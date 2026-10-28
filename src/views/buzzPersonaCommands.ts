/**
 * Buzz persona teams in the editor (Buzz Tier 5): review a suggested team and
 * accept it as project intent, and prepare one persona's deployment.
 *
 * Neither command creates a Buzz identity, starts a process, or touches a
 * channel. Accepting writes `.atlasmind/buzz-agents.json` after a modal that
 * shows the team and why each agent is in it. Preparing writes the persona's
 * manifest to AtlasMind's own storage and copies a credential-free launch
 * recipe; the identity is created in Buzz by the person, and AtlasMind does
 * not report it created because a recipe was copied.
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { AgentRegistry } from '../core/agentRegistry.js';
import {
  describeRecommendation,
  isReviewOnlyAgent,
  pendingRecommendations,
  recommendBuzzPersonas,
  recommendationToProfile,
  type RecommendationDismissals,
} from '../core/buzzAgentRecommendations.js';
import {
  BUZZ_PERSONA_FILE,
  readBuzzPersonaDocument,
  validateBuzzPersonaProfiles,
  writeBuzzPersonaDocument,
  type BuzzPersonaDocument,
} from '../core/buzzPersonaProfiles.js';
import { buildBuzzPersonaManifest, parseBuzzPersonaManifest } from '../core/buzzPersonaManifest.js';
import { CURRENT_SCHEMA_VERSIONS } from '../core/schemaMigration.js';
import { openWorkspaceFolders } from '../utils/workspaceRoots.js';

const DISMISSALS_KEY = 'atlasmind.buzz.personaRecommendationDismissals';
const DEPLOYMENTS_KEY = 'atlasmind.buzz.personaDeployments';

/** What this machine knows about a prepared persona. Never a key, never a message. */
export interface PersonaDeploymentRecord {
  manifestFingerprint: string;
  preparedAt: string;
  status: 'prepared';
}

export interface BuzzPersonaCommandDeps {
  /** The live registry, read when a command runs so it reflects agents created since activation. */
  getAgentRegistry: () => Pick<AgentRegistry, 'listAgents' | 'listEnabledAgents' | 'isEnabled'> | undefined;
  workspaceState: vscode.Memento;
  globalStorageUri: vscode.Uri;
  /** Ensures the ACP launcher exists and returns its directory. */
  prepareLauncher: () => Promise<string | undefined>;
}

export function registerBuzzPersonaCommands(deps: BuzzPersonaCommandDeps): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('atlasmind.buzz.recommendPersonas', async () => recommendPersonas(deps)),
    vscode.commands.registerCommand('atlasmind.buzz.preparePersonaDeployment', async () => preparePersonaDeployment(deps)),
  ];
}

async function pickWorkspaceRoot(purpose: string): Promise<string | undefined> {
  const folders = openWorkspaceFolders();
  if (folders.length === 0) {
    void vscode.window.showWarningMessage('Open the project this Buzz persona belongs to, then try again.');
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0]!.uri.fsPath;
  }
  const picked = await vscode.window.showQuickPick(
    folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { title: purpose },
  );
  return picked?.folder.uri.fsPath;
}

function registryFacts(agentRegistry: Pick<AgentRegistry, 'listAgents' | 'isEnabled'>) {
  return agentRegistry.listAgents().map(agent => ({
    id: agent.id,
    enabled: agentRegistry.isEnabled(agent.id),
    oversight: isReviewOnlyAgent(agent),
  }));
}

