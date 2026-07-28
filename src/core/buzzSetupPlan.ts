/**
 * Buzz setup plan — what is done, what is left, and what to click next.
 *
 * Setting Buzz up touches five unrelated places: a CLI binary, a secret, two
 * settings files, an MCP server, and a relay. Getting one wrong fails at the
 * far end, usually as a subscription that connects and then silently receives
 * nothing. This module turns that into an ordered checklist that can say
 * exactly which step is incomplete.
 *
 * **It is a plan, never an installer.** Every step's action *opens a surface*
 * — the Settings page, the key prompt, the MCP manager, the download page.
 * Nothing here enables a gate, writes a setting, stores a secret, or connects
 * anything. Buzz is deny-by-default in three places precisely so that turning
 * it on is a decision a human makes; a setup assistant that flipped those
 * switches to be helpful would be removing the property they exist to provide.
 *
 * It is also **deterministic**, not model-generated. A hallucinated setup step
 * is worse than no guidance at all: it sends someone to configure something
 * that does not exist and leaves them trusting a broken result. Every line
 * below is derived from observed state.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

/** How far along one setup step is. */
export type BuzzSetupStatus =
  /** Satisfied. */
  | 'done'
  /** Not satisfied, and actionable right now. */
  | 'todo'
  /** Not satisfied, and cannot be until an earlier step is. */
  | 'blocked'
  /** A deliberate choice rather than a requirement — never nagged about. */
  | 'optional';

export interface BuzzSetupStep {
  id: string;
  title: string;
  status: BuzzSetupStatus;
  /** One line explaining the current state, or what to do about it. */
  detail: string;
  /** A surface to open. Never a mutation. */
  action?: { command: string; title: string; args?: unknown[] };
}

/** Everything the plan needs to know, gathered by the caller. */
export interface BuzzSetupState {
  /** Is the pinned Buzz CLI on PATH? Needed only for outbound. */
  cliOnPath: boolean;
  /** Is an agent key in SecretStorage? */
  hasAgentKey: boolean;
  /** `atlasmind.buzz.relayUrl`. */
  relayUrl: string;
  /** `atlasmind.buzz.allowRemoteRelay`. */
  allowRemoteRelay: boolean;
  /** `atlasmind.buzz.enabled`. */
  enabled: boolean;
  /** `atlasmind.buzz.inboundEnabled`. */
  inboundEnabled: boolean;
  /** `atlasmind.buzz.inboundChannels`. */
  channelIds: string[];
  /** `atlasmind.buzz.autoCreateFollowUps`. */
  autoCreateFollowUps: boolean;
  /** Is the bundled Buzz Communications MCP server registered? */
  mcpServerRegistered: boolean;
  /** Live subscription status, when inbound is running. */
  inboundStatus?: string;
  /** How many Buzz identities have been observed this session. */
  observedIdentities: number;
}

/** The pinned CLI release the bundled bridge is built against. */
export const BUZZ_CLI_RELEASE_URL = 'https://github.com/block/buzz/releases/tag/v0.4.26';

/** True when the relay is not on this machine, so TLS and consent both apply. */
export function isRemoteRelay(relayUrl: string): boolean {
  const trimmed = (relayUrl ?? '').trim();
  if (!trimmed) {
    return false;
  }
  let host: string;
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch {
    // An unparseable URL is not evidence of being local.
    return true;
  }
  return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.localhost'));
}

/** True when this relay URL would be refused: plaintext to somewhere off-machine. */
export function isInsecureRemoteRelay(relayUrl: string): boolean {
  const trimmed = (relayUrl ?? '').trim();
  if (!trimmed || !isRemoteRelay(trimmed)) {
    return false;
  }
  return /^(ws|http):\/\//i.test(trimmed);
}

/**
 * Build the ordered setup checklist.
 *
 * Ordering is dependency order, not importance order: each step is only
 * actionable once the ones above it are satisfied, so the first non-`done`
 * step is always the right thing to do next.
 */
