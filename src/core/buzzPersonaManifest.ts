/**
 * The runtime manifest for one Buzz persona (Buzz Tier 5, Phase 4).
 *
 * The persona file in the repository says *which* agents form a team. The ACP
 * process Buzz launches cannot see the editor's registry — it starts a fresh
 * headless runtime with only the built-ins — so a team that includes an agent
 * somebody created in the editor would be a team the Buzz identity cannot run.
 * The manifest closes that gap: a sanitised snapshot of exactly the member
 * definitions, written by the extension to its own storage and named on the
 * ACP command line with `--buzz-persona-manifest`.
 *
 * Six rules.
 *
 * 1. **Only the members.** Unrelated agents are not exported; a member that is
 *    missing or disabled is reported and left out, never replaced.
 * 2. **No secrets.** A definition carrying anything the redactor would change
 *    refuses the export, naming the agent and field — the file is copied
 *    between processes and a scrubbed copy would report success while the
 *    secret stays in the agent.
 * 3. **Integrity is checked, not assumed.** The fingerprint is a full SHA-256
 *    over the canonical contents and is recomputed on load; a manifest edited
 *    by hand, truncated, or written by a newer build is refused whole.
 * 4. **Outside the workspace.** A manifest inside the repository is a file
 *    another contributor can edit, and it carries the system prompts the
 *    persona runs with; the loader refuses it. It must also be a plain file,
 *    not a link, and small.
 * 5. **A change is visible, not silent.** `manifestIsStale` compares the stored
 *    fingerprint with what the live registry would export now, so a changed
 *    system prompt under a running signed identity is shown and resynchronised
 *    deliberately.
 * 6. **No Buzz key, no provider credential, no channel history** — there is no
 *    field that could hold one.
 *
 * Since 0.513.0 a manifest may also say how the persona reaches **models**: the
 * ACP subscription agents from `atlasmind.acp.agents`. The headless process has
 * no SecretStorage and no settings, so without this a subscription-only user's
 * persona started, said hello, and had nothing to answer with. What crosses is
 * launch settings — a command, its arguments, declared launch variables — and
 * never a sign-in: each agent keeps its own login on this machine. A launch
 * variable with a credential-shaped name or a secret-shaped value refuses the
 * manifest, naming the agent and the variable, for the reason rule 2 refuses a
 * secret in a prompt.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentDefinition, AgentSkillPolicy, PersonaScope, PersonaSkillCeiling } from '../types.js';
import { parseAcpAgentSettings, type AcpAgentConfig } from '../providers/acp.js';
import { redactSecrets } from '../utils/secretRedactor.js';
import { classifyEnvironmentName } from './hostCommandEnvironment.js';
import { canonicalJson } from './workflowAuditRecord.js';
import type { BuzzPersonaProfile, PersonaIndependenceClass } from './buzzPersonaProfiles.js';
import { PERSONA_INDEPENDENCE_CLASSES } from './buzzPersonaProfiles.js';
import { readPersonaScope } from './personaScope.js';

export const BUZZ_PERSONA_MANIFEST_KIND = 'atlasmind-buzz-persona-manifest';
export const BUZZ_PERSONA_MANIFEST_VERSION = 1;
export const MAX_PERSONA_MANIFEST_BYTES = 1_000_000;
const MAX_SYSTEM_PROMPT_CHARS = 100_000;
const MAX_TEXT_CHARS = 2_000;
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SKILL_ID = /^[A-Za-z0-9:._-]{1,200}$/;
const SKILL_POLICIES: readonly AgentSkillPolicy[] = ['task-scoped', 'allowlist', 'all'];

/** The fields of an agent the headless runtime needs. Nothing else is exported. */
export interface ManifestAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  skills: string[];
  skillPolicy?: AgentSkillPolicy;
  primaryRoutingNeeds?: string[];
  allowedModels?: string[];
  costLimitUsd?: number;
}

export interface ManifestPersona {
  id: string;
  displayName: string;
  purpose: string;
  agentIds: string[];
  preferredAgentId: string;
  independenceClass: PersonaIndependenceClass;
  skillCeiling: PersonaSkillCeiling;
}

