/**
 * Replays an agent's golden cases against a definition, and records the result.
 *
 * `agentEvalHarness` holds every rule — what counts as a regression, what an
 * errored case means, why a first run is not a pass. This runs the cases and
 * fills the `AgentUpdateVerifier` seam the auto-updater consults before it ships
 * an unattended rewrite.
 *
 * Two properties are worth stating.
 *
 * **A case is run against the *candidate* definition, not the live one.** That
 * is the entire point: the question is whether the rewrite the model just
 * produced still does what somebody pinned, and running the agent as currently
 * registered would answer a different question and always pass.
 *
 * **A case that could not be run is an error, never a failure.** Every call is
 * wrapped, and the reason travels into the result — the harness then sets it
 * aside rather than counting it against the rewrite, because a gate that blocks
 * every change during a provider outage is a gate somebody disables.
 */

import * as vscode from 'vscode';
import type { AgentDefinition, RoutingConstraints } from '../types.js';
import type { AgentRegistry } from '../core/agentRegistry.js';
import type { ModelRouter } from '../core/modelRouter.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { TaskProfiler } from '../core/taskProfiler.js';
import type { AgentUpdateVerifier } from '../core/agentAutoUpdater.js';
import { resolveProviderIdForModel } from '../core/orchestrator.js';
import { dispatchGuardedCompletion } from '../core/modelEgress.js';
import { isLocalProviderId } from '../core/backgroundMemoryPolicy.js';
import {
  compareWithBaseline,
  definitionFingerprint,
  gradeCase,
  judgeChecks,
  readEvalBaseline,
  readGoldenCases,
  writeEvalBaseline,
  type CaseResult,
  type EvalRun,
  type GoldenCase,
  type RegressionVerdict,
} from '../core/agentEvalHarness.js';

const EVAL_CONSTRAINTS: RoutingConstraints = { budget: 'balanced', speed: 'balanced' };
const EVAL_MAX_TOKENS = 1024;
/**
 * Zero temperature, deliberately.
 *
 * A replay set compares two runs, and sampling noise between them would show up
 * as regressions that are not there — which is the fastest way to teach somebody
 * that the gate cries wolf.
 */
const EVAL_TEMPERATURE = 0;

export interface AgentEvalDeps {
  agents: AgentRegistry;
  router: ModelRouter;
  providers: ProviderRegistry;
  /**
   * Optional: the router accepts no profile and still selects a model. The
   * profile only sharpens that choice, and a replay set cares far more about
   * running at all than about running on the ideal model.
   */
  profiler?: TaskProfiler;
  workspaceRoot: () => string | undefined;
}