export function buildBuzzSetupPlan(state: BuzzSetupState): BuzzSetupStep[] {
  const steps: BuzzSetupStep[] = [];
  const relayUrl = (state.relayUrl ?? '').trim();
  const remote = isRemoteRelay(relayUrl);
  const insecure = isInsecureRemoteRelay(relayUrl);

  // 1 — the master switch. Everything else is inert without it.
  steps.push({
    id: 'enabled',
    title: 'Turn on the Buzz integration',
    status: state.enabled ? 'done' : 'todo',
    detail: state.enabled
      ? 'Buzz is enabled for this workspace.'
      : 'Off by default. Nothing connects, reads, or sends until you turn this on.',
    action: { command: 'atlasmind.openSettings', title: 'Open Settings → Buzz', args: ['buzz'] },
  });

  // 2 — where to connect, and whether that is allowed.
  const relayDetail = !relayUrl
    ? 'No relay URL set. The default is a local, self-hosted relay at ws://localhost:3000.'
    : insecure
      ? `${relayUrl} is a remote relay over an unencrypted connection, which is refused — plaintext would expose your colleagues' messages and the login challenge in transit. Use wss:// instead.`
      : remote && !state.allowRemoteRelay
        ? `${relayUrl} is not on this machine, so it also needs "Allow a remote relay". Project data will leave your machine.`
        : remote
          ? `Connecting to ${relayUrl} (remote, encrypted).`
          : `Connecting to ${relayUrl} (local).`;
  steps.push({
    id: 'relay',
    title: 'Point AtlasMind at a relay',
    status: !relayUrl || insecure || (remote && !state.allowRemoteRelay) ? 'todo' : 'done',
    detail: relayDetail,
    action: { command: 'atlasmind.openSettings', title: 'Open Settings → Buzz', args: ['buzz'] },
  });

  // 3 — identity. A real relay refuses to serve a subscription without it.
  steps.push({
    id: 'agentKey',
    title: 'Store your Buzz agent key',
    status: state.hasAgentKey ? 'done' : 'todo',
    detail: state.hasAgentKey
      ? 'A key is stored in the OS secret store.'
      : 'Most relays refuse to serve a subscription until you authenticate. Your key is kept in the OS secret store, never in settings or source.',
    action: { command: 'atlasmind.setBuzzAgentKey', title: 'Set Buzz agent key…' },
  });

  // 4 — inbound.
  const inboundBlocked = !state.enabled || !state.hasAgentKey;
  steps.push({
    id: 'inbound',
    title: 'Subscribe to Buzz activity (read-only)',
    status: state.inboundEnabled && !inboundBlocked ? 'done' : inboundBlocked ? 'blocked' : 'todo',
    detail: inboundBlocked
      ? 'Needs the steps above first.'
      : state.inboundEnabled
        ? `Subscribed${state.inboundStatus ? ` — ${state.inboundStatus}` : ''}${
          state.channelIds.length > 0
            ? `, watching ${state.channelIds.length} channel${state.channelIds.length === 1 ? '' : 's'}.`
            : '. No channels listed, so this covers every channel your key can read.'}`
        : 'Holds a read-only subscription and turns activity into work items. It can never publish to Buzz.',
    action: { command: 'atlasmind.openSettings', title: 'Open Settings → Buzz', args: ['buzz'] },
  });

  // 5 — persistence. A choice, never a requirement.
  steps.push({
    id: 'persistence',
    title: 'Record follow-ups to project memory',
    status: state.autoCreateFollowUps ? 'done' : 'optional',
    detail: state.autoCreateFollowUps
      ? 'Derived follow-ups are written into project_memory/, which is tracked by git.'
      : 'Off, so inbound activity is reported without being written. Deliberately separate from subscribing: project memory is committed to your repository, so recording colleagues’ activity there should be its own decision.',
    action: { command: 'atlasmind.openSettings', title: 'Open Settings → Buzz', args: ['buzz'] },
  });

  // 6 — outbound, which is a different mechanism with a different dependency.
  steps.push({
    id: 'cli',
    title: 'Install the Buzz CLI (only needed to send)',
    status: state.cliOnPath ? 'done' : 'optional',
    detail: state.cliOnPath
      ? 'Found on PATH.'
      : 'Not on PATH. Reading Buzz does not need it — only sending does, through the bundled bridge. Install v0.4.26, the version the bridge is pinned to.',
    action: state.cliOnPath
      ? undefined
      : { command: 'vscode.open', title: 'Download the Buzz CLI', args: [BUZZ_CLI_RELEASE_URL] },
  });

  steps.push({
    id: 'mcp',
    title: 'Connect the Buzz Communications bridge (only needed to send)',
    status: state.mcpServerRegistered ? 'done' : state.cliOnPath ? 'optional' : 'blocked',
    detail: state.mcpServerRegistered
      ? 'Registered. Sends still require the Director’s per-project outbound toggle and a confirmation for each message.'
      : state.cliOnPath
        ? 'Adds channel posting, thread reading, and DMs. AtlasMind pre-fills the whole server definition; you supply the key.'
        : 'Needs the Buzz CLI first.',
    action: { command: 'atlasmind.openMcpServers', title: 'Manage MCP servers' },
  });

  return steps;
}

/**
 * The steps that must be done before AtlasMind can read Buzz at all. Everything
 * else is an extra: sending is a separate mechanism, and recording follow-ups is
 * a decision rather than a requirement.
 */
export const REQUIRED_BUZZ_STEP_IDS = ['enabled', 'relay', 'agentKey', 'inbound'] as const;

/**
 * The first *required* step that still needs doing, or undefined when reading
 * Buzz is fully set up.
 *
 * Scoped to the required steps on purpose. The MCP bridge is `blocked` until the
 * CLI is installed, but the CLI is optional — nominating a step whose only
 * blocker is something you never have to do would send someone off to install a
 * binary they do not need.
 */
export function nextBuzzSetupStep(steps: BuzzSetupStep[]): BuzzSetupStep | undefined {
  const required = steps.filter(step => (REQUIRED_BUZZ_STEP_IDS as readonly string[]).includes(step.id));
  return required.find(step => step.status === 'todo') ?? required.find(step => step.status === 'blocked');
}

/**
 * Whether inbound is fully configured. Deliberately ignores the optional steps:
 * reporting "incomplete" for a choice someone made would be nagging, not help.
 */
export function isBuzzInboundReady(steps: BuzzSetupStep[]): boolean {
  return REQUIRED_BUZZ_STEP_IDS.every(id => steps.find(step => step.id === id)?.status === 'done');
}