/**
 * How the headless runtime reaches models: the user's ACP agents, as
 * `parseAcpAgentSettings` reads `atlasmind.acp.agents`. Launch settings only.
 */
export interface ManifestModelAccess {
  acpAgents: AcpAgentConfig[];
  /** Windows: `atlasmind.acp.hideConsoleWindows`, so a Buzz-launched agent behaves as the editor's does. */
  hideConsoleWindows: boolean;
}

/** What the extension reads from settings and offers the manifest. */
export interface ManifestModelAccessInput {
  /** The raw `atlasmind.acp.agents` value; read through the same parser the editor uses. */
  acpAgents: unknown;
  hideConsoleWindows?: boolean;
}

export interface BuzzPersonaManifest {
  kind: typeof BUZZ_PERSONA_MANIFEST_KIND;
  version: number;
  persona: ManifestPersona;
  agents: ManifestAgent[];
  /** Absent when no ACP agent is configured: the persona then uses the CLI's provider variables. */
  modelAccess?: ManifestModelAccess;
  /** SHA-256 over the canonical persona, agents and model access. */
  fingerprint: string;
}

export type ManifestBuild =
  | { kind: 'ok'; manifest: BuzzPersonaManifest; notices: string[] }
  | { kind: 'refused'; reason: string };

function snapshotAgent(agent: AgentDefinition): ManifestAgent {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    description: agent.description,
    systemPrompt: agent.systemPrompt ?? '',
    skills: [...agent.skills],
    ...(agent.skillPolicy ? { skillPolicy: agent.skillPolicy } : {}),
    ...(agent.primaryRoutingNeeds?.length ? { primaryRoutingNeeds: [...agent.primaryRoutingNeeds] } : {}),
    ...(agent.allowedModels?.length ? { allowedModels: [...agent.allowedModels] } : {}),
    ...(typeof agent.costLimitUsd === 'number' ? { costLimitUsd: agent.costLimitUsd } : {}),
  };
}

/** The first field of an agent the redactor would change, or `undefined`. */
function secretField(agent: ManifestAgent): string | undefined {
  const fields: Array<[string, string]> = [
    ['name', agent.name], ['role', agent.role], ['description', agent.description], ['systemPrompt', agent.systemPrompt],
    ...agent.skills.map((skill, index): [string, string] => [`skills[${index}]`, skill]),
  ];
  for (const [field, value] of fields) {
    if (redactSecrets(value).redactedCount > 0) {
      return field;
    }
  }
  return undefined;
}

function computeFingerprint(persona: ManifestPersona, agents: readonly ManifestAgent[], modelAccess?: ManifestModelAccess): string {
  const contents = modelAccess ? { persona, agents, modelAccess } : { persona, agents };
  return createHash('sha256').update(canonicalJson(contents), 'utf8').digest('hex');
}

/**
 * Why an ACP agent's launch settings cannot travel in a manifest, or
 * `undefined`. Names the agent and the variable, never the value.
 */
function modelAccessRefusal(agents: readonly AcpAgentConfig[]): string | undefined {
  for (const agent of agents) {
    const texts: Array<[string, string]> = [
      ['command', agent.command],
      ...(agent.args ?? []).map((arg, index): [string, string] => [`args[${index}]`, arg]),
      ...(agent.label ? [['label', agent.label] as [string, string]] : []),
    ];
    for (const [field, value] of texts) {
      if (redactSecrets(value).redactedCount > 0) {
        return `ACP agent ${agent.id} has what looks like a secret in its ${field}`;
      }
    }
    for (const [name, value] of Object.entries(agent.env ?? {})) {
      const rule = classifyEnvironmentName(name);
      if (rule) {
        return `ACP agent ${agent.id} passes ${name}, a credential-shaped variable (${rule}); a manifest carries launch settings, never credentials — let the agent use its own sign-in`;
      }
      if (redactSecrets(value).redactedCount > 0) {
        return `ACP agent ${agent.id} passes ${name} with what looks like a secret`;
      }
    }
  }
  return undefined;
}

