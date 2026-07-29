import { describe, expect, it } from 'vitest';
import {
  buildProjectState,
  countAttentionItems,
  hasProjectState,
  type ProjectStateInput,
} from '../../src/core/projectStateTree.ts';

const build = (input: ProjectStateInput) => buildProjectState(input);
const section = (input: ProjectStateInput, id: string) =>
  build(input).find(s => s.id === id);
const nodeIds = (input: ProjectStateInput, id: string) =>
  (section(input, id)?.nodes ?? []).map(n => n.id);

describe('a section AtlasMind did not assess is omitted, not shown empty', () => {
  it('produces nothing at all for empty input', () => {
    // "We could not assess this" must never render as "there is nothing here".
    expect(build({})).toEqual([]);
    expect(hasProjectState(build({}))).toBe(false);
  });

  it('omits each section independently', () => {
    const only = build({ workflow: { done: 1, total: 4 } });
    expect(only.map(s => s.id)).toEqual(['position']);
  });

  it('omits the deferred section when nothing is deferred', () => {
    // Unlike "waiting on you", there is no value in saying "nothing is ageing"
    // — it is context rather than a state anybody is checking.
    expect(section({ deferred: {} }, 'deferred')).toBeUndefined();
  });
});

describe('the view can always appear', () => {
  it('produces a section whenever automation could be read at all', () => {
    // The deadlock this guards: the view's `when` clause hid it because it had
    // no sections, and it had no sections because being hidden meant its
    // children were never requested. It could never appear.
    //
    // Automation comes from settings, which are always readable, so a real
    // workspace always yields at least this section — and the view is therefore
    // always reachable.
    const sections = build({
      automation: {
        masterEnabled: false, effective: 'off', limitedBy: 'master', detail: 'off',
        capabilities: [],
      },
    });
    expect(hasProjectState(sections)).toBe(true);
  });

  it('is empty only when genuinely nothing could be assessed', () => {
    expect(hasProjectState(build({}))).toBe(false);
  });
});

describe('what AtlasMind may do', () => {
  const automation = (over: Partial<NonNullable<ProjectStateInput['automation']>> = {}) => ({
    automation: {
      masterEnabled: true,
      effective: 'draft' as const,
      limitedBy: 'ceiling' as const,
      detail: 'Your personal ceiling is draft.',
      capabilities: [
        { label: 'Issue writes', enabled: false },
        { label: 'Pull request writes', enabled: true },
      ],
      ...over,
    },
  });

  it('leads with the effective level and what is binding it', () => {
    const nodes = section(automation(), 'permissions')!.nodes;
    expect(nodes[0]!.label).toBe('Level: draft');
    expect(nodes[0]!.description).toBe('limited by ceiling');
    expect(nodes[0]!.tooltip).toContain('personal ceiling');
  });

  it('says the workflow is off rather than showing a level', () => {
    const nodes = section(automation({ masterEnabled: false }), 'permissions')!.nodes;
    expect(nodes[0]!.label).toBe('Workflow off');
  });

  it('names no binding gate when the project itself set the level', () => {
    const nodes = section(automation({ limitedBy: 'none' }), 'permissions')!.nodes;
    expect(nodes[0]!.description).toBeUndefined();
  });

  it('describes an off capability as safe rather than as a problem', () => {
    // An "off" row is the normal state and should not read as something to fix.
    const off = section(automation(), 'permissions')!.nodes.find(n => n.label === 'Issue writes');
    expect(off!.description).toBe('off');
    expect(off!.tooltip).toContain('will not act');
    expect(off!.needsAttention).toBeFalsy();
  });

  it('reminds that a permitted capability still confirms each write', () => {
    const on = section(automation(), 'permissions')!.nodes.find(n => n.label === 'Pull request writes');
    expect(on!.tooltip).toContain('confirmation');
  });

  it('expands only when something is actually permitted', () => {
    // All-off is the safe default and does not need noticing.
    expect(section(automation(), 'permissions')!.expanded).toBe(true);
    const allOff = automation({ capabilities: [{ label: 'Issue writes', enabled: false }] });
    expect(section(allOff, 'permissions')!.expanded).toBe(false);
    expect(section(automation({ masterEnabled: false }), 'permissions')!.expanded).toBe(false);
  });

  it('never marks a permission row as needing attention', () => {
    // Permissions are a posture, not a task. Counting them would make the badge
    // permanently non-zero.
    for (const node of section(automation(), 'permissions')!.nodes) {
      expect(node.needsAttention, node.id).toBeFalsy();
    }
  });
});

