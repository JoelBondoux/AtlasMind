/**
 * Who is responsible for keeping a vital file current.
 *
 * The dashboard knew which files must never go stale — the Documents page tracks
 * them explicitly, the Delivery artifact inventory lists the ones a repository is
 * expected to keep — and it knew how to assign a human owner to a piece of
 * *outstanding work*. It had no answer for the standing question: a `README.md`
 * that is perfectly fresh today still has to be somebody's job tomorrow, and
 * `renderDirectorOwnerBadge` returned an empty string for every file nobody had
 * manually assigned. A file that belongs to everyone belongs to nobody, which is
 * how a repository ends up with a `SECURITY.md` written once in 2023.
 *
 * Five rules carry the semantics:
 *
 * **A vital file is never ownerless while a Director exists.** The default is
 * the person holding the built-in `director` role, which is the role that
 * already owns the workflow itself. This is a *derivation*, not a record: it
 * follows the roster, so replacing the Director re-points every default at once,
 * where written records would quietly keep naming somebody who left.
 *
 * **An explicit assignment always wins, and the two are never confused.**
 * `recorded` distinguishes "somebody decided this" from "nobody has, so it falls
 * here" — collapsing them would let a default read as a decision on a surface
 * whose entire purpose is to say who agreed to what.
 *
 * **A default is offered, never written on sight.** `project_memory/` is
 * git-tracked, so seeding assignment records because a tab was opened would
 * commit words nobody said — the rule `workflowConfig` states about its own file
 * and `roadmapGraphStore` states about reconciliation. `buildVitalFileAssignments`
 * produces exactly what a confirmed action *would* write, so the dialog can show
 * it before anything happens.
 *
 * **A guess may name you and must never name a colleague.** With no Director on
 * the roster the file falls to `selfContactId` — which `ProjectDirectorConfig`
 * already documents as the contact assignments default to, so this follows the
 * file's own convention rather than inventing one, and naming yourself is the
 * only guess that cannot burden somebody who never agreed to it. Picking the
 * first person on the roster is refused outright. It is recorded under its own
 * rule and reported as a `notice`, so "no Director is named" stays visible
 * instead of being papered over by a name that looks decided.
 *
 * **Only files somebody must keep current are in scope.** Nobody keeps
 * `coverage/` up to date — it is the output of a build — so ephemeral artifacts
 * are excluded, and that exclusion is a rule rather than an oversight.
 *
 * Pure: no `vscode`, no filesystem. Clock injected.
 */

/** The two inventories that hold files a person must keep current. */
export type VitalFileKind = 'document' | 'artifact';

export type VitalFileOwnerRule = 'assigned' | 'director' | 'self' | 'unowned';

/**
 * The role a default falls to. Matches the built-in id in `teamRoles.ts`, pinned
 * by test — a mismatch would make every default silently unresolvable, which
 * looks identical to a project that never named a Director.
 */
export const VITAL_FILE_DEFAULT_ROLE_ID = 'director';

/**
 * The declared rules that decide an owner, in the order they are evaluated.
 * Order *is* the policy, and the table is published on the surface so a name on
 * a card can be checked against the rule that put it there.
 */
export const VITAL_FILE_OWNER_RULES: ReadonlyArray<{ id: VitalFileOwnerRule; describes: string }> = [
  { id: 'assigned', describes: 'An assignment in the Director’s roster names an owner for this file. An explicit decision always wins.' },
  { id: 'director', describes: 'Nobody has been assigned, so the file falls to the person holding the Director role — the role that owns the workflow itself.' },
  { id: 'self', describes: 'Nobody has been assigned and no Director is named, so the file falls to you — the contact this project already treats as the assignment default.' },
  { id: 'unowned', describes: 'Nobody has been assigned, no Director is named, and this project has no “me” contact either. Reported rather than guessed at.' },
];

const RULE_TEXT = new Map(VITAL_FILE_OWNER_RULES.map(rule => [rule.id, rule.describes]));

/** One file somebody has to keep current. */
export interface VitalFile {
  kind: VitalFileKind;
  /** Matches `Assignment.linkedWork.id` for this kind. */
  id: string;
  label: string;
  path: string;
  /** Why this file is one somebody must keep current. */
  reason: string;
}

export interface VitalFileOwner {
  rule: VitalFileOwnerRule;
  /** The declared rule text, carried so no surface restates it from memory. */
  ruleText: string;
  contactId?: string;
  contactName?: string;
  /**
   * True only for `assigned`. Everything else is a default nobody wrote down,
   * and a surface that cannot tell them apart lets a derivation read as a
   * decision.
   */
  recorded: boolean;
  /** Present when more than one person holds the Director role. */
  otherDirectorCount?: number;
}