async function recommendPersonas(deps: BuzzPersonaCommandDeps): Promise<void> {
  const agentRegistry = deps.getAgentRegistry();
  if (!agentRegistry) {
    return;
  }
  const root = await pickWorkspaceRoot('Choose the project to suggest Buzz personas for');
  if (!root) {
    return;
  }
  const read = readBuzzPersonaDocument(root);
  if (read.exists && read.preserveExisting) {
    void vscode.window.showErrorMessage(`AtlasMind will not change ${BUZZ_PERSONA_FILE}: ${read.findings[0]?.message ?? read.notice ?? 'it cannot be read by this build'}.`);
    return;
  }
  const dismissals = deps.workspaceState.get<RecommendationDismissals>(DISMISSALS_KEY, {});
  const pending = pendingRecommendations(recommendBuzzPersonas(agentRegistry.listEnabledAgents()), read.document, dismissals);
  if (pending.length === 0) {
    void vscode.window.showInformationMessage('No new Buzz persona to suggest: every team the enabled agents form is already accepted or set aside.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    pending.map(recommendation => ({
      label: recommendation.displayName,
      description: `${recommendation.members.length} agent${recommendation.members.length === 1 ? '' : 's'} · leads ${recommendation.preferredAgentId}${recommendation.optional ? ' · optional' : ''}`,
      detail: recommendation.members.map(member => member.agentId).join(', '),
      recommendation,
    })),
    { title: 'Suggested Buzz personas', placeHolder: 'Each is one Buzz identity backed by a team of AtlasMind agents' },
  );
  if (!picked) {
    return;
  }
  const recommendation = picked.recommendation;
  const ACCEPT = 'Accept and save';
  const NOT_NOW = 'Not now';
  const choice = await vscode.window.showInformationMessage(
    `Save ${recommendation.displayName} as a Buzz persona for this project?`,
    {
      modal: true,
      detail: `${describeRecommendation(recommendation)}\n\nThis writes ${BUZZ_PERSONA_FILE}. It creates no Buzz identity and starts nothing; deploying it is a separate step.`,
    },
    ACCEPT,
    NOT_NOW,
  );
  if (choice === NOT_NOW) {
    await deps.workspaceState.update(DISMISSALS_KEY, { ...dismissals, [recommendation.id]: recommendation.registryFingerprint });
    return;
  }
  if (choice !== ACCEPT) {
    return;
  }
  const document: BuzzPersonaDocument = read.document ?? { version: CURRENT_SCHEMA_VERSIONS['buzz-agents'], profiles: [] };
  const next: BuzzPersonaDocument = { ...document, profiles: [...document.profiles, recommendationToProfile(recommendation)] };
  const written = await writeBuzzPersonaDocument(root, next);
  if (!written.ok) {
    void vscode.window.showErrorMessage(`AtlasMind did not save the persona: ${written.reason}`);
    return;
  }
  const warnings = validateBuzzPersonaProfiles(next, registryFacts(agentRegistry)).filter(finding => finding.profileId === recommendation.id);
  const OPEN = 'Open to customise';
  const action = await vscode.window.showInformationMessage(
    `Saved ${recommendation.displayName} to ${BUZZ_PERSONA_FILE}.${warnings.length > 0 ? ` ${warnings.map(warning => warning.message).join(' ')}` : ''}`,
    OPEN,
  );
  if (action === OPEN) {
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, BUZZ_PERSONA_FILE)));
  }
}

