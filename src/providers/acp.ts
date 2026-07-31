/**
 * ACP provider adapter — subscription-backed completion capacity over the
 * Agent Client Protocol.
 *
 * This is Tier 1 of `project_memory/roadmap/acp-integration.md`. It superseded
 * the `claude-cli` argv bridge (removed in v0.219.0) as the Claude-subscription
 * path, with strictly more capability and **no new security surface**. What it
 * bought over that bridge is why it is shaped this way:
 *
 * - **Streaming.** `session/update` text chunks map to `onTextChunk`; the argv
 *   bridge could not stream at all.
 * - **No 26k prompt ceiling.** Prompts travel as JSON-RPC over stdio rather than
 *   in argv, so the argv length limit and its truncation constants simply do not
 *   apply. A long context arrives intact instead of silently cut.
 * - **Images.** Sent as ACP `image` content blocks when the agent's
 *   `promptCapabilities.image` says it accepts them — and dropped with a note
 *   when it does not, rather than sent hopefully.
 *
 * **Restricted mode is mandatory at this tier, and is what lets it ship without
 * touching the authorization gate.** The agent is initialised with no
 * filesystem capability, no terminal capability, and an empty `mcpServers`
 * list. It is a completion source, not an executor. Delegated execution —
 * where `session/request_permission` must resolve through `toolApprovalManager`
 * — is Tier 3, and this adapter deliberately **refuses** any permission request
 * rather than answering one it has no policy for: failing closed is the only
 * safe behaviour for a request this tier was not built to authorize.
 *
 * The launch command is **user-authored** (`atlasmind.acp.agents`). Nothing here
 * installs, downloads, or `npx`-fetches an agent: the adapter probes for a
 * binary the user already has.
 *
 * Wire framing lives in {@link ./acpProtocol.ts}, verified against the published
 * spec. The child process is injected via {@link AcpProcessFactory} — the
 * `PresenceManager`/`BuzzClient` idiom — so the whole state machine is testable
 * without spawning anything.
 */

import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { CompletionRequest, CompletionResponse, DiscoveredModel, ProviderAdapter } from './adapter.js';
import { createAcpLaunchProbe, resolveAcpLaunch } from './acpLaunch.js';
import {
  ACP_ERROR_AUTH_REQUIRED,
  ACP_PERMISSION_METHOD,
  ACP_PROTOCOL_VERSION,
  parsePromptUsage,
  buildInitializeRequest,
  buildPermissionCancelledResponse,
  buildPermissionSelectedResponse,
  buildSessionCancelNotification,
  buildSessionCloseRequest,
  buildSessionNewRequest,
  buildSessionPromptRequest,
  drainFrames,
  encodeAcpFrame,
  parseAcpFrame,
  parseInitializeResult,
  parsePermissionRequest,
  parseSessionConfigOptions,
  parseSessionId,
  parseSessionUpdate,
  buildSetConfigOptionRequest,
  parseStopReason,
  toFinishReason,
  type AcpConfigOption,
  type AcpInitializeResult,
  type AcpMcpServer,
  type AcpPermissionRequest,
  type AcpPromptBlock,
  type AcpToolCall,
} from './acpProtocol.js';
import { resolveAcpPermission } from './acpPermission.js';
import {
  ACP_EFFORT_CATEGORY,
  acpEffortTiersFor,
  buildAcpModelVariantId,
  isSettableAcpConfigCategory,
  parseAcpModelVariant,
  type AcpEffortTier,
} from './acpEffort.js';
import {
  ACP_MODEL_CATEGORY,
  acpModelChoicesFor,
  acpModelRows,
  buildAcpModelId,
  composeAcpVariant,
  describeAcpModelStanding,
  splitAcpModelSegment,
  type AcpModelChoice,
} from './acpModels.js';

export const ACP_PROVIDER_ID = 'acp';
export const ACP_SETUP_URL = 'https://agentclientprotocol.com/get-started/agents';

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * How long a single agent's probe may take.
 *
 * Exported because any budget that *encloses* a probe has to be larger than it,
 * and that relationship was previously two unrelated numbers in two files: the
 * startup discovery pass allowed 10s per provider while this allowed 20s per
 * agent, so on a healthy install the enclosing timeout always fired first and
 * its handler marked the provider unhealthy. Callers derive their budget from
 * this constant rather than restating one.
 */
export const ACP_PROBE_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = ACP_PROBE_TIMEOUT_MS;

/** How long a `session/close` may take before teardown stops waiting for it. */
const SESSION_CLOSE_TIMEOUT_MS = 2_000;

/**
 * How long a probe's answer is reused.
 *
 * Was 10 seconds, which was sized for the cost of a handshake. The probe is not
 * a handshake — it opens a **session**, because that is the only honest test of
 * "signed in", and a session on a coding agent starts the agent's entire
 * runtime. Measured here: `claude-agent-acp` launches the user's whole
 * configured MCP fleet inside it (a GitKraken CLI, an `npx @azure/mcp` tree, a
 * `contrast-checker-mcp` tree, several via `cmd.exe`), and `codex-acp` starts an
 * `app-server` plus a REPL host. On Windows each `cmd.exe` makes the OS allocate
 * a `conhost.exe`, which is a console window that appears and vanishes.
 *
 * With a dozen call sites that refresh the provider catalog — opening a panel,
 * changing a setting, adding an agent — a ten-second TTL meant re-launching that
 * tree over and over. So the TTL is sized for what a miss actually costs rather
 * than for how fresh the answer could theoretically be. What it buys is a
 * staleness window on "is this agent signed in?", which changes on the order of
 * days; explicit refreshes still bypass it via {@link resetAcpProbeCache}.
 */
const ACP_PROBE_TTL_MS = 5 * 60_000;

/**
 * Agents whose ACP launch command is **declared in the ACP registry**.
 *
 * Every entry here was transcribed from that registry's `agent.json` files (see
 * {@link ACP_REGISTRY_SOURCE}) at {@link ACP_SPEC_VERIFIED_AT}, which is the
 * difference between this list and the guesswork it replaces. The previous
 * version paired the command `claude-agent-acp` with an install of
 * `@zed-industries/claude-code-acp` — a package that has since been renamed and
 * whose `bin` was `claude-code-acp`. So following AtlasMind's own instructions
 * installed a binary with a different name from the one AtlasMind then spawned,
 * and the Claude subscription path could not work for anybody. `install` and
 * `command` are now taken from the same source, and a test asserts that every
 * `install` names the package that actually provides `command`.
 *
 * `args` is why Gemini, Copilot and Qwen can be here at all: they are not
 * ACP-specific binaries but general CLIs with an ACP mode, so the flag is part
 * of the launch command. Gemini was previously excluded on the grounds that its
 * invocation was unpublished — the registry publishes it now.
 *
 * Agents distributed only as downloadable archives (goose, opencode, Cursor,
 * Kimi, Junie, Mistral Vibe, Amp) are deliberately absent from *this* list even
 * though they speak ACP: AtlasMind will not download and unpack an archive, so
 * it has no install to offer. They still work — the user installs them and names
 * the command, which is what {@link parseAcpAgentSettings} is for. The commands
 * are recorded in {@link SELF_INSTALLED_ACP_AGENTS} so the guide can name them.
 */
export interface VerifiedAcpAgent {
  id: string;
  label: string;
  command: string;
  /** Arguments that put the CLI into ACP mode. Empty for a dedicated adapter. */
  args: string[];
  modelId: string;
  /** The npm package whose `bin` provides `command`. */
  npmPackage: string;
}

