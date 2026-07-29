import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AtlasMindContext } from '../extension.js';
import type { TaskImageAttachment } from '../types.js';
import { buildAssistantResponseMetadata, buildQuickReplyPayload, buildWorkstationContext, reconcileAssistantResponse } from '../chat/participant.js';
import { resolvePickedImageAttachments } from '../chat/imageAttachments.js';
import { collectTestingDashboardSnapshot, writeProjectTestingConfig, type TestingDashboardSnapshot } from './settingsPanel.js';
import { getWebviewHtmlShell } from './webviewUtils.js';
import {
  buildIssueWorkPrompt,
  describeIssueAction,
  parseGhIssueList,
  sanitizeIssueDraft,
  sanitizeIssueNumber,
  summarizeIssues,
  type IssueRecord,
  type IssueSummary,
} from '../core/issueTracker.js';
import { ghFailureOf, runGhOrThrow } from '../core/ghClient.js';
import {
  buildWorkflowCurriculum,
  glossaryEntry,
  nextWorkflowStep,
  referencedGlossaryKeys,
  summarizeWorkflowProgress,
  type WorkflowObservedState,
  type WorkflowProgress,
  type WorkflowStageDefinition,
  type WorkflowStageId,
} from '../core/workflowCurriculum.js';
import {
  deriveBranchMetrics,
  deriveCiMetrics,
  deriveIssueMetrics,
  derivePullRequestMetrics,
  deriveReleaseMetrics,
  deriveWorkflowHealth,
  known,
  unknown,
  type BranchMetrics,
  type CiMetrics,
  type HealthComponent,
  type IssueMetrics,
  type PullRequestMetrics,
  type ReleaseMetrics,
  type WorkflowHealth,
} from '../core/workflowMetrics.js';
import {
  describePullRequestAction,
  parseGhPullRequestList,
  type PullRequestRecord,
} from '../core/pullRequestTracker.js';
import { PROTECTED_BRANCH_NAMES } from '../core/branchNaming.js';
import {
  buildCiFailureReport,
  type CiFailureReport,
} from '../core/ciFailureAnalysis.js';
import {
  FIRST_WRITING_LEVEL,
  explainAutomationLevel,
  normalizeAutomationLevel,
  permits,
  permitsProtectedRefWrite,
  type AutomationDecision,
  type AutomationLevel,
  type WorkflowCapability,
} from '../core/workflowAutomation.js';
import { DASHBOARD_THEME_CSS } from './dashboardTheme.js';
import {
  MAX_ROADMAP_GATES,
  MVP_GATE_ID,
  ROADMAP_GATES_START,
  extractItemGates,
  formatItemGateTags,
  normalizeGates,
  parseRoadmapGates,
  sanitizeGateSelection,
  slugifyGateId,
  stripRoadmapGatesBlock,
  upsertRoadmapGatesBlock,
  type RoadmapGate,
} from '../core/roadmapGates.js';
import { DataPrivacyManager, readDataPrivacyConfig, writeDataPrivacyConfig, defaultDataPrivacyConfig } from '../core/dataPrivacyManager.js';
import { COMPLIANCE_PACKS } from '../core/compliancePacks.js';
import { getProviderDataGovernance } from '../core/providerDataGovernance.js';
import { DELIVERY_SSOT_PATH, DELIVERY_SUMMARY_SSOT_PATH, sanitizeDeliveryConfig, seedDeliveryConfig, appendPromotionHistory, readPromotionHistory, acquireDeliveryLock, releaseDeliveryLock, type DeliverySeedInput, type DeliveryArchetype } from '../core/deliveryManager.js';
import { buildPromotionPlan, evaluatePromotionGate, evaluatePromotionGateExceptFixable, runPromotion, runRollback, checkHealthUrl, classifyBumpLevel, applyPromotionRemediation } from '../core/promotionRunner.js';
import {
  PROJECT_DIRECTOR_SSOT_PATH,
  PROJECT_DIRECTOR_SUMMARY_SSOT_PATH,
  sanitizeProjectDirectorConfig,
  seedProjectDirectorConfig,
  resolveTeamMode,
  deriveFollowUpUrgency,
  countOverdueFollowUps,
  configStoresRawPii,
  appendProjectDirectorHistory,
  type ProjectDirectorSeedInput,
  type FollowUpUrgency,
} from '../core/projectDirectorManager.js';
import {
  detectConnectorCapabilities,
  resolveCapability,
  buildToolArgs,
  type DirectorCommsIntent,
  type CommsDraft,
} from '../core/directorCommsRunner.js';
import {
  parseAgentBindings,
  writeAgentBinding,
  type BuzzAgentBinding,
  type BuzzAgentBindingIssue,
} from '../core/buzzAgentBindings.js';
import { describeIdentity } from '../core/buzzDirectory.js';
import { BUZZ_AGENT_KEY_SECRET, deriveBuzzPublicKey } from '../core/buzzSigner.js';
import { mcpSkillId } from '../mcp/mcpServerRegistry.js';
import { classifyToolInvocation } from '../core/toolPolicy.js';
import { DOCUMENTS_SSOT_PATH, DOCUMENTS_SUMMARY_SSOT_PATH, createShelfFolders, newShelfPaths, sanitizeDocumentsConfig, seedDocumentsConfig } from '../core/documentsManager.js';
import {
  RISK_SSOT_PATH,
  RISK_SUMMARY_SSOT_PATH,
  RISK_DOMAINS,
  appendRiskOversightHistory,
  readRiskOversightHistory,
  openFindings,
  hasBeenAssessed,
  findingWeight,
  riskMatrixCounts,
  mergeDomainFindings,
  parseRiskFindings,
  sanitizeRiskFindings,
} from '../core/riskOversightManager.js';
import type { DataPrivacyActivityEvent, DataPrivacySensitivity, DeliveryConfig, DeploymentStage, PromotionPath, PromotionHistoryEntry, ProjectDirectorConfig, ProjectRunRecord, DocumentCadence, RiskDomain, RiskFinding, RiskOversightConfig, RiskOversightHistoryEntry, RiskStatus } from '../types.js';

const execFileAsync = promisify(execFile);
const PROJECT_DASHBOARD_VIEW_TYPE = 'atlasmind.projectDashboard';
const MAX_COMMITS = 10;
const MAX_BRANCHES = 8;
const MAX_RECENT_FILES = 8;
const MAX_RECENT_RUNS = 8;
const MAX_RECENT_SESSIONS = 8;
const SERIES_DAY_RANGE = 90;
const MAX_IDEATION_CARDS = 48;
const MAX_IDEATION_CONNECTIONS = 96;
const MAX_IDEATION_HISTORY = 18;
const PRODUCTION_BRANCH_CANDIDATES = ['main', 'master', 'production', 'prod', 'release'] as const;
const IDEATION_BOARD_FILE = 'atlas-ideation-board.json';
const IDEATION_SUMMARY_FILE = 'atlas-ideation-board.md';
const IDEATION_WORKSPACE_REGISTRY_FILE = 'atlas-ideation-workspaces.json';
const DEFAULT_IDEATION_WORKSPACE_ID = 'default';
const IDEATION_RESPONSE_TAG = 'atlasmind-ideation';
const ALLOWED_DASHBOARD_COMMANDS = new Set([
  'atlasmind.openChatView',
  'atlasmind.openChatPanel',
  'atlasmind.openModelProviders',
  'atlasmind.openCostDashboard',
  'atlasmind.openProjectRunCenter',
  'atlasmind.openSettingsProject',
  'atlasmind.openSettingsSafety',
  'atlasmind.openSettingsTesting',
  'atlasmind.openToolWebhooks',
  'atlasmind.openAgentPanel',
  'atlasmind.openVoicePanel',
  'atlasmind.openVisionPanel',
  'atlasmind.toggleAutopilot',
  'atlasmind.updateProjectMemory',
  'atlasmind.bootstrapProject',
  'atlasmind.importProject',
  'atlasmind.openMcpServers',
  'workbench.view.scm',
]);
const EXPECTED_SSOT_DIRECTORIES = [
  'agents',
  'analysis',
  'architecture',
  'decisions',
  'domain',
  'ideas',
  'index',
  'misadventures',
  'operations',
  'roadmap',
  'skills',
];
const ROADMAP_ITEMS_START = '<!-- atlasmind:roadmap-items:start -->';
const ROADMAP_ITEMS_END = '<!-- atlasmind:roadmap-items:end -->';

// The roadmap import generator (see the `atlasmind-import` block in
// improvement-plan.md) injects "Project Context" metadata and generic
// "Prioritisation Notes" scaffolding as checklist lines. These are not
// actionable backlog items and must be filtered out of the dashboard so the
// Roadmap page stops listing inappropriate items and duplicating them.
const ROADMAP_NOISE_PHRASES = new Set<string>([
  'critical, security, reliability, or production-blocking work',
  'architectural integrity and changes that unlock safer future work',
  'user-facing outcomes, milestones, and backlog order in this file',
  'user-facing outcomes, milestones, and backlog order',
  'user-facing outcomes, milestones, and backlog order transparency',
  'delivery hygiene such as tests, ci, release notes, and documentation',
  'delivery hygiene such as tests, ci, release notes, and docs',
  'delivery hygiene: tests, ci, release notes, and documentation',
  'address the highest-risk security, reliability, or correctness gap first',
  'capture or implement the next architectural decision that reduces future churn',
  'clarify the next highest-value user or business outcome',
  'confirm the most leverage-heavy technical slice and keep the stack intentional',
  'add or update the tests needed to prove the next change safely',
  'sequence the next milestone so delivery remains measurable',
  'review the operational or third-party dependencies before scaling scope',
]);

// "key: value" project-context lines the generator emits (Project, Timeline, …).
const ROADMAP_METADATA_KEY = /^(project|project type|target audience|timeline|tech stack)\s*:/i;

function normalizeRoadmapText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
}

// True when a parsed checklist line is import-generator scaffolding rather than a
// real backlog item, so the dashboard can hide it.
function isRoadmapNoiseItem(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (ROADMAP_METADATA_KEY.test(trimmed)) {
    return true;
  }
  return ROADMAP_NOISE_PHRASES.has(normalizeRoadmapText(trimmed));
}

// The backlog lives between explicit markers; parse only that region when present
// so "## Project Context" and "## Prioritisation Notes" never leak into the list.
// The release-gates block is stripped first: it is a list too, and in a document
// with no item markers its lines would otherwise be read as backlog items.
function extractRoadmapItemsRegion(content: string): string {
  const source = stripRoadmapGatesBlock(content);
  const start = source.indexOf(ROADMAP_ITEMS_START);
  const end = source.indexOf(ROADMAP_ITEMS_END);
  if (start >= 0 && end > start) {
    return source.slice(start + ROADMAP_ITEMS_START.length, end);
  }
  return source;
}

type ProjectDashboardMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openCommand'; payload: string }
  | { type: 'openPrompt'; payload: string | { prompt: string; sourcePage?: DashboardPageId } }
  | { type: 'openFile'; payload: string }
  | { type: 'openRun'; payload: string }
  | { type: 'openRunWithGoal'; payload: string }
  | { type: 'openSession'; payload: string }
  | { type: 'attachIdeationImages' }
  | { type: 'clearIdeationImages' }
  | { type: 'saveIdeationBoard'; payload: IdeationBoardPayload }
  | { type: 'saveRoadmap'; payload: DashboardRoadmapSavePayload }
  | { type: 'createRoadmapGate' }
  | { type: 'deleteRoadmapGate'; payload: string }
  | { type: 'refreshIssues' }
  | { type: 'workOnIssue'; payload: string }
  | { type: 'createIssue'; payload: { title: string; body?: string; labels?: string[] } }
  | { type: 'closeIssue'; payload: { number: number } }
  | { type: 'reopenIssue'; payload: { number: number } }
  | { type: 'commentIssue'; payload: { number: number; body: string } }
  | { type: 'createPullRequest'; payload: { title: string; body?: string; base: string; head: string; draft?: boolean } }
  | { type: 'reviewPullRequest'; payload: { number: number; verdict: 'approve' | 'request-changes' | 'comment'; body?: string } }
  | { type: 'mergePullRequest'; payload: { number: number; base: string } }
  | { type: 'closePullRequest'; payload: { number: number } }
  | { type: 'runIdeationLoop'; payload: IdeationRunPayload }
  | { type: 'runGapAnalysis' }
  | { type: 'addressGap'; payload: string }
  | { type: 'resolveGapItem'; payload: string }
  | { type: 'resolveGapGroup'; payload: string }
  | { type: 'openGapFiles'; payload: string }
  | { type: 'saveTestingConfig'; payload: import('../types.js').ProjectTestingConfig }
  | { type: 'saveDataPrivacyConfig'; payload: import('../types.js').DataPrivacyConfig }
  | { type: 'saveDeliveryConfig'; payload: import('../types.js').DeliveryConfig }
  | { type: 'requestPromotionPlan'; payload: { pathId: string; mode: 'execute' | 'runbook' } }
  | { type: 'runPromotion'; payload: { pathId: string; attestations: string[]; confirmText: string } }
  | { type: 'resolveAndRunPromotion'; payload: { pathId: string; attestations: string[]; confirmText: string } }
  | { type: 'markDeliveryReviewed' }
  | { type: 'reimportDelivery' }
  | { type: 'rollbackStage'; payload: { stageId: string; confirmText: string } }
  | { type: 'testHealthUrl'; payload: { url: string } }
  | { type: 'testDataPrivacy'; payload: { kind: 'text' | 'path'; value: string } }
  | { type: 'saveDirectorConfig'; payload: import('../types.js').ProjectDirectorConfig }
  | { type: 'seedDirectorFromRepo' }
  | { type: 'saveDocumentsConfig'; payload: import('../types.js').DocumentsConfig }
  | { type: 'seedDocumentsFromRepo' }
  | { type: 'createShelfFolder'; payload: string }
  | { type: 'runRiskAnalysis'; payload: { domain: import('../types.js').RiskDomain | 'all' } }
  | { type: 'setRiskFindingStatus'; payload: { findingId: string; status: import('../types.js').RiskStatus; note?: string } }
  | { type: 'setRiskFilter'; payload: string }
  | { type: 'copyContact'; payload: string }
  | { type: 'openContactDeepLink'; payload: { contactId: string; linkId: string } }
  | { type: 'assignRunOwner'; payload: { runId: string; contactId: string } }
  | { type: 'directorSendComms'; payload: { intent: DirectorCommsIntent; contactId: string; subject?: string; body?: string; start?: string } }
  | { type: 'setBuzzAgentBinding'; payload: { pubkey: string; agentIds: string[]; label?: string } }
  | { type: 'openExternalUrl'; payload: string };

type DashboardWebviewMessage =
  | { type: 'state'; payload: DashboardSnapshot }
  | { type: 'error'; payload: string }
  | { type: 'navigate'; payload: DashboardPageId }
  | { type: 'ideationBusy'; payload: boolean }
  | { type: 'ideationStatus'; payload: string }
  | { type: 'ideationResponseReset' }
  | { type: 'ideationResponseChunk'; payload: string }
  | { type: 'ideationQuickReplies'; payload: import('../chat/participant.js').WebviewQuickReplyPayload }
  | { type: 'gapAnalysisBusy'; payload: boolean }
  | { type: 'gapAnalysisStatus'; payload: string }
  | { type: 'riskBusy'; payload: boolean }
  | { type: 'riskStatus'; payload: string }
  | { type: 'dataPrivacyTestResult'; payload: { ok: boolean; summary: string; labels: string[] } }
  | { type: 'promotionPlan'; payload: { plan: import('../types.js').PromotionPlan; mode: 'execute' | 'runbook' } }
  | { type: 'promotionProgress'; payload: { stepId: string; label: string; index: number; total: number; status: string; output?: string } }
  | { type: 'promotionDone'; payload: import('../types.js').PromotionRunResult }
  | { type: 'promotionError'; payload: string }
  | { type: 'rollbackResult'; payload: { ok: boolean; summary: string } }
  | { type: 'healthTestResult'; payload: { ok: boolean; summary: string } };

type Tone = 'accent' | 'good' | 'warn' | 'critical' | 'neutral';

interface DashboardStat {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  pageTarget?: DashboardPageId;
  command?: string;
}

/**
 * Every id that may appear as a prompt's `sourcePage`, listed in nav order.
 *
 * Single source of truth for *validation*: the union below is derived from it and
 * {@link normalizeDashboardPromptRequest} validates against it, so adding a page
 * cannot leave one of them behind. It previously could — `privacy` shipped in the
 * webview nav but was missing from both, which silently dropped `sourcePage` on
 * every "Ask Atlas" raised from that page.
 *
 * The nav's own order and grouping live in `PAGE_GROUPS` in
 * `media/projectDashboard.js`, which is what actually renders the tabs. This
 * list is kept in the same order for readability, but the two are not
 * mechanically coupled — the webview normalises any unknown id back to
 * `overview` rather than trusting it.
 *
 * `ideation` is deliberately last and has no tab: ideation is a separate panel,
 * and this id exists only so prompts raised there route to
 * `openIdeationPromptInChat`. It used to be indistinguishable from a real page,
 * so `createOrShow(..., 'ideation')` type-checked and rendered a blank dashboard.
 */
const DASHBOARD_PAGE_IDS = [
  'overview', 'score', 'gapAnalysis', 'workflow', 'roadmap', 'issues', 'director', 'runtime', 'repo', 'testing',
  'security', 'privacy', 'risk', 'delivery', 'documents', 'ssot', 'ideation',
] as const;

type DashboardPageId = typeof DASHBOARD_PAGE_IDS[number];

type IdeationCardKind =
  | 'concept'
  | 'insight'
  | 'question'
  | 'opportunity'
  | 'risk'
  | 'experiment'
  | 'user-need'
  | 'atlas-response'
  | 'attachment';

type IdeationCardAuthor = 'user' | 'atlas';

type IdeationAnchor = 'center' | 'north' | 'east' | 'south' | 'west';

interface IdeationCardRecord {
  id: string;
  title: string;
  body: string;
  kind: IdeationCardKind;
  author: IdeationCardAuthor;
  x: number;
  y: number;
  color: string;
  imageSources: string[];
  createdAt: string;
  updatedAt: string;
}

interface IdeationWorkspaceRecord {
  id: string;
  title: string;
  boardFile: string;
  summaryFile: string;
  createdAt: string;
  updatedAt: string;
}

interface IdeationWorkspaceRegistry {
  version: 1;
  activeWorkspaceId: string;
  workspaces: IdeationWorkspaceRecord[];
}

interface IdeationConnectionRecord {
  id: string;
  fromCardId: string;
  toCardId: string;
  label: string;
}

interface IdeationHistoryEntry {
  role: 'user' | 'atlas';
  content: string;
  timestamp: string;
}

interface IdeationBoardRecord {
  version: 1;
  updatedAt: string;
  cards: IdeationCardRecord[];
  connections: IdeationConnectionRecord[];
  focusCardId?: string;
  lastAtlasResponse: string;
  nextPrompts: string[];
  history: IdeationHistoryEntry[];
}

interface IdeationStructuredSuggestion {
  title: string;
  body: string;
  kind: IdeationCardKind;
  anchor?: IdeationAnchor;
}

interface IdeationResponseParseResult {
  displayResponse: string;
  cards: IdeationStructuredSuggestion[];
  nextPrompts: string[];
}

interface IdeationBoardPayload {
  cards: IdeationCardRecord[];
  connections: IdeationConnectionRecord[];
  focusCardId?: string;
  nextPrompts?: string[];
}

interface IdeationRunPayload {
  prompt: string;
  speakResponse?: boolean;
}

interface DashboardIdeationAttachment {
  source: string;
  mimeType: string;
}

interface DashboardIdeationSnapshot {
  boardPath: string;
  summaryPath: string;
  cards: IdeationCardRecord[];
  connections: IdeationConnectionRecord[];
  focusCardId?: string;
  nextPrompts: string[];
  history: IdeationHistoryEntry[];
  lastAtlasResponse: string;
  imageAttachments: DashboardIdeationAttachment[];
  updatedAt: string;
  updatedRelative: string;
}

interface DashboardSeriesPoint {
  date: string;
  label: string;
  value: number;
}

interface DashboardBranch {
  name: string;
  lastCommitAt: string;
  lastCommitRelative: string;
  subject: string;
  upstream?: string;
  current: boolean;
}

interface DashboardCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  committedAt: string;
  committedRelative: string;
}

/** One commit reduced to the two fields the timeline charts need. */
interface DashboardCommitLogEntry {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Git author *name* only — never an address. */
  author: string;
}

interface GitSnapshot {
  currentBranch: string;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  dirty: boolean;
  branches: DashboardBranch[];
  commits: DashboardCommit[];
  commitDates: string[];
  commitLog: DashboardCommitLogEntry[];
}

interface PackageSnapshot {
  version: string;
  dependencyCount: number;
  devDependencyCount: number;
  scriptCount: number;
  keyScripts: string[];
}

interface DashboardWorkflow {
  name: string;
  path: string;
  triggers: string[];
  lastModified: string;
}

type ArtifactType = 'persistent' | 'ephemeral';
type ArtifactOrigin = 'manual' | 'generated' | 'tooling';
type ArtifactLifecycle = 'source' | 'build' | 'test' | 'deploy' | 'runtime';
type ArtifactRetention = 'keep' | 'cache' | 'discard';

interface ArtifactSignal {
  label: string;
  description: string;
  /** Workspace-relative path to open when the artifact exists, or the primary path as a reference. */
  path: string;
  type: ArtifactType;
  origin: ArtifactOrigin;
  lifecycle: ArtifactLifecycle;
  retention: ArtifactRetention;
  exists: boolean;
  /** True when the artifact is persistent+keep but absent — blocks production readiness. */
  needsAttention: boolean;
}

interface ArtifactSpec {
  label: string;
  description: string;
  /** One or more workspace-relative paths to probe; first match wins. */
  paths: string[];
  type: ArtifactType;
  origin: ArtifactOrigin;
  lifecycle: ArtifactLifecycle;
  retention: ArtifactRetention;
}

const ARTIFACT_CATALOG: ArtifactSpec[] = [
  // ── Source ──────────────────────────────────────────────────────────────
  { label: 'CHANGELOG.md', description: 'Release notes and version movement tracking.', paths: ['CHANGELOG.md'], type: 'persistent', origin: 'manual', lifecycle: 'source', retention: 'keep' },
  { label: 'README.md', description: 'Project overview and onboarding documentation.', paths: ['README.md', 'README.rst', 'README.adoc'], type: 'persistent', origin: 'manual', lifecycle: 'source', retention: 'keep' },
  { label: 'LICENSE', description: 'Open-source license terms — required for public distribution.', paths: ['LICENSE', 'LICENSE.md', 'LICENSE.txt'], type: 'persistent', origin: 'manual', lifecycle: 'source', retention: 'keep' },
  { label: 'SECURITY.md', description: 'Vulnerability disclosure and responsible reporting policy.', paths: ['SECURITY.md', '.github/SECURITY.md'], type: 'persistent', origin: 'manual', lifecycle: 'source', retention: 'keep' },
  { label: 'CONTRIBUTING.md', description: 'Contributor guide covering the pull request and review process.', paths: ['CONTRIBUTING.md'], type: 'persistent', origin: 'manual', lifecycle: 'source', retention: 'keep' },
  { label: '.gitignore', description: 'Prevents build artifacts and secrets from being committed.', paths: ['.gitignore'], type: 'persistent', origin: 'tooling', lifecycle: 'source', retention: 'keep' },
  { label: '.github/CODEOWNERS', description: 'Defines code ownership for automated review routing.', paths: ['.github/CODEOWNERS'], type: 'persistent', origin: 'manual', lifecycle: 'source', retention: 'keep' },
  { label: '.github/pull_request_template.md', description: 'Shared review checklist applied to every pull request.', paths: ['.github/pull_request_template.md'], type: 'persistent', origin: 'manual', lifecycle: 'source', retention: 'keep' },
  // ── Build ───────────────────────────────────────────────────────────────
  { label: 'out/', description: 'Compiled TypeScript output — regenerated on build, not committed.', paths: ['out'], type: 'ephemeral', origin: 'generated', lifecycle: 'build', retention: 'discard' },
  { label: 'dist/', description: 'Bundled distribution output — regenerated at release time.', paths: ['dist'], type: 'ephemeral', origin: 'generated', lifecycle: 'build', retention: 'discard' },
  { label: 'node_modules/', description: 'Installed npm dependencies — reproduced by npm install.', paths: ['node_modules'], type: 'ephemeral', origin: 'tooling', lifecycle: 'build', retention: 'cache' },
  // ── Test ────────────────────────────────────────────────────────────────
  { label: 'coverage/', description: 'Test coverage report output — generated per CI run.', paths: ['coverage', '.nyc_output'], type: 'ephemeral', origin: 'generated', lifecycle: 'test', retention: 'discard' },
  // ── Deploy ──────────────────────────────────────────────────────────────
  { label: '.github/workflows/', description: 'CI/CD pipeline definitions.', paths: ['.github/workflows'], type: 'persistent', origin: 'manual', lifecycle: 'deploy', retention: 'keep' },
  { label: 'Dependency monitor', description: 'Automated dependency update configuration (Dependabot or Renovate).', paths: ['.github/dependabot.yml', 'renovate.json', 'renovate.json5', '.github/renovate.json'], type: 'persistent', origin: 'tooling', lifecycle: 'deploy', retention: 'keep' },
];

interface DashboardRunSummary {
  id: string;
  goal: string;
  status: string;
  updatedAt: string;
  updatedRelative: string;
  progressLabel: string;
  tddLabel: string;
  tddTone: Tone;
}

interface DashboardTddSummary {
  summary: string;
  detail: string;
  tone: Tone;
  verified: number;
  blocked: number;
  missing: number;
  notApplicable: number;
  evaluatedSubtasks: number;
}

interface DashboardSessionSummary {
  id: string;
  title: string;
  turnCount: number;
  updatedAt: string;
  updatedRelative: string;
  active: boolean;
}

interface DashboardRecentFile {
  path: string;
  lastModified: string;
  lastModifiedRelative: string;
}

interface SsotDeltaArea {
  label: string;
  status: 'ok' | 'stale' | 'missing' | 'unknown';
  delta: number;
  detail: string;
}

interface SsotDelta {
  areas: SsotDeltaArea[];
  totalDelta: number;
}

interface DashboardScoreComponent {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  detail: string;
  tone: Tone;
  pageTarget?: DashboardPageId;
}

interface DashboardOutcomeSignal {
  label: string;
  ok: boolean;
  detail: string;
  actionPrompt?: string;
}

interface DashboardOutcomeCompleteness {
  desiredOutcome: string;
  score: number;
  summary: string;
  referenceCoveragePercent: number;
  roadmapCompleted: number;
  roadmapTotal: number;
  runCompletionPercent: number;
  signals: DashboardOutcomeSignal[];
}

interface DashboardRoadmapSavePayload {
  /**
   * `isMvp` is the original single-gate field and is still accepted: an older
   * webview (or a queued message from one) must not silently drop an item's MVP
   * membership. `gates` supersedes it when present.
   */
  items: Array<{ id?: string; text: string; completed?: boolean; isMvp?: boolean; gates?: string[] }>;
  /** Declared release gates, when the save also changes the gate list. */
  gates?: Array<{ id: string; label: string }>;
}

interface DashboardRoadmapItem {
  id: string;
  text: string;
  completed: boolean;
  focus: 'security' | 'architecture' | 'delivery' | 'feature' | 'documentation';
  priorityScore: number;
  priorityReason: string;
  /** Retained as `gates.includes('mvp')` — the MVP gate keeps its own name. */
  isMvp: boolean;
  /** Every declared gate this item is tagged for, in declared order. */
  gates: string[];
  mvpCandidate: boolean;
}

interface DashboardRoadmapGateView extends RoadmapGate {
  totalCount: number;
  completedCount: number;
  progressPercent: number;
}

interface DashboardMvpStep {
  id: string;
  text: string;
  focus: DashboardRoadmapItem['focus'];
  completed: boolean;
  order: number;
  rationale: string;
  tagged: boolean;
}

interface DashboardMvpSnapshot {
  hasTaggedItems: boolean;
  totalCount: number;
  completedCount: number;
  progressPercent: number;
  route: DashboardMvpStep[];
  nextStep?: DashboardMvpStep;
  candidates: DashboardMvpStep[];
  summary: string;
  planPrompt: string;
}

/**
 * The repository's issue tracker, as the dashboard sees it.
 *
 * `status` is deliberately explicit rather than an empty list: "no issues" and
 * "we could not look" are different facts, and a page that showed an empty
 * board for a missing `gh` would report a clean tracker that nobody checked.
 */
interface DashboardIssuesSnapshot {
  status: 'ready' | 'not-loaded' | 'no-cli' | 'not-authenticated' | 'no-repo' | 'error';
  /** Plain-English state, including what to run when something is missing. */
  detail: string;
  /** Command that would fix a `no-cli` / `not-authenticated` / `no-repo` state. */
  fixCommand?: string;
  repoSlug?: string;
  issues: IssueRecord[];
  summary?: IssueSummary;
  /** When the list was last fetched; absent until the first load. */
  loadedAt?: string;
  busy: boolean;
}

/**
 * The Workflow page's payload.
 *
 * Everything here is derived from data the dashboard already gathers — git
 * state, package state, governance files, testing configuration, CI workflow
 * files — so opening the page costs no network call. That is deliberate: `gh`
 * is rate-limited, and a teaching surface that spent the user's quota to
 * explain itself would be a poor trade.
 *
 * The curriculum and the metrics are computed in pure modules
 * (`workflowCurriculum.ts`, `workflowMetrics.ts`) and simply carried through
 * here, so the numbers on this page are unit-tested rather than eyeballed.
 */
/** One CI run, as `gh run list` reports it. */
interface DashboardCiRun {
  databaseId: number;
  workflowName: string;
  displayTitle: string;
  conclusion: string;
  status: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Recent runs plus a classified report for the latest failure.
 *
 * `report` absent with runs present means nothing has failed. `logFailure`
 * set means something failed but the log could not be read — a different
 * fact, and one the surface has to state rather than imply.
 */
interface DashboardCiIntelligence {
  runs: DashboardCiRun[];
  report?: CiFailureReport;
  logFailure?: string;
  loadedAt: string;
}

interface DashboardGuidedWorkflowSnapshot {
  stages: WorkflowStageDefinition[];
  progress: WorkflowProgress;
  /** The next actionable step, or absent when the workflow is complete. */
  next?: { stageId: WorkflowStageId; stepId: string; stageName: string; stepTitle: string };
  /** Only the glossary entries this curriculum actually references. */
  glossary: Array<{ key: string; term: string; definition: string }>;
  profile: 'solo' | 'studio' | 'custom';
  /** Deny-by-default: false until the user turns the workflow on. */
  enabled: boolean;
  automationLevel: string;
  /**
   * The capability gates, and where each currently stands.
   *
   * Surfaced rather than merely honoured, because the page teaches the ladder:
   * somebody learning why "full automation is possible, never default" is true
   * needs to see the four independent switches, not just be told they exist.
   */
  capabilities: Array<{ id: string; label: string; enabled: boolean; detail: string }>;
  issues?: IssueMetrics;
  /** Absent until pull requests have actually been fetched — absent ≠ zero. */
  pullRequests?: PullRequestMetrics;
  /** Absent until CI has actually been read — absent ≠ healthy. */
  ciIntelligence?: DashboardCiIntelligence;
  branches: BranchMetrics;
  ci: CiMetrics;
  release: ReleaseMetrics;
  health: WorkflowHealth;
  /** Commits per day over the standard window, for the activity chart. */
  commitSeries: DashboardSeriesPoint[];
}

interface DashboardRoadmapSnapshot {
  filePath: string;
  items: DashboardRoadmapItem[];
  completedCount: number;
  outstandingCount: number;
  nextSuggestedWork: DashboardRoadmapItem[];
  /** The MVP gate's route. Kept under its own name — it feeds the score. */
  mvp: DashboardMvpSnapshot;
  /** Declared gates with their progress, in declared order (`mvp` first). */
  gates: DashboardRoadmapGateView[];
  /** One route per gate, keyed by gate id, so switching gates needs no round trip. */
  gateRoutes: Record<string, DashboardMvpSnapshot>;
}

interface DashboardScoreRecommendation {
  horizon: 'short' | 'medium' | 'long';
  title: string;
  detail: string;
  impactLabel: string;
  actionPrompt?: string;
  pageTarget?: DashboardPageId;
  command?: string;
  filePath?: string;
}

interface DashboardScoreBreakdown {
  components: DashboardScoreComponent[];
  outcome: DashboardOutcomeCompleteness;
  recommendations: DashboardScoreRecommendation[];
}

interface DashboardVersionEntry {
  branch: string;
  version: string;
  isProduction: boolean;
}

interface DashboardVersionSnapshot {
  current: DashboardVersionEntry;
  production?: DashboardVersionEntry;
}

interface DashboardStageView {
  id: string;
  name: string;
  kind: DeploymentStage['kind'];
  rank: number;
  description: string;
  /** Empty string when the stage maps to the working tree rather than a branch. */
  branchRef: string;
  branchExists: boolean;
  /** Package version committed on the stage's branch, or '—'. */
  deployedVersion: string;
  isCurrentBranch: boolean;
  isProtected: boolean;
  hostingProvider: string;
  hostingUrl: string;
  healthCheckUrl: string;
  configLabel: string;
  dataLabel: string;
  backupRequired: boolean;
  backupConfigured: boolean;
  /** Whether a rollback command is configured (enables the Roll back action). */
  hasRollback: boolean;
  /** Plain-English security/safety reasoning shown on the card for beginners. */
  securityNotes: string[];
}

interface DashboardPromotionPathView {
  id: string;
  fromStageId: string;
  toStageId: string;
  fromName: string;
  toName: string;
  /** Routine ID that will execute this push, or '' when none is bound yet. */
  routineId: string;
  /** Ordered guardrail sequence (preflight → backup → promote → verify). */
  guardrails: string[];
  /** Named checks that must pass before the push runs. */
  gates: string[];
  requiresApproval: boolean;
  /** Promotion into the target goes through a Pull Request to a protected branch. */
  viaPullRequest: boolean;
  /** CI status checks imported from the repo's workflows / branch protection. */
  statusChecks: string[];
  backupRequired: boolean;
  backupConfigured: boolean;
  /** Deny-by-default: backup required for the target but no command set. */
  blocked: boolean;
  blockReason: string;
  versionDelta: string;
  lastPromotion?: { ranAt: string; succeeded: boolean; version: string };
}

/**
 * Fingerprint of the review-relevant delivery state. Stored (workspace-scoped)
 * when the user marks the pipeline reviewed, then diffed on later renders to
 * detect drift "since the last review".
 */
interface DeliveryReviewParts {
  /** Stable JSON projection of the stages/paths protocol. */
  config: string;
  /** Stage-candidate branches in the repo not yet mapped to any stage. */
  candidates: string[];
  /** Stage branch refs that no longer exist in the repo. */
  missing: string[];
  /** CI/CD workflow file names. */
  workflows: string[];
}

interface StoredDeliveryReview {
  reviewedAt: string;
  parts: DeliveryReviewParts;
}

interface DashboardDeliveryReview {
  needsReview: boolean;
  reasons: string[];
  reviewedAt: string | null;
  reviewedRelative: string;
}

interface DashboardStagePipeline {
  /** Workspace-relative path of the JSON source of truth. */
  configPath: string;
  /** Workspace-relative path of the human-readable markdown mirror. */
  summaryPath: string;
  stages: DashboardStageView[];
  paths: DashboardPromotionPathView[];
  /** Drift / "review needed" status comparing live state to the last review. */
  review: DashboardDeliveryReview;
  /**
   * The raw, editable config (secret-free) so the dashboard stage editor can
   * mutate a copy and post it back. Null when no pipeline exists yet.
   */
  config: DeliveryConfig | null;
  /** Recent promotion/rollback audit records (newest first). */
  history: PromotionHistoryEntry[];
  /** True when this view seeded a default pipeline on first open. */
  seeded: boolean;
  /** True when no git repository is present, so stages cannot be modelled yet. */
  notInGitRepo: boolean;
}

/** A lightweight projection of an autonomous run for the Director assignments view. */
interface DashboardDirectorRun {
  id: string;
  title: string;
  status: string;
  relative: string;
  /** Name of the human owner, when an Assignment links this run to a contact. */
  ownerName?: string;
}

interface DashboardDirectorSnapshot {
  /** Workspace-relative path of the JSON source of truth. */
  configPath: string;
  /** Workspace-relative path of the human-readable markdown mirror. */
  summaryPath: string;
  /** The raw, editable config (secret-free) so the dashboard can mutate a copy and post it back. Null when none exists yet. */
  config: ProjectDirectorConfig | null;
  /** Resolved solo/team mode driving the presentation (self-management vs full roster). */
  teamMode: 'solo' | 'team';
  /** True when a contact stores raw personal data locally (drives the GDPR notice). */
  storesRawPii: boolean;
  /** True once the user has acknowledged the one-time PII/GDPR storage notice. */
  piiAcknowledged: boolean;
  /** Count of overdue follow-ups (derived). */
  overdueCount: number;
  /** Derived urgency per follow-up id, so the client can group without re-deriving. */
  followUpUrgency: Record<string, FollowUpUrgency>;
  /** Recent autonomous runs, for the "assign a human owner" view. */
  runs: DashboardDirectorRun[];
  /** Whether guarded outbound send/schedule is enabled for this project. */
  outboundEnabled: boolean;
  /** Communication intents a connected MCP connector can perform right now. */
  connectors: Array<{ intent: DirectorCommsIntent; serverName: string; toolName: string }>;
  /** True when this view seeded a first draft on first open. */
  seeded: boolean;
  /** True when no git repository is present, so the roster cannot be seeded yet. */
  notInGitRepo: boolean;
  /**
   * AtlasMind agents a Buzz identity can be bound to, id + label only. Sent so
   * the roster can offer a picker without the client guessing agent ids.
   */
  agentChoices: Array<{ id: string; name: string }>;
  /**
   * Current `atlasmind.buzz.agentBindings`, normalised. The setting stays the
   * single source of truth — this view is a convenience editor for it, not a
   * second store, so a binding made here and one hand-written in settings can
   * never disagree.
   */
  agentBindings: BuzzAgentBinding[];
  /** Bindings that could not be used, surfaced rather than silently dropped. */
  agentBindingIssues: BuzzAgentBindingIssue[];
  /** True when `atlasmind.buzz.enabled` is on, so the UI can explain an inert binding. */
  buzzEnabled: boolean;
  /**
   * Buzz identities *observed* this session, so a handle can be picked instead
   * of typed. Never a guess: each key arrived on the wire, and each name was
   * published by its own owner. In-memory only — a roster of who spoke is not
   * something `project_memory/` should accumulate.
   */
  /**
   * Observed Buzz identities, with enough evidence attached to tell strangers
   * apart. A truncated hex key and a channel count cannot: the picker offering
   * three `dcbe44bf896f… (no published name) · seen in 1 channel` rows is a
   * list nobody can choose from knowingly.
   */
  buzzIdentities: Array<{
    pubkey: string;
    label: string;
    named: boolean;
    channelIds: string[];
    messageCount: number;
    lastSeenAt: number;
    lastMessage?: string;
    about?: string;
  }>;
  /**
   * The user's own Buzz public key, derived from the agent key already in
   * SecretStorage. The one handle that needs no lookup at all.
   */
  ownBuzzPubkey?: string;
}

type DashboardGapPriority = 'P1' | 'P2' | 'P3';
type DashboardGapCategory = 'architecture' | 'security' | 'functionality' | 'ui-ux' | 'memory' | 'code-structure' | 'testing' | 'delivery' | 'documentation' | 'quality' | 'general';

interface DashboardGapAnalysisItem {
  id: string;
  priority: DashboardGapPriority;
  category: DashboardGapCategory;
  type: 'gap' | 'concern' | 'praise';
  text: string;
  resolved: boolean;
  source: 'analysis' | 'heuristic';
}

interface DashboardGapAnalysisSnapshot {
  completed: boolean;
  items: DashboardGapAnalysisItem[];
  lastRun: string | null;
}

interface DashboardSnapshot {
  generatedAt: string;
  ssotPresent: boolean;
  workspaceName: string;
  workspaceRootLabel: string;
  repositoryLabel: string;
  currentBranch: string;
  versions: DashboardVersionSnapshot;
  healthScore: number;
  healthSummary: string;
  stats: DashboardStat[];
  charts: {
    commits: DashboardSeriesPoint[];
    runs: DashboardSeriesPoint[];
    memory: DashboardSeriesPoint[];
    /**
     * Per-person commit series over the same window, so the Overview charts can
     * be filtered to one contributor and show who did the work.
     */
    contributors: Array<{ name: string; total: number; series: DashboardSeriesPoint[] }>;
    /** Commits in the window across everyone, including any merged "Others". */
    contributorTotal: number;
  };
  repo: {
    dirty: boolean;
    ahead: number;
    behind: number;
    staged: number;
    modified: number;
    untracked: number;
    branchCount: number;
    branches: DashboardBranch[];
    commits: DashboardCommit[];
  };
  runtime: {
    enabledAgents: number;
    totalAgents: number;
    enabledSkills: number;
    totalSkills: number;
    healthyProviders: number;
    totalProviders: number;
    enabledModels: number;
    totalModels: number;
    sessionCount: number;
    projectRunCount: number;
    activeSessionId: string;
    autopilot: boolean;
    totalCostUsd: number;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    tdd: DashboardTddSummary;
    runs: DashboardRunSummary[];
    sessions: DashboardSessionSummary[];
  };
  testing: TestingDashboardSnapshot;
  ssot: {
    path: string;
    totalEntries: number;
    totalFilesOnDisk: number;
    coveragePercent: number;
    coverage: Array<{ name: string; count: number; present: boolean }>;
    recentFiles: DashboardRecentFile[];
    warnedEntries: number;
    blockedEntries: number;
    delta: SsotDelta;
  };
  roadmap: DashboardRoadmapSnapshot;
  guidedWorkflow: DashboardGuidedWorkflowSnapshot;
  issues: DashboardIssuesSnapshot;
  security: {
    toolApprovalMode: string;
    allowTerminalWrite: boolean;
    autoVerifyAfterWrite: boolean;
    autoVerifyScripts: string;
    securityPolicyPresent: boolean;
    codeownersPresent: boolean;
    prTemplatePresent: boolean;
    issueTemplateCount: number;
    changelogPresent: boolean;
    governanceProviders: string[];
  };
  delivery: {
    packageVersion: string;
    dependencyCount: number;
    devDependencyCount: number;
    scriptCount: number;
    keyScripts: string[];
    workflows: DashboardWorkflow[];
    ciSignals: Array<{ label: string; ok: boolean }>;
    reviewReadiness: Array<{ label: string; ok: boolean }>;
    artifacts: ArtifactSignal[];
    stages: DashboardStagePipeline;
  };
  director: DashboardDirectorSnapshot;
  documents: DashboardDocumentsSnapshot;
  risk: DashboardRiskSnapshot;
  score: DashboardScoreBreakdown;
  ideation: DashboardIdeationSnapshot;
  gapAnalysis: DashboardGapAnalysisSnapshot;
  privacy: DashboardPrivacySnapshot;
  // There is deliberately no `quickActions` here. Overview used to end with a
  // grid of twelve equally-weighted shortcut cards, every one of which
  // duplicated a destination already on screen — a tab, the hero score ring, a
  // stat card on the same page, or the sidebar Quick Links. It was a second
  // navigation system competing with the first, on the page that should answer
  // "how are we doing?" rather than "where would you like to go?". Overview now
  // closes with the short-horizon entries from `score.recommendations`, which
  // are derived from real state and already carry their own action.
}

interface DashboardPrivacyModelNode {
  id: string;
  name: string;
  active: boolean;
  trusted: boolean;
}

interface DashboardPrivacyProviderNode {
  id: string;
  name: string;
  models: DashboardPrivacyModelNode[];
  trustedCount: number;
}

interface DashboardPrivacyGovernanceNode {
  providerId: string;
  providerName: string;
  retentionSummary: string;
  trainsOnDataByDefault: boolean | 'unknown';
  privacyPolicyUrl?: string;
  dataRequestUrl?: string;
  dataSubjectRequestUrl?: string;
  dpaUrl?: string;
  notes?: string;
}

interface DashboardPrivacySnapshot {
  enabled: boolean;
  rules: import('../types.js').DataPrivacyRule[];
  compliancePacks: string[];
  trustedModelIds: string[];
  providers: DashboardPrivacyProviderNode[];
  packs: Array<{ id: string; label: string; description: string; detectorCount: number }>;
  activity: {
    total: number;
    redactedCount: number;
    bySource: Array<{ label: string; count: number; sensitivity: string }>;
    byDay: DashboardSeriesPoint[];
  };
  governance: DashboardPrivacyGovernanceNode[];
}

interface SsotDiskSnapshot {
  totalFiles: number;
  coverage: Array<{ name: string; count: number; present: boolean }>;
  recentFiles: DashboardRecentFile[];
}

const GAP_PRIORITY_ORDER: DashboardGapPriority[] = ['P1', 'P2', 'P3'];

function buildGapAnalysisId(text: string): string {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return 'gap';
  }
  return Buffer.from(normalized)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 16);
}

function normalizeGapPriority(value: string | undefined, fallback: DashboardGapPriority = 'P2'): DashboardGapPriority {
  return value === 'P1' || value === 'P2' || value === 'P3' ? value : fallback;
}

function normalizeGapCategory(value: string | undefined, fallback: DashboardGapCategory = 'general'): DashboardGapCategory {
  const normalized = (value ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'architecture':
    case 'security':
    case 'functionality':
    case 'ui-ux':
    case 'memory':
    case 'code-structure':
    case 'testing':
    case 'delivery':
    case 'documentation':
    case 'quality':
    case 'general':
      return normalized;
    default:
      return fallback;
  }
}

function inferGapCategory(text: string): DashboardGapCategory {
  const normalized = text.toLowerCase();
  if (/security|secret|auth|permission|owasp|privacy|token|credential/.test(normalized)) return 'security';
  if (/architecture|boundary|service|provider|routing|design/.test(normalized)) return 'architecture';
  if (/ui|ux|onboarding|empty state|layout|workflow|accessibility/.test(normalized)) return 'ui-ux';
  if (/memory|ssot|context|recall|index/.test(normalized)) return 'memory';
  if (/structure|module|folder|coupling|separation|refactor/.test(normalized)) return 'code-structure';
  if (/test|coverage|verification|tdd/.test(normalized)) return 'testing';
  if (/ci|workflow|build|deploy|release/.test(normalized)) return 'delivery';
  if (/doc|readme|changelog|guide/.test(normalized)) return 'documentation';
  if (/feature|functionality|user flow|journey|product/.test(normalized)) return 'functionality';
  return 'general';
}

function inferGapPriority(type: DashboardGapAnalysisItem['type'], text: string): DashboardGapPriority {
  if (type === 'praise') {
    return 'P3';
  }
  const normalized = text.toLowerCase();
  if (/critical|urgent|blocker|broken|missing|unsafe|security|failing/.test(normalized)) return 'P1';
  if (/needs|should|concern|review|unclear|incomplete/.test(normalized)) return 'P2';
  return 'P3';
}

function makeGapAnalysisItem(input: {
  priority?: DashboardGapPriority;
  category?: DashboardGapCategory;
  type: DashboardGapAnalysisItem['type'];
  text: string;
  resolved?: boolean;
  source?: DashboardGapAnalysisItem['source'];
}): DashboardGapAnalysisItem {
  const text = input.text.trim();
  const category = input.category ?? inferGapCategory(text);
  const priority = input.priority ?? inferGapPriority(input.type, text);
  return {
    id: buildGapAnalysisId(text),
    priority,
    category,
    type: input.type,
    text,
    resolved: input.resolved ?? false,
    source: input.source ?? 'analysis',
  };
}

function sortGapAnalysisItems(items: DashboardGapAnalysisItem[]): DashboardGapAnalysisItem[] {
  return [...items].sort((left, right) => {
    if (left.resolved !== right.resolved) {
      return left.resolved ? 1 : -1;
    }
    const priorityDelta = GAP_PRIORITY_ORDER.indexOf(left.priority) - GAP_PRIORITY_ORDER.indexOf(right.priority);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    const typeWeight = { gap: 0, concern: 1, praise: 2 } as const;
    if (typeWeight[left.type] !== typeWeight[right.type]) {
      return typeWeight[left.type] - typeWeight[right.type];
    }
    return left.text.localeCompare(right.text);
  });
}

function mergeGapAnalysisItems(primary: DashboardGapAnalysisItem[], secondary: DashboardGapAnalysisItem[]): DashboardGapAnalysisItem[] {
  const merged = new Map<string, DashboardGapAnalysisItem>();
  for (const item of [...primary, ...secondary]) {
    const key = `${item.type}|${item.category}|${item.text.toLowerCase()}`;
    if (!merged.has(key)) {
      merged.set(key, item);
    }
  }
  return sortGapAnalysisItems([...merged.values()]);
}

function _serializeGapAnalysisItems(items: DashboardGapAnalysisItem[]): string {
  return sortGapAnalysisItems(items)
    .map(item => `- [${item.resolved ? 'x' : ' '}] [${item.priority}] [${item.category}] [${item.type}] ${item.text}`)
    .join('\n');
}

function parseGapAnalysisItems(content: string): DashboardGapAnalysisItem[] {
  const items: DashboardGapAnalysisItem[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    const structured = /^- \[( |x)] \[(P[1-3])] \[([a-z0-9-]+)] \[(gap|concern|praise)] (.+)$/i.exec(trimmed);
    if (structured) {
      items.push(makeGapAnalysisItem({
        priority: normalizeGapPriority(structured[2].toUpperCase()),
        category: normalizeGapCategory(structured[3]),
        type: structured[4].toLowerCase() as DashboardGapAnalysisItem['type'],
        text: structured[5],
        resolved: structured[1] === 'x',
        source: 'analysis',
      }));
      continue;
    }

    const legacy = /^- \[( |x)] \[(gap|concern|praise)] (.+)$/i.exec(trimmed);
    if (legacy) {
      items.push(makeGapAnalysisItem({
        type: legacy[2].toLowerCase() as DashboardGapAnalysisItem['type'],
        text: legacy[3],
        resolved: legacy[1] === 'x',
        source: 'analysis',
      }));
    }
  }
  return sortGapAnalysisItems(items);
}

function buildHeuristicGapAnalysisItems(input: {
  testingSnapshot: TestingDashboardSnapshot;
  securityPolicyPresent: boolean;
  codeownersPresent: boolean;
  prTemplatePresent: boolean;
  workflowCount: number;
  ssotCoveragePercent: number;
  totalMemoryEntries: number;
  blockedEntries: number;
  warnedEntries: number;
  roadmapOutstandingCount: number;
  healthScore: number;
  outcomeScore: number;
  runtimeTdd: DashboardTddSummary;
}): DashboardGapAnalysisItem[] {
  const items: DashboardGapAnalysisItem[] = [];
  const add = (type: DashboardGapAnalysisItem['type'], priority: DashboardGapPriority, category: DashboardGapCategory, text: string) => {
    items.push(makeGapAnalysisItem({ type, priority, category, text, source: 'heuristic' }));
  };

  if (!input.securityPolicyPresent) {
    add('gap', 'P1', 'security', 'Security and disclosure guidance is missing or incomplete for the current project state.');
  } else {
    add('praise', 'P3', 'security', 'A visible security policy is already in place.');
  }

  if (!input.codeownersPresent) {
    add('concern', 'P2', 'code-structure', 'Code ownership and review boundaries are not clearly defined yet.');
  }
  if (!input.prTemplatePresent) {
    add('concern', 'P3', 'documentation', 'Pull request guidance is still missing, which can weaken review quality.');
  }

  if (input.testingSnapshot.totalFiles === 0) {
    add('gap', 'P1', 'testing', 'No automated tests were detected, leaving unfinished behavior unverified.');
  } else {
    add('praise', 'P3', 'testing', `${input.testingSnapshot.totalFiles} test file(s) are already present in the workspace.`);
  }
  if (!input.testingSnapshot.coveragePercent) {
    add('concern', 'P2', 'testing', 'Coverage reporting is not being surfaced yet, so test blind spots may still exist.');
  }
  if (input.runtimeTdd.missing > 0 || input.runtimeTdd.blocked > 0) {
    add('concern', 'P1', 'testing', `TDD evidence still shows ${input.runtimeTdd.missing} missing and ${input.runtimeTdd.blocked} blocked item(s).`);
  }

  if (input.workflowCount === 0) {
    add('gap', 'P1', 'delivery', 'No CI workflow was detected, so changes are not being automatically verified before shipping.');
  } else {
    add('praise', 'P3', 'delivery', `${input.workflowCount} delivery workflow(s) are already configured.`);
  }

  if (input.totalMemoryEntries === 0 || input.ssotCoveragePercent < 70) {
    add('concern', 'P2', 'memory', 'Project memory coverage is still thin, so Atlas may be missing key context and decisions.');
  } else {
    add('praise', 'P3', 'memory', 'SSOT memory coverage is already giving the project a strong shared context base.');
  }
  if (input.blockedEntries > 0 || input.warnedEntries > 0) {
    add('concern', 'P1', 'memory', `${input.blockedEntries} blocked and ${input.warnedEntries} warned memory entr${input.warnedEntries === 1 ? 'y' : 'ies'} need review.`);
  }

  if (input.roadmapOutstandingCount > 0 || input.outcomeScore < 75) {
    add('gap', 'P1', 'functionality', 'Core functionality and feature completeness still need work relative to the intended project outcome.');
  } else {
    add('praise', 'P3', 'functionality', 'The roadmap and stated outcome are reasonably well aligned.');
  }

  if (input.healthScore < 90) {
    add('concern', 'P2', 'architecture', 'Architecture boundaries and integration seams still deserve an explicit review before the project is considered complete.');
    add('concern', 'P2', 'code-structure', 'Code structure can likely be tightened to make future work safer and easier to reason about.');
    add('concern', 'P3', 'ui-ux', 'UI/UX flows should be checked for clarity, onboarding friction, and empty/error state polish.');
  }

  return mergeGapAnalysisItems(items, []);
}

async function collectGapAnalysisSnapshot(workspaceRoot: string | undefined, ssotPath: string, fallbackItems: DashboardGapAnalysisItem[] = []): Promise<DashboardGapAnalysisSnapshot> {
  if (!workspaceRoot) {
    return { completed: false, items: sortGapAnalysisItems(fallbackItems), lastRun: null };
  }

  const analysisPath = path.join(workspaceRoot, ssotPath, 'analysis', 'gap-analysis.md');
  if (!existsSync(analysisPath)) {
    return { completed: false, items: sortGapAnalysisItems(fallbackItems), lastRun: null };
  }

  try {
    const content = await fs.readFile(analysisPath, 'utf8');
    const stat = await fs.stat(analysisPath);
    const parsedItems = parseGapAnalysisItems(content);
    return {
      completed: content.trim().length > 0,
      // Use only the parsed analysis items when they exist — heuristic fallbacks must
      // not be merged in, otherwise old heuristic items survive across analysis runs
      // and discoveries from a new analysis never cleanly replace the previous set.
      items: parsedItems.length > 0 ? sortGapAnalysisItems(parsedItems) : sortGapAnalysisItems(fallbackItems),
      lastRun: stat.mtime.toISOString(),
    };
  } catch {
    return { completed: false, items: sortGapAnalysisItems(fallbackItems), lastRun: null };
  }
}

function buildGapAnalysisPrompt(seedItems: DashboardGapAnalysisItem[] = []): string {
  const seedLines = seedItems
    .filter(item => !item.resolved)
    .slice(0, 12)
    .map(item => `- ${item.priority} ${item.category} ${item.type}: ${item.text}`);

  return [
    'Run a project-wide gap analysis for this repository.',
    'Assess at minimum: architecture, safety/security, functionality & features, UI/UX, memory/SSOT, code structure, testing, delivery, and documentation.',
    'Briefly report your activity and findings as you work so the operator can follow the investigation live.',
    'End with a structured checklist grouped by priority using one bullet per finding in exactly this form:',
    '- [ ] [P1] [security] [gap] ...',
    '- [ ] [P2] [architecture] [concern] ...',
    '- [ ] [P3] [documentation] [praise] ...',
    ...(seedLines.length > 0 ? ['', 'Preliminary signals to confirm, refine, expand, or overturn:', ...seedLines] : []),
  ].join('\n');
}

function buildGapResolutionPrompt(items: DashboardGapAnalysisItem[], scopeLabel: string): string {
  return [
    `Resolve the following ${scopeLabel} from the Atlas gap analysis.`,
    'Investigate the repository, report your activity live as you work, and then propose or implement the safest concrete next steps.',
    '',
    ...items.map(item => `- [${item.priority}] [${item.category}] [${item.type}] ${item.text}`),
  ].join('\n');
}

const GAP_CATEGORY_FILE_FILTER: Partial<Record<DashboardGapCategory, string>> = {
  documentation: '**/*.md',
  memory: 'project_memory/**',
  'ui-ux': 'media/**,src/views/**',
  delivery: '.github/**,*.json,*.yml,*.yaml',
  testing: 'src/**,**/*.test.ts,**/*.spec.ts',
};

const GAP_SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'about', 'as', 'if',
  'and', 'or', 'but', 'nor', 'so', 'yet', 'no', 'not', 'this', 'that', 'these', 'those',
  'it', 'its', 'they', 'their', 'there', 'also', 'more', 'any', 'all', 'each', 'than', 'too',
  'very', 'just', 'such', 'up', 'use', 'used', 'using', 'need', 'needs', 'must', 'add',
  'some', 'many', 'often', 'when', 'where', 'which', 'who', 'how', 'both', 'either', 'neither',
]);

function buildGapFileSearch(item: DashboardGapAnalysisItem): { query: string; filesToInclude: string } {
  const keywords = item.text
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !GAP_SEARCH_STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 5)
    .join(' ');
  return {
    query: keywords || item.text.slice(0, 60),
    filesToInclude: GAP_CATEGORY_FILE_FILTER[item.category] ?? 'src/**',
  };
}

async function markGapResolved(workspaceRoot: string, ssotPath: string, gapId: string): Promise<void> {
  const analysisPath = path.join(workspaceRoot, ssotPath, 'analysis', 'gap-analysis.md');
  if (!existsSync(analysisPath)) {
    return;
  }

  const content = await fs.readFile(analysisPath, 'utf8');
  const updated = content.split(/\r?\n/).map(line => {
    const structured = /^- \[( |x)](?: \[(P[1-3])])?(?: \[([a-z0-9-]+)])? \[(gap|concern|praise)] (.+)$/i.exec(line.trim());
    if (!structured) {
      return line;
    }
    return buildGapAnalysisId(structured[5]) === gapId ? line.replace('- [ ]', '- [x]') : line;
  }).join('\n');

  await fs.writeFile(analysisPath, updated, 'utf8');
}

export class ProjectDashboardPanel {
  public static currentPanel: ProjectDashboardPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private ideationAttachments: TaskImageAttachment[] = [];
  private pendingNavigationTarget: DashboardPageId | undefined;
  /**
   * Issues are fetched on demand, never as part of a dashboard render: `gh` is a
   * network call against a rate-limited API, and a page that refreshed it on
   * every unrelated re-render would spend the user's quota to show a tab they
   * may not be looking at.
   */
  private issuesState: DashboardIssuesSnapshot = {
    status: 'not-loaded',
    detail: 'Issues have not been loaded yet.',
    issues: [],
    busy: false,
  };

  /**
   * Pull requests, loaded alongside issues on the same explicit refresh.
   *
   * Two reads on one user action rather than a second button, because they are
   * halves of the same question — what work is in flight — and nobody wants to
   * press refresh twice. Kept `undefined` until a load actually succeeds, so a
   * surface can tell "none open" from "never looked": the second must never
   * render as the first.
   */
  private pullRequestsState: PullRequestRecord[] | undefined;

  /**
   * Recent CI runs and the latest classified failure.
   *
   * Loaded alongside issues and pull requests on the same explicit refresh.
   * `undefined` until a load succeeds, so the surface can distinguish "no
   * failures" from "never looked" — the second must never render as the first.
   */
  private ciState: DashboardCiIntelligence | undefined;

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext, targetPage?: DashboardPageId): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ProjectDashboardPanel.currentPanel) {
      ProjectDashboardPanel.currentPanel.panel.reveal(column);
      if (targetPage) {
        ProjectDashboardPanel.currentPanel.queueNavigation(targetPage);
      }
      void ProjectDashboardPanel.currentPanel.syncState();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PROJECT_DASHBOARD_VIEW_TYPE,
      'AtlasMind Project Dashboard',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    ProjectDashboardPanel.currentPanel = new ProjectDashboardPanel(panel, context, atlas, targetPage);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly atlas: AtlasMindContext,
    initialTarget?: DashboardPageId,
  ) {
    this.panel = panel;
    this.pendingNavigationTarget = initialTarget;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    }, null, this.disposables);
    this.panel.onDidChangeViewState(({ webviewPanel }) => {
      if (webviewPanel.visible) {
        void this.syncState();
      }
    }, null, this.disposables);

    this.atlas.skillsRefresh.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.modelsRefresh.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.deliveryRefresh?.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.projectDirectorRefresh?.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.documentsRefresh?.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.riskOversightRefresh?.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.projectRunsRefresh.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.memoryRefresh.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.sessionConversation.onDidChange(() => { void this.syncState(); }, null, this.disposables);
    this.disposables.push({
      dispose: this.atlas.toolApprovalManager.onAutopilotChange(() => {
        void this.syncState();
      }),
    });
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('atlasmind')) {
          void this.syncState();
        }
      }),
    );

    void this.syncState();
  }

  private queueNavigation(pageId: DashboardPageId): void {
    this.pendingNavigationTarget = pageId;
  }

  private dispose(): void {
    ProjectDashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isProjectDashboardMessage(message)) {
      return;
    }

    switch (message.type) {
      case 'ready':
      case 'refresh':
        await this.syncState();
        return;
      case 'openPrompt':
        {
          const promptRequest = normalizeDashboardPromptRequest(message.payload);
          if (!promptRequest) {
            return;
          }
          if (promptRequest.sourcePage === 'ideation') {
            await this.openIdeationPromptInChat(promptRequest.prompt);
            return;
          }
          await vscode.commands.executeCommand('atlasmind.openChatPanel', {
            draftPrompt: promptRequest.prompt,
            sendMode: 'new-session',
          });
        }
        return;
      case 'openCommand':
        if (ALLOWED_DASHBOARD_COMMANDS.has(message.payload)) {
          await vscode.commands.executeCommand(message.payload);
        }
        return;
      case 'openFile':
        await this.openWorkspaceRelativeFile(message.payload);
        return;
      case 'openRun':
        if (message.payload.trim().length > 0) {
          await vscode.commands.executeCommand('atlasmind.openProjectRunCenter', message.payload.trim());
        }
        return;
      case 'openRunWithGoal':
        {
          const goal = message.payload.trim();
          if (goal.length > 0) {
            await vscode.commands.executeCommand('atlasmind.openProjectRunCenter', { goal, autoPreview: false });
          }
        }
        return;
      case 'openSession':
        if (message.payload.trim().length > 0) {
          await vscode.commands.executeCommand('atlasmind.openChatView', message.payload.trim());
        }
        return;
      case 'attachIdeationImages':
        await this.attachIdeationImages();
        return;
      case 'clearIdeationImages':
        this.ideationAttachments = [];
        await this.syncState();
        return;
      case 'saveIdeationBoard':
        await this.saveIdeationBoard(message.payload);
        return;
      case 'saveRoadmap':
        await this.saveRoadmap(message.payload);
        return;
      case 'createRoadmapGate':
        await this.handleCreateRoadmapGate();
        return;
      case 'deleteRoadmapGate':
        await this.handleDeleteRoadmapGate(message.payload);
        return;
      case 'refreshIssues':
        await this.handleRefreshIssues();
        return;
      case 'workOnIssue':
        await this.handleWorkOnIssue(message.payload);
        return;
      case 'createIssue':
      case 'closeIssue':
      case 'reopenIssue':
      case 'commentIssue':
        await this.handleIssueWrite(message);
        return;
      case 'createPullRequest':
      case 'reviewPullRequest':
      case 'mergePullRequest':
      case 'closePullRequest':
        await this.handlePullRequestWrite(message);
        return;
      case 'saveTestingConfig':
        {
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (workspaceRoot) {
            await writeProjectTestingConfig(workspaceRoot, message.payload);
            await this.syncState();
          }
        }
        return;
      case 'saveDataPrivacyConfig':
        {
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (workspaceRoot) {
            await writeDataPrivacyConfig(workspaceRoot, message.payload);
            // Apply immediately to the live policy so enforcement reflects the
            // saved config without waiting for the file watcher.
            this.atlas.dataPrivacyManager.setConfig(message.payload);
            await this.syncState();
          }
        }
        return;
      case 'saveDeliveryConfig':
        {
          // The webview payload is untrusted: sanitize it (clamp strings, coerce
          // types, drop dangling promotion edges) before it touches disk.
          const clean = sanitizeDeliveryConfig(message.payload);
          if (clean) {
            await this.atlas.deliveryManager.save(clean);
            // The user just authored this protocol, so treat the save as a review —
            // the "review needed" banner is for drift the user did NOT make.
            await this.storeDeliveryReviewBaseline();
            await this.syncState();
          }
        }
        return;
      case 'markDeliveryReviewed':
        await this.storeDeliveryReviewBaseline();
        await this.syncState();
        return;
      case 'reimportDelivery':
        await this.handleReimportDelivery();
        return;
      case 'rollbackStage':
        await this.handleRollbackStage(message.payload);
        return;
      case 'testHealthUrl':
        {
          const result = await checkHealthUrl(message.payload.url);
          const summary = result.ok
            ? `Healthy — responded ${result.status}.`
            : result.error ? `Unreachable — ${result.error}` : `Responded ${result.status} (not 2xx/3xx).`;
          await this.postMessage({ type: 'healthTestResult', payload: { ok: result.ok, summary } });
        }
        return;
      case 'requestPromotionPlan':
        await this.handlePromotionPlanRequest(message.payload.pathId, message.payload.mode);
        return;
      case 'runPromotion':
        await this.handleRunPromotion(message.payload);
        return;
      case 'resolveAndRunPromotion':
        await this.handleResolveAndRunPromotion(message.payload);
        return;
      case 'saveDirectorConfig':
        await this.handleSaveDirectorConfig(message.payload);
        return;
      case 'seedDirectorFromRepo':
        await this.handleSeedDirector();
        return;
      case 'runRiskAnalysis':
        await this.handleRunRiskAnalysis(message.payload.domain);
        return;
      case 'setRiskFindingStatus':
        await this.handleSetRiskFindingStatus(message.payload);
        return;
      case 'setRiskFilter':
        // View-only state; the webview owns it. Nothing to persist.
        return;
      case 'saveDocumentsConfig':
        {
          // The webview payload is untrusted: sanitize it (clamp strings, make
          // paths workspace-relative and traversal-safe) before it touches disk.
          const clean = sanitizeDocumentsConfig(message.payload);
          if (clean) {
            // Diff against what was persisted *before* the save so only shelves
            // that are genuinely new get a folder created for them.
            const added = newShelfPaths(clean, this.atlas.documentsManager.getConfig());
            await this.atlas.documentsManager.save(clean);
            await this.ensureShelfFolders(added);
            await this.syncState();
          }
        }
        return;
      case 'seedDocumentsFromRepo':
        await this.handleSeedDocuments();
        return;
      case 'createShelfFolder':
        await this.ensureShelfFolders([message.payload]);
        await this.syncState();
        return;
      case 'copyContact':
        await this.handleCopyContact(message.payload);
        return;
      case 'openContactDeepLink':
        await this.handleOpenContactDeepLink(message.payload);
        return;
      case 'assignRunOwner':
        await this.handleAssignRunOwner(message.payload);
        return;
      case 'directorSendComms':
        await this.handleDirectorSendComms(message.payload);
        break;
      case 'setBuzzAgentBinding':
        await this.handleSetBuzzAgentBinding(message.payload);
        return;
      case 'testDataPrivacy':
        {
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          const config = workspaceRoot ? readDataPrivacyConfig(workspaceRoot) : undefined;
          // Force-enable a throwaway manager so the test works even while the
          // policy master switch is off in the editor.
          const tester = new DataPrivacyManager({ ...(config ?? defaultDataPrivacyConfig()), enabled: true });
          let result: { ok: boolean; summary: string; labels: string[] };
          if (message.payload.kind === 'path') {
            const rule = tester.classifyPath(message.payload.value, workspaceRoot);
            result = rule
              ? { ok: true, summary: `Classified by rule "${rule.label || rule.value}" (${rule.sensitivity}).`, labels: [rule.label || rule.value] }
              : { ok: false, summary: 'No path rule matches this path.', labels: [] };
          } else {
            const classification = tester.classifyText(message.payload.value);
            const labels = [...new Set(classification.matches.map(m => m.label))];
            result = classification.hasClassified
              ? { ok: true, summary: `Classified — ${labels.length} detector(s) fired.`, labels }
              : { ok: false, summary: 'No classified content detected in this text.', labels: [] };
          }
          void this.panel.webview.postMessage({ type: 'dataPrivacyTestResult', payload: result });
        }
        return;
      case 'openExternalUrl':
        // Only https URLs reach here (validated in isProjectDashboardMessage);
        // these originate from the static provider-governance registry.
        await vscode.env.openExternal(vscode.Uri.parse(message.payload));
        return;
      case 'runIdeationLoop':
        await this.runIdeationLoop(message.payload);
        return;
      case 'runGapAnalysis':
        {
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!workspaceRoot) {
            return;
          }
          const configuration = vscode.workspace.getConfiguration('atlasmind');
          const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
          const snapshot = await collectDashboardSnapshot(this.atlas, this.ideationAttachments, this.issuesState, this.pullRequestsState, this.ciState);
          const seedItems = snapshot.gapAnalysis.items.filter(item => !item.resolved);
          this.queueNavigation('gapAnalysis');
          await this.postMessage({ type: 'navigate', payload: 'gapAnalysis' });
          await this.postMessage({ type: 'gapAnalysisStatus', payload: 'Opened a new Atlas chat session for live gap analysis reporting.' });
          await this.postMessage({ type: 'gapAnalysisBusy', payload: false });
          await vscode.commands.executeCommand('atlasmind.openChatPanel', {
            draftPrompt: buildGapAnalysisPrompt(seedItems),
            sendMode: 'new-session',
            autoSubmit: true,
            contextPatch: {
              dashboardGapAnalysis: {
                persist: true,
                ssotPath,
                workspaceRootLabel: path.basename(workspaceRoot),
                seedItems,
              },
            },
          });
        }
        return;
      case 'resolveGapItem':
        {
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!workspaceRoot || message.payload.trim().length === 0) {
            return;
          }
          const snapshot = await collectDashboardSnapshot(this.atlas, this.ideationAttachments, this.issuesState, this.pullRequestsState, this.ciState);
          const targetItem = snapshot.gapAnalysis.items.find(item => item.id === message.payload.trim() && !item.resolved && item.type !== 'praise');
          if (!targetItem) {
            await this.postMessage({ type: 'gapAnalysisStatus', payload: 'That gap could not be found. Try re-running the analysis.' });
            return;
          }
          await vscode.commands.executeCommand('atlasmind.openChatPanel', {
            draftPrompt: buildGapResolutionPrompt([targetItem], 'gap item'),
            sendMode: 'new-session',
            autoSubmit: true,
            contextPatch: {
              dashboardGapResolution: {
                ids: [targetItem.id],
                priority: targetItem.priority,
              },
            },
          });
          await this.postMessage({ type: 'gapAnalysisStatus', payload: `Opened a new chat session to resolve the ${targetItem.priority} ${targetItem.category} issue.` });
        }
        return;
      case 'resolveGapGroup':
        {
          const priority = message.payload.trim().toUpperCase();
          if (priority !== 'P1' && priority !== 'P2' && priority !== 'P3') {
            return;
          }
          const snapshot = await collectDashboardSnapshot(this.atlas, this.ideationAttachments, this.issuesState, this.pullRequestsState, this.ciState);
          const groupedItems = snapshot.gapAnalysis.items.filter(item => !item.resolved && item.type !== 'praise' && item.priority === priority);
          if (groupedItems.length === 0) {
            await this.postMessage({ type: 'gapAnalysisStatus', payload: `No open ${priority} items are available to resolve.` });
            return;
          }
          await vscode.commands.executeCommand('atlasmind.openChatPanel', {
            draftPrompt: buildGapResolutionPrompt(groupedItems, `${priority} gap-analysis items`),
            sendMode: 'new-session',
            autoSubmit: true,
            contextPatch: {
              dashboardGapResolution: {
                ids: groupedItems.map(item => item.id),
                priority,
              },
            },
          });
          await this.postMessage({ type: 'gapAnalysisStatus', payload: `Opened a new chat session to resolve all ${priority} items together.` });
        }
        return;
      case 'openGapFiles':
        {
          const gapId = message.payload.trim();
          if (!gapId) {
            return;
          }
          const snapshot = await collectDashboardSnapshot(this.atlas, this.ideationAttachments, this.issuesState, this.pullRequestsState, this.ciState);
          const targetItem = snapshot.gapAnalysis.items.find(item => item.id === gapId);
          if (!targetItem) {
            await this.postMessage({ type: 'gapAnalysisStatus', payload: 'Gap item not found. Try re-running the analysis.' });
            return;
          }
          const { query, filesToInclude } = buildGapFileSearch(targetItem);
          await vscode.commands.executeCommand('workbench.action.findInFiles', {
            query,
            filesToInclude,
            isRegex: false,
            isCaseSensitive: false,
            matchWholeWord: false,
            triggerSearch: true,
          });
        }
        return;
      case 'addressGap':
        {
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!workspaceRoot || message.payload.trim().length === 0) {
            return;
          }
          const configuration = vscode.workspace.getConfiguration('atlasmind');
          const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
          await markGapResolved(workspaceRoot, ssotPath, message.payload.trim());
          this.queueNavigation('gapAnalysis');
          await this.postMessage({ type: 'gapAnalysisStatus', payload: 'Marked item as resolved.' });
          await this.syncState();
        }
        return;
    }
  }

  private async openWorkspaceRelativeFile(relativeTarget: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    const parsedTarget = parseDashboardFileTarget(relativeTarget);
    const target = resolveWorkspacePath(workspaceRoot, parsedTarget.relativePath);
    if (!target) {
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      const selection = typeof parsedTarget.line === 'number'
        ? new vscode.Selection(new vscode.Position(Math.max(0, parsedTarget.line - 1), 0), new vscode.Position(Math.max(0, parsedTarget.line - 1), 0))
        : undefined;
      await vscode.window.showTextDocument(document, { preview: false, ...(selection ? { selection } : {}) });
    } catch {
      // Ignore invalid or missing targets.
    }
  }

  private async syncState(): Promise<void> {
    try {
      const snapshot = await collectDashboardSnapshot(this.atlas, this.ideationAttachments, this.issuesState, this.pullRequestsState, this.ciState);
      await this.postMessage({ type: 'state', payload: snapshot });
      if (this.pendingNavigationTarget) {
        await this.postMessage({ type: 'navigate', payload: this.pendingNavigationTarget });
        this.pendingNavigationTarget = undefined;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.postMessage({ type: 'error', payload: `Dashboard refresh failed: ${detail}` });
    }
  }

  private async attachIdeationImages(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      await this.postMessage({ type: 'ideationStatus', payload: 'Open a workspace folder before attaching ideation images.' });
      return;
    }

    const selected = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      defaultUri: workspaceFolder.uri,
      openLabel: 'Attach ideation images',
      filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
    });

    if (!selected || selected.length === 0) {
      return;
    }

    this.ideationAttachments = await resolvePickedImageAttachments(selected);
    await this.postMessage({
      type: 'ideationStatus',
      payload: this.ideationAttachments.length > 0
        ? `Attached ${this.ideationAttachments.length} image${this.ideationAttachments.length === 1 ? '' : 's'} for ideation.`
        : 'No supported images were attached.',
    });
    await this.syncState();
  }

  private async saveIdeationBoard(payload: IdeationBoardPayload): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', 'project_memory'));
    const activeWorkspace = await loadActiveIdeationWorkspace(workspaceRoot, ssotPath);
    const stored = await loadIdeationBoard(workspaceRoot, ssotPath, activeWorkspace);
    const nextBoard = sanitizeIdeationBoard({
      ...stored,
      cards: payload.cards,
      connections: payload.connections,
      focusCardId: payload.focusCardId,
      nextPrompts: payload.nextPrompts ?? stored.nextPrompts,
      updatedAt: new Date().toISOString(),
    });
    await persistIdeationBoard(workspaceRoot, ssotPath, nextBoard, activeWorkspace);
    await touchActiveIdeationWorkspace(workspaceRoot, ssotPath, activeWorkspace.id, nextBoard.updatedAt);
  }

  private async saveRoadmap(payload: DashboardRoadmapSavePayload): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    const ssotPath = normalizeSsotPath(vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', 'project_memory'));
    const filePath = path.join(workspaceRoot, ssotPath, 'roadmap', 'improvement-plan.md');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const existing = await fs.readFile(filePath, 'utf-8').catch(() => '');

    // Gates come from the payload when the save changes them, otherwise from the
    // file — a plain item save must never drop a gate the user declared.
    const declaredGates = normalizeGates(
      Array.isArray(payload.gates)
        ? payload.gates.map(gate => ({
            id: slugifyGateId((gate as { id?: unknown })?.id),
            label: typeof (gate as { label?: unknown })?.label === 'string' ? (gate as { label: string }).label : '',
            order: 0,
            builtIn: false,
          }))
        : parseRoadmapGates(existing),
    );

    const sanitizedItems = (payload.items ?? [])
      .map((item, index) => {
        // Gate tags are metadata: keep them out of the text and re-derive them
        // from the ids so the round-trip stays idempotent even if a tag leaks in.
        const rawText = typeof item.text === 'string' ? item.text : '';
        const stripped = extractItemGates(rawText, declaredGates);
        const gates = sanitizeGateSelection(
          Array.isArray(item.gates)
            ? item.gates
            : [...(item.isMvp === true ? [MVP_GATE_ID] : []), ...stripped.gates],
          declaredGates,
        );
        return {
          id: typeof item.id === 'string' && item.id.trim().length > 0 ? item.id.trim() : `roadmap-${index + 1}`,
          text: stripped.text,
          completed: item.completed === true,
          isMvp: gates.includes(MVP_GATE_ID),
          gates,
        };
      })
      .filter(item => item.text.length > 0);

    const nextDocument = serializeDashboardRoadmapDocument(existing, sanitizedItems, declaredGates);
    await fs.writeFile(filePath, nextDocument, 'utf-8');

    const ssotRoot = vscode.Uri.file(path.join(workspaceRoot, ssotPath));
    await this.atlas.memoryManager.loadFromDisk(ssotRoot);
    this.atlas.memoryRefresh.fire();
    await this.syncState();
  }

  /**
   * Declare a new release gate.
   *
   * The name is collected with a native input box rather than in the webview: it
   * becomes a `#tag` in a tracked markdown file, so it is validated where the
   * write happens (slugified, length-capped, checked against the existing gates
   * and the maximum) and refused with a reason rather than silently corrected.
   */
  // ── Issues (GitHub, via the gh CLI) ─────────────────────────────

  /**
   * Load the repository's issues.
   *
   * Read-only and user-triggered. Each failure mode is reported as itself with
   * the command that fixes it — "no issues" and "we could not look" are
   * different facts, and collapsing them would report a clean tracker nobody
   * checked.
   */
  private async handleRefreshIssues(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      this.issuesState = { status: 'no-repo', detail: 'Open a workspace folder to read its issues.', issues: [], busy: false };
      await this.syncState();
      return;
    }

    this.issuesState = { ...this.issuesState, busy: true };
    await this.syncState();

    try {
      const slug = (await runGh(workspaceRoot, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])).trim();
      if (!slug) {
        this.issuesState = {
          status: 'no-repo',
          detail: 'This workspace has no GitHub repository that `gh` can resolve.',
          fixCommand: 'gh repo set-default',
          issues: [],
          busy: false,
        };
        await this.syncState();
        return;
      }

      // Closed issues are fetched too, but only recently — the page is a working
      // board, not an archive, and an unbounded closed list is a slow request
      // that nobody reads.
      const raw = await runGh(workspaceRoot, [
        'issue', 'list',
        '--state', 'all',
        '--limit', '100',
        '--json', 'number,title,state,author,labels,assignees,body,url,createdAt,updatedAt,comments',
      ]);
      const issues = parseGhIssueList(raw);
      this.issuesState = {
        status: 'ready',
        detail: `Read from ${slug}.`,
        repoSlug: slug,
        issues,
        summary: summarizeIssues(issues, Date.now()),
        loadedAt: new Date().toISOString(),
        busy: false,
      };

      // Pull requests, best-effort and deliberately not fatal: a repository can
      // have issues readable and pull requests not (a permissions split, or an
      // older `gh`), and failing the whole refresh over the secondary read would
      // hide the primary one that succeeded.
      try {
        const prRaw = await runGh(workspaceRoot, [
          'pr', 'list',
          '--state', 'all',
          '--limit', '100',
          '--json', 'number,title,state,author,headRefName,baseRefName,labels,body,url,createdAt,updatedAt,mergedAt,isDraft,additions,deletions,changedFiles,reviews',
        ]);
        this.pullRequestsState = parseGhPullRequestList(prRaw);
      } catch {
        // Left as-is rather than emptied: a failed refresh must not turn a
        // previously-read list into a confident "none".
      }

      // CI intelligence, also best-effort. A repository can have readable
      // issues and unreadable runs, and failing the whole refresh over the
      // tertiary read would hide the two that succeeded.
      try {
        const branch = (await runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
        if (branch && branch !== 'HEAD') {
          this.ciState = await gatherCiIntelligence(workspaceRoot, branch);
        }
      } catch {
        // Same reasoning as above.
      }
    } catch (error) {
      this.issuesState = { ...this.classifyIssueFailure(error), issues: [], busy: false };
    }
    await this.syncState();
  }

  /**
   * Turn a `gh` failure into the specific thing that is wrong, and its fix.
   *
   * The diagnosis comes from `ghClient` rather than being re-derived from the
   * message here. Two independent classifications of the same failure is how a
   * user ends up told to re-authenticate when they are merely rate-limited.
   */
  private classifyIssueFailure(error: unknown): Pick<DashboardIssuesSnapshot, 'status' | 'detail' | 'fixCommand'> {
    const failure = ghFailureOf(error);
    // `GhFailureKind` is richer than this page's status set, so the extra kinds
    // fold into `error` — keeping their specific detail and fix, which is the
    // part the user actually needs.
    const status: DashboardIssuesSnapshot['status'] =
      failure.kind === 'no-cli' ? 'no-cli'
        : failure.kind === 'not-authenticated' ? 'not-authenticated'
          : failure.kind === 'not-found' ? 'no-repo'
            : 'error';
    return {
      status,
      detail: failure.detail,
      ...(failure.fixCommand === undefined ? {} : { fixCommand: failure.fixCommand }),
    };
  }

  /**
   * Create, close, reopen, or comment on an issue.
   *
   * Every branch here is **outward-facing and usually public**, so each one is
   * gated on a `{ modal: true }` confirmation that names the repository and the
   * exact action, built from the same values that will be sent. The webview
   * supplies only data — never a command — and `gh` is invoked directly, without
   * a shell.
   */
  private async handleIssueWrite(message: {
    type: 'createIssue' | 'closeIssue' | 'reopenIssue' | 'commentIssue';
    payload: unknown;
  }): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const slug = this.issuesState.repoSlug;
    if (!workspaceRoot || !slug) {
      void vscode.window.showWarningMessage('Load the issue list first so AtlasMind knows which repository to write to.');
      return;
    }

    let args: string[];
    let description: string;
    let successNote: string;

    if (message.type === 'createIssue') {
      const draft = sanitizeIssueDraft(message.payload);
      if (!draft) {
        void vscode.window.showWarningMessage('An issue needs a title before it can be created.');
        return;
      }
      args = ['issue', 'create', '--title', draft.title, '--body', draft.body || '_No description provided._'];
      for (const label of draft.labels) {
        args.push('--label', label);
      }
      description = describeIssueAction('create', slug, { title: draft.title });
      successNote = `Created an issue on ${slug}.`;
    } else {
      const payload = message.payload as { number?: unknown; body?: unknown } | undefined;
      const number = sanitizeIssueNumber(payload?.number);
      if (number === 0) {
        return;
      }
      if (message.type === 'commentIssue') {
        const draft = sanitizeIssueDraft({ title: 'comment', body: payload?.body, labels: [] });
        const body = draft?.body ?? '';
        if (!body) {
          void vscode.window.showWarningMessage('Write a comment before posting it.');
          return;
        }
        args = ['issue', 'comment', String(number), '--body', body];
        description = describeIssueAction('comment', slug, { number });
        successNote = `Commented on #${number}.`;
      } else if (message.type === 'closeIssue') {
        args = ['issue', 'close', String(number)];
        description = describeIssueAction('close', slug, { number });
        successNote = `Closed #${number}.`;
      } else {
        args = ['issue', 'reopen', String(number)];
        description = describeIssueAction('reopen', slug, { number });
        successNote = `Reopened #${number}.`;
      }
    }

    const confirmation = await vscode.window.showWarningMessage(
      'Write to the issue tracker?',
      { modal: true, detail: description },
      'Yes, do it',
    );
    if (confirmation !== 'Yes, do it') {
      return;
    }

    try {
      await runGh(workspaceRoot, args);
      void vscode.window.showInformationMessage(successNote);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(`The issue action failed: ${detail.slice(0, 300)}`);
    }
    // Re-read either way: a failed write may still have partially applied, and
    // the list is the only honest report of what the tracker now holds.
    await this.handleRefreshIssues();
  }

  /**
   * The effective automation level for a workflow action, and why.
   *
   * Read at the moment of acting rather than carried from a snapshot: a setting
   * changed while a panel was open must take effect on the next action, not on
   * the next reload. The webview never supplies the level — it asks to act, and
   * this decides whether it may.
   */
  private automationFor(capability: WorkflowCapability, stageLevel: AutomationLevel): AutomationDecision {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const capabilitySetting = capability === 'issueWrites'
      ? 'workflow.allowIssueWrites'
      : capability === 'pullRequestWrites'
        ? 'workflow.allowPullRequestWrites'
        : 'workflow.allowReleaseWrites';
    return explainAutomationLevel({
      masterEnabled: configuration.get<boolean>('workflow.enabled', false),
      userCeiling: normalizeAutomationLevel(configuration.get<string>('workflow.maxAutomationLevel', 'observe')),
      capabilityEnabled: configuration.get<boolean>(capabilitySetting, false),
      stageLevel,
    });
  }

  /**
   * Create a pull request, review it, or merge it.
   *
   * Two gates, in this order. First the **automation ladder** — the effective
   * level must reach `propose`, and a refusal names the switch that caused it so
   * nobody has to toggle four settings at random. Then the **modal
   * confirmation**, naming the repository and the exact action, built from the
   * same values that will be sent.
   *
   * A merge carries a third gate: the base branch may be protected, and a
   * protected target is a *veto*, not a level to raise. The webview supplies
   * only data — never a command — and `gh` runs without a shell.
   */
  private async handlePullRequestWrite(message: {
    type: 'createPullRequest' | 'reviewPullRequest' | 'mergePullRequest' | 'closePullRequest';
    payload: unknown;
  }): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const slug = this.issuesState.repoSlug;
    if (!workspaceRoot || !slug) {
      void vscode.window.showWarningMessage('Load the issue list first so AtlasMind knows which repository to write to.');
      return;
    }

    // Stage level comes from the project's declared workflow. Until the
    // configuration file lands (Tier 4), the stage's shipped default applies —
    // which is `draft`, so a write needs the user to raise it deliberately.
    const decision = this.automationFor('pullRequestWrites', 'auto');
    if (!permits(decision.level, FIRST_WRITING_LEVEL)) {
      void vscode.window.showWarningMessage(
        `AtlasMind is not permitted to write pull requests right now (level: ${decision.level}).`,
        { modal: true, detail: decision.detail },
      );
      return;
    }

    const payload = (message.payload ?? {}) as Record<string, unknown>;
    const number = sanitizeIssueNumber(payload['number']);

    let args: string[];
    let description: string;
    let successNote: string;

    if (message.type === 'createPullRequest') {
      const title = typeof payload['title'] === 'string' ? payload['title'].trim() : '';
      const body = typeof payload['body'] === 'string' ? payload['body'] : '';
      const base = typeof payload['base'] === 'string' ? payload['base'].trim() : '';
      const head = typeof payload['head'] === 'string' ? payload['head'].trim() : '';
      if (!title || !base || !head) {
        void vscode.window.showWarningMessage('A pull request needs a title, a base, and a head branch.');
        return;
      }
      args = ['pr', 'create', '--base', base, '--head', head, '--title', title, '--body', body || '_No description provided._'];
      if (payload['draft'] === true) {
        args.push('--draft');
      }
      description = describePullRequestAction('create', slug, { title, base, head });
      successNote = `Opened a pull request on ${slug}.`;
    } else if (number === 0) {
      return;
    } else if (message.type === 'reviewPullRequest') {
      const verdict = payload['verdict'];
      const comment = typeof payload['body'] === 'string' ? payload['body'].trim() : '';
      if (verdict === 'approve') {
        args = ['pr', 'review', String(number), '--approve'];
        if (comment) {
          args.push('--body', comment);
        }
        description = describePullRequestAction('approve', slug, { number });
        successNote = `Approved #${number}.`;
      } else if (verdict === 'request-changes') {
        if (!comment) {
          // GitHub requires one, and so does courtesy: "changes requested" with
          // no explanation is a rejection the author cannot act on.
          void vscode.window.showWarningMessage('Requesting changes needs a comment explaining what to change.');
          return;
        }
        args = ['pr', 'review', String(number), '--request-changes', '--body', comment];
        description = describePullRequestAction('request-changes', slug, { number });
        successNote = `Requested changes on #${number}.`;
      } else {
        if (!comment) {
          void vscode.window.showWarningMessage('Write a comment before posting it.');
          return;
        }
        args = ['pr', 'review', String(number), '--comment', '--body', comment];
        description = describePullRequestAction('comment', slug, { number });
        successNote = `Commented on #${number}.`;
      }
    } else if (message.type === 'mergePullRequest') {
      const base = typeof payload['base'] === 'string' ? payload['base'].trim() : '';
      const protection = permitsProtectedRefWrite({
        targetIsProtected: PROTECTED_BRANCH_NAMES.has(base),
        allowProtectedRefWrites: vscode.workspace
          .getConfiguration('atlasmind')
          .get<boolean>('workflow.allowProtectedRefWrites', false),
      });
      if (!protection.allowed) {
        void vscode.window.showWarningMessage(
          `Merging into \`${base}\` is not permitted.`,
          { modal: true, detail: protection.detail ?? '' },
        );
        return;
      }
      // Squash by default: it keeps the integration branch readable, and the
      // branch's intermediate steps are the part nobody reads later.
      args = ['pr', 'merge', String(number), '--squash'];
      description = describePullRequestAction('merge', slug, { number, base });
      successNote = `Merged #${number}.`;
    } else {
      args = ['pr', 'close', String(number)];
      description = describePullRequestAction('close', slug, { number });
      successNote = `Closed #${number} without merging.`;
    }

    const confirmation = await vscode.window.showWarningMessage(
      'Write to GitHub?',
      { modal: true, detail: description },
      'Yes, do it',
    );
    if (confirmation !== 'Yes, do it') {
      return;
    }

    try {
      await runGh(workspaceRoot, args);
      void vscode.window.showInformationMessage(successNote);
    } catch (error) {
      void vscode.window.showWarningMessage(`The pull request action failed: ${ghFailureOf(error).detail}`);
    }
    // Re-read either way: a failed write may still have partially applied, and
    // the list is the only honest report of what GitHub now holds.
    await this.handleRefreshIssues();
  }

  /** Hand an issue to chat as *reported content*, never as instructions. */
  private async handleWorkOnIssue(rawNumber: unknown): Promise<void> {
    const number = sanitizeIssueNumber(rawNumber);
    const issue = this.issuesState.issues.find(entry => entry.number === number);
    if (!issue) {
      return;
    }
    await vscode.commands.executeCommand('atlasmind.openChatPanel', {
      draftPrompt: buildIssueWorkPrompt(issue),
      sendMode: 'new-session',
    });
  }

  private async handleCreateRoadmapGate(): Promise<void> {
    const context = await this.readRoadmapDocument();
    if (!context) {
      return;
    }
    if (context.gates.length >= MAX_ROADMAP_GATES) {
      void vscode.window.showWarningMessage(`A roadmap can track ${MAX_ROADMAP_GATES} release gates. Remove one before adding another.`);
      return;
    }

    const label = await vscode.window.showInputBox({
      title: 'New release gate',
      prompt: 'Name the release this gate represents, e.g. "Public beta" or "v1.0".',
      placeHolder: 'Public beta',
      validateInput: value => {
        const id = slugifyGateId(value);
        if (!id) {
          return 'Use letters or numbers — the name becomes a #tag in the roadmap file.';
        }
        if (context.gates.some(gate => gate.id === id)) {
          return `A gate called #${id} already exists.`;
        }
        return undefined;
      },
    });
    if (!label) {
      return;
    }
    const id = slugifyGateId(label);
    if (!id || context.gates.some(gate => gate.id === id)) {
      return;
    }

    const gates = normalizeGates([...context.gates, { id, label: label.trim(), order: context.gates.length, builtIn: false }]);
    await this.writeRoadmapDocument(context, context.items, gates);
    void vscode.window.showInformationMessage(`Release gate #${id} added. Tag backlog items with it to build its path.`);
  }

  /**
   * Remove a release gate.
   *
   * Destructive to a *label*, never to work: the gate's tag is removed from every
   * item, the items themselves are untouched, and the built-in MVP gate cannot be
   * removed at all. Confirmed modally because it edits a tracked file.
   */
  private async handleDeleteRoadmapGate(gateId: string): Promise<void> {
    const id = slugifyGateId(gateId);
    if (!id || id === MVP_GATE_ID) {
      return;
    }
    const context = await this.readRoadmapDocument();
    if (!context) {
      return;
    }
    const gate = context.gates.find(entry => entry.id === id);
    if (!gate) {
      return;
    }
    const taggedCount = context.items.filter(item => item.gates.includes(id)).length;
    const confirmation = await vscode.window.showWarningMessage(
      `Remove the release gate "${gate.label}" (#${id})?`,
      {
        modal: true,
        detail: taggedCount > 0
          ? `The tag will be removed from ${taggedCount} backlog item${taggedCount === 1 ? '' : 's'}. No backlog item is deleted.`
          : 'No backlog items are tagged for it.',
      },
      'Remove gate',
    );
    if (confirmation !== 'Remove gate') {
      return;
    }

    const gates = normalizeGates(context.gates.filter(entry => entry.id !== id));
    const items = context.items.map(item => ({ ...item, gates: item.gates.filter(entry => entry !== id) }));
    await this.writeRoadmapDocument(context, items, gates);
  }

  /** Read the roadmap document once, with its gates and items already parsed. */
  private async readRoadmapDocument(): Promise<{
    filePath: string;
    ssotPath: string;
    workspaceRoot: string;
    existing: string;
    gates: RoadmapGate[];
    items: Array<{ id: string; text: string; completed: boolean; gates: string[] }>;
  } | undefined> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return undefined;
    }
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
    const filePath = path.join(workspaceRoot, ssotPath, 'roadmap', 'improvement-plan.md');
    const existing = await fs.readFile(filePath, 'utf-8').catch(() => '');
    const gates = parseRoadmapGates(existing);
    const items = parseDashboardRoadmapItems(existing, gates)
      .map(item => ({ id: item.id, text: item.text, completed: item.completed, gates: item.gates }));
    return { filePath, ssotPath, workspaceRoot, existing, gates, items };
  }

  private async writeRoadmapDocument(
    context: { filePath: string; ssotPath: string; workspaceRoot: string; existing: string },
    items: Array<{ text: string; completed: boolean; gates: string[] }>,
    gates: RoadmapGate[],
  ): Promise<void> {
    await fs.mkdir(path.dirname(context.filePath), { recursive: true });
    const nextDocument = serializeDashboardRoadmapDocument(context.existing, items, gates);
    await fs.writeFile(context.filePath, nextDocument, 'utf-8');
    const ssotRoot = vscode.Uri.file(path.join(context.workspaceRoot, context.ssotPath));
    await this.atlas.memoryManager.loadFromDisk(ssotRoot);
    this.atlas.memoryRefresh.fire();
    await this.syncState();
  }

  private async runIdeationLoop(payload: IdeationRunPayload): Promise<void> {
    const trimmedPrompt = payload.prompt.trim();
    if (!trimmedPrompt) {
      await this.postMessage({ type: 'ideationStatus', payload: 'Describe the idea you want Atlas to pressure-test first.' });
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
    const activeWorkspace = await loadActiveIdeationWorkspace(workspaceRoot, ssotPath);
    const board = await loadIdeationBoard(workspaceRoot, ssotPath, activeWorkspace);
    const focusCard = board.cards.find(card => card.id === board.focusCardId);
    const sessionContext = this.atlas.sessionConversation.buildContext({
      maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
      maxChars: configuration.get<number>('chatSessionContextChars', 2500),
    });
    const workstationContext = buildWorkstationContext();
    const ideationPrompt = buildIdeationPrompt(trimmedPrompt, board, focusCard, this.ideationAttachments);

    await this.postMessage({ type: 'ideationResponseReset' });
    await this.postMessage({ type: 'ideationBusy', payload: true });
    await this.postMessage({ type: 'ideationStatus', payload: 'Atlas is shaping the next ideation move...' });

    let streamedText = '';
    try {
      const result = await this.atlas.orchestrator.processTask({
        id: `ideation-${Date.now()}`,
        userMessage: ideationPrompt,
        context: {
          ...(sessionContext ? { sessionContext } : {}),
          ...(workstationContext ? { workstationContext } : {}),
          ideationBoard: summarizeIdeationBoard(board),
          ...(focusCard ? { ideationFocus: `${focusCard.title}: ${focusCard.body}` } : {}),
          ...(this.ideationAttachments.length > 0 ? { imageAttachments: this.ideationAttachments } : {}),
        },
        constraints: {
          budget: toDashboardBudgetMode(configuration.get<string>('budgetMode')),
          speed: toDashboardSpeedMode(configuration.get<string>('speedMode')),
          ...(this.ideationAttachments.length > 0 ? { requiredCapabilities: ['vision'] } : {}),
        },
        timestamp: new Date().toISOString(),
      }, async chunk => {
        if (!chunk) {
          return;
        }
        streamedText += chunk;
      });

      const reconciled = reconcileAssistantResponse(streamedText, result.response);
      const parsed = normalizeIdeationResponse(parseIdeationResponse(reconciled.transcriptText));
      const updatedBoard = applyIdeationResponse(board, trimmedPrompt, parsed, focusCard?.id, this.ideationAttachments);
      await persistIdeationBoard(workspaceRoot, ssotPath, updatedBoard, activeWorkspace);
      await touchActiveIdeationWorkspace(workspaceRoot, ssotPath, activeWorkspace.id, updatedBoard.updatedAt);
      await this.postMessage({ type: 'ideationResponseChunk', payload: parsed.displayResponse });

      this.atlas.sessionConversation.recordTurn(
        trimmedPrompt,
        parsed.displayResponse,
        undefined,
        buildAssistantResponseMetadata(trimmedPrompt, result, {
          hasSessionContext: Boolean(sessionContext),
          imageAttachments: this.ideationAttachments,
          routingContext: { ideation: true },
          responseText: parsed.displayResponse,
        }),
      );

      // A question Atlas asks here deserves the same one-tap answer as in the
      // Chat panel; without this the user has to retype "yes".
      const quickReplies = buildQuickReplyPayload(parsed.displayResponse);
      if (quickReplies) {
        await this.postMessage({ type: 'ideationQuickReplies', payload: quickReplies });
      }

      if (payload.speakResponse || configuration.get<boolean>('voice.ttsEnabled', false)) {
        this.atlas.voiceManager.speak(parsed.displayResponse);
      }

      await this.postMessage({ type: 'ideationStatus', payload: 'Ideation board updated with Atlas feedback.' });
      await this.syncState();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.postMessage({ type: 'ideationStatus', payload: `Ideation request failed: ${detail}` });
    } finally {
      await this.postMessage({ type: 'ideationBusy', payload: false });
    }
  }

  private async postMessage(message: DashboardWebviewMessage): Promise<void> {
    await this.panel.webview.postMessage(message);
  }

  private async openIdeationPromptInChat(prompt: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', 'project_memory'));
    const activeWorkspace = await loadActiveIdeationWorkspace(workspaceRoot, ssotPath);
    const board = await loadIdeationBoard(workspaceRoot, ssotPath, activeWorkspace);
    const focusCard = board.cards.find(card => card.id === board.focusCardId);

    await vscode.commands.executeCommand('atlasmind.openChatPanel', {
      draftPrompt: prompt,
      sendMode: 'new-session',
      contextPatch: {
        ideationBoard: summarizeIdeationBoard(board),
        ...(focusCard ? { ideationFocus: `${focusCard.title}: ${focusCard.body}` } : {}),
        routingContext: {
          ideation: true,
          ideationPromptLaunch: 'dashboard-next-prompt',
        },
        ideationPromptSource: 'dashboard-next-prompt',
      },
    });
  }

  /**
   * Snapshot the current review-relevant delivery state as the new baseline, so
   * the "review needed" banner clears until something drifts again. Called when
   * the user marks the pipeline reviewed and (implicitly) when they save edits.
   */
  private async storeDeliveryReviewBaseline(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const config = this.atlas.deliveryManager?.getConfig();
    if (!workspaceRoot || !config) {
      return;
    }
    const stageViews = await Promise.all(
      [...config.stages].sort((a, b) => a.rank - b.rank).map(stage => buildStageView(workspaceRoot, stage, '')),
    );
    const workflowNames = (await collectWorkflowSnapshot(workspaceRoot)).map(workflow => workflow.name);
    const parts = await computeDeliveryReviewParts(workspaceRoot, config, stageViews, workflowNames);
    await this.context.workspaceState.update(
      DELIVERY_REVIEW_STATE_KEY,
      { reviewedAt: new Date().toISOString(), parts } satisfies StoredDeliveryReview,
    );
  }

  /**
   * Re-detect the repository's delivery signals and rebuild the pipeline from
   * them, replacing the stored config. Used by the "Re-import from repo" action
   * to refresh an already-seeded project after its real protocol has moved on.
   */
  private async handleReimportDelivery(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || !this.atlas.deliveryManager) {
      return;
    }
    let currentBranch = 'Detached';
    try {
      currentBranch = (await runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || 'Detached';
    } catch {
      currentBranch = 'Not a git repository';
    }
    if (currentBranch === 'Not a git repository') {
      return;
    }
    const signals = await detectDeliverySignals(this.atlas, workspaceRoot, currentBranch);
    const config = seedDeliveryConfig(signals);
    await this.atlas.deliveryManager.save(config);
    // The re-import is itself an authored review of the current state.
    await this.storeDeliveryReviewBaseline();
    await this.syncState();
  }

  // ── Project Director ─────────────────────────────────────────────

  /**
   * The one-time GDPR consent gate. When a config would persist raw personal
   * data locally and the user has not yet acknowledged it, show a modal
   * explaining the GDPR implications; on approval, record the acknowledgement
   * and enable the built-in `gdpr-pii` classification pack so the stored PII is
   * covered by the existing redaction boundary. Returns true when it is OK to
   * persist. Modelled on `remoteControlServer.ensureWorkspaceApproval`.
   *
   * The consent asked for here is narrow — "store these contact details" — but
   * turning the Data Privacy policy on for the first time is workspace-wide:
   * every later task has its assembled context scanned. The modal therefore
   * states that consequence up front, and if the master switch actually had to
   * be flipped the user is told afterwards and offered the page to review it.
   * A scope change the operator cannot see is a scope change they cannot undo.
   */
  private async ensurePiiConsent(config: ProjectDirectorConfig): Promise<boolean> {
    if (!configStoresRawPii(config)) {
      return true;
    }
    const context = this.atlas.extensionContext;
    const already = context?.workspaceState?.get<boolean>(PROJECT_DIRECTOR_PII_ACK_KEY, false) ?? false;
    if (already) {
      return true;
    }
    const choice = await vscode.window.showWarningMessage(
      'This stores personal data (names and contact details) in project_memory/operations/project-director.json. '
      + 'Under the GDPR you are the data controller: keep it minimal, store only what you need, and remove it on request. '
      + 'AtlasMind classifies stored personal data as confidential so it is never sent to an un-trusted model. '
      + 'Where possible, prefer referencing people in Microsoft 365 / Slack over storing raw details locally.',
      {
        modal: true,
        detail: 'To do that, AtlasMind will enable the "GDPR — Personal Data" detectors in the project Data Privacy policy. '
          + 'That policy applies to the whole workspace: from now on the context assembled for each task is scanned, and anything '
          + 'it matches is redacted before reaching a model you have not marked trusted. You can review or turn this off at any '
          + 'time on the Privacy page.',
      },
      'Store personal data',
    );
    if (choice !== 'Store personal data') {
      return false;
    }
    await context?.workspaceState?.update(PROJECT_DIRECTOR_PII_ACK_KEY, true);
    const { policyTurnedOn } = await this.enableGdprPiiPack();
    if (policyTurnedOn) {
      void vscode.window.showInformationMessage(
        'Data Privacy is now on for this workspace: task context is scanned for personal data and redacted for un-trusted models.',
        'Review on Privacy page',
      ).then(async (action) => {
        if (action === 'Review on Privacy page') {
          await this.postMessage({ type: 'navigate', payload: 'privacy' });
        }
      });
    }
    return true;
  }

  /**
   * Enable the built-in gdpr-pii compliance pack so stored Director PII is
   * classified. Reports whether the workspace-wide master switch had to be
   * turned on, so the caller can disclose that rather than changing the scope
   * of the policy silently.
   */
  private async enableGdprPiiPack(): Promise<{ policyTurnedOn: boolean }> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return { policyTurnedOn: false };
    }
    try {
      const current = readDataPrivacyConfig(workspaceRoot) ?? defaultDataPrivacyConfig();
      const policyTurnedOn = current.enabled !== true;
      if (current.compliancePacks.includes('gdpr-pii') && !policyTurnedOn) {
        return { policyTurnedOn: false };
      }
      const next = {
        ...current,
        enabled: true,
        compliancePacks: current.compliancePacks.includes('gdpr-pii')
          ? current.compliancePacks
          : [...current.compliancePacks, 'gdpr-pii'],
      };
      await writeDataPrivacyConfig(workspaceRoot, next);
      this.atlas.dataPrivacyManager?.setConfig(next);
      return { policyTurnedOn };
    } catch {
      // Best-effort; the Director save still proceeds.
      return { policyTurnedOn: false };
    }
  }

  private async handleSaveDirectorConfig(payload: unknown): Promise<void> {
    const clean = sanitizeProjectDirectorConfig(payload);
    if (!clean) {
      return;
    }
    if (!(await this.ensurePiiConsent(clean))) {
      return;
    }
    await this.atlas.projectDirectorManager.save(clean);
    await this.syncState();
  }

  /** Re-seed the roster from repository signals (git users, CODEOWNERS, package author, website intake). */
  private async handleSeedDirector(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || !this.atlas.projectDirectorManager) {
      return;
    }
    const signals = await detectDirectorSignals(workspaceRoot);
    const config = seedProjectDirectorConfig(signals);
    if (!(await this.ensurePiiConsent(config)) && configStoresRawPii(config)) {
      // Consent declined and the draft carries PII: do not persist.
      return;
    }
    await this.atlas.projectDirectorManager.save(config);
    await this.syncState();
  }

  /**
   * Bind (or unbind) a Buzz identity to an AtlasMind agent from the Director roster.
   *
   * The `atlasmind.buzz.agentBindings` setting remains the single source of
   * truth; this is a convenience editor for it, so a binding made here and one
   * typed into settings can never disagree. Three refusals, all loud:
   *
   *  - A key that will not normalise is **rejected, never coerced** — one wrong
   *    bech32 character would otherwise bind work to a different real identity.
   *  - An agent id with no matching agent is refused, so a rename cannot leave a
   *    binding silently pointing at nothing.
   *  - Writing fails visibly rather than leaving the roster showing a binding
   *    the settings file does not have.
   */
  private async handleSetBuzzAgentBinding(payload: { pubkey: string; agentIds: string[]; label?: string }): Promise<void> {
    const agentIds = payload.agentIds.map(id => id.trim()).filter(Boolean);
    // Every id is checked, not just the first. A rename that broke the second
    // of three would otherwise save silently and route nothing.
    const unknown = agentIds.filter(id => !this.atlas.agentRegistry?.get(id));
    if (unknown.length > 0) {
      void vscode.window.showWarningMessage(
        `The person was saved, but the Buzz agent binding was not: there is no AtlasMind agent named ${
          unknown.map(id => `"${id}"`).join(', ')}.`,
      );
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const result = writeAgentBinding(configuration.get('buzz.agentBindings'), { ...payload, agentIds });
    if (!result.ok) {
      // Say what did and did not happen. The person is saved by a separate
      // message, so a refused binding must not read as a refused save.
      void vscode.window.showWarningMessage(
        `The person was saved, but the Buzz agent binding was not: ${result.error ?? 'the key could not be used.'}`,
      );
      return;
    }

    // Workspace scope: which colleague maps to which specialist is a property of
    // this project, not of the machine.
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    try {
      await configuration.update('buzz.agentBindings', result.value, target);
    } catch (error) {
      void vscode.window.showWarningMessage(`Could not save the Buzz agent binding: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    await this.syncState();
  }

  /**
   * Create the folders for shelves that declare one.
   *
   * A shelf records where documents live, so it should not point at a folder the
   * project doesn't have — but this stays create-only (`mkdir`, never a write),
   * and a path already occupied by a file is reported rather than disturbed. The
   * user is told what was created so a filing decision never happens invisibly.
   */
  private async ensureShelfFolders(relPaths: string[]): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || relPaths.length === 0) {
      return;
    }
    const result = await createShelfFolders(workspaceRoot, relPaths);
    if (result.created.length > 0) {
      void vscode.window.showInformationMessage(
        `Created document ${result.created.length === 1 ? 'folder' : 'folders'}: ${result.created.join(', ')}.`,
      );
    }
    for (const skip of result.skipped) {
      void vscode.window.showWarningMessage(`Could not create the shelf folder "${skip.path}" — ${skip.reason}.`);
    }
  }

  private async handleSeedDocuments(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || !this.atlas.documentsManager) {
      return;
    }
    // Seed a starter filing system only from paths that actually exist, so the
    // registry never references documents the project doesn't have.
    const presentDocFolders = ['docs', 'wiki', 'documentation', 'guides']
      .filter(folder => existsSync(path.join(workspaceRoot, folder)));
    const keyDocs = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md']
      .filter(doc => existsSync(path.join(workspaceRoot, doc)));
    const seeded = seedDocumentsConfig({ presentDocFolders, keyDocs });
    await this.atlas.documentsManager.save(seeded);
    await this.syncState();
  }

  /**
   * Run one or all oversight advisors and record what they find.
   *
   * The agent is *pinned* via `processTaskWithAgent` rather than routed, so the Risk
   * page always consults the advisor the user asked for. Each advisor is read-only
   * (its skills are an allowlist), which is why persistence happens here instead:
   * the model returns JSON, this method sanitises it and owns the single write path.
   *
   * "All" runs sequentially, not concurrently — three parallel model calls is a
   * surprising cost spike from one click, and sequential progress is legible.
   */
  private async handleRunRiskAnalysis(domain: RiskDomain | 'all'): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || !this.atlas.riskOversightManager) {
      return;
    }
    const domains: RiskDomain[] = domain === 'all' ? [...RISK_DOMAINS] : [domain];

    await this.postMessage({ type: 'riskBusy', payload: true });
    try {
      const configuration = vscode.workspace.getConfiguration('atlasmind');
      let config = this.atlas.riskOversightManager.getConfig() ?? await this.atlas.riskOversightManager.ensureSeeded();

      for (const [index, current] of domains.entries()) {
        const agent = this.atlas.agentRegistry.get(`${current}-oversight`);
        if (!agent) {
          await this.postMessage({ type: 'riskStatus', payload: `The ${current} oversight advisor is not available.` });
          continue;
        }
        const position = domains.length > 1 ? ` (${index + 1}/${domains.length})` : '';
        await this.postMessage({ type: 'riskStatus', payload: `${agent.name} is reviewing the workspace${position}...` });

        let streamedText = '';
        let result;
        try {
          result = await this.atlas.orchestrator.processTaskWithAgent(
            {
              id: `risk-${current}-${Date.now()}`,
              userMessage: buildRiskAnalysisPrompt(current),
              context: { riskAnalysisMode: 'json' },
              constraints: {
                budget: toDashboardBudgetMode(configuration.get<string>('budgetMode')),
                speed: toDashboardSpeedMode(configuration.get<string>('speedMode')),
              },
              timestamp: new Date().toISOString(),
            },
            agent,
            chunk => { streamedText += chunk ?? ''; },
            progress => { void this.postMessage({ type: 'riskStatus', payload: `${agent.name}: ${progress}` }); },
          );
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          await this.postMessage({ type: 'riskStatus', payload: `${agent.name} failed: ${detail}` });
          continue;
        }

        // Model output is untrusted: parse defensively, then sanitise before persisting.
        const reconciled = reconcileAssistantResponse(streamedText, result.response);
        const raw = parseRiskFindings(reconciled.transcriptText);
        const incoming = sanitizeRiskFindings(raw)
          .map(finding => ({ ...finding, domain: current }));

        config = {
          ...config,
          findings: mergeDomainFindings(config.findings, incoming, current),
          runs: [
            ...config.runs.filter(run => run.domain !== current),
            { domain: current, ranAt: new Date().toISOString(), findingCount: incoming.length },
          ],
        };
        await this.atlas.riskOversightManager.save(config);
        await appendRiskOversightHistory(workspaceRoot, {
          id: `run-${current}-${new Date().toISOString()}`,
          kind: 'analysis-run',
          summary: `${agent.name} reviewed the workspace and reported ${incoming.length} finding${incoming.length === 1 ? '' : 's'}.`,
          domain: current,
          ranAt: new Date().toISOString(),
        });

        await this.postMessage({
          type: 'riskStatus',
          payload: incoming.length === 0
            // A clean result and an unparseable one look the same to the user, so say which.
            ? `${agent.name} reported no findings${raw.length > 0 ? ' that could be recorded' : ''}.`
            : `${agent.name} recorded ${incoming.length} finding${incoming.length === 1 ? '' : 's'}.`,
        });
        await this.syncState();
      }
    } finally {
      await this.postMessage({ type: 'riskBusy', payload: false });
    }
  }

  /**
   * Record a human decision about a finding. Findings are never deleted — a status
   * change is the only way one leaves the open set — so the register keeps a complete
   * account of what was raised and what was decided.
   */
  private async handleSetRiskFindingStatus(payload: { findingId: string; status: RiskStatus; note?: string }): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const manager = this.atlas.riskOversightManager;
    const config = manager?.getConfig();
    if (!manager || !config) {
      return;
    }
    const finding = config.findings.find(entry => entry.id === payload.findingId);
    if (!finding || finding.status === payload.status) {
      return;
    }
    const note = payload.note?.trim().slice(0, 2000);
    const updated: RiskOversightConfig = {
      ...config,
      findings: config.findings.map(entry => entry.id === payload.findingId
        ? {
          ...entry,
          status: payload.status,
          updatedAt: new Date().toISOString(),
          ...(note ? { statusNote: note } : {}),
        }
        : entry),
    };
    await manager.save(updated);
    if (workspaceRoot) {
      await appendRiskOversightHistory(workspaceRoot, {
        id: `status-${payload.findingId}-${new Date().toISOString()}`,
        kind: 'status-change',
        summary: `"${finding.title}" moved from ${finding.status} to ${payload.status}.`,
        domain: finding.domain,
        entityId: payload.findingId,
        ranAt: new Date().toISOString(),
      });
    }
    await this.syncState();
  }

  private async handleCopyContact(contactId: string): Promise<void> {
    const contact = this.atlas.projectDirectorManager?.getConfig()?.contacts.find(entry => entry.id === contactId);
    if (!contact) {
      return;
    }
    const lines = [contact.name];
    if (contact.title) { lines.push(contact.title); }
    if (contact.org) { lines.push(contact.org); }
    for (const link of contact.links) {
      lines.push(`${link.label || link.kind}: ${link.handle}`);
    }
    await vscode.env.clipboard.writeText(lines.join('\n'));
    await vscode.window.showInformationMessage(`Copied contact details for ${contact.name}.`);
  }

  private async handleOpenContactDeepLink(payload: { contactId: string; linkId: string }): Promise<void> {
    const contact = this.atlas.projectDirectorManager?.getConfig()?.contacts.find(entry => entry.id === payload.contactId);
    const link = contact?.links.find(entry => entry.id === payload.linkId);
    if (!link?.deepLink) {
      return;
    }
    // Re-validate the scheme server-side (defense in depth; the sanitiser already did).
    const scheme = link.deepLink.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1]?.toLowerCase();
    const allowed = ['mailto', 'tel', 'sms', 'slack', 'msteams', 'zoommtg', 'https'];
    if (!scheme || !allowed.includes(scheme)) {
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(link.deepLink));
  }

  /** Link (or clear) a human owner for an autonomous run via a Director assignment. */
  private async handleAssignRunOwner(payload: { runId: string; contactId: string }): Promise<void> {
    const manager = this.atlas.projectDirectorManager;
    const config = manager?.getConfig();
    if (!manager || !config) {
      return;
    }
    const runId = payload.runId.trim();
    if (!runId) {
      return;
    }
    const contactId = payload.contactId.trim();
    if (contactId && !config.contacts.some(entry => entry.id === contactId)) {
      return;
    }
    const now = new Date().toISOString();
    const assignments = [...config.assignments];
    const existingIndex = assignments.findIndex(entry => entry.linkedRunId === runId);
    if (!contactId) {
      if (existingIndex >= 0) { assignments.splice(existingIndex, 1); }
    } else if (existingIndex >= 0) {
      assignments[existingIndex] = { ...assignments[existingIndex], assigneeContactId: contactId, updatedAt: now };
    } else {
      const runs = await this.atlas.projectRunHistory.listRunsAsync(40);
      const run = runs.find(entry => entry.id === runId);
      assignments.push({
        id: `asg-run-${runId}`,
        title: run?.title || run?.goal || 'Autonomous run',
        kind: 'task',
        assigneeContactId: contactId,
        status: run?.status === 'completed' ? 'done' : run?.status === 'failed' ? 'blocked' : 'in-progress',
        priority: 'medium',
        linkedRunId: runId,
        source: 'run',
        createdAt: now,
        updatedAt: now,
      });
    }
    const clean = sanitizeProjectDirectorConfig({ ...config, assignments });
    if (clean) {
      await manager.save(clean);
      await this.syncState();
    }
  }

  /**
   * Guarded outbound send/schedule via a connected MCP connector. Deny-by-default:
   * it does nothing unless the project has `outboundEnabled`, a matching connector
   * is connected, and the user confirms the exact action in a modal. Falls back to
   * the contact's deep-link when no connector can perform the intent; never
   * auto-sends. The executed tool comes from the connected server — the webview
   * only supplies the draft, which is re-resolved and re-classified server-side.
   */
  private async handleDirectorSendComms(payload: { intent: DirectorCommsIntent; contactId: string; subject?: string; body?: string; start?: string }): Promise<void> {
    const config = this.atlas.projectDirectorManager?.getConfig();
    if (!config) {
      return;
    }
    if (config.settings.outboundEnabled !== true) {
      void vscode.window.showWarningMessage('Outbound messaging is off for this project. Enable it on the Project Director → Setup card.');
      return;
    }
    const contact = config.contacts.find(entry => entry.id === payload.contactId);
    if (!contact) {
      return;
    }
    const intent = payload.intent;
    const capabilities = detectConnectorCapabilities(this.atlas.mcpServerRegistry?.listServers() ?? []);
    const preferKinds = intent === 'message' ? ['buzz', 'slack', 'teams'] : ['email'];
    const preferredLinks = contact.links.filter(entry => preferKinds.includes(entry.kind));
    const link = preferredLinks.find(entry =>
      resolveCapability(capabilities, intent, entry.kind, entry.handle),
    ) ?? preferredLinks[0] ?? contact.links[0];
    const recipient = link?.handle ?? '';
    if (!recipient) {
      void vscode.window.showWarningMessage(`No ${intent === 'message' ? 'chat' : intent} channel on file for ${contact.name}.`);
      return;
    }

    if (link?.kind === 'buzz') {
      const buzzEnabled = vscode.workspace.getConfiguration('atlasmind').get<boolean>('buzz.enabled', false);
      if (!buzzEnabled) {
        void vscode.window.showWarningMessage(
          'Buzz integration is off. Enable atlasmind.buzz.enabled before opening or sending to Buzz.',
        );
        return;
      }
    }

    const capability = resolveCapability(capabilities, intent, link?.kind, recipient);
    if (!capability) {
      // Non-destructive fallback: open the deep-link, or explain there's no connector.
      if (link?.deepLink) {
        await vscode.env.openExternal(vscode.Uri.parse(link.deepLink));
      } else {
        const open = await vscode.window.showWarningMessage(
          `No connected MCP connector can ${intent === 'message' ? 'post a message' : intent === 'schedule' ? 'schedule an event' : 'send email'}. Connect one from MCP Servers.`,
          'Open MCP Servers',
        );
        if (open === 'Open MCP Servers') {
          await vscode.commands.executeCommand('atlasmind.openMcpServers');
        }
      }
      return;
    }

    const draft: CommsDraft = {
      intent,
      recipient,
      recipientName: contact.name,
      subject: payload.subject,
      body: payload.body,
      start: payload.start,
    };
    const args = buildToolArgs(capability, draft);
    const skillId = mcpSkillId(capability.serverId, capability.toolName);
    const policy = classifyToolInvocation(skillId, args);

    // Authorization gate: an explicit modal showing the exact external action.
    const summary = [
      `Send this ${intent} through the connector "${capability.serverName}" (tool ${capability.toolName})?`,
      `To: ${contact.name}${recipient ? ` <${recipient}>` : ''}`,
    ];
    if (draft.subject) { summary.push(`Subject: ${draft.subject}`); }
    if (draft.start) { summary.push(`When: ${draft.start}`); }
    if (draft.body) { summary.push(`Body: ${draft.body.length > 240 ? `${draft.body.slice(0, 240)}…` : draft.body}`); }
    summary.push('', `Risk: ${policy.risk}. This performs a real, external action that AtlasMind cannot undo.`);
    const choice = await vscode.window.showWarningMessage(summary.join('\n'), { modal: true }, 'Send');
    if (choice !== 'Send') {
      return;
    }

    const skill = this.atlas.skillsRegistry.get(skillId);
    if (!skill || !this.atlas.skillsRegistry.isEnabled(skill.id)) {
      void vscode.window.showErrorMessage(`Connector tool "${capability.toolName}" is unavailable. Reconnect the server from MCP Servers.`);
      return;
    }
    try {
      await skill.execute(args, this.atlas.skillContext);
      void vscode.window.showInformationMessage(`Sent ${intent} to ${contact.name} via ${capability.serverName}.`);
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceRoot) {
        await appendProjectDirectorHistory(workspaceRoot, {
          id: `out-${skillId}-${new Date().toISOString()}`,
          kind: 'outbound',
          summary: `${intent} → ${contact.name} via ${capability.serverName} (${capability.toolName})`,
          entityId: contact.id,
          ranAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Connector send failed: ${detail}`);
    }
    await this.syncState();
  }

  /** Resolve live CI status for the branch being promoted (best-effort, gh). */
  private async resolveLiveCiStatus(
    workspaceRoot: string,
    from: DeploymentStage,
  ): Promise<Record<string, 'pass' | 'fail' | 'pending'> | undefined> {
    let sourceRef = from.branchRef;
    if (!sourceRef) {
      try {
        sourceRef = (await runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      } catch {
        sourceRef = undefined;
      }
    }
    return sourceRef ? gatherLiveCiStatus(workspaceRoot, sourceRef) : undefined;
  }

  private async handlePromotionPlanRequest(pathId: string, mode: 'execute' | 'runbook'): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const config = this.atlas.deliveryManager.getConfig();
    if (!workspaceRoot || !config) {
      await this.postMessage({ type: 'promotionError', payload: 'No delivery pipeline is available.' });
      return;
    }
    const promo = config.paths.find(candidate => candidate.id === pathId);
    const from = promo && config.stages.find(stage => stage.id === promo.fromStageId);
    const to = promo && config.stages.find(stage => stage.id === promo.toStageId);
    if (!promo || !from || !to) {
      await this.postMessage({ type: 'promotionError', payload: 'That promotion path no longer exists.' });
      return;
    }
    const facts = await gatherPromotionFacts(workspaceRoot, from, to);
    await this.atlas.routineRegistry.reload(workspaceRoot).catch(() => undefined);
    const routine = promo.routineId ? this.atlas.routineRegistry.get(promo.routineId) : undefined;
    const liveStatusChecks = await this.resolveLiveCiStatus(workspaceRoot, from);
    const remediationAssessment = await assessPromotionRemediation(workspaceRoot, from, to);
    const plan = buildPromotionPlan({ config, pathId, ...facts, routine, liveStatusChecks, remediationAssessment });
    if (!plan) {
      await this.postMessage({ type: 'promotionError', payload: 'Could not build a promotion plan.' });
      return;
    }
    await this.postMessage({ type: 'promotionPlan', payload: { plan, mode } });
  }

  private async handleRunPromotion(payload: { pathId: string; attestations: string[]; confirmText: string }): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const config = this.atlas.deliveryManager.getConfig();
    if (!workspaceRoot || !config) {
      await this.postMessage({ type: 'promotionError', payload: 'No delivery pipeline is available.' });
      return;
    }
    const promo = config.paths.find(candidate => candidate.id === payload.pathId);
    const from = promo && config.stages.find(stage => stage.id === promo.fromStageId);
    const to = promo && config.stages.find(stage => stage.id === promo.toStageId);
    if (!promo || !from || !to) {
      await this.postMessage({ type: 'promotionError', payload: 'That promotion path no longer exists.' });
      return;
    }
    // Rebuild the plan from live state so gates are enforced against current facts,
    // not whatever the webview last saw.
    const facts = await gatherPromotionFacts(workspaceRoot, from, to);
    await this.atlas.routineRegistry.reload(workspaceRoot).catch(() => undefined);
    const routine = promo.routineId ? this.atlas.routineRegistry.get(promo.routineId) : undefined;
    const liveStatusChecks = await this.resolveLiveCiStatus(workspaceRoot, from);
    const approver = await resolveGitActorEmail(workspaceRoot);
    const lastCommitAuthor = await resolveLastCommitAuthor(workspaceRoot, from.branchRef);
    const remediationAssessment = await assessPromotionRemediation(workspaceRoot, from, to);
    const plan = buildPromotionPlan({ config, pathId: payload.pathId, ...facts, routine, liveStatusChecks, approver, lastCommitAuthor, remediationAssessment });
    if (!plan) {
      await this.postMessage({ type: 'promotionError', payload: 'Could not build a promotion plan.' });
      return;
    }
    const gate = evaluatePromotionGate(plan, payload.attestations, payload.confirmText, to.name);
    if (!gate.allowed) {
      await this.postMessage({ type: 'promotionError', payload: gate.reason ?? 'Promotion is not permitted.' });
      return;
    }
    // Single-flight: refuse to start while another promotion/rollback is running.
    if (!await acquireDeliveryLock(workspaceRoot, `promote ${from.name} → ${to.name}`)) {
      await this.postMessage({ type: 'promotionError', payload: 'Another promotion or rollback is already in progress. Wait for it to finish (or it clears automatically after 60 min).' });
      return;
    }
    try {
      const result = await runPromotion({
        workspaceRoot,
        plan,
        config,
        routine,
        onProgress: update => { void this.postMessage({ type: 'promotionProgress', payload: update }); },
      });
      // Record the outcome on the path and persist (updates delivery.json + delivery.md).
      const updated: DeliveryConfig = {
        ...config,
        paths: config.paths.map(candidate => candidate.id === payload.pathId
          ? { ...candidate, lastPromotion: { ranAt: result.startedAt, succeeded: result.succeeded, version: facts.fromVersion } }
          : candidate),
      };
      await this.atlas.deliveryManager.save(updated);
      // Append an immutable audit record (who/when/what/outcome).
      await appendPromotionHistory(workspaceRoot, {
        id: `promo-${Date.now()}`,
        kind: 'promotion',
        pathId: payload.pathId,
        fromName: from.name,
        toName: to.name,
        version: facts.fromVersion,
        succeeded: result.succeeded,
        ranAt: result.startedAt,
        durationMs: result.durationMs,
        actor: await resolveGitActor(workspaceRoot),
      }).catch(() => undefined);
      await this.postMessage({ type: 'promotionDone', payload: result });
    } finally {
      await releaseDeliveryLock(workspaceRoot);
    }
    await this.syncState();
  }

  /**
   * Resolve the fixable failing preflight checks (version bump + changelog),
   * commit them, then run the promotion — the modal's "Resolve & run". The
   * remediation is computed server-side from the live plan; the webview only
   * triggers it. The whole sequence runs under the single-flight delivery lock so
   * the edit/commit and the promotion are atomic with respect to other runs.
   */
  private async handleResolveAndRunPromotion(payload: { pathId: string; attestations: string[]; confirmText: string }): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const config = this.atlas.deliveryManager.getConfig();
    if (!workspaceRoot || !config) {
      await this.postMessage({ type: 'promotionError', payload: 'No delivery pipeline is available.' });
      return;
    }
    const promo = config.paths.find(candidate => candidate.id === payload.pathId);
    const from = promo && config.stages.find(stage => stage.id === promo.fromStageId);
    const to = promo && config.stages.find(stage => stage.id === promo.toStageId);
    if (!promo || !from || !to) {
      await this.postMessage({ type: 'promotionError', payload: 'That promotion path no longer exists.' });
      return;
    }

    // Build the plan from live state and confirm a remediation is actually on offer
    // (every failing auto-check is fixable). Refuse otherwise — never half-fix.
    await this.atlas.routineRegistry.reload(workspaceRoot).catch(() => undefined);
    const routine = promo.routineId ? this.atlas.routineRegistry.get(promo.routineId) : undefined;
    const facts = await gatherPromotionFacts(workspaceRoot, from, to);
    const liveStatusChecks = await this.resolveLiveCiStatus(workspaceRoot, from);
    const approver = await resolveGitActorEmail(workspaceRoot);
    const lastCommitAuthor = await resolveLastCommitAuthor(workspaceRoot, from.branchRef);
    const remediationAssessment = await assessPromotionRemediation(workspaceRoot, from, to);
    const plan = buildPromotionPlan({ config, pathId: payload.pathId, ...facts, routine, liveStatusChecks, approver, lastCommitAuthor, remediationAssessment });
    if (!plan) {
      await this.postMessage({ type: 'promotionError', payload: 'Could not build a promotion plan.' });
      return;
    }
    if (!plan.remediation) {
      await this.postMessage({ type: 'promotionError', payload: 'Nothing here can be auto-resolved — a non-fixable check is failing, or the checks already pass.' });
      return;
    }
    // The non-fixable gates (manual attestations, approval, protected confirm) must
    // already be satisfied; only the fixable auto-checks may still be failing.
    const nonAutoGate = evaluatePromotionGateExceptFixable(plan, payload.attestations, payload.confirmText, to.name);
    if (!nonAutoGate.allowed) {
      await this.postMessage({ type: 'promotionError', payload: nonAutoGate.reason ?? 'Promotion is not permitted.' });
      return;
    }

    if (!await acquireDeliveryLock(workspaceRoot, `resolve+promote ${from.name} → ${to.name}`)) {
      await this.postMessage({ type: 'promotionError', payload: 'Another promotion or rollback is already in progress. Wait for it to finish (or it clears automatically after 60 min).' });
      return;
    }
    try {
      await this.postMessage({ type: 'promotionProgress', payload: { stepId: 'resolve', label: 'Resolve preflight', index: 0, total: 0, status: 'running' } });
      const applied = await applyPromotionRemediation(workspaceRoot, plan.remediation);
      await this.postMessage({ type: 'promotionProgress', payload: { stepId: 'resolve', label: 'Resolve preflight', index: 0, total: 0, status: applied.ok ? 'done' : 'failed', output: applied.output } });
      if (!applied.ok) {
        await this.postMessage({ type: 'promotionError', payload: `Could not auto-resolve the failing checks: ${applied.output}` });
        return;
      }

      // Rebuild from the now-updated tree and enforce the FULL gate before running.
      const facts2 = await gatherPromotionFacts(workspaceRoot, from, to);
      const liveStatusChecks2 = await this.resolveLiveCiStatus(workspaceRoot, from);
      const lastCommitAuthor2 = await resolveLastCommitAuthor(workspaceRoot, from.branchRef);
      const plan2 = buildPromotionPlan({ config, pathId: payload.pathId, ...facts2, routine, liveStatusChecks: liveStatusChecks2, approver, lastCommitAuthor: lastCommitAuthor2 });
      if (!plan2) {
        await this.postMessage({ type: 'promotionError', payload: 'Could not rebuild the promotion plan after resolving checks.' });
        return;
      }
      const gate = evaluatePromotionGate(plan2, payload.attestations, payload.confirmText, to.name);
      if (!gate.allowed) {
        await this.postMessage({ type: 'promotionError', payload: `Resolved the fixable checks, but the promotion is still gated: ${gate.reason ?? 'not permitted.'}` });
        return;
      }

      const result = await runPromotion({
        workspaceRoot,
        plan: plan2,
        config,
        routine,
        onProgress: update => { void this.postMessage({ type: 'promotionProgress', payload: update }); },
      });
      const updated: DeliveryConfig = {
        ...config,
        paths: config.paths.map(candidate => candidate.id === payload.pathId
          ? { ...candidate, lastPromotion: { ranAt: result.startedAt, succeeded: result.succeeded, version: facts2.fromVersion } }
          : candidate),
      };
      await this.atlas.deliveryManager.save(updated);
      await appendPromotionHistory(workspaceRoot, {
        id: `promo-${Date.now()}`,
        kind: 'promotion',
        pathId: payload.pathId,
        fromName: from.name,
        toName: to.name,
        version: facts2.fromVersion,
        succeeded: result.succeeded,
        ranAt: result.startedAt,
        durationMs: result.durationMs,
        actor: await resolveGitActor(workspaceRoot),
      }).catch(() => undefined);
      await this.postMessage({ type: 'promotionDone', payload: result });
    } finally {
      await releaseDeliveryLock(workspaceRoot);
    }
    await this.syncState();
  }

  /**
   * Execute a stage's user-authored rollback command after authorization
   * (protected stages require the typed stage name). Records an audit entry.
   */
  private async handleRollbackStage(payload: { stageId: string; confirmText: string }): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const config = this.atlas.deliveryManager?.getConfig();
    if (!workspaceRoot || !config) {
      await this.postMessage({ type: 'rollbackResult', payload: { ok: false, summary: 'No delivery pipeline is available.' } });
      return;
    }
    const stage = config.stages.find(candidate => candidate.id === payload.stageId);
    if (!stage) {
      await this.postMessage({ type: 'rollbackResult', payload: { ok: false, summary: 'That stage no longer exists.' } });
      return;
    }
    const command = (stage.rollbackPolicy.command ?? '').trim();
    if (!command) {
      await this.postMessage({ type: 'rollbackResult', payload: { ok: false, summary: `No rollback command is configured for ${stage.name}.` } });
      return;
    }
    if (stage.isProtected && payload.confirmText.trim().toLowerCase() !== stage.name.trim().toLowerCase()) {
      await this.postMessage({ type: 'rollbackResult', payload: { ok: false, summary: `Type the stage name "${stage.name}" to confirm a protected rollback.` } });
      return;
    }
    if (!await acquireDeliveryLock(workspaceRoot, `rollback ${stage.name}`)) {
      await this.postMessage({ type: 'rollbackResult', payload: { ok: false, summary: 'Another promotion or rollback is already in progress. Wait for it to finish.' } });
      return;
    }
    try {
      const result = await runRollback(workspaceRoot, command);
      await appendPromotionHistory(workspaceRoot, {
        id: `rollback-${Date.now()}`,
        kind: 'rollback',
        toName: stage.name,
        succeeded: result.ok,
        ranAt: new Date().toISOString(),
        actor: await resolveGitActor(workspaceRoot),
      }).catch(() => undefined);
      await this.postMessage({ type: 'rollbackResult', payload: { ok: result.ok, summary: `${stage.name} rollback ${result.ok ? 'succeeded' : 'failed'}: ${result.output}` } });
    } finally {
      await releaseDeliveryLock(workspaceRoot);
    }
    await this.syncState();
  }

  private getHtml(): string {
    const scriptFileUri = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'projectDashboard.js');
    const scriptUri = this.panel.webview.asWebviewUri(scriptFileUri);
    let inlineScript: string | undefined;
    try {
      // Prefer inline script content to avoid webview resource bootstrap issues.
      inlineScript = readFileSync(scriptFileUri.fsPath, 'utf8');
    } catch {
      inlineScript = undefined;
    }

    return getWebviewHtmlShell({
      title: 'AtlasMind Project Dashboard',
      cspSource: this.panel.webview.cspSource,
      ...(inlineScript
        ? { scriptContent: inlineScript }
        : { scriptUri: scriptUri.toString() }),
      bodyContent: `
        <div class="dashboard-shell">
          <div id="no-project-banner" class="no-project-banner" style="display:none" aria-live="polite">
            <div class="no-project-banner-content">
              <p class="no-project-banner-title">No AtlasMind project loaded</p>
              <p class="no-project-banner-sub">Bootstrap a new project or import an existing one to enable memory, ideation, roadmap, and operational intelligence.</p>
              <div class="no-project-banner-actions">
                <button class="dashboard-button dashboard-button-primary" type="button" data-action="openCommand" data-payload="atlasmind.bootstrapProject">Bootstrap new project</button>
                <button class="dashboard-button dashboard-button-secondary" type="button" data-action="openCommand" data-payload="atlasmind.importProject">Import existing project</button>
              </div>
            </div>
          </div>
          <div class="dashboard-topbar">
            <div>
              <p class="dashboard-kicker">Command center</p>
              <h1>Project Dashboard</h1>
              <p class="dashboard-copy">Operational visibility across workspace health, AtlasMind runtime state, Testing intelligence, SSOT coverage, Roadmap priorities, security posture, delivery workflow, and review readiness.</p>
              <div id="dashboard-version-strip" class="dashboard-version-strip" aria-live="polite"></div>
            </div>
            <div class="dashboard-actions" role="group" aria-label="Dashboard actions">
              <button id="dashboard-refresh" class="dashboard-button dashboard-button-ghost" type="button">Refresh</button>
            </div>
          </div>
          <!-- No aria-live here. render() replaces this entire subtree on every
               state change, so a live region on the root made a screen reader
               re-announce the whole dashboard on each keystroke and checkbox
               toggle. Transient status is announced through #dashboard-status
               instead. -->
          <div id="dashboard-root" class="dashboard-root">
            <div class="dashboard-loading">Loading dashboard signals…</div>
          </div>
          <div id="dashboard-status" class="visually-hidden" role="status" aria-live="polite"></div>
        </div>
      `,
      extraCss: DASHBOARD_CSS,
    });
  }
}

export function isProjectDashboardMessage(message: unknown): message is ProjectDashboardMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }

  const candidate = message as Record<string, unknown>;
  if (candidate['type'] === 'ready' || candidate['type'] === 'refresh' || candidate['type'] === 'runGapAnalysis' || candidate['type'] === 'markDeliveryReviewed' || candidate['type'] === 'reimportDelivery' || candidate['type'] === 'seedDirectorFromRepo' || candidate['type'] === 'seedDocumentsFromRepo' || candidate['type'] === 'createRoadmapGate') {
    return true;
  }

  if (candidate['type'] === 'refreshIssues') {
    return true;
  }

  if (candidate['type'] === 'workOnIssue') {
    return sanitizeIssueNumber(candidate['payload']) > 0;
  }

  // Issue writes are outward-facing and usually public, so the shape is checked
  // here and the content is re-sanitised before it reaches `gh`. The webview
  // never supplies a command or an argument list — only these fields.
  if (candidate['type'] === 'createIssue') {
    return sanitizeIssueDraft(candidate['payload']) !== undefined;
  }

  // Pull-request writes carry the same rule as issue writes: the shape is
  // checked here, the content is re-sanitised before it reaches `gh`, and the
  // webview supplies only these fields — never a command or an argument list.
  if (candidate['type'] === 'createPullRequest') {
    const payload = candidate['payload'] as Record<string, unknown> | undefined;
    if (typeof payload !== 'object' || payload === null) {
      return false;
    }
    // A ref is a git ref, not free text: anything else is refused here rather
    // than sanitised into something that might still be a valid ref elsewhere.
    const ref = (value: unknown): boolean =>
      typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[~^:\s\\?*[\]]|\.\./.test(value);
    return typeof payload['title'] === 'string'
      && payload['title'].trim().length > 0
      && ref(payload['base'])
      && ref(payload['head'])
      && (payload['body'] === undefined || typeof payload['body'] === 'string')
      && (payload['draft'] === undefined || typeof payload['draft'] === 'boolean');
  }

  if (candidate['type'] === 'reviewPullRequest') {
    const payload = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof payload === 'object' && payload !== null
      && sanitizeIssueNumber(payload['number']) > 0
      && (payload['verdict'] === 'approve' || payload['verdict'] === 'request-changes' || payload['verdict'] === 'comment')
      && (payload['body'] === undefined || typeof payload['body'] === 'string');
  }

  if (candidate['type'] === 'mergePullRequest') {
    const payload = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof payload === 'object' && payload !== null
      && sanitizeIssueNumber(payload['number']) > 0
      && typeof payload['base'] === 'string';
  }

  if (candidate['type'] === 'closePullRequest') {
    const payload = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof payload === 'object' && payload !== null && sanitizeIssueNumber(payload['number']) > 0;
  }

  if (candidate['type'] === 'closeIssue' || candidate['type'] === 'reopenIssue') {
    const payload = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof payload === 'object' && payload !== null && sanitizeIssueNumber(payload['number']) > 0;
  }

  if (candidate['type'] === 'commentIssue') {
    const payload = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof payload === 'object' && payload !== null
      && sanitizeIssueNumber(payload['number']) > 0
      && typeof payload['body'] === 'string' && payload['body'].trim().length > 0;
  }

  if (candidate['type'] === 'deleteRoadmapGate') {
    // A gate id is a slug, not free text: reject anything that would not round-trip
    // as a `#tag` rather than coercing it into one.
    return typeof candidate['payload'] === 'string' && slugifyGateId(candidate['payload']).length > 0;
  }

  if ((candidate['type'] === 'openCommand' || candidate['type'] === 'openFile' || candidate['type'] === 'openRun' || candidate['type'] === 'openRunWithGoal' || candidate['type'] === 'openSession' || candidate['type'] === 'addressGap' || candidate['type'] === 'resolveGapItem' || candidate['type'] === 'resolveGapGroup' || candidate['type'] === 'openGapFiles' || candidate['type'] === 'copyContact' || candidate['type'] === 'createShelfFolder') && typeof candidate['payload'] === 'string') {
    return candidate['payload'].trim().length > 0;
  }

  if (candidate['type'] === 'openPrompt') {
    return normalizeDashboardPromptRequest(candidate['payload']) !== undefined;
  }

  if (candidate['type'] === 'attachIdeationImages' || candidate['type'] === 'clearIdeationImages') {
    return true;
  }

  if (candidate['type'] === 'runIdeationLoop') {
    return isIdeationRunPayload(candidate['payload']);
  }

  if (candidate['type'] === 'saveIdeationBoard') {
    return isIdeationBoardPayload(candidate['payload']);
  }

  if (candidate['type'] === 'saveRoadmap') {
    return isDashboardRoadmapSavePayload(candidate['payload']);
  }

  if (candidate['type'] === 'saveTestingConfig') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof p === 'object' && p !== null && p['version'] === 1 && Array.isArray(p['methodologies']);
  }

  if (candidate['type'] === 'saveDeliveryConfig') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof p === 'object' && p !== null && p['version'] === 1 && Array.isArray(p['stages']) && Array.isArray(p['paths']);
  }

  if (candidate['type'] === 'saveDirectorConfig') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof p === 'object' && p !== null && p['version'] === 1
      && Array.isArray(p['contacts']) && Array.isArray(p['stakeholders']) && Array.isArray(p['teamMembers'])
      && Array.isArray(p['responsibilities']) && Array.isArray(p['assignments']) && Array.isArray(p['followUps']);
  }

  if (candidate['type'] === 'saveDocumentsConfig') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof p === 'object' && p !== null && p['version'] === 1 && Array.isArray(p['filing']) && Array.isArray(p['autoUpdate']);
  }

  // Risk messages trigger a paid model call and mutate the persisted register, so the
  // domain and status are checked against their closed sets here rather than being
  // coerced later — an unrecognised value is rejected outright, not defaulted.
  if (candidate['type'] === 'runRiskAnalysis') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    if (typeof p !== 'object' || p === null) {
      return false;
    }
    const domain = p['domain'];
    return domain === 'all' || (typeof domain === 'string' && (RISK_DOMAINS as readonly string[]).includes(domain));
  }

  if (candidate['type'] === 'setRiskFindingStatus') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    if (typeof p !== 'object' || p === null) {
      return false;
    }
    const validStatuses = ['open', 'accepted', 'mitigated', 'closed', 'dismissed'];
    return typeof p['findingId'] === 'string' && p['findingId'].trim().length > 0
      && typeof p['status'] === 'string' && validStatuses.includes(p['status'])
      && (p['note'] === undefined || typeof p['note'] === 'string');
  }

  if (candidate['type'] === 'setRiskFilter') {
    return typeof candidate['payload'] === 'string';
  }

  if (candidate['type'] === 'openContactDeepLink') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof p === 'object' && p !== null && typeof p['contactId'] === 'string' && p['contactId'].length > 0
      && typeof p['linkId'] === 'string' && p['linkId'].length > 0;
  }

  if (candidate['type'] === 'assignRunOwner') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof p === 'object' && p !== null && typeof p['runId'] === 'string' && p['runId'].length > 0
      && typeof p['contactId'] === 'string';
  }

  if (candidate['type'] === 'directorSendComms') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof p === 'object' && p !== null
      && (p['intent'] === 'email' || p['intent'] === 'schedule' || p['intent'] === 'message')
      && typeof p['contactId'] === 'string' && p['contactId'].length > 0;
  }

  if (candidate['type'] === 'setBuzzAgentBinding') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    // An empty list is the unbind case, not a malformed message. Every entry
    // must be a string: this decides which agent owns inbound work, so a
    // non-string slipping through would reach the registry lookup as anything.
    return typeof p === 'object' && p !== null && typeof p['pubkey'] === 'string' && p['pubkey'].length > 0
      && Array.isArray(p['agentIds']) && p['agentIds'].every(id => typeof id === 'string');
  }

  if (candidate['type'] === 'requestPromotionPlan') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof p === 'object' && p !== null && typeof p['pathId'] === 'string' && p['pathId'].length > 0
      && (p['mode'] === 'execute' || p['mode'] === 'runbook');
  }

  if (candidate['type'] === 'runPromotion' || candidate['type'] === 'resolveAndRunPromotion') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof p === 'object' && p !== null && typeof p['pathId'] === 'string' && p['pathId'].length > 0
      && Array.isArray(p['attestations']) && typeof p['confirmText'] === 'string';
  }

  if (candidate['type'] === 'rollbackStage') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof p === 'object' && p !== null && typeof p['stageId'] === 'string' && p['stageId'].length > 0
      && typeof p['confirmText'] === 'string';
  }

  if (candidate['type'] === 'testHealthUrl') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof p === 'object' && p !== null && typeof p['url'] === 'string';
  }

  if (candidate['type'] === 'saveDataPrivacyConfig') {
    return isDataPrivacyConfigPayload(candidate['payload']);
  }

  if (candidate['type'] === 'testDataPrivacy') {
    const p = candidate['payload'] as Record<string, unknown> | undefined;
    return typeof p === 'object' && p !== null
      && (p['kind'] === 'text' || p['kind'] === 'path')
      && typeof p['value'] === 'string';
  }

  if (candidate['type'] === 'openExternalUrl') {
    return typeof candidate['payload'] === 'string' && /^https:\/\//i.test(candidate['payload']);
  }

  return false;
}

function isDataPrivacyConfigPayload(payload: unknown): payload is import('../types.js').DataPrivacyConfig {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false;
  }
  const p = payload as Record<string, unknown>;
  if (p['version'] !== 1 || typeof p['enabled'] !== 'boolean') {
    return false;
  }
  if (!Array.isArray(p['rules']) || !Array.isArray(p['compliancePacks']) || !Array.isArray(p['trustedModelIds'])) {
    return false;
  }
  const validRule = (r: unknown): boolean => {
    if (typeof r !== 'object' || r === null) { return false; }
    const rule = r as Record<string, unknown>;
    return typeof rule['id'] === 'string'
      && (rule['kind'] === 'term' || rule['kind'] === 'regex' || rule['kind'] === 'path')
      && typeof rule['value'] === 'string'
      && (rule['sensitivity'] === 'confidential' || rule['sensitivity'] === 'proprietary' || rule['sensitivity'] === 'secret')
      && typeof rule['enabled'] === 'boolean';
  };
  return (p['rules'] as unknown[]).every(validRule)
    && (p['compliancePacks'] as unknown[]).every(id => typeof id === 'string')
    && (p['trustedModelIds'] as unknown[]).every(id => typeof id === 'string');
}

function isDashboardRoadmapSavePayload(payload: unknown): payload is DashboardRoadmapSavePayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false;
  }
  const items = (payload as { items?: unknown }).items;
  return Array.isArray(items) && items.every(item => typeof item === 'object' && item !== null && typeof (item as { text?: unknown }).text === 'string');
}

/** Exported for tests: the page-id allowlist is easy to leave a new page out of. */
export function normalizeDashboardPromptRequest(payload: unknown): { prompt: string; sourcePage?: DashboardPageId } | undefined {
  if (typeof payload === 'string') {
    const prompt = payload.trim();
    return prompt.length > 0 ? { prompt } : undefined;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const candidate = payload as Record<string, unknown>;
  const prompt = typeof candidate['prompt'] === 'string' ? candidate['prompt'].trim() : '';
  if (!prompt) {
    return undefined;
  }
  const sourcePage = candidate['sourcePage'];
  return {
    prompt,
    ...(typeof sourcePage === 'string' && (DASHBOARD_PAGE_IDS as readonly string[]).includes(sourcePage)
      ? { sourcePage: sourcePage as DashboardPageId }
      : {}),
  };
}

/**
 * Assemble the Workflow page from state the dashboard already holds.
 *
 * No network call, no file read: every input is something a sibling collector
 * gathered for another page. The page therefore costs nothing to open, which is
 * what lets it be the first thing somebody looks at.
 *
 * The honesty rules from `workflowMetrics.ts` carry through unchanged — an
 * unmeasured component is omitted from the health score rather than counted as
 * zero, and a repository with no CI reports "no checks" rather than "0% passing".
 */
function buildGuidedWorkflowSnapshot(input: {
  configuration: vscode.WorkspaceConfiguration;
  gitSnapshot: GitSnapshot;
  packageVersion: string;
  ciWorkflowCount: number;
  testing: TestingDashboardSnapshot;
  issues: DashboardIssuesSnapshot;
  pullRequests?: readonly PullRequestRecord[];
  ci?: DashboardCiIntelligence;
  changelogPresent: boolean;
  prTemplatePresent: boolean;
  codeownersPresent: boolean;
  issueTemplateCount: number;
  commitSeries: DashboardSeriesPoint[];
}): DashboardGuidedWorkflowSnapshot {
  const now = Date.now();
  const profile = normalizeWorkflowProfile(input.configuration.get<string>('workflow.profile', 'solo'));
  const enabled = input.configuration.get<boolean>('workflow.enabled', false);
  const automationLevel = input.configuration.get<string>('workflow.maxAutomationLevel', 'observe');

  const enabledMethodologies = (input.testing.projectTestingConfig?.methodologies ?? [])
    .filter(entry => entry.enabled)
    .map(entry => entry.id);

  const branches = deriveBranchMetrics(
    input.gitSnapshot.branches.map(branch => ({ name: branch.name, lastCommitAt: branch.lastCommitAt })),
    now,
  );

  // Issues come from a network call the user may never have triggered. An
  // un-loaded tracker is *absent*, not empty — reporting "0 open issues" for a
  // list nobody fetched would be a confident lie.
  const issueMetrics = input.issues.status === 'ready'
    ? deriveIssueMetrics(
      input.issues.issues.map(issue => ({
        number: issue.number,
        state: issue.state,
        labels: issue.labels,
        assignees: issue.assignees,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      })),
      now,
    )
    : undefined;

  // Absent until a load succeeded — absent is not the same as none open, and
  // only one of those is a fact about the repository.
  const prMetrics = input.pullRequests === undefined
    ? undefined
    : derivePullRequestMetrics(
      input.pullRequests.map(pr => ({
        number: pr.number,
        state: pr.state,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        mergedAt: pr.mergedAt,
        additions: pr.additions,
        deletions: pr.deletions,
        reviews: pr.reviews.map(review => ({ verdict: review.verdict, submittedAt: review.submittedAt })),
        linkedIssues: pr.linkedIssues,
      })),
      now,
    );

  // Phase 1 has no check-run fetch on the render path, so CI reports honestly
  // that it has not looked rather than implying a green build.
  const ci = deriveCiMetrics([]);

  const release = deriveReleaseMetrics({
    version: input.packageVersion,
    changelogVersions: input.changelogPresent ? [input.packageVersion] : [],
    commitsSinceTag: 0,
    commitSubjects: input.gitSnapshot.commits.map(commit => commit.subject),
  });

  const observed: WorkflowObservedState = {
    ...(input.issues.repoSlug === undefined ? {} : { repoSlug: input.issues.repoSlug }),
    ...(input.issues.status === 'no-cli' ? { ghInstalled: false } : {}),
    ...(input.issues.status === 'not-authenticated' ? { ghInstalled: true, ghAuthenticated: false } : {}),
    ...(input.issues.status === 'ready' ? { ghInstalled: true, ghAuthenticated: true } : {}),
    ...(issueMetrics === undefined ? {} : {
      openIssueCount: issueMetrics.open,
      unassignedIssueCount: issueMetrics.unassigned,
      staleIssueCount: issueMetrics.stale,
    }),
    hasIssueTemplates: input.issueTemplateCount > 0,
    declaredLabelCount: issueMetrics ? issueMetrics.byLabel.length : 0,
    currentBranch: input.gitSnapshot.currentBranch,
    integrationBranch: 'develop',
    protectedBranches: ['main'],
    workingTreeClean: !input.gitSnapshot.dirty,
    nonConformingBranchCount: branches.nonConforming.length,
    enabledTestingMethodologyIds: enabledMethodologies,
    hasTestFiles: input.testing.totalFiles > 0,
    hasPullRequestTemplate: input.prTemplatePresent,
    hasCodeOwners: input.codeownersPresent,
    ciWorkflowCount: input.ciWorkflowCount,
    ciStatus: 'none',
    // The report's *presence* is the signal — there is no "found" flag, because
    // a report that could not be read is indistinguishable from one that does
    // not exist, and both mean "no verdict".
    hasTestReport: input.testing.policyCoverage?.report !== undefined,
    currentVersion: input.packageVersion,
    hasChangelog: input.changelogPresent,
    changelogHasCurrentVersion: release.changelogCurrent,
    commitsSinceLastTag: release.commitsSinceTag,
    hasDebtRegister: false,
    workflowConfigPresent: false,
    workflowEnabled: enabled,
    profile,
  };

  const stages = buildWorkflowCurriculum(observed);
  const progress = summarizeWorkflowProgress(stages);
  const next = nextWorkflowStep(stages);

  // Only the parts that could actually be measured contribute. `governance` is
  // always measurable because it reads local files; the rest may be absent, and
  // absent is reported rather than scored.
  const components: HealthComponent[] = [
    {
      key: 'setup',
      label: 'Workflow setup',
      score: progress.total > 0 ? known(Math.round((progress.done / progress.total) * 100)) : unknown('No steps evaluated.'),
      weight: 3,
    },
    { key: 'branches', label: 'Branch naming', score: branches.conformanceRate, weight: 1 },
    { key: 'commits', label: 'Commit conventions', score: release.conformance.rate, weight: 2 },
    { key: 'ci', label: 'CI pass rate', score: ci.passRate, weight: 2 },
    {
      key: 'issues',
      label: 'Issue hygiene',
      score: issueMetrics === undefined
        ? unknown('Issues have not been loaded.', 'Open the Issues tab to fetch them.')
        : issueMetrics.open === 0
          ? unknown('No open issues to assess.')
          : known(Math.round(((issueMetrics.open - issueMetrics.stale) / issueMetrics.open) * 100)),
      weight: 1,
    },
  ];

  return {
    stages,
    progress,
    ...(next === undefined ? {} : {
      next: {
        stageId: next.stage.id,
        stepId: next.step.id,
        stageName: next.stage.name,
        stepTitle: next.step.title,
      },
    }),
    glossary: referencedGlossaryKeys(stages).flatMap(key => {
      const entry = glossaryEntry(key);
      return entry ? [{ key, term: entry.term, definition: entry.definition }] : [];
    }),
    profile,
    enabled,
    automationLevel,
    capabilities: [
      {
        id: 'atlasmind.workflow.allowIssueWrites',
        label: 'Issue writes',
        enabled: input.configuration.get<boolean>('workflow.allowIssueWrites', false),
        detail: 'Create, comment on, edit, close or reopen issues. Every write still confirms first.',
      },
      {
        id: 'atlasmind.workflow.allowPullRequestWrites',
        label: 'Pull request writes',
        enabled: input.configuration.get<boolean>('workflow.allowPullRequestWrites', false),
        detail: 'Open pull requests, post reviews, merge. Every write still confirms first.',
      },
      {
        id: 'atlasmind.workflow.allowReleaseWrites',
        label: 'Release writes',
        enabled: input.configuration.get<boolean>('workflow.allowReleaseWrites', false),
        detail: 'Bump the version and write the changelog entry. Tagging and publishing stay human-triggered.',
      },
      {
        id: 'atlasmind.workflow.allowProtectedRefWrites',
        label: 'Protected branch writes',
        enabled: input.configuration.get<boolean>('workflow.allowProtectedRefWrites', false),
        detail: 'A hard ceiling. With this off, unattended automation is unreachable for any stage whose base is protected.',
      },
    ],
    ...(issueMetrics === undefined ? {} : { issues: issueMetrics }),
    ...(prMetrics === undefined ? {} : { pullRequests: prMetrics }),
    ...(input.ci === undefined ? {} : { ciIntelligence: input.ci }),
    branches,
    ci,
    release,
    health: deriveWorkflowHealth(components),
    commitSeries: input.commitSeries,
  };
}

function normalizeWorkflowProfile(value: string | undefined): 'solo' | 'studio' | 'custom' {
  return value === 'studio' || value === 'custom' ? value : 'solo';
}

async function collectDashboardSnapshot(
  atlas: AtlasMindContext,
  ideationAttachments: TaskImageAttachment[] = [],
  // Held by the panel rather than collected here: issues come from a network
  // call, so they are fetched on demand and simply carried through a render.
  issues: DashboardIssuesSnapshot = { status: 'not-loaded', detail: 'Issues have not been loaded yet.', issues: [], busy: false },
  // Undefined until a load has actually succeeded. An empty array would claim
  // "no pull requests", which is a different fact from "we have not looked".
  pullRequests?: readonly PullRequestRecord[],
  ci?: DashboardCiIntelligence,
): Promise<DashboardSnapshot> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'No Workspace';
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
  const workspaceRootLabel = workspaceRoot ? path.basename(workspaceRoot) : 'No folder open';
  const activeIdeationWorkspace = await loadActiveIdeationWorkspace(workspaceRoot, ssotPath);

  const [gitSnapshot, packageSnapshot, workflowSnapshot, ssotSnapshot, ideationBoard, roadmapSnapshot] = await Promise.all([
    collectGitSnapshot(workspaceRoot),
    collectPackageSnapshot(workspaceRoot),
    collectWorkflowSnapshot(workspaceRoot),
    collectSsotSnapshot(workspaceRoot, ssotPath),
    loadIdeationBoard(workspaceRoot, ssotPath, activeIdeationWorkspace),
    collectRoadmapSnapshot(workspaceRoot, ssotPath),
  ]);
  const versionSnapshot = await collectVersionSnapshot(workspaceRoot, gitSnapshot.currentBranch, packageSnapshot.version);
  const stagePipeline = await collectDeliveryStagePipeline(atlas, workspaceRoot, gitSnapshot.currentBranch, workflowSnapshot.map(workflow => workflow.name));

  const testingSnapshot = collectTestingDashboardSnapshot(atlas);
  const providers = atlas.modelRouter.listProviders();
  const totalProviders = providers.length;
  const healthyProviders = providers.filter(provider => atlas.modelRouter.isProviderHealthy(provider.id)).length;
  const enabledModels = providers.reduce((total, provider) => total + provider.models.filter(model => model.enabled !== false).length, 0);
  const totalModels = providers.reduce((total, provider) => total + provider.models.length, 0);
  const agents = atlas.agentRegistry.listAgents();
  const enabledAgents = agents.filter(agent => atlas.agentRegistry.isEnabled(agent.id)).length;
  const skills = atlas.skillsRegistry.listSkills();
  const enabledSkills = skills.filter(skill => atlas.skillsRegistry.isEnabled(skill.id)).length;
  const sessions = atlas.sessionConversation.listSessions();
  const runs = await atlas.projectRunHistory.listRunsAsync(40);
  const directorSnapshot = await collectDirectorSnapshot(atlas, workspaceRoot, gitSnapshot.currentBranch, runs);
  const documentsSnapshot = await collectDocumentsSnapshot(atlas, workspaceRoot);
  const riskSnapshot = collectRiskSnapshot(atlas, workspaceRoot);
  const runtimeTdd = summarizeRuntimeTdd(runs);
  const contributorBreakdown = buildContributorSeries(gitSnapshot.commitLog, SERIES_DAY_RANGE);
  const costSummary = atlas.costTracker.getSummary();
  const memoryEntries = atlas.memoryManager.listEntries();
  const scanResults = atlas.memoryManager.getScanResults();
  const warnedEntries = [...scanResults.values()].filter(result => result.status === 'warned').length;
  const blockedEntries = [...scanResults.values()].filter(result => result.status === 'blocked').length;
  const governanceProviders = detectGovernanceProviders(workspaceRoot);
  const toolApprovalMode = configuration.get<string>('toolApprovalMode', 'ask-on-write');
  const allowTerminalWrite = configuration.get<boolean>('allowTerminalWrite', false);
  const autoVerifyAfterWrite = configuration.get<boolean>('autoVerifyAfterWrite', false);
  const autoVerifyScripts = normalizeVerificationScripts(configuration.get<string[] | string>('autoVerifyScripts', []));
  const securityPolicyPresent = await fileExists(workspaceRoot ? path.join(workspaceRoot, 'SECURITY.md') : undefined);
  const changelogPresent = await fileExists(workspaceRoot ? path.join(workspaceRoot, 'CHANGELOG.md') : undefined);
  const codeownersPresent = await fileExists(workspaceRoot ? path.join(workspaceRoot, '.github', 'CODEOWNERS') : undefined);
  const prTemplatePresent = await fileExists(workspaceRoot ? path.join(workspaceRoot, '.github', 'pull_request_template.md') : undefined);
  const issueTemplateCount = await countIssueTemplates(workspaceRoot);
  const autopilot = atlas.toolApprovalManager.isAutopilot();
  const ciSignals = [
    { label: 'Compile script', ok: packageSnapshot.keyScripts.includes('compile') },
    { label: 'Lint script', ok: packageSnapshot.keyScripts.includes('lint') },
    { label: 'Test script', ok: packageSnapshot.keyScripts.includes('test') },
    { label: 'Workflow files', ok: workflowSnapshot.length > 0 },
  ];
  const reviewReadiness = [
    { label: 'PR template', ok: prTemplatePresent },
    { label: 'CODEOWNERS', ok: codeownersPresent },
    { label: 'Issue templates', ok: issueTemplateCount > 0 },
    { label: 'CHANGELOG', ok: changelogPresent },
  ];
  const outcomeCompleteness = await collectOutcomeCompleteness(workspaceRoot, ssotPath, runs, ciSignals);
  const ssotDelta = await collectSsotDelta(workspaceRoot, ssotPath, agents.length, memoryEntries, securityPolicyPresent, blockedEntries);
  // Built before the score rather than inline in the snapshot below: the score
  // now has a Data privacy component, so both need the same single evaluation.
  const privacySnapshot = await buildPrivacySnapshot(atlas);
  const scoreBreakdown = buildScoreBreakdown({
    ssotPath,
    securityPolicyPresent,
    codeownersPresent,
    prTemplatePresent,
    workflowCount: workflowSnapshot.length,
    dirty: gitSnapshot.dirty,
    behind: gitSnapshot.behind,
    ssotCoveragePercent: ssotSnapshot.coveragePercent,
    blockedEntries,
    warnedEntries,
    totalEntries: memoryEntries.length,
    autopilot,
    governanceProviderCount: governanceProviders.length,
    allowTerminalWrite,
    autoVerifyAfterWrite,
    ciSignals,
    reviewReadiness,
    outcomeCompleteness,
    risk: riskSnapshot,
    privacy: privacySnapshot,
  });
  const repoLabel = workspaceRoot && gitSnapshot.currentBranch !== 'Not a git repository'
    ? `${workspaceRootLabel} • ${gitSnapshot.currentBranch}`
    : workspaceRootLabel;

  // Normalise to /100 from the components actually present rather than assuming the
  // maxScores happen to sum to 100. They did by convention, but nothing enforced it,
  // and the UI hard-codes "/100" in the ring, the headline, and the >=85/>=65 bands.
  // Deriving the denominator keeps those correct as categories change. Every
  // component is now unconditional, so the denominator is fixed at 127 — but it
  // stays derived rather than hard-coded, because the last time a category was
  // conditional this is the line that kept the ring honest.
  const earnedScore = scoreBreakdown.components.reduce((total, component) => total + component.score, 0);
  const availableScore = scoreBreakdown.components.reduce((total, component) => total + component.maxScore, 0);
  const normalizedHealthScore = availableScore > 0 ? Math.round((earnedScore / availableScore) * 100) : 0;

  const stats: DashboardStat[] = [
    {
      id: 'health',
      label: 'Operational Health',
      value: `${normalizedHealthScore}`,
      detail: `Composite score across ${scoreBreakdown.components.length} operational dimensions, including ${outcomeCompleteness.score}% outcome completeness.`,
      tone: blockedEntries > 0 || autopilot ? 'warn' : outcomeCompleteness.score >= 75 ? 'good' : 'accent',
      pageTarget: 'score',
    },
    {
      id: 'branch',
      label: 'Branch State',
      value: gitSnapshot.currentBranch,
      detail: `${gitSnapshot.staged + gitSnapshot.modified + gitSnapshot.untracked} pending file changes, ${gitSnapshot.ahead} ahead / ${gitSnapshot.behind} behind.`,
      tone: gitSnapshot.dirty ? 'warn' : 'good',
      pageTarget: 'repo',
      command: 'workbench.view.scm',
    },
    {
      id: 'runtime',
      label: 'Atlas Runtime',
      value: `${enabledAgents}/${agents.length} agents`,
      detail: `${healthyProviders}/${totalProviders} providers healthy, ${enabledSkills}/${skills.length} skills enabled. TDD posture: ${runtimeTdd.summary.toLowerCase()}.`,
      tone: runtimeTdd.tone === 'critical' ? 'critical' : healthyProviders === totalProviders ? runtimeTdd.tone : 'warn',
      pageTarget: 'runtime',
      command: 'atlasmind.openAgentPanel',
    },
    {
      id: 'ssot',
      label: 'SSOT Coverage',
      value: `${ssotSnapshot.coveragePercent}%`,
      detail: `${memoryEntries.length} indexed entries, ${warnedEntries} warned, ${blockedEntries} blocked.`,
      tone: blockedEntries > 0 ? 'critical' : ssotSnapshot.coveragePercent >= 80 ? 'good' : 'warn',
      pageTarget: 'ssot',
    },
    {
      id: 'security',
      label: 'Security Posture',
      value: toolApprovalMode,
      detail: `${autoVerifyAfterWrite ? 'Post-write verification on' : 'Verification off'} • terminal writes ${allowTerminalWrite ? 'enabled' : 'blocked'}.`,
      tone: autopilot || allowTerminalWrite ? 'warn' : 'good',
      pageTarget: 'security',
      command: 'atlasmind.openSettingsSafety',
    },
    {
      id: 'testing',
      label: 'Test Surface',
      value: `${testingSnapshot.totalCases} cases`,
      detail: `${testingSnapshot.totalFiles} files across ${testingSnapshot.frameworkLabel}. Coverage ${testingSnapshot.coveragePercent ?? 'not generated'} and verification ${testingSnapshot.verificationEnabled ? 'enabled' : 'disabled'}.`,
      tone: testingSnapshot.coveragePercent ? 'good' : testingSnapshot.totalFiles > 0 ? 'accent' : 'warn',
      pageTarget: 'testing',
    },
    {
      id: 'delivery',
      label: 'Delivery Flow',
      value: `${workflowSnapshot.length} workflow${workflowSnapshot.length === 1 ? '' : 's'}`,
      detail: `${packageSnapshot.keyScripts.length} critical scripts, ${governanceProviders.length} governance provider${governanceProviders.length === 1 ? '' : 's'}.`,
      tone: workflowSnapshot.length > 0 ? 'good' : 'warn',
      pageTarget: 'delivery',
    },
    {
      id: 'ideation',
      label: 'Ideation Loop',
      value: `${ideationBoard.cards.length} board card${ideationBoard.cards.length === 1 ? '' : 's'}`,
      detail: `${ideationBoard.nextPrompts.length} follow-up prompt${ideationBoard.nextPrompts.length === 1 ? '' : 's'} queued, ${ideationAttachments.length} live attachment${ideationAttachments.length === 1 ? '' : 's'}.`,
      tone: ideationBoard.cards.length > 0 ? 'accent' : 'neutral',
      command: 'atlasmind.openProjectIdeation',
    },
  ];

  const healthScore = Number(stats.find(stat => stat.id === 'health')?.value ?? '0');
  const heuristicGapItems = buildHeuristicGapAnalysisItems({
    testingSnapshot,
    securityPolicyPresent,
    codeownersPresent,
    prTemplatePresent,
    workflowCount: workflowSnapshot.length,
    ssotCoveragePercent: ssotSnapshot.coveragePercent,
    totalMemoryEntries: memoryEntries.length,
    blockedEntries,
    warnedEntries,
    roadmapOutstandingCount: roadmapSnapshot.outstandingCount,
    healthScore,
    outcomeScore: outcomeCompleteness.score,
    runtimeTdd,
  });
  const gapAnalysis = await collectGapAnalysisSnapshot(workspaceRoot, ssotPath, heuristicGapItems);

  return {
    generatedAt: new Date().toISOString(),
    ssotPresent: ssotSnapshot.totalFiles > 0 || memoryEntries.length > 0,
    workspaceName,
    workspaceRootLabel,
    repositoryLabel: repoLabel,
    currentBranch: gitSnapshot.currentBranch,
    versions: versionSnapshot,
    healthScore,
    healthSummary: buildHealthSummary({ healthScore, blockedEntries, autopilot, dirty: gitSnapshot.dirty, workflowCount: workflowSnapshot.length, outcomeScore: outcomeCompleteness.score }),
    stats,
    charts: {
      commits: buildDailySeries(gitSnapshot.commitDates, SERIES_DAY_RANGE),
      runs: buildDailySeries(runs.map(run => run.updatedAt), SERIES_DAY_RANGE),
      memory: buildDailySeries(memoryEntries.map(entry => entry.lastModified), SERIES_DAY_RANGE),
      contributors: contributorBreakdown.contributors,
      contributorTotal: contributorBreakdown.totalCommits,
    },
    repo: {
      dirty: gitSnapshot.dirty,
      ahead: gitSnapshot.ahead,
      behind: gitSnapshot.behind,
      staged: gitSnapshot.staged,
      modified: gitSnapshot.modified,
      untracked: gitSnapshot.untracked,
      branchCount: gitSnapshot.branches.length,
      branches: gitSnapshot.branches,
      commits: gitSnapshot.commits,
    },
    runtime: {
      enabledAgents,
      totalAgents: agents.length,
      enabledSkills,
      totalSkills: skills.length,
      healthyProviders,
      totalProviders,
      enabledModels,
      totalModels,
      sessionCount: sessions.length,
      projectRunCount: runs.length,
      activeSessionId: atlas.sessionConversation.getActiveSessionId(),
      autopilot,
      totalCostUsd: costSummary.totalCostUsd,
      totalRequests: costSummary.totalRequests,
      totalInputTokens: costSummary.totalInputTokens,
      totalOutputTokens: costSummary.totalOutputTokens,
      tdd: runtimeTdd,
      runs: runs.slice(0, MAX_RECENT_RUNS).map(run => {
        const tdd = summarizeRunTdd(run.subTaskArtifacts);
        return {
          id: run.id,
          goal: run.goal,
          status: run.status,
          updatedAt: run.updatedAt,
          updatedRelative: formatRelativeDate(run.updatedAt),
          progressLabel: `${run.completedSubtaskCount}/${run.totalSubtaskCount} subtasks`,
          tddLabel: tdd.summary,
          tddTone: tdd.tone,
        };
      }),
      sessions: sessions.slice(0, MAX_RECENT_SESSIONS).map(session => ({
        id: session.id,
        title: session.title,
        turnCount: session.turnCount,
        updatedAt: session.updatedAt,
        updatedRelative: formatRelativeDate(session.updatedAt),
        active: session.isActive,
      })),
    },
    testing: testingSnapshot,
    ssot: {
      path: ssotPath,
      totalEntries: memoryEntries.length,
      totalFilesOnDisk: ssotSnapshot.totalFiles,
      coveragePercent: ssotSnapshot.coveragePercent,
      coverage: ssotSnapshot.coverage,
      recentFiles: ssotSnapshot.recentFiles,
      warnedEntries,
      blockedEntries,
      delta: ssotDelta,
    },
    roadmap: roadmapSnapshot,
    guidedWorkflow: buildGuidedWorkflowSnapshot({
      configuration,
      gitSnapshot,
      packageVersion: packageSnapshot.version,
      ciWorkflowCount: workflowSnapshot.length,
      testing: testingSnapshot,
      issues,
      ...(pullRequests === undefined ? {} : { pullRequests }),
      ...(ci === undefined ? {} : { ci }),
      changelogPresent,
      prTemplatePresent,
      codeownersPresent,
      issueTemplateCount,
      commitSeries: buildDailySeries(gitSnapshot.commitDates, SERIES_DAY_RANGE),
    }),
    issues,
    security: {
      toolApprovalMode,
      allowTerminalWrite,
      autoVerifyAfterWrite,
      autoVerifyScripts: autoVerifyScripts || 'No verification commands configured.',
      securityPolicyPresent,
      codeownersPresent,
      prTemplatePresent,
      issueTemplateCount,
      changelogPresent,
      governanceProviders,
    },
    delivery: {
      packageVersion: packageSnapshot.version,
      dependencyCount: packageSnapshot.dependencyCount,
      devDependencyCount: packageSnapshot.devDependencyCount,
      scriptCount: packageSnapshot.scriptCount,
      keyScripts: packageSnapshot.keyScripts,
      workflows: workflowSnapshot,
      ciSignals,
      reviewReadiness,
      artifacts: await collectArtifacts(workspaceRoot),
      stages: stagePipeline,
    },
    director: directorSnapshot,
    documents: documentsSnapshot,
    risk: riskSnapshot,
    score: scoreBreakdown,
    ideation: {
      boardPath: buildIdeationRelativePath(ssotPath, activeIdeationWorkspace.boardFile),
      summaryPath: buildIdeationRelativePath(ssotPath, activeIdeationWorkspace.summaryFile),
      cards: ideationBoard.cards,
      connections: ideationBoard.connections,
      focusCardId: ideationBoard.focusCardId,
      nextPrompts: ideationBoard.nextPrompts,
      history: ideationBoard.history,
      lastAtlasResponse: ideationBoard.lastAtlasResponse,
      imageAttachments: ideationAttachments.map(attachment => ({ source: attachment.source, mimeType: attachment.mimeType })),
      updatedAt: ideationBoard.updatedAt,
      updatedRelative: formatRelativeDate(ideationBoard.updatedAt),
    },
    gapAnalysis,
    privacy: privacySnapshot,
  };
}

async function buildPrivacySnapshot(atlas: AtlasMindContext): Promise<DashboardPrivacySnapshot> {
  const config = atlas.dataPrivacyManager?.getConfig() ?? defaultDataPrivacyConfig();
  const trustedSet = new Set(config.trustedModelIds);

  // Provider/model tree. Only CONNECTED providers are listed — those the user has
  // actually wired up (credentials / endpoints present). "Connected" here mirrors
  // the sidebar MODELS tree, which uses `isProviderConfigured` for its green-check
  // signal. We deliberately do NOT gate on `isProviderHealthy`: that reflects a live
  // network health probe which can fail for transient/environmental reasons (TLS,
  // timeouts), and a provider can be fully configured yet temporarily unhealthy. Such
  // a provider must still appear here so its models stay manageable as trust targets.
  // A provider that hosts a trusted model is always kept regardless. Children are
  // limited to currently-active (enabled) models, plus any trusted-but-disabled model
  // so it can still be unassigned.
  const providers: DashboardPrivacyProviderNode[] = [];
  const placedTrusted = new Set<string>();
  const catalog = atlas.modelRouter.listProviders();
  const configuredFlags = await Promise.all(
    catalog.map(provider => {
      // `isProviderConfigured('claude-cli')` spawns the Claude CLI twice (--version
      // then auth status). That is far too costly to pay on every dashboard render,
      // so use the already-established, periodically-refreshed health signal for it.
      // Every other provider's configured check is a cheap SecretStorage / config read.
      if (provider.id === 'claude-cli') {
        return Promise.resolve(atlas.modelRouter.isProviderHealthy('claude-cli'));
      }
      return atlas.isProviderConfigured(provider.id).catch(() => false);
    }),
  );
  for (let i = 0; i < catalog.length; i++) {
    const provider = catalog[i];
    const hostsTrusted = provider.models.some(model => trustedSet.has(model.id));
    if (!configuredFlags[i] && !hostsTrusted) {
      continue; // not connected and holds nothing trusted — hide it
    }
    const models: DashboardPrivacyModelNode[] = [];
    for (const model of provider.models) {
      const trusted = trustedSet.has(model.id);
      if (!model.enabled && !trusted) {
        continue; // show only active models (and trusted-but-disabled ones)
      }
      if (trusted) { placedTrusted.add(model.id); }
      models.push({ id: model.id, name: model.name, active: model.enabled, trusted });
    }
    if (models.length === 0) {
      continue;
    }
    models.sort((a, b) => a.name.localeCompare(b.name));
    providers.push({
      id: provider.id,
      name: provider.displayName,
      models,
      trustedCount: models.filter(m => m.trusted).length,
    });
  }
  providers.sort((a, b) => a.name.localeCompare(b.name));

  // Any trusted model no longer present in the catalog: surface under an
  // "Unavailable" group so it remains manageable.
  const orphanTrusted = config.trustedModelIds.filter(id => !placedTrusted.has(id));
  if (orphanTrusted.length > 0) {
    providers.push({
      id: '__unavailable__',
      name: 'Unavailable / removed',
      models: orphanTrusted.map(id => ({ id, name: id, active: false, trusted: true })),
      trustedCount: orphanTrusted.length,
    });
  }

  // Trusted-provider data governance (GDPR / data-management links).
  const trustedProviderIds = new Set<string>();
  for (const id of config.trustedModelIds) {
    const providerId = atlas.modelRouter.getModelInfo(id)?.provider ?? (id.includes('/') ? id.split('/')[0] : undefined);
    if (providerId) { trustedProviderIds.add(providerId); }
  }
  const providerNameById = new Map(atlas.modelRouter.listProviders().map(p => [p.id, p.displayName]));
  const governance: DashboardPrivacyGovernanceNode[] = [...trustedProviderIds]
    .sort()
    .map(providerId => ({
      providerId,
      providerName: providerNameById.get(providerId) ?? providerId,
      ...getProviderDataGovernance(providerId),
    }));

  return {
    enabled: config.enabled,
    rules: config.rules,
    compliancePacks: config.compliancePacks,
    trustedModelIds: config.trustedModelIds,
    providers,
    packs: COMPLIANCE_PACKS.map(pack => ({
      id: pack.id,
      label: pack.label,
      description: pack.description,
      detectorCount: pack.detectors.length,
    })),
    activity: aggregatePrivacyActivity(atlas.dataPrivacyManager?.getActivity() ?? []),
    governance,
  };
}

function aggregatePrivacyActivity(events: readonly DataPrivacyActivityEvent[]): DashboardPrivacySnapshot['activity'] {
  const SENSITIVITY_RANK: Record<DataPrivacySensitivity, number> = { confidential: 0, proprietary: 1, secret: 2 };
  const bySourceMap = new Map<string, { label: string; count: number; sensitivity: DataPrivacySensitivity }>();
  let redactedCount = 0;
  for (const event of events) {
    if (!event.trusted) { redactedCount += 1; }
    const existing = bySourceMap.get(event.label);
    if (existing) {
      existing.count += 1;
      if (SENSITIVITY_RANK[event.sensitivity] > SENSITIVITY_RANK[existing.sensitivity]) {
        existing.sensitivity = event.sensitivity;
      }
    } else {
      bySourceMap.set(event.label, { label: event.label, count: 1, sensitivity: event.sensitivity });
    }
  }
  const bySource = [...bySourceMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map(entry => ({ label: entry.label, count: entry.count, sensitivity: entry.sensitivity }));

  // 90-day series so the dashboard timescale switch (7/30/90) has data to slice.
  const byDay: DashboardSeriesPoint[] = [];
  const dayCounts = new Map<string, number>();
  for (const event of events) {
    const key = new Date(event.ts).toISOString().slice(0, 10);
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
  }
  const today = new Date();
  for (let i = SERIES_DAY_RANGE - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    byDay.push({ date: iso, label: iso.slice(5), value: dayCounts.get(iso) ?? 0 });
  }

  return { total: events.length, redactedCount, bySource, byDay };
}

function summarizeRuntimeTdd(runs: Array<{ subTaskArtifacts: Array<{ tddStatus?: 'verified' | 'blocked' | 'missing' | 'not-applicable' }> }>): DashboardTddSummary {
  let verified = 0;
  let blocked = 0;
  let missing = 0;
  let notApplicable = 0;

  for (const run of runs) {
    for (const artifact of run.subTaskArtifacts) {
      switch (artifact.tddStatus) {
        case 'verified':
          verified += 1;
          break;
        case 'blocked':
          blocked += 1;
          break;
        case 'missing':
          missing += 1;
          break;
        case 'not-applicable':
          notApplicable += 1;
          break;
        default:
          break;
      }
    }
  }

  const evaluatedSubtasks = verified + blocked + missing + notApplicable;
  if (evaluatedSubtasks === 0) {
    return {
      summary: 'No TDD telemetry yet',
      detail: 'Recent project runs have not recorded any per-subtask TDD telemetry yet.',
      tone: 'neutral',
      verified,
      blocked,
      missing,
      notApplicable,
      evaluatedSubtasks,
    };
  }

  if (blocked > 0) {
    return {
      summary: `${blocked} blocked by TDD gate`,
      detail: `${verified} verified, ${blocked} blocked, ${missing} missing evidence, ${notApplicable} not applicable across ${evaluatedSubtasks} tracked subtasks.`,
      tone: 'critical',
      verified,
      blocked,
      missing,
      notApplicable,
      evaluatedSubtasks,
    };
  }

  if (missing > 0) {
    return {
      summary: `${missing} missing TDD evidence`,
      detail: `${verified} verified, ${missing} missing evidence, ${notApplicable} not applicable across ${evaluatedSubtasks} tracked subtasks.`,
      tone: 'warn',
      verified,
      blocked,
      missing,
      notApplicable,
      evaluatedSubtasks,
    };
  }

  return {
    summary: `${verified} verified TDD subtasks`,
    detail: `${verified} verified and ${notApplicable} not applicable across ${evaluatedSubtasks} tracked subtasks.`,
    tone: 'good',
    verified,
    blocked,
    missing,
    notApplicable,
    evaluatedSubtasks,
  };
}

function summarizeRunTdd(artifacts: Array<{ tddStatus?: 'verified' | 'blocked' | 'missing' | 'not-applicable' }>): Pick<DashboardTddSummary, 'summary' | 'tone'> {
  const summary = summarizeRuntimeTdd([{ subTaskArtifacts: artifacts }]);
  return { summary: summary.summary, tone: summary.tone };
}

async function collectGitSnapshot(workspaceRoot: string | undefined): Promise<GitSnapshot> {
  if (!workspaceRoot) {
    return emptyGitSnapshot();
  }

  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: workspaceRoot, windowsHide: true });
  } catch {
    return emptyGitSnapshot();
  }

  const [statusOutput, branchOutput, commitOutput] = await Promise.all([
    runGit(workspaceRoot, ['status', '--short', '--branch']),
    runGit(workspaceRoot, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)|%(committerdate:iso8601)|%(upstream:short)|%(subject)', 'refs/heads']),
    runGit(workspaceRoot, ['log', '--date=iso-strict', '--pretty=format:%H|%ad|%an|%s', `-n${MAX_COMMITS}`]),
  ]);

  const statusLines = statusOutput.split(/\r?\n/).filter(Boolean);
  const branchLine = statusLines[0] ?? '';
  const currentBranch = parseCurrentBranch(branchLine);
  const { ahead, behind } = await collectAheadBehind(workspaceRoot);
  const staged = statusLines.slice(1).filter(line => line.length >= 1 && line[0] !== ' ' && line[0] !== '?').length;
  const modified = statusLines.slice(1).filter(line => line.length >= 2 && line[1] !== ' ' && line[0] !== '?').length;
  const untracked = statusLines.slice(1).filter(line => line.startsWith('??')).length;
  const dirty = staged + modified + untracked > 0;

  const branches = branchOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, MAX_BRANCHES)
    .map(line => {
      const [name = '', lastCommitAt = '', upstream = '', subject = ''] = line.split('|');
      return {
        name,
        lastCommitAt,
        lastCommitRelative: formatRelativeDate(lastCommitAt),
        subject,
        upstream: upstream || undefined,
        current: name === currentBranch,
      } satisfies DashboardBranch;
    });

  const commits = commitOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [hash = '', committedAt = '', author = '', ...subjectParts] = line.split('|');
      const subject = subjectParts.join('|');
      return {
        hash,
        shortHash: hash.slice(0, 7),
        subject,
        author,
        committedAt,
        committedRelative: formatRelativeDate(committedAt),
      } satisfies DashboardCommit;
    });

  // One log call carries both halves of the timeline: the day (for the activity
  // chart) and the author (for the per-person breakdown). Author *names* only —
  // the same field the commit list already shows; no addresses are read.
  const commitLog = (await runGit(workspaceRoot, ['log', `--since=${SERIES_DAY_RANGE} days ago`, '--date=short', '--pretty=format:%ad|%an']))
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const separator = line.indexOf('|');
      return separator < 0
        ? { date: line.trim(), author: '' }
        : { date: line.slice(0, separator).trim(), author: line.slice(separator + 1).trim() };
    })
    .filter(entry => entry.date.length > 0);
  const commitDates = commitLog.map(entry => entry.date);

  return {
    currentBranch,
    ahead,
    behind,
    staged,
    modified,
    untracked,
    dirty,
    branches,
    commits,
    commitDates,
    commitLog,
  };
}

async function collectAheadBehind(workspaceRoot: string): Promise<{ ahead: number; behind: number }> {
  try {
    const upstream = await runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    if (upstream.trim().length === 0) {
      return { ahead: 0, behind: 0 };
    }
    const output = await runGit(workspaceRoot, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
    const [aheadText = '0', behindText = '0'] = output.trim().split(/\s+/);
    return {
      ahead: Number(aheadText) || 0,
      behind: Number(behindText) || 0,
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

async function collectPackageSnapshot(workspaceRoot: string | undefined): Promise<PackageSnapshot> {
  if (!workspaceRoot) {
    return {
      version: 'N/A',
      dependencyCount: 0,
      devDependencyCount: 0,
      scriptCount: 0,
      keyScripts: [],
    };
  }

  const packagePath = path.join(workspaceRoot, 'package.json');
  try {
    const raw = await fs.readFile(packagePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const dependencies = asStringMap(parsed['dependencies']);
    const devDependencies = asStringMap(parsed['devDependencies']);
    const scripts = asStringMap(parsed['scripts']);
    const keyScripts = ['compile', 'watch', 'lint', 'test', 'test:coverage', 'package:vsix', 'publish:pre-release']
      .filter(script => typeof scripts[script] === 'string');
    return {
      version: typeof parsed['version'] === 'string' ? parsed['version'] : 'N/A',
      dependencyCount: Object.keys(dependencies).length,
      devDependencyCount: Object.keys(devDependencies).length,
      scriptCount: Object.keys(scripts).length,
      keyScripts,
    };
  } catch {
    return {
      version: 'N/A',
      dependencyCount: 0,
      devDependencyCount: 0,
      scriptCount: 0,
      keyScripts: [],
    };
  }
}

async function collectVersionSnapshot(
  workspaceRoot: string | undefined,
  currentBranch: string,
  currentVersion: string,
): Promise<DashboardVersionSnapshot> {
  const current: DashboardVersionEntry = {
    branch: normalizeBranchRef(currentBranch),
    version: currentVersion,
    isProduction: isProductionBranchRef(currentBranch),
  };

  if (!workspaceRoot || currentBranch === 'Not a git repository') {
    return { current };
  }

  const productionRef = await detectProductionBranchRef(workspaceRoot, currentBranch);
  if (!productionRef || normalizeBranchRef(productionRef) === normalizeBranchRef(currentBranch)) {
    return { current };
  }

  // Read from the freshest ref (prefers `origin/<branch>`) so the production
  // card reflects the released version, not a stale local release branch.
  const productionVersion = await readDeployedVersionForBranch(workspaceRoot, productionRef);
  if (!productionVersion || productionVersion === 'N/A') {
    return { current };
  }

  return {
    current,
    production: {
      branch: normalizeBranchRef(productionRef),
      version: productionVersion,
      isProduction: true,
    },
  };
}

async function detectProductionBranchRef(workspaceRoot: string, currentBranch: string): Promise<string | undefined> {
  if (isProductionBranchRef(currentBranch)) {
    return currentBranch;
  }

  try {
    const refs = (await runGit(workspaceRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin']))
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.endsWith('/HEAD'));

    for (const candidate of PRODUCTION_BRANCH_CANDIDATES) {
      if (refs.includes(candidate)) {
        return candidate;
      }
    }

    for (const candidate of PRODUCTION_BRANCH_CANDIDATES) {
      const remoteCandidate = `origin/${candidate}`;
      if (refs.includes(remoteCandidate)) {
        return remoteCandidate;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function readPackageVersionFromGitRef(workspaceRoot: string, ref: string): Promise<string | undefined> {
  try {
    const raw = await runGit(workspaceRoot, ['show', `${ref}:package.json`]);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed['version'] === 'string' ? parsed['version'] : undefined;
  } catch {
    return undefined;
  }
}

/** True when the given branch/tag/ref resolves to a commit in the repository. */
async function gitRefExists(workspaceRoot: string, ref: string): Promise<boolean> {
  try {
    await runGit(workspaceRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Choose which git ref to read a stage's *deployed* package version from, given
 * a probe for which refs exist.
 *
 * A stage branch like `master` models the released product, which lives on the
 * remote. A developer typically works on `develop` and never checks out or
 * pulls `master` locally (releases land via PR merges they never fetch into the
 * local branch), so the local `master` ref is frequently stale and reading
 * `git show master:package.json` reports an old version. Prefer the
 * remote-tracking ref `origin/<branch>` when it exists — that is the deployed
 * truth — and fall back to the local ref (e.g. an offline/local-only repo with
 * no remote). Pure so the preference order is unit-testable without git.
 */
export function chooseDeployedVersionRef(branchRef: string, refExists: (ref: string) => boolean): string | undefined {
  const trimmed = branchRef.trim();
  if (!trimmed) {
    return undefined;
  }
  // An explicit remote ref: use it, else its local short name.
  if (trimmed.startsWith('origin/')) {
    if (refExists(trimmed)) {
      return trimmed;
    }
    const local = normalizeBranchRef(trimmed);
    return refExists(local) ? local : undefined;
  }
  const remoteRef = `origin/${normalizeBranchRef(trimmed)}`;
  if (refExists(remoteRef)) {
    return remoteRef;
  }
  return refExists(trimmed) ? trimmed : undefined;
}

/** Resolve the freshest existing ref for a stage branch (prefers `origin/<branch>`). */
async function resolveDeployedVersionRef(workspaceRoot: string, branchRef: string): Promise<string | undefined> {
  const normalized = normalizeBranchRef(branchRef.trim());
  const candidates = branchRef.trim().startsWith('origin/')
    ? [branchRef.trim(), normalized]
    : [`origin/${normalized}`, branchRef.trim()];
  const existing = new Set<string>();
  await Promise.all(candidates.map(async ref => {
    if (ref && await gitRefExists(workspaceRoot, ref)) {
      existing.add(ref);
    }
  }));
  return chooseDeployedVersionRef(branchRef, ref => existing.has(ref));
}

/** Read the deployed package version for a stage branch from its freshest ref. */
async function readDeployedVersionForBranch(workspaceRoot: string, branchRef: string): Promise<string | undefined> {
  const ref = await resolveDeployedVersionRef(workspaceRoot, branchRef);
  return ref ? readPackageVersionFromGitRef(workspaceRoot, ref) : undefined;
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/** Top-level file names in a directory (empty on error). */
async function listDirFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name);
  } catch {
    return [];
  }
}

/** Extract the branch filter for a workflow trigger (`pull_request` / `push`). */
function extractTriggerBranches(content: string, trigger: string): string[] | 'all' | null {
  // Inline form: `on: [push, pull_request]` → gates all branches.
  const inline = content.match(/^on:\s*\[([^\]]*)\]/m);
  if (inline) {
    return inline[1].split(',').map(part => part.trim()).includes(trigger) ? 'all' : null;
  }
  if (new RegExp(`^on:\\s*${trigger}\\s*$`, 'm').test(content)) {
    return 'all';
  }
  const lines = content.split(/\r?\n/);
  const triggerIdx = lines.findIndex(line => new RegExp(`^\\s{1,6}${trigger}:\\s*$`).test(line));
  if (triggerIdx < 0) {
    return null;
  }
  const baseIndent = lines[triggerIdx].match(/^(\s*)/)?.[1].length ?? 0;
  for (let j = triggerIdx + 1; j < lines.length; j++) {
    if (lines[j].trim() === '') { continue; }
    const indent = lines[j].match(/^(\s*)/)?.[1].length ?? 0;
    if (indent <= baseIndent) { break; }
    const branchesMatch = lines[j].match(/^\s*branches:\s*(.*)$/);
    if (branchesMatch) {
      const rest = branchesMatch[1].trim();
      if (rest.startsWith('[')) {
        return rest.replace(/[[\]]/g, '').split(',').map(part => part.trim().replace(/['"]/g, '')).filter(Boolean);
      }
      const branches: string[] = [];
      for (let k = j + 1; k < lines.length; k++) {
        const item = lines[k].match(/^\s*-\s*(.+)$/);
        if (!item) { break; }
        branches.push(item[1].trim().replace(/['"]/g, ''));
      }
      return branches.length > 0 ? branches : 'all';
    }
  }
  return 'all';
}

/**
 * Parse `.github/workflows/*.yml` to determine which workflows gate a branch and
 * whether any do so on `pull_request` (implying PR-based promotion). Returns the
 * gating workflow names and a viaPr flag.
 */
async function detectBranchCiGating(workspaceRoot: string, branch: string): Promise<{ viaPr: boolean; checks: string[] }> {
  const dir = path.join(workspaceRoot, '.github', 'workflows');
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter(name => /\.ya?ml$/i.test(name));
  } catch {
    return { viaPr: false, checks: [] };
  }
  const target = normalizeBranchRef(branch).toLowerCase();
  const matches = (sel: string[] | 'all' | null): boolean =>
    sel === 'all' || (Array.isArray(sel) && sel.map(b => normalizeBranchRef(b).toLowerCase()).includes(target));
  const checks = new Set<string>();
  let viaPr = false;
  for (const file of files) {
    let content = '';
    try {
      content = await fs.readFile(path.join(dir, file), 'utf-8');
    } catch {
      continue;
    }
    const name = (content.match(/^name:\s*(.+)$/m)?.[1] ?? file.replace(/\.ya?ml$/i, '')).trim();
    const pr = extractTriggerBranches(content, 'pull_request');
    const push = extractTriggerBranches(content, 'push');
    if (matches(pr)) { viaPr = true; checks.add(name); }
    else if (matches(push)) { checks.add(name); }
  }
  return { viaPr, checks: [...checks].sort() };
}

/** Find a `workflow_dispatch` deploy/release/promote workflow file, if any. */
async function detectDispatchWorkflow(workspaceRoot: string): Promise<string | undefined> {
  const dir = path.join(workspaceRoot, '.github', 'workflows');
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter(name => /\.ya?ml$/i.test(name));
  } catch {
    return undefined;
  }
  for (const file of files) {
    let content = '';
    try {
      content = await fs.readFile(path.join(dir, file), 'utf-8');
    } catch {
      continue;
    }
    if (!/workflow_dispatch/.test(content)) {
      continue;
    }
    const name = (content.match(/^name:\s*(.+)$/m)?.[1] ?? '').toLowerCase();
    if (/(deploy|release|promote|publish|ship)/.test(name) || /(deploy|release|promote|publish|ship)/i.test(file)) {
      return file;
    }
  }
  return undefined;
}

/**
 * Run a `gh` command (best-effort; short timeout, never used on the render path).
 *
 * Delegates to {@link runGhOrThrow} so every `gh` invocation in AtlasMind shares
 * one implementation — one answer to "is this escaped?", one timeout policy, one
 * failure taxonomy. The throwing shape is kept because this function's callers
 * are written around try/catch.
 */
async function runGh(workspaceRoot: string, args: string[]): Promise<string> {
  return runGhOrThrow(workspaceRoot, args);
}

/** Best-effort GitHub branch-protection import: exact required-check contexts + PR requirement. */
async function fetchBranchProtection(
  workspaceRoot: string,
  slug: string,
  branch: string,
): Promise<{ requiresPr: boolean; contexts: string[] } | undefined> {
  try {
    const raw = await runGh(workspaceRoot, ['api', `repos/${slug}/branches/${normalizeBranchRef(branch)}/protection`]);
    const parsed = JSON.parse(raw) as {
      required_status_checks?: { contexts?: string[]; checks?: Array<{ context?: string }> };
      required_pull_request_reviews?: unknown;
    };
    const contexts = parsed.required_status_checks?.contexts
      ?? parsed.required_status_checks?.checks?.map(check => check.context ?? '').filter(Boolean)
      ?? [];
    return { requiresPr: Boolean(parsed.required_pull_request_reviews), contexts };
  } catch {
    return undefined;
  }
}

/**
 * Resolve live CI status (per check-run name) for a branch's head commit via
 * `gh`, so required status checks can be *verified* rather than self-attested.
 * Best-effort: returns undefined when gh is unavailable or the repo is not on
 * GitHub. Worst state per name wins (fail > pending > pass).
 */
/**
 * Recent CI runs, and a classified report for whichever failed most recently.
 *
 * Fetched on explicit request only. `gh run view --log-failed` downloads a log,
 * which is slow and rate-limited — a page that did it on every render would
 * spend the user's quota to show a tab they may not be looking at.
 *
 * The log never reaches a surface unsanitized: `buildCiFailureReport` strips
 * ANSI, redacts secrets, caps the size and marks truncation. Classification is
 * a rule table with no model in it, so the same log always produces the same
 * class and the taxonomy can be charted over time.
 */
async function gatherCiIntelligence(
  workspaceRoot: string,
  branch: string,
): Promise<DashboardCiIntelligence> {
  const runs = await runGh(workspaceRoot, [
    'run', 'list',
    '--branch', branch,
    '--limit', '30',
    '--json', 'databaseId,displayTitle,conclusion,status,workflowName,createdAt,updatedAt,headSha',
  ]);

  const parsed = parseGhRunList(runs);
  if (parsed.length === 0) {
    return { runs: [], loadedAt: new Date().toISOString() };
  }

  // Only the most recent failure is analysed. Fetching a log per failed run
  // would multiply a slow call by thirty for information nobody asked for.
  const failed = parsed.find(run => run.conclusion === 'failure');
  if (!failed) {
    return { runs: parsed, loadedAt: new Date().toISOString() };
  }

  try {
    const log = await runGhOrThrow(
      workspaceRoot,
      ['run', 'view', String(failed.databaseId), '--log-failed'],
      // A log is a download, not a status query; the read-only default of eight
      // seconds is not enough.
      { timeoutMs: 45_000, maxBufferBytes: 8 * 1024 * 1024 },
    );
    // Attempts on the same commit decide flakiness — a property of history that
    // no single log can establish.
    const attempts = parsed
      .filter(run => run.headSha === failed.headSha && run.workflowName === failed.workflowName)
      .map(run => ({ conclusion: run.conclusion }));

    return {
      runs: parsed,
      report: buildCiFailureReport({
        runId: String(failed.databaseId),
        jobName: failed.workflowName || failed.displayTitle,
        log,
        attempts,
      }),
      loadedAt: new Date().toISOString(),
    };
  } catch (error) {
    // A log we could not read is reported as such. "No failure detail" and
    // "the build is fine" are different facts.
    return {
      runs: parsed,
      logFailure: ghFailureOf(error).detail,
      loadedAt: new Date().toISOString(),
    };
  }
}

/** Parse `gh run list --json …`. Never throws; a bad entry is dropped. */
export function parseGhRunList(raw: string): DashboardCiRun[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const out: DashboardCiRun[] = [];
  for (const entry of parsed.slice(0, 100)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record['databaseId'];
    if (typeof id !== 'number' || !Number.isFinite(id)) {
      continue;
    }
    const text = (value: unknown, max: number): string =>
      typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '';
    out.push({
      databaseId: id,
      workflowName: text(record['workflowName'], 120),
      displayTitle: text(record['displayTitle'], 200),
      conclusion: text(record['conclusion'], 40).toLowerCase(),
      status: text(record['status'], 40).toLowerCase(),
      headSha: text(record['headSha'], 64),
      createdAt: text(record['createdAt'], 40),
      updatedAt: text(record['updatedAt'], 40),
    });
  }
  return out;
}

async function gatherLiveCiStatus(workspaceRoot: string, sourceRef: string): Promise<Record<string, 'pass' | 'fail' | 'pending'> | undefined> {
  const ref = normalizeBranchRef(sourceRef);
  if (!ref || ref === 'Not a git repository' || ref === 'Detached') {
    return undefined;
  }
  let slug: string | undefined;
  try {
    slug = (await runGh(workspaceRoot, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])) || undefined;
  } catch {
    return undefined;
  }
  if (!slug) {
    return undefined;
  }
  try {
    const raw = await runGh(workspaceRoot, ['api', `repos/${slug}/commits/${ref}/check-runs`, '--jq', '.check_runs']);
    const runs = JSON.parse(raw) as Array<{ name?: string; status?: string; conclusion?: string | null }>;
    const rank = { pass: 0, pending: 1, fail: 2 } as const;
    const map: Record<string, 'pass' | 'fail' | 'pending'> = {};
    for (const run of runs) {
      const name = (run.name ?? '').trim();
      if (!name) { continue; }
      const state: 'pass' | 'fail' | 'pending' = run.status !== 'completed'
        ? 'pending'
        : (run.conclusion === 'success' || run.conclusion === 'neutral' || run.conclusion === 'skipped') ? 'pass' : 'fail';
      const prev = map[name];
      if (!prev || rank[state] > rank[prev]) { map[name] = state; }
    }
    return map;
  } catch {
    return undefined;
  }
}

/**
 * Import the repository's actual delivery signals so the seeded pipeline reflects
 * the protocol already in place rather than a generic template: branch layout,
 * project archetype, database presence, publish target, env files, package
 * scripts, CI, the PR/CI promotion protocol, and any existing routine to bind to
 * a promotion path.
 */
async function detectDeliverySignals(
  atlas: AtlasMindContext,
  workspaceRoot: string,
  currentBranch: string,
): Promise<DeliverySeedInput> {
  const productionRef = await detectProductionBranchRef(workspaceRoot, currentBranch);
  const developExists = await gitRefExists(workspaceRoot, 'develop');

  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(await fs.readFile(path.join(workspaceRoot, 'package.json'), 'utf-8')) as Record<string, unknown>;
  } catch {
    pkg = {};
  }
  const deps = { ...(pkg['dependencies'] as Record<string, string> | undefined), ...(pkg['devDependencies'] as Record<string, string> | undefined) };
  const depNames = Object.keys(deps);
  const scriptsObj = (pkg['scripts'] as Record<string, string> | undefined) ?? {};
  const engines = pkg['engines'] as Record<string, unknown> | undefined;

  // ── Polyglot manifests + PaaS/IaC signals ───────────────────────
  const hasFile = (rel: string): Promise<boolean> => pathExists(path.join(workspaceRoot, rel));
  const readSafe = async (rel: string): Promise<string> => {
    try { return await fs.readFile(path.join(workspaceRoot, rel), 'utf-8'); } catch { return ''; }
  };
  const topFiles = await listDirFiles(workspaceRoot);
  const [hasPyproject, hasRequirements, hasGoMod, hasCargo, hasPom, hasGradle, hasDockerfile, hasCompose] = await Promise.all([
    hasFile('pyproject.toml'), hasFile('requirements.txt'), hasFile('go.mod'), hasFile('Cargo.toml'),
    hasFile('pom.xml'), hasFile('build.gradle'), hasFile('Dockerfile'), hasFile('docker-compose.yml'),
  ]);
  const hasCsproj = topFiles.some(name => /\.(csproj|sln)$/i.test(name));
  const ecosystem: 'node' | 'python' | 'go' | 'rust' | 'java' | 'dotnet' | 'unknown' =
    Object.keys(pkg).length > 0 ? 'node'
      : (hasPyproject || hasRequirements) ? 'python'
        : hasGoMod ? 'go'
          : hasCargo ? 'rust'
            : (hasPom || hasGradle) ? 'java'
              : hasCsproj ? 'dotnet'
                : 'unknown';
  const manifestText = (await Promise.all([
    readSafe('requirements.txt'), readSafe('pyproject.toml'), readSafe('go.mod'),
    readSafe('Cargo.toml'), readSafe('pom.xml'), readSafe('build.gradle'),
  ])).join('\n').toLowerCase();
  const composeText = `${(await readSafe('docker-compose.yml'))}${await readSafe('docker-compose.yaml')}`.toLowerCase();

  // PaaS / IaC hosting + a derivable production URL where possible.
  const flyToml = await readSafe('fly.toml');
  let productionUrl: string | undefined;
  const flyApp = flyToml.match(/^\s*app\s*=\s*["']?([a-z0-9-]+)/mi)?.[1];
  if (flyApp) { productionUrl = `https://${flyApp}.fly.dev`; }
  const paas =
    flyToml ? 'Fly.io'
      : (await hasFile('vercel.json')) ? 'Vercel'
        : (await hasFile('netlify.toml')) ? 'Netlify'
          : (await hasFile('render.yaml')) ? 'Render'
            : (await hasFile('app.yaml')) ? 'Google App Engine'
              : (await hasFile('serverless.yml')) || (await hasFile('serverless.yaml')) ? 'Serverless'
                : undefined;
  const hasK8s = (await hasFile('kustomization.yaml')) || (await hasFile('k8s')) || (await hasFile('manifests'));
  const hasTerraform = topFiles.some(name => /\.tf$/i.test(name));

  // Archetype (Node signals + polyglot frameworks).
  const isVscodeExt = Boolean(engines?.['vscode'] || pkg['contributes'] || depNames.includes('@vscode/vsce') || depNames.includes('@types/vscode'));
  const nodeServerDeps = ['express', 'fastify', 'koa', '@nestjs/core', 'next', 'nuxt', '@hapi/hapi', 'hono', 'apollo-server'];
  const webFrameworkRe = /(django|flask|fastapi|starlette|uvicorn|gunicorn|gin-gonic|labstack\/echo|gofiber|axum|actix-web|rocket|spring-boot|quarkus|micronaut|aspnetcore)/;
  const hasServer = nodeServerDeps.some(dep => depNames.includes(dep)) || Boolean(scriptsObj['start'])
    || hasDockerfile || hasCompose || Boolean(paas) || hasK8s || webFrameworkRe.test(manifestText);
  let archetype: DeliveryArchetype = 'generic';
  if (isVscodeExt) { archetype = 'vscode-extension'; }
  else if (hasServer) { archetype = 'web-service'; }
  else if (pkg['main'] || pkg['exports'] || pkg['module'] || hasPyproject || hasCargo || hasPom) { archetype = 'library'; }

  // Database (Node deps + polyglot ORMs + compose services + migration dirs).
  const dbRe = /^(pg|mysql2?|mongodb|mongoose|prisma|@prisma\/client|sqlite3|better-sqlite3|redis|ioredis|drizzle-orm|sequelize|typeorm|knex)$/;
  const dbManifestRe = /(psycopg|sqlalchemy|asyncpg|pymongo|gorm|sqlx|diesel|hibernate|spring-data|entityframework|npgsql)/;
  const dbComposeRe = /image:\s*["']?(postgres|mysql|mariadb|mongo|redis|cockroach)/;
  const hasDatabase = depNames.some(dep => dbRe.test(dep))
    || dbManifestRe.test(manifestText)
    || dbComposeRe.test(composeText)
    || await hasFile('migrations')
    || await hasFile('prisma')
    || await hasFile('alembic');

  // Publish target.
  const publishScripts = `${scriptsObj['publish:release'] ?? ''} ${scriptsObj['publish'] ?? ''} ${scriptsObj['deploy'] ?? ''}`;
  let publishTarget: string | undefined;
  if (isVscodeExt || depNames.includes('@vscode/vsce') || /vsce/.test(publishScripts)) { publishTarget = 'VS Code Marketplace'; }
  else if (paas) { publishTarget = paas; }
  else if (hasK8s) { publishTarget = 'Kubernetes'; }
  else if (hasDockerfile || hasCompose) { publishTarget = 'Container registry'; }
  else if (hasTerraform) { publishTarget = 'Terraform-managed infrastructure'; }
  else if (scriptsObj['publish'] && pkg['private'] !== true) { publishTarget = 'npm registry'; }
  else if (ecosystem === 'python' && /(hatchling|setuptools|poetry|twine|flit)/.test(manifestText)) { publishTarget = 'PyPI'; }
  else if (ecosystem === 'rust') { publishTarget = 'crates.io'; }

  // Env files.
  const envFiles: { local?: string; staging?: string; production?: string } = {};
  if (await pathExists(path.join(workspaceRoot, '.env.local'))) { envFiles.local = '.env.local'; }
  else if (await pathExists(path.join(workspaceRoot, '.env.development'))) { envFiles.local = '.env.development'; }
  if (await pathExists(path.join(workspaceRoot, '.env.staging'))) { envFiles.staging = '.env.staging'; }
  if (await pathExists(path.join(workspaceRoot, '.env.production'))) { envFiles.production = '.env.production'; }

  // Scripts: Node from package scripts; otherwise ecosystem conventions.
  const scripts = ecosystem === 'node'
    ? { build: Boolean(scriptsObj['compile'] || scriptsObj['build']), lint: Boolean(scriptsObj['lint']), test: Boolean(scriptsObj['test']) }
    : ecosystem === 'python' ? { build: false, lint: /(ruff|flake8|pylint|black)/.test(manifestText), test: true }
      : ecosystem === 'go' ? { build: true, lint: /golangci/.test(manifestText), test: true }
        : ecosystem === 'rust' ? { build: true, lint: true, test: true }
          : ecosystem === 'java' ? { build: true, lint: false, test: true }
            : ecosystem === 'dotnet' ? { build: true, lint: false, test: true }
              : { build: false, lint: false, test: false };
  const hasCi = (await collectWorkflowSnapshot(workspaceRoot)).length > 0;

  // Bind an existing routine to the production path (publish/release/ship/deploy
  // or the default routine), and a staging/integration routine when present.
  let productionRoutineId: string | undefined;
  let stagingRoutineId: string | undefined;
  try {
    await atlas.routineRegistry.reload(workspaceRoot);
    const routines = atlas.routineRegistry.list();
    const prod = routines.find(routine => /publish|release|ship|deploy|promote.*prod/i.test(`${routine.id} ${routine.name}`))
      ?? routines.find(routine => routine.default);
    productionRoutineId = prod?.id;
    stagingRoutineId = routines.find(routine => /stag|integrat/i.test(`${routine.id} ${routine.name}`))?.id;
  } catch {
    // No routines — leave promotion paths unbound (accurate).
  }

  // ── PR / CI promotion protocol ──────────────────────────────────
  const prodShort = productionRef ? normalizeBranchRef(productionRef) : 'main';
  const stagingShort = developExists ? 'develop' : normalizeBranchRef(currentBranch);

  const prodGating = await detectBranchCiGating(workspaceRoot, prodShort);
  const stagingGating = await detectBranchCiGating(workspaceRoot, stagingShort);

  // Best-effort enrichment from GitHub branch protection (exact check contexts +
  // PR requirement). Graceful fallback to local signals if gh is unavailable.
  let repoSlug: string | undefined;
  try {
    repoSlug = (await runGh(workspaceRoot, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])) || undefined;
  } catch {
    repoSlug = undefined;
  }
  const prodProtection = repoSlug ? await fetchBranchProtection(workspaceRoot, repoSlug, prodShort) : undefined;
  const stagingProtection = repoSlug ? await fetchBranchProtection(workspaceRoot, repoSlug, stagingShort) : undefined;

  // A bound production routine that opens a PR also signals PR-based promotion.
  let routineOpensPr = false;
  if (productionRoutineId) {
    const routine = atlas.routineRegistry.get(productionRoutineId);
    routineOpensPr = Boolean(routine?.steps.some(step =>
      /gh\s+pr\s+create/i.test(step.run) && new RegExp(`--base\\s+(${prodShort}|master|main)`).test(step.run)));
  }

  // "Via PR" means PRs are *required* — sourced authoritatively from branch
  // protection when gh is available, else from a routine that opens a PR. CI
  // merely having a pull_request trigger is NOT treated as "PR required" (a
  // branch can accept direct pushes yet still run CI on PRs, like `develop`).
  const productionViaPr = prodProtection ? (prodProtection.requiresPr || routineOpensPr) : routineOpensPr;
  const productionChecks = (prodProtection?.contexts.length ? prodProtection.contexts : prodGating.checks);
  const stagingViaPr = stagingProtection ? stagingProtection.requiresPr : false;
  const stagingChecks = (stagingProtection?.contexts.length ? stagingProtection.contexts : stagingGating.checks);

  // Trigger-CD: when there's no bound production routine, a dispatchable
  // deploy/release workflow becomes the promote mechanism (CD, not laptop).
  const dispatchFile = productionRoutineId ? undefined : await detectDispatchWorkflow(workspaceRoot);

  return {
    currentBranch,
    productionBranch: productionRef ?? undefined,
    developBranch: developExists ? 'develop' : undefined,
    archetype,
    hasDatabase,
    publishTarget,
    productionUrl,
    envFiles,
    scripts,
    hasCi,
    productionRoutineId,
    stagingRoutineId,
    viaPullRequest: { staging: stagingViaPr, production: productionViaPr },
    statusChecks: { staging: stagingChecks, production: productionChecks },
    dispatchWorkflow: dispatchFile ? { production: dispatchFile } : undefined,
  };
}

/** The git actor's email (for separation-of-duties comparison against authors). */
async function resolveGitActorEmail(workspaceRoot: string): Promise<string | undefined> {
  try {
    return (await runGit(workspaceRoot, ['config', 'user.email'])).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Email of the head-commit author for a branch (defaults to HEAD), for SoD. */
async function resolveLastCommitAuthor(workspaceRoot: string, ref?: string): Promise<string | undefined> {
  const target = ref ? normalizeBranchRef(ref) : 'HEAD';
  try {
    return (await runGit(workspaceRoot, ['log', '-1', '--format=%ae', target])).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** The git identity that ran an action (`Name <email>`), for the audit log. */
async function resolveGitActor(workspaceRoot: string): Promise<string | undefined> {
  try {
    const name = (await runGit(workspaceRoot, ['config', 'user.name'])).trim();
    let email = '';
    try { email = (await runGit(workspaceRoot, ['config', 'user.email'])).trim(); } catch { email = ''; }
    if (!name && !email) { return undefined; }
    return email ? `${name} <${email}>`.trim() : name;
  } catch {
    return undefined;
  }
}

/**
 * Gather the live facts a promotion plan's preflight checks depend on: the
 * source/target package versions, whether the working tree is clean, and
 * whether CHANGELOG.md references the source version.
 */
async function gatherPromotionFacts(
  workspaceRoot: string,
  from: DeploymentStage,
  to: DeploymentStage,
): Promise<{ fromVersion: string; toVersion: string; workingTreeClean: boolean; changelogHasFromVersion: boolean }> {
  const fromVersion = (await resolveStageVersion(workspaceRoot, from)) ?? '0.0.0';
  const toVersion = (await resolveStageVersion(workspaceRoot, to)) ?? '0.0.0';
  let workingTreeClean = false;
  try {
    const status = await runGit(workspaceRoot, ['status', '--porcelain']);
    workingTreeClean = status.trim().length === 0;
  } catch {
    workingTreeClean = false;
  }
  let changelogHasFromVersion = false;
  try {
    const changelog = await fs.readFile(path.join(workspaceRoot, 'CHANGELOG.md'), 'utf-8');
    changelogHasFromVersion = fromVersion !== '0.0.0' && changelog.includes(fromVersion);
  } catch {
    changelogHasFromVersion = false;
  }
  return { fromVersion, toVersion, workingTreeClean, changelogHasFromVersion };
}

/**
 * Assess the inputs for the "Resolve & run" remediation: the SemVer bump level
 * warranted by the conventional-commit history between the target and the source
 * (feat → minor, breaking → major, else patch), and whether the version/changelog
 * files can be written. Read-only — no edits happen here.
 */
async function assessPromotionRemediation(
  workspaceRoot: string,
  from: DeploymentStage,
  to: DeploymentStage,
): Promise<{ bumpLevel: 'patch' | 'minor' | 'major'; bumpReason: string; canBumpVersion: boolean; canEditChangelog: boolean }> {
  const fromRef = (from.branchRef ?? '').trim() || 'HEAD';
  const toRef = (to.branchRef ?? '').trim();
  let messages: string[] = [];
  let compared = false;
  if (toRef) {
    try {
      const out = await runGit(workspaceRoot, ['log', `${toRef}..${fromRef}`, '--format=%B%x00']);
      messages = out.split('\u0000').map(part => part.trim()).filter(part => part.length > 0);
      compared = true;
    } catch {
      compared = false;
    }
  }
  const bumpLevel = classifyBumpLevel(messages);
  const count = messages.length;
  let bumpReason: string;
  if (!compared) {
    bumpReason = `patch — no branch to compare against ${to.name}; defaulting to patch.`;
  } else if (count === 0) {
    bumpReason = `patch — no new commits ahead of ${to.name}; defaulting to patch.`;
  } else {
    const since = `since ${to.name} (${count} commit${count === 1 ? '' : 's'})`;
    bumpReason = bumpLevel === 'major'
      ? `major — a breaking change ${since}.`
      : bumpLevel === 'minor'
        ? `minor — at least one feature ${since}.`
        : `patch — fixes/chores only ${since}.`;
  }
  let canBumpVersion = false;
  try {
    await fs.access(path.join(workspaceRoot, 'package.json'));
    canBumpVersion = true;
  } catch {
    canBumpVersion = false;
  }
  return { bumpLevel, bumpReason, canBumpVersion, canEditChangelog: true };
}

/**
 * The package version representing a stage: read from its branch's package.json,
 * or — for a stage with no branch (the working tree) — from the live file.
 */
async function resolveStageVersion(workspaceRoot: string, stage: DeploymentStage): Promise<string | undefined> {
  if (stage.branchRef) {
    return readDeployedVersionForBranch(workspaceRoot, stage.branchRef);
  }
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed['version'] === 'string' ? parsed['version'] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Load (and on first open, seed) the deployment-stage pipeline and compute its
 * live status: the package version committed on each stage's branch, whether
 * that branch exists, and the safety reasoning surfaced on each card. Read-only
 * in this phase — no promotion is executed here.
 */
async function collectDeliveryStagePipeline(
  atlas: AtlasMindContext,
  workspaceRoot: string | undefined,
  currentBranch: string,
  workflowNames: string[],
): Promise<DashboardStagePipeline> {
  const noReview: DashboardDeliveryReview = { needsReview: false, reasons: [], reviewedAt: null, reviewedRelative: '' };
  const base: DashboardStagePipeline = {
    configPath: DELIVERY_SSOT_PATH,
    summaryPath: DELIVERY_SUMMARY_SSOT_PATH,
    stages: [],
    paths: [],
    review: noReview,
    config: null,
    history: [],
    seeded: false,
    notInGitRepo: false,
  };
  const manager = atlas.deliveryManager;
  if (!workspaceRoot || !manager) {
    return base;
  }

  const isGit = currentBranch !== 'Not a git repository' && currentBranch !== 'Detached';
  let config = manager.getConfig();
  let seeded = false;
  if (!config) {
    if (!isGit) {
      return { ...base, notInGitRepo: true };
    }
    const signals = await detectDeliverySignals(atlas, workspaceRoot, currentBranch);
    config = await manager.ensureSeeded(signals);
    seeded = true;
  }

  const orderedStages = [...config.stages].sort((left, right) => left.rank - right.rank);
  const stageViews = await Promise.all(
    orderedStages.map(stage => buildStageView(workspaceRoot, stage, currentBranch)),
  );
  const pathViews = config.paths
    .map(promo => buildPromotionPathView(promo, config as DeliveryConfig, stageViews))
    .filter((view): view is DashboardPromotionPathView => view !== undefined);

  const reviewParts = await computeDeliveryReviewParts(workspaceRoot, config, stageViews, workflowNames);
  let storedReview: StoredDeliveryReview | undefined;
  try {
    storedReview = atlas.extensionContext?.workspaceState?.get<StoredDeliveryReview>(DELIVERY_REVIEW_STATE_KEY) ?? undefined;
  } catch {
    storedReview = undefined;
  }
  const review = summarizeDeliveryReview(reviewParts, storedReview);
  const history = readPromotionHistory(workspaceRoot).slice(0, 12);

  return { ...base, stages: stageViews, paths: pathViews, review, config, history, seeded };
}

const DELIVERY_REVIEW_STATE_KEY = 'atlasmind.deliveryReview';

/** Workspace-scoped flag: the user has acknowledged the one-time PII/GDPR storage notice. */
const PROJECT_DIRECTOR_PII_ACK_KEY = 'atlasmind.projectDirector.piiStorageAcknowledged';

/**
 * The user's own Buzz public key, derived from the agent key in SecretStorage.
 *
 * Only the *public* half ever leaves this function, and only when Buzz is
 * enabled — reading the stored secret to compute a key nobody asked for would
 * be touching a secret without a reason. Failure is silent by design: an absent
 * or unusable key simply means the roster offers nothing to prefill.
 */
async function readOwnBuzzPubkey(atlas: AtlasMindContext): Promise<string | undefined> {
  if (!vscode.workspace.getConfiguration('atlasmind').get<boolean>('buzz.enabled', false)) {
    return undefined;
  }
  try {
    const stored = (await atlas.extensionContext.secrets.get(BUZZ_AGENT_KEY_SECRET))?.trim();
    return stored ? await deriveBuzzPublicKey(stored) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Gather a first-draft roster from the repository: the git user (as "me"),
 * distinct git contributors, CODEOWNERS handles, the package author, and any
 * Website Studio client-intake stakeholders. Everything is optional and
 * best-effort — a missing signal is simply omitted.
 */
async function detectDirectorSignals(workspaceRoot: string): Promise<ProjectDirectorSeedInput> {
  const input: ProjectDirectorSeedInput = { projectName: path.basename(workspaceRoot) };

  // package.json — project name/summary + author.
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(workspaceRoot, 'package.json'), 'utf-8')) as Record<string, unknown>;
    if (typeof pkg['name'] === 'string' && pkg['name'].trim()) { input.projectName = pkg['name'].trim(); }
    if (typeof pkg['description'] === 'string' && pkg['description'].trim()) { input.projectSummary = pkg['description'].trim(); }
    const author = pkg['author'];
    if (typeof author === 'string' && author.trim()) {
      input.packageAuthor = author.trim();
    } else if (author && typeof author === 'object') {
      const a = author as Record<string, unknown>;
      const name = typeof a['name'] === 'string' ? a['name'] : '';
      const email = typeof a['email'] === 'string' ? a['email'] : '';
      if (name) { input.packageAuthor = email ? `${name} <${email}>` : name; }
    }
  } catch { /* no package.json */ }

  // git identity → "me".
  try {
    const name = (await runGit(workspaceRoot, ['config', 'user.name'])).trim();
    const email = (await runGit(workspaceRoot, ['config', 'user.email'])).trim();
    if (name || email) { input.self = { name: name || email, email: email || undefined }; }
  } catch { /* not configured */ }

  // Distinct git contributors.
  try {
    const out = await runGit(workspaceRoot, ['log', '--no-merges', '--format=%an\t%ae', '-n', '2000']);
    const seen = new Set<string>();
    const contributors: Array<{ name: string; email: string }> = [];
    for (const line of out.split(/\r?\n/)) {
      const [name, email] = line.split('\t');
      const key = (email || name || '').toLowerCase().trim();
      if (!key || seen.has(key)) { continue; }
      seen.add(key);
      contributors.push({ name: (name || '').trim(), email: (email || '').trim() });
      if (contributors.length >= 50) { break; }
    }
    if (contributors.length > 0) { input.gitContributors = contributors; }
  } catch { /* no history */ }

  // CODEOWNERS owner handles.
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, '.github', 'CODEOWNERS'), 'utf-8');
    const handles = new Set<string>();
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) { continue; }
      for (const token of trimmed.split(/\s+/).slice(1)) {
        if (token.startsWith('@')) { handles.add(token); }
      }
    }
    if (handles.size > 0) { input.codeowners = [...handles].slice(0, 30); }
  } catch { /* none */ }

  // Website Studio client intake → stakeholder names.
  try {
    const ssotPath = normalizeSsotPath(vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', 'project_memory'));
    const parsed = JSON.parse(await fs.readFile(path.join(workspaceRoot, ssotPath, 'domain', 'website.json'), 'utf-8')) as Record<string, unknown>;
    const intake = parsed['intake'] as Record<string, unknown> | undefined;
    const raw = intake?.['stakeholders'] ?? parsed['stakeholders'];
    if (Array.isArray(raw)) {
      const names = raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 30);
      if (names.length > 0) { input.websiteStakeholders = names; }
    }
  } catch { /* none */ }

  return input;
}

/**
 * Assemble the Project Director view. Mirrors {@link collectDeliveryStagePipeline}:
 * reads the persisted roster, seeds a first draft on first open (in-memory only
 * when it would store raw PII the user has not yet consented to), and computes
 * derived follow-up urgency + a run-attribution overlay for the assignments view.
 */
async function collectDirectorSnapshot(
  atlas: AtlasMindContext,
  workspaceRoot: string | undefined,
  currentBranch: string,
  runs: ProjectRunRecord[],
): Promise<DashboardDirectorSnapshot> {
  const connectors = detectConnectorCapabilities(atlas.mcpServerRegistry?.listServers() ?? [])
    .map(capability => ({ intent: capability.intent, serverName: capability.serverName, toolName: capability.toolName }));
  const buzzConfiguration = vscode.workspace.getConfiguration('atlasmind');
  const parsedBindings = parseAgentBindings(buzzConfiguration.get('buzz.agentBindings'));
  const agentChoices = (atlas.agentRegistry?.listAgents() ?? [])
    .map(agent => ({ id: agent.id, name: agent.name || agent.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Observed identities, so a handle can be picked. `named` distinguishes a
  // published name from a key prefix standing in for one — the UI must not
  // present the latter as though someone chose it.
  const buzzIdentities = (atlas.buzzInbound?.listIdentities() ?? []).map(identity => ({
    pubkey: identity.pubkey,
    label: describeIdentity(identity),
    named: identity.displayName !== undefined,
    channelIds: identity.channelIds,
    messageCount: identity.messageCount,
    lastSeenAt: identity.lastSeenAt,
    ...(identity.lastMessage ? { lastMessage: identity.lastMessage } : {}),
    ...(identity.about ? { about: identity.about } : {}),
  }));
  const ownBuzzPubkey = await readOwnBuzzPubkey(atlas);
  const base: DashboardDirectorSnapshot = {
    configPath: PROJECT_DIRECTOR_SSOT_PATH,
    summaryPath: PROJECT_DIRECTOR_SUMMARY_SSOT_PATH,
    config: null,
    teamMode: 'solo',
    storesRawPii: false,
    piiAcknowledged: false,
    overdueCount: 0,
    followUpUrgency: {},
    runs: [],
    outboundEnabled: false,
    connectors,
    seeded: false,
    notInGitRepo: false,
    agentChoices,
    agentBindings: parsedBindings.bindings,
    agentBindingIssues: parsedBindings.issues,
    buzzEnabled: buzzConfiguration.get<boolean>('buzz.enabled', false),
    buzzIdentities,
    ...(ownBuzzPubkey ? { ownBuzzPubkey } : {}),
  };
  const manager = atlas.projectDirectorManager;
  let piiAcknowledged = false;
  try {
    piiAcknowledged = atlas.extensionContext?.workspaceState?.get<boolean>(PROJECT_DIRECTOR_PII_ACK_KEY, false) ?? false;
  } catch {
    piiAcknowledged = false;
  }
  if (!workspaceRoot || !manager) {
    return { ...base, piiAcknowledged };
  }

  const isGit = currentBranch !== 'Not a git repository' && currentBranch !== 'Detached';
  let config = manager.getConfig();
  let seeded = false;
  if (!config) {
    if (!isGit) {
      return { ...base, piiAcknowledged, notInGitRepo: true };
    }
    // First open: seed a first-draft roster from the repo. Do NOT persist raw PII
    // to disk until the user has acknowledged the GDPR notice — if the draft would
    // store PII and consent hasn't been given, keep it in memory only for now.
    const signals = await detectDirectorSignals(workspaceRoot);
    config = seedProjectDirectorConfig(signals);
    seeded = true;
    if (!configStoresRawPii(config) || piiAcknowledged) {
      try { await manager.save(config); } catch { /* best-effort; served in-memory */ }
    }
  }

  const followUpUrgency: Record<string, FollowUpUrgency> = {};
  for (const followUp of config.followUps) {
    followUpUrgency[followUp.id] = deriveFollowUpUrgency(followUp);
  }

  const nameByContact = new Map(config.contacts.map(contact => [contact.id, contact.name] as const));
  const ownerByRun = new Map<string, string>();
  for (const assignment of config.assignments) {
    if (assignment.linkedRunId && assignment.assigneeContactId) {
      const name = nameByContact.get(assignment.assigneeContactId);
      if (name) { ownerByRun.set(assignment.linkedRunId, name); }
    }
  }
  const runViews: DashboardDirectorRun[] = runs.slice(0, 12).map(run => ({
    id: run.id,
    title: run.title || run.goal || 'Untitled run',
    status: run.status,
    relative: formatRelativeDate(run.updatedAt || run.createdAt),
    ownerName: ownerByRun.get(run.id),
  }));

  return {
    ...base,
    config,
    teamMode: resolveTeamMode(config),
    storesRawPii: configStoresRawPii(config),
    piiAcknowledged,
    overdueCount: countOverdueFollowUps(config),
    followUpUrgency,
    runs: runViews,
    outboundEnabled: config.settings.outboundEnabled === true,
    connectors,
    seeded,
    notInGitRepo: false,
  };
}

const STAGE_CANDIDATE_EXACT = new Set([
  'main', 'master', 'develop', 'development', 'staging', 'stage', 'production', 'prod',
  'preview', 'uat', 'qa', 'demo', 'release', 'sandbox',
]);
const STAGE_CANDIDATE_PREFIX = ['release/', 'hotfix/', 'env/', 'deploy/', 'stage/', 'staging/', 'prod/', 'production/'];

function isStageCandidateBranch(name: string): boolean {
  const normalized = name.toLowerCase();
  return STAGE_CANDIDATE_EXACT.has(normalized) || STAGE_CANDIDATE_PREFIX.some(prefix => normalized.startsWith(prefix));
}

/** All local + origin-remote branch short names, de-duped and normalised. */
async function listRepoBranchRefs(workspaceRoot: string): Promise<string[]> {
  try {
    const out = await runGit(workspaceRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin']);
    const set = new Set<string>();
    for (const line of out.split(/\r?\n/)) {
      const name = normalizeBranchRef(line.trim());
      if (name && !name.endsWith('/HEAD')) {
        set.add(name);
      }
    }
    return [...set].sort();
  } catch {
    return [];
  }
}

/** Stable JSON projection of the protocol-relevant config fields for fingerprinting. */
function projectConfigForReview(config: DeliveryConfig): string {
  const stages = [...config.stages].sort((a, b) => a.rank - b.rank).map(stage => ({
    id: stage.id,
    name: stage.name,
    kind: stage.kind,
    rank: stage.rank,
    branchRef: stage.branchRef ?? '',
    backupRequired: stage.backupPolicy.required,
    requiresApproval: stage.promotionPolicy.requiresApproval,
    requireVersionBump: stage.promotionPolicy.requireVersionBump,
    requireChangelog: stage.promotionPolicy.requireChangelog,
    requiredChecks: [...stage.promotionPolicy.requiredChecks],
    isProtected: stage.isProtected,
  }));
  const paths = [...config.paths]
    .map(path => ({ from: path.fromStageId, to: path.toStageId, routineId: path.routineId ?? '' }))
    .sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`));
  return JSON.stringify({ stages, paths });
}

async function computeDeliveryReviewParts(
  workspaceRoot: string,
  config: DeliveryConfig,
  stageViews: DashboardStageView[],
  workflowNames: string[],
): Promise<DeliveryReviewParts> {
  const modeled = new Set(
    config.stages
      .map(stage => (stage.branchRef ? normalizeBranchRef(stage.branchRef).toLowerCase() : ''))
      .filter(Boolean),
  );
  const repoBranches = await listRepoBranchRefs(workspaceRoot);
  const candidates = repoBranches.filter(branch => isStageCandidateBranch(branch) && !modeled.has(branch.toLowerCase()));
  const missing = stageViews.filter(view => view.branchRef && !view.branchExists).map(view => view.branchRef).sort();
  return { config: projectConfigForReview(config), candidates, missing, workflows: [...workflowNames].sort() };
}

function summarizeDeliveryReview(parts: DeliveryReviewParts, stored: StoredDeliveryReview | undefined): DashboardDeliveryReview {
  const reviewedAt = stored?.reviewedAt ?? null;
  const reviewedRelative = reviewedAt ? formatRelativeDate(reviewedAt) : '';
  if (!stored) {
    return { needsReview: true, reasons: ['This delivery pipeline has not been reviewed yet.'], reviewedAt, reviewedRelative };
  }
  const reasons: string[] = [];
  const prev = stored.parts;
  if (prev.config !== parts.config) {
    reasons.push('The delivery configuration changed since your last review.');
  }
  const prevCandidates = new Set(prev.candidates ?? []);
  const newCandidates = parts.candidates.filter(branch => !prevCandidates.has(branch));
  if (newCandidates.length > 0) {
    reasons.push(`New branch(es) that may warrant a stage: ${formatBranchList(newCandidates)}.`);
  }
  const prevMissing = new Set(prev.missing ?? []);
  const newMissing = parts.missing.filter(branch => !prevMissing.has(branch));
  if (newMissing.length > 0) {
    reasons.push(`Stage branch(es) no longer in the repo: ${formatBranchList(newMissing)}.`);
  }
  if (JSON.stringify(prev.workflows ?? []) !== JSON.stringify(parts.workflows)) {
    reasons.push('CI/CD workflow files changed since your last review.');
  }
  return { needsReview: reasons.length > 0, reasons, reviewedAt, reviewedRelative };
}

function formatBranchList(branches: string[]): string {
  const shown = branches.slice(0, 5);
  const extra = branches.length - shown.length;
  return extra > 0 ? `${shown.join(', ')} +${extra} more` : shown.join(', ');
}

async function buildStageView(
  workspaceRoot: string,
  stage: DeploymentStage,
  currentBranch: string,
): Promise<DashboardStageView> {
  let deployedVersion = '—';
  let branchExists = false;
  if (stage.branchRef) {
    // Read the version from the freshest ref (prefers `origin/<branch>`): a
    // developer's local release branch is usually stale, so reading it directly
    // reports an outdated deployed version.
    const ref = await resolveDeployedVersionRef(workspaceRoot, stage.branchRef);
    branchExists = ref !== undefined;
    if (ref) {
      deployedVersion = (await readPackageVersionFromGitRef(workspaceRoot, ref)) ?? '—';
    }
  }
  const backupConfigured = Boolean(stage.backupPolicy.command && stage.backupPolicy.command.trim().length > 0);
  return {
    id: stage.id,
    name: stage.name,
    kind: stage.kind,
    rank: stage.rank,
    description: stage.description,
    branchRef: stage.branchRef ?? '',
    branchExists,
    deployedVersion,
    isCurrentBranch: stage.branchRef
      ? normalizeBranchRef(stage.branchRef) === normalizeBranchRef(currentBranch)
      : false,
    isProtected: stage.isProtected,
    hostingProvider: stage.hosting.provider ?? '',
    hostingUrl: stage.hosting.url ?? '',
    healthCheckUrl: stage.hosting.healthCheckUrl ?? '',
    configLabel: stage.config.sourceLabel ?? '',
    dataLabel: stage.data.label ?? stage.data.kind ?? '',
    backupRequired: stage.backupPolicy.required,
    backupConfigured,
    hasRollback: Boolean(stage.rollbackPolicy.command && stage.rollbackPolicy.command.trim().length > 0),
    securityNotes: buildStageSecurityNotes(stage, backupConfigured),
  };
}

function buildStageSecurityNotes(stage: DeploymentStage, backupConfigured: boolean): string[] {
  const notes: string[] = [];
  if (stage.isProtected) {
    notes.push('Protected stage — every push here asks for confirmation and is never force-pushed.');
  }
  if (stage.backupPolicy.required && !backupConfigured) {
    notes.push('A data backup is required before any push, but no backup command is set yet — pushes to this stage stay blocked until you add one.');
  } else if (stage.backupPolicy.required) {
    notes.push('A data backup runs automatically before any change, so this stage can be recovered.');
  }
  if (stage.promotionPolicy.requiresApproval) {
    notes.push('Pushes require explicit human approval before anything runs.');
  }
  if (stage.promotionPolicy.viaPullRequest) {
    notes.push(`Pushes into this stage go through a Pull Request to the ${stage.branchRef ?? 'protected'} branch — never a direct push.`);
  }
  if (stage.promotionPolicy.dispatchWorkflow) {
    notes.push(`Pushes run in CI/CD (dispatch ${stage.promotionPolicy.dispatchWorkflow}), not on a developer's machine.`);
  }
  if (stage.promotionPolicy.requireDistinctApprover) {
    notes.push('Separation of duties — whoever promotes must not be the author of the change.');
  }
  if (stage.config.sourceLabel) {
    notes.push(`Secrets live in ${stage.config.sourceLabel} — only the location is recorded here, never the values.`);
  }
  return notes;
}

function buildPromotionPathView(
  promo: PromotionPath,
  config: DeliveryConfig,
  stageViews: DashboardStageView[],
): DashboardPromotionPathView | undefined {
  const from = config.stages.find(stage => stage.id === promo.fromStageId);
  const to = config.stages.find(stage => stage.id === promo.toStageId);
  if (!from || !to) {
    return undefined;
  }
  const fromView = stageViews.find(view => view.id === promo.fromStageId);
  const toView = stageViews.find(view => view.id === promo.toStageId);
  const backupConfigured = Boolean(to.backupPolicy.command && to.backupPolicy.command.trim().length > 0);
  const viaPullRequest = to.promotionPolicy.viaPullRequest === true;
  const needsPrRoutine = viaPullRequest && !promo.routineId;
  const backupBlocked = to.backupPolicy.required && !backupConfigured;
  const blocked = backupBlocked || needsPrRoutine;
  const guardrails = [
    'Preflight gate — required checks must pass, or the push aborts',
    to.backupPolicy.required ? `Backup — snapshot ${to.name} before any change` : 'Backup — optional for this target',
    viaPullRequest
      ? `Promote — open a Pull Request into ${to.branchRef ?? 'the protected branch'} (never a direct push)`
      : 'Promote — merge/tag forward (never force-push)',
    'Verify — health-check the target after deploy',
  ];
  const blockReason = backupBlocked
    ? `Define a backup command for ${to.name} before this push can run.`
    : needsPrRoutine
      ? `Bind a promotion routine that opens a Pull Request into ${to.branchRef ?? 'the protected branch'}.`
      : '';
  const versionDelta = fromView && toView ? `v${fromView.deployedVersion} → v${toView.deployedVersion}` : '';
  return {
    id: promo.id,
    fromStageId: promo.fromStageId,
    toStageId: promo.toStageId,
    fromName: from.name,
    toName: to.name,
    routineId: promo.routineId ?? '',
    guardrails,
    gates: to.promotionPolicy.requiredChecks,
    requiresApproval: to.promotionPolicy.requiresApproval,
    viaPullRequest,
    statusChecks: to.promotionPolicy.requiredStatusChecks ?? [],
    backupRequired: to.backupPolicy.required,
    backupConfigured,
    blocked,
    blockReason,
    versionDelta,
    lastPromotion: promo.lastPromotion
      ? {
          ranAt: promo.lastPromotion.ranAt,
          succeeded: promo.lastPromotion.succeeded,
          version: promo.lastPromotion.version ?? '',
        }
      : undefined,
  };
}

async function collectWorkflowSnapshot(workspaceRoot: string | undefined): Promise<DashboardWorkflow[]> {
  if (!workspaceRoot) {
    return [];
  }

  const workflowsDir = path.join(workspaceRoot, '.github', 'workflows');
  try {
    const entries = await fs.readdir(workflowsDir, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name));
    const workflows = await Promise.all(files.map(async entry => {
      const filePath = path.join(workflowsDir, entry.name);
      const [text, stat] = await Promise.all([
        fs.readFile(filePath, 'utf-8'),
        fs.stat(filePath),
      ]);
      const nameMatch = text.match(/^name:\s*(.+)$/m);
      const triggers = ['push', 'pull_request', 'workflow_dispatch', 'schedule', 'release']
        .filter(trigger => new RegExp(String.raw`(^|\n)\s*${trigger}:`, 'm').test(text) || new RegExp(String.raw`on:\s*\[[^]]*${trigger}[^]]*]`, 'm').test(text));
      return {
        name: (nameMatch?.[1] ?? entry.name).trim(),
        path: toWorkspaceRelative(workspaceRoot, filePath),
        triggers,
        lastModified: new Date(stat.mtime).toISOString(),
      } satisfies DashboardWorkflow;
    }));
    return workflows.sort((left, right) => right.lastModified.localeCompare(left.lastModified));
  } catch {
    return [];
  }
}

async function collectArtifacts(workspaceRoot: string | undefined): Promise<ArtifactSignal[]> {
  const signals = await Promise.all(ARTIFACT_CATALOG.map(async spec => {
    let resolvedPath: string | undefined;
    if (workspaceRoot) {
      for (const candidate of spec.paths) {
        if (await fileExists(path.join(workspaceRoot, candidate))) {
          resolvedPath = candidate;
          break;
        }
      }
    }
    const exists = resolvedPath !== undefined;
    return {
      label: spec.label,
      description: spec.description,
      path: resolvedPath ?? spec.paths[0] ?? '',
      type: spec.type,
      origin: spec.origin,
      lifecycle: spec.lifecycle,
      retention: spec.retention,
      exists,
      needsAttention: spec.type === 'persistent' && spec.retention === 'keep' && !exists,
    } satisfies ArtifactSignal;
  }));

  // Detect packaged extension archives (.vsix) in the workspace root.
  if (workspaceRoot) {
    try {
      const rootEntries = await fs.readdir(workspaceRoot, { withFileTypes: true });
      const vsixFiles = rootEntries.filter(e => e.isFile() && e.name.endsWith('.vsix'));
      signals.push({
        label: '*.vsix',
        description: vsixFiles.length > 0
          ? `${vsixFiles.length} packaged extension archive${vsixFiles.length === 1 ? '' : 's'} present in workspace root.`
          : 'Packaged VS Code extension archive — produced by vsce package.',
        path: vsixFiles.length > 0 ? vsixFiles[0]!.name : '*.vsix',
        type: 'ephemeral',
        origin: 'generated',
        lifecycle: 'build',
        retention: 'cache',
        exists: vsixFiles.length > 0,
        needsAttention: false,
      });
    } catch {
      // Not a VS Code project or unreadable — skip silently.
    }
  }

  return signals;
}

async function collectSsotSnapshot(workspaceRoot: string | undefined, ssotPath: string): Promise<SsotDiskSnapshot & { coveragePercent: number }> {
  if (!workspaceRoot) {
    const coverage = EXPECTED_SSOT_DIRECTORIES.map(name => ({ name, count: 0, present: false }));
    return { totalFiles: 0, coverage, coveragePercent: 0, recentFiles: [] };
  }

  const absoluteSsotPath = path.join(workspaceRoot, ssotPath);
  const coverage = await Promise.all(EXPECTED_SSOT_DIRECTORIES.map(async name => {
    const directoryPath = path.join(absoluteSsotPath, name);
    const count = await countFiles(directoryPath);
    return {
      name,
      count,
      present: count > 0 || await fileExists(directoryPath),
    };
  }));
  const recentFiles = await collectRecentFiles(absoluteSsotPath, workspaceRoot);
  const totalFiles = coverage.reduce((total, entry) => total + entry.count, 0);
  const presentCount = coverage.filter(entry => entry.present).length;
  return {
    totalFiles,
    coverage,
    coveragePercent: Math.round((presentCount / EXPECTED_SSOT_DIRECTORIES.length) * 100),
    recentFiles,
  };
}

async function collectRecentFiles(directoryPath: string, workspaceRoot: string): Promise<DashboardRecentFile[]> {
  const files: Array<{ filePath: string; mtime: number }> = [];
  await walkFiles(directoryPath, async filePath => {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        files.push({ filePath, mtime: stat.mtimeMs });
      }
    } catch {
      // Ignore disappearing files.
    }
  });
  return files
    .sort((left, right) => right.mtime - left.mtime)
    .slice(0, MAX_RECENT_FILES)
    .map(file => ({
      path: toWorkspaceRelative(workspaceRoot, file.filePath),
      lastModified: new Date(file.mtime).toISOString(),
      lastModifiedRelative: formatRelativeDate(new Date(file.mtime).toISOString()),
    }));
}

async function newestMtimeForFiles(filePaths: string[]): Promise<number> {
  const times = await Promise.all(filePaths.map(async filePath => {
    try {
      const stat = await fs.stat(filePath);
      return stat.mtimeMs;
    } catch {
      return 0;
    }
  }));
  return Math.max(0, ...times);
}

async function newestMtimeInDirectory(dirPath: string): Promise<number> {
  const mtimes: number[] = [];
  await walkFiles(dirPath, async filePath => {
    try {
      const stat = await fs.stat(filePath);
      mtimes.push(stat.mtimeMs);
    } catch {
      // Ignore disappearing files.
    }
  });
  return mtimes.length > 0 ? Math.max(...mtimes) : 0;
}

async function countFilesNewerThan(dirPath: string, thresholdMs: number, extensions: string[]): Promise<number> {
  let count = 0;
  await walkFiles(dirPath, async filePath => {
    if (!extensions.some(ext => filePath.endsWith(ext))) {
      return;
    }
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs > thresholdMs) {
        count += 1;
      }
    } catch {
      // Ignore disappearing files.
    }
  });
  return count;
}

async function assessDocumentationDelta(workspaceRoot: string, ssotAbsPath: string): Promise<SsotDeltaArea> {
  const [ssotNewest, projectDocsNewest] = await Promise.all([
    Promise.all([
      newestMtimeInDirectory(path.join(ssotAbsPath, 'architecture')),
      newestMtimeInDirectory(path.join(ssotAbsPath, 'roadmap')),
      newestMtimeInDirectory(path.join(ssotAbsPath, 'decisions')),
    ]).then(times => Math.max(0, ...times)),
    Promise.all([
      newestMtimeInDirectory(path.join(workspaceRoot, 'docs')),
      newestMtimeInDirectory(path.join(workspaceRoot, 'wiki')),
      newestMtimeForFiles([
        path.join(workspaceRoot, 'README.md'),
        path.join(workspaceRoot, 'CHANGELOG.md'),
        path.join(workspaceRoot, 'CONTRIBUTING.md'),
      ]),
    ]).then(times => Math.max(0, ...times)),
  ]);

  if (projectDocsNewest === 0) {
    return { label: 'Documentation', status: 'unknown', delta: 0, detail: 'No documentation files detected.' };
  }
  if (ssotNewest === 0) {
    return { label: 'Documentation', status: 'missing', delta: 1, detail: 'No SSOT architecture, roadmap, or decisions entries found.' };
  }

  const staleCount = await Promise.all([
    countFilesNewerThan(path.join(workspaceRoot, 'docs'), ssotNewest, ['.md', '.txt']),
    countFilesNewerThan(path.join(workspaceRoot, 'wiki'), ssotNewest, ['.md', '.txt']),
  ]).then(([docsStale, wikiStale]) => {
    const rootStale = projectDocsNewest > ssotNewest ? 1 : 0;
    return docsStale + wikiStale + rootStale;
  });

  return {
    label: 'Documentation',
    status: staleCount > 0 ? 'stale' : 'ok',
    delta: staleCount,
    detail: staleCount > 0
      ? `${staleCount} doc file${staleCount === 1 ? '' : 's'} updated since last SSOT architecture/roadmap sync.`
      : 'Documentation is reflected in SSOT architecture and roadmap.',
  };
}

async function assessCodebaseDelta(workspaceRoot: string, ssotAbsPath: string): Promise<SsotDeltaArea> {
  const [ssotArchNewest, srcNewest] = await Promise.all([
    newestMtimeInDirectory(path.join(ssotAbsPath, 'architecture')),
    newestMtimeInDirectory(path.join(workspaceRoot, 'src')),
  ]);

  if (srcNewest === 0) {
    return { label: 'Codebase', status: 'unknown', delta: 0, detail: 'No src/ directory detected.' };
  }
  if (ssotArchNewest === 0) {
    return { label: 'Codebase', status: 'missing', delta: 1, detail: 'No SSOT architecture entries to map the codebase.' };
  }

  const staleCount = await countFilesNewerThan(
    path.join(workspaceRoot, 'src'),
    ssotArchNewest,
    ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cs'],
  );

  return {
    label: 'Codebase',
    status: staleCount > 0 ? 'stale' : 'ok',
    delta: staleCount,
    detail: staleCount > 0
      ? `${staleCount} source file${staleCount === 1 ? '' : 's'} modified since last SSOT architecture update.`
      : 'Source changes are reflected in SSOT architecture.',
  };
}

async function assessAgentInstructionsDelta(ssotAbsPath: string, agentCount: number): Promise<SsotDeltaArea> {
  const ssotAgentFileCount = await countFiles(path.join(ssotAbsPath, 'agents'));

  if (agentCount === 0 && ssotAgentFileCount === 0) {
    return { label: 'Agent instructions', status: 'ok', delta: 0, detail: 'No agents registered.' };
  }

  const delta = Math.max(0, agentCount - ssotAgentFileCount);
  return {
    label: 'Agent instructions',
    status: delta > 0 ? 'stale' : 'ok',
    delta,
    detail: delta > 0
      ? `${delta} registered agent${delta === 1 ? '' : 's'} not yet documented in SSOT agents/.`
      : `${agentCount} agent${agentCount === 1 ? '' : 's'} documented in SSOT agents/.`,
  };
}

async function assessSecurityDelta(
  workspaceRoot: string,
  ssotAbsPath: string,
  securityPolicyPresent: boolean,
  blockedEntries: number,
): Promise<SsotDeltaArea> {
  if (blockedEntries > 0) {
    return {
      label: 'Security',
      status: 'stale',
      delta: blockedEntries,
      detail: `${blockedEntries} blocked SSOT entr${blockedEntries === 1 ? 'y' : 'ies'} contain security threats and are excluded from context.`,
    };
  }

  const ssotMisadventuresCount = await countFiles(path.join(ssotAbsPath, 'misadventures'));
  const [securityFileNewest, ssotMisadventuresNewest] = await Promise.all([
    newestMtimeForFiles([
      path.join(workspaceRoot, 'SECURITY.md'),
      path.join(workspaceRoot, '.github', 'SECURITY.md'),
    ]),
    newestMtimeInDirectory(path.join(ssotAbsPath, 'misadventures')),
  ]);

  if (!securityPolicyPresent && ssotMisadventuresCount === 0) {
    return { label: 'Security', status: 'missing', delta: 1, detail: 'No SECURITY.md or SSOT incident log entries found.' };
  }

  const isStale = securityFileNewest > 0 && (ssotMisadventuresNewest === 0 || securityFileNewest > ssotMisadventuresNewest);
  return {
    label: 'Security',
    status: isStale ? 'stale' : 'ok',
    delta: isStale ? 1 : 0,
    detail: isStale
      ? 'Security policy updated since last SSOT misadventures sync.'
      : ssotMisadventuresCount > 0
        ? `${ssotMisadventuresCount} incident record${ssotMisadventuresCount === 1 ? '' : 's'} tracked in SSOT misadventures/.`
        : 'Security posture reflected in SSOT.',
  };
}

async function assessLicenseDelta(workspaceRoot: string, memoryEntries: readonly import('../types.js').MemoryEntry[]): Promise<SsotDeltaArea> {
  const licenseFiles = [
    path.join(workspaceRoot, 'LICENSE'),
    path.join(workspaceRoot, 'LICENSE.md'),
    path.join(workspaceRoot, 'LICENSE.txt'),
  ];
  const licenseExists = (await Promise.all(licenseFiles.map(filePath => fileExists(filePath)))).some(Boolean);

  if (!licenseExists) {
    return { label: 'License', status: 'missing', delta: 1, detail: 'No LICENSE file detected in workspace root.' };
  }

  const licenseInSsot = memoryEntries.some(entry =>
    entry.path.toLowerCase().includes('license')
    || (entry.tags ?? []).some(tag => tag.toLowerCase().includes('license')),
  );

  return {
    label: 'License',
    status: licenseInSsot ? 'ok' : 'stale',
    delta: licenseInSsot ? 0 : 1,
    detail: licenseInSsot
      ? 'License is captured in SSOT memory.'
      : 'LICENSE file present but not yet captured in SSOT memory.',
  };
}

async function collectSsotDelta(
  workspaceRoot: string | undefined,
  ssotPath: string,
  agentCount: number,
  memoryEntries: readonly import('../types.js').MemoryEntry[],
  securityPolicyPresent: boolean,
  blockedEntries: number,
): Promise<SsotDelta> {
  const unknownArea = (label: string): SsotDeltaArea => ({ label, status: 'unknown', delta: 0, detail: 'No workspace open.' });

  if (!workspaceRoot) {
    return {
      areas: [
        unknownArea('Documentation'),
        unknownArea('Codebase'),
        unknownArea('Agent instructions'),
        unknownArea('Security'),
        unknownArea('License'),
      ],
      totalDelta: 0,
    };
  }

  const ssotAbsPath = path.join(workspaceRoot, ssotPath);
  const [docArea, codeArea, agentArea, securityArea, licenseArea] = await Promise.all([
    assessDocumentationDelta(workspaceRoot, ssotAbsPath),
    assessCodebaseDelta(workspaceRoot, ssotAbsPath),
    assessAgentInstructionsDelta(ssotAbsPath, agentCount),
    assessSecurityDelta(workspaceRoot, ssotAbsPath, securityPolicyPresent, blockedEntries),
    assessLicenseDelta(workspaceRoot, memoryEntries),
  ]);

  const areas = [docArea, codeArea, agentArea, securityArea, licenseArea];
  return {
    areas,
    totalDelta: areas.reduce((total, area) => total + area.delta, 0),
  };
}

async function collectOutcomeCompleteness(
  workspaceRoot: string | undefined,
  ssotPath: string,
  runs: Array<{ completedSubtaskCount: number; totalSubtaskCount: number; status: string }>,
  ciSignals: Array<{ label: string; ok: boolean }>,
): Promise<DashboardOutcomeCompleteness> {
  if (!workspaceRoot) {
    return {
      desiredOutcome: 'Define the desired project outcome in project_memory/project_soul.md.',
      score: 0,
      summary: 'No workspace is open, so AtlasMind cannot measure how complete the desired project outcome is yet.',
      referenceCoveragePercent: 0,
      roadmapCompleted: 0,
      roadmapTotal: 0,
      runCompletionPercent: 0,
      signals: [
        {
          label: 'Outcome defined',
          ok: false,
          detail: 'Open a workspace and define the project vision in project_memory/project_soul.md.',
          actionPrompt: 'Open a workspace for this project, then define the desired outcome in project_memory/project_soul.md by writing a concrete Vision section that explains what done looks like. Make the smallest useful documentation change once the workspace is available, then summarize what still needs to be grounded in roadmap or capability docs.',
        },
      ],
    };
  }

  const projectSoulPath = path.join(workspaceRoot, ssotPath, 'project_soul.md');
  const productCapabilitiesPath = path.join(workspaceRoot, ssotPath, 'domain', 'product-capabilities.md');
  const [projectSoulRaw, productCapabilitiesExists, roadmapFiles] = await Promise.all([
    fs.readFile(projectSoulPath, 'utf-8').catch(() => ''),
    fileExists(productCapabilitiesPath),
    collectMarkdownFiles(path.join(workspaceRoot, ssotPath, 'roadmap')),
  ]);

  const desiredOutcome = extractMarkdownSection(projectSoulRaw, 'Vision')
    .replace(/\r?\n/g, ' ')
    .trim() || 'Define the desired project outcome in project_memory/project_soul.md#Vision.';
  const referencePaths = extractMarkdownBulletItems(extractMarkdownSection(projectSoulRaw, 'References'));
  const resolvedReferenceChecks = await Promise.all(referencePaths.map(async referencePath => {
    const normalizedReference = referencePath.replace(/^`|`$/g, '').trim();
    const directPath = path.join(workspaceRoot, normalizedReference);
    const ssotRelativePath = path.join(workspaceRoot, ssotPath, normalizedReference);
    const filePath = await fileExists(directPath) ? directPath : ssotRelativePath;
    return fileExists(filePath);
  }));
  const referencesPresent = resolvedReferenceChecks.filter(Boolean).length;
  const referenceCoveragePercent = referencePaths.length > 0
    ? Math.round((referencesPresent / referencePaths.length) * 100)
    : 0;

  const roadmapProgress = roadmapFiles.reduce((aggregate, text) => {
    const progress = parseRoadmapProgress(text);
    return {
      completed: aggregate.completed + progress.completed,
      total: aggregate.total + progress.total,
    };
  }, { completed: 0, total: 0 });
  const roadmapProgressPercent = roadmapProgress.total > 0
    ? Math.round((roadmapProgress.completed / roadmapProgress.total) * 100)
    : 0;

  const executionRatios = runs
    .filter(run => run.totalSubtaskCount > 0)
    .map(run => run.completedSubtaskCount / run.totalSubtaskCount);
  const runCompletionPercent = executionRatios.length > 0
    ? Math.round((executionRatios.reduce((total, value) => total + value, 0) / executionRatios.length) * 100)
    : 0;

  const deliveryEvidencePercent = ciSignals.length > 0
    ? Math.round((ciSignals.filter(signal => signal.ok).length / ciSignals.length) * 100)
    : 0;

  let score = 0;
  score += desiredOutcome.startsWith('Define the desired project outcome') ? 0 : 28;
  score += Math.round(referenceCoveragePercent * 0.18);
  score += roadmapProgress.total > 0 ? Math.round(roadmapProgressPercent * 0.26) : 0;
  score += productCapabilitiesExists ? 10 : 0;
  score += Math.round(deliveryEvidencePercent * 0.08);
  score += executionRatios.length > 0 ? Math.round(runCompletionPercent * 0.10) : 0;
  score = Math.max(0, Math.min(100, score));

  const signals: DashboardOutcomeSignal[] = [
    {
      label: 'Outcome defined',
      ok: !desiredOutcome.startsWith('Define the desired project outcome'),
      detail: !desiredOutcome.startsWith('Define the desired project outcome')
        ? 'The project soul defines a concrete vision for the end state.'
        : 'The project soul is missing a concrete vision statement for the desired end state.',
      actionPrompt: 'Open project_memory/project_soul.md and strengthen the Vision section into a concrete desired end state for this project. Make the smallest defensible documentation change that clearly defines what done looks like, then summarize what changed and what still needs follow-up.',
    },
    {
      label: 'Reference coverage',
      ok: referenceCoveragePercent >= 75,
      detail: referencePaths.length > 0
        ? `${referencesPresent}/${referencePaths.length} referenced vision-supporting document(s) resolve on disk.`
        : 'No supporting references are listed beneath the project soul vision.',
      actionPrompt: 'Review the References section in project_memory/project_soul.md and fix the first missing or weak supporting link. Update the referenced document or the reference list so this area has one concrete improvement, then summarize what was repaired and what still remains unresolved.',
    },
    {
      label: 'Roadmap progress',
      ok: roadmapProgress.total > 0 && roadmapProgressPercent >= 50,
      detail: roadmapProgress.total > 0
        ? `${roadmapProgress.completed}/${roadmapProgress.total} roadmap item(s) are marked complete.`
        : 'No tracked roadmap checklist items were found in project_memory/roadmap/.',
      actionPrompt: 'Open project_memory/roadmap/improvement-plan.md and translate the desired outcome into explicit measurable checklist items, or mark the first clearly completed item if that evidence already exists. Make a small first-pass roadmap improvement and then summarize the next milestone that should be addressed.',
    },
    {
      label: 'Execution evidence',
      ok: executionRatios.length > 0 && runCompletionPercent >= 70,
      detail: executionRatios.length > 0
        ? `Recent project runs average ${runCompletionPercent}% completion across planned subtasks.`
        : 'No recent autonomous runs provide evidence that execution is converging on the desired outcome.',
      actionPrompt: 'Review the current roadmap and recent project-run evidence, identify the smallest concrete piece of work that would move the desired outcome forward, and either complete that small step or leave the workspace with a sharply defined first implementation task. Summarize the action taken and the next blocker if it could not be finished in one pass.',
    },
    {
      label: 'Capability baseline',
      ok: productCapabilitiesExists,
      detail: productCapabilitiesExists
        ? 'A product-capabilities memory document exists and gives outcome context beyond the raw vision.'
        : 'No product-capabilities memory document was found to translate vision into concrete capabilities.',
      actionPrompt: 'Open project_memory/domain/product-capabilities.md and add or tighten the first high-signal capability entry that turns the project vision into something concrete and reviewable. Make the smallest useful documentation improvement, then summarize the remaining capability gaps.',
    },
  ];

  const summary = score >= 80
    ? 'The desired outcome is defined, backed by supporting documents, and execution evidence is broadly converging on it.'
    : score >= 55
      ? 'The desired outcome is visible, but roadmap progress, supporting evidence, or execution telemetry still leave noticeable gaps.'
      : 'The desired outcome is only partially translated into roadmap evidence and execution progress. AtlasMind needs sharper completion signals.';

  return {
    desiredOutcome,
    score,
    summary,
    referenceCoveragePercent,
    roadmapCompleted: roadmapProgress.completed,
    roadmapTotal: roadmapProgress.total,
    runCompletionPercent,
    signals,
  };
}

async function collectMarkdownFiles(directoryPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'));
    return Promise.all(files.map(entry => fs.readFile(path.join(directoryPath, entry.name), 'utf-8').catch(() => '')));
  } catch {
    return [];
  }
}

function extractMarkdownSection(text: string, heading: string): string {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|$)`, 'im');
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? '';
}

function extractMarkdownBulletItems(text: string): string[] {
  return [...text.matchAll(/^\s*[-*]\s+(.+?)\s*$/gm)]
    .map(match => match[1]?.trim() ?? '')
    .filter(Boolean);
}

function parseRoadmapProgress(text: string): { completed: number; total: number } {
  const region = extractRoadmapItemsRegion(text);
  const seen = new Set<string>();
  let completed = 0;
  let total = 0;
  for (const match of region.matchAll(/^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/gm)) {
    const raw = match[1]?.trim() ?? '';
    if (!raw) {
      continue;
    }
    const done = /^(?:✅|\[x\])/i.test(raw);
    const bare = raw.replace(/^(?:✅|\[(?:x| )\])\s*/i, '').replace(/\s*#mvp\b/ig, '').trim();
    if (isRoadmapNoiseItem(bare)) {
      continue;
    }
    const key = normalizeRoadmapText(bare);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    total += 1;
    if (done) {
      completed += 1;
    }
  }
  return { completed, total };
}

// ── Documents (.md management) ────────────────────────────────────

interface DashboardDocumentFilingView {
  id: string;
  label: string;
  path: string;
  description?: string;
  pattern?: string;
  exists: boolean;
  markdownCount: number;
}

interface DashboardDocumentAutoView {
  id: string;
  path: string;
  label?: string;
  sourceHint?: string;
  cadence: DocumentCadence;
  lastReviewed?: string;
  exists: boolean;
  lastModified?: string;
  status: 'missing' | 'fresh' | 'review-due' | 'unknown';
  statusLabel: string;
  detail: string;
  updatePrompt: string;
}

interface DashboardDocumentsSnapshot {
  filePath: string;
  summaryPath: string;
  configured: boolean;
  filing: DashboardDocumentFilingView[];
  autoUpdate: DashboardDocumentAutoView[];
  totalMarkdown: number;
  markdownCapped: boolean;
  reviewDueCount: number;
  missingCount: number;
  uncovered: string[];
  summary: string;
  /**
   * Something worth saying about the file itself — that it was migrated
   * forward, or that it came from a newer AtlasMind and was left untouched.
   * Absent in the ordinary case.
   */
  fileNotice?: string;
}

// ── Risk oversight snapshot ──────────────────────────────────────────────────

interface DashboardRiskDomainView {
  domain: RiskDomain;
  label: string;
  agentId: string;
  /** ISO date of the last run, or undefined when never analysed. */
  lastRun?: string;
  /** Whole days since the last run; undefined when never analysed. */
  daysSinceRun?: number;
  openCount: number;
  stale: boolean;
  /**
   * What this advisor actually reviews, taken from its own agent definition.
   *
   * A clean result is only meaningful if you can see what was looked for — "no
   * concerns" reads as "nothing was checked" otherwise. Sourced from the
   * registry rather than restated here so the two cannot drift.
   */
  coverage?: string;
}

interface DashboardRiskSnapshot {
  filePath: string;
  summaryPath: string;
  /** False until at least one advisor has actually run — drives "not yet assessed". */
  assessed: boolean;
  domains: DashboardRiskDomainView[];
  findings: RiskFinding[];
  openCount: number;
  acceptedCount: number;
  resolvedCount: number;
  /** Counts keyed `likelihood:impact`, for the risk matrix. */
  matrix: Record<string, number>;
  /** 0-100, higher is better. Undefined until assessed. */
  score?: number;
  /** Open findings over time, for the trend chart. */
  trend: DashboardSeriesPoint[];
  history: RiskOversightHistoryEntry[];
  summary: string;
}

/** An assessment older than this stops counting as current assurance. */
const RISK_STALE_DAYS = 90;

const RISK_DOMAIN_BRIEF: Record<RiskDomain, string> = {
  ethics: 'user harm, fairness and bias, consent, dark patterns, transparency about automated behaviour, accessibility as an ethical duty, and the human impact of the product\'s data and design decisions',
  legal: 'dependency and third-party licence compatibility and obligations, intellectual property and attribution, privacy regulation such as GDPR and CCPA, liability and warranty language, terms of service, and the handling of regulated or personal data',
  commercial: 'monetisation and business viability, vendor cost and lock-in exposure, contractual and customer obligations, competitor positioning, and go-to-market or customer impact',
};

/**
 * Prompt for a dashboard-triggered oversight run.
 *
 * Asks for prose *and* a machine-readable block: the page records the JSON, while the
 * prose keeps the run legible in the transcript. The parser tolerates the model
 * ignoring this contract entirely (see `parseRiskFindings`), so the instruction is a
 * request, not an assumption.
 */
function buildRiskAnalysisPrompt(domain: RiskDomain): string {
  return [
    `Review this workspace for ${domain} risk: ${RISK_DOMAIN_BRIEF[domain]}.`,
    '',
    'Inspect the repository before asserting anything — read the files that would actually',
    'evidence a concern, and cite them. Distinguish what you observed here from general',
    'principle, and say when you could not determine something rather than assuming.',
    'Rank by likelihood and impact, and report a clean result when the project looks sound;',
    'flagging everything is the same as flagging nothing.',
    '',
    'Then end your reply with a single fenced JSON block in exactly this shape:',
    '',
    '```json',
    '{"findings":[{',
    `  "title": "short specific title",`,
    '  "detail": "what the concern is and what you saw",',
    '  "likelihood": "low|medium|high",',
    '  "impact": "low|medium|high",',
    '  "confidence": "low|medium|high",',
    '  "evidence": ["workspace-relative/path.ts"],',
    '  "recommendation": "the next step, and the human review it needs"',
    '}]}',
    '```',
    '',
    'Use an empty array when there is nothing material to report. Evidence paths must be',
    'workspace-relative. Do not include any other JSON block in your reply.',
  ].join('\n');
}

const RISK_DOMAIN_LABEL: Record<RiskDomain, string> = {
  ethics: 'Ethics',
  legal: 'Legal',
  commercial: 'Commercial',
};

/**
 * Convert the persisted register into the view model the Risk page renders.
 *
 * Deliberately reports `assessed: false` rather than a zero score when nothing has
 * been analysed: an unassessed project is unknown, not safe, and the page must not
 * imply otherwise.
 */
function collectRiskSnapshot(atlas: AtlasMindContext, workspaceRoot: string | undefined): DashboardRiskSnapshot {
  const config = atlas.riskOversightManager?.getConfig();
  const history = workspaceRoot ? readRiskOversightHistory(workspaceRoot).slice(0, 50) : [];
  const findings = config?.findings ?? [];
  const open = config ? openFindings(config) : [];
  const accepted = findings.filter(finding => finding.status === 'accepted');
  const resolved = findings.filter(finding => finding.status === 'mitigated' || finding.status === 'closed' || finding.status === 'dismissed');
  const assessed = hasBeenAssessed(config);
  const now = Date.now();

  const domains: DashboardRiskDomainView[] = RISK_DOMAINS.map(domain => {
    const run = config?.runs.find(entry => entry.domain === domain);
    const parsed = run ? Date.parse(run.ranAt) : Number.NaN;
    const daysSinceRun = Number.isNaN(parsed) ? undefined : Math.floor((now - parsed) / 86_400_000);
    const agentId = `${domain}-oversight`;
    // The advisor's own description is the authoritative statement of what it
    // reviews; the sentence about being advisory belongs on the page intro, not
    // on every card, so only the first sentence is carried across.
    // Optional *call*, not just optional access: this is descriptive enrichment,
    // and a registry that cannot answer must never take the whole dashboard
    // snapshot down with it.
    const coverage = atlas.agentRegistry?.get?.(agentId)?.description?.split(/(?<=\.)\s+/)[0];
    return {
      domain,
      label: RISK_DOMAIN_LABEL[domain],
      agentId,
      ...(coverage ? { coverage } : {}),
      ...(run ? { lastRun: run.ranAt } : {}),
      ...(daysSinceRun === undefined ? {} : { daysSinceRun }),
      openCount: open.filter(finding => finding.domain === domain).length,
      stale: daysSinceRun === undefined ? true : daysSinceRun > RISK_STALE_DAYS,
    };
  });

  const summary = !assessed
    ? 'Risk has not been assessed yet. Run an oversight advisor to build the register.'
    : open.length === 0
      ? `No open findings across ${domains.filter(entry => entry.lastRun).length} assessed domain(s).`
      : `${open.length} open finding${open.length === 1 ? '' : 's'} across ${new Set(open.map(finding => finding.domain)).size} domain(s).`;

  return {
    filePath: RISK_SSOT_PATH,
    summaryPath: RISK_SUMMARY_SSOT_PATH,
    assessed,
    domains,
    findings,
    openCount: open.length,
    acceptedCount: accepted.length,
    resolvedCount: resolved.length,
    matrix: riskMatrixCounts(open),
    ...(assessed ? { score: computeRiskScore(config!) } : {}),
    trend: buildRiskTrend(history),
    history,
    summary,
  };
}

/**
 * Risk health as 0-100, higher is better. Starts at 100 and deducts weighted open
 * findings, then applies a staleness decay so an old assessment stops reading as
 * current assurance. `accepted` findings are excluded — a consciously owned risk is
 * a decision, not an unmanaged gap.
 */
function computeRiskScore(config: RiskOversightConfig): number {
  const open = openFindings(config);
  const burden = open.reduce((total, finding) => total + findingWeight(finding), 0);
  // 9 is a single worst-case finding (high/high/high confidence); ~4 of those floor the score.
  const fromFindings = Math.max(0, 100 - Math.round((burden / 36) * 100));

  const now = Date.now();
  const assessedDomains = RISK_DOMAINS.filter(domain => config.runs.some(run => run.domain === domain));
  if (assessedDomains.length === 0) {
    return fromFindings;
  }
  // Coverage: an unassessed domain is unknown risk, so it cannot count as assurance.
  const coverage = assessedDomains.length / RISK_DOMAINS.length;
  // Staleness: linear decay to 0.5 at twice the stale threshold.
  const oldestDays = Math.max(...assessedDomains.map(domain => {
    const run = config.runs.find(entry => entry.domain === domain)!;
    const parsed = Date.parse(run.ranAt);
    return Number.isNaN(parsed) ? RISK_STALE_DAYS * 2 : Math.floor((now - parsed) / 86_400_000);
  }));
  const freshness = oldestDays <= RISK_STALE_DAYS
    ? 1
    : Math.max(0.5, 1 - ((oldestDays - RISK_STALE_DAYS) / (RISK_STALE_DAYS * 2)) * 0.5);

  return Math.max(0, Math.min(100, Math.round(fromFindings * coverage * freshness)));
}

/** Analysis-run counts per day, so the Risk page can show assessment cadence. */
function buildRiskTrend(history: RiskOversightHistoryEntry[]): DashboardSeriesPoint[] {
  const runs = history.filter(entry => entry.kind === 'analysis-run');
  return buildDailySeries(runs.map(entry => entry.ranAt), SERIES_DAY_RANGE);
}

const DOC_IGNORE_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', 'vendor', '.vscode-test']);

/**
 * Bounded recursive walk for markdown files, skipping heavy/irrelevant folders
 * and hidden directories. Capped at `maxFiles` so a huge repo can't stall the
 * dashboard. Returns workspace-relative POSIX paths plus mtimes for freshness.
 */
async function listWorkspaceMarkdown(workspaceRoot: string, maxFiles = 600): Promise<Array<{ rel: string; mtimeMs: number }>> {
  const out: Array<{ rel: string; mtimeMs: number }> = [];
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    if (out.length >= maxFiles) {
      return;
    }
    const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
    for (const entry of entries) {
      if (out.length >= maxFiles) {
        return;
      }
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || DOC_IGNORE_DIRS.has(entry.name)) {
          continue;
        }
        await walk(path.join(absDir, entry.name), rel);
      } else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
        try {
          const stat = await fs.stat(path.join(absDir, entry.name));
          out.push({ rel, mtimeMs: stat.mtimeMs });
        } catch {
          // Unreadable file — skip it.
        }
      }
    }
  };
  await walk(workspaceRoot, '');
  return out;
}

async function collectDocumentsSnapshot(atlas: AtlasMindContext, workspaceRoot: string | undefined): Promise<DashboardDocumentsSnapshot> {
  const filePath = DOCUMENTS_SSOT_PATH;
  const summaryPath = DOCUMENTS_SUMMARY_SSOT_PATH;
  const config = atlas.documentsManager?.getConfig();
  if (!workspaceRoot) {
    return {
      filePath, summaryPath,
      configured: Boolean(config),
      filing: [], autoUpdate: [],
      totalMarkdown: 0, markdownCapped: false,
      reviewDueCount: 0, missingCount: 0,
      uncovered: [],
      summary: 'Open a workspace to manage its documents.',
    };
  }

  const MAX_MD = 600;
  const markdown = await listWorkspaceMarkdown(workspaceRoot, MAX_MD);
  const markdownCapped = markdown.length >= MAX_MD;
  const totalMarkdown = markdown.length;
  const now = Date.now();

  const filing: DashboardDocumentFilingView[] = (config?.filing ?? []).map(entry => {
    const prefix = entry.path.replace(/\/+$/, '');
    const inFolder = markdown.filter(md => md.rel === prefix || md.rel.startsWith(`${prefix}/`));
    return {
      id: entry.id,
      label: entry.label,
      path: entry.path,
      ...(entry.description ? { description: entry.description } : {}),
      ...(entry.pattern ? { pattern: entry.pattern } : {}),
      exists: existsSync(path.join(workspaceRoot, entry.path)),
      markdownCount: inFolder.length,
    };
  });

  const autoUpdate: DashboardDocumentAutoView[] = [];
  for (const entry of config?.autoUpdate ?? []) {
    let exists = false;
    let mtimeMs = 0;
    try {
      const stat = await fs.stat(path.join(workspaceRoot, entry.path));
      exists = stat.isFile();
      mtimeMs = stat.mtimeMs;
    } catch {
      exists = false;
    }
    let status: DashboardDocumentAutoView['status'];
    let detail: string;
    if (!exists) {
      status = 'missing';
      detail = `Not found at ${entry.path}.`;
    } else if (!entry.lastReviewed) {
      status = 'unknown';
      detail = 'Not reviewed yet — mark it reviewed once it is current.';
    } else {
      const reviewedMs = Date.parse(entry.lastReviewed);
      const changedSinceReview = Number.isFinite(reviewedMs) && mtimeMs > reviewedMs;
      const daysSince = Number.isFinite(reviewedMs) ? (now - reviewedMs) / 86_400_000 : Infinity;
      const overdueWeekly = entry.cadence === 'weekly' && daysSince > 7;
      if (changedSinceReview) {
        status = 'review-due';
        detail = `Changed since last review (${entry.lastReviewed.slice(0, 10)}).`;
      } else if (overdueWeekly) {
        status = 'review-due';
        detail = `Weekly review overdue (last ${entry.lastReviewed.slice(0, 10)}).`;
      } else {
        status = 'fresh';
        detail = `Reviewed ${entry.lastReviewed.slice(0, 10)}; no changes since.`;
      }
    }
    const statusLabel = status === 'missing' ? 'Missing'
      : status === 'review-due' ? 'Review due'
      : status === 'fresh' ? 'Up to date'
      : 'Not reviewed';
    autoUpdate.push({
      id: entry.id,
      path: entry.path,
      ...(entry.label ? { label: entry.label } : {}),
      ...(entry.sourceHint ? { sourceHint: entry.sourceHint } : {}),
      cadence: entry.cadence,
      ...(entry.lastReviewed ? { lastReviewed: entry.lastReviewed } : {}),
      exists,
      ...(exists ? { lastModified: new Date(mtimeMs).toISOString() } : {}),
      status,
      statusLabel,
      detail,
      updatePrompt: `Review ${entry.path} and update it so it is current${entry.sourceHint ? `. It should track: ${entry.sourceHint}` : ''}. Make the smallest correct edits, preserve the document's structure, and summarize what changed. Do not modify unrelated files.`,
    });
  }

  const reviewDueCount = autoUpdate.filter(entry => entry.status === 'review-due').length;
  const missingCount = autoUpdate.filter(entry => entry.status === 'missing').length;

  // Markdown files not covered by any shelf or tracked file — bounded suggestions.
  const coveredExact = new Set((config?.autoUpdate ?? []).map(entry => entry.path));
  const filingPrefixes = (config?.filing ?? []).map(entry => entry.path.replace(/\/+$/, ''));
  const uncovered = markdown
    .map(md => md.rel)
    .filter(rel => !rel.startsWith('project_memory/')) // SSOT memory is managed separately
    .filter(rel => !coveredExact.has(rel))
    .filter(rel => !filingPrefixes.some(prefix => rel === prefix || rel.startsWith(`${prefix}/`)))
    .slice(0, 12);

  const configured = Boolean(config) && (((config?.filing.length ?? 0) > 0) || ((config?.autoUpdate.length ?? 0) > 0));
  let summary: string;
  if (!configured) {
    summary = 'No document filing system defined yet. Seed one from your repo, or add shelves and tracked documents to keep them current.';
  } else {
    const parts = [
      `${filing.length} ${filing.length === 1 ? 'shelf' : 'shelves'}`,
      `${autoUpdate.length} tracked document${autoUpdate.length === 1 ? '' : 's'}`,
    ];
    if (reviewDueCount > 0) {
      parts.push(`${reviewDueCount} need${reviewDueCount === 1 ? 's' : ''} review`);
    }
    if (missingCount > 0) {
      parts.push(`${missingCount} missing`);
    }
    summary = `${parts.join(' · ')}.`;
  }

  // Surfaced rather than kept internal: an explicit save *will* write over a
  // newer-format file, so the user has to have been told it exists first.
  const fileNotice = atlas.documentsManager?.getNotice();
  return {
    filePath, summaryPath, configured,
    filing, autoUpdate,
    totalMarkdown, markdownCapped,
    reviewDueCount, missingCount,
    uncovered, summary,
    ...(fileNotice ? { fileNotice } : {}),
  };
}

async function collectRoadmapSnapshot(workspaceRoot: string | undefined, ssotPath: string): Promise<DashboardRoadmapSnapshot> {
  const filePath = `${ssotPath}/roadmap/improvement-plan.md`;
  if (!workspaceRoot) {
    const gates = normalizeGates([]);
    return {
      filePath,
      items: [],
      completedCount: 0,
      outstandingCount: 0,
      nextSuggestedWork: [],
      mvp: buildMvpSnapshot([], MVP_GATE_ID),
      gates: buildGateViews(gates, []),
      gateRoutes: buildGateRoutes(gates, []),
    };
  }

  const absolutePath = path.join(workspaceRoot, ssotPath, 'roadmap', 'improvement-plan.md');
  const content = await fs.readFile(absolutePath, 'utf-8').catch(() => '');
  const gates = parseRoadmapGates(content);
  const items = prioritizeDashboardRoadmapItems(parseDashboardRoadmapItems(content, gates));

  return {
    filePath,
    items,
    completedCount: items.filter(item => item.completed).length,
    outstandingCount: items.filter(item => !item.completed).length,
    nextSuggestedWork: items.filter(item => !item.completed).slice(0, 5),
    mvp: buildMvpSnapshot(items, MVP_GATE_ID),
    gates: buildGateViews(gates, items),
    gateRoutes: buildGateRoutes(gates, items),
  };
}

/** Per-gate progress, so the gate selector can show it without a route walk. */
function buildGateViews(gates: RoadmapGate[], items: DashboardRoadmapItem[]): DashboardRoadmapGateView[] {
  return gates.map(gate => {
    const tagged = items.filter(item => item.gates.includes(gate.id));
    const completedCount = tagged.filter(item => item.completed).length;
    return {
      ...gate,
      totalCount: tagged.length,
      completedCount,
      progressPercent: tagged.length > 0 ? Math.round((completedCount / tagged.length) * 100) : 0,
    };
  });
}

/**
 * A route per gate, computed up front.
 *
 * Switching gates in the UI is then instant and offline — the alternative
 * (asking the extension to recompute the selected gate) turns a view toggle into
 * a message round trip that can fail.
 */
function buildGateRoutes(gates: RoadmapGate[], items: DashboardRoadmapItem[]): Record<string, DashboardMvpSnapshot> {
  const routes: Record<string, DashboardMvpSnapshot> = {};
  for (const gate of gates.slice(0, MAX_ROADMAP_GATES)) {
    routes[gate.id] = buildMvpSnapshot(items, gate.id, gate.label);
  }
  return routes;
}

function parseDashboardRoadmapItems(content: string, gates: RoadmapGate[]): Array<{ id: string; text: string; completed: boolean; isMvp: boolean; gates: string[] }> {
  const region = extractRoadmapItemsRegion(content);
  const seen = new Set<string>();
  return [...region.matchAll(/^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/gm)]
    .map(match => {
      const raw = match[1]?.trim() ?? '';
      const completed = /^(?:✅|\[x\])/i.test(raw);
      const withoutCheckbox = raw.replace(/^(?:✅|\[(?:x| )\])\s*/i, '').trim();
      // Gate tags are metadata: keep them out of the displayed text and carry
      // them as ids. Only declared gates are recognised, so an item mentioning
      // "#2" keeps its wording.
      const parsed = extractItemGates(withoutCheckbox, gates);
      return { text: parsed.text, completed, isMvp: parsed.gates.includes(MVP_GATE_ID), gates: parsed.gates };
    })
    // Drop generator scaffolding (Project Context / Prioritisation Notes) …
    .filter(item => !isRoadmapNoiseItem(item.text))
    // … and collapse duplicates the generator emitted repeatedly.
    .filter(item => {
      const key = normalizeRoadmapText(item.text);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    // Assign stable sequential ids only after filtering so ids stay contiguous.
    .map((item, index) => ({ id: `roadmap-${index + 1}`, ...item }));
}

function prioritizeDashboardRoadmapItems(items: Array<{ id: string; text: string; completed: boolean; isMvp?: boolean; gates?: string[] }>): DashboardRoadmapItem[] {
  return items
    .map((item, index, allItems) => {
      const normalized = item.text.toLowerCase();
      const orderBoost = Math.max(1, allItems.length - index) * 2;
      let focus: DashboardRoadmapItem['focus'] = 'feature';
      let focusBoost = 0;
      const reasons = ['higher in the manually ordered backlog'];

      if (/\b(security|secure|auth|authentication|authorization|secret|token|credential|permission|vulnerability|owasp|compliance|privacy|encryption)\b/i.test(normalized)) {
        focus = 'security';
        focusBoost += 8;
        reasons.push('security / trust-boundary work');
      } else if (/\b(architecture|architectural|design|refactor|boundary|provider|routing|schema|migration|core)\b/i.test(normalized)) {
        focus = 'architecture';
        focusBoost += 6;
        reasons.push('architectural leverage');
      } else if (/\b(test|tdd|ci|lint|verification|release|build|deploy|performance|reliability)\b/i.test(normalized)) {
        focus = 'delivery';
        focusBoost += 4;
        reasons.push('delivery confidence');
      } else if (/\b(readme|docs?|wiki|changelog|copy)\b/i.test(normalized)) {
        focus = 'documentation';
        focusBoost += 1;
        reasons.push('documentation follow-through');
      } else {
        focusBoost += 3;
        reasons.push('product progress');
      }

      if (/\b(critical|urgent|blocker|production|outage|bug|regression|failing)\b/i.test(normalized)) {
        focusBoost += 5;
        reasons.push('critical/blocking wording');
      }

      const foundational = focus === 'security'
        || focus === 'architecture'
        || /\b(core|auth|foundation|foundational|baseline|essential|launch|ship|release|minimum viable|mvp|must|critical|first)\b/i.test(normalized);

      const gates = Array.isArray(item.gates) ? [...item.gates] : [];
      if (item.isMvp === true && !gates.includes(MVP_GATE_ID)) {
        gates.push(MVP_GATE_ID);
      }
      return {
        ...item,
        gates,
        isMvp: gates.includes(MVP_GATE_ID),
        mvpCandidate: !item.completed && foundational,
        focus,
        priorityScore: orderBoost + focusBoost,
        priorityReason: reasons.join(', '),
      };
    })
    .sort((left, right) => {
      if (left.completed !== right.completed) {
        return left.completed ? 1 : -1;
      }
      return right.priorityScore - left.priorityScore || left.id.localeCompare(right.id);
    });
}

const MVP_PHASE_WEIGHT: Record<DashboardRoadmapItem['focus'], number> = {
  security: 0,
  architecture: 1,
  delivery: 2,
  feature: 3,
  documentation: 4,
};

function describeMvpRationale(focus: DashboardRoadmapItem['focus'], completed: boolean): string {
  if (completed) {
    return 'Milestone already delivered.';
  }
  switch (focus) {
    case 'security':
      return 'Foundation — clear the trust boundary before building on top of it.';
    case 'architecture':
      return 'Architectural leverage that unblocks the later MVP work.';
    case 'delivery':
      return 'Delivery hardening so the MVP can ship with confidence.';
    case 'documentation':
      return 'Documentation follow-through to make the MVP usable.';
    default:
      return 'User-facing value that the MVP needs to demonstrate.';
  }
}

function toMvpStep(item: DashboardRoadmapItem, order: number): DashboardMvpStep {
  return {
    id: item.id,
    text: item.text,
    focus: item.focus,
    completed: item.completed,
    order,
    rationale: describeMvpRationale(item.focus, item.completed),
    tagged: item.isMvp,
  };
}

function orderMvpItems(items: DashboardRoadmapItem[]): DashboardRoadmapItem[] {
  return [...items].sort((left, right) => {
    if (left.completed !== right.completed) {
      return left.completed ? 1 : -1;
    }
    const phaseDelta = MVP_PHASE_WEIGHT[left.focus] - MVP_PHASE_WEIGHT[right.focus];
    if (phaseDelta !== 0) {
      return phaseDelta;
    }
    return right.priorityScore - left.priorityScore || left.id.localeCompare(right.id);
  });
}

/**
 * The route to a single gate.
 *
 * The MVP gate keeps its heuristic fallback — an untagged project still gets a
 * suggested foundation path, which is how the section earns its place before
 * anyone has tagged anything. A **user-created** gate does not: guessing which
 * items belong to someone's "v2" would be inventing a release plan, so an empty
 * gate is reported as empty.
 */
function buildMvpSnapshot(items: DashboardRoadmapItem[], gateId: string = MVP_GATE_ID, gateLabel = 'MVP'): DashboardMvpSnapshot {
  const isMvpGate = gateId === MVP_GATE_ID;
  const tagged = items.filter(item => item.gates.includes(gateId));
  const hasTaggedItems = tagged.length > 0;

  // Hybrid (MVP gate only): explicit tags define the path; otherwise fall back to
  // the strongest heuristic candidates so the section is still useful unconfigured.
  const pathItems = hasTaggedItems
    ? tagged
    : isMvpGate
      ? orderMvpItems(items.filter(item => item.mvpCandidate)).slice(0, 5)
      : [];

  const route = orderMvpItems(pathItems).map((item, index) => toMvpStep(item, index + 1));
  const completedCount = route.filter(step => step.completed).length;
  const totalCount = route.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const nextStep = route.find(step => !step.completed);

  // Heuristic candidates not already on the path, offered as "add to this gate".
  // Only for the MVP gate — the heuristic recognises foundational work, which is
  // not a claim about which release something belongs to.
  const pathIds = new Set(pathItems.map(item => item.id));
  const candidates = hasTaggedItems && isMvpGate
    ? orderMvpItems(items.filter(item => item.mvpCandidate && !pathIds.has(item.id)))
        .slice(0, 5)
        .map((item, index) => toMvpStep(item, index + 1))
    : [];

  const outstanding = route.filter(step => !step.completed);
  const label = isMvpGate ? 'MVP' : gateLabel;
  let summary: string;
  if (totalCount === 0) {
    summary = isMvpGate
      ? 'No MVP path yet. Tag the roadmap items that define your minimum viable product with “Mark MVP”.'
      : `Nothing is tagged for ${label} yet. Tag the backlog items that belong to this release to build its path.`;
  } else if (!hasTaggedItems) {
    summary = `No items tagged for MVP yet — showing ${totalCount} suggested foundation${totalCount === 1 ? '' : 's'}. ${nextStep ? `Start with: ${nextStep.text}.` : ''}`.trim();
  } else if (outstanding.length === 0) {
    summary = isMvpGate
      ? `All ${totalCount} MVP milestone${totalCount === 1 ? '' : 's'} complete — the minimum viable product is in reach.`
      : `All ${totalCount} ${label} milestone${totalCount === 1 ? '' : 's'} complete.`;
  } else {
    summary = `${completedCount} of ${totalCount} ${label} milestone${totalCount === 1 ? '' : 's'} complete${nextStep ? ` — next: ${nextStep.text}.` : '.'}`;
  }

  const planPrompt = buildMvpPlanPrompt(outstanding, hasTaggedItems, label);

  return {
    hasTaggedItems,
    totalCount,
    completedCount,
    progressPercent,
    route,
    nextStep,
    candidates,
    summary,
    planPrompt,
  };
}

function buildMvpPlanPrompt(outstanding: DashboardMvpStep[], hasTaggedItems: boolean, gateLabel = 'MVP'): string {
  const isMvp = gateLabel === 'MVP';
  const target = isMvp ? 'a minimum viable product' : `the ${gateLabel} release`;
  if (outstanding.length === 0) {
    return `Review the roadmap in project_memory/roadmap/improvement-plan.md and recommend what the next ${isMvp ? 'minimum-viable-product' : gateLabel} milestone should be, given that the currently tracked ${gateLabel} items are all complete. Keep it concise and call out the single best next step.`;
  }
  const list = outstanding.map((step, index) => `${index + 1}. ${step.text}`).join('\n');
  const tagNote = hasTaggedItems
    ? `These are the roadmap items currently tagged for the ${gateLabel} path:`
    : `No items are tagged for ${gateLabel} yet; these are the foundational roadmap items the dashboard suggests for the ${gateLabel} path:`;
  return [
    `Plan the fastest safe route to ${target} for this project.`,
    tagNote,
    list,
    'Recommend an ordered sequence that front-loads foundational, security, and architectural work, calls out dependencies between the items, and identifies the single best next step to take now. Keep the response concise.',
  ].join('\n\n');
}

function serializeDashboardRoadmapDocument(
  existing: string,
  items: Array<{ text: string; completed: boolean; isMvp?: boolean; gates?: string[] }>,
  gates: RoadmapGate[] = normalizeGates([]),
): string {
  const declaredGates = normalizeGates(gates);
  const normalizedItems = items.filter(item => item.text.trim().length > 0);
  const itemLines = normalizedItems.length > 0
    ? normalizedItems.map(item => {
        const selected = item.gates ?? (item.isMvp ? [MVP_GATE_ID] : []);
        return `- [${item.completed ? 'x' : ' '}] ${item.text.trim()}${formatItemGateTags(selected, declaredGates)}`;
      })
    : ['- [ ] Add the first prioritized roadmap item here.'];

  const section = [
    '## Prioritized Backlog',
    ROADMAP_ITEMS_START,
    ...itemLines,
    ROADMAP_ITEMS_END,
  ].join('\n');

  // The gates block is only written once a project has gates beyond the built-in
  // MVP one, so a roadmap that never uses them is left exactly as it was.
  const withGates = (document: string): string => (
    declaredGates.length > 1 || document.includes(ROADMAP_GATES_START)
      ? upsertRoadmapGatesBlock(document, declaredGates, ROADMAP_ITEMS_END)
      : document
  );

  if (existing.includes(ROADMAP_ITEMS_START) && existing.includes(ROADMAP_ITEMS_END)) {
    return withGates(existing.replace(
      new RegExp(`${escapeRegExp(ROADMAP_ITEMS_START)}[\\s\\S]*?${escapeRegExp(ROADMAP_ITEMS_END)}`, 'g'),
      [ROADMAP_ITEMS_START, ...itemLines, ROADMAP_ITEMS_END].join('\n'),
    ));
  }

  const preservedNotes = existing.trim().length > 0 ? `\n\n## Existing Notes\n${existing.trim()}\n` : '\n';
  return withGates([
    '# Developer Roadmap',
    '',
    'This file is the developer-facing backlog AtlasMind should absorb into SSOT and consult when deciding what to tackle next.',
    '',
    '> Priority order matters: items nearer the top receive more weight, but AtlasMind should still weigh criticality, security, architecture, delivery risk, and fresh execution evidence before choosing the next task.',
    '',
    section,
    '',
    '## Prioritisation Notes',
    '1. Critical, security, reliability, or production-blocking work.',
    '2. Architectural integrity and changes that unlock safer future work.',
    '3. User-facing outcomes and the manual order of this backlog.',
    '4. Delivery hygiene such as tests, CI, release notes, and docs.',
    preservedNotes.trimEnd(),
  ].filter(Boolean).join('\n'));
}

/**
 * Exported for tests. The component list carries a normalisation invariant (the
 * headline score is derived from the maxScores present, not a hard-coded 100) and
 * a safety one (risk is absent until assessed) that are worth pinning directly.
 */
export function buildScoreBreakdown(input: {
  ssotPath: string;
  securityPolicyPresent: boolean;
  codeownersPresent: boolean;
  prTemplatePresent: boolean;
  workflowCount: number;
  dirty: boolean;
  behind: number;
  ssotCoveragePercent: number;
  blockedEntries: number;
  warnedEntries: number;
  totalEntries: number;
  autopilot: boolean;
  governanceProviderCount: number;
  allowTerminalWrite: boolean;
  autoVerifyAfterWrite: boolean;
  ciSignals: Array<{ label: string; ok: boolean }>;
  reviewReadiness: Array<{ label: string; ok: boolean }>;
  outcomeCompleteness: DashboardOutcomeCompleteness;
  risk: DashboardRiskSnapshot;
  privacy: DashboardPrivacySnapshot;
}): DashboardScoreBreakdown {
  const components: DashboardScoreComponent[] = [
    {
      id: 'security',
      label: 'Security posture',
      score: Math.max(0, Math.min(22,
        (input.securityPolicyPresent ? 8 : 0)
        + (input.codeownersPresent ? 4 : 0)
        + (input.prTemplatePresent ? 3 : 0)
        + (input.autoVerifyAfterWrite ? 3 : 0)
        + (!input.allowTerminalWrite ? 2 : 0)
        + (!input.autopilot ? 2 : 0)
        - (input.blockedEntries > 0 ? 6 : 0))),
      maxScore: 22,
      detail: `${input.securityPolicyPresent ? 'Security policy present' : 'Security policy missing'}, ${input.blockedEntries} blocked SSOT entr${input.blockedEntries === 1 ? 'y' : 'ies'}, autopilot ${input.autopilot ? 'enabled' : 'disabled'}.`,
      tone: input.blockedEntries > 0 || input.autopilot ? 'warn' : 'good',
      pageTarget: 'security',
    },
    {
      id: 'repo',
      label: 'Repo hygiene',
      score: Math.max(0, Math.min(12,
        (input.dirty ? 0 : 6)
        + (input.behind === 0 ? 3 : 0)
        + (input.workflowCount > 0 ? 3 : 0))),
      maxScore: 12,
      detail: `${input.dirty ? 'Local changes still pending.' : 'Working tree is clean.'} ${input.behind === 0 ? 'Branch is current.' : `${input.behind} upstream commit(s) missing locally.`}`,
      tone: input.dirty || input.behind > 0 ? 'warn' : 'good',
      pageTarget: 'repo',
    },
    {
      id: 'ssot',
      label: 'SSOT coverage',
      score: Math.max(0, Math.min(18,
        Math.round(input.ssotCoveragePercent * 0.14)
        + (input.totalEntries > 0 ? 4 : 0)
        - (input.warnedEntries > 4 ? 2 : 0))),
      maxScore: 18,
      detail: `${input.ssotCoveragePercent}% directory coverage with ${input.totalEntries} indexed entries and ${input.warnedEntries} warned entr${input.warnedEntries === 1 ? 'y' : 'ies'}.`,
      tone: input.ssotCoveragePercent >= 80 && input.warnedEntries <= 4 ? 'good' : 'warn',
      pageTarget: 'ssot',
    },
    {
      id: 'delivery',
      label: 'Delivery flow',
      score: Math.max(0, Math.min(18,
        (input.workflowCount > 0 ? 6 : 0)
        + Math.round((input.ciSignals.filter(signal => signal.ok).length / Math.max(input.ciSignals.length, 1)) * 6)
        + Math.round((input.reviewReadiness.filter(signal => signal.ok).length / Math.max(input.reviewReadiness.length, 1)) * 6))),
      maxScore: 18,
      detail: `${input.ciSignals.filter(signal => signal.ok).length}/${input.ciSignals.length} CI signals and ${input.reviewReadiness.filter(signal => signal.ok).length}/${input.reviewReadiness.length} review signals are in place.`,
      tone: input.workflowCount > 0 && input.ciSignals.every(signal => signal.ok) ? 'good' : 'warn',
      pageTarget: 'delivery',
    },
    {
      id: 'governance',
      label: 'Governance automation',
      score: Math.min(10, input.governanceProviderCount * 5),
      maxScore: 10,
      detail: `${input.governanceProviderCount} dependency-governance provider${input.governanceProviderCount === 1 ? '' : 's'} detected.`,
      tone: input.governanceProviderCount > 0 ? 'good' : 'warn',
      pageTarget: 'security',
    },
    {
      id: 'outcome',
      label: 'Outcome completeness',
      score: Math.round(input.outcomeCompleteness.score * 0.2),
      maxScore: 20,
      detail: input.outcomeCompleteness.summary,
      tone: input.outcomeCompleteness.score >= 75 ? 'good' : input.outcomeCompleteness.score >= 55 ? 'accent' : 'warn',
      pageTarget: 'score',
    },
  ];

  // Risk and Privacy are always present, so an area nobody has looked at costs
  // points rather than quietly leaving the denominator.
  //
  // This reverses an earlier decision. Risk used to be omitted until an advisor
  // had run, on the reasoning that an unassessed exposure is *unknown* rather
  // than zero, and that scoring it 0/15 would silently drop every project's
  // health number. That protected the number at the cost of the thing the number
  // is for: with the component absent, a project that has never been assessed
  // scores identically to one assessed and found clean, which is the one
  // comparison the score most needs to make.
  //
  // The "unknown, not failing" concern is real and is handled in presentation
  // rather than by omission: an unassessed area scores 0 but is toned `warn`,
  // not `critical`, and its detail says the points are *unclaimed* and names the
  // action that claims them. A recommendation is raised alongside it.
  const riskAssessed = input.risk.assessed && input.risk.score !== undefined;
  const riskScore = riskAssessed ? input.risk.score! : 0;
  components.push({
    id: 'risk',
    label: 'Risk oversight',
    score: riskAssessed ? Math.round((riskScore / 100) * 15) : 0,
    maxScore: 15,
    detail: riskAssessed
      ? input.risk.summary
      : 'Not yet assessed — 15 points unclaimed. Run the ethics, legal and commercial advisors to claim them; an unassessed project is unknown, not safe.',
    tone: !riskAssessed
      ? 'warn'
      : riskScore >= 80 ? 'good' : riskScore >= 55 ? 'accent' : riskScore >= 30 ? 'warn' : 'critical',
    pageTarget: 'risk',
  });

  // Privacy: the data boundary between this workspace and an un-trusted model.
  // Scored on whether the gate is on, whether anything actually classifies, and
  // whether the model estate has been curated — not on how many matches fired,
  // which measures the project's content rather than its posture.
  const privacyEnabled = input.privacy.enabled;
  const privacyHasRules = input.privacy.compliancePacks.length > 0
    || input.privacy.rules.some(rule => rule.enabled);
  const privacyHasTrustedModels = input.privacy.trustedModelIds.length > 0;
  const privacyConfigured = privacyEnabled || privacyHasRules || privacyHasTrustedModels;
  const privacyScore = (privacyEnabled ? 5 : 0)
    + (privacyHasRules ? 4 : 0)
    + (privacyHasTrustedModels ? 3 : 0);
  components.push({
    id: 'privacy',
    label: 'Data privacy',
    score: privacyScore,
    maxScore: 12,
    detail: !privacyConfigured
      ? 'Not yet configured — 12 points unclaimed. Turn the gate on and choose the compliance packs that match your data to claim them.'
      : `${privacyEnabled ? 'Gate on' : 'Gate off'} • ${input.privacy.compliancePacks.length} compliance pack(s), ${input.privacy.rules.filter(rule => rule.enabled).length} active rule(s), ${input.privacy.trustedModelIds.length} trusted model(s).`,
    tone: !privacyConfigured ? 'warn' : privacyScore >= 10 ? 'good' : privacyScore >= 6 ? 'accent' : 'warn',
    pageTarget: 'privacy',
  });

  const recommendations: DashboardScoreRecommendation[] = [];

  // An unclaimed area costs more than most things a project can fix, so these
  // lead — and they say what the points are worth, because a score that drops
  // without explaining itself is just noise.
  if (!riskAssessed) {
    recommendations.push({
      horizon: 'short',
      title: 'Assess risk oversight',
      detail: 'Ethics, legal and commercial exposure has never been reviewed on this project. The score counts that as unclaimed rather than clean, so 15 points are currently withheld.',
      impactLabel: '+15 pts',
      pageTarget: 'risk',
    });
  }
  if (!privacyConfigured) {
    recommendations.push({
      horizon: 'short',
      title: 'Configure the data privacy gate',
      detail: 'Nothing currently classifies workspace content before it reaches a model. Turn the gate on and select the compliance packs that match the data this project handles.',
      impactLabel: '+12 pts',
      pageTarget: 'privacy',
    });
  }

  if (input.blockedEntries > 0) {
    recommendations.push({
      horizon: 'short',
      title: 'Resolve blocked SSOT entries',
      detail: 'Sanitize or rewrite blocked memory files first so the dashboard score is not overstating operational readiness while AtlasMind is excluding context.',
      impactLabel: 'High risk reduction',
      actionPrompt: 'Address this Project Dashboard recommendation: resolve blocked SSOT entries. Inspect the blocked memory material AtlasMind is excluding, make the smallest safe change that removes at least the first blocked item, and summarize what was fixed plus any remaining blocked files.',
      pageTarget: 'ssot',
    });
  }
  if (input.dirty || input.behind > 0) {
    recommendations.push({
      horizon: 'short',
      title: 'Stabilize the working tree',
      detail: 'Reduce branch drift and pending local changes before broadening delivery work, otherwise the operational score is propped up by incomplete repo hygiene.',
      impactLabel: 'Fast hygiene gain',
      actionPrompt: 'Address this Project Dashboard recommendation: stabilize the working tree. Review the current branch drift and local modifications, resolve the smallest meaningful repo-hygiene issue in one pass if possible, otherwise leave the workspace with a clear first cleanup step and summarize what changed.',
      pageTarget: 'repo',
      command: 'workbench.view.scm',
    });
  }
  if (input.outcomeCompleteness.roadmapTotal === 0 || input.outcomeCompleteness.score < 55) {
    recommendations.push({
      horizon: 'short',
      title: 'Translate vision into tracked milestones',
      detail: 'Capture the desired project outcome as explicit roadmap checklist items so completion can be measured instead of inferred.',
      impactLabel: 'Raises outcome completeness',
      actionPrompt: 'Address this Project Dashboard recommendation: translate the project vision into tracked milestones. Update project_memory/roadmap/improvement-plan.md with the first measurable milestone or checklist set that moves the desired outcome from aspiration into execution, then summarize the next milestone that should follow.',
      filePath: `${input.ssotPath}/roadmap/improvement-plan.md`,
    });
  }
  if (input.workflowCount === 0 || input.ciSignals.some(signal => !signal.ok)) {
    recommendations.push({
      horizon: 'medium',
      title: 'Close delivery automation gaps',
      detail: 'Add or tighten CI workflows and missing compile/lint/test signals so delivery readiness contributes real evidence instead of documentation-only confidence.',
      impactLabel: 'Improves delivery confidence',
      actionPrompt: 'Address this Project Dashboard recommendation: close delivery automation gaps. Identify the first missing compile, lint, test, or workflow signal that can be added or repaired with a focused change, implement that improvement if it is small enough, and summarize the remaining delivery gaps afterward.',
      pageTarget: 'delivery',
    });
  }
  if (input.governanceProviderCount === 0) {
    recommendations.push({
      horizon: 'medium',
      title: 'Add dependency governance automation',
      detail: 'Introduce Dependabot, Renovate, or an equivalent provider so governance posture is continuously reinforced rather than manually reviewed.',
      impactLabel: 'Improves governance score',
      actionPrompt: 'Address this Project Dashboard recommendation: add dependency governance automation. Introduce the smallest defensible governance automation improvement for this repo, or if a full setup is too large for one pass, scaffold the first concrete piece and summarize what remains.',
      pageTarget: 'security',
    });
  }
  if (input.outcomeCompleteness.referenceCoveragePercent < 100) {
    recommendations.push({
      horizon: 'medium',
      title: 'Back the outcome with referenced evidence',
      detail: 'Make sure the project soul references resolve to live architecture, operations, and capability docs so the desired outcome is anchored in current evidence.',
      impactLabel: 'Strengthens outcome traceability',
      actionPrompt: 'Address this Project Dashboard recommendation: back the desired outcome with referenced evidence. Fix one missing or stale supporting reference so the project soul points to live architecture, operations, or capability documentation, then summarize which evidence link should be repaired next.',
      pageTarget: 'ssot',
    });
  }
  recommendations.push({
    horizon: 'long',
    title: 'Turn completion into a managed operating metric',
    detail: 'Evolve the roadmap and run telemetry so AtlasMind can compare stated outcome, shipped capabilities, and execution evidence as an ongoing operational loop.',
    impactLabel: 'Sustained score quality',
    actionPrompt: 'Address this Project Dashboard recommendation: turn completion into a managed operating metric. Start the smallest useful improvement that links roadmap progress, shipped capabilities, and run telemetry together, and summarize the next step needed to make outcome completeness a durable operational metric.',
    pageTarget: 'score',
  });

  return {
    components,
    outcome: input.outcomeCompleteness,
    recommendations,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function walkFiles(directoryPath: string, visitor: (filePath: string) => Promise<void>): Promise<void> {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    await Promise.all(entries.map(async entry => {
      const fullPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await walkFiles(fullPath, visitor);
        return;
      }
      await visitor(fullPath);
    }));
  } catch {
    // Ignore missing directories.
  }
}

async function countFiles(directoryPath: string): Promise<number> {
  let total = 0;
  await walkFiles(directoryPath, async () => {
    total += 1;
  });
  return total;
}

/**
 * Per-contributor commit series for the Overview charts.
 *
 * Exported for tests: the capping behaviour is the part worth pinning. A
 * repository with a long tail of one-commit authors would otherwise produce a
 * pie chart of unreadable slivers, so everyone past the cap is merged into a
 * single **Others** entry that still counts their commits — a chart that
 * silently dropped contributors would misreport who did the work.
 *
 * Names come from git's author field and are clamped; no addresses are read.
 */
export function buildContributorSeries(
  entries: Array<{ date: string; author: string }>,
  days: number,
  maxContributors = 8,
): { contributors: Array<{ name: string; total: number; series: DashboardSeriesPoint[] }>; totalCommits: number; otherCount: number } {
  const byAuthor = new Map<string, string[]>();
  let totalCommits = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.date !== 'string' || entry.date.trim().length === 0) {
      continue;
    }
    const name = (typeof entry.author === 'string' ? entry.author : '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Unknown';
    const dates = byAuthor.get(name) ?? [];
    dates.push(entry.date);
    byAuthor.set(name, dates);
    totalCommits += 1;
  }

  const ranked = [...byAuthor.entries()]
    .map(([name, dates]) => ({ name, dates, total: dates.length }))
    // Ties broken by name so the order (and therefore the colours) is stable
    // between renders rather than depending on Map insertion.
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));

  const kept = ranked.slice(0, Math.max(1, maxContributors));
  const overflow = ranked.slice(Math.max(1, maxContributors));
  const contributors = kept.map(entry => ({
    name: entry.name,
    total: entry.total,
    series: buildDailySeries(entry.dates, days),
  }));
  if (overflow.length > 0) {
    const overflowDates = overflow.flatMap(entry => entry.dates);
    contributors.push({
      name: `Others (${overflow.length})`,
      total: overflowDates.length,
      series: buildDailySeries(overflowDates, days),
    });
  }

  return { contributors, totalCommits, otherCount: overflow.reduce((sum, entry) => sum + entry.total, 0) };
}

function buildDailySeries(timestamps: string[], days: number): DashboardSeriesPoint[] {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const counts = new Map<string, number>();
  for (const timestamp of timestamps) {
    const isoDay = normalizeDateKey(timestamp);
    if (!isoDay) {
      continue;
    }
    counts.set(isoDay, (counts.get(isoDay) ?? 0) + 1);
  }

  const series: DashboardSeriesPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(end);
    day.setDate(end.getDate() - offset);
    const key = day.toISOString().slice(0, 10);
    series.push({
      date: key,
      label: day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      value: counts.get(key) ?? 0,
    });
  }
  return series;
}

function isIdeationRunPayload(value: unknown): value is IdeationRunPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['prompt'] !== 'string' || candidate['prompt'].trim().length === 0) {
    return false;
  }
  return typeof candidate['speakResponse'] === 'undefined' || typeof candidate['speakResponse'] === 'boolean';
}

function isIdeationBoardPayload(value: unknown): value is IdeationBoardPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate['cards']) || !Array.isArray(candidate['connections'])) {
    return false;
  }
  if (candidate['cards'].length > MAX_IDEATION_CARDS || candidate['connections'].length > MAX_IDEATION_CONNECTIONS) {
    return false;
  }
  return candidate['cards'].every(isIdeationCardRecord) && candidate['connections'].every(isIdeationConnectionRecord)
    && (typeof candidate['focusCardId'] === 'undefined' || typeof candidate['focusCardId'] === 'string')
    && (typeof candidate['nextPrompts'] === 'undefined' || (Array.isArray(candidate['nextPrompts']) && candidate['nextPrompts'].every(item => typeof item === 'string')));
}

function isIdeationCardRecord(value: unknown): value is IdeationCardRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && typeof candidate['title'] === 'string'
    && typeof candidate['body'] === 'string'
    && typeof candidate['kind'] === 'string'
    && typeof candidate['author'] === 'string'
    && typeof candidate['x'] === 'number'
    && typeof candidate['y'] === 'number'
    && typeof candidate['color'] === 'string'
    && Array.isArray(candidate['imageSources'])
    && typeof candidate['createdAt'] === 'string'
    && typeof candidate['updatedAt'] === 'string';
}

function isIdeationConnectionRecord(value: unknown): value is IdeationConnectionRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && typeof candidate['fromCardId'] === 'string'
    && typeof candidate['toCardId'] === 'string'
    && typeof candidate['label'] === 'string';
}

function createDefaultIdeationWorkspaceRecord(): IdeationWorkspaceRecord {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_IDEATION_WORKSPACE_ID,
    title: 'Primary ideation',
    boardFile: IDEATION_BOARD_FILE,
    summaryFile: IDEATION_SUMMARY_FILE,
    createdAt: now,
    updatedAt: now,
  };
}

function sanitizeIdeationWorkspaceId(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || DEFAULT_IDEATION_WORKSPACE_ID;
}

function ideationWorkspaceFileNames(workspaceId: string): { boardFile: string; summaryFile: string } {
  if (workspaceId === DEFAULT_IDEATION_WORKSPACE_ID) {
    return { boardFile: IDEATION_BOARD_FILE, summaryFile: IDEATION_SUMMARY_FILE };
  }
  return {
    boardFile: `atlas-ideation-board.${workspaceId}.json`,
    summaryFile: `atlas-ideation-board.${workspaceId}.md`,
  };
}

function sanitizeIdeationWorkspaceRegistry(value: Partial<IdeationWorkspaceRegistry> | IdeationWorkspaceRegistry): IdeationWorkspaceRegistry {
  const fallback = createDefaultIdeationWorkspaceRecord();
  const seen = new Set<string>();
  const workspaces = Array.isArray(value.workspaces)
    ? value.workspaces
      .filter((item): item is IdeationWorkspaceRecord => typeof item === 'object' && item !== null)
      .map(item => {
        const id = sanitizeIdeationWorkspaceId(typeof item.id === 'string' ? item.id : '');
        if (seen.has(id)) {
          return undefined;
        }
        seen.add(id);
        const files = ideationWorkspaceFileNames(id);
        return {
          id,
          title: clampText(typeof item.title === 'string' && item.title.trim() ? item.title : 'Untitled ideation', 80),
          boardFile: typeof item.boardFile === 'string' && item.boardFile.trim() ? path.basename(item.boardFile.trim()) : files.boardFile,
          summaryFile: typeof item.summaryFile === 'string' && item.summaryFile.trim() ? path.basename(item.summaryFile.trim()) : files.summaryFile,
          createdAt: typeof item.createdAt === 'string' && item.createdAt.trim() ? item.createdAt : new Date().toISOString(),
          updatedAt: typeof item.updatedAt === 'string' && item.updatedAt.trim() ? item.updatedAt : new Date().toISOString(),
        } satisfies IdeationWorkspaceRecord;
      })
      .filter((item): item is IdeationWorkspaceRecord => Boolean(item))
    : [fallback];
  const normalizedWorkspaces = workspaces.length > 0 ? workspaces : [fallback];
  return {
    version: 1,
    activeWorkspaceId: typeof value.activeWorkspaceId === 'string' && normalizedWorkspaces.some(item => item.id === value.activeWorkspaceId)
      ? value.activeWorkspaceId
      : normalizedWorkspaces[0].id,
    workspaces: normalizedWorkspaces,
  };
}

async function loadIdeationWorkspaceRegistry(workspaceRoot: string | undefined, ssotPath: string): Promise<IdeationWorkspaceRegistry> {
  if (!workspaceRoot) {
    return { version: 1, activeWorkspaceId: DEFAULT_IDEATION_WORKSPACE_ID, workspaces: [createDefaultIdeationWorkspaceRecord()] };
  }
  const registryPath = path.join(workspaceRoot, ssotPath, 'ideas', IDEATION_WORKSPACE_REGISTRY_FILE);
  try {
    const raw = await fs.readFile(registryPath, 'utf-8');
    return sanitizeIdeationWorkspaceRegistry(JSON.parse(raw) as Partial<IdeationWorkspaceRegistry>);
  } catch {
    return { version: 1, activeWorkspaceId: DEFAULT_IDEATION_WORKSPACE_ID, workspaces: [createDefaultIdeationWorkspaceRecord()] };
  }
}

async function persistIdeationWorkspaceRegistry(workspaceRoot: string | undefined, ssotPath: string, registry: IdeationWorkspaceRegistry): Promise<void> {
  if (!workspaceRoot) {
    return;
  }
  const ideasDir = path.join(workspaceRoot, ssotPath, 'ideas');
  await fs.mkdir(ideasDir, { recursive: true });
  await fs.writeFile(path.join(ideasDir, IDEATION_WORKSPACE_REGISTRY_FILE), JSON.stringify(sanitizeIdeationWorkspaceRegistry(registry), null, 2), 'utf-8');
}

async function loadActiveIdeationWorkspace(workspaceRoot: string | undefined, ssotPath: string): Promise<IdeationWorkspaceRecord> {
  const registry = await loadIdeationWorkspaceRegistry(workspaceRoot, ssotPath);
  return registry.workspaces.find(item => item.id === registry.activeWorkspaceId) ?? registry.workspaces[0] ?? createDefaultIdeationWorkspaceRecord();
}

async function touchActiveIdeationWorkspace(workspaceRoot: string | undefined, ssotPath: string, workspaceId: string, updatedAt: string): Promise<void> {
  const registry = await loadIdeationWorkspaceRegistry(workspaceRoot, ssotPath);
  await persistIdeationWorkspaceRegistry(workspaceRoot, ssotPath, {
    ...registry,
    activeWorkspaceId: workspaceId,
    workspaces: registry.workspaces.map(item => item.id === workspaceId ? { ...item, updatedAt } : item),
  });
}

async function loadIdeationBoard(
  workspaceRoot: string | undefined,
  ssotPath: string,
  workspace: IdeationWorkspaceRecord,
): Promise<IdeationBoardRecord> {
  if (!workspaceRoot) {
    return createDefaultIdeationBoard();
  }

  const boardPath = path.join(workspaceRoot, ssotPath, 'ideas', workspace.boardFile);
  try {
    const raw = await fs.readFile(boardPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<IdeationBoardRecord>;
    return sanitizeIdeationBoard(parsed);
  } catch {
    return createDefaultIdeationBoard();
  }
}

async function persistIdeationBoard(
  workspaceRoot: string | undefined,
  ssotPath: string,
  board: IdeationBoardRecord,
  workspace: IdeationWorkspaceRecord,
): Promise<void> {
  if (!workspaceRoot) {
    return;
  }

  const ideasDir = path.join(workspaceRoot, ssotPath, 'ideas');
  await fs.mkdir(ideasDir, { recursive: true });
  const sanitized = sanitizeIdeationBoard(board);
  await Promise.all([
    fs.writeFile(path.join(ideasDir, workspace.boardFile), JSON.stringify(sanitized, null, 2), 'utf-8'),
    fs.writeFile(path.join(ideasDir, workspace.summaryFile), buildIdeationSummaryMarkdown(sanitized), 'utf-8'),
  ]);
}

function createDefaultIdeationBoard(): IdeationBoardRecord {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    cards: [],
    connections: [],
    lastAtlasResponse: '',
    nextPrompts: [
      'Who is the primary user, and what job are they trying to complete?',
      'What is the sharpest constraint or risk this project needs to survive?',
      'What is the smallest experiment that would validate the idea quickly?',
    ],
    history: [],
  };
}

function sanitizeIdeationBoard(value: Partial<IdeationBoardRecord> | IdeationBoardRecord): IdeationBoardRecord {
  const fallback = createDefaultIdeationBoard();
  const cards = Array.isArray(value.cards)
    ? value.cards.filter(isIdeationCardRecord).slice(0, MAX_IDEATION_CARDS).map(sanitizeIdeationCard)
    : fallback.cards;
  const cardIds = new Set(cards.map(card => card.id));
  const connections = Array.isArray(value.connections)
    ? value.connections
      .filter(isIdeationConnectionRecord)
      .filter(connection => cardIds.has(connection.fromCardId) && cardIds.has(connection.toCardId))
      .slice(0, MAX_IDEATION_CONNECTIONS)
      .map(connection => ({
        id: connection.id.trim() || createIdeationId('link'),
        fromCardId: connection.fromCardId,
        toCardId: connection.toCardId,
        label: clampText(connection.label, 36),
      }))
    : fallback.connections;
  const history = Array.isArray(value.history)
    ? value.history
      .filter((entry): entry is IdeationHistoryEntry => typeof entry === 'object' && entry !== null && (entry['role'] === 'user' || entry['role'] === 'atlas') && typeof entry['content'] === 'string' && typeof entry['timestamp'] === 'string')
      .slice(-MAX_IDEATION_HISTORY)
      .map(entry => ({ role: entry.role, content: clampText(entry.content, 800), timestamp: normalizeIso(entry.timestamp) }))
    : fallback.history;

  const focusCardId = typeof value.focusCardId === 'string' && cardIds.has(value.focusCardId) ? value.focusCardId : undefined;
  const nextPrompts = Array.isArray(value.nextPrompts)
    ? value.nextPrompts.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).slice(0, 6).map(entry => clampText(entry, 140))
    : fallback.nextPrompts;

  return {
    version: 1,
    updatedAt: normalizeIso(value.updatedAt),
    cards,
    connections,
    focusCardId,
    lastAtlasResponse: typeof value.lastAtlasResponse === 'string' ? clampText(value.lastAtlasResponse, 4000) : fallback.lastAtlasResponse,
    nextPrompts,
    history,
  };
}

function sanitizeIdeationCard(card: IdeationCardRecord): IdeationCardRecord {
  return {
    id: card.id.trim() || createIdeationId('card'),
    title: clampText(card.title, 80) || 'Untitled idea',
    body: clampText(card.body, 320),
    kind: isIdeationCardKind(card.kind) ? card.kind : 'concept',
    author: card.author === 'atlas' ? 'atlas' : 'user',
    x: clampNumber(card.x, -1600, 1600),
    y: clampNumber(card.y, -1200, 1200),
    color: normalizeIdeationColor(card.color),
    imageSources: Array.isArray(card.imageSources) ? card.imageSources.filter(source => typeof source === 'string').slice(0, 4) : [],
    createdAt: normalizeIso(card.createdAt),
    updatedAt: normalizeIso(card.updatedAt),
  };
}

function isIdeationCardKind(value: string): value is IdeationCardKind {
  return ['concept', 'insight', 'question', 'opportunity', 'risk', 'experiment', 'user-need', 'atlas-response', 'attachment'].includes(value);
}

function normalizeIdeationColor(value: string): string {
  const allowed = new Set(['sun', 'sea', 'mint', 'rose', 'sand', 'storm']);
  const normalized = value.trim().toLowerCase();
  return allowed.has(normalized) ? normalized : 'sun';
}

function normalizeIso(value: unknown): string {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return new Date().toISOString();
}

function clampText(value: string, limit: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, limit);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function createIdeationId(prefix: 'card' | 'link'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildIdeationRelativePath(ssotPath: string, fileName: string): string {
  return `${ssotPath.replace(/\/$/, '')}/ideas/${fileName}`;
}

function summarizeIdeationBoard(board: IdeationBoardRecord): string {
  const cards = board.cards.slice(0, 10).map(card => `- [${card.kind}] ${card.title}: ${card.body}`).join('\n');
  const prompts = board.nextPrompts.map(prompt => `- ${prompt}`).join('\n');
  return [
    `Board cards: ${board.cards.length}.`,
    board.focusCardId ? `Focused card: ${board.cards.find(card => card.id === board.focusCardId)?.title ?? 'unknown'}.` : 'No focused card selected.',
    cards ? `Current board:\n${cards}` : 'Current board is empty.',
    prompts ? `Queued follow-up prompts:\n${prompts}` : 'No queued follow-up prompts.',
  ].join('\n\n');
}

function buildIdeationPrompt(
  prompt: string,
  board: IdeationBoardRecord,
  focusCard: IdeationCardRecord | undefined,
  attachments: TaskImageAttachment[],
): string {
  const boardSummary = summarizeIdeationBoard(board);
  const focusSummary = focusCard
    ? `Focused card:\nTitle: ${focusCard.title}\nType: ${focusCard.kind}\nBody: ${focusCard.body}`
    : 'There is no focused card yet. If the board is sparse, help bootstrap it.';
  const attachmentSummary = attachments.length > 0
    ? `Attached images:\n${attachments.map(attachment => `- ${attachment.source} (${attachment.mimeType})`).join('\n')}`
    : 'No images are attached for this ideation pass.';

  return [
    'You are AtlasMind running a project ideation workshop.',
    'Act like a structured facilitator: pressure-test the idea, surface user needs, risks, opportunities, and next experiments.',
    'Respond in markdown with concise, high-signal guidance for the user.',
    `After the markdown, append a JSON object inside <${IDEATION_RESPONSE_TAG}>...</${IDEATION_RESPONSE_TAG}> with this schema:`,
    '{"cards":[{"title":"string","body":"string","kind":"concept|insight|question|opportunity|risk|experiment|user-need","anchor":"center|north|east|south|west"}],"nextPrompts":["string"]}',
    'Return 2 to 5 cards. Keep card bodies short and actionable. Use anchors to spread cards around the focused card when relevant.',
    '',
    `User request: ${prompt}`,
    '',
    boardSummary,
    '',
    focusSummary,
    '',
    attachmentSummary,
  ].join('\n');
}

function parseIdeationResponse(response: string): IdeationResponseParseResult {
  const tagPattern = new RegExp(`<${IDEATION_RESPONSE_TAG}>([\\s\\S]*?)</${IDEATION_RESPONSE_TAG}>`, 'i');
  const match = response.match(tagPattern);
  const displayResponse = sanitizeIdeationDisplayResponse(response.replace(tagPattern, '').trim());
  if (!match) {
    return {
      displayResponse: displayResponse || 'Atlas updated the ideation board.',
      cards: [{
        title: 'Atlas insight',
        body: clampText(displayResponse || 'Atlas updated the ideation board.', 220),
        kind: 'atlas-response',
        anchor: 'east',
      }],
      nextPrompts: [],
    };
  }

  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const cards = Array.isArray(parsed['cards'])
      ? parsed['cards']
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .slice(0, 5)
        .map(entry => ({
          title: clampText(typeof entry['title'] === 'string' ? entry['title'] : 'Atlas insight', 80),
          body: clampText(typeof entry['body'] === 'string' ? entry['body'] : '', 220),
          kind: isIdeationCardKind(typeof entry['kind'] === 'string' ? entry['kind'] : '') ? entry['kind'] as IdeationCardKind : 'insight',
          anchor: isIdeationAnchor(typeof entry['anchor'] === 'string' ? entry['anchor'] : '') ? entry['anchor'] as IdeationAnchor : undefined,
        }))
      : [];
    const nextPrompts = Array.isArray(parsed['nextPrompts'])
      ? parsed['nextPrompts'].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).slice(0, 6).map(entry => clampText(entry, 140))
      : [];

    return {
      displayResponse: displayResponse || 'Atlas updated the ideation board.',
      cards: cards.length > 0 ? cards : [{ title: 'Atlas insight', body: clampText(displayResponse || 'Atlas updated the ideation board.', 220), kind: 'atlas-response', anchor: 'east' }],
      nextPrompts,
    };
  } catch {
    return {
      displayResponse: displayResponse || 'Atlas updated the ideation board.',
      cards: [{ title: 'Atlas insight', body: clampText(displayResponse || 'Atlas updated the ideation board.', 220), kind: 'atlas-response', anchor: 'east' }],
      nextPrompts: [],
    };
  }
}

function sanitizeIdeationDisplayResponse(response: string): string {
  const cleanedLines = response
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !/^the requested tool action did not complete successfully\.?$/i.test(line))
    .filter(line => !/^(tool|provider|model|router|routing|approval|retry|executing|running|calling)\b/i.test(line))
    .filter(line => !/^(i('| a)?m|i will|let me|next,? i('| a)?ll|first,? i('| a)?ll)\b/i.test(line))
    .filter(line => !/^```/.test(line));
  const cleaned = cleanedLines.join('\n\n').trim();
  return cleaned || 'Atlas updated the ideation board.';
}

function normalizeIdeationResponse(parsed: IdeationResponseParseResult): IdeationResponseParseResult {
  const displayResponse = sanitizeIdeationDisplayResponse(parsed.displayResponse);
  if (parsed.cards.length > 0) {
    return { ...parsed, displayResponse };
  }
  return {
    ...parsed,
    displayResponse,
    cards: [{
      title: 'Atlas insight',
      body: clampText(displayResponse, 220),
      kind: 'atlas-response',
      anchor: 'east',
    }],
  };
}

function isIdeationAnchor(value: string): value is IdeationAnchor {
  return ['center', 'north', 'east', 'south', 'west'].includes(value);
}

function applyIdeationResponse(
  board: IdeationBoardRecord,
  userPrompt: string,
  parsed: IdeationResponseParseResult,
  focusCardId: string | undefined,
  attachments: TaskImageAttachment[],
): IdeationBoardRecord {
  const nextBoard = sanitizeIdeationBoard(board);
  const now = new Date().toISOString();
  const focusCard = focusCardId ? nextBoard.cards.find(card => card.id === focusCardId) : undefined;
  const origin = focusCard ?? { x: 0, y: 0 };
  if (nextBoard.cards.length === 0) {
    nextBoard.cards.push({
      id: createIdeationId('card'),
      title: clampText(userPrompt, 80) || 'Project idea',
      body: clampText(userPrompt, 220),
      kind: 'concept',
      author: 'user',
      x: 0,
      y: 0,
      color: 'sun',
      imageSources: attachments.map(attachment => attachment.source).slice(0, 4),
      createdAt: now,
      updatedAt: now,
    });
  }
  const additions = parsed.cards.map((card, index) => createAtlasIdeationCard(card, origin.x, origin.y, index, attachments, now));

  nextBoard.cards = [...nextBoard.cards, ...additions].slice(-MAX_IDEATION_CARDS);
  const links = focusCard
    ? additions.map((card, index) => ({
      id: createIdeationId('link'),
      fromCardId: focusCard.id,
      toCardId: card.id,
      label: buildIdeationLinkLabel(card.kind, index),
    }))
    : [];
  nextBoard.connections = [...nextBoard.connections, ...links].slice(-MAX_IDEATION_CONNECTIONS);
  nextBoard.focusCardId = additions.at(0)?.id ?? nextBoard.focusCardId;
  nextBoard.lastAtlasResponse = parsed.displayResponse;
  nextBoard.nextPrompts = parsed.nextPrompts.length > 0 ? parsed.nextPrompts : nextBoard.nextPrompts;
  nextBoard.history = [
    ...nextBoard.history,
    { role: 'user' as const, content: clampText(userPrompt, 800), timestamp: now },
    { role: 'atlas' as const, content: parsed.displayResponse, timestamp: now },
  ].slice(-MAX_IDEATION_HISTORY);
  nextBoard.updatedAt = now;
  return sanitizeIdeationBoard(nextBoard);
}

function createAtlasIdeationCard(
  suggestion: IdeationStructuredSuggestion,
  baseX: number,
  baseY: number,
  index: number,
  attachments: TaskImageAttachment[],
  timestamp: string,
): IdeationCardRecord {
  const offset = ideationOffsetForAnchor(suggestion.anchor, index);
  return {
    id: createIdeationId('card'),
    title: clampText(suggestion.title, 80) || 'Atlas insight',
    body: clampText(suggestion.body, 220),
    kind: suggestion.kind,
    author: 'atlas',
    x: clampNumber(baseX + offset.x, -1600, 1600),
    y: clampNumber(baseY + offset.y, -1200, 1200),
    color: ideationColorForKind(suggestion.kind),
    imageSources: attachments.map(attachment => attachment.source).slice(0, 4),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function ideationOffsetForAnchor(anchor: IdeationAnchor | undefined, index: number): { x: number; y: number } {
  const fallbacks = [
    { x: 220, y: -84 },
    { x: 240, y: 54 },
    { x: 0, y: 200 },
    { x: -240, y: 54 },
    { x: -220, y: -84 },
  ];
  switch (anchor) {
    case 'north': return { x: 0, y: -220 };
    case 'east': return { x: 250, y: (index - 1) * 50 };
    case 'south': return { x: 0, y: 220 };
    case 'west': return { x: -250, y: (index - 1) * 50 };
    case 'center': return { x: 40 * index, y: 40 * index };
    default: return fallbacks[index % fallbacks.length];
  }
}

function ideationColorForKind(kind: IdeationCardKind): string {
  switch (kind) {
    case 'risk': return 'rose';
    case 'question': return 'sea';
    case 'experiment': return 'storm';
    case 'opportunity': return 'mint';
    case 'user-need': return 'sand';
    case 'atlas-response': return 'sea';
    default: return 'sun';
  }
}

function buildIdeationLinkLabel(kind: IdeationCardKind, index: number): string {
  if (kind === 'question') {
    return 'question';
  }
  if (kind === 'risk') {
    return 'risk';
  }
  if (kind === 'experiment') {
    return 'test';
  }
  return index === 0 ? 'expands' : 'supports';
}

function buildIdeationSummaryMarkdown(board: IdeationBoardRecord): string {
  const cards = board.cards.map(card => `- **${card.title}** [${card.kind}] (${card.author})\n  ${card.body || 'No notes yet.'}`).join('\n');
  const connections = board.connections.map(connection => `- ${connection.fromCardId} -> ${connection.toCardId}${connection.label ? ` (${connection.label})` : ''}`).join('\n');
  const prompts = board.nextPrompts.map(prompt => `- ${prompt}`).join('\n');
  return [
    '# AtlasMind Ideation Board',
    '',
    `Updated: ${board.updatedAt}`,
    '',
    '## Latest Atlas feedback',
    '',
    board.lastAtlasResponse || 'No Atlas feedback captured yet.',
    '',
    '## Cards',
    '',
    cards || '- No ideation cards yet.',
    '',
    '## Connections',
    '',
    connections || '- No connections yet.',
    '',
    '## Next prompts',
    '',
    prompts || '- No follow-up prompts yet.',
  ].join('\n');
}

function toDashboardBudgetMode(value: string | undefined): 'cheap' | 'balanced' | 'expensive' | 'auto' {
  return value === 'cheap' || value === 'balanced' || value === 'expensive' || value === 'auto' ? value : 'balanced';
}

function toDashboardSpeedMode(value: string | undefined): 'fast' | 'balanced' | 'considered' | 'auto' {
  return value === 'fast' || value === 'balanced' || value === 'considered' || value === 'auto' ? value : 'balanced';
}

function buildHealthSummary(input: { healthScore: number; blockedEntries: number; autopilot: boolean; dirty: boolean; workflowCount: number; outcomeScore: number }): string {
  if (input.blockedEntries > 0) {
    return 'Security scanning is actively excluding SSOT material from model context. Review blocked entries first.';
  }
  if (input.autopilot) {
    return 'Autopilot is enabled for this session. Review approval posture before executing write-capable workflows.';
  }
  if (input.dirty) {
    return 'The repo is carrying local changes. Review the current branch before widening delivery or review workflows.';
  }
  if (input.workflowCount === 0) {
    return 'No CI workflow files were detected. Delivery automation looks incomplete.';
  }
  if (input.outcomeScore < 55) {
    return 'The desired project outcome is documented only loosely. Translate the vision into roadmap evidence and execution telemetry.';
  }
  if (input.healthScore >= 85) {
    return 'Project signals look healthy: governance, SSOT coverage, delivery scaffolding, and outcome completeness are broadly aligned.';
  }
  return 'Core signals are present, but governance, SSOT coverage, delivery scaffolding, or outcome completeness still have visible gaps.';
}

function detectGovernanceProviders(workspaceRoot: string | undefined): string[] {
  if (!workspaceRoot) {
    return [];
  }

  const providers: string[] = [];
  if (pathExistsSync(path.join(workspaceRoot, '.github', 'dependabot.yml'))) {
    providers.push('Dependabot');
  }
  if (
    pathExistsSync(path.join(workspaceRoot, 'renovate.json')) ||
    pathExistsSync(path.join(workspaceRoot, 'renovate.json5')) ||
    pathExistsSync(path.join(workspaceRoot, '.github', 'renovate.json'))
  ) {
    providers.push('Renovate');
  }
  if (pathExistsSync(path.join(workspaceRoot, '.github', 'workflows', 'snyk-monitor.yml'))) {
    providers.push('Snyk');
  }
  if (pathExistsSync(path.join(workspaceRoot, 'azure-pipelines.yml'))) {
    providers.push('Azure DevOps');
  }
  return providers;
}

function normalizeVerificationScripts(value: string[] | string | undefined): string {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(Boolean)
      .join(', ');
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return '';
}

async function countIssueTemplates(workspaceRoot: string | undefined): Promise<number> {
  if (!workspaceRoot) {
    return 0;
  }
  try {
    const entries = await fs.readdir(path.join(workspaceRoot, '.github', 'ISSUE_TEMPLATE'), { withFileTypes: true });
    return entries.filter(entry => entry.isFile()).length;
  } catch {
    return 0;
  }
}

async function runGit(workspaceRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: workspaceRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4,
  });
  return stdout.trim();
}

function parseCurrentBranch(statusLine: string): string {
  const match = statusLine.match(/^##\s+([^.\s]+)/);
  return match?.[1] ?? 'Detached';
}

function isProductionBranchRef(ref: string): boolean {
  const normalized = normalizeBranchRef(ref).toLowerCase();
  return PRODUCTION_BRANCH_CANDIDATES.includes(normalized as (typeof PRODUCTION_BRANCH_CANDIDATES)[number]);
}

function normalizeBranchRef(ref: string): string {
  return ref.replace(/^origin\//, '');
}

function emptyGitSnapshot(): GitSnapshot {
  return {
    currentBranch: 'Not a git repository',
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    dirty: false,
    branches: [],
    commits: [],
    commitDates: [],
    commitLog: [],
  };
}

function normalizeSsotPath(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.replace(/\\/g, '/') : 'project_memory';
}

function normalizeDateKey(value: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  const deltaMs = Date.now() - date.getTime();
  const deltaDays = Math.floor(deltaMs / (1000 * 60 * 60 * 24));
  if (deltaDays <= 0) {
    return 'Today';
  }
  if (deltaDays === 1) {
    return '1 day ago';
  }
  if (deltaDays < 30) {
    return `${deltaDays} days ago`;
  }
  const deltaMonths = Math.floor(deltaDays / 30);
  if (deltaMonths === 1) {
    return '1 month ago';
  }
  if (deltaMonths < 12) {
    return `${deltaMonths} months ago`;
  }
  const deltaYears = Math.floor(deltaMonths / 12);
  return deltaYears === 1 ? '1 year ago' : `${deltaYears} years ago`;
}

async function fileExists(filePath: string | undefined): Promise<boolean> {
  if (!filePath) {
    return false;
  }
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function pathExistsSync(filePath: string): boolean {
  return existsSync(filePath);
}

function asStringMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
  }
  return result;
}

function parseDashboardFileTarget(value: string): { relativePath: string; line?: number } {
  const trimmed = value.trim();
  const anchorMatch = trimmed.match(/^(.*?)(?:#L(\d+)(?:-L?\d+)?)$/i);
  if (anchorMatch) {
    return {
      relativePath: anchorMatch[1]?.trim() ?? trimmed,
      line: Number.parseInt(anchorMatch[2] ?? '', 10) || undefined,
    };
  }

  const colonMatch = trimmed.match(/^(.*?):(\d+)$/);
  if (colonMatch && !colonMatch[1]?.includes('://')) {
    return {
      relativePath: colonMatch[1]?.trim() ?? trimmed,
      line: Number.parseInt(colonMatch[2] ?? '', 10) || undefined,
    };
  }

  return { relativePath: trimmed };
}

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string | undefined {
  const trimmed = relativePath.trim();
  if (trimmed.length === 0 || path.isAbsolute(trimmed)) {
    return undefined;
  }
  const resolved = path.resolve(workspaceRoot, trimmed);
  const normalizedRoot = path.resolve(workspaceRoot);
  return resolved.startsWith(normalizedRoot) ? resolved : undefined;
}

function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
}

const DASHBOARD_CSS = `
  /* Tokens, the reduced-motion baseline and the shared control primitives
     live in dashboardTheme.ts so every AtlasMind panel draws on one
     definition. The dashboard-specific rules below layer on top. */
  ${DASHBOARD_THEME_CSS}

  body {
    padding: 0;
    background: var(--dash-bg);
    font-family: var(--dash-body);
  }

  .dashboard-shell {
    min-height: 100vh;
    padding: 24px;
    box-sizing: border-box;
  }

  .no-project-banner {
    margin-bottom: 20px;
    padding: 20px 24px;
    border-radius: var(--dash-radius);
    border: 1px solid var(--dash-border);
    background: var(--dash-panel);
  }
  .no-project-banner-title {
    margin: 0 0 6px 0;
    font-size: 1.05em;
    font-weight: 700;
    color: var(--vscode-foreground);
  }
  .no-project-banner-sub {
    margin: 0 0 16px 0;
    font-size: 0.9em;
    color: var(--dash-muted);
  }
  .no-project-banner-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .dashboard-button-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: var(--vscode-button-background);
    font-weight: 600;
  }
  .dashboard-button-primary:hover {
    background: var(--vscode-button-hoverBackground);
  }
  .dashboard-button-secondary {
    background: var(--vscode-button-secondaryBackground, var(--dash-panel));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border-color: var(--dash-border);
  }
  .dashboard-button-secondary:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .dashboard-topbar {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    align-items: flex-start;
    margin-bottom: 24px;
  }

  .dashboard-kicker,
  .card-kicker,
  .section-kicker,
  .chart-kicker {
    margin: 0 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 11px;
    color: var(--dash-muted);
  }

  .dashboard-topbar h1,
  .dashboard-root h2,
  .dashboard-root h3,
  .dashboard-root h4 {
    font-family: var(--dash-heading);
    letter-spacing: -0.02em;
  }

  .dashboard-topbar h1 {
    margin: 0;
    font-size: clamp(30px, 4vw, 44px);
  }

  .dashboard-copy {
    margin: 10px 0 0;
    max-width: 780px;
    color: var(--dash-muted);
    font-size: 14px;
  }

  .dashboard-version-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 14px;
    min-height: 18px;
  }

  .dashboard-version-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel-strong) 80%, transparent);
    font-size: 12px;
    color: var(--vscode-foreground);
  }

  .dashboard-version-pill strong {
    font-weight: 700;
  }

  .dashboard-version-pill-muted {
    color: var(--dash-muted);
  }

  .dashboard-button {
    border-radius: 999px;
    padding: 10px 18px;
    font-weight: 600;
  }

  .dashboard-button-ghost {
    background: transparent;
    border: 1px solid var(--dash-border);
    color: var(--vscode-foreground);
  }

  .dashboard-root {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .dashboard-loading,
  .dashboard-empty {
    display: grid;
    place-items: center;
    min-height: 280px;
    border: 1px solid var(--dash-border);
    border-radius: var(--dash-radius);
    background: var(--dash-panel);
    box-shadow: var(--dash-shadow);
    color: var(--dash-muted);
  }

  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.7fr) minmax(260px, 0.8fr);
    gap: 18px;
  }

  .hero-card,
  .score-card,
  .stat-card,
  .chart-card,
  .panel-card,
  .action-card,
  .branch-card,
  .list-card,
  .signal-card,
  .workflow-card,
  .coverage-card,
  .recent-item,
  .metric-pill,
  .governance-pill,
  .timeline-detail,
  .review-card {
    border: 1px solid var(--dash-border);
    border-radius: var(--dash-radius);
    background: linear-gradient(180deg, color-mix(in srgb, var(--dash-panel-strong) 92%, white 8%), var(--dash-panel));
    box-shadow: var(--dash-shadow);
  }

  .hero-card {
    padding: 24px;
    position: relative;
    overflow: hidden;
  }

  .hero-card::after {
    content: '';
    position: absolute;
    inset: auto -40px -60px auto;
    width: 220px;
    height: 220px;
    background: radial-gradient(circle, color-mix(in srgb, var(--dash-accent) 22%, transparent), transparent 68%);
    pointer-events: none;
  }

  .hero-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
  }

  .meta-pill,
  .governance-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 78%, transparent);
    font-size: 12px;
  }

  .score-card {
    padding: 24px;
    display: grid;
    gap: 16px;
    align-content: start;
  }

  .score-ring {
    width: 150px;
    height: 150px;
    margin: 0 auto;
    display: block;
  }

  .score-ring-track {
    fill: none;
    stroke: color-mix(in srgb, var(--dash-border) 75%, transparent);
    stroke-width: 12;
  }

  .score-ring-progress {
    fill: none;
    stroke: var(--dash-accent-strong);
    stroke-width: 12;
    stroke-linecap: round;
    transform: rotate(-90deg);
    transform-origin: 50% 50%;
    transition: stroke-dashoffset var(--dash-dur-entry) var(--dash-ease), stroke var(--dash-dur-value) ease;
  }

  /* Score is the one number the hero exists to convey — carry it in the ring
     colour too, not only in the digits underneath. */
  .score-ring.ring-good .score-ring-progress { stroke: var(--dash-good); }
  .score-ring.ring-warn .score-ring-progress { stroke: var(--dash-warn); }
  .score-ring.ring-critical .score-ring-progress { stroke: var(--dash-critical); }

  .score-value {
    text-align: center;
    font-size: 42px;
    font-weight: 700;
    line-height: 1;
  }

  .score-caption {
    text-align: center;
    color: var(--dash-muted);
    font-size: 13px;
  }

  /* Sticky so switching tabs on the long pages (Delivery, Director, Testing)
     does not mean scrolling back to the top first. */
  .toolbar-row {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
    flex-wrap: wrap;
    padding: 10px 0 12px;
    margin-bottom: 2px;
    background: linear-gradient(180deg, var(--vscode-editor-background) 78%, color-mix(in srgb, var(--vscode-editor-background) 60%, transparent));
    backdrop-filter: blur(6px);
    border-bottom: 1px solid color-mix(in srgb, var(--dash-border) 55%, transparent);
  }

  /* ── Section navigation ───────────────────────────────────────────────
     Fourteen identical pills in one wrapping row read as a wall. The tabs are
     clustered into five labelled groups that follow a manager's reading order,
     and each cluster wraps as a unit so a group is never split across rows. */
  .page-nav {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 6px 18px;
    flex: 1 1 auto;
  }

  .nav-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .nav-group + .nav-group {
    padding-left: 18px;
    border-left: 1px solid color-mix(in srgb, var(--dash-border) 70%, transparent);
  }

  .nav-group-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--dash-muted) 88%, transparent);
    padding-left: 4px;
  }

  .nav-group-tabs {
    display: flex;
    gap: 6px;
  }

  /* ── Recommended next (Overview footer) ───────────────────────────────
     Replaces a grid of twelve shortcut cards, every one of which duplicated a
     destination already reachable from the tabs, the hero score ring, a stat
     card on the same page, or the sidebar. */
  .next-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .next-actions-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .next-actions-head h3 { margin: 2px 0 0; }
  .next-actions-head .section-kicker { margin: 0; }

  /* An honest statement of where a card goes. The cards this replaced labelled
     themselves from an inert pageTarget, so "Open Chat View" announced itself
     as "runtime" while opening a different panel. */
  .card-destination {
    display: inline-block;
    margin-top: 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: color-mix(in srgb, var(--dash-accent-strong) 88%, var(--vscode-foreground));
  }

  .next-actions-empty h3 { margin: 2px 0 6px; }

  /* Caption + control, sitting immediately above the charts it filters. */
  .chart-range-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 2px;
  }

  .chart-range-row .section-kicker {
    margin: 0;
  }

  .page-nav button,
  .action-link {
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 82%, transparent);
    color: var(--vscode-foreground);
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
  }

  .nav-tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
    transition: background var(--dash-dur-fast) var(--dash-ease), border-color var(--dash-dur-fast) var(--dash-ease), color var(--dash-dur-fast) var(--dash-ease);
  }

  .action-link:hover,
  .action-link:focus-visible {
    background: color-mix(in srgb, var(--dash-accent) 84%, transparent);
    border-color: color-mix(in srgb, var(--dash-accent) 80%, white 20%);
  }

  .nav-tab:hover {
    border-color: color-mix(in srgb, var(--dash-accent) 60%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-panel) 96%, transparent);
  }

  /* The selected tab used to differ only by background colour, and it shared
     that exact rule with .action-link:hover — so a hovered link elsewhere on
     the page read as the active tab. Selection now also carries weight, a
     ring and an underline marker, none of which are colour-dependent. */
  .page-nav button[aria-selected="true"] {
    background: color-mix(in srgb, var(--dash-accent) 84%, transparent);
    border-color: color-mix(in srgb, var(--dash-accent) 80%, white 20%);
    color: var(--vscode-button-foreground, var(--vscode-foreground));
    font-weight: 700;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--dash-accent-strong) 55%, transparent), 0 6px 16px color-mix(in srgb, var(--dash-accent) 26%, transparent);
  }

  .page-nav button[aria-selected="true"]::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: -5px;
    width: 16px;
    height: 2px;
    border-radius: 2px;
    transform: translateX(-50%);
    background: var(--dash-accent-strong);
  }

  .nav-tab { position: relative; }

  /* Keyboard focus had no styled ring on the nav at all. */
  .page-nav button:focus-visible {
    outline: 2px solid var(--dash-accent-strong);
    outline-offset: 2px;
  }

  /* Attention badges. Tone is doubled by shape/weight so the signal survives
     a colour-vision difference or a high-contrast theme. */
  .nav-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 17px;
    height: 17px;
    padding: 0 5px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    background: color-mix(in srgb, var(--dash-muted) 40%, transparent);
    color: var(--vscode-foreground);
  }

  /* Tinted fill + the tone colour as text, rather than a solid fill with a
     hard-coded foreground. A solid fill forces a fixed text colour, and any
     fixed value is wrong in one of the two themes — #1c1400 on the warn badge
     read as black text. A translucent tint of the tone over the panel surface
     keeps the badge legible whichever way the theme goes. */
  .nav-badge-critical {
    background: color-mix(in srgb, var(--dash-critical) 24%, transparent);
    color: var(--dash-critical);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--dash-critical) 45%, transparent);
  }

  .nav-badge-warn {
    background: color-mix(in srgb, var(--dash-warn) 24%, transparent);
    color: var(--dash-warn);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--dash-warn) 45%, transparent);
  }

  .nav-badge-accent {
    background: color-mix(in srgb, var(--dash-accent-strong) 22%, transparent);
    color: var(--dash-accent-strong);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--dash-accent-strong) 40%, transparent);
  }


  .stats-grid,
  .chart-grid,
  .action-grid,
  .panel-grid,
  .delivery-grid,
  .repo-grid,
  .runtime-grid,
  .security-grid,
  .review-grid {
    display: grid;
    gap: 16px;
  }

  .stats-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .chart-grid,
  .delivery-grid,
  .runtime-grid,
  .security-grid,
  .review-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .director-roster {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
    margin-top: 12px;
  }
  .stage-edit-checks {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 8px 0;
  }

  .privacy-toggle,
  .privacy-pack,
  .privacy-model {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
    border-radius: 6px;
    cursor: pointer;
    flex-wrap: wrap;
  }
  .privacy-pack.on,
  .privacy-model.on {
    border-color: var(--vscode-focusBorder, #4daafc);
  }
  .privacy-pack-label,
  .privacy-model-name { font-weight: 600; }
  .privacy-pack-desc,
  .privacy-model-meta {
    flex-basis: 100%;
    opacity: 0.75;
    font-size: 0.85em;
  }
  .privacy-model-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    max-height: 320px;
    overflow-y: auto;
  }
  .privacy-rule-form {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .privacy-rule-form input[type="text"] { flex: 1 1 200px; }
  .privacy-rule-form input,
  .privacy-rule-form select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    padding: 4px 6px;
  }
  .privacy-rule-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
    flex-wrap: wrap;
  }
  .privacy-rule-value { flex: 1 1 160px; word-break: break-all; }
  .privacy-warn,
  .privacy-test-hit { color: var(--vscode-editorWarning-foreground, #cca700); }
  .privacy-test-clear { opacity: 0.75; }

  .privacy-span { grid-column: 1 / -1; }
  .privacy-tree { display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto; }
  .privacy-tree-provider {
    border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
    border-radius: 6px;
    padding: 6px 8px;
  }
  .privacy-tree-provider.has-trusted { border-color: var(--vscode-focusBorder, #4daafc); }
  .privacy-tree-head { display: flex; align-items: center; gap: 8px; }
  .privacy-tree-twisty {
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 0.9em;
    padding: 0 2px;
  }
  .privacy-tree-provider-label { display: flex; align-items: center; gap: 6px; flex: 1; cursor: pointer; }
  .privacy-tree-provider-name { font-weight: 600; }
  .privacy-tree-count { opacity: 0.7; font-size: 0.8em; white-space: nowrap; }
  .privacy-tree-models { display: flex; flex-direction: column; gap: 4px; margin: 6px 0 2px 22px; }
  .privacy-tree-model { display: flex; align-items: center; gap: 6px; padding: 2px 0; cursor: pointer; }

  /* How much of each provider's estate is cleared for confidential context,
     without having to expand the provider. */
  .privacy-tree-meter {
    height: 4px;
    margin: 2px 0 0 26px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--dash-border) 55%, transparent);
  }

  .privacy-tree-meter > span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--dash-good);
    transition: width var(--dash-dur-value) var(--dash-ease);
  }
  .privacy-tree-model.on .privacy-tree-model-name { font-weight: 600; }
  .privacy-source-bars { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
  .privacy-governance {
    border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
    padding: 10px 0;
  }
  .privacy-governance:first-of-type { border-top: none; }

  .action-grid,
  .panel-grid,
  .repo-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stat-card,
  .chart-card,
  .panel-card,
  .action-card,
  .branch-card,
  .list-card,
  .signal-card,
  .workflow-card,
  .review-card {
    padding: 20px;
  }

  .stat-card {
    min-height: 150px;
    display: grid;
    gap: 12px;
    transition: transform 160ms ease, border-color 160ms ease;
  }

  /* Only elements that actually resolve to an action get the interactive
     affordance (cursor + hover lift); static variants stay inert. */
  button.stat-card, .stat-card.is-actionable,
  button.action-card, .action-card.is-actionable,
  button.recent-item, .recent-item.is-actionable,
  button.branch-card, .branch-card,
  button.score-component-row, .score-component-row.is-actionable,
  button.signal-card, .signal-card.is-actionable,
  button.metric-pill, .metric-pill.is-actionable {
    cursor: pointer;
  }

  .stat-card.is-actionable:hover,
  .stat-card.is-actionable:focus-visible,
  .action-card.is-actionable:hover,
  .action-card.is-actionable:focus-visible,
  button.recent-item:hover,
  button.recent-item:focus-visible,
  .recent-item.is-actionable:hover,
  .recent-item.is-actionable:focus-visible,
  .branch-card:hover,
  .branch-card:focus-visible,
  .workflow-card:hover,
  .workflow-card:focus-visible,
  .review-card:hover,
  .review-card:focus-visible {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--dash-accent) 60%, white 40%);
  }

  .tone-accent { border-color: color-mix(in srgb, var(--dash-accent) 45%, var(--dash-border)); }
  .tone-good { border-color: color-mix(in srgb, var(--dash-good) 45%, var(--dash-border)); }
  .tone-warn { border-color: color-mix(in srgb, var(--dash-warn) 45%, var(--dash-border)); }
  .tone-critical { border-color: color-mix(in srgb, var(--dash-critical) 55%, var(--dash-border)); }

  .stat-value {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .stat-detail,
  .muted,
  .signal-detail,
  .list-meta,
  .timeline-empty,
  .timeline-detail,
  .section-copy {
    color: var(--dash-muted);
    font-size: 13px;
  }

  .chart-card {
    display: grid;
    gap: 14px;
    min-height: 320px;
  }

  .chart-shell {
    position: relative;
    min-height: 208px;
    display: grid;
    align-items: end;
  }

  .chart-bars {
    display: grid;
    grid-template-columns: repeat(var(--bar-count), minmax(0, 1fr));
    gap: 6px;
    align-items: end;
    height: 100%;
  }

  .chart-bar {
    position: relative;
    border: 0;
    background: transparent;
    padding: 0;
    height: 100%;
    cursor: pointer;
  }

  .chart-bar-column {
    position: absolute;
    inset: auto 0 0;
    border-radius: 12px 12px 8px 8px;
    min-height: 4px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--dash-accent) 96%, white 4%), color-mix(in srgb, var(--dash-accent) 44%, transparent));
    transform-origin: bottom;
    opacity: 0.88;
  }

  /* The rise is gated on .is-animating, which applyValueAnimations() adds only
     when the series or the timescale actually changed. It used to be
     unconditional, so up to 90 bars replayed on every unrelated re-render. */
  .chart-bars.is-animating .chart-bar-column {
    animation: dashBarRise var(--dash-dur-entry) var(--dash-ease) backwards;
    animation-delay: calc(var(--bar-index, 0) * 6ms);
  }

  .chart-bar.is-peak .chart-bar-column {
    background: linear-gradient(180deg, color-mix(in srgb, var(--dash-good) 88%, white 12%), color-mix(in srgb, var(--dash-good) 40%, transparent));
    opacity: 1;
  }

  /* Headroom is a margin, not padding, so the mean line's percentage bottom
     resolves against exactly the same box the bar heights are measured in. */
  .chart-plot {
    position: relative;
    height: 190px;
    margin-top: 18px;
  }

  /* Mean line: gives every bar a reference without adding a second series. */
  .chart-mean {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-top: 1px dashed color-mix(in srgb, var(--dash-muted) 55%, transparent);
    pointer-events: none;
    z-index: 1;
  }

  .chart-mean-label {
    position: absolute;
    right: 0;
    top: -8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--dash-muted);
    background: color-mix(in srgb, var(--dash-panel-strong) 88%, transparent);
    border-radius: 6px;
    padding: 1px 5px;
  }

  .chart-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .chart-headline {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    text-align: right;
  }

  .chart-total {
    font-family: var(--dash-heading);
    font-size: 26px;
    font-weight: 700;
    line-height: 1.1;
  }

  .chart-trend {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 600;
    color: var(--dash-muted);
  }

  .chart-trend.trend-up { color: var(--dash-good); }
  .chart-trend.trend-down { color: var(--dash-warn); }

  /* ── Distribution bar ─────────────────────────────────────────────────
     Segmented proportion bar + legend. Replaces the "3 verified · 1 blocked"
     sentences that carried counts but no magnitude. */
  .dist-block {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .dist-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    font-weight: 600;
  }

  .dist-bar {
    display: flex;
    height: 12px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--dash-border) 45%, transparent);
  }

  .dist-seg {
    display: block;
    height: 100%;
    min-width: 2px;
    transition: width var(--dash-dur-value) var(--dash-ease);
  }

  .dist-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }

  .dist-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--dash-muted);
  }

  .dist-legend-item strong {
    color: var(--vscode-foreground);
    font-variant-numeric: tabular-nums;
  }

  /* ── Donut charts (contributor mix, route to release) ─────────────
     SVG arcs rather than a chart library or a canvas, so the rings inherit
     theme colours, stay crisp at any zoom, and carry a <title> per slice. */
  .donut-block {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 10px;
  }

  .donut-chart {
    width: 148px;
    height: 148px;
    flex: 0 0 auto;
  }

  .donut-track { stroke: color-mix(in srgb, var(--dash-muted) 22%, transparent); }
  .donut-slice { transition: stroke-width 140ms ease, opacity 140ms ease; }
  .donut-slice.is-active { filter: brightness(1.12); }
  .donut-good { stroke: var(--dash-good); }
  .donut-warn { stroke: var(--dash-warn); }
  .donut-critical { stroke: var(--dash-critical); }
  .donut-accent { stroke: var(--dash-accent-strong); }
  .donut-muted { stroke: color-mix(in srgb, var(--dash-muted) 55%, transparent); }

  .donut-center-value {
    fill: var(--vscode-foreground);
    font-size: 20px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .donut-center-label {
    fill: var(--dash-muted);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .donut-legend {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-width: 0;
  }

  .donut-legend-percent {
    color: var(--dash-muted);
    font-variant-numeric: tabular-nums;
  }

  button.dist-legend-item {
    border: 1px solid transparent;
    border-radius: 999px;
    padding: 2px 8px;
    background: transparent;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    text-align: left;
  }

  button.dist-legend-item:hover { border-color: color-mix(in srgb, var(--dash-accent-strong) 50%, var(--dash-border)); }

  button.dist-legend-item.is-active {
    border-color: color-mix(in srgb, var(--dash-accent-strong) 70%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-accent-strong) 14%, transparent);
  }

  .chart-range--filter { margin-top: 14px; }
  .chart-grid--mix { margin-top: 16px; }

  /* An issue body is somebody else's prose: give it room but keep it visibly
     quoted so it never reads as AtlasMind's own text. */
  .issue-body {
    white-space: pre-wrap;
    border-left: 2px solid var(--dash-border);
    padding-left: 10px;
    margin-top: 6px;
    opacity: 0.9;
  }

  .dist-swatch {
    width: 9px;
    height: 9px;
    border-radius: 3px;
    flex: none;
  }

  .dist-empty {
    font-size: 12px;
    color: var(--dash-muted);
  }

  /* What an advisor reviews, so a clean result is legible as "checked and
     clear" rather than "never looked". Opens itself when a domain has run and
     found nothing, which is exactly when the question arises. */
  .risk-coverage {
    margin-top: 6px;
  }

  .risk-coverage > summary {
    cursor: pointer;
    list-style: none;
    font-size: 11px;
    font-weight: 600;
    color: var(--dash-muted);
    padding: 2px 0;
  }

  .risk-coverage > summary::-webkit-details-marker { display: none; }

  .risk-coverage > summary::before {
    content: "\\25B8";
    display: inline-block;
    margin-right: 6px;
    transition: transform var(--dash-dur-fast) var(--dash-ease);
  }

  .risk-coverage[open] > summary::before { transform: rotate(90deg); }
  .risk-coverage > summary:hover { color: var(--vscode-foreground); }
  .risk-coverage .stat-detail { margin: 4px 0 0; }

  /* ── Workflow help affordance ─────────────────────────────────────────
     The "?" that opens the why/how for a step.

     A real <button>, not a <span> with a title attribute, for three reasons: a
     native tooltip is unreachable by keyboard, truncated by the OS, and cannot
     hold a paragraph — and this content is the point of the page rather than a
     hint about it. Being a button also means it inherits the shared
     :focus-visible ring instead of needing its own. */
  .wf-help-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    margin-left: 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    color: var(--dash-accent-strong);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--dash-accent-strong) 55%, var(--dash-border));
    cursor: pointer;
    vertical-align: middle;
    transition: background var(--dash-dur-fast) var(--dash-ease), color var(--dash-dur-fast) var(--dash-ease);
  }

  .wf-help-toggle:hover,
  .wf-help-toggle[aria-expanded="true"] {
    background: color-mix(in srgb, var(--dash-accent-strong) 18%, transparent);
    color: var(--vscode-foreground);
  }

  /* The expanded panel. Indented and rule-marked so a long explanation reads as
     an aside rather than as the next section of the page. */
  .wf-help-panel {
    margin: 8px 0 4px 0;
    padding: 10px 14px;
    border-left: 2px solid color-mix(in srgb, var(--dash-accent-strong) 45%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-accent-strong) 6%, transparent);
    border-radius: 0 var(--dash-radius) var(--dash-radius) 0;
  }

  .wf-help-panel h5 {
    margin: 0 0 4px;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--dash-muted);
  }

  .wf-help-panel h5:not(:first-child) { margin-top: 12px; }
  .wf-help-panel p { margin: 0 0 6px; font-size: 12px; line-height: 1.6; max-width: 78ch; }
  .wf-help-panel ol,
  .wf-help-panel ul { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.6; max-width: 78ch; }
  .wf-help-panel li { margin-bottom: 4px; }
  .wf-help-panel code {
    font-family: var(--dash-mono);
    font-size: 11px;
    padding: 1px 4px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--dash-border) 45%, transparent);
  }

  /* Mistakes are visually distinct from the how-to. Somebody skimming for "what
     goes wrong" should be able to find it without reading the steps. */
  .wf-help-mistakes { border-left-color: color-mix(in srgb, var(--dash-warn) 55%, var(--dash-border)); }
  .wf-help-mistakes li { color: color-mix(in srgb, var(--dash-warn) 75%, var(--dash-body)); }

  .wf-stage {
    border: 1px solid var(--dash-border);
    border-radius: var(--dash-radius);
    padding: 14px 16px;
    margin-bottom: 10px;
    background: var(--dash-panel);
  }

  .wf-stage-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .wf-stage-head h4 { margin: 0; font-size: 14px; }
  .wf-stage-ordinal {
    font-family: var(--dash-mono);
    font-size: 11px;
    color: var(--dash-muted);
    min-width: 18px;
  }

  .wf-step {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 0;
    border-top: 1px solid color-mix(in srgb, var(--dash-border) 55%, transparent);
  }

  .wf-step:first-of-type { border-top: none; }
  .wf-step-mark { font-size: 12px; line-height: 1.6; }
  .wf-step-body { flex: 1; min-width: 0; }
  .wf-step-title { font-size: 13px; font-weight: 600; }
  .wf-step-detail { font-size: 12px; color: var(--dash-muted); margin-top: 2px; line-height: 1.5; }

  .wf-proficiency {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--dash-muted);
    border: 1px solid var(--dash-border);
    border-radius: 999px;
    padding: 0 6px;
  }

  /* A metric with no verdict. Deliberately quiet rather than alarming: "not
     measured" is not a failure, and styling it like one would train people to
     ignore the styling. */
  .wf-unknown { color: var(--dash-muted); font-style: italic; }

  /* A classified CI failure and the lines that decided it. */
  .wf-ci-failure {
    margin-top: 10px;
    padding: 10px 12px;
    border-left: 2px solid color-mix(in srgb, var(--dash-critical) 55%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-critical) 6%, transparent);
    border-radius: 0 var(--dash-radius) var(--dash-radius) 0;
  }

  /* Evidence is log text: monospaced, and allowed to scroll rather than forcing
     the page to. A long line must never make the body scroll horizontally. */
  .wf-ci-evidence {
    margin: 6px 0;
    padding: 8px 10px;
    max-height: 220px;
    overflow: auto;
    font-family: var(--dash-mono);
    font-size: 11px;
    line-height: 1.5;
    white-space: pre;
    background: color-mix(in srgb, var(--dash-border) 35%, transparent);
    border-radius: 8px;
  }

  .wf-glossary dt { font-size: 12px; font-weight: 600; margin-top: 8px; }
  .wf-glossary dd { font-size: 12px; color: var(--dash-muted); margin: 2px 0 0; line-height: 1.6; max-width: 78ch; }

  /* ── Release strip ────────────────────────────────────────────────────
     One tick per recorded promotion, oldest left. Turns "read eight rows" into
     "glance at the run of green". */
  .release-strip {
    display: flex;
    gap: 3px;
    align-items: flex-end;
    margin: 2px 0 10px;
    min-height: 22px;
  }

  .release-tick {
    flex: 1 1 6px;
    max-width: 22px;
    height: 18px;
    border-radius: 4px;
    background: var(--dash-good);
  }

  .release-tick.fail {
    background: var(--dash-critical);
    height: 22px;
  }

  /* Rollbacks are notched so they are distinguishable without relying on hue. */
  .release-tick.rollback {
    background: repeating-linear-gradient(135deg, var(--dash-warn) 0 3px, color-mix(in srgb, var(--dash-warn) 55%, transparent) 3px 6px);
  }

  .release-rate {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.03em;
    padding: 2px 9px;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
  }

  .release-rate.good { color: var(--dash-good); border-color: color-mix(in srgb, var(--dash-good) 50%, var(--dash-border)); }
  .release-rate.warn { color: var(--dash-warn); border-color: color-mix(in srgb, var(--dash-warn) 50%, var(--dash-border)); }
  .release-rate.bad { color: var(--dash-critical); border-color: color-mix(in srgb, var(--dash-critical) 50%, var(--dash-border)); }

  .dist-good { background: var(--dash-good); }
  .dist-warn { background: var(--dash-warn); }
  .dist-critical { background: var(--dash-critical); }
  .dist-accent { background: var(--dash-accent-strong); }
  .dist-muted { background: color-mix(in srgb, var(--dash-muted) 45%, transparent); }

  .chart-bar.active .chart-bar-column,
  .chart-bar:hover .chart-bar-column,
  .chart-bar:focus-visible .chart-bar-column {
    opacity: 1;
    box-shadow: 0 0 0 1px color-mix(in srgb, white 35%, transparent), 0 8px 24px color-mix(in srgb, var(--dash-accent) 28%, transparent);
  }

  .chart-axis {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 11px;
    color: var(--dash-muted);
  }

  .timeline-detail {
    padding: 12px 14px;
  }

  /* .action-card and .recent-item are deliberately absent here. They render as
     both real buttons and inert <div>s, and this blanket rule used to hand a
     hand-cursor to every one of them — overriding the scoped rule above and
     making ~15 dead cards across Repo, Roadmap, Testing, Gap Analysis and
     Documents look clickable. They get their cursor from the
     "button.x, .x.is-actionable" rule instead. */
  .workflow-card,
  .review-card,
  .branch-card {
    cursor: pointer;
  }

  /* Belt and braces: if a static variant ever ends up inside a container that
     sets a pointer cursor, it still reads as inert. */
  .recent-item:not(.is-actionable):not(button),
  .action-card.static {
    cursor: default;
  }

  .action-card {
    display: grid;
    gap: 8px;
    min-height: 128px;
  }

  .action-card strong,
  .panel-card h3,
  .branch-card h4,
  .list-card h3,
  .signal-card h4,
  .workflow-card h4,
  .review-card h4 {
    font-size: 17px;
    margin: 0;
  }

  .panel-card h3,
  .list-card h3 {
    margin-bottom: 10px;
  }

  .mini-grid {
    display: grid;
    gap: 10px;
  }

  .metric-pill {
    padding: 12px 14px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .metric-label {
    color: var(--dash-muted);
    font-size: 12px;
  }

  .metric-value {
    font-weight: 700;
  }

  .stack-list {
    display: grid;
    gap: 10px;
    max-height: 480px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--dash-border) 80%, transparent) transparent;
  }

  .stack-list .stack-list {
    max-height: none;
    overflow: visible;
  }

  .recent-item,
  .workflow-card,
  .review-card,
  .branch-card,
  .signal-card {
    text-align: left;
    width: 100%;
  }

  .recent-item {
    padding: 12px 14px;
  }

  /* An at-rest marker for the clickable variant. The identical card chrome is
     used for both live and inert rows, so before this the only thing telling
     them apart was the hover lift — which the user only discovers after
     committing to a click. */
  button.recent-item,
  .recent-item.is-actionable,
  button.branch-card,
  button.artifact-row {
    position: relative;
    padding-right: 30px;
  }

  button.recent-item::after,
  .recent-item.is-actionable::after,
  button.branch-card::after,
  button.artifact-row::after {
    content: "›";
    position: absolute;
    top: 12px;
    right: 13px;
    font-size: 15px;
    line-height: 1;
    color: color-mix(in srgb, var(--dash-accent-strong) 78%, transparent);
    opacity: 0.55;
    transition: opacity var(--dash-dur-fast) var(--dash-ease), transform var(--dash-dur-fast) var(--dash-ease);
  }

  button.recent-item:hover::after,
  button.recent-item:focus-visible::after,
  .recent-item.is-actionable:hover::after,
  .recent-item.is-actionable:focus-visible::after,
  button.branch-card:hover::after,
  button.branch-card:focus-visible::after,
  button.artifact-row:hover::after,
  button.artifact-row:focus-visible::after {
    opacity: 1;
    transform: translateX(2px);
  }

  .row-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
  }

  /* The Testing browser's category wrapper used to reuse .recent-item, so an
     inert card sat directly around live ones with identical chrome. It is a
     grouping element, not a card — style it as a heading instead. */
  .test-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .test-group-head {
    padding: 2px 2px 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dash-muted);
  }

  .test-group-head strong {
    font-size: 11px;
    letter-spacing: inherit;
  }

  .hero-grid > *,
  .panel-grid > *,
  .repo-grid > *,
  .runtime-grid > *,
  .security-grid > *,
  .delivery-grid > *,
  .review-grid > *,
  .stack-list > *,
  .row-head > * {
    min-width: 0;
    max-width: 100%;
  }

  .row-head strong,
  .row-head h4,
  .list-meta,
  .stat-detail,
  .section-copy {
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    font-size: 11px;
    color: var(--dash-muted);
  }

  .tag-good {
    border-color: color-mix(in srgb, var(--dash-good) 65%, var(--dash-border));
    color: color-mix(in srgb, var(--dash-good) 85%, var(--tint-away) 15%);
    background: color-mix(in srgb, var(--dash-good) 16%, transparent);
  }

  .tag-warn {
    border-color: color-mix(in srgb, var(--dash-warn) 65%, var(--dash-border));
    color: color-mix(in srgb, var(--dash-warn) 86%, var(--tint-away) 14%);
    background: color-mix(in srgb, var(--dash-warn) 14%, transparent);
  }

  .tag-critical {
    border-color: color-mix(in srgb, var(--dash-critical) 70%, var(--dash-border));
    color: color-mix(in srgb, var(--dash-critical) 86%, var(--tint-away) 14%);
    background: color-mix(in srgb, var(--dash-critical) 14%, transparent);
  }

  .tag-group {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .tag-mvp {
    border-color: color-mix(in srgb, var(--dash-accent-strong) 70%, var(--dash-border));
    color: color-mix(in srgb, var(--dash-accent-strong) 88%, var(--tint-away) 12%);
    background: color-mix(in srgb, var(--dash-accent-strong) 18%, transparent);
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .roadmap-item.is-mvp {
    border-left: 3px solid color-mix(in srgb, var(--dash-accent-strong) 70%, var(--dash-border));
  }

  /* ── Roadmap: release gates ───────────────────────────────────────
     A gate selector above the route card and one toggle per gate on each
     backlog item. With only the built-in MVP gate this reads as the single
     control it replaces; it grows into a release plan without a menu. */
  .gate-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .gate-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    background: transparent;
    color: var(--dash-muted);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .gate-chip:hover { border-color: color-mix(in srgb, var(--dash-accent-strong) 55%, var(--dash-border)); }

  .gate-chip.is-active {
    border-color: color-mix(in srgb, var(--dash-accent-strong) 75%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-accent-strong) 18%, transparent);
    color: color-mix(in srgb, var(--dash-accent-strong) 90%, var(--tint-away) 10%);
    font-weight: 600;
  }

  .gate-chip-count { opacity: 0.75; font-variant-numeric: tabular-nums; }
  .gate-chip--add { border-style: dashed; }

  .gate-toggle-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
  }

  .gate-toggle-hint {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dash-muted);
  }

  .gate-toggle {
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px dashed var(--dash-border);
    background: transparent;
    color: var(--dash-muted);
    font: inherit;
    font-size: 10.5px;
    cursor: pointer;
  }

  .gate-toggle:hover { border-color: color-mix(in srgb, var(--dash-accent-strong) 55%, var(--dash-border)); }

  .gate-toggle.is-on {
    border-style: solid;
    border-color: color-mix(in srgb, var(--dash-accent-strong) 70%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-accent-strong) 16%, transparent);
    color: color-mix(in srgb, var(--dash-accent-strong) 88%, var(--tint-away) 12%);
    font-weight: 600;
  }

  .roadmap-item {
    cursor: grab;
  }

  .roadmap-item .row-head {
    align-items: center;
  }

  .roadmap-item .drag-handle {
    cursor: grab;
    /* Was var(--dash-fg), which is not defined — the whole declaration was
       invalid at computed-value time, so the handle inherited body colour and
       never read as a de-emphasised affordance. */
    color: color-mix(in srgb, var(--vscode-foreground) 45%, transparent);
    font-size: 14px;
    line-height: 1;
    letter-spacing: -2px;
    margin-right: 8px;
    user-select: none;
    flex: 0 0 auto;
  }

  .roadmap-item:hover .drag-handle {
    color: var(--dash-accent-strong);
  }

  .roadmap-item.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }

  .roadmap-item.drag-over {
    border-top: 2px solid var(--dash-accent-strong);
    background: color-mix(in srgb, var(--dash-accent-strong) 10%, transparent);
  }

  .mvp-help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    margin-left: 6px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    color: var(--dash-accent-strong);
    border: 1px solid color-mix(in srgb, var(--dash-accent-strong) 55%, var(--dash-border));
    cursor: help;
    vertical-align: middle;
  }

  .mvp-progress {
    height: 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--dash-border) 70%, transparent);
    overflow: hidden;
    margin: 4px 0 2px;
  }

  .mvp-progress-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--dash-accent-strong);
    transition: width var(--dash-dur-value) var(--dash-ease);
  }

  .mvp-track {
    display: flex;
    align-items: flex-start;
    gap: 0;
    flex-wrap: wrap;
    margin: 6px 0 2px;
  }

  .mvp-node {
    position: relative;
    flex: 1 1 96px;
    min-width: 96px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 6px;
    padding-top: 4px;
  }

  .mvp-node:not(:last-child)::after {
    content: "";
    position: absolute;
    top: 17px;
    left: calc(50% + 16px);
    right: calc(-50% + 16px);
    height: 2px;
    background: color-mix(in srgb, var(--dash-border) 80%, transparent);
  }

  .mvp-node.done:not(:last-child)::after {
    background: color-mix(in srgb, var(--dash-good) 60%, var(--dash-border));
  }

  .mvp-node-dot {
    position: relative;
    z-index: 1;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 600;
    border: 2px solid var(--dash-border);
    background: var(--dash-surface, transparent);
    color: var(--dash-muted);
  }

  .mvp-node.done .mvp-node-dot {
    border-color: color-mix(in srgb, var(--dash-good) 70%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-good) 22%, transparent);
    color: color-mix(in srgb, var(--dash-good) 90%, var(--tint-away) 10%);
  }

  .mvp-node.active .mvp-node-dot {
    border-color: var(--dash-accent-strong);
    background: color-mix(in srgb, var(--dash-accent-strong) 22%, transparent);
    color: color-mix(in srgb, var(--dash-accent-strong) 92%, var(--tint-away) 8%);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--dash-accent-strong) 18%, transparent);
  }

  .mvp-node-label {
    font-size: 11px;
    line-height: 1.3;
    color: var(--dash-muted);
    overflow-wrap: anywhere;
    word-break: break-word;
    max-width: 120px;
  }

  .mvp-node.active .mvp-node-label {
    color: var(--vscode-foreground);
  }

  .mvp-next-callout {
    display: grid;
    gap: 4px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--dash-accent-strong) 45%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-accent-strong) 10%, transparent);
  }

  .mvp-next-kicker {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in srgb, var(--dash-accent-strong) 86%, var(--tint-away) 14%);
  }

  /* ── Shared design-refresh primitives ─────────────────────────────── */

  /* Metric pill: status dot, optional meter, actionable button variant */
  .metric-pill {
    flex-wrap: wrap;
    align-items: center;
  }

  button.metric-pill {
    font: inherit;
    color: inherit;
    text-align: left;
    width: 100%;
  }

  .metric-head {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .metric-meter {
    flex-basis: 100%;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--dash-border) 70%, transparent);
    overflow: hidden;
    margin-top: 2px;
  }

  .metric-meter > span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--dash-accent-strong);
    transition: width var(--dash-dur-value) var(--dash-ease);
  }

  button.metric-pill:hover,
  button.metric-pill:focus-visible {
    border-color: color-mix(in srgb, var(--dash-accent) 50%, var(--dash-border));
  }

  /* Tone status dots shared by pills, intro chips, governance pills */
  .pill-dot {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    flex: 0 0 auto;
    background: var(--dash-muted);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--dash-muted) 22%, transparent);
  }

  .pill-tone-good .pill-dot { background: var(--dash-good); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dash-good) 24%, transparent); }
  .pill-tone-warn .pill-dot { background: var(--dash-warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dash-warn) 24%, transparent); }
  .pill-tone-critical .pill-dot { background: var(--dash-critical); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dash-critical) 24%, transparent); }
  .pill-tone-accent .pill-dot { background: var(--dash-accent-strong); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dash-accent-strong) 24%, transparent); }
  .pill-tone-good { border-color: color-mix(in srgb, var(--dash-good) 40%, var(--dash-border)); }
  .pill-tone-warn { border-color: color-mix(in srgb, var(--dash-warn) 40%, var(--dash-border)); }
  .pill-tone-critical { border-color: color-mix(in srgb, var(--dash-critical) 45%, var(--dash-border)); }

  /* Signal card: actionable CTA chip + inert static variant */
  .signal-card.static { cursor: default; }

  .signal-cta {
    display: inline-flex;
    align-self: flex-start;
    margin-top: 8px;
    font-size: 11px;
    font-weight: 600;
    color: color-mix(in srgb, var(--dash-accent-strong) 86%, var(--tint-away) 14%);
  }

  /* Page intro band — plain-English orientation at the top of each page */
  .page-intro {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
    padding: 16px 18px;
    border: 1px solid var(--dash-border);
    border-radius: var(--dash-radius);
    background: linear-gradient(180deg, color-mix(in srgb, var(--dash-accent) 10%, var(--dash-panel)), var(--dash-panel));
    box-shadow: var(--dash-shadow);
  }

  .page-intro-body { min-width: 0; flex: 1 1 320px; }
  .page-intro-summary { color: var(--dash-muted); margin: 6px 0 0; max-width: 74ch; }
  .page-intro-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .page-intro-action { flex: 0 0 auto; }

  .intro-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 11px;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 80%, transparent);
    font-size: 12px;
    font-weight: 600;
  }

  /* Flow strip — at-a-glance node sequence (generalised pipeline-flow) */
  .flow-strip {
    display: flex;
    align-items: stretch;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }

  .flow-chip {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 12px;
    border-radius: 12px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 82%, transparent);
    min-width: 0;
  }

  .flow-chip-dot { font-weight: 700; font-size: 12px; color: var(--dash-muted); }
  .flow-chip-label { font-weight: 600; font-size: 12px; overflow-wrap: anywhere; }
  .flow-chip-sub { font-size: 11px; color: var(--dash-muted); }
  .flow-chip.status-good { border-color: color-mix(in srgb, var(--dash-good) 50%, var(--dash-border)); }
  .flow-chip.status-good .flow-chip-dot { color: var(--dash-good); }
  .flow-chip.status-warn { border-color: color-mix(in srgb, var(--dash-warn) 50%, var(--dash-border)); }
  .flow-chip.status-warn .flow-chip-dot { color: var(--dash-warn); }
  .flow-chip.status-critical { border-color: color-mix(in srgb, var(--dash-critical) 55%, var(--dash-border)); }
  .flow-chip.status-critical .flow-chip-dot { color: var(--dash-critical); }
  .flow-chip.status-active { border-color: color-mix(in srgb, var(--dash-accent-strong) 55%, var(--dash-border)); }
  .flow-chip.status-active .flow-chip-dot { color: var(--dash-accent-strong); }
  .flow-strip-arrow { align-self: center; color: var(--dash-muted); }

  .coverage-list {
    display: grid;
    gap: 10px;
  }

  .coverage-row {
    display: grid;
    gap: 6px;
  }

  /* ── Risk matrix ──────────────────────────────────────────────
     Likelihood x impact heatmap. Colours are derived from the existing
     good/warn/critical theme tokens so it tracks the VS Code theme, and every
     cell also carries its count as text — the band is never the only signal. */
  .risk-matrix {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 12px 0 6px;
  }

  .risk-matrix-row {
    display: grid;
    grid-template-columns: 72px repeat(3, minmax(0, 1fr));
    gap: 6px;
    align-items: stretch;
  }

  .risk-axis-label {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    text-transform: capitalize;
    color: var(--dash-muted);
  }

  .risk-matrix-row .risk-axis-label:first-child {
    justify-content: flex-end;
    padding-right: 8px;
  }

  .risk-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 46px;
    border-radius: 8px;
    border: 1px solid var(--dash-border);
    font-size: 15px;
    font-weight: 600;
    color: var(--vscode-foreground);
    background: color-mix(in srgb, var(--dash-border) 25%, transparent);
    cursor: pointer;
    transition: transform 120ms ease, border-color 120ms ease;
  }

  .risk-cell.is-empty {
    cursor: default;
    color: var(--dash-muted);
    font-weight: 400;
  }

  .risk-cell--low { background: color-mix(in srgb, var(--dash-good) 16%, transparent); }
  .risk-cell--moderate { background: color-mix(in srgb, var(--dash-warn) 16%, transparent); }
  .risk-cell--high { background: color-mix(in srgb, var(--dash-warn) 32%, transparent); }
  .risk-cell--severe { background: color-mix(in srgb, var(--dash-critical) 34%, transparent); }

  button.risk-cell:hover { transform: translateY(-1px); }
  button.risk-cell:focus-visible { outline: 2px solid var(--dash-accent); outline-offset: 2px; }

  .risk-cell.is-active {
    border-color: var(--dash-accent);
    box-shadow: inset 0 0 0 1px var(--dash-accent);
  }

  .risk-axis-caption {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--dash-muted);
  }

  .risk-finding {
    display: grid;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--dash-border);
    border-radius: 10px;
    margin-top: 10px;
  }

  /* Resolved findings stay visible but recede — they are history, not noise. */
  .risk-finding--accepted,
  .risk-finding--mitigated,
  .risk-finding--closed,
  .risk-finding--dismissed {
    opacity: 0.72;
  }

  .risk-finding--open { border-color: color-mix(in srgb, var(--dash-warn) 40%, var(--dash-border)); }

  .risk-tag {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    color: var(--dash-muted);
  }

  .risk-tag--ethics { border-color: color-mix(in srgb, var(--dash-accent) 50%, var(--dash-border)); }
  .risk-tag--legal { border-color: color-mix(in srgb, var(--dash-critical) 45%, var(--dash-border)); }
  .risk-tag--commercial { border-color: color-mix(in srgb, var(--dash-good) 45%, var(--dash-border)); }

  .coverage-bar {
    height: 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--dash-border) 45%, transparent);
    overflow: hidden;
  }

  .coverage-bar > span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, color-mix(in srgb, var(--dash-accent) 94%, white 6%), color-mix(in srgb, var(--dash-good) 70%, var(--dash-accent)));
    transition: width var(--dash-dur-value) var(--dash-ease);
  }

  .delta-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 4px;
  }

  .delta-header h3 {
    margin: 0;
  }

  .delta-summary-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    border: 1px solid var(--dash-border);
  }

  .delta-summary-badge.good {
    color: var(--dash-good);
    border-color: color-mix(in srgb, var(--dash-good) 46%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-good) 10%, transparent);
  }

  .delta-summary-badge.warn {
    color: var(--dash-warn);
    border-color: color-mix(in srgb, var(--dash-warn) 46%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-warn) 10%, transparent);
  }

  .delta-list {
    display: grid;
    gap: 8px;
    margin-bottom: 14px;
  }

  .delta-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 60%, transparent);
  }

  .delta-row--ok { border-color: color-mix(in srgb, var(--dash-good) 30%, var(--dash-border)); }
  .delta-row--stale { border-color: color-mix(in srgb, var(--dash-warn) 38%, var(--dash-border)); }
  .delta-row--missing { border-color: color-mix(in srgb, var(--dash-critical) 38%, var(--dash-border)); }

  .delta-icon {
    font-size: 13px;
    font-weight: 700;
    min-width: 18px;
    text-align: center;
    margin-top: 1px;
  }

  .delta-row--ok .delta-icon { color: var(--dash-good); }
  .delta-row--stale .delta-icon { color: var(--dash-warn); }
  .delta-row--missing .delta-icon { color: var(--dash-critical); }
  .delta-row--unknown .delta-icon { color: var(--dash-muted); }

  .delta-body {
    flex: 1;
    display: grid;
    gap: 2px;
  }

  .delta-body strong {
    font-size: 13px;
    font-weight: 600;
  }

  .delta-detail {
    font-size: 12px;
    color: var(--dash-muted);
  }

  .delta-badge {
    font-size: 11px;
    font-weight: 700;
    min-width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 0 5px;
    background: color-mix(in srgb, var(--dash-warn) 22%, transparent);
    color: var(--dash-warn);
    border: 1px solid color-mix(in srgb, var(--dash-warn) 40%, var(--dash-border));
  }

  .delta-row--missing .delta-badge {
    background: color-mix(in srgb, var(--dash-critical) 22%, transparent);
    color: var(--dash-critical);
    border-color: color-mix(in srgb, var(--dash-critical) 40%, var(--dash-border));
  }

  .artifact-list {
    display: grid;
    gap: 8px;
  }

  .artifact-row {
    display: grid;
    grid-template-columns: 18px 1fr auto;
    gap: 12px;
    align-items: start;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 60%, transparent);
    text-align: left;
    width: 100%;
    cursor: default;
    transition: border-color 120ms ease;
  }

  button.artifact-row {
    cursor: pointer;
  }

  button.artifact-row:hover,
  button.artifact-row:focus-visible {
    border-color: color-mix(in srgb, var(--dash-accent) 55%, var(--dash-border));
    outline: none;
  }

  .artifact-row--ok { border-color: color-mix(in srgb, var(--dash-good) 30%, var(--dash-border)); }
  .artifact-row--warn { border-color: color-mix(in srgb, var(--dash-warn) 38%, var(--dash-border)); }
  .artifact-row--info { border-color: var(--dash-border); }

  .artifact-icon {
    font-size: 13px;
    font-weight: 700;
    text-align: center;
    margin-top: 2px;
  }

  .artifact-row--ok .artifact-icon { color: var(--dash-good); }
  .artifact-row--warn .artifact-icon { color: var(--dash-warn); }
  .artifact-row--info .artifact-icon { color: var(--dash-muted); }

  .artifact-body {
    display: grid;
    gap: 5px;
  }

  .artifact-name {
    font-size: 12px;
    font-weight: 600;
    /* Was var(--dash-mono), which is not defined — artifact paths rendered in
       the body font instead of monospace. */
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .artifact-desc {
    font-size: 11px;
    color: var(--dash-muted);
    line-height: 1.4;
  }

  .artifact-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 4px;
  }

  .artifact-tags .tag {
    font-size: 10px;
    padding: 2px 7px;
  }

  .artifact-status {
    font-size: 10px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 999px;
    white-space: nowrap;
    align-self: start;
  }

  .artifact-status--ok {
    color: var(--dash-good);
    background: color-mix(in srgb, var(--dash-good) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--dash-good) 36%, transparent);
  }

  .artifact-status--warn {
    color: var(--dash-warn);
    background: color-mix(in srgb, var(--dash-warn) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--dash-warn) 36%, transparent);
  }

  .artifact-status--info {
    color: var(--dash-muted);
    background: color-mix(in srgb, var(--dash-muted) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--dash-muted) 25%, transparent);
  }

  .artifact-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .artifact-header h3 {
    margin: 0;
  }

  .artifact-attention-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 999px;
    color: var(--dash-warn);
    background: color-mix(in srgb, var(--dash-warn) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--dash-warn) 36%, transparent);
  }

  .artifact-attention-badge.good {
    color: color-mix(in srgb, var(--dash-good) 90%, var(--tint-away));
    background: color-mix(in srgb, var(--dash-good) 14%, transparent);
    border-color: color-mix(in srgb, var(--dash-good) 36%, transparent);
  }

  .signal-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .signal-card.good { border-color: color-mix(in srgb, var(--dash-good) 46%, var(--dash-border)); }
  .signal-card.warn { border-color: color-mix(in srgb, var(--dash-warn) 46%, var(--dash-border)); }

  .signal-card.is-actionable:hover,
  .signal-card.is-actionable:focus-visible,
  .action-card.score-recommendation-item.is-actionable:hover,
  .action-card.score-recommendation-item.is-actionable:focus-visible {
    border-color: color-mix(in srgb, var(--dash-accent) 45%, var(--dash-border));
    transform: translateY(-1px);
  }

  .checkline {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  .checkline::before {
    content: '';
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: var(--dash-good);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--dash-good) 24%, transparent);
  }

  .signal-card.warn .checkline::before {
    background: var(--dash-warn);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--dash-warn) 24%, transparent);
  }

  .page-section {
    display: none;
    gap: 16px;
  }

  .page-section.active {
    display: grid;
  }

  .score-summary-grid,
  .score-recommendation-grid {
    display: grid;
    gap: 16px;
  }

  .score-summary-grid {
    grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  }

  .score-recommendation-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .score-component-list {
    display: grid;
    gap: 12px;
  }

  .score-component-row,
  .score-recommendation-item {
    width: 100%;
    text-align: left;
  }

  .score-component-row {
    display: grid;
    gap: 8px;
    border: 1px solid var(--dash-border);
    border-radius: 16px;
    background: color-mix(in srgb, var(--dash-panel) 90%, transparent);
    padding: 14px;
  }

  .score-component-row.is-actionable:hover,
  .score-component-row.is-actionable:focus-visible {
    border-color: color-mix(in srgb, var(--dash-accent) 45%, var(--dash-border));
    transform: translateY(-1px);
  }

  .score-component-bar {
    height: 8px;
  }

  .score-outcome-card .mini-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 12px;
  }

  .ideation-shell,
  .ideation-lower-grid {
    display: grid;
    gap: 16px;
  }

  .ideation-shell {
    grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.4fr);
    align-items: start;
  }

  .ideation-lower-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .ideation-panel {
    border: 1px solid var(--dash-border);
    border-radius: var(--dash-radius);
    background: linear-gradient(180deg, color-mix(in srgb, var(--dash-panel-strong) 92%, white 8%), var(--dash-panel));
    box-shadow: var(--dash-shadow);
    padding: 18px;
  }

  .ideation-panel-control,
  .ideation-inspector-card,
  .ideation-response-card,
  .ideation-thread-card {
    display: grid;
    gap: 12px;
  }

  .ideation-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--dash-muted);
  }

  .ideation-prompt,
  .ideation-textarea,
  .ideation-input,
  .ideation-select {
    width: 100%;
    box-sizing: border-box;
    border-radius: 16px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 90%, var(--vscode-input-background) 10%);
    color: var(--vscode-foreground);
    padding: 12px 14px;
    font: inherit;
  }

  .ideation-prompt,
  .ideation-textarea {
    min-height: 120px;
    resize: vertical;
  }

  .ideation-action-row,
  .ideation-attachment-row,
  .ideation-chip-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .ideation-status-card {
    padding: 14px;
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--dash-accent) 34%, var(--dash-border));
    background: color-mix(in srgb, var(--dash-accent) 10%, transparent);
  }

  .attachment-pill,
  .ideation-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 82%, transparent);
    font-size: 12px;
  }

  .ideation-chip {
    cursor: pointer;
  }

  .ideation-panel-board {
    display: grid;
    gap: 12px;
  }

  .ideation-board-stage {
    position: relative;
    min-height: 760px;
    overflow: hidden;
    border-radius: 22px;
    border: 1px solid var(--dash-border);
    background:
      radial-gradient(circle at top left, color-mix(in srgb, var(--dash-accent) 16%, transparent), transparent 34%),
      linear-gradient(180deg, color-mix(in srgb, var(--dash-panel) 82%, black 18%), color-mix(in srgb, var(--dash-panel-strong) 90%, black 10%));
  }

  .ideation-board-stage::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(color-mix(in srgb, var(--dash-border) 32%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--dash-border) 32%, transparent) 1px, transparent 1px);
    background-size: 32px 32px;
    pointer-events: none;
    opacity: 0.5;
  }

  .ideation-connections {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .ideation-link {
    fill: none;
    stroke: color-mix(in srgb, var(--dash-accent) 58%, white 22%);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-dasharray: 10 8;
    opacity: 0.78;
  }

  .ideation-link-label {
    fill: var(--dash-muted);
    font-family: var(--dash-body);
    font-size: 12px;
    text-anchor: middle;
  }

  .ideation-card {
    position: absolute;
    width: 220px;
    min-height: 132px;
    padding: 14px 14px 16px;
    text-align: left;
    display: grid;
    gap: 10px;
    border-radius: 20px;
    border: 1px solid var(--dash-border);
    box-shadow: 0 16px 30px rgba(0, 0, 0, 0.22);
    transform: translate(-50%, -50%);
    cursor: pointer;
    transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
  }

  .ideation-card:hover,
  .ideation-card:focus-visible {
    transform: translate(-50%, -52%);
  }

  .ideation-card.selected {
    border-color: color-mix(in srgb, var(--dash-accent) 78%, white 22%);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--dash-accent) 60%, transparent), 0 20px 36px rgba(0, 0, 0, 0.28);
  }

  .ideation-card.focused {
    outline: 2px solid color-mix(in srgb, var(--dash-good) 68%, white 22%);
    outline-offset: 2px;
  }

  .ideation-card-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
    cursor: grab;
  }

  .ideation-card-head:active {
    cursor: grabbing;
  }

  .ideation-card-type {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: color-mix(in srgb, var(--vscode-foreground) 66%, var(--tint-away) 34%);
  }

  .ideation-card strong {
    font-size: 18px;
    line-height: 1.15;
  }

  .ideation-card p {
    margin: 0;
    color: color-mix(in srgb, var(--vscode-foreground) 74%, var(--tint-away) 26%);
    font-size: 13px;
    line-height: 1.45;
  }

  .ideation-card-sun {
    background: linear-gradient(180deg, #ffd978, #f1a844);
    color: #37220b;
  }

  .ideation-card-sea {
    background: linear-gradient(180deg, #8ad8ff, #4099d0);
    color: #0e2431;
  }

  .ideation-card-mint {
    background: linear-gradient(180deg, #b8f2cc, #60c78e);
    color: #133021;
  }

  .ideation-card-rose {
    background: linear-gradient(180deg, #ffc0c9, #ea6f84);
    color: #35141d;
  }

  .ideation-card-sand {
    background: linear-gradient(180deg, #f0dcc0, #c89f73);
    color: #312113;
  }

  .ideation-card-storm {
    background: linear-gradient(180deg, #b8c5e8, #6d7ea8);
    color: #151d2f;
  }

  .ideation-empty-state,
  .ideation-empty-mini {
    display: grid;
    place-items: center;
    text-align: center;
    color: var(--dash-muted);
  }

  .ideation-empty-state {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .ideation-empty-mini {
    min-height: 180px;
  }

  .ideation-board-hint {
    color: var(--dash-muted);
    font-size: 12px;
  }

  .ideation-inspector-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ideation-response-box {
    min-height: 260px;
    padding: 16px;
    border-radius: 18px;
    border: 1px solid var(--dash-border);
    background: color-mix(in srgb, var(--dash-panel) 88%, black 12%);
    line-height: 1.6;
    overflow: auto;
  }

  .ideation-history-list {
    display: grid;
    gap: 10px;
  }

  .ideation-history-item {
    cursor: default;
  }

  .mono {
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    font-size: 12px;
  }

  @media (max-width: 1280px) {
    .stats-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .chart-grid,
    .delivery-grid,
    .runtime-grid,
    .security-grid,
    .review-grid,
    .ideation-lower-grid { grid-template-columns: 1fr; }
    .action-grid,
    .panel-grid,
    .repo-grid,
    .hero-grid,
    .ideation-shell { grid-template-columns: 1fr; }
  }

  /* This block used to be malformed: two orphaned selectors sat directly above the
     at-rule, so the parser read \`@media\` as the third item of a selector prelude,
     treated the whole thing as an invalid qualified rule and discarded it — the
     820px breakpoint never applied. The stray \`.score-outcome-card .mini-grid\`
     declaration that trailed it then leaked to every viewport, pinning the Score
     page's outcome grid to one column at all widths. */
  @media (max-width: 820px) {
    .dashboard-shell { padding: 16px; }
    .stats-grid,
    .signal-grid { grid-template-columns: 1fr; }
    .score-summary-grid,
    .score-recommendation-grid,
    .score-outcome-card .mini-grid { grid-template-columns: 1fr; }
  }

  @keyframes dashBarRise {
    from { transform: scaleY(0.2); opacity: 0.25; }
    to { transform: scaleY(1); opacity: 0.92; }
  }
  .methodology-dashboard-table { width: 100%; border-collapse: collapse; }
  .methodology-dashboard-table td { padding: 5px 8px; border-bottom: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.2)); font-size: 0.88em; }
  .methodology-category-header { font-weight: 700; font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.07em; color: var(--vscode-descriptionForeground); padding-top: 10px !important; border-bottom: none !important; }
  .methodology-toggle-label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .methodology-name-cell { width: 60%; }

  /* ── Testing: per-policy coverage board ───────────────────────────
     Each enabled policy gets a card whose left edge carries its status, so the
     shape of the board is readable before any label is: a column of green edges
     is a covered suite, a run of red ones is the gap the page exists to show. */
  .policy-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; margin-top: 12px; }
  .policy-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.28)); background: var(--vscode-editorWidget-background, rgba(127,127,127,0.06)); border-left-width: 3px; border-left-style: solid; }
  .policy-card.status-covered { border-left-color: var(--dash-good, #4ec9b0); }
  .policy-card.status-tooling-only { border-left-color: var(--dash-warn, #cca700); }
  .policy-card.status-missing { border-left-color: var(--dash-critical, #f14c4c); }
  .policy-card.status-not-file-evident { border-left-color: var(--vscode-widget-border, rgba(127,127,127,0.4)); opacity: 0.82; }
  .policy-card.has-failures { box-shadow: 0 0 0 1px color-mix(in srgb, var(--dash-critical, #f14c4c) 45%, transparent) inset; }
  .policy-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .policy-card-head strong { font-size: 0.92em; }
  .policy-card-detail { font-size: 0.8em; line-height: 1.4; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  .policy-card-signals { font-size: 0.76em; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  .policy-card .tag-row { margin-top: 2px; gap: 6px; }
  .policy-report-line { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 0.84em; margin-top: 4px; }
  .policy-report-line code { font-size: 0.92em; overflow-wrap: anywhere; }
  .policy-failure-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }

  /* ── Delivery: Stages & Promotion ─────────────────────────────── */
  .stage-pipeline-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .stage-pipeline-header .tag-row { margin-top: 6px; }
  .stage-seeded-note { font-size: 0.82em; color: var(--vscode-descriptionForeground); margin: 4px 0 0; }
  .delivery-review-banner { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 12px; border-radius: 10px; margin-bottom: 14px; }
  .delivery-review-banner.warn { border: 1px solid var(--vscode-editorWarning-foreground, #cca700); background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 10%, transparent); }
  .delivery-review-banner.ok { border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.25)); color: var(--vscode-descriptionForeground); font-size: 0.84em; padding: 6px 12px; }
  .delivery-review-body strong { font-size: 0.9em; }
  .delivery-review-body ul { margin: 6px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; }
  .delivery-review-body li { font-size: 0.83em; line-height: 1.4; }
  .pipeline-flow { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; margin: 4px 0 16px; }
  .flow-node { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.3)); background: var(--vscode-editorWidget-background, rgba(127,127,127,0.06)); min-width: 130px; }
  .flow-node.current { border-color: var(--vscode-focusBorder, #4daafc); box-shadow: 0 0 0 1px var(--vscode-focusBorder, #4daafc) inset; }
  .flow-node.kind-production { border-left: 3px solid var(--vscode-charts-red, #f14c4c); }
  .flow-node.kind-staging { border-left: 3px solid var(--vscode-charts-yellow, #cca700); }
  .flow-node.kind-local { border-left: 3px solid var(--vscode-charts-blue, #4daafc); }
  .flow-name { font-weight: 700; font-size: 0.86em; }
  .flow-branch { font-size: 0.74em; color: var(--vscode-descriptionForeground); }
  .flow-ver { font-size: 0.78em; }
  .flow-arrow { display: flex; align-items: center; font-size: 1.2em; color: var(--vscode-descriptionForeground); }
  .stage-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; align-items: stretch; margin-bottom: 18px; }
  .stage-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 12px; border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.25)); background: var(--vscode-editorWidget-background, rgba(127,127,127,0.06)); }
  .stage-card.is-current { border-color: var(--vscode-focusBorder, #4daafc); box-shadow: 0 0 0 1px var(--vscode-focusBorder, #4daafc) inset; }
  .stage-card.kind-production { background: linear-gradient(180deg, rgba(220,80,80,0.10), transparent 60%); }
  .stage-card.kind-staging { background: linear-gradient(180deg, rgba(220,170,60,0.10), transparent 60%); }
  .stage-card.kind-local { background: linear-gradient(180deg, rgba(110,160,220,0.10), transparent 60%); }
  .stage-head { display: flex; align-items: center; gap: 8px; }
  .stage-rank { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; font-size: 0.78em; font-weight: 700; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); flex: 0 0 auto; }
  .stage-head h4 { margin: 0; font-size: 1.02em; }
  .stage-kind-badge { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.3)); color: var(--vscode-descriptionForeground); }
  .stage-lock { margin-left: auto; font-size: 0.95em; }
  .stage-current-tag { font-size: 0.68em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vscode-focusBorder, #4daafc); font-weight: 700; }
  .stage-desc { margin: 0; font-size: 0.86em; color: var(--vscode-descriptionForeground); line-height: 1.45; }
  .stage-facts { display: grid; grid-template-columns: 1fr; gap: 4px; margin: 2px 0; }
  .stage-fact { display: flex; justify-content: space-between; gap: 10px; font-size: 0.82em; padding: 3px 0; border-bottom: 1px dashed var(--vscode-widget-border, rgba(127,127,127,0.18)); }
  .stage-fact span { color: var(--vscode-descriptionForeground); }
  .stage-fact b { font-weight: 600; text-align: right; word-break: break-word; }
  .stage-fact .missing-ref { color: var(--vscode-errorForeground, #f14c4c); }
  .stage-security { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .stage-security li { position: relative; padding-left: 18px; font-size: 0.8em; line-height: 1.4; color: var(--vscode-foreground); }
  .stage-security li::before { content: "🛡"; position: absolute; left: 0; top: 0; font-size: 0.85em; opacity: 0.85; }
  .stage-security li.warn { color: var(--vscode-editorWarning-foreground, #cca700); }
  .stage-security li.warn::before { content: "⚠"; }
  .stage-card .action-link { align-self: flex-start; }

  .promotion-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  .promotion-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 12px; border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.25)); background: var(--vscode-editorWidget-background, rgba(127,127,127,0.06)); }
  .promotion-card.blocked { border-color: var(--vscode-editorWarning-foreground, #cca700); }
  .promotion-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .promotion-head h4 { margin: 0; font-size: 0.98em; }
  .promotion-head .version-delta { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.8em; color: var(--vscode-descriptionForeground); }
  .via-pr-badge { font-size: 0.68em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--vscode-charts-purple, #b180d7); color: var(--vscode-charts-purple, #b180d7); white-space: nowrap; }
  .guardrail-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
  .guardrail-list li { font-size: 0.82em; line-height: 1.4; }
  .gate-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 0.8em; color: var(--vscode-descriptionForeground); }
  .promotion-block-note { font-size: 0.8em; color: var(--vscode-editorWarning-foreground, #cca700); margin: 0; display: flex; gap: 6px; }
  .promotion-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 2px; }
  .promotion-ghost-btn { font-size: 0.8em; padding: 5px 10px; border-radius: 7px; border: 1px dashed var(--vscode-widget-border, rgba(127,127,127,0.4)); background: transparent; color: var(--vscode-descriptionForeground); cursor: not-allowed; }
  .promotion-last { font-size: 0.78em; color: var(--vscode-descriptionForeground); margin: 0; }

  /* ── Delivery: stage / promotion editors (Phase 2) ────────────── */
  .stage-card-foot { margin-top: auto; padding-top: 6px; display: flex; justify-content: flex-end; }
  .promotion-section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .action-link.primary { font-weight: 700; color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, #0e639c); padding: 5px 12px; border-radius: 7px; border: none; }
  .action-link.primary:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
  .action-link.danger { color: var(--vscode-errorForeground, #f14c4c); }
  .stage-editor, .path-editor { grid-column: 1 / -1; margin: 6px 0 12px; border-color: var(--vscode-focusBorder, #4daafc); }
  /* The hidden attribute must actually hide. Any author rule that sets a
     display value (every .stage-edit-grid, .tag-row, flex or grid container
     here) outranks the user-agent rule for [hidden], so without this an
     element marked hidden stays fully visible. */
  [hidden] { display: none !important; }
  .stage-edit-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 4px 0; }
  /* One communication channel. A person may need several, so the rows repeat. */
  .director-link-row { align-items: end; }
  /* The agent binding is a checklist, not one choice: a correspondent can span
     more than one specialism. Collapsed by default so the form stays readable. */
  .director-agent-picker { border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(127,127,127,0.4)));
    border-radius: 6px; background: var(--vscode-input-background); padding: 4px 7px; }
  .director-agent-picker > summary { cursor: pointer; padding: 2px 0; color: var(--vscode-input-foreground); }
  .director-agent-options { display: flex; flex-direction: column; gap: 3px; max-height: 190px; overflow-y: auto; padding: 6px 0 2px; }
  .director-agent-options .stage-edit-check { margin: 0; }
  .stage-edit-field { display: flex; flex-direction: column; gap: 3px; font-size: 0.8em; }
  .stage-edit-field > span { color: var(--vscode-descriptionForeground); }
  .stage-edit-field input[type="text"], .stage-edit-field input[type="number"], .stage-edit-field textarea, .stage-edit-field select {
    width: 100%; box-sizing: border-box; padding: 5px 7px; border-radius: 6px;
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(127,127,127,0.4)));
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    font-family: inherit; font-size: 1em;
  }
  .stage-edit-field textarea { resize: vertical; min-height: 38px; }
  .stage-edit-check { display: flex; align-items: center; gap: 7px; font-size: 0.82em; margin: 6px 0; }
  .stage-edit-check input { flex: 0 0 auto; }
  .stage-edit-group { margin: 12px 0 2px; font-size: 0.74em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.18)); padding-top: 8px; }
  .stage-edit-group small { font-weight: 400; text-transform: none; letter-spacing: 0; margin-left: 6px; opacity: 0.85; }
  .stage-edit-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; }
  .stage-remove-confirm { font-size: 0.82em; color: var(--vscode-editorWarning-foreground, #cca700); display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .reimport-confirm { font-size: 0.82em; color: var(--vscode-editorWarning-foreground, #cca700); display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .rollback-input { padding: 3px 6px; border-radius: 5px; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(127,127,127,0.4))); background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-size: 0.95em; }
  .stage-card-foot { gap: 10px; }
  .history-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 0.82em; padding: 4px 0; border-bottom: 1px dashed var(--vscode-widget-border, rgba(127,127,127,0.18)); }
  .history-row.good > span:first-child { color: var(--vscode-charts-green, #89d185); }
  .history-row.bad > span:first-child { color: var(--vscode-errorForeground, #f14c4c); }
  .history-row .list-meta { color: var(--vscode-descriptionForeground); }

  /* ── Delivery: promotion execution modal (Phase 3) ────────────── */
  .promo-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: flex-start; justify-content: center; padding: 40px 16px; z-index: 1000; overflow-y: auto; }
  .promo-modal { width: min(680px, 100%); background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.4)); border-radius: 14px; padding: 20px 22px; box-shadow: 0 18px 50px rgba(0,0,0,0.45); }
  .promo-modal > h3 { margin: 0 0 12px; font-size: 1.1em; }
  .promo-section { margin: 14px 0; }
  .promo-section > h4 { margin: 0 0 6px; font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vscode-descriptionForeground); }
  .promo-plan-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .promo-plan-step { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.2)); background: var(--vscode-editor-background); }
  .promo-plan-step-head { display: flex; align-items: center; gap: 8px; }
  .promo-step-badge { font-size: 0.66em; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.35)); color: var(--vscode-descriptionForeground); }
  .promo-step-badge.managed { color: var(--vscode-charts-blue, #4daafc); border-color: currentColor; }
  .promo-plan-step-detail { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-top: 3px; }
  .promo-cmd { margin: 6px 0 0; padding: 6px 8px; border-radius: 6px; background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.12)); font-family: var(--vscode-editor-font-family, monospace); font-size: 0.78em; white-space: pre-wrap; word-break: break-word; }
  .promo-check-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .promo-check { font-size: 0.84em; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
  .promo-check small { color: var(--vscode-descriptionForeground); width: 100%; padding-left: 18px; }
  .promo-check.pass { color: var(--vscode-charts-green, #89d185); }
  .promo-check.fail { color: var(--vscode-errorForeground, #f14c4c); }
  .promo-check.manual { color: var(--vscode-foreground); }
  .promo-check.manual label { display: inline-flex; gap: 7px; align-items: center; cursor: pointer; }
  .promo-fix-tag { font-size: 0.66em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--vscode-charts-blue, #4daafc); color: var(--vscode-charts-blue, #4daafc); white-space: nowrap; }
  .promo-remediation { font-size: 0.82em; margin: 10px 0 0; padding: 9px 11px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--vscode-charts-blue, #4daafc) 45%, transparent); background: color-mix(in srgb, var(--vscode-charts-blue, #4daafc) 10%, transparent); display: flex; flex-direction: column; gap: 3px; }
  .promo-remediation small { color: var(--vscode-descriptionForeground); }
  .promo-progress-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .promo-step { font-size: 0.84em; }
  .promo-step.done { color: var(--vscode-charts-green, #89d185); }
  .promo-step.failed { color: var(--vscode-errorForeground, #f14c4c); }
  .promo-step.running { color: var(--vscode-charts-blue, #4daafc); }
  .promo-step-out { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.82em; color: var(--vscode-descriptionForeground); margin: 2px 0 0 18px; white-space: pre-wrap; word-break: break-word; }
  .promo-result.good > h4 { color: var(--vscode-charts-green, #89d185); }
  .promo-result.bad > h4 { color: var(--vscode-errorForeground, #f14c4c); }

  /* ── Reduced motion ───────────────────────────────────────────────────
     The stylesheet had no prefers-reduced-motion handling at all. Every
     animation degrades to a plain state change; nothing is hidden, only the
     movement is removed. applyValueAnimations() also short-circuits on the
     same signal, so reduced-motion users never pay the class churn either. */
  @media (prefers-reduced-motion: reduce) {
    .chart-bars.is-animating .chart-bar-column {
      animation: none;
    }
    .score-ring-progress,
    .metric-meter > span,
    .coverage-bar > span,
    .mvp-progress-fill,
    .dist-seg,
    .nav-tab,
    .stat-card,
    .chart-bar,
    .action-card,
    .recent-item,
    .signal-card,
    .risk-cell,
    .artifact-row,
    .ideation-card,
    button.recent-item::after,
    .recent-item.is-actionable::after,
    button.branch-card::after,
    button.artifact-row::after {
      transition: none;
    }
    .stat-card.is-actionable:hover,
    .stat-card.is-actionable:focus-visible,
    .action-card.is-actionable:hover,
    .action-card.is-actionable:focus-visible,
    button.recent-item:hover,
    button.recent-item:focus-visible,
    .recent-item.is-actionable:hover,
    .recent-item.is-actionable:focus-visible,
    .branch-card:hover,
    .branch-card:focus-visible,
    .workflow-card:hover,
    .workflow-card:focus-visible,
    .review-card:hover,
    .review-card:focus-visible,
    button.risk-cell:hover,
    button.risk-cell:focus-visible,
    .signal-card.is-actionable:hover,
    .signal-card.is-actionable:focus-visible,
    .score-component-row.is-actionable:hover,
    .score-component-row.is-actionable:focus-visible,
    .ideation-card:hover {
      transform: none;
    }
    button.recent-item:hover::after,
    button.recent-item:focus-visible::after,
    .recent-item.is-actionable:hover::after,
    .recent-item.is-actionable:focus-visible::after,
    button.branch-card:hover::after,
    button.branch-card:focus-visible::after,
    button.artifact-row:hover::after,
    button.artifact-row:focus-visible::after {
      transform: none;
    }
  }
`;
