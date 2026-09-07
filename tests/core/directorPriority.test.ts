import { describe, expect, it } from 'vitest';
import {
  DIRECTOR_PRIORITY_RULES,
  DIRECTOR_PRIORITY_VISIBLE_CAP,
  STALLED_AFTER_DAYS,
  buildDirectorPriorities,
  collectSelfWork,
  roadmapDependentsForAssignments,
} from '../../src/core/directorPriority.ts';
import { defaultProjectDirectorConfig } from '../../src/core/projectDirectorManager.ts';
import type { Assignment, FollowUp, ProjectDirectorConfig } from '../../src/types.ts';

const NOW = new Date('2026-09-07T09:00:00.000Z');

function makeConfig(overrides: Partial<ProjectDirectorConfig> = {}): ProjectDirectorConfig {
  const base = defaultProjectDirectorConfig();
  return {
    ...base,
    selfContactId: 'me',
    contacts: [
      { id: 'me', name: 'The User', kind: 'person', links: [], piiStored: false },
      { id: 'alex', name: 'Alex', kind: 'person', links: [], piiStored: false },
    ],
    teamMembers: [
      { id: 'tm-me', contactId: 'me', discipline: 'engineering' },
      { id: 'tm-alex', contactId: 'alex', discipline: 'engineering' },
    ],
    ...overrides,
  } as ProjectDirectorConfig;
}

function makeAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'asg-1',
    title: 'Ship the thing',
    kind: 'task',
    assigneeContactId: 'alex',
    status: 'todo',
    priority: 'medium',
    source: 'manual',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