export const VERIFIED_ACP_AGENTS: readonly VerifiedAcpAgent[] = [
  {
    id: 'claude',
    label: 'Claude Agent (claude-agent-acp)',
    command: 'claude-agent-acp',
    args: [],
    modelId: 'acp/claude',
    npmPackage: '@agentclientprotocol/claude-agent-acp',
  },
  {
    id: 'codex',
    label: 'Codex (codex-acp)',
    command: 'codex-acp',
    args: [],
    modelId: 'acp/codex',
    npmPackage: '@agentclientprotocol/codex-acp',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI (gemini --acp)',
    command: 'gemini',
    args: ['--acp'],
    modelId: 'acp/gemini',
    npmPackage: '@google/gemini-cli',
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot CLI (copilot --acp)',
    command: 'copilot',
    args: ['--acp'],
    modelId: 'acp/copilot',
    npmPackage: '@github/copilot',
  },
  {
    id: 'qwen',
    label: 'Qwen Code (qwen --acp)',
    command: 'qwen',
    args: ['--acp'],
    modelId: 'acp/qwen',
    npmPackage: '@qwen-code/qwen-code',
  },
];

/**
 * ACP agents the user installs themselves, with the invocation the registry
 * declares.
 *
 * These ship as platform archives rather than packages, and unpacking a
 * downloaded archive is not something AtlasMind does — so there is no install
 * button, and offering one would be a button that cannot work. What is worth
 * having is the *command*: someone who already runs goose or opencode should not
 * have to work out the ACP flag, and "any agent that speaks ACP" is not a useful
 * answer to "which ones, and how".
 */
export const SELF_INSTALLED_ACP_AGENTS: ReadonlyArray<{ id: string; label: string; command: string; args: string[] }> = [
  { id: 'goose', label: 'goose', command: 'goose', args: ['acp'] },
  { id: 'opencode', label: 'OpenCode', command: 'opencode', args: ['acp'] },
  { id: 'cursor', label: 'Cursor', command: 'cursor-agent', args: ['acp'] },
  { id: 'kimi', label: 'Kimi CLI', command: 'kimi', args: ['acp'] },
];

/** How AtlasMind tells a user to install one of the packaged agents. */
export function acpInstallCommand(npmPackage: string): string {
  return `npm install -g ${npmPackage}`;
}

/**
 * Which pay-per-token provider each ACP agent is the subscription alternative to.
 *
 * "ACP" is a protocol name, and nobody goes looking for a protocol. Someone
 * holding a Claude subscription thinks *"I already pay for Claude"* — so the
 * offer belongs on the **Anthropic** card, phrased in those terms, rather than
 * behind a separate entry they must first know exists and then decode.
 *
 * Only vendors whose launch command is actually published appear here. Google is
 * now among them: Gemini CLI's ACP invocation was unpublished when this list was
 * written and is declared in the registry today, so the offer on the Google card
 * is a button that works rather than one that cannot.
 *
 * `install` is **derived** from the agent's entry in {@link VERIFIED_ACP_AGENTS}
 * rather than written out again here. Keeping a second copy is what produced the
 * bug this list shipped with for thirty-odd versions: the install string said
 * `@zed-industries/claude-code-acp` while `command` said `claude-agent-acp`, and
 * nothing could notice they disagreed.
 */
export interface AcpProviderBridge {
  /** The pay-per-token provider this is offered alongside. */
  providerId: string;
  /** Agent id used in the model id `acp/<id>`. */
  agentId: string;
  command: string;
  /**
   * Arguments that put the CLI into ACP mode.
   *
   * Carried on the bridge and not just in the verified list, because the
   * subscription button writes the agent's settings entry itself. Gemini CLI is
   * an interactive REPL without `--acp`, so a bridge that dropped the flag would
   * register an agent that starts, prints a banner, and never answers.
   */
  args: string[];
  /** What the user calls the thing they already pay for. */
  subscriptionName: string;
  /** Button text — the user's words, not the protocol's. */
  offerLabel: string;
  install: string;
}

/** Which vendor card carries which agent's offer, and in whose words. */
const ACP_BRIDGE_OFFERS: ReadonlyArray<{
  providerId: string;
  agentId: string;
  subscriptionName: string;
  offerLabel: string;
}> = [
  {
    providerId: 'anthropic',
    agentId: 'claude',
    subscriptionName: 'Claude subscription',
    offerLabel: 'Use my Claude subscription',
  },
  {
    providerId: 'openai',
    agentId: 'codex',
    subscriptionName: 'ChatGPT Plus or Pro subscription',
    offerLabel: 'Use my ChatGPT subscription',
  },
  {
    providerId: 'google',
    agentId: 'gemini',
    subscriptionName: 'Google AI Pro or Ultra subscription',
    offerLabel: 'Use my Gemini subscription',
  },
];

export const ACP_PROVIDER_BRIDGES: readonly AcpProviderBridge[] = ACP_BRIDGE_OFFERS.flatMap(offer => {
  const agent = VERIFIED_ACP_AGENTS.find(entry => entry.id === offer.agentId);
  // A bridge for an agent this build does not know how to launch would be an
  // offer with no command behind it, so it is dropped rather than half-built.
  return agent
    ? [{
      providerId: offer.providerId,
      agentId: offer.agentId,
      command: agent.command,
      args: agent.args,
      subscriptionName: offer.subscriptionName,
      offerLabel: offer.offerLabel,
      install: acpInstallCommand(agent.npmPackage),
    }]
    : [];
});

/** The subscription offer for a provider, when one exists. */
export function findAcpBridge(providerId: string): AcpProviderBridge | undefined {
  return ACP_PROVIDER_BRIDGES.find(bridge => bridge.providerId === providerId);
}

/**
 * The same bridge, found by agent id rather than by vendor.
 *
 * Both entry points into ACP setup end up needing the install command — the
 * offer on a vendor card knows the vendor, the agent picker knows the agent —
 * and a user who hits "not installed" needs the same answer either way.
 */
export function findAcpBridgeByAgent(agentId: string): AcpProviderBridge | undefined {
  return ACP_PROVIDER_BRIDGES.find(bridge => bridge.agentId === agentId);
}

export interface AcpAgentConfig {
  /** Stable id, used in the model id `acp/<id>`. */
  id: string;
  /** Executable to spawn. User-authored; never installed by AtlasMind. */
  command: string;
  args?: string[];
  /** Extra environment for the child, merged over the inherited environment. */
  env?: Record<string, string>;
  label?: string;
}

export interface AcpProbeResult {
  installed: boolean;
  /** True only when the agent reported no outstanding auth methods. */
  authenticated: boolean;
  /** The version the agent negotiated, when it got that far. */
  protocolVersion?: number;
  agentName?: string;
  command?: string;
  message?: string;
  /**
   * `promptCapabilities.image`, learned from the handshake.
   *
   * This is what lets `discoverModels` declare `vision` truthfully. It cannot be
   * a static fact about the agent id: whether `claude-agent-acp` accepts images
   * depends on the installed build, and asserting a capability the local binary
   * does not have produces a failed turn rather than a skipped one.
   */
  supportsImages?: boolean;
  /** `promptCapabilities.audio`. Reported for diagnostics; nothing sends audio. */
  supportsAudio?: boolean;
  /**
   * The knobs this agent offered on the probe's session.
   *
   * Captured for the same reason `supportsImages` is: it is a fact about the
   * *installed build*, learned by asking, and `discoverModels` runs on every
   * tree render and must not spawn. The probe already opens a session to answer
   * "signed in?", so the effort levels arrive on a round trip already being
   * paid for — they were simply being thrown away.
   */
  configOptions?: AcpConfigOption[];
}

