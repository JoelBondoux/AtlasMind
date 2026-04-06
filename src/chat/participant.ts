import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type {
  SessionSuggestedFollowup,
  SessionTranscriptEntry,
  SessionTranscriptMetadata,
} from './sessionConversation.js';
import type {
  ChangedWorkspaceFile,
  ProjectProgressUpdate,
  ProjectResult,
  ProjectRunSubTaskArtifact,
  ProjectRunSummary,
  SubTaskResult,
  TaskImageAttachment,
  TaskResult,
} from '../types.js';
import { Planner } from '../core/planner.js';
import { TaskProfiler } from '../core/taskProfiler.js';
import { describeCommonRoutingNeeds, shouldBiasTowardWorkspaceInvestigation } from '../core/orchestrator.js';
import { mergeImageAttachments, resolveInlineImageAttachments, resolvePickedImageAttachments } from './imageAttachments.js';

export { extractImagePathCandidates, mergeImageAttachments, resolveInlineImageAttachments } from './imageAttachments.js';

export const ATLASMIND_CHAT_PARTICIPANT_ID = 'atlasmind.orchestrator';

const PROJECT_APPROVAL_TOKEN = '--approve';
const DEFAULT_PROJECT_APPROVAL_FILE_THRESHOLD = 12;
const DEFAULT_ESTIMATED_FILES_PER_SUBTASK = 2;
const DEFAULT_CHANGED_FILE_REFERENCE_LIMIT = 5;
const DEFAULT_PROJECT_RUN_REPORT_FOLDER = 'project_memory/operations';
const DEFAULT_SSOT_PATH = 'project_memory';
const WORKSPACE_SNAPSHOT_EXCLUDE = '**/{.git,node_modules,out,dist,coverage}/**';
const AUTONOMOUS_CONTINUATION_PATTERN = /^\s*(?:please\s+)?(?:proceed|continue|resume|carry on|go ahead)(?:\s+(?:autonomously|automatically|with autopilot|on autopilot))?(?:\s*(?:on|with|for)\s+(.+?))?[.!?]*\s*$/i;
const PROJECT_RUN_REQUEST_PATTERN = /^\s*(?:please\s+)?(?:(?:start|begin|run|launch|kick off|continue|switch to)\s+(?:an?\s+)?)?(?:atlasmind\s+)?(?:autonomous\s+)?project(?:\s+run|\s+execution|\s+task)?\b(?:\s+(?:to|for|on|about|that|which))?\s*(.+)?$/i;
const EXPLICIT_FIX_PROMPT_PATTERN = /\b(?:fix|patch|repair|resolve|implement|update|change|modify|correct|adjust|rewrite|refactor)\b/i;
const EXPLICIT_NO_FIX_PATTERN = /\b(?:do not fix|don't fix|without changing|no code changes|read only|explain only|question only)\b/i;
const CONCRETE_ISSUE_PROMPT_PATTERN = /\b(?:bug|issue|problem|broken|regression|failing|fails|error|incorrect|wrong|missing|stuck|overflow|scroll|layout|sidebar|dropdown|panel|webview|tooltip|session rail|hides|hidden|crash|hang|stops|stopped|too tall|too wide|not working|doesn't|does not|won't|will not|can't|cannot)\b/i;
const ROADMAP_STATUS_PROMPT_PATTERN = /\broadmap\b/i;
const ROADMAP_STATUS_DETAIL_PATTERN = /\b(?:outstanding|remaining|left|pending|todo|to do|next steps?|follow-?ups?|progress|complete|completed|incomplete|address)\b/i;
const FOLLOWUP_FIX_QUESTION = 'Do you want me to fix this?';

interface RoadmapChecklistItem {
  path: string;
  text: string;
  completed: boolean;
}

export interface RoadmapStatusSnapshot {
  completed: number;
  total: number;
  outstanding: RoadmapChecklistItem[];
}

export interface AtlasChatProjectIntent {
  kind: 'project';
  goal: string;
}

export interface AtlasChatCommandIntent {
  kind: 'command';
  commandId: string;
  args?: unknown[];
  summary: string;
}

export type AtlasChatIntent = AtlasChatProjectIntent | AtlasChatCommandIntent;

interface AtlasCommandIntentDefinition {
  pattern: RegExp;
  commandId: string;
  args?: unknown[];
  summary: string;
}

const NATURAL_LANGUAGE_COMMAND_INTENTS: AtlasCommandIntentDefinition[] = [
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?chat settings\b/i,
    commandId: 'atlasmind.openSettingsChat',
    summary: 'Opened AtlasMind Chat Settings.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?model settings\b/i,
    commandId: 'atlasmind.openSettingsModels',
    summary: 'Opened AtlasMind Model Settings.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?safety settings\b/i,
    commandId: 'atlasmind.openSettingsSafety',
    summary: 'Opened AtlasMind Safety Settings.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?project settings\b/i,
    commandId: 'atlasmind.openSettingsProject',
    summary: 'Opened AtlasMind Project Settings.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?settings\b/i,
    commandId: 'atlasmind.openSettings',
    summary: 'Opened AtlasMind Settings.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?cost\s+(?:panel|dashboard)\b/i,
    commandId: 'atlasmind.openCostDashboard',
    summary: 'Opened the AtlasMind Cost Dashboard.',
  },
  {
    pattern: /\b(?:show|open)\s+(?:the\s+)?(?:atlasmind\s+)?cost\s+summary\b/i,
    commandId: 'atlasmind.showCostSummary',
    summary: 'Opened the AtlasMind cost summary.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?project run center\b/i,
    commandId: 'atlasmind.openProjectRunCenter',
    summary: 'Opened the AtlasMind Project Run Center.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?project dashboard\b/i,
    commandId: 'atlasmind.openProjectDashboard',
    summary: 'Opened the AtlasMind Project Dashboard.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?(?:project\s+)?(?:ideation\s+board|ideation\s+workspace|ideation\s+whiteboard|whiteboard)\b/i,
    commandId: 'atlasmind.openProjectIdeation',
    summary: 'Opened the AtlasMind Project Ideation workspace.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?(?:model\s+providers|providers\s+panel)\b/i,
    commandId: 'atlasmind.openModelProviders',
    summary: 'Opened AtlasMind Model Providers.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?chat\s+panel\b/i,
    commandId: 'atlasmind.openChatPanel',
    summary: 'Opened the AtlasMind Chat Panel.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?voice\s+panel\b/i,
    commandId: 'atlasmind.openVoicePanel',
    summary: 'Opened the AtlasMind Voice Panel.',
  },
  {
    pattern: /\b(?:open|show|launch|bring up)\s+(?:the\s+)?(?:atlasmind\s+)?vision\s+panel\b/i,
    commandId: 'atlasmind.openVisionPanel',
    summary: 'Opened the AtlasMind Vision Panel.',
  },
];

export interface WorkspaceSnapshotEntry {
  signature: string;
  relativePath: string;
  uri: vscode.Uri;
  textContent?: string;
}

export interface ProjectUiConfig {
  approvalFileThreshold: number;
  estimatedFilesPerSubtask: number;
  changedFileReferenceLimit: number;
  runReportFolder: string;
}

export interface ProjectRunOutcome {
  hasFailures: boolean;
  hasChangedFiles: boolean;
  /** Display titles of subtasks that ended with status 'failed'. */
  failedSubtaskTitles: string[];
}

export interface AssistantResponseReconciliation {
  additionalText: string;
  transcriptText: string;
}

/**
 * Registers the @atlas chat participant with VS Code's Chat API.
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): void {
  const participant = vscode.chat.createChatParticipant(
    ATLASMIND_CHAT_PARTICIPANT_ID,
    createAtlasMindChatRequestHandler(atlas),
  );

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');

  participant.followupProvider = createAtlasMindFollowupProvider();

  context.subscriptions.push(participant);
}

export function createAtlasMindChatRequestHandler(atlas: AtlasMindContext) {
  return (request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) =>
    handleNativeChatRequest(request, chatContext, stream, token, atlas);
}

export function createAtlasMindFollowupProvider(): vscode.ChatFollowupProvider {
  return {
    provideFollowups(
      result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken,
    ): vscode.ChatFollowup[] {
      return buildFollowups(
        result.metadata?.['command'] as string | undefined,
        result.metadata?.['outcome'] as ProjectRunOutcome | undefined,
        result.metadata?.['suggestedFollowups'] as SessionSuggestedFollowup[] | undefined,
      );
    },
  };
}

export function buildNativeChatContextSummary(
  request: Pick<vscode.ChatRequest, 'references' | 'toolReferences' | 'model'>,
  chatContext: Pick<vscode.ChatContext, 'history'>,
): string {
  const sections: string[] = [];

  const references = [
    ...(request.references ?? []).map(reference => reference.modelDescription ?? String(reference.value ?? reference.id ?? 'reference')),
    ...(request.toolReferences ?? []).map(reference => reference.name ?? 'tool-reference'),
  ].filter(item => typeof item === 'string' && item.trim().length > 0);

  if (references.length > 0) {
    sections.push(`Attached chat references:\n- ${references.join('\n- ')}`);
  }

  if (request.model?.id) {
    sections.push(`VS Code chat model: ${request.model.id}.`);
  }

  const historyLines = buildNativeChatHistoryLines(chatContext);
  if (historyLines.length > 0) {
    sections.push(`Native chat history:\n${historyLines.join('\n')}`);
  }

  return sections.join('\n\n');
}

export function buildWorkstationContext(
  options?: { platform?: NodeJS.Platform; terminalProfile?: string },
): string | undefined {
  const platform = options?.platform ?? process.platform;
  const platformLabel = toPlatformLabel(platform);
  const terminalProfile = options?.terminalProfile ?? getConfiguredTerminalProfile(platform);

  const lines = [`Host OS: ${platformLabel}.`];
  if (terminalProfile) {
    lines.push(`Preferred terminal in VS Code: ${terminalProfile}.`);
  }

  if (platform === 'win32') {
    const preferredShell = terminalProfile ?? 'PowerShell';
    lines.push(`When suggesting commands, default to ${preferredShell} syntax, Windows paths, and VS Code terminal usage unless the user asks for another shell or platform.`);
  } else if (terminalProfile) {
    lines.push(`When suggesting commands, default to ${terminalProfile} syntax and conventions unless the user asks for another shell or platform.`);
  }

  return `Workstation context:\n- ${lines.join('\n- ')}`;
}

async function handleNativeChatRequest(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
): Promise<vscode.ChatResult> {
  if (request.command) {
    return handleChatRequest(request, chatContext, stream, token, atlas);
  }

  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const storedSessionContext = atlas.sessionConversation.buildContext({
    maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
    maxChars: configuration.get<number>('chatSessionContextChars', 2500),
  });
  const nativeHistory = buildNativeChatHistoryLines(chatContext).join('\n');
  const nativeChatContext = buildNativeChatContextSummary(request, chatContext);
  const workstationContext = buildWorkstationContext();
  const sessionContext = [storedSessionContext, nativeHistory].filter(Boolean).join('\n\n');

  let streamedText = '';
  const result = await atlas.orchestrator.processTask({
    id: `task-${Date.now()}`,
    userMessage: request.prompt,
    context: {
      ...(sessionContext ? { sessionContext } : {}),
      ...(nativeChatContext ? { nativeChatContext } : {}),
      ...(workstationContext ? { workstationContext } : {}),
    },
    constraints: {
      budget: toBudgetMode(configuration.get<string>('budgetMode')),
      speed: toSpeedMode(configuration.get<string>('speedMode')),
    },
    timestamp: new Date().toISOString(),
  }, chunk => {
    if (!chunk) {
      return;
    }
    streamedText += chunk;
    writeMarkdownChunk(stream, chunk, 'native chat response chunk');
  }, message => {
    if (!message.trim()) {
      return;
    }
    stream.progress(message);
  });

  const reconciled = reconcileAssistantResponse(streamedText, result.response);
  if (reconciled.additionalText) {
    writeMarkdownChunk(stream, reconciled.additionalText, 'native chat completion');
  }

  const assistantMeta = buildAssistantResponseMetadata(request.prompt, result, {
    hasSessionContext: Boolean(sessionContext),
    routingContext: sessionContext ? { sessionContext } : {},
  });
  if (assistantMeta.followupQuestion) {
    writeMarkdownChunk(stream, `\n\n**Next step:** ${assistantMeta.followupQuestion}`, 'native chat follow-up prompt');
  }
  if (!token.isCancellationRequested) {
    atlas.sessionConversation.recordTurn(request.prompt, reconciled.transcriptText, undefined, assistantMeta);
  }

  return {
    metadata: {
      command: request.command ?? 'freeform',
      ...(assistantMeta.suggestedFollowups ? { suggestedFollowups: assistantMeta.suggestedFollowups } : {}),
    },
  };
}

function buildNativeChatHistoryLines(chatContext: Pick<vscode.ChatContext, 'history'>): string[] {
  const lines: string[] = [];
  for (const item of chatContext.history ?? []) {
    if ('prompt' in item && typeof item.prompt === 'string' && item.prompt.trim().length > 0) {
      lines.push(`User: ${item.prompt.trim()}`);
    }
    if ('response' in item && Array.isArray(item.response)) {
      for (const part of item.response) {
        if (part && typeof part === 'object' && 'value' in part && typeof part.value === 'string' && part.value.trim().length > 0) {
          lines.push(`Assistant: ${part.value.trim()}`);
        }
      }
    }
  }
  return lines;
}

async function handleChatRequest(
  request: vscode.ChatRequest,
  _chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
): Promise<vscode.ChatResult> {
  const command = request.command;
  let projectOutcome: ProjectRunOutcome | undefined;

  if (token.isCancellationRequested) {
    return {};
  }

  switch (command) {
    case 'bootstrap':
      await handleBootstrapCommand(stream, atlas);
      break;

    case 'import':
      await handleImportCommand(stream, atlas);
      break;

    case 'agents':
      await handleAgentsCommand(stream, atlas);
      break;

    case 'skills':
      await handleSkillsCommand(stream, atlas);
      break;

    case 'memory':
      await handleMemoryCommand(request.prompt, stream, atlas);
      break;

    case 'cost':
      await handleCostCommand(stream, atlas);
      break;

    case 'project':
      projectOutcome = await runProjectCommand(request.prompt, stream, token, atlas);
      break;

    case 'runs':
      await handleRunsCommand(stream);
      break;

    case 'voice':
      await handleVoiceCommand(stream);
      break;

    case 'vision':
      await handleVisionCommand(request, stream, atlas);
      break;

    default: {
      const routedIntent = resolveAtlasChatIntent(
        request.prompt,
        atlas.sessionConversation.getTranscript(),
      );
      if (routedIntent?.kind === 'project') {
        stream.markdown('### Autonomous Run\n\nContinuing from your earlier request and switching into project execution mode.');
        projectOutcome = await runProjectCommand(
          toApprovedProjectPrompt(routedIntent.goal),
          stream,
          token,
          atlas,
        );
        break;
      }

      if (routedIntent?.kind === 'command') {
        await vscode.commands.executeCommand(routedIntent.commandId, ...(routedIntent.args ?? []));
        stream.markdown(routedIntent.summary);
        break;
      }

      await handleFreeformMessage(request, stream, atlas);
      break;
    }
  }

  return { metadata: { command: command ?? 'freeform', outcome: projectOutcome } };
}

export async function runProjectCommand(
  prompt: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
): Promise<ProjectRunOutcome> {
  const noOpOutcome: ProjectRunOutcome = { hasFailures: false, hasChangedFiles: false, failedSubtaskTitles: [] };

  if (!prompt.trim()) {
    stream.markdown('Usage: `/project <goal>` — describe what you want to build or accomplish.');
    return noOpOutcome;
  }

  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const constraints = {
    budget: toBudgetMode(configuration.get<string>('budgetMode')),
    speed: toSpeedMode(configuration.get<string>('speedMode')),
  };
  const projectUiConfig = getProjectUiConfig(configuration);

  const approved = prompt.includes(PROJECT_APPROVAL_TOKEN);
  const goal = prompt.replace(PROJECT_APPROVAL_TOKEN, '').trim();
  const planner = new Planner(atlas.modelRouter, atlas.providerRegistry, new TaskProfiler());
  const runStartedAt = new Date().toISOString();
  const baselineSnapshot = await createWorkspaceSnapshot();
  let lastImpactSnapshot = baselineSnapshot;
  let impactReporting = Promise.resolve();
  const fileAttribution = new Map<string, Set<string>>();

  // Preview plan and estimate impact before execution.
  const preview = await planner.plan(goal, constraints);
  const estimatedFiles = estimateTouchedFiles(
    preview.subTasks.length,
    projectUiConfig.estimatedFilesPerSubtask,
  );
  stream.markdown(
    `### Preview\n\n` +
    `Estimated files to touch: **~${estimatedFiles}**\n\n` +
    `Execution policy: **tests first where behavior changes**. Atlas will try to follow a red-green-refactor loop autonomously and report the verification evidence it found.\n\n`,
  );

  // Cost estimation
  const costEstimate = atlas.orchestrator.estimateProjectCost(preview.subTasks.length, constraints);
  if (costEstimate.highUsd > 0) {
    stream.markdown(
      `Estimated cost: **$${costEstimate.lowUsd.toFixed(4)} – $${costEstimate.highUsd.toFixed(4)}**\n\n`,
    );
  }

  stream.markdown(
    `| ID | Title | Role | Depends on |\n|---|---|---|---|\n` +
    preview.subTasks
      .map(t => `| ${t.id} | ${t.title} | ${t.role} | ${t.dependsOn.join(', ') || '-'} |`)
      .join('\n'),
  );

  if (estimatedFiles > projectUiConfig.approvalFileThreshold && !approved) {
    stream.markdown(
      `\n\n\u26a0\ufe0f **Approval required**: this project is estimated to modify **~${estimatedFiles} files**, ` +
      `which exceeds the safety threshold of ${projectUiConfig.approvalFileThreshold}. ` +
      `This gate exists to prevent unreviewed large-scale changes — you can adjust it in ` +
      `AtlasMind Settings → Advanced → Approval Threshold.\n\n` +
      `Re-run with \`${PROJECT_APPROVAL_TOKEN}\` to proceed.`,
    );
    stream.button({
      command: 'atlasmind.showCostSummary',
      title: 'Show Cost Summary',
      tooltip: 'Review current session cost before approving a large run.',
    });
    return noOpOutcome;
  }

  stream.progress('Planning project...');

  const failedSubtaskTitles: string[] = [];

  const onProgress = (update: ProjectProgressUpdate): void => {
    if (token.isCancellationRequested) { return; }

    switch (update.type) {
      case 'planned': {
        const rows = update.plan.subTasks.map(
          t => `| ${t.id} | ${t.title} | ${t.role} | ${t.dependsOn.join(', ') || '\u2014'} |`,
        );
        stream.markdown(
          `### Plan: ${update.plan.subTasks.length} subtask(s)\n\n` +
          `| ID | Title | Role | Depends on |\n|---|---|---|---|\n` +
          rows.join('\n') + '\n',
        );
        break;
      }
      case 'batch-start':
        stream.progress(
          `Batch ${update.batchIndex}/${update.totalBatches}: ${update.batchSize} subtask(s) running in parallel`,
        );
        break;
      case 'subtask-start':
        stream.progress(`Running: ${update.title}`);
        break;
      case 'subtask-done': {
        const r = update.result;
        const icon = r.status === 'completed' ? '\u2705' : '\u274c';
        const body = r.status === 'completed'
          ? r.output.slice(0, 400) + (r.output.length > 400 ? '\u2026' : '')
          : `*Error: ${r.error ?? 'unknown'}*`;
        stream.markdown(
          `${icon} **${r.title}** \u2014 ${update.completed}/${update.total} ` +
          `(${r.durationMs}ms, $${r.costUsd.toFixed(4)})\n\n${body}\n\n---\n`,
        );
        if (r.status === 'failed') {
          failedSubtaskTitles.push(r.title);
        }
        impactReporting = impactReporting.then(async () => {
          const impact = await collectWorkspaceChangesSince(lastImpactSnapshot);
          lastImpactSnapshot = impact.snapshot;
          const changedFiles = impact.changedFiles;
          if (token.isCancellationRequested || changedFiles.length === 0) {
            return;
          }

          addFileAttribution(fileAttribution, r.title, changedFiles);

          const summary = summarizeChangedFiles(changedFiles);
          stream.markdown(
            `_Subtask file impact: ${changedFiles.length} changed file(s)` +
            ` (${summary})_`,
          );
        });
        break;
      }
      case 'synthesizing':
        stream.progress('Synthesizing results...');
        break;
      case 'error':
        stream.markdown(`\u274c **Planning error:** ${update.message}`);
        break;
    }
  };

  try {
    const result = await atlas.orchestrator.processProject(
      goal,
      constraints,
      onProgress,
    );
    await impactReporting;
    const changedFiles = (await collectWorkspaceChangesSince(baselineSnapshot)).changedFiles;
    const report = buildProjectRunSummary(result, changedFiles, fileAttribution, runStartedAt);
    const reportUri = await writeProjectRunSummaryReport(report, projectUiConfig.runReportFolder);

    stream.markdown(`## Project Report\n\n${result.synthesis}`);
    stream.markdown(
      `\n\n---\n*${result.subTaskResults.length} subtask(s) \u00b7 ` +
      `${(result.totalDurationMs / 1000).toFixed(1)}s \u00b7 ` +
      `$${result.totalCostUsd.toFixed(4)}*`,
    );
    if (changedFiles.length > 0) {
      stream.markdown(
        `\n\n### Changed Files\n\n` +
        `${changedFiles.length} file(s) changed since the project started ` +
        `(${summarizeChangedFiles(changedFiles)}).`,
      );

      // Diff preview table
      const diffRows = changedFiles.slice(0, projectUiConfig.changedFileReferenceLimit).map(file => {
        return `| \`${file.relativePath}\` | ${file.status} |`;
      });
      stream.markdown(
        `\n\n| File | Status |\n|---|---|\n${diffRows.join('\n')}\n`,
      );

      for (const file of changedFiles.slice(0, projectUiConfig.changedFileReferenceLimit)) {
        if (file.uri) {
          const referenceUri = 'scheme' in file.uri
            ? file.uri as vscode.Uri
            : vscode.Uri.file(file.uri.fsPath);
          stream.reference(referenceUri);
        }
      }

      stream.button({
        command: 'workbench.view.scm',
        title: 'Open Source Control',
        tooltip: 'View all diffs in the Source Control panel.',
      });
    }
    if (reportUri) {
      stream.markdown(`\n\nProject run summary saved to **${vscode.workspace.asRelativePath(reportUri, false)}**.`);
      stream.reference(reportUri);
      stream.button({
        command: 'vscode.open',
        title: 'Open Run Summary',
        arguments: [reportUri],
        tooltip: 'Open the JSON report for this /project execution.',
      });
    }
    const reportPath = reportUri ? vscode.workspace.asRelativePath(reportUri, false) : undefined;
    const subTaskArtifacts = buildProjectRunSubTaskArtifacts(result.subTaskResults);
    await atlas.projectRunHistory.upsertRun({
      id: result.id,
      goal,
      status: failedSubtaskTitles.length > 0 ? 'failed' : 'completed',
      createdAt: runStartedAt,
      updatedAt: new Date().toISOString(),
      estimatedFiles,
      requiresApproval: estimatedFiles > projectUiConfig.approvalFileThreshold,
      planSubtaskCount: preview.subTasks.length,
      completedSubtaskCount: result.subTaskResults.filter(item => item.status === 'completed').length,
      totalSubtaskCount: result.subTaskResults.length,
      currentBatch: 0,
      totalBatches: 0,
      failedSubtaskTitles: [...failedSubtaskTitles],
      plan: preview,
      subTaskArtifacts,
      requireBatchApproval: false,
      paused: false,
      awaitingBatchApproval: false,
      reportPath,
      summary: report,
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: failedSubtaskTitles.length > 0 ? 'warning' : 'info',
          message: failedSubtaskTitles.length > 0
            ? `Run completed with ${failedSubtaskTitles.length} failed subtask(s).`
            : 'Run completed successfully.',
        },
      ],
    });
    atlas.projectRunsRefresh.fire();
    stream.button({
      command: 'atlasmind.showCostSummary',
      title: 'Show Cost Summary',
      tooltip: 'Open a quick session cost summary.',
    });
    stream.button({
      command: 'atlasmind.openProjectRunCenter',
      title: 'Open Project Run Center',
      tooltip: 'Review run history and execute the next reviewed project run.',
    });
    stream.button({
      command: 'workbench.action.tasks.test',
      title: 'Run Tests',
      tooltip: 'Run the test task for this workspace.',
    });
    stream.button({
      command: 'atlasmind.openModelProviders',
      title: 'Manage Providers',
      tooltip: 'Review model/provider settings after execution.',
    });

    if (failedSubtaskTitles.length > 0) {
      stream.markdown(
        `\n\n---\n\u26a0\ufe0f **${failedSubtaskTitles.length} subtask(s) failed:**\n\n` +
        failedSubtaskTitles.map(t => `- ${t}`).join('\n'),
      );
      if (changedFiles.length > 0) {
        stream.markdown(
          `\n_${changedFiles.length} file(s) were modified before the failure. ` +
          `Use Source Control to review or revert the partial changes._`,
        );
        stream.button({
          command: 'workbench.view.scm',
          title: 'View Source Control',
          tooltip: 'Review and revert changes made by the partial run.',
        });
      }
    }

    return {
      hasFailures: failedSubtaskTitles.length > 0,
      hasChangedFiles: changedFiles.length > 0,
      failedSubtaskTitles,
    };
  } catch (err) {
    stream.markdown(
      `\u274c **Project execution failed:** ${err instanceof Error ? err.message : String(err)}`,
    );
    return { hasFailures: true, hasChangedFiles: false, failedSubtaskTitles: ['Project execution failed'] };
  }
}

async function handleRunsCommand(stream: vscode.ChatResponseStream): Promise<void> {
  stream.markdown(
    '### Project Run Center\n\n' +
    'Open the Project Run Center to preview a goal before execution, inspect durable run history, ' +
    'and review changed files or reports from earlier project runs.',
  );
  stream.button({
    command: 'atlasmind.openProjectRunCenter',
    title: 'Open Project Run Center',
    tooltip: 'Open the review/apply and run-history panel.',
  });
}

async function handleAgentsCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const agents = atlas.agentRegistry.listAgents();
  if (agents.length === 0) {
    stream.markdown('No agents registered yet. Use the sidebar to add agents.');
    return;
  }
  const lines = agents.map(a => `- **${a.name}** \u2013 ${a.role}`);
  stream.markdown(`### Registered Agents\n\n${lines.join('\n')}`);
}

async function handleBootstrapCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown('Open a workspace folder first, then run `/bootstrap` again.');
    return;
  }

  const { bootstrapProject } = await import('../bootstrap/bootstrapper.js');
  await bootstrapProject(workspaceFolder.uri, atlas);
  stream.markdown('Bootstrap completed. AtlasMind also offered governance baseline scaffolding for this project.');
}

async function handleImportCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown('Open a workspace folder first, then run `/import` again.');
    return;
  }

  stream.markdown('Scanning project files and populating memory…\n\n');

  const { importProject } = await import('../bootstrap/bootstrapper.js');
  const result = await importProject(workspaceFolder.uri, atlas);

  const lines: string[] = [];
  lines.push(`### Project Import Complete\n`);
  if (result.projectType) {
    lines.push(`**Detected type**: ${result.projectType}\n`);
  }
  lines.push(`- **${result.entriesCreated}** memory entries created`);
  lines.push(`- **${result.entriesSkipped}** entries skipped (duplicate or rejected)\n`);
  lines.push('The SSOT memory is now populated. Use `/memory` to query it, or ask `@atlas` a question about the project.');

  stream.markdown(lines.join('\n'));
}

async function handleSkillsCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const skills = atlas.skillsRegistry.listSkills();
  if (skills.length === 0) {
    stream.markdown('No skills registered yet.');
    return;
  }
  const lines = skills.map(s => `- **${s.name}** \u2013 ${s.description}`);
  stream.markdown(`### Registered Skills\n\n${lines.join('\n')}`);
}

async function handleCostCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const summary = atlas.costTracker.getSummary();
  stream.markdown(
    `### Session Cost Summary\n\n` +
    `| Metric | Value |\n|---|---|\n` +
    `| Total cost | $${summary.totalCostUsd.toFixed(4)} |\n` +
    `| Requests | ${summary.totalRequests} |\n` +
    `| Input tokens | ${summary.totalInputTokens.toLocaleString()} |\n` +
    `| Output tokens | ${summary.totalOutputTokens.toLocaleString()} |`,
  );
}

async function handleFreeformMessage(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const prompt = request.prompt;
  const roadmapStatusMarkdown = await buildRoadmapStatusMarkdown(prompt);
  if (roadmapStatusMarkdown) {
    stream.markdown(roadmapStatusMarkdown);
    return;
  }
  const imageAttachments = await resolveInlineImageAttachments(prompt);
  await runChatTask(prompt, stream, atlas, imageAttachments);
}

async function handleVisionCommand(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const selectedAttachments = await pickImageAttachments();
  if (selectedAttachments.length === 0) {
    stream.markdown('No images were selected. Run `/vision` again and choose one or more workspace images.');
    return;
  }

  stream.markdown(
    `### Attached Images\n\n${selectedAttachments.map(image => `- ${image.source}`).join('\n')}`,
  );

  const prompt = request.prompt.trim().length > 0
    ? request.prompt.trim()
    : 'Describe the attached images and highlight anything important.';

  await runChatTask(prompt, stream, atlas, selectedAttachments);
}

async function runChatTask(
  prompt: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
  explicitAttachments: TaskImageAttachment[] = [],
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const sessionContext = atlas.sessionConversation.buildContext({
    maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
    maxChars: configuration.get<number>('chatSessionContextChars', 2500),
  });
  const workstationContext = buildWorkstationContext();
  const inlineAttachments = explicitAttachments.length > 0 ? [] : await resolveInlineImageAttachments(prompt);
  const imageAttachments = mergeImageAttachments(explicitAttachments, inlineAttachments);
  let streamedText = '';
  const result = await atlas.orchestrator.processTask({
    id: `task-${Date.now()}`,
    userMessage: prompt,
    context: {
      ...(sessionContext ? { sessionContext } : {}),
      ...(workstationContext ? { workstationContext } : {}),
      ...(imageAttachments.length > 0 ? { imageAttachments } : {}),
    },
    constraints: {
      budget: toBudgetMode(configuration.get<string>('budgetMode')),
      speed: toSpeedMode(configuration.get<string>('speedMode')),
      ...(imageAttachments.length > 0 ? { requiredCapabilities: ['vision' as const] } : {}),
    },
    timestamp: new Date().toISOString(),
  }, chunk => {
    if (!chunk) {
      return;
    }
    streamedText += chunk;
    writeMarkdownChunk(stream, chunk, 'chat task response chunk');
  });

  const reconciled = reconcileAssistantResponse(streamedText, result.response);
  if (reconciled.additionalText) {
    writeMarkdownChunk(stream, reconciled.additionalText, 'chat task completion');
  }
  const assistantMeta = buildAssistantResponseMetadata(prompt, result, {
    hasSessionContext: Boolean(sessionContext),
    imageAttachments,
  });
  stream.markdown(renderAssistantResponseFooter(assistantMeta));
  atlas.sessionConversation.recordTurn(prompt, reconciled.transcriptText, undefined, assistantMeta);

  // If TTS auto-speak is enabled, forward the response to the voice manager.
  if (configuration.get<boolean>('voice.ttsEnabled', false)) {
    atlas.voiceManager.speak(reconciled.transcriptText);
  }
}

export function reconcileAssistantResponse(
  streamedText: string,
  finalResponse: string,
): AssistantResponseReconciliation {
  if (!streamedText) {
    return {
      additionalText: finalResponse,
      transcriptText: finalResponse,
    };
  }

  if (!finalResponse) {
    return {
      additionalText: '',
      transcriptText: streamedText,
    };
  }

  if (streamedText === finalResponse || streamedText.trim() === finalResponse.trim()) {
    return {
      additionalText: '',
      transcriptText: finalResponse,
    };
  }

  if (finalResponse.startsWith(streamedText)) {
    return {
      additionalText: finalResponse.slice(streamedText.length),
      transcriptText: finalResponse,
    };
  }

  const joined = joinAssistantResponseSegments(streamedText, finalResponse);
  return {
    additionalText: joined.slice(streamedText.length),
    transcriptText: joined,
  };
}

function joinAssistantResponseSegments(streamedText: string, finalResponse: string): string {
  if (!streamedText) {
    return finalResponse;
  }
  if (!finalResponse) {
    return streamedText;
  }

  const needsSeparator = !/[\s\n]$/.test(streamedText) && !/^[\s\n]/.test(finalResponse);
  return `${streamedText}${needsSeparator ? '\n\n' : ''}${finalResponse}`;
}

function writeMarkdownChunk(
  stream: Pick<vscode.ChatResponseStream, 'markdown'>,
  text: string,
  context: string,
): void {
  if (!text) {
    return;
  }

  try {
    stream.markdown(text);
  } catch (error) {
    console.error(`[AtlasMind] Failed to write ${context}.`, error);
  }
}

async function handleVoiceCommand(
  stream: vscode.ChatResponseStream,
): Promise<void> {
  stream.markdown(
    '### Voice Panel\n\n' +
    'The Voice Panel provides **Text-to-Speech** (TTS) and **Speech-to-Text** (STT) ' +
    'via the browser Web Speech API — no external API key required.\n\n' +
    '| Feature | Description |\n|---|---|\n' +
    '| 🎙️ STT | Click **Start Listening** to dictate; final transcript is sent back to the extension. |\n' +
    '| 🔊 TTS | Type text and click **Speak**, or enable auto-speak in Settings to hear @atlas responses. |\n' +
    '| ⚙️ Settings | Rate, pitch, volume, and language are configurable in the panel. |\n\n' +
    '**Quick settings (in VS Code Settings):**\n' +
    '- `atlasmind.voice.ttsEnabled` — auto-speak @atlas freeform responses\n' +
    '- `atlasmind.voice.rate` — speech rate (0.5–2.0)\n',
  );
  stream.button({ command: 'atlasmind.openVoicePanel', title: '🎙️ Open Voice Panel' });
}

export function buildAssistantResponseMetadata(
  prompt: string,
  result: Pick<TaskResult, 'agentId' | 'modelUsed' | 'costUsd' | 'inputTokens' | 'outputTokens' | 'artifacts'>,
  options?: { hasSessionContext?: boolean; imageAttachments?: TaskImageAttachment[]; routingContext?: Record<string, unknown> },
): SessionTranscriptMetadata {
  const taskProfile = new TaskProfiler().profileTask({
    userMessage: prompt,
    context: {
      ...(options?.hasSessionContext ? { sessionContext: true } : {}),
      ...(options?.imageAttachments?.length ? { imageAttachments: options.imageAttachments } : {}),
    },
    phase: 'execution',
    requiresTools: Boolean(result.artifacts?.toolCallCount),
  });

  const bullets = [
    `Reasoning intensity: ${taskProfile.reasoning}.`,
    `Task modality: ${taskProfile.modality}.`,
    `Selected agent: ${result.agentId}.`,
  ];

  const routingHints = describeCommonRoutingNeeds(prompt);
  if (routingHints.length > 0) {
    bullets.push(`Routing hints: ${routingHints.join(', ')}.`);
  }

  if (shouldBiasTowardWorkspaceInvestigation(prompt, options?.routingContext ?? {})) {
    bullets.push('Workspace investigation bias applied before execution.');
  }

  if (taskProfile.requiredCapabilities.length > 0) {
    bullets.push(`Required capabilities: ${taskProfile.requiredCapabilities.join(', ')}.`);
  }

  if (options?.hasSessionContext) {
    bullets.push('Included recent session context when routing the response.');
  }

  if (result.artifacts?.toolCallCount) {
    bullets.push(`Tool loop used ${result.artifacts.toolCallCount} call(s).`);
  } else {
    bullets.push('Answered directly without invoking tools.');
  }

  bullets.push(
    `Usage: ${result.inputTokens.toLocaleString()} input token(s), ` +
    `${result.outputTokens.toLocaleString()} output token(s), ` +
    `$${result.costUsd.toFixed(4)}.`,
  );

  const tddCue = buildThoughtSummaryTddCue(result.artifacts?.tddStatus, result.artifacts?.tddSummary);
  if (tddCue) {
    bullets.push(`Red-to-green: ${tddCue.statusLabel}.`);
    if (result.artifacts?.tddSummary) {
      bullets.push(`TDD evidence: ${result.artifacts.tddSummary}.`);
    }
  }

  if (result.artifacts?.checkpointedTools.length) {
    bullets.push(`Checkpointed tools: ${result.artifacts.checkpointedTools.join(', ')}.`);
  }

  if (result.artifacts?.verificationSummary) {
    bullets.push(`Verification: ${result.artifacts.verificationSummary}.`);
  }

  const suggestedFollowups = buildSuggestedExecutionFollowups(prompt, options?.routingContext ?? {});

  return {
    modelUsed: result.modelUsed,
    ...(suggestedFollowups
      ? {
        followupQuestion: FOLLOWUP_FIX_QUESTION,
        suggestedFollowups,
      }
      : {}),
    thoughtSummary: {
      label: 'Thinking summary',
      summary: `${capitalize(taskProfile.reasoning)}-reasoning ${taskProfile.modality} task routed to ${result.modelUsed}.`,
      bullets,
      status: tddCue?.status,
      statusLabel: tddCue?.statusLabel,
    },
  };
}

export function buildProjectResponseMetadata(goal: string): SessionTranscriptMetadata {
  return {
    modelUsed: 'multiple routed models',
    thoughtSummary: {
      label: 'Execution summary',
      summary: 'Autonomous project mode can route planning, sub-agents, and synthesis through different models.',
      bullets: [
        `Goal: ${truncateForSummary(goal, 120)}.`,
        'Planner, execution, and synthesis may each pick a different model based on cost, speed, and capability constraints.',
        'Open the Project Run Center to inspect per-subtask outputs and execution history.',
      ],
    },
  };
}

export function renderAssistantResponseFooter(metadata: SessionTranscriptMetadata | undefined): string {
  if (!metadata?.modelUsed && !metadata?.thoughtSummary && !metadata?.followupQuestion) {
    return '';
  }

  const sections: string[] = [];
  if (metadata.modelUsed) {
    sections.push(`\n\n---\n_Model: ${metadata.modelUsed}_`);
  }

  if (metadata.thoughtSummary) {
    const tddLine = metadata.thoughtSummary.statusLabel
      ? `\n\n**Red-to-green:** ${metadata.thoughtSummary.statusLabel}`
      : '';
    const bulletBlock = metadata.thoughtSummary.bullets.length > 0
      ? `\n\n${metadata.thoughtSummary.bullets.map(item => `- ${item}`).join('\n')}`
      : '';
    sections.push(`\n\n**${metadata.thoughtSummary.label}:** ${metadata.thoughtSummary.summary}${tddLine}${bulletBlock}`);
  }

  if (metadata.followupQuestion) {
    const labels = metadata.suggestedFollowups?.map(item => `- ${item.label}`).join('\n') ?? '';
    sections.push(`\n\n**Next step:** ${metadata.followupQuestion}${labels ? `\n\n${labels}` : ''}`);
  }

  return sections.join('');
}

function buildSuggestedExecutionFollowups(
  prompt: string,
  routingContext: Record<string, unknown>,
): SessionSuggestedFollowup[] | undefined {
  if (!shouldOfferExecutionChoices(prompt, routingContext)) {
    return undefined;
  }

  return [
    {
      label: 'Fix This',
      prompt: 'Fix this issue in the workspace. Make the smallest defensible change, verify it, and summarize what changed.',
    },
    {
      label: 'Explain Only',
      prompt: 'Explain the root cause and the best next step only. Do not make code changes.',
    },
    {
      label: 'Fix Autonomously',
      prompt: 'Fix this issue in the workspace autonomously. Continue through implementation and verification without waiting for another prompt unless you hit a real blocker.',
    },
  ];
}

function shouldOfferExecutionChoices(
  prompt: string,
  routingContext: Record<string, unknown>,
): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return false;
  }

  if (resolveAtlasChatIntent(trimmed, [])) {
    return false;
  }

  if (EXPLICIT_FIX_PROMPT_PATTERN.test(trimmed) || EXPLICIT_NO_FIX_PATTERN.test(trimmed)) {
    return false;
  }

  if (!CONCRETE_ISSUE_PROMPT_PATTERN.test(trimmed)) {
    return false;
  }

  return shouldBiasTowardWorkspaceInvestigation(trimmed, routingContext);
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

function buildThoughtSummaryTddCue(
  status: 'verified' | 'blocked' | 'missing' | 'not-applicable' | undefined,
  _summary: string | undefined,
): { status: 'verified' | 'blocked' | 'missing' | 'not-applicable'; statusLabel: string } | undefined {
  switch (status) {
    case 'verified':
      return { status: 'verified', statusLabel: '[Red->Green observed]' };
    case 'blocked':
      return { status: 'blocked', statusLabel: '[Red signal required before writes]' };
    case 'missing':
      return { status: 'missing', statusLabel: '[Red->Green missing]' };
    case 'not-applicable':
      return { status: 'not-applicable', statusLabel: '[TDD not applicable]' };
    default:
      return undefined;
  }
}

function toPlatformLabel(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'win32':
      return 'Windows';
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    default:
      return platform;
  }
}

function getConfiguredTerminalProfile(platform: NodeJS.Platform): string | undefined {
  const suffix = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'osx' : 'linux';
  const configured = vscode.workspace.getConfiguration('terminal.integrated').get<string>(`defaultProfile.${suffix}`)?.trim();
  if (configured) {
    return configured;
  }

  if (platform === 'win32') {
    return 'PowerShell';
  }

  return undefined;
}

function truncateForSummary(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(1, maxChars - 1))}…`;
}

async function handleMemoryCommand(
  prompt: string,
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const query = prompt.trim();
  if (query.length === 0) {
    stream.markdown('Usage: `/memory <search terms>`');
    return;
  }

  const results = await atlas.memoryManager.queryRelevant(query);
  if (results.length === 0) {
    stream.markdown('No matching memory entries found.');
    return;
  }

  const rows = results.map(
    entry => `- **${entry.title}** (${entry.path})\n  ${entry.snippet.slice(0, 180).replace(/\n/g, ' ')}`,
  );
  stream.markdown(`### Memory Results\n\n${rows.join('\n')}`);
}

export function isRoadmapStatusPrompt(prompt: string): boolean {
  return ROADMAP_STATUS_PROMPT_PATTERN.test(prompt) && ROADMAP_STATUS_DETAIL_PATTERN.test(prompt);
}

export function summarizeRoadmapStatus(files: Array<{ path: string; content: string }>): RoadmapStatusSnapshot {
  const items = files.flatMap(file => extractRoadmapChecklistItems(file.path, file.content));
  return {
    completed: items.filter(item => item.completed).length,
    total: items.length,
    outstanding: items.filter(item => !item.completed),
  };
}

export async function buildRoadmapStatusMarkdown(prompt: string): Promise<string | undefined> {
  if (!isRoadmapStatusPrompt(prompt)) {
    return undefined;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return '### Roadmap Status\n\nOpen a workspace to inspect the live roadmap files.';
  }

  const ssotPath = normalizeSsotPathForLookup(
    vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', DEFAULT_SSOT_PATH),
  );
  const roadmapRoot = path.join(workspaceRoot, ssotPath, 'roadmap');
  const files = await readRoadmapMarkdownFiles(roadmapRoot, workspaceRoot);
  const snapshot = summarizeRoadmapStatus(files);

  if (snapshot.total === 0) {
    return `### Roadmap Status\n\nNo tracked roadmap checklist items were found in \`${ssotPath}/roadmap/\`.`;
  }

  const lines = [
    '### Roadmap Status',
    '',
    `- Dashboard-aligned progress: **${snapshot.completed}/${snapshot.total}** roadmap item(s) marked complete.`,
    `- Outstanding roadmap items: **${snapshot.outstanding.length}**.`,
  ];

  if (snapshot.outstanding.length === 0) {
    lines.push('', 'All tracked roadmap items are currently marked complete.');
    return lines.join('\n');
  }

  lines.push('', '#### Outstanding Items', '');
  for (const item of snapshot.outstanding.slice(0, 25)) {
    lines.push(`- [ ] \`${item.path}\` — ${item.text}`);
  }
  if (snapshot.outstanding.length > 25) {
    lines.push(`- ...and **${snapshot.outstanding.length - 25}** more outstanding roadmap item(s).`);
  }

  return lines.join('\n');
}

function normalizeSsotPathForLookup(value: string | undefined): string {
  const raw = (value ?? DEFAULT_SSOT_PATH).trim();
  if (!raw) {
    return DEFAULT_SSOT_PATH;
  }
  return raw.replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '') || DEFAULT_SSOT_PATH;
}

async function readRoadmapMarkdownFiles(roadmapRoot: string, workspaceRoot: string): Promise<Array<{ path: string; content: string }>> {
  try {
    const entries = await fs.readdir(roadmapRoot, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map(async entry => {
        const absolutePath = path.join(roadmapRoot, entry.name);
        const content = await fs.readFile(absolutePath, 'utf-8');
        const relativePath = path.relative(workspaceRoot, absolutePath).split(path.sep).join('/');
        return { path: relativePath, content };
      }));
    return files.sort((left, right) => left.path.localeCompare(right.path));
  } catch {
    return [];
  }
}

function extractRoadmapChecklistItems(filePath: string, content: string): RoadmapChecklistItem[] {
  return [...content.matchAll(/^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/gm)]
    .map(match => match[1]?.trim() ?? '')
    .filter(Boolean)
    .map(text => ({
      path: filePath,
      text,
      completed: /^(?:✅|\[x\])/i.test(text),
    }));
}

// -- Follow-up suggestions -------------------------------------------------

export function buildFollowups(
  command: string | undefined,
  outcome?: ProjectRunOutcome,
  suggestedFollowups?: SessionSuggestedFollowup[],
): vscode.ChatFollowup[] {
  if (suggestedFollowups && suggestedFollowups.length > 0) {
    return suggestedFollowups.map(item => ({ prompt: item.prompt, label: item.label }));
  }

  switch (command) {
    case 'bootstrap':
      return [
        { prompt: '/agents', label: 'View registered agents' },
        { prompt: '/skills', label: 'View registered skills' },
        { prompt: '/memory project soul', label: 'Query project memory' },
        { prompt: '/project scaffold the first feature', label: 'Start building with /project' },
      ];

    case 'import':
      return [
        { prompt: '/memory project overview', label: 'View imported overview' },
        { prompt: '/memory dependencies', label: 'View imported dependencies' },
        { prompt: '/agents', label: 'View registered agents' },
        { prompt: '/project', label: 'Start a project task' },
      ];

    case 'agents':
      return [
        { prompt: '/skills', label: 'View registered skills' },
        { prompt: '/project', label: 'Run a project with these agents' },
        { prompt: 'How do I add a custom agent?', label: 'How to add an agent' },
      ];

    case 'skills':
      return [
        { prompt: '/agents', label: 'View registered agents' },
        { prompt: 'How do I add a custom skill?', label: 'How to add a skill' },
        { prompt: '/project', label: 'Run a project using these skills' },
      ];

    case 'memory':
      return [
        { prompt: '/memory architecture', label: 'Search architecture notes' },
        { prompt: '/memory decisions', label: 'Search decisions log' },
        { prompt: '/project based on the current memory context', label: 'Start a project from memory' },
      ];

    case 'cost':
      return [
        { prompt: '/agents', label: 'See which agents ran' },
        { prompt: 'How can I reduce costs?', label: 'Tips to reduce cost' },
      ];

    case 'project': {
      // Outcome-driven chips: surface the most relevant next action first.
      if (outcome?.hasFailures) {
        return [
          { prompt: '/cost', label: 'Review session cost' },
          { prompt: '/project', label: 'Retry the project' },
          { prompt: 'What went wrong with the failed subtasks?', label: 'Diagnose failures' },
        ];
      }
      if (outcome?.hasChangedFiles) {
        return [
          { prompt: '/cost', label: 'Review session cost' },
          { prompt: '/memory save the project plan', label: 'Save plan to memory' },
          { prompt: 'Write tests for the files that were changed', label: 'Add tests' },
        ];
      }
      return [
        { prompt: '/cost', label: 'Review session cost' },
        { prompt: '/memory save the project plan', label: 'Save plan to memory' },
        { prompt: '/project', label: 'Run another project' },
      ];
    }

    case 'runs':
      return [
        { prompt: '/project', label: 'Run a new project' },
        { prompt: '/cost', label: 'Review session cost' },
        { prompt: '/memory operations', label: 'Search operations memory' },
      ];

    case 'voice':
      return [
        { prompt: '/agents', label: 'View agents' },
        { prompt: '/skills', label: 'View skills' },
        { prompt: 'How do I use voice input?', label: 'Voice input help' },
      ];

    default: // freeform
      return [
        { prompt: '/project', label: 'Turn this into a full project' },
        { prompt: '/memory', label: 'Search project memory' },
        { prompt: '/cost', label: 'Check session cost' },
        { prompt: '/vision', label: 'Ask with images' },
        { prompt: '/voice', label: 'Open voice panel' },
      ];
  }
}

export function isAutonomousContinuationPrompt(prompt: string): boolean {
  return AUTONOMOUS_CONTINUATION_PATTERN.test(prompt.trim());
}

export function resolveProjectExecutionGoal(
  prompt: string,
  transcript: SessionTranscriptEntry[],
): string | undefined {
  const trimmed = prompt.trim();
  if (trimmed.startsWith('/project')) {
    const goal = trimmed.slice('/project'.length).replace(PROJECT_APPROVAL_TOKEN, '').trim();
    return goal.length > 0 ? goal : undefined;
  }

  return resolveAutonomousContinuationGoal(prompt, transcript);
}

export function resolveNaturalLanguageProjectGoal(
  prompt: string,
  transcript: SessionTranscriptEntry[],
): string | undefined {
  const explicitGoal = resolveProjectExecutionGoal(prompt, transcript);
  if (explicitGoal) {
    return explicitGoal;
  }

  const match = PROJECT_RUN_REQUEST_PATTERN.exec(prompt.trim());
  if (!match) {
    return undefined;
  }

  const requestedGoal = match[1]?.trim().replace(/^[\s:.-]+/, '') ?? '';
  if (requestedGoal.length > 0) {
    return requestedGoal;
  }

  return undefined;
}

export function resolveAtlasChatIntent(
  prompt: string,
  transcript: SessionTranscriptEntry[],
): AtlasChatIntent | undefined {
  const projectGoal = resolveNaturalLanguageProjectGoal(prompt, transcript);
  if (projectGoal) {
    return { kind: 'project', goal: projectGoal };
  }

  for (const intent of NATURAL_LANGUAGE_COMMAND_INTENTS) {
    if (intent.pattern.test(prompt.trim())) {
      return {
        kind: 'command',
        commandId: intent.commandId,
        ...(intent.args ? { args: intent.args } : {}),
        summary: intent.summary,
      };
    }
  }

  return undefined;
}

export function resolveAutonomousContinuationGoal(
  prompt: string,
  transcript: SessionTranscriptEntry[],
): string | undefined {
  const match = AUTONOMOUS_CONTINUATION_PATTERN.exec(prompt.trim());
  if (!match) {
    return undefined;
  }

  const followupDetail = match[1]?.trim();
  const priorPrompt = [...transcript]
    .reverse()
    .filter(entry => entry.role === 'user')
    .map(entry => normalizeAutonomousSourcePrompt(entry.content))
    .find(candidate => candidate.length > 0);

  if (!priorPrompt) {
    return followupDetail && followupDetail.length > 0 ? followupDetail : undefined;
  }

  if (!followupDetail) {
    return priorPrompt;
  }

  return `${priorPrompt}\n\nAdditional execution instruction: ${followupDetail}`;
}

function normalizeAutonomousSourcePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed || isAutonomousContinuationPrompt(trimmed)) {
    return '';
  }

  if (trimmed.startsWith('/project')) {
    return trimmed.slice('/project'.length).replace(PROJECT_APPROVAL_TOKEN, '').trim();
  }

  if (trimmed.startsWith('/')) {
    return '';
  }

  return trimmed.replace(PROJECT_APPROVAL_TOKEN, '').trim();
}

export function toApprovedProjectPrompt(goal: string): string {
  const normalized = goal.replace(PROJECT_APPROVAL_TOKEN, '').trim();
  return normalized.length > 0 ? `${normalized} ${PROJECT_APPROVAL_TOKEN}` : PROJECT_APPROVAL_TOKEN;
}

export function getProjectUiConfig(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>,
): ProjectUiConfig {
  return {
    approvalFileThreshold: getPositiveIntegerSetting(
      configuration,
      'projectApprovalFileThreshold',
      DEFAULT_PROJECT_APPROVAL_FILE_THRESHOLD,
    ),
    estimatedFilesPerSubtask: getPositiveIntegerSetting(
      configuration,
      'projectEstimatedFilesPerSubtask',
      DEFAULT_ESTIMATED_FILES_PER_SUBTASK,
    ),
    changedFileReferenceLimit: getPositiveIntegerSetting(
      configuration,
      'projectChangedFileReferenceLimit',
      DEFAULT_CHANGED_FILE_REFERENCE_LIMIT,
    ),
    runReportFolder: getStringSetting(
      configuration,
      'projectRunReportFolder',
      DEFAULT_PROJECT_RUN_REPORT_FOLDER,
    ),
  };
}

export function estimateTouchedFiles(subTaskCount: number, estimatedFilesPerSubtask: number): number {
  return Math.max(1, subTaskCount * Math.max(1, estimatedFilesPerSubtask));
}

export async function createWorkspaceSnapshot(): Promise<Map<string, WorkspaceSnapshotEntry>> {
  const uris = await vscode.workspace.findFiles('**/*', WORKSPACE_SNAPSHOT_EXCLUDE);
  const snapshot = new Map<string, WorkspaceSnapshotEntry>();

  await Promise.all(uris.map(async (uri) => {
    const stat = await vscode.workspace.fs.stat(uri);
    const key = toSnapshotKey(uri);
    snapshot.set(key, {
      signature: `${stat.mtime}:${stat.size}`,
      relativePath: vscode.workspace.asRelativePath(uri, false),
      uri,
      textContent: await readSnapshotTextContent(uri, stat.size),
    });
  }));

  return snapshot;
}