export interface VitalFileOwnership {
  file: VitalFile;
  owner: VitalFileOwner;
}

export interface VitalFileOwnershipInput {
  files: readonly VitalFile[];
  contacts: ReadonlyArray<{ id: string; name: string }>;
  teamMembers: ReadonlyArray<{ contactId: string; roleId?: string }>;
  selfContactId?: string;
  assignments: ReadonlyArray<{
    assigneeContactId?: string;
    status?: string;
    linkedWork?: { kind: string; id: string };
  }>;
}

export interface VitalFileOwnershipReport {
  entries: VitalFileOwnership[];
  /** Files whose owner somebody actually recorded. */
  recordedCount: number;
  /** Files falling to a default — owned, but by derivation. */
  defaultedCount: number;
  /** Files with no owner at all. */
  unownedCount: number;
  /** The person defaults fall to, when there is one. */
  defaultOwner?: { contactId: string; contactName: string; rule: 'director' | 'self' };
  /**
   * Something true about the default that is worth acting on but does not stop
   * it working — no Director is named, so these fall to you. Kept apart from
   * `blocker` because a fixable weakness and an unresolvable one call for
   * different reactions, and collapsing them makes the working case look broken.
   */
  notice?: string;
  /** Why nothing can be defaulted, when nothing can. Absent in the ordinary case. */
  blocker?: string;
  rules: ReadonlyArray<{ id: VitalFileOwnerRule; describes: string }>;
  summary: string;
}

/** Roster text is workspace-authored: strip controls and clamp before display. */
function safe(value: unknown, max = 200): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
    : '';
}

/**
 * The person defaults fall to, and what is worth saying about how we got there.
 *
 * A team member holding the Director role wins. Failing that it falls to you,
 * because `ProjectDirectorConfig` already documents `selfContactId` as the
 * contact assignments default to — and because naming yourself is the only
 * guess that cannot hand somebody else's files to a person who never agreed to
 * them. Picking the first name on the roster is refused: a roster seeded from
 * git history routinely contains bots, and "dependabot owns the SECURITY policy"
 * is worse than an honest gap because it stops anybody looking.
 */
export function resolveVitalFileDefaultOwner(
  input: Pick<VitalFileOwnershipInput, 'contacts' | 'teamMembers' | 'selfContactId'>,
): {
  owner?: { contactId: string; contactName: string; rule: 'director' | 'self' };
  otherDirectorCount: number;
  notice?: string;
  blocker?: string;
} {
  const nameOf = (contactId: string): string | undefined => {
    const contact = input.contacts.find(candidate => candidate.id === contactId);
    return contact ? safe(contact.name, 120) || contact.id : undefined;
  };

  const directors = input.teamMembers
    .filter(member => member.roleId === VITAL_FILE_DEFAULT_ROLE_ID)
    .map(member => member.contactId)
    .filter(contactId => nameOf(contactId) !== undefined);

  const first = directors[0];
  if (first) {
    return {
      owner: { contactId: first, contactName: nameOf(first)!, rule: 'director' },
      otherDirectorCount: Math.max(0, directors.length - 1),
    };
  }

  const self = safe(input.selfContactId, 120);
  if (self && nameOf(self)) {
    return {
      owner: { contactId: self, contactName: nameOf(self)!, rule: 'self' },
      otherDirectorCount: 0,
      notice: `No team member holds the Director role, so vital files fall to you (${nameOf(self)}). Assign the Director role in Project Director to point them somewhere else.`,
    };
  }

  return {
    otherDirectorCount: 0,
    blocker: input.contacts.length === 0
      ? 'No people are on the roster yet, so there is nobody for a vital file to fall to. Add contacts in Project Director.'
      : 'No team member holds the Director role and this project has no “me” contact, so vital files have no default owner. Assign the Director role in Project Director.',
  };
}

/**
 * Resolve an owner for every vital file.
 *
 * A `cancelled` assignment is ignored: "we decided not to do this" is not a
 * lasting claim on the file, so it falls back to the default. Every other status
 * is honoured, `done` included — a completed review still names the person whose
 * file it is.
 */
