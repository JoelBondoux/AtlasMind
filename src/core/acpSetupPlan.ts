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
 *   2. On Windows, choose where agent consoles may appear — before the first
 *      probe starts anything.
 *   3. Have it installed — a command that is not on PATH fails at spawn.
 *   4. Be signed in — the agent's own login, never AtlasMind's.
 *   5. Enable the provider — otherwise the router will not select it.
 *   6. **Prove one completion comes back.** Configured is not the same as
 *      working, and the difference is invisible from the settings screen — the
 *      same reason the Buzz walkthrough refuses to stop at "subscribed".
 *
 * Steps 1–5 are what `isAcpProviderReady` means. Step 6 is in the walkthrough
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
  /** `process.platform`, injected so this pure plan can skip a Windows-only choice. */
  platform: string;
  /** Whether the checkbox has an explicit workspace/user value, not its default. */
  consoleModeChosen: boolean;
  /** The chosen value of `atlasmind.acp.hideConsoleWindows`. */
  hideConsoleWindows: boolean;
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
  /**
   * Agents the guide may suggest, injected from `VERIFIED_ACP_AGENTS`.
   *
   * Injected rather than imported so this module keeps no second copy of the
   * install commands — the drift between two copies is what made the guide
   * recommend a package that installs a differently-named binary.
   */
  suggestions: readonly AcpAgentSuggestion[];
  /**
   * The first agent's published sign-in flow, from `acpSignInFor`.
   *
   * Injected for the same reason as `suggestions`, and **absent for any agent
   * whose flow AtlasMind has not read**. The guide then says so rather than
   * printing a plausible command: this step is the one where somebody types what
   * they are told into a terminal, so a guess here is worse than a gap.
   */
  signIn?: { command: string; then?: string; docs: string };
}

export const ACP_DOCS_URL = 'https://agentclientprotocol.com/get-started/introduction';
export const ACP_AGENTS_URL = 'https://agentclientprotocol.com/get-started/agents';

/**
 * Install commands for the agents whose ACP launch command is published.
 *
 * Quoted as suggestions the user runs, never executed. **Derived from
 * `VERIFIED_ACP_AGENTS`** rather than typed out here, because a hand-copied
 * install string is how the guide came to tell people to install
 * `@zed-industries/claude-code-acp` — a package whose binary is *not* the
 * `claude-agent-acp` the same guide told them to configure. One list, one answer.
 *
 * The setup plan cannot import the adapter directly without dragging
 * `node:child_process` into a pure module, so the caller injects the list and
 * this is the shape it must have.
 */
export interface AcpAgentSuggestion {
  id: string;
  label: string;
  command: string;
  /** Arguments that put the CLI into ACP mode, if any. */
  args: string[];
  install: string;
}

/** Rendered `command` plus `args`, which is what a user actually has to type. */
export function acpLaunchLine(agent: Pick<AcpAgentSuggestion, 'command' | 'args'>): string {
  return [agent.command, ...agent.args].join(' ');
}

export const ACP_SETUP_GUIDE: SetupGuideSummary = {
  id: 'acp',
  label: 'ACP agents',
  blurb: 'Use a Claude, ChatGPT or Gemini subscription as routable capacity, over the Agent Client Protocol.',
  command: '/acp',
  stepIds: ['agent', 'console', 'installed', 'authenticated', 'provider', 'firstTurn'],
};

