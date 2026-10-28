/**
 * Buzz persona teams — the project's declared intent (Buzz Tier 5, Phase 1).
 *
 * A *persona* is one Buzz-facing identity — "AM Engineer", "AM Oversight" —
 * backed by a scoped collection of AtlasMind agents. This file is only the
 * project's intent: which agents make up each persona, which one leads, how
 * independent it must stay and how far its authority reaches. It is not a
 * Buzz key, not a running process and not a channel membership; those belong
 * to Buzz and to the local deployment, and a file committed to the repository
 * must hold none of them.
 *
 * Six rules, from `project_memory/roadmap/buzz-integration.md` (Tier 5).
 *
 * 1. **Ids are stable and validated, never cleaned.** A persona id becomes part
 *    of a deployment record and a launch recipe; one that is not already a
 *    plain slug is reported, not repaired.
 * 2. **Membership is explicit and many-to-many.** One agent may serve several
 *    personas; a persona names its members and exactly one preferred member,
 *    which must be one of them.
 * 3. **Invalid is reported, never repaired.** An unusable profile is left out
 *    of the typed view with a finding naming why, so it leaves the file only
 *    when a person saves without it.
 * 4. **Unknown fields survive.** An older build saving must not drop what a
 *    newer one wrote; a newer-*version* file is refused outright
 *    (`schemaMigration`, kind `buzz-agents`).
 * 5. **No secrets, no paths.** A field shaped like a key, a secret or an
 *    absolute path refuses the whole document — the file is committed.
 * 6. **Never seeded.** Opening anything never writes this file; saving an
 *    accepted or edited profile is the first write.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { CURRENT_SCHEMA_VERSIONS, interpretVersionedDocument } from './schemaMigration.js';
import type { PersonaSkillCeiling } from '../types.js';

export const BUZZ_PERSONA_FILE = path.join('.atlasmind', 'buzz-agents.json');

export const BUZZ_PERSONA_LIMITS = {
  profiles: 12,
  members: 24,
  idLength: 40,
  displayNameLength: 60,
  purposeLength: 300,
  allowlistSkills: 50,
} as const;

export const PERSONA_INDEPENDENCE_CLASSES = ['execution', 'advisory', 'oversight'] as const;
export type PersonaIndependenceClass = (typeof PERSONA_INDEPENDENCE_CLASSES)[number];

export interface BuzzPersonaProfile {
  id: string;
  displayName: string;
  purpose: string;
  agentIds: string[];
  preferredAgentId: string;
  routingMode: 'scoped-orchestration';
  independenceClass: PersonaIndependenceClass;
  skillCeiling: PersonaSkillCeiling;
  /** Fields this build does not know, kept where they were written. */
  [extra: string]: unknown;
}

export interface BuzzPersonaDocument {
  version: number;
  profiles: BuzzPersonaProfile[];
  [extra: string]: unknown;
}

export interface BuzzPersonaFinding {
  /** The profile id, or `(document)` when the problem is the file itself. */
  profileId: string;
  severity: 'invalid' | 'warning';
  message: string;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const SECRET_KEY_NAME = /(secret|token|password|private.?key|nsec|api.?key|credential)/i;
const SECRET_VALUE = /\bnsec1[0-9a-z]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\|\/(?:Users|home|root|etc|var|opt)\/)/;

