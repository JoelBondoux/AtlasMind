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
   * The actual how-to, as ordered instructions rather than prose. Each line is
   * one thing to do, so the walkthrough can present them one at a time with the
   * command already written out — someone setting Buzz up for the first time
   * should never have to work out what to type.
   */
  guidance?: BuzzGuidanceLine[];
  /** Where to read more. Never a substitute for the guidance itself. */
  docs?: { url: string; title: string };
  /** A surface to open. Never a mutation. */
  action?: { command: string; title: string; args?: unknown[] };
}

/** Everything the plan needs to know, gathered by the caller. */
/**
 * One instruction. A `command` is spelled out in full so it can be copied or
 * typed into a terminal for the user; `authored` distinguishes commands
 * AtlasMind wrote from commands quoted out of Buzz's documentation, which are
 * somebody else's text and are never offered as one-click actions.
 */
export interface BuzzGuidanceLine {
  text: string;
  /** An exact command, ready to run. */
  command?: string;
  /** True when AtlasMind wrote this command, so it may be pre-loaded into a terminal. */
  authored?: boolean;
  /** A page to open for this instruction. */
  url?: string;
}

/** Which way the user has said they want to run a relay, when they have said. */
export type BuzzRelayMode = 'local' | 'hosted' | 'undecided';

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
  /**
   * Whether the user has said how they want to run a relay. Asking once and
   * then showing only the relevant path beats presenting both and leaving them
   * to work out which half applies.
   */
  relayMode?: BuzzRelayMode;
}

/** The pinned CLI release the bundled bridge is built against. */
export const BUZZ_CLI_RELEASE_URL = 'https://github.com/block/buzz/releases/tag/v0.4.26';

/** Packaged desktop builds — the app a person actually reads Buzz in. */
export const BUZZ_APP_RELEASE_URL = 'https://github.com/block/buzz/releases/latest';

/**
 * Client statuses that prove a relay actually answered. Anything else means the
 * relay is configured but unverified — including the default localhost URL,
 * which looks settled while nothing may be listening on the port.
 */
const CONNECTED_STATUSES = ['subscribed', 'live'];

/**
 * Every command AtlasMind offers to type into a terminal for you.
 *
 * An allowlist rather than a filter: `atlasmind.buzz.prepareCommand` is a
 * registered command id and therefore reachable from a webview, so its payload
 * cannot be assumed to be one of ours. Commands quoted from Buzz's docs are
 * deliberately absent — they are somebody else's text and are shown for copying
 * only.
 */