/** Read the user's ACP settings into model access, or refuse. Empty is absent. */
function buildModelAccess(input: ManifestModelAccessInput | undefined): { access?: ManifestModelAccess } | { refused: string } {
  const acpAgents = parseAcpAgentSettings(input?.acpAgents);
  if (acpAgents.length === 0) {
    return {};
  }
  const refusal = modelAccessRefusal(acpAgents);
  if (refusal) {
    return { refused: refusal };
  }
  return { access: { acpAgents, hideConsoleWindows: input?.hideConsoleWindows === true } };
}

/**
 * Snapshot a persona's usable members. `registry` is every agent the editor
 * holds and `isEnabled` says which are switched on. `modelAccess` is what the
 * editor's settings say about ACP agents; omitted, the persona relies on the
 * CLI's provider variables.
 */
export function buildBuzzPersonaManifest(
  profile: BuzzPersonaProfile,
  registry: readonly AgentDefinition[],
  isEnabled: (agentId: string) => boolean,
  modelAccessInput?: ManifestModelAccessInput,
): ManifestBuild {
  const builtAccess = buildModelAccess(modelAccessInput);
  if ('refused' in builtAccess) {
    return { kind: 'refused', reason: `${builtAccess.refused}, so the manifest was not written.` };
  }
  const modelAccess = builtAccess.access;
  const byId = new Map(registry.map(agent => [agent.id, agent]));
  const notices: string[] = [];
  const agents: ManifestAgent[] = [];
  for (const id of profile.agentIds) {
    const agent = byId.get(id);
    if (!agent) {
      notices.push(`${id} is not an agent this workspace has, so it was left out.`);
      continue;
    }
    if (!isEnabled(id)) {
      notices.push(`${id} is disabled, so it was left out.`);
      continue;
    }
    const snapshot = snapshotAgent(agent);
    const leaked = secretField(snapshot);
    if (leaked) {
      return { kind: 'refused', reason: `${id}.${leaked} contains what looks like a secret, so the manifest was not written. Remove it from the agent and try again.` };
    }
    agents.push(snapshot);
  }
  if (agents.length === 0) {
    return { kind: 'refused', reason: `Persona ${profile.id} has no enabled member to export.` };
  }
  const agentIds = agents.map(agent => agent.id);
  let preferredAgentId = profile.preferredAgentId;
  if (!agentIds.includes(preferredAgentId)) {
    preferredAgentId = agentIds[0]!;
    notices.push(`The preferred member ${profile.preferredAgentId} is unavailable, so ${preferredAgentId} leads.`);
  }
  const persona: ManifestPersona = {
    id: profile.id,
    displayName: profile.displayName,
    purpose: profile.purpose,
    agentIds,
    preferredAgentId,
    independenceClass: profile.independenceClass,
    skillCeiling: profile.skillCeiling,
  };
  return {
    kind: 'ok',
    manifest: {
      kind: BUZZ_PERSONA_MANIFEST_KIND,
      version: BUZZ_PERSONA_MANIFEST_VERSION,
      persona,
      agents,
      ...(modelAccess ? { modelAccess } : {}),
      fingerprint: computeFingerprint(persona, agents, modelAccess),
    },
    notices,
  };
}

/**
 * Whether what the registry and settings would export now differs from the
 * stored manifest — a changed prompt, member or ACP agent all count.
 */
export function manifestIsStale(
  stored: BuzzPersonaManifest,
  profile: BuzzPersonaProfile,
  registry: readonly AgentDefinition[],
  isEnabled: (agentId: string) => boolean,
  modelAccessInput?: ManifestModelAccessInput,
): boolean {
  const current = buildBuzzPersonaManifest(profile, registry, isEnabled, modelAccessInput);
  return current.kind !== 'ok' || current.manifest.fingerprint !== stored.fingerprint;
}

function readString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length <= max ? value : undefined;
}

function readStringList(value: unknown, pattern: RegExp, max: number): string[] | undefined {
  return Array.isArray(value) && value.length <= max && value.every(item => typeof item === 'string' && pattern.test(item))
    ? [...value as string[]]
    : undefined;
}

