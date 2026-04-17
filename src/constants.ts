/**
 * AtlasMind – centralised tunable constants.
 *
 * Every cap, limit, and default that was previously scattered across source
 * files now lives here so the values are discoverable, adjustable, and
 * testable from a single location.
 */

// ── Orchestrator ─────────────────────────────────────────────────

/** Maximum agentic loop iterations before forcing a stop. */
export const MAX_TOOL_ITERATIONS = 15;

/** Maximum number of tool calls accepted in a single model turn. */
export const MAX_TOOL_CALLS_PER_TURN = 8;

/** Maximum number of tool executions running in parallel. */
export const MAX_PARALLEL_TOOL_EXECUTIONS = 3;

/** Per-tool execution timeout in milliseconds. */
export const TOOL_EXECUTION_TIMEOUT_MS = 15_000;

/** Provider call timeout in milliseconds. */
export const PROVIDER_TIMEOUT_MS = 30_000;

/** Number of retries for transient provider failures. */
export const MAX_PROVIDER_RETRIES = 2;

/** Exponential backoff base for provider retries in milliseconds. */
export const PROVIDER_RETRY_BASE_DELAY_MS = 400;

// ── Planner ──────────────────────────────────────────────────────

/** Maximum subtasks the planner will accept from a single LLM response. */
export const MAX_SUBTASKS = 20;

// ── Task Scheduler ───────────────────────────────────────────────

/** Maximum concurrent subtask executions per batch within the scheduler. */
export const MAX_SCHEDULER_CONCURRENCY = 5;

// ── Memory ───────────────────────────────────────────────────────

/** Dimension length for hashed mini-embeddings. */
export const EMBEDDING_DIMENSIONS = 96;

/** Hard ceiling on the number of entries in the in-memory SSOT index. */
export const MAX_MEMORY_ENTRIES = 1_000;

/** Maximum byte length for a single memory entry's content field. */
export const MAX_ENTRY_CONTENT_BYTES = 64_000;

/** Maximum characters when rendering a memory snippet for context. */
export const MAX_SNIPPET_LENGTH = 4_000;

/** Maximum character length for a memory entry title. */
export const MAX_TITLE_LENGTH = 200;

/** Maximum number of tags per memory entry. */
export const MAX_TAGS = 12;

/** Maximum character length per tag. */
export const MAX_TAG_LENGTH = 50;

/** Maximum number of results returned from a single memory query. */
export const MAX_QUERY_RESULTS = 50;

// ── Memory Scanner ───────────────────────────────────────────────

/** Maximum byte length for a memory entry accepted by the scanner. */
export const MAX_SCANNER_ENTRY_BYTES = 32_000;

// ── Skills ───────────────────────────────────────────────────────

/** Maximum response bytes for the web-fetch skill. */
export const MAX_WEB_FETCH_BODY_BYTES = 64_000;

/** Cap on memory-query skill results. */
export const MAX_MEMORY_QUERY_RESULTS_CAP = 50;

/** Maximum characters for memory-write snippet input. */
export const MAX_MEMORY_WRITE_SNIPPET = 4_000;

// ── Chat ─────────────────────────────────────────────────────────

/** Maximum number of image attachments per chat turn. */
export const MAX_IMAGE_ATTACHMENTS = 4;

/** Maximum byte size for a single image attachment. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Default output token budget for Atlas chat completions when callers do not specify one. */
export const DEFAULT_CHAT_MAX_TOKENS = 2_400;

/** Maximum continuation requests after a provider truncates a reply with `finishReason: 'length'`. */
export const MAX_COMPLETION_CONTINUATIONS = 2;

// ── Checkpoint Manager ───────────────────────────────────────────

/** Maximum number of automatic checkpoints retained per workspace. */
export const MAX_CHECKPOINTS = 10;

// ── Project Run History ──────────────────────────────────────────

/** Maximum number of project runs persisted in globalState. */
export const MAX_PROJECT_RUNS = 40;

// ── Tool Webhook Dispatcher ──────────────────────────────────────

/** Default timeout for outbound webhook delivery in milliseconds. */
export const DEFAULT_WEBHOOK_TIMEOUT_MS = 5_000;

/** Maximum webhook delivery history items. */
export const MAX_WEBHOOK_HISTORY_ITEMS = 50;

/** Maximum delivery attempts per webhook payload. */
export const MAX_WEBHOOK_DELIVERY_ATTEMPTS = 3;

/** Exponential backoff base for webhook retry in milliseconds. */
export const WEBHOOK_RETRY_BASE_DELAY_MS = 300;

// ── MCP Client ───────────────────────────────────────────────────

/** Per-tool-call timeout for MCP server invocations in milliseconds. */
export const MCP_TOOL_CALL_TIMEOUT_MS = 120_000;

// ── Bootstrap ────────────────────────────────────────────────────

/** Maximum byte length for a file during project import scanning. */
export const MAX_IMPORT_FILE_BYTES = 32_000;

/** Maximum snippet characters for a single imported file summary. */
export const MAX_IMPORT_SNIPPET = 3_500;
