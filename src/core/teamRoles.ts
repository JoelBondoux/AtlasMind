/**
 * Roles a Director can assign, and what assigning one actually does.
 *
 * The honest framing matters more here than anywhere else in the workflow, so
 * it is stated first:
 *
 * > **A role is a configuration template and a declared expectation. It is not
 * > a permission boundary.**
 *
 * AtlasMind runs inside each person's editor. It cannot prevent somebody
 * editing their own settings, and claiming otherwise would be security theatre.
 * What a role *can* do is real and useful:
 *
 * 1. **Configure.** The settings it writes go to workspace scope, which applies
 *    to everyone who opens the repository. Since v0.185.1 a person can still be
 *    *stricter* than their role — the most restrictive scope wins — so a role
 *    defines an envelope rather than forcing a level onto anyone.
 *
 * 2. **Declare.** The assignment is recorded in the Director's SSOT, which is
 *    committed. Who is expected to do what is visible and reviewable rather
 *    than remembered.
 *
 * 3. **Route review.** Roles plus responsibility paths generate CODEOWNERS
 *    entries, and *that* is where restriction genuinely bites — because GitHub
 *    enforces it, not AtlasMind.
 *
 * One deliberate omission: **a role never writes the master switch.** It sets
 * the ceiling and the capabilities — the shape of what is permitted — but each
 * person still turns the workflow on themselves. The master switch is described
 * to users as the one control they need in order to be certain, and a role that
 * flipped it on their behalf would take that away.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type { AutomationLevel } from './workflowAutomation.js';
import type { WorkflowStageId } from './workflowCurriculum.js';

export interface TeamRoleCapabilities {
  issueWrites: boolean;
  pullRequestWrites: boolean;
  releaseWrites: boolean;
  protectedRefWrites: boolean;
}

export interface TeamRole {
  id: string;
  label: string;
  /** One line on what this role is for. */
  blurb: string;
  /** The automation ceiling this role implies. */
  ceiling: AutomationLevel;
  capabilities: TeamRoleCapabilities;
  /** Workflow stages this role is expected to own. */
  ownsStages: WorkflowStageId[];
  /** Whether this role becomes a required reviewer on the paths it owns. */
  reviewsOwnedPaths: boolean;
  /** Built-in roles may be edited but never deleted. */
  builtIn: boolean;
}

/**
 * The shipped roles.
 *
 * Deliberately few. Each is a promise that the workflow behaves differently for
 * it, and a role nobody can tell apart from another is a menu item rather than a
 * capability. Directors can add their own; these seed.
 */
export const BUILTIN_TEAM_ROLES: readonly TeamRole[] = [
  {
    id: 'director',
    label: 'Director',
    blurb: 'Owns the workflow itself: sets the envelope, approves releases, and is the only role permitted to write to a protected branch.',
    ceiling: 'propose',
    capabilities: { issueWrites: true, pullRequestWrites: true, releaseWrites: true, protectedRefWrites: true },
    ownsStages: ['planning', 'release', 'automation'],
    reviewsOwnedPaths: true,
    builtIn: true,
  },
  {
    id: 'maintainer',
    label: 'Maintainer',
    blurb: 'Carries day-to-day delivery: opens and merges pull requests, triages issues, and prepares releases without publishing them.',
    ceiling: 'propose',
    // Release *preparation* without protected-ref writes: a maintainer can bump
    // and draft, and the promotion into a protected branch still needs the
    // Director. That split is the point of having two roles.
    capabilities: { issueWrites: true, pullRequestWrites: true, releaseWrites: true, protectedRefWrites: false },
    ownsStages: ['planning', 'branching', 'pull-request', 'ci'],
    reviewsOwnedPaths: true,
    builtIn: true,
  },
  {
    id: 'contributor',
    label: 'Contributor',
    blurb: 'Writes code and opens pull requests. Cannot merge their own work, which is the separation a review requirement exists to create.',
    ceiling: 'draft',
    capabilities: { issueWrites: true, pullRequestWrites: false, releaseWrites: false, protectedRefWrites: false },
    ownsStages: ['branching', 'development'],
    reviewsOwnedPaths: false,
    builtIn: true,
  },
  {
    id: 'reviewer',
    label: 'Reviewer',
    blurb: 'Reads and reviews. Comments and approvals only — no branch, release, or issue writes.',
    ceiling: 'observe',
    capabilities: { issueWrites: false, pullRequestWrites: false, releaseWrites: false, protectedRefWrites: false },
    ownsStages: ['pull-request'],
    reviewsOwnedPaths: true,
    builtIn: true,
  },
  {
    id: 'observer',
    label: 'Observer',
    blurb: 'Sees the workflow and its metrics and changes nothing. For stakeholders who need visibility rather than involvement.',
    ceiling: 'observe',
    capabilities: { issueWrites: false, pullRequestWrites: false, releaseWrites: false, protectedRefWrites: false },
    ownsStages: [],
    reviewsOwnedPaths: false,
    builtIn: true,
  },
];

