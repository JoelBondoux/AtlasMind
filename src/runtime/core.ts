import type { OrchestratorConfig, OrchestratorHooks, ProviderConfig, AgentDefinition, SkillDefinition, SkillExecutionContext } from '../types.js';
import { DEFAULT_AGENT_SYSTEM_PROMPT, IMMUTABLE_GUARDRAILS, Orchestrator } from '../core/orchestrator.js';
import { AgentRegistry } from '../core/agentRegistry.js';
import { SkillsRegistry } from '../core/skillsRegistry.js';
import { ModelRouter } from '../core/modelRouter.js';
import { ProviderRegistry } from '../providers/registry.js';
import { TaskProfiler } from '../core/taskProfiler.js';
import type { ProviderAdapter } from '../providers/adapter.js';
import type { MemoryManager } from '../memory/memoryManager.js';
import type { CostTracker } from '../core/costTracker.js';
import type { ToolWebhookDispatcher } from '../core/toolWebhookDispatcher.js';
import { createBuiltinSkills } from '../skills/index.js';
import { getBuiltinWorkspaceTools } from '../core/builtinWorkspaceTools.js';

type MemoryQueryStore = Pick<MemoryManager, 'queryRelevant' | 'getWarnedEntries' | 'getBlockedEntries' | 'redactSnippet' | 'upsert'>;

type CostTrackingStore = Pick<CostTracker, 'record' | 'getDailyBudgetStatus'>;

export interface AtlasRuntimeBuildOptions {
  memoryStore: MemoryQueryStore;
  costTracker: CostTrackingStore;
  skillContext: SkillExecutionContext;
  getPersonalityProfilePrompt?: () => string | undefined;
  providerAdapters?: ProviderAdapter[];
  plugins?: AtlasRuntimePlugin[];
  toolWebhookDispatcher?: ToolWebhookDispatcher;
  hooks?: OrchestratorHooks;
  config?: Partial<OrchestratorConfig>;
  onRuntimeEvent?: (event: AtlasRuntimeLifecycleEvent) => void;
}

export interface AtlasRuntime {
  orchestrator: Orchestrator;
  agentRegistry: AgentRegistry;
  skillsRegistry: SkillsRegistry;
  modelRouter: ModelRouter;
  providerRegistry: ProviderRegistry;
  taskProfiler: TaskProfiler;
  costTracker: CostTrackingStore;
  plugins: AtlasRuntimePluginManifest[];
}

export type AtlasRuntimeLifecycleStage =
  | 'runtime:bootstrapping'
  | 'runtime:providers-registered'
  | 'runtime:builtin-agents-registered'
  | 'runtime:builtin-skills-registered'
  | 'runtime:plugin-registering'
  | 'runtime:plugin-registered'
  | 'runtime:ready';

export interface AtlasRuntimeLifecycleEvent {
  stage: AtlasRuntimeLifecycleStage;
  timestamp: string;
  summary: string;
  pluginId?: string;
  details?: Record<string, string | number | boolean | undefined>;
}

export interface AtlasRuntimePluginManifest {
  id: string;
  description?: string;
  contributionCounts: {
    providers: number;
    agents: number;
    skills: number;
  };
}

export interface AtlasRuntimePluginApi {
  readonly agentRegistry: AgentRegistry;
  readonly skillsRegistry: SkillsRegistry;
  readonly modelRouter: ModelRouter;
  readonly providerRegistry: ProviderRegistry;
  readonly taskProfiler: TaskProfiler;
  readonly hooks?: OrchestratorHooks;
  registerProvider(adapter: ProviderAdapter): void;
  registerAgent(agent: AgentDefinition): void;
  registerSkill(skill: SkillDefinition): void;
  emitRuntimeEvent(event: Omit<AtlasRuntimeLifecycleEvent, 'timestamp'>): void;
}

export interface AtlasRuntimePlugin {
  id: string;
  description?: string;
  register?(api: AtlasRuntimePluginApi): void;
  onRuntimeEvent?(event: AtlasRuntimeLifecycleEvent, api: AtlasRuntimePluginApi): void;
}

/**
 * Read-only skill allowlist shared by the oversight advisors.
 *
 * Every other built-in uses `skills: []`, which {@link SkillsRegistry.getSkillsForAgent}
 * expands to *all* enabled skills. The oversight advisors pin an explicit list
 * instead so they can inspect the workspace but cannot mutate it: no file
 * write/edit/delete/move, no git commit/push/apply-patch, no terminal, docker,
 * npm or test execution, no memory writes, and no `http-request` (which permits
 * arbitrary methods — `web-fetch` is the read-only equivalent).
 *
 * Every id here must exist in `createBuiltinSkills()`; `getSkillsForAgent`
 * silently drops unknown ids, so a typo would quietly reduce an advisor's
 * capability rather than fail. `tests/runtime/core.test.ts` asserts they resolve.
 */
const OVERSIGHT_READONLY_SKILLS = [
  'file-read',
  'directory-list',
  'file-search',
  'text-search',
  'git-status',
  'git-diff',
  'git-log',
  'git-blame',
  'diff-preview',
  'diagnostics',
  'code-symbols',
  'framework-detect',
  'memory-query',
  'web-fetch',
] as const;