function makeFollowUp(overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id: 'fu-1',
    title: 'Ping the sponsor',
    dueDate: '2026-09-08',
    cadence: 'once',
    status: 'open',
    linked: { kind: 'none' },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('collectSelfWork — the personal list is scoped by name', () => {
  it('leaves somebody else\'s due follow-up off my list', () => {
    // The bug this pins: the old collector took *every* due follow-up, so the
    // Project State badge ("waiting on you") and the Project Director badge
    // were the same number for the same reason on a solo-director project.
    const config = makeConfig({
      followUps: [
        makeFollowUp({ id: 'fu-mine', ownerContactId: 'me' }),
        makeFollowUp({ id: 'fu-theirs', ownerContactId: 'alex' }),
      ],
    });

    const mine = collectSelfWork(config, NOW);

    expect(mine.followUps.map(followUp => followUp.id)).toEqual(['fu-mine']);
  });

  it('treats an unowned record as mine on a solo project and as nobody\'s on a team', () => {
    // Solo: there is nobody else it could be. Team: putting it on one person's
    // personal list would quietly assign it to them.
    const solo = makeConfig({
      teamMembers: [],
      followUps: [makeFollowUp({ ownerContactId: undefined })],
      assignments: [makeAssignment({ assigneeContactId: undefined })],
    });
    const team = makeConfig({
      followUps: [makeFollowUp({ ownerContactId: undefined })],
      assignments: [makeAssignment({ assigneeContactId: undefined })],
    });

    expect(collectSelfWork(solo, NOW).followUps).toHaveLength(1);
    expect(collectSelfWork(solo, NOW).assignments).toHaveLength(1);
    expect(collectSelfWork(team, NOW).followUps).toHaveLength(0);
    expect(collectSelfWork(team, NOW).assignments).toHaveLength(0);
  });

  it('drops finished and cancelled work', () => {
    const config = makeConfig({
      assignments: [
        makeAssignment({ id: 'asg-open', assigneeContactId: 'me' }),
        makeAssignment({ id: 'asg-done', assigneeContactId: 'me', status: 'done' }),
        makeAssignment({ id: 'asg-cancelled', assigneeContactId: 'me', status: 'cancelled' }),
      ],
    });

    expect(collectSelfWork(config, NOW).assignments.map(a => a.id)).toEqual(['asg-open']);
  });

  it('returns nothing rather than throwing when there is no roster', () => {
    expect(collectSelfWork(undefined, NOW)).toEqual({ followUps: [], assignments: [] });
  });
});

describe('buildDirectorPriorities — ranked by consequence, from a declared table', () => {
  it('puts work other work waits on above work that is merely very late', () => {
    // Rule 3. Sorting by magnitude would let a 90-day-old item outrank the one
    // three other pieces of work cannot start without.
    const config = makeConfig({
      assignments: [
        makeAssignment({ id: 'asg-blocking', title: 'Migration ladder', linkedWork: { kind: 'roadmap', id: 'rm-1' } }),
        makeAssignment({ id: 'asg-late', title: 'Very late thing', due: '2026-06-01' }),
      ],
    });

    const board = buildDirectorPriorities({
      config,
      now: NOW,
      dependents: new Map([['roadmap:rm-1', 3]]),
    });

    expect(board.items.map(item => item.id)).toEqual([
      'blocking-others:asg-blocking',
      'overdue-assignment:asg-late',
    ]);
    expect(board.items[0]).toMatchObject({
      severity: 'blocking',
      waitingCount: 3,
      ownerName: 'Alex',
      mine: false,
    });
    expect(board.items[0].detail).toContain('With Alex');
    expect(board.items[1].ageDays).toBe(98);
  });

  it('grades each record once, at its worst grade', () => {
    // Rule 4: blocked, overdue and stalled all match this one assignment.
    const config = makeConfig({
      assignments: [makeAssignment({
        id: 'asg-everything',
        status: 'blocked',
        due: '2026-08-01',
        updatedAt: '2026-07-01T00:00:00.000Z',
        linkedWork: { kind: 'roadmap', id: 'rm-1' },
      })],
    });

    const board = buildDirectorPriorities({
      config,
      now: NOW,
      dependents: new Map([['roadmap:rm-1', 2]]),
    });

    expect(board.items).toHaveLength(1);
    expect(board.items[0].ruleId).toBe('blocked-and-blocking');
  });

  it('publishes the rule that graded every item', () => {
    // Rule 2. A grade that cannot be read back is a grade nobody can argue with.
    const config = makeConfig({ assignments: [makeAssignment({ status: 'blocked' })] });

    const board = buildDirectorPriorities({ config, now: NOW, dependents: new Map() });

    const declared = DIRECTOR_PRIORITY_RULES.map(rule => rule.rule);
    for (const item of board.items) {
      expect(declared).toContain(item.rule);
    }
  });

  it('reports an absent dependency graph as unassessed rather than as "nothing is blocking"', () => {
    // Rule 5, the one that matters most: a board that says nothing is holding
    // anybody up because it never looked is worse than one that says nothing.
    const config = makeConfig({
      assignments: [makeAssignment({ linkedWork: { kind: 'roadmap', id: 'rm-1' } })],
    });

    const unassessed = buildDirectorPriorities({ config, now: NOW });
    const assessed = buildDirectorPriorities({ config, now: NOW, dependents: new Map() });

    expect(unassessed.dependenciesAssessed).toBe(false);
    expect(unassessed.dependenciesMatter).toBe(true);
    expect(unassessed.summary).toContain('not assessed');
    expect(assessed.dependenciesAssessed).toBe(true);
    expect(assessed.summary).not.toContain('not assessed');
  });

  it('does not caveat a dependency question that could never have had an answer', () => {
    const config = makeConfig({ assignments: [makeAssignment({ linkedWork: undefined })] });

    const board = buildDirectorPriorities({ config, now: NOW });

    expect(board.dependenciesMatter).toBe(false);
    expect(board.summary).not.toContain('not assessed');
  });

  it('flags started work nobody has recorded anything against', () => {
    const config = makeConfig({
      assignments: [makeAssignment({
        id: 'asg-stalled',
        status: 'in-progress',
        updatedAt: '2026-08-01T00:00:00.000Z',
      })],
    });

    const board = buildDirectorPriorities({ config, now: NOW, dependents: new Map() });

    expect(board.items[0]).toMatchObject({ ruleId: 'stalled', severity: 'late', mine: false });
    expect(board.items[0].ageDays).toBeGreaterThanOrEqual(STALLED_AFTER_DAYS);
    expect(board.items[0].detail).toContain('With Alex');
  });

  it('never calls work with no dates stalled', () => {
    // An unknown age is not a long one: "nothing recorded for N days" would be
    // a claim about a measurement nobody took.
    const config = makeConfig({
      assignments: [{
        ...makeAssignment({ id: 'asg-dateless', status: 'in-progress' }),
        createdAt: '',
        updatedAt: '',
      }],
    });

    const board = buildDirectorPriorities({ config, now: NOW, dependents: new Map() });

    expect(board.items.map(item => item.ruleId)).not.toContain('stalled');
  });

  it('counts flags, not the backlog', () => {
    // What the sidebar badge reads. A badge that counted ready-to-pick-up work
    // would be permanently non-zero, which is how a badge stops being read.
    const config = makeConfig({
      assignments: [
        makeAssignment({ id: 'asg-late', due: '2026-08-01' }),
        makeAssignment({ id: 'asg-ready', title: 'Ready to go' }),
        makeAssignment({ id: 'asg-mine-late', assigneeContactId: 'me', due: '2026-08-01' }),
      ],
    });

    const board = buildDirectorPriorities({ config, now: NOW, dependents: new Map() });

    expect(board.totalCount).toBe(3);
    expect(board.flaggedCount).toBe(2);
    expect(board.flaggedElsewhereCount).toBe(1);
    expect(board.summary).toContain('2 late or not moving');
    expect(board.summary).toContain('1 ready to pick up');
  });

  it('caps the list and states the remainder', () => {
    const config = makeConfig({
      assignments: Array.from({ length: DIRECTOR_PRIORITY_VISIBLE_CAP + 3 }, (_unused, index) =>
        makeAssignment({ id: `asg-${index}`, title: `Item ${index}` })),
    });

    const board = buildDirectorPriorities({ config, now: NOW, dependents: new Map() });

    expect(board.items).toHaveLength(DIRECTOR_PRIORITY_VISIBLE_CAP);
    expect(board.totalCount).toBe(DIRECTOR_PRIORITY_VISIBLE_CAP + 3);
    expect(board.droppedByCap).toBe(3);
  });

  it('separates "read it and it is clear" from "nothing has been written down"', () => {
    const empty = buildDirectorPriorities({ config: makeConfig(), now: NOW, dependents: new Map() });
    const clear = buildDirectorPriorities({
      config: makeConfig({ assignments: [makeAssignment({ status: 'done' })] }),
      now: NOW,
      dependents: new Map(),
    });

    expect(empty.emptyState).toBe('unexamined');
    expect(clear.emptyState).toBe('clear');
    expect(buildDirectorPriorities({ now: NOW }).emptyState).toBe('unexamined');
  });

  it('is deterministic — the same board twice, in the same order', () => {
    const config = makeConfig({
      assignments: [
        makeAssignment({ id: 'asg-b', title: 'Beta' }),
        makeAssignment({ id: 'asg-a', title: 'Alpha' }),
      ],
      followUps: [makeFollowUp({ ownerContactId: 'alex' })],
    });

    const first = buildDirectorPriorities({ config, now: NOW, dependents: new Map() });
    const second = buildDirectorPriorities({ config, now: NOW, dependents: new Map() });

    expect(first.items.map(item => item.id)).toEqual(second.items.map(item => item.id));
    expect(first.items.map(item => item.title)).toEqual(['Ping the sponsor', 'Alpha', 'Beta']);
  });

  it('answers a different question from the personal list', () => {
    // The whole point: on a project where the director is also the developer,
    // the two views must not report the same number for the same reason.
    const config = makeConfig({
      assignments: [
        makeAssignment({ id: 'asg-mine', assigneeContactId: 'me' }),
        makeAssignment({ id: 'asg-alex-late', assigneeContactId: 'alex', due: '2026-08-01' }),
      ],
      followUps: [makeFollowUp({ id: 'fu-alex', ownerContactId: 'alex', dueDate: '2026-08-20' })],
    });

    const mine = collectSelfWork(config, NOW);
    const board = buildDirectorPriorities({ config, now: NOW, dependents: new Map() });

    expect(mine.assignments).toHaveLength(1);
    expect(mine.followUps).toHaveLength(0);
    expect(board.flaggedCount).toBe(2);
    expect(board.flaggedElsewhereCount).toBe(2);
  });
});


describe('roadmapDependentsForAssignments — the two sides do not share an id', () => {
  const reading = {
    nodes: [
      { id: 'rm-migration-ladder', normalizedText: 'design the migration ladder' },
      { id: 'rm-port-css', normalizedText: 'port the css' },
      { id: 'rm-done', normalizedText: 'already landed', completedAt: '2026-08-01T00:00:00.000Z' },
    ],
    edges: [
      { from: 'rm-migration-ladder', to: 'rm-port-css', origin: 'declared' },
      { from: 'rm-migration-ladder', to: 'rm-done', origin: 'declared' },
    ],
  };

  it('joins on the item text, because a Director link carries the positional id and the graph carries the durable one', () => {
    // The defect this pins: `linkedWork.id` for a roadmap item is `roadmap-3`,
    // which renumbers on every insert, while the graph is keyed on the durable
    // anchor id. Joining on id alone matches nothing, and the blocking rule
    // would quietly never fire — worse than absent, because the board would
    // still read as having looked.
    const assignments = [makeAssignment({
      id: 'asg-ladder',
      title: 'Design the migration ladder',
      linkedWork: { kind: 'roadmap', id: 'roadmap-3' },
    })];

    const dependents = roadmapDependentsForAssignments(reading, assignments);

    // One waiter, not two: the completed dependent is not still waiting.
    expect(dependents.get('roadmap:roadmap-3')).toBe(1);
  });

  it('ignores a suggested edge', () => {
    // A derived edge is a keyword match nobody accepted. It must never tell
    // somebody their colleague is holding up the release.
    const suggested = {
      nodes: reading.nodes,
      edges: [{ from: 'rm-migration-ladder', to: 'rm-port-css', origin: 'derived' }],
    };
    const assignments = [makeAssignment({
      title: 'Design the migration ladder',
      linkedWork: { kind: 'roadmap', id: 'roadmap-3' },
    })];

    expect(roadmapDependentsForAssignments(suggested, assignments).size).toBe(0);
  });

  it('says nothing about a renamed item rather than adopting whatever took its place', () => {
    const assignments = [makeAssignment({
      title: 'Design the migration ladder (v2)',
      linkedWork: { kind: 'roadmap', id: 'roadmap-3' },
    })];

    expect(roadmapDependentsForAssignments(reading, assignments).size).toBe(0);
  });

  it('feeds the board, which then grades the item as blocking', () => {
    const config = makeConfig({
      assignments: [makeAssignment({
        id: 'asg-ladder',
        title: 'Design the migration ladder',
        linkedWork: { kind: 'roadmap', id: 'roadmap-3' },
      })],
    });

    const board = buildDirectorPriorities({
      config,
      now: NOW,
      dependents: roadmapDependentsForAssignments(reading, config.assignments),
    });

    expect(board.items[0]).toMatchObject({ ruleId: 'blocking-others', waitingCount: 1 });
  });
});
