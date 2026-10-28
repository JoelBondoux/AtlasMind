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
import { createHash, randomBytes } from 'node:crypto';
import * as os from 'node:os';
import {
  buildBuzzAcpRuntimeSetup,
  buildBuzzHarnessDefinition,
  buzzCustomHarnessDirectory,
  buzzHarnessIdFor,
  describeBuzzHarnessSteps,
  planBuzzHarnessWrite,
} from '../acp/buzzAcpSetup.js';
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
import { buildBuzzPersonaManifest, parseBuzzPersonaManifest, type ManifestModelAccessInput } from '../core/buzzPersonaManifest.js';
import {
  PERSONA_DEPLOYMENTS_KEY,
  PERSONA_RECOMMENDATION_DISMISSALS_KEY,
  readPersonaDeployments,
  recordVerifiedIdentity,
} from '../core/buzzPersonaDeployments.js';
import {
  createPersonaChallenge,
  personaChallengeMessage,
  verifyPersonaAnswer,
  type PersonaChallenge,
} from '../core/buzzPersonaVerification.js';
import type { NostrEvent } from '../core/buzzProtocol.js';
import type { BuzzClientStatus } from '../core/buzzClient.js';
import { CURRENT_SCHEMA_VERSIONS } from '../core/schemaMigration.js';
import { openWorkspaceFolders } from '../utils/workspaceRoots.js';

const DISMISSALS_KEY = PERSONA_RECOMMENDATION_DISMISSALS_KEY;

/** The part of the inbound subscription a persona check needs. */
export interface PersonaCheckInbound {
  getStatus(): BuzzClientStatus;
  onDidObserveEvent(observer: (event: NostrEvent) => void): vscode.Disposable;
}

export interface BuzzPersonaCommandDeps {
  /** The live registry, read when a command runs so it reflects agents created since activation. */
  getAgentRegistry: () => Pick<AgentRegistry, 'listAgents' | 'listEnabledAgents' | 'isEnabled'> | undefined;
  workspaceState: vscode.Memento;
  globalStorageUri: vscode.Uri;
  /** Ensures the ACP launcher exists and returns its directory. */
  prepareLauncher: () => Promise<string | undefined>;
  /** The inbound subscription, which is how a check's answer is seen. */
  getBuzzInbound?: () => PersonaCheckInbound | undefined;
  /** Inbound settings, read when a check starts. */
  readInboundGates?: () => { enabled: boolean; inboundEnabled: boolean; channelIds: string[] };
  /** AtlasMind's revocation list. */
  isRevoked?: (pubkey: string) => boolean;
}

export function registerBuzzPersonaCommands(deps: BuzzPersonaCommandDeps): vscode.Disposable[] {
  const checks = new PersonaChecks(deps);
  return [
    vscode.commands.registerCommand('atlasmind.buzz.recommendPersonas', async () => recommendPersonas(deps)),
    vscode.commands.registerCommand('atlasmind.buzz.preparePersonaDeployment', async () => preparePersonaDeployment(deps)),
    vscode.commands.registerCommand('atlasmind.buzz.verifyPersonaDeployment', async () => checks.start()),
    checks,
  ];
}