export const BUZZ_SETUP_COMMANDS: readonly string[] = [
  'docker --version',
  'git clone https://github.com/block/buzz.git',
  'docker ps',
  'buzz --version',
];

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
      { text: 'Press the button below to open **Settings → Buzz**.' },
      { text: 'Tick **Enable the Buzz integration** at the top of the page.' },
      { text: 'That is the whole step. It connects nothing on its own — it only stops every other Buzz setting being inert. The setting is workspace-scoped, so your other projects are unaffected.' },
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
  const relayMode = state.relayMode ?? 'undecided';
  const relayGuidance: BuzzGuidanceLine[] = insecure
    ? [
      { text: `\`${relayUrl}\` is off-machine but unencrypted, so AtlasMind refuses it — plaintext would put your colleagues' messages and the login challenge on the wire in the clear.` },
      { text: 'Change the scheme from `ws://` to `wss://` in **Settings → Buzz → Relay URL**.' },
    ]
    : remote && !state.allowRemoteRelay
      ? [
        { text: `\`${relayUrl}\` is not on this machine, so it needs one more explicit consent.` },
        { text: 'In **Settings → Buzz**, tick **Allow a remote relay**.' },
        { text: 'Be deliberate: project communications will leave your machine.' },
      ]
      : relayMode === 'hosted'
        ? [
          { text: 'Someone else runs the relay, so there is nothing to install.' },
          { text: 'Ask whoever runs it for the relay URL. It starts `wss://`.' },
          { text: 'Paste it into **Settings → Buzz → Relay URL**, and tick **Allow a remote relay** just below it.' },
          { text: 'That is the whole step — no Docker, no clone, no build.' },
        ]
        : relayMode === 'local'
          ? [
            { text: '**1. Check you have Docker.** Run this; any version number means you are fine.', command: 'docker --version', authored: true },
            { text: 'If that says "command not found", install Docker Desktop first, then come back.', url: 'https://docs.docker.com/get-docker/' },
            { text: '**2. Get the Buzz source.** It is the relay, so you need the repository.', command: 'git clone https://github.com/block/buzz.git', authored: true },
            { text: '**3. Build and start it.** Buzz\'s own README is the authority on these — they are quoted below with a link, because they change as Buzz ships and a stale command copied from here would fail in a way that looks like AtlasMind\'s fault.' },
            { text: '**4. Confirm something is actually listening.** You should see a Buzz container running.', command: 'docker ps', authored: true },
            { text: 'Then leave the relay running and come back here. The default `ws://localhost:3000` already points at it, so there is nothing to change in Settings.' },
          ]
          : [
            { text: '**First decide how you want to run Buzz.** The two paths need completely different things, so pick one and I will show only that.' },
            { text: '**Hosted** — someone else runs the relay. You paste a `wss://` URL and tick one box. Nothing to install.' },
            { text: '**Local** — you run it on this machine. Needs Docker and a few terminal commands, and keeps everything on your machine. This is the default.' },
            { text: 'Use the buttons below to choose.' },
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

  // 2b — the app. Not required for AtlasMind to work, but it is how a person
  // reads Buzz at all, and it is where the channel ids in the next steps come
  // from. Leaving it out made the guide describe a workspace with no way in.
  steps.push({
    id: 'app',
    title: 'Install the Buzz app (recommended)',
    status: 'optional',
    detail: 'AtlasMind reads and writes Buzz; the app is how *you* read it — and where the channel ids AtlasMind needs come from.',
    guidance: [
      { text: 'Download the packaged build for your OS — `.exe` on Windows, `.dmg` on macOS, `.AppImage`/`.deb` on Linux. Install it like any other app.', url: BUZZ_APP_RELEASE_URL },
      { text: 'Point it at the same relay as AtlasMind. By default it already uses `ws://localhost:3000`; for a hosted relay, set `BUZZ_RELAY_URL` before launching or switch the relay inside the app.' },
      { text: 'Join or create a channel there. **Copy its id** — that is what goes into **Settings → Buzz → Channels to watch**.' },
      { text: 'You can skip this if a colleague has already given you a relay URL and a channel id.' },
    ],
    docs: { url: BUZZ_PROJECT_URL, title: 'Buzz — getting started' },
    action: { command: 'vscode.open', title: 'Download the Buzz app', args: [BUZZ_APP_RELEASE_URL] },
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
      { text: '**If you already have a key**, press the button below and paste it. That is the whole step.' },
      { text: 'It wants an `nsec1…` or a 64-character hex **secret** key. An `npub` is the public half and cannot sign, so it is refused by name rather than failing later.' },
      { text: '**If you do not have one yet**, the Buzz CLI generates one — see Buzz\'s own documentation for the current command, quoted below.' },
      { text: 'The checksum is verified as you paste, so a mistyped key fails immediately instead of quietly authenticating as somebody else.' },
      { text: 'It is stored in your OS secret store (Keychain / Credential Manager / libsecret). Never in settings, never in source, never in a log.' },
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
      { text: 'Open **Settings → Buzz** and tick **Watch Buzz activity**.' },
      { text: 'Optionally paste channel ids underneath, one per line, to narrow what is watched.' },
      { text: 'An empty list is **not** "no channels" — it scopes by message kind alone, so it covers every channel your key can already read.' },
      { text: 'The subscription only subscribes, authenticates, and keeps alive. It cannot publish to Buzz, by construction.' },
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
      { text: '**Skip this entirely if you only want AtlasMind to read Buzz.** Sending is the only thing that needs it.' },
      { text: 'Download **v0.4.26** — the bridge checks the CLI against that release\'s command surface, so a newer build may not match.', url: BUZZ_CLI_RELEASE_URL },
      { text: 'Put it on your `PATH`, or set `BUZZ_CLI_PATH` when you add the MCP server in the next step.' },
      { text: 'Check AtlasMind can see it:', command: 'buzz --version', authored: true },
    ],
    docs: { url: BUZZ_CLI_RELEASE_URL, title: 'Buzz CLI v0.4.26' },
    action: state.cliOnPath
      ? undefined
      : { command: 'vscode.open', title: 'Download the Buzz CLI', args: [BUZZ_CLI_RELEASE_URL] },
  });

  steps.push({
    id: 'mcp',
    title: 'Connect the Buzz MCP bridge (only needed to send)',
    status: state.mcpServerRegistered ? 'done' : state.cliOnPath ? 'optional' : 'blocked',
    detail: state.mcpServerRegistered
      ? 'Registered. Sends still require the Director’s per-project outbound toggle and a confirmation for each message.'
      : state.cliOnPath
        ? 'Adds channel posting, thread reading, and DMs. AtlasMind pre-fills the whole server definition; you supply the key.'
        : 'Needs the Buzz CLI first.',
    guidance: state.mcpServerRegistered || !state.cliOnPath ? undefined : [
      { text: 'Press the button below to open **Manage MCP Servers**.' },
      { text: 'Choose **Browse by category → Buzz Communications**.' },
      { text: 'AtlasMind pre-fills the command, arguments, and environment, and wires your relay URL and both Buzz gates automatically. You supply the agent key, and the CLI location if it is not on `PATH`.' },
      { text: 'The bridge exposes only channel listing/posting, thread reading, and DMs — never Buzz shell, file, or admin tools.' },
      { text: 'Sending still needs the Director\'s per-project outbound toggle *and* a confirmation for each message.' },
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

/**
 * Render one step as markdown: what to do now, in order, with the commands
 * written out.
 *
 * Shared so the chat participant and the AtlasMind chat panel show the same
 * words — two hand-maintained copies of a setup guide drift, and the one that
 * drifts is always the one somebody is following.
 */
export function renderBuzzStepMarkdown(
  step: BuzzSetupStep,
  position: { index: number; total: number },
): string {
  const lines = [
    `### Buzz setup — step ${position.index} of ${position.total}: ${step.title}`,
    '',
    step.detail,
  ];

  if (step.guidance?.length) {
    lines.push('');
    for (const line of step.guidance) {
      lines.push(`- ${line.text}`);
      if (line.url) {
        lines.push(`  ${line.url}`);
      }
      if (line.command) {
        lines.push('', '```bash', line.command, '```');
      }
    }
  }

  if (step.docs) {
    lines.push('', `Buzz's own documentation: ${step.docs.url}`);
  }
  return lines.join('\n');
}

/**
 * Position of a step within the required sequence, for "step 2 of 4".
 * Optional steps are excluded — counting them would make the finish line move.
 */
export function buzzStepPosition(steps: BuzzSetupStep[], stepId: string): { index: number; total: number } {
  const required = steps.filter(step => (REQUIRED_BUZZ_STEP_IDS as readonly string[]).includes(step.id));
  const at = required.findIndex(step => step.id === stepId);
  return { index: at >= 0 ? at + 1 : required.length + 1, total: required.length };
}
