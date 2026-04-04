import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type {
  ChangedWorkspaceFile,
  ProjectProgressUpdate,
  ProjectResult,
  ProjectRunSubTaskArtifact,
  ProjectRunSummary,
  SubTaskResult,
  TaskImageAttachment,
} from '../types.js';
import { Planner } from '../core/planner.js';
import { TaskProfiler } from '../core/taskProfiler.js';
import { mergeImageAttachments, resolveInlineImageAttachments, resolvePickedImageAttachments } from './imageAttachments.js';

export { extractImagePathCandidates, mergeImageAttachments, resolveInlineImageAttachments } from './imageAttachments.js';

const PROJECT_APPROVAL_TOKEN = '--approve';
const DEFAULT_PROJECT_APPROVAL_FILE_THRESHOLD = 12;
const DEFAULT_ESTIMATED_FILES_PER_SUBTASK = 2;
const DEFAULT_CHANGED_FILE_REFERENCE_LIMIT = 5;
const DEFAULT_PROJECT_RUN_REPORT_FOLDER = 'project_memory/operations';
const WORKSPACE_SNAPSHOT_EXCLUDE = '**/{.git,node_modules,out,dist,coverage}/**';

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

/**
 * Registers the @atlas chat participant with VS Code's Chat API.
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): void {
  const participant = vscode.chat.createChatParticipant(
    'atlasmind.orchestrator',
    (request, chatContext, stream, token) =>
      handleChatRequest(request, chatContext, stream, token, atlas),
  );

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');

  participant.followupProvider = {
    provideFollowups(
      result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken,
    ): vscode.ChatFollowup[] {
      return buildFollowups(
        result.metadata?.['command'] as string | undefined,
        result.metadata?.['outcome'] as ProjectRunOutcome | undefined,
      );
    },
  };

  context.subscriptions.push(participant);
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
      projectOutcome = await handleProjectCommand(request.prompt, stream, token, atlas);
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

    default:
      await handleFreeformMessage(request, stream, atlas);
      break;
  }

  return { metadata: { command: command ?? 'freeform', outcome: projectOutcome } };
}

async function handleProjectCommand(
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
    `Estimated files to touch: **~${estimatedFiles}**\n\n`,
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
  const inlineAttachments = explicitAttachments.length > 0 ? [] : await resolveInlineImageAttachments(prompt);
  const imageAttachments = mergeImageAttachments(explicitAttachments, inlineAttachments);
  let streamed = false;
  const result = await atlas.orchestrator.processTask({
    id: `task-${Date.now()}`,
    userMessage: prompt,
    context: {
      ...(sessionContext ? { sessionContext } : {}),
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
    streamed = true;
    stream.markdown(chunk);
  });

  if (!streamed) {
    stream.markdown(result.response);
  }
  atlas.sessionConversation.recordTurn(prompt, result.response);

  // If TTS auto-speak is enabled, forward the response to the voice manager.
  if (configuration.get<boolean>('voice.ttsEnabled', false)) {
    atlas.voiceManager.speak(result.response);
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

// -- Follow-up suggestions -------------------------------------------------

export function buildFollowups(
  command: string | undefined,
  outcome?: ProjectRunOutcome,
): vscode.ChatFollowup[] {
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