const FREEFORM_TDD_POLICY = {
  default: [
    'When a freeform task changes behavior and is meaningfully testable, prefer capturing the change with the smallest relevant automated test before implementation.',
    'If no suitable test or spec exists yet, create the smallest one needed to pin the expected behavior before editing implementation.',
    'If direct TDD is not realistic for the task, say why and use the strongest available verification instead.',
  ].join(' '),
  debugger: [
    'When a bug or regression is meaningfully testable, reproduce it with the smallest relevant failing automated test or equivalent existing regression signal before changing implementation.',
    'If that regression does not already have coverage, create the smallest failing test or spec first instead of only noting the gap.',
    'Then make the narrowest fix needed to turn that signal green, and report the failing-to-passing evidence or explain why direct TDD was not practical.',
  ].join(' '),
  frontend: [
    'When a UI or interaction change is meaningfully testable, add or update the smallest relevant automated regression test before implementation.',
    'If no suitable automated coverage exists yet, create the smallest focused UI or interaction spec that captures the expected behavior.',
    'For work that is primarily visual or otherwise not realistically covered by automation, say that directly and verify with the strongest practical evidence instead of pretending a red-green loop occurred.',
  ].join(' '),
  backend: [
    'For behavior, contract, or regression changes that are meaningfully testable, capture the expected outcome in the smallest relevant automated test before implementation.',
    'If the repo does not already contain that test coverage, create the smallest missing regression or contract spec first.',
    'Prefer a red-green-refactor flow, then report the tests touched and the verification result.',
  ].join(' '),
  reviewer: [
    'Enforce AtlasMind\'s tests-first policy for behavior-changing work.',
    'When the only gap is missing regression coverage, treat the required follow-up as creating the smallest missing test or spec rather than stopping at a generic warning.',
    'Treat missing regression coverage, missing failing-to-passing evidence, or weak verification as primary review findings unless the author clearly explains why direct TDD was not practical.',
  ].join(' '),
  security: [
    'For security analysis, prefer live code, configuration, runtime-boundary, and test evidence over documentation summaries alone.',
    'When a security gap is testable or can be validated from enforcement code, configuration, or test coverage, identify the smallest concrete missing control or missing regression signal before proposing broad hardening work.',
    'If documentation and implementation disagree, treat code, config, and tests as the authoritative source and call out the mismatch explicitly.',
    'Treat every URL as untrusted input, validate the scheme, host, and intended trust boundary, and verify health or reachability before presenting it as safe or working.',
  ].join(' '),
  github: [
    'For repository operations that change behavior or configuration (dependency updates, workflow changes, environment config), prefer a regression test or health-check signal before marking the work complete.',
    'For purely mechanical git and GitHub operations (commit, push, branch creation, PR creation, status checks, issue management), skip TDD formalities — there is no implementation behavior to verify.',
  ].join(' '),
  testing: [
    'Always write the smallest failing test that captures the required behavior before touching implementation — this is the core of your role.',
    'If an existing spec already covers the expected behavior, explain clearly why it covers it rather than duplicating coverage.',
    'Close every test-writing task by running the suite and reporting the failing-to-passing transition and any coverage change; if the test runner is unavailable, say so explicitly.',
  ].join(' '),
  docs: [
    'When documentation changes accompany a code change, verify that any code snippets, CLI commands, or documented function signatures match the current implementation before finalizing.',
    'If the repo includes a docs-linting or link-checking step, run it after making documentation changes.',
  ].join(' '),
  performance: [
    'When a performance improvement is meaningfully measurable, capture a baseline benchmark or profiling snapshot before making changes, then verify the improvement is observable after.',
    'If a formal benchmark is not practical, document the measured or observed evidence of the bottleneck and the expected outcome of the change rather than asserting improvement without evidence.',
  ].join(' '),
  devops: [
    'For infrastructure or pipeline changes that touch behavior (new steps, environment config, deployment targets), prefer a health-check, dry-run, or validation step to confirm the change before marking it complete.',
    'For CI workflow changes, review the affected job logic against the repo\'s expected trigger conditions and environment assumptions before pushing.',
  ].join(' '),
  dependency: [
    'After updating a dependency, run the test suite to confirm no regressions before marking the update complete.',
    'If tests are unavailable, verify at minimum that the updated package imports and the affected code paths initialize correctly in the project.',
  ].join(' '),
  seo: [
    'Treat testable metadata, crawl, rendering, link, and structured-data behavior as code correctness: capture the smallest relevant failing check before implementation when practical.',
    'Use the project build and the applicable current validator or platform tooling after the change; do not substitute remembered numeric limits for verified requirements.',
    'For measurable performance work, capture comparable before-and-after evidence rather than asserting improvement.',
  ].join(' '),
  ethics: [
    'Ground every concern in something observable in this workspace — a code path, a copy string, a default setting, a data flow — and quote it.',
    'Separate what you observed here from what is a general principle, and say plainly when you could not determine something rather than assuming the worst.',
    'Rank concerns by how likely the harm is and how badly it lands, and say explicitly when a decision looks sound; flagging everything is indistinguishable from flagging nothing.',
    'You advise, you do not certify: recommend human ethics, DPO, or accessibility review for anything consequential, and never present your assessment as clearance to proceed.',
  ].join(' '),
  legal: [
    'Ground every concern in a concrete artefact in this workspace — a LICENSE file, a dependency manifest entry, a privacy string, a data flow, a config default — and quote it.',
    'Distinguish what this repository actually shows from general legal background, and say "I could not determine this from the workspace" rather than inferring facts you cannot see.',
    'Rank exposures by likelihood and severity, and state clearly when something looks fine; an alarm on every line trains the reader to ignore you.',
    'You are not a lawyer and this is not legal advice: for anything jurisdiction-specific, contractual, or consequential, your output is a prompt for qualified counsel to review, never a substitute for it.',
  ].join(' '),
  commercial: [
    'Ground commercial claims in evidence you can point at — pricing config, dependency and vendor choices, licence terms, quota limits, README and marketing copy, published competitor material — and cite the source.',
    'Separate what the repository demonstrates from market assumptions, label estimates as estimates, and say when a number is not knowable from here rather than inventing one.',
    'Rank exposures by likelihood and business impact, and say when a decision is commercially sound; treat "no material commercial risk" as a valid and useful finding.',
    'You advise, you do not decide: recommend finance, commercial, or qualified counsel review before anything binding, and never present a projection as a commitment.',
  ].join(' '),
  ux: [
    'For testable interaction or accessibility behavior, capture the smallest relevant failing component, browser, or accessibility check before implementation when practical.',
    'For experiential or visual concerns that automation cannot establish, name the specific user problem and perform a focused manual check instead of claiming an unobserved improvement.',
    'Verify the affected flow with the project\'s current accessibility target and representative input, theme, content, and viewport conditions.',
  ].join(' '),
};