/** Steps that must be done for the router to be able to use an ACP agent. */
export const REQUIRED_ACP_STEP_IDS = ['agent', 'console', 'installed', 'authenticated', 'provider'] as const;

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
        text: 'Pick an agent you already have a subscription for. These publish their ACP launch command:',
      },
      ...state.suggestions.map(agent => ({
        text: `${agent.label} — runs as \`${acpLaunchLine(agent)}\`, installed with:`,
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

  // 2 — choose before the first Windows process is started
  const needsConsoleChoice = state.platform === 'win32';
  const consoleReady = !needsConsoleChoice || state.consoleModeChosen;
  steps.push({
    id: 'console',
    title: 'Choose how ACP windows start',
    status: !hasAgent ? 'blocked' : consoleReady ? 'done' : 'todo',
    detail: !hasAgent
      ? 'Name an agent first.'
      : !needsConsoleChoice
        ? 'This choice is Windows-only; this platform does not create Windows console pop-ups.'
        : !state.consoleModeChosen
          ? 'Before AtlasMind starts the agent, choose whether its terminal windows may appear normally or stay on a dedicated private desktop.'
          : state.hideConsoleWindows
            ? 'ACP processes will run on a private Windows desktop, so their console windows cannot appear or take focus.'
            : 'ACP processes use ordinary Windows launching. Their own child processes may briefly show terminal windows during startup.',
    guidance: !hasAgent || consoleReady ? undefined : [
      {
        text: 'Visible is the compatibility-first choice. AtlasMind keeps a safe live session, so startup happens far less often, but an agent or MCP server can still briefly open a black terminal window when it does start.',
      },
      {
        text: 'Private desktop prevents those windows reaching your input desktop. Hidden desktops are also used by hVNC malware, so Microsoft Defender or corporate EDR may flag or block the technique. AtlasMind discloses it, never switches to that desktop, and fails rather than silently falling back.',
      },
      {
        text: 'The same choice remains available as the “ACP: Hide Console Windows” checkbox in Settings.',
      },
    ],
    action: { command: 'atlasmind.acp.chooseConsoleMode', title: 'Choose window behaviour' },
  });

  // 3 — have it installed
  const installed = state.installed === true;
  steps.push({
    id: 'installed',
    title: 'Install the agent',
    status: !hasAgent || !consoleReady ? 'blocked' : installed ? 'done' : 'todo',
    detail: !hasAgent
      ? 'Name an agent first — until then there is no command to look for.'
      : !consoleReady
        ? 'Choose the Windows console behaviour first, so the installation probe does not start a process before explaining where its windows may appear.'
      : installed
        ? `\`${first!.command}\` is on PATH.`
        : `\`${first!.command}\` was not found on PATH.${state.probeMessage ? ` ${state.probeMessage}` : ''}`,
    guidance: !hasAgent || installed ? undefined : [
      {
        text: `Install the agent that provides \`${first!.command}\`, then reopen this guide.`,
      },
      ...state.suggestions
        .filter(agent => agent.command === first!.command)
        .map(agent => ({ text: `${agent.label} installs with:`, command: agent.install, authored: false })),
      { text: 'A globally installed binary must be on the PATH that VS Code itself sees — restarting VS Code after installing is often what fixes "not found".' },
    ],
  });

  // 4 — sign in (the vendor's flow, never AtlasMind's)
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
        text: 'Sign in with the agent\'s own login — AtlasMind never handles that credential, and never stores it.',
      },
      // The launch command is not the sign-in command, and telling someone to
      // "run the agent" when the agent runs as `gemini --acp` sends them to a
      // JSON-RPC server that will never prompt them for anything.
      ...(state.signIn
        ? [
          {
            text: 'Run this in a terminal — AtlasMind types it for you and stops there, because what follows asks for your account password:',
            command: state.signIn.command,
            authored: true,
          },
          ...(state.signIn.then ? [{ text: state.signIn.then }] : []),
          { text: 'Then come back and run `/acp` again.', ...(state.signIn.docs ? { url: state.signIn.docs } : {}) },
        ]
        : [
          {
            text: `AtlasMind has no published sign-in flow recorded for \`${first?.command}\`, so it will not guess one. Check the agent's own documentation — note that the command that starts it in ACP mode is usually **not** the one that signs it in.`,
            url: ACP_AGENTS_URL,
          },
        ]),
      { text: 'An agent that lists sign-in methods has not necessarily asked you for one — AtlasMind decides by trying to open a session, not by reading that list.' },
    ],
    // Offered only while signing in is actually the next thing to do. A version
    // mismatch is not fixed by logging in again, and a step already done does
    // not need a terminal opening for it.
    ...(state.signIn && installed && !authenticated && !versionMismatch
      ? {
        action: {
          command: 'atlasmind.setup.prepareCommand',
          title: 'Open a terminal with the command',
          args: [state.signIn.command],
        },
      }
      : {}),
  });

  // 5 — enable the provider
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

  // 6 — prove it answers
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
