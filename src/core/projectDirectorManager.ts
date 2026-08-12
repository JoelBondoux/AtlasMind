/**
 * ProjectDirectorManager — models the *people* a project runs on: its
 * stakeholders, delivery team, responsibilities (who owns what), human task
 * assignments, and follow-ups. It is the data backbone of the Project Director
 * dashboard.
 *
 * Like {@link ./deliveryManager} and {@link ./dataPrivacyManager}, the
 * persistence helpers are free of the `vscode` API (node `fs` only) so seeding,
 * sanitisation, and the markdown mirror can be unit tested in isolation, and so
 * this module stays reusable outside the extension host.
 *
 * Safety- and GDPR-first defaults:
 *  - AtlasMind prefers to *reference* a person in their system of record
 *    (Microsoft 365 / Entra, Slack) via {@link DirectoryRef} and resolve their
 *    details on demand, rather than hoarding raw personal data locally. Raw PII
 *    stored locally is flagged (`piiStored`) so the extension layer can gate it
 *    behind a one-time consent notice and classify it confidential.
 *  - No secret VALUES are ever stored — communication `handle`s are non-secret
 *    identifiers (address / @username / phone), never tokens or passwords.
 *  - `deepLink`s are restricted to a scheme allowlist; `javascript:`/`data:`/
 *    `file:` and bare `http:` are rejected at the sanitisation boundary.
 */

import * as path from 'node:path';
import { interpretVersionedDocument, type VersionedDocumentRead } from './schemaMigration.js';
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import type {
  Assignment,
  AssignmentKind,
  AssignmentPriority,
  AssignmentStatus,
  DashboardWorkKind,
  CommunicationLink,
  DirectorContact,
  DirectorLevel,
  FollowUp,
  FollowUpCadence,
  FollowUpStatus,
  ProjectDirectorConfig,
  ProjectDirectorHistoryEntry,
  ProjectTeamMode,
  Responsibility,
  Stakeholder,
  StakeholderCategory,
  TeamMember,
} from '../types.js';

export const PROJECT_DIRECTOR_SSOT_PATH = 'project_memory/operations/project-director.json';
export const PROJECT_DIRECTOR_SUMMARY_SSOT_PATH = 'project_memory/operations/project-director.md';
export const PROJECT_DIRECTOR_HISTORY_SSOT_PATH = 'project_memory/operations/project-director-history.json';

/** Most recent director change records retained on disk. */
const MAX_HISTORY = 200;

// ── History ──────────────────────────────────────────────────────

export function readProjectDirectorHistory(workspaceRoot: string): ProjectDirectorHistoryEntry[] {
  try {
    const raw = readFileSync(path.join(workspaceRoot, PROJECT_DIRECTOR_HISTORY_SSOT_PATH), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ProjectDirectorHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Append an audit record (newest first), capped at {@link MAX_HISTORY}. */
export async function appendProjectDirectorHistory(
  workspaceRoot: string,
  entry: ProjectDirectorHistoryEntry,
): Promise<void> {
  const file = path.join(workspaceRoot, PROJECT_DIRECTOR_HISTORY_SSOT_PATH);
  const history = readProjectDirectorHistory(workspaceRoot);
  history.unshift(entry);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(history.slice(0, MAX_HISTORY), null, 2), 'utf-8');
}

// ── Defaults ─────────────────────────────────────────────────────

export function defaultProjectDirectorSettings(): ProjectDirectorConfig['settings'] {
  return { teamMode: 'auto', nudgeOnActivation: true, remindersEnabled: false, outboundEnabled: false };
}

export function defaultProjectDirectorConfig(): ProjectDirectorConfig {
  return {
    version: 1,
    project: { name: '' },
    contacts: [],
    stakeholders: [],
    teamMembers: [],
    responsibilities: [],
    assignments: [],
    followUps: [],
    settings: defaultProjectDirectorSettings(),
  };
}

// ── Seeding ──────────────────────────────────────────────────────

/**
 * Repository signals used to seed a first-draft roster that reflects the people
 * *already* around the project — not a generic template. Everything is optional
 * so callers supply only what they can detect.
 */
export interface ProjectDirectorSeedInput {
  projectName: string;
  projectSummary?: string;
  /** The AtlasMind user ("me"), typically the git `user.name`/`user.email`. */
  self?: { name: string; email?: string };
  /** Distinct git authors (from `git shortlog -sne` / `git log`). */
  gitContributors?: Array<{ name: string; email: string }>;
  /** Parsed owner handles from `.github/CODEOWNERS` (e.g. `@org/maintainers`). */
  codeowners?: string[];
  /** `package.json` "author" (may be "Name <email>"). */
  packageAuthor?: string;
  /** Names from an existing Website Studio client intake. */
  websiteStakeholders?: string[];
  /** Optional timeline note from bootstrap intake → seeds a confirmation follow-up. */
  timeline?: string;
}

/** Parse a "Name <email>" string into its parts. */
function parseNameEmail(value: string): { name: string; email?: string } {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match && match[1]) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  const trimmed = value.trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    return { name: trimmed.split('@')[0], email: trimmed };
  }
  return { name: trimmed };
}