export async function collectWorkspaceChangesSince(
  baseline: Map<string, WorkspaceSnapshotEntry>,
): Promise<{ snapshot: Map<string, WorkspaceSnapshotEntry>; changedFiles: ChangedWorkspaceFile[] }> {
  const current = await createWorkspaceSnapshot();
  return {
    snapshot: current,
    changedFiles: diffWorkspaceSnapshots(baseline, current),
  };
}

export function diffWorkspaceSnapshots(
  baseline: Map<string, WorkspaceSnapshotEntry>,
  current: Map<string, WorkspaceSnapshotEntry>,
): ChangedWorkspaceFile[] {
  const changed: ChangedWorkspaceFile[] = [];
  const keys = new Set<string>([...baseline.keys(), ...current.keys()]);

  for (const key of keys) {
    const before = baseline.get(key);
    const after = current.get(key);

    if (!before && after) {
      changed.push({ relativePath: after.relativePath, status: 'created', uri: after.uri });
      continue;
    }

    if (before && !after) {
      changed.push({ relativePath: before.relativePath, status: 'deleted' });
      continue;
    }

    if (before && after && before.signature !== after.signature) {
      changed.push({ relativePath: after.relativePath, status: 'modified', uri: after.uri });
    }
  }

  return changed.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function summarizeChangedFiles(changedFiles: ChangedWorkspaceFile[]): string {
  const created = changedFiles.filter(file => file.status === 'created').length;
  const modified = changedFiles.filter(file => file.status === 'modified').length;
  const deleted = changedFiles.filter(file => file.status === 'deleted').length;
  return `created ${created}, modified ${modified}, deleted ${deleted}`;
}

export function buildChangedFilesDiffPreview(
  baseline: Map<string, WorkspaceSnapshotEntry>,
  current: Map<string, WorkspaceSnapshotEntry>,
  changedFiles: ChangedWorkspaceFile[],
): string | undefined {
  const previews = changedFiles
    .slice(0, 3)
    .map(file => buildSingleFileDiffPreview(file, baseline, current))
    .filter((value): value is string => Boolean(value));

  if (previews.length === 0) {
    return undefined;
  }

  return previews.join('\n\n');
}

export function addFileAttribution(
  attributionMap: Map<string, Set<string>>,
  subTaskTitle: string,
  changedFiles: ChangedWorkspaceFile[],
): void {
  for (const file of changedFiles) {
    const existing = attributionMap.get(file.relativePath) ?? new Set<string>();
    existing.add(subTaskTitle);
    attributionMap.set(file.relativePath, existing);
  }
}

export function toSerializableAttribution(
  attributionMap: Map<string, Set<string>>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [filePath, subTaskTitles] of attributionMap) {
    result[filePath] = [...subTaskTitles].sort((a, b) => a.localeCompare(b));
  }
  return result;
}

