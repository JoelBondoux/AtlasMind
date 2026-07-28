import { describe, expect, it } from 'vitest';
import {
  ACP_AGENT_SUGGESTIONS,
  ACP_SETUP_GUIDE,
  buildAcpSetupPlan,
  isAcpProviderReady,
  type AcpSetupState,
} from '../../src/core/acpSetupPlan.ts';
import { nextSetupStep, summarizeSetupProgress } from '../../src/core/setupWalkthrough.ts';

const state = (over: Partial<AcpSetupState> = {}): AcpSetupState => ({
  configuredAgents: [],
  clientProtocolVersion: 1,
  providerEnabled: false,
  hasCompletedATurn: false,
  ...over,
});

const AGENT = { id: 'claude', command: 'claude-agent-acp' };
const statusOf = (steps: ReturnType<typeof buildAcpSetupPlan>, id: string) => steps.find(step => step.id === id)?.status;

describe('buildAcpSetupPlan — ordering follows how things actually fail', () => {
  it('starts by asking for an agent, with everything after it blocked', () => {
    const steps = buildAcpSetupPlan(state());
    expect(statusOf(steps, 'agent')).toBe('todo');
    expect(statusOf(steps, 'installed')).toBe('blocked');
    expect(statusOf(steps, 'authenticated')).toBe('blocked');
    expect(statusOf(steps, 'provider')).toBe('blocked');
    expect(statusOf(steps, 'firstTurn')).toBe('blocked');
    expect(nextSetupStep(steps, ACP_SETUP_GUIDE.stepIds)?.id).toBe('agent');
  });

  it('asks for installation once an agent is named', () => {
    const steps = buildAcpSetupPlan(state({ configuredAgents: [AGENT], installed: false }));
    expect(statusOf(steps, 'agent')).toBe('done');
    expect(nextSetupStep(steps, ACP_SETUP_GUIDE.stepIds)?.id).toBe('installed');
  });

  it('asks for a sign-in once the binary is there', () => {
    const steps = buildAcpSetupPlan(state({ configuredAgents: [AGENT], installed: true, authenticated: false }));
    expect(statusOf(steps, 'installed')).toBe('done');
    expect(nextSetupStep(steps, ACP_SETUP_GUIDE.stepIds)?.id).toBe('authenticated');
  });

  it('asks to enable the provider once the agent is usable', () => {
    const steps = buildAcpSetupPlan(state({ configuredAgents: [AGENT], installed: true, authenticated: true }));
    expect(statusOf(steps, 'authenticated')).toBe('done');
    expect(nextSetupStep(steps, ACP_SETUP_GUIDE.stepIds)?.id).toBe('provider');
  });

  it('finally asks for proof that a completion comes back', () => {
    const steps = buildAcpSetupPlan(state({
      configuredAgents: [AGENT], installed: true, authenticated: true, providerEnabled: true,
    }));
    expect(isAcpProviderReady(steps)).toBe(true);
    // Configured and working are different things, and the settings screen
    // cannot tell them apart — so the walkthrough does not stop at "enabled".
    expect(nextSetupStep(steps, ACP_SETUP_GUIDE.stepIds)?.id).toBe('firstTurn');
  });

  it('is finished only once something has actually answered', () => {
    const steps = buildAcpSetupPlan(state({
      configuredAgents: [AGENT], installed: true, authenticated: true, providerEnabled: true, hasCompletedATurn: true,
    }));
    expect(nextSetupStep(steps, ACP_SETUP_GUIDE.stepIds)).toBeUndefined();
    expect(summarizeSetupProgress(steps, ACP_SETUP_GUIDE.stepIds)).toMatchObject({ done: 5, total: 5, finished: true });
  });
});