function emailLink(email: string): CommunicationLink {
  return {
    id: `link-${slugify(email)}`,
    kind: 'email',
    label: 'Email',
    handle: email,
    deepLink: `mailto:${email}`,
    preferred: true,
  };
}

/**
 * Build a first-draft {@link ProjectDirectorConfig} from repository signals. Git
 * contributors become team members; CODEOWNERS handles become groups that own a
 * "Code ownership" responsibility; the package author becomes an internal
 * stakeholder; website-intake names become client stakeholders. Contacts that
 * carry a raw email are flagged `piiStored` so the extension layer can gate them
 * behind the GDPR consent notice. Everything is fully editable afterwards.
 */
export function seedProjectDirectorConfig(input: ProjectDirectorSeedInput): ProjectDirectorConfig {
  const config = defaultProjectDirectorConfig();
  config.project = {
    name: clampStr(input.projectName, 200) || 'Project',
    summary: optStr(input.projectSummary, MAX_LONG),
  };

  const contactByEmail = new Map<string, DirectorContact>();
  const contactByName = new Map<string, DirectorContact>();
  const ensureContact = (name: string, email?: string): DirectorContact => {
    const key = email?.toLowerCase();
    if (key && contactByEmail.has(key)) { return contactByEmail.get(key)!; }
    if (!email && contactByName.has(name.toLowerCase())) { return contactByName.get(name.toLowerCase())!; }
    const contact: DirectorContact = {
      id: `contact-${slugify(email ?? name)}-${config.contacts.length + 1}`,
      name: clampStr(name, 120) || 'Contact',
      kind: 'person',
      links: email ? [emailLink(email)] : [],
      piiStored: Boolean(email),
      ref: email ? undefined : { source: 'local', displayLabel: clampStr(name, 120) || 'Contact' },
    };
    config.contacts.push(contact);
    if (key) { contactByEmail.set(key, contact); }
    contactByName.set(name.toLowerCase(), contact);
    return contact;
  };

  // "Me" first, so a solo dev has a first-class self even with an empty roster.
  // A matching git contributor dedupes onto this same contact.
  if (input.self && (input.self.name || input.self.email)) {
    const me = ensureContact(input.self.name || input.self.email!, input.self.email || undefined);
    config.selfContactId = me.id;
  }

  // Git contributors → team members.
  for (const author of input.gitContributors ?? []) {
    if (!author?.name && !author?.email) { continue; }
    const contact = ensureContact(author.name || author.email, author.email || undefined);
    if (!config.teamMembers.some(tm => tm.contactId === contact.id)) {
      config.teamMembers.push({
        id: `tm-${slugify(contact.id)}`,
        contactId: contact.id,
        discipline: 'contributor',
      });
    }
  }

  // CODEOWNERS handles → group contacts + a "Code ownership" responsibility.
  const ownerContactIds: string[] = [];
  for (const handle of input.codeowners ?? []) {
    const clean = clampStr(handle, 120);
    if (!clean) { continue; }
    const isGroup = clean.includes('/');
    const contact: DirectorContact = {
      id: `contact-${slugify(clean)}`,
      name: clean,
      kind: isGroup ? 'group' : 'person',
      links: [{ id: `link-${slugify(clean)}`, kind: 'github', label: 'GitHub', handle: clean }],
      piiStored: false,
      ref: { source: 'local', displayLabel: clean },
    };
    if (!config.contacts.some(c => c.id === contact.id)) {
      config.contacts.push(contact);
    }
    ownerContactIds.push(contact.id);
    if (!config.teamMembers.some(tm => tm.contactId === contact.id)) {
      config.teamMembers.push({ id: `tm-${slugify(contact.id)}`, contactId: contact.id, discipline: 'code-owner' });
    }
  }
  if (ownerContactIds[0]) {
    config.responsibilities.push({
      id: 'resp-code-ownership',
      area: 'Code ownership',
      description: 'Seeded from .github/CODEOWNERS. Review and refine.',
      ownerContactId: ownerContactIds[0],
      backupContactId: ownerContactIds[1],
    });
  }

  // package.json author → internal stakeholder.
  if (input.packageAuthor) {
    const { name, email } = parseNameEmail(input.packageAuthor);
    if (name) {
      const contact = ensureContact(name, email);
      if (!config.stakeholders.some(s => s.contactId === contact.id)) {
        config.stakeholders.push({
          id: `stk-${slugify(contact.id)}`,
          contactId: contact.id,
          category: 'internal',
          influence: 'high',
          interest: 'high',
        });
      }
    }
  }

  // Website Studio intake names → client stakeholders.
  for (const raw of input.websiteStakeholders ?? []) {
    const name = clampStr(raw, 120);
    if (!name) { continue; }
    const contact = ensureContact(name);
    if (!config.stakeholders.some(s => s.contactId === contact.id)) {
      config.stakeholders.push({
        id: `stk-${slugify(contact.id)}`,
        contactId: contact.id,
        category: 'client',
        influence: 'medium',
        interest: 'high',
      });
    }
  }

  // Timeline note → a confirmation follow-up.
  if (input.timeline) {
    const now = new Date().toISOString();
    config.followUps.push({
      id: 'fu-confirm-timeline',
      title: `Confirm timeline: ${clampStr(input.timeline, 160)}`,
      dueDate: now.slice(0, 10),
      cadence: 'once',
      status: 'open',
      linked: { kind: 'none' },
      createdAt: now,
      updatedAt: now,
    });
  }

  config.updatedAt = new Date().toISOString();
  return config;
}