export function buildProjectRunSummary(
  result: ProjectResult,
  changedFiles: ChangedWorkspaceFile[],
  fileAttribution: Map<string, Set<string>>,
  runStartedAt: string,
  subTaskArtifacts?: ProjectRunSubTaskArtifact[],
): ProjectRunSummary {
  return {
    id: result.id,
    goal: result.goal,
    startedAt: runStartedAt,
    generatedAt: new Date().toISOString(),
    totalCostUsd: result.totalCostUsd,
    totalDurationMs: result.totalDurationMs,
    subTaskResults: result.subTaskResults.map(item => ({
      subTaskId: item.subTaskId,
      title: item.title,
      status: item.status,
      costUsd: item.costUsd,
      durationMs: item.durationMs,
      error: item.error,
    })),
    changedFiles,
    fileAttribution: toSerializableAttribution(fileAttribution),
    subTaskArtifacts: subTaskArtifacts ?? buildProjectRunSubTaskArtifacts(result.subTaskResults),
  };
}

export function buildProjectRunSubTaskArtifacts(results: SubTaskResult[]): ProjectRunSubTaskArtifact[] {
  return results.map(result => ({
    subTaskId: result.subTaskId,
    title: result.title,
    role: result.role ?? 'general-assistant',
    dependsOn: [...(result.dependsOn ?? [])],
    status: result.status,
    output: result.output,
    outputPreview: result.artifacts?.outputPreview ?? truncatePreview(result.output),
    costUsd: result.costUsd,
    durationMs: result.durationMs,
    error: result.error,
    toolCallCount: result.artifacts?.toolCallCount ?? 0,
    toolCalls: result.artifacts?.toolCalls.map(tool => ({ ...tool })) ?? [],
    verificationSummary: result.artifacts?.verificationSummary,
    tddStatus: result.artifacts?.tddStatus,
    tddSummary: result.artifacts?.tddSummary,
    checkpointedTools: [...(result.artifacts?.checkpointedTools ?? [])],
    changedFiles: result.artifacts?.changedFiles.map(file => ({ ...file })) ?? [],
    diffPreview: result.artifacts?.diffPreview,
  }));
}