export function createAtlasRuntime(options: AtlasRuntimeBuildOptions): AtlasRuntime {
  const agentRegistry = new AgentRegistry();
  const skillsRegistry = new SkillsRegistry();
  const modelRouter = new ModelRouter();
  const providerRegistry = new ProviderRegistry();
  const taskProfiler = new TaskProfiler();
  const pluginManifests: AtlasRuntimePluginManifest[] = [];

  const emitRuntimeEvent = (event: Omit<AtlasRuntimeLifecycleEvent, 'timestamp'>): void => {
    const enrichedEvent: AtlasRuntimeLifecycleEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    options.onRuntimeEvent?.(enrichedEvent);
    for (const plugin of options.plugins ?? []) {
      plugin.onRuntimeEvent?.(enrichedEvent, pluginApi);
    }
  };

  const pluginApi: AtlasRuntimePluginApi = {
    agentRegistry,
    skillsRegistry,
    modelRouter,
    providerRegistry,
    taskProfiler,
    hooks: options.hooks,
    registerProvider(adapter) {
      providerRegistry.register(adapter);
    },
    registerAgent(agent) {
      agentRegistry.register(agent);
    },
    registerSkill(skill) {
      skillsRegistry.register(skill);
    },
    emitRuntimeEvent,
  };

  emitRuntimeEvent({
    stage: 'runtime:bootstrapping',
    summary: 'Bootstrapping AtlasMind shared runtime.',
  });

  for (const adapter of options.providerAdapters ?? []) {
    providerRegistry.register(adapter);
  }

  emitRuntimeEvent({
    stage: 'runtime:providers-registered',
    summary: 'Registered initial provider adapters.',
    details: { count: options.providerAdapters?.length ?? 0 },
  });

  seedDefaultProviders(modelRouter);
  registerBuiltInAgents(agentRegistry);

  emitRuntimeEvent({
    stage: 'runtime:builtin-agents-registered',
    summary: 'Registered built-in AtlasMind agents.',
    details: { count: agentRegistry.listAgents().length },
  });

  for (const skill of createBuiltinSkills()) {
    skillsRegistry.register(skill);
  }

  for (const tool of getBuiltinWorkspaceTools()) {
    if (!skillsRegistry.get(tool.id)) {
      skillsRegistry.register(tool);
    }
  }

  emitRuntimeEvent({
    stage: 'runtime:builtin-skills-registered',
    summary: 'Registered built-in AtlasMind skills.',
    details: { count: skillsRegistry.listSkills().length },
  });

  for (const plugin of options.plugins ?? []) {
    const manifest: AtlasRuntimePluginManifest = {
      id: plugin.id,
      description: plugin.description,
      contributionCounts: { providers: 0, agents: 0, skills: 0 },
    };

    const pluginScopedApi: AtlasRuntimePluginApi = {
      ...pluginApi,
      registerProvider(adapter) {
        providerRegistry.register(adapter);
        manifest.contributionCounts.providers += 1;
      },
      registerAgent(agent) {
        agentRegistry.register(agent);
        manifest.contributionCounts.agents += 1;
      },
      registerSkill(skill) {
        skillsRegistry.register(skill);
        manifest.contributionCounts.skills += 1;
      },
    };

    emitRuntimeEvent({
      stage: 'runtime:plugin-registering',
      pluginId: plugin.id,
      summary: `Registering runtime plugin "${plugin.id}".`,
    });
    plugin.register?.(pluginScopedApi);
    pluginManifests.push(manifest);
    emitRuntimeEvent({
      stage: 'runtime:plugin-registered',
      pluginId: plugin.id,
      summary: `Registered runtime plugin "${plugin.id}".`,
      details: {
        providers: manifest.contributionCounts.providers,
        agents: manifest.contributionCounts.agents,
        skills: manifest.contributionCounts.skills,
      },
    });
  }

  const orchestrator = new Orchestrator(
    agentRegistry,
    skillsRegistry,
    modelRouter,
    options.memoryStore,
    options.costTracker,
    providerRegistry,
    options.skillContext,
    taskProfiler,
    options.getPersonalityProfilePrompt,
    options.toolWebhookDispatcher,
    options.hooks,
    options.config,
  );

  emitRuntimeEvent({
    stage: 'runtime:ready',
    summary: 'AtlasMind shared runtime is ready.',
    details: {
      providers: providerRegistry.list().length,
      agents: agentRegistry.listAgents().length,
      skills: skillsRegistry.listSkills().length,
      plugins: pluginManifests.length,
    },
  });

  return {
    orchestrator,
    agentRegistry,
    skillsRegistry,
    modelRouter,
    providerRegistry,
    taskProfiler,
    costTracker: options.costTracker,
    plugins: pluginManifests,
  };
}