// ── Validation ───────────────────────────────────────────────────

function isProjectDirectorConfig(value: unknown): value is ProjectDirectorConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const c = value as Record<string, unknown>;
  return c['version'] === 1
    && typeof c['project'] === 'object' && c['project'] !== null
    && Array.isArray(c['contacts'])
    && Array.isArray(c['stakeholders'])
    && Array.isArray(c['teamMembers'])
    && Array.isArray(c['responsibilities'])
    && Array.isArray(c['assignments'])
    && Array.isArray(c['followUps']);
}

const MAX_FIELD = 240;
const MAX_LONG = 2000;

const STAKEHOLDER_CATEGORIES: StakeholderCategory[] = [
  'sponsor', 'client', 'user-representative', 'regulator', 'vendor', 'partner', 'internal', 'other',
];
const LEVELS: DirectorLevel[] = ['high', 'medium', 'low'];
const ASSIGNMENT_KINDS: AssignmentKind[] = ['task', 'responsibility', 'review', 'decision', 'other'];
const ASSIGNMENT_STATUSES: AssignmentStatus[] = ['todo', 'in-progress', 'blocked', 'done', 'cancelled'];
const ASSIGNMENT_PRIORITIES: AssignmentPriority[] = ['high', 'medium', 'low'];
const DASHBOARD_WORK_KINDS: DashboardWorkKind[] = [
  'branch', 'roadmap', 'issue', 'pull-request', 'gap', 'risk', 'debt', 'document',
];
const FOLLOWUP_STATUSES: FollowUpStatus[] = ['open', 'done', 'snoozed', 'cancelled'];
const FOLLOWUP_CADENCES: FollowUpCadence[] = ['once', 'daily', 'weekly', 'biweekly', 'monthly'];
const TEAM_MODES: ProjectTeamMode[] = ['solo', 'team', 'auto'];
const DIRECTORY_SOURCES = ['m365', 'slack', 'google', 'buzz', 'local'];
const CONTACT_KINDS = ['person', 'group', 'org'];
const LINKED_KINDS = ['stakeholder', 'teamMember', 'assignment', 'responsibility', 'run', 'none'];
/** Deep-link schemes AtlasMind will launch. `http:` is intentionally excluded. */
const ALLOWED_DEEPLINK_SCHEMES = ['mailto', 'tel', 'sms', 'slack', 'msteams', 'zoommtg', 'https'];

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function clampStr(value: unknown, max = MAX_FIELD): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optStr(value: unknown, max = MAX_FIELD): string | undefined {
  const trimmed = clampStr(value, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

function asBool(value: unknown): boolean {
  return value === true;
}

/**
 * A slug-shaped identifier, or nothing.
 *
 * Used for a role id, which is looked up rather than displayed. Coercing a
 * malformed value would risk matching a *different* role, so anything that is
 * not already a clean slug resolves to no role at all.
 */
function optSlug(value: unknown, max: number): string | undefined {
  const trimmed = clampStr(value, max).toLowerCase();
  return /^[a-z0-9][a-z0-9-]*$/.test(trimmed) ? trimmed : undefined;
}

/**
 * CODEOWNERS path patterns.
 *
 * These end up in a file GitHub reads to route review, so they are
 * control-stripped, length-capped and count-capped, and anything containing
 * whitespace is dropped — a pattern with a space in it silently splits into a
 * pattern and an owner, which would assign review to something that is not a
 * person. Returns `undefined` rather than an empty array so the field stays
 * absent when unused.
 */
function cleanPathPatterns(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  for (const entry of value.slice(0, 40)) {
    if (typeof entry !== 'string') {
      continue;
    }
    const pattern = entry.replace(/[\u0000-\u001f\u007f]+/g, '').trim().slice(0, 200);
    if (pattern.length > 0 && !/\s/.test(pattern) && !out.includes(pattern)) {
      out.push(pattern);
    }
  }
  return out.length > 0 ? out : undefined;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || String(Date.now());
}

function whitelist<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const s = clampStr(value, 60) as T;
  return allowed.includes(s) ? s : fallback;
}

function isoOrNow(value: unknown): string {
  const s = clampStr(value, 40);
  return s && !Number.isNaN(Date.parse(s)) ? s : new Date().toISOString();
}

/** Return a launchable deep link only if its scheme is allowlisted. */
function safeDeepLink(value: unknown): string | undefined {
  const raw = optStr(value, 500);
  if (!raw) { return undefined; }
  const schemeMatch = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!schemeMatch) { return undefined; }
  const scheme = schemeMatch[1].toLowerCase();
  return ALLOWED_DEEPLINK_SCHEMES.includes(scheme) ? raw : undefined;
}