/**
 * Asks the user whether a delegated ACP agent may perform one operation.
 *
 * Injected rather than imported so the adapter stays `vscode`-free: the real
 * implementation shows a modal and consults `ToolApprovalManager`, and the tests
 * pass a function. **No policy means no permission** — see {@link AcpAdapter}.
 */
export type AcpPermissionPolicy = (request: AcpPermissionRequest) => Promise<boolean>;

/** Notified as the agent announces and updates tool calls, so they are visible. */
export type AcpToolEventListener = (event: AcpToolCall) => void;

/** Minimal child-process surface, so tests can drive a fake. */
export interface AcpProcessHandle {
  writeLine(line: string): void;
  onStdout(listener: (chunk: string) => void): void;
  onStderr(listener: (chunk: string) => void): void;
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  kill(): void;
  /**
   * The OS process id, when there is a real process behind this handle.
   *
   * Optional because a fake in a test has no pid — and because the Windows
   * tree-kill backstop is the only thing that needs one, so requiring it would
   * make every test double carry a field for a code path it never reaches.
   */
  readonly pid?: number | undefined;
}

export type AcpProcessFactory = (config: AcpAgentConfig, cwd: string | undefined) => AcpProcessHandle;

interface AcpTurnResult {
  text: string;
  finishReason: CompletionResponse['finishReason'];
  inputTokens: number;
  outputTokens: number;
  agentName?: string;
}

export class AcpAdapter implements ProviderAdapter {
  readonly providerId = ACP_PROVIDER_ID;

  /**
   * What *this* adapter last learned about each agent, by agent id.
   *
   * Distinct from the module-level TTL cache on purpose. That cache exists so
   * separate adapter instances do not each spawn a process for the same agent,
   * and it is deliberately bypassed whenever a process factory is injected —
   * shared state that outlived a test would leak between them. But
   * `discoverModels` needs the probe's findings to offer effort variants, and
   * with the shared cache bypassed it would see nothing and offer none: the
   * feature would work in production and be untestable, which is the same as
   * being unverified.
   *
   * An instance memo has neither problem. It is not shared, so it cannot leak;
   * and it is the honest scope anyway — what this adapter found out.
   */
  private readonly lastProbeByAgent = new Map<string, AcpProbeResult>();

  constructor(
    private readonly options?: {
      /**
       * The configured agents, or a getter for them.
       *
       * A getter is the shape the long-lived routed adapter needs. It is
       * constructed once at activation, so an array here is a snapshot of
       * `atlasmind.acp.agents` as it read at that moment — and adding an agent
       * afterwards left the adapter that actually answers prompts blind to it
       * until the window was reloaded, while the provider panel (which builds a
       * throwaway adapter per click) reported the new agent as ready. Two
       * surfaces disagreeing about which agents exist is exactly the confusion
       * this provider keeps producing.
       *
       * Tests and one-shot probes pass an array, which still means "these".
       */
      agents?: AcpAgentConfig[] | (() => AcpAgentConfig[]);
      cwd?: string;
      timeoutMs?: number;
      clientVersion?: string;
      spawnProcess?: AcpProcessFactory;
      /**
       * MCP servers to hand the agent at `session/new`.
       *
       * Absent, or returning nothing, means the agent gets none — the default.
       * The list is an explicit user allowlist, not "everything AtlasMind has
       * connected": these entries carry commands and environment variables into
       * a third-party process.
       *
       * A getter rather than a value, matching `LocalEchoAdapter`'s
       * `getEndpoints`: it is read per session, so revoking a server in settings
       * takes effect on the next turn instead of the next window reload.
       */
      getMcpServers?: () => AcpMcpServer[];
      /**
       * The authorization gate for delegated execution.
       *
       * **Omitting it is a denial, not a bypass.** With no policy, every
       * `session/request_permission` is refused, exactly as at Tier 1 — so a
       * caller that forgets to wire the gate gets an agent that cannot act,
       * rather than one that acts unsupervised.
       */
      permissionPolicy?: AcpPermissionPolicy;
      /**
       * Called when a requested effort tier could not be applied and the turn is
       * proceeding at the agent's default. Not an error channel — the turn
       * succeeds — but the run was cheaper than it was billed as, and that is
       * worth saying out loud rather than absorbing.
       */
      onEffortNotApplied?: (event: { agentId: string; requested: string; reason: string }) => void;
      /**
       * The user's `atlasmind.acp.modelStanding` declarations.
       *
       * A function for the same reason `agents` is: settings change while the
       * extension host is alive, and a value captured at construction would go
       * stale the moment somebody teaches AtlasMind where a new model sits.
       */
      modelStanding?: () => Record<string, string>;
      onToolEvent?: AcpToolEventListener;
    },
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    return this.run(request, undefined);
  }

  async streamComplete(
    request: CompletionRequest,
    onTextChunk: (chunk: string) => void,
  ): Promise<CompletionResponse> {
    return this.run(request, onTextChunk);
  }

  async listModels(): Promise<string[]> {
    return this.agents().map(agent => `${ACP_PROVIDER_ID}/${agent.id}`);
  }

  /**
   * Model metadata for the router.
   *
   * `vision` is declared **only** when a handshake has actually reported
   * `promptCapabilities.image`, and is read from the probe cache rather than by
   * spawning: this runs on every tree render, and a process per render is not a
   * price a capability list should cost. The consequence is that vision appears
   * once the agent has been probed (health check, provider panel, setup plan)
   * and not before — the conservative direction, since a model wrongly *offered*
   * for vision fails the turn, while one wrongly withheld merely routes
   * elsewhere.
   *
   * `function_calling` is deliberately never declared. ACP has no way to expose
   * AtlasMind's own `ToolDefinition`s to the agent, so a task requiring that
   * must not be routed here — see the refusal in {@link run}.
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    return this.agents().flatMap(agent => {
      const known = this.lastProbeByAgent.get(agent.id) ?? peekAcpProbe(this.probeCacheKey(agent));
      const baseModelId = `${ACP_PROVIDER_ID}/${agent.id}`;
      const label = agent.label ?? agent.id;
      const capabilities: DiscoveredModel['capabilities'] = known?.supportsImages
        ? ['chat', 'code', 'reasoning', 'vision']
        : ['chat', 'code', 'reasoning'];

      const base: DiscoveredModel = {
        id: baseModelId,
        name: label,
        // Subscription-backed: priced at zero per token, which is *why* the router
        // must not let it win budget mode by default — that gate lives in
        // modelRouter's subscription handling, not here.
        inputPricePer1k: 0,
        outputPricePer1k: 0,
        capabilities,
      };

      // One row per effort level the agent actually offers. Read from the cached
      // probe for the same reason `vision` is: this runs on every render of every
      // surface that lists models, and a process per render is not a price a
      // capability list should cost. Before the agent has been probed there is
      // one row — the agent's own default — which is the conservative direction:
      // a variant wrongly offered would route a turn to an effort the agent never
      // agreed to, while one wrongly withheld merely runs at the default.
      const tiers = acpEffortTiersFor(known?.configOptions ?? []);
      // The models this agent offers *today*, read from the same probe. Nothing
      // here names a model that must exist: a hardcoded roster would be wrong
      // within weeks and wrong in the worst direction — a model the user is
      // paying for, invisible to the router.
      const models = acpModelChoicesFor(known?.configOptions ?? [], this.modelStanding());

      // With no model knob the agent keeps its original shape: one base row plus
      // an effort ladder. Adding an empty model dimension would rename every
      // existing row for no gain and invalidate anyone's pinned model id.
      if (models.length === 0) {
        return [
          base,
          ...tiers.map(tier => ({
            id: buildAcpModelVariantId(baseModelId, tier),
            name: `${label} (${tier.label} effort)`,
            inputPricePer1k: 0,
            outputPricePer1k: 0,
            capabilities,
            // What the router already knows how to reason about. `reasoningDepth`
            // drives task-fit scoring and `premiumRequestMultiplier` drives the
            // budget gate, so the effort gradient falls out of existing machinery
            // rather than needing a parallel one. Both come from a declared table
            // — `ACP_EFFORT_RULE_NOTE`, published on the provider card.
            reasoningDepth: tier.reasoningDepth,
            premiumRequestMultiplier: tier.premiumRequestMultiplier,
          })),
        ];
      }

      // Model × effort, capped and ordered so truncation costs every *effort*
      // before it costs any *model*. Both dimensions are real knobs on the same
      // session, so the cross product is what lets the router ask for the deep
      // model at low effort — a combination neither dimension can express alone.
      return [
        base,
        ...acpModelRows(models, tiers).map(({ model, effort }) => {
          const composed = composeAcpVariant(model, effort);
          const modelId = buildAcpModelId(baseModelId, model);
          return {
            id: effort ? buildAcpModelVariantId(modelId, effort) : modelId,
            // The agent's own name for the model, plus the standing that decided
            // its routing weight — including when that standing is unknown, so a
            // row nobody ranked does not look like one somebody did.
            name: effort
              ? `${label} · ${model.name} (${effort.label} effort)`
              : `${label} · ${model.name} (${describeAcpModelStanding(model.standing)})`,
            inputPricePer1k: 0,
            outputPricePer1k: 0,
            capabilities,
            ...composed,
          };
        }),
      ];
    });
  }

  /** The user's declared model standings; a throwing getter degrades to none. */
  private modelStanding(): Record<string, string> {
    try {
      const declared = this.options?.modelStanding?.();
      return declared && typeof declared === 'object' ? declared : {};
    } catch {
      return {};
    }
  }