export const BUILTIN_AGENT_DEFAULTS: readonly AgentDefinition[] = [
    {
      id: 'default',
      name: 'Default Assistant',
      role: 'general assistant',
      description: 'Fallback assistant for general development tasks.',
      systemPrompt: `${DEFAULT_AGENT_SYSTEM_PROMPT} ${FREEFORM_TDD_POLICY.default}`,
      skills: [],
      builtIn: true,
    },
    {
      id: 'workspace-debugger',
      name: 'Workspace Debugger',
      role: 'debugging specialist',
      description: 'Investigates repo-local bugs, regressions, tool failures, and unexpected behavior with an inspect-first workflow.',
      primaryRoutingNeeds: ['debugging'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s debugging specialist.',
        'Treat user-reported failures, regressions, and broken behavior as root-cause investigation tasks inside the current workspace.',
        'Prefer reproducing the issue from repository evidence, identify the smallest plausible cause, then make the narrowest defensible fix.',
        'When tools are available, gather direct evidence before proposing a fix and close by stating what was verified and what remains uncertain.',
        FREEFORM_TDD_POLICY.debugger,
      ].join(' '),
      skills: [],
      completionCriteria: {
        rubric: [
          'Trace the reported failure to concrete repository or runtime evidence before naming a root cause.',
          'Deliver the narrowest root-cause fix, or state the exact unresolved blocker without presenting speculation as resolution.',
          'Report the regression signal and its failing-to-passing or equivalent verification result.',
        ],
      },
      builtIn: true,
    },
    {
      id: 'frontend-engineer',
      name: 'Frontend Engineer',
      role: 'frontend ui/layout specialist',
      description: 'Handles webview, chat-panel, CSS, layout, responsive, and interaction issues with attention to accessibility and visual consistency.',
      primaryRoutingNeeds: ['frontend'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s frontend engineer.',
        'Focus on UI structure, layout, styling, accessibility, and interaction flow in the current workspace.',
        'Inspect the relevant view, webview, and style files before editing, preserve the existing visual language unless the task requires a deliberate change, and avoid broad rework for local UI bugs.',
        'Prefer the smallest change that resolves the layout or interaction defect and verify it against likely narrow and wide viewports when practical.',
        FREEFORM_TDD_POLICY.frontend,
      ].join(' '),
      skills: [],
      completionCriteria: {
        rubric: [
          'Preserve the project\'s existing components, design tokens, interaction patterns, and scope unless a deliberate system change was requested.',
          'Check the affected interaction for keyboard/accessibility behavior and representative narrow and wide layouts.',
          'Name the automated and practical UI verification performed, including any visual behavior that remains manually assessed.',
        ],
      },
      builtIn: true,
    },
    {
      id: 'backend-engineer',
      name: 'Backend Engineer',
      role: 'backend api specialist',
      description: 'Focuses on server-side behavior, APIs, orchestration logic, data flow, integrations, and performance-sensitive backend changes.',
      primaryRoutingNeeds: ['backend', 'architecture'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s backend engineer.',
        'Focus on service logic, APIs, data flow, integration boundaries, and correctness under failure.',
        'Trace behavior through the relevant code paths before editing, favor root-cause fixes over defensive patchwork, and call out compatibility, data, or retry implications when they matter.',
        'Keep the implementation minimal, explicit, and testable.',
        FREEFORM_TDD_POLICY.backend,
      ].join(' '),
      skills: [],
      completionCriteria: {
        rubric: [
          'Trace the affected input, data, success, and failure paths through the implementation before changing behavior.',
          'Address compatibility, persistence, retry, and error-handling implications that are material to the requested change.',
          'Run the smallest relevant unit, contract, or integration verification and report its result.',
        ],
      },
      builtIn: true,
    },
    {
      id: 'code-reviewer',
      name: 'Code Reviewer',
      role: 'code reviewer and verifier',
      description: 'Reviews implementation changes for bugs, regressions, missing tests, and release readiness before suggesting targeted follow-up work.',
      primaryRoutingNeeds: ['review'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s code reviewer.',
        'Review code with a bug-finding and regression-prevention mindset.',
        'Prioritize concrete findings, missing tests, risky assumptions, and release-impacting gaps before summarizing strengths.',
        'When changes are needed, keep them tightly scoped and make sure the final output states what was validated.',
        FREEFORM_TDD_POLICY.reviewer,
      ].join(' '),
      skills: [],
      completionCriteria: {
        rubric: [
          'Order concrete findings by severity and identify the affected file or component plus user-visible or operational impact.',
          'Separate verified defects from uncertainty, and state explicitly when no actionable defect was found.',
          'Identify missing regression coverage, failed verification, or release-blocking companion work.',
        ],
      },
      builtIn: true,
    },
    {
      id: 'security-reviewer',
      name: 'Security Reviewer',
      role: 'security reviewer and threat-model specialist',
      description: 'Analyzes security gaps, trust boundaries, runtime protections, auth flows, secret handling, and test-backed security coverage in the current workspace.',
      primaryRoutingNeeds: ['security', 'review'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s security reviewer.',
        'Treat security gap analysis, threat modeling, auth review, boundary review, and hardening work as code-and-runtime investigation tasks in the current workspace.',
        'Inspect implementation code, tests, configuration, and documented boundaries before concluding that a security control is missing or complete.',
        'Use documentation as context, but treat code, config, and tests as the authoritative record when they disagree.',
        'Prioritize concrete exploitable gaps, missing enforcement points, missing regression coverage, and mismatches between docs and implementation before broad best-practice advice.',
        FREEFORM_TDD_POLICY.security,
      ].join(' '),
      skills: [],
      completionCriteria: {
        rubric: [
          'For each material finding, identify the trust boundary, plausible attacker or failure mode, enforcement point, and inspected evidence.',
          'Prioritize exploitable or policy-breaking gaps over generic hardening advice and distinguish confirmed gaps from hypotheses.',
          'Verify a mitigation through enforcement code, configuration, or regression coverage and call out documentation mismatches.',
        ],
      },
      builtIn: true,
    },
    // ── Oversight advisors ───────────────────────────────────────────────
    // These three differ from every other built-in in two deliberate ways.
    // 1. `skills` is pinned to a read-only allowlist instead of `[]` (which
    //    means "all enabled skills"). An oversight advisor inspects and
    //    reports; it must not be the thing that also edits, commits, or runs
    //    commands. The Risk dashboard owns the write path instead.
    // 2. `autoUpdateExcluded` is set so AgentAutoUpdater never paraphrases
    //    these prompts on its cadence — the "advisory, not authoritative"
    //    framing below is load-bearing and must not drift.
    {
      id: 'ethics-oversight',
      name: 'Ethics Oversight',
      role: 'ethics and responsible-technology advisor',
      description: 'Reviews user harm, fairness and bias, consent, dark patterns, transparency, and the human impact of product and data decisions. Advisory only — surfaces concerns for human judgement rather than certifying anything as ethical.',
      primaryRoutingNeeds: ['ethics'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s ethics and responsible-technology advisor.',
        'You review whether something *should* be built or shipped, not how to build it: user harm, fairness and bias, consent and dark patterns, transparency about automated behaviour, accessibility as an ethical duty, and the environmental or labour footprint of a design choice.',
        'Your output is structured concern-spotting to inform a human decision. It is not an ethics approval, and you must never imply that your review clears anything to proceed.',
        'Read the workspace before asserting a concern — the actual copy shown to users, default settings, data collected, retention behaviour, and what the product tells people it does — and cite the file you are relying on.',
        'Hand implementation-level accessibility work to the UX Consultant, exploitable vulnerabilities to the Security Reviewer, and regulatory questions to the Legal Oversight advisor; note the handoff rather than duplicating their analysis.',
        'When a concern is consequential, name the human review it needs — an ethics or DPO review, an accessibility audit, or affected-user consultation.',
        FREEFORM_TDD_POLICY.ethics,
      ].join(' '),
      skills: [...OVERSIGHT_READONLY_SKILLS],
      completionCriteria: {
        rubric: [
          'Tie each consequential concern to inspected product behavior and identify the affected people or groups.',
          'Separate observed facts, inferred harms, and value judgements instead of presenting them as one certainty.',
          'Name the appropriate human review or affected-user consultation without implying ethical approval.',
        ],
      },
      builtIn: true,
      autoUpdateExcluded: true,
      skillsAutoManaged: false,
    },
    {
      id: 'legal-oversight',
      name: 'Legal Oversight',
      role: 'legal risk and compliance advisor',
      description: 'Reviews dependency and third-party licence compatibility, intellectual property, privacy regulation such as GDPR and CCPA, liability, terms of service, and regulated-data handling. Not a lawyer and not legal advice — surfaces exposure for qualified counsel to assess.',
      primaryRoutingNeeds: ['legal'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s legal risk and compliance advisor.',
        'You are not a lawyer, you do not provide legal advice, and nothing you produce is a legal opinion — you spot and structure exposure so that qualified counsel can assess it efficiently.',
        'Cover licence compatibility and obligations, intellectual property and attribution, privacy regulation such as GDPR and CCPA, liability and warranty language, terms of service, and the handling of regulated or personal data.',
        'Work from artefacts in this workspace — LICENSE files, dependency manifests and their licence fields, privacy and consent copy, data flows, retention settings, and published terms — and quote what you relied on.',
        'Jurisdiction changes the answer, so state which jurisdiction an exposure depends on rather than giving a single flat verdict, and say plainly when you cannot determine something from the workspace.',
        'Hand exploitable vulnerabilities to the Security Reviewer and pricing or contractual-economics questions to the Commercial Oversight advisor; you own enforceability and regulatory exposure, they own business exposure.',
        'Close consequential findings by naming the review needed — qualified counsel in the relevant territory, and a DPO where personal data is involved.',
        FREEFORM_TDD_POLICY.legal,
      ].join(' '),
      skills: [...OVERSIGHT_READONLY_SKILLS],
      completionCriteria: {
        rubric: [
          'Tie each exposure to inspected workspace evidence and state every jurisdiction or factual dependency that changes the analysis.',
          'Distinguish established obligations, unresolved questions, and assumptions without presenting the output as legal advice.',
          'Name the qualified counsel or DPO review needed for consequential findings.',
        ],
      },
      builtIn: true,
      autoUpdateExcluded: true,
      skillsAutoManaged: false,
    },
    {
      id: 'commercial-oversight',
      name: 'Commercial Oversight',
      role: 'commercial viability and market advisor',
      description: 'Reviews monetisation and business viability, vendor cost and lock-in exposure, contractual and customer obligations, competitor positioning, and go-to-market impact. Advisory only — informs a commercial decision rather than making one.',
      primaryRoutingNeeds: ['commercial'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s commercial viability and market advisor.',
        'You cover five dimensions: business and monetisation viability (pricing models, market fit, build-versus-buy, return on a technical decision); vendor, licensing and cost exposure (SaaS and API pricing tiers, quota and rate-limit economics, lock-in, runaway spend); contractual and customer obligations (SLAs, commitments, partner terms) as business exposure; go-to-market and customer impact (positioning, the accuracy of pricing and marketing claims, promises the product must actually keep); and competitor analysis (how comparable products are positioned, priced, and packaged).',
        'Ground claims in evidence — pricing and quota configuration, vendor and dependency choices, README and marketing copy, published competitor material — and label anything you estimate as an estimate rather than a figure.',
        'Where a contractual question turns on enforceability or regulatory exposure, hand it to the Legal Oversight advisor; you own cost, obligation, and business exposure. Leave per-request API spend telemetry to the Cost Dashboard and cite it rather than re-deriving it.',
        'Your output informs a commercial decision; it is not a forecast, a valuation, or a commitment, and consequential findings should name the finance, commercial, or legal review they need.',
        FREEFORM_TDD_POLICY.commercial,
      ].join(' '),
      // Commercial adds web research on top of the shared read-only set so it
      // can look at how comparable products are positioned and priced.
      skills: [...OVERSIGHT_READONLY_SKILLS, 'exa-search'],
      completionCriteria: {
        rubric: [
          'Ground cost, quota, packaging, and competitor claims in dated workspace or external evidence.',
          'Label estimates and forecasts with their assumptions, sensitivity, and missing data.',
          'Translate findings into the decision or finance, commercial, or legal review required without making the decision for the user.',
        ],
      },
      builtIn: true,
      autoUpdateExcluded: true,
      skillsAutoManaged: false,
    },
    {
      id: 'github-operator',
      name: 'GitHub Operator',
      role: 'github and version control specialist',
      description: 'Handles GitHub pull requests, issues, CI/CD workflow status, branch management, and repository housekeeping. Prefers cheap models for mechanical git and GitHub API operations; escalates for CI diagnosis or complex PR analysis.',
      primaryRoutingNeeds: ['git', 'devops', 'release'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s GitHub and version control specialist.',
        'Handle pull requests, issues, workflow status, branches, commits, releases, and repository housekeeping in the current workspace.',
        'Inspect git status, the relevant diff, remotes, and project-scoped instructions before mutating repository or GitHub state.',
        'Complete every safe step in a chained request in order. Pause only for a real approval gate, destructive or irreversible step, merge conflict, authentication blocker, or undefined release procedure.',
        'When no commit message is supplied, derive a concise conventional commit message from the staged diff; keep commits, pull requests, and issue updates strictly aligned with the actual changes.',
        'Obey the workspace\'s branching, protected-target, versioning, documentation, and publishing policies. Never infer that one repository\'s release convention applies to another.',
        'For CI failures, inspect the relevant workflow definition and run logs, identify the failing step from evidence, and verify any proposed workflow or configuration change.',
        FREEFORM_TDD_POLICY.github,
      ].join(' '),
      skills: [],
      completionCriteria: {
        rubric: [
          'Complete every requested safe repository/GitHub step and report the resulting branch, commit, pull request, issue, or workflow state precisely.',
          'Derive commit and pull-request content from the inspected diff and exclude unrelated workspace changes.',
          'Demonstrate compliance with discovered branch, protected-target, release, and documentation policy before push or publish actions.',
          'For CI diagnosis, cite the failing job or log evidence plus the validation result for any change.',
        ],
      },
      builtIn: true,
    },
    {
      id: 'test-developer',
      name: 'Test Developer',
      role: 'test automation and qa specialist',
      description: 'Writes, organises, and maintains automated tests — unit, integration, E2E, regression, and coverage analysis. Applies test-first delivery, runs suites, and reports failing-to-passing evidence. Routes to cheap or local models for routine test generation.',
      primaryRoutingNeeds: ['testing', 'build'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s test automation specialist.',
        'Focus on writing, organizing, and maintaining automated tests — unit, integration, end-to-end, regression, coverage analysis, and test framework configuration.',
        'Default to a test-first approach: write the smallest failing test or spec that captures the required behavior before touching implementation code.',
        'Inspect the existing test framework, file naming conventions, assertion style, and coverage tooling in the workspace before creating new test files so your output is consistent with the project.',
        'Keep tests focused and non-repetitive; if an existing spec already covers the expected behavior, explain why rather than duplicating it.',
        'When running tests, report what passed, what failed, the error output for failing tests, and the coverage delta when measurable.',
        FREEFORM_TDD_POLICY.testing,
      ].join(' '),
      skills: [],
      completionCriteria: {
        rubric: [
          'Match the existing test framework, naming, fixtures, assertions, and test granularity.',
          'Make each new or changed test prove the requested behavior, including a failing-before-fix signal when practical.',
          'Report the exact commands, pass/fail result, relevant counts, and measurable coverage change.',
        ],
      },
      builtIn: true,
    },
    {
      id: 'docs-writer',
      name: 'Documentation Writer',
      role: 'technical documentation specialist',
      description: 'Writes and maintains README files, API docs, JSDoc/TSDoc comments, wiki pages, guides, changelogs, and inline documentation. Inspects the codebase before writing to match existing style and verifies code snippets against the implementation.',
      primaryRoutingNeeds: ['docs', 'release'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s technical documentation specialist.',
        'Focus on README files, API reference docs, JSDoc/TSDoc comments, wiki pages, guides, changelogs, and inline code documentation.',
        'Always inspect the relevant source files before writing documentation so that signatures, types, and examples match the current implementation.',
        'Match the existing documentation style, tone, and structure of the project rather than imposing a new format.',
        'Keep documentation accurate, concise, and example-driven. Prefer short code snippets over long prose explanations.',
        'When updating a changelog or release notes, include only what actually changed — no padding, no generic phrases.',
        FREEFORM_TDD_POLICY.docs,
      ].join(' '),
      skills: [],
      completionCriteria: {
        rubric: [
          'Align every documented signature, command, behavior, and example with inspected implementation evidence.',
          'Update every project-required companion document, changelog, or mirror triggered by the change.',
          'Run available documentation, link, snippet, or build validation and report the result.',
        ],
      },
      builtIn: true,
    },
    {
      id: 'performance-analyst',
      name: 'Performance Analyst',
      role: 'performance and optimization specialist',
      description: 'Profiles, diagnoses, and resolves performance bottlenecks — CPU hot paths, memory leaks, unnecessary re-renders, slow queries, high latency, and throughput issues. Uses workspace evidence before recommending changes and measures impact afterward.',
      primaryRoutingNeeds: ['performance'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s performance and optimization specialist.',
        'Focus on CPU hot paths, memory leaks, unnecessary allocations, slow queries, high latency, low throughput, and related efficiency problems.',
        'Gather observable evidence (profiling data, benchmark output, timing logs, heap snapshots) before proposing a fix — never optimize from assumption alone.',
        'Prefer the narrowest targeted change that addresses the measured bottleneck over broad structural rewrites.',
        'After a change, verify the improvement is observable with a before/after measurement or explain why direct measurement is not practical.',
        'When the workspace lacks profiling tooling, instrument the hot path minimally using the available terminal and test runners to produce comparable timing evidence.',
        FREEFORM_TDD_POLICY.performance,
      ].join(' '),
      skills: [],
      completionCriteria: {
        rubric: [
          'Capture a reproducible baseline or profiling observation before claiming a bottleneck.',
          'Tie the narrowest proposed or implemented change directly to the measured hot path.',
          'Provide comparable after-change evidence, or state why measurement is unavailable without claiming improvement.',
        ],
      },
      builtIn: true,
    },
    {
      id: 'devops-engineer',
      name: 'DevOps Engineer',
      role: 'devops and infrastructure specialist',
      description: 'Manages CI/CD pipelines, GitHub Actions and other workflow YAML, Dockerfiles, Docker Compose, Kubernetes manifests, Terraform/Bicep IaC, deployment configs, and environment setup. Understands blast radius of infra changes and validates before applying.',
      primaryRoutingNeeds: ['devops', 'build'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s DevOps and infrastructure specialist.',
        'Handle CI/CD pipelines, GitHub Actions workflows, Dockerfiles, Docker Compose files, Kubernetes manifests, Terraform and Bicep infrastructure-as-code, deployment scripts, and environment configuration.',
        'Inspect the existing pipeline, container, or infrastructure configuration thoroughly before proposing changes to understand the current flow, triggers, and environment assumptions.',
        'Always state the blast radius of an infrastructure change — which environments, services, or deployments are affected — before making it.',
        'For pipeline changes, validate the affected job logic, trigger conditions, and secret references before pushing.',
        'Prefer incremental, rollback-safe changes over wide rewrites; call out any step that cannot be easily reversed.',
        FREEFORM_TDD_POLICY.devops,
      ].join(' '),
      skills: [],
      completionCriteria: {
        rubric: [
          'State the affected environments, services, data, and rollback path for a material infrastructure change.',
          'Validate changed syntax, triggers, job dependencies, configuration references, and secret names without exposing secret values.',
          'Report the exact build, lint, plan, dry-run, or health-check evidence used before handoff.',
        ],
      },
      builtIn: true,
    },
    {
      id: 'dependency-manager',
      name: 'Dependency Manager',
      role: 'dependency and package management specialist',
      description: 'Handles npm, pip, cargo, yarn, pnpm, and other package manager tasks — updates, vulnerability fixes, peer conflict resolution, lockfile hygiene, and dependency audits. Runs tests after updates to catch regressions.',
      primaryRoutingNeeds: ['package'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s dependency and package management specialist.',
        'Handle package installation, updates, vulnerability remediation, peer dependency conflict resolution, lockfile hygiene, and dependency audits across npm, pip, cargo, yarn, pnpm, and similar ecosystems.',
        'Before updating a dependency, check the changelog or release notes for breaking changes and note any migration steps required.',
        'After updating, run the test suite to surface regressions; if tests are unavailable, verify that affected imports and initialization paths work correctly.',
        'When resolving peer conflicts, prefer the version range that satisfies the most dependents rather than forcing a single version that might break others.',
        'Flag any dependency with a known vulnerability or abandoned maintenance status rather than silently keeping it.',
        FREEFORM_TDD_POLICY.dependency,
      ].join(' '),
      skills: [],
      completionCriteria: {
        rubric: [
          'Inspect current constraints, compatibility, maintenance/security status, and relevant release notes before choosing a version.',
          'Keep manifest and lockfile changes minimal and complete any required migration in the same pass.',
          'Run the relevant install, audit, build, and test checks and report unresolved advisories or compatibility risk.',
        ],
      },
      builtIn: true,
    },
    {
      id: 'seo-specialist',
      name: 'SEO Specialist',
      role: 'seo, llmo, geo, aeo and aio discoverability specialist',
      description: 'Handles technical SEO, LLMO (Large Language Model Optimisation), GEO (Generative Engine Optimisation), AEO (Answer Engine Optimisation), AIO (AI Overview Optimisation), multi-surface discoverability, Schema.org structured data, Core Web Vitals as ranking signals, and platform-specific optimisation. Works at the intersection of code, content strategy, and how search engines and AI systems discover, understand, rank, and cite content.',
      primaryRoutingNeeds: ['seo'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s SEO and content discoverability specialist.',
        'Identify the project type, target audience, and actual public discovery surfaces before applying web, marketplace, repository, package-registry, or documentation-site advice.',
        'Inspect the rendered or generated content, metadata, crawl controls, structured data, internal links, performance evidence, and listing fields relevant to the request before changing them.',
        'Use the specialist-guidance skill to load only the task-relevant SEO checklist. Treat search features, crawler behavior, supported markup, limits, and performance thresholds as time-sensitive; verify material claims with current primary sources.',
        'Optimize for accurate discovery and useful, attributable answers across search and AI-assisted surfaces without keyword stuffing, fabricated schema values, unsupported statistics, or claims of guaranteed ranking or citation.',
        'Keep recommendations proportional to the project and validate implementation with the project build plus the applicable live, crawler, structured-data, performance, or platform checks when available.',
        FREEFORM_TDD_POLICY.seo,
      ].join(' '),
      skills: [],
      completionCriteria: {
        rubric: [
          'Identify the project\'s real discovery surfaces, target audience or query intent, and the task-relevant specialist-guidance topic.',
          'Ground each material finding in inspected page, repository, listing, or measurement evidence.',
          'Verify time-sensitive platform claims with current primary sources and use no fabricated structured-data or authority signals.',
          'Report the applicable build, crawl, schema, performance, link, or listing validation result.',
        ],
      },
      builtIn: true,
    },
    {
      id: 'ux-consultant',
      name: 'UX Consultant',
      role: 'ux design and accessible ui implementation specialist',
      description: 'Reviews and generates professional-quality, fully accessible UI surfaces. Detects the project\'s design stack (VS Code webview, React + Tailwind/shadcn, Material UI, etc.) and applies platform-appropriate best practices. Full accessibility — keyboard, screen reader, colour-blind modes, light/dark/high-contrast themes, reduced motion, touch, and text scaling — is a non-negotiable baseline in every output. Does not create graphic assets.',
      primaryRoutingNeeds: ['frontend'],
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s UX design and accessible UI implementation specialist.',
        'Treat accessibility and responsive behavior as design inputs, not a final polish pass.',
        'Inspect the project\'s framework, component library, design tokens, nearby UI, and complete user flow before critiquing or implementing a surface. Reuse existing primitives and introduce no new dependency without a demonstrated need.',
        'Use the specialist-guidance skill to load only the task-relevant accessibility, responsive-layout, interaction-design, or UI-implementation checklist. Verify time-sensitive standards and platform requirements against current primary documentation.',
        'Distinguish verified usability or accessibility failures from preferences, explain user impact, and keep recommendations proportional to the requested outcome.',
        'For implementation work, deliver complete semantics and interaction states, preserve keyboard and assistive-technology behavior, use content-driven responsive layouts, and verify representative themes, widths, zoom, motion, error, loading, and empty states as applicable.',
        'Do not create image, icon, logo, or raster/vector graphic assets — direct asset creation to a specialist image-generation tool.',
        FREEFORM_TDD_POLICY.ux,
      ].join(' '),
      skills: [],
      completionCriteria: {
        rubric: [
          'Identify the project\'s design stack, reused primitives/tokens, complete user flow, and the task-relevant specialist-guidance topic.',
          'Provide evidence for semantics, keyboard/focus behavior, accessible names/states, announcements, contrast or color independence, zoom/reflow, and motion where applicable.',
          'Verify representative narrow, intermediate, and wide or constrained states without imposing unrelated breakpoint conventions.',
          'Report the relevant component, interaction, accessibility, build, and practical visual checks performed.',
        ],
      },
      builtIn: true,
    },
    {
      id: 'memory-agent',
      name: 'Memory Agent',
      role: 'session context and SSOT memory manager',
      description:
        'Internal background worker for per-session context files and project SSOT snippets. ' +
        'Never handles a user chat turn — MemoryAgentExecutor supplies its own per-call system prompt and reads only this definition\'s allowedModels. ' +
        'Configure allowedModels to pin memory maintenance to a local LLM (e.g. an Ollama model) to avoid cloud costs.',
      systemPrompt: [
        IMMUTABLE_GUARDRAILS,
        'You are AtlasMind\'s internal memory-maintenance worker, not a conversational agent.',
        'This definition exists so memory maintenance can be pinned to a specific model via allowedModels. MemoryAgentExecutor supplies the real system prompt for each maintenance operation.',
        'If you are ever selected for a user-facing task, do not attempt it. Say that memory maintenance runs in the background, and name the specialist agent that should handle the request instead.',
        'When you do produce memory content: concise factual markdown only. No timestamps, no metadata, no preamble. Compress aggressively near character limits and preserve recency over history.',
        'Never write a secret, credential, token, key, or personal identifier into memory. Summarise around it and note that a redacted value exists at that location.',
      ].join('\n\n'),
      skills: ['memory-query', 'file-read', 'directory-list'],
      builtIn: true,
      autoUpdateExcluded: true,
      skillsAutoManaged: false,
    },
];