function sanitizeLink(input: unknown, index: number, used: Set<string>): CommunicationLink | undefined {
  const l = asObject(input);
  const label = clampStr(l['label'], 120);
  const handle = clampStr(l['handle'], MAX_FIELD);
  if (!label && !handle) { return undefined; }
  let id = clampStr(l['id'], 80) || `link-${index}-${slugify(handle || label)}`;
  while (used.has(id)) { id = `${id}-${used.size}`; }
  used.add(id);
  return {
    id,
    kind: clampStr(l['kind'], 40) || 'other',
    label: label || handle,
    handle,
    deepLink: safeDeepLink(l['deepLink']),
    ...(asBool(l['preferred']) ? { preferred: true } : {}),
  };
}

/**
 * Coerce an untrusted payload (from the dashboard) into a well-formed
 * {@link ProjectDirectorConfig}: strings are trimmed and length-capped, unknown
 * enum values fall back to a safe default (never dropped), ids are de-duplicated
 * and generated when missing, role records referencing a non-existent contact
 * are dropped, optional references that dangle are cleared, and deep-links with
 * a non-allowlisted scheme are stripped. Returns `undefined` when the top-level
 * shape is not a director config at all. This is the webview → disk security
 * boundary; no secret values are ever expected here (only labels/handles/notes).
 */