function readAgent(raw: unknown): ManifestAgent | string {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
  const id = typeof record?.['id'] === 'string' ? record['id'] : '';
  if (!record || !AGENT_ID.test(id)) {
    return 'an agent has no valid id';
  }
  const name = readString(record['name'], MAX_TEXT_CHARS);
  const role = readString(record['role'], MAX_TEXT_CHARS);
  const description = readString(record['description'], MAX_TEXT_CHARS);
  const systemPrompt = readString(record['systemPrompt'], MAX_SYSTEM_PROMPT_CHARS);
  const skills = readStringList(record['skills'], SKILL_ID, 500);
  if (name === undefined || role === undefined || description === undefined || systemPrompt === undefined || !skills) {
    return `agent ${id} is missing a field or has one that is too long`;
  }
  const agent: ManifestAgent = { id, name, role, description, systemPrompt, skills };
  if (record['skillPolicy'] !== undefined) {
    if (!SKILL_POLICIES.includes(record['skillPolicy'] as AgentSkillPolicy)) {
      return `agent ${id} has an unknown skill policy`;
    }
    agent.skillPolicy = record['skillPolicy'] as AgentSkillPolicy;
  }
  for (const key of ['primaryRoutingNeeds', 'allowedModels'] as const) {
    if (record[key] !== undefined) {
      const list = readStringList(record[key], /^[A-Za-z0-9:._/@-]{1,200}$/, 100);
      if (!list) {
        return `agent ${id} has an invalid ${key}`;
      }
      agent[key] = list;
    }
  }
  if (record['costLimitUsd'] !== undefined) {
    if (typeof record['costLimitUsd'] !== 'number' || !Number.isFinite(record['costLimitUsd']) || record['costLimitUsd'] < 0) {
      return `agent ${id} has an invalid cost limit`;
    }
    agent.costLimitUsd = record['costLimitUsd'];
  }
  const leaked = secretField(agent);
  if (leaked) {
    return `agent ${id}.${leaked} contains what looks like a secret`;
  }
  return agent;
}

/** Parse and verify a manifest's text. Refuses whole; never repairs. */
export function parseBuzzPersonaManifest(text: string): { kind: 'ok'; manifest: BuzzPersonaManifest } | { kind: 'refused'; reason: string } {
  const refuse = (reason: string) => ({ kind: 'refused' as const, reason: `Persona manifest refused: ${reason}.` });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse('it is not valid JSON');
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  if (!record || record['kind'] !== BUZZ_PERSONA_MANIFEST_KIND) {
    return refuse('it is not an AtlasMind persona manifest');
  }
  if (typeof record['version'] !== 'number' || !Number.isInteger(record['version'])) {
    return refuse('it has no version');
  }
  if (record['version'] > BUZZ_PERSONA_MANIFEST_VERSION) {
    return refuse(`it was written by a newer AtlasMind (version ${record['version']}); update AtlasMind before running it`);
  }
  if (record['version'] < 1) {
    return refuse('its version is not one AtlasMind has written');
  }
  const rawAgents = record['agents'];
  if (!Array.isArray(rawAgents) || rawAgents.length === 0 || rawAgents.length > 24) {
    return refuse('it must hold between 1 and 24 agents');
  }
  const agents: ManifestAgent[] = [];
  for (const raw of rawAgents) {
    const agent = readAgent(raw);
    if (typeof agent === 'string') {
      return refuse(agent);
    }
    if (agents.some(existing => existing.id === agent.id)) {
      return refuse(`agent ${agent.id} appears twice`);
    }
    agents.push(agent);
  }
  const persona = record['persona'] && typeof record['persona'] === 'object' ? record['persona'] as Record<string, unknown> : undefined;
  const scope = readPersonaScope(persona ? {
    personaId: persona['id'],
    allowedAgentIds: persona['agentIds'],
    preferredAgentId: persona['preferredAgentId'],
    skillCeiling: persona['skillCeiling'],
  } : undefined);
  const displayName = readString(persona?.['displayName'], 60);
  const purpose = readString(persona?.['purpose'], 300);
  const independenceClass = persona?.['independenceClass'];
  if (!scope || displayName === undefined || purpose === undefined
    || !(PERSONA_INDEPENDENCE_CLASSES as readonly unknown[]).includes(independenceClass)) {
    return refuse('its persona is malformed');
  }
  if (scope.allowedAgentIds.length !== agents.length || !scope.allowedAgentIds.every(id => agents.some(agent => agent.id === id))) {
    return refuse('its persona members and its agents do not match');
  }
  const manifestPersona: ManifestPersona = {
    id: scope.personaId,
    displayName,
    purpose,
    agentIds: scope.allowedAgentIds,
    preferredAgentId: scope.preferredAgentId,
    independenceClass: independenceClass as PersonaIndependenceClass,
    skillCeiling: scope.skillCeiling,
  };
  let modelAccess: ManifestModelAccess | undefined;
  if (record['modelAccess'] !== undefined) {
    const rawAccess = record['modelAccess'] && typeof record['modelAccess'] === 'object' && !Array.isArray(record['modelAccess'])
      ? record['modelAccess'] as Record<string, unknown>
      : undefined;
    const acpAgents = parseAcpAgentSettings(rawAccess?.['acpAgents']);
    // Read through the editor's own parser and refused unless it reads back
    // exactly as written: the parser cleans, and a cleaned command is not the
    // one the manifest's author approved.
    if (!rawAccess || typeof rawAccess['hideConsoleWindows'] !== 'boolean' || acpAgents.length === 0
      || canonicalJson(acpAgents) !== canonicalJson(rawAccess['acpAgents'])) {
      return refuse('its model access is malformed');
    }
    const refusal = modelAccessRefusal(acpAgents);
    if (refusal) {
      return refuse(refusal);
    }
    modelAccess = { acpAgents, hideConsoleWindows: rawAccess['hideConsoleWindows'] };
  }
  const fingerprint = computeFingerprint(manifestPersona, agents, modelAccess);
  if (record['fingerprint'] !== fingerprint) {
    return refuse('its contents do not match its fingerprint, so it was changed after AtlasMind wrote it');
  }
  return {
    kind: 'ok',
    manifest: {
      kind: BUZZ_PERSONA_MANIFEST_KIND,
      version: record['version'],
      persona: manifestPersona,
      agents,
      ...(modelAccess ? { modelAccess } : {}),
      fingerprint,
    },
  };
}

