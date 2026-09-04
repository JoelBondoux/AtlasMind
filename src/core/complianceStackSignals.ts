import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ComplianceStackSignals } from './complianceTechnicalControls.js';
import type { TestingPolicyCoverage } from './testingPolicyCoverage.js';
import { readDeliveryConfig } from './deliveryManager.js';
import { readWorkflowConfig } from './workflowConfig.js';
import { readWorkflowHistory, WORKFLOW_HISTORY_SSOT_PATH } from './workflowAuditRecord.js';
import { readRiskOversightConfig } from './riskOversightManager.js';
import { LENS_ENDPOINT_FILE, normalizeLensEndpointFile } from './lensEndpoints.js';
import { hasProviderDataGovernance } from './providerDataGovernance.js';

/**
 * What the workspace can tell the compliance control checks about the stack.
 *
 * Lifted out of the Settings panel so the Compliance page can gather the same
 * signals. A second implementation was the obvious alternative and the wrong
 * one: the two surfaces would eventually give different answers to "is a backup
 * taken before a production promotion?", and a compliance board where two pages
 * disagree is worse than one that does not answer at all.
 *
 * Everything here is a bounded file read. The single expensive input — the
 * coverage board, which means walking the test tree — is optional, so a caller
 * that has not paid for it gathers everything else and leaves those two signals
 * ungathered rather than guessing.
 */
/**
 * Config and CI files that evidence a testing policy's tooling.
 *
 * A fixed probe list rather than a walk: this runs on every dashboard render, and
 * the paths a tool writes are well known. Returns workspace-relative paths only.
 */
/**
 * What the stack can be asked about a governance regime.
 *
 * Gathered from files the dashboard already reads. Anything that cannot be
 * gathered is left `undefined` rather than defaulted — `complianceTechnicalControls`
 * treats absent as "not assessed", and a default would turn silence into a pass
 * on the one board where a false pass gets repeated to an auditor.
 */