describe('buildAcpSetupPlan — what it says', () => {
  it('names both published launch commands, and no unpublished one', () => {
    const steps = buildAcpSetupPlan(state());
    const text = JSON.stringify(steps.find(step => step.id === 'agent'));
    expect(text).toContain('claude-agent-acp');
    expect(text).toContain('codex-acp');
    // Gemini implements ACP but publishes no invocation; there is nothing
    // truthful to tell someone to type.
    expect(text.toLowerCase()).not.toContain('gemini');
  });

  it('quotes install commands as somebody else\'s text, never as an AtlasMind button', () => {
    const steps = buildAcpSetupPlan(state());
    const guidance = steps.find(step => step.id === 'agent')?.guidance ?? [];
    const commands = guidance.filter(line => line.command);
    expect(commands.length).toBeGreaterThan(0);
    // `authored: false` is what keeps these out of the one-click terminal path.
    expect(commands.every(line => line.authored !== true)).toBe(true);
  });

  it('reports a protocol mismatch as its own problem, not as "not signed in"', () => {
    const steps = buildAcpSetupPlan(state({
      configuredAgents: [AGENT], installed: true, authenticated: true, protocolVersion: 99,
    }));
    expect(statusOf(steps, 'authenticated')).toBe('todo');
    expect(steps.find(step => step.id === 'authenticated')?.detail).toContain('version 99');
    // A mismatched agent cannot be used, so the provider step stays blocked.
    expect(statusOf(steps, 'provider')).toBe('blocked');
  });

  it('carries the probe\'s own message through rather than paraphrasing it', () => {
    const steps = buildAcpSetupPlan(state({
      configuredAgents: [AGENT], installed: false, probeMessage: 'spawn claude-agent-acp ENOENT',
    }));
    expect(steps.find(step => step.id === 'installed')?.detail).toContain('ENOENT');
  });

  it('says the provider ships disabled on purpose', () => {
    const steps = buildAcpSetupPlan(state({ configuredAgents: [AGENT], installed: true, authenticated: true }));
    expect(steps.find(step => step.id === 'provider')?.detail).toMatch(/disabled deliberately|off, so the router will not route/i);
  });

  it('names the two things that usually go wrong when nothing comes back', () => {
    const steps = buildAcpSetupPlan(state({
      configuredAgents: [AGENT], installed: true, authenticated: true, providerEnabled: true,
    }));
    const guidance = JSON.stringify(steps.find(step => step.id === 'firstTurn')?.guidance);
    expect(guidance).toMatch(/subscription/i);
    expect(guidance).toMatch(/exits immediately/i);
  });

  it('lists every configured agent so a second one is visible', () => {
    const steps = buildAcpSetupPlan(state({
      configuredAgents: [AGENT, { id: 'codex', command: 'codex-acp' }],
    }));
    const detail = steps.find(step => step.id === 'agent')?.detail ?? '';
    expect(detail).toContain('claude-agent-acp');
    expect(detail).toContain('codex-acp');
    expect(detail).toContain('2 agents');
  });
});

describe('isAcpProviderReady', () => {
  it('ignores the proof step — a provider can be wired and never used', () => {
    const steps = buildAcpSetupPlan(state({
      configuredAgents: [AGENT], installed: true, authenticated: true, providerEnabled: true, hasCompletedATurn: false,
    }));
    expect(isAcpProviderReady(steps)).toBe(true);
    expect(statusOf(steps, 'firstTurn')).toBe('todo');
  });

  it('is false while anything required is outstanding', () => {
    expect(isAcpProviderReady(buildAcpSetupPlan(state({ configuredAgents: [AGENT], installed: true })))).toBe(false);
  });
});

describe('ACP_AGENT_SUGGESTIONS', () => {
  it('pairs each published command with a real install command', () => {
    expect(ACP_AGENT_SUGGESTIONS.map(agent => agent.command)).toEqual(['claude-agent-acp', 'codex-acp']);
    expect(ACP_AGENT_SUGGESTIONS.every(agent => agent.install.trim().length > 0)).toBe(true);
  });
});