  /**
   * The model choice a slug names, for the agent that offers it.
   *
   * Resolved against the cached probe rather than a fresh session: this runs on
   * the execute path, where a spawn to re-read a list we already have would add
   * seconds to every turn. An unknown slug yields nothing and the turn runs on
   * the agent's own model — the conservative direction, since the alternative is
   * refusing a turn over a knob.
   */
  private resolveModelChoice(agent: AcpAgentConfig, slug: string | undefined): AcpModelChoice | undefined {
    if (!slug) {
      return undefined;
    }
    const known = this.lastProbeByAgent.get(agent.id) ?? peekAcpProbe(this.probeCacheKey(agent));
    return acpModelChoicesFor(known?.configOptions ?? [], this.modelStanding())
      .find(model => model.slug === slug);
  }

  /**
   * Healthy when **any** configured agent can be used.
   *
   * This used to probe `agents[0]` and report its answer as the provider's,
   * which is wrong in both directions once more than one agent is configured:
   * a broken first agent condemned a working second one, and a working first
   * agent vouched for a second that was never contacted. Order in a settings
   * array is not a statement about which subscription matters.
   *
   * `probeAll` is what the per-agent surfaces read, so the vendor rows can say
   * which agent is actually answering instead of inheriting this one flag.
   */
  async healthCheck(): Promise<boolean> {
    const results = await this.probeAll();
    return results.some(entry => entry.result.installed && entry.result.authenticated);
  }

  /**
   * Probe every configured agent, concurrently.
   *
   * Concurrent because these are serial seconds otherwise — a `session/new`
   * round trip is several seconds per agent, and the startup discovery budget
   * this runs inside is finite. Two agents probed in sequence overran it, the
   * timeout marked the provider unhealthy, and nothing re-probed afterwards.
   */
  async probeAll(): Promise<Array<{ agent: AcpAgentConfig; result: AcpProbeResult }>> {
    const agents = this.agents();
    return Promise.all(agents.map(async agent => ({ agent, result: await this.probe(agent) })));
  }

  /**
   * Handshake with an agent to find out whether it is installed, speaks our
   * protocol version, and is logged in.
   *
   * TTL-cached, because read-only callers (the Models
   * tree, the Project Dashboard, the provider panel) re-probe on every render,
   * and each probe here spawns a process.
   */
  async probe(agent?: AcpAgentConfig): Promise<AcpProbeResult> {
    const target = agent ?? this.agents()[0];
    if (!target) {
      return {
        installed: false,
        authenticated: false,
        message: 'No ACP agent is configured. Add one under atlasmind.acp.agents with the command you have installed.',
      };
    }

    const cacheKey = this.probeCacheKey(target);
    // A fake process factory means a test; caching across tests would leak state.
    const cacheable = !this.options?.spawnProcess;
    if (cacheable) {
      const cached = acpProbeCache.get(cacheKey);
      if (cached && Date.now() - cached.at < ACP_PROBE_TTL_MS) {
        return cached.result;
      }
    }

    const result = await this.handshakeOnly(target);
    // Always recorded on the instance; only shared when caching is on.
    this.lastProbeByAgent.set(target.id, result);
    if (cacheable) {
      acpProbeCache.set(cacheKey, { at: Date.now(), result });
      acpAgentProbes.set(target.id, { at: Date.now(), result });
    }
    return result;
  }

  private probeCacheKey(agent: AcpAgentConfig): string {
    return `${agent.command}|${(agent.args ?? []).join(' ')}|${this.options?.cwd ?? ''}`;
  }

  private agents(): AcpAgentConfig[] {
    const configured = this.options?.agents;
    // A throwing getter must not take down a health check or a turn: it degrades
    // to "no agents", which is the same thing an unconfigured install reports.
    let resolved: AcpAgentConfig[];
    try {
      resolved = typeof configured === 'function' ? configured() : (configured ?? []);
    } catch {
      resolved = [];
    }
    return (Array.isArray(resolved) ? resolved : []).filter(agent => agent && agent.id && agent.command);
  }

  /**
   * The agent a model id names, plus the model and effort it asks for.
   *
   * `acp/claude@opus#high` is one agent, one model, one effort. **Both suffixes
   * are stripped before the agent lookup** — an id still carrying either would
   * match no configured agent and fall through to `agents[0]`, quietly running
   * the turn on somebody else's subscription. The model segment is separated
   * first because it sits between the agent and the effort.
   */
  private resolveAgent(model: string): {
    agent: AcpAgentConfig;
    effort?: AcpEffortTier;
    modelChoice?: AcpModelChoice;
  } | undefined {
    const { withoutModel, modelSlug } = splitAcpModelSegment(model);
    const { baseModelId, effort } = parseAcpModelVariant(withoutModel);
    const wanted = baseModelId.startsWith(`${ACP_PROVIDER_ID}/`)
      ? baseModelId.slice(ACP_PROVIDER_ID.length + 1)
      : baseModelId;
    const agents = this.agents();
    const agent = agents.find(entry => entry.id === wanted) ?? agents[0];
    if (!agent) {
      return undefined;
    }
    const modelChoice = this.resolveModelChoice(agent, modelSlug);
    return {
      agent,
      ...(effort ? { effort } : {}),
      ...(modelChoice ? { modelChoice } : {}),
    };
  }

