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
 * **The mechanics are shared.** Ordering, next-step selection, progress counting
 * and rendering live in {@link ./setupWalkthrough.ts} and behave identically for
 * every AtlasMind setup guide — only the steps below are Buzz-specific. That is
 * deliberate: the decisions that made this guide work (derive rather than ask,
 * one step at a time, count only what gates the outcome, never flip a switch)
 * are not Buzz-specific either, and re-deriving them per feature is how they get
 * lost — the second guide is always the one that quietly starts installing things.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import {
  isSetupComplete,
  nextSetupStep,
  renderSetupStepMarkdown,
  setupStepPosition,
  type SetupGuidanceLine,
  type SetupStatus,
  type SetupStep,
  type SetupStepPosition,
} from './setupWalkthrough.js';

/** How far along one setup step is. Shared across every setup guide. */
export type BuzzSetupStatus = SetupStatus;

/** One setup step. Shared shape — see `setupWalkthrough.ts`. */
export type BuzzSetupStep = SetupStep;

/**
 * One instruction. Shared shape — see `setupWalkthrough.ts`. A `command` is
 * spelled out in full so it can be copied or typed into a terminal for the
 * user; `authored` distinguishes commands AtlasMind wrote from commands quoted
 * out of Buzz's documentation, which are somebody else's text and are never
 * offered as one-click actions.
 */
