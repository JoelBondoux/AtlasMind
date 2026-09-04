import { describe, expect, it } from 'vitest';
import {
  VITAL_FILE_DEFAULT_ROLE_ID,
  VITAL_FILE_OWNER_RULES,
  buildVitalFileAssignments,
  resolveVitalFileDefaultOwner,
  resolveVitalFileOwnership,
  type VitalFile,
  type VitalFileOwnershipInput,
} from '../../src/core/vitalFileOwnership.ts';
import { BUILTIN_TEAM_ROLES } from '../../src/core/teamRoles.ts';

const FILES: VitalFile[] = [
  { kind: 'document', id: 'doc-1', label: 'Architecture', path: 'docs/architecture.md', reason: 'Tracked for weekly review.' },
  { kind: 'artifact', id: 'artifact-security-md', label: 'SECURITY.md', path: 'SECURITY.md', reason: 'The repository is expected to keep it.' },
];

function input(overrides: Partial<VitalFileOwnershipInput> = {}): VitalFileOwnershipInput {
  return {
    files: FILES,
    contacts: [
      { id: 'c-ada', name: 'Ada' },
      { id: 'c-grace', name: 'Grace' },
    ],
    teamMembers: [
      { contactId: 'c-ada', roleId: 'contributor' },
      { contactId: 'c-grace', roleId: 'director' },
    ],
    assignments: [],
    ...overrides,
  };
}

describe('the default role', () => {
  it('is a role teamRoles actually ships', () => {
    // A mismatch would make every default silently unresolvable, which looks
    // identical on screen to a project that never named a Director.
    expect(BUILTIN_TEAM_ROLES.map(role => role.id)).toContain(VITAL_FILE_DEFAULT_ROLE_ID);
  });
});

describe('resolveVitalFileDefaultOwner', () => {
  it('falls to the person holding the Director role', () => {
    const resolved = resolveVitalFileDefaultOwner(input());
    expect(resolved.owner).toEqual({ contactId: 'c-grace', contactName: 'Grace', rule: 'director' });
    expect(resolved.blocker).toBeUndefined();
  });

  it('reports how many others hold the role rather than hiding the ambiguity', () => {
    const resolved = resolveVitalFileDefaultOwner(input({
      teamMembers: [
        { contactId: 'c-grace', roleId: 'director' },
        { contactId: 'c-ada', roleId: 'director' },
      ],
    }));
    expect(resolved.owner?.contactId).toBe('c-grace');
    expect(resolved.otherDirectorCount).toBe(1);
  });

  it('falls to you when no Director is named, and keeps saying so', () => {
    // `selfContactId` is already documented as the contact assignments default
    // to, so this follows the file's own convention. The notice keeps "no
    // Director is named" visible rather than papering over it with a name that
    // looks decided — which is why it is a notice and not a blocker.
    const resolved = resolveVitalFileDefaultOwner({
      contacts: [{ id: 'c-me', name: 'Joel' }, { id: 'c-bot', name: 'dependabot[bot]' }],
      teamMembers: [{ contactId: 'c-bot' }],
      selfContactId: 'c-me',
    });
    expect(resolved.owner).toEqual({ contactId: 'c-me', contactName: 'Joel', rule: 'self' });
    expect(resolved.notice).toContain('Director role');
    expect(resolved.blocker).toBeUndefined();
  });

  it('never picks the first name on the roster', () => {
    // A roster seeded from git history routinely contains bots, and "dependabot
    // owns the SECURITY policy" is worse than an honest gap: it stops anybody
    // looking. With no Director and no self contact there is nobody to name.
    const resolved = resolveVitalFileDefaultOwner({
      contacts: [{ id: 'c-bot', name: 'dependabot[bot]' }, { id: 'c-grace', name: 'Grace' }],
      teamMembers: [{ contactId: 'c-bot', roleId: 'reviewer' }],
    });
    expect(resolved.owner).toBeUndefined();
    expect(resolved.blocker).toContain('Director role');
  });

  it('prefers a named Director over you', () => {
    const resolved = resolveVitalFileDefaultOwner({
      contacts: [{ id: 'c-me', name: 'Joel' }, { id: 'c-grace', name: 'Grace' }],
      teamMembers: [{ contactId: 'c-grace', roleId: 'director' }],
      selfContactId: 'c-me',
    });
    expect(resolved.owner?.contactId).toBe('c-grace');
    expect(resolved.notice).toBeUndefined();
  });

  it('names the missing roster rather than the missing role when there is nobody at all', () => {
    const resolved = resolveVitalFileDefaultOwner({ contacts: [], teamMembers: [] });
    expect(resolved.blocker).toContain('No people are on the roster');
  });

  it('ignores a Director whose contact record is gone', () => {
    const resolved = resolveVitalFileDefaultOwner({
      contacts: [{ id: 'c-ada', name: 'Ada' }],
      teamMembers: [{ contactId: 'c-departed', roleId: 'director' }],
    });
    expect(resolved.owner).toBeUndefined();
  });
});