/** The editor's ACP settings, as a persona manifest carries them. */
export function readManifestModelAccess(): ManifestModelAccessInput {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  return {
    acpAgents: configuration.get<unknown>('acp.agents'),
    hideConsoleWindows: configuration.get<boolean>('acp.hideConsoleWindows', false),
  };
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
  const built = buildBuzzPersonaManifest(picked.profile, agentRegistry.listAgents(), id => agentRegistry.isEnabled(id), readManifestModelAccess());
  if (built.kind === 'refused') {
    void vscode.window.showErrorMessage(built.reason);
    return;
  }
  const acpAgentIds = built.manifest.modelAccess?.acpAgents.map(agent => agent.id) ?? [];

  const deployments = readPersonaDeployments(deps.workspaceState.get<unknown>(PERSONA_DEPLOYMENTS_KEY));
  const previous = deployments[picked.profile.id];
  const changed = previous !== undefined && previous.manifestFingerprint !== built.manifest.fingerprint;
  const CONTINUE = changed ? 'Resynchronise' : 'Write manifest and copy recipe';
  // Buzz is installed for this user when its app-data folder exists; only
  // then is there a harness folder for AtlasMind to register into.
  const harnessFolder = buzzCustomHarnessDirectory(process.platform, process.env, os.homedir());
  const buzzInstalled = harnessFolder !== undefined && await pathExists(path.dirname(harnessFolder));
  const harnessName = `AtlasMind ${picked.profile.displayName}`;
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
        buzzInstalled
          ? `It also registers a Buzz harness named "${harnessName}" in Buzz's custom-harness folder (${harnessFolder}), which Buzz reads by itself. The harness holds the launch command and arguments, no credentials; then you pick it for the agent. A harness AtlasMind did not register is never overwritten.`
          : '',
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
  let harnessSteps = '';
  let registrationNote = '';
  try {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, text, 'utf8');
    const setup = buildBuzzAcpRuntimeSetup({
      workspaceRoot: root,
      runtimeExecutable: process.execPath,
      agentEntrypoint: path.join(launcherDirectory, 'atlasmind-acp-runner.js'),
      personaManifestPath: manifestPath,
      manifestAcpAgentIds: acpAgentIds,
      // One harness per persona: the manifest is in the arguments.
      harnessName,
    });
    await vscode.env.clipboard.writeText(JSON.stringify(setup, null, 2));
    let registered = false;
    if (buzzInstalled && harnessFolder) {
      const definition = buildBuzzHarnessDefinition(setup, buzzHarnessIdFor(picked.profile.id));
      const target = path.join(harnessFolder, `${definition.id}.json`);
      const existing = await fs.readFile(target, 'utf8').catch(() => undefined);
      const plan = planBuzzHarnessWrite(existing, definition);
      if (plan.kind === 'refuse') {
        registrationNote = ` AtlasMind did not register the harness: ${plan.reason} (${target}).`;
      } else {
        if (plan.kind !== 'unchanged') {
          await fs.mkdir(harnessFolder, { recursive: true });
          await fs.writeFile(target, `${JSON.stringify(definition, null, 2)}\n`, 'utf8');
        }
        registered = true;
      }
    }
    harnessSteps = describeBuzzHarnessSteps(setup, registered);
  } catch (error) {
    void vscode.window.showErrorMessage(`AtlasMind could not prepare the persona: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  // A verified identity is kept on the record: it still names who ran the
  // persona, and the card asks for a fresh check when the manifest moved on.
  const identity = previous?.identity;
  await deps.workspaceState.update(PERSONA_DEPLOYMENTS_KEY, {
    ...deployments,
    [picked.profile.id]: {
      manifestFingerprint: built.manifest.fingerprint,
      preparedAt: new Date().toISOString(),
      status: identity && identity.manifestFingerprint === built.manifest.fingerprint ? 'verified' : 'prepared',
      ...(identity ? { identity } : {}),
    },
  });
  void vscode.window.showInformationMessage(
    `Prepared ${picked.profile.displayName}.${registrationNote} ${harnessSteps} Add the agent to the project channel, then run "AtlasMind: Verify Buzz Persona Deployment" to record which identity runs it.`,
  );
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Persona checks in flight. Session-scoped: a challenge is worth fifteen
 * minutes and is never written anywhere, so a reload simply asks again.
 */
class PersonaChecks implements vscode.Disposable {
  private readonly open = new Map<string, { challenge: PersonaChallenge; displayName: string }>();
  private observer: vscode.Disposable | undefined;
  private expiryTimer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: BuzzPersonaCommandDeps) {}

  async start(): Promise<void> {
    const inbound = this.deps.getBuzzInbound?.();
    const gates = this.deps.readInboundGates?.();
    if (!inbound || !gates || !gates.enabled || !gates.inboundEnabled) {
      const OPEN = 'Open Buzz setup';
      const choice = await vscode.window.showWarningMessage(
        'AtlasMind sees a persona\'s answer through its Buzz inbound subscription, which is off. Turn on atlasmind.buzz.enabled and atlasmind.buzz.inboundEnabled, and watch the channel the persona is in, then run the check again.',
        OPEN,
      );
      if (choice === OPEN) {
        await vscode.commands.executeCommand('atlasmind.buzz.openGuide');
      }
      return;
    }
    const root = await pickWorkspaceRoot('Choose the project whose Buzz persona you are checking');
    if (!root) {
      return;
    }
    const read = readBuzzPersonaDocument(root);
    const deployments = readPersonaDeployments(this.deps.workspaceState.get<unknown>(PERSONA_DEPLOYMENTS_KEY));
    const prepared = (read.document?.profiles ?? []).filter(profile => deployments[profile.id]);
    if (prepared.length === 0) {
      void vscode.window.showWarningMessage('No persona has been prepared on this machine yet. Run "AtlasMind: Prepare Buzz Persona Deployment" first.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      prepared.map(profile => ({
        label: profile.displayName,
        description: deployments[profile.id]!.identity ? `verified ${deployments[profile.id]!.identity!.verifiedAt.slice(0, 10)}` : 'not verified',
        profile,
      })),
      { title: 'Check which Buzz identity runs a persona' },
    );
    if (!picked) {
      return;
    }
    const challenge = createPersonaChallenge(
      picked.profile.id,
      deployments[picked.profile.id]!.manifestFingerprint,
      Date.now(),
      randomBytes(16).toString('hex'),
    );
    this.open.set(picked.profile.id, { challenge, displayName: picked.profile.displayName });
    this.ensureObserving(inbound);
    const message = personaChallengeMessage(challenge, picked.profile.displayName);
    await vscode.env.clipboard.writeText(message);
    const status = inbound.getStatus();
    void vscode.window.showInformationMessage(
      `Copied a check for ${picked.profile.displayName}. Post it in a channel AtlasMind watches where ${picked.profile.displayName} is a member, mentioning the agent. `
      + `The identity that answers it within 15 minutes, with a signature its owner authorised, is offered for recording.`
      + (status === 'live' || status === 'subscribed' ? '' : ` The Buzz subscription is ${status} right now, so an answer may not be seen until it reconnects.`),
    );
  }

  private ensureObserving(inbound: PersonaCheckInbound): void {
    if (!this.observer) {
      this.observer = inbound.onDidObserveEvent(event => { void this.judge(event); });
    }
    if (!this.expiryTimer) {
      this.expiryTimer = setInterval(() => this.expire(), 60_000);
      this.expiryTimer.unref?.();
    }
  }

  private expire(): void {
    const now = Date.now();
    for (const [personaId, entry] of this.open) {
      if (now > entry.challenge.expiresAt) {
        this.open.delete(personaId);
        void vscode.window.showWarningMessage(`Nothing answered the check for ${entry.displayName} within 15 minutes, so no identity was recorded. Check the agent runs as a Custom command in Buzz and is in that channel, then try again.`);
      }
    }
    if (this.open.size === 0) {
      this.stopObserving();
    }
  }

  private async judge(event: NostrEvent): Promise<void> {
    if (this.open.size === 0) {
      return;
    }
    const verdict = await verifyPersonaAnswer(event, [...this.open.values()].map(entry => entry.challenge), {
      now: Date.now(),
      ...(this.deps.isRevoked ? { isRevoked: this.deps.isRevoked } : {}),
    });
    if (verdict.status === 'ignored' || verdict.status === 'unknown-challenge') {
      return;
    }
    const entry = this.open.get(verdict.personaId);
    if (!entry) {
      return;
    }
    if (verdict.status === 'expired') {
      this.open.delete(verdict.personaId);
      void vscode.window.showWarningMessage(`The answer for ${entry.displayName} arrived after its check expired, so nothing was recorded. Run the check again.`);
      return;
    }
    if (verdict.status === 'invalid') {
      void vscode.window.showWarningMessage(`An answer for ${entry.displayName} was not accepted: ${verdict.reason}. The check stays open.`);
      return;
    }
    if (verdict.status === 'stale-manifest') {
      void vscode.window.showWarningMessage(
        `${entry.displayName} answered from ${verdict.pubkey.slice(0, 12)}… with manifest ${verdict.answeredWith}, but the prepared one is ${verdict.expected}. Restart the agent in Buzz so it loads the prepared manifest; the check stays open.`,
      );
      return;
    }
    this.open.delete(verdict.personaId);
    if (this.open.size === 0) {
      this.stopObserving();
    }
    const RECORD = 'Record this identity';
    const choice = await vscode.window.showInformationMessage(
      `${entry.displayName} answered the check. Record its Buzz identity?`,
      {
        modal: true,
        detail: [
          `Identity: ${verdict.pubkey}`,
          `Authorised by: ${verdict.ownerPubkey}`,
          'Record it only if you recognise that owner key — usually your own Buzz Desktop identity. AtlasMind checked the signature and the owner attestation; it cannot know whose key the owner is.',
          'This is stored in this workspace on this machine only, never in the repository.',
        ].join('\n\n'),
      },
      RECORD,
    );
    if (choice !== RECORD) {
      return;
    }
    const deployments = readPersonaDeployments(this.deps.workspaceState.get<unknown>(PERSONA_DEPLOYMENTS_KEY));
    const { next, displaced } = recordVerifiedIdentity(deployments, verdict.personaId, {
      pubkey: verdict.pubkey,
      ownerPubkey: verdict.ownerPubkey,
      verifiedAt: new Date(verdict.verifiedAt).toISOString(),
      manifestFingerprint: entry.challenge.manifestFingerprint,
    });
    await this.deps.workspaceState.update(PERSONA_DEPLOYMENTS_KEY, next);
    void vscode.window.showInformationMessage(
      `Recorded ${verdict.pubkey.slice(0, 12)}… as ${entry.displayName}.${displaced.length > 0 ? ` It was recorded for ${displaced.join(', ')} before; one identity runs one persona, so that record was cleared.` : ''}`,
    );
  }

  private stopObserving(): void {
    this.observer?.dispose();
    this.observer = undefined;
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = undefined;
    }
  }

  dispose(): void {
    this.open.clear();
    this.stopObserving();
  }
}