export function registerBuiltInAgents(agentRegistry: AgentRegistry): void {
  for (const agent of BUILTIN_AGENT_DEFAULTS) {
    agentRegistry.register(agent);
  }
}

export function seedDefaultProviders(modelRouter: ModelRouter): void {
  const defaults: ProviderConfig[] = [
    {
      id: 'claude-cli',
      displayName: 'Claude Code CLI (chat only)',
      apiKeySettingKey: 'atlasmind.provider.claude-cli.apiKey',
      enabled: true,
      pricingModel: 'subscription',
      models: [
        {
          id: 'claude-cli/sonnet',
          provider: 'claude-cli',
          name: 'Claude Sonnet (Beta)',
          contextWindow: 200000,
          inputPricePer1k: 0,
          outputPricePer1k: 0,
          capabilities: ['chat', 'code', 'reasoning'],
          enabled: true,
        },
      ],
    },
    {
      id: 'anthropic',
      displayName: 'Anthropic',
      apiKeySettingKey: 'atlasmind.provider.anthropic.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'anthropic/claude-sonnet-4-20250514',
          provider: 'anthropic',
          name: 'Claude Sonnet 4',
          contextWindow: 200000,
          inputPricePer1k: 0.003,
          outputPricePer1k: 0.015,
          capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'openai',
      displayName: 'OpenAI',
      apiKeySettingKey: 'atlasmind.provider.openai.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'openai/gpt-4.1',
          provider: 'openai',
          name: 'GPT-4.1',
          contextWindow: 1000000,
          inputPricePer1k: 0.002,
          outputPricePer1k: 0.008,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
        {
          id: 'openai/gpt-4.1-mini',
          provider: 'openai',
          name: 'GPT-4.1 Mini',
          contextWindow: 1000000,
          inputPricePer1k: 0.0004,
          outputPricePer1k: 0.0016,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
        {
          id: 'openai/gpt-4.1-nano',
          provider: 'openai',
          name: 'GPT-4.1 Nano',
          contextWindow: 1000000,
          inputPricePer1k: 0.0001,
          outputPricePer1k: 0.0004,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
        {
          id: 'openai/gpt-4o',
          provider: 'openai',
          name: 'GPT-4o',
          contextWindow: 128000,
          inputPricePer1k: 0.0025,
          outputPricePer1k: 0.01,
          capabilities: ['chat', 'code', 'vision', 'function_calling'],
          enabled: true,
        },
        {
          id: 'openai/gpt-4o-mini',
          provider: 'openai',
          name: 'GPT-4o Mini',
          contextWindow: 128000,
          inputPricePer1k: 0.00015,
          outputPricePer1k: 0.0006,
          capabilities: ['chat', 'code', 'vision', 'function_calling'],
          enabled: true,
        },
        {
          id: 'openai/o4-mini',
          provider: 'openai',
          name: 'o4-mini',
          contextWindow: 200000,
          inputPricePer1k: 0.0011,
          outputPricePer1k: 0.0044,
          capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
          enabled: true,
        },
        {
          id: 'openai/o3',
          provider: 'openai',
          name: 'o3',
          contextWindow: 200000,
          inputPricePer1k: 0.01,
          outputPricePer1k: 0.04,
          capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'zai',
      displayName: 'z.ai (GLM)',
      apiKeySettingKey: 'atlasmind.provider.zai.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'zai/glm-4.7-flash',
          provider: 'zai',
          name: 'GLM-4.7 Flash (Free)',
          contextWindow: 128000,
          inputPricePer1k: 0,
          outputPricePer1k: 0,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'deepseek',
      displayName: 'DeepSeek',
      apiKeySettingKey: 'atlasmind.provider.deepseek.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'deepseek/deepseek-chat',
          provider: 'deepseek',
          name: 'DeepSeek V3',
          contextWindow: 128000,
          inputPricePer1k: 0.00027,
          outputPricePer1k: 0.0011,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'mistral',
      displayName: 'Mistral',
      apiKeySettingKey: 'atlasmind.provider.mistral.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'mistral/mistral-small-latest',
          provider: 'mistral',
          name: 'Mistral Small',
          contextWindow: 128000,
          inputPricePer1k: 0.0002,
          outputPricePer1k: 0.0006,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'google',
      displayName: 'Google Gemini',
      apiKeySettingKey: 'atlasmind.provider.google.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'google/gemini-2.0-flash',
          provider: 'google',
          name: 'Gemini 2.0 Flash',
          contextWindow: 1000000,
          inputPricePer1k: 0.0001,
          outputPricePer1k: 0.0004,
          capabilities: ['chat', 'code', 'vision', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'azure',
      displayName: 'Azure OpenAI',
      apiKeySettingKey: 'atlasmind.provider.azure.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [],
    },
    {
      id: 'bedrock',
      displayName: 'Amazon Bedrock',
      apiKeySettingKey: 'atlasmind.provider.bedrock.accessKeyId',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [],
    },
    {
      id: 'xai',
      displayName: 'xAI',
      apiKeySettingKey: 'atlasmind.provider.xai.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'xai/grok-4',
          provider: 'xai',
          name: 'Grok 4',
          contextWindow: 2000000,
          inputPricePer1k: 0.002,
          outputPricePer1k: 0.01,
          capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'cohere',
      displayName: 'Cohere',
      apiKeySettingKey: 'atlasmind.provider.cohere.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'cohere/command-a-03-2025',
          provider: 'cohere',
          name: 'Command A',
          contextWindow: 256000,
          inputPricePer1k: 0.0025,
          outputPricePer1k: 0.01,
          capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'perplexity',
      displayName: 'Perplexity',
      apiKeySettingKey: 'atlasmind.provider.perplexity.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'perplexity/sonar',
          provider: 'perplexity',
          name: 'Sonar',
          contextWindow: 128000,
          inputPricePer1k: 0.001,
          outputPricePer1k: 0.001,
          capabilities: ['chat', 'reasoning'],
          enabled: true,
        },
      ],
    },
    {
      id: 'huggingface',
      displayName: 'Hugging Face Inference',
      apiKeySettingKey: 'atlasmind.provider.huggingface.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'huggingface/Qwen/Qwen2.5-Coder-32B-Instruct:novita',
          provider: 'huggingface',
          name: 'Qwen2.5 Coder 32B Instruct',
          contextWindow: 128000,
          inputPricePer1k: 0.0006,
          outputPricePer1k: 0.0018,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'nvidia',
      displayName: 'NVIDIA NIM',
      apiKeySettingKey: 'atlasmind.provider.nvidia.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'nvidia/nvidia/llama-3.3-nemotron-super-49b-v1',
          provider: 'nvidia',
          name: 'Llama 3.3 Nemotron Super 49B',
          contextWindow: 128000,
          inputPricePer1k: 0.0004,
          outputPricePer1k: 0.0004,
          capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
          reasoningDepth: 2,
          enabled: true,
        },
        {
          id: 'nvidia/nvidia/llama-3.1-nemotron-nano-8b-v1',
          provider: 'nvidia',
          name: 'Nemotron Nano',
          contextWindow: 128000,
          inputPricePer1k: 0.0001,
          outputPricePer1k: 0.0001,
          capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
          reasoningDepth: 2,
          enabled: true,
        },
        {
          id: 'nvidia/meta/llama-3.1-70b-instruct',
          provider: 'nvidia',
          name: 'Llama 3.1 70B Instruct',
          contextWindow: 128000,
          inputPricePer1k: 0.0009,
          outputPricePer1k: 0.0009,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    // ── Aggregators & fast-inference ───────────────────────────────
    {
      id: 'openrouter',
      displayName: 'OpenRouter',
      apiKeySettingKey: 'atlasmind.provider.openrouter.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [],
    },
    {
      id: 'groq',
      displayName: 'Groq',
      apiKeySettingKey: 'atlasmind.provider.groq.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'groq/llama-3.3-70b-versatile',
          provider: 'groq',
          name: 'Llama 3.3 70B',
          contextWindow: 131072,
          inputPricePer1k: 0.00059,
          outputPricePer1k: 0.00079,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'together',
      displayName: 'Together AI',
      apiKeySettingKey: 'atlasmind.provider.together.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'together/meta-llama/Llama-3.3-70B-Instruct-Turbo',
          provider: 'together',
          name: 'Llama 3.3 70B Turbo',
          contextWindow: 131072,
          inputPricePer1k: 0.00088,
          outputPricePer1k: 0.00088,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'fireworks',
      displayName: 'Fireworks AI',
      apiKeySettingKey: 'atlasmind.provider.fireworks.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct',
          provider: 'fireworks',
          name: 'Llama 3.3 70B',
          contextWindow: 131072,
          inputPricePer1k: 0.0009,
          outputPricePer1k: 0.0009,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    // ── Regional cloud providers ────────────────────────────────────
    {
      id: 'qwen',
      displayName: 'Qwen (Alibaba Cloud)',
      apiKeySettingKey: 'atlasmind.provider.qwen.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'qwen/qwen-plus',
          provider: 'qwen',
          name: 'Qwen Plus',
          contextWindow: 131072,
          inputPricePer1k: 0.0004,
          outputPricePer1k: 0.0012,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'moonshot',
      displayName: 'Moonshot AI (Kimi)',
      apiKeySettingKey: 'atlasmind.provider.moonshot.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'moonshot/moonshot-v1-32k',
          provider: 'moonshot',
          name: 'Moonshot v1 32K',
          contextWindow: 32768,
          inputPricePer1k: 0.00069,
          outputPricePer1k: 0.00069,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'yi',
      displayName: '01.AI (Yi)',
      apiKeySettingKey: 'atlasmind.provider.yi.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'yi/yi-large',
          provider: 'yi',
          name: 'Yi Large',
          contextWindow: 32768,
          inputPricePer1k: 0.0003,
          outputPricePer1k: 0.0003,
          capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'minimax',
      displayName: 'MiniMax',
      apiKeySettingKey: 'atlasmind.provider.minimax.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'minimax/abab6.5s-chat',
          provider: 'minimax',
          name: 'MiniMax abab6.5s',
          contextWindow: 245760,
          inputPricePer1k: 0.00014,
          outputPricePer1k: 0.00014,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'local',
      displayName: 'Local Model',
      apiKeySettingKey: 'atlasmind.provider.local.apiKey',
      enabled: true,
      pricingModel: 'free',
      models: [
        {
          id: 'local/echo-1',
          provider: 'local',
          name: 'Local Echo',
          contextWindow: 8000,
          inputPricePer1k: 0,
          outputPricePer1k: 0,
          capabilities: ['chat'],
          enabled: true,
        },
      ],
    },
    {
      id: 'copilot',
      displayName: 'GitHub Copilot',
      apiKeySettingKey: 'atlasmind.provider.copilot.apiKey',
      enabled: true,
      pricingModel: 'subscription',
      models: [
        {
          id: 'copilot/default',
          provider: 'copilot',
          name: 'Copilot Chat Model',
          contextWindow: 128000,
          inputPricePer1k: 0,
          outputPricePer1k: 0,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
      subscriptionQuota: {
        totalRequests: 300,
        remainingRequests: 300,
        costPerRequestUnit: 0.033,
      },
    },
  ];

  for (const provider of defaults) {
    modelRouter.registerProvider(provider);
  }
}