/** Read a manifest from disk under the loader's path rules. Never throws. */
export function loadBuzzPersonaManifestFile(
  manifestPath: string,
  workspaceRoot: string,
): { kind: 'ok'; manifest: BuzzPersonaManifest } | { kind: 'refused'; reason: string } {
  const refuse = (reason: string) => ({ kind: 'refused' as const, reason: `Persona manifest refused: ${reason}.` });
  if (!path.isAbsolute(manifestPath) || path.extname(manifestPath).toLowerCase() !== '.json') {
    return refuse('the path must be an absolute path to a .json file');
  }
  const resolved = path.resolve(manifestPath);
  const relative = path.relative(path.resolve(workspaceRoot), resolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return refuse('it is inside the workspace, where another contributor could edit the prompts it runs; use the one AtlasMind wrote to its own storage');
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    return refuse('the file does not exist');
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return refuse('it is not a plain file');
  }
  if (stat.size > MAX_PERSONA_MANIFEST_BYTES) {
    return refuse('it is larger than 1 MB');
  }
  let text: string;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch {
    return refuse('the file could not be read');
  }
  return parseBuzzPersonaManifest(text);
}

/** The agents the headless runtime registers before the ACP facade starts. */
export function manifestAgentDefinitions(manifest: BuzzPersonaManifest): AgentDefinition[] {
  return manifest.agents.map(agent => ({ ...agent, skills: [...agent.skills] }));
}

/** The host-owned scope a manifest's persona runs under. */
export function manifestToScope(manifest: BuzzPersonaManifest, hostDelivery: boolean): PersonaScope {
  return {
    personaId: manifest.persona.id,
    allowedAgentIds: [...manifest.persona.agentIds],
    preferredAgentId: manifest.persona.preferredAgentId,
    skillCeiling: manifest.persona.skillCeiling,
    ...(hostDelivery ? { hostDelivery: 'buzz-acp' as const } : {}),
  };
}