export type BuzzGuidanceLine = SetupGuidanceLine;

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
  /** How many usable entries `atlasmind.buzz.agentBindings` currently holds. */
  agentBindings: number;
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
  // A valid URL is not a relay, and until a connection succeeds AtlasMind has
  // no way to tell. So while the user has not said how they run Buzz, this step
  // is unfinished and the guide stops here to ask — rather than skipping past
  // "do you actually have a relay?" because a default string looked plausible.
  const relayStatus: BuzzSetupStatus =
    !relayUrl || insecure || (remote && !state.allowRemoteRelay) ? 'todo'
      : relayMode === 'undecided' && !CONNECTED_STATUSES.includes(state.inboundStatus ?? '') ? 'todo'
        : 'done';
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
      // Only offered when the CLI is actually there. Naming a button that needs
      // a binary you never installed is how a guide teaches people to distrust it.
      ...(state.cliOnPath
        ? [{ text: 'Then press **Fetch my channels** on that page and tick the ones to watch. It asks the Buzz CLI for the real ids, so the channel list cannot quietly disagree with the channel you post in.' }]
        : [{ text: 'Optionally paste channel ids underneath, one per line, to narrow what is watched. (With the Buzz CLI installed — an optional step further down — a **Fetch my channels** button lists them for you instead.)' }]),
      { text: 'An empty list is **not** "no channels" — it scopes by message kind alone, so it covers every channel your key can already read.' },
      { text: 'The subscription only subscribes, authenticates, and keeps alive. It cannot publish to Buzz, by construction.' },
    ],
    action: { command: 'atlasmind.openSettings', title: 'Open Settings → Buzz', args: ['buzz'] },
  });

  // 5 — proof. Every failure mode above has the same symptom: a subscription
  // that connects and then silently receives nothing. Wrong channel id, wrong
  // relay, a key that authenticated as somebody with nothing to read — all of
  // them look exactly like "set up correctly, quiet day". The only thing that
  // tells them apart is one real message arriving, so the walkthrough asks for
  // one before calling anything finished.
  const rosterBlocked = inboundBlocked || !state.inboundEnabled;
  const observed = Math.max(0, Math.trunc(state.observedIdentities ?? 0));
  const bound = Math.max(0, Math.trunc(state.agentBindings ?? 0));
  steps.push({
    id: 'firstAgent',
    title: 'Prove your first Buzz message arrived',
    status: observed > 0 ? 'done' : rosterBlocked ? 'blocked' : 'todo',
    detail: observed > 0
      ? `Working — ${observed} Buzz ${observed === 1 ? 'identity has' : 'identities have'} been seen on the wire this session.`
      : rosterBlocked
        ? 'Needs the steps above first — nothing is subscribed yet.'
        : 'Subscribed, but nothing has arrived yet. A wrong channel id, a wrong relay, and a quiet day all look identical from here, so send one message and check it lands.',
    guidance: observed > 0 || rosterBlocked ? undefined : [
      { text: '**Identity is not runtime.** The key you stored lets AtlasMind authenticate to Buzz, but it does not create a running managed agent. Likewise, a **Person** in the Director is routing metadata; its Buzz handle opens or labels a channel. Automatic replies require the separate **Run AtlasMind as a Buzz managed agent** step below.' },
      // The one step that genuinely needs the desktop app, so the one step that
      // should say how to get it. It was mentioned only in an optional step the
      // walkthrough never shows, which read as though nothing needed it.
      { text: '**1. Get the Buzz app, if you have not already.** This is the step that needs it: AtlasMind can read Buzz but cannot post, so the test message has to come from somewhere else. Download the build for your OS — `.exe` on Windows, `.dmg` on macOS, `.AppImage`/`.deb` on Linux — and install it like any other app.', url: BUZZ_APP_RELEASE_URL },
      { text: 'Point the app at the same relay as AtlasMind. By default both use `ws://localhost:3000`; for a hosted relay, set `BUZZ_RELAY_URL` before launching or switch the relay inside the app. **Different relays is the second-most-common reason nothing arrives.**' },
      { text: '**2. Post something.** In the app, go to a channel AtlasMind is watching and send a message — "hello from Buzz" will do. If you left **Channels to watch** empty, any channel your key can read counts.' },
      // Deliberately not a `command`: that renders in a shell fence and offers a
      // terminal button, and `/buzz read` is a chat command, not something to type
      // into a terminal.
      { text: '**3. Check it arrived.** Come back to this chat and say **`/buzz read`**. That prints what AtlasMind actually received, so it answers the question directly rather than by inference.' },
      { text: '**4a. If you see your message — that is the whole integration proven.** The relay, the key, the authentication, and the subscription are all confirmed working, and the identity you just posted under is now available to bind in the next step.' },
      ...(state.cliOnPath
        ? [{ text: '**4b. If nothing appears**, the usual cause is a channel id mismatch: the id in **Settings → Buzz → Channels to watch** is not the channel you posted in. Press **Fetch my channels** on that page — it asks the Buzz CLI for the real ids so you can tick the right one instead of guessing.' }]
        : [{ text: '**4b. If nothing appears**, the usual cause is a channel id mismatch: the id in **Settings → Buzz → Channels to watch** is not the channel you posted in. Clear the list to watch everything, and try again.' }]),
      { text: 'The next most likely cause is that AtlasMind and the Buzz app are pointed at different relays. Both must use the same URL — check the app\'s relay against **Settings → Buzz → Relay URL**.' },
      { text: 'Note that this half is **read-only by construction**: AtlasMind can subscribe but cannot publish. Replying from AtlasMind is the optional CLI and MCP bridge steps further down — nothing here needs them.' },
    ],
    action: { command: 'atlasmind.openSettings', title: 'Open Settings → Buzz', args: ['buzz'] },
  });

  // 6 — who is who. Everything above gets messages *in*; this is what makes
  // them land somewhere. Without a binding an inbound author stays unassigned —
  // deliberately, since guessing which specialist owns a stranger's message is
  // worse than admitting you do not know — so setup that stops at "subscribed"
  // leaves a working feed that never reaches an agent.
  steps.push({
    id: 'roster',
    title: 'Put the Buzz people in the Director roster',
    status: bound > 0 ? 'done' : rosterBlocked ? 'blocked' : 'todo',
    detail: bound > 0
      ? `${bound} Buzz ${bound === 1 ? 'identity is' : 'identities are'} bound to an AtlasMind agent${
        observed > bound ? `, out of ${observed} seen so far.` : '.'}`
      : rosterBlocked
        ? 'Needs the steps above first — there is nothing arriving to route yet.'
        : observed > 0
          ? `${observed} Buzz ${observed === 1 ? 'identity has' : 'identities have'} been seen and none are bound yet, so their work arrives unassigned.`
          : 'Nobody is bound yet. Work from an unbound Buzz identity stays unassigned rather than being routed by guesswork.',
    guidance: bound > 0 || rosterBlocked ? undefined : [
      { text: 'Press the button below to open **Project Dashboard → Director**. This is AtlasMind\'s roster of the people around the project — who they are, what they own, and now which Buzz identity is theirs.' },
      { text: 'Press **Add person** (or **Edit** on someone already there) and give them a name.' },
      { text: 'Set **Channel** to **Buzz**. The Buzz fields only appear once you do.' },
      ...(observed > 0
        ? [{ text: `Pick their key from the identity list — AtlasMind offers the ${observed} ${observed === 1 ? 'identity it has' : 'identities it has'} actually seen on the relay. It never derives a key from a name: a constructed key would belong to a different real person.` }]
        : [{ text: 'Nobody has posted yet, so there is no identity list to pick from. Paste their `npub…` key instead — ask them for it, or come back once they have posted and AtlasMind will offer it.' }]),
      { text: 'Choose the **AtlasMind agent** that should own their work — the DevOps specialist for a build bot, a reviewer for a colleague raising defects. Leave it unset and their messages stay unassigned; nothing is guessed.' },
      { text: 'Bind yourself too. Your own agent posts under its own key, and binding it keeps your own activity attributed rather than arriving as a stranger.' },
      { text: 'One binding is enough to finish this step. You can add the rest as people appear.' },
      { text: 'This binding routes inbound follow-up work only. It does not create a Buzz managed agent or start a reply loop. Use **AtlasMind: Copy Buzz ACP Agent Setup** from the Command Palette for that.' },
    ],
    action: { command: 'atlasmind.openProjectDirector', title: 'Open the Director roster' },
  });

  // 7 — reciprocal ACP. Optional because inbound-only use remains valid, and
  // not marked "done" merely because AtlasMind copied instructions: only Buzz
  // can know whether the managed agent was actually created and started.
  steps.push({
    id: 'managedAgent',
    title: 'Run AtlasMind as a Buzz managed agent (for automatic replies)',
    status: 'optional',
    detail: 'A Director Person/channel binding is not executable. Buzz needs its own managed agent whose Custom command launches AtlasMind’s local ACP endpoint.',
    guidance: [
      { text: 'Open the VS Code Command Palette and run **AtlasMind: Copy Buzz ACP Agent Setup** to copy a credential-free recipe for this workspace.' },
      { text: 'In Buzz, open **Settings → Agents**, create an agent, choose **Provider → Custom command**, then paste **Agent command** and the comma-separated **Agent arguments** from the copied JSON.' },
      { text: 'Leave Buzz’s **LLM provider** and **Model** blank. AtlasMind owns model routing; those Buzz fields do not configure AtlasMind.' },
      { text: 'Under **Environment variables**, add `ELECTRON_RUN_AS_NODE=1` from the copied recipe plus one AtlasMind provider variable (or a local endpoint). VS Code SecretStorage is deliberately not exported into another process.' },
      { text: 'Buzz keeps `buzz-acp` as the harness. The AtlasMind command is the ACP-speaking agent behind it, so it does not need to appear in Buzz’s built-in runtime catalog.' },
    ],
  });

  // 8 — persistence. A choice, never a requirement.
  steps.push({
    id: 'persistence',
    title: 'Record follow-ups to project memory',
    status: state.autoCreateFollowUps ? 'done' : 'optional',
    detail: state.autoCreateFollowUps
      ? 'Derived follow-ups are written into project_memory/, which is tracked by git.'
      : 'Off, so inbound activity is reported without being written. Deliberately separate from subscribing: project memory is committed to your repository, so recording colleagues’ activity there should be its own decision.',
    action: { command: 'atlasmind.openSettings', title: 'Open Settings → Buzz', args: ['buzz'] },
  });

  // 9 — outbound, which is a different mechanism with a different dependency.
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
 * The steps the walkthrough actually walks you through, and counts.
 *
 * Deliberately longer than `REQUIRED_BUZZ_STEP_IDS`, and the difference is the
 * point. Neither proving a message arrives nor binding people to agents is
 * needed for the subscription to *work* — an unbound author stays unassigned,
 * which is correct behaviour rather than a fault — so neither has any business
 * making `isBuzzInboundReady` report a gap. But a walkthrough that stops at
 * "subscribed" hands back a feed that was never shown to carry anything and
 * never reaches an agent, and calls that finished. That is how the round-trip
 * test and the roster came to be the parts of Buzz setup nobody was told about.
 */