/** Run one case against one definition. Never throws. */
async function runCase(
  deps: AgentEvalDeps,
  definition: AgentDefinition,
  golden: GoldenCase,
): Promise<CaseResult> {
  const judges = judgeChecks(golden);
  try {
    const profile = deps.profiler?.profileTask({
      userMessage: golden.prompt,
      phase: 'planning',
      requiresTools: false,
    });
    const model = deps.router.selectModel(EVAL_CONSTRAINTS, definition.allowedModels, profile);
    const providerId = resolveProviderIdForModel(model, deps.router, 'copilot');
    const provider = deps.providers.get(providerId);
    if (!provider) {
      return gradeCase(golden, { error: `No provider is available for ${model}.` });
    }
    const response = await dispatchGuardedCompletion({
      provider,
      origins: ['system-prompt', 'generated-instruction'],
      external: !isLocalProviderId(provider.providerId),
      request: {
        model,
        messages: [
          // The candidate definition, which is the whole question.
          { role: 'system', content: definition.systemPrompt },
          { role: 'user', content: golden.prompt },
        ],
        maxTokens: EVAL_MAX_TOKENS,
        temperature: EVAL_TEMPERATURE,
      },
    });
    return gradeCase(golden, {
      output: response.content,
      // No judge is consulted here. A judge check with no verdict fails rather
      // than passes, which is the honest outcome: asking a model to grade a
      // model is a separate decision with its own cost, and quietly passing
      // those checks would let a suite go green by not asking.
      ...(judges.length > 0 ? { judgeVerdicts: [] } : {}),
    });
  } catch (error) {
    return gradeCase(golden, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Replay every declared case for an agent against a definition. */
async function replayGoldenCases(
  deps: AgentEvalDeps,
  definition: AgentDefinition,
  cases: readonly GoldenCase[],
  now: string,
): Promise<EvalRun> {
  const results: CaseResult[] = [];
  for (const golden of cases) {
    results.push(await runCase(deps, definition, golden));
  }
  return {
    agentId: definition.id,
    ranAt: now,
    definitionFingerprint: definitionFingerprint(definition.systemPrompt, definition.description),
    results,
  };
}

/**
 * The seam the auto-updater consults.
 *
 * Returns `undefined` whenever the check genuinely could not be made — no
 * workspace, no cases — which the gate treats as *unverified* and therefore
 * holds. That is the intended reading: the alternative is a rewrite shipping
 * unattended on the strength of a check that did not happen.
 */
export function createAgentUpdateVerifier(deps: AgentEvalDeps): AgentUpdateVerifier {
  return {
    declaredCaseCount: agentId => {
      const root = deps.workspaceRoot();
      return root ? readGoldenCases(root).filter(entry => entry.agentId === agentId).length : 0;
    },
    verify: async (agent, candidate): Promise<RegressionVerdict | undefined> => {
      const root = deps.workspaceRoot();
      if (!root) {
        return undefined;
      }
      const cases = readGoldenCases(root).filter(entry => entry.agentId === agent.id);
      if (cases.length === 0) {
        return undefined;
      }
      // Against the candidate, never the live definition.
      const run = await replayGoldenCases(deps, candidate, cases, new Date().toISOString());
      return compareWithBaseline(agent.id, run, cases, readEvalBaseline(root));
    },
  };
}

/**
 * Run the suite for one agent on request, and record the result as the new
 * baseline.
 *
 * Recording is confirmed rather than automatic. A baseline is what every later
 * regression is measured against, so overwriting one is how a real regression
 * becomes the new normal — and the dialog says what it is about to accept.
 */
export async function runAgentEvalSuite(deps: AgentEvalDeps): Promise<void> {
  const root = deps.workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage('Open a workspace folder before running the agent evals.');
    return;
  }
  const cases = readGoldenCases(root);
  if (cases.length === 0) {
    void vscode.window.showInformationMessage(
      'No golden cases are declared. Add them to project_memory/agents/eval-cases.json — each needs a prompt, at least one check, and the reason it exists.',
    );
    return;
  }

  const agentIds = [...new Set(cases.map(entry => entry.agentId))];
  const picked = await vscode.window.showQuickPick(
    agentIds.map(id => ({
      label: deps.agents.listAgents().find(agent => agent.id === id)?.name ?? id,
      description: `${cases.filter(entry => entry.agentId === id).length} case(s)`,
      id,
    })),
    { title: 'Replay golden cases', placeHolder: 'Which agent?' },
  );
  if (!picked) {
    return;
  }

  const definition = deps.agents.listAgents().find(agent => agent.id === picked.id);
  if (!definition) {
    void vscode.window.showWarningMessage('That agent is no longer registered.');
    return;
  }

  const forAgent = cases.filter(entry => entry.agentId === picked.id);
  const baseline = readEvalBaseline(root);
  const run = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `AtlasMind: replaying ${forAgent.length} case(s)`, cancellable: false },
    async () => replayGoldenCases(deps, definition, forAgent, new Date().toISOString()),
  );
  const verdict = compareWithBaseline(picked.id, run, forAgent, baseline);

  const record = await vscode.window.showInformationMessage(
    verdict.summary,
    { modal: true, detail: buildVerdictDetail(verdict) },
    'Record as the new baseline',
  );
  if (record !== 'Record as the new baseline') {
    return;
  }
  await writeEvalBaseline(root, baseline ?? { version: 1, runs: [] }, run);
  void vscode.window.showInformationMessage('Baseline recorded. Later runs are compared against this one.');
}

function buildVerdictDetail(verdict: RegressionVerdict): string {
  const lines: string[] = [];
  if (verdict.regressions.length > 0) {
    lines.push('Regressed:');
    for (const result of verdict.regressions) {
      lines.push(`  ${result.caseId} — ${result.failedChecks.join('; ')}`);
    }
  }
  if (verdict.fixes.length > 0) {
    lines.push(`Now passing: ${verdict.fixes.join(', ')}`);
  }
  if (verdict.errored.length > 0) {
    // Named rather than counted: an outage and a broken prompt look identical
    // in a number.
    lines.push(`Errored and set aside: ${verdict.errored.join(', ')}`);
  }
  if (verdict.notRun.length > 0) {
    lines.push(`Did not run: ${verdict.notRun.join(', ')}`);
  }
  lines.push('');
  lines.push('Recording this as the baseline means every later run is compared against it — including any failure above.');
  return lines.join('\n');
}
