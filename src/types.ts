// User-specific environment info for tailoring AtlasMind behavior
export interface UserEnvironment {
  os: string;
  osVersion: string;
  arch: string;
  cpu: string;
  ramGB: number;
  shell: string;
  editor: string;
  editorVersion: string;
  machineId: string;
  location: string;
  timestamp: string;
  // Extend with more fields as needed
}

export type EnvironmentRecord = UserEnvironment;
/**
 * AtlasMind – shared type definitions.
 */

// ── Model Providers ─────────────────────────────────────────────

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'mistral'
  | 'deepseek'
  | 'zai'
  | 'azure'
  | 'bedrock'
  | 'xai'
  | 'cohere'
  | 'perplexity'
  | 'huggingface'
  | 'nvidia'
  | 'openrouter'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'qwen'
  | 'moonshot'
  | 'yi'
  | 'minimax'
  | 'local'
  | 'copilot'
  | (string & {});  // open union: allows new providers without a multi-file type change

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  name: string;
  contextWindow: number;
  inputPricePer1k: number;   // USD
  outputPricePer1k: number;  // USD
  capabilities: ModelCapability[];
  /**
   * The provider can satisfy a tool-backed task by letting its agent execute
   * native tools inside the provider session, rather than by returning
   * AtlasMind `tool_calls`.
   *
   * This is capability only, never permission. Routing may use it only when
   * `RoutingConstraints.allowDelegatedToolExecution` is true, and the provider
   * remains responsible for approval-gating every native operation.
   */
  delegatedToolExecution?: boolean;
  specialistDomains?: SpecialistDomain[];
  enabled: boolean;
  /**
   * Whether this model supports prompt caching (a stable prompt prefix —
   * system prompt, memory bundle, tool definitions — is billed at a reduced
   * "cache read" rate on subsequent turns). Used by the router to favour
   * cache-capable models for iterative/threaded work where a large prefix is
   * reused across turns.
   */
  supportsPromptCaching?: boolean;
  /**
   * Price per 1K input tokens served from the prompt cache (USD). When omitted
   * but `supportsPromptCaching` is true, the router applies a conservative
   * default cache-read discount to `inputPricePer1k`.
   */
  cachedInputPricePer1k?: number;
  /**
   * How many subscription "premium request" units this model consumes per
   * request.  Standard models = 1, premium = 2+.  Only meaningful for
   * subscription providers (e.g. GitHub Copilot charges 3× for Opus 4).
   * Defaults to 1 when omitted.
   */
  premiumRequestMultiplier?: number;
  /**
   * Graduated reasoning depth: 0 = none, 1 = basic, 2 = medium, 3 = extended/full.
   * Used by the router instead of the binary 'reasoning' capability tag so that
   * new hybrid models can be positioned on a spectrum rather than forced into a
   * yes/no bucket.  When omitted the router falls back to 2 for models that list
   * 'reasoning' in capabilities, or 0 for models that do not.
   */
  reasoningDepth?: number;
  /**
   * Explicit latency class that overrides the context-window-based speed-tier
   * heuristic.  Set this in the catalog for models whose actual inference speed
   * does not match what the heuristic would infer (e.g. a 1M-context Flash model
   * that is genuinely fast, or an extended-thinking Opus that is genuinely slow).
   * When omitted the router derives the tier from reasoningDepth and contextWindow.
   */
  latencyClass?: 'fast' | 'balanced' | 'slow';
  /**
   * Multiplier applied to output token counts when projecting the true cost of
   * models that emit a large reasoning scratchpad before the visible answer
   * (e.g. DeepSeek R1, QwQ, or Claude extended-thinking mode).  A value of 4
   * means the model is expected to generate ~4× the output tokens compared to
   * what it returns as visible content.  Used by the router's cost projection
   * so that extended-thinking models are compared fairly against standard models.
   * Defaults to 1 (no hidden tokens) when omitted.
   */
  thinkingTokenMultiplier?: number;
  /**
   * ISO 8601 date (YYYY-MM-DD) on or after which this model should be treated
   * as deprecated.  The router will skip deprecated models during candidate
   * selection and emit a one-time "model deprecated" notification to the user
   * so they can update their agent configuration.  Leaving this field absent
   * means the model is considered current.
   */
  deprecatedAt?: string;
}

/**
 * Capabilities a model may support.  The list is intentionally open — new
 * provider capabilities (audio, computer-use, extended-thinking, structured
 * output) can be appended without breaking existing guards because `includes`
 * checks on known values continue to work.  Unknown capability strings are
 * accepted by the type system via the trailing `string &` escape hatch but
 * the router will treat them as optional preferences rather than hard gates.
 */
export type ModelCapability =
  | 'chat'
  | 'code'
  | 'vision'
  | 'function_calling'
  | 'reasoning'
  | 'extended_thinking'
  | 'structured_output'
  | 'computer_use'
  | 'audio';

export type SpecialistDomain =
  | 'media-generation'
  | 'visual-analysis'
  | 'voice'
  | 'research'
  | 'robotics'
  | 'simulation'
  | 'real-time-video'
  | 'scientific-computing';

/**
 * How the provider charges for token usage.
 * - `subscription`: Tokens included in a plan (e.g. GitHub Copilot).
 *    Effective cost is zero — prefer these over pay-per-token.
 * - `pay-per-token`: Billed per token via API (e.g. Anthropic, OpenAI).
 * - `free`: No cost at all (e.g. local models, free-tier endpoints).
 */
export type PricingModel = 'subscription' | 'pay-per-token' | 'free';

export interface ProviderConfig {
  id: ProviderId;
  displayName: string;
  apiKeySettingKey: string;
  enabled: boolean;
  pricingModel: PricingModel;
  models: ModelInfo[];
  /** Subscription quota tracking — only relevant when pricingModel is 'subscription'. */
  subscriptionQuota?: SubscriptionQuota;
}

/**
 * Tracks remaining subscription quota for providers that bundle tokens in a
 * plan (e.g. GitHub Copilot, Claude Code).  When remaining quota hits zero
 * the router treats the provider as effectively `pay-per-token`.
 */
export interface SubscriptionQuota {
  /** Total quota units included in the billing period. */
  totalRequests: number;
  /** Remaining quota units in the current billing period. */
  remainingRequests: number;
  /**
   * The unit that `totalRequests` and `remainingRequests` count in.
   * Different providers use different billing models:
   * - `requests` – GitHub Copilot legacy premium-request-unit model
   * - `credits`  – GitHub Copilot AI-credits model (post June 2026)
   * - `tokens`   – token-based subscription (OpenAI Flex, etc.)
   * - `minutes`  – compute-time-based plans
   * Defaults to `requests` when omitted for back-compat.
   */
  unit?: 'requests' | 'credits' | 'tokens' | 'minutes';
  /** ISO 8601 timestamp when the current billing period resets. */
  resetsAt?: string;
  /**
   * Effective USD cost per quota unit, derived from the subscription price
   * divided by `totalRequests`.  Used to compare the real cost of
   * subscription tokens against pay-per-token APIs.
   * For example: $10/month ÷ 300 requests = ~$0.033 per request unit.
   */
  costPerRequestUnit?: number;
}

// ── Budget / Speed ──────────────────────────────────────────────

export type BudgetMode = 'cheap' | 'balanced' | 'expensive' | 'auto';
export type SpeedMode = 'fast' | 'balanced' | 'considered' | 'auto';
export type TaskPhase = 'planning' | 'execution' | 'synthesis' | 'maintenance';
export type TaskModality = 'text' | 'code' | 'vision' | 'mixed';
export type TaskReasoning = 'low' | 'medium' | 'high';

export interface RoutingConstraints {
  budget: BudgetMode;
  speed: SpeedMode;
  maxCostUsd?: number;
  preferredProvider?: ProviderId;
  /**
   * Explicit model pin for role-based routing (e.g. a planning/synthesis "brain"
   * model). When set and the model is available, healthy, and satisfies required
   * capabilities and any allow-list, the router selects it directly — bypassing
   * budget/speed gates since it is a deliberate choice — otherwise it falls back
   * to normal scoring.
   */
  preferredModel?: string;
  /** Hard requirements that the selected model must support. */
  requiredCapabilities?: ModelCapability[];
  /**
   * Permit a model with `delegatedToolExecution` to satisfy a
   * `function_calling` requirement using its provider-native tools.
   *
   * Off unless the host has an explicit delegated-execution authorization
   * setting. It never means AtlasMind tool schemas may be passed to that
   * provider.
   */
  allowDelegatedToolExecution?: boolean;
  /**
   * Number of concurrent model slots the caller needs for this task batch.
   * When > 1, the router will allow pay-per-token overflow beyond
   * subscription providers to enable parallelism.
   */
  parallelSlots?: number;
  /**
   * Fraction (0..1) of this turn's input tokens expected to be served from the
   * prompt cache — i.e. the share of the prompt that is a stable, reused prefix.
   * When > 0, the router projects a lower input cost for cache-capable models,
   * favouring them for iterative/threaded work. Defaults to 0 (no cacheable
   * prefix) so single-shot turns are unaffected.
   */
  cacheablePrefixRatio?: number;
  /**
   * When set, the task's context contains data classified by the Data Privacy
   * policy (see {@link DataPrivacyConfig}). The router must restrict candidate
   * selection to the user's trusted-model allow-list so confidential or
   * regulated data is never sent to an un-trusted model. The orchestrator's
   * redaction boundary is the fail-safe when no trusted model can be selected.
   */
  requireTrustedModel?: boolean;
}

export type ToolApprovalMode = 'always-ask' | 'ask-on-write' | 'ask-on-external' | 'allow-safe-readonly';

/**
 * Runtime approval state used to implement "Bypass Approvals" (per-task) and
 * "Autopilot" (session-wide). These aren't persisted across VS Code restarts.
 */
export interface ToolApprovalState {
  /**
   * When set to a task ID, all tool calls for that task bypass approval.
   * Cleared when the task ends.
   */
  bypassTaskId?: string;

  /**
   * When true, all tool calls bypass approval for the entire session.
   * Cleared when the user toggles it off or the extension restarts.
   */
  autopilot: boolean;
}

export type ToolRiskCategory =
  | 'read'
  | 'workspace-write'
  | 'terminal-read'
  | 'terminal-write'
  | 'git-read'
  | 'git-write'
  | 'network'
  | 'audio-input'
  | 'audio-output';

export interface ToolInvocationPolicy {
  category: ToolRiskCategory;
  risk: 'low' | 'medium' | 'high';
  summary: string;
}

export type ToolApprovalDecision = 'allow-once' | 'bypass-task' | 'autopilot' | 'deny';

export interface PendingToolApprovalRequest {
  id: string;
  taskId: string;
  toolName: string;
  category: ToolRiskCategory;
  risk: 'low' | 'medium' | 'high';
  summary: string;
  createdAt: string;
  title?: string;
  detail?: string;
  allowedDecisions?: ToolApprovalDecision[];
  decisionLabels?: Partial<Record<ToolApprovalDecision, string>>;
}

export interface TaskProfile {
  phase: TaskPhase;
  modality: TaskModality;
  reasoning: TaskReasoning;
  requiresTools: boolean;
  /** Hard requirements inferred from task shape, e.g. vision or tool use. */
  requiredCapabilities: ModelCapability[];
  /** Soft preferences used by routing scores after hard filtering. */
  preferredCapabilities: ModelCapability[];
}

/**
 * A way a model under-performed on a turn, fed into the router's persistent
 * "struggle memory" so a model that repeatedly fails a *kind* of task is
 * de-weighted for that task signature. Distinct from a hard provider failure:
 * these are quality/behaviour signals the coarse execution grader can miss
 * (e.g. a small model that emits a tool call as plain text instead of a
 * structured `tool_calls` response).
 */
export type ModelStruggleKind =
  | 'timeout'
  | 'empty'
  | 'tool-call-as-text'
  | 'error-finish'
  | 'user-correction';

/**
 * Persistent, decaying de-weight signal for a model on a specific task
 * signature. `penalty` is the stored (un-decayed) magnitude as of
 * `lastUpdated`; the router applies time-decay on read so transient glitches
 * fade while genuinely weak models stay de-weighted across sessions.
 */
export interface ModelStruggleState {
  /** Stored penalty magnitude (>= 0) as of `lastUpdated`; decayed on read. */
  penalty: number;
  /** ISO timestamp of the last record/recover; drives time-decay. */
  lastUpdated: string;
  /** Number of struggle records folded in — diagnostics / "why" surfacing. */
  hits: number;
  /** The most recent struggle kind — surfaced in the UI hint. */
  lastKind: ModelStruggleKind;
}

// ── Agents ──────────────────────────────────────────────────────

/**
 * How often AtlasMind automatically refreshes a user-defined agent's system
 * prompt and description to keep it modern, accurate, and legally compliant.
 * The check happens on the next agent use after the interval has elapsed.
 */
export type AgentAutoUpdateCadence = 'never' | 'every-use' | 'daily' | 'weekly' | 'monthly';

/**
 * How an agent's declared `skills` list becomes an execution-time eligibility
 * pool. Missing values are treated as the safe legacy default:
 * `allowlist` when ids are present, otherwise `task-scoped`.
 */
export type AgentSkillPolicy = 'task-scoped' | 'allowlist' | 'all';

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  allowedModels?: string[];  // model IDs – empty = any
  costLimitUsd?: number;
  skills: string[];           // skill IDs; meaning is controlled by skillPolicy
  /**
   * `task-scoped`: deterministically select a small relevant subset per turn.
   * An empty list means built-in skills are eligible; external/MCP skills must
   * be named explicitly. `allowlist`: expose exactly the named enabled skills.
   * `all`: deliberately expose every enabled skill, including external skills.
   */
  skillPolicy?: AgentSkillPolicy;
  /**
   * Routing need IDs this agent is the primary handler for.
   * Used by the orchestrator as the dominant signal when the classifier
   * returns matching routing needs — outweighs token-overlap scoring.
   * Values must be valid RoutingNeedId strings (see classifierService.ts).
   */
  primaryRoutingNeeds?: string[];
  /** True for agents shipped with the extension. Built-in agents cannot be deleted via the UI. */
  builtIn?: boolean;
  /** ISO 8601 timestamp of the last successful auto-update. */
  lastAutoUpdated?: string;
  /** When true, this agent is excluded from the global auto-update cadence. */
  autoUpdateExcluded?: boolean;
  /** When true, skill assignments are managed automatically based on the agent's role and context. */
  skillsAutoManaged?: boolean;
  /**
   * Optional, agent-specific definition of done. The rubric is shown to the
   * agent alongside AtlasMind's shared execution rubric. The orchestrator also
   * reprompts once when a final response matches an `incompletePatterns` entry.
   */
  completionCriteria?: {
    /**
     * Concrete, observable requirements for this agent's work. Keep each item
     * independently assessable (for example, "Cite the failing and passing test
     * command"), rather than using broad aspirations such as "produce quality
     * work".
     */
    rubric?: string[];
    /**
     * Regex source strings (case-insensitive). If the final agent response matches
     * any of these, the orchestrator injects one re-prompt asking the agent to
     * either finish the outstanding work or declare explicit unresolved blockers.
     * Patterns should capture phrases the agent uses when it acknowledges work it
     * hasn't completed — e.g. "not yet wired", "important follow-up".
     */
    incompletePatterns?: string[];
  };
  /** Testing methodologies this agent is the primary handler for. */
  testingMethodologies?: TestingMethodologyId[];
  /**
   * Per-methodology model ID overrides. When the orchestrator runs a test task
   * tagged with a methodology, the matching entry here takes precedence over the
   * agent's global `allowedModels` list.
   */
  testingModelOverrides?: Partial<Record<TestingMethodologyId, string>>;
}

// ── Testing Methodologies ────────────────────────────────────────

export type TestingMethodologyId =
  | 'tdd'
  | 'bdd'
  | 'atdd'
  | 'sdd'
  | 'v-model'
  | 'unit'
  | 'integration'
  | 'e2e'
  | 'mutation'
  | 'property'
  | 'snapshot'
  | 'contract'
  | 'continuous'
  | 'white-box'
  | 'performance'
  | 'security-testing'
  | 'visual'
  | 'mbt'
  | 'test-design'
  | 'black-box'
  | 'gray-box'
  | 'exploratory'
  | 'agile-testing'
  // Structural — drift and integrity checks over the code's own shape.
  | 'dead-field'
  | 'type-drift'
  | 'dependency-graph'
  // Behavioral — parity and consistency across surfaces, representations, versions.
  | 'cross-surface-parity'
  | 'cross-representation'
  | 'cross-version-parity'
  | 'semantic-constraint'
  | 'anti-uniformity'
  | 'output-schema-drift'
  | 'hallucination-detection'
  // Non-functional
  | 'chaos'
  | 'accessibility'
  | 'observability'
  // Data & schema
  | 'data-quality'
  | 'schema-migration'
  | 'compatibility'
  | 'state-drift'
  // AI-specific
  | 'prompt-regression'
  | 'model-routing'
  | 'guardrail'
  | 'agent-collaboration'
  | 'determinism-boundary'
  // Compliance — security & privacy
  | 'iso-27001'
  | 'soc2'
  | 'gdpr'
  | 'hipaa'
  | 'pci-dss'
  | 'nist-800-53'
  // Compliance — operational & process
  | 'change-management'
  | 'audit-trail'
  | 'rbac-compliance'
  | 'data-retention'
  // Compliance — software supply chain
  | 'sbom'
  | 'dependency-licensing'
  | 'license-compatibility'
  | 'secure-build-pipeline'
  // Compliance — AI-specific
  | 'ai-safety-compliance'
  | 'model-output-risk'
  | 'bias-fairness'
  | 'explainability'
  | 'ai-data-policy'
  // Compliance — industry-specific
  | 'financial-compliance'
  | 'medical-compliance'
  | 'automotive-compliance'
  | 'aviation-compliance'
  | 'energy-compliance';

export interface TestingMethodologyDefinition {
  id: TestingMethodologyId;
  label: string;
  description: string;
  /**
   * Broad grouping for UI organisation.
   *
   * The compliance families are separate keys rather than one `compliance`
   * bucket with a sub-field: twenty-four rows under a single heading is a list
   * nobody reads, and the families answer genuinely different questions (a
   * privacy regulator, a build pipeline, and a fairness review share no
   * evidence). Splitting them here keeps the renderer a flat group-by.
   */
  category:
    | 'design-time'
    | 'structural'
    | 'behavioral'
    | 'non-functional'
    | 'data-schema'
    | 'ai-specific'
    | 'exploratory'
    | 'compliance-security'
    | 'compliance-operational'
    | 'compliance-supply-chain'
    | 'compliance-ai'
    | 'compliance-industry';
  /** Concise guidance on when this methodology is most appropriate. */
  whenToUse: string;
  /** Common tools and frameworks associated with this methodology. */
  keyTools: string;
  /** Primary trade-off or cost to consider before adopting. */
  tradeoffs: string;
  /** Project types or signals that suggest this methodology. Used by auto-detect heuristics. */
  autoDetectSignals: string[];
  /** Rough LLM token consumption level when this methodology is actively used. */
  tokenImpactLevel: 'low' | 'medium' | 'high';
  /** What drives the token usage — shown in the methodology info panel. */
  tokenImpact: string;
}