  private async handshakeOnly(agent: AcpAgentConfig): Promise<AcpProbeResult> {
    let session: AcpSession | undefined;
    try {
      session = new AcpSession(agent, this.spawnFactory(), this.options?.cwd, this.clientVersion(), PROBE_TIMEOUT_MS);
      const initialized = await session.initialize();
      if (!initialized.compatible) {
        return {
          installed: true,
          authenticated: false,
          protocolVersion: initialized.protocolVersion,
          command: agent.command,
          message: `${agent.command} speaks ACP version ${initialized.protocolVersion}; AtlasMind speaks ${ACP_PROTOCOL_VERSION}. Update the agent, or use a version that matches.`,
        };
      }
      // Whether the agent is signed in can only be found out by asking it to do
      // something that needs a login, so the probe **creates a session**. The
      // list of auth methods cannot answer it: `codex-acp` advertises `api-key`
      // and `chat-gpt` on every handshake, signed in or not, so reading a
      // non-empty list as "not authenticated" refused every working ChatGPT
      // subscription. See ACP_ERROR_AUTH_REQUIRED.
      //
      // The session is thrown away immediately, and this costs one extra
      // round-trip on a probe that is already TTL-cached. What it buys is worth
      // more than the round-trip: the probe now reports that the agent can
      // actually be used, rather than that it started.
      // The probe is only ever a completion-capability check, so it isolates
      // unconditionally: nothing it does needs the machine's settings, and it
      // is the call that runs most often.
      const authenticated = await session.canCreateSession({ isolateAgentSettings: true });
      return {
        installed: true,
        authenticated: authenticated.ok,
        protocolVersion: initialized.protocolVersion,
        ...(initialized.agentName ? { agentName: initialized.agentName } : {}),
        command: agent.command,
        supportsImages: initialized.supportsImages,
        supportsAudio: initialized.supportsAudio,
        // Only meaningful when a session actually opened — `canCreateSession`
        // is what populates them, and an agent that refused has told us nothing
        // about what it would have let us configure.
        ...(authenticated.ok ? { configOptions: session.getConfigOptions() } : {}),
        ...(authenticated.ok
          ? {}
          : { message: authenticated.authRequired
            ? `${agent.command} is installed but not signed in. Use the agent's own login flow${initialized.authMethods.length > 0 ? ` (${initialized.authMethods.join(', ')})` : ''} — AtlasMind never handles that credential.`
            : `${agent.command} started but could not open a session: ${authenticated.message}` }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missing = /ENOENT|not recognized|command not found/i.test(message);
      return {
        installed: !missing,
        authenticated: false,
        command: agent.command,
        message: missing
          ? `${agent.command} was not found on PATH. Install the ACP agent you want to use, then set its command in atlasmind.acp.agents.`
          : `${agent.command} could not be started: ${message.slice(0, 300)}`,
      };
    } finally {
      // The probe's session is thrown away immediately, and what it started is
      // not small — closing it first lets the agent reap its own tree instead
      // of leaving it orphaned when we kill the parent.
      await session?.closeSession();
      session?.dispose();
    }
  }

  private async run(request: CompletionRequest, onTextChunk: ((chunk: string) => void) | undefined): Promise<CompletionResponse> {
    const resolved = this.resolveAgent(request.model);
    if (!resolved) {
      throw new Error('No ACP agent is configured. Add one under atlasmind.acp.agents.');
    }
    const { agent, effort, modelChoice } = resolved;

    // Two different things are called "tools", and conflating them is the trap.
    //
    // `request.tools` is AtlasMind's own function-calling loop: here are schemas,
    // call one, hand back `toolCalls`, and the Orchestrator runs it. ACP has no
    // channel for that — a client cannot inject function definitions into an
    // agent's turn — so this stays refused however much of Tier 3 is enabled.
    //
    // What Tier 3 adds is the *agent's* tools: its own built-ins plus any MCP
    // servers passed at session/new, executed inside the agent and authorized
    // one at a time through `session/request_permission`. That is the
    // Orchestrator standing down and delegating, not nesting its loop inside
    // another one.
    if (request.tools && request.tools.length > 0) {
      throw new Error('ACP agents cannot run AtlasMind\'s own tool definitions — the protocol has no way to pass them in. The agent executes its own tools instead, gated by approval. Route function-calling tasks to a provider that supports them.');
    }

    const session = new AcpSession(
      agent,
      this.spawnFactory(),
      this.options?.cwd,
      this.clientVersion(),
      this.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      this.options?.permissionPolicy,
      this.options?.onToolEvent,
    );
    try {
      const initialized = await session.initialize();
      if (!initialized.compatible) {
        throw new Error(`${agent.command} speaks ACP version ${initialized.protocolVersion}, but AtlasMind speaks ${ACP_PROTOCOL_VERSION}.`);
      }
      // Deliberately no check on `initialized.authMethods` here. It lists the
      // logins the agent *offers*, not the ones this user still owes, and
      // refusing on a non-empty list is what made the Codex path unusable for
      // signed-in users. If a login really is required, `session/new` says so
      // with ACP_ERROR_AUTH_REQUIRED and that is turned into the message below.
      //
      // A getter that throws must not silently become "no servers" — but it also
      // must not take down a turn, so it degrades to the deny-by-default empty
      // list, which is the same thing an unconfigured install sends.
      let mcpServers: AcpMcpServer[] = [];
      try {
        mcpServers = this.options?.getMcpServers?.() ?? [];
      } catch {
        mcpServers = [];
      }
      try {
        // Isolate the agent from the machine's own settings **only** while it
        // is a completion source. `mcpServers` is empty exactly when delegated
        // execution is off (the getter returns [] unless `acp.toolsEnabled`),
        // so it is the honest signal for which mode this turn is in — and it
        // keeps the decision next to the thing it is about rather than reading
        // a setting from inside the adapter.
        await session.newSession(mcpServers, { isolateAgentSettings: mcpServers.length === 0 });
      } catch (error) {
        // A login the user has to perform is not the same failure as a broken
        // agent, and saying so is the difference between an actionable message
        // and "something went wrong".
        if (error instanceof AcpAuthRequiredError) {
          throw new Error(
            `${agent.command} needs you to sign in before it will answer. Run it once in a terminal and follow its own login`
            + `${initialized.authMethods.length > 0 ? ` (${initialized.authMethods.join(', ')})` : ''}. AtlasMind never handles that credential.`,
          );
        }
        throw error;
      }

      // Ask for the effort this model id names, before the prompt goes out.
      //
      // A failure here does **not** fail the turn: the agent answers at its own
      // default, which is a worse answer than requested but still an answer, and
      // aborting over a knob would turn a degraded turn into no turn. It is
      // reported rather than swallowed, because the router priced this turn at
      // this tier's multiplier — so a silent fallback would bill max effort for
      // a low-effort run, and nobody would ever find out.
      // The model first, then the effort. Order matters against agents that
      // reset dependent knobs when the model changes — a model switch applied
      // *after* the effort would silently discard it, which is the same
      // looks-like-success failure the category rule exists to prevent.
      //
      // Reported on the same channel as effort and for the same reason: the
      // router priced this turn as the requested model, so falling back to the
      // agent's own without saying so would bill an Opus turn for a Haiku run.
      if (modelChoice) {
        const applied = await session.setConfigOption(ACP_MODEL_CATEGORY, modelChoice.value);
        if (!applied.ok) {
          this.options?.onEffortNotApplied?.({
            agentId: agent.id,
            requested: `model ${modelChoice.name}`,
            reason: applied.reason ?? 'unknown',
          });
        }
      }

      if (effort) {
        const applied = await session.setConfigOption(ACP_EFFORT_CATEGORY, effort.value);
        if (!applied.ok) {
          this.options?.onEffortNotApplied?.({
            agentId: agent.id,
            requested: effort.value,
            reason: applied.reason ?? 'unknown',
          });
        }
      }

      const turn = await session.prompt(buildPromptBlocks(request, initialized), onTextChunk, request.signal);
      return {
        content: turn.text,
        model: request.model,
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        finishReason: turn.finishReason,
      };
    } finally {
      await session.closeSession();
      session.dispose();
    }
  }

  private clientVersion(): string {
    return this.options?.clientVersion ?? '0.0.0';
  }

  private spawnFactory(): AcpProcessFactory {
    return this.options?.spawnProcess ?? defaultAcpProcessFactory;
  }
}

const acpProbeCache = new Map<string, { at: number; result: AcpProbeResult }>();

/**
 * Read a cached probe without triggering one.
 *
 * `discoverModels` needs to know whether the agent takes images, but it is
 * called on every render of every surface that lists models. Spawning there
 * would make a capability list cost a process each time, so this returns what is
 * already known and `undefined` otherwise.
 */
function peekAcpProbe(cacheKey: string): AcpProbeResult | undefined {
  const cached = acpProbeCache.get(cacheKey);
  return cached && Date.now() - cached.at < ACP_PROBE_TTL_MS ? cached.result : undefined;
}

/**
 * The last probe of each agent, by agent id.
 *
 * Deliberately a second map rather than a lookup into {@link acpProbeCache},
 * whose key is `command|args|cwd` — a synchronous caller like a tree row knows
 * the agent id and nothing else, and reconstructing that key from a workspace
 * cwd it may not have would fail silently by returning "never probed".
 *
 * Held **without a TTL**, unlike the probe cache. The two answer different
 * questions: the probe cache asks "may I skip spawning a process right now?",
 * where staleness costs a wrong capability list for ten seconds; this asks
 * "what is the last thing this agent told us?", where expiring the answer means
 * a tree row reporting *unknown* every ten seconds for an agent that is working
 * fine. The last known answer is the honest one until a newer one arrives.
 */
const acpAgentProbes = new Map<string, { at: number; result: AcpProbeResult }>();

/**
 * What this agent said last time it was asked, without asking again.
 *
 * Returns `undefined` for an agent that has never been probed — which callers
 * must render as *not yet checked*, not as *failing*. Saying an agent is not
 * responding before contacting it is the misreport this whole path exists to
 * stop.
 */
export function peekAcpAgentProbe(agentId: string): AcpProbeResult | undefined {
  return acpAgentProbes.get(agentId)?.result;
}

/** Exported for tests: clears the probe TTL cache. */
export function resetAcpProbeCache(): void {
  acpProbeCache.clear();
  acpAgentProbes.clear();
}

/**
 * Turn AtlasMind's chat messages into ACP content blocks.
 *
 * The whole conversation goes in one prompt because this tier does not reuse
 * sessions — the spec's own ecosystem notes warn that session resume is not
 * universally supported, so designing around it would be building on sand.
 * Crucially there is **no character budget**: the argv ceiling that forced the
 * old CLI bridge to truncate does not exist over stdio.
 */
export function buildPromptBlocks(request: CompletionRequest, agent: Pick<AcpInitializeResult, 'supportsImages'>): AcpPromptBlock[] {
  const blocks: AcpPromptBlock[] = [];
  const transcript: string[] = [];
  const images: AcpPromptBlock[] = [];
  let droppedImages = 0;

  for (const message of request.messages) {
    if (message.role === 'system') {
      transcript.push(`System instructions:\n${message.content}`);
      continue;
    }
    if (message.role === 'tool') {
      // Restricted mode means no tool loop; a stray tool message is history.
      transcript.push(`Tool result (${message.toolName ?? 'unknown'}):\n${message.content}`);
      continue;
    }
    transcript.push(`${message.role === 'assistant' ? 'Assistant' : 'User'}:\n${message.content}`);

    for (const image of message.images ?? []) {
      if (!agent.supportsImages) {
        droppedImages += 1;
        continue;
      }
      images.push({ type: 'image', data: image.dataBase64, mimeType: image.mimeType });
    }
  }

  if (droppedImages > 0) {
    transcript.push(`(${droppedImages} image attachment${droppedImages === 1 ? '' : 's'} omitted: this ACP agent does not declare image support.)`);
  }

  blocks.push({ type: 'text', text: transcript.join('\n\n') });
  blocks.push(...images);
  return blocks;
}

/**
 * One prompt turn against one agent process.
 *
 * Owns the JSON-RPC id counter, the pending-request table, and the stdout
 * framing buffer. A session is single-use: spawn, handshake, prompt, dispose.
 */
class AcpSession {
  private readonly process: AcpProcessHandle;
  private nextId = 1;
  private buffer = '';
  private stderr = '';
  private sessionId = '';
  private configOptions: AcpConfigOption[] = [];
  /** Set from the handshake; a close sent to an agent that never offered one is noise. */
  private supportsClose = false;
  private readonly processPid: number | undefined;
  private exited: { code: number | null; signal: string | null } | undefined;
  private disposed = false;
  private readonly pending = new Map<number, { resolve: (result: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private onText: ((chunk: string) => void) | undefined;
  private text = '';
  /** Latest reported context occupancy. Diagnostic; never billed. */
  private context: { usedTokens?: number; windowTokens?: number } = {};

  constructor(
    private readonly agent: AcpAgentConfig,
    spawnProcess: AcpProcessFactory,
    private readonly cwd: string | undefined,
    private readonly clientVersion: string,
    private readonly timeoutMs: number,
    private readonly permissionPolicy?: AcpPermissionPolicy,
    private readonly onToolEvent?: AcpToolEventListener,
  ) {
    this.process = spawnProcess(agent, cwd);
    this.processPid = this.process.pid;
    this.process.onStdout(chunk => this.ingest(chunk));
    // stderr is diagnostic only — kept bounded so a chatty agent cannot grow
    // the heap, and surfaced only when something actually fails.
    this.process.onStderr(chunk => { this.stderr = (this.stderr + chunk).slice(-4_000); });
    this.process.onExit((code, signal) => {
      this.exited = { code, signal };
      const reason = new Error(`The ACP agent exited (${signal ?? `code ${code ?? 'unknown'}`}).${this.stderr ? ` ${this.stderr.trim().slice(-500)}` : ''}`);
      for (const [, entry] of this.pending) {
        entry.reject(reason);
      }
      this.pending.clear();
    });
  }

  async initialize(): Promise<AcpInitializeResult> {
    const result = await this.request(buildInitializeRequest(this.nextId, this.clientVersion));
    const parsed = parseInitializeResult(result);
    this.supportsClose = parsed.supportsSessionClose;
    return parsed;
  }

  async newSession(mcpServers: AcpMcpServer[], options?: { isolateAgentSettings?: boolean }): Promise<void> {
    // The spec requires an absolute cwd. Falling back to the process cwd is
    // correct and observable; inventing a path would not be.
    const cwd = this.cwd ?? process.cwd();
    const result = await this.request(buildSessionNewRequest(this.nextId, cwd, mcpServers, options));
    this.sessionId = parseSessionId(result);
    if (!this.sessionId) {
      throw new Error('The ACP agent did not return a session id.');
    }
    // Kept, not discarded. These are the knobs the agent will let us turn, and
    // which id names each one differs per agent — so the set request cannot be
    // built without them.
    this.configOptions = parseSessionConfigOptions(result);
  }

  /** What this session said it would let us configure. Empty until `newSession`. */
  getConfigOptions(): AcpConfigOption[] {
    return this.configOptions;
  }

  /**
   * Set one config option, refusing any category outside the allowlist.
   *
   * The refusal is the point rather than a formality: the same `configOptions`
   * array carries the agent's **permission** mode, whose values include
   * `agent-full-access` and `bypassPermissions`. A method that could set those
   * would route around `toolApprovalManager` entirely — so the check lives here,
   * at the one place a set request is built, rather than at each caller.
   *
   * Reports rather than throws. A turn that ran at the agent's default effort
   * produced an answer; a turn aborted over a knob did not.
   */
  async setConfigOption(category: string, value: string): Promise<{ ok: boolean; reason?: string }> {
    if (!isSettableAcpConfigCategory(category)) {
      return { ok: false, reason: `AtlasMind does not set ACP config options in the "${category}" category.` };
    }
    if (!this.sessionId) {
      return { ok: false, reason: 'No ACP session is open.' };
    }
    const option = this.configOptions.find(entry => entry.category === category);
    if (!option) {
      return { ok: false, reason: `This agent offers no "${category}" option.` };
    }
    if (!option.options.some(entry => entry.value === value)) {
      return { ok: false, reason: `This agent does not offer "${value}" for "${category}".` };
    }
    try {
      const result = await this.request(
        buildSetConfigOptionRequest(this.nextId, this.sessionId, option.id, value),
      );
      // The response echoes the full set back, so the new value is *confirmed*
      // rather than assumed. An agent that accepted the request and ignored it
      // would otherwise be indistinguishable from one that applied it.
      this.configOptions = parseSessionConfigOptions(result);
      const applied = this.configOptions.find(entry => entry.id === option.id);
      return applied?.currentValue === value
        ? { ok: true }
        : { ok: false, reason: `The agent reported "${applied?.currentValue ?? 'nothing'}" after being asked for "${value}".` };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Whether this agent will open a session for us — the only honest test of
   * "signed in".
   *
   * Reports rather than throws, because the probe's job is to describe what it
   * found. `authRequired` is kept separate from every other failure so the
   * caller can say "sign in" where that is the answer and not where it is not:
   * a crashed agent reported as an authentication problem sends the user to a
   * login screen that will not help.
   */
  async canCreateSession(options?: { isolateAgentSettings?: boolean }): Promise<{ ok: boolean; authRequired: boolean; message: string }> {
    try {
      await this.newSession([], options);
      return { ok: true, authRequired: false, message: '' };
    } catch (error) {
      if (error instanceof AcpAuthRequiredError) {
        return { ok: false, authRequired: true, message: error.message };
      }
      return {
        ok: false,
        authRequired: false,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      };
    }
  }

  async prompt(
    blocks: AcpPromptBlock[],
    onTextChunk: ((chunk: string) => void) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<AcpTurnResult> {
    this.onText = onTextChunk;
    this.text = '';

    const abort = () => {
      if (this.sessionId) {
        this.send(buildSessionCancelNotification(this.sessionId));
      }
    };
    signal?.addEventListener('abort', abort, { once: true });

    try {
      const result = await this.request(buildSessionPromptRequest(this.nextId, this.sessionId, blocks));
      const stop = parseStopReason(result);
      // Token counts come off the prompt **result**, which is where every agent
      // actually reports them. The `usage_update` notification carries context
      // occupancy instead — reading input/output tokens out of it was why every
      // ACP turn used to be recorded as costing nothing at all.
      const usage = parsePromptUsage(result);
      return {
        text: this.text,
        finishReason: toFinishReason(stop),
        // Absent counts are reported as 0 rather than estimated: a fabricated
        // token count would feed the cost tracker a number nobody measured.
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      };
    } finally {
      signal?.removeEventListener('abort', abort);
      this.onText = undefined;
    }
  }

  /**
   * Ask the agent to close the session, then let the caller dispose.
   *
   * Sent before the kill because a `session/new` on a coding agent is not a
   * lightweight object. Measured on this machine: `claude-agent-acp` starts the
   * user's entire configured MCP fleet inside the session — `gk.exe mcp`, an
   * `npx @azure/mcp` tree, a `contrast-checker-mcp` tree, several of them via
   * `cmd.exe`, each of which makes Windows allocate a `conhost.exe`.
   * `codex-acp` starts an `app-server` plus a REPL host. Killing our direct
   * child orphans all of that to be reaped by the OS.
   *
   * Best-effort by construction: bounded by its own short timeout and never
   * throwing, because this runs on the teardown path where the only thing worse
   * than an unclosed session is a hang while closing one.
   */
  async closeSession(): Promise<void> {
    if (!this.sessionId || this.disposed || this.exited || !this.supportsClose) {
      return;
    }
    const sessionId = this.sessionId;
    this.sessionId = '';
    try {
      await Promise.race([
        this.request(buildSessionCloseRequest(this.nextId, sessionId)),
        new Promise(resolve => setTimeout(resolve, SESSION_CLOSE_TIMEOUT_MS)),
      ]);
    } catch {
      // The process is going away regardless.
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.pending.clear();
    if (!this.exited) {
      try {
        this.process.kill();
      } catch {
        // Already gone.
      }
      this.killProcessTree();
    }
  }

  /**
   * On Windows, make sure the agent's *children* die too.
   *
   * `child.kill()` signals one process. POSIX callers can reach a whole tree
   * through the process group, but Windows has no group concept — so an agent
   * that shelled out (and this one shells out a lot) leaves its descendants
   * running after we kill it. `session/close` normally unwinds them first;
   * this is the backstop for when it does not, because an agent that never
   * advertised `close`, or failed it, would otherwise leak a process tree per
   * turn. `taskkill /T` walks the tree, `/F` because a graceful signal is not
   * a thing it can send.
   *
   * Fire-and-forget and never throws: every caller is already on a
   * "make it dead" path, where a process that is *already* gone is success.
   * The approach is the one `acp-patchbay` arrived at independently.
   */
  private killProcessTree(): void {
    if (process.platform !== 'win32') {
      return;
    }
    const pid = this.processPid;
    if (pid === undefined) {
      return;
    }
    try {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => { /* already gone is success */ });
    } catch {
      // Nothing left to do on a teardown path.
    }
  }

  private request(frame: ReturnType<typeof buildInitializeRequest>): Promise<Record<string, unknown>> {
    const id = frame.id;
    this.nextId = id + 1;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The ACP agent did not answer ${frame.method} within ${Math.round(this.timeoutMs / 1000)}s.`));
      }, this.timeoutMs);
      const settle = {
        resolve: (result: Record<string, unknown>) => { clearTimeout(timer); resolve(result); },
        reject: (error: Error) => { clearTimeout(timer); reject(error); },
      };
      this.pending.set(id, settle);
      try {
        this.send(frame);
      } catch (error) {
        this.pending.delete(id);
        settle.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private send(frame: Parameters<typeof encodeAcpFrame>[0]): void {
    this.process.writeLine(encodeAcpFrame(frame));
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    const { lines, rest } = drainFrames(this.buffer);
    this.buffer = rest;
    for (const line of lines) {
      this.handleFrame(line);
    }
  }

  private handleFrame(line: string): void {
    const frame = parseAcpFrame(line);
    switch (frame.kind) {
      case 'response': {
        this.pending.get(frame.id)?.resolve(frame.result);
        this.pending.delete(frame.id);
        return;
      }
      case 'error': {
        this.pending.get(frame.id)?.reject(frame.code === ACP_ERROR_AUTH_REQUIRED
          ? new AcpAuthRequiredError(frame.message)
          : new Error(`The ACP agent returned an error (${frame.code}): ${frame.message}`));
        this.pending.delete(frame.id);
        return;
      }
      case 'notification': {
        if (frame.method === 'session/update') {
          this.applyUpdate(frame.params);
        }
        return;
      }
      case 'request': {
        // The agent is asking AtlasMind for something. `session/request_permission`
        // is the one method with an answer; everything else (fs/*, terminal/*,
        // elicitation/*) is refused, because AtlasMind declared it cannot do
        // those in `initialize` and an agent asking anyway is not a reason to
        // start.
        if (frame.method === ACP_PERMISSION_METHOD) {
          void this.answerPermission(frame.id, frame.params);
          return;
        }
        this.rejectAgentRequest(frame.id, frame.method);
        return;
      }
      default:
        // Unusable line (a banner, a partial, a malformed frame) — ignored by
        // design; a subprocess writing prose to stdout must not fail a turn.
        return;
    }
  }

  /**
   * Answer a `session/request_permission` request.
   *
   * The order of the guards is the policy. Before anything is asked of the user
   * the request must be *readable*, and before any approval can be granted a
   * policy must *exist* — a missing gate is a denial, never an open door. Only
   * then does the decision reach the user, and only an explicit `true` can
   * produce a selection of an allow option.
   *
   * Nothing here throws. This runs on the stdout read loop, where an exception
   * would strand the turn holding a permission the agent is still waiting on;
   * a failure to decide has to become a refusal on the wire instead.
   */
  private async answerPermission(id: number, params: Record<string, unknown>): Promise<void> {
    let request: AcpPermissionRequest | undefined;
    try {
      request = parsePermissionRequest(params);
    } catch {
      request = undefined;
    }

    if (!request) {
      this.rejectAgentRequestWith(id, 'AtlasMind could not read that permission request, so it was refused.');
      return;
    }

    // Announce the pending call before prompting: the approval dialog is about
    // to describe it, and the run log should already show what was asked.
    this.emitToolEvent(request.toolCall);

    if (!this.permissionPolicy) {
      this.rejectAgentRequestWith(
        id,
        'AtlasMind is running this agent without tool authorization enabled, so the operation was declined.',
      );
      return;
    }

    let approved = false;
    try {
      approved = await this.permissionPolicy(request) === true;
    } catch {
      // A gate that failed is a gate that did not approve.
      approved = false;
    }

    if (this.disposed) {
      return;
    }

    const resolution = resolveAcpPermission(request, approved);
    if (resolution.action === 'select') {
      this.process.writeLine(buildPermissionSelectedResponse(id, resolution.optionId));
      return;
    }
    if (resolution.action === 'cancelled') {
      this.process.writeLine(buildPermissionCancelledResponse(id));
      return;
    }
    this.rejectAgentRequestWith(id, resolution.message);
  }

  private emitToolEvent(toolCall: AcpToolCall): void {
    try {
      this.onToolEvent?.(toolCall);
    } catch {
      // A listener that throws must not take the turn down with it.
    }
  }

  /** JSON-RPC error reply: this client does not implement the method. */
  private rejectAgentRequest(id: number, method: string): void {
    this.process.writeLine(`${JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `AtlasMind runs ACP agents in restricted mode and does not implement ${method}.`,
      },
    })}\n`);
  }

  /**
   * JSON-RPC error reply for a request we understood but will not grant.
   *
   * `-32603` (internal error) rather than `-32601`: the method exists and was
   * handled — the answer is no. Reporting "method not found" for a refusal would
   * invite an agent to conclude the client is too old and retry differently.
   */
  private rejectAgentRequestWith(id: number, message: string): void {
    this.process.writeLine(`${JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message },
    })}\n`);
  }

  private applyUpdate(params: Record<string, unknown>): void {
    const update = parseSessionUpdate(params);
    if (update.kind === 'text') {
      this.text += update.text;
      this.onText?.(update.text);
      return;
    }
    if (update.kind === 'tool_call') {
      this.emitToolEvent(update.toolCall);
      return;
    }
    if (update.kind === 'context') {
      // Context occupancy, not the turn's bill. Kept for the run log's benefit
      // and deliberately **not** folded into the token counts — `used` is a
      // cumulative context total, so charging it as this turn's input tokens
      // would bill the whole conversation again on every message.
      this.context = {
        ...(update.usedTokens === undefined ? {} : { usedTokens: update.usedTokens }),
        ...(update.windowTokens === undefined ? {} : { windowTokens: update.windowTokens }),
      };
    }
  }
}

/**
 * The agent requires a login before it will do this.
 *
 * A distinct type rather than a string match on a message, because the two
 * callers need to act differently — the probe reports "not signed in", a turn
 * tells the user which login to run — and matching on wording would break the
 * moment an agent rephrased its error.
 */
export class AcpAuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpAuthRequiredError';
  }
}

/**
 * Spawn the agent for real. Never through a shell, and never installed by us.
 *
 * The command is resolved through {@link resolveAcpLaunch} first, because on
 * Windows spawning it by name simply does not work: every published ACP adapter
 * is an npm `bin`, and an npm `bin` on Windows is a shim that
 * `spawn(…, { shell: false })` cannot execute. That failure surfaced as
 * `spawn claude-agent-acp ENOENT`, which reads as "you have not installed it" to
 * a user who has — so the resolution failure carries a written explanation
 * instead.
 */
const defaultAcpProcessFactory: AcpProcessFactory = (config, cwd) => {
  const launch = resolveAcpLaunch(config, createAcpLaunchProbe());
  if (launch.status === 'unresolved') {
    throw new Error(launch.reason);
  }

  const child: ChildProcessWithoutNullStreams = spawn(launch.command, launch.args, {
    cwd,
    windowsHide: true,
    shell: false,
    env: { ...process.env, ...(config.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return {
    pid: child.pid,
    writeLine: line => { child.stdin.write(line); },
    onStdout: listener => { child.stdout.on('data', listener); },
    onStderr: listener => { child.stderr.on('data', listener); },
    onExit: listener => {
      child.on('close', (code, signal) => listener(code, signal));
      child.on('error', error => listener(null, error.message));
    },
    kill: () => { child.kill(); },
  };
};

/** Read the user's configured agents, falling back to nothing (deny by default). */
export function parseAcpAgentSettings(raw: unknown): AcpAgentConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const agents: AcpAgentConfig[] = [];
  const seen = new Set<string>();
  for (const entry of raw.slice(0, 12)) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record['id'] === 'string' ? record['id'].trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) : '';
    const command = typeof record['command'] === 'string' ? record['command'].trim().slice(0, 400) : '';
    if (!id || !command || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const args = Array.isArray(record['args'])
      ? record['args'].filter((arg): arg is string => typeof arg === 'string').slice(0, 20).map(arg => arg.slice(0, 400))
      : [];
    const env: Record<string, string> = {};
    if (typeof record['env'] === 'object' && record['env'] !== null) {
      for (const [key, value] of Object.entries(record['env'] as Record<string, unknown>).slice(0, 20)) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string') {
          env[key] = value.slice(0, 2_000);
        }
      }
    }
    agents.push({
      id,
      command,
      args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(typeof record['label'] === 'string' ? { label: record['label'].slice(0, 80) } : {}),
    });
  }
  return agents;
}