describe('resolveVitalFileOwnership', () => {
  it('leaves no vital file ownerless while a Director exists', () => {
    const report = resolveVitalFileOwnership(input());
    expect(report.entries).toHaveLength(2);
    expect(report.entries.every(entry => entry.owner.contactName === 'Grace')).toBe(true);
    expect(report.unownedCount).toBe(0);
    expect(report.defaultedCount).toBe(2);
    expect(report.recordedCount).toBe(0);
  });

  it('marks a default as derived, never as a decision somebody made', () => {
    // Collapsing the two would let a derivation read as a decision on the one
    // surface whose purpose is recording what people agreed to.
    const report = resolveVitalFileOwnership(input());
    expect(report.entries.every(entry => entry.owner.recorded)).toBe(false);
    expect(report.entries[0]!.owner.rule).toBe('director');
  });

  it('lets an explicit assignment beat the default', () => {
    const report = resolveVitalFileOwnership(input({
      assignments: [{ assigneeContactId: 'c-ada', status: 'todo', linkedWork: { kind: 'document', id: 'doc-1' } }],
    }));
    const document = report.entries.find(entry => entry.file.kind === 'document')!;
    const artifact = report.entries.find(entry => entry.file.kind === 'artifact')!;

    expect(document.owner).toMatchObject({ rule: 'assigned', contactName: 'Ada', recorded: true });
    expect(artifact.owner).toMatchObject({ rule: 'director', contactName: 'Grace', recorded: false });
    expect(report.recordedCount).toBe(1);
    expect(report.defaultedCount).toBe(1);
  });

  it('falls back past a cancelled assignment but not past a completed one', () => {
    // "We decided not to do this" is not a lasting claim on the file. A finished
    // review still names the person whose file it is.
    const cancelled = resolveVitalFileOwnership(input({
      assignments: [{ assigneeContactId: 'c-ada', status: 'cancelled', linkedWork: { kind: 'document', id: 'doc-1' } }],
    }));
    const done = resolveVitalFileOwnership(input({
      assignments: [{ assigneeContactId: 'c-ada', status: 'done', linkedWork: { kind: 'document', id: 'doc-1' } }],
    }));

    expect(cancelled.entries[0]!.owner).toMatchObject({ rule: 'director', contactName: 'Grace' });
    expect(done.entries[0]!.owner).toMatchObject({ rule: 'assigned', contactName: 'Ada' });
  });

  it('treats an assignment with no assignee as no owner, not as a decision to leave it unowned', () => {
    const report = resolveVitalFileOwnership(input({
      assignments: [{ assigneeContactId: '', status: 'todo', linkedWork: { kind: 'document', id: 'doc-1' } }],
    }));
    expect(report.entries[0]!.owner.rule).toBe('director');
  });

  it('does not let one kind’s id match another kind’s file', () => {
    const report = resolveVitalFileOwnership({
      ...input(),
      files: [{ kind: 'artifact', id: 'doc-1', label: 'Coincidence', path: 'x', reason: 'r' }],
      assignments: [{ assigneeContactId: 'c-ada', status: 'todo', linkedWork: { kind: 'document', id: 'doc-1' } }],
    });
    expect(report.entries[0]!.owner.rule).toBe('director');
  });

  it('reports unowned with the reason rather than showing a clean empty state', () => {
    const report = resolveVitalFileOwnership(input({
      teamMembers: [{ contactId: 'c-ada', roleId: 'contributor' }],
      selfContactId: undefined,
    }));
    expect(report.unownedCount).toBe(2);
    expect(report.entries.every(entry => entry.owner.rule === 'unowned')).toBe(true);
    expect(report.blocker).toBeTruthy();
    expect(report.summary).toContain('no owner at all');
  });

  it('publishes the rules that graded it, and every entry names one of them', () => {
    const report = resolveVitalFileOwnership(input());
    const ruleIds = new Set(VITAL_FILE_OWNER_RULES.map(rule => rule.id));
    expect(report.rules).toEqual(VITAL_FILE_OWNER_RULES);
    expect(report.entries.every(entry => ruleIds.has(entry.owner.rule) && entry.owner.ruleText.length > 0)).toBe(true);
  });

  it('strips control characters out of a roster name before it reaches a card', () => {
    const report = resolveVitalFileOwnership(input({
      contacts: [{ id: 'c-grace', name: 'Grace\u001b[31m Hopper' }],
    }));
    expect(report.entries[0]!.owner.contactName).toBe('Grace [31m Hopper');
  });

  it('says nothing is tracked rather than reporting a healthy zero', () => {
    const report = resolveVitalFileOwnership(input({ files: [] }));
    expect(report.summary).toContain('No vital files are tracked yet');
  });
});

describe('buildVitalFileAssignments', () => {
  const now = new Date('2026-09-04T10:00:00.000Z');

  it('writes only the defaults, leaving recorded owners exactly as they are', () => {
    const report = resolveVitalFileOwnership(input({
      assignments: [{ assigneeContactId: 'c-ada', status: 'todo', linkedWork: { kind: 'document', id: 'doc-1' } }],
    }));
    const additions = buildVitalFileAssignments(report, now);

    expect(additions).toHaveLength(1);
    expect(additions[0]).toMatchObject({
      assigneeContactId: 'c-grace',
      kind: 'responsibility',
      linkedWork: { kind: 'artifact', id: 'artifact-security-md' },
      source: 'dashboard',
    });
  });

  it('writes nothing when there is nobody for a file to fall to', () => {
    const report = resolveVitalFileOwnership(input({ teamMembers: [], selfContactId: undefined }));
    expect(buildVitalFileAssignments(report, now)).toEqual([]);
  });

  it('derives ids from the file so a second run updates rather than duplicates', () => {
    // Two people recording the same defaults must not produce a diff, and the
    // action must be safe to press twice.
    const report = resolveVitalFileOwnership(input());
    const first = buildVitalFileAssignments(report, now);
    const second = buildVitalFileAssignments(report, new Date('2027-01-01T00:00:00.000Z'));

    expect(first.map(entry => entry.id)).toEqual(second.map(entry => entry.id));
    expect(new Set(first.map(entry => entry.id)).size).toBe(first.length);
    expect(first[0]!.id).not.toMatch(/\d{10,}/);
  });

  it('records the rule that produced the owner, so a written default is traceable', () => {
    const additions = buildVitalFileAssignments(resolveVitalFileOwnership(input()), now);
    expect(additions[0]!.notes).toContain('Director role');
  });
});