export function builtInRole(id: string): TeamRole | undefined {
  return BUILTIN_TEAM_ROLES.find(role => role.id === id);
}

// ── Settings a role implies ──────────────────────────────────────────────────

/** A setting a role writes, with the value and why. */
export interface RoleSettingChange {
  key: string;
  value: string | boolean;
  /** Shown in the confirmation, so nobody approves a change they cannot read. */
  reason: string;
}

/**
 * The settings assigning a role would write, in a stable order.
 *
 * **Never includes `workflow.enabled`.** See the module note: the master switch
 * stays the individual's. A role defines what is permitted once somebody turns
 * the workflow on, not whether it is on.
 */
export function roleWorkspaceSettings(role: TeamRole): RoleSettingChange[] {
  const changes: RoleSettingChange[] = [
    {
      key: 'atlasmind.workflow.maxAutomationLevel',
      value: role.ceiling,
      reason: `${role.label} works at \`${role.ceiling}\`. Anyone can still set themselves lower.`,
    },
    {
      key: 'atlasmind.workflow.allowIssueWrites',
      value: role.capabilities.issueWrites,
      reason: role.capabilities.issueWrites
        ? 'Create, comment on and close issues. Each write still confirms first.'
        : 'No issue writes.',
    },
    {
      key: 'atlasmind.workflow.allowPullRequestWrites',
      value: role.capabilities.pullRequestWrites,
      reason: role.capabilities.pullRequestWrites
        ? 'Open, review and merge pull requests. Each write still confirms first.'
        : 'No pull request writes. Reviews and comments are unaffected.',
    },
    {
      key: 'atlasmind.workflow.allowReleaseWrites',
      value: role.capabilities.releaseWrites,
      reason: role.capabilities.releaseWrites
        ? 'Prepare a release — version bump and changelog. Tagging and publishing stay human-triggered.'
        : 'No release preparation.',
    },
    {
      key: 'atlasmind.workflow.allowProtectedRefWrites',
      value: role.capabilities.protectedRefWrites,
      reason: role.capabilities.protectedRefWrites
        ? 'May write to a protected branch. Rarely correct — a protected branch exists so changes reach it through review.'
        : 'No protected branch writes.',
    },
  ];
  return changes;
}

/**
 * The confirmation text for applying a role.
 *
 * Built from the same values that will be written, so the dialog cannot
 * describe something other than what happens — the rule every outward-facing
 * write in AtlasMind follows.
 */
export function describeRoleApplication(role: TeamRole, scopeLabel = 'this workspace'): string {
  const changes = roleWorkspaceSettings(role);
  const lines = [
    `Apply the ${role.label} role to ${scopeLabel}.`,
    '',
    'This writes the following settings, which apply to everyone who opens this repository:',
    ...changes.map(change => `  ${change.key} = ${String(change.value)}`),
    '',
    'It does not turn the workflow on — that stays each person\'s own decision — and anyone can still set themselves more restrictive than the role.',
  ];
  return lines.join('\n');
}

