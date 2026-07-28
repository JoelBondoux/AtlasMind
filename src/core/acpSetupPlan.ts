/**
 * ACP setup plan — the `/acp` walkthrough.
 *
 * Same discipline as the Buzz guide, and for the same reasons: the state is
 * **derived** from what is actually configured rather than asked for, the steps
 * are shown one at a time with the command written out, and **nothing here
 * installs or enables anything**. Every action opens a surface; the decisions
 * stay the user's.
 *
 * The step order follows the order things actually fail in:
 *
 *   1. Name an agent — nothing else can be checked until there is a command.
 *   2. Have it installed — a command that is not on PATH fails at spawn.
 *   3. Be signed in — the agent's own login, never AtlasMind's.
 *   4. Enable the provider — otherwise the router will not select it.
 *   5. **Prove one completion comes back.** Configured is not the same as
 *      working, and the difference is invisible from the settings screen — the
 *      same reason the Buzz walkthrough refuses to stop at "subscribed".
 *
 * Steps 1–4 are what `isAcpProviderReady` means. Step 5 is in the walkthrough
 * but not in that predicate, because a provider can be correctly configured and
 * still never have answered anything, and reporting that as a *fault* would be
 * wrong while reporting it as *finished* would be worse.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type { SetupGuideSummary, SetupStep } from './setupWalkthrough.js';

/** Everything the plan needs, gathered by the caller. */
export interface AcpSetupState {
  /** Agents configured in `atlasmind.acp.agents`. */
  configuredAgents: Array<{ id: string; command: string; label?: string }>;
  /** Did a probe find the first agent's binary? Undefined when never probed. */
  installed?: boolean;
  /** Did the agent report itself authenticated? Undefined when never probed. */
  authenticated?: boolean;
  /** The protocol version the agent negotiated, when it got that far. */
  protocolVersion?: number;
  /** The version AtlasMind speaks, for the mismatch message. */
  clientProtocolVersion: number;
  /** Whatever the probe said, when it failed. */
  probeMessage?: string;
  /** Is the `acp` provider enabled in the router? */
  providerEnabled: boolean;
  /** Has an ACP model actually returned a completion in this workspace? */
  hasCompletedATurn: boolean;
}

export const ACP_DOCS_URL = 'https://agentclientprotocol.com/get-started/introduction';
export const ACP_AGENTS_URL = 'https://agentclientprotocol.com/get-started/agents';

/**
 * Install commands for the two agents whose ACP launch command is published.
 *
 * Quoted as suggestions the user runs, never executed, and deliberately short of
 * a third entry: Gemini CLI implements ACP but publishes no invocation, so there
 * is nothing here to tell someone to type.
 */
export const ACP_AGENT_SUGGESTIONS: ReadonlyArray<{ id: string; label: string; command: string; install: string }> = [
  { id: 'claude', label: 'Claude Agent', command: 'claude-agent-acp', install: 'npm install -g @zed-industries/claude-code-acp' },
  { id: 'codex', label: 'Codex CLI', command: 'codex-acp', install: 'cargo install codex-acp' },
];

export const ACP_SETUP_GUIDE: SetupGuideSummary = {
  id: 'acp',
  label: 'ACP agents',
  blurb: 'Use a Claude or ChatGPT subscription as routable capacity, over the Agent Client Protocol.',
  command: '/acp',
  stepIds: ['agent', 'installed', 'authenticated', 'provider', 'firstTurn'],
};

/** Steps that must be done for the router to be able to use an ACP agent. */
export const REQUIRED_ACP_STEP_IDS = ['agent', 'installed', 'authenticated', 'provider'] as const;