async function preparePersonaDeployment(deps: BuzzPersonaCommandDeps): Promise<void> {
  const agentRegistry = deps.getAgentRegistry();
  if (!agentRegistry) {
    return;
  }
  const root = await pickWorkspaceRoot('Choose the project whose Buzz persona you are deploying');
  if (!root) {
    return;
  }
  const read = readBuzzPersonaDocument(root);
  if (!read.document || read.document.profiles.length === 0) {
    void vscode.window.showWarningMessage(read.exists
      ? `${BUZZ_PERSONA_FILE} has no usable persona: ${read.findings.map(finding => `${finding.profileId}: ${finding.message}`).join('; ') || 'it is empty'}.`
      : `There is no ${BUZZ_PERSONA_FILE} yet. Run "AtlasMind: Recommend Buzz Personas" first.`);
    return;
  }
  const findings = validateBuzzPersonaProfiles(read.document, registryFacts(agentRegistry));
  const picked = await vscode.window.showQuickPick(
    read.document.profiles.map(profile => {
      const problems = findings.filter(finding => finding.profileId === profile.id);
      return {
        label: profile.displayName,
        description: `${profile.agentIds.length} agents · ${profile.skillCeiling.mode}`,
        detail: problems.length > 0 ? problems.map(problem => problem.message).join(' ') : profile.agentIds.join(', '),
        profile,
      };
    }),
    { title: 'Prepare a Buzz persona deployment' },
  );
  if (!picked) {
    return;
  }
  // The persona reaches models through the same ACP agents the editor does;
  // their launch settings travel in the manifest, their sign-ins stay put.
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const built = buildBuzzPersonaManifest(picked.profile, agentRegistry.listAgents(), id => agentRegistry.isEnabled(id), {
    acpAgents: configuration.get<unknown>('acp.agents'),
    hideConsoleWindows: configuration.get<boolean>('acp.hideConsoleWindows', false),
  });
  if (built.kind === 'refused') {
    void vscode.window.showErrorMessage(built.reason);
    return;
  }
  const acpAgentIds = built.manifest.modelAccess?.acpAgents.map(agent => agent.id) ?? [];

  const deployments = deps.workspaceState.get<Record<string, PersonaDeploymentRecord>>(DEPLOYMENTS_KEY, {});
  const previous = deployments[picked.profile.id];
  const changed = previous !== undefined && previous.manifestFingerprint !== built.manifest.fingerprint;
  const CONTINUE = changed ? 'Resynchronise' : 'Write manifest and copy recipe';
  const confirm = await vscode.window.showInformationMessage(
    changed
      ? `${picked.profile.displayName}'s agents changed since it was prepared on ${previous!.preparedAt.slice(0, 10)}. Resynchronise its manifest?`
      : `Prepare ${picked.profile.displayName} for Buzz?`,
    {
      modal: true,
      detail: [
        `Members: ${built.manifest.persona.agentIds.join(', ')} (leads ${built.manifest.persona.preferredAgentId}).`,
        acpAgentIds.length > 0
          ? `Models: your ACP agents ${acpAgentIds.join(', ')}, answering only — their launch settings are copied, their sign-ins stay where they are.`
          : 'Models: no ACP agent is configured, so the Buzz agent needs an ATLASMIND_PROVIDER_* variable in its environment.',
        ...built.notices,
        changed ? 'A Buzz identity already running this persona will use the new definitions when it next starts.' : '',
        'AtlasMind writes the manifest to its own storage (not the repository) and copies a launch recipe with no credentials in it. You create the managed agent in Buzz yourself.',
      ].filter(Boolean).join('\n\n'),
    },
    CONTINUE,
  );
  if (confirm !== CONTINUE) {
    return;
  }

  const launcherDirectory = await deps.prepareLauncher();
  if (!launcherDirectory) {
    void vscode.window.showErrorMessage('AtlasMind could not create its ACP launcher. Rebuild or reinstall the extension and try again.');
    return;
  }
  const projectKey = createHash('sha256').update(path.resolve(root), 'utf8').digest('hex').slice(0, 12);
  const manifestPath = path.join(deps.globalStorageUri.fsPath, 'buzz-personas', `${projectKey}-${picked.profile.id}.json`);
  const text = `${JSON.stringify(built.manifest, null, 2)}\n`;
  // The loader re-verifies on start; checking here means a bad write is seen now, not by Buzz.
  if (parseBuzzPersonaManifest(text).kind !== 'ok') {
    void vscode.window.showErrorMessage('AtlasMind produced a manifest it could not verify, so nothing was written.');
    return;
  }
  try {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, text, 'utf8');
    const { buildBuzzAcpRuntimeSetup } = await import('../acp/buzzAcpSetup.js');
    const setup = buildBuzzAcpRuntimeSetup({
      workspaceRoot: root,
      runtimeExecutable: process.execPath,
      agentEntrypoint: path.join(launcherDirectory, 'atlasmind-acp-runner.js'),
      personaManifestPath: manifestPath,
      manifestAcpAgentIds: acpAgentIds,
    });
    await vscode.env.clipboard.writeText(JSON.stringify(setup, null, 2));
  } catch (error) {
    void vscode.window.showErrorMessage(`AtlasMind could not prepare the persona: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  await deps.workspaceState.update(DEPLOYMENTS_KEY, {
    ...deployments,
    [picked.profile.id]: { manifestFingerprint: built.manifest.fingerprint, preparedAt: new Date().toISOString(), status: 'prepared' },
  });
  void vscode.window.showInformationMessage(
    `Copied the Buzz custom-agent fields for ${picked.profile.displayName}. In Buzz, create or edit the agent ${picked.profile.displayName}: Provider → Custom command, paste the Agent command, and under Advanced paste the Agent runtime args and set Parallelism to 1. Add it to the project channel, then mention it once to check it answers.`,
  );
}