export const TESTING_METHODOLOGY_DEFINITIONS: TestingMethodologyDefinition[] = [
  {
    id: 'tdd', label: 'TDD', description: 'Test-Driven Development — red-green-refactor loop', category: 'design-time',
    whenToUse: 'Any project where correctness matters and requirements can be expressed as assertions before the code is written. Especially valuable for greenfield features and critical business logic.',
    keyTools: 'Jest, Vitest, Mocha, pytest, JUnit, RSpec, Go testing',
    tradeoffs: 'Requires discipline to write the test first; initial velocity feels slower before the refactor payoff. Poorly scoped tests can become brittle.',
    autoDetectSignals: ['*'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Red-green-refactor cycles generate multiple LLM passes per feature; always active means cost accumulates steadily across sessions.',
  },
  {
    id: 'bdd', label: 'BDD', description: 'Behavior-Driven Development — Gherkin / Given-When-Then specs', category: 'design-time',
    whenToUse: 'Projects with a non-technical product owner or QA team who needs to co-author acceptance criteria. Works best when requirements arrive as user stories.',
    keyTools: 'Cucumber, SpecFlow, Behave, Gherkin, Codecept, Playwright BDD plugin',
    tradeoffs: 'Scenario maintenance overhead grows quickly if stakeholders do not actively contribute. Can drift into redundant unit + scenario coverage.',
    autoDetectSignals: ['cucumber', 'gherkin', 'specflow', 'behave', 'product team', 'user story', 'bdd'],
    tokenImpactLevel: 'high',
    tokenImpact: 'Natural-language Gherkin generation and step-definition mapping produce long prompts; stakeholder-facing language typically requires multiple refinement rounds.',
  },
  {
    id: 'atdd', label: 'ATDD', description: 'Acceptance Test-Driven Development — customer-facing criteria first', category: 'design-time',
    whenToUse: 'When the delivery team works directly from customer acceptance criteria. Bridges the gap between BDD storytelling and executable acceptance tests.',
    keyTools: 'Robot Framework, FitNesse, Cucumber, SpecFlow, Gauge',
    tradeoffs: 'Requires close collaboration with customers to define criteria up-front; misaligned criteria produce tests that pass but miss intent.',
    autoDetectSignals: ['robot framework', 'fitnesse', 'gauge', 'acceptance criteria', 'atdd'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Acceptance criteria authoring and executable test mapping are moderately verbose; more structured than BDD so fewer refinement rounds are needed.',
  },
  {
    id: 'sdd', label: 'Spec-Driven (SDD)', description: 'Specification-first development — API contracts and schemas drive implementation', category: 'design-time',
    whenToUse: 'API and service projects where the interface contract is the primary deliverable. Ideal for public APIs, microservices, and SDKs where consumers need a stable spec before implementation begins.',
    keyTools: 'OpenAPI/Swagger, AsyncAPI, Stoplight, Redocly, Prism (mock server), Dredd, Spectral',
    tradeoffs: 'Specs drift from implementation without automated sync tooling. Writing a complete spec upfront requires significant domain knowledge and can delay the first working prototype.',
    autoDetectSignals: ['openapi', 'swagger', 'asyncapi', 'stoplight', 'prism', 'api-first', 'api first', 'spectral', 'redocly', 'sdd', 'spec-driven'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Spec generation is front-loaded per endpoint; ongoing validation and mock-server setup are lightweight. Cost spikes during initial spec authoring then flattens.',
  },
  {
    id: 'v-model', label: 'V-Model', description: 'Phase-paired verification — each development phase maps to a corresponding test phase', category: 'design-time',
    whenToUse: 'Projects with strict phase gating or compliance requirements — medical devices (ISO 13485), automotive (ISO 26262), safety-critical systems (IEC 61508). Also a useful mental model for clarifying test-level responsibilities on any team.',
    keyTools: 'Requirements traceability matrices, IBM DOORS, Polarion, HP ALM / Micro Focus ALM, IBM Rational Quality Manager, formal test plans',
    tradeoffs: 'Rigid phase boundaries slow feedback loops and make iterative changes expensive. Produces large plan artifacts that rapidly become stale. Not well suited to discovery-heavy or Agile workstreams.',
    autoDetectSignals: ['v-model', 'verification and validation', 'requirements traceability', 'rtm', 'iso 26262', 'iec 61508', 'iec 62443', 'fda', 'regulated', 'medical device', 'safety-critical', 'functional safety'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Traceability matrix generation and phase-aligned test plan authoring are upfront costs; once plans exist, ongoing per-phase coverage adds moderate overhead.',
  },
  {
    id: 'unit', label: 'Unit Testing', description: 'Isolated function and class-level tests', category: 'structural',
    whenToUse: 'All projects. Start here. Fast, cheap, and gives precise regression signals. Should be the largest layer of your test pyramid.',
    keyTools: 'Jest, Vitest, Mocha, pytest, JUnit, NUnit, xUnit, Go testing, Minitest',
    tradeoffs: 'Tests of implementation details (not behaviour) become expensive to maintain. Mocking boundaries can give false confidence at integration points.',
    autoDetectSignals: ['*'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Isolated, short-context prompts — the cheapest methodology per test. High volume can aggregate, but each individual call is minimal.',
  },
  {
    id: 'integration', label: 'Integration', description: 'Multi-component interaction and service-boundary tests', category: 'structural',
    whenToUse: 'Any project with multiple collaborating services, a database, a message bus, or a third-party API. Catches contract mismatches that unit tests cannot.',
    keyTools: 'Supertest, pytest-httpx, Testcontainers, WireMock, Spring Boot Test, go-sqlmock',
    tradeoffs: 'Slower and more environment-dependent than unit tests. Flaky tests are common without proper isolation (e.g. Testcontainers).',
    autoDetectSignals: ['api', 'backend', 'service', 'database', 'postgres', 'mysql', 'mongodb', 'redis', 'kafka', 'rabbitmq', 'microservice'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Multi-component context windows are larger than unit tests; environment setup and configuration guidance adds extra LLM calls beyond the test code itself.',
  },
  {
    id: 'mutation', label: 'Mutation Testing', description: 'Fault injection to measure suite kill-rate (Stryker, Pitest)', category: 'structural',
    whenToUse: 'Mature suites where you want to measure test quality, not just quantity. Excellent for libraries and shared utilities where coverage alone is misleading.',
    keyTools: 'Stryker Mutator (JS/TS/C#), Pitest (Java/Kotlin), mutmut (Python), Infection (PHP)',
    tradeoffs: 'Very slow on large codebases; often run nightly rather than on every push. Tuning timeout and survivor thresholds takes experimentation.',
    autoDetectSignals: ['stryker', 'pitest', 'mutmut', 'infection', 'library', 'sdk', 'package', 'utility'],
    tokenImpactLevel: 'high',
    tokenImpact: 'Each surviving mutant may trigger an LLM analysis pass. Large codebases can produce thousands of mutants, making this the most token-intensive structural methodology.',
  },
  {
    id: 'property', label: 'Property-Based', description: 'Generative input testing (fast-check, Hypothesis)', category: 'structural',
    whenToUse: 'Pure functions, parsers, data transformers, and algorithmic code. Generates hundreds of random inputs to find edge cases no human would enumerate.',
    keyTools: 'fast-check (JS/TS), Hypothesis (Python), QuickCheck (Haskell/Erlang), jqwik (Java), gopter (Go)',
    tradeoffs: 'Requires learning the property-definition mindset; not suitable for code with side effects or non-deterministic I/O.',
    autoDetectSignals: ['fast-check', 'hypothesis', 'quickcheck', 'jqwik', 'gopter', 'library', 'sdk', 'parser', 'transformer', 'algorithm'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Property definition requires reasoning about input domains; shrinkage failure analysis adds follow-up calls to diagnose the minimal failing case.',
  },
  {
    id: 'continuous', label: 'Continuous / Shift-Left', description: 'Automated testing embedded throughout CI/CD — tests run on every commit, earliest possible feedback', category: 'structural',
    whenToUse: 'Any project with a CI/CD pipeline. Essential for teams delivering frequent releases or practising trunk-based development. Shift-left means pushing tests earlier: linting, type checks, and unit tests on pre-commit; integration and E2E on PR; performance and security on merge.',
    keyTools: 'GitHub Actions, GitLab CI, Jenkins, CircleCI, Azure DevOps, Buildkite, Husky / pre-commit hooks, Test Impact Analysis (Vitest, Jest)',
    tradeoffs: 'Requires significant upfront investment in pipeline configuration and test suite speed. Slow suites become a bottleneck on developer velocity. Shallow-but-fast suites give false safety if coverage is insufficient.',
    autoDetectSignals: ['github actions', 'gitlab ci', 'jenkins', 'circleci', 'azure devops', 'buildkite', 'ci/cd', 'pipeline', 'continuous integration', 'shift-left', 'husky', 'pre-commit', 'trunk-based'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Pipeline configuration is authored once and reused. The methodology itself adds no per-test LLM overhead — cost is driven by whichever test methodologies run inside the pipeline.',
  },
  {
    id: 'white-box', label: 'White-Box', description: 'Structure-aware testing — code paths, branches, and conditions guided by internal knowledge', category: 'structural',
    whenToUse: 'Security-sensitive modules, complex algorithms, and codebases where path or branch coverage is a compliance requirement (DO-178C, IEC 61508). Augments unit tests with precise coverage metrics to identify dead code and untested logic.',
    keyTools: 'Istanbul / nyc (JS/TS), coverage.py, JaCoCo (Java/Kotlin), gcov / lcov (C/C++), LLVM coverage, SonarQube, Codecov, Coveralls',
    tradeoffs: 'High coverage percentages do not guarantee correctness — every line can be executed while semantic bugs remain. Tests tightly coupled to implementation details become expensive to maintain during refactors.',
    autoDetectSignals: ['coverage', 'istanbul', 'nyc', 'jacoco', 'gcov', 'lcov', 'sonarqube', 'codecov', 'coveralls', 'branch coverage', 'path coverage', 'white-box', 'whitebox', 'do-178', 'iec 61508'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Coverage gap analysis and path-targeted test generation require full code context; coverage report interpretation adds parsing overhead on top of test authoring.',
  },
  {
    id: 'e2e', label: 'End-to-End', description: 'Full user-flow simulation (Playwright, Cypress, etc.)', category: 'behavioral',
    whenToUse: 'Web and mobile applications with critical user journeys (checkout, login, onboarding). High confidence at the cost of speed.',
    keyTools: 'Playwright, Cypress, Puppeteer, WebdriverIO, Detox (mobile), Appium',
    tradeoffs: 'Slowest tests in the suite; brittle to DOM changes. High maintenance burden if driven by selectors rather than accessible roles.',
    autoDetectSignals: ['playwright', 'cypress', 'puppeteer', 'webdriverio', 'detox', 'appium', 'react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'remix', 'web app', 'frontend'],
    tokenImpactLevel: 'high',
    tokenImpact: 'Page object models, multi-step scenario scripts, and selector generation are among the longest test artefacts. Browser-state descriptions and multi-page flows inflate context length significantly.',
  },
  {
    id: 'snapshot', label: 'Snapshot', description: 'UI and serialised-output regression snapshots', category: 'behavioral',
    whenToUse: 'Component libraries, serialisers, and any code with stable, human-reviewable output. Great at catching unintended regressions without custom assertions.',
    keyTools: 'Jest snapshots, Vitest snapshots, Storybook Storyshots, react-test-renderer',
    tradeoffs: 'Snapshots become noisy if updated carelessly ("just update the snapshot"). Reviewers must read diffs critically or the guardrail erodes.',
    autoDetectSignals: ['react', 'vue', 'angular', 'svelte', 'storybook', 'component library', 'serialiser', 'renderer'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Snapshot comparison is tooling-driven. LLM involvement is limited to initial setup and occasional triage when a diff is ambiguous.',
  },
  {
    id: 'contract', label: 'Contract', description: 'Consumer-driven API contract verification (Pact)', category: 'behavioral',
    whenToUse: 'Microservice architectures where multiple teams own their own services. Consumers write the contract; providers verify it — eliminating integration environment dependency.',
    keyTools: 'Pact (JS, Java, Go, .NET, Ruby, Python), Spring Cloud Contract, Dredd',
    tradeoffs: 'Requires buy-in from all service teams to publish and verify contracts. Initial setup cost is high; payoff grows with the number of services.',
    autoDetectSignals: ['pact', 'spring cloud contract', 'dredd', 'microservice', 'consumer', 'provider', 'api contract'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Consumer/provider schema reasoning requires cross-service context; the focused scope keeps cost moderate relative to full integration testing.',
  },
  {
    id: 'mbt', label: 'Model-Based (MBT)', description: 'Derive test cases from formal system models — state machines, UML diagrams, decision tables', category: 'behavioral',
    whenToUse: 'Complex systems with many state transitions: embedded software, protocol implementations, workflow engines, and telecom or automotive stacks. MBT generates optimised test suites that cover the model more completely than hand-authored cases.',
    keyTools: 'GraphWalker, TestOptimal, Conformiq, MBTsuite, Selenium + custom state model wrappers',
    tradeoffs: 'Requires expertise in formal modelling. Model creation and maintenance adds overhead. Overkill for simple CRUD applications where a direct test is faster to write than a model.',
    autoDetectSignals: ['state machine', 'finite automata', 'finite state', 'workflow engine', 'graphwalker', 'xstate', 'mbt', 'model-based', 'protocol', 'embedded', 'state diagram'],
    tokenImpactLevel: 'high',
    tokenImpact: 'State model generation, optimal path derivation, and test-case synthesis from a behavioural model require sustained reasoning across large context windows.',
  },
  {
    id: 'test-design', label: 'Test Design Techniques', description: 'Systematic input partitioning — Equivalence Partitioning, Boundary Value Analysis, decision tables', category: 'behavioral',
    whenToUse: 'Any function or API accepting bounded inputs — form validators, parsers, calculators, pricing engines, and state machines. EP and BVA systematically identify which representative values and edge cases to test without exhaustive enumeration. Use decision tables for logic with many input combinations.',
    keyTools: 'Applied within any test framework (Jest, Vitest, pytest, JUnit). Combinatorial design tools: Hexawise, ACTS (NIST), Allpairs. Documented as test design artefacts alongside code.',
    tradeoffs: 'Techniques require up-front domain analysis of input spaces. EP and BVA address individual parameters; combinatorial explosion occurs when testing interactions between many inputs simultaneously (use pairwise testing to manage this).',
    autoDetectSignals: ['equivalence partitioning', 'boundary value', 'equivalence class', 'decision table', 'test design', 'pairwise', 'combinatorial', 'hexawise', 'acts testing'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Equivalence class and boundary identification is mechanical once patterns are established. Prompts are short and highly structured — one of the lowest-cost methodologies per test case authored.',
  },
  {
    id: 'black-box', label: 'Black-Box', description: 'Behaviour-only testing — derive cases from requirements and specs without inspecting internals', category: 'behavioral',
    whenToUse: 'System, acceptance, and regression testing where the tester does not need implementation access. Ideal for testing third-party components, validating compliance against public specifications, or running tests as an end-user proxy.',
    keyTools: 'Postman, REST-assured, Selenium, Playwright, TestRail (test case management), acceptance criteria checklists, OWASP testing guides',
    tradeoffs: 'Cannot target specific code paths; internal logic coverage is unknown. May duplicate work already covered by unit tests if test layers are not coordinated. Defect root-cause analysis is harder without internal visibility.',
    autoDetectSignals: ['acceptance testing', 'system testing', 'functional testing', 'black-box', 'blackbox', 'postman', 'requirements-based testing', 'specification testing'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Minimal internal code context needed; test cases are derived from requirements documents. Prompts are concise and self-contained.',
  },
  {
    id: 'gray-box', label: 'Gray-Box', description: 'Hybrid approach — partial internal visibility informs test design while tests operate through the public interface', category: 'behavioral',
    whenToUse: 'Integration and API testing where you know the data schema or internal state model but test through the public interface. Common in security testing (knowing the DB schema to craft SQL edge cases) and API contract verification with schema awareness.',
    keyTools: 'Postman with schema validation, REST-assured, Playwright + DevTools protocol, Burp Suite (security), OpenAPI-driven test generators (Schemathesis, Dredd)',
    tradeoffs: 'The boundary between gray-box and white-box testing is often subjective and team-dependent. Partial visibility can create a false sense of coverage completeness if the unknown internals contain the actual bugs.',
    autoDetectSignals: ['gray-box', 'greybox', 'gray box', 'grey box', 'schemathesis', 'schema-driven testing', 'api schema validation'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Partial schema context adds overhead beyond pure black-box. Combining internal and external perspectives requires more context than either approach alone.',
  },
  {
    id: 'performance', label: 'Performance', description: 'Load, stress, and latency benchmarks (k6, Artillery, JMeter)', category: 'non-functional',
    whenToUse: 'APIs, real-time systems, or any application with SLA targets. Run before a major release or infrastructure change to validate throughput and latency under load.',
    keyTools: 'k6, Artillery, Apache JMeter, Gatling, Locust, autocannon, wrk',
    tradeoffs: 'Requires a representative test environment; results on localhost are misleading. Defining realistic load scenarios takes time and domain knowledge.',
    autoDetectSignals: ['k6', 'artillery', 'jmeter', 'gatling', 'locust', 'autocannon', 'performance', 'real-time', 'high-load', 'throughput', 'sla', 'latency'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Load scenario design and result interpretation are moderately token-intensive; tests run infrequently (pre-release / post-infra-change) so total session cost is bounded.',
  },
  {
    id: 'security-testing', label: 'Security', description: 'SAST / DAST and dependency vulnerability scanning', category: 'non-functional',
    whenToUse: 'Any application handling authentication, payments, PII, or sensitive data. Should be part of CI for all production software.',
    keyTools: 'Snyk, OWASP ZAP, Semgrep, Trivy, CodeQL, Dependabot, npm audit, OWASP Dependency-Check',
    tradeoffs: 'SAST tools produce false positives that need triage. DAST requires a running environment. Both add CI time and require a process for managing findings.',
    autoDetectSignals: ['auth', 'authentication', 'oauth', 'jwt', 'password', 'payment', 'stripe', 'pii', 'gdpr', 'snyk', 'semgrep', 'trivy', 'codeql'],
    tokenImpactLevel: 'high',
    tokenImpact: 'SAST/DAST result triage, vulnerability classification, and remediation guidance are analysis-heavy. Security findings often require multi-turn investigation to establish exploitability and fix strategy.',
  },
  {
    id: 'visual', label: 'Visual Regression', description: 'Pixel-diff screenshots (Percy, Chromatic, Playwright)', category: 'non-functional',
    whenToUse: 'Design systems, component libraries, and marketing sites where visual correctness is a first-class requirement. Catches CSS regressions that functional tests miss.',
    keyTools: 'Percy (BrowserStack), Chromatic (Storybook), Playwright screenshot API, BackstopJS, Applitools',
    tradeoffs: 'Requires a consistent rendering environment to avoid flaky diffs. Cloud services add cost. Anti-aliasing and font rendering differences across OS can produce noise.',
    autoDetectSignals: ['percy', 'chromatic', 'backstopjs', 'applitools', 'storybook', 'design system', 'component library', 'marketing', 'react', 'vue', 'angular', 'svelte'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Screenshot comparison is entirely tooling-driven. LLM is used only for baseline configuration and describing visual regression failures for human review.',
  },
  {
    id: 'exploratory', label: 'Exploratory', description: 'Session-based manual discovery and charter testing', category: 'exploratory',
    whenToUse: 'New features, usability-sensitive workflows, and any area where automation has not yet caught up. Pairs well with a formal charter to keep sessions focused.',
    keyTools: 'Session-based testing charters, TestRail, Zephyr, Xray, Notion test logs, PractiTest',
    tradeoffs: 'Not repeatable and depends on tester skill. Should complement automation, not replace it. Results are only as good as the debrief and reporting discipline.',
    autoDetectSignals: ['exploratory', 'manual', 'usability', 'ux', 'new feature', 'charter'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Charter generation is lightweight; the bulk of exploration is manual. LLM involvement is limited to session planning and debrief summarisation.',
  },
  {
    id: 'agile-testing', label: 'Agile Testing', description: 'Whole-team quality ownership — testing is continuous and collaborative throughout every sprint', category: 'exploratory',
    whenToUse: 'Agile, Scrum, or Kanban teams where developers and testers share quality ownership. Testing activities are distributed throughout the sprint rather than blocked at the end. Works alongside TDD, BDD, and Exploratory testing rather than replacing them.',
    keyTools: 'Jira, Azure Boards, Linear, Zephyr Squad, TestRail, three-amigos sessions, Definition of Done checklists, retrospective practices',
    tradeoffs: 'Without explicit ownership, testing responsibility diffuses and gaps appear. Requires cultural buy-in across the whole team — it is a collaboration model, not a tooling choice. Easy to declare Agile Testing without actually shifting quality left.',
    autoDetectSignals: ['agile', 'scrum', 'kanban', 'sprint', 'three amigos', 'definition of done', 'dod', 'backlog refinement', 'story points', 'retrospective'],
    tokenImpactLevel: 'low',
    tokenImpact: 'DoD checklists, three-amigos facilitation notes, and retrospective summaries are short coordination artefacts. No per-test LLM cost — this methodology coordinates testing, it does not author it.',
  },

  // ── Structural: drift and integrity over the code's own shape ────
  {
    id: 'dead-field', label: 'Dead-Field / Dead-Prop Detection', description: 'Finds declared fields, props and config keys that nothing ever reads', category: 'structural',
    whenToUse: 'Codebases where types, props or configuration have accumulated over several refactors. A field that is written but never read is a bug wearing a feature\'s clothes — the code that was supposed to consume it was renamed, moved, or never written.',
    keyTools: 'ts-prune, knip, ts-unused-exports, eslint no-unused-vars, Vulture (Python), deadcode (Go), cargo-udeps (Rust)',
    tradeoffs: 'Reflection, dynamic key access, and serialization boundaries produce false positives — a field read only by `JSON.parse` consumers looks dead. Needs an allowlist for public API surfaces, or it reports every exported type as unused.',
    autoDetectSignals: ['knip', 'ts-prune', 'ts-unused-exports', 'vulture', 'cargo-udeps', 'refactor', 'legacy', 'typescript'],
    tokenImpactLevel: 'low',
    tokenImpact: 'The scan is entirely tooling-driven. LLM cost is limited to triaging whether a reported field is genuinely dead or reached dynamically — a short judgement per finding.',
  },
  {
    id: 'type-drift', label: 'Type Drift Detection', description: 'Checks that static types still describe what actually arrives at runtime', category: 'structural',
    whenToUse: 'Any TypeScript or typed-Python project consuming external JSON — an API response, a config file, a database row. The compiler checks the *assertion*, not the data, so a backend that renamed a field keeps compiling and fails in production.',
    keyTools: 'Zod, Valibot, io-ts, ArkType, typia, Pydantic, attrs + cattrs, quicktype (schema → type generation)',
    tradeoffs: 'Runtime validation costs latency on hot paths and duplicates the type declaration unless the schema is the single source both derive from. Validating everything is over-correction; the boundary is where it pays.',
    autoDetectSignals: ['zod', 'valibot', 'io-ts', 'arktype', 'typia', 'pydantic', 'typescript', 'api', 'json', 'openapi'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Deriving a runtime schema from an existing type (or the reverse) is a per-boundary generation cost. Ongoing drift reports are cheap; the initial schema authoring pass is the spike.',
  },
  {
    id: 'dependency-graph', label: 'Dependency Graph Integrity', description: 'Asserts the module graph has no cycles and respects declared layer boundaries', category: 'structural',
    whenToUse: 'Layered or modular codebases where an architectural rule exists but nothing enforces it — "the domain layer must not import the UI". Without a test, the rule survives exactly as long as the person who remembers it.',
    keyTools: 'dependency-cruiser, madge, eslint-plugin-boundaries, Nx module boundaries, import-linter (Python), go-arch-lint, ArchUnit (Java)',
    tradeoffs: 'The rule set is the hard part, not the tool — an over-strict boundary produces constant justified violations and gets disabled. Cycles in generated or vendored code need exclusions.',
    autoDetectSignals: ['dependency-cruiser', 'madge', 'nx', 'turborepo', 'lerna', 'monorepo', 'import-linter', 'archunit', 'hexagonal', 'clean architecture', 'ddd'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Graph analysis is tooling-driven. LLM involvement is limited to authoring the initial boundary rules and explaining a cycle\'s shortest path when one appears.',
  },

  // ── Behavioral: parity, consistency, and constraint ──────────────
  {
    id: 'cross-surface-parity', label: 'Cross-Surface Property Parity', description: 'Asserts the same rule produces the same answer on every surface that states it', category: 'behavioral',
    whenToUse: 'Products where one fact is displayed in several places — a CLI and a web UI, a dashboard card and the detail page it links to, an API and the SDK wrapping it. The failure this catches is two surfaces disagreeing about the same number, which reads as a data bug and is really a duplicated rule.',
    keyTools: 'Shared fixture suites, Vitest/Jest table-driven tests, golden files, contract-style shared assertions, Playwright + API cross-checks',
    tradeoffs: 'Only pays where a rule is genuinely duplicated; forcing parity onto surfaces that legitimately differ produces tests that block valid divergence. Requires naming the canonical source, which is a design decision the test cannot make for you.',
    autoDetectSignals: ['cli', 'dashboard', 'sdk', 'multi-surface', 'webview', 'api', 'monorepo', 'design system'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Identifying which rules are duplicated across surfaces takes cross-file reading; once the shared fixture exists, each added surface is cheap.',
  },
  {
    id: 'cross-representation', label: 'Cross-Representation Consistency', description: 'Asserts a value survives every round trip between its representations', category: 'behavioral',
    whenToUse: 'Anywhere one value has several forms — JSON and a database row, a domain object and its DTO, markdown and its parsed AST, a display string and the number behind it. Serialization asymmetry is the classic silent corruption: it writes fine, reads back subtly different, and nothing fails until much later.',
    keyTools: 'fast-check / Hypothesis round-trip properties, snapshot fixtures, JSON Schema validation, protobuf/Avro conformance suites',
    tradeoffs: 'Round-trip properties are only as good as the generator; a naive generator never produces the edge case (empty string, unicode, null vs absent) where asymmetry actually lives. Lossy-by-design conversions need explicit exclusion or they read as failures.',
    autoDetectSignals: ['serialization', 'serde', 'protobuf', 'avro', 'dto', 'orm', 'prisma', 'typeorm', 'sqlalchemy', 'json', 'parser', 'codec'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Enumerating a type\'s representations and writing the round-trip property is a per-type cost; generative execution afterwards is free of LLM involvement.',
  },
  {
    id: 'cross-version-parity', label: 'Cross-Version Parity', description: 'Asserts a new version still answers old inputs the way the old version did', category: 'behavioral',
    whenToUse: 'Libraries, APIs and file formats with existing consumers. Distinct from compatibility testing: this replays *real recorded behaviour* from the previous version rather than checking a declared contract, so it catches the change nobody documented.',
    keyTools: 'Golden/approval files, recorded request-response fixtures, API diffing (oasdiff, openapi-diff), semantic-release + api-extractor, Pact provider verification against prior consumer versions',
    tradeoffs: 'Golden files record whatever the old version did, bugs included — a fixed bug looks like a regression until the baseline is deliberately re-approved. Requires discipline about *why* a baseline changed.',
    autoDetectSignals: ['library', 'sdk', 'package', 'api', 'semver', 'api-extractor', 'oasdiff', 'openapi-diff', 'public api', 'backwards compatible'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Baseline capture is mechanical; the LLM cost is in adjudicating each diff — deciding whether a behaviour change is a fix or a break is a judgement call per finding.',
  },
  {
    id: 'semantic-constraint', label: 'Semantic Constraint Testing', description: 'Asserts domain invariants that types allow but the domain forbids', category: 'behavioral',
    whenToUse: 'Domains with rules the type system cannot express — an end date after its start, a total matching the sum of its parts, a state machine that never reaches a terminal state twice. The type says `Date`; the domain says "not before the other one".',
    keyTools: 'Zod refinements, class-validator, Pydantic validators, database CHECK constraints, fast-check preconditions, invariant assertions in domain models',
    tradeoffs: 'Constraints scattered across the code drift apart; they belong with the type they constrain. Over-constraining rejects legitimate historical data, which surfaces as a migration failure rather than a test one.',
    autoDetectSignals: ['domain', 'ddd', 'invariant', 'business rule', 'zod', 'class-validator', 'pydantic', 'state machine', 'xstate', 'booking', 'ledger', 'finance'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Eliciting the real domain rules is the expensive part and needs domain-document reading. Once declared, constraint checks execute without LLM involvement.',
  },
  {
    id: 'anti-uniformity', label: 'Anti-Uniformity Assertions', description: 'Fails when output is suspiciously identical — the shape a broken generator produces', category: 'behavioral',
    whenToUse: 'Generators, seeders, recommendation output, batch transforms, and any AI-produced set. A function returning the same value for every input passes every "is it a string?" assertion ever written. This is the assertion that catches a pipeline silently returning its default.',
    keyTools: 'Distinct-count assertions, entropy/variance checks, fast-check with distribution assertions, snapshot diversity checks, statistical spread assertions',
    tradeoffs: 'Legitimately uniform output (a constant-by-design field, a single-item input) trips the check, so the assertion needs a threshold rather than a binary. Too loose and it never fires; too tight and it flakes on small samples.',
    autoDetectSignals: ['generator', 'seed', 'faker', 'llm', 'openai', 'anthropic', 'recommendation', 'embedding', 'batch', 'etl', 'synthetic data'],
    tokenImpactLevel: 'low',
    tokenImpact: 'The assertions are small and statistical. Cost is limited to choosing a defensible threshold per output set, which is a one-off judgement.',
  },
  {
    id: 'output-schema-drift', label: 'Output Schema Drift Detection', description: 'Detects when produced output stops matching its own published schema', category: 'behavioral',
    whenToUse: 'Any producer with consumers it cannot see — a public API, an event stream, a webhook, a structured LLM response, an exported report. The producer\'s tests pass because they were updated alongside it; the consumer breaks because it was not.',
    keyTools: 'JSON Schema / Ajv, OpenAPI response validation, oasdiff, Avro/protobuf schema registry compatibility checks, Zod parse on output, Great Expectations for tabular output',
    tradeoffs: 'Only as strong as the schema\'s strictness — a schema permitting additional properties never detects an added field, which is exactly the change that breaks strict consumers. Requires deciding whether additive change is breaking for *your* consumers.',
    autoDetectSignals: ['openapi', 'asyncapi', 'json schema', 'ajv', 'webhook', 'event', 'kafka', 'avro', 'protobuf', 'schema registry', 'public api', 'llm', 'structured output'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Schema authoring and drift adjudication carry moderate cost; the validation itself is tooling-driven and runs without LLM involvement.',
  },
  {
    id: 'hallucination-detection', label: 'Hallucination Detection', description: 'Checks that model-stated facts are grounded in the sources actually provided', category: 'behavioral',
    whenToUse: 'Any feature where a model states facts a user will act on — RAG answers, summarisation, extraction, citations. A fluent, specific, entirely invented answer is indistinguishable from a correct one to every assertion except one that checks it against the source.',
    keyTools: 'RAGAS (faithfulness/groundedness), DeepEval, TruLens, Promptfoo assertions, LLM-as-judge with a citation requirement, entity overlap against source, Anthropic/OpenAI evals',
    tradeoffs: 'The grader is itself a model and can be wrong in the same direction as the thing it grades. Needs a human-labelled seed set to trust the grader, and a groundedness score is a signal, not a verdict.',
    autoDetectSignals: ['rag', 'retrieval', 'llm', 'openai', 'anthropic', 'langchain', 'llamaindex', 'embedding', 'vector', 'pinecone', 'chroma', 'summarisation', 'summarization', 'citation', 'agent'],
    tokenImpactLevel: 'high',
    tokenImpact: 'Every graded case runs at least one extra model call, often against long source context. The most token-expensive methodology in the catalogue — budget it as a sampled suite, not a per-commit gate.',
  },

  // ── Non-functional ──────────────────────────────────────────────
  {
    id: 'chaos', label: 'Chaos / Resilience', description: 'Injects failure deliberately to test that degradation is graceful', category: 'non-functional',
    whenToUse: 'Distributed systems and anything with a network dependency it does not control. Retry logic, timeouts, and circuit breakers are written once and never exercised — chaos testing is the only thing that runs them before production does.',
    keyTools: 'Chaos Mesh, LitmusChaos, Gremlin, AWS Fault Injection Simulator, Toxiproxy, Pumba, k6 with fault injection, Chaos Toolkit',
    tradeoffs: 'Dangerous without a blast radius and a stop button — chaos in production is a practice with prerequisites, not a starting point. Staging results only transfer if staging genuinely resembles production.',
    autoDetectSignals: ['kubernetes', 'k8s', 'microservice', 'distributed', 'grpc', 'kafka', 'rabbitmq', 'circuit breaker', 'resilience', 'retry', 'istio', 'service mesh', 'aws', 'terraform'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Experiment design and hypothesis authoring are moderate; failure-mode analysis after a run can require multi-turn investigation.',
  },
  {
    id: 'accessibility', label: 'Accessibility (a11y)', description: 'Automated and manual checks against WCAG success criteria', category: 'non-functional',
    whenToUse: 'Every product with a user interface, and a legal requirement for public sector, education, and increasingly commercial software (EAA, ADA, Section 508). Automated tooling reliably catches roughly a third of WCAG issues, which makes it necessary and not sufficient.',
    keyTools: 'axe-core, @axe-core/playwright, jest-axe, Pa11y, Lighthouse, WAVE, eslint-plugin-jsx-a11y, screen readers (NVDA, VoiceOver, JAWS) for the manual half',
    tradeoffs: 'A clean automated run is routinely mistaken for an accessible product. Keyboard traps, focus order, and meaningful alt text need a human. Colour-contrast checks flag decorative elements that need exclusion.',
    autoDetectSignals: ['react', 'vue', 'angular', 'svelte', 'axe-core', 'pa11y', 'lighthouse', 'wcag', 'a11y', 'accessibility', 'jsx-a11y', 'public sector', 'gov', 'storybook'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Rule violations come from tooling; the LLM cost is in remediation guidance — deciding the correct semantic markup or ARIA pattern is a per-violation judgement.',
  },
  {
    id: 'observability', label: 'Observability / Telemetry', description: 'Tests that logs, metrics and traces are emitted, correlated and complete', category: 'non-functional',
    whenToUse: 'Any service operated in production, and mandatory for anything with an on-call rotation. Telemetry is written once and verified never; the incident where a trace is missing its span is the wrong time to discover it.',
    keyTools: 'OpenTelemetry SDK test exporters, in-memory span exporters, Prometheus test registries, structured-log assertions, Grafana/Loki query tests, alert-rule unit tests (promtool)',
    tradeoffs: 'Asserting exact log strings makes refactoring painful — assert on structured fields and correlation ids, not on prose. Testing that a metric exists is easy; testing that it is *correct* under load is not.',
    autoDetectSignals: ['opentelemetry', 'otel', 'prometheus', 'grafana', 'datadog', 'sentry', 'jaeger', 'loki', 'pino', 'winston', 'structlog', 'observability', 'tracing', 'sre', 'on-call'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Asserting span shape and log structure is straightforward once the pattern exists; establishing what *should* be emitted for a given operation is the reasoning cost.',
  },

  // ── Data & schema ───────────────────────────────────────────────
  {
    id: 'data-quality', label: 'Data Quality', description: 'Asserts completeness, uniqueness, range and referential integrity of data itself', category: 'data-schema',
    whenToUse: 'Data pipelines, warehouses, ETL jobs, and any application whose correctness depends on the data being right rather than the code being right. Code tests pass on an empty table; a data-quality test does not.',
    keyTools: 'Great Expectations, dbt tests, Soda Core, Pandera, Deequ, Monte Carlo, SQL assertion suites',
    tradeoffs: 'Expectations drift from reality as the business changes, producing alert fatigue; they need an owner and a review cadence. Running full-table checks on large warehouses costs real money per run.',
    autoDetectSignals: ['dbt', 'great_expectations', 'great expectations', 'soda', 'pandera', 'deequ', 'airflow', 'dagster', 'prefect', 'snowflake', 'bigquery', 'redshift', 'etl', 'warehouse', 'pipeline', 'pandas'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Expectation authoring per column or table is a front-loaded cost; scheduled runs afterwards are tooling-only.',
  },
  {
    id: 'schema-migration', label: 'Schema Migration', description: 'Tests migrations apply, roll back, and preserve existing rows', category: 'data-schema',
    whenToUse: 'Any project with a persistent store and more than one deployment. A migration is the least reversible code in the codebase and is routinely the least tested — it runs once, against data no test fixture resembles.',
    keyTools: 'Testcontainers, Flyway/Liquibase test harness, Prisma Migrate, Alembic, Django migration tests, Atlas, pgTAP, sqitch verify scripts',
    tradeoffs: 'Testing against an empty schema proves nothing — the value comes from a seeded fixture that resembles production shape, which is work to build and keep current. Down-migrations are often untested because they are rarely run, which is precisely when they fail.',
    autoDetectSignals: ['prisma', 'flyway', 'liquibase', 'alembic', 'typeorm', 'knex', 'sequelize', 'django', 'activerecord', 'migration', 'postgres', 'mysql', 'sqlite', 'testcontainers', 'atlas'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Fixture design and reversibility reasoning per migration carry moderate cost; the harness runs without LLM involvement once established.',
  },
  {
    id: 'compatibility', label: 'Backward / Forward Compatibility', description: 'Tests old and new versions against each other in both directions', category: 'data-schema',
    whenToUse: 'Rolling deployments, event streams, mobile clients you cannot force-update, and persisted documents written by an older build. During any rolling deploy both versions run at once — forward compatibility (old code reading new data) is the half everyone forgets.',
    keyTools: 'Confluent Schema Registry compatibility modes, Avro/protobuf compatibility checks, buf breaking, expand-contract migration patterns, versioned fixture corpora',
    tradeoffs: 'Full N-1/N+1 matrix testing is expensive; most teams pick one direction and are surprised by the other. Forward compatibility constrains design permanently — unknown fields must be preserved, not dropped.',
    autoDetectSignals: ['kafka', 'avro', 'protobuf', 'buf', 'schema registry', 'grpc', 'event', 'mobile', 'react-native', 'rolling deploy', 'blue-green', 'canary', 'versioned', 'migration'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Reasoning about which direction a change breaks is per-change analysis; the compatibility check itself is tooling-driven.',
  },
  {
    id: 'state-drift', label: 'Memory / State Drift Detection', description: 'Detects when persisted state stops matching what the code believes it holds', category: 'data-schema',
    whenToUse: 'Long-lived stores written by successive versions — agent memory, user preferences, caches, session documents, event-sourced aggregates. The document on disk was written by a build that no longer exists, and the reader assumes a shape nobody re-checked.',
    keyTools: 'Versioned document schemas with migration ladders, Zod/Pydantic parse-on-read, snapshot corpora of historical documents, replay tests over an event log',
    tradeoffs: 'Requires keeping a corpus of genuinely old documents, which teams discard. Detecting drift is cheap; deciding whether an unrecognised document is corrupt or merely *newer* is the hard part, and getting it wrong overwrites good data.',
    autoDetectSignals: ['event sourcing', 'cqrs', 'redis', 'session', 'cache', 'localstorage', 'agent', 'memory', 'checkpoint', 'persisted', 'zustand', 'redux-persist', 'schema version'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Migration-ladder authoring per schema version is the cost; drift detection at read time runs without LLM involvement.',
  },

  // ── AI-specific ─────────────────────────────────────────────────
  {
    id: 'prompt-regression', label: 'Prompt Regression', description: 'Replays a graded case set so a prompt edit cannot silently degrade quality', category: 'ai-specific',
    whenToUse: 'Any product with a prompt in it. Prompts are edited like prose and deployed like code, with no equivalent of a failing build — a wording change that fixes one case and breaks nine is invisible without a replay set.',
    keyTools: 'Promptfoo, Braintrust, LangSmith, DeepEval, OpenAI Evals, Anthropic evals, Vitest + recorded fixtures with an LLM judge',
    tradeoffs: 'Model nondeterminism makes exact-match assertions flaky, so most assertions become graded and fuzzy — which means the grader needs its own validation. Case sets go stale as the product changes and need curation, not just accumulation.',
    autoDetectSignals: ['openai', 'anthropic', 'langchain', 'llamaindex', 'promptfoo', 'braintrust', 'langsmith', 'prompt', 'llm', 'gpt', 'claude', 'gemini', 'agent', 'eval'],
    tokenImpactLevel: 'high',
    tokenImpact: 'Every case in the set is a model call, and graded assertions add a second. Cost scales linearly with case count — run on prompt change rather than on every commit.',
  },
  {
    id: 'model-routing', label: 'Model Routing Correctness', description: 'Asserts the router picks the model the policy says it should, and fails over correctly', category: 'ai-specific',
    whenToUse: 'Any system choosing between models on cost, capability, latency or availability. A router silently sending every request to the most expensive model still returns correct answers — the bug is only visible on the invoice, and only weeks later.',
    keyTools: 'Table-driven tests over the routing function, fake provider adapters, budget-ceiling assertions, failover simulation with injected provider errors, cost-per-route snapshot tests',
    tradeoffs: 'Only meaningful when routing is a pure function of declared inputs; a router reaching into live provider state cannot be tested without stubbing that state, which is the work. Asserting exact model ids makes vendor releases a test-maintenance event.',
    autoDetectSignals: ['router', 'routing', 'openrouter', 'litellm', 'model selection', 'fallback', 'failover', 'openai', 'anthropic', 'ollama', 'multi-model', 'budget', 'cost'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Routing is a decision function — tests run against stubs with no model calls at all. One of the cheapest AI-specific policies to enforce.',
  },
  {
    id: 'guardrail', label: 'Guardrail Enforcement', description: 'Tests that safety policies actually refuse, including under adversarial input', category: 'ai-specific',
    whenToUse: 'Any model-backed feature reachable by untrusted input. A guardrail is written once, believed permanently, and bypassed by the first prompt injection nobody tried — a policy without a test is a comment.',
    keyTools: 'Promptfoo red-team plugins, Garak, PyRIT, NeMo Guardrails test suites, Llama Guard, Rebuff, adversarial case corpora, refusal assertions',
    tradeoffs: 'The adversarial case set is never complete, so passing means "not broken by what we tried". Grading a refusal is subtler than it looks — an over-refusing model passes the safety test and fails the product.',
    autoDetectSignals: ['guardrail', 'moderation', 'prompt injection', 'jailbreak', 'llama guard', 'nemo', 'garak', 'pyrit', 'safety', 'content policy', 'openai', 'anthropic', 'agent', 'tool use'],
    tokenImpactLevel: 'high',
    tokenImpact: 'Adversarial suites are large by necessity and every case is a model call, often with a graded judgement on top. Budget as a scheduled suite rather than a per-commit gate.',
  },
  {
    id: 'agent-collaboration', label: 'Agent Collaboration Correctness', description: 'Tests hand-offs, delegation limits, and that agents share no authority they should not', category: 'ai-specific',
    whenToUse: 'Multi-agent systems with delegation, sub-tasks, or tool sharing. The failure mode is authority accumulating across a hand-off — a restricted agent obtaining a capability by asking a permissive one — which every individual agent test passes.',
    keyTools: 'Deterministic fake agents, hand-off depth/cycle assertions, permission-intersection property tests, transcript replay, LangGraph/CrewAI test harnesses, trace assertions',
    tradeoffs: 'Requires the collaboration rules to be explicit before they can be tested; most systems discover their rules by writing this suite. End-to-end multi-agent runs are slow and nondeterministic — test the policy layer as a pure function wherever it can be extracted.',
    autoDetectSignals: ['multi-agent', 'crewai', 'langgraph', 'autogen', 'agent', 'handoff', 'delegation', 'orchestrator', 'swarm', 'subagent', 'tool use', 'mcp'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Policy-layer tests run on stubs with no model calls; only full-loop collaboration tests spend tokens. Keep the split and this stays inexpensive.',
  },
  {
    id: 'determinism-boundary', label: 'Determinism / Stochasticity Boundary', description: 'Asserts which parts of the system must be reproducible and which are allowed to vary', category: 'ai-specific',
    whenToUse: 'Any system mixing deterministic logic with model output. Without a declared boundary, a flaky test is indistinguishable from a real regression, and teams respond by retrying until green — which disables the suite in effect while it still reports passing.',
    keyTools: 'Seeded RNG, temperature-0 fixtures, cassette/VCR recording of model calls, canonical JSON hashing of deterministic stages, flake-detection reruns, snapshot tests on the deterministic side only',
    tradeoffs: 'Drawing the boundary is a design decision the test cannot make; drawing it too generously means the stochastic half is never asserted at all. Recorded cassettes go stale and hide genuine provider behaviour changes.',
    autoDetectSignals: ['llm', 'openai', 'anthropic', 'temperature', 'seed', 'random', 'nondeterministic', 'flaky', 'vcr', 'cassette', 'nock', 'msw', 'agent', 'simulation'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Deterministic stages are asserted with hashes and seeds at no model cost; recorded fixtures replace live calls on the stochastic side.',
  },

  // ── Compliance: security & privacy ──────────────────────────────
  {
    id: 'iso-27001', label: 'ISO/IEC 27001 Controls', description: 'Maps Annex A controls to the evidence that demonstrates each one', category: 'compliance-security',
    whenToUse: 'Organisations certified or seeking certification, and any vendor whose enterprise customers ask for it in procurement. The certification is organisational, but a meaningful share of Annex A lands on the codebase — access control, cryptography, logging, secure development.',
    keyTools: 'Control-mapping registers, Vanta, Drata, Secureframe, evidence-collection automation, internal audit checklists, Statement of Applicability',
    tradeoffs: 'Largely documentary — most Annex A controls are policy and process, not assertions, so treating this as an automated suite over-promises. The value is a maintained mapping from control to evidence, reviewed on a cadence.',
    autoDetectSignals: ['iso 27001', 'iso27001', 'isms', 'vanta', 'drata', 'secureframe', 'soa', 'statement of applicability', 'annex a', 'certification', 'enterprise'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Control-to-evidence mapping is a document-authoring cost, front-loaded and then reviewed periodically. No per-commit LLM involvement.',
  },
  {
    id: 'soc2', label: 'SOC 2 Type I/II', description: 'Checks Trust Services Criteria are met and, for Type II, evidenced over time', category: 'compliance-security',
    whenToUse: 'SaaS vendors selling to enterprises. Type I asks whether controls are designed correctly at a point in time; Type II asks whether they operated continuously over a period — which makes *evidence continuity* the thing to test, not just control existence.',
    keyTools: 'Vanta, Drata, Secureframe, Tugboat Logic, CI evidence exports, access-review automation, change-management logs',
    tradeoffs: 'Type II fails on gaps in evidence rather than on missing controls — a correctly-configured control with a three-week logging gap is a finding. Automation tooling reports readiness, which is not the same as an auditor\'s opinion.',
    autoDetectSignals: ['soc 2', 'soc2', 'trust services', 'vanta', 'drata', 'secureframe', 'saas', 'enterprise', 'audit', 'type ii'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Criteria mapping and evidence-gap narration are document work. Continuous evidence collection is tooling-driven.',
  },
  {
    id: 'gdpr', label: 'GDPR Data Handling', description: 'Tests lawful basis, minimisation, subject rights, and deletion actually work', category: 'compliance-security',
    whenToUse: 'Any product processing personal data of people in the EU or UK, regardless of where the company is. Several obligations are genuinely executable — a deletion request that leaves rows in a backup index, or an export missing a data category, is a testable defect.',
    keyTools: 'Data-flow mapping / RoPA, deletion-completeness tests across every store, export-completeness assertions, consent-state tests, retention-window checks, pseudonymisation verification',
    tradeoffs: 'Deletion is the hard one: caches, search indexes, analytics, backups and logs each hold copies the primary-store test never sees. A passing deletion test that only checks the main database gives false assurance, which is worse than none.',
    autoDetectSignals: ['gdpr', 'ccpa', 'privacy', 'personal data', 'pii', 'consent', 'ropa', 'data subject', 'dsar', 'right to erasure', 'eu', 'cookie'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Data-inventory reasoning is the front-loaded cost; deletion and export completeness tests then run as ordinary integration tests.',
  },
  {
    id: 'hipaa', label: 'HIPAA Technical Safeguards', description: 'Tests the Security Rule technical safeguards over protected health information', category: 'compliance-security',
    whenToUse: 'Any system handling PHI in the US — covered entities and their business associates alike. The technical safeguards (access control, audit controls, integrity, authentication, transmission security) are the most testable part of the rule.',
    keyTools: 'Encryption-at-rest/in-transit assertions, audit-log completeness tests, unique-user-identification checks, automatic-logoff tests, integrity verification, BAA inventory',
    tradeoffs: 'Technical safeguards are only part of the obligation — administrative and physical safeguards dominate and are not testable here. "Addressable" specifications require a documented decision, not a passing test.',
    autoDetectSignals: ['hipaa', 'phi', 'protected health', 'ephi', 'baa', 'healthcare', 'hl7', 'fhir', 'ehr', 'emr', 'patient', 'medical'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Safeguard-to-evidence mapping is document work; the executable subset runs as ordinary integration and audit-log tests.',
  },
  {
    id: 'pci-dss', label: 'PCI-DSS Application Security', description: 'Tests the application-layer requirements for handling cardholder data', category: 'compliance-security',
    whenToUse: 'Anything storing, processing or transmitting cardholder data. Requirement 6 (secure development) and Requirement 3 (protect stored data) map directly onto testable application behaviour — most usefully, that a PAN never reaches a log.',
    keyTools: 'PAN-in-logs scanners, tokenisation verification, TLS configuration tests, secret-scanning (gitleaks, trufflehog), SAST/DAST per Requirement 6, ASV scan reports, network segmentation tests',
    tradeoffs: 'Scope reduction is the real strategy — the fewer systems that touch a PAN, the smaller the testable surface. Testing an application that should never have held card data at all is effort spent defending the wrong architecture.',
    autoDetectSignals: ['pci', 'pci-dss', 'cardholder', 'payment', 'stripe', 'braintrust', 'adyen', 'checkout', 'pan', 'tokenisation', 'tokenization', 'merchant', 'ecommerce'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Requirement mapping is document work; PAN-leak and TLS assertions run as ordinary automated checks.',
  },
  {
    id: 'nist-800-53', label: 'NIST 800-53 / 800-171', description: 'Maps control families to implementation evidence for federal work', category: 'compliance-security',
    whenToUse: 'Federal systems (800-53) and contractors handling controlled unclassified information (800-171, required by DFARS). Also a well-structured control catalogue for anyone wanting one, independent of the US government context.',
    keyTools: 'OSCAL control catalogues and SSP tooling, compliance-as-code (InSpec, Open Policy Agent), SSP templates, POA&M registers, CMMC assessment guides',
    tradeoffs: 'The catalogue is very large — a control-by-control pass without tailoring to your baseline is months of documentation nobody reads. Start from the impact-level baseline, not the full catalogue.',
    autoDetectSignals: ['nist', '800-53', '800-171', 'oscal', 'fedramp', 'cmmc', 'dfars', 'cui', 'ssp', 'poa&m', 'federal', 'government', 'inspec'],
    tokenImpactLevel: 'high',
    tokenImpact: 'The control catalogue is large and each mapping needs justification prose. The most document-heavy policy here — scope it to a tailored baseline before starting.',
  },

  // ── Compliance: operational & process ───────────────────────────
  {
    id: 'change-management', label: 'Change-Management Compliance', description: 'Tests that changes reached production through the approvals the policy requires', category: 'compliance-operational',
    whenToUse: 'Regulated environments and any organisation asserting a change process to an auditor. Almost entirely checkable from repository and CI metadata — protected branches, required reviews, linked tickets, deployment approvals — which makes it the cheapest compliance policy to automate.',
    keyTools: 'Branch-protection API assertions, required-review checks, CODEOWNERS verification, deployment-approval gates, commit-to-ticket traceability, git history analysis',
    tradeoffs: 'Emergency changes are legitimate and will break a naive assertion — the policy needs a documented break-glass path, or the test trains people to bypass it. Measuring process compliance is not measuring change quality.',
    autoDetectSignals: ['change management', 'itil', 'cab', 'branch protection', 'codeowners', 'approval', 'sox', 'audit', 'release process', 'gitops'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Repository and CI metadata assertions are mechanical. Cost is limited to declaring the policy once.',
  },
  {
    id: 'audit-trail', label: 'Audit-Trail Completeness', description: 'Tests that every consequential action leaves an attributable, tamper-evident record', category: 'compliance-operational',
    whenToUse: 'Systems where "who did what, when" is a requirement — finance, healthcare, admin tooling, anything with privileged operations. The failure is silent: an action path added later that nobody wired to the audit log, discovered during an incident.',
    keyTools: 'Action-to-log coverage tests, append-only store verification, hash-chain/tamper-evidence checks, actor-attribution assertions, log-retention verification, structured audit-event schemas',
    tradeoffs: 'Coverage is the hard part — asserting the log works is easy, asserting that *every* privileged path writes to it requires enumerating those paths and keeping the list current. Audit logs holding request payloads become a privacy liability of their own.',
    autoDetectSignals: ['audit', 'audit log', 'auditlog', 'sox', 'hipaa', 'immutable', 'append-only', 'event log', 'admin', 'privileged', 'rbac', 'compliance'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Enumerating consequential actions is a reasoning pass over the codebase; the resulting assertions run as ordinary tests.',
  },
  {
    id: 'rbac-compliance', label: 'Access Control & RBAC', description: 'Tests that every role can do exactly what it should and nothing more', category: 'compliance-operational',
    whenToUse: 'Any multi-role system. Positive permission tests ("an admin can delete") are always written; negative ones ("a viewer cannot, via any route") rarely are — and privilege escalation lives entirely in the untested half.',
    keyTools: 'Role-matrix table tests, negative-authorization suites, OPA/Cedar policy tests, IAM policy simulators, permission-lattice property tests, session/tenant isolation tests',
    tradeoffs: 'A full role × resource × action matrix grows fast and much of it is uninteresting; property-based tests over the permission lattice cover more with less. Testing the policy layer proves nothing if a route bypasses it — the enforcement point must be single.',
    autoDetectSignals: ['rbac', 'abac', 'authorization', 'permissions', 'roles', 'casbin', 'opa', 'cedar', 'oso', 'keycloak', 'auth0', 'multi-tenant', 'iam', 'admin'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Deriving the intended role matrix is the reasoning cost; the generated negative suite then runs without LLM involvement.',
  },
  {
    id: 'data-retention', label: 'Data Retention & Deletion', description: 'Tests data is deleted when the policy says, and not before', category: 'compliance-operational',
    whenToUse: 'Wherever a retention schedule exists — privacy regulation, sector rules, or a customer contract. Retention has two failure directions and most teams test neither: data surviving past its window, and data destroyed before a legal-hold period ends.',
    keyTools: 'Retention-job tests with clock injection, cascade-deletion verification across every store, legal-hold override tests, backup-expiry verification, soft-delete purge tests',
    tradeoffs: 'Requires a clock seam or the test cannot reach the window at all. Backups are the usual gap — a retention test that stops at the primary store misses the copies that actually persist.',
    autoDetectSignals: ['retention', 'ttl', 'purge', 'legal hold', 'gdpr', 'archive', 'soft delete', 'cron', 'lifecycle', 's3 lifecycle', 'expiry', 'data lifecycle'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Retention rules are few and the tests are mechanical once a clock seam exists.',
  },

  // ── Compliance: software supply chain ───────────────────────────
  {
    id: 'sbom', label: 'SBOM Verification', description: 'Checks a software bill of materials is produced, complete and accurate', category: 'compliance-supply-chain',
    whenToUse: 'Anything shipped to enterprise or government customers (US EO 14028, EU CRA), and good practice generally. The useful test is not that an SBOM exists but that it *matches the artifact* — a stale SBOM is worse than none, because it is trusted.',
    keyTools: 'Syft, CycloneDX CLI, SPDX tools, Trivy, cdxgen, sbom-utility validation, GitHub dependency submission API',
    tradeoffs: 'Generation is easy and completeness is not — vendored code, system packages, and dynamically loaded plugins routinely go unlisted. Format validity is machine-checkable; accuracy is only as good as the generator\'s view of the build.',
    autoDetectSignals: ['sbom', 'cyclonedx', 'spdx', 'syft', 'grype', 'trivy', 'supply chain', 'eo 14028', 'cra', 'dependency-track', 'container', 'docker'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Generation and validation are entirely tooling-driven; LLM involvement is limited to explaining a completeness gap.',
  },
  {
    id: 'dependency-licensing', label: 'Dependency Licensing', description: 'Checks every dependency\'s licence is known and permitted by policy', category: 'compliance-supply-chain',
    whenToUse: 'Any product distributed to customers or sold commercially. A copyleft dependency added transitively by a minor version bump is the standard way this becomes a problem, and it is entirely preventable by a CI check.',
    keyTools: 'license-checker, licensee, FOSSA, Snyk License Compliance, ScanCode, pip-licenses, cargo-deny, go-licenses, Dependency-Track',
    tradeoffs: 'Declared licence metadata is often missing or wrong, so an unknown-licence list needs manual resolution rather than a blanket block. An allowlist that blocks the build on any unknown will be widened under deadline pressure unless someone owns triage.',
    autoDetectSignals: ['license', 'licence', 'fossa', 'scancode', 'cargo-deny', 'license-checker', 'pip-licenses', 'go-licenses', 'commercial', 'distribution', 'oss'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Scanning is tooling-driven; LLM cost is limited to resolving unknown or ambiguous licence declarations.',
  },
  {
    id: 'license-compatibility', label: 'Open-Source Licence Compatibility', description: 'Checks the combination of licences is compatible with how you distribute', category: 'compliance-supply-chain',
    whenToUse: 'Distributed software, and especially anything linking or bundling. Distinct from licence *inventory*: each licence can be individually permitted while the combination is still incompatible — GPL and Apache-2.0 in the same linked binary being the classic case.',
    keyTools: 'FOSSA policy engine, ScanCode + licensedcode, OSS Review Toolkit (ORT), SPDX licence expression evaluation, cargo-deny bans, copyleft-reach analysis',
    tradeoffs: 'Compatibility depends on how you distribute — linking, bundling, SaaS-only, or shipping a binary all give different answers for the same dependency set. A tool cannot know your distribution model; it must be declared, and a wrong declaration produces confidently wrong results.',
    autoDetectSignals: ['gpl', 'agpl', 'lgpl', 'copyleft', 'ort', 'fossa', 'spdx', 'distribution', 'binary', 'bundle', 'linking', 'proprietary', 'dual license'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Compatibility reasoning across a licence set is genuinely analytical and benefits from explanation per conflict; the scan feeding it is cheap.',
  },
  {
    id: 'secure-build-pipeline', label: 'Secure Build Pipeline (SLSA)', description: 'Verifies build provenance, isolation and integrity against a SLSA level', category: 'compliance-supply-chain',
    whenToUse: 'Any project whose consumers need to know an artifact came from the source it claims. SLSA levels give a concrete ladder — provenance generated (L1), hosted and authenticated build (L2), hardened and isolated (L3) — each with a checkable claim.',
    keyTools: 'slsa-github-generator, Sigstore/cosign, in-toto attestations, SLSA verifier, GitHub artifact attestations, reproducible-build checks, pinned action digests',
    tradeoffs: 'Level 3 requires build-platform properties most teams do not control, so the achievable target depends on the CI provider. Provenance nobody verifies at consumption time is documentation, not a control.',
    autoDetectSignals: ['slsa', 'sigstore', 'cosign', 'in-toto', 'provenance', 'attestation', 'supply chain', 'reproducible build', 'github actions', 'docker', 'container', 'signing'],
    tokenImpactLevel: 'low',
    tokenImpact: 'Provenance generation and verification are pipeline configuration. LLM involvement is one-off setup guidance.',
  },

  // ── Compliance: AI-specific ─────────────────────────────────────
  {
    id: 'ai-safety-compliance', label: 'AI Safety & Guardrail Compliance', description: 'Evidences that declared AI safety commitments are implemented and enforced', category: 'compliance-ai',
    whenToUse: 'Products making public safety claims, and anything in scope of the EU AI Act\'s obligations for high-risk or general-purpose systems. Distinct from guardrail *testing*: this asks whether the declared policy, the implementation, and the evidence agree.',
    keyTools: 'EU AI Act conformity checklists, NIST AI RMF mapping, model cards, system cards, guardrail-policy registers, incident-reporting procedures, red-team evidence retention',
    tradeoffs: 'Largely documentary and the regulatory picture is still moving, so a mapping built once goes stale. The executable half is already covered by guardrail enforcement testing — keep them distinct or you will duplicate evidence and still miss the policy gap.',
    autoDetectSignals: ['ai act', 'eu ai act', 'nist ai rmf', 'model card', 'system card', 'high-risk ai', 'ai governance', 'responsible ai', 'llm', 'openai', 'anthropic'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Policy-to-implementation mapping is document authoring, reviewed on a cadence rather than per commit.',
  },
  {
    id: 'model-output-risk', label: 'Model-Output Risk Classification', description: 'Tests that outputs are classified by risk and that the classification drives handling', category: 'compliance-ai',
    whenToUse: 'Products where some model outputs need different treatment — human review, a disclaimer, a refusal, or a log. A classifier that is never tested tends toward one class, which silently removes the review step it exists to trigger.',
    keyTools: 'Labelled risk corpora, confusion-matrix assertions, threshold calibration tests, Llama Guard / moderation-endpoint evaluation, escalation-path tests, anti-uniformity checks on classifier output',
    tradeoffs: 'Needs a labelled ground-truth set, which is real annotation work and the reason this is usually skipped. Accuracy alone is a misleading metric when risk classes are rare — measure recall on the rare class.',
    autoDetectSignals: ['moderation', 'classifier', 'risk', 'content policy', 'human review', 'escalation', 'llm', 'openai', 'anthropic', 'toxicity', 'safety'],
    tokenImpactLevel: 'high',
    tokenImpact: 'Corpus evaluation means a model call per labelled case, repeated whenever thresholds change. Sample rather than running the full corpus per commit.',
  },
  {
    id: 'bias-fairness', label: 'Bias, Fairness & Non-Discrimination', description: 'Tests outcomes across protected groups for unjustified disparity', category: 'compliance-ai',
    whenToUse: 'Any system whose output affects people\'s access to something — hiring, lending, housing, pricing, moderation, ranking. Legally required in several jurisdictions (NYC LL144, EU AI Act) and the disparity is invisible in aggregate accuracy, which is the metric everyone reports.',
    keyTools: 'Fairlearn, AI Fairness 360, What-If Tool, counterfactual/perturbation test sets, demographic parity and equalised-odds metrics, disparate-impact ratio, slice-based evaluation',
    tradeoffs: 'Fairness definitions are mathematically incompatible — satisfying demographic parity and equalised odds simultaneously is generally impossible, so the choice is a stated value judgement, not a technical default. Testing needs protected-attribute data, which privacy rules restrict collecting.',
    autoDetectSignals: ['fairness', 'bias', 'fairlearn', 'aif360', 'protected', 'demographic', 'hiring', 'lending', 'credit', 'ranking', 'recommendation', 'll144', 'eeoc', 'ml', 'model'],
    tokenImpactLevel: 'high',
    tokenImpact: 'Slice evaluation multiplies the case set by the number of groups compared, and counterfactual perturbation multiplies it again.',
  },
  {
    id: 'explainability', label: 'Explainability & Transparency', description: 'Tests that a decision can be explained to the person it affects', category: 'compliance-ai',
    whenToUse: 'Automated decisions with legal or significant effect — GDPR Article 22, the EU AI Act, and sector rules like ECOA adverse-action notices all require a meaningful explanation. The test is that the explanation is faithful to the decision, not merely that one is produced.',
    keyTools: 'SHAP, LIME, captum, counterfactual explanation generators, faithfulness/consistency assertions, model cards, decision-log inspection, reason-code verification',
    tradeoffs: 'A plausible explanation that does not reflect the actual decision is worse than none — post-hoc explainers can be unfaithful, and a fluent LLM rationale is not evidence of the reasoning that produced the answer. Testing faithfulness is harder than producing explanations.',
    autoDetectSignals: ['explainability', 'xai', 'shap', 'lime', 'captum', 'interpretability', 'article 22', 'adverse action', 'reason code', 'transparency', 'model card', 'ml'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Faithfulness checks run per sampled decision; the explainer itself is library code rather than a model call in classical ML settings.',
  },
  {
    id: 'ai-data-policy', label: 'AI Memory & Data-Use Policy', description: 'Tests that what the system remembers and sends matches what was promised', category: 'compliance-ai',
    whenToUse: 'Any AI product with memory, retrieval, or training feedback loops. Two commitments are routinely stated and rarely tested: that customer data does not train a model, and that a secret or another tenant\'s data never reaches a prompt.',
    keyTools: 'Redaction-boundary tests, prompt-payload inspection, tenant-isolation tests over retrieval, training-opt-out verification, memory-retention window tests, provider zero-retention configuration checks',
    tradeoffs: 'The boundary is only as good as its worst path — one un-redacted logging call or one retrieval query missing a tenant filter defeats the whole policy, so coverage matters more than depth here. Provider-side commitments cannot be tested locally, only configured and evidenced.',
    autoDetectSignals: ['rag', 'retrieval', 'memory', 'embedding', 'vector', 'multi-tenant', 'redaction', 'pii', 'training data', 'opt-out', 'zero retention', 'llm', 'openai', 'anthropic'],
    tokenImpactLevel: 'medium',
    tokenImpact: 'Boundary tests inspect payloads before dispatch and need no model calls; enumerating every path that reaches a prompt is the reasoning cost.',
  },

  // ── Compliance: industry-specific ───────────────────────────────
  {
    id: 'financial-compliance', label: 'Financial Services (FFIEC, MiFID II)', description: 'Sector controls for financial systems — records, reporting, resilience', category: 'compliance-industry',
    whenToUse: 'Banking, payments, brokerage and investment platforms. The testable core is record-keeping completeness, transaction reporting accuracy, timestamp precision, and operational resilience — MiFID II clock synchronisation and record retention being unusually precise requirements.',
    keyTools: 'Transaction-reporting reconciliation suites, immutable record stores (WORM), clock-synchronisation verification, best-execution reporting checks, DORA resilience testing, SOX change controls',
    tradeoffs: 'The obligations differ sharply by jurisdiction and licence type — a generic financial-compliance suite tests nothing precisely. Requires a compliance owner to state which obligations apply before any test is worth writing.',
    autoDetectSignals: ['ffiec', 'mifid', 'dora', 'psd2', 'open banking', 'fca', 'finra', 'sec', 'trading', 'brokerage', 'banking', 'ledger', 'settlement', 'kyc', 'aml'],
    tokenImpactLevel: 'high',
    tokenImpact: 'Regulation-to-control mapping is extensive document work and must be re-reviewed as rules change.',
  },
  {
    id: 'medical-compliance', label: 'Medical (FDA 21 CFR Part 11)', description: 'Electronic records and signatures validation for regulated medical software', category: 'compliance-industry',
    whenToUse: 'Software producing records submitted to the FDA, and medical device software more broadly (IEC 62304). Part 11 is unusually testable: audit trails, record integrity, signature binding, and access control are all assertions.',
    keyTools: 'Computer System Validation (IQ/OQ/PQ) protocols, audit-trail integrity tests, electronic-signature binding verification, IEC 62304 lifecycle records, requirements traceability matrices, GAMP 5',
    tradeoffs: 'Validation is a documented lifecycle, not a test suite — evidence of process is as regulated as evidence of function, which makes an agile workflow harder to evidence. Pairs necessarily with the V-Model.',
    autoDetectSignals: ['fda', '21 cfr', 'part 11', 'iec 62304', 'gamp', 'medical device', 'clinical', 'gxp', 'gmp', 'validation', 'csv', 'ehr', 'patient'],
    tokenImpactLevel: 'high',
    tokenImpact: 'Validation protocols and traceability matrices are large documents requiring per-requirement authoring.',
  },
  {
    id: 'automotive-compliance', label: 'Automotive (ISO 26262)', description: 'Functional safety evidence for road-vehicle electronics by ASIL level', category: 'compliance-industry',
    whenToUse: 'Automotive electronic control units and their software. The standard prescribes verification methods per ASIL level — including structural coverage requirements (MC/DC at ASIL D) that dictate exactly what the test suite must demonstrate.',
    keyTools: 'MC/DC coverage tools (VectorCAST, LDRA, Cantata), MISRA C static analysis, HARA and safety-case tooling, requirements traceability, fault-injection at the hardware boundary, ASPICE process assessment',
    tradeoffs: 'ASIL D structural coverage is expensive and non-negotiable — the level is determined by hazard analysis, not by preference. Toolchain qualification is itself a required activity, so unqualified tools cannot produce usable evidence.',
    autoDetectSignals: ['iso 26262', 'asil', 'autosar', 'misra', 'automotive', 'ecu', 'can bus', 'vehicle', 'aspice', 'functional safety', 'hara', 'embedded'],
    tokenImpactLevel: 'high',
    tokenImpact: 'Safety-case argumentation and per-requirement traceability are substantial document work alongside the coverage evidence.',
  },
  {
    id: 'aviation-compliance', label: 'Aviation (DO-178C)', description: 'Airborne software certification evidence by Design Assurance Level', category: 'compliance-industry',
    whenToUse: 'Software in certified aircraft systems. DO-178C defines objectives per DAL (A–E), with structural coverage — statement, decision, and MC/DC at Level A — and requirements-based testing as the backbone of the evidence package.',
    keyTools: 'Qualified verification tools (LDRA, VectorCAST, Rapita), requirements-based test generation, MC/DC analysis, traceability from requirement to test to code, DO-330 tool qualification, DO-331 model-based supplement',
    tradeoffs: 'The most demanding regime in this catalogue — Level A objectives require independence between development and verification, so the same person cannot write both. Certification cost is measured in engineer-years, not sprints.',
    autoDetectSignals: ['do-178', 'do178', 'dal', 'avionics', 'arinc', 'faa', 'easa', 'airborne', 'aerospace', 'do-330', 'do-331', 'mc/dc', 'embedded', 'safety-critical'],
    tokenImpactLevel: 'high',
    tokenImpact: 'Objective-by-objective evidence packages are the largest documentation burden here, with traceability required in both directions.',
  },
  {
    id: 'energy-compliance', label: 'Energy (NERC CIP)', description: 'Critical infrastructure protection controls for bulk electric systems', category: 'compliance-industry',
    whenToUse: 'Operators of bulk electric system cyber assets in North America. The testable core is asset inventory accuracy, electronic security perimeter enforcement, access revocation timeliness, and patch-management evidence — all with prescribed deadlines.',
    keyTools: 'BES cyber asset inventory reconciliation, ESP firewall-rule verification, access-revocation timing tests, patch-assessment evidence (35-day cycle), configuration-change monitoring, CIP-013 supply chain evidence',
    tradeoffs: 'Penalties are substantial and evidence is audited on fixed cycles, so gaps in *evidence continuity* matter as much as gaps in control. Operational technology environments often cannot run the tooling that IT compliance assumes.',
    autoDetectSignals: ['nerc', 'cip', 'bulk electric', 'bes', 'scada', 'ics', 'ot security', 'iec 62443', 'utility', 'grid', 'substation', 'critical infrastructure'],
    tokenImpactLevel: 'high',
    tokenImpact: 'Control-family evidence mapping plus periodic re-attestation makes this document-heavy and recurring rather than one-off.',
  },
];

/**
 * Per-methodology project-level configuration. Stored in
 * `project_memory/index/testing-config.json`.
 */
export interface ProjectTestingMethodologyConfig {
  id: TestingMethodologyId;
  enabled: boolean;
  /** Agent ID assigned as primary handler for this methodology. */
  assignedAgentId?: string;
  /**
   * Model ID to use when running tasks under this methodology.
   * Falls back to the assigned agent's `allowedModels` / global router.
   */
  assignedModelId?: string;
  /** Free-form notes visible in the Testing Strategy dashboard. */
  notes?: string;
  /**
   * Hold back non-test writes until this methodology's evidence has been seen.
   *
   * Off by default, and deliberately opt-in per methodology rather than a single
   * project-wide switch. Enabling a methodology is a statement of intent that
   * should be safe to make; turning one into a *gate* changes how every task in
   * the project runs, and that is a decision worth taking one methodology at a
   * time. A project can therefore declare fourteen methodologies as the standard
   * it holds itself to and block on only the one or two it is willing to stop
   * work over.
   *
   * Introduced with schema version 2; absent on a v1 file and migrated in as
   * `false`, so no existing project acquires a gate it did not ask for.
   */
  blocking?: boolean;
}

export interface ProjectTestingConfig {
  /**
   * 1 — the original shape.
   * 2 — methodologies may carry `blocking`.
   *
   * Read through `interpretVersionedDocument`, so a file written by a newer
   * AtlasMind is *refused* rather than treated as absent and overwritten.
   */
  version: 1 | 2;
  updatedAt: string;
  methodologies: ProjectTestingMethodologyConfig[];
}

// ── Data Privacy ─────────────────────────────────────────────────

/**
 * How sensitive a classified data point is. Surfaced in redaction notices and
 * the audit log; does not (currently) change enforcement — any classified
 * content is gated to trusted models regardless of level.
 */
export type DataPrivacySensitivity = 'confidential' | 'proprietary' | 'secret';

/**
 * A single user-defined privacy rule. Matches either text content (literal
 * term or regex) or a file/folder path (glob). Any match marks the surrounding
 * context as classified, which gates model routing to the trusted allow-list.
 */
export interface DataPrivacyRule {
  id: string;
  kind: 'term' | 'regex' | 'path';
  /** The literal term, regex source, or workspace-relative glob. */
  value: string;
  /** Optional human label shown in redaction notices (never the value itself). */
  label?: string;
  sensitivity: DataPrivacySensitivity;
  enabled: boolean;
}

/**
 * Project-scoped data-privacy policy. Stored at
 * `project_memory/operations/data-privacy.json`.
 *
 * Classified content (matched by custom {@link DataPrivacyRule}s or enabled
 * compliance packs) may only be sent to models listed in `trustedModelIds`.
 * Enforcement is primarily a routing gate ({@link RoutingConstraints.requireTrustedModel});
 * the orchestrator's redaction boundary is the fail-safe when a trusted model
 * cannot be selected.
 */
export interface DataPrivacyConfig {
  version: 1;
  /** Master switch. When false, no classification or gating occurs. */
  enabled: boolean;
  /** User-defined term/regex/path rules. */
  rules: DataPrivacyRule[];
  /**
   * IDs of enabled built-in compliance packs (e.g. `gdpr-pii`, `hipaa-phi`,
   * `pci-dss`). Each pack contributes regulated-data detectors to the
   * classifier. See `src/core/compliancePacks.ts`.
   */
  compliancePacks: string[];
  /** Model IDs permitted to receive classified content. Empty = nothing trusted. */
  trustedModelIds: string[];
  updatedAt?: string;
}

/** A single classification hit, used for notices and audit logging. */
export interface DataPrivacyMatch {
  /** `rule:<id>` for custom rules or `pack:<packId>:<detectorId>` for packs. */
  source: string;
  /** Human label for the notice (e.g. "GDPR PII — email address"). */
  label: string;
  sensitivity: DataPrivacySensitivity;
}

/**
 * One recorded "catch" — a point in time at which a custom rule or compliance
 * detector matched task context. Aggregated into the Privacy dashboard charts.
 * Values are never stored; only the source/label and sensitivity.
 */
export interface DataPrivacyActivityEvent {
  /** Epoch milliseconds. */
  ts: number;
  source: string;
  label: string;
  sensitivity: DataPrivacySensitivity;
  /** Whether the selected model was trusted (false = content was redacted). */
  trusted: boolean;
}

// ── Skills ──────────────────────────────────────────────────────

/**
 * Optional hooks injected into the Orchestrator to decouple it from
 * tool-approval, checkpointing, webhook dispatch, and post-tool
 * verification without inflating the constructor parameter list.
 */
export interface OrchestratorHooks {
  /**
   * Host-owned settings reader. The core orchestrator has no direct dependency
   * on VS Code so the same runtime can run behind a stdio ACP client or CLI.
   */
  readSetting?: <T>(key: string, fallback: T) => T;

  /** Gate function that determines whether a tool invocation should proceed. */
  toolApprovalGate?: (
    taskId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<{ approved: boolean; reason?: string }>;

  /** Gate function for warning-level auto-generated skills before in-process execution. */
  generatedSkillApprovalGate?: (
    skillId: string,
    scanResult: SkillScanResult,
    source: string,
  ) => Promise<{ approved: boolean; reason?: string }>;

  /** Pre-tool hook that snapshots affected files for later rollback. */
  writeCheckpointHook?: (
    taskId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<void>;

  /** Verifies the workspace state after a batch of tool invocations. */
  postToolVerifier?: (
    invocations: Array<{ toolName: string; args: Record<string, unknown>; result: string }>,
  ) => Promise<string | undefined>;

  /**
   * Called after a subscription request completes and quota has been decremented.
   * `remainingRequests` is the new value after decrement; `totalRequests` is the
   * billing-period cap.  Use this to persist quota and emit exhaustion warnings.
   *
   * `scope` names the plan that was spent, which is a **provider id** for a
   * provider fronting a single subscription and a **model id** for one fronting
   * several (ACP). Resolve it for display rather than assuming a provider — see
   * `ModelRouter.setModelSubscriptionQuota`.
   */
  onQuotaUpdated?: (scope: string, remainingRequests: number, totalRequests: number) => void;

  /**
   * Called after a model's execution outcome is recorded (Direction 2 —
   * outcome-driven routing). Receives the full snapshot of decayed per-model
   * outcome state so it can be persisted across sessions.
   */
  onModelOutcomeRecorded?: (outcomes: Record<string, { ewma: number; samples: number }>) => void;

  /**
   * Called after a model's struggle signal is recorded or recovered. Receives
   * the full snapshot of per-(model × task-signature) struggle state so it can
   * be persisted across sessions, mirroring `onModelOutcomeRecorded`.
   */
  onModelStruggleRecorded?: (signals: Record<string, ModelStruggleState>) => void;

  /**
   * Called each time the active model changes during task execution — on initial
   * selection, provider failover, tool-capability re-route, and escalation.
   * Callers can use this to show a live model indicator in the UI.
   */
  onModelSelected?: (model: string) => void;

  /**
   * Called once when the agentic loop produces a final response, before that
   * response is returned to the caller. Implementors should inspect the response
   * for signs that the stated goal was not fully achieved and return any blockers.
   * When blockers are returned the orchestrator injects a single re-prompt and
   * continues the loop so the agent can resolve them or declare them explicitly.
   *
   * Return `{ passed: true }` (or omit `blockers`) to let the response through.
   */
  definitionOfDoneChecker?: (
    goal: string,
    response: string,
    tddStatus: 'verified' | 'blocked' | 'missing' | 'not-applicable' | undefined,
    agentRole: string,
  ) => Promise<{ passed: boolean; blockers?: string[] }>;

  /**
   * Called when a task's context contains data classified by the Data Privacy
   * policy but no trusted model is available to receive it. The orchestrator
   * redacts the classified spans regardless (fail-safe); this hook lets the UI
   * surface a notice prompting the user to assign a trusted model/provider.
   * Fire-and-forget — the orchestrator does not await a decision.
   */
  onClassifiedContentForUntrustedModel?: (info: {
    selectedModel: string;
    matches: DataPrivacyMatch[];
  }) => void;
}

/**
 * Runtime-configurable orchestrator tunables.
 * Values are read from `atlasmind.*` VS Code settings with constant defaults.
 */
export interface OrchestratorConfig {
  maxToolIterations: number;
  maxToolCallsPerTurn: number;
  toolExecutionTimeoutMs: number;
  providerTimeoutMs: number;
}

/**
 * Runtime context provided to skill handlers.
 * Abstracts VS Code APIs so skills remain independently testable.
 */
export interface SkillExecutionContext {
  /** Absolute filesystem path to the workspace root, or undefined if no workspace is open. */
  workspaceRootPath: string | undefined;
  /** Search the in-memory SSOT index for relevant entries. */
  queryMemory(query: string, maxResults?: number): Promise<MemoryEntry[]>;
  /** Add or update an entry in the in-memory SSOT index and optionally persist to disk. */
  upsertMemory(entry: MemoryEntry): MemoryUpsertResult;
  /** Remove an entry from the in-memory SSOT index and optionally delete the file on disk. */
  deleteMemory(path: string): Promise<boolean>;
  /** Read the UTF-8 text content of a file by absolute path. */
  readFile(absolutePath: string): Promise<string>;
  /** Write UTF-8 text to a file by absolute path. Rejects paths outside the workspace root. */
  writeFile(absolutePath: string, content: string): Promise<void>;
  /** Find files matching a glob pattern relative to the workspace root. Returns absolute paths. */
  findFiles(globPattern: string): Promise<string[]>;
  /** Search UTF-8 text files in the workspace and return matching lines. */
  searchInFiles(
    query: string,
    options?: { isRegexp?: boolean; includePattern?: string; maxResults?: number },
  ): Promise<Array<{ path: string; line: number; text: string }>>;
  /** List the direct children of a workspace-relative or absolute directory path. */
  listDirectory(absolutePath?: string): Promise<Array<{ path: string; type: 'file' | 'directory' }>>;
  /** Execute a subprocess without shell interpolation and capture stdout/stderr. */
  runCommand(
    executable: string,
    args?: string[],
    options?: { cwd?: string; timeoutMs?: number },
  ): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }>;
  /** Return `git status --short --branch` for the workspace repository. */
  getGitStatus(): Promise<string>;
  /** Return `git diff` output for the workspace repository. */
  getGitDiff(options?: { ref?: string; staged?: boolean }): Promise<string>;
  /** Restore the most recent automatic checkpoint captured before write-capable tool use. */
  rollbackLastCheckpoint(): Promise<{ ok: boolean; summary: string; restoredPaths: string[] }>;
  /** Validate or apply a unified git patch inside the workspace repository. */
  applyGitPatch(
    patch: string,
    options?: { checkOnly?: boolean; stage?: boolean },
  ): Promise<{ ok: boolean; stdout: string; stderr: string }>;
  /** Return `git log` output for the workspace repository. */
  getGitLog(options?: { maxCount?: number; ref?: string; filePath?: string }): Promise<string>;
  /** Manage git branches: list, create, switch, or delete. */
  gitBranch(action: 'list' | 'create' | 'switch' | 'delete', name?: string): Promise<string>;
  /** Delete a file inside the workspace by absolute path. */
  deleteFile(absolutePath: string): Promise<void>;
  /** Move or rename a file inside the workspace. Both paths must be absolute workspace paths. */
  moveFile(sourcePath: string, destPath: string): Promise<void>;
  /** Get LSP diagnostics (compiler errors/warnings) for files in the workspace. */
  getDiagnostics(filePaths?: string[]): Promise<Array<{ path: string; line: number; column: number; severity: string; message: string; source?: string }>>;
  /** Retrieve a stored API key for a specialist integration (e.g. 'exa', 'elevenlabs'). Returns undefined if not configured. */
  getSpecialistApiKey(providerId: string): Promise<string | undefined>;
  /** List the names of currently visible VS Code output channels. Returns empty array in non-VS-Code environments. */
  getOutputChannelNames(): Promise<string[]>;
  /** Read the recent content logged to a named VS Code output channel by AtlasMind itself. Returns empty string if the channel is not tracked or unavailable. */
  getAtlasMindOutputLog(): Promise<string>;
  /** List active debug sessions with their type and name. Returns empty array when no debug session is running. */
  getDebugSessions(): Promise<Array<{ id: string; name: string; type: string }>>;
  /**
   * Ask another agent a question, and get its answer back.
   *
   * **Optional on purpose.** Only the orchestrator can run an agent, and the
   * CLI context and unit tests have no orchestrator — a tool that found this
   * absent must refuse with a reason, not crash. Its absence is the honest
   * report that delegation is unavailable here.
   *
   * The implementation is responsible for the authorization rule, which is not
   * negotiable at this layer: **a delegate runs with at most the caller's
   * capabilities, never the union.** See `agentHandoff.ts`.
   */
  runAgent?(request: {
    targetAgentId: string;
    reason: string;
    question: string;
    callerAgentId: string;
    callerTaskId: string;
  }): Promise<string>;
  /** Evaluate an expression in the currently paused debug session. Returns the result or an error string. */
  evaluateDebugExpression(expression: string, frameId?: number): Promise<string>;
  /**
   * Return recent output lines from a named VS Code integrated terminal.
   * If `terminalName` is omitted the most-recently-active terminal is used.
   * Returns an empty string when no matching terminal is found or the
   * environment does not support terminal reads.
   */
  getTerminalOutput(terminalName?: string): Promise<string>;
  /** List document symbols (functions, classes, variables) in a file using the VS Code symbol provider. */
  getDocumentSymbols(absolutePath: string): Promise<Array<{ name: string; kind: string; range: string; children?: string[] }>>;
  /** Find all references to a symbol at a given position. */
  findReferences(absolutePath: string, line: number, column: number): Promise<Array<{ path: string; line: number; column: number; text: string }>>;
  /** Go to definition of a symbol at a given position. */
  goToDefinition(absolutePath: string, line: number, column: number): Promise<Array<{ path: string; line: number; column: number }>>;
  /** Rename a symbol across the workspace using the VS Code rename provider. */
  renameSymbol(absolutePath: string, line: number, column: number, newName: string): Promise<{ filesChanged: number; editsApplied: number }>;
  /** Fetch text content from a URL. Returns the response body as text (HTML→markdown conversion for web pages). */
  fetchUrl(url: string, options?: { maxBytes?: number; timeoutMs?: number }): Promise<{ ok: boolean; status: number; body: string }>;
  /** Make a bounded HTTP request with optional method, headers, and body. Subject to the same timeout and size limits as fetchUrl. */
  httpRequest(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; maxBytes?: number; timeoutMs?: number }): Promise<{ ok: boolean; status: number; body: string }>;
  /** Get code actions (quick-fixes, refactorings) available at a position or range. */
  getCodeActions(absolutePath: string, startLine: number, startColumn: number, endLine: number, endColumn: number): Promise<Array<{ title: string; kind?: string; isPreferred?: boolean }>>;
  /** Apply a code action by title at a given position or range. */
  applyCodeAction(absolutePath: string, startLine: number, startColumn: number, endLine: number, endColumn: number, actionTitle: string): Promise<{ applied: boolean; reason?: string }>;
  /**
   * List installed VS Code extensions with their id, display name, version, and whether the
   * extension is currently active (activated and running). Note: `isActive` reflects the VS Code
   * `Extension.isActive` flag — it is `true` once the extension has been activated this session,
   * and `false` for extensions that have not yet been activated (e.g. lazy-activated extensions).
   * Returns an empty array in non-VS-Code environments.
   */
  getInstalledExtensions(): Promise<Array<{ id: string; displayName: string; version: string; isActive: boolean }>>;
  /**
   * Return a list of currently forwarded ports from the VS Code Remote/Tunnels API.
   * Returns an empty array when no ports are forwarded or the API is unavailable.
   */
  getPortForwards(): Promise<Array<{ portNumber: number; label?: string; localAddress?: string; privacy?: string }>>;
  /** Get a summary of the most recent VS Code test run results. Returns counts per state (passed, failed, skipped, errored). */
  getTestResults?(): Promise<Array<{ id: string; completedAt: number; durationMs?: number; counts: Record<string, number> }>>;
  /** Get info about the currently active VS Code debug session, or null if none is active. */
  getActiveDebugSession?(): Promise<{ id: string; name: string; type: string } | null>;
  /** List the names of currently open integrated terminals. */
  listTerminals?(): Promise<Array<{ name: string }>>;
  /** Open a URL in the VS Code Simple Browser panel. No-op in non-VS-Code environments. */
  openSimpleBrowser?(url: string, title?: string): Promise<void>;
  /** List VS Code debug launch configurations from .vscode/launch.json. Returns empty array when none exist. */
  getDebugConfigs?(): Promise<Array<{ name: string; type: string; request: string }>>;
  /** Start a VS Code debug session by configuration name. Returns ok=false with a message on failure. */
  launchDebugSession?(configName: string): Promise<{ ok: boolean; message: string }>;
  /** List all breakpoints currently set in the workspace. */
  getBreakpoints?(): Promise<Array<{ id: string; path: string; line: number; enabled: boolean; condition?: string }>>;
  /** Add a source breakpoint at the given absolute file path and 1-based line number. Returns the new breakpoint ID. */
  addBreakpoint?(absolutePath: string, line: number, options?: { condition?: string; logMessage?: string }): Promise<string>;
  /** Remove breakpoints by their IDs. Returns the count of breakpoints actually removed. */
  removeBreakpoints?(ids: string[]): Promise<{ removed: number }>;
}

export type SkillHandler = (
  params: Record<string, unknown>,
  context: SkillExecutionContext,
) => Promise<string>;

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  /** JSON Schema object describing the input parameters for this skill. */
  parameters: Record<string, unknown>;
  execute: SkillHandler;
  /** Absolute path to the source file. Present for custom (non-built-in) skills. */
  source?: string;
  /** True for skills shipped with the extension. Built-in skills default to enabled. */
  builtIn?: boolean;
  /** Optional Skills tree path segments used for built-in categories or custom folders. */
  panelPath?: string[];
  /** Per-skill execution timeout in milliseconds. Overrides the orchestrator default (15 000 ms) when set. */
  timeoutMs?: number;
  /** Optional natural-language phrases and aliases that help AtlasMind route freeform requests toward this skill. */
  routingHints?: string[];
}

// ── Skill security scanning ──────────────────────────────────────

export interface SkillScanIssue {
  /** Rule identifier, e.g. "no-eval". */
  rule: string;
  severity: 'error' | 'warning';
  /** 1-based line number in the source file. */
  line: number;
  /** The offending line of code (trimmed, max 120 chars). */
  snippet: string;
  message: string;
}

/** Overall result of a static security scan on a skill's source. */
export type SkillScanStatus = 'not-scanned' | 'passed' | 'failed';

export interface SkillScanResult {
  skillId: string;
  status: SkillScanStatus;
  /** ISO timestamp of when the scan completed. */
  scannedAt: string;
  issues: SkillScanIssue[];
}

// ── Project Routines ─────────────────────────────────────────────

/** A single shell-command step within a routine. */
export interface RoutineStep {
  id: string;
  label: string;
  /** Shell command to execute. Supports ${message} and ${version} interpolation. */
  run: string;
  on_fail: 'abort' | 'prompt' | 'continue';
}

/** A named, executable workflow stored in project_memory/routines/. */
export interface RoutineDefinition {
  id: string;
  name: string;
  description: string;
  /** When true this routine is selected by /ship when no routine ID is specified. */
  default?: boolean;
  steps: RoutineStep[];
  /** Absolute path to the source .md file. Absent for built-in routines. */
  source?: string;
  builtIn?: boolean;
}

/** Result of executing a single step. */
export interface RoutineStepResult {
  stepId: string;
  label: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  skipped?: boolean;
}

/** Aggregate result of a full routine run. */
export interface RoutineRunResult {
  routineId: string;
  routineName: string;
  steps: RoutineStepResult[];
  succeeded: boolean;
  /** ID of the first step that failed, if any. */
  failedStep?: string;
  durationMs: number;
}

// ── Website Studio ───────────────────────────────────────────────

/** Hosting/CMS targets understood by the Website Studio. */
export type WebsitePlatformId =
  | 'cloudflare-pages'
  | 'github-pages'
  | 'wordpress-elementor'
  | 'wordpress'
  | 'vercel'
  | 'netlify'
  | 'azure-static-web-apps'
  | 'shopify'
  | 'webflow'
  | 'custom';

export type WebsiteWorkStatus = 'not-started' | 'draft' | 'review' | 'approved' | 'blocked';
export type WebsitePlatformStatus = 'not-planned' | 'planned' | 'configured' | 'live' | 'blocked';
export type WebsiteAutomationStatus = 'idea' | 'mapped' | 'configured' | 'verified' | 'paused';

/**
 * The kind of interface being designed.
 *
 * `website` preserves the full sitemap/SEO/hosting workflow. The other kinds
 * use the same screen, content, wireframe and UI-system core without pretending
 * that their eventual implementation is HTML or that it has a public URL.
 */
export type UiSurfaceKind =
  | 'website'
  | 'web-app'
  | 'mobile-app'
  | 'desktop-app'
  | 'editor-extension'
  | 'embedded-ui'
  | 'other';

/** Project-wide content rules applied to every screen and implementation. */
export interface UiContentDesign {
  voice: string;
  principles: string[];
  preferredTerms: string[];
  avoidedTerms: string[];
  readingLevel: string;
  locales: string[];
  accessibilityNotes: string;
}

export type UiRepositoryAdapterId = 'react' | 'static-html-css' | 'vscode-webview' | 'custom';
export type UiRepositoryMappingTargetKind = 'component' | 'token' | 'node';
export type UiRepositoryMappingCoverage = 'declared' | 'partial' | 'unsupported';

export type UiRepositoryMappingTarget =
  | { kind: 'component'; id: string }
  | { kind: 'token'; id: string }
  | { kind: 'node'; id: string; screenId: string };

export interface UiRepositoryMappingBaseline {
  graphRevision: number;
  designFingerprint: string;
  sourceFingerprint: string;
  verifiedAt: string;
}

export type UiRepositoryImportCapability = 'partial' | 'unsupported';
export type UiRepositoryImportFactKind = 'export' | 'property' | 'slot' | 'token' | 'selector';
export type UiRepositoryImportFindingSeverity = 'info' | 'loss' | 'unsupported';
export type UiRepositoryImportFindingCode =
  | 'react-static-only'
  | 'react-source-extension-unsupported'
  | 'react-props-not-found'
  | 'html-css-static-only'
  | 'html-css-source-extension-unsupported'
  | 'vscode-static-only'
  | 'vscode-source-extension-unsupported'
  | 'custom-adapter-unsupported'
  | 'source-symbol-not-found'
  | 'source-not-utf8'
  | 'no-structural-facts'
  | 'exact-relations-suggested';

export interface UiRepositoryImportFact {
  kind: UiRepositoryImportFactKind;
  name: string;
}

export interface UiRepositoryImportFinding {
  code: UiRepositoryImportFindingCode;
  severity: UiRepositoryImportFindingSeverity;
  message: string;
}

/** Host-created adapter evidence. It deliberately has no source-content field. */
export interface UiRepositoryImportReport {
  adapterId: UiRepositoryAdapterId;
  capability: UiRepositoryImportCapability;
  graphRevision: number;
  designFingerprint: string;
  sourceFingerprint: string;
  importedAt: string;
  facts: UiRepositoryImportFact[];
  suggestedPropertyMappings: Record<string, string>;
  suggestedSlotMappings: Record<string, string>;
  findings: UiRepositoryImportFinding[];
}

/** A declared bridge between one graph fact and one repository source location. */
export interface UiRepositoryMapping {
  id: string;
  label: string;
  adapterId: UiRepositoryAdapterId;
  target: UiRepositoryMappingTarget;
  /** Normalized workspace-relative file path; never an import string or command. */
  sourcePath: string;
  /** Optional export, selector, class, resource key, or equivalent adapter-owned name. */
  sourceSymbol: string;
  propertyMappings: Record<string, string>;
  slotMappings: Record<string, string>;
  coverage: UiRepositoryMappingCoverage;
  limitations: string[];
  /** Host-created fingerprints only. Mapping definition edits clear this baseline. */
  lastVerified: UiRepositoryMappingBaseline | null;
  /** Host-created structural evidence only. Mapping definition edits clear this report. */
  lastImport: UiRepositoryImportReport | null;
}

/**
 * A design-to-code handoff that remains useful for React Native, SwiftUI,
 * native desktop, game-engine UI, and other non-HTML targets.
 */
export interface UiImplementationGuide {
  targetTechnologies: string[];
  sourceRoots: string[];
  componentLocations: string[];
  notes: string[];
  repositoryMappingRevision: number;
  repositoryMappings: UiRepositoryMapping[];
}

/** Normalized, deliberately bounded client brief imported into Website Studio. */
export interface ClientWebsiteIntake {
  clientName: string;
  projectName: string;
  summary: string;
  goals: string[];
  audiences: string[];
  requiredFeatures: string[];
  contentSources: string[];
  brandNotes: string;
  constraints: string[];
  successMetrics: string[];
  targetLaunch?: string;
  budget?: string;
  stakeholders: string[];
}

/**
 * The structural role a drawn wireframe box claims. Deliberately a closed set:
 * generation reads the kind to decide what markup a box becomes, so a free-text
 * kind would put the generated element under the model's control rather than
 * the author's. `custom` is the honest escape hatch — it says "structure I have
 * not named", which generation renders as a plain container.
 */
export type WireframeElementKind =
  | 'nav'
  | 'hero'
  | 'section'
  | 'grid'
  | 'card'
  | 'media'
  | 'text'
  | 'form'
  | 'cta'
  | 'sidebar'
  | 'footer'
  | 'custom';

/**
 * A box on the wireframe canvas, in canvas units — never device pixels.
 *
 * `x`/`width` run across a fixed 1000-unit column grid and `y`/`height` down the
 * same unit. Storing pixels would record the author's monitor size in a
 * git-tracked SSOT file and make one design read differently on another
 * machine; a proportional grid is the claim the author actually made.
 */
export interface WireframeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One drawn element on a page's wireframe. */
export interface WebsiteWireframeElement {
  id: string;
  kind: WireframeElementKind;
  label: string;
  rect: WireframeRect;
  /** Containing element, for nested structure. Absent means top level. */
  parentId?: string;
  /**
   * Natural-language design intent for this element alone — what the author
   * would say if they pointed at it. Model-writable, so every reader that
   * interpolates it into a prompt must fence it.
   */
  designPrompt: string;
  notes: string;
}

/** Which viewport a wireframe describes. Each page holds one wireframe per breakpoint it has been drawn for. */
export type WireframeBreakpoint = 'desktop' | 'tablet' | 'mobile';

/** A page's drawn structure at one breakpoint. */
export interface WebsiteWireframe {
  breakpoint: WireframeBreakpoint;
  elements: WebsiteWireframeElement[];
}

/** Layout semantics shared by web and non-web UI targets. */
export type UiLayoutMode = 'free' | 'stack' | 'grid' | 'overlay';

/** How a node claims space on one axis. */
export type UiSizeMode = 'fixed' | 'fill' | 'hug';

/** Primary axis used when a container arranges its direct children. */
export type UiLayoutDirection = 'vertical' | 'horizontal';

/** Cross-axis placement for stack, grid, and overlay children. */
export type UiLayoutAlignment = 'start' | 'center' | 'end' | 'stretch';

/** Main-axis placement for the complete child run. */
export type UiLayoutDistribution = 'start' | 'center' | 'end' | 'space-between';

/** Whether a stack may continue its run on another row/column. */
export type UiLayoutWrap = 'nowrap' | 'wrap';

/** The base layout claim for one design node. */
export interface UiNodeLayout {
  mode: UiLayoutMode;
  rect: WireframeRect;
  widthMode: UiSizeMode;
  heightMode: UiSizeMode;
  hidden: boolean;
  direction: UiLayoutDirection;
  gap: number;
  padding: number;
  columns: number;
  align: UiLayoutAlignment;
  distribute: UiLayoutDistribution;
  minWidth: number | null;
  maxWidth: number | null;
  minHeight: number | null;
  maxHeight: number | null;
  wrap: UiLayoutWrap;
  order: number;
}

/**
 * An intentional viewport-specific departure from the base layout. Missing
 * properties inherit; storing a complete duplicate would make it impossible to
 * tell an override from a coincidentally equal value.
 */
export interface UiNodeViewportOverride {
  mode?: UiLayoutMode;
  rect?: WireframeRect;
  widthMode?: UiSizeMode;
  heightMode?: UiSizeMode;
  hidden?: boolean;
  direction?: UiLayoutDirection;
  gap?: number;
  padding?: number;
  columns?: number;
  align?: UiLayoutAlignment;
  distribute?: UiLayoutDistribution;
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
  wrap?: UiLayoutWrap;
  order?: number;
}

/**
 * One target-independent node in UI Studio's authoritative design graph.
 * References are stable identifiers, never source paths or executable values.
 */
export interface UiDesignNode {
  id: string;
  kind: WireframeElementKind;
  label: string;
  /** Authoring guard enforced by the reducer; it does not alter rendered output. */
  locked: boolean;
  parentId?: string;
  layout: UiNodeLayout;
  viewportOverrides: Partial<Record<WireframeBreakpoint, UiNodeViewportOverride>>;
  designPrompt: string;
  notes: string;
  contentRef?: string;
  styleRef?: string;
  componentRef?: string;
  /** Explicit reusable-definition instance; never inferred from selection. */
  componentInstance?: UiComponentInstance;
  /** Slot claimed inside the parent component instance, when applicable. */
  componentSlot?: string;
  /** Explicit content state selected for design review, not inferred runtime data. */
  previewContentState?: UiNodeContentState;
  /** Node-owned short interface copy; long-form screen copy remains in Markdown. */
  contentStatePresentations?: Partial<Record<Exclude<UiNodeContentState, 'default'>, UiNodeStatePresentation>>;
  /** Explicit sample-data projection for design review; never a production data source. */
  dataBinding?: UiNodeDataBinding;
  /** Stable reference to graph-owned asset metadata; never a source path or URL itself. */
  assetRef?: string;
}

export type UiNodeContentState = 'default' | 'empty' | 'loading' | 'error' | 'success';
export type UiContentMaturity = 'placeholder' | 'draft' | 'reviewed' | 'approved';

export interface UiNodeStatePresentation {
  title: string;
  body: string;
  actionLabel: string;
  maturity: UiContentMaturity;
}

export type UiContentFieldKind = 'text' | 'number' | 'boolean' | 'url' | 'date';
export type UiContentSampleValue = string | number | boolean;
export type UiNodeContentSlot = 'title' | 'body' | 'action';

export interface UiContentFieldDefinition {
  id: string;
  label: string;
  kind: UiContentFieldKind;
  required: boolean;
}

/** Bounded preview-only record. Production records and credentials never enter the design graph. */
export interface UiContentSampleRecord {
  id: string;
  label: string;
  values: Record<string, UiContentSampleValue>;
}

export interface UiContentCollection {
  id: string;
  label: string;
  description: string;
  fields: UiContentFieldDefinition[];
  samples: UiContentSampleRecord[];
}

export type UiDesignAssetKind = 'image' | 'illustration' | 'icon' | 'video-poster';
export type UiDesignAssetSourceKind = 'workspace' | 'https';
export type UiDesignAssetCrop = 'cover' | 'contain' | 'none';

/** A validated reference only. Binary content and credentials never enter the design graph. */
export interface UiDesignAssetSource {
  kind: UiDesignAssetSourceKind;
  reference: string;
}

/** Target-independent media intent shared by canvas, preview, and future repository adapters. */
export interface UiDesignAsset {
  id: string;
  label: string;
  kind: UiDesignAssetKind;
  source: UiDesignAssetSource;
  width: number;
  height: number;
  crop: UiDesignAssetCrop;
  /** Percentages in the closed 0..100 range. */
  focalPoint: { x: number; y: number };
  altText: string;
  decorative: boolean;
  maturity: UiContentMaturity;
}

export interface UiNodeDataBinding {
  collectionId: string;
  sampleRecordId: string;
  fieldMappings: Partial<Record<UiNodeContentSlot, string>>;
}

export type UiContentDiagnosticCode =
  | 'collection-not-found'
  | 'sample-record-not-found'
  | 'field-not-found'
  | 'sample-value-missing'
  | 'content-state-missing';

export interface UiContentDiagnostic {
  code: UiContentDiagnosticCode;
  severity: 'error' | 'warning';
  nodeIds: [string];
  message: string;
}

export type UiAssetDiagnosticCode = 'asset-not-found' | 'asset-alt-missing';

export interface UiAssetDiagnostic {
  code: UiAssetDiagnosticCode;
  severity: 'error' | 'warning';
  nodeIds: [string];
  message: string;
}

/** A page/screen projection in the shared design graph. */
export interface UiDesignScreen {
  /** Stable screen identity. Initially identical to the compatible page id. */
  id: string;
  pageId: string;
  /** False preserves the meaningful legacy state "this screen has not been drawn". */
  initialized: boolean;
  baseBreakpoint: WireframeBreakpoint;
  nodes: UiDesignNode[];
}

export type UiDesignTokenKind =
  | 'color'
  | 'font-family'
  | 'font-size'
  | 'font-weight'
  | 'line-height'
  | 'spacing'
  | 'radius'
  | 'shadow'
  | 'motion'
  | 'breakpoint';

export interface UiShadowTokenValue {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

export interface UiMotionTokenValue {
  durationMs: number;
  easing: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export type UiDesignTokenValue = string | number | UiShadowTokenValue | UiMotionTokenValue;

interface UiDesignTokenBase {
  id: string;
  label: string;
  kind: UiDesignTokenKind;
}

/** A token owns one typed value or aliases another token of the same kind. */
export type UiDesignToken =
  | (UiDesignTokenBase & { value: UiDesignTokenValue; aliasOf?: never })
  | (UiDesignTokenBase & { aliasOf: string; value?: never });

/** Closed, target-independent component property vocabulary. */
export type UiComponentPropertyKind = 'text' | 'number' | 'boolean' | 'choice';
export type UiComponentPropertyValue = string | number | boolean;

/** Interaction and system states that a reusable definition may explicitly support. */
export type UiComponentState =
  | 'default'
  | 'hover'
  | 'focus'
  | 'active'
  | 'disabled'
  | 'loading'
  | 'empty'
  | 'error'
  | 'success'
  | 'validation';

export interface UiComponentPropertyDefinition {
  id: string;
  label: string;
  kind: UiComponentPropertyKind;
  defaultValue: UiComponentPropertyValue;
  /** Required for `choice`; absent for every other property kind. */
  choices?: string[];
}

export interface UiComponentSlotDefinition {
  id: string;
  label: string;
  required: boolean;
  /** Empty means any bounded wireframe kind is accepted. */
  allowedKinds: WireframeElementKind[];
  maxChildren: number;
}

export interface UiComponentVariantDefinition {
  id: string;
  label: string;
  /** Values are checked against the definition's declared properties. */
  propertyValues: Record<string, UiComponentPropertyValue>;
}

/** A reusable, target-independent component definition. It stores no markup or executable style. */
export interface UiComponentDefinition {
  id: string;
  label: string;
  description: string;
  rootKind: WireframeElementKind;
  properties: UiComponentPropertyDefinition[];
  slots: UiComponentSlotDefinition[];
  variants: UiComponentVariantDefinition[];
  /** Always contains `default`; other entries are explicit design decisions. */
  states: UiComponentState[];
}

/** Bounded per-node departures from one reusable component definition. */
export interface UiComponentInstance {
  definitionId: string;
  variantId?: string;
  state: UiComponentState;
  propertyOverrides: Record<string, UiComponentPropertyValue>;
}

/**
 * UI Studio's authoritative visual-design document. `revision` is monotonic:
 * undo restores content from history but still advances this value so a stale
 * preview or webview event can never become current again by accident.
 */
export interface UiDesignGraph {
  revision: number;
  tokens: UiDesignToken[];
  components: UiComponentDefinition[];
  contentCollections: UiContentCollection[];
  assets: UiDesignAsset[];
  screens: UiDesignScreen[];
}

/**
 * A link leaving one page.
 *
 * `origin` separates a link somebody typed from one read off a nav or CTA box
 * on the wireframe. The distinction is load-bearing: a derived link may be
 * recomputed whenever the canvas changes, and a declared one may not — silently
 * overwriting a person's link because a box was moved would lose a decision.
 */
export interface WebsitePageLink {
  id: string;
  label: string;
  /** Another page in this workspace. */
  targetPageId?: string;
  /** An address outside the site. `https` only. */
  externalUrl?: string;
  origin: 'declared' | 'derived';
}

/** One page moving from sitemap through wireframe, visual design, content, and SEO review. */
export interface WebsitePagePlan {
  id: string;
  title: string;
  slug: string;
  purpose: string;
  template: string;
  sections: string[];
  wireframeNotes: string;
  designNotes: string;
  wireframeStatus: WebsiteWorkStatus;
  designStatus: WebsiteWorkStatus;
  contentStatus: WebsiteWorkStatus;
  seoStatus: WebsiteWorkStatus;
  /**
   * Explicit parent in the sitemap hierarchy. Absent means the parent is
   * derived from the slug path instead — which is what makes the hierarchy map
   * build itself as pages are added. An explicit value always wins, because it
   * is the one a person set on purpose.
   */
  parentId?: string;
  /** Sibling ordering. Ties are broken on id so the map cannot shuffle between renders. */
  order: number;
  /**
   * Natural-language design intent for the whole page. Enough of these and a
   * site can be taken to first-draft design from the sitemap alone, without
   * anybody drawing a box. Model-writable — fence before prompting.
   */
  designPrompt: string;
  links: WebsitePageLink[];
  /** Drawn structure. Absent means this page has never been opened on the canvas. */
  wireframe?: WebsiteWireframe;
}

/** Project-level UI direction. Values are design decisions, never generated CSS or executable code. */
export interface WebsiteDesignSystem {
  brandDirection: string;
  tone: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  headingFont: string;
  bodyFont: string;
  spacingScale: string;
  cornerStyle: string;
  accessibilityTarget: string;
  componentNotes: string[];
}

/** One possible publishing target. Secret values are intentionally excluded. */
export interface WebsitePlatformTarget {
  id: WebsitePlatformId;
  label: string;
  status: WebsitePlatformStatus;
  primary: boolean;
  siteUrl?: string;
  projectReference?: string;
  environmentReference?: string;
  notes: string;
}

/** The fixed website delivery environments presented by Website Studio. */
export type WebsiteHostingEnvironmentId = 'develop' | 'staging' | 'production';

/** Develop can run locally or use a guarded hosted fallback; later stages are hosted. */
export type WebsiteHostingMode = 'local' | 'hosted';

/** Access is policy-controlled by environment and is not freely user-selectable. */
export type WebsiteAccessPolicy = 'local-only' | 'password-protected' | 'public';

/**
 * One stage in Website Studio's fixed Develop → Staging → Production pipeline.
 * Credential references point to SecretStorage, environment variables, or an
 * external secret manager; raw passwords are deliberately outside this schema.
 */
export interface WebsiteHostingEnvironment {
  id: WebsiteHostingEnvironmentId;
  name: 'Develop' | 'Staging' | 'Production';
  purpose: string;
  hostingMode: WebsiteHostingMode;
  accessPolicy: WebsiteAccessPolicy;
  url?: string;
  branchReference?: string;
  credentialReference?: string;
  subdomainLabel?: string;
  notes: string;
  promotionProtected: boolean;
}

/**
 * A planned n8n workflow. `credentialReference` names an environment variable,
 * SecretStorage entry, or external secret-manager item; it must never contain
 * the credential or webhook value itself.
 */
export interface WebsiteAutomation {
  id: string;
  name: string;
  event: string;
  outcome: string;
  status: WebsiteAutomationStatus;
  n8nWorkflowId?: string;
  instanceUrl?: string;
  credentialReference?: string;
  dataNotes: string;
}

/**
 * The framework and platform a site is built and shipped with.
 *
 * One choice rather than two fields on separate pages: "Astro on Cloudflare
 * Pages" determines the build command, the output directory and the deploy
 * config together, and splitting the decision makes the compatible pairing
 * something the user is expected to already know.
 *
 * Absent means *not chosen*. It is never defaulted, and the v2 → v3 migration
 * deliberately does not guess one from the files on disk — a wrong guess here
 * scaffolds the wrong project.
 */
export interface WebsiteStackChoice {
  /** A `WebsiteFrameworkId` from `websiteFrameworks.ts`. */
  frameworkId: string;
  platformId: WebsitePlatformId;
  /** A `WebsitePackageManager`. Defaults to npm at the point of use, not here. */
  packageManager: string;
  /** ISO 8601. When the choice was made, so a stale pairing can be spotted. */
  decidedAt: string;
}

/**
 * Website Studio SSOT. Persisted to `project_memory/domain/website.json` with
 * a human-readable `website.md` mirror for review and version control.
 *
 * Version 2 added the wireframe canvas, sitemap hierarchy, link graph, and the
 * natural-language design prompts. The 1 → 2 step lives in `schemaMigration.ts`
 * and builds a stacked wireframe from the old `sections` array, so a project
 * written by an earlier build never opens onto an empty canvas.
 *
 * Version 3 added `stack`. The 2 → 3 step adds nothing but the version number:
 * an absent stack means nobody has chosen one, and a migration has no standing
 * to infer it.
 * Version 4 moved page copy into separately managed Markdown files. Version 5
 * generalizes the design core beyond websites with `surfaceKind`,
 * `contentDesign`, and `implementation`; existing projects migrate explicitly
 * to `website`, the only surface the older format could describe. Version 6
 * adds the revisioned target-independent design graph; the page wireframe is a
 * compatibility projection while existing readers move to that graph. Version
 * 7 adds typed token definitions without inventing any during migration.
 * Version 8 adds reusable component definitions and bounded instances; the
 * migration again adds only empty authority, never an inferred component.
 * Version 9 adds optional node-owned content-state presentations and changes
 * only the format number during migration so no interface copy is invented.
 * Version 10 adds bounded preview-only content collections and explicit node
 * bindings; migration adds an empty collection authority and invents no data.
 * Version 11 adds validated asset metadata and stable node references; migration
 * adds an empty asset authority rather than inspecting or guessing from files.
 * Version 13 adds bounded adapter evidence reports to revisioned repository mappings.
 */
export interface WebsiteWorkspaceConfig {
  version: 13;
  updatedAt: string;
  /** Which profile the shared UI-design core is serving. Defaults to website for migrated workspaces. */
  surfaceKind: UiSurfaceKind;
  intake: ClientWebsiteIntake;
  /**
   * Natural-language design intent for the site as a whole — the sentence every
   * page prompt is read against. Model-writable; fence before prompting.
   */
  designPrompt: string;
  pages: WebsitePagePlan[];
  designGraph: UiDesignGraph;
  designSystem: WebsiteDesignSystem;
  contentDesign: UiContentDesign;
  implementation: UiImplementationGuide;
  platforms: WebsitePlatformTarget[];
  hostingEnvironments: WebsiteHostingEnvironment[];
  automations: WebsiteAutomation[];
  /** The framework/platform pairing. Absent until somebody picks one. */
  stack?: WebsiteStackChoice;
}

// ── Delivery / Deployment Stages ─────────────────────────────────

/**
 * The lifecycle role a deployment stage plays. Drives pipeline ordering, the
 * default guardrails applied to it, and how strongly AtlasMind protects it.
 * `production` is the most protected; `local` the least.
 */
export type DeploymentStageKind =
  | 'local'
  | 'development'
  | 'staging'
  | 'production'
  | 'preview'
  | 'custom';

/**
 * Where a stage's runtime configuration and secrets live. Only a human label
 * and a workspace-relative path/reference are stored here — never secret VALUES,
 * which remain in VS Code SecretStorage or the user's own secret manager. This
 * preserves the redaction boundary: the dashboard can describe *where* config
 * comes from without ever surfacing the config itself.
 */
export interface StageConfigSource {
  /** Human label, e.g. ".env.staging" or "Doppler · staging". */
  sourceLabel?: string;
  /** Workspace-relative path or opaque reference (never a secret value). */
  sourcePath?: string;
}

/** Where a stage is hosted and how its health is checked after a promotion. */
export interface StageHosting {
  /** e.g. "Vercel", "AWS ECS", "Fly.io", "bare-metal". */
  provider?: string;
  /** Public URL of the running stage. */
  url?: string;
  /** Endpoint polled by the post-promotion verify guardrail. */
  healthCheckUrl?: string;
}

/** The data store a stage reads/writes, and where its migrations live. */
export interface StageDataRepository {
  /** e.g. "postgres", "mysql", "mongodb", "s3", "none". */
  kind?: string;
  /** Human label, e.g. "Neon · staging branch". Never a connection secret. */
  label?: string;
  /** Workspace-relative path to migration scripts, if any. */
  migrationsPath?: string;
  /**
   * Command that applies database migrations. When set, it runs as a managed
   * step during promotion (after backup, before deploy) so schema changes are
   * applied as part of the guarded sequence rather than out of band.
   */
  migrateCommand?: string;
}

/**
 * Backup / recovery policy enforced BEFORE any promotion that can change this
 * stage's data. Safety-first: a stage that has a data repository but no backup
 * command defined is blocked from being promoted *to* until one is set
 * (deny-by-default).
 */
export interface StageBackupPolicy {
  /** When true, a successful backup step is mandatory before promotion. */
  required: boolean;
  /** Shell command that snapshots this stage's data (user-authored). */
  command?: string;
  /**
   * Optional command that verifies the backup is restorable (e.g. checks the
   * snapshot exists / is non-empty). When set, it runs as a managed step right
   * after the backup and must pass — turning "backup ran" into "backup verified".
   */
  verifyCommand?: string;
  /** Reference to a written runbook (path or URL) describing recovery. */
  runbookRef?: string;
  /** Human description of retention, e.g. "30 daily snapshots". */
  retention?: string;
}

/** Gates that must pass before a promotion INTO a stage is allowed to run. */
export interface StagePromotionPolicy {
  /** Require explicit human approval in the confirmation step. */
  requiresApproval: boolean;
  /** Require the version to be bumped relative to the target before promoting. */
  requireVersionBump: boolean;
  /** Require a CHANGELOG entry for the new version. */
  requireChangelog: boolean;
  /**
   * Free-form named checks that must pass (e.g. "e2e:staging").
   * Surfaced in the dashboard and the runbook so the gates are self-documenting.
   */
  requiredChecks: string[];
  /**
   * When true, promotion into this stage's branch goes through a **Pull Request**
   * to a protected branch — not a direct merge/push. Imported from the repo's
   * workflows (a `pull_request`-triggered CI on the branch), the bound routine's
   * `gh pr create`, and/or GitHub branch protection.
   */
  viaPullRequest?: boolean;
  /**
   * Named CI status checks (workflow / context names) that must be green for the
   * promotion — imported from the repository's CI workflows and, when available,
   * the branch's protection settings. Distinct from {@link requiredChecks}
   * (the free-form human checklist).
   */
  requiredStatusChecks?: string[];
  /**
   * When set, the promotion is performed by **dispatching a CI/CD workflow**
   * (`gh workflow run <file>`) rather than running deploy commands on the
   * developer's machine — so production deploys happen in CD, with its identity
   * and logs. The deploy step becomes "Trigger CD: <file>".
   */
  dispatchWorkflow?: string;
  /**
   * Separation of duties: when true, the person running the promotion (the git
   * actor) must be different from the author of the change being promoted (the
   * source branch's head-commit author). Enforced as an automatic gate.
   */
  requireDistinctApprover?: boolean;
}

/** How to roll a stage back if a promotion goes wrong. */
export interface StageRollbackPolicy {
  /** Shell command that restores the prior state (user-authored). */
  command?: string;
  /** Reference to a written rollback runbook (path or URL). */
  runbookRef?: string;
}

/**
 * One named deployment stage (e.g. Development, Staging, Production). Stored in
 * {@link DeliveryConfig}. Descriptions are natural-language so the pipeline is
 * understandable to a newcomer without asking the AI.
 */
export interface DeploymentStage {
  id: string;
  name: string;
  kind: DeploymentStageKind;
  /** Pipeline order, lowest first (local = 0 … production highest). */
  rank: number;
  /** Plain-English description of what this stage is for. */
  description: string;
  /** Git branch or tag whose committed package version represents this stage. */
  branchRef?: string;
  config: StageConfigSource;
  hosting: StageHosting;
  data: StageDataRepository;
  backupPolicy: StageBackupPolicy;
  promotionPolicy: StagePromotionPolicy;
  rollbackPolicy: StageRollbackPolicy;
  /** When true the stage is protected: promotions to it always confirm + never force-push. */
  isProtected: boolean;
}

/** Outcome summary of a single promotion run, persisted for the dashboard. */
export interface PromotionRecord {
  /** ISO 8601 timestamp of the run. */
  ranAt: string;
  succeeded: boolean;
  /** Version that was promoted (source package version at run time). */
  version?: string;
  /** ID of the ProjectRunRecord capturing the full step log. */
  runId?: string;
  /** Handle the user can act on to roll back, when available. */
  rollbackHandle?: string;
}

/**
 * A directed promotion edge between two stages (source → target). Binds the
 * pair to the {@link RoutineDefinition} that performs the promotion, plus a
 * record of the most recent promotion run along the edge.
 */
export interface PromotionPath {
  id: string;
  fromStageId: string;
  toStageId: string;
  /** Routine ID that executes this promotion (wrapped by managed guardrail steps). */
  routineId?: string;
  /** Summary of the most recent promotion run along this path. */
  lastPromotion?: PromotionRecord;
}

/**
 * Project-scoped delivery configuration. Stored at
 * `project_memory/operations/delivery.json` with a human-readable
 * `project_memory/operations/delivery.md` mirror so the pipeline is
 * maintainable in natural language and reviewable in version control.
 */
export interface DeliveryConfig {
  version: 1;
  stages: DeploymentStage[];
  paths: PromotionPath[];
  updatedAt?: string;
}

// ── Document (.md) management ─────────────────────────────────────

/** How often an auto-maintained document is expected to be re-reviewed. */
export type DocumentCadence = 'on-change' | 'on-release' | 'weekly' | 'manual';

/**
 * One shelf in the project's document filing system — a workspace-relative
 * folder (optionally narrowed by a glob) that groups related documents.
 */
export interface DocumentFilingEntry {
  id: string;
  label: string;
  /** Workspace-relative folder (or file). Path-traversal is rejected on save. */
  path: string;
  description?: string;
  /** Optional glob within the folder, e.g. `**\/*.md`. */
  pattern?: string;
}

/**
 * A document the user wants kept current. AtlasMind never rewrites it on a timer
 * (deny-by-default); it tracks freshness and offers an assisted update. `sourceHint`
 * records what the file should track and `lastReviewed` is the confirmation baseline.
 */
export interface DocumentAutoUpdateEntry {
  id: string;
  /** Workspace-relative file to keep updated. Path-traversal is rejected on save. */
  path: string;
  label?: string;
  /** What this file should stay in sync with / when it should change. */
  sourceHint?: string;
  cadence: DocumentCadence;
  /** ISO date the file was last confirmed current (by the user or an Atlas run). */
  lastReviewed?: string;
}

export interface DocumentsConfig {
  version: 1;
  filing: DocumentFilingEntry[];
  autoUpdate: DocumentAutoUpdateEntry[];
  updatedAt?: string;
}

// ── Risk oversight ────────────────────────────────────────────────

/** Which oversight advisor owns a finding. Maps 1:1 to the `*-oversight` agent ids. */
export type RiskDomain = 'ethics' | 'legal' | 'commercial';

/** How likely the exposure is to actually materialise. */
export type RiskLikelihood = 'low' | 'medium' | 'high';

/** How badly it lands if it does. */
export type RiskImpact = 'low' | 'medium' | 'high';

/**
 * Lifecycle of a finding. Findings are never deleted — they transition — so the
 * register stays a complete record of what was raised and what was decided.
 * `accepted` means consciously owned by a human, which is a decision, not a gap.
 */
export type RiskStatus = 'open' | 'accepted' | 'mitigated' | 'closed' | 'dismissed';

/** How confident the advisor was; `low` findings are shown but scored gently. */
export type RiskConfidence = 'low' | 'medium' | 'high';

/**
 * One recorded oversight finding.
 *
 * Produced by an oversight advisor and then sanitised at the boundary before it is
 * persisted — model output is untrusted input like any other. `evidence` holds
 * workspace-relative paths the advisor cited; path-traversal is rejected on save.
 */
export interface RiskFinding {
  id: string;
  domain: RiskDomain;
  title: string;
  detail: string;
  likelihood: RiskLikelihood;
  impact: RiskImpact;
  confidence: RiskConfidence;
  status: RiskStatus;
  /** Workspace-relative paths cited as evidence. Traversal is rejected on save. */
  evidence: string[];
  /** Suggested next step, and the human review it needs. */
  recommendation?: string;
  /** ISO timestamp this finding was first raised. */
  raisedAt: string;
  /** ISO timestamp of the most recent change to this finding. */
  updatedAt?: string;
  /** Free-text note recorded when a human accepted, dismissed, or mitigated it. */
  statusNote?: string;
}

/** When each domain was last analysed, so the dashboard can show staleness. */
export interface RiskDomainRun {
  domain: RiskDomain;
  ranAt: string;
  /** Number of findings the run produced (after sanitisation). */
  findingCount: number;
}

export interface RiskOversightConfig {
  version: 1;
  /** The full register: open *and* resolved findings. Nothing is dropped on resolve. */
  findings: RiskFinding[];
  /** Most recent analysis run per domain. */
  runs: RiskDomainRun[];
  updatedAt?: string;
}

/**
 * One append-only audit record of a risk-register change, persisted newest first to
 * `project_memory/operations/risk-oversight-history.json`.
 */
export interface RiskOversightHistoryEntry {
  id: string;
  kind: 'analysis-run' | 'status-change' | 'finding-added' | (string & {});
  summary: string;
  domain?: RiskDomain;
  /** The finding this record refers to, when it is about a single finding. */
  entityId?: string;
  /** git user that made the change (name <email>), when resolvable. */
  actor?: string;
  ranAt: string;
}

// ── Security review ──────────────────────────────────────────────

/**
 * The areas a security review sweeps. Unlike risk — where each domain has its own
 * advisor — all four are reviewed by the single `security-reviewer` agent under an
 * area-scoped prompt, so the split exists to make coverage legible and to let one
 * area be re-run without re-running the rest.
 */
export type SecurityReviewArea = 'secrets' | 'boundaries' | 'dependencies' | 'permissions';

/** Standard severity ladder. `info` is an observation, not a defect, and scores zero. */
export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** How reachable the weakness is in practice — the security analogue of likelihood. */
export type SecurityExploitability = 'low' | 'medium' | 'high';

/** How confident the reviewer was; `low` findings are shown but scored gently. */
export type SecurityConfidence = 'low' | 'medium' | 'high';

/**
 * Lifecycle of a security finding. As with risk, findings are never deleted — they
 * transition — so the register stays a complete account of what was raised and what
 * was decided. `accepted` means a human consciously owns it, which is a decision.
 */
export type SecurityFindingStatus = 'open' | 'accepted' | 'mitigated' | 'closed' | 'dismissed';

/**
 * One recorded security finding.
 *
 * Produced by the security reviewer and sanitised at the boundary before it is
 * persisted — model output is untrusted input like any other. `evidence` holds
 * workspace-relative paths; path traversal is rejected on save.
 */
export interface SecurityFinding {
  id: string;
  area: SecurityReviewArea;
  title: string;
  detail: string;
  severity: SecuritySeverity;
  exploitability: SecurityExploitability;
  confidence: SecurityConfidence;
  status: SecurityFindingStatus;
  /** Workspace-relative paths cited as evidence. Traversal is rejected on save. */
  evidence: string[];
  /** Suggested remediation, and the review it needs. */
  recommendation?: string;
  /**
   * Where this finding came from. `review` is a security-reviewer run; `gap-analysis`
   * marks one routed here from the Gap Analysis page so its origin stays visible.
   */
  origin?: 'review' | 'gap-analysis';
  /** ISO timestamp this finding was first raised. */
  raisedAt: string;
  /** ISO timestamp of the most recent change to this finding. */
  updatedAt?: string;
  /** Free-text note recorded when a human accepted, dismissed, or mitigated it. */
  statusNote?: string;
}

export interface SecurityAreaRun {
  area: SecurityReviewArea;
  ranAt: string;
  /** Number of findings the run produced (after sanitisation). */
  findingCount: number;
}

export interface SecurityReviewConfig {
  version: 1;
  /** The full register: open *and* resolved findings. Nothing is dropped on resolve. */
  findings: SecurityFinding[];
  /** Most recent review run per area. */
  runs: SecurityAreaRun[];
  updatedAt?: string;
}

/**
 * One append-only audit record of a security-register change, persisted newest first
 * to `project_memory/operations/security-review-history.json`.
 */
export interface SecurityReviewHistoryEntry {
  id: string;
  kind: 'review-run' | 'status-change' | 'finding-added' | (string & {});
  summary: string;
  area?: SecurityReviewArea;
  /** The finding this record refers to, when it is about a single finding. */
  entityId?: string;
  /** git user that made the change (name <email>), when resolvable. */
  actor?: string;
  ranAt: string;
}

// ── Delivery / Promotion execution ───────────────────────────────

/** Whether a preflight check is evaluated by AtlasMind or attested by a human. */
export type PromotionCheckKind = 'auto' | 'manual';

/** Result state of a preflight check. `manual` = awaiting human attestation. */
export type PromotionCheckStatus = 'pass' | 'fail' | 'manual' | 'skipped';

export interface PromotionPreflightCheck {
  id: string;
  label: string;
  kind: PromotionCheckKind;
  status: PromotionCheckStatus;
  detail: string;
  /**
   * True when this failing auto-check can be auto-resolved by the plan's
   * {@link PromotionRemediation} (version bump / changelog entry). Used by the UI
   * to flag the check as fixable.
   */
  fixable?: boolean;
}

/**
 * An offer to auto-resolve the failing, fixable preflight checks (version not
 * bumped, missing changelog entry) inline as part of the promotion, surfaced as
 * a one-click "Resolve & run". AtlasMind edits `package.json`/`CHANGELOG.md` and
 * commits them with a conventional message — it never pushes or force-pushes.
 * The version level is *assessed* from the conventional-commit history since the
 * target (feat → minor, breaking → major, otherwise patch). Like every other
 * command in the runner, the edits/commit are server-sourced; the webview can
 * only trigger this, never inject content.
 */
export interface PromotionRemediation {
  /** IDs of the currently-failing checks this resolution will turn green. */
  resolves: string[];
  /** Version `package.json` will be set to (bumped, or the current version when only the changelog is missing). */
  targetVersion: string;
  /** SemVer level the version advances by, or null when no bump is needed. */
  bumpLevel: 'patch' | 'minor' | 'major' | null;
  /** Human reasoning for the assessed level (e.g. "minor — 3 feature commit(s) since Staging"). */
  bumpReason: string;
  /** Whether a CHANGELOG.md entry will be added for `targetVersion`. */
  editsChangelog: boolean;
  /** Whether the edits will be committed (chore(release): vX.Y.Z), never pushed. */
  commits: boolean;
  /** One-line description shown in the modal; also the commit subject. */
  summary: string;
}

/** The lifecycle phase a plan step belongs to. */
export type PromotionStepKind = 'preflight' | 'backup' | 'deploy' | 'verify' | 'record';

export interface PromotionPlanStep {
  id: string;
  kind: PromotionStepKind;
  label: string;
  detail: string;
  /** Shell command this step will run, when applicable (shown in the runbook). */
  command?: string;
  /** Managed guardrail steps are injected by AtlasMind and cannot be removed. */
  managed: boolean;
}

/**
 * A fully-assembled, inspectable promotion plan for one path. Built fresh each
 * time the user opens the Execute/Runbook dialog so it reflects live git state.
 * The plan never carries secret values — only labels, the user-authored command
 * strings (sourced from persisted config/routines), and check outcomes.
 */
export interface PromotionPlan {
  pathId: string;
  fromStageId: string;
  toStageId: string;
  fromName: string;
  toName: string;
  steps: PromotionPlanStep[];
  checks: PromotionPreflightCheck[];
  /** Hard blockers that prevent execution entirely (e.g. missing required backup). */
  blockers: string[];
  requiresApproval: boolean;
  isProtected: boolean;
  /** Promotion into the target goes through a Pull Request to a protected branch. */
  viaPullRequest: boolean;
  /** Whether a bound promotion routine with steps was found on disk. */
  hasRoutine: boolean;
  routineId?: string;
  /** Offer to auto-resolve fixable failing checks, when any exist. */
  remediation?: PromotionRemediation;
}

export interface PromotionStepResult {
  id: string;
  label: string;
  ok: boolean;
  skipped: boolean;
  /** Trimmed/last-N output for display; never the full unbounded stream. */
  output: string;
}

export interface PromotionRunResult {
  pathId: string;
  succeeded: boolean;
  steps: PromotionStepResult[];
  startedAt: string;
  durationMs: number;
  /** Recovery hint surfaced after the run (rollback command / runbook ref). */
  rollback?: { command?: string; runbookRef?: string };
}

/**
 * One append-only audit record of a promotion or rollback, persisted to
 * `project_memory/operations/delivery-history.json` so the dashboard can show
 * what shipped where, when, and by whom.
 */
export interface PromotionHistoryEntry {
  id: string;
  /** 'promotion' (forward) or 'rollback' (recovery). */
  kind: 'promotion' | 'rollback';
  pathId?: string;
  fromName?: string;
  toName: string;
  version?: string;
  succeeded: boolean;
  ranAt: string;
  durationMs?: number;
  /** git user that ran it (name <email>), when resolvable. */
  actor?: string;
}

// ── Project Director ─────────────────────────────────────────────

/**
 * A communication channel kind. Open union so a project can record a channel
 * AtlasMind doesn't model natively without a type change.
 */
export type CommunicationChannelKind =
  | 'email'
  | 'slack'
  | 'teams'
  | 'buzz'
  | 'phone'
  | 'sms'
  | 'meet'
  | 'zoom'
  | 'github'
  | 'linkedin'
  | 'other'
  | (string & {});

/**
 * A reference to a person/group in their GDPR-compliant system of record
 * (Microsoft 365 / Entra, Slack, Google Workspace). AtlasMind prefers to
 * *reference* people here and resolve their details on demand from the
 * connected directory, rather than hoarding raw personal data locally.
 */
export interface DirectoryRef {
  /**
   * Which system of record owns this identity. `local` = stored in AtlasMind
   * only. `buzz` = the identity lives in Buzz (a self-sovereign Nostr keypair) —
   * AtlasMind references it, Buzz owns it. AtlasMind never mints or runs its own
   * identity/directory system; it points at the owning system of record.
   */
  source: 'm365' | 'slack' | 'google' | 'buzz' | 'local' | (string & {});
  /** Stable external id (Entra object id, Slack user id, …). Not PII on its own. */
  externalId?: string;
  /** Non-PII display label where possible, e.g. "Design Lead", "#project-x". */
  displayLabel: string;
}

/**
 * One way to reach a {@link DirectorContact}. `handle` is a **non-secret**
 * identifier (an address, @username, or phone number) — never a token or
 * password. `deepLink`, when present, is a launchable URL restricted to a
 * scheme allowlist (mailto:/tel:/sms:/slack:/msteams:/zoommtg:/https:).
 */
export interface CommunicationLink {
  id: string;
  kind: CommunicationChannelKind;
  /** Human label shown in the UI, e.g. "Work email", "#project-x". */
  label: string;
  /** Non-secret handle: address, @username, phone number. */
  handle: string;
  /** Optional launchable deep link (scheme-allowlisted). */
  deepLink?: string;
  /** Marks the contact's preferred channel, surfaced first. */
  preferred?: boolean;
}

/**
 * A person, group, or organisation involved in the project. The single source
 * of truth for identity + communication; {@link Stakeholder} and
 * {@link TeamMember} reference a contact by id so the same human can play both
 * roles without duplicating their channels.
 */
export interface DirectorContact {
  id: string;
  name: string;
  kind: 'person' | 'group' | 'org' | (string & {});
  /** Free-text role/title, e.g. "VP Product", "Design Lead". */
  title?: string;
  org?: string;
  /** Optional timezone label for scheduling context (display only). */
  timezone?: string;
  /** Preferred link to the person's system of record (GDPR-minimising). */
  ref?: DirectoryRef;
  links: CommunicationLink[];
  /**
   * True when raw personal data (beyond a non-PII label) is persisted locally.
   * Drives the one-time GDPR consent gate and the confidential classification.
   */
  piiStored: boolean;
  notes?: string;
}

export type StakeholderCategory =
  | 'sponsor'
  | 'client'
  | 'user-representative'
  | 'regulator'
  | 'vendor'
  | 'partner'
  | 'internal'
  | 'other'
  | (string & {});

/** High/medium/low scale used for the stakeholder influence/interest grid. */
export type DirectorLevel = 'high' | 'medium' | 'low' | (string & {});

/** A role a contact plays as a project stakeholder. Thin record → a contact. */
export interface Stakeholder {
  id: string;
  contactId: string;
  category: StakeholderCategory;
  influence: DirectorLevel;
  interest: DirectorLevel;
  /** What this stakeholder cares about / expects from the project. */
  interestSummary?: string;
  notes?: string;
}

/** A role a contact plays as a delivery team member. Thin record → a contact. */
export interface TeamMember {
  id: string;
  contactId: string;
  /** Discipline/role on delivery, e.g. "backend-engineer", "QA". */
  discipline: string;
  /**
   * The workflow role assigned to this person — see `teamRoles.ts`.
   *
   * Distinct from `discipline`, which says what they *do*; this says what the
   * workflow permits them. A role is a configuration template and a declared
   * expectation, **never a permission boundary** — AtlasMind runs inside each
   * person's editor and cannot enforce one. Where restriction genuinely bites
   * is the CODEOWNERS entries a role plus responsibility paths generate,
   * because GitHub enforces those.
   */
  roleId?: string;
  /** Optional allocation hint (display only), e.g. "50%", "2 days/wk". */
  allocation?: string;
  availability?: string;
  notes?: string;
}

/**
 * An area of ownership. `ownerContactId` is the single accountable owner;
 * `backupContactId` names a fallback. A full RACI matrix is deferred.
 */
export interface Responsibility {
  id: string;
  /** Area/scope label, e.g. "Payments", "Release sign-off". */
  area: string;
  description?: string;
  ownerContactId: string;
  backupContactId?: string;
  /**
   * Path patterns this area covers, as GitHub CODEOWNERS reads them.
   *
   * Optional because plenty of responsibilities ("Release sign-off", "Client
   * relationship") map to no path at all. Where paths *are* supplied, the owner
   * and backup become required reviewers for them — which is the one place a
   * role turns into an enforced restriction, since GitHub enforces CODEOWNERS
   * and AtlasMind cannot.
   */
  paths?: string[];
  notes?: string;
}

export type AssignmentKind =
  | 'task'
  | 'responsibility'
  | 'review'
  | 'decision'
  | 'other'
  | (string & {});
export type AssignmentStatus =
  | 'todo'
  | 'in-progress'
  | 'blocked'
  | 'done'
  | 'cancelled'
  | (string & {});
export type AssignmentPriority = 'high' | 'medium' | 'low' | (string & {});

/** Dashboard work records that can carry a Director-assigned human owner. */
export type DashboardWorkKind =
  | 'branch'
  | 'roadmap'
  | 'issue'
  | 'pull-request'
  | 'gap'
  | 'risk'
  | 'debt'
  | 'document';

/** A concrete dashboard record that a cross-surface link can reveal. */
export type DashboardFocusKind = DashboardWorkKind | 'assignment' | 'follow-up';

/**
 * A guarded dashboard deep link. The page is always required; focus is an
 * optional enhancement, so a record removed between click and render still
 * lands on the correct owning page rather than failing navigation entirely.
 */
export interface ProjectDashboardOpenTarget {
  page: string;
  focus?: {
    kind: DashboardFocusKind;
    id: string;
  };
}

/** Stable link to work owned by another Project Dashboard surface. */
export interface AssignmentLinkedWork {
  kind: DashboardWorkKind;
  id: string;
}

/**
 * Links a human (contact) to a unit of work — the human-assignee overlay that
 * {@link ProjectRunRecord} / {@link SubTask} (assigned to *agent roles*) lack.
 * `linkedRunId` binds an autonomous run to its human owner **without mutating
 * the run record**; `linkedResponsibilityId` binds an ongoing responsibility;
 * `linkedWork` lets the same Director-owned assignment follow actionable work
 * across Project Dashboard surfaces without those surfaces inventing owners.
 */
export interface Assignment {
  id: string;
  title: string;
  kind: AssignmentKind;
  assigneeContactId?: string;
  status: AssignmentStatus;
  priority: AssignmentPriority;
  /** ISO date (yyyy-mm-dd) or full ISO timestamp; optional. */
  due?: string;
  /** ProjectRunRecord.id this assignment aggregates, when it maps to a run. */
  linkedRunId?: string;
  linkedResponsibilityId?: string;
  linkedWork?: AssignmentLinkedWork;
  /** Provenance so imported/derived items are distinguishable from manual ones. */
  source: 'manual' | 'imported' | 'run' | 'dashboard' | (string & {});
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export type FollowUpStatus = 'open' | 'done' | 'snoozed' | 'cancelled' | (string & {});
export type FollowUpCadence =
  | 'once'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | (string & {});

/** What a follow-up is about, so the dashboard can deep-link to the entity. */
export interface FollowUpLinkedEntity {
  kind: 'stakeholder' | 'teamMember' | 'assignment' | 'responsibility' | 'run' | 'none' | (string & {});
  id?: string;
}

/**
 * A durable follow-up (a nudge to do or check something by a date). `due` /
 * `overdue` are **derived** at read time from `dueDate` + `status` +
 * `snoozedUntil`, never persisted. `cadence` and `lastFiredAt` support the
 * scheduled-reminder engine (later phase).
 */
export interface FollowUp {
  id: string;
  title: string;
  /** Who is responsible for doing the follow-up. */
  ownerContactId?: string;
  /** Who the follow-up is with (e.g. the stakeholder to contact). */
  withContactId?: string;
  /** ISO date the follow-up is due. */
  dueDate: string;
  cadence: FollowUpCadence;
  status: FollowUpStatus;
  linked: FollowUpLinkedEntity;
  /** Preferred channel to use when reaching out. */
  channelHint?: CommunicationChannelKind;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** If snoozed, the ISO date it re-surfaces. */
  snoozedUntil?: string;
  /** Last time a reminder fired for this item, to avoid duplicate nudges. */
  lastFiredAt?: string;
  notes?: string;
}

/**
 * Whether the project is run by a single person or a team. `auto` infers it
 * from the roster (solo when there is no team member other than "me"), so a
 * solo dev is never asked to fill in stakeholder/team ceremony they don't need,
 * while a team project surfaces the full roster. Drives dashboard presentation.
 */
export type ProjectTeamMode = 'solo' | 'team' | 'auto';

/** Project Director behaviour toggles, persisted with the config. */
export interface ProjectDirectorSettings {
  /** Solo vs team framing; `auto` infers from the roster. */
  teamMode: ProjectTeamMode;
  /** Show a single throttled nudge on activation when follow-ups are overdue. */
  nudgeOnActivation: boolean;
  /** Enable the scheduled-reminder engine (recurring follow-up nudges). */
  remindersEnabled: boolean;
  /** Enable guarded outbound send/schedule via connected MCP tools. */
  outboundEnabled: boolean;
}

/**
 * Project Director SSOT. Persisted to
 * `project_memory/operations/project-director.json` with a human-readable
 * `project-director.md` mirror and a capped `project-director-history.json`
 * audit trail, so the people, ownership, and follow-ups around a project are
 * maintainable in natural language and reviewable in version control.
 */
export interface ProjectDirectorConfig {
  version: 1;
  updatedAt?: string;
  project: { name: string; summary?: string };
  /**
   * The contact representing "me" (the AtlasMind user). Assignments and
   * follow-ups default to this contact, the UI addresses them as "you", and a
   * solo project is recognised when this is the only human on the roster.
   */
  selfContactId?: string;
  contacts: DirectorContact[];
  stakeholders: Stakeholder[];
  teamMembers: TeamMember[];
  responsibilities: Responsibility[];
  /**
   * Edited or custom workflow roles, merged over the built-ins on read.
   *
   * Untyped here on purpose: this document is hand-editable, so it is read
   * through `sanitizeTeamRole`, which defaults every capability to denied. A
   * missing field must never read as consent. Deleting a built-in here does not
   * remove it — that would silently drop the expectations attached to everybody
   * already assigned it.
   */
  roles?: unknown[];
  assignments: Assignment[];
  followUps: FollowUp[];
  settings: ProjectDirectorSettings;
}

/**
 * One append-only audit record of a Project Director change, persisted newest
 * first to `project_memory/operations/project-director-history.json`.
 */
export interface ProjectDirectorHistoryEntry {
  id: string;
  kind: 'assignment-status' | 'followup-status' | 'roster-change' | 'outbound' | (string & {});
  summary: string;
  entityId?: string;
  /** git user that made the change (name <email>), when resolvable. */
  actor?: string;
  ranAt: string;
}

// ── Scanner rule configuration ────────────────────────────────────

/**
 * A scanner rule in a format that can be serialised to / from JSON.
 * `pattern` is stored as a regex source string (no delimiters), flags are always `''`.
 */
export interface SerializedScanRule {
  id: string;
  severity: 'error' | 'warning';
  /** Regex source string, e.g. `\\beval\\s*\\(` */
  pattern: string;
  message: string;
  /** When false the rule is loaded but never fires. Defaults to true. */
  enabled: boolean;
  /** True for rules shipped with the extension. Custom rules are false. */
  builtIn: boolean;
}

export interface ScannerRulesConfig {
  /** Per-rule overrides keyed by rule id. Only changed fields need to be stored. */
  overrides: Record<string, Partial<Pick<SerializedScanRule, 'severity' | 'message' | 'enabled'>>>;
  /** User-defined rules appended after the built-in set. */
  customRules: SerializedScanRule[];
}

// ── Memory scanning ─────────────────────────────────────────────

export interface MemoryScanIssue {
  rule: string;
  severity: 'error' | 'warning';
  /** 1-based line number in the document. */
  line: number;
  /** The offending line (trimmed, max 120 chars). */
  snippet: string;
  message: string;
}

/**
 * Result of scanning a single SSOT document for prompt-injection and secret leakage.
 * Error-level findings block the entry from being included in model context.
 * Warning-level findings are noted in the system prompt but do not suppress the entry.
 */
export interface MemoryScanResult {
  path: string;
  /** 'clean' | 'warned' | 'blocked' */
  status: 'clean' | 'warned' | 'blocked';
  scannedAt: string;
  issues: MemoryScanIssue[];
}

// ── AtlasMind Lens ─────────────────────────────────────────────

/** A source range carried between Lens visualisations and AtlasMind chat. All positions are 1-based. */
export interface LensSourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** Identifies one root in the currently open VS Code workspace without exposing its absolute URI. */
export interface LensWorkspaceIdentity {
  name: string;
  /** Zero-based position in `vscode.workspace.workspaceFolders`. */
  index: number;
}

/**
 * The visual objects AtlasMind Lens can make queryable.
 *
 * Only `file` and `symbol` are emitted by the first outline slice. The remaining
 * kinds reserve one shared contract for the roadmap's graphs, rather than each
 * future surface inventing an incompatible chat handoff.
 */
export type LensTargetKind =
  | 'file'
  | 'symbol'
  | 'code-range'
  | 'relation'
  | 'command'
  | 'route'
  | 'schema'
  | 'runtime-event';

/** How AtlasMind knows that a Lens node or edge exists. Unknown is never represented as proven. */
export type LensEvidenceKind = 'source' | 'runtime' | 'framework' | 'declared' | 'inferred';

export interface LensEvidence {
  kind: LensEvidenceKind;
  source: string;
  /** 0–1, used only when the producer has a meaningful confidence value. */
  confidence?: number;
}

/**
 * A bounded, workspace-relative reference passed from a Lens visualisation to chat.
 * It deliberately contains no source text or absolute filesystem path.
 */
export interface LensVisualTarget {
  version: 2;
  id: string;
  kind: LensTargetKind;
  label: string;
  detail?: string;
  workspace: LensWorkspaceIdentity;
  workspacePath: string;
  range?: LensSourceRange;
  symbolKind?: string;
  evidence: LensEvidence;
}

/** Whether a Lens graph represents static possibility, observed execution, or an explicit inference. */
export type LensGraphMode = 'possible' | 'observed' | 'inferred';

export type LensGraphNodeRole = 'entrypoint' | 'caller' | 'callee' | 'reference';

export type LensGraphRelation = 'calls' | 'references';

export interface LensGraphNode {
  id: string;
  target: LensVisualTarget;
  role: LensGraphNodeRole;
  /** Relative column used by the first journey layout. */
  depth: number;
}

export interface LensGraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: LensGraphRelation;
  evidence: LensEvidence;
}

/** Bounded graph record shared by Lens language adapters and editor visualisations. */
export interface LensGraph {
  version: 1;
  id: string;
  label: string;
  mode: LensGraphMode;
  rootNodeId: string;
  nodes: LensGraphNode[];
  edges: LensGraphEdge[];
  notices: string[];
  truncated: boolean;
}

export type LensCodeImpactCategory =
  | 'upstream-caller'
  | 'downstream-callee'
  | 'consumer-reference';

/** One evidence-backed reason a selected symbol may be affected by, or affect, another source target. */
export interface LensCodeImpactItem {
  id: string;
  category: LensCodeImpactCategory;
  relation: LensGraphRelation;
  /** One is directly connected to the selected symbol; larger values are farther away. */
  proximity: number;
  target: LensVisualTarget;
  reason: string;
  evidence: LensEvidence;
}

/** Bounded projection of a language-service graph into a change-review surface. */
export interface LensCodeImpact {
  version: 1;
  id: string;
  label: string;
  root: LensVisualTarget;
  items: LensCodeImpactItem[];
  notices: string[];
  truncated: boolean;
}

export type LensTestKind = 'unit' | 'integration' | 'contract' | 'end-to-end' | 'unknown';

/** One source-backed test-like caller/reference associated with a selected production symbol. */
export interface LensTestEvidenceItem {
  id: string;
  testKind: LensTestKind;
  link: LensGraphRelation;
  target: LensVisualTarget;
  reason: string;
  /** The conservative filename/folder signal used to classify this source as test-like. */
  classification: string;
  evidence: LensEvidence;
}

/** Bounded, non-executing test-evidence projection for one selected Lens target. */
export interface LensTestMap {
  version: 1;
  id: string;
  label: string;
  root: LensVisualTarget;
  items: LensTestEvidenceItem[];
  notices: string[];
  truncated: boolean;
}

export type LensContractLayer =
  | 'ui'
  | 'api'
  | 'validator'
  | 'domain'
  | 'persistence'
  | 'database'
  | 'external';

export type LensContractSourceKind =
  | 'typescript'
  | 'openapi'
  | 'json-schema'
  | 'graphql'
  | 'protobuf'
  | 'validator'
  | 'orm'
  | 'sql'
  | 'manual';

export type LensContractCoverage = 'complete' | 'partial' | 'unknown';
export type LensFieldPresence = 'required' | 'optional' | 'unknown';
export type LensFieldNullability = 'nullable' | 'non-null' | 'unknown';

export interface LensContractField {
  id: string;
  path: string;
  label: string;
  dataType: string;
  format?: string;
  presence: LensFieldPresence;
  nullability: LensFieldNullability;
  target?: LensVisualTarget;
  evidence: LensEvidence;
}

/** One normalized declaration boundary such as an OpenAPI shape, DTO, ORM model, or SQL table. */
export interface LensContract {
  version: 1;
  id: string;
  label: string;
  layer: LensContractLayer;
  sourceKind: LensContractSourceKind;
  coverage: LensContractCoverage;
  target?: LensVisualTarget;
  fields: LensContractField[];
}

export interface LensContractFieldRef {
  contractId: string;
  fieldPath: string;
}

export type LensFieldMappingKind = 'equivalent' | 'rename' | 'transform' | 'drop' | 'introduce' | 'inferred';

export interface LensExplicitFieldMapping {
  id: string;
  kind: LensFieldMappingKind;
  upstreamContractId: string;
  downstreamContractId: string;
  from?: LensContractFieldRef;
  to?: LensContractFieldRef;
  note?: string;
  intentional: boolean;
}

export interface LensFieldSuppression {
  id: string;
  field: LensContractFieldRef;
  reason: string;
}

/** Normalized contents of `.atlasmind/lens-mappings.json`. */
export interface LensContractMappingFile {
  version: 1;
  mappings: LensExplicitFieldMapping[];
  suppressions: LensFieldSuppression[];
}

export type LensFieldWireStatus =
  | 'exact'
  | 'transformed'
  | 'dropped'
  | 'introduced'
  | 'incompatible'
  | 'unverified'
  | 'inferred';

export interface LensFieldWire {
  id: string;
  status: LensFieldWireStatus;
  from?: LensContractFieldRef;
  to?: LensContractFieldRef;
  fromFieldId?: string;
  toFieldId?: string;
  mappingKind?: LensFieldMappingKind;
  reason: string;
  evidence: LensEvidence;
  intentional: boolean;
  suppressed: boolean;
  suppressionReason?: string;
}

export interface LensContractReview {
  version: 1;
  id: string;
  upstreamContractId: string;
  downstreamContractId: string;
  wires: LensFieldWire[];
  notices: string[];
  truncated: boolean;
}

export type LensContractFindingClass =
  | 'definite-conflict'
  | 'likely-drift'
  | 'missing-evidence'
  | 'intentional-transform'
  | 'dead-wire'
  | 'dropped-wire'
  | 'undocumented-wire';

export type LensContractFindingSeverity = 'error' | 'warning' | 'info';

/** One deterministic interpretation of a contract wire; suppressed findings remain present. */
export interface LensContractDriftFinding {
  id: string;
  wireId: string;
  findingClass: LensContractFindingClass;
  severity: LensContractFindingSeverity;
  label: string;
  reason: string;
  suppressed: boolean;
  suppressionReason?: string;
}

export interface LensContractDriftSummary {
  total: number;
  active: number;
  suppressed: number;
  errors: number;
  warnings: number;
  information: number;
  byClass: Record<LensContractFindingClass, number>;
}

/** Finding-oriented projection of one Field Wiring review. */
export interface LensContractDriftReport {
  version: 1;
  id: string;
  reviewId: string;
  findings: LensContractDriftFinding[];
  summary: LensContractDriftSummary;
  notices: string[];
  truncated: boolean;
}

export type LensSchemaChangeKind =
  | 'rename'
  | 'remove'
  | 'type'
  | 'format'
  | 'presence'
  | 'nullability';

export type LensSchemaImpactCategory =
  | 'contract'
  | 'relationship'
  | 'mapping'
  | 'validation'
  | 'serialization'
  | 'migration'
  | 'deployment';

export type LensSchemaImpactSeverity = 'high' | 'medium' | 'review';

export interface LensSchemaImpactItem {
  id: string;
  label: string;
  detail: string;
  category: LensSchemaImpactCategory;
  severity: LensSchemaImpactSeverity;
  /** Zero is the selected field; larger values are farther evidence-backed implications. */
  proximity: number;
  target?: LensVisualTarget;
  evidence: LensEvidence;
}

/** Bounded impact preview for one proposed field-shape change across the selected contract boundary. */
export interface LensSchemaChangeImpact {
  version: 1;
  id: string;
  seedContractId: string;
  seedFieldId: string;
  changeKind: LensSchemaChangeKind;
  items: LensSchemaImpactItem[];
  notices: string[];
  truncated: boolean;
}

export type LensContractRelationKind =
  | 'foreign-key'
  | 'reference'
  | 'orm'
  | 'resolver'
  | 'loader'
  | 'query';

export interface LensContractRelationEndpoint {
  contractLabel: string;
  fieldPath: string;
  contractId?: string;
  fieldId?: string;
}

/** A declared relationship between fields; unresolved endpoints remain visible by label. */
export interface LensContractRelation {
  id: string;
  kind: LensContractRelationKind;
  label: string;
  from: LensContractRelationEndpoint;
  to: LensContractRelationEndpoint;
  target?: LensVisualTarget;
  evidence: LensEvidence;
}

export type LensDataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

export type LensDataControlKind =
  | 'consent'
  | 'authorization'
  | 'redaction'
  | 'encryption'
  | 'retention'
  | 'residency';

export interface LensDataTrustFieldRule {
  id: string;
  contractId: string;
  fieldPath: string;
  classification: LensDataClassification;
  controls: LensDataControlKind[];
  note?: string;
}

/** Explicit repository policy from `.atlasmind/lens-data-trust.json`; contains metadata, never data values. */
export interface LensDataTrustPolicyFile {
  version: 1;
  fields: LensDataTrustFieldRule[];
}

export type LensDataTrustStatus = 'declared' | 'unknown';

export interface LensDataTrustItem {
  id: string;
  contractId: string;
  fieldId: string;
  label: string;
  status: LensDataTrustStatus;
  classification?: LensDataClassification;
  controls: LensDataControlKind[];
  note?: string;
  proximity: number;
  target?: LensVisualTarget;
  evidence: LensEvidence;
}

/** Bounded trust-policy projection across one selected normalized field wire. */
export interface LensDataTrustMap {
  version: 1;
  id: string;
  seedContractId: string;
  seedFieldId: string;
  items: LensDataTrustItem[];
  notices: string[];
  truncated: boolean;
}

// ── Lens: live endpoints ────────────────────────────────────────
//
// Every other Lens reads files. These types describe the one that reaches a
// third-party service, and they are shaped by a single rule that the whole
// feature rests on: **the shape is read, the rows never are**. A probe asks a
// database for `information_schema`, an API for the OpenAPI document it serves,
// a GraphQL endpoint for its introspection — and nothing in these types has a
// field that could hold a row, a response body, or a value. That is not a
// convention; `LensServedContract` reuses `LensContract`, which has nowhere to
// put one, and a test asserts no probe output carries sample data.

/**
 * How a live endpoint is reached. Decides the probe, the source, and the gate.
 *
 * `database` is the MCP path — a connected server's schema tool. The three
 * direct kinds exist because most managed databases have no MCP server, and
 * telling somebody with a Neon or RDS instance to go and install one is not an
 * answer. `sql-http` is separate from `postgres` rather than a flag on it
 * because Cloudflare D1 and Turso have no wire protocol at all: a driver cannot
 * reach them, and collapsing the two would make the transport undecidable.
 */
export type LensEndpointKind =
  | 'http-openapi'
  | 'graphql'
  | 'database'
  | 'postgres'
  | 'mysql'
  | 'sql-http';

/** Which catalog vocabulary a SQL endpoint speaks. */
export type LensSqlDialect = 'postgres' | 'mysql';

/** The vendor whose HTTP SQL API an `sql-http` endpoint speaks. */
export type LensSqlHttpVendor = 'neon' | 'cloudflare-d1' | 'turso';

/**
 * How sensitive an endpoint's environment is.
 *
 * Mirrors `DeploymentStage.isProtected` rather than inventing a second word for
 * the same idea: `production` is the one that costs a type-to-confirm, and an
 * endpoint that does not say gets `unknown`, which is treated **as production**.
 * Guessing downward here would silently move the gate off the one environment it
 * exists for.
 */
export type LensEndpointStage = 'local' | 'development' | 'staging' | 'production' | 'unknown';

/**
 * A declared third-party service, from `.atlasmind/lens-endpoints.json`.
 *
 * Two absences are deliberate. There is **no credential field** — `secretRef`
 * names a SecretStorage key and the normalizer refuses a document that looks
 * like it carries a value — because this file is committed, and a schema that
 * accepts a password will eventually be given one. And there is **no method or
 * query field**: what a probe sends is chosen by AtlasMind from a fixed
 * allowlist, never by the file, or the safety rule would be editable by the
 * thing it constrains.
 */
export interface LensEndpointDeclaration {
  id: string;
  label: string;
  kind: LensEndpointKind;
  stage: LensEndpointStage;
  /** Absolute `https` URL for `http-openapi`/`graphql`. Absent for `database`. */
  url?: string;
  /**
   * For `database`: the connected MCP server id whose schema tool should be
   * asked. AtlasMind bundles no database driver and holds no database
   * credential — the already-approved MCP connection is the whole transport.
   */
  mcpServerId?: string;
  /**
   * SecretStorage key holding a bearer token, API key, or connection string.
   * Never the value — the normalizer refuses a document that carries one.
   */
  secretRef?: string;
  /** For `sql-http`: which vendor's HTTP SQL API this endpoint speaks. */
  vendor?: LensSqlHttpVendor;
  /** Repository contract ids this endpoint is expected to match, if known. */
  expectedContractIds: string[];
  note?: string;
}

/** The committed declaration file listing every service a lens may reach. */
export interface LensEndpointFile {
  version: 1;
  endpoints: LensEndpointDeclaration[];
}

/**
 * Whether a probe reached the endpoint, and what that means.
 *
 * `unassessed` is the load-bearing member and is never merged into
 * `unreachable`: "nobody looked" and "we looked and it was not there" are
 * different facts, and a reachability lens that reported the first as the second
 * would raise a dead end for every endpoint on a machine that is simply offline.
 */
export type LensProbeOutcome = 'reached' | 'unreachable' | 'refused' | 'unauthorized' | 'unassessed';

/** One endpoint's probe result. Carries evidence about shape, never content. */
export interface LensProbeResult {
  version: 1;
  endpointId: string;
  outcome: LensProbeOutcome;
  /** Why, in one sentence, phrased for somebody who did not run it. */
  reason: string;
  /** The declared rule that decided a `refused` or `unauthorized` outcome. */
  rule?: string;
  /** Round-trip milliseconds, when a call was actually made. */
  latencyMs?: number;
  /** HTTP status, when the transport was HTTP. Never a body. */
  status?: number;
  /** How many shape declarations came back. Never what they contained. */
  contractCount?: number;
  observedAt: string;
}

/**
 * What a live service served, derived into the same shape the repository
 * extractors produce.
 *
 * `contracts` is a list — one per served schema or table, with bare field paths
 * — deliberately mirroring `extractJsonContractSources` and
 * `extractSqlContractSources` rather than flattening everything into one
 * contract with dotted paths. The two sides of a drift comparison have to be
 * built the same way or every field mismatches on its name alone, and the
 * comparison would report a total schema failure for a service that is working
 * perfectly.
 */
export interface LensServedContract {
  version: 1;
  endpointId: string;
  contracts: LensContract[];
  observedAt: string;
  notices: string[];
  truncated: boolean;
}

/**
 * How a declared contract and a served contract differ.
 *
 * The first three are what The User asked to see. `absent-remotely` is a schema
 * failure and a dead end at once — the code declares a field or table the live
 * service does not serve — and it is separated from `undeclared-remotely`
 * because the two need opposite fixes and collapsing them into "mismatch" would
 * hide which.
 */
export type LensLiveDriftKind =
  | 'absent-remotely'
  | 'undeclared-remotely'
  | 'type-changed'
  | 'nullability-changed'
  | 'presence-changed'
  | 'matched';

export interface LensLiveDriftFinding {
  id: string;
  kind: LensLiveDriftKind;
  severity: LensContractFindingSeverity;
  label: string;
  reason: string;
  fieldPath: string;
  /** What the repository declares, and what the service served. Shapes only. */
  declared?: string;
  served?: string;
  target?: LensVisualTarget;
  evidence: LensEvidence;
}

export interface LensLiveDriftReport {
  version: 1;
  id: string;
  endpointId: string;
  declaredContractId: string;
  outcome: LensProbeOutcome;
  findings: LensLiveDriftFinding[];
  notices: string[];
  truncated: boolean;
}

/**
 * One endpoint on the reachability map.
 *
 * `expectedContractIds` that resolved to nothing are carried as `danglingContractIds`
 * rather than dropped — an endpoint pointing at a contract that no longer exists
 * is exactly the dead end this lens is for.
 */
export interface LensReachabilityItem {
  id: string;
  endpointId: string;
  label: string;
  kind: LensEndpointKind;
  stage: LensEndpointStage;
  outcome: LensProbeOutcome;
  reason: string;
  latencyMs?: number;
  danglingContractIds: string[];
  evidence: LensEvidence;
}

export interface LensReachabilityMap {
  version: 1;
  id: string;
  items: LensReachabilityItem[];
  reachedCount: number;
  unreachableCount: number;
  unassessedCount: number;
  notices: string[];
  truncated: boolean;
}

/**
 * Per-table health, read entirely from catalog statistics.
 *
 * Every number here is an estimate the database already maintains — nothing is
 * produced by scanning a table, so "AtlasMind never reads a row" stays literally
 * true rather than nearly true. `rowEstimate` is therefore **optional**: a
 * relation Postgres has never analyzed reports `reltuples = -1`, and MySQL
 * leaves `TABLE_ROWS` null for several engines. Both mean *unknown*, and
 * defaulting either to `0` would say "this table is empty" about a table nobody
 * has ever measured.
 */
export interface LensTableMetrics {
  table: string;
  /** Planner estimate. Absent when the table has never been analyzed. */
  rowEstimate?: number;
  totalBytes?: number;
  indexBytes?: number;
  indexCount?: number;
  /** When the estimate was last refreshed. Absent means never, not recently. */
  lastAnalyzedAt?: string;
  lastVacuumedAt?: string;
}

/** One declared constraint, so a drift report can name a key that has gone. */
export interface LensTableConstraint {
  table: string;
  name: string;
  /** `PRIMARY KEY`, `FOREIGN KEY`, `UNIQUE`, `CHECK` — as the catalog spells it. */
  constraintType: string;
  column?: string;
}

/**
 * Round-trip timing across several samples of the cheapest possible statement.
 *
 * `first` is kept separate from `p50` on purpose: on a serverless database the
 * first connection of the day pays a cold start measured in seconds, and folding
 * it into an average produces a number that describes neither the cold path nor
 * the warm one. Reported as two facts because they are two facts.
 */
export interface LensLatencyProfile {
  samples: number;
  firstMs: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  /** True when the first sample dominates the rest — a cold start, not slowness. */
  coldStartSuspected: boolean;
}

/**
 * What the planner intends to do with the catalog query.
 *
 * From `EXPLAIN` **without** `ANALYZE`: the plan is computed and the statement
 * is not run. A probe that executed whatever it explained would be a shape
 * nobody should build, however harmless this particular statement is.
 * Every field is optional — a plan is a nice-to-have, and a schema reading that
 * succeeded is never discarded because the plan did not.
 */
export interface LensQueryPlanProfile {
  available: boolean;
  /** Why no plan was read, when there is none. */
  unavailableReason?: string;
  planningMs?: number;
  estimatedCost?: number;
  estimatedRows?: number;
  /** Top-level node type, e.g. `Nested Loop`, `Hash Join`. Never the full tree. */
  rootNode?: string;
}

/** Everything a direct database probe measured, beyond the schema itself. */
export interface LensDatabaseHealth {
  version: 1;
  endpointId: string;
  dialect: LensSqlDialect;
  tables: LensTableMetrics[];
  constraints: LensTableConstraint[];
  latency?: LensLatencyProfile;
  plan?: LensQueryPlanProfile;
  /** Server version string, when the driver reports one. Never a connection string. */
  serverVersion?: string;
  notices: string[];
  truncated: boolean;
}

/**
 * Whether the trust policy still describes what the service actually serves.
 *
 * `served-undeclared` is the finding worth having: a field the live service
 * returns that no rule in `.atlasmind/lens-data-trust.json` classifies. It is
 * unknown sensitivity on real, live data — which the static Data Trust lens
 * cannot see, because the field was never in a repository file.
 */
export type LensLiveTrustStatus = 'confirmed' | 'served-undeclared' | 'declared-absent' | 'unassessed';

export interface LensLiveTrustItem {
  id: string;
  endpointId: string;
  fieldPath: string;
  status: LensLiveTrustStatus;
  classification?: LensDataClassification;
  controls: LensDataControlKind[];
  reason: string;
  evidence: LensEvidence;
}

export interface LensLiveTrustMap {
  version: 1;
  id: string;
  endpointId: string;
  items: LensLiveTrustItem[];
  undeclaredCount: number;
  notices: string[];
  truncated: boolean;
}

// ── Memory / SSOT ───────────────────────────────────────────────

export const SSOT_FOLDERS = [
  'project_soul.md',
  'architecture',
  'roadmap',
  'decisions',
  'misadventures',
  'ideas',
  'domain',
  'operations',
  'agents',
  'skills',
  'index',
  'sessions',
  'routines',
] as const;

export type SsotFolder = (typeof SSOT_FOLDERS)[number];

export type MemoryDocumentClass =
  | 'project-soul'
  | 'architecture'
  | 'roadmap'
  | 'decision'
  | 'misadventure'
  | 'idea'
  | 'domain'
  | 'operations'
  | 'agent'
  | 'skill'
  | 'index'
  | 'session-context'
  | 'other';

export type MemoryEvidenceType = 'manual' | 'imported' | 'generated-index';

/**
 * Structured context loaded from the session SSOT folder.
 * Replaces the raw 400-char sessionContext string when available.
 */
export interface SessionContextBundle {
  /** The top-level goal or problem statement for this session or project run. Rendered before the summary so every agent knows what it is solving. */
  goal?: string;
  /** Rolling compressed summary of the session, updated each turn. */
  summary: string;
  /** Concluded facts, diagnosed issues, and fixes applied this session. */
  decisions: string;
  /** Unresolved questions and incomplete tasks. */
  openThreads: string;
  /** Excerpts from main SSOT entries cited as relevant to this session. */
  ssotExcerpts: string[];
  /** ISO timestamp when this bundle was loaded from disk. */
  loadedAt: string;
}

export interface MemoryEntry {
  path: string;
  title: string;
  tags: string[];
  lastModified: string;
  snippet: string;
  /** Authoritative workspace-relative files or SSOT entries this memory note summarizes or points to. */
  sourcePaths?: string[];
  /** Optional SSOT links used for one-hop graph expansion during retrieval. */
  relatedPaths?: string[];
  /** Import/source fingerprint when this entry was generated from tracked upstream inputs. */
  sourceFingerprint?: string;
  /** Fingerprint of the stored note body, when available from import metadata. */
  bodyFingerprint?: string;
  /** High-level document class used to bias retrieval quality. */
  documentClass?: MemoryDocumentClass;
  /** Whether the entry was hand-authored, imported from live sources, or generated as a meta-index. */
  evidenceType?: MemoryEvidenceType;
  /** Internal embedding/vector metadata used for semantic retrieval. */
  embedding?: number[];
}

/** Outcome of a {@link MemoryManager.upsert} call. */
export interface MemoryUpsertResult {
  /** Whether the entry was accepted ('created' | 'updated') or rejected. */
  status: 'created' | 'updated' | 'rejected';
  /** Human-readable reason when status is 'rejected'. */
  reason?: string;
}

/** Options for {@link MemoryManager.queryWithOptions}, allowing callers to override query mode and filter results. */
export interface MemoryQueryOptions {
  /** Override the inferred retrieval mode instead of using automatic classification. */
  mode?: 'summary-safe' | 'hybrid' | 'live-verify' | 'planning';
  /** Maximum number of results to return (default: 5). */
  maxResults?: number;
  /** Only return entries whose tags include ALL of the specified values. */
  filterByTags?: string[];
  /** Exclude entries whose document class matches any of these values. */
  excludeClass?: MemoryDocumentClass[];
}

/** Aggregate statistics about the in-memory SSOT index. */
export interface MemoryStat {
  /** Total number of indexed entries. */
  totalEntries: number;
  /** Entries grouped by document class. */
  entriesByClass: Partial<Record<MemoryDocumentClass, number>>;
  /** Number of entries with scanner warnings. */
  warnings: number;
  /** Number of entries blocked by the scanner. */
  blocked: number;
  /** Total combined snippet length across all entries (proxy for memory size). */
  totalSnippetChars: number;
  /** Number of entries whose source files may be stale (have sourcePaths but no bodyFingerprint). */
  potentiallyStaleImports: number;
  /** Number of imported entries that are fully fingerprinted (have both sourcePaths and bodyFingerprint). */
  fingerprintedImports: number;
}

/** A single operator feedback event written to SSOT when frustration is detected during chat. */
export interface OperatorFeedback {
  /** ISO timestamp of the feedback event. */
  timestamp: string;
  /** Detected signal strength. */
  level: 'high' | 'moderate' | 'low';
  /** The cue pattern that matched in the user's prompt. */
  matchedCue: string;
  /** Brief human-readable summary of what was detected. */
  summary: string;
  /** The guidance injected into the next model turn. */
  recoveryGuidance: string;
}

// ── Multi-agent project execution ───────────────────────────────

/**
 * A single unit of work within a decomposed project plan.
 * Subtasks form a DAG via `dependsOn`; independent subtasks run in parallel.
 */
export interface SubTask {
  /** Short slug used as a dependency reference key (e.g. "setup-repo"). */
  id: string;
  title: string;
  description: string;
  /** Specialisation role for the ephemeral agent (e.g. "backend-engineer"). */
  role: string;
  /** Skill IDs available to this subtask's agent. */
  skills: string[];
  /** IDs of subtasks whose output must be available before this one starts. */
  dependsOn: string[];
}

/**
 * Lifecycle state of a single subtask.
 *
 * `needs-input` is a non-terminal pause: the subtask stopped because it hit a
 * safety cap (e.g. `maxToolIterations`) without producing a final answer, and a
 * human decision is required to raise the limit and resume, or to skip it.
 * It is deliberately distinct from `failed` so the UI can surface the
 * raise-limit actions instead of treating the run as a hard failure.
 */
export type SubTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'needs-input';

export interface ToolExecutionArtifact {
  toolName: string;
  durationMs: number;
  checkpointed: boolean;
  resultPreview: string;
}

export interface SubTaskExecutionArtifacts {
  output: string;
  outputPreview: string;
  toolCallCount: number;
  /** Number of tool calls whose raw result was classified as a failure. */
  failedToolCallCount?: number;
  toolCalls: ToolExecutionArtifact[];
  verificationSummary?: string;
  tddStatus?: 'verified' | 'blocked' | 'missing' | 'not-applicable';
  tddSummary?: string;
  /** Methodology under which this subtask's verification ran. */
  testingMethodologyId?: TestingMethodologyId;
  checkpointedTools: string[];
  changedFiles: ChangedWorkspaceFile[];
  diffPreview?: string;
}

export interface SubTaskResult {
  subTaskId: string;
  title: string;
  status: SubTaskStatus;
  output: string;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  error?: string;
  role?: string;
  dependsOn?: string[];
  artifacts?: SubTaskExecutionArtifacts;
  /** Set when the subtask failed because a provider was billing-paused with no fallback available. Signals the project runner to abort remaining batches. */
  billingAbort?: boolean;
  /** True when the subtask stopped because it hit the agentic tool-iteration cap (or tools-per-turn cap) without a final answer. Pairs with `status: 'needs-input'`. */
  iterationLimitHit?: boolean;
  /** Orchestrator-suggested higher `maxToolIterations` value the user can apply to resume this subtask. */
  suggestedIterationLimit?: number;
  /** Orchestrator-suggested higher `maxToolCallsPerTurn` value the user can apply to resume this subtask. */
  suggestedToolCallsPerTurnLimit?: number;
}

/** A decomposed project plan ready for parallel execution. */
export interface ProjectPlan {
  id: string;
  goal: string;
  subTasks: SubTask[];
}

/** Final result after all subtasks complete and a synthesis pass runs. */
export interface ProjectResult {
  id: string;
  goal: string;
  subTaskResults: SubTaskResult[];
  /** Synthesised final report assembled from all subtask outputs. */
  synthesis: string;
  totalCostUsd: number;
  totalDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface ChangedWorkspaceFile {
  relativePath: string;
  status: 'created' | 'modified' | 'deleted';
  uri?: { fsPath: string };
}

export type ProjectRunReviewDecision = 'pending' | 'accepted' | 'dismissed';

export interface ProjectRunReviewFile {
  relativePath: string;
  status: ChangedWorkspaceFile['status'];
  uri?: { fsPath: string };
  decision: ProjectRunReviewDecision;
  decidedAt?: string;
}

export interface ProjectRunSummary {
  id: string;
  goal: string;
  startedAt: string;
  generatedAt: string;
  synthesis: string;
  totalCostUsd: number;
  totalDurationMs: number;
  subTaskResults: Array<{
    subTaskId: string;
    title: string;
    status: string;
    costUsd: number;
    durationMs: number;
    error?: string;
  }>;
  changedFiles: ChangedWorkspaceFile[];
  fileAttribution: Record<string, string[]>;
  subTaskArtifacts: ProjectRunSubTaskArtifact[];
}

export interface ProjectRunExecutionOptions {
  autonomousMode: boolean;
  requireBatchApproval: boolean;
  mirrorProgressToChat: boolean;
  injectOutputIntoFollowUp: boolean;
}

export interface ProjectRunIdeationOrigin {
  boardPath: string;
  launchMode: 'focused-card' | 'board-thread';
  sourceCardId?: string;
  sourceCardTitle?: string;
  sourcePrompt?: string;
}

export interface ProjectRunSubTaskArtifact {
  subTaskId: string;
  title: string;
  role: string;
  dependsOn: string[];
  status: SubTaskStatus;
  output: string;
  outputPreview: string;
  costUsd: number;
  durationMs: number;
  error?: string;
  toolCallCount: number;
  toolCalls: ToolExecutionArtifact[];
  verificationSummary?: string;
  tddStatus?: 'verified' | 'blocked' | 'missing' | 'not-applicable';
  tddSummary?: string;
  checkpointedTools: string[];
  changedFiles: ChangedWorkspaceFile[];
  diffPreview?: string;
}

export interface ProjectRunLogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface ProjectRunSeedResult {
  subTaskId: string;
  title: string;
  output: string;
}

export interface ProjectRunRecord {
  id: string;
  title: string;
  goal: string;
  workspaceKey?: string;
  chatSessionId?: string;
  chatMessageId?: string;
  plannerRootRunId?: string;
  plannerJobIndex?: number;
  plannerJobCount?: number;
  plannerSeedResults?: ProjectRunSeedResult[];
  carryForwardSummary?: string;
  ideationOrigin?: ProjectRunIdeationOrigin;
  status: 'previewed' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  estimatedFiles: number;
  requiresApproval: boolean;
  planSubtaskCount: number;
  completedSubtaskCount: number;
  totalSubtaskCount: number;
  currentBatch: number;
  totalBatches: number;
  failedSubtaskTitles: string[];
  reportPath?: string;
  plan?: ProjectPlan;
  summary?: ProjectRunSummary;
  reviewFiles?: ProjectRunReviewFile[];
  subTaskArtifacts: ProjectRunSubTaskArtifact[];
  executionOptions: ProjectRunExecutionOptions;
  requireBatchApproval: boolean;
  paused: boolean;
  awaitingBatchApproval: boolean;
  logs: ProjectRunLogEntry[];
}

/** Progress event emitted as each subtask completes during project execution. */
export type ProjectProgressUpdate =
  | { type: 'planned'; plan: ProjectPlan }
  | { type: 'batch-start'; batchIndex: number; totalBatches: number; batchSize: number; subTaskIds: string[] }
  | { type: 'subtask-start'; subTaskId: string; title: string; batchSize: number }
  | { type: 'subtask-done'; result: SubTaskResult; completed: number; total: number }
  | { type: 'subtask-retry'; subTaskId: string; title: string; reason: string }
  | { type: 'synthesizing' }
  | { type: 'error'; message: string };

// ── Mission Loop (autonomous goal-seeking loop) ─────────────────

/**
 * The closed parameter envelope that bounds a mission. Every field is a HARD
 * stop: {@link MissionRunner} checks each one before starting an iteration and
 * halts with the corresponding {@link MissionStopReason} when any is exceeded.
 * This is the "closed set of parameters" that confines progress.
 */
export interface MissionBudget {
  /** Maximum number of loop iterations before forcing a stop. */
  maxIterations: number;
  /** Hard ceiling on cumulative USD cost across all iterations. */
  maxCostUsd: number;
  /** Hard ceiling on cumulative (input + output) tokens across all iterations. */
  maxTokens: number;
  /** Hard ceiling on wall-clock duration in milliseconds. */
  maxDurationMs: number;
  /**
   * Stop after this many consecutive iterations the goal evaluator judges as
   * making no measurable progress. Prevents the loop from burning budget while
   * spinning on a problem it cannot move forward.
   */
  maxConsecutiveNoProgress: number;
}

/**
 * Free-text and structured constraints injected into every subtask agent prompt
 * for the duration of the mission. Treated as high-priority instructions that
 * compose with (and never override) the immutable guardrails.
 */
export interface MissionGuardrails {
  /** Plain-language rules the mission must respect (e.g. "do not touch auth"). */
  instructions: string[];
  /**
   * Workspace-relative paths the mission must not modify. Surfaced to agents and
   * used to flag (and checkpoint) any increment that would touch them.
   */
  protectedPaths?: string[];
}

/**
 * When the hybrid-autonomy loop must pause for human approval. Any trigger that
 * fires forces a checkpoint before the next iteration proceeds; the checkpoint
 * is denied by default if no approver responds.
 */
export interface MissionCheckpointPolicy {
  /** Require approval every N iterations (0 / undefined disables). */
  everyNIterations?: number;
  /**
   * Require approval the first time cumulative spend crosses each of these
   * fractions (0..1) of the cost budget (e.g. [0.5, 0.9]).
   */
  atBudgetFractions?: number[];
  /** Require approval before any iteration expected to write files or commit. */
  beforeWriteBatches?: boolean;
}

/** A fully specified mission: goal + guardrails + the closed parameter envelope. */
export interface MissionConfig {
  id: string;
  /** The high-level objective the loop works toward. */
  goal: string;
  /**
   * Explicit, checkable "definition of done". Optional — when omitted the goal
   * evaluator infers criteria from the goal. Drives the `achieved` decision.
   */
  successCriteria?: string[];
  guardrails: MissionGuardrails;
  budget: MissionBudget;
  checkpointPolicy: MissionCheckpointPolicy;
  /** Budget/speed routing constraints applied to every increment. */
  constraints: RoutingConstraints;
  /**
   * When true, the loop may synthesize new agents/skills and use Agentic
   * Resource Discovery to fill capability gaps — always behind the existing
   * approval gates. When false, the loop is restricted to registered capabilities.
   */
  allowDiscovery: boolean;
  /** When seeded from an ideation board/card, the origin for audit + write-back. */
  ideationOrigin?: ProjectRunIdeationOrigin;
}

/** The goal evaluator's high-level judgement for one iteration. */
export type GoalVerdictKind = 'achieved' | 'progressing' | 'stalled' | 'blocked';

/** The goal evaluator's structured, validated verdict for one iteration. */
export interface GoalVerdict {
  verdict: GoalVerdictKind;
  /** Evaluator confidence in the verdict, 0..1. */
  confidence: number;
  /** Outstanding work items still required to satisfy the goal. */
  remaining: string[];
  /** Suggested focus for the next increment. */
  nextFocus: string;
  /** Short rationale for the verdict. */
  rationale: string;
}

/** A capability the loop discovered or created during a mission (for audit). */
export interface MissionCapabilityRecord {
  kind: 'agent' | 'skill' | 'mcp-tool' | 'discovered-resource';
  id: string;
  name: string;
  source: 'registry' | 'synthesized' | 'ard';
}

/** Outcome of a single mission iteration. */
export interface MissionIterationResult {
  index: number;
  /** The increment plan executed this iteration. */
  plan: ProjectPlan;
  /** The synthesized report from this iteration's execution. */
  synthesis: string;
  verdict: GoalVerdict;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  changedFiles: ChangedWorkspaceFile[];
  createdCapabilities: MissionCapabilityRecord[];
  /** Subtask outcomes for this iteration (drives verification weighting). */
  subTaskResults: SubTaskResult[];
}

/** Why a mission stopped looping. */
export type MissionStopReason =
  | 'goal-achieved'
  | 'budget-exhausted'
  | 'max-iterations'
  | 'no-progress'
  | 'time-exhausted'
  | 'token-exhausted'
  | 'blocked'
  | 'cancelled'
  | 'error'
  | 'stopped-by-user';

export type MissionStatus =
  | 'previewed'
  | 'running'
  | 'awaiting-checkpoint'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Final result after the mission loop terminates. */
export interface MissionResult {
  id: string;
  goal: string;
  iterations: MissionIterationResult[];
  stopReason: MissionStopReason;
  /** True only when the loop terminated because the goal was achieved. */
  achieved: boolean;
  /** Final assembled report across all iterations. */
  finalSynthesis: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
}

/**
 * A recoverable block: the loop could not make verifiable progress because a
 * relaxable AtlasMind setting (e.g. terminal-write being disabled) prevented a
 * required action. Surfaced to the user so they can override, change the
 * setting, or stop — instead of the loop silently cancelling.
 */
export interface MissionSettingBlocker {
  /** Fully-qualified setting key for display (e.g. "atlasmind.allowTerminalWrite"). */
  settingKey: string;
  /** Config key (without the "atlasmind." prefix) used to apply an in-run override. */
  configKey: string;
  /** Value to set when the user chooses "override for this run". */
  overrideValue: boolean;
  /** Command id that opens the settings page where this setting can be changed. */
  settingsCommand: string;
  /** Short title for the prompt. */
  title: string;
  /** Plain-language explanation of what is blocked and why. */
  detail: string;
}

/** Progress event emitted as a mission loops. Mirrors {@link ProjectProgressUpdate}. */
export type MissionProgressUpdate =
  | { type: 'mission-start'; config: MissionConfig }
  | { type: 'iteration-start'; index: number; maxIterations: number; focus: string }
  | { type: 'planned-increment'; index: number; plan: ProjectPlan }
  | { type: 'executing'; index: number }
  | { type: 'evaluated'; index: number; verdict: GoalVerdict }
  | { type: 'checkpoint-required'; index: number; reason: string; spentUsd: number; budgetUsd: number }
  | { type: 'checkpoint-resolved'; index: number; approved: boolean }
  | { type: 'blocked'; index: number; blocker: MissionSettingBlocker }
  | { type: 'budget-status'; spentUsd: number; budgetUsd: number; iterations: number; maxIterations: number }
  | { type: 'mission-stopped'; result: MissionResult }
  | { type: 'error'; message: string };

/** A persisted mission run (audit trail + resume), stored by MissionRegistry. */
export interface MissionRunRecord {
  id: string;
  goal: string;
  workspaceKey?: string;
  chatSessionId?: string;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  config: MissionConfig;
  iterations: MissionIterationResult[];
  stopReason?: MissionStopReason;
  achieved: boolean;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  /** Capabilities created across the whole mission (deduped). */
  createdCapabilities: MissionCapabilityRecord[];
}

// ── Orchestrator ────────────────────────────────────────────────

export interface TaskRequest {
  id: string;
  userMessage: string;
  context: Record<string, unknown>;
  constraints: RoutingConstraints;
  timestamp: string;
  /** Cancellation signal. When aborted, the orchestrator stops before the next tool iteration. */
  signal?: AbortSignal;
}

export interface TaskImageAttachment {
  source: string;
  mimeType: string;
  dataBase64: string;
}

/** One model endpoint AtlasMind actually invoked while producing a task result. */
export interface TaskModelAttempt {
  model: string;
  providerId: string;
  /** Turn-local circuit-breaker key. Contains no URL, command, or credential. */
  endpointScope: string;
  status: 'completed' | 'timeout' | 'error' | 'capability-mismatch' | 'escalated';
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Bounded diagnostic text for failed or superseded attempts. */
  reason?: string;
}

export interface TaskResult {
  id: string;
  agentId: string;
  modelUsed: string;
  response: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  contextCompressionSavingsUsd?: number;
  durationMs: number;
  /** Every model endpoint actually invoked, in order. Selection previews are excluded. */
  modelAttempts?: TaskModelAttempt[];
  artifacts?: Omit<SubTaskExecutionArtifacts, 'changedFiles' | 'diffPreview'>;
  /** Set when a provider was automatically paused mid-request (e.g. billing failure). */
  autoDisabledProvider?: {
    providerId: string;
    displayName: string;
    reason: 'billing' | 'auth';
    failoverModelUsed?: string;
  };
  /** True when the agentic loop hit the maxToolIterations cap without a natural stop. */
  iterationLimitHit?: boolean;
  /** Orchestrator-suggested new value for maxToolIterations when iterationLimitHit is true. */
  suggestedIterationLimit?: number;
  /** Orchestrator-suggested new value for maxToolCallsPerTurn when the per-turn cap was exceeded. */
  suggestedToolCallsPerTurnLimit?: number;
  /** Set when the orchestrator auto-synthesized a new specialist agent for this task. */
  synthesizedAgent?: {
    id: string;
    name: string;
    role: string;
    description: string;
  };
  /**
   * Set when the task was decomposed into subtasks via processTaskMultiStep.
   * Each element is the result of one subtask in execution order.
   */
  stepwiseResults?: SubTaskResult[];
}

// ── Cost tracking ───────────────────────────────────────────────

export interface CostRecord {
  taskId: string;
  agentId: string;
  model: string;
  providerId?: ProviderId;
  pricingModel?: PricingModel;
  billingCategory?: 'pay-per-token' | 'free' | 'subscription-included' | 'subscription-overflow';
  sessionId?: string;
  messageId?: string;
  inputTokens: number;
  outputTokens: number;
  /** Portion of `inputTokens` served from the provider's prompt cache, when reported. */
  cachedInputTokens?: number;
  costUsd: number;
  budgetCostUsd?: number;
  compressionSavingsUsd?: number;
  /** USD saved this request by the prompt-cache discount on cached input tokens. */
  cacheSavingsUsd?: number;
  timestamp: string;
}

// ── MCP (Model Context Protocol) ────────────────────────────────

/**
 * Persisted configuration for a single MCP server connection.
 * At least one of `command` (stdio) or `url` (HTTP/SSE) must be set.
 */
export interface McpServerConfig {
  /** Unique identifier for this server entry (UUID). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Transport type – 'stdio' spawns a subprocess; 'http' connects over Streamable HTTP/SSE. */
  transport: 'stdio' | 'http';
  // stdio fields
  command?: string;            // e.g. "npx"
  args?: string[];             // e.g. ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
  env?: Record<string, string>;
  /**
   * Names of environment variables whose *values* are stored in VS Code
   * SecretStorage (under `atlasmind.mcp.<id>.<KEY>`) instead of in `env`.
   * Resolved and merged into the process env at connect time; never persisted
   * to globalState. Used by the guided setup wizard for credentials.
   */
  secretEnvKeys?: string[];
  // http fields
  url?: string;                // e.g. "http://localhost:3000/mcp"
  /** Whether the server should be connected on extension activation. */
  enabled: boolean;
}

// ── MCP environment scan (config import + PATH/env discovery) ─────

/**
 * A server definition discovered in another tool's MCP config file (Claude
 * Desktop, Cursor, VS Code, Windsurf, a repo `.mcp.json`, …). Only NON-SECRET
 * metadata is captured here — env var *names* are recorded, never their values.
 * Actual credential values are re-read from the source file on demand at connect
 * time and routed to SecretStorage, so no secret is ever cached or shown.
 */
export interface ImportedMcpServer {
  name: string;
  /** Human-readable source label, e.g. "Claude Desktop" or ".vscode/mcp.json". */
  source: string;
  /** Absolute path of the source config file (used to re-read values on import). */
  sourcePath: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  /** Env var NAMES only (values never captured). */
  envKeys: string[];
  /** Subset of envKeys whose names look like secrets (token/key/secret/…). */
  secretEnvKeys: string[];
}

/**
 * Cached result of scanning the machine + workspace for MCP setup signals. Safe
 * to persist to SSOT: contains no secret values (only names, paths, and launcher
 * availability).
 */
export interface McpEnvironmentScan {
  version: 1;
  scannedAt: string;
  /** Which launch runtimes are on PATH (npx, uvx, docker, python, wrangler, …). */
  launchers: Record<string, boolean>;
  /** Servers found in other tools' MCP config files, ready to import. */
  importedServers: ImportedMcpServer[];
  /** Env var NAMES discovered in dotenv/wrangler files (names only, never values). */
  envVarNames: string[];
  /** Plain-language project signals, e.g. "wrangler.toml present". */
  projectSignals: string[];
  /** Config files that were checked and whether each existed. */
  sources: Array<{ label: string; path: string; exists: boolean }>;
}

/** Live connection status of a single MCP server. */
export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Metadata about a single tool exposed by an MCP server. */
export interface McpToolInfo {
  serverId: string;
  name: string;
  description: string;
  /** JSON Schema object describing the tool's arguments. */
  inputSchema: Record<string, unknown>;
}

/** Snapshot of an MCP server's runtime state (config + live status + discovered tools). */
export interface McpServerState {
  config: McpServerConfig;
  status: McpConnectionStatus;
  /** Set when status is 'error'. */
  error?: string;
  tools: McpToolInfo[];
}

// ── Agentic Resource Discovery (ARD) ─────────────────────────────
//
// ARD (https://github.com/ards-project/ard-spec) is a discovery-only protocol:
// it locates agentic resources (MCP servers, A2A agents, Skills, APIs) BEFORE
// invocation. AtlasMind acts as an ARD client (search + install + in-task
// discovery) and publisher (export its own catalog). All external manifests
// and search responses are treated as untrusted input.

/**
 * IANA media types used by ARD catalog entries to identify the kind of agentic
 * resource an entry points to. Open union — unknown types from external
 * catalogs are preserved verbatim rather than rejected.
 */
export type ArdResourceType =
  | 'application/mcp-server+json'
  | 'application/a2a-agent-card+json'
  | 'application/ai-skill'
  | 'application/ai-catalog+json'
  | 'application/ai-registry+json'
  | (string & {});

/** Federation behaviour for a registry `POST /search` request. */
export type ArdFederationMode = 'auto' | 'referrals' | 'none';

/**
 * How an Agent Finder is queried:
 * - `registry` — a live discovery service exposing `POST /search`.
 * - `manifest` — a static `ai-catalog.json` fetched and searched locally.
 */
export type ArdEndpointKind = 'registry' | 'manifest';

/**
 * Identity / compliance metadata attached to a catalog host or entry. Surfaced
 * read-only in AtlasMind; cryptographic verification is NOT performed in this
 * version (the relevance score and these attestations are informational only).
 */
export interface ArdTrustManifest {
  identity?: string;
  identityType?: string;
  attestations?: Array<{ type: string; uri?: string; digest?: string }>;
  provenance?: Array<{ relation: string; sourceId?: string; sourceDigest?: string }>;
}

/** The publisher/host block of an `ai-catalog.json` manifest. */
export interface ArdHostInfo {
  displayName?: string;
  identifier?: string;
  documentationUrl?: string;
  logoUrl?: string;
  trustManifest?: ArdTrustManifest;
}

/**
 * A single entry in an `ai-catalog.json` manifest. Per the spec's strict
 * Value-or-Reference rule, exactly one of `url` or `data` is present.
 */
export interface ArdCatalogEntry {
  /** Domain-anchored URN: `urn:ai:<publisher>:<namespace>:<name>`. */
  identifier: string;
  displayName: string;
  type: ArdResourceType;
  /** Remote reference to the artifact — mutually exclusive with `data`. */
  url?: string;
  /** Embedded artifact JSON — mutually exclusive with `url`. */
  data?: Record<string, unknown>;
  description?: string;
  representativeQueries?: string[];
  capabilities?: string[];
  tags?: string[];
  version?: string;
  updatedAt?: string;
  trustManifest?: ArdTrustManifest;
}

/** A parsed, validated `ai-catalog.json` manifest. */
export interface ArdCatalog {
  specVersion: string;
  host?: ArdHostInfo;
  entries: ArdCatalogEntry[];
}

/** Filter constraints for a registry search (dot-notation keys; OR within a key, AND across keys). */
export type ArdSearchFilter = Record<string, string[]>;

/** A `POST /search` request body. */
export interface ArdSearchRequest {
  query: { text: string; filter?: ArdSearchFilter };
  federation?: ArdFederationMode;
  pageSize?: number;
  pageToken?: string;
}

/** One ranked result from a registry search. */
export interface ArdSearchResult {
  identifier: string;
  displayName: string;
  type: ArdResourceType;
  url?: string;
  data?: Record<string, unknown>;
  description?: string;
  capabilities?: string[];
  tags?: string[];
  trustManifest?: ArdTrustManifest;
  /** Semantic relevance 0–100. Explicitly NOT a trust, compliance, or safety rating. */
  score?: number;
  /** Identifier/URL of the registry that produced this result. */
  source?: string;
}

/** A referral to another registry the client may choose to query (federation). */
export interface ArdReferral {
  identifier: string;
  displayName: string;
  type: ArdResourceType;
  url: string;
}

/** A `POST /search` response body. */
export interface ArdSearchResponse {
  results: ArdSearchResult[];
  referrals?: ArdReferral[];
  pageToken?: string;
}

/**
 * A persisted "Agent Finder" — a discovery endpoint AtlasMind can query.
 * Stored in globalState by the ArdRegistry; the shipped defaults are disabled
 * so no outbound discovery traffic occurs until the user opts in.
 */
export interface ArdDiscoveryEndpoint {
  id: string;
  name: string;
  url: string;
  kind: ArdEndpointKind;
  enabled: boolean;
  /**
   * Allow http/localhost targets (e.g. the ARD conformance demo registry).
   * Only honoured when `atlasmind.ard.allowInsecureEndpoints` is true.
   */
  insecure?: boolean;
  /** True for the finders shipped with the extension. */
  builtIn?: boolean;
}

/**
 * A normalized discovered resource (catalog entry or search result) annotated
 * with the finder that surfaced it. Used by the discovery panel/tree and the
 * install flow.
 */
export interface ArdDiscoveredResource {
  identifier: string;
  displayName: string;
  type: ArdResourceType;
  url?: string;
  data?: Record<string, unknown>;
  description?: string;
  capabilities?: string[];
  tags?: string[];
  trustManifest?: ArdTrustManifest;
  score?: number;
  /** Display name of the Agent Finder that surfaced this resource. */
  sourceName: string;
  /** Endpoint id of the finder that surfaced this resource. */
  sourceEndpointId?: string;
}

/** Outcome of an {@link ArdInstaller} action for a single discovered resource. */
export interface ArdInstallResult {
  /** What happened: a resource was installed, a finder added, or it was recorded as a reference. */
  kind: 'mcp-server' | 'finder' | 'reference' | 'unsupported';
  ok: boolean;
  /** Human-readable summary for the UI / chat. */
  message: string;
  /** When kind is 'mcp-server', the id of the newly added (disabled) server. */
  mcpServerId?: string;
  /** When kind is 'finder', the id of the newly added (disabled) finder. */
  finderId?: string;
}

// ── Voice (TTS / STT) ────────────────────────────────────────────────────────

/**
 * Voice synthesis and recognition settings.
 * All values are validated before use (see VoiceManager).
 */
export interface VoiceSettings {
  /** Speech rate — range [0.5, 2.0], default 1.0. */
  rate: number;
  /** Pitch — range [0, 2], default 1.0. */
  pitch: number;
  /** Volume — range [0, 1], default 1.0. */
  volume: number;
  /** Whether STT controls should be available in the voice panel. */
  sttEnabled: boolean;
  /**
   * BCP 47 language tag for synthesis and recognition (e.g. "en-US").
   * Empty string means browser/OS default.
   */
  language: string;
  /** Preferred microphone device id, when a backend can honor it. */
  inputDeviceId: string;
  /** Preferred audio output device id, when a backend can honor it. */
  outputDeviceId: string;
}