export async function writeProjectRunSummaryReport(
  report: ProjectRunSummary,
  reportFolder: string,
): Promise<vscode.Uri | undefined> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return undefined;
  }

  const safeFolder = reportFolder.replace(/\\/g, '/').replace(/^\/+/, '').trim() || DEFAULT_PROJECT_RUN_REPORT_FOLDER;
  const folderUri = vscode.Uri.joinPath(workspaceFolder.uri, ...safeFolder.split('/').filter(Boolean));
  await vscode.workspace.fs.createDirectory(folderUri);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileUri = vscode.Uri.joinPath(folderUri, `project-run-${timestamp}.json`);
  const payload = JSON.stringify(report, null, 2);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(payload, 'utf-8'));
  return fileUri;
}

function toSnapshotKey(uri: vscode.Uri): string {
  return uri.fsPath.toLowerCase();
}

async function readSnapshotTextContent(uri: vscode.Uri, size: number): Promise<string | undefined> {
  if (size > 200_000) {
    return undefined;
  }

  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.includes(0)) {
      return undefined;
    }
    return Buffer.from(bytes).toString('utf-8');
  } catch {
    return undefined;
  }
}

function buildSingleFileDiffPreview(
  changedFile: ChangedWorkspaceFile,
  baseline: Map<string, WorkspaceSnapshotEntry>,
  current: Map<string, WorkspaceSnapshotEntry>,
): string | undefined {
  const entry = current.get(toSnapshotLookupKey(changedFile.relativePath)) ?? baseline.get(toSnapshotLookupKey(changedFile.relativePath));
  const relativePath = entry?.relativePath ?? changedFile.relativePath;
  const before = baseline.get(toSnapshotLookupKey(relativePath))?.textContent;
  const after = current.get(toSnapshotLookupKey(relativePath))?.textContent;

  if (changedFile.status === 'created' && after) {
    return `+++ ${relativePath}\n${takeFirstLines(after).map(line => `+ ${line}`).join('\n')}`;
  }
  if (changedFile.status === 'deleted' && before) {
    return `--- ${relativePath}\n${takeFirstLines(before).map(line => `- ${line}`).join('\n')}`;
  }
  if (changedFile.status === 'modified' && before !== undefined && after !== undefined) {
    const beforeLines = before.split(/\r?\n/);
    const afterLines = after.split(/\r?\n/);
    const previewLines: string[] = [`*** ${relativePath}`];
    const maxLines = Math.max(beforeLines.length, afterLines.length);
    for (let index = 0; index < maxLines && previewLines.length < 25; index += 1) {
      if (beforeLines[index] === afterLines[index]) {
        continue;
      }
      if (beforeLines[index] !== undefined) {
        previewLines.push(`- ${beforeLines[index]}`);
      }
      if (afterLines[index] !== undefined) {
        previewLines.push(`+ ${afterLines[index]}`);
      }
    }
    return previewLines.join('\n');
  }

  return undefined;
}

