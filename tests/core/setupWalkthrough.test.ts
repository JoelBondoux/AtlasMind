import { describe, expect, it } from 'vitest';
import {
  findNonOpeningActions,
  isOpeningAction,
  isSetupComplete,
  nextSetupStep,
  renderSetupIndexMarkdown,
  renderSetupStepMarkdown,
  setupStepPosition,
  summarizeSetupProgress,
  type SetupStep,
} from '../../src/core/setupWalkthrough.ts';
import { buildBuzzSetupPlan } from '../../src/core/buzzSetupPlan.ts';
import { buildAcpSetupPlan } from '../../src/core/acpSetupPlan.ts';
import { SETUP_GUIDES, buildSetupIndex } from '../../src/core/setupGuideRegistry.ts';

const step = (over: Partial<SetupStep> & Pick<SetupStep, 'id' | 'status'>): SetupStep => ({
  title: over.id,
  detail: '',
  ...over,
});

const IDS = ['a', 'b', 'c'] as const;

describe('nextSetupStep', () => {
  it('picks the first actionable step, preferring todo over blocked', () => {
    const steps = [step({ id: 'a', status: 'done' }), step({ id: 'b', status: 'blocked' }), step({ id: 'c', status: 'todo' })];
    expect(nextSetupStep(steps, IDS)?.id).toBe('c');
  });

  it('falls back to a blocked step when nothing is actionable', () => {
    const steps = [step({ id: 'a', status: 'done' }), step({ id: 'b', status: 'blocked' })];
    expect(nextSetupStep(steps, IDS)?.id).toBe('b');
  });

  it('never nominates a step outside the walkthrough', () => {
    // The Buzz MCP bridge is blocked until the CLI is installed, and the CLI is
    // optional — nominating it would send someone to install a binary they do
    // not need. This is the general form of that rule.
    const steps = [step({ id: 'a', status: 'done' }), step({ id: 'extra', status: 'todo' })];
    expect(nextSetupStep(steps, IDS)).toBeUndefined();
  });

  it('returns nothing when the walkthrough is finished', () => {
    expect(nextSetupStep([step({ id: 'a', status: 'done' })], ['a'])).toBeUndefined();
  });

  it('ignores optional steps', () => {
    expect(nextSetupStep([step({ id: 'a', status: 'optional' })], ['a'])).toBeUndefined();
  });
});

describe('isSetupComplete / summarizeSetupProgress', () => {
  it('reports complete only when every required step is done', () => {
    expect(isSetupComplete([step({ id: 'a', status: 'done' }), step({ id: 'b', status: 'todo' })], ['a', 'b'])).toBe(false);
    expect(isSetupComplete([step({ id: 'a', status: 'done' }), step({ id: 'b', status: 'done' })], ['a', 'b'])).toBe(true);
  });

  it('does not count an optional step as an outstanding gap', () => {
    expect(isSetupComplete([step({ id: 'a', status: 'done' }), step({ id: 'opt', status: 'optional' })], ['a'])).toBe(true);
  });

  it('counts progress over walkthrough steps only', () => {
    const steps = [step({ id: 'a', status: 'done' }), step({ id: 'b', status: 'todo' }), step({ id: 'extra', status: 'done' })];
    expect(summarizeSetupProgress(steps, IDS)).toEqual({ done: 1, total: 2, finished: false });
  });

  it('reports an empty guide as unfinished rather than done', () => {
    // "0 of 0 complete" must not read as success — a guide whose state could
    // not be gathered has not been finished, it has not been started.
    expect(summarizeSetupProgress([], IDS).finished).toBe(false);
  });
});

describe('setupStepPosition', () => {
  it('numbers steps within the walkthrough and marks the current one', () => {
    const steps = [step({ id: 'a', status: 'done', title: 'First' }), step({ id: 'b', status: 'todo', title: 'Second' })];
    const position = setupStepPosition(steps, ['a', 'b'], 'b');
    expect(position).toMatchObject({ index: 2, total: 2 });
    expect(position.trail).toContain('✅ 1. First');
    expect(position.trail).toContain('▶ 2. Second');
  });

  it('excludes steps outside the walkthrough so the finish line cannot move', () => {
    const steps = [step({ id: 'a', status: 'todo' }), step({ id: 'extra', status: 'todo' })];
    expect(setupStepPosition(steps, ['a'], 'a').total).toBe(1);
  });
});

describe('renderSetupStepMarkdown', () => {
  const target = step({ id: 'b', status: 'todo', title: 'Install it', detail: 'Not installed yet.' });

  it('leads with progress rather than "step 3 of 5"', () => {
    const md = renderSetupStepMarkdown('ACP', target, { index: 3, total: 5 });
    expect(md).toContain('ACP setup — 2 of 5 done. Next: Install it');
  });

  it('says "step 1 of N" only when nothing is done', () => {
    const md = renderSetupStepMarkdown('ACP', target, { index: 1, total: 5 });
    expect(md).toContain('ACP setup — step 1 of 5: Install it');
  });

  it('writes commands out in a runnable block', () => {
    const md = renderSetupStepMarkdown('ACP', {
      ...target,
      guidance: [{ text: 'Install it with:', command: 'npm i -g thing' }],
    }, { index: 1, total: 2 });
    expect(md).toContain('```bash\nnpm i -g thing\n```');
  });

  it('labels the guide, so two guides never look like one', () => {
    expect(renderSetupStepMarkdown('Buzz', target, { index: 1, total: 2 })).toContain('Buzz setup —');
    expect(renderSetupStepMarkdown('ACP', target, { index: 1, total: 2 })).toContain('ACP setup —');
  });
});

