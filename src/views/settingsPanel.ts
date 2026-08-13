import * as path from 'node:path';
import * as os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as vscode from 'vscode';
import { decodeLocalEndpointModelId, getConfiguredLocalEndpoints, inferLocalEndpointLabel, type LocalEndpointConfig } from '../providers/index.js';
import { probeGpuDevices } from '../providers/gpuProbe.js';
import { getLocalModelRecommendationCandidates, type LocalRecommendationWorkloadTag } from '../providers/localModelRecommendationRegistry.js';
import { getCachedLocalModelCatalog } from '../providers/localModelCatalogSync.js';
import { RECOMMENDED_MCP_SERVERS, getRecommendedMcpStarterDetails } from '../constants.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';
import { scanAiInstructionFiles, syncAiInstructionFiles } from '../utils/aiInstructionSync.js';
import { syncTestingProtocols, readWorkflowGuidanceInput } from '../utils/testingProtocolSync.js';
import { scaffoldTestingFramework, scaffoldableMethodologies, type FirstTestCandidate } from '../core/testingScaffolder.js';
import { readProjectTestingConfig, TESTING_CONFIG_SSOT_PATH } from '../core/testingConfigLoader.js';
import { IMMUTABLE_GUARDRAILS } from '../core/orchestrator.js';
import type { ArdDiscoveredResource, ArdDiscoveryEndpoint, ProjectTestingConfig } from '../types.js';
import { getDisplayCurrency, getExchangeRate } from '../core/currencyFormatter.js';
import { isLocalSyncStale, LOCAL_MODEL_SYNC_CACHE_KEY, syncLocalModels, type LocalModelSyncResult } from '../providers/localModelSync.js';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../types.js';
import { COMPLIANCE_EVIDENCE_DIR, deriveTestingPolicyCoverage, parseJUnitReport, type TestingPolicyCoverage, type TestingPolicyTestFile } from '../core/testingPolicyCoverage.js';
import { assessTestingMethodologies, type ProjectTestingEvidence } from '../core/testingAutoAssess.js';
import { deriveTestingPolicyDetails, type TestingPolicyDetailSet } from '../core/testingPolicyDetail.js';
import { detectProjectArchetype } from '../core/projectArchetype.js';
import { parseAgentBindings } from '../core/buzzAgentBindings.js';
import { parseCustomDebtMarkers } from '../core/debtRegister.js';
import { inspectLensDeclarations, lensDeclarationStatusLabel } from '../core/lensDeclarations.js';
import {
  modelSidebarHiddenEntryKey,
  readHiddenModelSidebarEntries,
  restoreModelSidebarEntry,
  type ModelSidebarHiddenEntry,
} from './modelSidebarVisibility.js';

const execFileAsync = promisify(execFile);

const BUDGET_MODES = ['cheap', 'balanced', 'expensive', 'auto'] as const;
const SPEED_MODES = ['fast', 'balanced', 'considered', 'auto'] as const;
const BUDGET_MODE_HELP = {
  cheap: 'Excludes expensive model tiers and strongly favors the lowest-cost eligible options. Best for quick edits, light investigation, and scratchpad work where cost matters more than peak capability.',
  balanced: 'Keeps a practical middle ground between price and capability. This is the safest day-to-day default for most coding, debugging, and review work.',
  expensive: 'Allows the full model catalog, including the highest-cost tiers, so AtlasMind can spend more freely on difficult reasoning, architecture, or migration tasks.',
  auto: 'Lets the task profiler infer the budget level from the current request. Use this when your workload swings between quick fixes and deeper analysis.',
} as const;
const SPEED_MODE_HELP = {
  fast: 'Excludes slower reasoning-heavy routes and prefers lower-latency models. Best for tight feedback loops, short follow-ups, and rapid iteration.',
  balanced: 'Keeps a middle ground between responsiveness and reasoning depth. This is the most stable default when you want solid results without over-tuning.',
  considered: 'Allows slower, deeper reasoning routes and longer deliberation. Best for ambiguous debugging, design work, and other problems that benefit from more thought.',
  auto: 'Lets the task profiler infer the speed level from the current request. Use this when some tasks need instant turnaround and others need deeper reasoning.',
} as const;
const DEPENDENCY_MONITORING_PROVIDERS = ['dependabot', 'renovate', 'snyk', 'azure-devops'] as const;
const DEPENDENCY_MONITORING_SCHEDULES = ['daily', 'weekly', 'monthly'] as const;
const DISPLAY_CURRENCIES = ['auto', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'BRL', 'MXN', 'KRW', 'SEK', 'NOK', 'DKK', 'NZD', 'SGD', 'HKD', 'ZAR'] as const;
const DEFAULT_PROJECT_APPROVAL_FILE_THRESHOLD = 12;
const DEFAULT_ESTIMATED_FILES_PER_SUBTASK = 2;
const DEFAULT_CHANGED_FILE_REFERENCE_LIMIT = 5;
const DEFAULT_PROJECT_RUN_REPORT_FOLDER = 'project_memory/operations';
const TEST_SCAN_EXCLUDED_DIRS = new Set(['.git', '.next', '.turbo', 'coverage', 'dist', 'node_modules', 'out', 'project_memory']);
const TEST_FILE_NAME_PATTERN = /(?:^|[.-])(test|spec)\.[cm]?[jt]sx?$/i;
const TEST_CODE_EXT_PATTERN = /\.[cm]?[jt]sx?$/i;
const MAX_DISCOVERED_TEST_FILES = 200;
const MAX_DISCOVERED_TEST_CASES = 600;
const MAX_TEST_FILE_BYTES = 128_000;
const SETTINGS_HELP = {
  budgetMode: 'Budget preference for model selection. Examples: use cheap for scratchpad work, balanced for daily coding, expensive for architecture or migration work, and auto for mixed team workloads.',
  feedbackRoutingWeight: 'Controls how strongly saved thumbs up/down history nudges future model selection. Use 0 to disable feedback-weighted routing, 1 for the default slight influence, or values up to 2 for a somewhat stronger but still capped bias.',
  dailyCostLimitUsd: 'Daily cost cap in USD. Use 0 to disable it. Examples: 5 for an individual guardrail, 20 for a shared team budget, or 0 for unrestricted experimentation.',
  displayCurrency: 'Currency used for all cost displays. Auto detects from your OS locale. Examples: EUR for European teams, GBP for UK users, or JPY for Japan. Underlying costs are always stored in USD; exchange rates are fetched at startup with a 24-hour cache.',
  speedMode: 'Speed preference for model selection. Examples: fast for tight feedback loops, balanced for normal work, considered for deeper reasoning, and auto when workloads vary.',
  showImportProjectAction: 'Controls whether the Memory toolbar keeps the Import Existing Project action visible. Keep it on during onboarding and turn it off in already standardized repos.',
  chatSessionTurnLimit: 'How many recent chat turns AtlasMind carries forward. Examples: 4 for short task chats, 6 for the default balance, or 10 when long debugging context matters.',
  chatSessionContextChars: 'Maximum characters reserved for summarized carry-forward context. Examples: 1200 for lightweight carry-forward, 2500 for default use, or 4000+ for complex multi-step work.',
  localOpenAiBaseUrl: 'Legacy single-endpoint fallback for local OpenAI-compatible routing. AtlasMind now prefers the structured local endpoint list when it is present.',
  localOpenAiEndpoints: 'Configure one or more labeled local OpenAI-compatible endpoints. Examples: Ollama at http://127.0.0.1:11434/v1 and LM Studio at http://127.0.0.1:1234/v1. Labels are shown back in provider surfaces so operators can tell which engine owns each routed model.',
  toolApprovalMode: 'Main approval policy for tool execution. Examples: always-ask for regulated repos, ask-on-write for normal coding, ask-on-external for tighter network boundaries, or allow-safe-readonly for investigation-only work.',
  allowTerminalWrite: 'Allows write-capable terminal subprocesses after approval. Enable it in a sandbox where installs and commits are expected, and keep it off where terminal mutations require separate controls.',
  acpToolsEnabled: 'Lets an agent reached over the Agent Client Protocol — your Claude or ChatGPT subscription — run its own tools without a prompt for every operation. Off by default: the agent answers questions but cannot act. When enabled, AtlasMind automatically answers each request with a one-operation grant and records it; it never accepts the agent\'s persistent "always allow" option.',
  autoVerifyAfterWrite: 'Runs configured verification scripts after successful workspace writes. Enable it for immediate lint or test feedback, or disable it when validation happens elsewhere.',
  autoVerifyScripts: 'Comma-separated package script names AtlasMind runs after writes. Examples: test, lint, compile or test:unit, test:manifest, typecheck.',
  autoVerifyTimeoutMs: 'Maximum time per verification script in milliseconds. Examples: 30000 for fast local checks, 120000 for mixed lint or test workflows, or 300000 for slower pipelines.',
  instructionsVerifyOnCommit: 'Refuses a commit when an AtlasMind-managed block in an AI instruction file no longer matches the document it was generated from. Verify only — it never edits a file, so the commit you staged is the commit that lands. Covers the blocks generated from files (the testing matrix and the workflow); the debt-marker block comes from a setting a git hook cannot read, so it is left unchecked rather than guessed at. Saved to workspace settings, because a hook cannot see a User-scoped value.',
  voiceTtsEnabled: 'Automatically speak AtlasMind freeform responses aloud through the configured voice backend. Keep it off for silent text-only work or enable it for hands-free review and accessibility workflows.',
  voiceRate: 'Speech playback rate for text-to-speech output. Use lower values for careful listening and higher values when reviewing long responses quickly.',
  voicePitch: 'Speech playback pitch for text-to-speech output. Adjust this for comfort and intelligibility rather than correctness.',
  voiceVolume: 'Speech playback volume for text-to-speech output. Set 0 to stay muted while keeping TTS enabled for quick toggling.',
  voiceLanguage: 'BCP 47 language tag for speech synthesis and recognition, such as en-US or fr-FR. Leave it empty to use the browser or OS default language.',
  voiceOutputDeviceId: 'Preferred speaker device id for supported voice backends. Leave it empty to use the system default output device.',
  projectApprovalFileThreshold: 'Estimated changed-file threshold that triggers /project approval gating. Examples: 6 in small repos, 12 as a default balance, or 20+ in monorepos where broader edits are normal.',
  projectEstimatedFilesPerSubtask: 'Heuristic multiplier used to estimate changed files from planned subtasks. Examples: 1 for isolated modules, 2 for typical services, or 3 to 4 for layered shared platforms.',
  projectChangedFileReferenceLimit: 'Maximum number of changed files surfaced as clickable references after /project runs. Examples: 3 for compact summaries, 5 for default use, or 10 for review-heavy workflows.',
  projectRunReportFolder: 'Workspace-relative folder for persisted /project run summary JSON reports. Examples: project_memory/operations, docs/atlasmind/runs, or ops/atlasmind/run-reports.',
  projectDependencyMonitoringEnabled: 'Controls whether AtlasMind bootstrapping scaffolds dependency monitoring defaults for Atlas-built projects. Turn it on for team templates and off when governance is provisioned elsewhere.',
  projectDependencyMonitoringProviders: 'Selects which dependency monitoring providers AtlasMind scaffolds. Examples: Dependabot for GitHub-native repos, Renovate for advanced grouping, Snyk for security-led review, or Azure DevOps for pipeline-centric teams.',
  projectDependencyMonitoringSchedule: 'Default cadence for generated dependency monitoring automation. Examples: daily for security-sensitive services, weekly for normal review cycles, or monthly for stable products.',
  projectDependencyMonitoringIssueTemplate: 'Adds a dependency review issue template during governance scaffolding. Keep it on when updates need formal review or compliance evidence, and off for lightweight personal repos.',
  buzzEnabled: 'Master switch for the Buzz integration. Off by default: nothing connects, reads, or sends until you turn it on. Every other Buzz setting is inert while this is off.',
  buzzRelayUrl: 'The Buzz relay to connect to. Defaults to a local, self-hosted relay (ws://localhost:3000). A hosted relay must be encrypted (wss://) and additionally requires Allow remote relay.',
  buzzAllowRemoteRelay: 'Permits the relay URL to point off-machine. Leave it off to keep project communications on a loopback relay. Turning it on means project data leaves this machine, under the same redaction boundary AtlasMind applies to any external send.',
  buzzInboundEnabled: 'Hold a read-only subscription to the relay and derive work items from Buzz activity. The subscription can never publish to Buzz. Requires the master switch, and an agent key when the relay demands authentication.',
  buzzInboundChannels: 'Which Buzz channels to watch, one channel id per line. Leave it empty and the subscription is scoped only by message kind, so it covers every channel your agent key can already read. List channels to narrow it.',
  buzzAutoCreateFollowUps: 'Records derived follow-ups into project_memory/, which is git-tracked. Off by default and deliberately separate from the subscription switch, so watching a channel never starts committing records about colleagues by itself. Message bodies are never stored — only a follow-up and a pointer back to the thread.',
  buzzAgentBindings: 'Routes work from a given Buzz identity to a chosen AtlasMind agent. Edited per person on the Project Dashboard → Director tab, or by hand here. A local routing preference only: Buzz still owns the keypair and directory.',
  experimentalSkillLearningEnabled: 'Enables Atlas-generated custom skill drafts. Keep it off in production workspaces and enable it only in sandboxes where generated artifacts will be manually reviewed.',
  maxToolIterations: 'Maximum tool-call loop iterations before AtlasMind stops and surfaces Continue and Cancel actions. Examples: 10 for conservative environments, 20 for the default balance, or 25 for complex multi-step workflows. Higher values allow deeper automation but increase latency and cost.',
  loopEnabled: 'Enable the autonomous goal-seeking Mission Loop (the /loop chat command and Mission Control). When off, AtlasMind will not start any looping run.',
  loopDefaultMaxIterations: 'Default hard cap on Mission Loop iterations before the loop stops regardless of progress. Examples: 3 for a quick scoped task, 8 for the default balance, or 15 for a larger multi-step effort.',
  loopDefaultMaxCostUsd: 'Default hard ceiling, in USD, on the cumulative cost of one Mission Loop run. Enforced before each iteration on top of the daily cost limit. Examples: 1 for a tight cap, 5 for the default balance, or 20 for a larger sanctioned run.',
  loopDefaultMaxTokens: 'Default hard ceiling on cumulative input+output tokens across a Mission Loop run. Examples: 300000 for a small task, 2000000 for the default balance, or 5000000 for a large effort.',
  loopDefaultMaxDurationMinutes: 'Default hard wall-clock cap, in minutes, for a Mission Loop run. The loop stops at the next iteration boundary once this is exceeded. Examples: 10 for a short supervised run, 30 for the default balance, or 120 for a long unattended run.',
  loopMaxConsecutiveNoProgress: 'Stop the Mission Loop after this many consecutive iterations the goal evaluator judges as making no measurable progress. Examples: 1 to fail fast, 2 for the default balance, or 3 to give the loop more room to recover.',
  loopCheckpointEveryNIterations: 'Pause the Mission Loop for a deny-by-default approval checkpoint every N iterations. Use 0 to disable cadence checkpoints. Examples: 1 to approve every iteration, 3 for the default balance, or 5 for fewer interruptions.',
  loopCheckpointAtBudgetFraction: 'Pause for an approval checkpoint the first time cumulative spend crosses this fraction (0.01–1) of the cost budget. Examples: 0.5 to check in early, 0.75 for the default balance, or 0.9 to check in only near the cap.',
  loopRequireApprovalBeforeWriteBatches: 'Require an approval checkpoint before any Mission Loop iteration expected to write files or commit. Strongest safety posture; most interruptive.',
  loopAllowDiscovery: 'Allow the Mission Loop to fill capability gaps by synthesizing new agents/skills and using Agentic Resource Discovery. New capabilities always pass the existing approval gates; the loop prefers already-registered capabilities first.',
  loopGoalAchievedConfidenceThreshold: 'Minimum goal-evaluator confidence (0–1) required to accept an "achieved" verdict and stop the loop successfully. Below this the loop keeps iterating, so a low-confidence evaluator can never falsely declare success. Examples: 0.6 to stop more readily, 0.7 for the default balance, or 0.85 to demand high certainty.',
} as const;

type BudgetMode = (typeof BUDGET_MODES)[number];
type SpeedMode = (typeof SPEED_MODES)[number];
type DependencyMonitoringProvider = (typeof DEPENDENCY_MONITORING_PROVIDERS)[number];
type DependencyMonitoringSchedule = (typeof DEPENDENCY_MONITORING_SCHEDULES)[number];
type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];
type SettingsHelpId = keyof typeof SETTINGS_HELP;

export interface TestingFileSummary {
  relativePath: string;
  category: 'unit' | 'integration' | 'e2e' | 'other';
  suites: number;
  cases: number;
  lastModifiedLabel: string;
}

export interface TestingCaseSummary {
  status: 'unknown' | 'passing' | 'failing' | 'incomplete';
  id: string;
  title: string;
  suiteTitle: string;
  relativePath: string;
  category: 'unit' | 'integration' | 'e2e' | 'other';
  line: number;
  description: string;
  inputSummary: string;
  outputSummary: string;
}

export interface TestingDashboardCategoryCount {
  key: 'unit' | 'integration' | 'e2e' | 'other';
  label: string;
  count: number;
}

export interface TestingDashboardSnapshot {
  frameworkLabel: string;
  testingPolicyLabel: string;
  testingPolicyDetail: string;
  totalFiles: number;
  totalSuites: number;
  totalCases: number;
  unitFiles: number;
  integrationFiles: number;
  e2eFiles: number;
  averageCasesPerFile: string;
  coveragePercent?: string;
  coverageDetail: string;
  packageScripts: string[];
  configFiles: string[];
  coverageReportRelativePath?: string;
  coverageDataRelativePath?: string;
  files: TestingFileSummary[];
  tests: TestingCaseSummary[];
  categoryCounts: TestingDashboardCategoryCount[];
  verificationEnabled: boolean;
  verificationScripts: string[];
  /** Project-level methodology configuration read from testing-config.json. */
  projectTestingConfig: import('../types.js').ProjectTestingConfig | undefined;
  /** Agents available for methodology assignment. */
  availableAgentSummaries: Array<{ id: string; name: string }>;
  /**
   * The shared methodology catalogue, carried to the Project Dashboard so it
   * can explain a protocol with the same wording as Settings rather than keep
   * a second, labels-only copy that inevitably drifts.
   */
  methodologyDefinitions: import('../types.js').TestingMethodologyDefinition[];
  /**
   * The evidence `policyCoverage` was derived from.
   *
   * Carried so a caller can ask the same question about methodologies that are
   * switched *off* — the coverage rows only cover enabled ones, so a project
   * quietly practising something it never declared is invisible without this.
   * Re-scanning the workspace to find out would be a second walk producing a
   * second answer.
   */
  policyEvidence?: {
    testFiles: import('../core/testingPolicyCoverage.js').TestingPolicyTestFile[];
    dependencies: string[];
    scripts: string[];
    configFiles: string[];
  };
  /**
   * Per-enabled-policy evidence: what has tests, what has none, and what is
   * failing according to the project's own test report. See
   * {@link ../core/testingPolicyCoverage.ts}.
   */
  policyCoverage: TestingPolicyCoverage;
  /**
   * Per-policy severity, drafts and chart data.
   *
   * Derived here beside the coverage it grades, so the Testing page and the
   * Settings page cannot disagree about how bad a policy's state is.
   */
  policyDetails: TestingPolicyDetailSet;
}

interface LocalHardwareSnapshot {
  cpuModel: string;
  cpuThreads: number;
  ramGb: number;
  gpus: Array<{ name: string; vramGb?: number }>;
}

interface LocalModelRecommendationItem {
  modelFamily: string;
  recommendedTag: string;
  status: 'installed' | 'recommended';
  /** Actual model ID of the installed instance — used for remove operations. */
  installedModelId?: string;
  /** Runtime the model is installed in — determines which remove/manage action to show. */
  installedRuntime?: 'ollama' | 'lmstudio';
  fitScore: number;
  rationale: string[];
  installHint: string;
}

interface InstalledLocalModelItem {
  runtime: 'ollama' | 'lmstudio';
  modelId: string;
  displayName: string;
  removable: boolean;
}

interface LocalModelRecommendationPayload {
  generatedAt: string;
  hardware: LocalHardwareSnapshot;
  recentlyUsedModels: Array<{ model: string; requests: number }>;
  recentlyUsedFamilies: Array<{ family: string; requests: number }>;
  recommendations: LocalModelRecommendationItem[];
  installedModels: InstalledLocalModelItem[];
}

/**
 * Every settings page, in nav order.
 *
 * The order is grouped in the sequence someone actually configures the
 * extension: what it can do (Capabilities), how it talks to you (Interaction),
 * what it is allowed to do (Guardrails), how far it may run alone (Autonomy),
 * then opt-in extras. The previous order was the sequence the pages were added
 * — Resource Discovery, which is how you *add* a capability, sat last, four
 * pages away from Models & Integrations, and AI Instructions sat between
 * Experimental and Resource Discovery rather than beside Chat.
 *
 * The nav markup below is grouped to match; this list is the canonical order
 * and the source of `SettingsPageId`.
 */
export const SETTINGS_PAGE_IDS = ['overview', 'agents', 'models', 'discovery', 'mcp', 'buzz', 'chat', 'ai-instructions', 'safety', 'testing', 'project', 'loop', 'experimental'] as const;
export type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[number];
export interface SettingsPanelTarget {
  page?: SettingsPageId;
  query?: string;
  section?: string;
}

type SettingsMessage =
  | { type: 'setBudgetMode'; payload: BudgetMode }
  | { type: 'setSpeedMode'; payload: SpeedMode }
  | { type: 'setFeedbackRoutingWeight'; payload: number }
  | { type: 'setLocalOpenAiBaseUrl'; payload: string }
  | { type: 'setLocalOpenAiEndpoints'; payload: LocalEndpointConfig[] }
  | { type: 'setDailyCostLimitUsd'; payload: number }
  | { type: 'setDisplayCurrency'; payload: DisplayCurrency }
  | { type: 'setShowImportProjectAction'; payload: boolean }
  | { type: 'setToolApprovalMode'; payload: 'always-ask' | 'ask-on-write' | 'ask-on-external' | 'allow-safe-readonly' }
  | { type: 'setAllowTerminalWrite'; payload: boolean }
  | { type: 'setAcpToolsEnabled'; payload: boolean }
  | { type: 'setAcpHideConsoleWindows'; payload: boolean }
  | { type: 'setAutoVerifyAfterWrite'; payload: boolean }
  | { type: 'setAutoVerifyScripts'; payload: string }
  | { type: 'setAutoVerifyTimeoutMs'; payload: number }
  | { type: 'setBuzzEnabled'; payload: boolean }
  | { type: 'setBuzzRelayUrl'; payload: string }
  | { type: 'setBuzzAllowRemoteRelay'; payload: boolean }
  | { type: 'setBuzzInboundEnabled'; payload: boolean }
  | { type: 'setBuzzInboundChannels'; payload: string }
  | { type: 'setBuzzAutoCreateFollowUps'; payload: boolean }
  // Named rather than a generic "run this command id": the webview boundary is
  // untrusted, and an allowlist of two is one by construction.
  | { type: 'openBuzzAgentKey' }
  | { type: 'openDirectorRoster' }
  | { type: 'openBuzzGuide' }
  | { type: 'fetchBuzzChannels' }
  | { type: 'setMcpServerEnabled'; payload: { id: string; enabled: boolean } }
  | { type: 'connectMcpServer'; payload: string }
  | { type: 'disconnectMcpServer'; payload: string }
  | { type: 'openMcpManager' }
  | { type: 'setVoiceTtsEnabled'; payload: boolean }
  | { type: 'setInstructionsVerifyOnCommit'; payload: boolean }
  | { type: 'setVoiceRate'; payload: number }
  | { type: 'setVoicePitch'; payload: number }
  | { type: 'setVoiceVolume'; payload: number }
  | { type: 'setVoiceLanguage'; payload: string }
  | { type: 'setVoiceOutputDeviceId'; payload: string }
  | { type: 'setChatSessionTurnLimit'; payload: number }
  | { type: 'setChatSessionContextChars'; payload: number }
  | { type: 'setProjectApprovalFileThreshold'; payload: number }
  | { type: 'setProjectEstimatedFilesPerSubtask'; payload: number }
  | { type: 'setProjectChangedFileReferenceLimit'; payload: number }
  | { type: 'setProjectRunReportFolder'; payload: string }
  | { type: 'setProjectDependencyMonitoringEnabled'; payload: boolean }
  | { type: 'setProjectDependencyMonitoringProviders'; payload: DependencyMonitoringProvider[] }
  | { type: 'setProjectDependencyMonitoringSchedule'; payload: DependencyMonitoringSchedule }
  | { type: 'setProjectDependencyMonitoringIssueTemplate'; payload: boolean }
  | { type: 'setExperimentalSkillLearningEnabled'; payload: boolean }
  | { type: 'setMaxToolIterations'; payload: number }
  | { type: 'setLoopEnabled'; payload: boolean }
  | { type: 'setLoopDefaultMaxIterations'; payload: number }
  | { type: 'setLoopDefaultMaxCostUsd'; payload: number }
  | { type: 'setLoopDefaultMaxTokens'; payload: number }
  | { type: 'setLoopDefaultMaxDurationMinutes'; payload: number }
  | { type: 'setLoopMaxConsecutiveNoProgress'; payload: number }
  | { type: 'setLoopCheckpointEveryNIterations'; payload: number }
  | { type: 'setLoopCheckpointAtBudgetFraction'; payload: number }
  | { type: 'setLoopRequireApprovalBeforeWriteBatches'; payload: boolean }
  | { type: 'setLoopAllowDiscovery'; payload: boolean }
  | { type: 'setLoopGoalAchievedConfidenceThreshold'; payload: number }
  | { type: 'purgeProjectMemory' }
  | { type: 'openChatView' }
  | { type: 'openChatPanel' }
  | { type: 'openAgentPanel' }
  | { type: 'openPersonalityProfile' }
  | { type: 'openModelProviders' }
  | { type: 'restoreModelSidebarEntry'; payload: string }
  | { type: 'openSpecialistIntegrations' }
  | { type: 'openProjectRunCenter' }
  | { type: 'setupLensDeclarations' }
  | { type: 'openLensDashboard' }
  | { type: 'openCompareModels' }
  | { type: 'openVoicePanel' }
  | { type: 'openVisionPanel' }
  | { type: 'chooseAcpConsoleMode' }
  | { type: 'openChat' }
  | { type: 'recommendLocalModels' }
  | { type: 'installRecommendedLocalModel'; payload: { runtime: 'ollama' | 'lmstudio'; modelTag: string } }
  | { type: 'removeInstalledLocalModel'; payload: { runtime: 'ollama' | 'lmstudio'; modelId: string } }
  | { type: 'refreshTestingInventory' }
  | { type: 'createTestFile' }
  | { type: 'openCoverageReport' }
  | { type: 'openWorkspaceFile'; payload: string }
  | { type: 'scanAiInstructions' }
  | { type: 'syncAiInstructions'; payload: string[] }
  | { type: 'alignAiInstructions' }
  | { type: 'saveTestingConfig'; payload: import('../types.js').ProjectTestingConfig }
  | { type: 'autoAssessTestingConfig' }
  | { type: 'syncTestingProtocols' }
  | { type: 'scaffoldTestingFramework' }
  | { type: 'ardSearch'; payload: { query: string; typeFilter?: string } }
  | { type: 'ardFetchManifest'; payload: { url: string } }
  | { type: 'ardInstall'; payload: { identifier: string } }
  | { type: 'ardToggleFinder'; payload: { id: string; enabled: boolean } }
  | { type: 'ardRemoveFinder'; payload: { id: string } }
  | { type: 'ardAddFinder'; payload: { name: string; url: string; kind: string; insecure: boolean } }
  | { type: 'ardExportCatalog' };

/**
 * A deliberately bounded first-test brief. It names evidence AtlasMind
 * observed, rather than claiming that an arbitrary example test is coverage.
 * The test-authoring agent can decline without changing files if the candidate
 * is not a stable, observable behaviour after inspection.
 */
export function buildFirstTestAuthoringPrompt(
  candidate: FirstTestCandidate,
  config: ProjectTestingConfig,
): string {
  const enabledLabels = config.methodologies
    .filter(methodology => methodology.enabled)
    .map(methodology => TESTING_METHODOLOGY_DEFINITIONS.find(definition => definition.id === methodology.id)?.label ?? methodology.id);
  const protocols = enabledLabels.length > 0 ? enabledLabels.join(', ') : 'the project default testing policy';
  return [
    'Author exactly one focused, codebase-specific first automated test after AtlasMind scaffolds the testing strategy.',
    '',
    `The project already exposes ${candidate.exportedSymbol} from \`${candidate.sourcePath}\` and has ${candidate.testRunner} configured.`,
    `Follow the enabled testing protocols: ${protocols}. The same protocols have just been synchronised into the detected AI instruction files.`,
    '',
    'First inspect that source module and the existing test conventions. Write one smallest meaningful test for an observed, stable behaviour of that module only if it can run in the existing test setup.',
    'Do not count a generic scaffold sample as project coverage. Do not install dependencies, edit package manifests or runner configuration, change production source, make network calls, or add a speculative test.',
    'If the target has no clear, stable, safely testable behaviour, make no file changes and explain why. Respect every AtlasMind approval request before writing or running anything.',
  ].join('\n');
}

/**
 * Settings webview panel – budget/speed modes plus /project execution controls.
 */
export class SettingsPanel {
  public static currentPanel: SettingsPanel | undefined;
  private static readonly viewType = 'atlasmind.settings';
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionVersion: string;
  private initialTarget?: SettingsPanelTarget;
  private disposables: vscode.Disposable[] = [];
  private readonly extensionContext: vscode.ExtensionContext;
  private readonly atlasContext?: import('../extension').AtlasMindContext;
  // Lazily created output channel for streaming local-model install progress/errors
  // (shared by the LM Studio `lms get` and Ollama `/api/pull` install flows).
  private localModelInstallChannel?: vscode.OutputChannel;
  // Resource Discovery (ARD) tab state. Search results persist in the ARD registry
  // (getRecentResults/setRecentResults); only transient view state lives here.
  private ardStatus?: { kind: 'info' | 'success' | 'warning' | 'error'; text: string };
  private ardBusy = false;
  private ardLastQuery = '';

  public static createOrShow(context: vscode.ExtensionContext, target?: SettingsPageId | SettingsPanelTarget, atlasContext?: import('../extension').AtlasMindContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const normalizedTarget = normalizeSettingsPanelTarget(target);

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(column);
      if (normalizedTarget.page || normalizedTarget.query || normalizedTarget.section) {
        void SettingsPanel.currentPanel.retarget(normalizedTarget);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      'AtlasMind Settings',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    const extensionVersion = String(context.extension.packageJSON?.version ?? 'unknown');
    SettingsPanel.currentPanel = new SettingsPanel(panel, normalizedTarget, extensionVersion, context, atlasContext);
  }

  private constructor(panel: vscode.WebviewPanel, initialTarget: SettingsPanelTarget | undefined, extensionVersion: string, context: vscode.ExtensionContext, atlasContext?: import('../extension').AtlasMindContext) {
    this.panel = panel;
    this.initialTarget = initialTarget;
    this.extensionVersion = extensionVersion;
    this.extensionContext = context;
    this.atlasContext = atlasContext;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      message => {
        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );

    void this.migrateLegacyLocalOpenAiSettings();
  }

  private dispose(): void {
    SettingsPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private async retarget(target: SettingsPanelTarget): Promise<void> {
    this.initialTarget = target;
    this.panel.webview.html = this.getHtml();
    await this.migrateLegacyLocalOpenAiSettings();
  }

  private async migrateLegacyLocalOpenAiSettings(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const migratedEndpoints = await migrateLegacyLocalOpenAiSettings(configuration);
    if (!migratedEndpoints || migratedEndpoints.length === 0) {
      return;
    }

    await this.panel.webview.postMessage({
      type: 'syncLocalOpenAiEndpoints',
      payload: migratedEndpoints,
    });
  }

  // ── Resource Discovery (ARD) tab ─────────────────────────────────────────
  // Mirrors the standalone ARD panel's behavior, hosted inside the Settings
  // dashboard so discovery shares its chrome and lives "within" Settings. Each
  // action re-renders the panel with the discovery tab kept active, matching the
  // full-rebuild pattern the rest of the Settings panel already uses.

  private async handleArdMessage(message: SettingsMessage): Promise<void> {
    const atlas = this.atlasContext;
    if (!atlas?.ardRegistry || !atlas.ardClient || !atlas.ardInstaller) {
      this.ardStatus = { kind: 'error', text: 'Resource Discovery services are not available.' };
      this.rerenderDiscovery();
      return;
    }
    const registry = atlas.ardRegistry;

    switch (message.type) {
      case 'ardSearch':
        await this.ardRunSearch(message.payload.query, message.payload.typeFilter);
        break;
      case 'ardFetchManifest':
        await this.ardRunManifestFetch(message.payload.url);
        break;
      case 'ardInstall':
        await this.ardRunInstall(message.payload.identifier);
        break;
      case 'ardToggleFinder':
        registry.setEnabled(message.payload.id, message.payload.enabled);
        this.ardStatus = { kind: 'info', text: `Finder ${message.payload.enabled ? 'enabled' : 'disabled'}.` };
        break;
      case 'ardRemoveFinder':
        registry.remove(message.payload.id);
        this.ardStatus = { kind: 'info', text: 'Finder removed.' };
        break;
      case 'ardAddFinder':
        this.ardRunAddFinder(message.payload);
        break;
      case 'ardExportCatalog':
        await vscode.commands.executeCommand('atlasmind.ard.exportCatalog');
        this.ardStatus = { kind: 'info', text: 'Catalog export started — see the save dialog.' };
        break;
      default:
        return;
    }

    this.rerenderDiscovery();
    atlas.discoveryRefresh?.fire();
  }

  /** Re-render the panel, keeping the Resource Discovery tab active. */
  private rerenderDiscovery(): void {
    this.initialTarget = { page: 'discovery' };
    this.panel.webview.html = this.getHtml();
  }

  private async ardRunSearch(rawQuery: string, typeFilter?: string): Promise<void> {
    const atlas = this.atlasContext!;
    const query = rawQuery.trim();
    if (!query) {
      this.ardStatus = { kind: 'warning', text: 'Enter a search query.' };
      return;
    }
    const endpoints = atlas.ardRegistry!.listEnabled();
    if (endpoints.length === 0) {
      this.ardStatus = { kind: 'warning', text: 'No Agent Finders are enabled. Enable one below before searching.' };
      return;
    }

    this.ardLastQuery = query;
    this.ardBusy = true;
    this.rerenderDiscovery();

    const filter = typeFilter && typeFilter.trim() ? { type: [typeFilter.trim()] } : undefined;
    const { results, errors } = await atlas.ardClient!.searchEndpoints(endpoints, query, filter ? { filter } : {});
    this.ardBusy = false;
    atlas.ardRegistry!.setRecentResults(results);
    this.ardStatus = results.length > 0
      ? { kind: 'success', text: `Found ${results.length} result(s) for "${query}".${errors.length ? ` ${errors.length} finder(s) errored.` : ''}` }
      : { kind: 'warning', text: `No results for "${query}".${errors.length ? ` ${errors.map(e => `${e.endpoint}: ${e.message}`).join('; ')}` : ''}` };
  }

  private async ardRunManifestFetch(rawUrl: string): Promise<void> {
    const atlas = this.atlasContext!;
    const url = rawUrl.trim();
    if (!url) {
      this.ardStatus = { kind: 'warning', text: 'Enter a manifest or origin URL.' };
      return;
    }
    this.ardBusy = true;
    this.rerenderDiscovery();
    try {
      const catalog = await atlas.ardClient!.fetchCatalog(url);
      this.ardLastQuery = url;
      const mapped: ArdDiscoveredResource[] = catalog.entries.map(entry => ({
        identifier: entry.identifier,
        displayName: entry.displayName,
        type: entry.type,
        ...(entry.url ? { url: entry.url } : {}),
        ...(entry.data ? { data: entry.data } : {}),
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.capabilities ? { capabilities: entry.capabilities } : {}),
        ...(entry.tags ? { tags: entry.tags } : {}),
        ...(entry.trustManifest ? { trustManifest: entry.trustManifest } : {}),
        sourceName: catalog.host?.displayName ?? 'Manifest',
      }));
      atlas.ardRegistry!.setRecentResults(mapped);
      this.ardStatus = { kind: 'success', text: `Loaded ${mapped.length} entr(ies) from the manifest.` };
    } catch (error) {
      this.ardStatus = { kind: 'error', text: `Manifest fetch failed: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      this.ardBusy = false;
    }
  }

  private async ardRunInstall(identifier: string): Promise<void> {
    const atlas = this.atlasContext!;
    const resource = atlas.ardRegistry!.getRecentResults().find(r => r.identifier === identifier);
    if (!resource) {
      this.ardStatus = { kind: 'error', text: 'That result is no longer available — search again.' };
      return;
    }
    try {
      const result = await atlas.ardInstaller!.install(resource);
      this.ardStatus = { kind: result.ok ? 'success' : 'warning', text: result.message };
      if (result.kind === 'mcp-server') {
        void vscode.window.showInformationMessage(result.message, 'Open MCP Servers').then(choice => {
          if (choice === 'Open MCP Servers') {
            void vscode.commands.executeCommand('atlasmind.openMcpServers');
          }
        });
      }
    } catch (error) {
      this.ardStatus = { kind: 'error', text: `Install failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private ardRunAddFinder(payload: { name: string; url: string; kind: string; insecure: boolean }): void {
    const name = payload.name.trim();
    const url = payload.url.trim();
    const kind = payload.kind === 'manifest' ? 'manifest' : 'registry';
    if (!name || !url) {
      this.ardStatus = { kind: 'warning', text: 'A finder needs both a name and a URL.' };
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      this.ardStatus = { kind: 'warning', text: 'Finder URL must start with https:// (or http:// for a trusted local registry).' };
      return;
    }
    this.atlasContext!.ardRegistry!.add({ name, url, kind, enabled: false, insecure: payload.insecure });
    this.ardStatus = { kind: 'success', text: `Added "${name}" as a disabled finder. Enable it to search.` };
  }

  private buildArdPage(): string {
    const registry = this.atlasContext?.ardRegistry;
    if (!registry) {
      return `
        <div class="page-header">
          <p class="page-kicker">Resource Discovery</p>
          <h2>Discover agentic resources</h2>
          <p>Resource Discovery is unavailable because AtlasMind's core services did not finish starting up.</p>
        </div>`;
    }
    const finders = registry.list();
    const results = registry.getRecentResults();
    const enabledCount = finders.filter(f => f.enabled).length;
    const status = this.ardStatus
      ? `<p class="ard-status ard-status-${escapeHtml(this.ardStatus.kind)}">${escapeHtml(this.ardStatus.text)}</p>`
      : '';

    return `
      <div class="page-header">
        <p class="page-kicker">Resource Discovery</p>
        <h2>Discover agentic resources <span class="badge">ARD</span></h2>
        <p>Find external MCP servers, agents, skills, and APIs via <a href="https://github.com/ards-project/ard-spec">Agentic Resource Discovery</a>. Discovery happens before invocation; nothing is installed without your action. ${enabledCount} of ${finders.length} finder(s) enabled.</p>
      </div>

      ${status}

      <div class="page-grid">
        <article class="settings-card">
          <div class="card-header">
            <p class="card-kicker">Search</p>
            <h3>Query enabled Agent Finders</h3>
          </div>
          <form id="ardSearchForm" class="ard-form">
            <input id="ardSearchQuery" type="search" placeholder="Describe a capability, e.g. &quot;book a flight&quot;" value="${escapeHtml(this.ardLastQuery)}" />
            <input id="ardTypeFilter" type="text" placeholder="Optional type filter (e.g. application/mcp-server+json)" />
            <button type="submit" class="primary-button">${this.ardBusy ? 'Searching…' : 'Search'}</button>
          </form>
          <details>
            <summary>Fetch a manifest by URL</summary>
            <form id="ardManifestForm" class="ard-form">
              <input id="ardManifestUrl" type="url" placeholder="https://example.com or https://example.com/.well-known/ai-catalog.json" />
              <button type="submit" class="secondary-button">Fetch</button>
            </form>
          </details>
        </article>

        <article class="settings-card">
          <div class="card-header">
            <p class="card-kicker">Results</p>
            <h3>Ranked candidates</h3>
          </div>
          <p class="info-note">The relevance score reflects query match only — it is <strong>not</strong> a trust, compliance, or safety rating. Review each resource before installing.</p>
          ${this.buildArdResults(results)}
        </article>

        <article class="settings-card">
          <div class="card-header">
            <p class="card-kicker">Agent Finders</p>
            <h3>Sources searched for resources</h3>
          </div>
          <p class="muted-line">Finders ship disabled. Enable one to allow outbound discovery searches.</p>
          ${this.buildArdFinders(finders)}
          <details>
            <summary>Add a finder</summary>
            <form id="ardAddFinderForm" class="ard-form">
              <input id="ardFinderName" type="text" placeholder="Name" />
              <input id="ardFinderUrl" type="url" placeholder="https://registry.example.com/search" />
              <select id="ardFinderKind">
                <option value="registry">Registry (POST /search)</option>
                <option value="manifest">Manifest (ai-catalog.json)</option>
              </select>
              <label class="ard-inline"><input id="ardFinderInsecure" type="checkbox" /> Allow http / localhost</label>
              <button type="submit" class="secondary-button">Add finder</button>
            </form>
          </details>
        </article>

        <article class="settings-card">
          <div class="card-header">
            <p class="card-kicker">Publish</p>
            <h3>Export this project's catalog</h3>
          </div>
          <p class="muted-line">Export AtlasMind's agents, skills, and MCP servers as a spec-conformant <code>ai-catalog.json</code> (system prompts, secrets, and env are never included).</p>
          <div class="button-stack">
            <button id="ardExportBtn" type="button" class="secondary-button">Export this project's catalog…</button>
          </div>
        </article>
      </div>`;
  }

  private buildArdResults(results: ArdDiscoveredResource[]): string {
    if (this.ardBusy) {
      return '<p class="muted-line">Searching enabled finders…</p>';
    }
    if (results.length === 0) {
      return '<p class="muted-line">No results yet. Run a search or fetch a manifest above.</p>';
    }
    return `<div class="ard-results">${results.map(r => this.buildArdResultCard(r)).join('')}</div>`;
  }

  private buildArdResultCard(r: ArdDiscoveredResource): string {
    const score = typeof r.score === 'number'
      ? `<span class="badge ard-score" title="Semantic relevance — not a trust rating">${r.score}/100</span>`
      : '';
    const trust = r.trustManifest
      ? `<span class="badge ard-trust" title="Publisher provided identity/attestation metadata (not verified by AtlasMind)">trust info</span>`
      : '';
    const caps = (r.capabilities ?? []).slice(0, 6).map(c => `<span class="ard-chip">${escapeHtml(c)}</span>`).join('');
    return `
      <div class="ard-result-card">
        <div class="ard-result-head">
          <strong>${escapeHtml(r.displayName)}</strong>
          <span class="badge ard-type">${escapeHtml(shortArdType(r.type))}</span>
          ${score}
          ${trust}
        </div>
        <div class="ard-result-meta">${escapeHtml(r.identifier)} · via ${escapeHtml(r.sourceName)}</div>
        ${r.description ? `<p class="ard-result-desc">${escapeHtml(truncateArd(r.description, 260))}</p>` : ''}
        ${caps ? `<div class="ard-chips">${caps}</div>` : ''}
        ${r.url ? `<div class="ard-result-url"><a href="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a></div>` : ''}
        <div class="button-stack">
          <button type="button" class="secondary-button" data-ard-install="${escapeHtml(r.identifier)}">Install</button>
        </div>
      </div>`;
  }

  private buildArdFinders(finders: ArdDiscoveryEndpoint[]): string {
    if (finders.length === 0) {
      return '<p class="muted-line">No finders configured.</p>';
    }
    return `<table class="ard-table">
      <thead><tr><th>Finder</th><th>Kind</th><th>Enabled</th><th></th></tr></thead>
      <tbody>
        ${finders.map(f => `
        <tr>
          <td><strong>${escapeHtml(f.name)}</strong><br /><span class="muted-line">${escapeHtml(f.url)}</span></td>
          <td>${escapeHtml(f.kind)}${f.insecure ? ' <span class="badge ard-warn">insecure</span>' : ''}</td>
          <td><label class="ard-inline"><input type="checkbox" data-ard-toggle-finder="${escapeHtml(f.id)}" ${f.enabled ? 'checked' : ''} /> ${f.enabled ? 'on' : 'off'}</label></td>
          <td>${f.builtIn ? '' : `<button type="button" class="link-button" data-ard-remove-finder="${escapeHtml(f.id)}">Remove</button>`}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  private async handleMessage(message: unknown): Promise<void> {
    // MCP server install message is not a standard settings message
    if (message && typeof message === 'object' && (message as any).type === 'installMcpServer') {
      await this.handleInstallMcpServer((message as any).payload);
      return;
    }
    if (!isSettingsMessage(message)) {
      return;
    }

    if (message.type.startsWith('ard')) {
      await this.handleArdMessage(message);
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    switch (message.type) {
      case 'setBudgetMode':
        await configuration.update('budgetMode', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setDailyCostLimitUsd':
        await configuration.update('dailyCostLimitUsd', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setDisplayCurrency':
        await configuration.update('displayCurrency', message.payload, vscode.ConfigurationTarget.Global);
        return;

      case 'restoreModelSidebarEntry': {
        const restored = await restoreModelSidebarEntry(this.extensionContext.globalState, message.payload);
        if (restored) {
          this.atlasContext?.modelsRefresh.fire();
          this.initialTarget = { page: 'models', section: 'modelSidebarVisibilityCard' };
          this.panel.webview.html = this.getHtml();
        }
        return;
      }

      case 'setSpeedMode':
        await configuration.update('speedMode', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setFeedbackRoutingWeight':
        await configuration.update('feedbackRoutingWeight', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setLocalOpenAiBaseUrl': {
        const normalized = normalizeLocalOpenAiBaseUrl(message.payload);
        if (!normalized) {
          return;
        }
        await configuration.update('localOpenAiBaseUrl', normalized, vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setLocalOpenAiEndpoints': {
        const normalized = normalizeLocalOpenAiEndpoints(message.payload);
        try {
          await configuration.update('localOpenAiEndpoints', normalized, vscode.ConfigurationTarget.Workspace);
          await configuration.update('localOpenAiBaseUrl', normalized[0]?.baseUrl ?? '', vscode.ConfigurationTarget.Workspace);
        } catch (error) {
          // Surface persistence failures instead of letting the fire-and-forget
          // message handler swallow them (e.g. no workspace folder is open).
          vscode.window.showErrorMessage(
            `AtlasMind could not save local endpoints: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return;
      }

      case 'setToolApprovalMode':
        await configuration.update('toolApprovalMode', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setShowImportProjectAction':
        await configuration.update('showImportProjectAction', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setAllowTerminalWrite':
        await configuration.update('allowTerminalWrite', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setAcpToolsEnabled':
        await configuration.update('acp.toolsEnabled', message.payload === true, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setAcpHideConsoleWindows':
        // Global, matching the guided picker: this is a property of the machine
        // and its endpoint security, not of the repository, and writing it to
        // the workspace would dirty `.vscode/settings.json` for everyone else.
        await configuration.update(
          'acp.hideConsoleWindows',
          message.payload === true,
          vscode.ConfigurationTarget.Global,
        );
        return;

      case 'setAutoVerifyAfterWrite':
        await configuration.update('autoVerifyAfterWrite', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setAutoVerifyScripts': {
        const scripts = message.payload
          .split(',')
          .map(value => value.trim())
          .filter(value => /^[A-Za-z0-9:_-]+$/.test(value));
        await configuration.update('autoVerifyScripts', scripts, vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setAutoVerifyTimeoutMs':
        await configuration.update('autoVerifyTimeoutMs', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setVoiceTtsEnabled':
        await configuration.update('voice.ttsEnabled', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setInstructionsVerifyOnCommit':
        // Workspace scope is required, not merely conventional: the pre-commit
        // hook reads `.vscode/settings.json` because it has no VS Code host, so
        // a User-scoped value would be a control that silently does nothing.
        await configuration.update('instructions.verifyOnCommit', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setVoiceRate':
        await configuration.update('voice.rate', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setVoicePitch':
        await configuration.update('voice.pitch', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setVoiceVolume':
        await configuration.update('voice.volume', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setVoiceLanguage':
        await configuration.update('voice.language', message.payload.trim(), vscode.ConfigurationTarget.Workspace);
        return;

      case 'setVoiceOutputDeviceId':
        await configuration.update('voice.outputDeviceId', message.payload.trim(), vscode.ConfigurationTarget.Workspace);
        return;

      case 'setChatSessionTurnLimit':
        await configuration.update('chatSessionTurnLimit', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setChatSessionContextChars':
        await configuration.update('chatSessionContextChars', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setProjectApprovalFileThreshold':
        await configuration.update('projectApprovalFileThreshold', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setProjectEstimatedFilesPerSubtask':
        await configuration.update('projectEstimatedFilesPerSubtask', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setProjectChangedFileReferenceLimit':
        await configuration.update('projectChangedFileReferenceLimit', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setBuzzEnabled':
        await configuration.update('buzz.enabled', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setBuzzRelayUrl': {
        const relayUrl = message.payload.trim();
        // Validate the shape at the boundary. The transport separately refuses
        // plaintext to a remote host; this only stops an unusable value being
        // stored, so a typo surfaces here rather than as a connection failure.
        if (relayUrl && !/^(wss?|https?):\/\/[^\s]+$/i.test(relayUrl)) {
          void vscode.window.showWarningMessage('Buzz relay URL must start with ws://, wss://, http:// or https://.');
          return;
        }
        await configuration.update('buzz.relayUrl', relayUrl, vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setBuzzAllowRemoteRelay':
        await configuration.update('buzz.allowRemoteRelay', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setBuzzInboundEnabled':
        await configuration.update('buzz.inboundEnabled', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setBuzzInboundChannels': {
        // One id per line. Blank lines are dropped rather than stored as empty
        // channel ids, and the list is capped so a paste cannot balloon it.
        const channels = message.payload
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line.length > 0 && line.length <= 200)
          .slice(0, 50);
        await configuration.update('buzz.inboundChannels', channels, vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setBuzzAutoCreateFollowUps':
        await configuration.update('buzz.autoCreateFollowUps', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'openBuzzAgentKey':
        await vscode.commands.executeCommand('atlasmind.setBuzzAgentKey');
        return;

      case 'openDirectorRoster':
        await vscode.commands.executeCommand('atlasmind.openProjectDirector');
        return;

      case 'setMcpServerEnabled': {
        const registry = this.atlasContext?.mcpServerRegistry;
        if (!registry) { return; }
        registry.updateServer(message.payload.id, { enabled: message.payload.enabled });
        // Disabling should actually stop the server, not just relabel it.
        if (!message.payload.enabled) {
          await registry.disconnectServer(message.payload.id).catch(() => undefined);
        }
        this.panel.webview.html = this.getHtml();
        return;
      }

      case 'connectMcpServer':
        await this.atlasContext?.mcpServerRegistry?.connectServer(message.payload).catch((error: unknown) => {
          void vscode.window.showWarningMessage(`Could not connect: ${error instanceof Error ? error.message : String(error)}`);
        });
        this.panel.webview.html = this.getHtml();
        return;

      case 'disconnectMcpServer':
        await this.atlasContext?.mcpServerRegistry?.disconnectServer(message.payload).catch(() => undefined);
        this.panel.webview.html = this.getHtml();
        return;

      case 'openMcpManager':
        // Adding, editing, and secret entry stay in the dedicated panel. Two
        // implementations of one flow drift, and the one that drifts is the one
        // nobody is looking at.
        await vscode.commands.executeCommand('atlasmind.openMcpServers');
        return;

      case 'fetchBuzzChannels':
        // Asks the Buzz CLI which channels exist and offers them to tick. The
        // only Buzz control here that writes a setting — and every part of that
        // write is the user's: this button, then the picker, then nothing at all
        // if they dismiss it. It touches the channel list only, never a gate.
        await vscode.commands.executeCommand('atlasmind.buzz.fetchChannels');
        return;

      case 'openBuzzGuide':
        // AtlasMind's own chat panel, not VS Code's. Routing through
        // `workbench.action.chat.open` put a Buzz question in front of Copilot's
        // participant picker and, because the slash command arrived as text,
        // straight into the general agent.
        await vscode.commands.executeCommand('atlasmind.buzz.openGuide');
        return;

      case 'setProjectRunReportFolder': {
        const folder = message.payload;
        // Reject paths that attempt directory traversal or use absolute paths
        if (/\.\.[\\/]/.test(folder) || /^[\\/]/.test(folder) || /^[A-Za-z]:/.test(folder)) {
          return;
        }
        await configuration.update('projectRunReportFolder', folder, vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setProjectDependencyMonitoringEnabled':
        await configuration.update('projectDependencyMonitoringEnabled', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setProjectDependencyMonitoringProviders':
        await configuration.update('projectDependencyMonitoringProviders', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setProjectDependencyMonitoringSchedule':
        await configuration.update('projectDependencyMonitoringSchedule', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setProjectDependencyMonitoringIssueTemplate':
        await configuration.update('projectDependencyMonitoringIssueTemplate', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setExperimentalSkillLearningEnabled': {
        if (message.payload) {
          const proceed = await vscode.window.showWarningMessage(
            'Experimental skill learning will spend model tokens and may generate unsafe or incorrect code. Generated skills are scanned, but they still require manual review before use. Enable anyway?',
            { modal: true },
            'Enable',
          );
          const enabled = proceed === 'Enable';
          if (enabled) {
            await configuration.update('experimentalSkillLearningEnabled', true, vscode.ConfigurationTarget.Workspace);
          }
          await this.panel.webview.postMessage({ type: 'syncExperimentalSkillLearningEnabled', payload: enabled });
          return;
        }

        await configuration.update('experimentalSkillLearningEnabled', false, vscode.ConfigurationTarget.Workspace);
        await this.panel.webview.postMessage({ type: 'syncExperimentalSkillLearningEnabled', payload: false });
        return;
      }

      case 'setMaxToolIterations': {
        const clamped = Math.max(1, Math.min(50, Math.round(message.payload)));
        await configuration.update('maxToolIterations', clamped, vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setLoopEnabled':
        await configuration.update('loop.enabled', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setLoopDefaultMaxIterations': {
        const clamped = Math.max(1, Math.min(50, Math.round(message.payload)));
        await configuration.update('loop.defaultMaxIterations', clamped, vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setLoopDefaultMaxCostUsd': {
        // The field is entered in the user's display currency; store USD-canonical.
        const rate = getExchangeRate(getDisplayCurrency());
        const usd = rate > 0 ? message.payload / rate : message.payload;
        await configuration.update('loop.defaultMaxCostUsd', Math.max(0.01, usd), vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setLoopDefaultMaxTokens':
        await configuration.update('loop.defaultMaxTokens', Math.max(1000, Math.round(message.payload)), vscode.ConfigurationTarget.Workspace);
        return;

      case 'setLoopDefaultMaxDurationMinutes':
        await configuration.update('loop.defaultMaxDurationMinutes', Math.max(1, Math.round(message.payload)), vscode.ConfigurationTarget.Workspace);
        return;

      case 'setLoopMaxConsecutiveNoProgress': {
        const clamped = Math.max(1, Math.min(10, Math.round(message.payload)));
        await configuration.update('loop.maxConsecutiveNoProgress', clamped, vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setLoopCheckpointEveryNIterations': {
        const clamped = Math.max(0, Math.min(50, Math.round(message.payload)));
        await configuration.update('loop.checkpointEveryNIterations', clamped, vscode.ConfigurationTarget.Workspace);
        return;
      }

      case 'setLoopCheckpointAtBudgetFraction':
        await configuration.update('loop.checkpointAtBudgetFraction', Math.max(0.01, Math.min(1, message.payload)), vscode.ConfigurationTarget.Workspace);
        return;

      case 'setLoopRequireApprovalBeforeWriteBatches':
        await configuration.update('loop.requireApprovalBeforeWriteBatches', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setLoopAllowDiscovery':
        await configuration.update('loop.allowDiscovery', message.payload, vscode.ConfigurationTarget.Workspace);
        return;

      case 'setLoopGoalAchievedConfidenceThreshold':
        await configuration.update('loop.goalAchievedConfidenceThreshold', Math.max(0, Math.min(1, message.payload)), vscode.ConfigurationTarget.Workspace);
        return;

      case 'purgeProjectMemory':
        await vscode.commands.executeCommand('atlasmind.purgeProjectMemory');
        return;

      case 'openModelProviders':
        await vscode.commands.executeCommand('atlasmind.openModelProviders');
        return;

      case 'openSpecialistIntegrations':
        await vscode.commands.executeCommand('atlasmind.openSpecialistIntegrations');
        return;

      case 'openChatView':
        await vscode.commands.executeCommand('atlasmind.openChatView');
        return;

      case 'openChatPanel':
        await vscode.commands.executeCommand('atlasmind.openChatPanel');
        return;

      case 'openAgentPanel':
        await vscode.commands.executeCommand('atlasmind.openAgentPanel');
        return;

      case 'openPersonalityProfile':
        await vscode.commands.executeCommand('atlasmind.openPersonalityProfile');
        return;

      case 'openProjectRunCenter':
        await vscode.commands.executeCommand('atlasmind.openProjectRunCenter');
        return;
      case 'openLensDashboard':
        await vscode.commands.executeCommand('atlasmind.lens.openDashboard');
        return;
      case 'setupLensDeclarations':
        await vscode.commands.executeCommand('atlasmind.lens.setupDeclarations');
        this.initialTarget = { page: 'project', section: 'lensDeclarationsCard' };
        this.panel.webview.html = this.getHtml();
        return;

      case 'openCompareModels':
        await vscode.commands.executeCommand('atlasmind.compareModels');
        return;

      case 'openVoicePanel':
        await vscode.commands.executeCommand('atlasmind.openVoicePanel');
        return;

      case 'openVisionPanel':
        await vscode.commands.executeCommand('atlasmind.openVisionPanel');
        return;

      case 'chooseAcpConsoleMode':
        // The picker writes whichever option is selected, so the checkbox on
        // this page can be out of date the moment it returns. Re-render rather
        // than leave two controls disagreeing about the same setting.
        await vscode.commands.executeCommand('atlasmind.acp.chooseConsoleMode');
        this.panel.webview.html = this.getHtml();
        return;

      case 'openChat':
        await vscode.commands.executeCommand('workbench.action.chat.open');
        return;

      case 'recommendLocalModels':
        await this.handleRecommendLocalModels();
        return;

      case 'installRecommendedLocalModel':
        await this.handleInstallRecommendedLocalModel(message.payload);
        return;

      case 'removeInstalledLocalModel':
        await this.handleRemoveInstalledLocalModel(message.payload);
        return;

      case 'refreshTestingInventory':
        this.panel.webview.html = this.getHtml();
        return;

      case 'createTestFile':
        await this.createTestFile();
        return;

      case 'openCoverageReport':
        await this.openCoverageReport();
        return;

      case 'saveTestingConfig':
        await this.saveTestingConfig(message.payload);
        return;

      // The three Testing-page actions repaint when they finish, whatever
      // happened.
      //
      // Each shows a busy label and disables its button on click, and each has
      // several early returns — no workspace, an unsaved matrix, a dismissed
      // picker, a declined confirmation. Auto-assess repainted only on its one
      // success path, so cancelling the quick pick left the button disabled and
      // reading "Assessing…" until the panel was closed and reopened, with
      // nothing on screen explaining why the control was dead.
      //
      // Repainting in a `finally` covers every path including a thrown one, and
      // it is one place rather than one per early return — which is what makes
      // it hold when the next early return is added.
      case 'autoAssessTestingConfig':
        try { await this.runAutoAssessTestingConfig(); }
        finally { this.panel.webview.html = this.getHtml(); }
        return;

      case 'syncTestingProtocols':
        try { await this.runSyncTestingProtocols(); }
        finally { this.panel.webview.html = this.getHtml(); }
        return;

      case 'scaffoldTestingFramework':
        try { await this.runScaffoldTestingFramework(); }
        finally { this.panel.webview.html = this.getHtml(); }
        return;

      case 'openWorkspaceFile':
        await this.openWorkspaceFile(message.payload);
        return;

      case 'scanAiInstructions':
        await this.handleScanAiInstructions();
        return;

      case 'syncAiInstructions':
        await this.handleSyncAiInstructions(message.payload);
        return;

      case 'alignAiInstructions':
        await this.handleAlignAiInstructions();
        return;
    }
  }

  private async handleInstallMcpServer(payload: unknown): Promise<void> {
    const candidate = payload && typeof payload === 'object'
      ? payload as { id?: unknown; name?: unknown; docsUrl?: unknown }
      : undefined;
    const name = typeof candidate?.name === 'string' && candidate.name.trim().length > 0
      ? candidate.name.trim()
      : 'Selected MCP server';
    const starter = typeof candidate?.id === 'string'
      ? getRecommendedMcpStarterDetails(candidate.id)
      : undefined;

    await vscode.commands.executeCommand('atlasmind.mcpServers.installRecommended', candidate);

    void this.panel.webview.postMessage({
      type: 'status',
      payload: starter?.setupMode === 'prefill'
        ? `${name} is being installed with its verified CLI preset. AtlasMind will also try to bootstrap the required local runtime automatically through a supported package manager on this operating system.`
        : `${name} still needs manual setup, so AtlasMind opened the MCP Add Server workspace with the audited starter details.`,
    });
  }

  private async openWorkspaceFile(relativePath: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    const resolved = resolveWorkspaceRelativePath(workspaceRoot, relativePath);
    if (!resolved || !existsSync(resolved)) {
      await vscode.window.showWarningMessage('That workspace file is no longer available.');
      return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private async handleScanAiInstructions(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      await this.panel.webview.postMessage({ type: 'aiInstructionScanResult', payload: [] });
      return;
    }
    const entries = scanAiInstructionFiles(workspaceRoot);
    await this.panel.webview.postMessage({ type: 'aiInstructionScanResult', payload: entries });
  }

  private async handleSyncAiInstructions(selectedPaths: unknown): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      await this.panel.webview.postMessage({
        type: 'aiInstructionSyncResult',
        payload: { success: false, summary: 'No workspace folder is open.' },
      });
      return;
    }

    if (!Array.isArray(selectedPaths) || selectedPaths.length === 0) {
      await this.panel.webview.postMessage({
        type: 'aiInstructionSyncResult',
        payload: { success: false, summary: 'No files selected.' },
      });
      return;
    }

    const result = await syncAiInstructionFiles(workspaceRoot, selectedPaths as string[]);
    await this.panel.webview.postMessage({ type: 'aiInstructionSyncResult', payload: result });
  }

  /**
   * Two-way alignment: hands off to the `/sync-instructions` chat command, which
   * reconciles every tool's instructions (plus AtlasMind's), raises any significant
   * conflicts for the user to resolve in chat, then mirrors the unified set back
   * into each tool's file. Conflict resolution lives in chat by design.
   */
  private async handleAlignAiInstructions(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      await this.panel.webview.postMessage({
        type: 'aiInstructionSyncResult',
        payload: { success: false, summary: 'Open a workspace folder first, then align instruction sets.' },
      });
      return;
    }
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: '@atlas /sync-instructions' });
    } catch {
      // Fallback: if the native chat cannot be opened, tell the user how to start it.
      await vscode.window.showInformationMessage(
        'Run "@atlas /sync-instructions" in the AtlasMind chat to align instruction sets across tools.',
      );
    }
  }

  private async createTestFile(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const target = workspaceRoot
      ? path.join(workspaceRoot, 'tests', 'new-feature.test.ts')
      : 'new-feature.test.ts';
    const scaffold = [
      "import { describe, expect, it } from 'vitest';",
      '',
      "describe('new feature', () => {",
      "  it('behaves as expected', () => {",
      '    expect(true).toBe(true);',
      '  });',
      '});',
      '',
    ].join('\n');

    const uri = vscode.Uri.parse(`untitled:${target.replace(/\\/g, '/')}`);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    if (document.getText().trim().length === 0) {
      await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(0, 0), scaffold);
      });
    }
  }

  private async openCoverageReport(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    const snapshot = collectTestingDashboardSnapshot(this.atlasContext);
    const reportRelativePath = snapshot.coverageReportRelativePath ?? snapshot.coverageDataRelativePath;
    const resolved = reportRelativePath ? resolveWorkspaceRelativePath(workspaceRoot, reportRelativePath) : undefined;
    if (!resolved || !existsSync(resolved)) {
      await vscode.window.showInformationMessage('No coverage report is available yet. Run your coverage script first.');
      return;
    }

    await vscode.env.openExternal(vscode.Uri.file(resolved));
  }

  private async saveTestingConfig(config: import('../types.js').ProjectTestingConfig): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }
    try {
      const { syncSummary } = await persistTestingConfig(
        workspaceRoot,
        config,
        this.atlasContext?.agentRegistry?.listAgents() ?? [],
      );
      if (syncSummary) {
        void vscode.window.showInformationMessage(`Testing strategy saved. ${syncSummary}`);
      }
      this.panel.webview.html = this.getHtml();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Failed to save testing configuration: ${detail}`);
    }
  }

  private async runSyncTestingProtocols(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      void vscode.window.showInformationMessage('No workspace open — open a folder first.');
      return;
    }
    const config = readProjectTestingConfig(workspaceRoot);
    if (!config) {
      void vscode.window.showInformationMessage('No testing configuration saved yet — save the Testing matrix first.');
      return;
    }
    const agents = this.atlasContext?.agentRegistry?.listAgents() ?? [];
    try {
      const result = await syncTestingProtocols(
        workspaceRoot,
        config,
        agents,
        parseCustomDebtMarkers(
          vscode.workspace.getConfiguration('atlasmind').get<string[]>('debt.markers', []),
        ),
        readWorkflowGuidanceInput(workspaceRoot),
      );
      if (result.success) {
        void vscode.window.showInformationMessage(result.summary);
      } else {
        void vscode.window.showWarningMessage(result.summary);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Failed to sync testing protocols: ${detail}`);
    }
  }

  private async runScaffoldTestingFramework(): Promise<void> {
    // The caller repaints in a `finally`, so this must not repaint again.
    await runTestingScaffoldWithSync(this.atlasContext);
  }

  /**
   * Turn a source candidate into one actual project test, rather than claiming
   * a generic sample proves anything. The candidate is deliberately narrow and
   * the agent is explicitly allowed to decline: syntactic exports are not proof
   * of a stable, observable behaviour. This call happens only after the
   * scaffold confirmation and the outbound instruction sync.
   */
  static async authorFirstScaffoldTestFor(
    atlasContext: import('../extension.js').AtlasMindContext | undefined,
    candidate: FirstTestCandidate,
    config: ProjectTestingConfig,
  ): Promise<string> {
    if (!atlasContext) {
      return 'The strategy and AI instruction files were prepared, but no live Atlas task runner is available to author the first test.';
    }
    const status = vscode.window.setStatusBarMessage(
      `AtlasMind is assessing ${candidate.sourcePath} for the first focused test…`,
    );
    try {
      const result = await atlasContext.orchestrator.processTask({
        id: `testing-scaffold-first-test-${Date.now()}`,
        userMessage: buildFirstTestAuthoringPrompt(candidate, config),
        context: {
          testingScaffold: true,
          firstTestCandidate: candidate,
          testingMethodologies: config.methodologies.filter(methodology => methodology.enabled).map(methodology => methodology.id),
        },
        constraints: { budget: 'auto', speed: 'balanced' },
        timestamp: new Date().toISOString(),
      });
      return `First-test task completed with ${result.agentId}; refresh the Testing Dashboard to review the result.`;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return `The first-test task could not run (${detail}); the strategy and agent instructions are still ready.`;
    } finally {
      status.dispose();
    }
  }

  private async runAutoAssessTestingConfig(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      void vscode.window.showInformationMessage('No workspace open — open a folder first.');
      return;
    }

    // Evidence the repository can already show, from the same coverage
    // derivation the Testing page renders — so what arrives ticked here and
    // what reads as *Tested* there are the same judgement.
    const snapshot = collectTestingDashboardSnapshot(this.atlasContext);
    const alreadyEvidenced = (snapshot.policyCoverage?.rows ?? [])
      .filter(row => row.status === 'covered' || row.status === 'tooling-only' || row.status === 'not-file-evident')
      .map(row => row.id);

    const gathered = await gatherTestingEvidence(workspaceRoot);

    // The shape is only allowed to *suppress* a policy when detection was
    // confident. `generic` reached by fallback is not a finding about this
    // project, and letting an unconfident guess withhold recommendations would
    // silently narrow the assessment for a reason the user never sees.
    const detection = detectProjectArchetype({
      corpus: [...gathered.dependencies, ...gathered.paths].join(' ').toLowerCase(),
      files: gathered.paths.map(p => p.toLowerCase()),
    });

    const assessment = assessTestingMethodologies({
      ...gathered,
      alreadyEvidenced,
      ...(detection.confident ? { archetype: detection.archetype, traits: detection.traits } : {}),
    });

    const inferred = assessment.policies;

    const modeChoice = await vscode.window.showQuickPick(
      [
        {
          label: '$(sparkle) Auto',
          description: assessment.summary,
          value: 'auto' as const,
        },
        {
          label: '$(list-unordered) Manual',
          description: `Choose from the full list of ${TESTING_METHODOLOGY_DEFINITIONS.length} methodologies`,
          value: 'manual' as const,
        },
        {
          label: '$(dash) Skip',
          description: 'Keep the current configuration unchanged',
          value: 'skip' as const,
        },
      ],
      { placeHolder: 'How should testing methodologies be selected?', ignoreFocusOut: true, title: 'Auto-Assess Testing Strategy' },
    );

    if (!modeChoice || modeChoice.value === 'skip') {
      return;
    }

    let selectedIds: import('../types.js').TestingMethodologyId[] | undefined;

    if (modeChoice.value === 'auto') {
      // Ticked where the *code* shows it; offered where only the prose mentions
      // it. Everything matching one flat corpus used to arrive ticked, and that
      // corpus included the README — so a project could have thirteen
      // methodologies switched on because of what its own marketing copy said
      // about it, and be left with eight permanent gaps nobody read as gaps.
      //
      // Nothing is hidden: a prose match is still listed and still one keystroke
      // away. It simply arrives as a proposal rather than as a decision already
      // taken on the user's behalf.
      const accepted = await vscode.window.showQuickPick(
        inferred.map(item => ({
          label: item.basis === 'discouraged' ? `$(circle-slash) ${item.label}` : item.label,
          description: item.reason,
          picked: item.recommended,
          id: item.id,
        })),
        {
          placeHolder: assessment.unassessed.length > 0
            ? `Ticked from the code. Could not read ${assessment.unassessed.join(', ')} — review before accepting`
            : 'Ticked from what the code shows. Tick anything else you intend to practise, then press Enter',
          canPickMany: true,
          ignoreFocusOut: true,
          title: 'Auto-Assessed Methodologies',
        },
      );
      if (accepted === undefined) { return; }
      selectedIds = accepted.map(p => p.id as import('../types.js').TestingMethodologyId);
    } else {
      const picked = await vscode.window.showQuickPick(
        TESTING_METHODOLOGY_DEFINITIONS.map(def => ({
          label: def.label,
          description: def.description,
          picked: def.id === 'tdd' || def.id === 'unit',
          id: def.id,
        })),
        {
          placeHolder: 'Select the testing methodologies for this project',
          canPickMany: true,
          ignoreFocusOut: true,
          title: 'Testing Methodologies',
        },
      );
      if (picked === undefined) { return; }
      selectedIds = picked.map(p => p.id as import('../types.js').TestingMethodologyId);
    }

    if (selectedIds.length === 0) {
      void vscode.window.showInformationMessage('No methodologies selected — configuration unchanged.');
      return;
    }

    const enabledIds = new Set(selectedIds);

    // Offer to assign a test-focused agent to all enabled methodologies.
    const agentAssignments = new Map<string, string>();
    const agents = this.atlasContext?.agentRegistry?.listAgents() ?? [];
    const testAgent = agents.find(a =>
      a.role?.toLowerCase().includes('test') || a.name?.toLowerCase().includes('test'),
    );
    if (testAgent && selectedIds.length > 0) {
      const assignChoice = await vscode.window.showInformationMessage(
        `Assign "${testAgent.name}" as the primary agent for all ${selectedIds.length} enabled methodolog${selectedIds.length === 1 ? 'y' : 'ies'}?`,
        'Yes, assign',
        'No, skip',
      );
      if (assignChoice === 'Yes, assign') {
        for (const id of selectedIds) {
          agentAssignments.set(id, testAgent.id);
        }
      }
    }

    // Merge with existing config to preserve notes/model overrides.
    const existing = readProjectTestingConfig(workspaceRoot);
    const savedMap = new Map(existing?.methodologies?.map(m => [m.id, m]) ?? []);
    const newConfig: import('../types.js').ProjectTestingConfig = {
      version: 1,
      updatedAt: new Date().toISOString(),
      methodologies: TESTING_METHODOLOGY_DEFINITIONS.map(def => {
        const prev = savedMap.get(def.id);
        return {
          ...prev,
          id: def.id,
          enabled: enabledIds.has(def.id),
          assignedAgentId: agentAssignments.get(def.id) ?? prev?.assignedAgentId,
        };
      }),
    };

    // Through the shared path, so auto-assess pushes the new matrix to the
    // external instruction files too. It previously wrote the file alone, which
    // is how a project could enable thirteen methodologies in one click and leave
    // every AI tool reading the old set.
    const { syncSummary } = await persistTestingConfig(
      workspaceRoot,
      newConfig,
      this.atlasContext?.agentRegistry?.listAgents() ?? [],
    );
    this.panel.webview.html = this.getHtml();
    void vscode.window.showInformationMessage(
      `Testing strategy updated: ${selectedIds.length} methodolog${selectedIds.length === 1 ? 'y' : 'ies'} active.${syncSummary ? ` ${syncSummary}` : ''}`,
    );
  }

  private async handleRecommendLocalModels(): Promise<void> {
    await this.panel.webview.postMessage({
      type: 'localModelRecommendationStatus',
      payload: 'Scanning local hardware and local model metadata...',
    });

    try {
      const payload = await buildLocalModelRecommendationPayload(this.extensionContext, this.atlasContext);
      await this.panel.webview.postMessage({ type: 'localModelRecommendationResult', payload });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.panel.webview.postMessage({
        type: 'localModelRecommendationStatus',
        payload: `Local model recommendation scan failed: ${detail}`,
      });
    }
  }

  private async handleInstallRecommendedLocalModel(
    payload: { runtime: 'ollama' | 'lmstudio'; modelTag: string },
  ): Promise<void> {
    const modelTag = payload.modelTag.trim();
    if (!modelTag) {
      return;
    }

    if (payload.runtime === 'lmstudio') {
      await this.handleInstallInLmStudio(modelTag);
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const { ollamaBaseUrl } = resolveRuntimeBaseUrls(configuration);
    // Ollama can pull GGUF models straight from HuggingFace via the "hf.co/" prefix;
    // the live catalog tags those candidates as "hf:owner/repo", which /api/pull rejects.
    const ollamaPullTarget = modelTag.startsWith('hf:')
      ? `hf.co/${modelTag.slice(3)}`
      : modelTag;

    // Preflight: a stopped daemon is the most common reason the pull "does nothing".
    if (!(await isOllamaReachable(ollamaBaseUrl))) {
      await this.panel.webview.postMessage({
        type: 'localModelRecommendationStatus',
        payload: `Ollama is not reachable at ${ollamaBaseUrl}. Start it (run \`ollama serve\` or launch the Ollama app), then click Install again.`,
      });
      return;
    }

    const channel = this.getLocalModelInstallChannel();
    channel.clear();
    channel.show(true);
    channel.appendLine(`$ ollama pull ${ollamaPullTarget}`);
    channel.appendLine('');
    await this.panel.webview.postMessage({
      type: 'localModelRecommendationStatus',
      payload: `Downloading ${ollamaPullTarget} into Ollama — progress is shown in the "AtlasMind: Local Model Install" output panel. Large models can take several minutes.`,
    });

    const outcome = await vscode.window.withProgress<{ ok: true } | { ok: false; error: string; cancelled?: boolean }>(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Ollama: installing ${ollamaPullTarget}`,
        cancellable: true,
      },
      (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => {
          channel.appendLine('\n[cancelled by user]');
          controller.abort();
        });
        return installOllamaModel(
          ollamaBaseUrl,
          ollamaPullTarget,
          line => {
            channel.appendLine(line);
            progress.report({ message: line });
          },
          controller.signal,
        )
          .then(() => ({ ok: true as const }))
          .catch((error: unknown) => {
            const cancelled = error instanceof Error && error.name === 'AbortError';
            return { ok: false as const, error: error instanceof Error ? error.message : String(error), cancelled };
          });
      },
    );

    if (outcome.ok) {
      channel.appendLine('\n[done]');
      // Force a fresh local-model sync so the newly pulled model is detected.
      await this.extensionContext.globalState.update(LOCAL_MODEL_SYNC_CACHE_KEY, undefined);
      await this.panel.webview.postMessage({
        type: 'localModelRecommendationStatus',
        payload: `Installed ${ollamaPullTarget} into Ollama. Refreshing recommendations...`,
      });
      await this.handleRecommendLocalModels();
      return;
    }

    if (outcome.cancelled) {
      await this.panel.webview.postMessage({
        type: 'localModelRecommendationStatus',
        payload: `Cancelled the Ollama download of ${ollamaPullTarget}.`,
      });
      return;
    }

    channel.appendLine(`\n[failed] ${outcome.error}`);
    await this.panel.webview.postMessage({
      type: 'localModelRecommendationStatus',
      payload: `Install failed for ${ollamaPullTarget}: ${outcome.error}. See the "AtlasMind: Local Model Install" output for details.`,
    });
  }

  private async handleInstallInLmStudio(modelTag: string): Promise<void> {
    // Strip the "hf:" prefix added by the live catalog sync to get the raw HF repo ID.
    // Ollama-style tags (no prefix) are passed through as-is — lms searches HF for them.
    const hfModelId = modelTag.startsWith('hf:') ? modelTag.slice(3) : modelTag;

    // Defense-in-depth: we spawn lms directly (no shell), but still only allow the
    // characters that appear in HF repo ids / lms search terms / quant selectors.
    if (!/^[A-Za-z0-9._@/:-]+$/.test(hfModelId)) {
      await this.panel.webview.postMessage({
        type: 'localModelRecommendationStatus',
        payload: `Refusing to install "${hfModelId}": the model id contains unexpected characters.`,
      });
      return;
    }

    const hfUrl = vscode.Uri.parse(`https://huggingface.co/${hfModelId}`);

    // lms ships with LM Studio at a fixed location on all platforms.
    const lmsBin = process.platform === 'win32'
      ? path.join(os.homedir(), '.lmstudio', 'bin', 'lms.exe')
      : path.join(os.homedir(), '.lmstudio', 'bin', 'lms');

    if (!existsSync(lmsBin)) {
      // lms not found — open the HuggingFace model page.
      // HuggingFace shows a "Use this model → LM Studio" button that opens LM Studio directly.
      await vscode.env.openExternal(hfUrl);
      await this.panel.webview.postMessage({
        type: 'localModelRecommendationStatus',
        payload: `LM Studio CLI (lms) was not found. Opened ${hfModelId} on HuggingFace — click "Use this model → LM Studio" to install, then click Scan & Recommend.`,
      });
      return;
    }

    await this.runLmsGetInstall(lmsBin, hfModelId, hfUrl);
  }

  /**
   * Run `lms get <model> --yes` as a child process (no shell — sidesteps every
   * cross-platform quoting pitfall) and stream its output to a dedicated channel.
   *
   * `--yes` is essential: without it `lms get` waits for an interactive
   * quantization/confirmation choice that cannot be answered in a spawned process,
   * so it exits non-zero — the "terminated with exit code 1" failure users hit when
   * the install was previously wired through a `shellPath` terminal. On failure the
   * real reason is surfaced and the HuggingFace page is opened as a fallback.
   */
  private async runLmsGetInstall(lmsBin: string, modelId: string, hfUrl: vscode.Uri): Promise<void> {
    const channel = this.getLocalModelInstallChannel();
    channel.clear();
    channel.show(true);
    channel.appendLine(`$ "${lmsBin}" get ${modelId} --yes`);
    channel.appendLine('');

    await this.panel.webview.postMessage({
      type: 'localModelRecommendationStatus',
      payload: `Downloading ${modelId} via LM Studio — progress is shown in the "AtlasMind: Local Model Install" output panel. Large models can take several minutes.`,
    });

    const outcome = await vscode.window.withProgress<{ code: number | null; stderrTail: string; failure?: string }>(
      {
        location: vscode.ProgressLocation.Notification,
        title: `LM Studio: installing ${modelId}`,
        cancellable: true,
      },
      (_progress, token) =>
        new Promise(resolve => {
          let stderrTail = '';
          let settled = false;
          const finish = (value: { code: number | null; stderrTail: string; failure?: string }): void => {
            if (!settled) {
              settled = true;
              resolve(value);
            }
          };

          const child = spawn(lmsBin, ['get', modelId, '--yes'], { windowsHide: true });

          token.onCancellationRequested(() => {
            channel.appendLine('\n[cancelled by user]');
            child.kill();
            finish({ code: null, stderrTail, failure: 'cancelled' });
          });

          child.stdout?.on('data', (chunk: Buffer) => channel.append(chunk.toString()));
          child.stderr?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            stderrTail = (stderrTail + text).slice(-2000);
            channel.append(text);
          });
          child.on('error', error => {
            channel.appendLine(`\n[failed to launch lms] ${error.message}`);
            finish({ code: null, stderrTail, failure: error.message });
          });
          child.on('close', code => finish({ code, stderrTail }));
        }),
    );

    if (outcome.failure === 'cancelled') {
      await this.panel.webview.postMessage({
        type: 'localModelRecommendationStatus',
        payload: `Cancelled the LM Studio download of ${modelId}.`,
      });
      return;
    }

    if (outcome.code === 0) {
      channel.appendLine('\n[done]');
      // Force a fresh local-model sync so the newly downloaded model is detected.
      await this.extensionContext.globalState.update(LOCAL_MODEL_SYNC_CACHE_KEY, undefined);
      await this.panel.webview.postMessage({
        type: 'localModelRecommendationStatus',
        payload: `Installed ${modelId} via LM Studio. Refreshing recommendations...`,
      });
      await this.handleRecommendLocalModels();
      return;
    }

    const reason = outcome.failure
      ?? lastNonEmptyLine(outcome.stderrTail)
      ?? `lms exited with code ${outcome.code ?? 'unknown'}`;
    await vscode.env.openExternal(hfUrl);
    await this.panel.webview.postMessage({
      type: 'localModelRecommendationStatus',
      payload: `LM Studio install of ${modelId} failed: ${reason}. See the "AtlasMind: Local Model Install" output for the full log. Opened the HuggingFace page as a fallback.`,
    });
  }

  private getLocalModelInstallChannel(): vscode.OutputChannel {
    if (!this.localModelInstallChannel) {
      this.localModelInstallChannel = vscode.window.createOutputChannel('AtlasMind: Local Model Install');
      this.disposables.push(this.localModelInstallChannel);
    }
    return this.localModelInstallChannel;
  }

  private async handleRemoveInstalledLocalModel(
    payload: { runtime: 'ollama' | 'lmstudio'; modelId: string },
  ): Promise<void> {
    const modelId = payload.modelId.trim();
    if (!modelId) {
      return;
    }

    if (payload.runtime === 'lmstudio') {
      await this.panel.webview.postMessage({
        type: 'localModelRecommendationStatus',
        payload: 'LM Studio remove automation is not exposed by a stable public API yet. Remove the model in LM Studio, then click Scan & Recommend again.',
      });
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Remove ${modelId} from Ollama?`,
      { modal: true },
      'Remove',
    );
    if (confirmation !== 'Remove') {
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const { ollamaBaseUrl } = resolveRuntimeBaseUrls(configuration);
    await this.panel.webview.postMessage({
      type: 'localModelRecommendationStatus',
      payload: `Removing ${modelId} from Ollama...`,
    });

    try {
      await removeOllamaModel(ollamaBaseUrl, modelId);
      await this.panel.webview.postMessage({
        type: 'localModelRecommendationStatus',
        payload: `Removed ${modelId} from Ollama. Refreshing recommendations...`,
      });
      await this.handleRecommendLocalModels();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.panel.webview.postMessage({
        type: 'localModelRecommendationStatus',
        payload: `Remove failed for ${modelId}: ${detail}`,
      });
    }
  }

  private renderModelSidebarVisibility(): string {
    // ExtensionContext always supplies globalState in VS Code. The fallback
    // keeps isolated renderer tests and partial extension-host stubs honest
    // without changing the persisted behavior in production.
    const visibilityState = this.extensionContext.globalState;
    const entries = visibilityState
      ? readHiddenModelSidebarEntries(visibilityState)
      : [];
    if (entries.length === 0) {
      return '<p class="model-sidebar-empty">Nothing is hidden. Every available provider and model can appear in the Models sidebar.</p>';
    }

    const providers = this.atlasContext?.modelRouter.listProviders() ?? [];
    const describe = (entry: ModelSidebarHiddenEntry): { kind: string; label: string; detail: string } => {
      if (entry.kind === 'provider') {
        const provider = providers.find(candidate => candidate.id === entry.providerId);
        return {
          kind: 'Provider',
          label: provider?.displayName ?? entry.providerId,
          detail: `Provider id: ${entry.providerId}`,
        };
      }

      if (entry.kind === 'model') {
        const provider = providers.find(candidate => candidate.id === entry.providerId);
        const model = provider?.models.find(candidate => candidate.id === entry.modelId);
        return {
          kind: 'Model',
          label: model?.name ?? entry.modelId,
          detail: `${provider?.displayName ?? entry.providerId} · ${entry.modelId}`,
        };
      }

      const provider = providers.find(candidate => candidate.id === entry.vendorId);
      return {
        kind: 'Subscription route',
        label: `${provider?.displayName ?? entry.vendorId} — ${entry.agentId}`,
        detail: `ACP agent: ${entry.agentId}`,
      };
    };

    return `
      <div class="model-sidebar-hidden-list">
        ${entries.map(entry => {
          const item = describe(entry);
          const key = modelSidebarHiddenEntryKey(entry);
          return `
            <div class="model-sidebar-hidden-row">
              <div class="model-sidebar-hidden-copy">
                <span class="model-sidebar-hidden-kind">${escapeHtml(item.kind)}</span>
                <strong>${escapeHtml(item.label)}</strong>
                <span class="muted-line">${escapeHtml(item.detail)}</span>
              </div>
              <button
                type="button"
                class="secondary-button model-sidebar-restore"
                data-restore-model-sidebar-entry="${escapeHtml(key)}"
                aria-label="Restore ${escapeHtml(item.label)} to the Models sidebar"
              >Restore</button>
            </div>`;
        }).join('')}
      </div>`;
  }

  private getHtml(): string {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const lensWorkspace = vscode.workspace.workspaceFolders?.[0];
    const lensDeclarations = inspectLensDeclarations(
      lensWorkspace?.uri.scheme === 'file' || lensWorkspace?.uri.scheme === 'vscode-remote'
        ? lensWorkspace.uri.fsPath
        : undefined,
    );
    const registeredAgents = this.atlasContext?.agentRegistry?.listAgents() ?? [];
    const enabledAgentCount = registeredAgents.filter(agent =>
      this.atlasContext?.agentRegistry?.isEnabled(agent.id) ?? true,
    ).length;
    const customAgentCount = registeredAgents.filter(agent => !agent.builtIn).length;
    const builtInAgentCount = registeredAgents.length - customAgentCount;
    const selectedBudget = getBudgetMode(configuration.get<string>('budgetMode'));
    const selectedSpeed = getSpeedMode(configuration.get<string>('speedMode'));
    const feedbackRoutingWeight = getRangedNumber(configuration.get<number>('feedbackRoutingWeight'), 1, 0, 2, 2);
    const localOpenAiEndpoints = getConfiguredLocalEndpoints({
      getEndpoints: () => configuration.get<unknown>('localOpenAiEndpoints'),
      getLegacyBaseUrl: () => configuration.get<string>('localOpenAiBaseUrl'),
    });
    const serializedLocalOpenAiEndpoints = serializeForInlineScript(localOpenAiEndpoints);
    const dailyCostLimitUsd = getNonNegativeNumber(configuration.get<number>('dailyCostLimitUsd'), 0);
    const selectedDisplayCurrency = getDisplayCurrency();
    const showImportProjectAction = configuration.get<boolean>('showImportProjectAction', true);
    const selectedToolApprovalMode = getToolApprovalMode(configuration.get<string>('toolApprovalMode'));
    const allowTerminalWrite = configuration.get<boolean>('allowTerminalWrite', false);
    const acpToolsEnabled = configuration.get<boolean>('acp.toolsEnabled', false);
    const acpAgentCount = Array.isArray(configuration.get<unknown>('acp.agents'))
      ? (configuration.get<unknown[]>('acp.agents') ?? []).length
      : 0;
    // Windows-only, and stated as such rather than shown everywhere as a
    // checkbox that does nothing: the pop-up windows it suppresses are a
    // consequence of how Windows allocates a console to a child process.
    const acpConsoleChoiceApplies = process.platform === 'win32';
    const acpHideConsoleWindows = configuration.get<boolean>('acp.hideConsoleWindows', false);
    const autoVerifyAfterWrite = configuration.get<boolean>('autoVerifyAfterWrite', true);
    const autoVerifyScripts = escapeHtml((configuration.get<string[]>('autoVerifyScripts', ['test']) ?? ['test']).join(', '));
    const autoVerifyTimeoutMs = getPositiveInteger(configuration.get<number>('autoVerifyTimeoutMs'), 120000);
    const voiceTtsEnabled = configuration.get<boolean>('voice.ttsEnabled', false);
    const instructionsVerifyOnCommit = configuration.get<boolean>('instructions.verifyOnCommit', true);
    const voiceRate = getRangedNumber(configuration.get<number>('voice.rate'), 1, 0.5, 2, 2);
    const voicePitch = getRangedNumber(configuration.get<number>('voice.pitch'), 1, 0, 2, 2);
    const voiceVolume = getRangedNumber(configuration.get<number>('voice.volume'), 1, 0, 1, 2);
    const voiceLanguage = escapeHtml(configuration.get<string>('voice.language', ''));
    const voiceOutputDeviceId = escapeHtml(configuration.get<string>('voice.outputDeviceId', ''));
    const chatSessionTurnLimit = getPositiveInteger(configuration.get<number>('chatSessionTurnLimit'), 6);
    const chatSessionContextChars = getPositiveInteger(configuration.get<number>('chatSessionContextChars'), 2500);
    const projectApprovalFileThreshold = getPositiveInteger(
      configuration.get<number>('projectApprovalFileThreshold'),
      DEFAULT_PROJECT_APPROVAL_FILE_THRESHOLD,
    );
    const projectEstimatedFilesPerSubtask = getPositiveInteger(
      configuration.get<number>('projectEstimatedFilesPerSubtask'),
      DEFAULT_ESTIMATED_FILES_PER_SUBTASK,
    );
    const projectChangedFileReferenceLimit = getPositiveInteger(
      configuration.get<number>('projectChangedFileReferenceLimit'),
      DEFAULT_CHANGED_FILE_REFERENCE_LIMIT,
    );
    const projectRunReportFolder = escapeHtml(
      getNonEmptyString(
        configuration.get<string>('projectRunReportFolder'),
        DEFAULT_PROJECT_RUN_REPORT_FOLDER,
      ),
    );
    const projectDependencyMonitoringEnabled = configuration.get<boolean>('projectDependencyMonitoringEnabled', true);
    const projectDependencyMonitoringProviders = getDependencyMonitoringProviders(
      configuration.get<string[]>('projectDependencyMonitoringProviders', ['dependabot']),
    );
    const projectDependencyMonitoringSchedule = getDependencyMonitoringSchedule(
      configuration.get<string>('projectDependencyMonitoringSchedule'),
    );
    const projectDependencyMonitoringIssueTemplate = configuration.get<boolean>('projectDependencyMonitoringIssueTemplate', true);
    const experimentalSkillLearningEnabled = configuration.get<boolean>('experimentalSkillLearningEnabled', false);
    const maxToolIterations = getPositiveInteger(configuration.get<number>('maxToolIterations'), 20);

    // MCP servers, read live so the page shows what is actually connected
    // rather than what was configured.
    const mcpServers = (this.atlasContext?.mcpServerRegistry?.listServers() ?? []).map(entry => ({
      id: entry.config.id,
      name: entry.config.name || entry.config.id,
      transport: entry.config.transport,
      enabled: entry.config.enabled !== false,
      status: entry.status,
      error: entry.error,
      toolCount: entry.tools.length,
    }));

    // Buzz. Each switch is read independently so the page can show the real
    // stored value even when a parent gate makes it inert — hiding a stored
    // `true` behind a disabled parent would misrepresent what is configured.
    const buzzEnabled = configuration.get<boolean>('buzz.enabled', false);
    const buzzRelayUrl = escapeHtml(configuration.get<string>('buzz.relayUrl', '') || '');
    const buzzAllowRemoteRelay = configuration.get<boolean>('buzz.allowRemoteRelay', false);
    const buzzInboundEnabled = configuration.get<boolean>('buzz.inboundEnabled', false);
    const buzzInboundChannels = escapeHtml((configuration.get<string[]>('buzz.inboundChannels', []) ?? []).join('\n'));
    const buzzAutoCreateFollowUps = configuration.get<boolean>('buzz.autoCreateFollowUps', false);
    const parsedBuzzBindings = parseAgentBindings(configuration.get('buzz.agentBindings'));

    // Mission Loop defaults.
    const loopEnabled = configuration.get<boolean>('loop.enabled', true);
    const loopDefaultMaxIterations = getPositiveInteger(configuration.get<number>('loop.defaultMaxIterations'), 8);
    const loopDefaultMaxCostUsd = getPositiveNumber(configuration.get<number>('loop.defaultMaxCostUsd'), 5);
    // Cost cap is stored USD-canonical but shown in the user's selected display currency.
    const loopDisplayCurrency = getDisplayCurrency();
    const loopFxRate = getExchangeRate(loopDisplayCurrency);
    const loopDefaultMaxCostDisplay = formatPlainNumber(loopDefaultMaxCostUsd * loopFxRate, 2);
    const loopDefaultMaxTokens = getPositiveInteger(configuration.get<number>('loop.defaultMaxTokens'), 2000000);
    const loopDefaultMaxTokensDisplay = groupThousands(loopDefaultMaxTokens);
    const loopDefaultMaxDurationMinutes = getPositiveInteger(configuration.get<number>('loop.defaultMaxDurationMinutes'), 30);
    const loopMaxConsecutiveNoProgress = getPositiveInteger(configuration.get<number>('loop.maxConsecutiveNoProgress'), 2);
    const loopCheckpointEveryNIterations = getNonNegativeInteger(configuration.get<number>('loop.checkpointEveryNIterations'), 3);
    const loopCheckpointAtBudgetFraction = getRangedNumber(configuration.get<number>('loop.checkpointAtBudgetFraction'), 0.75, 0.01, 1);
    const loopRequireApprovalBeforeWriteBatches = configuration.get<boolean>('loop.requireApprovalBeforeWriteBatches', false);
    const loopAllowDiscovery = configuration.get<boolean>('loop.allowDiscovery', true);
    const loopGoalAchievedConfidenceThreshold = getRangedNumber(configuration.get<number>('loop.goalAchievedConfidenceThreshold'), 0.7, 0, 1);

    const testingDashboard = collectTestingDashboardSnapshot(this.atlasContext);
    const modelSidebarVisibility = this.renderModelSidebarVisibility();

    const initialPage = this.initialTarget?.page ?? 'overview';
    const hasExplicitInitialPage = this.initialTarget?.page !== undefined;
    const initialQuery = escapeHtml(this.initialTarget?.query ?? '');
    const initialSection = JSON.stringify(this.initialTarget?.section ?? '');
    const extensionVersion = escapeHtml(this.extensionVersion);

    return getWebviewHtmlShell({
      dashboardSkin: true,
      title: 'AtlasMind Settings',
      cspSource: this.panel.webview.cspSource,
      bodyContent:
      `
      <div class="settings-hero">
        <div>
          <p class="eyebrow">Workspace configuration</p>
          <h1>AtlasMind Settings</h1>
          <p class="hero-copy">A navigable control surface for routing, safety, chat context, and autonomous project runs. Every change is still validated before it is written into workspace settings.</p>
        </div>
        <div class="hero-side">
          <div class="hero-badges" aria-label="Settings principles">
            <span class="hero-badge" data-tooltip="AtlasMind validates incoming values inside the extension host before persisting them, instead of trusting raw webview form input." tabindex="0">Validated writes</span>
            <span class="hero-badge" data-tooltip="These controls write to workspace settings so project-specific routing, safety, and run behavior stay local to the current repo." tabindex="0">Workspace scoped</span>
            <span class="hero-badge" data-tooltip="Defaults stay conservative around tool execution, safety approvals, and settings writes until you explicitly loosen them." tabindex="0">Security-first defaults</span>
          </div>
          <span class="hero-version" aria-label="Installed AtlasMind version">v${extensionVersion}</span>
        </div>
      </div>

      <div class="search-shell">
        <label class="search-label" for="settingsSearch">Search settings</label>
        <input id="settingsSearch" type="search" placeholder="Search pages, controls, or workflows" value="${initialQuery}" />
        <p id="searchStatus" class="search-status" aria-live="polite"></p>
      </div>

      <div class="settings-layout">
        <nav class="settings-nav" aria-label="AtlasMind settings sections" role="tablist" aria-orientation="vertical">
          <button type="button" class="nav-link ${initialPage === 'overview' ? 'active' : ''}" id="tab-overview" data-page-target="overview" data-search="overview quick actions budget speed cost limits currency display currency personality profile role tone memory posture embedded chat detached chat project run center vscode chat" role="tab" aria-selected="${initialPage === 'overview' ? 'true' : 'false'}" aria-controls="page-overview" ${initialPage === 'overview' ? '' : 'tabindex="-1"'}>Overview</button>
          <div class="nav-group" role="presentation">
            <span class="nav-group-label" aria-hidden="true">Capabilities</span>
            <button type="button" class="nav-link ${initialPage === 'agents' ? 'active' : ''}" id="tab-agents" data-page-target="agents" data-search="agents manage agents built-in custom roles prompts instructions rubrics completion criteria global immutable guardrails safety policy skills models budget auto-update automation" role="tab" aria-selected="${initialPage === 'agents' ? 'true' : 'false'}" aria-controls="page-agents" ${initialPage === 'agents' ? '' : 'tabindex="-1"'}>Agents</button>
            <button type="button" class="nav-link ${initialPage === 'models' ? 'active' : ''}" id="tab-models" data-page-target="models" data-search="models integrations providers hidden hide restore sidebar visibility local endpoint local endpoints ollama lm studio azure bedrock personality profile role tone memory posture voice vision exa specialist acp agent client protocol claude subscription chatgpt subscription codex subscription-backed claude-agent-acp codex-acp use my subscription no api key" role="tab" aria-selected="${initialPage === 'models' ? 'true' : 'false'}" aria-controls="page-models" ${initialPage === 'models' ? '' : 'tabindex="-1"'}>Models & Integrations</button>
            <button type="button" class="nav-link ${initialPage === 'discovery' ? 'active' : ''}" id="tab-discovery" data-page-target="discovery" data-search="resource discovery ard agent finders mcp servers agents skills apis search install publish catalog manifest registry" role="tab" aria-selected="${initialPage === 'discovery' ? 'true' : 'false'}" aria-controls="page-discovery" ${initialPage === 'discovery' ? '' : 'tabindex="-1"'}>Resource Discovery</button>
            <button type="button" class="nav-link ${initialPage === 'mcp' ? 'active' : ''}" id="tab-mcp" data-page-target="mcp" data-search="mcp servers model context protocol tools connect disconnect stdio http bridge" role="tab" aria-selected="${initialPage === 'mcp' ? 'true' : 'false'}" aria-controls="page-mcp" ${initialPage === 'mcp' ? '' : 'tabindex="-1"'}>MCP Servers</button>
            <button type="button" class="nav-link ${initialPage === 'buzz' ? 'active' : ''}" id="tab-buzz" data-page-target="buzz" data-search="buzz nostr relay inbound subscription follow-ups agent bindings npub agent key channels remote relay" role="tab" aria-selected="${initialPage === 'buzz' ? 'true' : 'false'}" aria-controls="page-buzz" ${initialPage === 'buzz' ? '' : 'tabindex="-1"'}>Buzz</button>
          </div>
          <div class="nav-group" role="presentation">
            <span class="nav-group-label" aria-hidden="true">Interaction</span>
            <button type="button" class="nav-link ${initialPage === 'chat' ? 'active' : ''}" id="tab-chat" data-page-target="chat" data-search="chat sidebar sessions import project carry-forward turns context max chars" role="tab" aria-selected="${initialPage === 'chat' ? 'true' : 'false'}" aria-controls="page-chat" ${initialPage === 'chat' ? '' : 'tabindex="-1"'}>Chat & Sidebar</button>
            <button type="button" class="nav-link ${initialPage === 'ai-instructions' ? 'active' : ''}" id="tab-ai-instructions" data-page-target="ai-instructions" data-search="ai instructions sync copilot claude cursor cline continue codex gemini windsurf aider import instruction sets" role="tab" aria-selected="${initialPage === 'ai-instructions' ? 'true' : 'false'}" aria-controls="page-ai-instructions" ${initialPage === 'ai-instructions' ? '' : 'tabindex="-1"'}>AI Instructions</button>
          </div>
          <div class="nav-group" role="presentation">
            <span class="nav-group-label" aria-hidden="true">Guardrails</span>
            <button type="button" class="nav-link ${initialPage === 'safety' ? 'active' : ''}" id="tab-safety" data-page-target="safety" data-search="safety verification approvals tool approval terminal write scripts timeout max tool iterations loop limit acp agent client protocol acp tools delegated execution agent permissions allow once always allow acp mcp servers hide console windows private desktop pop-up popup black terminal window focus stealing windows launcher" role="tab" aria-selected="${initialPage === 'safety' ? 'true' : 'false'}" aria-controls="page-safety" ${initialPage === 'safety' ? '' : 'tabindex="-1"'}>Safety & Verification</button>
            <button type="button" class="nav-link ${initialPage === 'testing' ? 'active' : ''}" id="tab-testing" data-page-target="testing" data-search="testing methodology tdd bdd unit integration e2e mutation property snapshot contract performance security visual exploratory test strategy agent override model" role="tab" aria-selected="${initialPage === 'testing' ? 'true' : 'false'}" aria-controls="page-testing" ${initialPage === 'testing' ? '' : 'tabindex="-1"'}>Testing</button>
          </div>
          <div class="nav-group" role="presentation">
            <span class="nav-group-label" aria-hidden="true">Autonomy</span>
            <button type="button" class="nav-link ${initialPage === 'project' ? 'active' : ''}" id="tab-project" data-page-target="project" data-search="project runs approval threshold estimated files changed file references report folder dependency monitoring dependabot renovate governance updates" role="tab" aria-selected="${initialPage === 'project' ? 'true' : 'false'}" aria-controls="page-project" ${initialPage === 'project' ? '' : 'tabindex="-1"'}>Project Runs</button>
            <button type="button" class="nav-link ${initialPage === 'loop' ? 'active' : ''}" id="tab-loop" data-page-target="loop" data-search="mission loop autonomous goal seeking iterations cost cap token cap time cap no progress checkpoint approval budget fraction discovery confidence threshold envelope" role="tab" aria-selected="${initialPage === 'loop' ? 'true' : 'false'}" aria-controls="page-loop" ${initialPage === 'loop' ? '' : 'tabindex="-1"'}>Mission Loop</button>
          </div>
          <div class="nav-group" role="presentation">
            <span class="nav-group-label" aria-hidden="true">Advanced</span>
            <button type="button" class="nav-link ${initialPage === 'experimental' ? 'active' : ''}" id="tab-experimental" data-page-target="experimental" data-search="experimental skill learning generated drafts" role="tab" aria-selected="${initialPage === 'experimental' ? 'true' : 'false'}" aria-controls="page-experimental" ${initialPage === 'experimental' ? '' : 'tabindex="-1"'}>Experimental</button>
          </div>
        </nav>

        <main class="settings-main">
          <section id="page-overview" class="settings-page ${initialPage === 'overview' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-overview" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Overview</p>
              <h2>Daily control center</h2>
              <p>Choose how AtlasMind balances cost and speed, then jump straight into the surfaces you use most.</p>
            </div>

            <div class="action-grid">
              <button id="openChatView" class="action-card action-card-primary">
                <span class="action-title">Focus Embedded Chat</span>
                <span class="action-copy">Reveal the Atlas chat workspace inside the sidebar container.</span>
              </button>
              <button id="openChatPanel" class="action-card">
                <span class="action-title">Open Detached Chat</span>
                <span class="action-copy">Use the larger conversation workspace when you want more room.</span>
              </button>
              <button id="openProjectRunCenter" class="action-card">
                <span class="action-title">Project Run Center</span>
                <span class="action-copy">Review batch progress, approvals, pauses, and resumptions.</span>
              </button>
              <button id="openAgentManagerOverview" class="action-card">
                <span class="action-title">Manage Agents</span>
                <span class="action-copy">Inspect built-ins, create custom agents, and tune prompts, completion criteria, skills, and routing limits.</span>
              </button>
              <button id="openPersonalityProfileOverview" class="action-card">
                <span class="action-title">Personality Profile</span>
                <span class="action-copy">Shape Atlas's role, tone, memory posture, and project-specific working preferences.</span>
              </button>
              <button id="openCompareModels" class="action-card">
                <span class="action-title">Compare Models</span>
                <span class="action-copy">Run one prompt across your configured models and rank quality, cost, and latency.</span>
              </button>
              <button id="openChat" class="action-card">
                <span class="action-title">VS Code Chat</span>
                <span class="action-copy">Jump into the native Chat view and continue with <code>@atlas</code>.</span>
              </button>
            </div>

            <div class="page-grid two-up">
              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Routing</p>
                  <h3>${renderHeadingWithHelp('Budget mode', 'budgetMode')}</h3>
                </div>
                <p class="card-copy">Select how aggressively AtlasMind should spend on models across orchestrated tasks.</p>
                <div class="choice-cluster" role="radiogroup" aria-label="Budget mode">
                  ${renderRoutingChoicePill('budget', 'cheap', 'Cheap', selectedBudget === 'cheap', BUDGET_MODE_HELP.cheap)}
                  ${renderRoutingChoicePill('budget', 'balanced', 'Balanced', selectedBudget === 'balanced', BUDGET_MODE_HELP.balanced)}
                  ${renderRoutingChoicePill('budget', 'expensive', 'Expensive', selectedBudget === 'expensive', BUDGET_MODE_HELP.expensive)}
                  ${renderRoutingChoicePill('budget', 'auto', 'Auto', selectedBudget === 'auto', BUDGET_MODE_HELP.auto)}
                </div>
                <div class="field-stack compact-stack">
                  ${renderFieldLabel('dailyCostLimitUsd', 'Daily Cost Limit (USD)', 'dailyCostLimitUsd')}
                  <input id="dailyCostLimitUsd" type="number" min="0" step="0.01" value="${dailyCostLimitUsd}" />
                  <p class="info-note">Use <code>0</code> for unlimited. AtlasMind warns at 80% and blocks new requests once the limit is reached.</p>
                </div>
                <div class="field-grid top-gap">
                  ${renderFieldLabel('displayCurrency', 'Display Currency', 'displayCurrency')}
                  <select id="displayCurrency">
                    <option value="auto" ${selectedDisplayCurrency === 'auto' ? 'selected' : ''}>Auto (from OS locale)</option>
                    <option value="USD" ${selectedDisplayCurrency === 'USD' ? 'selected' : ''}>USD — US Dollar</option>
                    <option value="EUR" ${selectedDisplayCurrency === 'EUR' ? 'selected' : ''}>EUR — Euro</option>
                    <option value="GBP" ${selectedDisplayCurrency === 'GBP' ? 'selected' : ''}>GBP — British Pound</option>
                    <option value="JPY" ${selectedDisplayCurrency === 'JPY' ? 'selected' : ''}>JPY — Japanese Yen</option>
                    <option value="CAD" ${selectedDisplayCurrency === 'CAD' ? 'selected' : ''}>CAD — Canadian Dollar</option>
                    <option value="AUD" ${selectedDisplayCurrency === 'AUD' ? 'selected' : ''}>AUD — Australian Dollar</option>
                    <option value="CHF" ${selectedDisplayCurrency === 'CHF' ? 'selected' : ''}>CHF — Swiss Franc</option>
                    <option value="CNY" ${selectedDisplayCurrency === 'CNY' ? 'selected' : ''}>CNY — Chinese Yuan</option>
                    <option value="INR" ${selectedDisplayCurrency === 'INR' ? 'selected' : ''}>INR — Indian Rupee</option>
                    <option value="BRL" ${selectedDisplayCurrency === 'BRL' ? 'selected' : ''}>BRL — Brazilian Real</option>
                    <option value="MXN" ${selectedDisplayCurrency === 'MXN' ? 'selected' : ''}>MXN — Mexican Peso</option>
                    <option value="KRW" ${selectedDisplayCurrency === 'KRW' ? 'selected' : ''}>KRW — South Korean Won</option>
                    <option value="SEK" ${selectedDisplayCurrency === 'SEK' ? 'selected' : ''}>SEK — Swedish Krona</option>
                    <option value="NOK" ${selectedDisplayCurrency === 'NOK' ? 'selected' : ''}>NOK — Norwegian Krone</option>
                    <option value="DKK" ${selectedDisplayCurrency === 'DKK' ? 'selected' : ''}>DKK — Danish Krone</option>
                    <option value="NZD" ${selectedDisplayCurrency === 'NZD' ? 'selected' : ''}>NZD — New Zealand Dollar</option>
                    <option value="SGD" ${selectedDisplayCurrency === 'SGD' ? 'selected' : ''}>SGD — Singapore Dollar</option>
                    <option value="HKD" ${selectedDisplayCurrency === 'HKD' ? 'selected' : ''}>HKD — Hong Kong Dollar</option>
                    <option value="ZAR" ${selectedDisplayCurrency === 'ZAR' ? 'selected' : ''}>ZAR — South African Rand</option>
                  </select>
                  <p class="info-note">Costs are stored in USD and converted at startup using live exchange rates (24-hour cache). Auto detects your currency from the OS locale.</p>
                </div>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Routing</p>
                  <h3>${renderHeadingWithHelp('Speed mode', 'speedMode')}</h3>
                </div>
                <p class="card-copy">Decide how much time AtlasMind should spend choosing and running more capable reasoning paths.</p>
                <div class="choice-cluster" role="radiogroup" aria-label="Speed mode">
                  ${renderRoutingChoicePill('speed', 'fast', 'Fast', selectedSpeed === 'fast', SPEED_MODE_HELP.fast)}
                  ${renderRoutingChoicePill('speed', 'balanced', 'Balanced', selectedSpeed === 'balanced', SPEED_MODE_HELP.balanced)}
                  ${renderRoutingChoicePill('speed', 'considered', 'Considered', selectedSpeed === 'considered', SPEED_MODE_HELP.considered)}
                  ${renderRoutingChoicePill('speed', 'auto', 'Auto', selectedSpeed === 'auto', SPEED_MODE_HELP.auto)}
                </div>
                <div class="info-band">
                  <strong>Tip:</strong> Pair <code>balanced</code> speed with <code>balanced</code> budget when you want stable defaults without over-tuning the router.
                </div>
                <div class="field-stack compact-stack top-gap">
                  ${renderFieldLabel('feedbackRoutingWeight', 'Feedback Routing Weight', 'feedbackRoutingWeight')}
                  <input id="feedbackRoutingWeight" type="number" min="0" max="2" step="0.05" value="${feedbackRoutingWeight}" />
                  <p class="info-note">Set <code>0</code> to ignore thumbs history in routing. Higher values amplify the bias, but AtlasMind still caps the effect so votes cannot override hard capability or provider-health checks.</p>
                </div>
              </article>
            </div>
          </section>

          <section id="page-agents" class="settings-page ${initialPage === 'agents' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-agents" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Agents</p>
              <h2>Agent definitions and operating policy</h2>
              <p>Review the specialists AtlasMind can route to, create custom agents, and control the instructions and completion criteria applied to each one.</p>
            </div>

            <div class="stats-grid">
              <article class="stat-card">
                <span class="stat-label">Registered</span>
                <span class="stat-value">${registeredAgents.length}</span>
                <div class="stat-meta">All built-in and custom definitions.</div>
              </article>
              <article class="stat-card">
                <span class="stat-label">Available</span>
                <span class="stat-value">${enabledAgentCount}</span>
                <div class="stat-meta">Enabled for routing and orchestration.</div>
              </article>
              <article class="stat-card">
                <span class="stat-label">Built-in</span>
                <span class="stat-value">${builtInAgentCount}</span>
                <div class="stat-meta">Protected identity and factory defaults.</div>
              </article>
              <article class="stat-card">
                <span class="stat-label">Custom</span>
                <span class="stat-value">${customAgentCount}</span>
                <div class="stat-meta">Definitions you fully control.</div>
              </article>
            </div>

            <div class="page-grid two-up">
              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Agent workspace</p>
                  <h3>Manage definitions</h3>
                </div>
                <p class="card-copy">Open the dedicated workspace to search agents and edit identity, instructions, rubrics, skills, model limits, testing roles, and maintenance policy in one place.</p>
                <button id="openAgentManager">Manage Agents</button>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Related configuration</p>
                  <h3>Models and testing</h3>
                </div>
                <p class="card-copy">Model providers and project testing methodologies remain separate because they apply across agents. Agent-specific assignments link back to those surfaces.</p>
                <div class="button-stack">
                  <button id="openAgentModelProviders">Manage Model Providers</button>
                  <button id="openAgentTestingSettings" class="secondary-button" data-settings-page="testing">Open Testing Settings</button>
                </div>
              </article>

              <article class="settings-card agent-policy-card" id="globalAgentGuardrailsCard">
                <div class="card-header">
                  <p class="card-kicker">Runtime policy</p>
                  <h3>Global guardrails</h3>
                </div>
                <p class="card-copy">This authoritative, non-overrideable block is included in every routed agent's effective system instructions. It takes priority over agent definitions, user instructions, retrieved content, workspace files, and tool output.</p>
                <div class="info-band">
                  <strong>Read-only by design.</strong> Agents and workspace content cannot weaken these rules. Changing them requires changing and rebuilding AtlasMind.
                </div>
                <pre id="globalAgentGuardrails" class="guardrail-block" tabindex="0" aria-label="Global immutable guardrails">${escapeHtml(IMMUTABLE_GUARDRAILS)}</pre>
                <p class="info-note">Runtime source: <code>IMMUTABLE_GUARDRAILS</code> in <code>src/core/orchestrator.ts</code>. This view is rendered from that source of truth rather than a separate summary.</p>
              </article>
            </div>
          </section>

          <section id="page-chat" class="settings-page ${initialPage === 'chat' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-chat" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Chat &amp; Sidebar</p>
              <h2>Session carry-forward and sidebar affordances</h2>
              <p>Control how much AtlasMind carries across turns and which actions stay visible in the sidebar workflow.</p>
            </div>

            <div class="page-grid">
              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Atlas workspace</p>
                  <h3>Sidebar behavior</h3>
                </div>
                <div class="field-stack">
                  ${renderFieldLabel('showImportProjectAction', 'Memory toolbar action', 'showImportProjectAction')}
                  <label class="checkbox-card">
                    <input id="showImportProjectAction" type="checkbox" ${showImportProjectAction ? 'checked' : ''}>
                    <span>
                      <strong>${renderHeadingWithHelp('Show Import Existing Project', 'showImportProjectAction')}</strong>
                      <span class="muted-line">Keep the import action visible in the Memory view title bar.</span>
                    </span>
                  </label>
                </div>
                <p class="info-note">AtlasMind Settings remains available from the overflow menu on AtlasMind views.</p>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Context window</p>
                  <h3>Conversation carry-forward</h3>
                </div>
                <div class="field-grid">
                  ${renderFieldLabel('chatSessionTurnLimit', 'Session Carry-forward Turns', 'chatSessionTurnLimit')}
                  <input id="chatSessionTurnLimit" type="number" min="1" step="1" value="${chatSessionTurnLimit}" />

                  ${renderFieldLabel('chatSessionContextChars', 'Session Context Max Chars', 'chatSessionContextChars')}
                  <input id="chatSessionContextChars" type="number" min="400" step="100" value="${chatSessionContextChars}" />
                </div>
                <p class="info-note">Lower values make sessions cheaper and tighter. Higher values keep more local continuity available to the orchestrator.</p>
              </article>
            </div>
          </section>

          <section id="page-models" class="settings-page ${initialPage === 'models' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-models" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Models &amp; Integrations</p>
              <h2>Provider endpoints and specialist surfaces</h2>
              <p>Use this page to reach provider management quickly and configure any local OpenAI-compatible endpoint.</p>
            </div>

            <div class="page-grid two-up">
              <article id="localEndpointsCard" class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Local routing</p>
                  <h3>${renderHeadingWithHelp('OpenAI-compatible endpoints', 'localOpenAiEndpoints')}</h3>
                </div>
                <p class="card-copy">Point AtlasMind at Ollama, LM Studio, Open WebUI, or multiple local OpenAI-compatible engines at once. Add rows only when you need them, and give each one a label so AtlasMind can tell you which endpoint owns which local model.</p>
                <div class="field-stack">
                  <div class="local-endpoints-header">
                    <span class="field-label field-label-with-help"><span>Configured local endpoints</span>${renderHelpIndicator('localOpenAiEndpoints')}</span>
                    <div class="local-endpoint-add-wrapper">
                      <button id="addLocalEndpoint" type="button" class="secondary-button local-endpoint-add" aria-label="Add local endpoint">+</button>
                      <ul id="addEndpointMenu" class="endpoint-preset-menu" role="menu" hidden></ul>
                    </div>
                  </div>
                  <div id="localEndpointsList" class="local-endpoints-list"></div>
                </div>
                <p class="info-note">Labels such as <code>Ollama</code> or <code>LM Studio</code> are shown back in the Platform &amp; Local provider page. Local API credentials, when needed, still remain in SecretStorage through the provider surfaces rather than plain settings.</p>
              </article>

              <article class="settings-card" id="localModelAdvisorCard">
                <div class="card-header">
                  <p class="card-kicker">Local model advisor</p>
                  <h3>Scan and recommend local models</h3>
                </div>
                <p class="card-copy">AtlasMind reviews your recent local-model usage, checks local hardware capacity, compares against recent release families in AtlasMind's model catalog, recommends the best models to keep installed, and lets you manage install/remove lifecycle from this panel.</p>
                <div class="button-stack">
                  <button id="scanLocalModelRecommendations">Scan &amp; Recommend</button>
                </div>
                <p id="localModelRecommendationStatus" class="info-note" aria-live="polite">No scan has been run yet.</p>
                <div id="localModelRecommendationResults" class="local-model-recommendation-results" hidden></div>
              </article>


              <article class="settings-card" id="modelSidebarVisibilityCard">
                <div class="card-header">
                  <p class="card-kicker">Sidebar visibility</p>
                  <h3>Hidden providers and models</h3>
                </div>
                <p class="card-copy">Use the eye-closed icon on any provider, subscription route, or model row to remove visual clutter. This is a display preference only: hidden entries stay configured, enabled, and available to routing.</p>
                ${modelSidebarVisibility}
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Management</p>
                  <h3>Provider surfaces</h3>
                </div>
                <div class="button-stack">
                  <button id="openModelProviders">Manage Model Providers</button>
                  <button id="openSpecialistIntegrations">Open Specialist Integrations</button>
                  <button id="openPersonalityProfileModels">Personality Profile</button>
                  <button id="openVoicePanel">Voice Panel</button>
                  <button id="openVisionPanel">Vision Panel</button>
                </div>
                <p class="info-note">Use providers for routed models and specialist integrations for focused capabilities such as voice or image tooling.</p>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">MCP Servers</p>
                  <h3>Recommended MCP starters</h3>
                </div>
                <div class="field-stack">
                  <label for="mcpServerCatalogue" class="field-label">Select a recommended MCP server</label>
                  <select id="mcpServerCatalogue"></select>
                  <div id="mcpServerBadges" class="catalogue-badges" aria-live="polite"></div>
                  <div id="mcpServerDescription" class="info-note" style="min-height: 2.5em;"></div>
                  <button id="installMcpServer" class="secondary-button" disabled>Open in Add Server</button>
                  <a id="mcpServerDocs" href="#" target="_blank" rel="noopener" style="display:none; margin-top:6px;">View Documentation</a>
                  <p class="info-note">The full recommended catalogue and the custom endpoint form now live together in the MCP Add Server workspace.</p>
                </div>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Voice output</p>
                  <h3>${renderHeadingWithHelp('Text-to-speech playback', 'voiceTtsEnabled')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="voiceTtsEnabled" type="checkbox" ${voiceTtsEnabled ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Auto-speak Atlas responses', 'voiceTtsEnabled')}</strong>
                    <span class="muted-line">Use the same voice stack as the Voice Panel when AtlasMind finishes a freeform response.</span>
                  </span>
                </label>
                <div class="field-grid top-gap">
                  ${renderFieldLabel('voiceRate', 'Speech Rate', 'voiceRate')}
                  <input id="voiceRate" type="number" min="0.5" max="2" step="0.05" value="${voiceRate}" />

                  ${renderFieldLabel('voicePitch', 'Speech Pitch', 'voicePitch')}
                  <input id="voicePitch" type="number" min="0" max="2" step="0.05" value="${voicePitch}" />

                  ${renderFieldLabel('voiceVolume', 'Speech Volume', 'voiceVolume')}
                  <input id="voiceVolume" type="number" min="0" max="1" step="0.05" value="${voiceVolume}" />

                  ${renderFieldLabel('voiceLanguage', 'Speech Language', 'voiceLanguage')}
                  <input id="voiceLanguage" type="text" value="${voiceLanguage}" placeholder="e.g. en-US" />

                  ${renderFieldLabel('voiceOutputDeviceId', 'Preferred Speaker Device', 'voiceOutputDeviceId')}
                  <input id="voiceOutputDeviceId" type="text" value="${voiceOutputDeviceId}" placeholder="Leave empty for default output" />
                </div>
                <p class="info-note">Use the dedicated Voice Panel for microphone capture, voice previews, and device inspection. These settings keep TTS behavior visible in the main dashboard.</p>
              </article>
            </div>
          </section>

          <section id="page-safety" class="settings-page ${initialPage === 'safety' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-safety" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Safety &amp; Verification</p>
              <h2>Approval policy and automated checks</h2>
              <p>Define when AtlasMind needs your approval and how aggressively it should verify edits after writing files.</p>
            </div>

            <div class="page-grid">
              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Approvals</p>
                  <h3>${renderHeadingWithHelp('Tool execution policy', 'toolApprovalMode')}</h3>
                </div>
                <div class="field-grid">
                  ${renderFieldLabel('toolApprovalMode', 'Tool Approval Mode', 'toolApprovalMode')}
                  <select id="toolApprovalMode">
                    <option value="always-ask" ${selectedToolApprovalMode === 'always-ask' ? 'selected' : ''}>Always ask</option>
                    <option value="ask-on-write" ${selectedToolApprovalMode === 'ask-on-write' ? 'selected' : ''}>Ask on write</option>
                    <option value="ask-on-external" ${selectedToolApprovalMode === 'ask-on-external' ? 'selected' : ''}>Ask on external</option>
                    <option value="allow-safe-readonly" ${selectedToolApprovalMode === 'allow-safe-readonly' ? 'selected' : ''}>Allow safe readonly</option>
                  </select>
                </div>
                <label class="checkbox-card top-gap">
                  <input id="allowTerminalWrite" type="checkbox" ${allowTerminalWrite ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Permit terminal write commands', 'allowTerminalWrite')}</strong>
                    <span class="muted-line">Allow install, commit, or other write-capable subprocesses after the relevant approval step.</span>
                  </span>
                </label>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Delegated agents (ACP)</p>
                  <h3>${renderHeadingWithHelp('Let subscription agents act', 'acpToolsEnabled')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="acpToolsEnabled" type="checkbox" ${acpToolsEnabled ? 'checked' : ''}>
                  <span>
                    <strong>Allow ACP agents to run their own tools</strong>
                    <span class="muted-line">
                      An ACP agent is a subscription you already have — Claude, or ChatGPT via Codex — driven over the Agent Client Protocol.
                      With this off it answers questions but cannot act. With it on it can edit files, run commands, search, and fetch,
                      and <strong>AtlasMind automatically allows each operation without another prompt</strong>.
                    </span>
                  </span>
                </label>
                <p class="muted-line top-gap">
                  The work runs inside the agent's own process, not inside AtlasMind. Turning this setting on is the standing authorization
                  for tool-backed ACP turns, and AtlasMind records every request. It never grants permission inside the agent permanently:
                  where an agent offers &ldquo;always allow&rdquo;, AtlasMind answers &ldquo;allow once&rdquo; instead, so turning this setting
                  off remains sufficient to stop future operations.
                </p>
                ${acpAgentCount === 0
                  ? '<p class="muted-line">No ACP agent is configured yet, so this setting has nothing to govern. Set one up from Model Providers — look for &ldquo;Use my Claude subscription&rdquo;.</p>'
                  : ''}
              </article>

              <article class="settings-card" id="acpConsoleWindowsCard">
                <div class="card-header">
                  <p class="card-kicker">Delegated agents (ACP)</p>
                  <h3>Where ACP console windows appear</h3>
                </div>
                ${acpConsoleChoiceApplies
                  ? `<label class="checkbox-card">
                  <input id="acpHideConsoleWindows" type="checkbox" ${acpHideConsoleWindows ? 'checked' : ''}>
                  <span>
                    <strong>Hide ACP windows on a private Windows desktop</strong>
                    <span class="muted-line">
                      An ACP agent starts models and tools as child processes, and a later Windows shell can otherwise open a blank terminal
                      that takes focus. With this on, one native parent gives the full tree a shared hidden console on a non-visible desktop.
                      VS Code shows the live session in its status bar instead of opening another window.
                    </span>
                  </span>
                </label>
                <p class="muted-line top-gap">
                  Hidden desktops are also used by hVNC malware, so Microsoft Defender or corporate endpoint security may flag or block the
                  launcher — AtlasMind never switches to that desktop or controls it remotely, and it fails visibly rather than silently
                  falling back. Leave this off where policy forbids it.
                </p>
                <div class="button-stack top-gap">
                  <button id="chooseAcpConsoleMode" class="secondary-button">Compare both options</button>
                </div>`
                  : '<p class="muted-line">This choice is Windows-only. On this platform ACP agents do not create console pop-ups, so there is nothing to suppress.</p>'}
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Verification</p>
                  <h3>${renderHeadingWithHelp('Post-write checks', 'autoVerifyAfterWrite')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="autoVerifyAfterWrite" type="checkbox" ${autoVerifyAfterWrite ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Auto verify after writes', 'autoVerifyAfterWrite')}</strong>
                    <span class="muted-line">Run configured verification scripts after file-edit, file-write, and git-apply-patch succeed.</span>
                  </span>
                </label>
                <div class="field-grid top-gap">
                  ${renderFieldLabel('autoVerifyScripts', 'Verification Scripts', 'autoVerifyScripts')}
                  <input id="autoVerifyScripts" type="text" value="${autoVerifyScripts}" placeholder="test, lint" />

                  ${renderFieldLabel('autoVerifyTimeoutMs', 'Verification Timeout (ms)', 'autoVerifyTimeoutMs')}
                  <input id="autoVerifyTimeoutMs" type="number" min="5000" step="1000" value="${autoVerifyTimeoutMs}" />
                </div>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Execution limits</p>
                  <h3>${renderHeadingWithHelp('Agentic loop cap', 'maxToolIterations')}</h3>
                </div>
                <div class="field-grid">
                  ${renderFieldLabel('maxToolIterations', 'Max Tool Iterations', 'maxToolIterations')}
                  <input id="maxToolIterations" type="number" min="1" max="50" step="1" value="${maxToolIterations}" />
                </div>
                <p class="info-note">When the limit is reached AtlasMind shows Continue and Cancel actions so you can extend the run without restarting.</p>
              </article>
            </div>
          </section>

          ${renderTestingPage(testingDashboard, initialPage === 'testing')}

          <section id="page-project" class="settings-page ${initialPage === 'project' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-project" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Project Runs</p>
              <h2>Autonomous run thresholds and reporting</h2>
              <p>Fine-tune the approval thresholds, diff context density, and report location used by <code>/project</code> execution.</p>
            </div>

            <div class="page-grid">
              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Run guardrails</p>
                  <h3>${renderHeadingWithHelp('Thresholds', 'projectApprovalFileThreshold')}</h3>
                </div>
                <div class="field-grid">
                  ${renderFieldLabel('projectApprovalFileThreshold', 'Approval Threshold (files)', 'projectApprovalFileThreshold')}
                  <input id="projectApprovalFileThreshold" type="number" min="1" step="1" value="${projectApprovalFileThreshold}" />

                  ${renderFieldLabel('projectEstimatedFilesPerSubtask', 'Estimated Files Per Subtask', 'projectEstimatedFilesPerSubtask')}
                  <input id="projectEstimatedFilesPerSubtask" type="number" min="1" step="1" value="${projectEstimatedFilesPerSubtask}" />

                  ${renderFieldLabel('projectChangedFileReferenceLimit', 'Changed File Reference Limit', 'projectChangedFileReferenceLimit')}
                  <input id="projectChangedFileReferenceLimit" type="number" min="1" step="1" value="${projectChangedFileReferenceLimit}" />

                  ${renderFieldLabel('projectRunReportFolder', 'Run Report Folder', 'projectRunReportFolder')}
                  <input id="projectRunReportFolder" type="text" value="${projectRunReportFolder}" />
                </div>
                <p class="info-note">Report folders stay workspace-relative and reject absolute paths or traversal sequences.</p>
              </article>

              <article class="settings-card" id="lensDeclarationsCard">
                <div class="card-header">
                  <p class="card-kicker">Lens</p>
                  <h3>Repository declarations</h3>
                </div>
                <p class="card-copy">State Lifecycle and Configuration Resolution use explicit repository files; they do not analyze whichever editor file happens to be active. These are two of the eight Atlas Lenses — open the dashboard to see the rest, what each one reads, and which are ready.</p>
                <div class="stack-list">
                  ${lensDeclarations.files.map(file => `
                    <div class="list-row">
                      <span>
                        <strong>${escapeHtml(file.label)}</strong>
                        <span class="muted-line"><code>${escapeHtml(file.workspacePath)}</code></span>
                      </span>
                      <span class="badge">${escapeHtml(lensDeclarationStatusLabel(file.status))}</span>
                    </div>
                  `).join('')}
                </div>
                <div class="button-stack top-gap">
                  <button id="openLensDashboard" class="secondary-button">Open Atlas Lenses</button>
                  <button id="setupLensDeclarations" class="secondary-button">${lensDeclarations.readyCount === lensDeclarations.totalCount ? 'Review Lens declarations' : 'Set up Lens declarations'}</button>
                </div>
                <p class="info-note">Starter creation is create-only and contains no invented project states, configuration values, or secret data.</p>
              </article>

              <article class="settings-card settings-card-danger">
                <div class="card-header">
                  <p class="card-kicker">Memory lifecycle</p>
                  <h3>Purge imported and manual memory</h3>
                </div>
                <p class="card-copy">Delete the current <code>project_memory</code> tree, recreate the SSOT scaffold, and force AtlasMind to reload from an empty baseline. This is destructive.</p>
                <div class="button-stack">
                  <button id="purgeProjectMemory" class="danger-button">Purge Project Memory</button>
                </div>
                <p class="warning-note">AtlasMind requires two confirmations before deleting workspace memory.</p>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Bootstrap governance</p>
                  <h3>${renderHeadingWithHelp('Dependency monitoring defaults', 'projectDependencyMonitoringEnabled')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="projectDependencyMonitoringEnabled" type="checkbox" ${projectDependencyMonitoringEnabled ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Scaffold dependency monitoring for Atlas-built projects', 'projectDependencyMonitoringEnabled')}</strong>
                    <span class="muted-line">Bootstrap uses these settings when it generates governance files for a new or newly-governed project.</span>
                  </span>
                </label>
                <div class="field-stack top-gap">
                  <span class="field-label field-label-with-help"><span>Supported automation providers</span>${renderHelpIndicator('projectDependencyMonitoringProviders')}</span>
                  <div class="checkbox-list">
                    <label class="checkbox-card compact-checkbox">
                      <input type="checkbox" name="dependencyMonitoringProvider" value="dependabot" ${projectDependencyMonitoringProviders.includes('dependabot') ? 'checked' : ''}>
                      <span>
                        <strong>Dependabot</strong>
                        <span class="muted-line">GitHub-native dependency and GitHub Actions update PRs.</span>
                      </span>
                    </label>
                    <label class="checkbox-card compact-checkbox">
                      <input type="checkbox" name="dependencyMonitoringProvider" value="renovate" ${projectDependencyMonitoringProviders.includes('renovate') ? 'checked' : ''}>
                      <span>
                        <strong>Renovate</strong>
                        <span class="muted-line">Common professional alternative with broader ecosystem support and grouping rules.</span>
                      </span>
                    </label>
                    <label class="checkbox-card compact-checkbox">
                      <input type="checkbox" name="dependencyMonitoringProvider" value="snyk" ${projectDependencyMonitoringProviders.includes('snyk') ? 'checked' : ''}>
                      <span>
                        <strong>Snyk</strong>
                        <span class="muted-line">Security-focused dependency monitoring through a scheduled GitHub workflow that expects a Snyk token.</span>
                      </span>
                    </label>
                    <label class="checkbox-card compact-checkbox">
                      <input type="checkbox" name="dependencyMonitoringProvider" value="azure-devops" ${projectDependencyMonitoringProviders.includes('azure-devops') ? 'checked' : ''}>
                      <span>
                        <strong>Azure DevOps</strong>
                        <span class="muted-line">Scheduled dependency review pipeline scaffold for teams standardizing on Azure Pipelines.</span>
                      </span>
                    </label>
                  </div>
                </div>
                <div class="field-grid top-gap">
                  ${renderFieldLabel('projectDependencyMonitoringSchedule', 'Monitoring cadence', 'projectDependencyMonitoringSchedule')}
                  <select id="projectDependencyMonitoringSchedule">
                    <option value="daily" ${projectDependencyMonitoringSchedule === 'daily' ? 'selected' : ''}>Daily</option>
                    <option value="weekly" ${projectDependencyMonitoringSchedule === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="monthly" ${projectDependencyMonitoringSchedule === 'monthly' ? 'selected' : ''}>Monthly</option>
                  </select>
                </div>
                <label class="checkbox-card top-gap">
                  <input id="projectDependencyMonitoringIssueTemplate" type="checkbox" ${projectDependencyMonitoringIssueTemplate ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Scaffold dependency review issue template', 'projectDependencyMonitoringIssueTemplate')}</strong>
                    <span class="muted-line">Adds a review template so teams can record approval, exceptions, and follow-up actions after dependency drift is detected.</span>
                  </span>
                </label>
                <p class="info-note">AtlasMind also writes SSOT starter docs for dependency policy and operational review history. The built-in set now covers GitHub-native, Renovate, Snyk, and Azure DevOps patterns, and repo-specific services can still be layered in later.</p>
              </article>
            </div>
          </section>

          <section id="page-loop" class="settings-page ${initialPage === 'loop' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-loop" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Mission Loop</p>
              <h2>Autonomous goal-seeking loop defaults</h2>
              <p>Defaults for the <code>/loop</code> command and the Mission Control panel. Every budget value below is a <strong>hard stop</strong> — the loop checks them before each iteration and halts when any is exceeded. These are starting values for new missions; you can still fine-tune each run in Mission Control.</p>
            </div>

            <div class="page-grid">
              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Availability</p>
                  <h3>${renderHeadingWithHelp('Enable the Mission Loop', 'loopEnabled')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="loopEnabled" type="checkbox" ${loopEnabled ? 'checked' : ''}>
                  <span>
                    <strong>Allow autonomous loop runs</strong>
                    <span class="muted-line">When off, <code>/loop</code> and Mission Control will not start a run.</span>
                  </span>
                </label>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Closed parameter envelope</p>
                  <h3>${renderHeadingWithHelp('Hard stops', 'loopDefaultMaxIterations')}</h3>
                </div>
                <div class="field-grid">
                  ${renderFieldLabel('loopDefaultMaxIterations', 'Max iterations', 'loopDefaultMaxIterations')}
                  <input id="loopDefaultMaxIterations" type="number" min="1" max="50" step="1" value="${loopDefaultMaxIterations}" />

                  ${renderFieldLabel('loopDefaultMaxCostUsd', `Cost cap (${loopDisplayCurrency})`, 'loopDefaultMaxCostUsd')}
                  <input id="loopDefaultMaxCostUsd" type="number" min="0.01" step="0.5" value="${loopDefaultMaxCostDisplay}" />

                  ${renderFieldLabel('loopDefaultMaxTokens', 'Token cap', 'loopDefaultMaxTokens')}
                  <input id="loopDefaultMaxTokens" type="text" inputmode="numeric" autocomplete="off" value="${loopDefaultMaxTokensDisplay}" />

                  ${renderFieldLabel('loopDefaultMaxDurationMinutes', 'Time cap (minutes)', 'loopDefaultMaxDurationMinutes')}
                  <input id="loopDefaultMaxDurationMinutes" type="number" min="1" step="1" value="${loopDefaultMaxDurationMinutes}" />

                  ${renderFieldLabel('loopMaxConsecutiveNoProgress', 'No-progress stop (iterations)', 'loopMaxConsecutiveNoProgress')}
                  <input id="loopMaxConsecutiveNoProgress" type="number" min="1" max="10" step="1" value="${loopMaxConsecutiveNoProgress}" />
                </div>
                <p class="info-note">The cost cap is enforced on top of the daily cost limit. The loop also stops the moment the goal is verifiably achieved.</p>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Checkpoints &amp; autonomy</p>
                  <h3>${renderHeadingWithHelp('Approval checkpoints', 'loopCheckpointEveryNIterations')}</h3>
                </div>
                <div class="field-grid">
                  ${renderFieldLabel('loopCheckpointEveryNIterations', 'Checkpoint every N iterations (0 = off)', 'loopCheckpointEveryNIterations')}
                  <input id="loopCheckpointEveryNIterations" type="number" min="0" max="50" step="1" value="${loopCheckpointEveryNIterations}" />

                  ${renderFieldLabel('loopCheckpointAtBudgetFraction', 'Checkpoint at budget fraction', 'loopCheckpointAtBudgetFraction')}
                  <input id="loopCheckpointAtBudgetFraction" type="number" min="0.01" max="1" step="0.05" value="${loopCheckpointAtBudgetFraction}" />
                </div>
                <label class="checkbox-card top-gap">
                  <input id="loopRequireApprovalBeforeWriteBatches" type="checkbox" ${loopRequireApprovalBeforeWriteBatches ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Require approval before write/commit batches', 'loopRequireApprovalBeforeWriteBatches')}</strong>
                    <span class="muted-line">Strongest safety posture; most interruptive.</span>
                  </span>
                </label>
                <p class="info-note">Checkpoints are deny-by-default: if no one approves, the loop stops safely rather than continuing unattended.</p>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Discovery &amp; completion</p>
                  <h3>${renderHeadingWithHelp('How the loop learns and decides "done"', 'loopAllowDiscovery')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="loopAllowDiscovery" type="checkbox" ${loopAllowDiscovery ? 'checked' : ''}>
                  <span>
                    <strong>Allow capability discovery</strong>
                    <span class="muted-line">Synthesize new agents/skills and use Agentic Resource Discovery to fill gaps — always behind the existing approval gates, preferring registered capabilities first.</span>
                  </span>
                </label>
                <div class="field-grid top-gap">
                  ${renderFieldLabel('loopGoalAchievedConfidenceThreshold', 'Goal-achieved confidence threshold', 'loopGoalAchievedConfidenceThreshold')}
                  <input id="loopGoalAchievedConfidenceThreshold" type="number" min="0" max="1" step="0.05" value="${loopGoalAchievedConfidenceThreshold}" />
                </div>
                <p class="info-note">A goal is only accepted as achieved with passing verification and at least this evaluator confidence, so a low-confidence verdict can never falsely declare success.</p>
              </article>
            </div>
          </section>

          <section id="page-mcp" class="settings-page ${initialPage === 'mcp' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-mcp" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">MCP Servers</p>
              <h2>Tools AtlasMind can reach</h2>
              <p>Each connected server contributes tools that agents may call. Enabling or connecting one here widens what AtlasMind can do, so the list shows what is actually running rather than what was once configured.</p>
            </div>

            <div class="page-grid">
              ${mcpServers.length === 0
                ? `<article class="settings-card">
                    <div class="card-header"><p class="card-kicker">Nothing connected</p><h3>No MCP servers yet</h3></div>
                    <p class="muted-line">Add one from the full manager — it has the browse-by-category list, transport setup, and secret entry.</p>
                    <div class="button-stack"><button type="button" class="secondary-button" id="mcpOpenManager">Open the MCP manager</button></div>
                  </article>`
                : mcpServers.map(server => `
                  <article class="settings-card">
                    <div class="card-header">
                      <p class="card-kicker">${escapeHtml(server.transport)} · ${escapeHtml(server.status)}${server.toolCount > 0 ? ` · ${server.toolCount} tool${server.toolCount === 1 ? '' : 's'}` : ''}</p>
                      <h3>${escapeHtml(server.name)}</h3>
                    </div>
                    ${server.error ? `<p class="warning-note">${escapeHtml(server.error)}</p>` : ''}
                    <label class="checkbox-card">
                      <input type="checkbox" data-mcp-enable="${escapeHtml(server.id)}" ${server.enabled ? 'checked' : ''}>
                      <span>
                        <strong>Enabled</strong>
                        <span class="muted-line">Turning this off disconnects the server and withdraws its tools.</span>
                      </span>
                    </label>
                    <div class="button-stack">
                      ${server.status === 'connected'
                        ? `<button type="button" class="secondary-button" data-mcp-disconnect="${escapeHtml(server.id)}">Disconnect</button>`
                        : `<button type="button" class="secondary-button" data-mcp-connect="${escapeHtml(server.id)}" ${server.enabled ? '' : 'disabled'}>Connect</button>`}
                    </div>
                  </article>`).join('')}
            </div>

            ${mcpServers.length > 0 ? `<article class="settings-card">
              <div class="card-header"><p class="card-kicker">Adding and editing</p><h3>Full MCP manager</h3></div>
              <p class="muted-line">Adding a server, changing its transport or arguments, and entering secrets all live in the dedicated panel. They are deliberately not duplicated here — two implementations of one flow drift, and the one that drifts is the one nobody is looking at.</p>
              <div class="button-stack"><button type="button" class="secondary-button" id="mcpOpenManager">Open the MCP manager</button></div>
            </article>` : ''}
          </section>

          <section id="page-buzz" class="settings-page ${initialPage === 'buzz' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-buzz" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Buzz</p>
              <h2>Work with your Buzz workspace</h2>
              <p>Buzz owns identity and messaging; AtlasMind owns reasoning and execution. Each switch below is off until you turn it on, and each one only takes effect when the one above it is already on.</p>
            </div>

            <article class="settings-card" id="buzzGuideCard">
              <div class="card-header">
                <p class="card-kicker">Not sure where to start?</p>
                <h3>Walk me through it</h3>
              </div>
              <p class="muted-line">Opens a guided checklist in chat, built from what is actually configured here: what is done, what is left, and what to do next — including the parts that live outside this page, like running a relay or installing the CLI. It reports; it never switches anything on for you.</p>
              <div class="button-stack">
                <button type="button" class="secondary-button" id="buzzOpenGuide">Guide me through Buzz setup</button>
              </div>
            </article>

            <div class="page-grid">
              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Connection</p>
                  <h3>${renderHeadingWithHelp('Relay', 'buzzEnabled')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="buzzEnabled" type="checkbox" ${buzzEnabled ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Enable the Buzz integration', 'buzzEnabled')}</strong>
                    <span class="muted-line">The master switch. Everything else on this page stays inert until this is on.</span>
                  </span>
                </label>
                <div class="field-grid" data-buzz-depends="buzzEnabled">
                  ${renderFieldLabel('buzzRelayUrl', 'Relay URL', 'buzzRelayUrl')}
                  <input id="buzzRelayUrl" type="text" value="${buzzRelayUrl}" placeholder="ws://localhost:3000" />
                </div>
                <label class="checkbox-card" data-buzz-depends="buzzEnabled">
                  <input id="buzzAllowRemoteRelay" type="checkbox" ${buzzAllowRemoteRelay ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Allow a remote relay', 'buzzAllowRemoteRelay')}</strong>
                    <span class="muted-line">Needed for a hosted Buzz. Project data then leaves this machine.</span>
                  </span>
                </label>
                <p class="info-note">A relay that is not on this machine must be encrypted — a plaintext <code>ws://</code> URL to a remote host is refused, because it would expose both your colleagues' messages and the authentication challenge in transit.</p>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Inbound</p>
                  <h3>${renderHeadingWithHelp('Read-only subscription', 'buzzInboundEnabled')}</h3>
                </div>
                <label class="checkbox-card" data-buzz-depends="buzzEnabled">
                  <input id="buzzInboundEnabled" type="checkbox" ${buzzInboundEnabled ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Watch Buzz activity', 'buzzInboundEnabled')}</strong>
                    <span class="muted-line">Subscribes and derives work items. It can never publish to Buzz.</span>
                  </span>
                </label>
                <div class="field-grid" data-buzz-depends="buzzInboundEnabled">
                  ${renderFieldLabel('buzzInboundChannels', 'Channels to watch', 'buzzInboundChannels')}
                  <textarea id="buzzInboundChannels" rows="3" placeholder="One channel id per line">${buzzInboundChannels}</textarea>
                </div>
                <p class="info-note">An empty list is <strong>not</strong> "no channels" — it scopes the subscription by message kind alone, covering every channel your agent key can already read. List channel ids to narrow it. An authenticating relay needs an agent key before it will accept a subscription at all.</p>
                <p class="info-note">Rather than copying ids out of the Buzz app, press <strong>Fetch my channels</strong> and tick them. It asks the Buzz CLI for the real ids, so a channel id that quietly does not match the channel you posted in — the usual reason a working subscription receives nothing — stops being possible. Needs the CLI installed and your agent key stored; nothing is saved unless you tick and confirm.</p>
                <div class="button-stack">
                  <button type="button" class="secondary-button" id="buzzFetchChannels">Fetch my channels</button>
                  <button type="button" class="secondary-button" id="buzzSetAgentKey">Set Buzz agent key…</button>
                </div>
              </article>

              <article class="settings-card settings-card-warning" data-buzz-depends="buzzInboundEnabled">
                <div class="card-header">
                  <p class="card-kicker">Persistence</p>
                  <h3>${renderHeadingWithHelp('Record follow-ups to project memory', 'buzzAutoCreateFollowUps')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="buzzAutoCreateFollowUps" type="checkbox" ${buzzAutoCreateFollowUps ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Save derived follow-ups', 'buzzAutoCreateFollowUps')}</strong>
                    <span class="muted-line">Writes into <code>project_memory/</code>, which is tracked by git.</span>
                  </span>
                </label>
                <p class="warning-note">Deliberately separate from the switch above: watching a channel should never, on its own, start committing records about your colleagues' conversations. Conversations are <strong>derived, never mirrored</strong> — a message becomes a follow-up with a pointer back to the Buzz thread, never the message body.</p>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Routing</p>
                  <h3>${renderHeadingWithHelp('Agent bindings', 'buzzAgentBindings')}</h3>
                </div>
                ${parsedBuzzBindings.bindings.length
                  ? `<ul class="plain-list">${parsedBuzzBindings.bindings.map(binding =>
                      `<li><code>${escapeHtml(`${binding.pubkey.slice(0, 12)}…`)}</code> → <strong>${escapeHtml(binding.agentIds.join(', '))}</strong>${binding.agentIds.length > 1 ? ' <span class="muted-line">(first owns the work)</span>' : ''}${binding.label ? ` <span class="muted-line">${escapeHtml(binding.label)}</span>` : ''}</li>`).join('')}</ul>`
                  : '<p class="muted-line">No bindings yet. Work from an unbound Buzz identity stays unassigned rather than being routed by guesswork.</p>'}
                ${parsedBuzzBindings.issues.length
                  ? `<p class="warning-note">${parsedBuzzBindings.issues.map(issue =>
                      `Ignored <code>${escapeHtml(issue.input)}</code> — ${escapeHtml(issue.reason)}`).join('<br>')}</p>`
                  : ''}
                <p class="info-note">Bind a person to an agent on the <strong>Project Dashboard → Director</strong> tab: give them the <code>buzz</code> channel, paste their <code>npub…</code> key, and pick an agent.</p>
                <div class="button-stack">
                  <button type="button" class="secondary-button" id="buzzOpenDirector">Open the Director roster</button>
                </div>
              </article>
            </div>
          </section>

          <section id="page-experimental" class="settings-page ${initialPage === 'experimental' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-experimental" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Experimental</p>
              <h2>Higher-risk features</h2>
              <p>Features here are available for exploration, but they increase token spend and require stricter review of results.</p>
            </div>

            <div class="page-grid">
              <article class="settings-card settings-card-warning">
                <div class="card-header">
                  <p class="card-kicker">Drafting</p>
                  <h3>${renderHeadingWithHelp('Atlas-generated skill drafts', 'experimentalSkillLearningEnabled')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="experimentalSkillLearningEnabled" type="checkbox" ${experimentalSkillLearningEnabled ? 'checked' : ''}>
                  <span>
                    <strong>${renderHeadingWithHelp('Enable Atlas-generated skill drafts', 'experimentalSkillLearningEnabled')}</strong>
                    <span class="muted-line">Drafts are scanned before import, but still require manual review before use.</span>
                  </span>
                </label>
                <p class="warning-note">Warning: generated skills can still be wrong or unsafe. Review every draft before enabling it in production workflows.</p>
              </article>
            </div>
          </section>

          <section id="page-ai-instructions" class="settings-page ${initialPage === 'ai-instructions' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-ai-instructions" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">AI Instructions</p>
              <h2>Align instruction sets across your AI tools</h2>
              <p>Reconcile the instruction files used by GitHub Copilot, Claude Code, Cursor, Cline, Continue, OpenAI Codex, Gemini CLI, Windsurf, and Aider — plus AtlasMind's own — into one unified set, then mirror it back into every tool so they all share the same guidance.</p>
            </div>

            <div class="page-grid">
              <article class="settings-card" id="aiInstructionsAlignCard">
                <div class="card-header">
                  <p class="card-kicker">Two-way sync</p>
                  <h3>Align all instruction sets</h3>
                </div>
                <p class="card-copy">AtlasMind reads every detected tool's instructions (and its own), reconciles them into one unified set, and writes that set back into each tool's file — in that tool's own format, inside a managed block so your other content is preserved. Trivial differences are merged automatically; <strong>significant conflicting rules are raised in chat for you to resolve</strong> before anything is written.</p>
                <div class="button-stack">
                  <button id="alignAiInstructions">Align all instruction sets (two-way)</button>
                </div>
                <p class="info-note">Opens the AtlasMind chat and runs <code>/sync-instructions</code>. The unified set is also saved to <code>project_memory/domain/ai-instructions-sync.md</code>.</p>
              </article>

              <article class="settings-card" id="aiInstructionsScanCard">
                <div class="card-header">
                  <p class="card-kicker">One-way import</p>
                  <h3>Scan &amp; import into AtlasMind only</h3>
                </div>
                <p class="card-copy">Prefer not to touch your other tools' files? Scan the workspace and selectively merge the chosen instruction files into AtlasMind's workspace context only — nothing is written back to the other tools.</p>
                <div class="button-stack">
                  <button id="scanAiInstructions">Scan Workspace</button>
                </div>
                <p id="aiInstructionScanStatus" class="info-note" aria-live="polite" style="min-height:1.4em;"></p>
              </article>

              <article class="settings-card" id="aiInstructionsVerifyCard">
                <div class="card-header">
                  <p class="card-kicker">Before each commit</p>
                  <h3>${renderHeadingWithHelp('Keep the managed blocks current', 'instructionsVerifyOnCommit')}</h3>
                </div>
                <label class="checkbox-card">
                  <input id="instructionsVerifyOnCommit" type="checkbox" ${instructionsVerifyOnCommit ? 'checked' : ''}>
                  <span>
                    <strong>Verify AI instruction sets before each commit</strong>
                    <span class="muted-line">Refuse the commit when a managed block no longer matches the file it was generated from.</span>
                  </span>
                </label>
                <p class="card-copy top-gap"><strong>Verify only — this never edits a file.</strong> It refuses and names the command that fixes it, the same way this project already treats a missing version bump. A hook that rewrote files would mean the commit you staged is not the commit that lands; a <em>two-way</em> sync at commit time would pull another agent's edits in and broadcast them to every other tool's file unreviewed.</p>
                <p class="info-note">Covers the blocks generated from files (the testing matrix and the workflow). The debt-marker block comes from a setting, which a git hook cannot read, so it is not checked rather than guessed at. Skip one commit with <code>ATLASMIND_SKIP_INSTRUCTION_CHECK=1</code>. Saved to <strong>workspace</strong> settings, because a git hook cannot see a User-scoped value.</p>
              </article>
            </div>

            <div id="aiInstructionResults" hidden>
              <div class="page-grid">
                <article class="settings-card">
                  <div class="card-header">
                    <p class="card-kicker">Found files</p>
                    <h3>Select instruction sets to sync</h3>
                  </div>
                  <p class="card-copy">Each file found in the workspace is listed below with a content preview. Check the ones you want to merge, then click <strong>Confirm Sync</strong>. AtlasMind writes the merged result to <code>project_memory/domain/ai-instructions-sync.md</code> where it becomes part of the workspace context automatically.</p>
                  <div id="aiInstructionList" class="ai-instruction-list"></div>
                  <div class="button-stack top-gap">
                    <button id="confirmAiSync" disabled>Confirm Sync</button>
                    <button id="rescanAiInstructions" class="secondary-button">Re-scan</button>
                  </div>
                  <p id="aiSyncStatus" class="info-note" aria-live="polite" style="min-height:1.4em;"></p>
                </article>
              </div>
            </div>

            <div id="aiInstructionConfirmed" hidden>
              <div class="page-grid">
                <article class="settings-card">
                  <div class="card-header">
                    <p class="card-kicker">Sync complete</p>
                    <h3>Instruction sets merged</h3>
                  </div>
                  <p id="aiInstructionConfirmedSummary" class="card-copy"></p>
                  <div class="button-stack">
                    <button id="openAtlasInstructions" class="secondary-button">Open Merged Instructions</button>
                    <button id="resetAiInstructionScan" class="secondary-button">Scan again</button>
                  </div>
                  <p class="info-note">The merged instructions are now in <code>project_memory/domain/ai-instructions-sync.md</code>. AtlasMind loads this file as part of its workspace context on the next task.</p>
                </article>
              </div>
            </div>
          </section>

          <section id="page-discovery" class="settings-page ${initialPage === 'discovery' ? 'active fallback-visible' : ''}" role="tabpanel" aria-labelledby="tab-discovery" tabindex="0">
            ${this.buildArdPage()}
          </section>
        </main>
      </div>

      `,
      extraCss:
      `
        /* Palette, page frame and hero come from the shared dashboard theme. */
        code {
          font-family: var(--vscode-editor-font-family, var(--vscode-font-family, monospace));
        }
        .eyebrow,
        .page-kicker,
        .card-kicker {
          margin: 0 0 6px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.74rem;
          color: var(--atlas-panel-muted);
        }
        .settings-hero {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          padding: 20px 22px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 18px;
          background:
            radial-gradient(circle at top right, color-mix(in srgb, var(--atlas-panel-accent) 14%, transparent), transparent 38%),
            linear-gradient(160deg, var(--atlas-panel-surface) 0%, var(--vscode-editor-background) 72%);
          margin-bottom: 18px;
        }
        .settings-hero h1 {
          margin: 0;
          font-size: 1.65rem;
        }
        .hero-copy {
          max-width: 760px;
          margin: 10px 0 0;
          color: var(--atlas-panel-muted);
        }
        .hero-side {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          align-items: flex-end;
          gap: 14px;
          min-width: 220px;
        }
        .hero-version {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid var(--atlas-panel-border);
          background: color-mix(in srgb, var(--atlas-panel-surface-strong) 74%, transparent);
          color: var(--atlas-panel-muted);
          font-size: 0.82rem;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }
        .hero-badges {
          display: flex;
          flex-wrap: wrap;
          align-content: flex-start;
          justify-content: flex-end;
          gap: 10px;
        }
        .hero-badge {
          position: relative;
          display: inline-flex;
          align-items: center;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 999px;
          padding: 6px 12px;
          background: var(--atlas-panel-accent-soft);
          color: var(--vscode-foreground);
          font-size: 0.9rem;
          white-space: nowrap;
        }
        .hero-badge[data-tooltip]::after {
          content: attr(data-tooltip);
          position: absolute;
          right: 0;
          top: calc(100% + 10px);
          width: min(320px, 70vw);
          padding: 10px 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 12px;
          background: var(--atlas-panel-surface-strong);
          color: var(--vscode-foreground);
          line-height: 1.45;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          z-index: 20;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
        }
        .hero-badge[data-tooltip]:hover::after,
        .hero-badge[data-tooltip]:focus-visible::after {
          opacity: 1;
          visibility: visible;
        }
        .settings-layout {
          display: grid;
          grid-template-columns: minmax(220px, 240px) minmax(0, 1fr);
          gap: 18px;
          align-items: start;
        }
        .search-shell {
          display: grid;
          gap: 6px;
          margin: 0 0 18px;
        }
        .search-label {
          font-weight: 600;
        }
        .search-shell input {
          width: 100%;
          box-sizing: border-box;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          padding: 10px 12px;
          border-radius: 12px;
        }
        .search-status {
          min-height: 1.2em;
          margin: 0;
          color: var(--atlas-panel-muted);
          font-size: 0.92rem;
        }
        /* Ten identical pills in one flat column gave no sense of what belonged
           with what. Grouping is decorative only — the tabs themselves are
           unchanged, and the captions are aria-hidden because every tab name is
           already self-describing. */
        .nav-group {
          display: grid;
          gap: 4px;
        }
        .nav-group + .nav-group,
        .nav-link + .nav-group {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid color-mix(in srgb, var(--atlas-panel-border) 60%, transparent);
        }
        .nav-group-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.11em;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
          padding: 0 4px 2px;
        }

        .settings-nav {
          position: sticky;
          top: 20px;
          z-index: 2;
          isolation: isolate;
          display: grid;
          gap: 8px;
          padding: 16px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 18px;
          background: linear-gradient(180deg, var(--atlas-panel-surface-strong), var(--atlas-panel-surface));
        }
        .nav-link {
          display: block;
          width: 100%;
          box-sizing: border-box;
          text-align: left;
          text-decoration: none;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          border-radius: 12px;
          padding: 11px 12px;
          background: transparent;
          color: var(--vscode-foreground);
        }
        .nav-link:hover,
        .nav-link:focus-visible {
          background: var(--atlas-panel-accent-soft);
          border-color: var(--atlas-panel-border);
          outline: none;
        }
        .nav-link.active {
          background: color-mix(in srgb, var(--atlas-panel-accent) 22%, transparent);
          border-color: color-mix(in srgb, var(--atlas-panel-accent) 48%, var(--atlas-panel-border));
        }
        .nav-link.hidden-by-search {
          display: none;
        }
        .settings-main {
          min-width: 0;
        }
        .settings-page {
          display: none;
          scroll-margin-top: 20px;
        }
        .settings-page.fallback-visible {
          display: block;
        }
        .settings-pages-ready .settings-page {
          display: none;
        }
        .settings-pages-ready .settings-page.active {
          display: block;
        }
        .page-header {
          margin-bottom: 14px;
        }
        .page-header h2,
        .card-header h3 {
          margin: 0;
        }
        .page-header p:last-child,
        .card-copy,
        .muted-line,
        .info-note {
          color: var(--atlas-panel-muted);
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .page-grid {
          display: grid;
          gap: 14px;
        }
        .two-up {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .action-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 14px;
        }
        .action-card {
          display: flex;
          flex-direction: column;
          gap: 6px;
          text-align: left;
          padding: 18px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 16px;
          background: linear-gradient(180deg, var(--atlas-panel-surface) 0%, var(--vscode-editor-background) 100%);
        }
        .action-card-primary {
          border-color: color-mix(in srgb, var(--atlas-panel-accent) 42%, var(--atlas-panel-border));
          background: linear-gradient(180deg, color-mix(in srgb, var(--atlas-panel-accent) 10%, var(--atlas-panel-surface)), var(--vscode-editor-background));
        }
        .action-title {
          font-weight: 700;
        }
        .action-copy {
          color: var(--atlas-panel-muted);
          font-size: 0.95rem;
        }
        .settings-card {
          border: 1px solid var(--atlas-panel-border);
          border-radius: 18px;
          padding: 20px;
          background: linear-gradient(180deg, var(--atlas-panel-surface) 0%, var(--vscode-editor-background) 100%);
        }
        .settings-card-warning {
          border-color: color-mix(in srgb, var(--atlas-panel-warning) 55%, var(--atlas-panel-border));
        }
        .settings-card-danger {
          border-color: var(--vscode-inputValidation-errorBorder, #d13438);
          background: color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #d13438) 8%, var(--atlas-panel-surface));
        }
        .agent-policy-card {
          grid-column: 1 / -1;
        }
        .guardrail-block {
          margin: 14px 0 0;
          max-width: 100%;
          padding: 16px;
          overflow: auto;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          word-break: break-word;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 12px;
          color: var(--vscode-editor-foreground);
          background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
          font-family: var(--vscode-editor-font-family, monospace);
          font-size: 0.88rem;
          line-height: 1.55;
          user-select: text;
        }
        .field-grid {
          display: grid;
          grid-template-columns: minmax(220px, 280px) minmax(260px, 1fr);
          gap: 10px 14px;
          align-items: center;
        }
        .danger-button {
          border-color: var(--vscode-inputValidation-errorBorder, #d13438);
          background: color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #d13438) 20%, var(--vscode-button-background));
        }
        .danger-button:hover,
        .danger-button:focus-visible {
          background: color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #d13438) 30%, var(--vscode-button-background));
        }
        .field-stack {
          display: grid;
          gap: 8px;
        }
        .compact-stack {
          margin-top: 14px;
        }
        .field-grid input,
        .field-stack input {
          width: 100%;
          box-sizing: border-box;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          padding: 8px 10px;
          border-radius: 10px;
        }
        .field-grid select {
          width: 100%;
          box-sizing: border-box;
          color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
          background: var(--vscode-dropdown-background, var(--vscode-input-background));
          border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, var(--vscode-widget-border, #444)));
          padding: 8px 10px;
          border-radius: 10px;
        }
        .field-grid label,
        .field-stack label {
          font-weight: 500;
        }
        /* Both of these were undefined anywhere in the panel and relied on the
           shell's blanket "button" fill. That made the *destructive* "Remove"
           in the Agent Finder table the loudest control on the page — louder
           than the Search submit beside it. */
        .primary-button {
          border: 1px solid transparent;
          border-radius: 10px;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          padding: 8px 14px;
          font-weight: 600;
        }
        .primary-button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }

        /* A quiet, destructive-toned text action — the weight a "Remove" in a
           table row should carry. Mirrors mcpPanel.ts's .link-button. */
        .link-button {
          background: none;
          border: none;
          padding: 0;
          font: inherit;
          cursor: pointer;
          color: var(--vscode-errorForeground, #f48771);
          text-decoration: underline;
        }
        .link-button:hover { opacity: 0.8; }
        .link-button:focus-visible { outline: 2px solid var(--atlas-panel-accent); outline-offset: 2px; }

        .secondary-button {
          border: 1px solid var(--atlas-panel-border);
          border-radius: 10px;
          background: var(--atlas-panel-surface-strong);
          color: var(--vscode-foreground);
          padding: 8px 12px;
        }
        .secondary-button:hover,
        .secondary-button:focus-visible {
          border-color: color-mix(in srgb, var(--atlas-panel-accent) 48%, var(--atlas-panel-border));
          outline: none;
        }
        .label-with-help,
        .field-label-with-help,
        .heading-with-help {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .field-label-with-help {
          font-weight: 500;
        }
        .help-indicator {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 999px;
          background: var(--atlas-panel-accent-soft);
          color: var(--vscode-foreground);
          font-size: 0.78rem;
          font-weight: 700;
          cursor: help;
          flex: 0 0 auto;
        }
        .help-indicator::after {
          content: attr(data-tooltip);
          position: absolute;
          left: calc(100% + 10px);
          top: 50%;
          transform: translateY(-50%);
          width: min(360px, 60vw);
          padding: 10px 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 12px;
          background: var(--atlas-panel-surface-strong);
          color: var(--vscode-foreground);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
          white-space: normal;
          line-height: 1.45;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          z-index: 20;
        }
        .help-indicator:hover::after,
        .help-indicator:focus-visible::after {
          opacity: 1;
          visibility: visible;
        }
        .help-indicator:focus-visible {
          outline: 1px solid color-mix(in srgb, var(--atlas-panel-accent) 70%, white 30%);
          outline-offset: 2px;
        }
        .choice-cluster {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 10px;
        }
        .choice-pill {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 999px;
          background: var(--atlas-panel-surface-strong);
          cursor: pointer;
        }
        .choice-pill[data-tooltip]::after {
          content: attr(data-tooltip);
          position: absolute;
          left: 0;
          top: calc(100% + 10px);
          width: min(360px, 72vw);
          padding: 10px 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 12px;
          background: var(--atlas-panel-surface-strong);
          color: var(--vscode-foreground);
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
          line-height: 1.45;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          z-index: 20;
        }
        .choice-pill[data-tooltip]:hover::after,
        .choice-pill[data-tooltip]:focus-within::after {
          opacity: 1;
          visibility: visible;
        }
        .choice-pill input {
          margin: 0;
        }
        .local-endpoints-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }
        .local-endpoint-add {
          min-width: 40px;
          padding: 6px 12px;
          font-size: 1.2rem;
          line-height: 1;
        }
        .local-endpoint-add-wrapper {
          position: relative;
        }
        .endpoint-preset-menu {
          position: absolute;
          right: 0;
          top: 100%;
          z-index: 10;
          margin: 4px 0 0;
          padding: 4px 0;
          min-width: 210px;
          list-style: none;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 10px;
          background: var(--atlas-panel-surface-strong, #1e1e2e);
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
        }
        .endpoint-preset-menu[hidden] {
          display: none;
        }
        .endpoint-preset-menu li {
          display: grid;
          grid-template-columns: 1fr;
        }
        .endpoint-preset-menu button {
          display: flex;
          flex-direction: column;
          gap: 1px;
          width: 100%;
          padding: 7px 14px;
          border: none;
          background: transparent;
          color: var(--vscode-foreground);
          font: inherit;
          font-size: 0.92rem;
          text-align: left;
          cursor: pointer;
        }
        .endpoint-preset-menu button:hover,
        .endpoint-preset-menu button:focus-visible {
          background: color-mix(in srgb, var(--atlas-panel-accent) 18%, transparent);
          outline: none;
        }
        .endpoint-preset-menu .preset-hint {
          font-size: 0.78rem;
          color: var(--atlas-panel-muted);
        }
        .endpoint-preset-menu .preset-separator {
          height: 1px;
          margin: 4px 10px;
          background: var(--atlas-panel-border);
        }
        .local-endpoints-list {
          display: grid;
          gap: 10px;
        }
        .local-endpoint-row {
          display: grid;
          grid-template-columns: minmax(140px, 180px) minmax(0, 1fr) auto;
          gap: 10px;
          align-items: end;
          padding: 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 14px;
          background: color-mix(in srgb, var(--atlas-panel-surface-strong) 74%, transparent);
        }
        .local-endpoint-field {
          display: grid;
          gap: 6px;
        }
        .local-endpoint-field label {
          font-size: 0.88rem;
          color: var(--atlas-panel-muted);
        }
        .local-endpoint-remove {
          align-self: center;
          min-width: 40px;
          padding: 8px 10px;
        }
        .local-endpoints-empty {
          margin: 0;
          padding: 12px;
          border: 1px dashed var(--atlas-panel-border);
          border-radius: 14px;
          color: var(--atlas-panel-muted);
          background: color-mix(in srgb, var(--atlas-panel-surface) 65%, transparent);
        }
        .model-sidebar-hidden-list {
          display: grid;
          gap: 10px;
          margin-top: 14px;
        }
        .model-sidebar-hidden-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
          justify-content: space-between;
          min-width: 0;
          padding: 12px 14px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 14px;
          background: color-mix(in srgb, var(--atlas-panel-surface-strong) 74%, transparent);
        }
        .model-sidebar-hidden-copy {
          display: grid;
          flex: 1 1 260px;
          gap: 3px;
          min-width: 0;
        }
        .model-sidebar-hidden-copy strong {
          overflow-wrap: break-word;
          word-break: normal;
        }
        .model-sidebar-hidden-copy .muted-line {
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .model-sidebar-hidden-kind {
          color: var(--atlas-panel-muted);
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .model-sidebar-restore {
          flex: 0 0 auto;
        }
        .model-sidebar-empty {
          margin: 14px 0 0;
          padding: 12px 14px;
          border: 1px dashed var(--atlas-panel-border);
          border-radius: 14px;
          color: var(--atlas-panel-muted);
        }
        .local-model-recommendation-results {
          margin-top: 10px;
          display: grid;
          gap: 10px;
        }
        .local-model-summary {
          padding: 10px 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 12px;
          background: color-mix(in srgb, var(--atlas-panel-surface) 72%, transparent);
        }
        .local-model-summary p {
          margin: 0;
        }
        .local-model-summary p + p {
          margin-top: 6px;
        }
        .local-model-recommendation-card {
          padding: 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 12px;
          background: color-mix(in srgb, var(--atlas-panel-surface-strong) 74%, transparent);
        }
        .local-model-recommendation-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .local-model-recommendation-header h4 {
          margin: 0;
          font-size: 1rem;
        }
        .local-model-recommendation-meta {
          margin: 8px 0;
          color: var(--atlas-panel-muted);
        }
        .local-model-recommendation-card ul {
          margin: 0;
          padding-left: 16px;
          display: grid;
          gap: 4px;
        }
        .local-model-install-hint {
          margin: 10px 0 0;
        }
        .local-model-actions {
          margin-top: 10px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .local-model-installed {
          margin-top: 6px;
          padding: 12px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 12px;
          background: color-mix(in srgb, var(--atlas-panel-surface) 72%, transparent);
          display: grid;
          gap: 8px;
        }
        .local-model-installed h4 {
          margin: 0;
        }
        .local-model-installed-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 8px 0;
          border-top: 1px solid color-mix(in srgb, var(--atlas-panel-border) 70%, transparent);
        }
        .local-model-installed-row:first-of-type {
          border-top: none;
        }
        .local-model-runtime-note {
          color: var(--atlas-panel-muted);
          font-size: 0.88rem;
        }
        .local-model-badge {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 3px 9px;
          font-size: 0.78rem;
          border: 1px solid var(--atlas-panel-border);
          white-space: nowrap;
        }
        .local-model-badge-installed {
          background: color-mix(in srgb, var(--vscode-testing-iconPassed) 18%, transparent);
        }
        .local-model-badge-recommended {
          background: color-mix(in srgb, var(--atlas-panel-accent) 22%, transparent);
        }
        .local-model-empty {
          margin: 0;
          padding: 12px;
          border: 1px dashed var(--atlas-panel-border);
          border-radius: 12px;
          color: var(--atlas-panel-muted);
        }
        .checkbox-card {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 10px;
          align-items: start;
          padding: 12px 14px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 14px;
          background: color-mix(in srgb, var(--atlas-panel-surface-strong) 74%, transparent);
        }
        .checkbox-card strong {
          display: block;
          margin-bottom: 2px;
        }
        .checkbox-card input {
          margin-top: 2px;
        }
        .muted-line {
          display: block;
          font-size: 0.94rem;
        }
        .button-stack {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 14px;
        }
        .stat-card {
          border: 1px solid var(--atlas-panel-border);
          border-radius: 14px;
          padding: 14px;
          background: color-mix(in srgb, var(--atlas-panel-surface-strong) 76%, transparent);
        }
        .stat-label {
          display: block;
          margin-bottom: 6px;
          color: var(--atlas-panel-muted);
          font-size: 0.88rem;
        }
        .stat-value {
          font-size: 1.35rem;
          font-weight: 700;
        }
        .stat-meta {
          margin-top: 4px;
          color: var(--atlas-panel-muted);
          font-size: 0.88rem;
        }
        .inline-chip-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .info-chip {
          display: inline-flex;
          align-items: center;
          padding: 5px 10px;
          border-radius: 999px;
          border: 1px solid var(--atlas-panel-border);
          background: color-mix(in srgb, var(--atlas-panel-accent) 12%, transparent);
          font-size: 0.88rem;
        }
        .test-file-list {
          display: grid;
          gap: 10px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        /* ── Testing Methodology Matrix ───────────────────── */
        ${renderTestingPageStyles()}
        .test-file-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          padding: 12px 14px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 14px;
          background: color-mix(in srgb, var(--atlas-panel-surface-strong) 74%, transparent);
        }
        .test-file-title {
          font-weight: 600;
        }
        .test-file-path,
        .mini-meta {
          color: var(--atlas-panel-muted);
          font-size: 0.9rem;
        }
        .mini-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 4px;
        }
        .checkbox-list {
          display: grid;
          gap: 10px;
        }
        .compact-checkbox {
          padding: 10px 12px;
        }
        .field-label {
          font-weight: 500;
        }
        .top-gap {
          margin-top: 14px;
        }
        .info-band {
          margin-top: 14px;
          padding: 12px 14px;
          border-radius: 14px;
          background: color-mix(in srgb, var(--atlas-panel-accent) 10%, transparent);
          border: 1px solid var(--atlas-panel-border);
        }
        .warning-note {
          margin-top: 14px;
          padding: 12px 14px;
          border-left: 3px solid var(--atlas-panel-warning);
          background: color-mix(in srgb, var(--atlas-panel-warning) 10%, transparent);
          border-radius: 12px;
        }
        input:focus-visible,
        select:focus-visible,
        button:focus-visible {
          outline: 2px solid var(--atlas-panel-accent);
          outline-offset: 2px;
        }
        @media (max-width: 920px) {
          .settings-layout,
          .two-up,
          .action-grid,
          .stats-grid {
            grid-template-columns: 1fr;
          }
          .settings-nav {
            position: static;
          }
        }
        @media (max-width: 720px) {
          .settings-hero {
            flex-direction: column;
          }
          .field-grid {
            grid-template-columns: 1fr;
          }
          .local-endpoint-row,
          .test-file-row {
            grid-template-columns: 1fr;
          }
          .hero-badges {
            justify-content: flex-start;
          }
        }
        .catalogue-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          min-height: 1.5rem;
        }
        .catalogue-badge {
          display: inline-flex;
          align-items: center;
          padding: 3px 10px;
          border-radius: 999px;
          border: 1px solid var(--atlas-panel-border);
          font-size: 0.78rem;
          background: color-mix(in srgb, var(--accent-soft) 65%, transparent);
        }
        .catalogue-badge.official { border-color: color-mix(in srgb, #4caf50 55%, var(--atlas-panel-border)); }
        .catalogue-badge.community { border-color: color-mix(in srgb, #03a9f4 55%, var(--atlas-panel-border)); }
        .catalogue-badge.registry { border-color: color-mix(in srgb, #ff9800 55%, var(--atlas-panel-border)); }
        .catalogue-badge.archived { border-color: color-mix(in srgb, #9e9e9e 65%, var(--atlas-panel-border)); }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        .ai-instruction-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 8px;
        }
        .ai-instruction-row {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 10px;
          align-items: start;
          padding: 12px 14px;
          border: 1px solid var(--atlas-panel-border);
          border-radius: 14px;
          background: color-mix(in srgb, var(--atlas-panel-surface) 65%, transparent);
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
        }
        .ai-instruction-row.ai-instruction-row-checked {
          border-color: var(--atlas-panel-accent);
          background: var(--atlas-panel-accent-soft);
        }
        .ai-instruction-row input[type="checkbox"] {
          margin-top: 3px;
          cursor: pointer;
        }
        .ai-instruction-meta {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ai-instruction-tool {
          font-size: 0.8rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--atlas-panel-muted);
        }
        .ai-instruction-path {
          display: inline;
          background: none;
          border: none;
          padding: 0;
          font-size: 0.9rem;
          font-family: var(--vscode-editor-font-family, monospace);
          color: var(--atlas-panel-accent);
          cursor: pointer;
          text-decoration: underline;
          text-align: left;
        }
        .ai-instruction-path:hover { opacity: 0.8; }
        .ai-instruction-preview {
          font-size: 0.83rem;
          color: var(--atlas-panel-muted);
          white-space: pre-line;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          margin: 0;
        }
        .ai-instruction-size {
          font-size: 0.78rem;
          color: var(--atlas-panel-muted);
          white-space: nowrap;
          padding-top: 2px;
        }
        .ai-instruction-empty {
          margin: 0;
          padding: 16px;
          border: 1px dashed var(--atlas-panel-border);
          border-radius: 14px;
          color: var(--atlas-panel-muted);
          text-align: center;
        }
        .ard-form {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          margin: 8px 0;
        }
        .ard-form input[type="search"],
        .ard-form input[type="text"],
        .ard-form input[type="url"],
        .ard-form select {
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border, var(--atlas-panel-border));
          padding: 6px 9px;
          border-radius: 6px;
          min-width: 220px;
          flex: 1 1 220px;
        }
        .ard-inline { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
        .ard-status {
          margin: 0 0 14px;
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid var(--atlas-panel-border);
        }
        .ard-status-success { border-color: color-mix(in srgb, #4caf50 55%, var(--atlas-panel-border)); }
        .ard-status-warning { border-color: var(--atlas-panel-warning); }
        .ard-status-error { border-color: color-mix(in srgb, #f44336 60%, var(--atlas-panel-border)); }
        .ard-status-info { border-color: var(--atlas-panel-accent); }
        .ard-results { display: flex; flex-direction: column; gap: 10px; }
        .ard-result-card {
          border: 1px solid var(--atlas-panel-border);
          border-radius: 12px;
          padding: 12px 14px;
          background: var(--atlas-panel-surface);
        }
        .ard-result-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .ard-result-meta { color: var(--atlas-panel-muted); font-size: 0.82rem; margin-top: 4px; }
        .ard-result-desc { margin: 8px 0; }
        .ard-result-url { font-size: 0.82rem; margin-top: 4px; }
        .plain-list { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 4px; }
        .plain-list li { font-size: 0.86rem; }
        /* A gate whose parent switch is off: still readable, visibly not in force. */
        .settings-page [data-buzz-depends].is-inert { opacity: 0.55; }
        .ard-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
        .ard-chip {
          background: var(--atlas-panel-accent-soft);
          border-radius: 999px;
          padding: 2px 9px;
          font-size: 0.78rem;
        }
        .badge.ard-type { background: var(--atlas-panel-surface-strong); color: var(--vscode-foreground); }
        .badge.ard-score { background: var(--vscode-charts-blue, #36c); color: #fff; }
        .badge.ard-trust { background: var(--vscode-charts-purple, #93c); color: #fff; }
        .badge.ard-warn { background: var(--atlas-panel-warning); color: #1a1a1a; }
        .ard-table th, .ard-table td { vertical-align: top; }
      `,
      scriptContent:
      `
        // MCP server catalogue data injected from backend
        const recommendedMcpServers = ${JSON.stringify(RECOMMENDED_MCP_SERVERS.map(server => ({
          ...server,
          starter: getRecommendedMcpStarterDetails(server.id),
        })))};
                // MCP server catalogue UI logic
                const mcpServerCatalogue = document.getElementById('mcpServerCatalogue');
                const mcpServerBadges = document.getElementById('mcpServerBadges');
                const mcpServerDescription = document.getElementById('mcpServerDescription');
                const installMcpServerBtn = document.getElementById('installMcpServer');
                const mcpServerDocs = document.getElementById('mcpServerDocs');
                let selectedMcpServer = null;

                function getMcpProvenanceLabel(provenance) {
                  switch (provenance) {
                    case 'official': return 'Official';
                    case 'community': return 'Community';
                    case 'archived': return 'Archived reference';
                    default: return 'Registry fallback';
                  }
                }

                function getMcpProvenanceHint(provenance) {
                  switch (provenance) {
                    case 'official': return 'Verified first-party documentation and upstream reference.';
                    case 'community': return 'Community-maintained integration; review its upstream guidance before use.';
                    case 'archived': return 'Historical example that still resolves, but it is no longer actively maintained.';
                    default: return 'AtlasMind could confirm the MCP catalogue entry, but not a stable vendor-specific install guide.';
                  }
                }

                function getMcpSetupLabel(server) {
                  return server?.starter?.setupMode === 'prefill' ? 'AtlasMind-ready' : 'Manual setup';
                }

                function getMcpInstallActionLabel(server) {
                  return server?.starter?.setupMode === 'prefill' ? 'Install & Connect' : 'Open in Add Server';
                }

                function getMcpPendingActionLabel(server) {
                  return server?.starter?.setupMode === 'prefill' ? 'Installing...' : 'Opening...';
                }

                function renderMcpServerBadges(server) {
                  if (!(mcpServerBadges instanceof HTMLElement)) return;
                  mcpServerBadges.innerHTML = '';
                  if (!server) return;
                  const badge = document.createElement('span');
                  badge.className = 'catalogue-badge ' + (server.provenance || 'registry');
                  badge.textContent = getMcpProvenanceLabel(server.provenance);
                  badge.title = getMcpProvenanceHint(server.provenance);
                  mcpServerBadges.appendChild(badge);

                  const setupBadge = document.createElement('span');
                  setupBadge.className = 'catalogue-badge ' + (server?.starter?.setupMode === 'prefill' ? 'official' : 'archived');
                  setupBadge.textContent = getMcpSetupLabel(server);
                  setupBadge.title = server?.starter?.note || 'Review the linked setup guide before connecting this preset.';
                  mcpServerBadges.appendChild(setupBadge);
                }

                function updateMcpServerCatalogue() {
                  if (!(mcpServerCatalogue instanceof HTMLSelectElement)) return;
                  mcpServerCatalogue.innerHTML = '';
                  recommendedMcpServers.forEach((server, idx) => {
                    const opt = document.createElement('option');
                    opt.value = server.id;
                    opt.textContent = server.name + ' · ' + getMcpProvenanceLabel(server.provenance) + ' · ' + getMcpSetupLabel(server);
                    mcpServerCatalogue.appendChild(opt);
                  });
                  if (recommendedMcpServers.length > 0) {
                    mcpServerCatalogue.selectedIndex = 0;
                    setSelectedMcpServer(recommendedMcpServers[0].id);
                  }
                }

                function setSelectedMcpServer(serverId) {
                  selectedMcpServer = recommendedMcpServers.find(s => s.id === serverId) || null;
                  if (selectedMcpServer) {
                    renderMcpServerBadges(selectedMcpServer);
                    if (mcpServerDescription) {
                      mcpServerDescription.textContent = selectedMcpServer.description + ' ' + getMcpProvenanceHint(selectedMcpServer.provenance) + ' ' + (selectedMcpServer?.starter?.note || '');
                    }
                    if (installMcpServerBtn) {
                      installMcpServerBtn.disabled = false;
                      installMcpServerBtn.textContent = getMcpInstallActionLabel(selectedMcpServer);
                    }
                    if (mcpServerDocs) {
                      mcpServerDocs.href = selectedMcpServer.docsUrl;
                      mcpServerDocs.style.display = 'inline-block';
                    }
                  } else {
                    renderMcpServerBadges(null);
                    if (mcpServerDescription) mcpServerDescription.textContent = '';
                    if (installMcpServerBtn) installMcpServerBtn.disabled = true;
                    if (mcpServerDocs) mcpServerDocs.style.display = 'none';
                  }
                }

                if (mcpServerCatalogue instanceof HTMLSelectElement) {
                  mcpServerCatalogue.addEventListener('change', () => {
                    setSelectedMcpServer(mcpServerCatalogue.value);
                  });
                }
                if (installMcpServerBtn instanceof HTMLButtonElement) {
                  installMcpServerBtn.addEventListener('click', () => {
                    if (selectedMcpServer) {
                      vscode.postMessage({ type: 'installMcpServer', payload: selectedMcpServer });
                      installMcpServerBtn.disabled = true;
                      installMcpServerBtn.textContent = getMcpPendingActionLabel(selectedMcpServer);
                    }
                  });
                }
                window.addEventListener('message', event => {
                  const message = event.data;
                  if (!message || typeof message !== 'object' || message.type !== 'status') {
                    return;
                  }
                  const payload = typeof message.payload === 'string' ? message.payload : '';
                  if (payload && mcpServerDescription) {
                    mcpServerDescription.textContent = payload;
                  }
                  if (installMcpServerBtn instanceof HTMLButtonElement) {
                    installMcpServerBtn.disabled = false;
                    installMcpServerBtn.textContent = getMcpInstallActionLabel(selectedMcpServer);
                  }
                });
                updateMcpServerCatalogue();
        const vscode = acquireVsCodeApi();
        function createLocalEndpointId() {
          return 'endpoint-' + Math.random().toString(36).slice(2, 10);
        }
        const initialLocalOpenAiEndpoints = ${serializedLocalOpenAiEndpoints};

        const navButtons = Array.from(document.querySelectorAll('[data-page-target]'));
        const pages = Array.from(document.querySelectorAll('.settings-page'));
        const searchInput = document.getElementById('settingsSearch');
        const searchStatus = document.getElementById('searchStatus');
        const knownPages = new Set(${JSON.stringify(SETTINGS_PAGE_IDS)});

        function focusSection(sectionId) {
          if (typeof sectionId !== 'string' || sectionId.trim().length === 0) {
            return;
          }
          const section = document.getElementById(sectionId);
          if (!(section instanceof HTMLElement)) {
            return;
          }
          section.scrollIntoView({ block: 'start', behavior: 'auto' });
        }

        function activatePage(pageId, options = {}) {
          const focusPanel = options.focusPanel === true;
          const resolvedPageId = knownPages.has(pageId) ? pageId : 'overview';
          navButtons.forEach(button => {
            if (!(button instanceof HTMLElement)) {
              return;
            }
            const isActive = button.dataset.pageTarget === resolvedPageId;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
            button.tabIndex = isActive ? 0 : -1;
            if (focusPanel && isActive) {
              button.focus();
            }
          });

          pages.forEach(page => {
            if (!(page instanceof HTMLElement)) {
              return;
            }
            const isActive = page.id === 'page-' + resolvedPageId;
            page.classList.toggle('active', isActive);
            page.hidden = !isActive;
          });

          const state = vscode.getState() ?? {};
          vscode.setState({ ...state, activePage: resolvedPageId });
        }

        function updateSearch(query, options = {}) {
          const normalized = typeof query === 'string' ? query.trim().toLowerCase() : '';
          // Every word must appear, rather than the whole phrase as one string.
          // A setting is most often searched for by the name it has in the VS
          // Code settings UI — "acp: hide console windows" — and as a substring
          // that matches nothing, because keyword lists are written as keywords.
          // Punctuation goes the same way: a trailing colon should not be the
          // reason a page is hidden.
          const terms = normalized.split(/[^a-z0-9.+#-]+/).filter(term => term.length > 0);
          let visibleCount = 0;

          navButtons.forEach(button => {
            if (!(button instanceof HTMLElement)) {
              return;
            }
            const haystack = ((button.textContent ?? '') + ' ' + (button.dataset.search ?? '')).toLowerCase();
            const matches = terms.length === 0 || terms.every(term => haystack.includes(term));
            button.classList.toggle('hidden-by-search', !matches);
            if (matches) {
              visibleCount += 1;
            }
          });

          if (searchStatus instanceof HTMLElement) {
            if (normalized.length === 0) {
              searchStatus.textContent = 'Browse by page or search for a control.';
            } else if (visibleCount === 0) {
              searchStatus.textContent = 'No settings pages matched that search.';
            } else if (visibleCount === 1) {
              searchStatus.textContent = '1 matching settings page.';
            } else {
              searchStatus.textContent = visibleCount + ' matching settings pages.';
            }
          }

          const currentActive = navButtons.find(button => button instanceof HTMLElement && button.classList.contains('active') && !button.classList.contains('hidden-by-search'));
          if (!currentActive && visibleCount > 0) {
            const firstVisible = navButtons.find(button => button instanceof HTMLElement && !button.classList.contains('hidden-by-search'));
            if (firstVisible instanceof HTMLElement) {
              activatePage(firstVisible.dataset.pageTarget ?? 'overview', options);
            }
          }

          const state = vscode.getState() ?? {};
          vscode.setState({ ...state, searchQuery: normalized });
        }

        navButtons.forEach((button, index) => {
          if (!(button instanceof HTMLElement)) {
            return;
          }
          button.addEventListener('click', event => {
            event.preventDefault();
            activatePage(button.dataset.pageTarget ?? 'overview');
          });
          button.addEventListener('keydown', event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
              return;
            }

            event.preventDefault();
            let nextIndex = index;
            if (event.key === 'ArrowDown') {
              nextIndex = (index + 1) % navButtons.length;
            } else if (event.key === 'ArrowUp') {
              nextIndex = (index - 1 + navButtons.length) % navButtons.length;
            } else if (event.key === 'Home') {
              nextIndex = 0;
            } else if (event.key === 'End') {
              nextIndex = navButtons.length - 1;
            }

            const nextButton = navButtons[nextIndex];
            if (nextButton instanceof HTMLElement) {
              activatePage(nextButton.dataset.pageTarget ?? 'overview', { focusPanel: true });
            }
          });
        });

        const savedState = vscode.getState();
        const initialPage = ${JSON.stringify(initialPage)};
        const hasExplicitInitialPage = ${JSON.stringify(hasExplicitInitialPage)};
        const initialSection = ${initialSection};
        const restoredPage = typeof savedState?.activePage === 'string' && knownPages.has(savedState.activePage)
          ? savedState.activePage
          : undefined;
        const startupPage = (hasExplicitInitialPage ? initialPage : restoredPage) ?? initialPage;
        activatePage(startupPage);
        if (searchInput instanceof HTMLInputElement) {
          const startingQuery = typeof savedState?.searchQuery === 'string' && savedState.searchQuery.length > 0
            ? savedState.searchQuery
            : searchInput.value;
          if (startingQuery.length > 0) {
            searchInput.value = startingQuery;
          }
          updateSearch(startingQuery);
          searchInput.addEventListener('input', () => {
            updateSearch(searchInput.value);
          });
        }
        if (typeof initialSection === 'string' && initialSection.length > 0) {
          focusSection(initialSection);
        }
        let localEndpointRows = [];
        let renderLocalEndpoints = () => {};
        let experimentalSkillLearningEnabled = null;

        try {
          function bindCommandButton(id, messageType) {
            const element = document.getElementById(id);
            if (!(element instanceof HTMLButtonElement)) {
              return;
            }
            element.addEventListener('click', () => {
              vscode.postMessage({ type: messageType });
            });
          }

          bindCommandButton('openChatView', 'openChatView');
          bindCommandButton('openChatPanel', 'openChatPanel');
          bindCommandButton('openChat', 'openChat');
          bindCommandButton('openAgentManagerOverview', 'openAgentPanel');
          bindCommandButton('openAgentManager', 'openAgentPanel');
          bindCommandButton('openAgentModelProviders', 'openModelProviders');
          bindCommandButton('openPersonalityProfileOverview', 'openPersonalityProfile');
          bindCommandButton('openPersonalityProfileModels', 'openPersonalityProfile');
          bindCommandButton('openModelProviders', 'openModelProviders');
          bindCommandButton('openSpecialistIntegrations', 'openSpecialistIntegrations');
          bindCommandButton('openProjectRunCenter', 'openProjectRunCenter');
          bindCommandButton('openLensDashboard', 'openLensDashboard');
          bindCommandButton('setupLensDeclarations', 'setupLensDeclarations');
          bindCommandButton('openCompareModels', 'openCompareModels');
          bindCommandButton('openVoicePanel', 'openVoicePanel');
          bindCommandButton('openVisionPanel', 'openVisionPanel');
          bindCommandButton('chooseAcpConsoleMode', 'chooseAcpConsoleMode');
          bindCommandButton('scanLocalModelRecommendations', 'recommendLocalModels');
          bindCommandButton('purgeProjectMemory', 'purgeProjectMemory');
          bindCommandButton('refreshTestingInventory', 'refreshTestingInventory');
          // syncTestingProtocols and scaffoldTestingFramework are deliberately
          // NOT bound here: they are bound below with a busy state. Binding in
          // both places would post the message twice and run the whole scaffold
          // — filesystem pass, instruction sync and agent task — a second time
          // on one click.
          bindCommandButton('createTestFile', 'createTestFile');
          bindCommandButton('openCoverageReport', 'openCoverageReport');

          document.querySelectorAll('[data-restore-model-sidebar-entry]').forEach(element => {
            if (!(element instanceof HTMLButtonElement)) {
              return;
            }
            element.addEventListener('click', () => {
              const entryKey = element.dataset.restoreModelSidebarEntry;
              if (!entryKey) {
                return;
              }
              element.disabled = true;
              element.textContent = 'Restoring…';
              vscode.postMessage({ type: 'restoreModelSidebarEntry', payload: entryKey });
            });
          });

          (function() {
            const saveBtn = document.getElementById('saveTestingStrategy');
            if (!saveBtn) return;
            saveBtn.addEventListener('click', function() {
              const rows = document.querySelectorAll('.methodology-row');
              const methodologies = Array.from(rows).map(function(row) {
                const id = row.getAttribute('data-methodology-id');
                const checkbox = row.querySelector('.methodology-enabled-checkbox');
                const agentSel = row.querySelector('.methodology-agent-select');
                const modelInput = row.querySelector('.methodology-model-input');
                const notesInput = row.querySelector('.methodology-notes-input');
                return {
                  id: id,
                  enabled: checkbox ? checkbox.checked : false,
                  assignedAgentId: agentSel && agentSel.value ? agentSel.value : undefined,
                  assignedModelId: modelInput && modelInput.value.trim() ? modelInput.value.trim() : undefined,
                  notes: notesInput && notesInput.value.trim() ? notesInput.value.trim() : undefined,
                };
              });
              vscode.postMessage({ type: 'saveTestingConfig', payload: { version: 1, updatedAt: new Date().toISOString(), methodologies: methodologies } });
              saveBtn.textContent = 'Saved ✓';
              setTimeout(function() { saveBtn.textContent = 'Save Testing Strategy'; }, 2000);
            });
            document.querySelectorAll('.methodology-enabled-checkbox').forEach(function(cb) {
              cb.addEventListener('change', function() {
                const row = cb.closest('.methodology-row');
                if (row) { row.classList.toggle('methodology-enabled', cb.checked); }
              });
            });

            document.querySelectorAll('.methodology-info-btn').forEach(function(btn) {
              btn.addEventListener('click', function() {
                const targetId = btn.getAttribute('data-info-target');
                if (!targetId) return;
                const infoRow = document.getElementById(targetId);
                if (!infoRow) return;
                const isExpanded = btn.getAttribute('aria-expanded') === 'true';
                infoRow.style.display = isExpanded ? 'none' : '';
                btn.setAttribute('aria-expanded', String(!isExpanded));
                btn.classList.toggle('methodology-info-btn--open', !isExpanded);
              });
            });

            // Busy state for the three long Testing actions. Scaffolding runs a
            // filesystem pass, an outbound instruction sync, and sometimes an
            // agent task, so a button that looked idle throughout invited a
            // second click that would run the whole thing again.
            //
            // Safe to disable only because the host repaints on every path,
            // including cancellations and errors. A busy label with a
            // conditional reset is how a control ends up permanently dead
            // after a dismissed dialog.
            [
              ['autoAssessTestingConfig', 'Assessing…'],
              ['scaffoldTestingFramework', 'Scaffolding…'],
              ['syncTestingProtocols', 'Syncing…'],
            ].forEach(function(entry) {
              const button = document.getElementById(entry[0]);
              if (!(button instanceof HTMLButtonElement)) { return; }
              button.addEventListener('click', function() {
                button.textContent = entry[1];
                button.disabled = true;
                vscode.postMessage({ type: entry[0] });
              });
            });
          })();

          // Delegated, not bound per element at load. The AI-instruction file
          // buttons are injected into #aiInstructionList by innerHTML *after* a
          // scan returns, so a one-shot querySelectorAll at startup never saw
          // them and every one of those paths was unclickable.
          document.addEventListener('click', event => {
            const element = event.target instanceof HTMLElement
              ? event.target.closest('[data-open-file]')
              : null;
            if (!(element instanceof HTMLElement)) {
              return;
            }
            const relativePath = element.dataset.openFile;
            if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
              return;
            }
            vscode.postMessage({ type: 'openWorkspaceFile', payload: relativePath });
          });

          document.querySelectorAll('[data-settings-page]').forEach(element => {
            if (!(element instanceof HTMLButtonElement)) {
              return;
            }
            element.addEventListener('click', () => {
              const targetPage = element.dataset.settingsPage ?? 'overview';
              const targetSection = element.dataset.settingsSection ?? '';
              activatePage(targetPage, { focusPanel: true });
              if (targetSection) {
                focusSection(targetSection);
              }
            });
          });

          document.querySelectorAll('input[name="budget"]').forEach(element => {
            element.addEventListener('change', event => {
              const target = event.target;
              if (!(target instanceof HTMLInputElement)) {
                return;
              }
              vscode.postMessage({ type: 'setBudgetMode', payload: target.value });
            });
          });

          document.querySelectorAll('input[name="speed"]').forEach(element => {
            element.addEventListener('change', event => {
              const target = event.target;
              if (!(target instanceof HTMLInputElement)) {
                return;
              }
              vscode.postMessage({ type: 'setSpeedMode', payload: target.value });
            });
          });

          const localEndpointsList = document.getElementById('localEndpointsList');
          const addLocalEndpointButton = document.getElementById('addLocalEndpoint');
          localEndpointRows = Array.isArray(initialLocalOpenAiEndpoints)
            ? initialLocalOpenAiEndpoints.map(endpoint => ({
              id: typeof endpoint.id === 'string' ? endpoint.id : createLocalEndpointId(),
              label: typeof endpoint.label === 'string' ? endpoint.label : '',
              baseUrl: typeof endpoint.baseUrl === 'string' ? endpoint.baseUrl : '',
            }))
            : [];

          function normalizeLocalEndpointUrl(value) {
            const trimmed = typeof value === 'string' ? value.trim() : '';
            if (!trimmed) {
              return undefined;
            }
            try {
              const parsed = new URL(trimmed);
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return undefined;
              }
              return trimmed.replace(/\\/+$/, '');
            } catch {
              return undefined;
            }
          }

          function inferLocalEndpointLabelFromUrl(baseUrl) {
            try {
              const parsed = new URL(baseUrl);
              if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === '11434') {
                return 'Ollama';
              }
              if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === '1234') {
                return 'LM Studio';
              }
              const host = parsed.hostname === '127.0.0.1' ? 'localhost' : parsed.hostname;
              return parsed.port ? host + ':' + parsed.port : host;
            } catch {
              return 'Local Endpoint';
            }
          }

          function persistLocalEndpoints() {
            const payload = localEndpointRows
              .map(row => {
                const normalizedBaseUrl = normalizeLocalEndpointUrl(row.baseUrl);
                if (!normalizedBaseUrl) {
                  return undefined;
                }
                const label = row.label.trim() || inferLocalEndpointLabelFromUrl(normalizedBaseUrl);
                return {
                  id: row.id,
                  label,
                  baseUrl: normalizedBaseUrl,
                };
              })
              .filter(Boolean);
            vscode.postMessage({ type: 'setLocalOpenAiEndpoints', payload });
          }

          renderLocalEndpoints = () => {
            if (!(localEndpointsList instanceof HTMLElement)) {
              return;
            }
            localEndpointsList.innerHTML = '';
            if (localEndpointRows.length === 0) {
              const empty = document.createElement('p');
              empty.className = 'local-endpoints-empty';
              empty.textContent = 'No local endpoints configured yet. Use + to add one only when you need it.';
              localEndpointsList.appendChild(empty);
              return;
            }

            localEndpointRows.forEach((row, index) => {
              const wrapper = document.createElement('div');
              wrapper.className = 'local-endpoint-row';

              const labelField = document.createElement('div');
              labelField.className = 'local-endpoint-field';
              const labelLabel = document.createElement('label');
              labelLabel.textContent = 'Label';
              labelLabel.setAttribute('for', 'localEndpointLabel-' + row.id);
              const labelInput = document.createElement('input');
              labelInput.id = 'localEndpointLabel-' + row.id;
              labelInput.type = 'text';
              labelInput.placeholder = inferLocalEndpointLabelFromUrl(row.baseUrl || 'http://127.0.0.1:11434/v1');
              labelInput.value = row.label;
              labelInput.addEventListener('input', () => {
                row.label = labelInput.value;
              });
              labelInput.addEventListener('change', persistLocalEndpoints);
              labelInput.addEventListener('blur', persistLocalEndpoints);
              labelField.appendChild(labelLabel);
              labelField.appendChild(labelInput);

              const urlField = document.createElement('div');
              urlField.className = 'local-endpoint-field';
              const urlLabel = document.createElement('label');
              urlLabel.textContent = 'Base URL';
              urlLabel.setAttribute('for', 'localEndpointUrl-' + row.id);
              const urlInput = document.createElement('input');
              urlInput.id = 'localEndpointUrl-' + row.id;
              urlInput.type = 'url';
              urlInput.placeholder = index === 0 ? 'http://127.0.0.1:11434/v1' : 'http://127.0.0.1:1234/v1';
              urlInput.value = row.baseUrl;
              urlInput.addEventListener('input', () => {
                row.baseUrl = urlInput.value;
                labelInput.placeholder = inferLocalEndpointLabelFromUrl(urlInput.value || 'http://127.0.0.1:11434/v1');
              });
              urlInput.addEventListener('change', persistLocalEndpoints);
              urlInput.addEventListener('blur', persistLocalEndpoints);
              urlField.appendChild(urlLabel);
              urlField.appendChild(urlInput);

              const removeButton = document.createElement('button');
              removeButton.type = 'button';
              removeButton.className = 'secondary-button local-endpoint-remove';
              removeButton.textContent = '−';
              removeButton.setAttribute('aria-label', 'Remove local endpoint');
              removeButton.addEventListener('click', () => {
                localEndpointRows.splice(index, 1);
                renderLocalEndpoints();
                persistLocalEndpoints();
              });

              wrapper.appendChild(labelField);
              wrapper.appendChild(urlField);
              wrapper.appendChild(removeButton);
              localEndpointsList.appendChild(wrapper);
            });
          };

          if (addLocalEndpointButton instanceof HTMLButtonElement) {
            const endpointPresets = [
              { label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
              { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
              { label: 'Open WebUI', baseUrl: 'http://localhost:3000/api' },
              { label: 'LocalAI', baseUrl: 'http://localhost:8080/v1' },
              { label: 'llama.cpp', baseUrl: 'http://localhost:8080/v1' },
              { label: 'vLLM', baseUrl: 'http://localhost:8000/v1' },
              { label: 'Jan', baseUrl: 'http://localhost:1337/v1' },
            ];

            const presetMenu = document.getElementById('addEndpointMenu');

            function buildPresetMenu() {
              if (!(presetMenu instanceof HTMLUListElement)) { return; }
              presetMenu.innerHTML = '';
              endpointPresets.forEach(preset => {
                const li = document.createElement('li');
                li.setAttribute('role', 'none');
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.setAttribute('role', 'menuitem');
                const nameSpan = document.createElement('span');
                nameSpan.textContent = preset.label;
                const hintSpan = document.createElement('span');
                hintSpan.className = 'preset-hint';
                hintSpan.textContent = preset.baseUrl;
                btn.appendChild(nameSpan);
                btn.appendChild(hintSpan);
                btn.addEventListener('click', () => {
                  localEndpointRows.push({
                    id: createLocalEndpointId(),
                    label: preset.label,
                    baseUrl: preset.baseUrl,
                  });
                  renderLocalEndpoints();
                  persistLocalEndpoints();
                  closePresetMenu();
                });
                li.appendChild(btn);
                presetMenu.appendChild(li);
              });

              const sep = document.createElement('li');
              sep.setAttribute('role', 'separator');
              const sepDiv = document.createElement('div');
              sepDiv.className = 'preset-separator';
              sep.appendChild(sepDiv);
              presetMenu.appendChild(sep);

              const customLi = document.createElement('li');
              customLi.setAttribute('role', 'none');
              const customBtn = document.createElement('button');
              customBtn.type = 'button';
              customBtn.setAttribute('role', 'menuitem');
              customBtn.textContent = 'Custom endpoint\u2026';
              customBtn.addEventListener('click', () => {
                localEndpointRows.push({ id: createLocalEndpointId(), label: '', baseUrl: '' });
                renderLocalEndpoints();
                closePresetMenu();
              });
              customLi.appendChild(customBtn);
              presetMenu.appendChild(customLi);
            }

            function closePresetMenu() {
              if (presetMenu instanceof HTMLElement) {
                presetMenu.hidden = true;
              }
              document.removeEventListener('click', onOutsideClick, true);
              document.removeEventListener('keydown', onEscapeKey, true);
            }

            function onOutsideClick(event) {
              if (presetMenu instanceof HTMLElement && !presetMenu.contains(event.target) && event.target !== addLocalEndpointButton) {
                closePresetMenu();
              }
            }

            function onEscapeKey(event) {
              if (event.key === 'Escape') {
                closePresetMenu();
                addLocalEndpointButton.focus();
              }
            }

            buildPresetMenu();

            addLocalEndpointButton.addEventListener('click', () => {
              if (!(presetMenu instanceof HTMLElement)) { return; }
              const isOpen = !presetMenu.hidden;
              if (isOpen) {
                closePresetMenu();
              } else {
                presetMenu.hidden = false;
                document.addEventListener('click', onOutsideClick, true);
                document.addEventListener('keydown', onEscapeKey, true);
                const firstButton = presetMenu.querySelector('button');
                if (firstButton) { firstButton.focus(); }
              }
            });
          }

          renderLocalEndpoints();

          const toolApprovalMode = document.getElementById('toolApprovalMode');
          if (toolApprovalMode instanceof HTMLSelectElement) {
            toolApprovalMode.addEventListener('change', () => {
              vscode.postMessage({ type: 'setToolApprovalMode', payload: toolApprovalMode.value });
            });
          }

          const showImportProjectAction = document.getElementById('showImportProjectAction');
          if (showImportProjectAction instanceof HTMLInputElement) {
            showImportProjectAction.addEventListener('change', () => {
              vscode.postMessage({ type: 'setShowImportProjectAction', payload: showImportProjectAction.checked });
            });
          }

          const allowTerminalWrite = document.getElementById('allowTerminalWrite');
          if (allowTerminalWrite instanceof HTMLInputElement) {
            allowTerminalWrite.addEventListener('change', () => {
              vscode.postMessage({ type: 'setAllowTerminalWrite', payload: allowTerminalWrite.checked });
            });
          }

          const acpToolsEnabled = document.getElementById('acpToolsEnabled');
          if (acpToolsEnabled instanceof HTMLInputElement) {
            acpToolsEnabled.addEventListener('change', () => {
              vscode.postMessage({ type: 'setAcpToolsEnabled', payload: acpToolsEnabled.checked });
            });
          }

          const acpHideConsoleWindows = document.getElementById('acpHideConsoleWindows');
          if (acpHideConsoleWindows instanceof HTMLInputElement) {
            acpHideConsoleWindows.addEventListener('change', () => {
              vscode.postMessage({ type: 'setAcpHideConsoleWindows', payload: acpHideConsoleWindows.checked });
            });
          }

          const autoVerifyAfterWrite = document.getElementById('autoVerifyAfterWrite');
          if (autoVerifyAfterWrite instanceof HTMLInputElement) {
            autoVerifyAfterWrite.addEventListener('change', () => {
              vscode.postMessage({ type: 'setAutoVerifyAfterWrite', payload: autoVerifyAfterWrite.checked });
            });
          }

          const autoVerifyScripts = document.getElementById('autoVerifyScripts');
          if (autoVerifyScripts instanceof HTMLInputElement) {
            const emitScripts = () => {
              vscode.postMessage({ type: 'setAutoVerifyScripts', payload: autoVerifyScripts.value });
            };
            autoVerifyScripts.addEventListener('change', emitScripts);
            autoVerifyScripts.addEventListener('blur', emitScripts);
          }

          function bindPositiveIntegerInput(id, messageType) {
            const element = document.getElementById(id);
            if (!(element instanceof HTMLInputElement)) {
              return;
            }
            const emit = () => {
              const value = Number.parseInt(element.value, 10);
              if (!Number.isFinite(value) || value < 1) {
                return;
              }
              vscode.postMessage({ type: messageType, payload: value });
            };
            element.addEventListener('change', emit);
            element.addEventListener('blur', emit);
          }

          function bindNonNegativeNumberInput(id, messageType) {
            const element = document.getElementById(id);
            if (!(element instanceof HTMLInputElement)) {
              return;
            }
            const emit = () => {
              const value = Number.parseFloat(element.value);
              if (!Number.isFinite(value) || value < 0) {
                return;
              }
              vscode.postMessage({ type: messageType, payload: value });
            };
            element.addEventListener('change', emit);
            element.addEventListener('blur', emit);
          }

          function bindRangedNumberInput(id, messageType, min, max) {
            const element = document.getElementById(id);
            if (!(element instanceof HTMLInputElement)) {
              return;
            }
            const emit = () => {
              const value = Number.parseFloat(element.value);
              if (!Number.isFinite(value) || value < min || value > max) {
                return;
              }
              vscode.postMessage({ type: messageType, payload: value });
            };
            element.addEventListener('change', emit);
            element.addEventListener('blur', emit);
          }

          function bindCheckboxSetting(id, messageType) {
            const element = document.getElementById(id);
            if (!(element instanceof HTMLInputElement)) {
              return;
            }
            element.addEventListener('change', () => {
              vscode.postMessage({ type: messageType, payload: element.checked });
            });
          }

          // Integer field that displays a thousands separator (comma every three digits)
          // for readability while sending a plain integer to the extension.
          function bindIntegerWithCommas(id, messageType) {
            const element = document.getElementById(id);
            if (!(element instanceof HTMLInputElement)) {
              return;
            }
            const handle = () => {
              const digits = element.value.replace(/[^0-9]/g, '');
              const value = Number.parseInt(digits, 10);
              if (!Number.isFinite(value) || value < 1) {
                return;
              }
              vscode.postMessage({ type: messageType, payload: value });
              element.value = value.toLocaleString('en-US');
            };
            element.addEventListener('change', handle);
            element.addEventListener('blur', handle);
          }

          bindNonNegativeNumberInput('dailyCostLimitUsd', 'setDailyCostLimitUsd');

          const displayCurrency = document.getElementById('displayCurrency');
          if (displayCurrency instanceof HTMLSelectElement) {
            displayCurrency.addEventListener('change', () => {
              vscode.postMessage({ type: 'setDisplayCurrency', payload: displayCurrency.value });
            });
          }

          bindRangedNumberInput('feedbackRoutingWeight', 'setFeedbackRoutingWeight', 0, 2);
          bindPositiveIntegerInput('autoVerifyTimeoutMs', 'setAutoVerifyTimeoutMs');
          bindPositiveIntegerInput('maxToolIterations', 'setMaxToolIterations');
          bindRangedNumberInput('voiceRate', 'setVoiceRate', 0.5, 2);
          bindRangedNumberInput('voicePitch', 'setVoicePitch', 0, 2);
          bindRangedNumberInput('voiceVolume', 'setVoiceVolume', 0, 1);
          bindPositiveIntegerInput('projectApprovalFileThreshold', 'setProjectApprovalFileThreshold');
          bindPositiveIntegerInput('chatSessionTurnLimit', 'setChatSessionTurnLimit');
          bindPositiveIntegerInput('chatSessionContextChars', 'setChatSessionContextChars');
          bindPositiveIntegerInput('projectEstimatedFilesPerSubtask', 'setProjectEstimatedFilesPerSubtask');
          bindPositiveIntegerInput('projectChangedFileReferenceLimit', 'setProjectChangedFileReferenceLimit');

          // Mission Loop defaults.
          bindPositiveIntegerInput('loopDefaultMaxIterations', 'setLoopDefaultMaxIterations');
          bindNonNegativeNumberInput('loopDefaultMaxCostUsd', 'setLoopDefaultMaxCostUsd');
          bindIntegerWithCommas('loopDefaultMaxTokens', 'setLoopDefaultMaxTokens');
          bindPositiveIntegerInput('loopDefaultMaxDurationMinutes', 'setLoopDefaultMaxDurationMinutes');
          bindPositiveIntegerInput('loopMaxConsecutiveNoProgress', 'setLoopMaxConsecutiveNoProgress');
          bindNonNegativeNumberInput('loopCheckpointEveryNIterations', 'setLoopCheckpointEveryNIterations');
          bindRangedNumberInput('loopCheckpointAtBudgetFraction', 'setLoopCheckpointAtBudgetFraction', 0.01, 1);
          bindRangedNumberInput('loopGoalAchievedConfidenceThreshold', 'setLoopGoalAchievedConfidenceThreshold', 0, 1);
          bindCheckboxSetting('loopEnabled', 'setLoopEnabled');
          bindCheckboxSetting('loopRequireApprovalBeforeWriteBatches', 'setLoopRequireApprovalBeforeWriteBatches');
          bindCheckboxSetting('loopAllowDiscovery', 'setLoopAllowDiscovery');

          const instructionsVerify = document.getElementById('instructionsVerifyOnCommit');
          if (instructionsVerify instanceof HTMLInputElement) {
            instructionsVerify.addEventListener('change', () => {
              vscode.postMessage({ type: 'setInstructionsVerifyOnCommit', payload: instructionsVerify.checked });
            });
          }

          const voiceTtsEnabled = document.getElementById('voiceTtsEnabled');
          if (voiceTtsEnabled instanceof HTMLInputElement) {
            voiceTtsEnabled.addEventListener('change', () => {
              vscode.postMessage({ type: 'setVoiceTtsEnabled', payload: voiceTtsEnabled.checked });
            });
          }

          const voiceLanguage = document.getElementById('voiceLanguage');
          if (voiceLanguage instanceof HTMLInputElement) {
            const emitVoiceLanguage = () => {
              vscode.postMessage({ type: 'setVoiceLanguage', payload: voiceLanguage.value });
            };
            voiceLanguage.addEventListener('change', emitVoiceLanguage);
            voiceLanguage.addEventListener('blur', emitVoiceLanguage);
          }

          const voiceOutputDeviceId = document.getElementById('voiceOutputDeviceId');
          if (voiceOutputDeviceId instanceof HTMLInputElement) {
            const emitVoiceOutputDeviceId = () => {
              vscode.postMessage({ type: 'setVoiceOutputDeviceId', payload: voiceOutputDeviceId.value });
            };
            voiceOutputDeviceId.addEventListener('change', emitVoiceOutputDeviceId);
            voiceOutputDeviceId.addEventListener('blur', emitVoiceOutputDeviceId);
          }

          // MCP servers. Delegated because the cards are re-rendered whenever a
          // connection changes, so per-element listeners would be lost.
          document.querySelectorAll('[data-mcp-enable]').forEach(element => {
            if (element instanceof HTMLInputElement) {
              element.addEventListener('change', () => {
                vscode.postMessage({
                  type: 'setMcpServerEnabled',
                  payload: { id: element.getAttribute('data-mcp-enable'), enabled: element.checked },
                });
              });
            }
          });
          document.querySelectorAll('[data-mcp-connect]').forEach(element => {
            element.addEventListener('click', () => {
              vscode.postMessage({ type: 'connectMcpServer', payload: element.getAttribute('data-mcp-connect') });
            });
          });
          document.querySelectorAll('[data-mcp-disconnect]').forEach(element => {
            element.addEventListener('click', () => {
              vscode.postMessage({ type: 'disconnectMcpServer', payload: element.getAttribute('data-mcp-disconnect') });
            });
          });
          document.querySelectorAll('#mcpOpenManager').forEach(element => {
            element.addEventListener('click', () => {
              vscode.postMessage({ type: 'openMcpManager' });
            });
          });

          // Buzz. The gates are nested, so a dependent control is dimmed and
          // disabled while its parent is off — it still shows the value that is
          // stored, because hiding a stored 'on' would misreport the config.
          const buzzEnabledInput = document.getElementById('buzzEnabled');
          const buzzInboundEnabledInput = document.getElementById('buzzInboundEnabled');

          function syncBuzzGates() {
            const gateOn = {
              buzzEnabled: buzzEnabledInput instanceof HTMLInputElement && buzzEnabledInput.checked,
              buzzInboundEnabled: buzzInboundEnabledInput instanceof HTMLInputElement && buzzInboundEnabledInput.checked,
            };
            // Inbound is only live when the master switch is too, so a dependent
            // of inbound is inert whenever either is off.
            gateOn.buzzInboundEnabled = gateOn.buzzInboundEnabled && gateOn.buzzEnabled;
            document.querySelectorAll('[data-buzz-depends]').forEach(element => {
              const parent = element.getAttribute('data-buzz-depends');
              const live = parent === 'buzzInboundEnabled' ? gateOn.buzzInboundEnabled : gateOn.buzzEnabled;
              element.classList.toggle('is-inert', !live);
              element.querySelectorAll('input, textarea, select, button').forEach(control => {
                if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
                  || control instanceof HTMLSelectElement || control instanceof HTMLButtonElement) {
                  control.disabled = !live;
                }
              });
            });
          }

          if (buzzEnabledInput instanceof HTMLInputElement) {
            buzzEnabledInput.addEventListener('change', () => {
              vscode.postMessage({ type: 'setBuzzEnabled', payload: buzzEnabledInput.checked });
              syncBuzzGates();
            });
          }
          if (buzzInboundEnabledInput instanceof HTMLInputElement) {
            buzzInboundEnabledInput.addEventListener('change', () => {
              vscode.postMessage({ type: 'setBuzzInboundEnabled', payload: buzzInboundEnabledInput.checked });
              syncBuzzGates();
            });
          }

          const buzzAllowRemoteRelay = document.getElementById('buzzAllowRemoteRelay');
          if (buzzAllowRemoteRelay instanceof HTMLInputElement) {
            buzzAllowRemoteRelay.addEventListener('change', () => {
              vscode.postMessage({ type: 'setBuzzAllowRemoteRelay', payload: buzzAllowRemoteRelay.checked });
            });
          }

          const buzzAutoCreateFollowUps = document.getElementById('buzzAutoCreateFollowUps');
          if (buzzAutoCreateFollowUps instanceof HTMLInputElement) {
            buzzAutoCreateFollowUps.addEventListener('change', () => {
              vscode.postMessage({ type: 'setBuzzAutoCreateFollowUps', payload: buzzAutoCreateFollowUps.checked });
            });
          }

          const buzzRelayUrl = document.getElementById('buzzRelayUrl');
          if (buzzRelayUrl instanceof HTMLInputElement) {
            const emitBuzzRelayUrl = () => {
              vscode.postMessage({ type: 'setBuzzRelayUrl', payload: buzzRelayUrl.value });
            };
            buzzRelayUrl.addEventListener('change', emitBuzzRelayUrl);
            buzzRelayUrl.addEventListener('blur', emitBuzzRelayUrl);
          }

          const buzzInboundChannels = document.getElementById('buzzInboundChannels');
          if (buzzInboundChannels instanceof HTMLTextAreaElement) {
            const emitBuzzChannels = () => {
              vscode.postMessage({ type: 'setBuzzInboundChannels', payload: buzzInboundChannels.value });
            };
            buzzInboundChannels.addEventListener('change', emitBuzzChannels);
            buzzInboundChannels.addEventListener('blur', emitBuzzChannels);
          }

          const buzzSetAgentKey = document.getElementById('buzzSetAgentKey');
          if (buzzSetAgentKey instanceof HTMLButtonElement) {
            buzzSetAgentKey.addEventListener('click', () => {
              vscode.postMessage({ type: 'openBuzzAgentKey' });
            });
          }

          const buzzOpenGuide = document.getElementById('buzzOpenGuide');
          if (buzzOpenGuide instanceof HTMLButtonElement) {
            buzzOpenGuide.addEventListener('click', () => {
              vscode.postMessage({ type: 'openBuzzGuide' });
            });
          }

          const buzzFetchChannels = document.getElementById('buzzFetchChannels');
          if (buzzFetchChannels instanceof HTMLButtonElement) {
            buzzFetchChannels.addEventListener('click', () => {
              vscode.postMessage({ type: 'fetchBuzzChannels' });
            });
          }

          const buzzOpenDirector = document.getElementById('buzzOpenDirector');
          if (buzzOpenDirector instanceof HTMLButtonElement) {
            buzzOpenDirector.addEventListener('click', () => {
              vscode.postMessage({ type: 'openDirectorRoster' });
            });
          }

          syncBuzzGates();

          const projectDependencyMonitoringEnabled = document.getElementById('projectDependencyMonitoringEnabled');
          if (projectDependencyMonitoringEnabled instanceof HTMLInputElement) {
            projectDependencyMonitoringEnabled.addEventListener('change', () => {
              vscode.postMessage({ type: 'setProjectDependencyMonitoringEnabled', payload: projectDependencyMonitoringEnabled.checked });
            });
          }

          function emitDependencyMonitoringProviders() {
            const selected = Array.from(document.querySelectorAll('input[name="dependencyMonitoringProvider"]:checked'))
              .map(element => element instanceof HTMLInputElement ? element.value : '')
              .filter(value => value === 'dependabot' || value === 'renovate' || value === 'snyk' || value === 'azure-devops');
            vscode.postMessage({ type: 'setProjectDependencyMonitoringProviders', payload: selected });
          }

          document.querySelectorAll('input[name="dependencyMonitoringProvider"]').forEach(element => {
            element.addEventListener('change', emitDependencyMonitoringProviders);
          });

          const projectDependencyMonitoringSchedule = document.getElementById('projectDependencyMonitoringSchedule');
          if (projectDependencyMonitoringSchedule instanceof HTMLSelectElement) {
            projectDependencyMonitoringSchedule.addEventListener('change', () => {
              vscode.postMessage({ type: 'setProjectDependencyMonitoringSchedule', payload: projectDependencyMonitoringSchedule.value });
            });
          }

          const projectDependencyMonitoringIssueTemplate = document.getElementById('projectDependencyMonitoringIssueTemplate');
          if (projectDependencyMonitoringIssueTemplate instanceof HTMLInputElement) {
            projectDependencyMonitoringIssueTemplate.addEventListener('change', () => {
              vscode.postMessage({ type: 'setProjectDependencyMonitoringIssueTemplate', payload: projectDependencyMonitoringIssueTemplate.checked });
            });
          }

          const projectRunReportFolder = document.getElementById('projectRunReportFolder');
          if (projectRunReportFolder instanceof HTMLInputElement) {
            const emitFolder = () => {
              const value = projectRunReportFolder.value.trim();
              if (value.length === 0) {
                return;
              }
              vscode.postMessage({ type: 'setProjectRunReportFolder', payload: value });
            };
            projectRunReportFolder.addEventListener('change', emitFolder);
            projectRunReportFolder.addEventListener('blur', emitFolder);
          }

          experimentalSkillLearningEnabled = document.getElementById('experimentalSkillLearningEnabled');
          if (experimentalSkillLearningEnabled instanceof HTMLInputElement) {
            experimentalSkillLearningEnabled.addEventListener('change', () => {
              vscode.postMessage({
                type: 'setExperimentalSkillLearningEnabled',
                payload: experimentalSkillLearningEnabled.checked,
              });
            });
          }
        } catch (error) {
          console.error('AtlasMind settings controls failed to initialize', error);
        }

        const localModelRecommendationStatus = document.getElementById('localModelRecommendationStatus');
        const localModelRecommendationResults = document.getElementById('localModelRecommendationResults');

        function escapeForHtml(s) {
          return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        }

        function renderLocalModelRecommendations(payload) {
          if (!(localModelRecommendationResults instanceof HTMLElement)) {
            return;
          }

          const hardwareSummary = payload && typeof payload === 'object' && payload.hardware
            ? payload.hardware
            : {};
          const hardwareLine = [
            typeof hardwareSummary.cpuThreads === 'number' ? hardwareSummary.cpuThreads + ' CPU threads' : undefined,
            typeof hardwareSummary.ramGb === 'number' ? hardwareSummary.ramGb + ' GB RAM' : undefined,
            Array.isArray(hardwareSummary.gpus) && hardwareSummary.gpus.length > 0
              ? hardwareSummary.gpus.map(gpu => {
                if (!gpu || typeof gpu !== 'object') {
                  return undefined;
                }
                const name = typeof gpu.name === 'string' ? gpu.name : 'Unknown GPU';
                const vram = typeof gpu.vramGb === 'number' ? gpu.vramGb + ' GB VRAM' : undefined;
                return vram ? name + ' (' + vram + ')' : name;
              }).filter(Boolean).join(', ')
              : 'No GPU information detected',
          ].filter(Boolean).join(' | ');

          const usedFamilies = Array.isArray(payload?.recentlyUsedFamilies)
            ? payload.recentlyUsedFamilies
            : [];
          const usageLine = usedFamilies.length > 0
            ? usedFamilies
              .slice(0, 4)
              .map(entry => escapeForHtml(String(entry.family ?? 'Unknown')) + ' (' + escapeForHtml(String(entry.requests ?? 0)) + ')')
              .join(', ')
            : 'No recent local-model usage was found in AtlasMind history.';

          const recommendations = Array.isArray(payload?.recommendations)
            ? payload.recommendations
            : [];

          const cardsHtml = recommendations.length > 0
            ? recommendations.map(item => {
              const isInstalled = item.status === 'installed';
              const installedRuntimeLabel = item.installedRuntime === 'lmstudio'
                ? 'LM Studio'
                : item.installedRuntime === 'ollama' ? 'Ollama' : '';
              const badgeClass = isInstalled ? 'local-model-badge-installed' : 'local-model-badge-recommended';
              const badgeText = isInstalled
                ? (installedRuntimeLabel ? 'Installed · ' + installedRuntimeLabel : 'Installed')
                : 'Recommended';
              const rationale = Array.isArray(item.rationale)
                ? item.rationale.map(line => '<li>' + escapeForHtml(String(line)) + '</li>').join('')
                : '';
              const tag = String(item.recommendedTag ?? '');
              let actionsHtml = '';
              if (isInstalled) {
                if (item.installedRuntime === 'ollama') {
                  actionsHtml = '<button type="button" class="danger-button" data-local-model-action="remove" data-runtime="ollama" data-model-id="' + escapeForHtml(String(item.installedModelId ?? '')) + '">Remove from Ollama</button>';
                } else if (item.installedRuntime === 'lmstudio') {
                  actionsHtml = '<span class="local-model-runtime-note">Manage in LM Studio</span>';
                }
              } else {
                // Both runtimes can install any candidate: Ollama pulls GGUF straight from
                // HuggingFace via the hf.co/ prefix (translated in the host), and lms searches
                // HuggingFace for Ollama-style tags. Offer both buttons for every recommendation.
                actionsHtml += '<button type="button" class="secondary-button" data-local-model-action="install" data-runtime="ollama" data-model-tag="' + escapeForHtml(tag) + '">Install in Ollama</button>';
                actionsHtml += '<button type="button" class="secondary-button" data-local-model-action="install" data-runtime="lmstudio" data-model-tag="' + escapeForHtml(tag) + '">Install in LM Studio</button>';
              }
              return '<article class="local-model-recommendation-card">'
                + '<div class="local-model-recommendation-header">'
                + '<h4>' + escapeForHtml(String(item.modelFamily ?? 'Model')) + '</h4>'
                + '<span class="local-model-badge ' + badgeClass + '">' + badgeText + '</span>'
                + '</div>'
                + '<p class="local-model-recommendation-meta">Suggested tag: <code>' + escapeForHtml(tag) + '</code> · Fit score: ' + escapeForHtml(String(item.fitScore ?? 0)) + '</p>'
                + '<ul>' + rationale + '</ul>'
                + '<p class="local-model-install-hint"><strong>Install hint:</strong> ' + escapeForHtml(String(item.installHint ?? '')) + '</p>'
                + '<div class="local-model-actions">'
                + actionsHtml
                + '</div>'
                + '</article>';
            }).join('')
            : '<p class="local-model-empty">No recommendation could be generated from the available data.</p>';

          const installedModels = Array.isArray(payload?.installedModels) ? payload.installedModels : [];
          const installedHtml = installedModels.length > 0
            ? '<div class="local-model-installed">'
              + '<h4>Installed local models</h4>'
              + installedModels.map(item => {
                const runtimeLabel = String(item.runtime ?? '').toLowerCase() === 'lmstudio' ? 'LM Studio' : 'Ollama';
                const removeControl = item.removable
                  ? '<button type="button" class="danger-button" data-local-model-action="remove" data-runtime="' + escapeForHtml(String(item.runtime ?? '')) + '" data-model-id="' + escapeForHtml(String(item.modelId ?? '')) + '">Remove</button>'
                  : '<span class="local-model-runtime-note">Manage in ' + runtimeLabel + '</span>';
                return '<div class="local-model-installed-row">'
                  + '<div>'
                  + '<strong>' + escapeForHtml(String(item.displayName ?? item.modelId ?? 'Local model')) + '</strong>'
                  + '<p class="mini-meta">Runtime: ' + runtimeLabel + '</p>'
                  + '</div>'
                  + removeControl
                  + '</div>';
              }).join('')
              + '</div>'
            : '<p class="local-model-empty">No installed local models were discovered from current endpoints.</p>';

          localModelRecommendationResults.innerHTML = ''
            + '<div class="local-model-summary">'
            + '<p><strong>Hardware:</strong> ' + escapeForHtml(hardwareLine || 'Unknown hardware profile') + '</p>'
            + '<p><strong>Recent local usage:</strong> ' + usageLine + '</p>'
            + '</div>'
            + cardsHtml
            + installedHtml;
          localModelRecommendationResults.hidden = false;

          localModelRecommendationResults.querySelectorAll('button[data-local-model-action]').forEach(button => {
            if (!(button instanceof HTMLButtonElement)) {
              return;
            }
            button.addEventListener('click', () => {
              const action = button.dataset.localModelAction;
              const runtime = button.dataset.runtime;
              if (action === 'install') {
                const modelTag = button.dataset.modelTag ?? '';
                if (!modelTag || (runtime !== 'ollama' && runtime !== 'lmstudio')) {
                  return;
                }
                vscode.postMessage({
                  type: 'installRecommendedLocalModel',
                  payload: { runtime, modelTag },
                });
                return;
              }

              if (action === 'remove') {
                const modelId = button.dataset.modelId ?? '';
                if (!modelId || (runtime !== 'ollama' && runtime !== 'lmstudio')) {
                  return;
                }
                vscode.postMessage({
                  type: 'removeInstalledLocalModel',
                  payload: { runtime, modelId },
                });
              }
            });
          });
        }

        // AI Instructions sync
        const alignAiInstructionsBtn = document.getElementById('alignAiInstructions');
        if (alignAiInstructionsBtn instanceof HTMLButtonElement) {
          alignAiInstructionsBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'alignAiInstructions' });
          });
        }
        const scanAiInstructionsBtn = document.getElementById('scanAiInstructions');
        const rescanAiInstructionsBtn = document.getElementById('rescanAiInstructions');
        const resetAiInstructionScanBtn = document.getElementById('resetAiInstructionScan');
        const confirmAiSyncBtn = document.getElementById('confirmAiSync');
        const openAtlasInstructionsBtn = document.getElementById('openAtlasInstructions');
        const aiInstructionScanStatus = document.getElementById('aiInstructionScanStatus');
        const aiInstructionResults = document.getElementById('aiInstructionResults');
        const aiInstructionList = document.getElementById('aiInstructionList');
        const aiSyncStatus = document.getElementById('aiSyncStatus');
        const aiInstructionConfirmed = document.getElementById('aiInstructionConfirmed');
        const aiInstructionConfirmedSummary = document.getElementById('aiInstructionConfirmedSummary');

        function triggerAiScan() {
          if (aiInstructionScanStatus instanceof HTMLElement) {
            aiInstructionScanStatus.textContent = 'Scanning workspace...';
          }
          if (scanAiInstructionsBtn instanceof HTMLButtonElement) {
            scanAiInstructionsBtn.disabled = true;
            scanAiInstructionsBtn.textContent = 'Scanning...';
          }
          vscode.postMessage({ type: 'scanAiInstructions' });
        }

        function refreshAiCheckboxStyling() {
          const anyChecked = document.querySelectorAll('.ai-instruction-check:checked').length > 0;
          if (confirmAiSyncBtn instanceof HTMLButtonElement) {
            confirmAiSyncBtn.disabled = !anyChecked;
          }
        }

        if (scanAiInstructionsBtn instanceof HTMLButtonElement) {
          scanAiInstructionsBtn.addEventListener('click', triggerAiScan);
        }
        if (rescanAiInstructionsBtn instanceof HTMLButtonElement) {
          rescanAiInstructionsBtn.addEventListener('click', triggerAiScan);
        }
        if (resetAiInstructionScanBtn instanceof HTMLButtonElement) {
          resetAiInstructionScanBtn.addEventListener('click', () => {
            if (aiInstructionResults instanceof HTMLElement) { aiInstructionResults.hidden = true; }
            if (aiInstructionConfirmed instanceof HTMLElement) { aiInstructionConfirmed.hidden = true; }
            if (aiInstructionScanStatus instanceof HTMLElement) { aiInstructionScanStatus.textContent = ''; }
            if (scanAiInstructionsBtn instanceof HTMLButtonElement) {
              scanAiInstructionsBtn.disabled = false;
              scanAiInstructionsBtn.textContent = 'Scan Workspace';
            }
            triggerAiScan();
          });
        }
        if (confirmAiSyncBtn instanceof HTMLButtonElement) {
          confirmAiSyncBtn.addEventListener('click', () => {
            const checked = Array.from(document.querySelectorAll('.ai-instruction-check:checked'))
              .filter(el => el instanceof HTMLInputElement)
              .map(el => el.value);
            if (checked.length === 0) { return; }
            if (aiSyncStatus instanceof HTMLElement) { aiSyncStatus.textContent = 'Syncing…'; }
            if (confirmAiSyncBtn instanceof HTMLButtonElement) {
              confirmAiSyncBtn.disabled = true;
              confirmAiSyncBtn.textContent = 'Syncing…';
            }
            vscode.postMessage({ type: 'syncAiInstructions', payload: checked });
          });
        }
        if (openAtlasInstructionsBtn instanceof HTMLButtonElement) {
          openAtlasInstructionsBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'openWorkspaceFile', payload: 'project_memory/domain/ai-instructions-sync.md' });
          });
        }

        document.body.classList.add('settings-pages-ready');

        window.addEventListener('message', event => {
          const message = event.data;
          if (message?.type === 'syncNavigation') {
            const page = typeof message.payload?.page === 'string' ? message.payload.page : 'overview';
            const query = typeof message.payload?.query === 'string' ? message.payload.query : '';
            const section = typeof message.payload?.section === 'string' ? message.payload.section : '';
            if (searchInput instanceof HTMLInputElement) {
              searchInput.value = query;
              updateSearch(query);
              searchInput.focus();
              searchInput.select();
            }
            activatePage(page);
            focusSection(section);
            return;
          }
          if (message?.type === 'syncLocalOpenAiEndpoints' && Array.isArray(message.payload)) {
            localEndpointRows.splice(0, localEndpointRows.length, ...message.payload
              .filter(endpoint => endpoint && typeof endpoint === 'object')
              .map(endpoint => ({
                id: typeof endpoint.id === 'string' ? endpoint.id : createLocalEndpointId(),
                label: typeof endpoint.label === 'string' ? endpoint.label : '',
                baseUrl: typeof endpoint.baseUrl === 'string' ? endpoint.baseUrl : '',
              })));
            renderLocalEndpoints();
            return;
          }
          if (message?.type === 'syncExperimentalSkillLearningEnabled' && experimentalSkillLearningEnabled instanceof HTMLInputElement) {
            experimentalSkillLearningEnabled.checked = Boolean(message.payload);
            return;
          }
          if (message?.type === 'localModelRecommendationStatus') {
            if (localModelRecommendationStatus instanceof HTMLElement) {
              localModelRecommendationStatus.textContent = String(message.payload ?? '');
            }
            return;
          }
          if (message?.type === 'localModelRecommendationResult') {
            if (localModelRecommendationStatus instanceof HTMLElement) {
              localModelRecommendationStatus.textContent = 'Recommendations generated from local usage, hardware capacity, and release-aware model families.';
            }
            renderLocalModelRecommendations(message.payload);
            return;
          }
          if (message?.type === 'aiInstructionScanResult') {
            const entries = Array.isArray(message.payload) ? message.payload : [];
            if (scanAiInstructionsBtn instanceof HTMLButtonElement) {
              scanAiInstructionsBtn.disabled = false;
              scanAiInstructionsBtn.textContent = 'Scan Workspace';
            }
            if (aiInstructionScanStatus instanceof HTMLElement) {
              aiInstructionScanStatus.textContent = entries.length === 0
                ? 'No AI instruction files were found in this workspace.'
                : 'Found ' + entries.length + ' instruction file' + (entries.length === 1 ? '' : 's') + '.';
            }
            if (aiInstructionList instanceof HTMLElement) {
              if (entries.length === 0) {
                aiInstructionList.innerHTML = '<p class="ai-instruction-empty">No AI instruction files were found. Supported tools: GitHub Copilot, Claude Code, Cursor, Cline, Continue, OpenAI Codex, Gemini CLI, Windsurf, and Aider.</p>';
              } else {
                function escHtml(s) {
                  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
                }
                aiInstructionList.innerHTML = entries.map(function(entry) {
                  const tool = escHtml(entry.tool || '');
                  const relPath = escHtml(entry.relativePath || '');
                  const label = escHtml(entry.label || entry.relativePath || '');
                  const preview = escHtml(entry.preview || '');
                  const sizeLabel = escHtml(entry.sizeLabel || '');
                  return '<label class="ai-instruction-row ai-instruction-row-checked">'
                    + '<input type="checkbox" class="ai-instruction-check" value="' + relPath + '" checked>'
                    + '<div class="ai-instruction-meta">'
                    + '<span class="ai-instruction-tool">' + tool + '</span>'
                    + '<button type="button" class="ai-instruction-path" data-open-file="' + relPath + '">' + label + '</button>'
                    + '<p class="ai-instruction-preview">' + preview + '</p>'
                    + '</div>'
                    + '<span class="ai-instruction-size">' + sizeLabel + '</span>'
                    + '</label>';
                }).join('');
                document.querySelectorAll('.ai-instruction-check').forEach(function(checkbox) {
                  if (!(checkbox instanceof HTMLInputElement)) { return; }
                  const row = checkbox.closest('.ai-instruction-row');
                  checkbox.addEventListener('change', function() {
                    if (row instanceof HTMLElement) {
                      row.classList.toggle('ai-instruction-row-checked', checkbox.checked);
                    }
                    refreshAiCheckboxStyling();
                  });
                });
              }
            }
            if (confirmAiSyncBtn instanceof HTMLButtonElement) {
              confirmAiSyncBtn.disabled = entries.length === 0;
              confirmAiSyncBtn.textContent = 'Confirm Sync';
            }
            if (aiInstructionResults instanceof HTMLElement) { aiInstructionResults.hidden = false; }
            return;
          }
          if (message?.type === 'aiInstructionSyncResult') {
            const success = Boolean(message.payload?.success);
            const summary = String(message.payload?.summary ?? '');
            if (confirmAiSyncBtn instanceof HTMLButtonElement) {
              confirmAiSyncBtn.disabled = false;
              confirmAiSyncBtn.textContent = 'Confirm Sync';
            }
            if (aiSyncStatus instanceof HTMLElement) { aiSyncStatus.textContent = ''; }
            if (success) {
              if (aiInstructionResults instanceof HTMLElement) { aiInstructionResults.hidden = true; }
              if (aiInstructionConfirmedSummary instanceof HTMLElement) { aiInstructionConfirmedSummary.textContent = summary; }
              if (aiInstructionConfirmed instanceof HTMLElement) { aiInstructionConfirmed.hidden = false; }
            } else {
              if (aiSyncStatus instanceof HTMLElement) {
                aiSyncStatus.textContent = summary || 'Sync failed. Check that the project_memory/domain folder exists.';
              }
            }
            return;
          }
        });

        // ── Resource Discovery (ARD) tab wiring ──────────────────────────
        (function () {
          function ardVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
          function ardChecked(id) { const el = document.getElementById(id); return el ? el.checked : false; }
          const ardSearchForm = document.getElementById('ardSearchForm');
          if (ardSearchForm) ardSearchForm.addEventListener('submit', e => { e.preventDefault(); vscode.postMessage({ type: 'ardSearch', payload: { query: ardVal('ardSearchQuery'), typeFilter: ardVal('ardTypeFilter') } }); });
          const ardManifestForm = document.getElementById('ardManifestForm');
          if (ardManifestForm) ardManifestForm.addEventListener('submit', e => { e.preventDefault(); vscode.postMessage({ type: 'ardFetchManifest', payload: { url: ardVal('ardManifestUrl') } }); });
          const ardAddFinderForm = document.getElementById('ardAddFinderForm');
          if (ardAddFinderForm) ardAddFinderForm.addEventListener('submit', e => { e.preventDefault(); vscode.postMessage({ type: 'ardAddFinder', payload: { name: ardVal('ardFinderName'), url: ardVal('ardFinderUrl'), kind: ardVal('ardFinderKind'), insecure: ardChecked('ardFinderInsecure') } }); });
          const ardExportBtn = document.getElementById('ardExportBtn');
          if (ardExportBtn) ardExportBtn.addEventListener('click', () => vscode.postMessage({ type: 'ardExportCatalog' }));
          document.addEventListener('click', e => {
            const t = e.target;
            if (!(t instanceof HTMLElement)) return;
            const install = t.getAttribute('data-ard-install');
            if (install) { vscode.postMessage({ type: 'ardInstall', payload: { identifier: install } }); }
            const remove = t.getAttribute('data-ard-remove-finder');
            if (remove) { vscode.postMessage({ type: 'ardRemoveFinder', payload: { id: remove } }); }
          });
          document.addEventListener('change', e => {
            const t = e.target;
            if (!(t instanceof HTMLInputElement)) return;
            const toggle = t.getAttribute('data-ard-toggle-finder');
            if (toggle) { vscode.postMessage({ type: 'ardToggleFinder', payload: { id: toggle, enabled: t.checked } }); }
          });
        })();
      `,
    });
  }
}

function renderTestingPage(snapshot: TestingDashboardSnapshot, isActive: boolean): string {
  const scriptMarkup = snapshot.packageScripts.length > 0
    ? snapshot.packageScripts.map(script => `<span class="info-chip">${escapeHtml(script)}</span>`).join('')
    : '<span class="info-chip">No test scripts found</span>';

  const configMarkup = snapshot.configFiles.length > 0
    ? snapshot.configFiles.map(file => `<button type="button" class="secondary-button" data-open-file="${escapeHtml(file)}">${escapeHtml(path.posix.basename(file))}</button>`).join('')
    : '<p class="info-note">No dedicated test config files were detected in the workspace root.</p>';

  const fileMarkup = snapshot.files.length > 0
    ? snapshot.files.map(file => {
      const categoryLabel = file.category.charAt(0).toUpperCase() + file.category.slice(1);
      return `
        <li class="test-file-row">
          <div>
            <div class="test-file-title">${escapeHtml(path.posix.basename(file.relativePath))}</div>
            <div class="test-file-path">${escapeHtml(file.relativePath)}</div>
            <div class="mini-meta">
              <span>${escapeHtml(categoryLabel)}</span>
              <span>${file.suites} suites</span>
              <span>${file.cases} cases</span>
              <span>${escapeHtml(file.lastModifiedLabel)}</span>
            </div>
          </div>
          <div class="button-stack">
            <button type="button" class="secondary-button" data-open-file="${escapeHtml(file.relativePath)}">Open</button>
          </div>
        </li>`;
    }).join('')
    : '<p class="local-endpoints-empty">No test files were discovered yet. Use the Create Test File action to seed a new suite.</p>';

  const coverageDisabled = snapshot.coverageReportRelativePath || snapshot.coverageDataRelativePath ? '' : 'disabled';

  // Build a lookup from the saved config so we can pre-populate the matrix rows.
  const savedConfig = snapshot.projectTestingConfig;
  const savedMap = new Map(savedConfig?.methodologies.map(m => [m.id, m]) ?? []);

  // Group methodologies by category for visual separation
  const categories: Array<{ label: string; key: string }> = [
    { label: 'Design-time (drive implementation from tests)', key: 'design-time' },
    { label: 'Structural (validate internal correctness)', key: 'structural' },
    { label: 'Behavioral (validate observable behavior)', key: 'behavioral' },
    { label: 'Non-functional (quality attributes)', key: 'non-functional' },
    { label: 'Data & schema (the data, not the code)', key: 'data-schema' },
    { label: 'AI-specific (model-backed behaviour)', key: 'ai-specific' },
    { label: 'Exploratory', key: 'exploratory' },
    { label: 'Compliance — security & privacy', key: 'compliance-security' },
    { label: 'Compliance — operational & process', key: 'compliance-operational' },
    { label: 'Compliance — software supply chain', key: 'compliance-supply-chain' },
    { label: 'Compliance — AI governance', key: 'compliance-ai' },
    { label: 'Compliance — industry-specific', key: 'compliance-industry' },
  ];

  const enabledCount = TESTING_METHODOLOGY_DEFINITIONS.filter(def => {
    const saved = savedMap.get(def.id);
    return saved ? saved.enabled : (def.id === 'tdd' || def.id === 'unit');
  }).length;

  const methodologyMatrixRows = categories.map(cat => {
    const defsInCat = TESTING_METHODOLOGY_DEFINITIONS.filter(d => d.category === cat.key);
    if (defsInCat.length === 0) return '';
    const rows = defsInCat.map(def => {
      const saved = savedMap.get(def.id);
      const isEnabled = saved ? saved.enabled : (def.id === 'tdd' || def.id === 'unit');
      const assignedAgent = saved?.assignedAgentId ?? '';
      const assignedModel = saved?.assignedModelId ?? '';
      const notes = saved?.notes ?? '';

      // Build agent dropdown with pre-selected value
      const agentDropdown = [
        '<option value="">— None assigned —</option>',
        ...snapshot.availableAgentSummaries.map(a => {
          const selected = a.id === assignedAgent ? ' selected' : '';
          return `<option value="${escapeHtml(a.id)}"${selected}>${escapeHtml(a.name)}</option>`;
        }),
      ].join('');

      const infoRowId = `info-row-${escapeHtml(def.id)}`;
      return `
        <tr class="methodology-row${isEnabled ? ' methodology-enabled' : ''}" data-methodology-id="${escapeHtml(def.id)}">
          <td class="methodology-toggle-cell">
            <label class="toggle-switch" title="${isEnabled ? 'Enabled' : 'Disabled'}">
              <input type="checkbox" class="methodology-enabled-checkbox" data-id="${escapeHtml(def.id)}"${isEnabled ? ' checked' : ''}>
              <span class="toggle-track"></span>
            </label>
          </td>
          <td class="methodology-name-cell">
            <div class="methodology-name-row">
              <strong>${escapeHtml(def.label)}</strong>
              <button type="button" class="methodology-info-btn" data-info-target="${infoRowId}" title="Show methodology details" aria-expanded="false" aria-controls="${infoRowId}">ⓘ</button>
            </div>
            <div class="methodology-desc">${escapeHtml(def.description)}</div>
          </td>
          <td class="methodology-agent-cell">
            <select class="methodology-agent-select compact-select" data-id="${escapeHtml(def.id)}" title="Assign an agent as primary handler for ${escapeHtml(def.label)} tasks">
              ${agentDropdown}
            </select>
          </td>
          <td class="methodology-model-cell">
            <input type="text" class="methodology-model-input compact-input" data-id="${escapeHtml(def.id)}"
              value="${escapeHtml(assignedModel)}"
              placeholder="Model ID (optional)"
              title="Override model ID for ${escapeHtml(def.label)} tasks. Leave blank to use the assigned agent's default.">
          </td>
          <td class="methodology-notes-cell">
            <input type="text" class="methodology-notes-input compact-input" data-id="${escapeHtml(def.id)}"
              value="${escapeHtml(notes)}"
              placeholder="Notes…"
              title="Free-form notes for this methodology">
          </td>
        </tr>
        <tr id="${infoRowId}" class="methodology-info-row" style="display:none">
          <td></td>
          <td colspan="4" class="methodology-info-cell">
            <div class="methodology-info-grid">
              <div class="info-block">
                <span class="info-block-label">When to use</span>
                <span class="info-block-body">${escapeHtml(def.whenToUse)}</span>
              </div>
              <div class="info-block">
                <span class="info-block-label">Key tools</span>
                <span class="info-block-body">${escapeHtml(def.keyTools)}</span>
              </div>
              <div class="info-block">
                <span class="info-block-label">Trade-offs</span>
                <span class="info-block-body">${escapeHtml(def.tradeoffs)}</span>
              </div>
              <div class="info-block">
                <span class="info-block-label">AI token impact <span class="token-impact-badge token-impact-${escapeHtml(def.tokenImpactLevel)}">${escapeHtml(def.tokenImpactLevel.charAt(0).toUpperCase() + def.tokenImpactLevel.slice(1))}</span></span>
                <span class="info-block-body">${escapeHtml(def.tokenImpact)}</span>
              </div>
            </div>
          </td>
        </tr>`;
    }).join('');
    return `
      <tbody class="methodology-category-group">
        <tr class="methodology-category-header">
          <td colspan="5" class="methodology-category-label">${escapeHtml(cat.label)}</td>
        </tr>
        ${rows}
      </tbody>`;
  }).join('');

  return `
          <section id="page-testing" class="settings-page ${isActive ? 'active fallback-visible' : ''}" role="region" aria-label="Testing" tabindex="0">
            <div class="page-header">
              <p class="page-kicker">Testing</p>
              <h2>Testing Strategy &amp; Methodology Management</h2>
              <p>Configure which testing methodologies AtlasMind enforces, assign specialist agents, and set per-methodology model overrides. Changes are saved to <code>project_memory/index/testing-config.json</code>.</p>
            </div>

            <div class="stats-grid">
              ${renderTestingStatCard('Framework', snapshot.frameworkLabel, 'Detected from package scripts and dependencies.')}
              ${renderTestingStatCard('Active methodologies', String(enabledCount), `${TESTING_METHODOLOGY_DEFINITIONS.length} available across 5 categories`)}
              ${renderTestingStatCard('Discovered files', String(snapshot.totalFiles), `${snapshot.unitFiles} unit • ${snapshot.integrationFiles} integration • ${snapshot.e2eFiles} e2e`)}
              ${renderTestingStatCard('Test cases', String(snapshot.totalCases), `${snapshot.totalSuites} describe blocks across the visible suite.`)}
              ${renderTestingStatCard('Coverage', snapshot.coveragePercent ?? '—', snapshot.coverageDetail)}
            </div>

            <article class="settings-card full-width-card" id="testingStrategyMatrix">
              <div class="card-header">
                <p class="card-kicker">Strategy</p>
                <h3>Testing Methodology Matrix</h3>
              </div>
              <p class="card-copy">
                Enable the methodologies your project uses. Assign an agent as the primary handler and optionally override the model used for test-generation or verification tasks under that methodology.
                ${savedConfig ? `<em>Last saved: ${escapeHtml(new Date(savedConfig.updatedAt).toLocaleString())}</em>` : '<em>No config saved yet — defaults shown. Save to persist.</em>'}
              </p>
              <div class="methodology-table-wrapper">
                <table class="methodology-table">
                  <thead>
                    <tr>
                      <th class="col-toggle">On</th>
                      <th class="col-name">Methodology</th>
                      <th class="col-agent">Primary Agent</th>
                      <th class="col-model">Model Override</th>
                      <th class="col-notes">Notes</th>
                    </tr>
                  </thead>
                  ${methodologyMatrixRows}
                </table>
              </div>
              <div class="button-stack top-gap">
                <button id="saveTestingStrategy" type="button">Save Testing Strategy</button>
                <button id="autoAssessTestingConfig" type="button" class="secondary-button" title="Scan the project and automatically recommend testing methodologies based on the tech stack and dependencies">Auto-assess project</button>
                <button id="scaffoldTestingFramework" type="button" class="secondary-button" title="Construct a stack-aware starter framework and strategy playbook, sync existing AI instruction files, then ask AtlasMind to author one real test only when a supported runner and a safe source candidate already exist. Existing files are never overwritten.">Scaffold framework</button>
                <button id="syncTestingProtocols" type="button" class="secondary-button" title="Write the enabled protocols into detected AI agent instruction files (CLAUDE.md, copilot-instructions.md, AGENTS.md, etc.) so external agents enact the same strategy.">Sync to AI agents</button>
                <button id="refreshTestingInventory" type="button" class="secondary-button">Refresh inventory</button>
              </div>
              <p class="info-note top-gap">Saved configuration is written to <strong>project_memory/index/testing-config.json</strong> and is read by Atlas agents when planning test tasks. <strong>Sync to AI agents</strong> mirrors the enabled protocols into external agent instruction files; saving and scaffolding also sync automatically. Scaffolding may ask AtlasMind to write one focused test only after it finds an existing Vitest/Jest runner and a small exported source target; it never invents a test target or installs tooling.</p>
            </article>

            <div class="page-grid two-up">
              <article id="testingInventoryCard" class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Inventory</p>
                  <h3>Discovered test files</h3>
                </div>
                <p class="card-copy">Recently changed and discoverable test files in the workspace.</p>
                <ul class="test-file-list">${fileMarkup}</ul>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Actions</p>
                  <h3>Test management</h3>
                </div>
                <div class="button-stack">
                  <button id="createTestFile" type="button">Create Test File</button>
                  <button id="openCoverageReport" type="button" ${coverageDisabled}>Open Coverage Report</button>
                </div>
                <div class="info-band top-gap">
                  <strong>Suite density:</strong> ${escapeHtml(snapshot.averageCasesPerFile)} average cases per discovered file.
                </div>
                <div class="field-stack top-gap">
                  <span class="field-label">Detected test scripts</span>
                  <div class="inline-chip-list">${scriptMarkup}</div>
                </div>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Settings</p>
                  <h3>Verification settings</h3>
                </div>
                <div class="button-stack">
                  <button type="button" class="secondary-button" data-settings-page="safety" data-settings-section="autoVerifyScripts">Verification scripts</button>
                  <button type="button" class="secondary-button" data-settings-page="safety" data-settings-section="maxToolIterations">Execution limits</button>
                  <button type="button" class="secondary-button" data-settings-page="project" data-settings-section="projectRunReportFolder">Run report folder</button>
                </div>
                <p class="info-note top-gap">These links take you straight to the settings that shape automatic validation and long-running test workflows.</p>
              </article>

              <article class="settings-card">
                <div class="card-header">
                  <p class="card-kicker">Files</p>
                  <h3>Coverage and test config</h3>
                </div>
                <div class="button-stack">${configMarkup}</div>
                <p class="info-note top-gap">Open the config and manifest files that define how AtlasMind and your package runner verify this workspace.</p>
              </article>
            </div>
          </section>`;
}

function renderTestingPageStyles(): string {
  return `
    /* ── Testing Strategy Matrix ─────────────────────────── */
    .methodology-table-wrapper { overflow-x: auto; }
    .methodology-table { width: 100%; border-collapse: collapse; font-size: 0.88em; }
    .methodology-table th { padding: 6px 10px; text-align: left; font-weight: 600; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
    .methodology-table td { padding: 6px 10px; vertical-align: middle; border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 40%, transparent); }
    .methodology-category-label { font-size: 0.78em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vscode-descriptionForeground); padding: 12px 10px 4px; background: color-mix(in srgb, var(--vscode-editor-background) 60%, transparent); }
    .methodology-row { transition: background 0.15s; }
    .methodology-row:hover { background: color-mix(in srgb, var(--vscode-list-hoverBackground) 40%, transparent); }
    .methodology-row.methodology-enabled .methodology-name-cell strong { color: var(--vscode-testing-iconPassed); }
    .methodology-name-cell .methodology-desc { font-size: 0.82em; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .col-toggle { width: 48px; }
    .col-name { min-width: 160px; }
    .col-agent { min-width: 160px; }
    .col-model { min-width: 160px; }
    .col-notes { min-width: 120px; }
    .compact-select, .compact-input { font-size: 0.85em; padding: 3px 6px; border-radius: 3px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); width: 100%; }
    .compact-input::placeholder { color: var(--vscode-input-placeholderForeground); }
    .full-width-card { grid-column: 1 / -1; }
    /* Toggle switch */
    .toggle-switch { display: inline-flex; align-items: center; cursor: pointer; }
    .toggle-switch input[type="checkbox"] { position: absolute; opacity: 0; width: 0; height: 0; }
    .toggle-track { display: inline-block; width: 32px; height: 18px; border-radius: 9px; background: var(--vscode-input-border); position: relative; transition: background 0.2s; }
    .toggle-switch input:checked + .toggle-track { background: var(--vscode-testing-iconPassed); }
    .toggle-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: var(--vscode-editor-background); transition: transform 0.2s; }
    .toggle-switch input:checked + .toggle-track::after { transform: translateX(14px); }
    /* Info button and expandable detail rows */
    .methodology-name-row { display: flex; align-items: center; gap: 6px; }
    .methodology-info-btn { background: none; border: none; cursor: pointer; color: var(--vscode-textLink-foreground); font-size: 0.95em; padding: 0 2px; line-height: 1; opacity: 0.7; transition: opacity 0.15s; }
    .methodology-info-btn:hover, .methodology-info-btn--open { opacity: 1; }
    .methodology-info-btn--open { color: var(--vscode-testing-iconPassed); }
    .methodology-info-row td { padding: 0; }
    .methodology-info-cell { padding: 10px 10px 14px !important; background: color-mix(in srgb, var(--vscode-editor-background) 80%, var(--vscode-sideBar-background) 20%); border-bottom: 2px solid color-mix(in srgb, var(--vscode-textLink-foreground) 30%, transparent); }
    .methodology-info-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .info-block { display: flex; flex-direction: column; gap: 4px; }
    .info-block-label { font-size: 0.74em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vscode-descriptionForeground); display: flex; align-items: center; gap: 6px; }
    .info-block-body { font-size: 0.85em; color: var(--vscode-foreground); line-height: 1.5; }
    .token-impact-badge { display: inline-block; font-size: 0.8em; font-weight: 700; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 3px; text-transform: uppercase; }
    .token-impact-low { background: color-mix(in srgb, var(--vscode-testing-iconPassed) 20%, transparent); color: var(--vscode-testing-iconPassed); }
    .token-impact-medium { background: color-mix(in srgb, var(--vscode-problemsWarningIcon-foreground) 20%, transparent); color: var(--vscode-problemsWarningIcon-foreground); }
    .token-impact-high { background: color-mix(in srgb, var(--vscode-testing-iconFailed) 20%, transparent); color: var(--vscode-testing-iconFailed); }`;
}

function renderTestingStatCard(label: string, value: string, meta: string): string {
  return `
    <article class="stat-card">
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-value">${escapeHtml(value)}</span>
      <div class="stat-meta">${escapeHtml(meta)}</div>
    </article>`;
}

/**
 * Re-exported so existing importers keep working. There is now exactly one
 * reader: this file used to carry a byte-identical copy, which meant two
 * implementations that could disagree about whether a config was usable, and
 * both hard-gated on `version === 1` — so a file written by a newer AtlasMind
 * read as "no testing policy at all" and was liable to be overwritten with a
 * fresh default.
 */
export { readProjectTestingConfig };


export async function writeProjectTestingConfig(
  workspaceRoot: string,
  config: import('../types.js').ProjectTestingConfig,
): Promise<void> {
  const configUri = vscode.Uri.file(path.join(workspaceRoot, TESTING_CONFIG_SSOT_PATH));
  const updated: import('../types.js').ProjectTestingConfig = { ...config, updatedAt: new Date().toISOString() };
  await vscode.workspace.fs.writeFile(configUri, Buffer.from(JSON.stringify(updated, null, 2), 'utf-8'));
}

/**
 * Save the testing matrix **and** push it to the AI instruction files that read it.
 *
 * The two used to be separate, and only one of three writers did both: the
 * Settings page synced, while the Project Dashboard's methodology toggle and the
 * auto-assess flow wrote the file alone. So turning a methodology off from the
 * dashboard left `CLAUDE.md`, `AGENTS.md` and `.github/copilot-instructions.md`
 * still instructing every external agent to follow it — the config said one thing
 * and the tools reading it said another, with nothing on screen to suggest they
 * had diverged.
 *
 * The sync is best-effort and deliberately cannot fail the save: the file on disk
 * is the source of truth, and a mirror that could block it would make a
 * write-through cache out of a copy.
 */
export async function persistTestingConfig(
  workspaceRoot: string,
  config: import('../types.js').ProjectTestingConfig,
  agents: import('../types.js').AgentDefinition[],
): Promise<{ syncSummary?: string }> {
  await writeProjectTestingConfig(workspaceRoot, config);
  try {
    const result = await syncTestingProtocols(
      workspaceRoot,
      config,
      agents,
      parseCustomDebtMarkers(
        vscode.workspace.getConfiguration('atlasmind').get<string[]>('debt.markers', []),
      ),
      readWorkflowGuidanceInput(workspaceRoot),
    );
    return result.success ? { syncSummary: result.summary } : {};
  } catch {
    return {};
  }
}

/**
 * The Scaffold framework action, in one place.
 *
 * There are two ways to reach it — the button on Settings → Testing and the
 * `atlasmind.scaffoldTestingFramework` command — and they had drifted into
 * doing different things. The command scaffolded the files and stopped: it
 * never ran the outbound protocol sync, so every external AI tool
 * (`CLAUDE.md`, Copilot, Cursor, …) carried on reading the *previous* set of
 * methodologies while the repository had just been scaffolded for the new one.
 * Its confirmation dialog did not mention the sync either, so nothing about the
 * outcome contradicted what the user had been told.
 *
 * That is the same failure the auto-assess path was fixed for in v0.222.0 —
 * "it previously wrote the file alone, which is how a project could enable
 * thirteen methodologies in one click and leave every AI tool reading the old
 * set" — reappearing at a second entry point. One function now, so a third
 * entry point cannot reintroduce it.
 *
 * `atlasContext` is optional because the command palette can run without a
 * panel: without it the scaffold and sync still happen and only the first-test
 * authoring is skipped, which the returned message states rather than implies.
 */
export async function runTestingScaffoldWithSync(
  atlasContext?: import('../extension.js').AtlasMindContext,
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showInformationMessage('No workspace open — open a folder first.');
    return;
  }
  const config = readProjectTestingConfig(workspaceRoot);
  if (!config) {
    void vscode.window.showInformationMessage('No testing configuration saved yet — open Settings → Testing and save the matrix first.');
    return;
  }
  const confirm = await vscode.window.showInformationMessage(
    'Scaffold the testing framework for the enabled methodologies? This creates starter files only where absent, refreshes the managed strategy playbook, and syncs the enabled protocols into existing AI instruction files.',
    {
      modal: true,
      detail: 'If the project already has Vitest or Jest and AtlasMind finds a small exported source target, it will also ask an Atlas agent to author one focused test. The agent must inspect the code first, will not install dependencies or change production code, and normal tool approvals still apply.',
    },
    'Scaffold',
  );
  if (confirm !== 'Scaffold') {
    return;
  }
  try {
    const result = await scaffoldTestingFramework(workspaceRoot, config);
    const protocolSync = await syncTestingProtocols(
      workspaceRoot,
      config,
      atlasContext?.agentRegistry?.listAgents() ?? [],
      parseCustomDebtMarkers(
        vscode.workspace.getConfiguration('atlasmind').get<string[]>('debt.markers', []),
      ),
      readWorkflowGuidanceInput(workspaceRoot),
    );
    const firstTestSummary = result.firstTestCandidate
      ? await SettingsPanel.authorFirstScaffoldTestFor(atlasContext, result.firstTestCandidate, config)
      : 'No codebase-specific first-test task was started: AtlasMind needs an existing Vitest or Jest runner and a small exported source module before it can safely nominate one.';
    if (result.success) {
      void vscode.window.showInformationMessage(`${result.summary} ${protocolSync.summary} ${firstTestSummary}`);
    } else {
      void vscode.window.showWarningMessage(result.summary);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Failed to scaffold testing framework: ${detail}`);
  }
}

/**
 * Gathers what the *codebase* shows, kept apart from what its prose claims.
 *
 * The previous version returned one flat string with three kilobytes of README
 * mixed into it, and only ever parsed `package.json` — so a Python, Rust, Go or
 * Java project contributed no dependency evidence at all and was assessed
 * almost entirely on its README. Measured on this repository, twelve policies
 * fired on README text alone.
 *
 * Two things changed. Dependencies are read from **every** manifest, so the
 * assessment works on projects that are not Node. And prose is returned as its
 * own field rather than concatenated, because `assessTestingMethodologies`
 * cannot apply the observed-versus-stated rule to a corpus that has already
 * thrown the distinction away.
 *
 * Everything unreadable is *reported* rather than swallowed: "we could not
 * parse your manifest" and "your manifest says nothing relevant" are different
 * facts, and only the second one supports a conclusion.
 */
async function gatherTestingEvidence(workspaceRoot: string): Promise<ProjectTestingEvidence> {
  const dependencies: string[] = [];
  const scripts: string[] = [];
  const paths: string[] = [];
  const prose: string[] = [];
  const unreadable: string[] = [];

  const readIfPresent = (rel: string): string | undefined => {
    const abs = path.join(workspaceRoot, rel);
    if (!existsSync(abs)) { return undefined; }
    try {
      return readFileSync(abs, 'utf8');
    } catch {
      unreadable.push(rel);
      return undefined;
    }
  };

  // ── Node ──────────────────────────────────────────────────────
  const pkgRaw = readIfPresent('package.json');
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
      dependencies.push(...Object.keys(Object.assign(
        {},
        pkg['dependencies'] as Record<string, string> | undefined,
        pkg['devDependencies'] as Record<string, string> | undefined,
      )));
      const pkgScripts = pkg['scripts'] as Record<string, string> | undefined;
      if (pkgScripts) {
        scripts.push(...Object.keys(pkgScripts), ...Object.values(pkgScripts));
      }
      // A publishable package is a library, and libraries carry different
      // obligations to their consumers than an application does.
      if (pkg['private'] !== true && typeof pkg['name'] === 'string') {
        dependencies.push('library', 'sdk', 'package');
      }
    } catch {
      unreadable.push('package.json');
    }
  }

  // ── Other language manifests ──────────────────────────────────
  //
  // Read as raw text rather than parsed. A full TOML/XML/Gradle parser for each
  // is a lot of surface for a heuristic, and the only question being asked is
  // whether a name appears — which the boundary-matched signal test answers
  // correctly against raw manifest text.
  for (const manifest of [
    'pyproject.toml', 'requirements.txt', 'Pipfile', 'setup.py', 'setup.cfg',
    'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts',
    'Gemfile', 'composer.json', 'pubspec.yaml', 'mix.exs',
  ]) {
    const text = readIfPresent(manifest);
    if (text) {
      dependencies.push(text.slice(0, 20_000));
      paths.push(manifest);
    }
  }

  // ── Files and directories that exist ──────────────────────────
  //
  // A fixed probe list rather than a walk: this runs on a button press, the
  // paths a tool creates are well known, and a workspace walk on a large
  // monorepo is a cost the user did not ask for.
  for (const rel of [
    '.github/workflows', '.github/CODEOWNERS', 'CODEOWNERS', '.gitlab-ci.yml', 'Jenkinsfile',
    '.circleci', 'azure-pipelines.yml', '.buildkite', 'SECURITY.md', 'PRIVACY.md',
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'k8s', 'charts', 'helm',
    'migrations', 'db/migrate', 'prisma/migrations', 'alembic.ini', 'alembic',
    'buf.yaml', 'sbom.cdx.json', 'sbom.json', 'deny.toml', 'MODEL_CARD.md',
    'openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.json', 'asyncapi.yaml',
    'project_memory/operations/compliance',
  ]) {
    if (existsSync(path.join(workspaceRoot, rel))) {
      paths.push(rel);
    }
  }

  // Terraform and proto files are conventionally scattered, so they need a scan
  // rather than a probe. Bounded to one hit — presence is the whole question.
  for (const [glob, token] of [
    ['**/*.tf', 'terraform'],
    ['**/*.proto', 'protobuf'],
    ['**/*.{html,htm,svelte,vue,jsx,tsx}', 'web app frontend'],
  ] as const) {
    try {
      const found = await vscode.workspace.findFiles(glob, '**/node_modules/**', 1);
      if (found.length > 0) { paths.push(token); }
    } catch {
      unreadable.push(`scan for ${glob}`);
    }
  }

  // Test-tool config files, by basename.
  try {
    const configFiles = await vscode.workspace.findFiles(
      '**/{jest,vitest,cypress,playwright,mocha,.mocharc,karma,jasmine,stryker,k6,artillery,locust,pact,backstop,cucumber,knip,dependency-cruiser,promptfooconfig}.{config.,conf.,}{js,ts,mjs,cjs,json,yaml,yml}',
      '**/node_modules/**',
      40,
    );
    paths.push(...configFiles.map(f => path.basename(f.fsPath)));
  } catch {
    unreadable.push('test tooling config scan');
  }

  // ── Prose: describes the goal, never decides the policy ───────
  const readme = readIfPresent('README.md');
  if (readme) { prose.push(readme.slice(0, 8000)); }
  const soul = readIfPresent('project_memory/project_soul.md');
  if (soul) { prose.push(soul.slice(0, 4000)); }

  // Contributor count is a fact about the repository, but it speaks to how the
  // team works rather than to what the code contains — so it lands in prose,
  // where it can suggest the collaboration-shaped policies without switching
  // them on. A two-person repository is not evidence that anyone writes Gherkin.
  try {
    const { stdout } = await execFileAsync('git', ['shortlog', '-s', 'HEAD'], { cwd: workspaceRoot, timeout: 4000 });
    if (stdout.trim().split('\n').filter(Boolean).length > 1) {
      prose.push('product team user story acceptance criteria');
    }
  } catch { /* no git or no commits — add nothing rather than guessing solo */ }

  return {
    dependencies,
    scripts,
    paths,
    prose: prose.join(' '),
    unreadable,
  };
}

export function collectTestingDashboardSnapshot(
  atlasContext?: import('../extension.js').AtlasMindContext,
): TestingDashboardSnapshot {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const verificationEnabled = configuration.get<boolean>('autoVerifyAfterWrite', true);
  const verificationScripts = (configuration.get<string[]>('autoVerifyScripts', ['test']) ?? [])
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean);
  const testingPolicyOverride = getNonEmptyString(configuration.get<string>('testingPolicyOverride'), '');
  const testingPolicyLabel = testingPolicyOverride || 'Red-Green TDD';
  const testingPolicyDetail = testingPolicyOverride
    ? 'Using the workspace override configured for AtlasMind testing policy.'
    : verificationEnabled
      ? 'Default Atlas policy: capture the smallest relevant failing test first, then turn it green.'
      : 'Default Atlas policy still prefers tests-first behavior changes, but verification is currently more manual.';

  const availableAgentSummaries: Array<{ id: string; name: string }> =
    typeof atlasContext?.agentRegistry?.listAgents === 'function'
      ? atlasContext.agentRegistry.listAgents().map((a: { id: string; name: string }) => ({ id: a.id, name: a.name }))
      : [];

  if (!workspaceRoot) {
    return {
      frameworkLabel: 'No workspace',
      testingPolicyLabel,
      testingPolicyDetail,
      totalFiles: 0,
      totalSuites: 0,
      totalCases: 0,
      unitFiles: 0,
      integrationFiles: 0,
      e2eFiles: 0,
      averageCasesPerFile: '0',
      coverageDetail: 'Open a workspace to inspect tests and coverage.',
      packageScripts: [],
      configFiles: [],
      files: [],
      tests: [],
      categoryCounts: [
        { key: 'unit', label: 'Unit', count: 0 },
        { key: 'integration', label: 'Integration', count: 0 },
        { key: 'e2e', label: 'E2E', count: 0 },
        { key: 'other', label: 'Other', count: 0 },
      ],
      verificationEnabled,
      verificationScripts,
      projectTestingConfig: undefined,
      availableAgentSummaries,
      methodologyDefinitions: TESTING_METHODOLOGY_DEFINITIONS,
      policyCoverage: deriveTestingPolicyCoverage({
        enabledMethodologies: [],
        testFiles: [],
        dependencies: [],
        scripts: [],
        configFiles: [],
      }),
      // No workspace means nothing was assessed, which the derivation states in
      // its own summary rather than reporting an empty set as a clean bill.
      policyDetails: deriveTestingPolicyDetails(undefined),
    };
  }

  const projectTestingConfig = readProjectTestingConfig(workspaceRoot);

  let packageScripts: string[] = [];
  let frameworkLabel = 'Workspace tests';
  const configFiles: string[] = [];
  // Every script and dependency name, not just the test-shaped ones: the policy
  // readout below asks "is this policy's tooling installed at all", which the
  // display-filtered lists cannot answer.
  let allScriptNames: string[] = [];
  let dependencyNames: string[] = [];
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  if (existsSync(packageJsonPath)) {
    configFiles.push('package.json');
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      allScriptNames = Object.keys(packageJson.scripts ?? {}).slice(0, 200);
      dependencyNames = [
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.devDependencies ?? {}),
      ].slice(0, 500);
      packageScripts = allScriptNames
        .filter(name => /(test|coverage|vitest|jest|playwright|cypress|watch)/i.test(name))
        .slice(0, 8);
      frameworkLabel = inferTestingFramework(packageJson);
    } catch {
      frameworkLabel = 'Workspace tests';
    }
  }

  for (const candidate of ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'jest.config.ts', 'jest.config.js', 'playwright.config.ts']) {
    if (existsSync(path.join(workspaceRoot, candidate))) {
      configFiles.push(candidate);
    }
  }

  const discoveredFiles = discoverTestFiles(workspaceRoot);
  let totalSuites = 0;
  let totalCases = 0;
  let unitFiles = 0;
  let integrationFiles = 0;
  let e2eFiles = 0;
  let newestTestFileMs = 0;
  const discoveredTests: TestingCaseSummary[] = [];
  const policyTestFiles: TestingPolicyTestFile[] = [];

  const fileSummaries = discoveredFiles.map(filePath => {
    const relativePath = toWorkspaceRelativePath(workspaceRoot, filePath);
    const category = inferTestingCategory(relativePath);
    const fileText = safeReadTextFile(filePath);
    const suites = countPatternMatches(fileText, /\bdescribe\s*\(/g);
    const cases = countPatternMatches(fileText, /\b(?:it|test)(?:\.(?:only|skip|todo|fails|concurrent))?(?:\.each\([^)]*\))?\s*\(/g);
    // Tests that exist but do not run. Locally derivable and always available,
    // unlike a failure count — a skipped test is a gap the panel should show.
    const skipped = countPatternMatches(fileText, /\b(?:it|test|describe)\.(?:skip|todo)\s*\(|\bx(?:it|describe)\s*\(|@(?:pytest\.mark\.)?skip|@unittest\.skip|#\[ignore\]|\bt\.Skip\(/g);
    const modified = statSync(filePath).mtime;
    const lastModifiedLabel = `Updated ${modified.toISOString().slice(0, 10)}`;
    newestTestFileMs = Math.max(newestTestFileMs, modified.getTime());
    policyTestFiles.push({ relativePath, cases, skipped });

    totalSuites += suites;
    totalCases += cases;
    discoveredTests.push(...extractIndividualTests(fileText, relativePath, category));
    if (category === 'unit') {
      unitFiles += 1;
    } else if (category === 'integration') {
      integrationFiles += 1;
    } else if (category === 'e2e') {
      e2eFiles += 1;
    }

    return {
      relativePath,
      category,
      suites,
      cases,
      lastModifiedLabel,
    } satisfies TestingFileSummary;
  });

  const enabledMethodologies = (projectTestingConfig?.methodologies ?? [])
    .filter(entry => entry.enabled)
    .map(entry => entry.id);
  const discoveredReport = findTestResultReport(workspaceRoot);
  const parsedReport = discoveredReport ? parseJUnitReport(discoveredReport.text) : undefined;
  const policyCoverage = deriveTestingPolicyCoverage({
    // Nothing enabled yet means the two Atlas defaults, matching what the
    // strategy table shows in that state rather than an empty board.
    enabledMethodologies: enabledMethodologies.length > 0 ? enabledMethodologies : ['tdd', 'unit'],
    testFiles: policyTestFiles,
    dependencies: dependencyNames,
    scripts: allScriptNames,
    configFiles: [...configFiles, ...probePolicyConfigFiles(workspaceRoot)],
    ...(parsedReport && discoveredReport
      ? { report: { ...parsedReport, relativePath: discoveredReport.relativePath, generatedAtMs: discoveredReport.generatedAtMs } }
      : {}),
    ...(newestTestFileMs > 0 ? { newestTestFileMs } : {}),
    frameworkLabel,
  });
  const policyEvidence = {
    testFiles: policyTestFiles,
    dependencies: dependencyNames,
    scripts: allScriptNames,
    configFiles: [...configFiles, ...probePolicyConfigFiles(workspaceRoot)],
  };

  const coverageInfoPath = path.join(workspaceRoot, 'coverage', 'lcov.info');
  const coverage = parseLcovCoverage(coverageInfoPath);
  const coverageReportRelativePath = existsSync(path.join(workspaceRoot, 'coverage', 'lcov-report', 'index.html'))
    ? 'coverage/lcov-report/index.html'
    : (existsSync(path.join(workspaceRoot, 'coverage', 'index.html')) ? 'coverage/index.html' : undefined);

  return {
    policyEvidence,
    frameworkLabel,
    testingPolicyLabel,
    testingPolicyDetail,
    totalFiles: discoveredFiles.length,
    totalSuites,
    totalCases,
    unitFiles,
    integrationFiles,
    e2eFiles,
    averageCasesPerFile: discoveredFiles.length > 0 ? getRangedNumber(totalCases / discoveredFiles.length, 0, 0, 999, 1) : '0',
    coveragePercent: coverage.percent,
    coverageDetail: coverage.detail,
    packageScripts,
    configFiles,
    coverageReportRelativePath,
    coverageDataRelativePath: coverage.exists ? 'coverage/lcov.info' : undefined,
    files: fileSummaries.slice(0, 12),
    tests: discoveredTests.slice(0, MAX_DISCOVERED_TEST_CASES),
    categoryCounts: [
      { key: 'unit', label: 'Unit', count: discoveredTests.filter(test => test.category === 'unit').length },
      { key: 'integration', label: 'Integration', count: discoveredTests.filter(test => test.category === 'integration').length },
      { key: 'e2e', label: 'E2E', count: discoveredTests.filter(test => test.category === 'e2e').length },
      { key: 'other', label: 'Other', count: discoveredTests.filter(test => test.category === 'other').length },
    ],
    verificationEnabled,
    verificationScripts,
    projectTestingConfig,
    availableAgentSummaries,
    methodologyDefinitions: TESTING_METHODOLOGY_DEFINITIONS,
    policyCoverage,
    policyDetails: deriveTestingPolicyDetails(policyCoverage, {
      scaffoldable: scaffoldableMethodologies(workspaceRoot, policyCoverage.rows.map(row => row.id)),
    }),
  };
}

/**
 * Config and CI files that evidence a testing policy's tooling.
 *
 * A fixed probe list rather than a walk: this runs on every dashboard render, and
 * the paths a tool writes are well known. Returns workspace-relative paths only.
 */
function probePolicyConfigFiles(workspaceRoot: string): string[] {
  const candidates = [
    'cypress.config.ts', 'cypress.config.js', 'wdio.conf.ts', 'wdio.conf.js',
    'stryker.conf.json', 'stryker.conf.js', 'stryker.conf.mjs', '.stryker-tmp',
    'backstop.json', '.percy.yml', '.percy.yaml', 'loki.config.js',
    'semgrep.yml', 'semgrep.yaml', '.semgrep.yml', '.snyk', '.gitleaks.toml', 'SECURITY.md',
    'openapi.yaml', 'openapi.yml', 'openapi.json', 'asyncapi.yaml', 'swagger.json',
    '.spectral.yaml', '.spectral.yml', 'redocly.yaml',
    '.gitlab-ci.yml', 'azure-pipelines.yml', 'Jenkinsfile', '.travis.yml', 'bitbucket-pipelines.yml',
    'setup.cfg', 'pytest.ini', 'tox.ini',
  ];
  const found = candidates.filter(candidate => existsSync(path.join(workspaceRoot, candidate)));
  // Directories are reported with a trailing slash so a `^\.github/workflows/`
  // style marker matches without needing to enumerate the workflow files.
  for (const dir of ['.github/workflows', '.circleci', 'pacts', 'features']) {
    if (existsSync(path.join(workspaceRoot, dir))) {
      found.push(`${dir}/`);
    }
  }
  // Compliance control mappings are named per policy, so the directory marker
  // trick above does not work — a `^…/compliance/gdpr\.md$` pattern has to see
  // the actual filename or every compliance policy would match every mapping.
  // Enumerated rather than probed by id: this module does not own the policy
  // list, and a mapping written by hand should count exactly like a scaffolded
  // one.
  try {
    const entries = readdirSync(path.join(workspaceRoot, COMPLIANCE_EVIDENCE_DIR), { withFileTypes: true, encoding: 'utf8' });
    for (const entry of entries.slice(0, 80)) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        found.push(`${COMPLIANCE_EVIDENCE_DIR}/${entry.name}`);
      }
    }
  } catch {
    // No compliance mappings in this project — not an error, and deliberately
    // not the same as an empty one: the policy simply reads as unassessed.
  }
  return found;
}

/**
 * Find the newest machine-readable test report the project has produced.
 *
 * A fixed candidate list plus a shallow scan of the handful of directories
 * runners conventionally write to — never a workspace walk. Nothing is executed
 * to create one: if the project has not written a report, the panel says so
 * rather than implying a clean run.
 */
function findTestResultReport(workspaceRoot: string): { relativePath: string; text: string; generatedAtMs: number } | undefined {
  const MAX_REPORT_SIZE = 8_000_000;
  const candidates = [
    'junit.xml', 'test-results.xml', 'test-report.xml', 'report.xml',
    'test-results/junit.xml', 'test-results/results.xml', 'test-results/test-results.xml',
    'reports/junit.xml', 'coverage/junit.xml',
  ];
  for (const dir of ['test-results', 'reports', 'target/surefire-reports', 'build/test-results/test', 'TestResults']) {
    try {
      const entries = readdirSync(path.join(workspaceRoot, dir), { withFileTypes: true, encoding: 'utf8' });
      for (const entry of entries.slice(0, 40)) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) {
          candidates.push(`${dir}/${entry.name}`);
        }
      }
    } catch {
      // Directory absent or unreadable — nothing to add.
    }
  }

  let best: { relativePath: string; text: string; generatedAtMs: number } | undefined;
  for (const relativePath of [...new Set(candidates)].slice(0, 60)) {
    const absolute = path.join(workspaceRoot, relativePath);
    try {
      const stat = statSync(absolute);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_REPORT_SIZE) {
        continue;
      }
      if (best && stat.mtimeMs <= best.generatedAtMs) {
        continue;
      }
      const text = readFileSync(absolute, 'utf8');
      best = { relativePath, text, generatedAtMs: stat.mtimeMs };
    } catch {
      // Unreadable or missing — skip it.
    }
  }
  return best;
}

export function extractIndividualTests(
  fileText: string,
  relativePath: string,
  category: TestingFileSummary['category'],
): TestingCaseSummary[] {
  const lines = fileText.split(/\r?\n/g);
  const tests: TestingCaseSummary[] = [];
  let currentSuite = 'Top-level tests';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const describeMatch = line.match(/\bdescribe(?:\.(?:only|skip))?\s*\(\s*(["'`])(.+?)\1/);
    if (describeMatch?.[2]) {
      currentSuite = describeMatch[2].trim();
    }

    const testMatch = line.match(/\b(?:it|test)(?:\.(?:only|skip|todo|fails|concurrent))?(?:\.each\([^)]*\))?\s*\(\s*(["'`])(.+?)\1/);
    if (!testMatch?.[2]) {
      continue;
    }

    const title = testMatch[2].trim();
    const blockLines = collectTestBlockLines(lines, index);
    const description = findNearestComment(lines, index) || `${currentSuite} → ${title}`;
    tests.push({
      id: `${relativePath}:${index + 1}:${tests.length + 1}`,
      status: 'unknown',
      title,
      suiteTitle: currentSuite,
      relativePath,
      category,
      line: index + 1,
      description,
      inputSummary: summarizeTestInputs(blockLines),
      outputSummary: summarizeTestOutputs(blockLines),
    });
  }

  return tests;
}

function collectTestBlockLines(lines: string[], startIndex: number): string[] {
  const block: string[] = [];
  let depth = 0;

  for (let index = startIndex; index < Math.min(lines.length, startIndex + 24); index += 1) {
    const line = lines[index] ?? '';
    if (index > startIndex && /\b(?:describe|it|test)\b/.test(line) && depth <= 0) {
      break;
    }
    block.push(line);
    depth += countPatternMatches(line, /\{/g) - countPatternMatches(line, /\}/g);
    if (index > startIndex && depth <= 0 && /\)?\s*;?\s*$/.test(line.trim())) {
      break;
    }
  }

  return block;
}

function findNearestComment(lines: string[], index: number): string | undefined {
  for (let cursor = index - 1; cursor >= Math.max(0, index - 3); cursor -= 1) {
    const candidate = (lines[cursor] ?? '').trim().replace(/^\/\/\s?/, '').replace(/^\*\s?/, '');
    if (!candidate) {
      continue;
    }
    if (candidate.startsWith('//') || lines[cursor]?.trim().startsWith('//') || lines[cursor]?.trim().startsWith('*')) {
      return candidate;
    }
    break;
  }
  return undefined;
}

function summarizeTestInputs(lines: string[]): string {
  const inputLines = lines
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !/^\s*(?:it|test|describe)\b/.test(line))
    .filter(line => !/^\s*(?:expect\s*\(|await expect\s*\()/.test(line))
    .filter(line => !/^[)};]+$/.test(line))
    .slice(0, 3)
    .map(cleanCodePreview);
  return inputLines.length > 0 ? inputLines.join(' • ') : 'See the source block for arrange and act details.';
}

function summarizeTestOutputs(lines: string[]): string {
  const outputLines = lines
    .map(line => line.trim())
    .filter(line => /\bexpect\s*\(|\bto(?:Be|Equal|Contain|Match|Throw|Have)\b/.test(line))
    .slice(0, 3)
    .map(cleanCodePreview);
  return outputLines.length > 0 ? outputLines.join(' • ') : 'No explicit assertion summary was detected in this snippet.';
}

function cleanCodePreview(line: string): string {
  return line.replace(/\s+/g, ' ').replace(/^[([{]+|[)\]};,]+$/g, '').slice(0, 140).trim();
}

function discoverTestFiles(workspaceRoot: string): string[] {
  const results: Array<{ filePath: string; mtimeMs: number }> = [];
  const pending = [workspaceRoot];

  while (pending.length > 0 && results.length < MAX_DISCOVERED_TEST_FILES) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    let entries: Array<import('node:fs').Dirent<string>>;
    try {
      entries = readdirSync(current, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!TEST_SCAN_EXCLUDED_DIRS.has(entry.name.toLowerCase())) {
          pending.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = toWorkspaceRelativePath(workspaceRoot, fullPath);
      const isNamedTest = TEST_FILE_NAME_PATTERN.test(entry.name);
      const isTestFolderSource = /(^|\/)(tests?|__tests__)(\/|$)/i.test(relativePath) && TEST_CODE_EXT_PATTERN.test(entry.name) && !entry.name.endsWith('.d.ts');
      if (!isNamedTest && !isTestFolderSource) {
        continue;
      }

      try {
        results.push({ filePath: fullPath, mtimeMs: statSync(fullPath).mtimeMs });
      } catch {
        // Ignore stat failures for transient files.
      }
    }
  }

  return results
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map(item => item.filePath);
}

function inferTestingFramework(packageJson: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): string {
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };

  if ('vitest' in dependencies) {
    return 'Vitest';
  }
  if ('jest' in dependencies) {
    return 'Jest';
  }
  if ('playwright' in dependencies || '@playwright/test' in dependencies) {
    return 'Playwright';
  }
  if ('cypress' in dependencies) {
    return 'Cypress';
  }
  if ('mocha' in dependencies) {
    return 'Mocha';
  }

  const scriptNames = Object.keys(packageJson.scripts ?? {}).join(' ').toLowerCase();
  if (scriptNames.includes('vitest')) {
    return 'Vitest';
  }
  if (scriptNames.includes('jest')) {
    return 'Jest';
  }
  if (scriptNames.includes('playwright')) {
    return 'Playwright';
  }
  return 'Workspace tests';
}

function inferTestingCategory(relativePath: string): TestingFileSummary['category'] {
  if (/(^|\/)(e2e|playwright|cypress)(\/|$)/i.test(relativePath)) {
    return 'e2e';
  }
  if (/integration/i.test(relativePath)) {
    return 'integration';
  }
  if (/unit/i.test(relativePath) || /(?:test|spec)/i.test(relativePath)) {
    return 'unit';
  }
  return 'other';
}

function safeReadTextFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8').slice(0, MAX_TEST_FILE_BYTES);
  } catch {
    return '';
  }
}

function countPatternMatches(content: string, pattern: RegExp): number {
  return content.match(pattern)?.length ?? 0;
}

function parseLcovCoverage(filePath: string): { exists: boolean; percent?: string; detail: string } {
  if (!existsSync(filePath)) {
    return { exists: false, detail: 'No coverage report found yet. Generate one from your test runner when you need line-hit metrics.' };
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    let linesFound = 0;
    let linesHit = 0;
    for (const line of content.split(/\r?\n/g)) {
      if (line.startsWith('LF:')) {
        linesFound += Number.parseInt(line.slice(3), 10) || 0;
      } else if (line.startsWith('LH:')) {
        linesHit += Number.parseInt(line.slice(3), 10) || 0;
      }
    }

    if (linesFound <= 0) {
      return { exists: true, detail: 'Coverage data exists, but AtlasMind could not extract line totals from it.' };
    }

    const percent = ((linesHit / linesFound) * 100).toFixed(1).replace(/\.0$/, '');
    return {
      exists: true,
      percent: `${percent}%`,
      detail: `${linesHit}/${linesFound} lines hit in the latest LCOV report.`,
    };
  } catch {
    return { exists: true, detail: 'Coverage data exists, but the report could not be parsed safely.' };
  }
}

function toWorkspaceRelativePath(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
}

function isSafeWorkspaceRelativePath(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().replace(/\\/g, '/');
  if (normalized.length === 0 || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    return false;
  }
  return normalized.split('/').every(segment => segment.length > 0 && segment !== '..');
}

function resolveWorkspaceRelativePath(workspaceRoot: string, candidate: string): string | undefined {
  if (!isSafeWorkspaceRelativePath(candidate)) {
    return undefined;
  }
  const resolved = path.resolve(workspaceRoot, candidate);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return resolved;
}

export function isSettingsMessage(value: unknown): value is SettingsMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  const message = value as { type?: unknown; payload?: unknown };
  if (message.type === 'setBudgetMode') {
    return typeof message.payload === 'string' && BUDGET_MODES.includes(message.payload as BudgetMode);
  }

  if (message.type === 'setSpeedMode') {
    return typeof message.payload === 'string' && SPEED_MODES.includes(message.payload as SpeedMode);
  }

  if (message.type === 'setFeedbackRoutingWeight') {
    return typeof message.payload === 'number'
      && Number.isFinite(message.payload)
      && message.payload >= 0
      && message.payload <= 2;
  }

  if (message.type === 'setLocalOpenAiBaseUrl') {
    return typeof message.payload === 'string' && message.payload.trim().length > 0;
  }

  if (message.type === 'setLocalOpenAiEndpoints') {
    return Array.isArray(message.payload) && message.payload.every(candidate => {
      if (typeof candidate !== 'object' || candidate === null) {
        return false;
      }
      const record = candidate as Record<string, unknown>;
      return typeof record['id'] === 'string'
        && record['id'].trim().length > 0
        && typeof record['label'] === 'string'
        && record['label'].trim().length > 0
        && typeof record['baseUrl'] === 'string'
        && record['baseUrl'].trim().length > 0;
    });
  }

  if (message.type === 'installRecommendedLocalModel') {
    if (typeof message.payload !== 'object' || message.payload === null) {
      return false;
    }
    const payload = message.payload as Record<string, unknown>;
    return (payload['runtime'] === 'ollama' || payload['runtime'] === 'lmstudio')
      && typeof payload['modelTag'] === 'string'
      && payload['modelTag'].trim().length > 0;
  }

  if (message.type === 'removeInstalledLocalModel') {
    if (typeof message.payload !== 'object' || message.payload === null) {
      return false;
    }
    const payload = message.payload as Record<string, unknown>;
    return (payload['runtime'] === 'ollama' || payload['runtime'] === 'lmstudio')
      && typeof payload['modelId'] === 'string'
      && payload['modelId'].trim().length > 0;
  }

  if (message.type === 'setDailyCostLimitUsd') {
    return typeof message.payload === 'number' && Number.isFinite(message.payload) && message.payload >= 0;
  }

  if (message.type === 'setToolApprovalMode') {
    return typeof message.payload === 'string' && [
      'always-ask',
      'ask-on-write',
      'ask-on-external',
      'allow-safe-readonly',
    ].includes(message.payload);
  }

  if (message.type === 'setShowImportProjectAction') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setAllowTerminalWrite') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setAcpToolsEnabled') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setAcpHideConsoleWindows') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setAutoVerifyAfterWrite') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setAutoVerifyScripts') {
    return typeof message.payload === 'string';
  }

  if (message.type === 'setVoiceTtsEnabled') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setVoiceLanguage' || message.type === 'setVoiceOutputDeviceId') {
    return typeof message.payload === 'string';
  }

  if (message.type === 'setVoiceRate') {
    return typeof message.payload === 'number'
      && Number.isFinite(message.payload)
      && message.payload >= 0.5
      && message.payload <= 2;
  }

  if (message.type === 'setVoicePitch') {
    return typeof message.payload === 'number'
      && Number.isFinite(message.payload)
      && message.payload >= 0
      && message.payload <= 2;
  }

  if (message.type === 'setVoiceVolume') {
    return typeof message.payload === 'number'
      && Number.isFinite(message.payload)
      && message.payload >= 0
      && message.payload <= 1;
  }

  if (
    message.type === 'setAutoVerifyTimeoutMs' ||
    message.type === 'setChatSessionTurnLimit' ||
    message.type === 'setChatSessionContextChars' ||
    message.type === 'setProjectApprovalFileThreshold' ||
    message.type === 'setProjectEstimatedFilesPerSubtask' ||
    message.type === 'setProjectChangedFileReferenceLimit' ||
    message.type === 'setMaxToolIterations'
  ) {
    return typeof message.payload === 'number' && Number.isFinite(message.payload) && message.payload >= 1;
  }

  if (message.type === 'setProjectRunReportFolder') {
    return typeof message.payload === 'string' && message.payload.trim().length > 0;
  }

  if (message.type === 'setProjectDependencyMonitoringEnabled') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setProjectDependencyMonitoringProviders') {
    return Array.isArray(message.payload) && message.payload.every(value => DEPENDENCY_MONITORING_PROVIDERS.includes(value as DependencyMonitoringProvider));
  }

  if (message.type === 'setProjectDependencyMonitoringSchedule') {
    return typeof message.payload === 'string' && DEPENDENCY_MONITORING_SCHEDULES.includes(message.payload as DependencyMonitoringSchedule);
  }

  if (message.type === 'setDisplayCurrency') {
    return typeof message.payload === 'string' && DISPLAY_CURRENCIES.includes(message.payload as DisplayCurrency);
  }

  if (message.type === 'setProjectDependencyMonitoringIssueTemplate') {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setExperimentalSkillLearningEnabled') {
    return typeof message.payload === 'boolean';
  }

  if (
    message.type === 'setLoopEnabled' ||
    message.type === 'setLoopRequireApprovalBeforeWriteBatches' ||
    message.type === 'setLoopAllowDiscovery'
  ) {
    return typeof message.payload === 'boolean';
  }

  if (
    message.type === 'setLoopDefaultMaxIterations' ||
    message.type === 'setLoopDefaultMaxTokens' ||
    message.type === 'setLoopDefaultMaxDurationMinutes' ||
    message.type === 'setLoopMaxConsecutiveNoProgress'
  ) {
    return typeof message.payload === 'number' && Number.isFinite(message.payload) && message.payload >= 1;
  }

  if (message.type === 'setLoopDefaultMaxCostUsd') {
    return typeof message.payload === 'number' && Number.isFinite(message.payload) && message.payload > 0;
  }

  if (message.type === 'setLoopCheckpointEveryNIterations') {
    return typeof message.payload === 'number' && Number.isFinite(message.payload) && message.payload >= 0;
  }

  if (
    message.type === 'setLoopCheckpointAtBudgetFraction' ||
    message.type === 'setLoopGoalAchievedConfidenceThreshold'
  ) {
    return typeof message.payload === 'number' && Number.isFinite(message.payload) && message.payload >= 0 && message.payload <= 1;
  }

  if (message.type === 'openWorkspaceFile') {
    return isSafeWorkspaceRelativePath(message.payload);
  }

  if (message.type === 'restoreModelSidebarEntry') {
    return typeof message.payload === 'string'
      && message.payload.length > 0
      && message.payload.length <= 4096
      && !/[\u0000-\u001f\u007f]/.test(message.payload);
  }

  if (
    message.type === 'refreshTestingInventory' ||
    message.type === 'createTestFile' ||
    message.type === 'openCoverageReport' ||
    message.type === 'autoAssessTestingConfig' ||
    message.type === 'syncTestingProtocols' ||
    message.type === 'scaffoldTestingFramework'
  ) {
    return true;
  }

  if (
    message.type === 'purgeProjectMemory' ||
    message.type === 'openChatView' ||
    message.type === 'openChatPanel' ||
    message.type === 'openAgentPanel' ||
    message.type === 'openPersonalityProfile' ||
    message.type === 'openModelProviders' ||
    message.type === 'openSpecialistIntegrations' ||
    message.type === 'openProjectRunCenter' ||
    message.type === 'setupLensDeclarations' ||
    message.type === 'openLensDashboard' ||
    message.type === 'openCompareModels' ||
    message.type === 'openVoicePanel' ||
    message.type === 'openVisionPanel' ||
    message.type === 'chooseAcpConsoleMode' ||
    message.type === 'openChat' ||
    message.type === 'recommendLocalModels' ||
    message.type === 'scanAiInstructions' ||
    message.type === 'alignAiInstructions'
  ) {
    return true;
  }

  if (message.type === 'syncAiInstructions') {
    return Array.isArray(message.payload) && message.payload.every(
      (p: unknown) => typeof p === 'string' && isSafeWorkspaceRelativePath(p),
    );
  }

  if (message.type === 'saveTestingConfig') {
    if (typeof message.payload !== 'object' || message.payload === null) {
      return false;
    }
    const payload = message.payload as Record<string, unknown>;
    return payload['version'] === 1 && Array.isArray(payload['methodologies'])
      && payload['methodologies'].every((m: unknown) => {
        if (typeof m !== 'object' || m === null) return false;
        const item = m as Record<string, unknown>;
        return typeof item['id'] === 'string' && typeof item['enabled'] === 'boolean';
      });
  }

  if (
    message.type === 'setBuzzEnabled'
    || message.type === 'setBuzzAllowRemoteRelay'
    || message.type === 'setBuzzInboundEnabled'
    || message.type === 'setBuzzAutoCreateFollowUps'
  ) {
    return typeof message.payload === 'boolean';
  }

  if (message.type === 'setBuzzRelayUrl' || message.type === 'setBuzzInboundChannels') {
    // Empty is meaningful for both: it clears the relay, or watches by kind alone.
    return typeof message.payload === 'string';
  }

  if (message.type === 'openBuzzAgentKey' || message.type === 'openDirectorRoster'
    || message.type === 'openBuzzGuide' || message.type === 'fetchBuzzChannels'
    || message.type === 'openMcpManager') {
    return true;
  }

  if (message.type === 'connectMcpServer' || message.type === 'disconnectMcpServer') {
    return typeof message.payload === 'string' && message.payload.trim().length > 0;
  }

  if (message.type === 'setMcpServerEnabled') {
    const payload = message.payload as Record<string, unknown> | undefined;
    return typeof payload === 'object' && payload !== null
      && typeof payload['id'] === 'string' && payload['id'].trim().length > 0
      && typeof payload['enabled'] === 'boolean';
  }

  if (message.type === 'ardExportCatalog') {
    return true;
  }

  if (message.type === 'ardSearch') {
    return typeof message.payload === 'object' && message.payload !== null
      && typeof (message.payload as Record<string, unknown>)['query'] === 'string';
  }

  if (message.type === 'ardFetchManifest') {
    return typeof message.payload === 'object' && message.payload !== null
      && typeof (message.payload as Record<string, unknown>)['url'] === 'string';
  }

  if (message.type === 'ardInstall') {
    return typeof message.payload === 'object' && message.payload !== null
      && typeof (message.payload as Record<string, unknown>)['identifier'] === 'string';
  }

  if (message.type === 'ardToggleFinder') {
    const payload = message.payload as Record<string, unknown> | null;
    return typeof payload === 'object' && payload !== null
      && typeof payload['id'] === 'string' && typeof payload['enabled'] === 'boolean';
  }

  if (message.type === 'ardRemoveFinder') {
    return typeof message.payload === 'object' && message.payload !== null
      && typeof (message.payload as Record<string, unknown>)['id'] === 'string';
  }

  if (message.type === 'ardAddFinder') {
    const payload = message.payload as Record<string, unknown> | null;
    return typeof payload === 'object' && payload !== null
      && typeof payload['name'] === 'string' && typeof payload['url'] === 'string';
  }

  return false;
}

function normalizeSettingsPanelTarget(target?: SettingsPageId | SettingsPanelTarget): SettingsPanelTarget {
  if (typeof target === 'string') {
    return { page: isSettingsPageId(target) ? target : undefined };
  }

  const page = isSettingsPageId(target?.page) ? target?.page : undefined;
  const query = typeof target?.query === 'string' && target.query.trim().length > 0 ? target.query.trim() : undefined;
  const section = typeof target?.section === 'string' && target.section.trim().length > 0 ? target.section.trim() : undefined;
  return { page, query, section };
}

function isSettingsPageId(value: unknown): value is SettingsPageId {
  return typeof value === 'string' && SETTINGS_PAGE_IDS.includes(value as SettingsPageId);
}

function shortArdType(type: string): string {
  return type
    .replace(/^application\//, '')
    .replace(/\+json$/, '')
    .replace(/^vnd\.atlasmind\./, '');
}

function truncateArd(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

function getBudgetMode(value: string | undefined): BudgetMode {
  return BUDGET_MODES.includes(value as BudgetMode) ? value as BudgetMode : 'balanced';
}

function getSpeedMode(value: string | undefined): SpeedMode {
  return SPEED_MODES.includes(value as SpeedMode) ? value as SpeedMode : 'balanced';
}

function getNonNegativeNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function getToolApprovalMode(value: string | undefined): 'always-ask' | 'ask-on-write' | 'ask-on-external' | 'allow-safe-readonly' {
  switch (value) {
    case 'always-ask':
    case 'ask-on-write':
    case 'ask-on-external':
    case 'allow-safe-readonly':
      return value;
    default:
      return 'ask-on-write';
  }
}

function getDependencyMonitoringProviders(value: string[] | undefined): DependencyMonitoringProvider[] {
  const providers = (value ?? []).filter(candidate => DEPENDENCY_MONITORING_PROVIDERS.includes(candidate as DependencyMonitoringProvider)) as DependencyMonitoringProvider[];
  return providers;
}

function getDependencyMonitoringSchedule(value: string | undefined): DependencyMonitoringSchedule {
  return DEPENDENCY_MONITORING_SCHEDULES.includes(value as DependencyMonitoringSchedule)
    ? value as DependencyMonitoringSchedule
    : 'weekly';
}

function getPositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

function getPositiveNumber(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function getNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

/** Format a number with up to `decimals` places, trimming trailing zeros (e.g. 5.00 → "5"). */
function formatPlainNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** Format an integer with a thousands separator (comma every three digits). */
function groupThousands(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function getRangedNumber(value: number | undefined, fallback: number, min: number, max: number, decimals = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback.toFixed(decimals);
  }

  const clamped = Math.min(max, Math.max(min, value));
  return clamped.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function renderFieldLabel(forId: string, text: string, helpId: SettingsHelpId): string {
  return `<label for="${escapeHtml(forId)}" class="label-with-help"><span>${escapeHtml(text)}</span>${renderHelpIndicator(helpId)}</label>`;
}

function renderHeadingWithHelp(text: string, helpId: SettingsHelpId): string {
  return `<span class="heading-with-help"><span>${escapeHtml(text)}</span>${renderHelpIndicator(helpId)}</span>`;
}

function renderRoutingChoicePill(group: 'budget' | 'speed', value: string, label: string, checked: boolean, description: string): string {
  const escapedDescription = escapeHtml(description);
  return `<label class="choice-pill" data-tooltip="${escapedDescription}" title="${escapedDescription}"><input type="radio" name="${escapeHtml(group)}" value="${escapeHtml(value)}" ${checked ? 'checked' : ''} aria-label="${escapeHtml(`${label}. ${description}`)}"><span>${escapeHtml(label)}</span></label>`;
}

function renderHelpIndicator(helpId: SettingsHelpId): string {
  return `<span class="help-indicator" tabindex="0" role="note" aria-label="${escapeHtml(SETTINGS_HELP[helpId])}" data-tooltip="${escapeHtml(SETTINGS_HELP[helpId])}">?</span>`;
}

function getNonEmptyString(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }
  return value.trim();
}

function normalizeLocalOpenAiBaseUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return trimmed.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function normalizeLocalOpenAiEndpoints(endpoints: LocalEndpointConfig[]): LocalEndpointConfig[] {
  const usedIds = new Set<string>();
  const normalized: LocalEndpointConfig[] = [];
  for (const [index, endpoint] of endpoints.entries()) {
    const baseUrl = normalizeLocalOpenAiBaseUrl(endpoint.baseUrl);
    if (!baseUrl) {
      continue;
    }

    const label = endpoint.label.trim().length > 0
      ? endpoint.label.trim()
      : inferLocalEndpointLabel(baseUrl);

    let id = endpoint.id.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!id || usedIds.has(id)) {
      id = `endpoint-${index + 1}`;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `endpoint-${index + 1}-${suffix}`;
        suffix += 1;
      }
    }
    usedIds.add(id);
    normalized.push({ id, label, baseUrl });
  }
  return normalized;
}

type ConfigInspectShape<T> = {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
};

async function migrateLegacyLocalOpenAiSettings(configuration: vscode.WorkspaceConfiguration): Promise<LocalEndpointConfig[] | undefined> {
  const endpointsInspect = configuration.inspect<unknown>('localOpenAiEndpoints') as ConfigInspectShape<unknown> | undefined;
  if (hasExplicitConfigurationValue(endpointsInspect)) {
    return undefined;
  }

  const legacyInspect = configuration.inspect<string>('localOpenAiBaseUrl') as ConfigInspectShape<string> | undefined;
  const legacyResolution = resolveLegacyLocalEndpointMigration(legacyInspect);
  if (!legacyResolution) {
    return undefined;
  }

  const normalized = normalizeLocalOpenAiEndpoints([{
    id: inferLocalEndpointLabel(legacyResolution.baseUrl),
    label: inferLocalEndpointLabel(legacyResolution.baseUrl),
    baseUrl: legacyResolution.baseUrl,
  }]);
  if (normalized.length === 0) {
    return undefined;
  }

  await configuration.update('localOpenAiEndpoints', normalized, legacyResolution.target);
  return normalized;
}

function hasExplicitConfigurationValue(inspect: ConfigInspectShape<unknown> | undefined): boolean {
  return inspect?.workspaceFolderValue !== undefined
    || inspect?.workspaceValue !== undefined
    || inspect?.globalValue !== undefined;
}

function resolveLegacyLocalEndpointMigration(inspect: ConfigInspectShape<string> | undefined): { baseUrl: string; target: vscode.ConfigurationTarget } | undefined {
  const workspaceFolderBaseUrl = normalizeLocalOpenAiBaseUrl(inspect?.workspaceFolderValue ?? '');
  if (workspaceFolderBaseUrl) {
    return { baseUrl: workspaceFolderBaseUrl, target: vscode.ConfigurationTarget.WorkspaceFolder };
  }

  const workspaceBaseUrl = normalizeLocalOpenAiBaseUrl(inspect?.workspaceValue ?? '');
  if (workspaceBaseUrl) {
    return { baseUrl: workspaceBaseUrl, target: vscode.ConfigurationTarget.Workspace };
  }

  const globalBaseUrl = normalizeLocalOpenAiBaseUrl(inspect?.globalValue ?? '');
  if (globalBaseUrl) {
    return { baseUrl: globalBaseUrl, target: vscode.ConfigurationTarget.Global };
  }

  return undefined;
}

function resolveRuntimeBaseUrls(configuration: vscode.WorkspaceConfiguration): { ollamaBaseUrl: string; lmStudioBaseUrl: string } {
  const endpoints = getConfiguredLocalEndpoints({
    getEndpoints: () => configuration.get<unknown>('localOpenAiEndpoints'),
    getLegacyBaseUrl: () => configuration.get<string>('localOpenAiBaseUrl'),
  });

  const defaultOllama = 'http://127.0.0.1:11434';
  const defaultLmStudio = 'http://127.0.0.1:1234';

  let ollamaBaseUrl: string | undefined;
  let lmStudioBaseUrl: string | undefined;

  for (const endpoint of endpoints) {
    const runtime = inferRuntimeFromEndpoint(endpoint);
    if (runtime === 'ollama' && !ollamaBaseUrl) {
      ollamaBaseUrl = toRuntimeRootBaseUrl(endpoint.baseUrl);
    }
    if (runtime === 'lmstudio' && !lmStudioBaseUrl) {
      lmStudioBaseUrl = toRuntimeRootBaseUrl(endpoint.baseUrl);
    }
  }

  return {
    ollamaBaseUrl: ollamaBaseUrl ?? defaultOllama,
    lmStudioBaseUrl: lmStudioBaseUrl ?? defaultLmStudio,
  };
}

function inferRuntimeFromEndpoint(endpoint: LocalEndpointConfig): 'ollama' | 'lmstudio' | 'unknown' {
  const label = endpoint.label.toLowerCase();
  if (label.includes('ollama')) {
    return 'ollama';
  }
  if (label.includes('lm studio') || label.includes('lmstudio')) {
    return 'lmstudio';
  }

  try {
    const parsed = new URL(endpoint.baseUrl);
    if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === '11434') {
      return 'ollama';
    }
    if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === '1234') {
      return 'lmstudio';
    }
  } catch {
    // Fall through
  }

  return 'unknown';
}

function toRuntimeRootBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    if (normalizedPath === '/v1') {
      parsed.pathname = '';
      return parsed.toString().replace(/\/+$/, '');
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  }
}

/** Lightweight reachability probe for the Ollama daemon (2.5s timeout). */
async function isOllamaReachable(ollamaBaseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${ollamaBaseUrl.replace(/\/+$/, '')}/api/version`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Interpret one newline-delimited JSON object from Ollama's `/api/pull` stream.
 * Returns a human-readable progress `text` (status + percentage when a byte
 * count is present), an `error` message, or an empty object for blank/non-JSON
 * keep-alive lines. Pure — unit-tested.
 */
export function interpretOllamaPullLine(line: string): { text?: string; error?: string } {
  const trimmed = line.trim();
  if (!trimmed) {
    return {};
  }
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return {};
  }
  if (typeof obj['error'] === 'string') {
    return { error: obj['error'] };
  }
  const status = typeof obj['status'] === 'string' ? obj['status'] : '';
  const completed = typeof obj['completed'] === 'number' ? obj['completed'] : undefined;
  const total = typeof obj['total'] === 'number' ? obj['total'] : undefined;
  if (status && completed !== undefined && total !== undefined && total > 0) {
    const pct = Math.floor((completed / total) * 100);
    return { text: `${status} — ${pct}% (${formatByteCount(completed)}/${formatByteCount(total)})` };
  }
  return status ? { text: status } : {};
}

/**
 * Pull a model into Ollama via `POST /api/pull`, streaming the newline-delimited
 * JSON progress objects so the caller can surface live download progress (rather
 * than blocking silently on a single `stream:false` request). Talking to the API
 * directly — which is exactly what the `ollama pull` CLI does under the hood —
 * means this works without the CLI on PATH and honours a remote `ollamaBaseUrl`.
 * Honours `signal` for cancellation and throws on any reported error.
 */
async function installOllamaModel(
  ollamaBaseUrl: string,
  modelTag: string,
  onProgress?: (line: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${ollamaBaseUrl.replace(/\/+$/, '')}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelTag, stream: true }),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Ollama install failed (${response.status})${detail ? `: ${detail.trim()}` : ''}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastReported = '';
  let reportedError: string | undefined;

  const handleLine = (line: string): void => {
    const { text, error } = interpretOllamaPullLine(line);
    if (error) {
      reportedError = error;
      return;
    }
    if (text && text !== lastReported) {
      lastReported = text;
      onProgress?.(text);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }
  }
  handleLine(buffer);

  if (reportedError) {
    throw new Error(reportedError);
  }
}

async function removeOllamaModel(ollamaBaseUrl: string, modelId: string): Promise<void> {
  const response = await fetch(`${ollamaBaseUrl.replace(/\/+$/, '')}/api/delete`, {
    method: 'DELETE',  // Ollama's delete endpoint requires DELETE, not POST
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelId }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Ollama remove failed (${response.status}): ${detail}`);
  }
}

async function buildLocalModelRecommendationPayload(
  extensionContext: vscode.ExtensionContext,
  atlasContext?: import('../extension').AtlasMindContext,
): Promise<LocalModelRecommendationPayload> {
  const hardware = await detectLocalHardwareSnapshot();
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const { ollamaBaseUrl, lmStudioBaseUrl } = resolveRuntimeBaseUrls(configuration);
  const localSync = await loadOrRefreshLocalModelSync(
    extensionContext.globalState,
    ollamaBaseUrl,
    lmStudioBaseUrl,
  );

  const installedLocalModels = localSync?.models ?? [];

  const allRecentRecords = atlasContext?.costTracker.getRecords({ days: 30 }) ?? [];
  const recentLocalRecords = allRecentRecords
    .filter(record => record.providerId === 'local' || record.model.startsWith('local/'));

  const recentlyUsedModels = summarizeRecentLocalModels(recentLocalRecords);
  const recentlyUsedFamilies = summarizeRecentLocalFamilies(recentLocalRecords);
  const usageByFamily = new Map(recentlyUsedFamilies.map(item => [item.family, item.requests]));
  const maxGpuVramGb = hardware.gpus.reduce((max, gpu) => Math.max(max, gpu.vramGb ?? 0), 0);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const workloadContext = buildWorkloadContext(allRecentRecords, atlasContext, workspaceRoot);
  const remoteCatalog = getCachedLocalModelCatalog(extensionContext.globalState);
  const recommendationCandidates = getLocalModelRecommendationCandidates(workspaceRoot, remoteCatalog);

  const recommendations = recommendationCandidates
    .map(candidate => {
      let fitScore = candidate.releaseWeight * 8;
      const rationale: string[] = [];

      if (hardware.ramGb >= candidate.minRamGb) {
        fitScore += 18;
        rationale.push(`System RAM (${hardware.ramGb} GB) meets the ${candidate.minRamGb} GB target.`);
      } else {
        fitScore -= 22;
        rationale.push(`Model usually expects around ${candidate.minRamGb} GB RAM; your system has ${hardware.ramGb} GB.`);
      }

      if (candidate.minVramGb !== undefined) {
        if (maxGpuVramGb <= 0) {
          rationale.push(`GPU VRAM was not detected; this model typically benefits from about ${candidate.minVramGb} GB VRAM.`);
        } else if (maxGpuVramGb >= candidate.minVramGb) {
          fitScore += 16;
          rationale.push(`Detected GPU VRAM (${maxGpuVramGb} GB) clears the ${candidate.minVramGb} GB target.`);
        } else {
          fitScore -= 14;
          rationale.push(`Detected GPU VRAM (${maxGpuVramGb} GB) is below the ${candidate.minVramGb} GB target.`);
        }
      }

      const familyUsageCount = usageByFamily.get(candidate.modelFamily) ?? 0;
      if (familyUsageCount > 0) {
        fitScore += Math.min(20, familyUsageCount * 3);
        rationale.push(`You already use ${candidate.modelFamily} frequently (${familyUsageCount} recent requests).`);
      }

      // Only specific tags (not 'general') contribute to the workload signal —
      // 'general' is always present and would otherwise match every candidate.
      const specificMatchingTags = candidate.workloadTags.filter(
        tag => tag !== 'general' && workloadContext.signals.has(tag),
      );
      if (specificMatchingTags.length > 0) {
        fitScore += 14;
        const topEvidence = specificMatchingTags
          .flatMap(tag => workloadContext.evidence.get(tag) ?? [])
          .slice(0, 2);
        rationale.push(
          topEvidence.length > 0
            ? `Capability match (${specificMatchingTags.join(', ')}): ${topEvidence.join('; ')}.`
            : `Model profile matches your ${specificMatchingTags.join(' and ')} workload.`,
        );
      }

      const installedModel = findInstalledLocalMatch(candidate, installedLocalModels);
      if (installedModel) {
        fitScore += 6;
        const runtimeLabel = installedModel.runtime === 'lmstudio' ? 'LM Studio' : 'Ollama';
        rationale.push(`Already installed in ${runtimeLabel} as "${installedModel.id}".`);
      }

      return {
        modelFamily: candidate.modelFamily,
        recommendedTag: candidate.recommendedTag,
        status: installedModel ? 'installed' : 'recommended',
        ...(installedModel ? { installedModelId: installedModel.id, installedRuntime: installedModel.runtime } : {}),
        fitScore: Math.max(1, Math.min(100, Math.round(fitScore))),
        rationale,
        installHint: candidate.installHint,
      } satisfies LocalModelRecommendationItem;
    })
    .sort((left, right) => right.fitScore - left.fitScore)
    .slice(0, 4);

  const installedModels = (localSync?.models ?? [])
    .map(model => ({
      runtime: model.runtime,
      modelId: model.id,
      displayName: model.name || model.id,
      removable: model.runtime === 'ollama',
    }))
    .sort((left, right) => left.runtime.localeCompare(right.runtime) || left.displayName.localeCompare(right.displayName));

  return {
    generatedAt: new Date().toISOString(),
    hardware,
    recentlyUsedModels,
    recentlyUsedFamilies,
    recommendations,
    installedModels,
  };
}

async function loadOrRefreshLocalModelSync(
  globalState: vscode.Memento,
  ollamaBaseUrl: string,
  lmStudioBaseUrl: string,
): Promise<LocalModelSyncResult | undefined> {
  const cached = globalState.get<LocalModelSyncResult>(LOCAL_MODEL_SYNC_CACHE_KEY);
  if (cached && !isLocalSyncStale(cached)) {
    return cached;
  }

  try {
    const refreshed = await syncLocalModels(ollamaBaseUrl, lmStudioBaseUrl);
    if (refreshed.models.length > 0) {
      await globalState.update(LOCAL_MODEL_SYNC_CACHE_KEY, refreshed);
      return refreshed;
    }
  } catch {
    // Keep recommendation flow resilient even if local sync fails.
  }

  return cached;
}

function summarizeRecentLocalModels(records: ReadonlyArray<{ model: string }>): Array<{ model: string; requests: number }> {
  const usage = new Map<string, number>();
  for (const record of records) {
    const decoded = decodeLocalEndpointModelId(record.model);
    const rawModel = decoded.rawModelId.trim().toLowerCase();
    if (!rawModel) {
      continue;
    }
    usage.set(rawModel, (usage.get(rawModel) ?? 0) + 1);
  }

  return [...usage.entries()]
    .map(([model, requests]) => ({ model, requests }))
    .sort((left, right) => right.requests - left.requests)
    .slice(0, 6);
}

function summarizeRecentLocalFamilies(records: ReadonlyArray<{ model: string }>): Array<{ family: string; requests: number }> {
  const usage = new Map<string, number>();
  for (const record of records) {
    const family = inferLocalModelFamily(record.model);
    usage.set(family, (usage.get(family) ?? 0) + 1);
  }

  return [...usage.entries()]
    .map(([family, requests]) => ({ family, requests }))
    .sort((left, right) => right.requests - left.requests)
    .slice(0, 6);
}

/**
 * Aggregate workload signals from all available project context sources:
 * recent model usage (all providers), agent and skill definitions,
 * workspace project files, and SSOT project memory.
 */
function buildWorkloadContext(
  allRecords: ReadonlyArray<{ agentId?: string; model: string; providerId?: string }>,
  atlasContext: import('../extension').AtlasMindContext | undefined,
  workspaceRoot: string | undefined,
): { signals: Set<LocalRecommendationWorkloadTag>; evidence: Map<LocalRecommendationWorkloadTag, string[]> } {
  const signals = new Set<LocalRecommendationWorkloadTag>(['general']);
  const evidence = new Map<LocalRecommendationWorkloadTag, string[]>();

  function addSignal(tag: LocalRecommendationWorkloadTag, reason: string): void {
    signals.add(tag);
    const list = evidence.get(tag) ?? [];
    list.push(reason);
    evidence.set(tag, list);
  }

  // ── 1. Model names across ALL recent requests (not just local) ──────────────
  const allModelText = [...new Set(allRecords.map(r => r.model))].join(' ').toLowerCase();
  if (/code|coder|codestral|devstral|starcoder/.test(allModelText))   addSignal('code',      'code models in recent request history');
  if (/reason|r1\b|think|math|70b|30b/.test(allModelText))           addSignal('reasoning', 'reasoning models in recent request history');
  if (/vision|vl\b|llava|visual|gemma3.*(?:4b|12b)/.test(allModelText)) addSignal('vision', 'vision models in recent request history');

  // ── 2. Agent usage frequency + agent role/description keywords ──────────────
  if (atlasContext) {
    const agentUsage = new Map<string, number>();
    for (const record of allRecords) {
      if (record.agentId) agentUsage.set(record.agentId, (agentUsage.get(record.agentId) ?? 0) + 1);
    }
    const topAgentIds = new Set(
      [...agentUsage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id),
    );

    for (const agent of atlasContext.agentRegistry.listAgents()) {
      const agentText = [agent.name, agent.role, agent.description].join(' ').toLowerCase();
      const count = agentUsage.get(agent.id) ?? 0;
      const label = count > 0 ? `"${agent.name}" agent (${count} requests)` : `"${agent.name}" agent definition`;

      if (topAgentIds.has(agent.id)) {
        if (/code|review|refactor|debug|implement|test|lint|build/.test(agentText))
          addSignal('code',      label);
        if (/vision|image|screenshot|visual|diagram|ocr/.test(agentText))
          addSignal('vision',    label);
        if (/reason|analyz|research|architect|plan|strateg|think/.test(agentText))
          addSignal('reasoning', label);
      }

      // Skills assigned to any agent reveal project capability even without usage
      const skills = atlasContext.skillsRegistry.getSkillsForAgent(agent);
      for (const skill of skills) {
        const skillText = [skill.name, skill.description, ...(skill.routingHints ?? [])].join(' ').toLowerCase();
        if (/browser|screenshot|capture|image|ocr|vision/.test(skillText))
          addSignal('vision', `skill "${skill.name}"`);
        if (/code|lint|test|build|compile|git|diff|format/.test(skillText))
          addSignal('code',   `skill "${skill.name}"`);
        if (/search|research|analyz|reason/.test(skillText))
          addSignal('reasoning', `skill "${skill.name}"`);
      }
    }
  }

  // ── 3. Project framework detection from workspace manifest files ─────────────
  if (workspaceRoot) {
    // Any open workspace is a development project → code signal
    addSignal('code', 'active development workspace');

    // Python/ML libraries
    for (const manifestFile of ['requirements.txt', 'requirements-dev.txt']) {
      try {
        const filePath = path.join(workspaceRoot, manifestFile);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf8').toLowerCase();
          if (/torch|tensorflow|keras|sklearn|transformers|diffusers|jax/.test(content))
            addSignal('reasoning', `ML libraries in ${manifestFile}`);
          if (/pillow|opencv|cv2|imageio|skimage|torchvision/.test(content))
            addSignal('vision', `image libraries in ${manifestFile}`);
        }
      } catch { /* ignore */ }
    }

    // pyproject.toml
    try {
      const pyprojectPath = path.join(workspaceRoot, 'pyproject.toml');
      if (existsSync(pyprojectPath)) {
        const content = readFileSync(pyprojectPath, 'utf8').toLowerCase();
        if (/torch|tensorflow|sklearn|transformers|diffusers/.test(content))
          addSignal('reasoning', 'ML libraries in pyproject.toml');
        if (/pillow|opencv|cv2|torchvision/.test(content))
          addSignal('vision', 'image libraries in pyproject.toml');
      }
    } catch { /* ignore */ }

    // package.json — check dependency keys for ML/vision libraries
    try {
      const pkgPath = path.join(workspaceRoot, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
        const allDeps = Object.keys({
          ...(typeof pkg['dependencies'] === 'object' && pkg['dependencies'] !== null ? pkg['dependencies'] as object : {}),
          ...(typeof pkg['devDependencies'] === 'object' && pkg['devDependencies'] !== null ? pkg['devDependencies'] as object : {}),
        }).join(' ').toLowerCase();
        if (/@tensorflow|@huggingface|brain\.js|ml5|onnxruntime/.test(allDeps))
          addSignal('reasoning', 'ML libraries in package.json');
        if (/canvas|sharp|jimp|tesseract|@napi-rs\/canvas/.test(allDeps))
          addSignal('vision', 'image libraries in package.json');
      }
    } catch { /* ignore */ }
  }

  // ── 4. SSOT project_soul.md — tech stack description ─────────────────────────
  if (workspaceRoot) {
    try {
      const soulPath = path.join(workspaceRoot, 'project_memory', 'project_soul.md');
      if (existsSync(soulPath)) {
        const content = readFileSync(soulPath, 'utf8').slice(0, 3000).toLowerCase();
        if (/machine learning|deep learning|neural|llm|ai model|transformers/.test(content))
          addSignal('reasoning', 'ML/AI project in project memory');
        if (/computer vision|image processing|ocr|screenshot/i.test(content))
          addSignal('vision',    'vision workloads in project memory');
        if (/typescript|javascript|rust|golang|python|software development/.test(content))
          addSignal('code',      'software development in project memory');
      }
    } catch { /* ignore */ }
  }

  return { signals, evidence };
}

/**
 * Reduce a model tag/id to a normalized identity key for cross-runtime matching.
 * Strips the runtime/source prefix (`hf:`, `hf.co/`, `huggingface.co/`), keeps only
 * the repo name, drops quant/tag noise (`:Q4_K_M`, `:latest`) while preserving the
 * parameter size (`:14b`), removes the `-gguf`/`-instruct`/`-chat`/`-it` suffix, and
 * compacts to alphanumerics. So `hf:antirez/DeepSeek-V4-GGUF`, `deepseek-v4:latest`,
 * and `hf.co/antirez/DeepSeek-V4-GGUF:Q4_K_M` all collapse to `deepseekv4`.
 */
export function localModelMatchKey(rawId: string): string {
  let s = rawId.trim().toLowerCase();
  s = s.replace(/^hf:/, '').replace(/^hf\.co\//, '').replace(/^huggingface\.co\//, '');
  const lastSlash = s.lastIndexOf('/');
  if (lastSlash >= 0) {
    s = s.slice(lastSlash + 1); // keep the repo name, drop the owner
  }
  const colon = s.indexOf(':');
  if (colon >= 0) {
    const base = s.slice(0, colon);
    const suffix = s.slice(colon + 1);
    // Keep size-like suffixes (e.g. "14b", "30b", "8x7b"); drop quant/tag noise.
    s = /^\d/.test(suffix) ? `${base}${suffix}` : base;
  }
  s = s.replace(/[-_](gguf|instruct|chat|it)$/i, '').replace(/gguf$/i, '');
  return s.replace(/[^a-z0-9]/g, '');
}

/**
 * Determine whether a recommendation candidate is already installed in any local
 * runtime. Matches on the normalized identity key, with a coarse family-name
 * fallback for the curated default candidates whose families are canonical.
 */
export function findInstalledLocalMatch(
  candidate: { recommendedTag: string; modelFamily: string },
  installedModels: ReadonlyArray<{ id: string; runtime: 'ollama' | 'lmstudio' }>,
): { id: string; runtime: 'ollama' | 'lmstudio' } | undefined {
  const candidateKey = localModelMatchKey(candidate.recommendedTag);
  return installedModels.find(model => {
    const modelKey = localModelMatchKey(model.id);
    if (candidateKey && modelKey && candidateKey === modelKey) {
      return true;
    }
    return inferLocalModelFamily(model.id) === candidate.modelFamily;
  });
}

/** Last non-blank, trimmed line of a string, or undefined if there is none. */
function lastNonEmptyLine(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : undefined;
}

function inferLocalModelFamily(modelId: string): string {
  const raw = decodeLocalEndpointModelId(modelId).rawModelId.toLowerCase();

  if (/qwen3[:\- ]?14b/.test(raw)) return 'Qwen 3 14B';
  if (/qwen3[:\- ]?30b/.test(raw)) return 'Qwen 3 30B';
  if (/devstral/.test(raw)) return 'Devstral Small';
  if (/gemma3[:\- ]?12b/.test(raw)) return 'Gemma 3 12B';
  if (/gemma3[:\- ]?4b/.test(raw)) return 'Gemma 3 4B';
  if (/phi[-_ ]?4/.test(raw)) return 'Phi-4';
  if (/llama3\.3[:\- ]?70b|llama[-_ ]?3\.3.*70b/.test(raw)) return 'Llama 3.3 70B';
  if (/qwen3/.test(raw)) return 'Qwen 3 14B';
  if (/gemma3/.test(raw)) return 'Gemma 3 12B';

  const compact = raw.split(':')[0] ?? raw;
  return compact.length > 0 ? compact : 'Unknown local model';
}

async function detectLocalHardwareSnapshot(): Promise<LocalHardwareSnapshot> {
  const cpuModel = os.cpus()[0]?.model?.trim() || 'Unknown CPU';
  const cpuThreads = os.cpus().length;
  const ramGb = Math.max(1, Math.round(os.totalmem() / 1024 / 1024 / 1024));
  const gpus = await detectGpuInfo();
  return {
    cpuModel,
    cpuThreads,
    ramGb,
    gpus,
  };
}

/**
 * GPU names and sizes for the hardware card.
 *
 * Delegates to `providers/gpuProbe.ts`. These probes used to live here as
 * module-private functions, which meant nothing in `src/core/` could read a VRAM
 * figure — so the router could pick a local model with no idea whether it would
 * fit. The probe now also reports used and free memory, which the local GPU
 * arbiter needs and this card does not; the extra fields are simply dropped
 * here.
 */
async function detectGpuInfo(): Promise<Array<{ name: string; vramGb?: number }>> {
  const devices = await probeGpuDevices();
  return devices.map(device => {
    const vramGb = device.totalBytes !== undefined
      ? Math.round((device.totalBytes / 1024 / 1024 / 1024) * 10) / 10
      : undefined;
    return { name: device.name, ...(vramGb !== undefined ? { vramGb } : {}) };
  });
}

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