function takeFirstLines(text: string, maxLines = 12): string[] {
  return text.split(/\r?\n/).slice(0, maxLines);
}

function truncatePreview(value: string, maxLength = 600): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

function toSnapshotLookupKey(relativePath: string): string {
  return relativePath.toLowerCase();
}

function getPositiveIntegerSetting(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>,
  key: string,
  fallback: number,
): number {
  const value = configuration.get<number>(key);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}

function getStringSetting(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>,
  key: string,
  fallback: string,
): string {
  const value = configuration.get<string>(key);
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }

  return value.trim();
}

function toBudgetMode(value: string | undefined): 'cheap' | 'balanced' | 'expensive' | 'auto' {
  if (value === 'cheap' || value === 'balanced' || value === 'expensive' || value === 'auto') {
    return value;
  }
  return 'balanced';
}

function toSpeedMode(value: string | undefined): 'fast' | 'balanced' | 'considered' | 'auto' {
  if (value === 'fast' || value === 'balanced' || value === 'considered' || value === 'auto') {
    return value;
  }
  return 'balanced';
}

async function pickImageAttachments(): Promise<TaskImageAttachment[]> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return [];
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFiles: true,
    canSelectFolders: false,
    defaultUri: workspaceFolder.uri,
    openLabel: 'Attach images to AtlasMind chat',
    filters: {
      Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
    },
  });

  if (!selected || selected.length === 0) {
    return [];
  }

  return resolvePickedImageAttachments(selected);
}