describe('where you are', () => {
  it('shows progress and the next actionable step', () => {
    const nodes = section({
      workflow: { done: 3, total: 12, nextStageName: 'Planning', nextStepTitle: 'Add issue templates' },
    }, 'position')!.nodes;
    expect(nodes[0]!.label).toBe('3 of 12 steps');
    expect(nodes[0]!.description).toBe('25%');
    expect(nodes[1]!.label).toBe('Add issue templates');
    expect(nodes[1]!.description).toBe('Planning');
  });

  it('distinguishes a blocked next step from an actionable one', () => {
    const blocked = section({
      workflow: { done: 1, total: 4, nextStepTitle: 'x', nextIsBlocked: true },
    }, 'position')!.nodes.find(n => n.id === 'position.next');
    expect(blocked!.icon).toBe('debug-pause');
    expect(blocked!.tooltip).toContain('waiting on');

    const actionable = section({
      workflow: { done: 1, total: 4, nextStepTitle: 'x' },
    }, 'position')!.nodes.find(n => n.id === 'position.next');
    expect(actionable!.icon).toBe('arrow-right');
  });

  it('says so when every step is done', () => {
    expect(nodeIds({ workflow: { done: 4, total: 4 } }, 'position')).toContain('position.complete');
  });

  it('omits progress when nothing was counted, rather than showing 0 of 0', () => {
    expect(nodeIds({ workflow: { done: 0, total: 0 } }, 'position')).not.toContain('position.progress');
  });
});

describe('waiting on you', () => {
  it('says plainly when nothing is waiting', () => {
    // Distinct from an absent section: this one was assessed and found nothing.
    const nodes = section({ attention: {} }, 'attention')!.nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.label).toBe('Nothing waiting on you');
    expect(nodes[0]!.needsAttention).toBeFalsy();
  });

  it('surfaces paused runs, overdue follow-ups and blocked stages', () => {
    const input: ProjectStateInput = {
      attention: {
        awaitingCheckpoint: 2,
        overdueFollowUps: 1,
        blockedStages: ['release'],
      },
    };
    const nodes = section(input, 'attention')!.nodes;
    expect(nodes.map(n => n.label)).toEqual([
      '2 runs awaiting approval',
      '1 overdue follow-up',
      'release blocked',
    ]);
    expect(nodes.every(n => n.needsAttention)).toBe(true);
  });

  it('explains that an unanswered checkpoint denies rather than proceeds', () => {
    const node = section({ attention: { awaitingCheckpoint: 1 } }, 'attention')!.nodes[0]!;
    expect(node.tooltip).toContain('denies rather than proceeding');
  });

  it('flags only an unclassified CI failure as needing a person', () => {
    // A classified failure has an owner and a suggested fix. Flagging it too
    // would make the badge permanently non-zero on any project with a red build.
    const unknown = section({
      attention: { unresolvedCiFailure: { jobName: 'quality', classification: 'unknown' } },
    }, 'attention')!.nodes[0]!;
    expect(unknown.needsAttention).toBe(true);
    expect(unknown.tooltip).toContain('will not guess');

    const classified = section({
      attention: { unresolvedCiFailure: { jobName: 'quality', classification: 'test-failure' } },
    }, 'attention')!.nodes[0]!;
    expect(classified.needsAttention).toBe(false);
    expect(classified.tooltip).toContain('by rule rather than by a model');
  });

  it('expands only when something actually needs a person', () => {
    expect(section({ attention: {} }, 'attention')!.expanded).toBe(false);
    expect(section({ attention: { overdueFollowUps: 1 } }, 'attention')!.expanded).toBe(true);
  });

  it('singularises correctly', () => {
    const one = section({ attention: { awaitingCheckpoint: 1, overdueFollowUps: 1 } }, 'attention')!.nodes;
    expect(one[0]!.label).toBe('1 run awaiting approval');
    expect(one[1]!.label).toBe('1 overdue follow-up');
  });
});

