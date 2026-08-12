import { describe, expect, it } from 'vitest';
import {
  countOverdueFollowUps,
  defaultProjectDirectorConfig,
  deriveFollowUpUrgency,
  isSoloProject,
  renderProjectDirectorMarkdown,
  resolveTeamMode,
  sanitizeProjectDirectorConfig,
  seedProjectDirectorConfig,
  configStoresRawPii,
} from '../../src/core/projectDirectorManager.ts';
import type { FollowUp, ProjectDirectorConfig } from '../../src/types.ts';

function makeFollowUp(overrides: Partial<FollowUp>): FollowUp {
  return {
    id: 'fu-1',
    title: 'Ping the sponsor',
    dueDate: '2026-07-24',
    cadence: 'once',
    status: 'open',
    linked: { kind: 'none' },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('seedProjectDirectorConfig', () => {
  it('turns git contributors into team members with a mailto link and PII flag', () => {
    const config = seedProjectDirectorConfig({
      projectName: 'AtlasMind',
      gitContributors: [{ name: 'Jane Doe', email: 'jane@example.com' }],
    });

    expect(config.project.name).toBe('AtlasMind');
    expect(config.contacts).toHaveLength(1);
    const contact = config.contacts[0];
    expect(contact.piiStored).toBe(true);
    expect(contact.links[0]).toMatchObject({ kind: 'email', handle: 'jane@example.com', deepLink: 'mailto:jane@example.com' });
    expect(config.teamMembers[0]).toMatchObject({ contactId: contact.id, discipline: 'contributor' });
  });

  it('turns CODEOWNERS handles into groups and a code-ownership responsibility', () => {
    const config = seedProjectDirectorConfig({
      projectName: 'AtlasMind',
      codeowners: ['@acme/maintainers', '@acme/reviewers'],
    });

    const group = config.contacts.find(c => c.name === '@acme/maintainers');
    expect(group?.kind).toBe('group');
    expect(group?.piiStored).toBe(false);
    const responsibility = config.responsibilities.find(r => r.id === 'resp-code-ownership');
    expect(responsibility?.area).toBe('Code ownership');
    expect(responsibility?.ownerContactId).toBe(group?.id);
    expect(responsibility?.backupContactId).toBeDefined();
  });

  it('maps the package author to an internal stakeholder and website names to client stakeholders', () => {
    const config = seedProjectDirectorConfig({
      projectName: 'AtlasMind',
      packageAuthor: 'Joel Bondoux <joel@example.net>',
      websiteStakeholders: ['Acme Client'],
    });

    expect(config.stakeholders.some(s => s.category === 'internal' && s.influence === 'high')).toBe(true);
    expect(config.stakeholders.some(s => s.category === 'client')).toBe(true);
  });

  it('produces a valid, empty-but-well-formed config from minimal input', () => {
    const config = seedProjectDirectorConfig({ projectName: '' });
    expect(config.version).toBe(1);
    expect(config.project.name).toBe('Project');
    expect(config.contacts).toEqual([]);
    expect(config.selfContactId).toBeUndefined();
    expect(config.settings).toEqual({ teamMode: 'auto', nudgeOnActivation: true, remindersEnabled: false, outboundEnabled: false });
  });
});

describe('solo-dev accommodation', () => {
  it('seeds a first-class "me" contact and sets selfContactId', () => {
    const config = seedProjectDirectorConfig({
      projectName: 'Solo App',
      self: { name: 'Joel', email: 'joel@example.net' },
    });
    expect(config.selfContactId).toBeDefined();
    const me = config.contacts.find(c => c.id === config.selfContactId);
    expect(me?.name).toBe('Joel');
  });

  it('dedupes the self contact when the same person is the sole git contributor → still solo', () => {
    const config = seedProjectDirectorConfig({
      projectName: 'Solo App',
      self: { name: 'Joel', email: 'joel@example.net' },
      gitContributors: [{ name: 'Joel', email: 'joel@example.net' }],
    });
    expect(config.contacts).toHaveLength(1);
    expect(resolveTeamMode(config)).toBe('solo');
    expect(isSoloProject(config)).toBe(true);
  });

  it('infers team mode when a contributor other than "me" exists', () => {
    const config = seedProjectDirectorConfig({
      projectName: 'App',
      self: { name: 'Joel', email: 'joel@example.net' },
      gitContributors: [{ name: 'Jane', email: 'jane@example.com' }],
    });
    expect(resolveTeamMode(config)).toBe('team');
  });

  it('honours an explicit teamMode over inference', () => {
    const teamish = seedProjectDirectorConfig({
      projectName: 'App',
      gitContributors: [{ name: 'A', email: 'a@x.com' }, { name: 'B', email: 'b@x.com' }],
    });
    teamish.settings.teamMode = 'solo';
    expect(resolveTeamMode(teamish)).toBe('solo');
    const solo = defaultProjectDirectorConfig();
    solo.settings.teamMode = 'team';
    expect(resolveTeamMode(solo)).toBe('team');
    expect(isSoloProject(undefined)).toBe(true);
  });

  it('sanitize preserves a valid selfContactId, clears a dangling one, and whitelists teamMode', () => {
    const kept = sanitizeProjectDirectorConfig({
      version: 1, project: { name: 'P' },
      selfContactId: 'c1',
      contacts: [{ id: 'c1', name: 'Me', kind: 'person', links: [], piiStored: false }],
      stakeholders: [], teamMembers: [], responsibilities: [], assignments: [], followUps: [],
      settings: { teamMode: 'bogus' },
    })!;
    expect(kept.selfContactId).toBe('c1');
    expect(kept.settings.teamMode).toBe('auto');

    const dangling = sanitizeProjectDirectorConfig({
      version: 1, project: { name: 'P' }, selfContactId: 'ghost',
      contacts: [], stakeholders: [], teamMembers: [], responsibilities: [], assignments: [], followUps: [],
      settings: { teamMode: 'solo' },
    })!;
    expect(dangling.selfContactId).toBeUndefined();
    expect(dangling.settings.teamMode).toBe('solo');
  });
});

describe('sanitizeProjectDirectorConfig — webview→disk boundary', () => {
  const base = (): Record<string, unknown> => ({
    version: 1,
    project: { name: 'Proj' },
    contacts: [{ id: 'c1', name: 'Alice', kind: 'person', links: [], piiStored: false }],
    stakeholders: [],
    teamMembers: [],
    responsibilities: [],
    assignments: [],
    followUps: [],
    settings: {},
  });

  it('rejects a non-version-1 or non-object shape', () => {
    expect(sanitizeProjectDirectorConfig(null)).toBeUndefined();
    expect(sanitizeProjectDirectorConfig({})).toBeUndefined();
    expect(sanitizeProjectDirectorConfig({ ...base(), version: 2 })).toBeUndefined();
  });

  it('drops role records that reference a non-existent contact', () => {
    const input = base();
    input.stakeholders = [
      { id: 's1', contactId: 'c1', category: 'client', influence: 'high', interest: 'high' },
      { id: 's2', contactId: 'ghost', category: 'client', influence: 'high', interest: 'high' },
    ];
    input.teamMembers = [{ id: 't1', contactId: 'ghost', discipline: 'x' }];
    input.responsibilities = [{ id: 'r1', area: 'A', ownerContactId: 'ghost' }];
    const out = sanitizeProjectDirectorConfig(input)!;
    expect(out.stakeholders.map(s => s.id)).toEqual(['s1']);
    expect(out.teamMembers).toHaveLength(0);
    expect(out.responsibilities).toHaveLength(0);
  });

  it('clears dangling optional references but keeps the record', () => {
    const input = base();
    input.responsibilities = [{ id: 'r1', area: 'A', ownerContactId: 'c1', backupContactId: 'ghost' }];
    input.assignments = [{
      id: 'a1', title: 'T', kind: 'task', status: 'todo', priority: 'medium',
      assigneeContactId: 'ghost', linkedResponsibilityId: 'ghost', source: 'manual',
      createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    }];
    const out = sanitizeProjectDirectorConfig(input)!;
    expect(out.responsibilities[0].backupContactId).toBeUndefined();
    expect(out.assignments[0].assigneeContactId).toBeUndefined();
    expect(out.assignments[0].linkedResponsibilityId).toBeUndefined();
  });

  it('coerces unknown enum values to a safe fallback instead of dropping the record', () => {
    const input = base();
    input.stakeholders = [{ id: 's1', contactId: 'c1', category: 'wat', influence: 'SUPER', interest: 'x' }];
    input.assignments = [{
      id: 'a1', title: 'T', kind: 'nope', status: '???', priority: 'urgent', source: 'weird',
      createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    }];
    const out = sanitizeProjectDirectorConfig(input)!;
    expect(out.stakeholders[0]).toMatchObject({ category: 'other', influence: 'medium', interest: 'medium' });
    expect(out.assignments[0]).toMatchObject({ kind: 'task', status: 'todo', priority: 'medium', source: 'manual' });
  });

  it('keeps only bounded, declared dashboard work links', () => {
    const input = base();
    input.assignments = [
      {
        id: 'a1', title: 'Own develop', kind: 'task', status: 'in-progress', priority: 'medium', source: 'dashboard',
        linkedWork: { kind: 'branch', id: 'develop' },
        createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
      },
      {
        id: 'a2', title: 'Forged work', kind: 'task', status: 'todo', priority: 'medium', source: 'dashboard',
        linkedWork: { kind: 'terminal-command', id: 'rm -rf .' },
        createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
      },
    ];

    const out = sanitizeProjectDirectorConfig(input)!;
    expect(out.assignments[0]).toMatchObject({
      source: 'dashboard',
      linkedWork: { kind: 'branch', id: 'develop' },
    });
    expect(out.assignments[1].linkedWork).toBeUndefined();
  });

  it('strips deep-links whose scheme is not allowlisted, keeps safe ones', () => {
    const input = base();
    input.contacts = [{
      id: 'c1', name: 'Alice', kind: 'person', piiStored: false, links: [
        { id: 'l1', kind: 'other', label: 'evil', handle: 'x', deepLink: 'javascript:alert(1)' },
        { id: 'l2', kind: 'other', label: 'file', handle: 'x', deepLink: 'file:///etc/passwd' },
        { id: 'l3', kind: 'other', label: 'insecure', handle: 'x', deepLink: 'http://example.com' },
        { id: 'l4', kind: 'email', label: 'Email', handle: 'a@b.com', deepLink: 'mailto:a@b.com' },
        { id: 'l5', kind: 'other', label: 'web', handle: 'x', deepLink: 'https://example.com' },
      ],
    }];
    const links = sanitizeProjectDirectorConfig(input)!.contacts[0].links;
    expect(links.find(l => l.id === 'l1')?.deepLink).toBeUndefined();
    expect(links.find(l => l.id === 'l2')?.deepLink).toBeUndefined();
    expect(links.find(l => l.id === 'l3')?.deepLink).toBeUndefined();
    expect(links.find(l => l.id === 'l4')?.deepLink).toBe('mailto:a@b.com');
    expect(links.find(l => l.id === 'l5')?.deepLink).toBe('https://example.com');
  });

  it('clamps oversized strings and regenerates duplicate ids', () => {
    const input = base();
    const huge = 'x'.repeat(5000);
    input.contacts = [
      { id: 'dup', name: 'Alice', kind: 'person', piiStored: false, links: [], notes: huge },
      { id: 'dup', name: 'Bob', kind: 'person', piiStored: false, links: [] },
    ];
    const out = sanitizeProjectDirectorConfig(input)!;
    expect(new Set(out.contacts.map(c => c.id)).size).toBe(2);
    expect((out.contacts[0].notes ?? '').length).toBeLessThanOrEqual(2000);
  });
});

describe('deriveFollowUpUrgency / countOverdueFollowUps', () => {
  const now = new Date('2026-07-24T12:00:00');

  it('classifies overdue, due-soon, and upcoming by due date', () => {
    expect(deriveFollowUpUrgency(makeFollowUp({ dueDate: '2026-07-20' }), now)).toBe('overdue');
    expect(deriveFollowUpUrgency(makeFollowUp({ dueDate: '2026-07-24' }), now)).toBe('due-soon');
    expect(deriveFollowUpUrgency(makeFollowUp({ dueDate: '2026-07-26' }), now)).toBe('due-soon');
    expect(deriveFollowUpUrgency(makeFollowUp({ dueDate: '2026-08-30' }), now)).toBe('upcoming');
  });

  it('collapses done/cancelled and respects an active snooze', () => {
    expect(deriveFollowUpUrgency(makeFollowUp({ status: 'done', dueDate: '2026-07-20' }), now)).toBe('done');
    expect(deriveFollowUpUrgency(makeFollowUp({ status: 'cancelled', dueDate: '2026-07-20' }), now)).toBe('done');
    expect(deriveFollowUpUrgency(makeFollowUp({ status: 'snoozed', snoozedUntil: '2026-08-01', dueDate: '2026-07-20' }), now)).toBe('snoozed');
    // A snooze that has elapsed re-surfaces and is re-evaluated by its due date.
    expect(deriveFollowUpUrgency(makeFollowUp({ status: 'snoozed', snoozedUntil: '2026-07-21', dueDate: '2026-07-20' }), now)).toBe('overdue');
  });

  it('counts only overdue follow-ups', () => {
    const config = defaultProjectDirectorConfig();
    config.followUps = [
      makeFollowUp({ id: 'a', dueDate: '2026-07-20' }),
      makeFollowUp({ id: 'b', dueDate: '2026-07-19' }),
      makeFollowUp({ id: 'c', dueDate: '2026-08-30' }),
      makeFollowUp({ id: 'd', status: 'done', dueDate: '2026-01-01' }),
    ];
    expect(countOverdueFollowUps(config, now)).toBe(2);
    expect(countOverdueFollowUps(undefined, now)).toBe(0);
  });
});

describe('renderProjectDirectorMarkdown — GDPR-safe mirror', () => {
  it('shows channels by kind/label only and never leaks a raw email into git-tracked prose', () => {
    const config = seedProjectDirectorConfig({
      projectName: 'AtlasMind',
      gitContributors: [{ name: 'Jane Doe', email: 'jane@example.com' }],
    });
    const markdown = renderProjectDirectorMarkdown(config);
    expect(markdown).toContain('# Project Director');
    expect(markdown).toContain('## Team');
    expect(markdown).toContain('Jane Doe');
    expect(markdown).toContain('email (Email)');
    expect(markdown).not.toContain('jane@example.com');
  });

  it('renders all top-level sections even when empty', () => {
    const markdown = renderProjectDirectorMarkdown(defaultProjectDirectorConfig());
    for (const heading of ['## Project', '## Stakeholders', '## Team', '## Responsibilities', '## Assignments', '## Follow-ups']) {
      expect(markdown).toContain(heading);
    }
  });

  it('shows Solo mode and marks "you" for a solo project', () => {
    const config = seedProjectDirectorConfig({ projectName: 'Solo App', self: { name: 'Joel', email: 'joel@example.net' } });
    config.responsibilities = [{ id: 'r1', area: 'Releases', ownerContactId: config.selfContactId! }];
    const markdown = renderProjectDirectorMarkdown(config);
    expect(markdown).toContain('- **Mode:** Solo');
    expect(markdown).toContain('- **You:** Joel');
    expect(markdown).toContain('Joel (you)'); // self is tagged in the responsibilities table
  });
});

describe('configStoresRawPii', () => {
  it('is true only when a contact stores raw PII', () => {
    const clean: ProjectDirectorConfig = defaultProjectDirectorConfig();
    expect(configStoresRawPii(clean)).toBe(false);
    const withPii = seedProjectDirectorConfig({ projectName: 'x', gitContributors: [{ name: 'A', email: 'a@b.com' }] });
    expect(configStoresRawPii(withPii)).toBe(true);
    expect(configStoresRawPii(undefined)).toBe(false);
  });
});
