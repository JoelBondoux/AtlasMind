import { describe, expect, it } from 'vitest';
import {
  ACP_SETUP_GUIDE,
  acpLaunchLine,
  buildAcpSetupPlan,
  isAcpProviderReady,
  type AcpAgentSuggestion,
  type AcpSetupState,
} from '../../src/core/acpSetupPlan.ts';
import { nextSetupStep, summarizeSetupProgress } from '../../src/core/setupWalkthrough.ts';
import { ACP_SIGN_IN_COMMANDS, VERIFIED_ACP_AGENTS, acpInstallCommand, acpSignInFor } from '../../src/providers/acp.ts';

/**
 * The suggestions the caller injects, built the way `collectAcpSetupSteps` does.
 *
 * Deliberately derived from `VERIFIED_ACP_AGENTS` here too: a test that typed
 * its own install strings could pass while the guide recommended a package that
 * installs a differently-named binary — which is exactly what shipped.
 */
const SUGGESTIONS: AcpAgentSuggestion[] = VERIFIED_ACP_AGENTS.map(agent => ({
  id: agent.id,
  label: agent.label.replace(/\s*\(.*\)$/, ''),
  command: agent.command,
  args: agent.args,
  install: acpInstallCommand(agent.npmPackage),
  ...(agent.eligibility ? { eligibility: agent.eligibility } : {}),
}));

const state = (over: Partial<AcpSetupState> = {}): AcpSetupState => ({
  configuredAgents: [],
  platform: 'linux',
  consoleModeChosen: false,
  hideConsoleWindows: false,
  clientProtocolVersion: 1,
  providerEnabled: false,
  hasCompletedATurn: false,
  suggestions: SUGGESTIONS,
  ...over,
});

const AGENT = { id: 'claude', command: 'claude-agent-acp' };
const statusOf = (steps: ReturnType<typeof buildAcpSetupPlan>, id: string) => steps.find(step => step.id === id)?.status;