describe('deferred and ageing', () => {
  it('omits tech debt entirely while the register does not exist', () => {
    // Showing "0 debt items" would claim a store AtlasMind does not have.
    expect(nodeIds({ deferred: { staleDocuments: 2 } }, 'deferred')).not.toContain('deferred.debt');
    expect(nodeIds({ deferred: { staleDocuments: 2, debtItems: 0 } }, 'deferred')).toContain('deferred.debt');
  });

  it('lists uncovered protocols and says what to do about them', () => {
    const node = section({
      deferred: { uncoveredProtocols: ['bdd', 'mutation', 'e2e', 'visual'] },
    }, 'deferred')!.nodes[0]!;
    expect(node.label).toBe('4 protocols with no evidence');
    expect(node.description).toBe('bdd, mutation, e2e');
    expect(node.tooltip).toContain('stop declaring the protocol');
  });

  it('shows gate progress', () => {
    const node = section({
      deferred: { gates: [{ label: 'MVP', done: 6, total: 14 }] },
    }, 'deferred')!.nodes[0]!;
    expect(node.description).toBe('6/14');
  });

  it('omits a gate with nothing tagged for it', () => {
    expect(section({ deferred: { gates: [{ label: 'MVP', done: 0, total: 0 }] } }, 'deferred'))
      .toBeUndefined();
  });

  it('never expands by default', () => {
    // Context, not a call to action. Opening it every session would train
    // people to collapse the whole view.
    expect(section({ deferred: { staleDocuments: 3 } }, 'deferred')!.expanded).toBe(false);
  });

  it('never marks a deferred row as needing attention', () => {
    const nodes = section({
      deferred: { staleDocuments: 3, uncoveredProtocols: ['bdd'], gates: [{ label: 'MVP', done: 1, total: 2 }] },
    }, 'deferred')!.nodes;
    expect(nodes.every(n => !n.needsAttention)).toBe(true);
  });
});

describe('the badge counts only what needs a person', () => {
  it('counts attention rows and nothing else', () => {
    const sections = build({
      automation: {
        masterEnabled: true, effective: 'auto', limitedBy: 'none', detail: '',
        capabilities: [{ label: 'Issue writes', enabled: true }],
      },
      workflow: { done: 1, total: 9, nextStepTitle: 'x' },
      attention: { awaitingCheckpoint: 1, overdueFollowUps: 2, blockedStages: ['release'] },
      deferred: { staleDocuments: 5 },
    });
    expect(countAttentionItems(sections)).toBe(3);
  });

  it('is zero when nothing needs a person, even with plenty on screen', () => {
    // A badge that counted everything would be permanently non-zero and
    // therefore ignored.
    const sections = build({
      workflow: { done: 2, total: 9, nextStepTitle: 'x' },
      attention: {},
      deferred: { staleDocuments: 5, uncoveredProtocols: ['bdd'] },
    });
    expect(countAttentionItems(sections)).toBe(0);
  });

  it('is zero for an unassessed project rather than misleading', () => {
    expect(countAttentionItems(build({}))).toBe(0);
  });
});

describe('rows only ever open a surface', () => {
  it('never attaches a command that mutates', () => {
    // The same rule the setup guides follow: a glanceable row opens a screen
    // where you decide, it does not decide for you.
    const sections = build({
      automation: {
        masterEnabled: true, effective: 'propose', limitedBy: 'none', detail: '',
        capabilities: [{ label: 'Issue writes', enabled: true }],
      },
      workflow: { done: 1, total: 9, nextStepTitle: 'x' },
      attention: { awaitingCheckpoint: 1, overdueFollowUps: 1, blockedStages: ['ci'] },
      deferred: { staleDocuments: 1, uncoveredProtocols: ['bdd'], gates: [{ label: 'MVP', done: 1, total: 3 }] },
    });
    for (const s of sections) {
      for (const node of s.nodes) {
        if (node.command) {
          // `workbench.action.openSettings` is allowed alongside our own
          // `open*` commands: it filters the settings UI and changes nothing.
          // The automation row needs it because those four gates are plain
          // settings with no panel to open — pointing at the Settings panel
          // instead showed nothing at all.
          const opensOnly = /^atlasmind\.open[A-Z]/.test(node.command.command)
            || node.command.command === 'workbench.action.openSettings';
          expect(opensOnly, `${node.id} → ${node.command.command}`).toBe(true);
        }
      }
    }
  });

  it('gives every section a tooltip explaining what it is for', () => {
    const sections = build({
      automation: { masterEnabled: true, effective: 'observe', limitedBy: 'none', detail: '', capabilities: [] },
      workflow: { done: 0, total: 3 },
      attention: {},
      deferred: { staleDocuments: 1 },
    });
    expect(sections).toHaveLength(4);
    for (const s of sections) {
      expect(s.tooltip.length, s.id).toBeGreaterThan(40);
      expect(s.icon.length, s.id).toBeGreaterThan(0);
    }
  });

  it('gives every node a stable unique id', () => {
    const sections = build({
      attention: { awaitingCheckpoint: 1, blockedStages: ['ci', 'release'] },
      deferred: { gates: [{ label: 'MVP', done: 1, total: 2 }, { label: 'Beta', done: 0, total: 3 }] },
    });
    const ids = sections.flatMap(s => s.nodes.map(n => n.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