describe('isOpeningAction — a plan is never an installer', () => {
  it('allows actions that open a surface', () => {
    for (const command of [
      'atlasmind.openSettings',
      'atlasmind.openModelProviderPanel',
      'atlasmind.openChatPanel',
      'atlasmind.showWalkthrough',
      'atlasmind.buzz.prepareCommand',
      'atlasmind.setup.prepareCommand',
      // Opens an input box the user types into — dismissing it stores nothing.
      'atlasmind.setBuzzAgentKey',
      'workbench.action.openSettings',
      'vscode.open',
    ]) {
      expect(isOpeningAction(command), command).toBe(true);
    }
  });

  it('admits a prompt but still refuses the switch-flippers beside it', () => {
    // The distinction the allowlist exists to hold: `setBuzzAgentKey` asks the
    // user for a value; `setBuzzEnabled` would decide one for them.
    expect(isOpeningAction('atlasmind.setBuzzAgentKey')).toBe(true);
    expect(isOpeningAction('atlasmind.setBuzzEnabled')).toBe(false);
    expect(isOpeningAction('atlasmind.setBuzzInboundEnabled')).toBe(false);
  });

  it('refuses anything that would change state on the user\'s behalf', () => {
    // A setup assistant that flipped the deny-by-default switches to be helpful
    // would remove the property those switches exist to provide.
    for (const command of [
      'atlasmind.buzz.enable',
      'atlasmind.setBuzzEnabled',
      'atlasmind.installAgent',
      'atlasmind.acp.enableProvider',
      'workbench.action.terminal.sendSequence',
      '',
    ]) {
      expect(isOpeningAction(command), command).toBe(false);
    }
    expect(isOpeningAction(undefined as unknown as string)).toBe(false);
  });

  it('reports offenders instead of throwing', () => {
    const steps = [
      step({ id: 'a', status: 'todo', action: { command: 'atlasmind.openSettings', title: 'ok' } }),
      step({ id: 'b', status: 'todo', action: { command: 'atlasmind.buzz.enable', title: 'bad' } }),
    ];
    expect(findNonOpeningActions(steps)).toEqual(['atlasmind.buzz.enable']);
  });
});

describe('every shipped guide obeys the opening-action rule', () => {
  it('the Buzz plan offers only opening actions', () => {
    const steps = buildBuzzSetupPlan({
      cliOnPath: false,
      hasAgentKey: false,
      relayUrl: '',
      allowRemoteRelay: false,
      enabled: false,
      inboundEnabled: false,
      channelIds: [],
      autoCreateFollowUps: false,
      mcpServerRegistered: false,
      observedIdentities: 0,
      agentBindings: 0,
    });
    expect(findNonOpeningActions(steps)).toEqual([]);
  });

  it('the ACP plan offers only opening actions, in every state', () => {
    const states = [
      { configuredAgents: [], clientProtocolVersion: 1, providerEnabled: false, hasCompletedATurn: false },
      { configuredAgents: [{ id: 'claude', command: 'claude-agent-acp' }], installed: true, authenticated: true, clientProtocolVersion: 1, providerEnabled: true, hasCompletedATurn: true },
    ];
    for (const state of states) {
      expect(findNonOpeningActions(buildAcpSetupPlan(state))).toEqual([]);
    }
  });
});

describe('renderSetupIndexMarkdown', () => {
  it('shows every guide with its progress and next step', () => {
    const md = renderSetupIndexMarkdown([
      { guide: SETUP_GUIDES[0]!, progress: { done: 2, total: 5, finished: false }, nextTitle: 'Install the agent' },
      { guide: SETUP_GUIDES[1]!, progress: { done: 6, total: 6, finished: true } },
    ]);
    expect(md).toContain('2/5 — next: Install the agent');
    expect(md).toContain('6/6 — done');
    expect(md).toContain('/acp');
    expect(md).toContain('/buzz');
  });

  it('says so plainly when there is nothing to show', () => {
    expect(renderSetupIndexMarkdown([])).toContain('No setup guides are available.');
  });

  it('states that nothing is changed for you', () => {
    const md = renderSetupIndexMarkdown([{ guide: SETUP_GUIDES[0]!, progress: { done: 0, total: 5, finished: false } }]);
    expect(md).toMatch(/does not change a setting for you|none of them changes a setting/i);
  });
});

describe('buildSetupIndex', () => {
  it('includes a guide whose state could not be gathered, as not started', () => {
    // Omitting it would read as "this feature does not exist", which is a worse
    // answer than "nothing set up yet".
    const index = buildSetupIndex([]);
    expect(index).toHaveLength(SETUP_GUIDES.length);
    expect(index.every(entry => entry.progress.done === 0)).toBe(true);
    expect(index.every(entry => entry.progress.finished === false)).toBe(true);
  });

  it('computes progress from the guide\'s own steps', () => {
    const steps = buildAcpSetupPlan({
      configuredAgents: [{ id: 'claude', command: 'claude-agent-acp' }],
      installed: true,
      authenticated: true,
      clientProtocolVersion: 1,
      providerEnabled: false,
      hasCompletedATurn: false,
    });
    const entry = buildSetupIndex([{ guideId: 'acp', steps }]).find(item => item.guide.id === 'acp')!;
    expect(entry.progress).toMatchObject({ done: 3, total: 5, finished: false });
    expect(entry.nextTitle).toBe('Enable the ACP provider');
  });
});