export const BUZZ_WALKTHROUGH_STEP_IDS = [...REQUIRED_BUZZ_STEP_IDS, 'firstAgent', 'roster'] as const;

/**
 * The first step of the walkthrough that still needs doing, or undefined when
 * there is nothing left to guide someone through.
 *
 * Scoped to the walkthrough steps on purpose. The MCP bridge is `blocked` until
 * the CLI is installed, but the CLI is optional — nominating a step whose only
 * blocker is something you never have to do would send someone off to install a
 * binary they do not need.
 */
export function nextBuzzSetupStep(steps: BuzzSetupStep[]): BuzzSetupStep | undefined {
  return nextSetupStep(steps, BUZZ_WALKTHROUGH_STEP_IDS);
}

/**
 * Whether inbound is fully configured. Deliberately ignores the optional steps:
 * reporting "incomplete" for a choice someone made would be nagging, not help.
 */
export function isBuzzInboundReady(steps: BuzzSetupStep[]): boolean {
  return isSetupComplete(steps, REQUIRED_BUZZ_STEP_IDS);
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
  position: SetupStepPosition,
): string {
  return renderSetupStepMarkdown('Buzz', step, position, "Buzz's own documentation");
}

/**
 * Position of a step within the walkthrough sequence, for "step 2 of 6".
 * Optional steps are excluded — counting them would make the finish line move.
 */
export function buzzStepPosition(
  steps: BuzzSetupStep[],
  stepId: string,
): SetupStepPosition {
  return setupStepPosition(steps, BUZZ_WALKTHROUGH_STEP_IDS, stepId);
}

/** A chip the walkthrough offers, so a question can be answered by clicking. */
export interface BuzzGuideChoice {
  id: string;
  label: string;
}

/**
 * The choices for a step, or none when the step is purely instructional.
 *
 * Only the relay step asks a genuine question — which way you run Buzz — and it
 * is the one place the guide cannot work the answer out for itself. Everything
 * else is "do this, then come back", where a chip would be a button that only
 * means "I have read this".
 */
export function buzzStepChoices(step: BuzzSetupStep, relayMode: BuzzRelayMode): BuzzGuideChoice[] {
  if (step.id !== 'relay' || relayMode !== 'undecided') {
    return [];
  }
  return [
    { id: 'local', label: 'I will run Buzz on this machine' },
    { id: 'hosted', label: 'I have a relay URL from someone else' },
  ];
}