export function buildAcpSetupPlan(state: AcpSetupState): SetupStep[] {
  const steps: SetupStep[] = [];
  const first = state.configuredAgents[0];
  const hasAgent = Boolean(first);

  // 1 — name an agent
  steps.push({
    id: 'agent',
    title: 'Name an ACP agent',
    status: hasAgent ? 'done' : 'todo',
    detail: hasAgent
      ? `${state.configuredAgents.length} agent${state.configuredAgents.length === 1 ? '' : 's'} configured: ${state.configuredAgents.map(agent => `\`${agent.command}\``).join(', ')}.`
      : 'AtlasMind does not know which agent to run. Nothing is installed for you — you name a command, and it spawns only that.',
    guidance: hasAgent ? undefined : [
      {
        text: 'Pick an agent you already have a subscription for. These two publish their ACP launch command:',
      },
      ...ACP_AGENT_SUGGESTIONS.map(agent => ({
        text: `${agent.label} — command \`${agent.command}\`, installed with:`,
        command: agent.install,
        // Somebody else's install command: quoted, attributed, never a button.
        authored: false,
      })),
      {
        text: 'Then add it to `atlasmind.acp.agents`, for example:',
        command: '[{ "id": "claude", "command": "claude-agent-acp" }]',
        authored: false,
      },
      { text: 'Other ACP agents work too — supply whatever command starts them in ACP mode.', url: ACP_AGENTS_URL },
    ],
    docs: { url: ACP_AGENTS_URL, title: 'ACP agent list' },
    action: { command: 'atlasmind.openSettingsModels', title: 'Open model settings' },
  });

  // 2 — have it installed
  const installed = state.installed === true;
  steps.push({
    id: 'installed',
    title: 'Install the agent',
    status: !hasAgent ? 'blocked' : installed ? 'done' : 'todo',
    detail: !hasAgent
      ? 'Name an agent first — until then there is no command to look for.'
      : installed
        ? `\`${first!.command}\` is on PATH.`
        : `\`${first!.command}\` was not found on PATH.${state.probeMessage ? ` ${state.probeMessage}` : ''}`,
    guidance: !hasAgent || installed ? undefined : [
      {
        text: `Install the agent that provides \`${first!.command}\`, then reopen this guide.`,
      },
      ...ACP_AGENT_SUGGESTIONS
        .filter(agent => agent.command === first!.command)
        .map(agent => ({ text: `${agent.label} installs with:`, command: agent.install, authored: false })),
      { text: 'A globally installed binary must be on the PATH that VS Code itself sees — restarting VS Code after installing is often what fixes "not found".' },
    ],
  });

  // 3 — sign in (the vendor's flow, never AtlasMind's)
  const authenticated = state.authenticated === true;
  const versionMismatch = typeof state.protocolVersion === 'number'
    && state.protocolVersion > 0
    && state.protocolVersion !== state.clientProtocolVersion;
  steps.push({
    id: 'authenticated',
    title: 'Sign in to the agent',
    status: !installed ? 'blocked' : versionMismatch ? 'todo' : authenticated ? 'done' : 'todo',
    detail: !installed
      ? 'Install the agent first.'
      : versionMismatch
        ? `\`${first?.command}\` speaks ACP version ${state.protocolVersion}; AtlasMind speaks ${state.clientProtocolVersion}. Update the agent to a version that matches.`
        : authenticated
          ? 'The agent reports itself signed in.'
          : `\`${first?.command}\` is installed but not signed in.${state.probeMessage ? ` ${state.probeMessage}` : ''}`,
    guidance: !installed || authenticated || versionMismatch ? undefined : [
      {
        text: 'Sign in with the agent\'s own login — AtlasMind never handles that credential, and never stores it. Run the agent once in a terminal and follow its prompts.',
      },
      { text: 'For the Claude agent this is the Claude Code login; for Codex it is your ChatGPT account.' },
    ],
  });

  // 4 — enable the provider
  const gatesPassed = installed && authenticated && !versionMismatch;
  steps.push({
    id: 'provider',
    title: 'Enable the ACP provider',
    status: !gatesPassed ? 'blocked' : state.providerEnabled ? 'done' : 'todo',
    detail: !gatesPassed
      ? 'Get the agent installed and signed in first.'
      : state.providerEnabled
        ? 'The ACP provider is enabled, so the router can select its models.'
        : 'The ACP provider is off, so the router will not route to it. It ships disabled deliberately — an agent nobody configured should never receive a task.',
    action: { command: 'atlasmind.openModelProviderPanel', title: 'Open model providers' },
  });

  // 5 — prove it answers
  steps.push({
    id: 'firstTurn',
    title: 'Prove a completion comes back',
    status: !state.providerEnabled || !gatesPassed
      ? 'blocked'
      : state.hasCompletedATurn ? 'done' : 'todo',
    detail: !state.providerEnabled || !gatesPassed
      ? 'Finish the steps above first.'
      : state.hasCompletedATurn
        ? 'An ACP model has answered in this workspace.'
        : 'Nothing has come back from an ACP agent yet. Configured and working are different things, and the settings screen cannot tell them apart.',
    guidance: !state.providerEnabled || !gatesPassed || state.hasCompletedATurn ? undefined : [
      { text: `Ask Atlas something with the ACP model selected — \`acp/${first?.id ?? 'claude'}\` — and watch the reply stream in.` },
      { text: 'If nothing arrives, the two usual causes are a subscription that has run out for the day, and an agent that starts but exits immediately. The agent\'s own output says which; run it once in a terminal to see it.' },
    ],
    action: { command: 'atlasmind.openChatPanel', title: 'Open chat' },
  });

  return steps;
}

/** Whether the router can actually use an ACP agent. Ignores the proof step. */
export function isAcpProviderReady(steps: SetupStep[]): boolean {
  return REQUIRED_ACP_STEP_IDS.every(id => steps.find(step => step.id === id)?.status === 'done');
}