export function gatherComplianceStackSignals(
  workspaceRoot: string,
  input: {
    readonly dependencies: readonly string[];
    readonly scripts: readonly string[];
    /**
     * The coverage board, when the caller has one.
     *
     * Optional because gathering it means walking the test tree, and the
     * dashboard renders far more often than that walk is worth. Omitting it
     * leaves the two signals derived from it ungathered, which reads
     * `unknown` — the correct answer to "we did not look", and one that
     * never counts as evidence.
     */
    readonly coverage?: TestingPolicyCoverage;
    readonly toolApprovalMode?: string;
    /** Providers the user has switched on — the sub-processors, in effect. */
    readonly enabledProviderIds?: readonly string[];
  },
): ComplianceStackSignals {
  const deps = input.dependencies.map(value => value.toLowerCase());
  const scripts = input.scripts.map(value => value.toLowerCase());
  const has = (candidate: string): boolean => existsSync(path.join(workspaceRoot, candidate));

  let workflowNames: string[] = [];
  try {
    workflowNames = readdirSync(path.join(workspaceRoot, '.github', 'workflows'))
      .filter(name => /\.ya?ml$/i.test(name))
      .map(name => name.toLowerCase())
      .slice(0, 60);
  } catch {
    workflowNames = [];
  }
  const workflowText = workflowNames.join(' ');
  const mentions = (names: readonly string[]): boolean => names.some(name =>
    deps.some(dep => dep.includes(name)) || scripts.some(script => script.includes(name)) || workflowText.includes(name));

  // The endpoint file is a committed declaration. Absent means the project has
  // declared no integrations, which is not the same as having none — so the
  // signal is omitted rather than reported as zero plaintext destinations.
  let endpoints: ComplianceStackSignals['endpoints'];
  try {
    const parsed = normalizeLensEndpointFile(
      JSON.parse(readFileSync(path.join(workspaceRoot, LENS_ENDPOINT_FILE), 'utf8')) as unknown,
    );
    if (parsed) {
      const list = parsed.file.endpoints;
      endpoints = {
        total: list.length,
        plaintextNonLoopback: list.filter(entry => {
          const url = (entry.url ?? '').toLowerCase();
          if (!url.startsWith('http://')) { return false; }
          return !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);
        }).length,
        usingSecretRefs: list.filter(entry => (entry.secretRef ?? '').length > 0).length,
      };
    }
  } catch {
    endpoints = undefined;
  }

  // Credentials in *settings* rather than in SecretStorage. A VS Code setting
  // is written to `settings.json` in clear text and is routinely committed or
  // synced, so a credential-shaped string property is the encryption-at-rest
  // failure this ecosystem actually has — and unlike a scan of the developer's
  // own machine it is checkable from the manifest, which is where the decision
  // was made. `secretRef`-style pointers are the sanctioned shape and are
  // matched exactly so they do not count against it.
  let secretsFoundInSettings: boolean | undefined;
  try {
    const manifest = JSON.parse(readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')) as {
      contributes?: { configuration?: { properties?: Record<string, { type?: unknown }> } };
    };
    const properties = manifest.contributes?.configuration?.properties;
    if (properties) {
      secretsFoundInSettings = Object.entries(properties).some(([key, schema]) => {
        const leaf = key.split('.').pop() ?? '';
        if (/^(secretRef|secretRefs|apiKeySettingKey)$/i.test(leaf)) { return false; }
        if (!/(apikey|api_key|token|secret|password|credential)/i.test(leaf)) { return false; }
        // A boolean toggle named `useToken` stores no credential; only a string
        // property can hold one.
        return schema?.type === 'string';
      });
    }
  } catch {
    secretsFoundInSettings = undefined;
  }

  const delivery = readDeliveryConfig(workspaceRoot);
  const production = delivery?.stages.find(stage => stage.kind === 'production')
    ?? [...(delivery?.stages ?? [])].sort((left, right) => right.rank - left.rank)[0];
  const workflowConfig = readWorkflowConfig(workspaceRoot);

  // Sub-processor risk (ISO A.5.19 / A.5.23, SOC 2 CC9.2). A provider the user
  // has switched on is one AtlasMind will send project text to, so "are its
  // retention and training terms on record?" is the supplier control in the
  // only form this product can answer it.
  const providerGovernance = input.enabledProviderIds
    ? {
      enabled: input.enabledProviderIds.length,
      withDeclaredGovernance: input.enabledProviderIds.filter(id => hasProviderDataGovernance(id)).length,
    }
    : undefined;

  // Risk assessment (SOC 2 CC3.2). Assessed, not empty — a register nobody has
  // run reports zero findings, and zero-because-unassessed must not read as
  // zero-because-clean.
  const risk = readRiskOversightConfig(workspaceRoot);
  const riskRegister = risk
    ? {
      assessed: risk.runs.length > 0,
      openFindings: risk.findings.filter(finding => finding.status === 'open').length,
    }
    : undefined;

  // Secure coding (ISO A.8.28). Configured *and* enforced: a linter that runs
  // only when somebody remembers is a suggestion, not an applied principle.
  const lintConfigured = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts', '.eslintrc.json', '.eslintrc.cjs', '.eslintrc.js', 'ruff.toml', '.golangci.yml']
    .some(candidate => has(candidate))
    || scripts.some(script => script === 'lint' || script.startsWith('lint:'));
  const lintInPipeline = workflowNames.length > 0
    && (workflowConfig?.stages ?? []).some(stage => stage.requiredStatusChecks.length > 0);

  const history = readWorkflowHistory(workspaceRoot);
  const auditPresent = existsSync(path.join(workspaceRoot, WORKFLOW_HISTORY_SSOT_PATH));

  // A policy the coverage board never scored is omitted rather than reported
  // as unevidenced: the regime check would otherwise read "guardrails have no
  // enforcement test" for a project that simply has the policy switched off.
  const statusOf = (id: string): string | undefined =>
    input.coverage?.rows.find(row => row.id === id)?.status;

  return {
    ciWorkflowCount: workflowNames.length,
    ciWorkflowNames: workflowNames,
    dependencyUpdatesConfigured: has('.github/dependabot.yml')
      || has('.github/dependabot.yaml')
      || has('renovate.json')
      || has('.github/renovate.json'),
    vulnerabilityScanningConfigured:
      mentions(['snyk', 'trivy', 'semgrep', 'codeql', 'grype', 'osv-scanner'])
      || scripts.some(script => script.includes('audit')),
    secretScanningConfigured:
      mentions(['gitleaks', 'trufflehog', 'detect-secrets']) || has('.gitleaks.toml'),
    securityPolicyPresent: has('SECURITY.md'),
    ...(workflowConfig
      ? {
        protectedBranches: workflowConfig.branches.protected,
        requiredStatusChecks: [...new Set(workflowConfig.stages.flatMap(stage => stage.requiredStatusChecks))],
        requiredHumanChecks: [...new Set(workflowConfig.stages.flatMap(stage => stage.requiredChecks))],
      }
      : {}),
    ...(production
      ? {
        backup: {
          required: production.backupPolicy.required,
          hasCommand: (production.backupPolicy.command ?? '').trim().length > 0,
          hasVerifyCommand: (production.backupPolicy.verifyCommand ?? '').trim().length > 0,
          // A project whose every stage declares no data store has nothing to
          // back up, and reporting that as a failure is a false gap.
          hasDataRepository: (delivery?.stages ?? []).some(stage => stage.data.kind !== 'none'),
        },
      }
      : {}),
    ...(delivery
      ? {
        deploymentStages: {
          count: delivery.stages.length,
          hasProtectedProduction: delivery.stages.some(stage => stage.isProtected),
        },
      }
      : {}),
    ...(endpoints ? { endpoints } : {}),
    ...(secretsFoundInSettings === undefined ? {} : { secretsFoundInSettings }),
    ...(providerGovernance ? { providerGovernance } : {}),
    ...(riskRegister ? { riskRegister } : {}),
    lintConfigured,
    lintInPipeline,
    auditLedger: { present: auditPresent, runCount: history.records.length },
    ...(input.toolApprovalMode ? { toolApprovalMode: input.toolApprovalMode } : {}),
    modelCardPresent: has('MODEL_CARD.md') || has('docs/model-card.md'),
    ...(statusOf('security-testing') === undefined ? {} : { securityTestingEvidenced: statusOf('security-testing') === 'covered' }),
    ...(statusOf('guardrail') === undefined ? {} : { guardrailEvidenced: statusOf('guardrail') === 'covered' }),
    ...(statusOf('audit-trail') === undefined ? {} : { auditTrailEvidenced: statusOf('audit-trail') === 'covered' }),
  };
}