export function sanitizeProjectDirectorConfig(input: unknown): ProjectDirectorConfig | undefined {
  if (!isProjectDirectorConfig(input)) {
    return undefined;
  }
  const raw = input as unknown as Record<string, unknown>;
  const project = asObject(raw['project']);

  // Contacts first — they define the id space every role record references.
  const usedContactIds = new Set<string>();
  const contacts: DirectorContact[] = [];
  for (const item of raw['contacts'] as unknown[]) {
    const c = asObject(item);
    const name = clampStr(c['name'], 120);
    if (!name) { continue; }
    let id = clampStr(c['id'], 80) || `contact-${slugify(name)}`;
    while (usedContactIds.has(id)) { id = `${id}-${usedContactIds.size}`; }
    usedContactIds.add(id);

    const usedLinkIds = new Set<string>();
    const links: CommunicationLink[] = [];
    if (Array.isArray(c['links'])) {
      (c['links'] as unknown[]).forEach((raw, i) => {
        const link = sanitizeLink(raw, i, usedLinkIds);
        if (link) { links.push(link); }
      });
    }

    const refRaw = c['ref'];
    const ref = (typeof refRaw === 'object' && refRaw !== null)
      ? (() => {
          const r = asObject(refRaw);
          const displayLabel = clampStr(r['displayLabel'], 160);
          if (!displayLabel && !r['externalId']) { return undefined; }
          return {
            source: whitelist(r['source'], DIRECTORY_SOURCES, 'local'),
            externalId: optStr(r['externalId'], 200),
            displayLabel: displayLabel || name,
          };
        })()
      : undefined;

    contacts.push({
      id,
      name,
      kind: whitelist(c['kind'], CONTACT_KINDS, 'person'),
      title: optStr(c['title']),
      org: optStr(c['org']),
      timezone: optStr(c['timezone'], 60),
      ref,
      links,
      piiStored: asBool(c['piiStored']),
      notes: optStr(c['notes'], MAX_LONG),
    });
  }
  const contactIds = new Set(contacts.map(c => c.id));
  const validRef = (id: unknown): string | undefined => {
    const s = clampStr(id, 80);
    return s && contactIds.has(s) ? s : undefined;
  };

  // Stakeholders (drop if the required contact is missing).
  const usedStakeholderIds = new Set<string>();
  const stakeholders: Stakeholder[] = [];
  for (const item of raw['stakeholders'] as unknown[]) {
    const s = asObject(item);
    const contactId = validRef(s['contactId']);
    if (!contactId) { continue; }
    let id = clampStr(s['id'], 80) || `stk-${slugify(contactId)}`;
    while (usedStakeholderIds.has(id)) { id = `${id}-${usedStakeholderIds.size}`; }
    usedStakeholderIds.add(id);
    stakeholders.push({
      id,
      contactId,
      category: whitelist(s['category'], STAKEHOLDER_CATEGORIES, 'other'),
      influence: whitelist(s['influence'], LEVELS, 'medium'),
      interest: whitelist(s['interest'], LEVELS, 'medium'),
      interestSummary: optStr(s['interestSummary'], MAX_LONG),
      notes: optStr(s['notes'], MAX_LONG),
    });
  }

  // Team members (drop if the required contact is missing).
  const usedTeamIds = new Set<string>();
  const teamMembers: TeamMember[] = [];
  for (const item of raw['teamMembers'] as unknown[]) {
    const t = asObject(item);
    const contactId = validRef(t['contactId']);
    if (!contactId) { continue; }
    const discipline = clampStr(t['discipline'], 120) || 'contributor';
    let id = clampStr(t['id'], 80) || `tm-${slugify(contactId)}`;
    while (usedTeamIds.has(id)) { id = `${id}-${usedTeamIds.size}`; }
    usedTeamIds.add(id);
    teamMembers.push({
      id,
      contactId,
      discipline,
      // A role id is a slug, not free text: it is looked up against the role
      // list, and an unrecognised one resolves to no role rather than to a
      // partially-matched one.
      roleId: optSlug(t['roleId'], 60),
      allocation: optStr(t['allocation'], 60),
      availability: optStr(t['availability'], 120),
      notes: optStr(t['notes'], MAX_LONG),
    });
  }

  // Responsibilities (drop if the owner contact is missing; clear dangling backup).
  const usedRespIds = new Set<string>();
  const responsibilities: Responsibility[] = [];
  for (const item of raw['responsibilities'] as unknown[]) {
    const r = asObject(item);
    const area = clampStr(r['area'], 160);
    const ownerContactId = validRef(r['ownerContactId']);
    if (!area || !ownerContactId) { continue; }
    let id = clampStr(r['id'], 80) || `resp-${slugify(area)}`;
    while (usedRespIds.has(id)) { id = `${id}-${usedRespIds.size}`; }
    usedRespIds.add(id);
    responsibilities.push({
      id,
      area,
      description: optStr(r['description'], MAX_LONG),
      ownerContactId,
      backupContactId: validRef(r['backupContactId']),
      paths: cleanPathPatterns(r['paths']),
      notes: optStr(r['notes'], MAX_LONG),
    });
  }
  const respIds = new Set(responsibilities.map(r => r.id));

  // Assignments (clear dangling contact/responsibility refs; keep bounded links
  // to host-resolved runs and dashboard work as-is).
  const usedAssignmentIds = new Set<string>();
  const assignments: Assignment[] = [];
  for (const item of raw['assignments'] as unknown[]) {
    const a = asObject(item);
    const title = clampStr(a['title'], MAX_FIELD);
    if (!title) { continue; }
    let id = clampStr(a['id'], 80) || `asg-${slugify(title)}`;
    while (usedAssignmentIds.has(id)) { id = `${id}-${usedAssignmentIds.size}`; }
    usedAssignmentIds.add(id);
    const linkedRespRaw = clampStr(a['linkedResponsibilityId'], 80);
    const linkedWorkRaw = asObject(a['linkedWork']);
    const linkedWorkKind = whitelist(linkedWorkRaw['kind'], DASHBOARD_WORK_KINDS, '' as DashboardWorkKind);
    const linkedWorkId = clampStr(linkedWorkRaw['id'], 600);
    assignments.push({
      id,
      title,
      kind: whitelist(a['kind'], ASSIGNMENT_KINDS, 'task'),
      assigneeContactId: validRef(a['assigneeContactId']),
      status: whitelist(a['status'], ASSIGNMENT_STATUSES, 'todo'),
      priority: whitelist(a['priority'], ASSIGNMENT_PRIORITIES, 'medium'),
      due: optStr(a['due'], 40),
      linkedRunId: optStr(a['linkedRunId'], 120),
      linkedResponsibilityId: respIds.has(linkedRespRaw) ? linkedRespRaw : undefined,
      ...(linkedWorkKind && linkedWorkId ? { linkedWork: { kind: linkedWorkKind, id: linkedWorkId } } : {}),
      source: whitelist(a['source'], ['manual', 'imported', 'run', 'dashboard'], 'manual'),
      createdAt: isoOrNow(a['createdAt']),
      updatedAt: isoOrNow(a['updatedAt']),
      notes: optStr(a['notes'], MAX_LONG),
    });
  }

  // Follow-ups (clear dangling contact refs).
  const usedFollowUpIds = new Set<string>();
  const followUps: FollowUp[] = [];
  for (const item of raw['followUps'] as unknown[]) {
    const f = asObject(item);
    const title = clampStr(f['title'], MAX_FIELD);
    if (!title) { continue; }
    let id = clampStr(f['id'], 80) || `fu-${slugify(title)}`;
    while (usedFollowUpIds.has(id)) { id = `${id}-${usedFollowUpIds.size}`; }
    usedFollowUpIds.add(id);
    const linked = asObject(f['linked']);
    followUps.push({
      id,
      title,
      ownerContactId: validRef(f['ownerContactId']),
      withContactId: validRef(f['withContactId']),
      dueDate: clampStr(f['dueDate'], 40) || new Date().toISOString().slice(0, 10),
      cadence: whitelist(f['cadence'], FOLLOWUP_CADENCES, 'once'),
      status: whitelist(f['status'], FOLLOWUP_STATUSES, 'open'),
      linked: {
        kind: whitelist(linked['kind'], LINKED_KINDS, 'none'),
        id: optStr(linked['id'], 120),
      },
      channelHint: optStr(f['channelHint'], 40),
      createdAt: isoOrNow(f['createdAt']),
      updatedAt: isoOrNow(f['updatedAt']),
      completedAt: optStr(f['completedAt'], 40),
      snoozedUntil: optStr(f['snoozedUntil'], 40),
      lastFiredAt: optStr(f['lastFiredAt'], 40),
      notes: optStr(f['notes'], MAX_LONG),
    });
  }

  const settings = asObject(raw['settings']);
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    project: {
      name: clampStr(project['name'], 200),
      summary: optStr(project['summary'], MAX_LONG),
    },
    selfContactId: validRef(raw['selfContactId']),
    contacts,
    stakeholders,
    teamMembers,
    responsibilities,
    assignments,
    followUps,
    settings: {
      teamMode: whitelist(settings['teamMode'], TEAM_MODES, 'auto'),
      nudgeOnActivation: settings['nudgeOnActivation'] === false ? false : true,
      remindersEnabled: asBool(settings['remindersEnabled']),
      outboundEnabled: asBool(settings['outboundEnabled']),
    },
  };
}

