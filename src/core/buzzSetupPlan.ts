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
  /**
   * The actual how-to, when the step needs more than a sentence. Kept as
   * discrete lines so both the chat walkthrough and the Settings page can
   * render them without re-wrapping prose.
   */
  guidance?: string[];
  /** Where to read more. Never a substitute for the guidance itself. */
  docs?: { url: string; title: string };
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

/**
 * Client statuses that prove a relay actually answered. Anything else means the
 * relay is configured but unverified — including the default localhost URL,
 * which looks settled while nothing may be listening on the port.
 */
const CONNECTED_STATUSES = ['subscribed', 'live'];

/** The project itself — the authority on how to run a relay. */
export const BUZZ_PROJECT_URL = 'https://github.com/block/buzz';

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
    guidance: state.enabled ? undefined : [
      'Open **Settings → Buzz** and tick **Enable the Buzz integration**.',
      'This alone connects nothing. It only stops every other Buzz setting being inert.',
      'The setting is workspace-scoped, so enabling it here does not enable it in your other projects.',
    ],
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
  const relayGuidance = insecure
    ? [
      `\`${relayUrl}\` is off-machine but unencrypted, so AtlasMind refuses it.`,
      'Plaintext would put your colleagues\' messages and the login challenge on the wire in the clear.',
      'Change the scheme to `wss://` — or point at a local relay instead.',
    ]
    : remote && !state.allowRemoteRelay
      ? [
        `\`${relayUrl}\` is not on this machine, so it needs a second, explicit consent.`,
        'Tick **Allow a remote relay** in Settings → Buzz.',
        'Be deliberate about it: project communications will leave your machine.',
      ]
      : [
        '**Two ways to run this, and they need different things:**',
        '**A hosted relay** — someone else runs it. Paste its `wss://` URL and tick **Allow a remote relay**. Nothing to install.',
        '**A local relay** — you run it yourself, which is the default (`ws://localhost:3000`) and keeps everything on your machine. This is not automatic: **something has to actually be listening on that port**, and nothing in AtlasMind starts it.',
        'Running one locally normally means **Docker** — the Buzz project is the authority on the current image and command, so follow its instructions rather than a command copied from here.',
        'If nothing is listening, the symptom is a subscription that never becomes live. Check with `docker ps` that your relay container is up.',
      ];
  const relayStatus: BuzzSetupStatus = !relayUrl || insecure || (remote && !state.allowRemoteRelay) ? 'todo' : 'done';
  // A valid URL is not a relay. The default points at localhost, which reads as
  // "already working" while nothing may be listening — and AtlasMind cannot
  // know which until a connection succeeds. So the how-to stays visible until
  // one actually has, rather than declaring victory over a string.
  const relayProven = CONNECTED_STATUSES.includes(state.inboundStatus ?? '');
  steps.push({
    id: 'relay',
    title: 'Have a relay to connect to',
    status: relayStatus,
    detail: relayStatus === 'done' && !relayProven
      ? `${relayDetail} AtlasMind has not connected yet, so this is the configured target rather than a confirmed one.`
      : relayDetail,
    // Guidance on a step that is genuinely finished is noise, and noise is what
    // makes people stop reading the steps that still matter.
    guidance: relayStatus === 'done' && relayProven ? undefined : relayGuidance,
    docs: { url: BUZZ_PROJECT_URL, title: 'Buzz — running a relay' },
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
    guidance: state.hasAgentKey ? undefined : [
      'Run **AtlasMind: Set Buzz Agent Key** and paste your agent identity key.',
      'It takes an `nsec1…` or a 64-character hex **secret** key. An `npub` is the public half and cannot sign, so it is refused by name.',
      'The Buzz CLI generates one if you do not have it — see the Buzz project for the current command.',
      'The checksum is verified when you paste it, so a mistyped key fails immediately rather than silently authenticating as somebody else.',
      'It goes into the OS secret store (Keychain / Credential Manager / libsecret) — never into settings, source, or a log.',
    ],
    docs: { url: BUZZ_PROJECT_URL, title: 'Buzz — agent identity' },
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
    guidance: inboundBlocked || state.inboundEnabled ? undefined : [
      'Tick **Watch Buzz activity** in Settings → Buzz.',
      'Optionally list channel ids, one per line, to narrow what is watched.',
      'An empty list is **not** "no channels" — it scopes by message kind alone, so it covers every channel your key can already read.',
      'The subscription sends only subscribe / authenticate / keep-alive frames. It cannot publish to Buzz, by construction.',
    ],
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
    guidance: state.cliOnPath ? undefined : [
      'Skip this entirely if you only want AtlasMind to *read* Buzz.',
      'Download **v0.4.26** — the bridge validates the CLI against that release\'s command surface, so a newer build may not match.',
      'Put it on your `PATH`, or set the `BUZZ_CLI_PATH` input when you add the MCP server.',
      'Re-run this checklist afterwards to confirm AtlasMind can see it.',
    ],
    docs: { url: BUZZ_CLI_RELEASE_URL, title: 'Buzz CLI v0.4.26' },
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
    guidance: state.mcpServerRegistered || !state.cliOnPath ? undefined : [
      'Open **Manage MCP Servers → Browse by category → Buzz Communications**.',
      'AtlasMind pre-fills the command, arguments, and environment, and wires the relay URL and both Buzz gates to your settings automatically.',
      'You supply the agent key (stored as a secret) and, if the CLI is not on `PATH`, its location.',
      'The bridge exposes only channel listing/posting, thread reading, and DMs — never Buzz shell, file, or admin tools.',
      'Sending still requires the Director\'s per-project outbound toggle *and* a confirmation dialog for each message.',
    ],
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