// ── CODEOWNERS ───────────────────────────────────────────────────────────────

/**
 * A GitHub owner reference: `@user` or `@org/team`.
 *
 * Validated rather than sanitised, because a *plausible but wrong* handle is
 * worse than a rejected one: GitHub silently ignores an owner it cannot resolve,
 * so the path ends up with no required reviewer and nobody finds out until a
 * change lands unreviewed.
 */
export function normalizeGithubOwner(handle: string | undefined): string | undefined {
  const raw = (handle ?? '').trim().replace(/^@/, '');
  if (!raw) {
    return undefined;
  }
  // A team reference: org/team.
  const team = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})$/.exec(raw);
  if (team) {
    return `@${raw}`;
  }
  // A user: alphanumeric and hyphens, no leading or trailing hyphen, max 39.
  if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(raw) && !raw.includes('--')) {
    return `@${raw}`;
  }
  return undefined;
}

export interface CodeownersEntry {
  /** A path pattern, as GitHub reads them. */
  path: string;
  /** Owner handles, already normalised. */
  owners: string[];
  /** The responsibility this came from, for the comment above it. */
  area?: string;
}

export interface CodeownersBuildInput {
  /** Responsibility areas with paths and the contacts who own them. */
  responsibilities: readonly {
    area: string;
    paths?: readonly string[];
    ownerHandles: readonly string[];
    backupHandles?: readonly string[];
  }[];
}

export interface CodeownersBuildResult {
  entries: CodeownersEntry[];
  /** The managed block body, ready for `upsertManagedBlock`. */
  block: string;
  /** Anything dropped, and why. Never silent. */
  warnings: string[];
}

/**
 * The path a CODEOWNERS pattern must not be.
 *
 * A bare `*` makes the owners required reviewers on *every* file, which is
 * almost never what somebody assigning a responsibility area meant, and it
 * silently overrides every more specific rule above it.
 */
function isOverbroad(path: string): boolean {
  return path.trim() === '*' || path.trim() === '/*' || path.trim() === '**';
}

/**
 * Build the managed CODEOWNERS block from responsibilities.
 *
 * Only the block is generated — hand-written entries outside it are preserved
 * by `upsertManagedBlock`. That matters: CODEOWNERS is a file GitHub reads to
 * route review, and replacing somebody's hand-written rules would reassign
 * review for paths nobody asked about.
 *
 * Order is preserved from the input, because **CODEOWNERS is last-match-wins**:
 * reordering entries silently changes who reviews what.
 */
export function buildCodeownersBlock(input: CodeownersBuildInput): CodeownersBuildResult {
  const entries: CodeownersEntry[] = [];
  const warnings: string[] = [];

  for (const responsibility of input.responsibilities) {
    const paths = (responsibility.paths ?? []).map(path => path.trim()).filter(Boolean);
    const owners = [...responsibility.ownerHandles, ...(responsibility.backupHandles ?? [])]
      .map(handle => normalizeGithubOwner(handle))
      .filter((handle): handle is string => handle !== undefined);

    const rejected = [...responsibility.ownerHandles, ...(responsibility.backupHandles ?? [])]
      .filter(handle => normalizeGithubOwner(handle) === undefined && (handle ?? '').trim().length > 0);
    for (const handle of rejected) {
      warnings.push(`\`${handle}\` is not a valid GitHub owner and was dropped from "${responsibility.area}". GitHub ignores an owner it cannot resolve, so the path would have had no reviewer.`);
    }

    if (paths.length === 0) {
      warnings.push(`"${responsibility.area}" has no paths, so it cannot route review. Add a path pattern to include it.`);
      continue;
    }
    if (owners.length === 0) {
      warnings.push(`"${responsibility.area}" has no usable GitHub owner, so it was left out rather than written with no reviewer.`);
      continue;
    }

    for (const path of paths) {
      if (isOverbroad(path)) {
        warnings.push(`"${responsibility.area}" uses \`${path}\`, which would make its owners required reviewers on every file and override every more specific rule. Left out.`);
        continue;
      }
      entries.push({ path, owners: [...new Set(owners)], area: responsibility.area });
    }
  }

  const lines: string[] = [
    '# Generated by AtlasMind from the Project Director roster.',
    '# Edit responsibilities and their paths there rather than here — this block is rewritten.',
    '# Entries outside this block are yours and are never touched.',
  ];
  let lastArea: string | undefined;
  for (const entry of entries) {
    if (entry.area && entry.area !== lastArea) {
      lines.push('', `# ${entry.area}`);
      lastArea = entry.area;
    }
    lines.push(`${entry.path} ${entry.owners.join(' ')}`);
  }

  return { entries, block: lines.join('\n'), warnings };
}