/** Walk every key and string in the document; the first forbidden thing refuses it. */
function findForbidden(value: unknown, at: string): string | undefined {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) {
      return `${at} holds what looks like a secret key`;
    }
    if (ABSOLUTE_PATH.test(value)) {
      return `${at} holds an absolute path — a committed file must not name a location on one machine`;
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbidden(value[index], `${at}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_NAME.test(key)) {
        return `${at}.${key} is named like a secret — keys and credentials never belong in this file`;
      }
      const found = findForbidden(child, `${at}.${key}`);
      if (found) return found;
    }
  }
  return undefined;
}

function readText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f]/.test(value) ? value.trim() : undefined;
}

function readCeiling(value: unknown): PersonaSkillCeiling | string {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
  switch (record?.['mode']) {
    case 'member': return { mode: 'member' };
    case 'read-only': return { mode: 'read-only' };
    case 'allowlist': {
      const ids = record['skillIds'];
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > BUZZ_PERSONA_LIMITS.allowlistSkills
        || !ids.every(id => typeof id === 'string' && /^[A-Za-z0-9:._-]{1,80}$/.test(id))) {
        return 'an allowlist ceiling needs between 1 and 50 skill ids';
      }
      return { mode: 'allowlist', skillIds: [...new Set(ids as string[])] };
    }
    default: return 'skillCeiling.mode must be member, read-only or allowlist';
  }
}

/** One profile, typed, or why it cannot be used. Unknown fields are kept. */
function readProfile(raw: unknown): { profile: BuzzPersonaProfile } | { id: string; reason: string } {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
  const id = typeof record?.['id'] === 'string' ? record['id'] : '';
  if (!record || !SLUG.test(id)) {
    return { id: id.slice(0, 40) || '(no id)', reason: 'the id must be a lowercase slug of at most 40 characters' };
  }
  const displayName = readText(record['displayName'], BUZZ_PERSONA_LIMITS.displayNameLength);
  if (!displayName) {
    return { id, reason: 'displayName is missing or longer than 60 characters' };
  }
  const purpose = readText(record['purpose'], BUZZ_PERSONA_LIMITS.purposeLength) ?? '';
  const members = record['agentIds'];
  if (!Array.isArray(members) || members.length === 0 || members.length > BUZZ_PERSONA_LIMITS.members
    || !members.every(member => typeof member === 'string' && SLUG.test(member))) {
    return { id, reason: 'agentIds must list between 1 and 24 agent ids' };
  }
  const agentIds = [...new Set(members as string[])];
  const preferred = record['preferredAgentId'];
  if (typeof preferred !== 'string' || !agentIds.includes(preferred)) {
    return { id, reason: 'preferredAgentId must be one of the persona\'s own members' };
  }
  if (record['routingMode'] !== 'scoped-orchestration') {
    return { id, reason: 'routingMode must be scoped-orchestration — the only mode this build runs' };
  }
  const independenceClass = record['independenceClass'];
  if (!(PERSONA_INDEPENDENCE_CLASSES as readonly unknown[]).includes(independenceClass)) {
    return { id, reason: 'independenceClass must be execution, advisory or oversight' };
  }
  const ceiling = readCeiling(record['skillCeiling']);
  if (typeof ceiling === 'string') {
    return { id, reason: ceiling };
  }
  return {
    profile: {
      ...record,
      id,
      displayName,
      purpose,
      agentIds,
      preferredAgentId: preferred,
      routingMode: 'scoped-orchestration',
      independenceClass: independenceClass as PersonaIndependenceClass,
      skillCeiling: ceiling,
    },
  };
}

/**
 * The usable profiles in a parsed document, and a finding for each that is
 * not. A forbidden value anywhere refuses the whole document.
 */
export function sanitizeBuzzPersonaDocument(raw: unknown): { document?: BuzzPersonaDocument; findings: BuzzPersonaFinding[] } {
  const findings: BuzzPersonaFinding[] = [];
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
  if (!record) {
    return { findings: [{ profileId: '(document)', severity: 'invalid', message: 'the file is not a JSON object' }] };
  }
  const forbidden = findForbidden(record, '$');
  if (forbidden) {
    return { findings: [{ profileId: '(document)', severity: 'invalid', message: `refused: ${forbidden}` }] };
  }
  const rawProfiles = Array.isArray(record['profiles']) ? record['profiles'] : [];
  if (rawProfiles.length > BUZZ_PERSONA_LIMITS.profiles) {
    findings.push({ profileId: '(document)', severity: 'invalid', message: `more than ${BUZZ_PERSONA_LIMITS.profiles} personas — the list is used whole or not at all` });
    return { findings };
  }
  const profiles: BuzzPersonaProfile[] = [];
  const seen = new Set<string>();
  for (const entry of rawProfiles) {
    const read = readProfile(entry);
    if ('reason' in read) {
      findings.push({ profileId: read.id, severity: 'invalid', message: read.reason });
      continue;
    }
    if (seen.has(read.profile.id)) {
      findings.push({ profileId: read.profile.id, severity: 'invalid', message: 'another persona already has this id' });
      continue;
    }
    seen.add(read.profile.id);
    profiles.push(read.profile);
  }
  return { document: { ...record, version: CURRENT_SCHEMA_VERSIONS['buzz-agents'], profiles }, findings };
}

/** The registry facts a persona's members are checked against. */
export interface PersonaRegistryAgent {
  id: string;
  enabled: boolean;
  /** An advisor that reviews rather than acts — never silently part of an executing persona. */
  oversight: boolean;
}

/**
 * Check profiles against the agents that exist. A missing or disabled member
 * degrades the persona and is named; a persona with no usable member is
 * unusable; an executing persona that includes an oversight agent says it has
 * given up that agent's independence. Nothing is deleted or substituted.
 */
export function validateBuzzPersonaProfiles(
  document: BuzzPersonaDocument,
  registry: readonly PersonaRegistryAgent[],
): BuzzPersonaFinding[] {
  const byId = new Map(registry.map(agent => [agent.id, agent]));
  const findings: BuzzPersonaFinding[] = [];
  for (const profile of document.profiles) {
    const usable = profile.agentIds.filter(id => byId.get(id)?.enabled);
    for (const id of profile.agentIds) {
      const agent = byId.get(id);
      if (!agent) {
        findings.push({ profileId: profile.id, severity: 'warning', message: `member ${id} is not an agent this workspace has` });
      } else if (!agent.enabled) {
        findings.push({ profileId: profile.id, severity: 'warning', message: `member ${id} is disabled` });
      }
    }
    if (usable.length === 0) {
      findings.push({ profileId: profile.id, severity: 'invalid', message: 'no member is an enabled agent, so this persona cannot answer' });
    } else if (!usable.includes(profile.preferredAgentId)) {
      findings.push({ profileId: profile.id, severity: 'warning', message: `the preferred member ${profile.preferredAgentId} cannot run, so another member will lead` });
    }
    if (profile.independenceClass === 'execution') {
      for (const id of profile.agentIds) {
        if (byId.get(id)?.oversight) {
          findings.push({ profileId: profile.id, severity: 'warning', message: `${id} is an oversight agent inside an executing persona — it no longer reviews independently` });
        }
      }
    }
  }
  return findings;
}

export interface BuzzPersonaRead {
  document?: BuzzPersonaDocument;
  findings: BuzzPersonaFinding[];
  /** A file exists that this build must not write over (newer, or refused). */
  preserveExisting: boolean;
  notice?: string;
  exists: boolean;
}

function isPersonaDocumentShape(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as Record<string, unknown>)['profiles']);
}

/** Read `.atlasmind/buzz-agents.json`. Never throws; absent is not an error. */
export function readBuzzPersonaDocument(root: string): BuzzPersonaRead {
  const file = path.join(root, BUZZ_PERSONA_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { findings: [], preserveExisting: false, exists: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { findings: [{ profileId: '(document)', severity: 'invalid', message: 'the file is not valid JSON' }], preserveExisting: true, exists: true };
  }
  const interpreted = interpretVersionedDocument('buzz-agents', parsed, isPersonaDocumentShape);
  if (!interpreted.config) {
    return {
      findings: [{ profileId: '(document)', severity: 'invalid', message: interpreted.notice ?? 'the file is not a persona document this build can read' }],
      // A file AtlasMind cannot read is somebody's work; it is never replaced unasked.
      preserveExisting: true,
      exists: true,
      ...(interpreted.notice ? { notice: interpreted.notice } : {}),
    };
  }
  const sanitized = sanitizeBuzzPersonaDocument(interpreted.config);
  return {
    ...(sanitized.document ? { document: sanitized.document } : {}),
    findings: sanitized.findings,
    preserveExisting: !sanitized.document,
    exists: true,
    ...(interpreted.notice ? { notice: interpreted.notice } : {}),
  };
}

/**
 * Save the document. Refuses a file this build must not overwrite, and input
 * that does not sanitize cleanly — the caller decides what to keep, not this.
 */
export async function writeBuzzPersonaDocument(root: string, document: BuzzPersonaDocument): Promise<{ ok: true } | { ok: false; reason: string }> {
  const existing = readBuzzPersonaDocument(root);
  if (existing.exists && existing.preserveExisting) {
    return { ok: false, reason: existing.notice ?? 'the existing file cannot be read by this build, so it was not replaced' };
  }
  const sanitized = sanitizeBuzzPersonaDocument(document);
  const invalid = sanitized.findings.filter(finding => finding.severity === 'invalid');
  if (!sanitized.document || invalid.length > 0) {
    return { ok: false, reason: invalid.map(finding => `${finding.profileId}: ${finding.message}`).join('; ') || 'the document is not usable' };
  }
  const file = path.join(root, BUZZ_PERSONA_FILE);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(sanitized.document, null, 2)}\n`, 'utf8');
  return { ok: true };
}