export function resolveVitalFileOwnership(input: VitalFileOwnershipInput): VitalFileOwnershipReport {
  const fallback = resolveVitalFileDefaultOwner(input);
  const nameOf = (contactId: string): string | undefined => {
    const contact = input.contacts.find(candidate => candidate.id === contactId);
    return contact ? safe(contact.name, 120) || contact.id : undefined;
  };

  const entries: VitalFileOwnership[] = input.files.map(file => {
    const assignment = input.assignments.find(candidate =>
      candidate.linkedWork?.kind === file.kind
      && candidate.linkedWork.id === file.id
      && candidate.status !== 'cancelled'
      && safe(candidate.assigneeContactId, 120) !== '');
    const assignedName = assignment?.assigneeContactId ? nameOf(assignment.assigneeContactId) : undefined;
    if (assignment?.assigneeContactId && assignedName) {
      return {
        file,
        owner: {
          rule: 'assigned',
          ruleText: RULE_TEXT.get('assigned')!,
          contactId: assignment.assigneeContactId,
          contactName: assignedName,
          recorded: true,
        },
      };
    }
    if (fallback.owner) {
      return {
        file,
        owner: {
          rule: fallback.owner.rule,
          ruleText: RULE_TEXT.get(fallback.owner.rule)!,
          contactId: fallback.owner.contactId,
          contactName: fallback.owner.contactName,
          recorded: false,
          ...(fallback.otherDirectorCount > 0 ? { otherDirectorCount: fallback.otherDirectorCount } : {}),
        },
      };
    }
    return {
      file,
      owner: { rule: 'unowned', ruleText: RULE_TEXT.get('unowned')!, recorded: false },
    };
  });

  const recordedCount = entries.filter(entry => entry.owner.recorded).length;
  const unownedCount = entries.filter(entry => entry.owner.rule === 'unowned').length;
  const defaultedCount = entries.length - recordedCount - unownedCount;

  return {
    entries,
    recordedCount,
    defaultedCount,
    unownedCount,
    ...(fallback.owner ? { defaultOwner: fallback.owner } : {}),
    ...(fallback.notice ? { notice: fallback.notice } : {}),
    ...(fallback.blocker ? { blocker: fallback.blocker } : {}),
    rules: VITAL_FILE_OWNER_RULES,
    summary: summarize(entries.length, recordedCount, defaultedCount, unownedCount, fallback.owner?.contactName),
  };
}

function summarize(
  total: number,
  recorded: number,
  defaulted: number,
  unowned: number,
  defaultName: string | undefined,
): string {
  if (total === 0) {
    return 'No vital files are tracked yet. Documents added on the Documents page and the artifacts this repository is expected to keep appear here.';
  }
  const parts = [`${total} vital file${total === 1 ? '' : 's'}`];
  if (recorded > 0) { parts.push(`${recorded} with a recorded owner`); }
  if (defaulted > 0 && defaultName) { parts.push(`${defaulted} falling to ${defaultName} by default`); }
  if (unowned > 0) { parts.push(`${unowned} with no owner at all`); }
  return `${parts.join(', ')}.`;
}

/**
 * The assignment records a confirmed "record these defaults" action would write.
 *
 * Returned as a value rather than written here for the reason the delivery run
 * plan returns its command list: a dialog cannot show somebody what is about to
 * be written if it is composed after they agree. Only defaults are included —
 * a file whose owner was recorded is left exactly as it is, and an unowned file
 * has nobody to record.
 */
export function buildVitalFileAssignments(
  report: VitalFileOwnershipReport,
  now: Date,
): Array<{
  id: string;
  title: string;
  kind: 'responsibility';
  assigneeContactId: string;
  status: 'todo';
  priority: 'medium';
  linkedWork: { kind: VitalFileKind; id: string };
  source: 'dashboard';
  createdAt: string;
  updatedAt: string;
  notes: string;
}> {
  const stamp = now.toISOString();
  return report.entries
    .filter(entry => !entry.owner.recorded && entry.owner.contactId !== undefined)
    .map(entry => ({
      // Deterministic and derived from the file, never a timestamp or a random
      // value: two people recording the same defaults must not produce a diff,
      // and running the action twice must update rather than duplicate.
      id: `vital-${entry.file.kind}-${entry.file.id}`,
      title: `Keep ${entry.file.label} current`,
      kind: 'responsibility' as const,
      assigneeContactId: entry.owner.contactId!,
      status: 'todo' as const,
      priority: 'medium' as const,
      linkedWork: { kind: entry.file.kind, id: entry.file.id },
      source: 'dashboard' as const,
      createdAt: stamp,
      updatedAt: stamp,
      notes: `${entry.file.reason} Recorded from the Delivery dashboard's default: ${entry.owner.ruleText}`,
    }));
}