export const CODEOWNERS_MARKERS = {
  start: '# >>> atlasmind:codeowners:start',
  end: '# <<< atlasmind:codeowners:end',
} as const;

// ── Untrusted boundary ───────────────────────────────────────────────────────

/**
 * Coerce a persisted or user-edited role into a usable one.
 *
 * Every capability defaults **false** and the ceiling defaults to the most
 * restrictive value, so a malformed or truncated role grants nothing. A role
 * document is editable by hand, and a missing field must never read as consent.
 */
export function sanitizeTeamRole(value: unknown): TeamRole | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'].trim().slice(0, 60) : '';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return undefined;
  }
  const capabilities = (record['capabilities'] ?? {}) as Record<string, unknown>;
  const flag = (key: string): boolean => capabilities[key] === true;
  const ceilingRaw = record['ceiling'];
  const ceiling: AutomationLevel =
    ceilingRaw === 'off' || ceilingRaw === 'observe' || ceilingRaw === 'draft'
      || ceilingRaw === 'propose' || ceilingRaw === 'auto'
      ? ceilingRaw
      : 'observe';

  const stages = Array.isArray(record['ownsStages'])
    ? (record['ownsStages'] as unknown[]).filter((stage): stage is WorkflowStageId => typeof stage === 'string')
    : [];

  const text = (key: string, max: number, fallback: string): string => {
    const raw = record[key];
    return typeof raw === 'string' && raw.trim().length > 0
      ? raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
      : fallback;
  };

  return {
    id,
    label: text('label', 60, id),
    blurb: text('blurb', 400, ''),
    ceiling,
    capabilities: {
      issueWrites: flag('issueWrites'),
      pullRequestWrites: flag('pullRequestWrites'),
      releaseWrites: flag('releaseWrites'),
      protectedRefWrites: flag('protectedRefWrites'),
    },
    ownsStages: stages,
    reviewsOwnedPaths: record['reviewsOwnedPaths'] === true,
    builtIn: builtInRole(id) !== undefined,
  };
}

/**
 * Merge persisted roles over the built-ins.
 *
 * A built-in that was edited keeps the edit; a built-in that was *deleted*
 * comes back, because deleting one would silently remove the expectations
 * attached to everybody already assigned it.
 */
export function resolveTeamRoles(persisted: unknown): TeamRole[] {
  const edits = new Map<string, TeamRole>();
  if (Array.isArray(persisted)) {
    for (const entry of persisted) {
      const role = sanitizeTeamRole(entry);
      if (role) {
        edits.set(role.id, role);
      }
    }
  }
  const out: TeamRole[] = BUILTIN_TEAM_ROLES.map(role => edits.get(role.id) ?? role);
  for (const [id, role] of edits) {
    if (!builtInRole(id)) {
      out.push(role);
    }
  }
  return out;
}