describe('buildAcpSetupPlan — ordering follows how things actually fail', () => {
  it('starts by asking for an agent, with everything after it blocked', () => {
    const steps = buildAcpSetupPlan(state());
    expect(statusOf(steps, 'agent')).toBe('todo');
    expect(statusOf(steps, 'console')).toBe('blocked');
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

  it('asks the Windows launch question before it probes installation', () => {
    const steps = buildAcpSetupPlan(state({
      platform: 'win32',
      configuredAgents: [AGENT],
    }));
    expect(statusOf(steps, 'console')).toBe('todo');
    expect(statusOf(steps, 'installed')).toBe('blocked');
    expect(nextSetupStep(steps, ACP_SETUP_GUIDE.stepIds)?.id).toBe('console');
    expect(JSON.stringify(steps.find(step => step.id === 'console'))).toMatch(/EDR|hidden desktops/i);
  });

  it('records both Windows choices as explicit and describes the consequence', () => {
    const visible = buildAcpSetupPlan(state({
      platform: 'win32',
      configuredAgents: [AGENT],
      consoleModeChosen: true,
      hideConsoleWindows: false,
    }));
    expect(statusOf(visible, 'console')).toBe('done');
    expect(visible.find(step => step.id === 'console')?.detail).toMatch(/ordinary|briefly show/i);

    const hidden = buildAcpSetupPlan(state({
      platform: 'win32',
      configuredAgents: [AGENT],
      consoleModeChosen: true,
      hideConsoleWindows: true,
    }));
    expect(hidden.find(step => step.id === 'console')?.detail).toMatch(/private Windows desktop/i);
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
    expect(summarizeSetupProgress(steps, ACP_SETUP_GUIDE.stepIds)).toMatchObject({ done: 6, total: 6, finished: true });
  });
});

describe('buildAcpSetupPlan — what it says', () => {
  it('names every published launch command, with its own install', () => {
    const steps = buildAcpSetupPlan(state());
    const text = JSON.stringify(steps.find(step => step.id === 'agent'));
    for (const agent of SUGGESTIONS) {
      expect(text, agent.id).toContain(agent.command);
      expect(text, agent.id).toContain(agent.install);
    }
  });

  it('names no agent it cannot tell the user how to launch', () => {
    // The rule that kept Gemini out until its invocation was published: an agent
    // may only be suggested if there is something truthful to type. It is now
    // here because the ACP registry declares `gemini --acp`.
    const text = JSON.stringify(buildAcpSetupPlan(state({ suggestions: [] })));
    for (const agent of SUGGESTIONS) {
      expect(text).not.toContain(agent.install);
    }
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

describe('the suggestions the guide shows', () => {
  it('pairs each published command with a real install command', () => {
    expect(SUGGESTIONS.map(agent => agent.command))
      .toEqual(['claude-agent-acp', 'codex-acp', 'gemini', 'copilot', 'qwen']);
    expect(SUGGESTIONS.every(agent => agent.install.trim().length > 0)).toBe(true);
  });

  it('never recommends the renamed package or the crate that never existed', () => {
    const installs = SUGGESTIONS.map(agent => agent.install).join('\n');
    // The guide used to say `npm install -g @zed-industries/claude-code-acp`
    // while telling the user to configure `claude-agent-acp` — a package whose
    // bin is `claude-code-acp`. Following the guide could not work.
    expect(installs).not.toContain('@zed-industries/claude-code-acp');
    expect(installs).not.toContain('cargo install');
  });

  it('shows the ACP-mode flag as part of the command to type', () => {
    // `gemini` alone opens an interactive REPL. Telling somebody to configure
    // the bare command would send them to a prompt that never answers.
    expect(acpLaunchLine({ command: 'gemini', args: ['--acp'] })).toBe('gemini --acp');
    expect(acpLaunchLine({ command: 'claude-agent-acp', args: [] })).toBe('claude-agent-acp');

    const guidance = buildAcpSetupPlan(state()).find(step => step.id === 'agent')?.guidance ?? [];
    expect(guidance.map(entry => entry.text).join('\n')).toContain('gemini --acp');
  });

  it('states Gemini account eligibility before suggesting its install', () => {
    const guidance = buildAcpSetupPlan(state()).find(step => step.id === 'agent')?.guidance ?? [];
    const gemini = guidance.find(entry => entry.command === 'npm install -g @google/gemini-cli');
    expect(gemini?.text).toContain('Gemini Code Assist Standard or Enterprise');
    expect(gemini?.text).toContain('Google AI Pro and Ultra');
  });
});

describe('the sign-in step names a command that can actually sign you in', () => {
  const SIGN_IN = { command: 'gemini', then: 'Choose Sign in with Google.', docs: 'https://example.invalid/auth' };

  const notSignedIn = (over: Partial<AcpSetupState> = {}) => buildAcpSetupPlan(state({
    configuredAgents: [{ id: 'gemini', command: 'gemini' }],
    installed: true,
    authenticated: false,
    ...over,
  }));

  it('offers the verified command as an authored one, and a terminal to type it into', () => {
    const step = notSignedIn({ signIn: SIGN_IN }).find(entry => entry.id === 'authenticated');
    const authored = (step?.guidance ?? []).filter(line => line.authored);
    expect(authored.map(line => line.command)).toEqual(['gemini']);
    expect(step?.action).toEqual({
      command: 'atlasmind.setup.prepareCommand',
      title: 'Open a terminal with the command',
      args: ['gemini'],
    });
  });

  it('never offers the ACP launch line, which is the command that cannot log in', () => {
    // `gemini --acp` starts a JSON-RPC server. Sending somebody there to sign in
    // is the bug this step exists to fix, so it is asserted rather than assumed.
    const step = notSignedIn({ signIn: SIGN_IN }).find(entry => entry.id === 'authenticated');
    for (const line of step?.guidance ?? []) {
      expect(line.command ?? '').not.toContain('--acp');
    }
    expect(step?.action?.args).not.toContain('gemini --acp');
  });

  it('says so rather than guessing when the agent has no documented flow', () => {
    const step = buildAcpSetupPlan(state({
      configuredAgents: [{ id: 'mine', command: 'my-agent' }],
      installed: true,
      authenticated: false,
    })).find(entry => entry.id === 'authenticated');
    // No action, because there is no command worth typing for somebody.
    expect(step?.action).toBeUndefined();
    expect((step?.guidance ?? []).some(line => line.authored)).toBe(false);
    expect(JSON.stringify(step?.guidance)).toMatch(/will not guess/i);
  });

  it('stops offering the terminal once signing in is not the next thing to do', () => {
    const signedIn = notSignedIn({ signIn: SIGN_IN, authenticated: true });
    expect(signedIn.find(entry => entry.id === 'authenticated')?.action).toBeUndefined();

    // A protocol mismatch is not fixed by logging in again.
    const mismatched = notSignedIn({ signIn: SIGN_IN, protocolVersion: 99 });
    expect(mismatched.find(entry => entry.id === 'authenticated')?.action).toBeUndefined();
  });
});

describe('acpSignInFor — read from each vendor, never derived from the launch command', () => {
  it('covers every agent AtlasMind offers to install', () => {
    for (const agent of VERIFIED_ACP_AGENTS) {
      expect(acpSignInFor(agent.command), `${agent.command} has no recorded sign-in`).toBeDefined();
    }
  });

  it('never returns the launch line, and never a bare guess at one', () => {
    for (const agent of VERIFIED_ACP_AGENTS) {
      const signIn = acpSignInFor(agent.command)!;
      expect(signIn.command).not.toContain('--acp');
      expect(signIn.command).not.toBe(acpLaunchLine(agent));
      expect(signIn.docs.startsWith('https://')).toBe(true);
    }
    // The one that is not the probed binary at all: claude-agent-acp drives the
    // Claude CLI, so the credential lives with a different command.
    expect(acpSignInFor('claude-agent-acp')?.command).toBe('claude');
  });

  it('answers undefined for an agent nobody has read the docs for', () => {
    expect(acpSignInFor('my-agent')).toBeUndefined();
    expect(acpSignInFor('')).toBeUndefined();
  });

  it('allowlists exactly the commands it would ask a terminal to type', () => {
    for (const agent of VERIFIED_ACP_AGENTS) {
      expect(ACP_SIGN_IN_COMMANDS).toContain(acpSignInFor(agent.command)!.command);
    }
    expect(ACP_SIGN_IN_COMMANDS.every(command => !/[;&|><$`\n]/.test(command))).toBe(true);
  });
});