// ── Derivations (pure; used by the panel, tree, and scheduler) ───

export type FollowUpUrgency = 'overdue' | 'due-soon' | 'upcoming' | 'done' | 'snoozed';

/** Local calendar date key (yyyy-mm-dd) for a Date. */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Normalise an ISO date/timestamp string to its yyyy-mm-dd key. */
function toDateKey(value: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) { return value.slice(0, 10); }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : dateKey(new Date(parsed));
}

function dayDiff(fromKey: string, toKey: string): number {
  const a = Date.parse(`${fromKey}T00:00:00Z`);
  const b = Date.parse(`${toKey}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Classify a follow-up's urgency. `overdue`/`due-soon`/`upcoming` are derived
 * from `dueDate` relative to now; `done`/`cancelled` collapse to `done`; a
 * snoozed item that has not yet re-surfaced is `snoozed`, otherwise it is
 * re-evaluated by its due date. "Due soon" = due within the next 3 days.
 */
export function deriveFollowUpUrgency(followUp: FollowUp, now: Date = new Date()): FollowUpUrgency {
  if (followUp.status === 'done' || followUp.status === 'cancelled') { return 'done'; }
  const todayKey = dateKey(now);
  if (followUp.status === 'snoozed' && followUp.snoozedUntil) {
    const snoozeKey = toDateKey(followUp.snoozedUntil);
    if (snoozeKey && snoozeKey > todayKey) { return 'snoozed'; }
  }
  const dueKey = toDateKey(followUp.dueDate);
  if (!dueKey) { return 'upcoming'; }
  if (dueKey < todayKey) { return 'overdue'; }
  return dayDiff(todayKey, dueKey) <= 3 ? 'due-soon' : 'upcoming';
}

/** Count follow-ups whose derived urgency is `overdue`. */
export function countOverdueFollowUps(config: ProjectDirectorConfig | undefined, now: Date = new Date()): number {
  if (!config) { return 0; }
  return config.followUps.filter(f => deriveFollowUpUrgency(f, now) === 'overdue').length;
}

/** Whether any contact stores raw personal data locally (drives the consent gate). */
export function configStoresRawPii(config: ProjectDirectorConfig | undefined): boolean {
  return Boolean(config?.contacts.some(c => c.piiStored));
}

/**
 * Resolve the effective solo/team mode. An explicit `solo`/`team` setting wins;
 * `auto` infers **solo** when there is no team member other than "me" — so a
 * one-person project never has to fill in team ceremony, and the dashboard can
 * foreground self-management (my follow-ups, my responsibilities) instead.
 */
export function resolveTeamMode(config: ProjectDirectorConfig | undefined): 'solo' | 'team' {
  if (!config) { return 'solo'; }
  if (config.settings.teamMode === 'solo' || config.settings.teamMode === 'team') {
    return config.settings.teamMode;
  }
  const others = config.teamMembers.filter(tm => tm.contactId !== config.selfContactId);
  return others.length > 0 ? 'team' : 'solo';
}

/** Convenience predicate for {@link resolveTeamMode} === 'solo'. */
export function isSoloProject(config: ProjectDirectorConfig | undefined): boolean {
  return resolveTeamMode(config) === 'solo';
}

// ── Persistence (node fs; vscode-free) ───────────────────────────

export function readProjectDirectorConfig(workspaceRoot: string): ProjectDirectorConfig | undefined {
  return readProjectDirectorFile(workspaceRoot).config;
}

/**
 * Read the people roster, distinguishing "no usable file" from "a file this build
 * must not touch".
 *
 * `preserveExisting` is true when the file was written by a *newer* AtlasMind.
 * It is intact and readable by that build, so seeding a default over it would
 * destroy real work — and the plain reader cannot say so, because both cases
 * look like `undefined`.
 */
export function readProjectDirectorFile(workspaceRoot: string): VersionedDocumentRead<ProjectDirectorConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(workspaceRoot, PROJECT_DIRECTOR_SSOT_PATH), 'utf8'));
  } catch {
    // Absent or unparseable: there is nothing to preserve.
    return { preserveExisting: false };
  }
  return interpretVersionedDocument('project-director', parsed, isProjectDirectorConfig);
}

/**
 * Persist the config as JSON (source of truth) and regenerate the human-readable
 * markdown mirror alongside it. Both files live in `project_memory/operations/`.
 */
export async function writeProjectDirectorConfig(
  workspaceRoot: string,
  config: ProjectDirectorConfig,
): Promise<void> {
  const configPath = path.join(workspaceRoot, PROJECT_DIRECTOR_SSOT_PATH);
  const summaryPath = path.join(workspaceRoot, PROJECT_DIRECTOR_SUMMARY_SSOT_PATH);
  await mkdir(path.dirname(configPath), { recursive: true });
  const updated: ProjectDirectorConfig = { ...config, updatedAt: new Date().toISOString() };
  await Promise.all([
    writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8'),
    writeFile(summaryPath, renderProjectDirectorMarkdown(updated), 'utf-8'),
  ]);
}

// ── Markdown mirror ──────────────────────────────────────────────

function describe(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : '—';
}

/** The preferred (or first) link, described by kind + label only — never the raw handle. */
function preferredChannelLabel(contact: DirectorContact | undefined): string {
  if (!contact || contact.links.length === 0) { return '—'; }
  const link = contact.links.find(l => l.preferred) ?? contact.links[0];
  return `${link.kind}${link.label && link.label !== link.kind ? ` (${link.label})` : ''}`;
}

/**
 * Render the natural-language companion document. A newcomer can read this file
 * top to bottom and understand who is who, who owns what, and what is due.
 *
 * GDPR note: this mirror is version-controllable, so it describes communication
 * channels by *kind* and *label* only — raw handles (email addresses, phone
 * numbers) stay in `project-director.json`, not in git-tracked prose.
 */
export function renderProjectDirectorMarkdown(config: ProjectDirectorConfig): string {
  const nameOf = (contactId: string | undefined): string => {
    const c = config.contacts.find(x => x.id === contactId);
    if (!c) { return '—'; }
    return contactId === config.selfContactId ? `${c.name} (you)` : c.name;
  };
  const contactOf = (contactId: string | undefined): DirectorContact | undefined =>
    config.contacts.find(x => x.id === contactId);

  const lines: string[] = [];
  lines.push('# Project Director');
  lines.push('');
  lines.push('> Maintained by AtlasMind (Project Dashboard → Director). This is the human-readable');
  lines.push('> mirror of `project-director.json`. Communication channels are shown by kind/label only;');
  lines.push('> raw handles (emails, phone numbers) live in the JSON, not in this git-tracked file.');
  lines.push('');

  lines.push('## Project');
  lines.push('');
  lines.push(`- **Name:** ${describe(config.project.name)}`);
  if (config.project.summary) { lines.push(`- **Summary:** ${config.project.summary}`); }
  lines.push(`- **Mode:** ${resolveTeamMode(config) === 'solo' ? 'Solo' : 'Team'}`);
  const me = config.contacts.find(x => x.id === config.selfContactId);
  if (me) { lines.push(`- **You:** ${me.name}`); }
  lines.push('');

  lines.push('## Stakeholders');
  lines.push('');
  if (config.stakeholders.length === 0) {
    lines.push('_None recorded yet._');
  } else {
    lines.push('| Name | Category | Influence / Interest | Cares about | Preferred channel |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const s of config.stakeholders) {
      lines.push(`| ${nameOf(s.contactId)} | ${s.category} | ${s.influence} / ${s.interest} | ${describe(s.interestSummary)} | ${preferredChannelLabel(contactOf(s.contactId))} |`);
    }
  }
  lines.push('');

  lines.push('## Team');
  lines.push('');
  if (config.teamMembers.length === 0) {
    lines.push('_None recorded yet._');
  } else {
    lines.push('| Name | Discipline | Allocation | Preferred channel |');
    lines.push('| --- | --- | --- | --- |');
    for (const t of config.teamMembers) {
      lines.push(`| ${nameOf(t.contactId)} | ${t.discipline} | ${describe(t.allocation)} | ${preferredChannelLabel(contactOf(t.contactId))} |`);
    }
  }
  lines.push('');

  lines.push('## Responsibilities');
  lines.push('');
  if (config.responsibilities.length === 0) {
    lines.push('_None recorded yet._');
  } else {
    lines.push('| Area | Owner | Backup | Description |');
    lines.push('| --- | --- | --- | --- |');
    for (const r of config.responsibilities) {
      lines.push(`| ${describe(r.area)} | ${nameOf(r.ownerContactId)} | ${r.backupContactId ? nameOf(r.backupContactId) : '—'} | ${describe(r.description)} |`);
    }
  }
  lines.push('');

  lines.push('## Assignments');
  lines.push('');
  if (config.assignments.length === 0) {
    lines.push('_None recorded yet._');
  } else {
    lines.push('| Title | Linked work | Assignee | Status | Priority | Due |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const a of config.assignments) {
      const linked = a.linkedWork ? `${a.linkedWork.kind}: ${a.linkedWork.id}` : a.linkedRunId ? `run: ${a.linkedRunId}` : '—';
      lines.push(`| ${describe(a.title)} | ${describe(linked)} | ${a.assigneeContactId ? nameOf(a.assigneeContactId) : '—'} | ${a.status} | ${a.priority} | ${describe(a.due)} |`);
    }
  }
  lines.push('');

  lines.push('## Follow-ups');
  lines.push('');
  const groups: Array<{ heading: string; urgency: FollowUpUrgency }> = [
    { heading: 'Overdue', urgency: 'overdue' },
    { heading: 'Due soon', urgency: 'due-soon' },
    { heading: 'Upcoming', urgency: 'upcoming' },
  ];
  const active = config.followUps.filter(f => f.status !== 'done' && f.status !== 'cancelled');
  if (active.length === 0) {
    lines.push('_No open follow-ups._');
  } else {
    for (const group of groups) {
      const items = active.filter(f => deriveFollowUpUrgency(f) === group.urgency);
      if (items.length === 0) { continue; }
      lines.push(`### ${group.heading}`);
      lines.push('');
      for (const f of items) {
        const withWhom = f.withContactId ? ` — with ${nameOf(f.withContactId)}` : '';
        lines.push(`- **${describe(f.title)}** (due ${describe(f.dueDate)})${withWhom}`);
      }
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(`_Last updated: ${config.updatedAt ?? 'unknown'}._`);
  lines.push('');
  return lines.join('\n');
}

// ── Service ──────────────────────────────────────────────────────

/**
 * Workspace-scoped holder for the Project Director config. Reads the persisted
 * roster at construction and serves it to the dashboard; seeds and persists a
 * first draft on first use. Persistence is best-effort so a read-only workspace
 * still serves an in-memory config. Undefined workspace → undefined config,
 * never a throw.
 */
export class ProjectDirectorManager {
  private config: ProjectDirectorConfig | undefined;
  /**
   * True when a file exists that this build must not overwrite — it was written
   * by a newer AtlasMind. Distinct from "no config", which is safe to seed over.
   * This one matters most: the roster holds real people.
   */
  private preserveExisting = false;
  private notice: string | undefined;

  constructor(private readonly workspaceRoot: string | undefined) {
    this.applyRead();
  }

  private applyRead(): void {
    if (!this.workspaceRoot) {
      this.config = undefined;
      this.preserveExisting = false;
      this.notice = undefined;
      return;
    }
    const read = readProjectDirectorFile(this.workspaceRoot);
    this.config = read.config;
    this.preserveExisting = read.preserveExisting;
    this.notice = read.notice;
  }

  /** Something worth telling the user about the file itself, if anything. */
  getNotice(): string | undefined {
    return this.notice;
  }

  getConfig(): ProjectDirectorConfig | undefined {
    return this.config;
  }

  hasConfig(): boolean {
    return this.config !== undefined;
  }

  /** Re-read the config from disk (e.g. after the file was edited externally). */
  reload(): ProjectDirectorConfig | undefined {
    // Through applyRead, so the preserve flag and notice are refreshed too —
    // a stale flag would either block a legitimate seed or permit a clobber.
    this.applyRead();
    return this.config;
  }

  /**
   * Return the existing config, or seed + persist a first draft if none exists
   * yet. Persistence is best-effort: on a read-only workspace the seeded config
   * is still returned in memory.
   */
  async ensureSeeded(seed: ProjectDirectorSeedInput): Promise<ProjectDirectorConfig> {
    if (this.config) {
      return this.config;
    }
    const seeded = seedProjectDirectorConfig(seed);
    this.config = seeded;
    // Never write over a file from a newer AtlasMind: it is not corrupt, this
    // build simply cannot read it, and replacing a roster of real people with
    // an empty default is the worst version of this bug.
    if (this.workspaceRoot && !this.preserveExisting) {
      try {
        await writeProjectDirectorConfig(this.workspaceRoot, seeded);
      } catch {
        // Best-effort; the in-memory config is still served.
      }
    }
    return seeded;
  }

  /** Persist an updated config (already sanitised by the caller) and cache it. */
  async save(config: ProjectDirectorConfig): Promise<void> {
    this.config = config;
    if (this.workspaceRoot) {
      await writeProjectDirectorConfig(this.workspaceRoot, config);
    }
  }
}
