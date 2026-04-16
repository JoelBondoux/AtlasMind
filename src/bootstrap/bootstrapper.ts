import * as vscode from 'vscode';
import { SSOT_FOLDERS } from '../types.js';
import type { AtlasMindContext } from '../extension.js';
import type { BudgetMode, MemoryDocumentClass, MemoryEntry, MemoryEvidenceType, SpeedMode } from '../types.js';

type DependencyMonitoringProvider = 'dependabot' | 'renovate' | 'snyk' | 'azure-devops';
type DependencyMonitoringSchedule = 'daily' | 'weekly' | 'monthly';
type BootstrapOnlineRepoState = 'existing' | 'planned' | 'none';
type BootstrapPromptReporter = Pick<vscode.ChatResponseStream, 'markdown'> | undefined;
type BootstrapInferredField =
  | 'projectName'
  | 'projectType'
  | 'productSummary'
  | 'productOutcome'
  | 'builderProfile'
  | 'targetAudience'
  | 'timeline'
  | 'projectBudget'
  | 'atlasBudgetMode'
  | 'atlasSpeedMode'
  | 'techStack'
  | 'thirdPartyTools'
  | 'onlineRepoState'
  | 'successMetrics'
  | 'repoLocation'
  | 'repoHost';

const PROJECT_PERSONALITY_PROFILE_STORAGE_KEY = 'atlasmind.personalityProfile';

const KNOWN_TECH_TERMS = [
  'TypeScript',
  'JavaScript',
  'React',
  'Next.js',
  'Node.js',
  'Node',
  'Express',
  'NestJS',
  'PostgreSQL',
  'Postgres',
  'MySQL',
  'MongoDB',
  'Redis',
  'Python',
  'FastAPI',
  'Django',
  'Flask',
  'Go',
  'Rust',
  'Java',
  'Spring',
  'C#',
  '.NET',
  'Azure OpenAI',
  'Azure',
  'AWS',
  'GCP',
  'Docker',
  'Kubernetes',
];

const KNOWN_TOOL_TERMS = [
  'GitHub Actions',
  'Azure DevOps',
  'Stripe',
  'Sentry',
  'Clerk',
  'Auth0',
  'Supabase',
  'Firebase',
  'Linear',
  'Jira',
  'Slack',
  'Notion',
  'PostHog',
  'Datadog',
  'LaunchDarkly',
  'Vercel',
  'Netlify',
];

interface BootstrapProjectIntake {
  mode: 'guided' | 'minimal';
  captureNotes: string[];
  projectType?: string;
  projectName?: string;
  productSummary?: string;
  productOutcome?: string;
  builderProfile?: string;
  targetAudience?: string;
  timeline?: string;
  projectBudget?: string;
  atlasBudgetMode?: BudgetMode;
  atlasSpeedMode?: SpeedMode;
  techStack?: string;
  thirdPartyTools?: string;
  onlineRepoState?: BootstrapOnlineRepoState;
  successMetrics?: string;
  repoLocation?: string;
  repoHost?: 'github' | 'azure-devops' | 'gitlab' | 'other';
  initGit?: boolean;
  scaffoldGovernance?: boolean;
  dependencyMonitoringProviders?: DependencyMonitoringProvider[];
  dependencyMonitoringSchedule?: DependencyMonitoringSchedule;
}

interface BootstrapArtifacts {
  questionCount: number;
  answeredCount: number;
  projectSoulUpdated: boolean;
  ideationSeeded: boolean;
  githubArtifactsUpdated: boolean;
  personalitySeeded: boolean;
  settingsUpdated: string[];
}

interface BootstrapIdeationBoardRecord {
  version: 1;
  updatedAt: string;
  cards: BootstrapIdeationCardRecord[];
  connections: BootstrapIdeationConnectionRecord[];
  constraints: {
    budget: string;
    timeline: string;
    teamSize: string;
    riskTolerance: string;
    technicalStack: string;
  };
  focusCardId?: string;
  lastAtlasResponse: string;
  nextPrompts: string[];
  history: Array<{ role: 'user' | 'atlas'; content: string; timestamp: string }>;
  projectMetadataSummary: string;
  contextPackets: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
}

interface BootstrapIdeationCardRecord {
  id: string;
  title: string;
  body: string;
  kind: 'idea' | 'problem' | 'experiment' | 'user-insight' | 'risk' | 'requirement' | 'evidence' | 'atlas-response' | 'attachment';
  author: 'user' | 'atlas';
  x: number;
  y: number;
  color: string;
  imageSources: string[];
  media: Array<Record<string, unknown>>;
  tags: string[];
  confidence: number;
  evidenceStrength: number;
  riskScore: number;
  costToValidate: number;
  syncTargets: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

interface BootstrapIdeationConnectionRecord {
  id: string;
  fromCardId: string;
  toCardId: string;
  label: string;
  style: 'dotted' | 'solid';
  direction: 'none' | 'forward' | 'reverse' | 'both';
  relation: 'supports' | 'causal' | 'dependency' | 'contradiction' | 'opportunity';
}

/**
 * Bootstrap a new project: create SSOT folders, optionally init Git,
 * and prompt for project type.
 */
export async function bootstrapProject(
  workspaceRoot: vscode.Uri,
  atlas: AtlasMindContext,
  reporter?: BootstrapPromptReporter,
): Promise<void> {
  const config = vscode.workspace.getConfiguration('atlasmind');
  const ssotRelPath = getValidatedSsotPath(config.get<string>('ssotPath', 'project_memory'));
  if (!ssotRelPath) {
    vscode.window.showErrorMessage('AtlasMind SSOT path must be a safe relative path inside the workspace.');
    return;
  }

  const ssotRoot = vscode.Uri.joinPath(workspaceRoot, ssotRelPath);

  reportBootstrapProgress(reporter, '### Atlas Bootstrap Intake\n\nAtlas is collecting a skippable project brief to seed memory, ideation, settings, and governance scaffolding.');

  if (await hasExistingContent(ssotRoot)) {
    const choice = await vscode.window.showWarningMessage(
      `The SSOT path "${ssotRelPath}" already exists. AtlasMind will only add missing files and folders.`,
      'Continue',
      'Cancel',
    );

    if (choice !== 'Continue') {
      return;
    }
  }

  const intake = await collectBootstrapIntake(reporter);

  await ensureSsotStructure(ssotRoot);

  reportBootstrapProgress(reporter, '- SSOT scaffold ready. Writing the intake into project memory and ideation defaults.');
  const artifacts = await applyBootstrapIntake(workspaceRoot, ssotRoot, intake, config, atlas);

  if (intake.initGit) {
    try {
      await vscode.commands.executeCommand('git.init');
    } catch {
      vscode.window.showWarningMessage('Git init failed – you may need to do it manually.');
    }
  }

  if (intake.scaffoldGovernance) {
    await scaffoldGovernanceBaseline(workspaceRoot, ssotRoot, config, intake);
    vscode.window.showInformationMessage('AtlasMind governance baseline scaffolded (.github + .vscode recommendations).');
  }

  await atlas.memoryManager.loadFromDisk(ssotRoot);
  atlas.memoryRefresh.fire();

  const summary = buildBootstrapCompletionSummary(ssotRelPath, intake, artifacts);
  reportBootstrapProgress(reporter, summary);
  vscode.window.showInformationMessage(`AtlasMind bootstrap completed at ${ssotRelPath}/ with ${artifacts.answeredCount} captured signal${artifacts.answeredCount === 1 ? '' : 's'}.`);
}

async function collectBootstrapIntake(reporter?: BootstrapPromptReporter): Promise<BootstrapProjectIntake> {
  const modePick = await vscode.window.showQuickPick(
    [
      {
        label: '$(comment-discussion) Guided Atlas intake',
        description: 'Recommended. Ask skippable product, team, delivery, and stack questions.',
        intakeMode: 'guided' as const,
      },
      {
        label: '$(zap) Minimal bootstrap',
        description: 'Create the SSOT scaffold with only Git and governance prompts.',
        intakeMode: 'minimal' as const,
      },
    ],
    { placeHolder: 'How should Atlas bootstrap this workspace?' },
  );

  const intake: BootstrapProjectIntake = { mode: modePick?.intakeMode ?? 'guided', captureNotes: [] };

  if (intake.mode === 'guided') {
    reportBootstrapProgress(reporter, '#### Product Brief\n\nAtlas is asking the core product questions first. Every answer is optional; cancel or leave blank to skip.');
    await askBootstrapTextField(intake, 'projectName', 'Project name', 'What should Atlas call this project?', 'Leave blank to infer it from the workspace folder.', reporter);
    await askBootstrapQuickPickField(
      intake,
      'projectType',
      ['Web App', 'API Server', 'CLI Tool', 'Library', 'VS Code Extension', 'Desktop App', 'Mobile App', 'Other'],
      'What type of project is this?',
      value => value,
      reporter,
    );
    await askBootstrapTextField(
      intake,
      'productSummary',
      'What are you building?',
      'Describe the product, initiative, or system in one or two sentences.',
      'Example: An internal AI-assisted support console for customer success.',
      reporter,
    );
    await askBootstrapTextField(
      intake,
      'productOutcome',
      'Primary outcome',
      'What problem, opportunity, or result matters most?',
      'Example: Reduce triage time from hours to minutes for support engineers.',
      reporter,
    );
    await askBootstrapTextField(
      intake,
      'targetAudience',
      'Target audience',
      'Who is this for?',
      'Example: Internal analysts, startup founders, enterprise admins, field technicians.',
      reporter,
    );

    reportBootstrapProgress(reporter, '#### Delivery Constraints\n\nAtlas is collecting team, timing, and budget constraints so routing, roadmaps, and planning defaults start in the right place.');
    await askBootstrapTextField(
      intake,
      'builderProfile',
      'Who is building it?',
      'Who is building this and what is the delivery context?',
      'Example: Solo founder, 4-person product team, client services team, platform group.',
      reporter,
    );
    await askBootstrapTextField(intake, 'timeline', 'Timeline', 'What timeframe matters for delivery?', 'Example: prototype this week, beta in 6 weeks, GA this quarter.', reporter);
    await askBootstrapTextField(intake, 'projectBudget', 'Project budget', 'What budget or cost posture matters?', 'Example: bootstrapped MVP, fixed client budget, enterprise-funded initiative.', reporter);
    await askBootstrapTextField(intake, 'successMetrics', 'Success metrics', 'How will you know this is working?', 'Example: activation rate, retained users, cost savings, deployment frequency.', reporter);
    await askBootstrapQuickPickField(
      intake,
      'atlasBudgetMode',
      ['Lean / keep Atlas costs low', 'Balanced', 'Premium / depth first', 'Auto'],
      'How cost-sensitive should Atlas be while helping on this project?',
      mapAtlasBudgetMode,
      reporter,
    );
    await askBootstrapQuickPickField(
      intake,
      'atlasSpeedMode',
      ['Fast feedback', 'Balanced', 'Considered / deeper reasoning', 'Auto'],
      'How should Atlas trade off speed vs depth for this project?',
      mapAtlasSpeedMode,
      reporter,
    );

    reportBootstrapProgress(reporter, '#### Technical Shape\n\nAtlas is capturing the stack and surrounding tooling so ideation, governance, and planning artifacts start with the real technical surface.');
    await askBootstrapTextField(
      intake,
      'techStack',
      'Tech stack',
      'What stack do you expect to use?',
      'Example: TypeScript, React, Node, PostgreSQL, Azure OpenAI.',
      reporter,
    );
    await askBootstrapTextField(
      intake,
      'thirdPartyTools',
      '3rd-party tools',
      'What integrations, platforms, or third-party tools matter?',
      'Example: Stripe, Clerk, GitHub Actions, Sentry, Supabase, Azure, Linear.',
      reporter,
    );
    await askBootstrapQuickPickField(
      intake,
      'onlineRepoState',
      ['Already has an online repo', 'Needs a new online repo', 'Keep it local only for now', 'Not sure / skip'],
      'Does this project already have an online repository?',
      mapOnlineRepoState,
      reporter,
    );

    if (intake.onlineRepoState !== 'none') {
      await askBootstrapQuickPickField(
        intake,
        'repoHost',
        ['GitHub', 'Azure DevOps', 'GitLab', 'Other / unknown'],
        intake.onlineRepoState === 'planned'
          ? 'If Atlas should help create the first remote later, where should it live?'
          : 'Which delivery platform should Atlas assume for the existing online repo?',
        mapRepoHost,
        reporter,
      );
    }

    if (intake.onlineRepoState === 'planned') {
      await askBootstrapTextField(
        intake,
        'repoLocation',
        'Planned repo location',
        'If you already know it, where should the first online repo be created?',
        'Example: GitHub org/repo, Azure DevOps project/repo, or self-hosted GitLab group.',
        reporter,
      );
    }
  }

  reportBootstrapProgress(reporter, '#### Repo Setup\n\nAtlas is finishing the repository setup preferences.');
  intake.initGit = mapBooleanQuickPick(await askOptionalQuickPick(['Yes', 'No'], 'Initialise a Git repository?'));
  intake.scaffoldGovernance = mapBooleanQuickPick(await askOptionalQuickPick(
    ['Yes', 'No'],
    'Scaffold governance baseline (CI, issue templates, extension recommendations, dependency monitoring)?',
  ));

  if (intake.scaffoldGovernance) {
    intake.dependencyMonitoringProviders = getDependencyMonitoringProviders(
      mapDependencyMonitoringProviders(await vscode.window.showQuickPick(
        [
          'Dependabot',
          'Renovate',
          'Snyk',
          'Azure DevOps pipeline',
          'Skip / use workspace defaults',
        ],
        {
          placeHolder: 'Which dependency-monitoring scaffolds should Atlas prepare?',
          canPickMany: true,
        },
      )),
    );
    intake.dependencyMonitoringSchedule = mapDependencyMonitoringSchedule(await askOptionalQuickPick(
      ['Daily', 'Weekly', 'Monthly'],
      'What review cadence should dependency monitoring default to?',
    ));
  }

  return intake;
}

async function applyBootstrapIntake(
  workspaceRoot: vscode.Uri,
  ssotRoot: vscode.Uri,
  intake: BootstrapProjectIntake,
  configuration: Pick<vscode.WorkspaceConfiguration, 'get' | 'update'>,
  atlas: AtlasMindContext,
): Promise<BootstrapArtifacts> {
  const questionCount = 16;
  const answeredCount = countBootstrapSignals(intake);

  const projectSoulUpdated = await writeBootstrapProjectSoul(ssotRoot, intake);
  await writeBootstrapProjectBrief(ssotRoot, intake);
  await writeBootstrapRepositoryPlan(ssotRoot, intake);
  await writeBootstrapRoadmap(ssotRoot, intake);
  const ideationSeeded = await seedBootstrapIdeation(ssotRoot, intake);
  const settingsUpdated = await applyBootstrapSettings(configuration, intake);
  const personalitySeeded = await applyBootstrapPersonalityProfile(atlas, intake);
  const githubArtifactsUpdated = await writeGitHubPlanningArtifacts(workspaceRoot, intake);

  return {
    questionCount,
    answeredCount,
    projectSoulUpdated,
    ideationSeeded,
    githubArtifactsUpdated,
    personalitySeeded,
    settingsUpdated,
  };
}

function countBootstrapSignals(intake: BootstrapProjectIntake): number {
  return [
    intake.projectType,
    intake.projectName,
    intake.productSummary,
    intake.productOutcome,
    intake.builderProfile,
    intake.targetAudience,
    intake.timeline,
    intake.projectBudget,
    intake.atlasBudgetMode,
    intake.atlasSpeedMode,
    intake.techStack,
    intake.thirdPartyTools,
    intake.onlineRepoState,
    intake.successMetrics,
    intake.repoLocation,
    intake.repoHost,
  ].filter(value => typeof value === 'string' ? value.trim().length > 0 : Boolean(value)).length;
}

async function askBootstrapTextField(
  intake: BootstrapProjectIntake,
  field: BootstrapInferredField,
  title: string,
  prompt: string,
  placeHolder: string,
  reporter?: BootstrapPromptReporter,
): Promise<void> {
  if (hasBootstrapValue(intake[field])) {
    reportBootstrapProgress(reporter, `- Atlas already captured ${describeBootstrapField(field)} from earlier context, so that prompt is skipped.`);
    return;
  }

  const value = await askOptionalText(title, prompt, placeHolder);
  applyBootstrapFreeformAnswer(intake, field, value, reporter);
}

async function askBootstrapQuickPickField<T extends BootstrapProjectIntake[BootstrapInferredField]>(
  intake: BootstrapProjectIntake,
  field: BootstrapInferredField,
  options: string[],
  placeHolder: string,
  mapper: (selection: string | undefined) => T | undefined,
  reporter?: BootstrapPromptReporter,
): Promise<void> {
  if (hasBootstrapValue(intake[field])) {
    reportBootstrapProgress(reporter, `- Atlas already captured ${describeBootstrapField(field)} from earlier context, so that prompt is skipped.`);
    return;
  }

  const selection = await askOptionalQuickPick(options, placeHolder);
  const mapped = mapper(selection);
  if (mapped !== undefined) {
    setBootstrapField(intake, field, mapped);
  }
}

function applyBootstrapFreeformAnswer(
  intake: BootstrapProjectIntake,
  field: BootstrapInferredField,
  value: string | undefined,
  reporter?: BootstrapPromptReporter,
): void {
  const normalized = value?.trim();
  if (!normalized) {
    return;
  }

  setBootstrapField(intake, field, normalized);

  const inferred = inferBootstrapFieldsFromText(field, normalized);
  const capturedFields: string[] = [];
  for (const [candidateField, candidateValue] of Object.entries(inferred) as Array<[BootstrapInferredField, BootstrapProjectIntake[BootstrapInferredField]]>) {
    if (candidateField === field || !hasBootstrapValue(candidateValue) || hasBootstrapValue(intake[candidateField])) {
      continue;
    }
    setBootstrapField(intake, candidateField, candidateValue);
    const note = `Captured ${describeBootstrapField(candidateField)} from ${describeBootstrapField(field)}.`;
    if (!intake.captureNotes.includes(note)) {
      intake.captureNotes.push(note);
    }
    capturedFields.push(describeBootstrapField(candidateField));
  }

  if (capturedFields.length > 0) {
    reportBootstrapProgress(
      reporter,
      `- Atlas captured ${formatBootstrapFieldList(capturedFields)} from this answer and will not ask for ${capturedFields.length === 1 ? 'it' : 'them'} again.`,
    );
  }
}

function inferBootstrapFieldsFromText(
  sourceField: BootstrapInferredField,
  text: string,
): Partial<BootstrapProjectIntake> {
  const inferred: Partial<BootstrapProjectIntake> = {};

  if (sourceField !== 'projectName') {
    const labeledProjectName = extractLabeledBootstrapValue(text, ['project name', 'name', 'called']);
    if (labeledProjectName) {
      inferred.projectName = labeledProjectName;
    }
  }

  if (sourceField !== 'projectType') {
    const labeledProjectType = extractLabeledBootstrapValue(text, ['project type', 'type']);
    inferred.projectType = inferBootstrapProjectType(labeledProjectType ?? text);
  }

  if (sourceField !== 'productOutcome') {
    const labeledOutcome = extractLabeledBootstrapValue(text, ['outcome', 'primary outcome', 'goal', 'objective']);
    if (labeledOutcome) {
      inferred.productOutcome = labeledOutcome;
    }
  }

  if (sourceField !== 'targetAudience') {
    const labeledAudience = extractLabeledBootstrapValue(text, ['audience', 'target audience', 'users', 'target users']);
    const naturalAudience = labeledAudience ?? extractAudienceFromBootstrapText(text);
    if (naturalAudience) {
      inferred.targetAudience = naturalAudience;
    }
  }

  if (sourceField !== 'builderProfile') {
    const labeledBuilders = extractLabeledBootstrapValue(text, ['builders', 'built by', 'builder profile', 'team', 'who is building it']);
    const naturalBuilders = labeledBuilders ?? extractBuilderProfileFromBootstrapText(text);
    if (naturalBuilders) {
      inferred.builderProfile = naturalBuilders;
    }
  }

  if (sourceField !== 'timeline') {
    const labeledTimeline = extractLabeledBootstrapValue(text, ['timeline', 'timeframe', 'deadline', 'launch']);
    const naturalTimeline = labeledTimeline ?? extractTimelineFromBootstrapText(text);
    if (naturalTimeline) {
      inferred.timeline = naturalTimeline;
    }
  }

  if (sourceField !== 'projectBudget') {
    const labeledBudget = extractLabeledBootstrapValue(text, ['budget', 'cost posture', 'budget posture', 'funding']);
    const naturalBudget = labeledBudget ?? extractBudgetFromBootstrapText(text);
    if (naturalBudget) {
      inferred.projectBudget = naturalBudget;
    }
  }

  if (sourceField !== 'successMetrics') {
    const labeledMetrics = extractLabeledBootstrapValue(text, ['success metrics', 'metrics', 'kpis', 'measure']);
    if (labeledMetrics) {
      inferred.successMetrics = labeledMetrics;
    }
  }

  if (sourceField !== 'techStack') {
    const labeledStack = extractLabeledBootstrapValue(text, ['tech stack', 'stack', 'technical stack']);
    const naturalStack = dedupeBootstrapTerms([
      labeledStack,
      findKnownBootstrapTerms(text, KNOWN_TECH_TERMS),
    ]);
    if (naturalStack) {
      inferred.techStack = naturalStack;
    }
  }

  if (sourceField !== 'thirdPartyTools') {
    const labeledTools = extractLabeledBootstrapValue(text, ['3rd-party tools', 'third-party tools', 'tools', 'integrations', 'platforms']);
    const naturalTools = dedupeBootstrapTerms([
      labeledTools,
      findKnownBootstrapTerms(text, KNOWN_TOOL_TERMS),
    ]);
    if (naturalTools) {
      inferred.thirdPartyTools = naturalTools;
    }
  }

  if (sourceField !== 'onlineRepoState') {
    inferred.onlineRepoState = inferOnlineRepoStateFromBootstrapText(text);
  }

  if (sourceField !== 'repoLocation') {
    const labeledRepoLocation = extractLabeledBootstrapValue(text, ['repo location', 'repository location', 'repository path', 'remote location', 'github org', 'gitlab group', 'azure devops project']);
    const naturalRepoLocation = labeledRepoLocation ?? extractRepoLocationFromBootstrapText(text);
    if (naturalRepoLocation) {
      inferred.repoLocation = naturalRepoLocation;
    }
  }

  if (sourceField !== 'repoHost') {
    inferred.repoHost = inferRepoHostFromBootstrapText(text);
  }

  if (sourceField !== 'atlasBudgetMode') {
    inferred.atlasBudgetMode = inferAtlasBudgetModeFromBootstrapText(text);
  }

  if (sourceField !== 'atlasSpeedMode') {
    inferred.atlasSpeedMode = inferAtlasSpeedModeFromBootstrapText(text);
  }

  return inferred;
}

function extractLabeledBootstrapValue(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const match = new RegExp(`(?:^|[.;\\n]\\s*)${escapeBootstrapRegex(label)}\\s*[:=-]\\s*([^.;\\n]+)`, 'i').exec(text);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function extractAudienceFromBootstrapText(text: string): string | undefined {
  const match = /\bfor\s+([^.;\n]+?)(?=\s+(?:using|with|built|shipping|launch(?:ing)?|by|on)\b|[.;\n]|$)/i.exec(text);
  const value = match?.[1]?.trim();
  if (!value || /^this\s+project$/i.test(value)) {
    return undefined;
  }

  return /\b(users?|customers?|clients?|operators?|admins?|administrators?|analysts?|developers?|engineers?|designers?|founders?|teams?|staff|students?|teachers?|researchers?|coordinators?|managers?|technicians?)\b/i.test(value)
    ? value
    : undefined;
}

function extractBuilderProfileFromBootstrapText(text: string): string | undefined {
  const patterns = [
    /\bbuilt by\s+([^.;\n]+)/i,
    /\bby\s+(a\s+[^.;\n]+(?:team|group|founder|engineers?|developers?|designers?|analysts?)[^.;\n]*)/i,
    /\bwith\s+(a\s+[^.;\n]+(?:team|group|founder|engineers?|developers?|designers?|analysts?)[^.;\n]*)/i,
  ];

  for (const pattern of patterns) {
    const value = pattern.exec(text)?.[1]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function extractTimelineFromBootstrapText(text: string): string | undefined {
  const patterns = [
    /\b(in\s+\d+\s+(?:day|days|week|weeks|month|months|quarter|quarters|year|years))\b/i,
    /\b(within\s+\d+\s+(?:day|days|week|weeks|month|months|quarter|quarters|year|years))\b/i,
    /\b(?:launch(?:ing)?|shipping|beta|ga)\s+([^.;\n]+)/i,
    /\bby\s+((?:Q[1-4]\s+)?[A-Z][a-z]+\s+\d{4}|[A-Z][a-z]+\s+\d{1,2}(?:,\s*\d{4})?)/i,
  ];

  for (const pattern of patterns) {
    const value = pattern.exec(text)?.[1]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function extractBudgetFromBootstrapText(text: string): string | undefined {
  const lowered = text.toLowerCase();
  if (lowered.includes('lean budget') || lowered.includes('lean mvp')) {
    return 'Lean budget';
  }
  if (lowered.includes('moderate budget')) {
    return 'Moderate budget';
  }
  if (lowered.includes('tight budget') || lowered.includes('bootstrapped')) {
    return 'Tight or bootstrapped budget';
  }
  if (lowered.includes('enterprise-funded') || lowered.includes('premium budget')) {
    return 'Enterprise-funded budget';
  }
  return undefined;
}

function inferBootstrapProjectType(text: string): BootstrapProjectIntake['projectType'] {
  const lowered = text.toLowerCase();
  if (/\b(vs\s*code extension|extension)\b/.test(lowered)) {
    return 'VS Code Extension';
  }
  if (/\b(api|service|backend|server)\b/.test(lowered)) {
    return 'API Server';
  }
  if (/\b(cli|command line|terminal app|console app)\b/.test(lowered)) {
    return 'CLI Tool';
  }
  if (/\b(library|sdk|package|module)\b/.test(lowered)) {
    return 'Library';
  }
  if (/\b(desktop|electron|tauri)\b/.test(lowered)) {
    return 'Desktop App';
  }
  if (/\b(mobile|ios|android|react native|flutter)\b/.test(lowered)) {
    return 'Mobile App';
  }
  if (/\b(web app|portal|dashboard|site|frontend|browser app|website)\b/.test(lowered)) {
    return 'Web App';
  }
  return undefined;
}

function inferRepoHostFromBootstrapText(text: string): BootstrapProjectIntake['repoHost'] {
  if (/\bgithub(?!\s+actions)\b/i.test(text)) {
    return 'github';
  }
  if (/\bazure\s+devops\b/i.test(text)) {
    return 'azure-devops';
  }
  if (/\bgitlab\b/i.test(text)) {
    return 'gitlab';
  }
  return undefined;
}

function inferOnlineRepoStateFromBootstrapText(text: string): BootstrapOnlineRepoState | undefined {
  if (/\b(no|without)\s+(?:online|remote)\s+repo(?:sitory)?\b/i.test(text) || /\bno\s+repo\s+yet\b/i.test(text)) {
    return /\b(local only|keep it local|no remote planned)\b/i.test(text) ? 'none' : 'planned';
  }
  if (/\b(existing|already\s+have|already\s+on|already\s+in)\s+(?:an?\s+)?(?:online|remote)\s+repo(?:sitory)?\b/i.test(text)) {
    return 'existing';
  }
  if (/\bhost(?:ed|ing)?\s+(?:later|eventually)?\s+on\s+(github|gitlab|azure devops)\b/i.test(text)) {
    return 'planned';
  }
  return undefined;
}

function extractRepoLocationFromBootstrapText(text: string): string | undefined {
  const match = /\b(?:create|host|store)\s+(?:it|the repo|the repository)?\s*(?:on|in|under)\s+([^.;\n]+?)(?=\s+(?:with|using|for)\b|[.;\n]|$)/i.exec(text);
  const value = match?.[1]?.trim();
  return value && !/^(github|gitlab|azure devops)$/i.test(value) ? value : undefined;
}

function inferAtlasBudgetModeFromBootstrapText(text: string): BudgetMode | undefined {
  const lowered = text.toLowerCase();
  if (/(atlas\s+budget\s+mode\s*[:=-]\s*)?(lean|bootstrapped|tight budget|keep costs low|cost-sensitive|cheap)/i.test(lowered)) {
    return 'cheap';
  }
  if (/(atlas\s+budget\s+mode\s*[:=-]\s*)?(premium|depth first|enterprise-funded|quality first)/i.test(lowered)) {
    return 'expensive';
  }
  if (/(atlas\s+budget\s+mode\s*[:=-]\s*)?(balanced|moderate budget|reasonable budget)/i.test(lowered)) {
    return 'balanced';
  }
  return undefined;
}

function inferAtlasSpeedModeFromBootstrapText(text: string): SpeedMode | undefined {
  const lowered = text.toLowerCase();
  if (/(atlas\s+speed\s+mode\s*[:=-]\s*)?(fast feedback|move fast|rapid iteration|quick turnaround|ship quickly)/i.test(lowered)) {
    return 'fast';
  }
  if (/(atlas\s+speed\s+mode\s*[:=-]\s*)?(considered|deeper reasoning|thorough|deliberate|careful)/i.test(lowered)) {
    return 'considered';
  }
  if (/(atlas\s+speed\s+mode\s*[:=-]\s*)?balanced/i.test(lowered)) {
    return 'balanced';
  }
  return undefined;
}

function findKnownBootstrapTerms(text: string, knownTerms: readonly string[]): string | undefined {
  const matches = knownTerms.filter(term => new RegExp(`(^|[^A-Za-z0-9])${escapeBootstrapRegex(term)}([^A-Za-z0-9]|$)`, 'i').test(text));
  return matches.length > 0 ? matches.join(', ') : undefined;
}

function dedupeBootstrapTerms(values: Array<string | undefined>): string | undefined {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    for (const segment of value.split(/[,|]/)) {
      const normalized = segment.trim();
      if (!normalized) {
        continue;
      }
      const dedupeKey = normalized.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      ordered.push(normalized);
    }
  }
  return ordered.length > 0 ? ordered.join(', ') : undefined;
}

function hasBootstrapValue(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null;
}

function setBootstrapField(
  intake: BootstrapProjectIntake,
  field: BootstrapInferredField,
  value: BootstrapProjectIntake[BootstrapInferredField],
): void {
  (intake as unknown as Record<string, unknown>)[field] = value;
}

function describeBootstrapField(field: BootstrapInferredField): string {
  switch (field) {
    case 'projectName':
      return 'project name';
    case 'projectType':
      return 'project type';
    case 'productSummary':
      return 'project brief';
    case 'productOutcome':
      return 'primary outcome';
    case 'builderProfile':
      return 'builder profile';
    case 'targetAudience':
      return 'target audience';
    case 'timeline':
      return 'timeline';
    case 'projectBudget':
      return 'budget';
    case 'atlasBudgetMode':
      return 'Atlas budget mode';
    case 'atlasSpeedMode':
      return 'Atlas speed mode';
    case 'techStack':
      return 'tech stack';
    case 'thirdPartyTools':
      return 'third-party tools';
    case 'onlineRepoState':
      return 'online repo status';
    case 'successMetrics':
      return 'success metrics';
    case 'repoLocation':
      return 'planned repo location';
    case 'repoHost':
      return 'delivery platform';
  }
}

function formatBootstrapFieldList(fields: string[]): string {
  if (fields.length === 1) {
    return fields[0] ?? 'that context';
  }
  if (fields.length === 2) {
    return `${fields[0]} and ${fields[1]}`;
  }
  return `${fields.slice(0, -1).join(', ')}, and ${fields.at(-1)}`;
}

function escapeBootstrapRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function applyBootstrapPersonalityProfile(atlas: AtlasMindContext, intake: BootstrapProjectIntake): Promise<boolean> {
  const answers = buildBootstrapPersonalityAnswers(intake);
  if (Object.keys(answers).length === 0) {
    return false;
  }

  const workspaceState = atlas.extensionContext.workspaceState;
  const existing = workspaceState.get<unknown>(PROJECT_PERSONALITY_PROFILE_STORAGE_KEY);
  const existingAnswers = isStoredBootstrapPersonalityProfile(existing) ? existing.answers : {};
  const nextAnswers: Record<string, unknown> = { ...existingAnswers };
  let changed = false;

  for (const [key, value] of Object.entries(answers)) {
    if (hasMeaningfulBootstrapPersonalityAnswer(existingAnswers[key])) {
      continue;
    }
    nextAnswers[key] = value;
    changed = true;
  }

  if (!changed) {
    return false;
  }

  await workspaceState.update(PROJECT_PERSONALITY_PROFILE_STORAGE_KEY, {
    version: 1,
    updatedAt: new Date().toISOString(),
    answers: nextAnswers,
  });
  return true;
}

function buildBootstrapPersonalityAnswers(intake: BootstrapProjectIntake): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  const projectLabel = intake.projectName || intake.productSummary || 'this project';
  const primaryOutcome = intake.productOutcome || intake.successMetrics;

  if (intake.productSummary) {
    answers['primaryPurpose'] = `Help deliver ${projectLabel} with project-aware engineering, planning, and documentation support.`;
  }

  if (primaryOutcome) {
    answers['optimiseFor'] = primaryOutcome;
    answers['northStar'] = `Keep work aligned to ${primaryOutcome}${intake.targetAudience ? ` for ${intake.targetAudience}` : ''}, and avoid losing earlier captured project context.`;
  }

  const priorityValues = [
    primaryOutcome ? 'outcome alignment' : '',
    intake.targetAudience ? 'audience clarity' : '',
    intake.techStack ? 'technical consistency' : '',
    'traceable decisions',
    'context continuity',
  ].filter(Boolean).join(', ');
  if (priorityValues) {
    answers['priorityValues'] = priorityValues;
  }

  const longTermMemory = [
    intake.productSummary ? `Project brief: ${intake.productSummary}` : '',
    intake.targetAudience ? `Audience: ${intake.targetAudience}` : '',
    intake.timeline ? `Timeline: ${intake.timeline}` : '',
    intake.projectBudget ? `Budget: ${intake.projectBudget}` : '',
    intake.techStack ? `Stack: ${intake.techStack}` : '',
    intake.thirdPartyTools ? `Tools: ${intake.thirdPartyTools}` : '',
  ].filter(Boolean).join(' | ');
  if (longTermMemory) {
    answers['rememberLongTerm'] = longTermMemory;
  }

  if (intake.productSummary || intake.productOutcome || intake.timeline) {
    answers['goalHorizon'] = 'project-aware';
    answers['goalModelPersistence'] = 'maintain';
    answers['ambiguityHandling'] = 'safe-assumptions';
  }

  if (intake.atlasBudgetMode === 'cheap') {
    answers['costAwareness'] = 'always-surface';
  } else if (intake.atlasBudgetMode === 'expensive') {
    answers['costAwareness'] = 'quiet';
  }

  const inferredRiskTolerance = inferBootstrapPersonalityRiskTolerance(intake);
  if (inferredRiskTolerance) {
    answers['riskTolerance'] = inferredRiskTolerance;
  }

  return answers;
}

function inferBootstrapPersonalityRiskTolerance(
  intake: BootstrapProjectIntake,
): 'risk-averse' | 'risk-neutral' | 'risk-tolerant' | undefined {
  const text = [
    intake.projectBudget,
    intake.timeline,
    intake.builderProfile,
    intake.productOutcome,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/\b(regulated|compliance|enterprise|security|reliability|fixed client|tight deadline)\b/.test(text)) {
    return 'risk-averse';
  }
  if (/\b(prototype|experiment|mvp|hackathon|explore|greenfield)\b/.test(text)) {
    return 'risk-tolerant';
  }
  if (text.length > 0) {
    return 'risk-neutral';
  }
  return undefined;
}

function isStoredBootstrapPersonalityProfile(value: unknown): value is { version: 1; updatedAt: string; answers: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['version'] === 1
    && typeof candidate['updatedAt'] === 'string'
    && typeof candidate['answers'] === 'object'
    && candidate['answers'] !== null;
}

function hasMeaningfulBootstrapPersonalityAnswer(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 && value.trim() !== 'auto' : value !== undefined && value !== null;
}

async function writeBootstrapProjectSoul(ssotRoot: vscode.Uri, intake: BootstrapProjectIntake): Promise<boolean> {
  const soulUri = vscode.Uri.joinPath(ssotRoot, 'project_soul.md');
  const existing = await readUtf8IfExists(soulUri);
  const projectSoul = buildBootstrapProjectSoul(existing, intake);
  await vscode.workspace.fs.writeFile(soulUri, Buffer.from(projectSoul, 'utf-8'));
  return true;
}

async function writeBootstrapProjectBrief(ssotRoot: vscode.Uri, intake: BootstrapProjectIntake): Promise<void> {
  const briefUri = vscode.Uri.joinPath(ssotRoot, 'domain', 'project-brief.md');
  await ensureParentDirectory(briefUri, ssotRoot);
  await vscode.workspace.fs.writeFile(briefUri, Buffer.from(buildBootstrapProjectBrief(intake), 'utf-8'));

  const intakeUri = vscode.Uri.joinPath(ssotRoot, 'operations', 'bootstrap-intake.md');
  await ensureParentDirectory(intakeUri, ssotRoot);
  await vscode.workspace.fs.writeFile(intakeUri, Buffer.from(buildBootstrapIntakeLog(intake), 'utf-8'));
}

async function writeBootstrapRepositoryPlan(ssotRoot: vscode.Uri, intake: BootstrapProjectIntake): Promise<void> {
  const repositoryPlanUri = vscode.Uri.joinPath(ssotRoot, 'operations', 'repository-plan.md');
  await ensureParentDirectory(repositoryPlanUri, ssotRoot);
  await vscode.workspace.fs.writeFile(repositoryPlanUri, Buffer.from(buildBootstrapRepositoryPlan(intake), 'utf-8'));
}

async function writeBootstrapRoadmap(ssotRoot: vscode.Uri, intake: BootstrapProjectIntake): Promise<void> {
  const roadmapUri = vscode.Uri.joinPath(ssotRoot, 'roadmap', 'bootstrap-plan.md');
  await ensureParentDirectory(roadmapUri, ssotRoot);
  await vscode.workspace.fs.writeFile(roadmapUri, Buffer.from(buildBootstrapRoadmap(intake), 'utf-8'));
}

async function seedBootstrapIdeation(ssotRoot: vscode.Uri, intake: BootstrapProjectIntake): Promise<boolean> {
  const ideasDir = vscode.Uri.joinPath(ssotRoot, 'ideas');
  await vscode.workspace.fs.createDirectory(ideasDir);

  const board = buildBootstrapIdeationBoard(intake);
  const boardUri = vscode.Uri.joinPath(ideasDir, 'atlas-ideation-board.json');
  const summaryUri = vscode.Uri.joinPath(ideasDir, 'atlas-ideation-board.md');

  await vscode.workspace.fs.writeFile(boardUri, Buffer.from(JSON.stringify(board, null, 2), 'utf-8'));
  await vscode.workspace.fs.writeFile(summaryUri, Buffer.from(buildBootstrapIdeationSummary(board), 'utf-8'));
  return true;
}

async function applyBootstrapSettings(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get' | 'update'>,
  intake: BootstrapProjectIntake,
): Promise<string[]> {
  const updated: string[] = [];

  if (intake.atlasBudgetMode && configuration.get<string>('budgetMode') !== intake.atlasBudgetMode) {
    await configuration.update('budgetMode', intake.atlasBudgetMode, vscode.ConfigurationTarget.WorkspaceFolder);
    updated.push(`budgetMode=${intake.atlasBudgetMode}`);
  }

  if (intake.atlasSpeedMode && configuration.get<string>('speedMode') !== intake.atlasSpeedMode) {
    await configuration.update('speedMode', intake.atlasSpeedMode, vscode.ConfigurationTarget.WorkspaceFolder);
    updated.push(`speedMode=${intake.atlasSpeedMode}`);
  }

  if (intake.dependencyMonitoringProviders && intake.dependencyMonitoringProviders.length > 0) {
    await configuration.update('projectDependencyMonitoringProviders', intake.dependencyMonitoringProviders, vscode.ConfigurationTarget.WorkspaceFolder);
    updated.push(`projectDependencyMonitoringProviders=${intake.dependencyMonitoringProviders.join(',')}`);
  }

  if (intake.dependencyMonitoringSchedule) {
    await configuration.update('projectDependencyMonitoringSchedule', intake.dependencyMonitoringSchedule, vscode.ConfigurationTarget.WorkspaceFolder);
    updated.push(`projectDependencyMonitoringSchedule=${intake.dependencyMonitoringSchedule}`);
  }

  if (typeof intake.scaffoldGovernance === 'boolean') {
    await configuration.update('projectDependencyMonitoringEnabled', intake.scaffoldGovernance, vscode.ConfigurationTarget.WorkspaceFolder);
    updated.push(`projectDependencyMonitoringEnabled=${String(intake.scaffoldGovernance)}`);
  }
  return updated;
}

async function writeGitHubPlanningArtifacts(workspaceRoot: vscode.Uri, intake: BootstrapProjectIntake): Promise<boolean> {
  const issueTemplateUri = vscode.Uri.joinPath(workspaceRoot, '.github', 'ISSUE_TEMPLATE', 'project_intake.yml');
  await ensureParentDirectory(issueTemplateUri, workspaceRoot);
  await vscode.workspace.fs.writeFile(issueTemplateUri, Buffer.from(buildBootstrapProjectIntakeIssueTemplate(intake), 'utf-8'));

  const projectCsvUri = vscode.Uri.joinPath(workspaceRoot, '.github', 'project-planning', 'atlasmind-project-items.csv');
  await ensureParentDirectory(projectCsvUri, workspaceRoot);
  await vscode.workspace.fs.writeFile(projectCsvUri, Buffer.from(buildBootstrapProjectPlanningCsv(intake), 'utf-8'));
  return true;
}

function buildBootstrapCompletionSummary(ssotRelPath: string, intake: BootstrapProjectIntake, artifacts: BootstrapArtifacts): string {
  const lines = [
    '### Bootstrap Complete',
    '',
    `- SSOT location: \`${ssotRelPath}/\``,
    `- Captured signals: **${artifacts.answeredCount}/${artifacts.questionCount}**`,
    artifacts.settingsUpdated.length > 0
      ? `- Updated Atlas settings: ${artifacts.settingsUpdated.map(item => `\`${item}\``).join(', ')}`
      : '- Updated Atlas settings: none',
    artifacts.personalitySeeded
      ? '- Seeded project-scoped Personality Profile defaults from the captured brief.'
      : '- Personality Profile defaults were left unchanged.',
    artifacts.ideationSeeded
      ? '- Seeded ideation defaults in `ideas/atlas-ideation-board.json` and `ideas/atlas-ideation-board.md`.'
      : '- Ideation defaults were not seeded.',
    artifacts.githubArtifactsUpdated
      ? '- Wrote GitHub-ready planning artifacts under `.github/ISSUE_TEMPLATE/` and `.github/project-planning/`.'
      : '- GitHub-ready planning artifacts were not written.',
    intake.onlineRepoState === 'planned'
      ? `- Atlas captured where the first online repo should live${intake.repoHost ? `: ${formatBootstrapRepoTarget(intake)}` : ''}.`
      : intake.onlineRepoState === 'existing'
        ? `- Atlas recorded the existing online repo host${intake.repoHost ? `: ${formatBootstrapRepoTarget(intake)}` : ''}.`
        : intake.onlineRepoState === 'none'
          ? '- Atlas recorded that the project is local-only for now.'
          : '- Online repo planning was skipped.',
    intake.scaffoldGovernance
      ? '- Governance scaffolding is enabled for this repo.'
      : '- Governance scaffolding was skipped.',
  ];

  if (intake.productSummary) {
    lines.push('', `**Project brief:** ${intake.productSummary}`);
  }

  if (intake.captureNotes.length > 0) {
    lines.push('', `**Auto-captured context:** ${intake.captureNotes.join(' ')}`);
  }

  return lines.join('\n');
}

function buildBootstrapProjectSoul(existing: string | undefined, intake: BootstrapProjectIntake): string {
  const title = intake.projectName?.trim() || 'Project Soul';
  const vision = intake.productSummary?.trim() || 'Define the product clearly, keep the architecture intentional, and preserve key context in AtlasMind SSOT memory.';
  const principles = [
    intake.productOutcome ? `- Optimize for the primary outcome: ${intake.productOutcome}.` : '- Optimize for a clearly stated user and business outcome.',
    intake.targetAudience ? `- Keep the target audience explicit: ${intake.targetAudience}.` : '- Keep the target audience explicit in planning and execution.',
    intake.techStack ? `- Prefer the agreed stack: ${intake.techStack}.` : '- Prefer the agreed stack and avoid accidental sprawl.',
    intake.projectBudget ? `- Respect the budget posture: ${intake.projectBudget}.` : '- Respect budget, time, and staffing constraints.',
    '- Keep project memory, ideation, and governance artifacts in sync.',
  ].join('\n');
  const intakeSnapshot = buildBootstrapSnapshotBlock(intake);

  if (!existing || shouldRefreshProjectSoul(existing)) {
    return [
      `# ${title}`,
      '',
      '> This file is the living identity of the project.',
      '',
      '## Project Type',
      intake.projectType ?? 'Unknown',
      '',
      '## Vision',
      vision,
      '',
      '## Principles',
      principles,
      '',
      '## Bootstrap Intake Snapshot',
      intakeSnapshot,
      '',
      '## Key Decisions',
      '- AtlasMind bootstrapping seeds SSOT, ideation defaults, and GitHub planning artifacts from a guided intake.',
      '- Long-term project context belongs in the SSOT under `project_memory/`.',
      '- Routing preferences and governance defaults should match the project delivery constraints.',
      '',
      '## Imported References',
      '- domain/project-brief.md',
      '- operations/bootstrap-intake.md',
      '- operations/repository-plan.md',
      '- roadmap/bootstrap-plan.md',
      '- ideas/atlas-ideation-board.md',
    ].join('\n');
  }

  return upsertMarkdownSection(existing, 'Bootstrap Intake Snapshot', intakeSnapshot);
}

function buildBootstrapProjectBrief(intake: BootstrapProjectIntake): string {
  return [
    '# Project Brief',
    '',
    '## Summary',
    intake.productSummary ?? '_Not captured during bootstrap._',
    '',
    '## Primary Outcome',
    intake.productOutcome ?? '_Not captured during bootstrap._',
    '',
    '## Audience',
    intake.targetAudience ?? '_Not captured during bootstrap._',
    '',
    '## Builders',
    intake.builderProfile ?? '_Not captured during bootstrap._',
    '',
    '## Delivery Constraints',
    `- Timeline: ${intake.timeline ?? 'Unspecified'}`,
    `- Budget: ${intake.projectBudget ?? 'Unspecified'}`,
    `- Atlas budget mode: ${intake.atlasBudgetMode ?? 'Unspecified'}`,
    `- Atlas speed mode: ${intake.atlasSpeedMode ?? 'Unspecified'}`,
    '',
    '## Repository Plan',
    `- Online repo status: ${describeBootstrapOnlineRepoState(intake.onlineRepoState)}`,
    `- Repo host: ${intake.repoHost ?? 'Unspecified'}`,
    `- Repo location: ${intake.repoLocation ?? 'Unspecified'}`,
    '',
    '## Technical Direction',
    `- Project type: ${intake.projectType ?? 'Unspecified'}`,
    `- Tech stack: ${intake.techStack ?? 'Unspecified'}`,
    `- Third-party tools: ${intake.thirdPartyTools ?? 'Unspecified'}`,
    `- Delivery platform: ${intake.repoHost ?? 'Unspecified'}`,
    '',
    '## Success Signals',
    intake.successMetrics ?? '_Not captured during bootstrap._',
  ].join('\n');
}

function buildBootstrapRepositoryPlan(intake: BootstrapProjectIntake): string {
  return [
    '# Repository Plan',
    '',
    `- Online repo status: ${describeBootstrapOnlineRepoState(intake.onlineRepoState)}`,
    `- Preferred host: ${intake.repoHost ?? 'Unspecified'}`,
    `- Preferred location: ${intake.repoLocation ?? 'Unspecified'}`,
    '',
    '## Notes',
    intake.onlineRepoState === 'planned'
      ? `- Create the first online repository on ${formatBootstrapRepoTarget(intake) || 'the chosen host'} before production delivery automation depends on it.`
      : intake.onlineRepoState === 'existing'
        ? `- Reuse the existing online repository on ${formatBootstrapRepoTarget(intake) || 'the chosen host'} for governance, planning, and automation.`
        : intake.onlineRepoState === 'none'
          ? '- Keep the project local-only for now and revisit remote hosting when collaboration or automation requires it.'
          : '- Repository hosting was not captured during bootstrap.',
  ].join('\n');
}

function buildBootstrapIntakeLog(intake: BootstrapProjectIntake): string {
  return [
    '# Bootstrap Intake Log',
    '',
    `Captured: ${new Date().toISOString()}`,
    '',
    '## Responses',
    `- Mode: ${intake.mode}`,
    `- Project name: ${intake.projectName ?? 'Skipped'}`,
    `- Project type: ${intake.projectType ?? 'Skipped'}`,
    `- Product summary: ${intake.productSummary ?? 'Skipped'}`,
    `- Primary outcome: ${intake.productOutcome ?? 'Skipped'}`,
    `- Builder profile: ${intake.builderProfile ?? 'Skipped'}`,
    `- Target audience: ${intake.targetAudience ?? 'Skipped'}`,
    `- Timeline: ${intake.timeline ?? 'Skipped'}`,
    `- Budget: ${intake.projectBudget ?? 'Skipped'}`,
    `- Atlas budget mode: ${intake.atlasBudgetMode ?? 'Skipped'}`,
    `- Atlas speed mode: ${intake.atlasSpeedMode ?? 'Skipped'}`,
    `- Tech stack: ${intake.techStack ?? 'Skipped'}`,
    `- Third-party tools: ${intake.thirdPartyTools ?? 'Skipped'}`,
    `- Online repo status: ${describeBootstrapOnlineRepoState(intake.onlineRepoState)}`,
    `- Success metrics: ${intake.successMetrics ?? 'Skipped'}`,
    `- Repo location: ${intake.repoLocation ?? 'Skipped'}`,
    `- Repo host: ${intake.repoHost ?? 'Skipped'}`,
    `- Init git: ${typeof intake.initGit === 'boolean' ? String(intake.initGit) : 'Skipped'}`,
    `- Governance scaffold: ${typeof intake.scaffoldGovernance === 'boolean' ? String(intake.scaffoldGovernance) : 'Skipped'}`,
    '',
    '## Auto-captured context',
    ...(intake.captureNotes.length > 0 ? intake.captureNotes.map(note => `- ${note}`) : ['- None']),
  ].join('\n');
}

function buildBootstrapRoadmap(intake: BootstrapProjectIntake): string {
  const projectLabel = intake.projectName || intake.productSummary || 'the project';
  return [
    '# Bootstrap Plan',
    '',
    `## Initial Track for ${projectLabel}`,
    '',
    '- [ ] Confirm the problem statement and success metrics.',
    '- [ ] Review the target audience assumptions with stakeholders.',
    intake.techStack ? `- [ ] Validate the proposed stack: ${intake.techStack}.` : '- [ ] Validate the technical stack and delivery architecture.',
    intake.thirdPartyTools ? `- [ ] Confirm third-party integrations: ${intake.thirdPartyTools}.` : '- [ ] Confirm third-party integrations and operational dependencies.',
    intake.timeline ? `- [ ] Sequence milestones against the stated timeframe: ${intake.timeline}.` : '- [ ] Sequence the first milestones and delivery checkpoints.',
    intake.projectBudget ? `- [ ] Check scope against the budget posture: ${intake.projectBudget}.` : '- [ ] Check scope against the available budget and staffing.',
    intake.onlineRepoState === 'planned'
      ? `- [ ] Create the online repository on ${formatBootstrapRepoTarget(intake) || 'the selected host'} and connect delivery automation.`
      : intake.onlineRepoState === 'existing'
        ? `- [ ] Confirm Atlas governance and planning artifacts align with the existing online repository on ${formatBootstrapRepoTarget(intake) || 'the selected host'}.`
        : '- [ ] Decide whether and when this project should move to an online repository.',
    '- [ ] Turn the brief into issue-level execution slices and a tracked project board.',
  ].join('\n');
}

function buildBootstrapIdeationBoard(intake: BootstrapProjectIntake): BootstrapIdeationBoardRecord {
  const now = new Date().toISOString();
  const rootId = createBootstrapIdeationId('card');
  const audienceId = createBootstrapIdeationId('card');
  const constraintId = createBootstrapIdeationId('card');
  const stackId = createBootstrapIdeationId('card');
  const cards: BootstrapIdeationCardRecord[] = [
    {
      id: rootId,
      title: intake.projectName || intake.projectType || 'Project concept',
      body: clampBootstrapText(intake.productSummary || intake.productOutcome || 'Define the product clearly before execution starts.', 220),
      kind: 'idea',
      author: 'user',
      x: 0,
      y: 0,
      color: 'sun',
      imageSources: [],
      media: [],
      tags: ['bootstrap'],
      confidence: 55,
      evidenceStrength: 25,
      riskScore: 30,
      costToValidate: 35,
      syncTargets: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: audienceId,
      title: 'Target audience',
      body: clampBootstrapText(intake.targetAudience || 'Clarify the primary users and jobs-to-be-done.', 220),
      kind: 'user-insight',
      author: 'atlas',
      x: 280,
      y: -40,
      color: 'sea',
      imageSources: [],
      media: [],
      tags: ['audience'],
      confidence: 50,
      evidenceStrength: 40,
      riskScore: 25,
      costToValidate: 20,
      syncTargets: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: constraintId,
      title: 'Constraints',
      body: clampBootstrapText([
        intake.timeline ? `Timeline: ${intake.timeline}` : '',
        intake.projectBudget ? `Budget: ${intake.projectBudget}` : '',
        intake.builderProfile ? `Builders: ${intake.builderProfile}` : '',
        intake.onlineRepoState ? `Repo: ${describeBootstrapOnlineRepoState(intake.onlineRepoState)}` : '',
      ].filter(Boolean).join(' | ') || 'Capture the real delivery constraints before execution expands.', 220),
      kind: 'risk',
      author: 'atlas',
      x: -280,
      y: 40,
      color: 'rose',
      imageSources: [],
      media: [],
      tags: ['constraints'],
      confidence: 45,
      evidenceStrength: 30,
      riskScore: 70,
      costToValidate: 25,
      syncTargets: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: stackId,
      title: 'Technical direction',
      body: clampBootstrapText([
        intake.projectType ? `Type: ${intake.projectType}` : '',
        intake.techStack ? `Stack: ${intake.techStack}` : '',
        intake.thirdPartyTools ? `Tools: ${intake.thirdPartyTools}` : '',
      ].filter(Boolean).join(' | ') || 'Capture the intended stack and integration surface.', 220),
      kind: 'requirement',
      author: 'atlas',
      x: 40,
      y: 240,
      color: 'sand',
      imageSources: [],
      media: [],
      tags: ['stack'],
      confidence: 55,
      evidenceStrength: 35,
      riskScore: 35,
      costToValidate: 30,
      syncTargets: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const connections: BootstrapIdeationConnectionRecord[] = [
    { id: createBootstrapIdeationId('link'), fromCardId: rootId, toCardId: audienceId, label: 'serves', style: 'dotted', direction: 'none', relation: 'causal' },
    { id: createBootstrapIdeationId('link'), fromCardId: rootId, toCardId: constraintId, label: 'bounded by', style: 'dotted', direction: 'none', relation: 'contradiction' },
    { id: createBootstrapIdeationId('link'), fromCardId: rootId, toCardId: stackId, label: 'implemented through', style: 'dotted', direction: 'none', relation: 'dependency' },
  ];

  return {
    version: 1,
    updatedAt: now,
    cards,
    connections,
    constraints: {
      budget: intake.projectBudget ?? '',
      timeline: intake.timeline ?? '',
      teamSize: intake.builderProfile ?? '',
      riskTolerance: intake.projectBudget?.toLowerCase().includes('enterprise') ? 'balanced' : '',
      technicalStack: intake.techStack ?? '',
    },
    focusCardId: rootId,
    lastAtlasResponse: 'Atlas seeded the ideation board from the bootstrap intake.',
    nextPrompts: [
      'What is the smallest end-to-end slice worth validating first?',
      'Which assumption about the audience is most dangerous if wrong?',
      intake.onlineRepoState === 'planned'
        ? 'What should happen before the first online repository is created?'
        : 'What should become tracked issues or project items next?',
    ],
    history: [
      {
        role: 'atlas',
        content: 'Atlas seeded the ideation board from the bootstrap intake.',
        timestamp: now,
      },
    ],
    projectMetadataSummary: buildBootstrapMetadataSummary(intake),
    contextPackets: [],
    runs: [],
  };
}

function buildBootstrapIdeationSummary(board: BootstrapIdeationBoardRecord): string {
  return [
    '# AtlasMind Ideation Board',
    '',
    `Updated: ${board.updatedAt}`,
    '',
    '## Seeded Context',
    board.projectMetadataSummary || 'No explicit project metadata captured yet.',
    '',
    '## Cards',
    ...board.cards.map(card => `- **${card.title}** [${card.kind}]\n  ${card.body}`),
    '',
    '## Suggested Next Prompts',
    ...board.nextPrompts.map(prompt => `- ${prompt}`),
  ].join('\n');
}

function buildBootstrapProjectIntakeIssueTemplate(intake: BootstrapProjectIntake): string {
  const title = clampBootstrapText(intake.projectName || intake.productSummary || 'Project intake', 80);
  return [
    'name: Project intake',
    'description: Capture the project brief, constraints, and delivery posture seeded by AtlasMind bootstrap.',
    `title: "[Initiative]: ${escapeYamlString(title)}"`,
    'labels:',
    '  - type:initiative',
    '  - triage',
    'body:',
    '  - type: textarea',
    '    id: summary',
    '    attributes:',
    '      label: Summary',
    '      description: What is being built?',
    `      value: "${escapeYamlString(intake.productSummary ?? '')}"`,
    '    validations:',
    '      required: false',
    '  - type: textarea',
    '    id: audience',
    '    attributes:',
    '      label: Target audience',
    `      value: "${escapeYamlString(intake.targetAudience ?? '')}"`,
    '  - type: textarea',
    '    id: constraints',
    '    attributes:',
    '      label: Delivery constraints',
    `      value: "${escapeYamlString(buildBootstrapConstraintSummary(intake))}"`,
    '  - type: textarea',
    '    id: stack',
    '    attributes:',
    '      label: Technical direction',
    `      value: "${escapeYamlString(buildBootstrapTechnicalSummary(intake))}"`,
  ].join('\n');
}

function buildBootstrapProjectPlanningCsv(intake: BootstrapProjectIntake): string {
  const rows = [
    ['Title', 'Body', 'Labels', 'Milestone', 'Status'],
    [
      intake.projectName || 'Confirm project brief',
      intake.productSummary || 'Refine the product summary and confirm the intended outcome.',
      'type:initiative,triage',
      intake.timeline || 'Bootstrap',
      'Todo',
    ],
    [
      'Validate target audience',
      intake.targetAudience || 'Define the primary audience, their jobs, and success criteria.',
      'type:discovery,user-research',
      intake.timeline || 'Bootstrap',
      'Todo',
    ],
    [
      'Lock technical direction',
      buildBootstrapTechnicalSummary(intake) || 'Confirm the initial stack, integrations, and architecture boundaries.',
      'type:engineering,architecture',
      intake.timeline || 'Bootstrap',
      'Todo',
    ],
    [
      'Define first execution slice',
      intake.productOutcome || 'Turn the brief into a first shippable milestone with acceptance criteria.',
      'type:delivery,planning',
      intake.timeline || 'Bootstrap',
      'Todo',
    ],
  ];

  return rows.map(columns => columns.map(escapeCsvCell).join(',')).join('\n');
}

function buildBootstrapSnapshotBlock(intake: BootstrapProjectIntake): string {
  return [
    `- Product summary: ${intake.productSummary ?? 'Unspecified'}`,
    `- Primary outcome: ${intake.productOutcome ?? 'Unspecified'}`,
    `- Audience: ${intake.targetAudience ?? 'Unspecified'}`,
    `- Builders: ${intake.builderProfile ?? 'Unspecified'}`,
    `- Timeline: ${intake.timeline ?? 'Unspecified'}`,
    `- Budget: ${intake.projectBudget ?? 'Unspecified'}`,
    `- Online repo: ${describeBootstrapOnlineRepoState(intake.onlineRepoState)}`,
    `- Repo target: ${formatBootstrapRepoTarget(intake) ?? 'Unspecified'}`,
    `- Stack: ${intake.techStack ?? 'Unspecified'}`,
    `- Third-party tools: ${intake.thirdPartyTools ?? 'Unspecified'}`,
    `- Atlas routing: budget ${intake.atlasBudgetMode ?? 'Unspecified'}, speed ${intake.atlasSpeedMode ?? 'Unspecified'}`,
  ].join('\n');
}

function buildBootstrapMetadataSummary(intake: BootstrapProjectIntake): string {
  return [
    intake.projectName ? `Project: ${intake.projectName}` : '',
    intake.projectType ? `Type: ${intake.projectType}` : '',
    intake.productSummary ? `Summary: ${intake.productSummary}` : '',
    intake.productOutcome ? `Outcome: ${intake.productOutcome}` : '',
    intake.targetAudience ? `Audience: ${intake.targetAudience}` : '',
    intake.builderProfile ? `Builders: ${intake.builderProfile}` : '',
    intake.timeline ? `Timeline: ${intake.timeline}` : '',
    intake.projectBudget ? `Budget: ${intake.projectBudget}` : '',
    intake.onlineRepoState ? `Online repo: ${describeBootstrapOnlineRepoState(intake.onlineRepoState)}` : '',
    formatBootstrapRepoTarget(intake) ? `Repo target: ${formatBootstrapRepoTarget(intake)}` : '',
    intake.techStack ? `Stack: ${intake.techStack}` : '',
    intake.thirdPartyTools ? `Tools: ${intake.thirdPartyTools}` : '',
  ].filter(Boolean).join('\n');
}

function buildBootstrapConstraintSummary(intake: BootstrapProjectIntake): string {
  return [
    intake.builderProfile ? `Builders: ${intake.builderProfile}` : '',
    intake.timeline ? `Timeline: ${intake.timeline}` : '',
    intake.projectBudget ? `Budget: ${intake.projectBudget}` : '',
    intake.onlineRepoState ? `Online repo: ${describeBootstrapOnlineRepoState(intake.onlineRepoState)}` : '',
    formatBootstrapRepoTarget(intake) ? `Repo target: ${formatBootstrapRepoTarget(intake)}` : '',
    intake.atlasBudgetMode ? `Atlas budget mode: ${intake.atlasBudgetMode}` : '',
    intake.atlasSpeedMode ? `Atlas speed mode: ${intake.atlasSpeedMode}` : '',
  ].filter(Boolean).join(' | ');
}

function buildBootstrapTechnicalSummary(intake: BootstrapProjectIntake): string {
  return [
    intake.projectType ? `Project type: ${intake.projectType}` : '',
    intake.techStack ? `Stack: ${intake.techStack}` : '',
    intake.thirdPartyTools ? `Third-party tools: ${intake.thirdPartyTools}` : '',
    intake.onlineRepoState ? `Online repo: ${describeBootstrapOnlineRepoState(intake.onlineRepoState)}` : '',
    formatBootstrapRepoTarget(intake) ? `Repo target: ${formatBootstrapRepoTarget(intake)}` : '',
    intake.repoHost ? `Delivery platform: ${intake.repoHost}` : '',
  ].filter(Boolean).join(' | ');
}

function describeBootstrapOnlineRepoState(state: BootstrapOnlineRepoState | undefined): string {
  switch (state) {
    case 'existing':
      return 'Existing online repo';
    case 'planned':
      return 'Needs a new online repo';
    case 'none':
      return 'Local only for now';
    default:
      return 'Skipped';
  }
}

function formatBootstrapRepoTarget(intake: BootstrapProjectIntake): string | undefined {
  if (intake.repoLocation?.trim()) {
    return `${intake.repoHost ?? 'chosen host'} (${intake.repoLocation.trim()})`;
  }
  return intake.repoHost;
}

async function askOptionalText(title: string, prompt: string, placeHolder: string): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title,
    prompt,
    placeHolder,
    ignoreFocusOut: true,
  });
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

async function askOptionalQuickPick(options: string[], placeHolder: string): Promise<string | undefined> {
  const selection = await vscode.window.showQuickPick([...options, 'Skip'], {
    placeHolder,
    ignoreFocusOut: true,
  });
  if (!selection || selection === 'Skip') {
    return undefined;
  }
  return selection;
}

function mapAtlasBudgetMode(selection: string | undefined): BudgetMode | undefined {
  switch (selection) {
    case 'Lean / keep Atlas costs low':
      return 'cheap';
    case 'Balanced':
      return 'balanced';
    case 'Premium / depth first':
      return 'expensive';
    case 'Auto':
      return 'auto';
    default:
      return undefined;
  }
}

function mapAtlasSpeedMode(selection: string | undefined): SpeedMode | undefined {
  switch (selection) {
    case 'Fast feedback':
      return 'fast';
    case 'Balanced':
      return 'balanced';
    case 'Considered / deeper reasoning':
      return 'considered';
    case 'Auto':
      return 'auto';
    default:
      return undefined;
  }
}

function mapOnlineRepoState(selection: string | undefined): BootstrapOnlineRepoState | undefined {
  switch (selection) {
    case 'Already has an online repo':
      return 'existing';
    case 'Needs a new online repo':
      return 'planned';
    case 'Keep it local only for now':
      return 'none';
    default:
      return undefined;
  }
}

function mapRepoHost(selection: string | undefined): BootstrapProjectIntake['repoHost'] {
  switch (selection) {
    case 'GitHub':
      return 'github';
    case 'Azure DevOps':
      return 'azure-devops';
    case 'GitLab':
      return 'gitlab';
    case 'Other / unknown':
      return 'other';
    default:
      return undefined;
  }
}

function mapBooleanQuickPick(selection: string | undefined): boolean | undefined {
  switch (selection) {
    case 'Yes':
      return true;
    case 'No':
      return false;
    default:
      return undefined;
  }
}

function mapDependencyMonitoringProviders(selection: readonly string[] | undefined): string[] | undefined {
  if (!selection || selection.length === 0 || selection.includes('Skip / use workspace defaults')) {
    return undefined;
  }

  return selection.map(value => {
    switch (value) {
      case 'Dependabot':
        return 'dependabot';
      case 'Renovate':
        return 'renovate';
      case 'Snyk':
        return 'snyk';
      case 'Azure DevOps pipeline':
        return 'azure-devops';
      default:
        return value.toLowerCase();
    }
  });
}

function mapDependencyMonitoringSchedule(selection: string | undefined): DependencyMonitoringSchedule | undefined {
  switch (selection) {
    case 'Daily':
      return 'daily';
    case 'Weekly':
      return 'weekly';
    case 'Monthly':
      return 'monthly';
    default:
      return undefined;
  }
}

function upsertMarkdownSection(existing: string, heading: string, content: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^## ${escapedHeading}\\n)([\\s\\S]*?)(?=^## |\\Z)`, 'm');
  const replacement = `$1${content.trim()}\n\n`;
  if (pattern.test(existing)) {
    return existing.replace(pattern, replacement).trimEnd() + '\n';
  }
  const suffix = existing.trimEnd();
  return `${suffix}\n\n## ${heading}\n${content.trim()}\n`;
}

async function readUtf8IfExists(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
  } catch {
    return undefined;
  }
}

function clampBootstrapText(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function createBootstrapIdeationId(prefix: 'card' | 'link'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r?\n/g, ' ').trim();
  return `"${normalized.replace(/"/g, '""')}"`;
}

function escapeYamlString(value: string): string {
  return value.replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

function reportBootstrapProgress(reporter: BootstrapPromptReporter, markdown: string): void {
  reporter?.markdown(markdown);
}

async function hasExistingContent(uri: vscode.Uri): Promise<boolean> {
  try {
    const children = await vscode.workspace.fs.readDirectory(uri);
    return children.length > 0;
  } catch {
    return false;
  }
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export function getValidatedSsotPath(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0 || /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    return undefined;
  }

  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
    return undefined;
  }

  return segments.join('/');
}

function getStarterContent(filename: string): string {
  switch (filename) {
    case 'project_soul.md':
      return [
        '# Project Soul',
        '',
        '> This file is the living identity of the project.',
        '',
        '## Project Type',
        '{{PROJECT_TYPE}}',
        '',
        '## Vision',
        '<!-- Describe the high-level goal of this project -->',
        '',
        '## Principles',
        '- ',
        '',
        '## Key Decisions',
        '<!-- Link to decisions/ folder entries -->',
        '',
      ].join('\n');
    default:
      return `# ${filename}\n`;
  }
}

async function scaffoldGovernanceBaseline(
  workspaceRoot: vscode.Uri,
  ssotRoot: vscode.Uri,
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>,
  intake?: BootstrapProjectIntake,
): Promise<void> {
  const projectLabel = intake?.projectName?.trim() || intake?.productSummary?.trim() || 'this project';
  const audienceLabel = intake?.targetAudience?.trim() || 'the intended users';
  const stackLabel = intake?.techStack?.trim() || 'the agreed technical stack';
  const constraintLabel = buildBootstrapConstraintSummary(intake ?? { mode: 'minimal', captureNotes: [] }).trim() || 'No explicit constraints captured during bootstrap.';
  const files: Array<{ path: string; content: string }> = [
    {
      path: '.github/workflows/ci.yml',
      content: [
        'name: CI',
        '',
        'on:',
        '  push:',
        '    branches: [master]',
        '  pull_request:',
        '    branches: [master]',
        '',
        'jobs:',
        '  quality:',
        '    runs-on: ubuntu-latest',
        '',
        '    steps:',
        '      - name: Checkout',
        '        uses: actions/checkout@v4',
        '',
        '      - name: Setup Node',
        '        uses: actions/setup-node@v4',
        '        with:',
        '          node-version: 20',
        '          cache: npm',
        '',
        '      - name: Install dependencies',
        '        run: npm ci',
        '',
        '      - name: Compile',
        '        run: npm run compile',
        '',
        '      - name: Lint',
        '        run: npm run lint',
        '',
        '      - name: Test',
        '        run: npm run test',
      ].join('\n'),
    },
    {
      path: '.github/pull_request_template.md',
      content: [
        '## Summary',
        '- What changed?',
        '- Why?',
        intake?.productOutcome ? `- Which project outcome does this move forward? ${intake.productOutcome}` : '- Which project outcome does this move forward?',
        '',
        '## Linked Issue',
        '- Closes #<issue-number>',
        '',
        '## Project Context',
        `- Initiative: ${projectLabel}`,
        `- Audience: ${audienceLabel}`,
        `- Constraints: ${constraintLabel}`,
        '',
        '## Quality Checklist',
        '- [ ] Tests added/updated',
        '- [ ] Lint passes',
        '- [ ] Compile passes',
        '- [ ] Documentation updated',
      ].join('\n'),
    },
    {
      path: '.github/CODEOWNERS',
      content: [
        '* @your-org/maintainers',
      ].join('\n'),
    },
    {
      path: '.github/ISSUE_TEMPLATE/bug_report.md',
      content: [
        '---',
        'name: Bug report',
        'about: Report a defect',
        'title: "[Bug]: "',
        'labels: ["type:bug", "triage"]',
        'assignees: []',
        '---',
        '',
        '## Description',
        '',
        '## Impacted audience',
        audienceLabel,
        '',
        '## Steps to Reproduce',
        '1.',
        '2.',
        '3.',
        '',
        '## Expected Behavior',
        '',
        '## Actual Behavior',
      ].join('\n'),
    },
    {
      path: '.github/ISSUE_TEMPLATE/feature_request.md',
      content: [
        '---',
        'name: Feature request',
        'about: Suggest an improvement',
        'title: "[Feature]: "',
        'labels: ["type:feature", "triage"]',
        'assignees: []',
        '---',
        '',
        '## Problem',
        intake?.productSummary ?? '',
        '',
        '## Proposed Solution',
        '',
        '## Fit With Project Constraints',
        constraintLabel,
        '',
        '## Acceptance Criteria',
        '- [ ]',
      ].join('\n'),
    },
    {
      path: '.github/ISSUE_TEMPLATE/config.yml',
      content: [
        'blank_issues_enabled: false',
      ].join('\n'),
    },
    {
      path: '.vscode/extensions.json',
      content: [
        '{',
        '  "recommendations": [',
        '    "github.copilot-chat",',
        '    "dbaeumer.vscode-eslint",',
        '    "github.vscode-pull-request-github",',
        '    "eamodio.gitlens",',
        '    "editorconfig.editorconfig",',
        '    "redhat.vscode-yaml"',
        '  ]',
        '}',
      ].join('\n'),
    },
    {
      path: '.github/project-planning/README.md',
      content: [
        '# AtlasMind Project Planning Seed',
        '',
        `This folder contains intake-aware planning artifacts for ${projectLabel}.`,
        '',
        '## Intended use',
        '- Import `atlasmind-project-items.csv` into GitHub Projects or another planning tool.',
        '- Keep issue templates aligned with the SSOT brief and ideation board.',
        '',
        '## Bootstrap context',
        `- Audience: ${audienceLabel}`,
        `- Stack: ${stackLabel}`,
        `- Constraints: ${constraintLabel}`,
      ].join('\n'),
    },
  ];

  const dependencyMonitoringEnabled = configuration.get<boolean>('projectDependencyMonitoringEnabled', true);
  const dependencyMonitoringProviders = getDependencyMonitoringProviders(
    configuration.get<string[]>('projectDependencyMonitoringProviders', ['dependabot']),
  );
  const dependencyMonitoringSchedule = getDependencyMonitoringSchedule(
    configuration.get<string>('projectDependencyMonitoringSchedule', 'weekly'),
  );
  const dependencyMonitoringIssueTemplate = configuration.get<boolean>('projectDependencyMonitoringIssueTemplate', true);

  if (dependencyMonitoringEnabled) {
    files.push(...buildDependencyMonitoringFiles({
      providers: dependencyMonitoringProviders,
      schedule: dependencyMonitoringSchedule,
      includeIssueTemplate: dependencyMonitoringIssueTemplate,
    }));
  }

  for (const file of files) {
    const fileUri = vscode.Uri.joinPath(workspaceRoot, ...file.path.split('/'));
    await ensureParentDirectory(fileUri, workspaceRoot);
    if (!(await pathExists(fileUri))) {
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(file.content, 'utf-8'));
    }
  }

  if (dependencyMonitoringEnabled) {
    await scaffoldDependencyMonitoringMemory(ssotRoot, {
      providers: dependencyMonitoringProviders,
      schedule: dependencyMonitoringSchedule,
      includeIssueTemplate: dependencyMonitoringIssueTemplate,
    });
  }
}

function getDependencyMonitoringProviders(value: string[] | undefined): DependencyMonitoringProvider[] {
  return (value ?? []).filter(candidate =>
    candidate === 'dependabot'
    || candidate === 'renovate'
    || candidate === 'snyk'
    || candidate === 'azure-devops') as DependencyMonitoringProvider[];
}

function getDependencyMonitoringSchedule(value: string | undefined): DependencyMonitoringSchedule {
  switch (value) {
    case 'daily':
    case 'monthly':
      return value;
    default:
      return 'weekly';
  }
}

function buildDependencyMonitoringFiles(options: {
  providers: DependencyMonitoringProvider[];
  schedule: DependencyMonitoringSchedule;
  includeIssueTemplate: boolean;
}): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

  if (options.providers.includes('dependabot')) {
    files.push({
      path: '.github/dependabot.yml',
      content: [
        'version: 2',
        'updates:',
        '  - package-ecosystem: npm',
        '    directory: "/"',
        '    schedule:',
        `      interval: ${options.schedule}`,
        '    open-pull-requests-limit: 5',
        '    labels:',
        '      - dependencies',
        '    commit-message:',
        '      prefix: chore',
        '      include: scope',
        '',
        '  - package-ecosystem: github-actions',
        '    directory: "/"',
        '    schedule:',
        `      interval: ${options.schedule}`,
        '    open-pull-requests-limit: 3',
        '    labels:',
        '      - dependencies',
        '    commit-message:',
        '      prefix: chore',
        '      include: scope',
      ].join('\n'),
    });
  }

  if (options.providers.includes('renovate')) {
    files.push({
      path: 'renovate.json',
      content: JSON.stringify({
        $schema: 'https://docs.renovatebot.com/renovate-schema.json',
        extends: ['config:base'],
        labels: ['dependencies'],
        dependencyDashboard: true,
        schedule: getRenovateSchedule(options.schedule),
        packageRules: [
          {
            matchUpdateTypes: ['major'],
            dependencyDashboardApproval: true,
          },
        ],
      }, null, 2),
    });
  }

  if (options.providers.includes('snyk')) {
    files.push({
      path: '.github/workflows/snyk-monitor.yml',
      content: [
        'name: Snyk Dependency Monitor',
        '',
        'on:',
        '  workflow_dispatch:',
        '  schedule:',
        `    - cron: '${getScheduledCron(options.schedule)}'`,
        '',
        'permissions:',
        '  contents: read',
        '',
        'jobs:',
        '  snyk:',
        '    runs-on: ubuntu-latest',
        '    if: ${{ secrets.SNYK_TOKEN != "" }}',
        '    steps:',
        '      - name: Checkout',
        '        uses: actions/checkout@v4',
        '',
        '      - name: Setup Node',
        '        uses: actions/setup-node@v4',
        '        with:',
        '          node-version: 20',
        '          cache: npm',
        '',
        '      - name: Install dependencies',
        '        run: npm ci',
        '',
        '      - name: Run Snyk monitor',
        '        run: npx snyk monitor --all-projects',
        '        env:',
        '          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}',
        '',
        '      - name: Run Snyk high-severity test',
        '        run: npx snyk test --all-projects --severity-threshold=high',
        '        env:',
        '          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}',
      ].join('\n'),
    });
  }

  if (options.providers.includes('azure-devops')) {
    files.push({
      path: 'azure-pipelines.dependency-monitor.yml',
      content: [
        'trigger: none',
        'pr: none',
        '',
        'schedules:',
        `- cron: "${getScheduledCron(options.schedule)}"`,
        '  displayName: Dependency monitor',
        '  branches:',
        '    include:',
        '    - develop',
        '  always: true',
        '',
        'pool:',
        '  vmImage: ubuntu-latest',
        '',
        'steps:',
        '- task: NodeTool@0',
        '  inputs:',
        '    versionSpec: "20.x"',
        '  displayName: Use Node.js 20',
        '',
        '- script: npm ci',
        '  displayName: Install dependencies',
        '',
        '- script: |',
        '    npm outdated --json > dependency-outdated.json',
        '    exit 0',
        '  displayName: Capture dependency drift',
        '',
        '- task: PublishPipelineArtifact@1',
        '  inputs:',
        '    targetPath: dependency-outdated.json',
        '    artifact: dependency-monitor-report',
        '  displayName: Publish dependency report',
      ].join('\n'),
    });
  }

  if (options.includeIssueTemplate) {
    files.push({
      path: '.github/ISSUE_TEMPLATE/dependency_review.md',
      content: [
        '---',
        'name: Dependency review',
        'about: Track dependency drift review, exceptions, and follow-up tasks',
        'title: "[Dependencies]: review pending update"',
        'labels: ["type:chore", "dependencies", "triage"]',
        'assignees: []',
        '---',
        '',
        '## Source',
        '- Automation provider:',
        '- Ecosystem:',
        '- Update type:',
        '',
        '## Risk assessment',
        '- [ ] Breaking change review completed',
        '- [ ] Security impact reviewed',
        '- [ ] Release notes linked',
        '',
        '## Decision',
        '- [ ] Approve update now',
        '- [ ] Defer with documented exception',
        '- [ ] Reject and replace dependency/service',
        '',
        '## Follow-up',
        '- SSOT entry updated:',
        '- Test plan:',
      ].join('\n'),
    });
  }

  return files;
}

function getRenovateSchedule(schedule: DependencyMonitoringSchedule): string[] {
  switch (schedule) {
    case 'daily':
      return ['at any time'];
    case 'monthly':
      return ['before 6am on the first day of the month'];
    default:
      return ['before 6am on monday'];
  }
}

function getScheduledCron(schedule: DependencyMonitoringSchedule): string {
  switch (schedule) {
    case 'daily':
      return '0 6 * * *';
    case 'monthly':
      return '0 6 1 * *';
    default:
      return '0 6 * * 1';
  }
}

async function scaffoldDependencyMonitoringMemory(
  ssotRoot: vscode.Uri,
  options: {
    providers: DependencyMonitoringProvider[];
    schedule: DependencyMonitoringSchedule;
    includeIssueTemplate: boolean;
  },
): Promise<void> {
  const providersLabel = options.providers.length > 0 ? options.providers.join(', ') : 'manual review only';
  const docs: Array<{ path: string; content: string }> = [
    {
      path: 'operations/dependency-monitoring.md',
      content: [
        '# Dependency Monitoring',
        '',
        '## Current Policy',
        `- Enabled providers: ${providersLabel}`,
        `- Review cadence: ${options.schedule}`,
        `- Review issue template scaffolded: ${options.includeIssueTemplate ? 'yes' : 'no'}`,
        '',
        '## Review Workflow',
        '1. Let the configured automation provider open or suggest dependency updates.',
        '2. Review changelogs, migration notes, and security advisories before merging.',
        '3. Record exceptions, deferred updates, or approved changes in `decisions/dependency-policy.md` or a new ADR.',
        '4. Capture incidents or regressions caused by updates in `misadventures/` so future upgrades can learn from them.',
        '',
        '## Supported Automation',
        '- Dependabot: GitHub-native dependency and GitHub Actions update PRs.',
        '- Renovate: broader ecosystem coverage and finer grouping policy controls.',
        '- Snyk: scheduled GitHub workflow for dependency monitoring and high-severity testing.',
        '- Azure DevOps: scheduled pipeline scaffold that captures dependency drift as a build artifact.',
        '- Additional enterprise services can be added later through repository-specific configuration.',
      ].join('\n'),
    },
    {
      path: 'decisions/dependency-policy.md',
      content: [
        '# Dependency Policy',
        '',
        '## Baseline Decision',
        `AtlasMind scaffolding enabled the following dependency-monitoring providers: ${providersLabel}.`,
        '',
        '## Approval Rules',
        '- Major updates require a human review of release notes and compatibility impact.',
        '- Security updates should be triaged immediately, even when functional upgrades are deferred.',
        '- Provider or service changes that alter authentication, CI behavior, or generated files must be documented before rollout.',
        '',
        '## Exceptions',
        '- Document deferred updates here with the reason, owner, and next review date.',
      ].join('\n'),
    },
  ];

  for (const doc of docs) {
    const fileUri = vscode.Uri.joinPath(ssotRoot, ...doc.path.split('/'));
    await ensureParentDirectory(fileUri, ssotRoot);
    if (!(await pathExists(fileUri))) {
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(doc.content, 'utf-8'));
    }
  }
}

async function ensureParentDirectory(targetFile: vscode.Uri, workspaceRoot: vscode.Uri): Promise<void> {
  const relative = targetFile.path.replace(workspaceRoot.path, '').replace(/^\//, '');
  const parts = relative.split('/');
  if (parts.length <= 1) {
    return;
  }

  let current = workspaceRoot;
  for (const segment of parts.slice(0, -1)) {
    current = vscode.Uri.joinPath(current, segment);
    await vscode.workspace.fs.createDirectory(current);
  }
}

// ── Project Import ──────────────────────────────────────────

type ImportScanCategory =
  | 'manifest'
  | 'readme'
  | 'config'
  | 'license'
  | 'architecture-doc'
  | 'routing-doc'
  | 'agents-doc'
  | 'development-doc'
  | 'configuration-doc'
  | 'workflow-doc'
  | 'security-doc'
  | 'governance-doc'
  | 'changelog';

/** Well-known project files to scan during import, grouped by purpose. */
const IMPORT_SCAN_FILES: ReadonlyArray<{ path: string; category: ImportScanCategory }> = [
  { path: 'package.json', category: 'manifest' },
  { path: 'Cargo.toml', category: 'manifest' },
  { path: 'pyproject.toml', category: 'manifest' },
  { path: 'go.mod', category: 'manifest' },
  { path: 'pom.xml', category: 'manifest' },
  { path: 'build.gradle', category: 'manifest' },
  { path: 'Gemfile', category: 'manifest' },
  { path: 'composer.json', category: 'manifest' },
  { path: 'README.md', category: 'readme' },
  { path: 'README.rst', category: 'readme' },
  { path: 'README.txt', category: 'readme' },
  { path: 'readme.md', category: 'readme' },
  { path: 'tsconfig.json', category: 'config' },
  { path: '.eslintrc.json', category: 'config' },
  { path: '.eslintrc.js', category: 'config' },
  { path: 'eslint.config.js', category: 'config' },
  { path: '.prettierrc', category: 'config' },
  { path: '.editorconfig', category: 'config' },
  { path: '.gitignore', category: 'config' },
  { path: 'Dockerfile', category: 'config' },
  { path: 'docker-compose.yml', category: 'config' },
  { path: 'Makefile', category: 'config' },
  { path: 'LICENSE', category: 'license' },
  { path: 'LICENSE.md', category: 'license' },
  { path: 'LICENSE.txt', category: 'license' },
  { path: 'docs/architecture.md', category: 'architecture-doc' },
  { path: 'docs/model-routing.md', category: 'routing-doc' },
  { path: 'docs/agents-and-skills.md', category: 'agents-doc' },
  { path: 'docs/development.md', category: 'development-doc' },
  { path: 'docs/configuration.md', category: 'configuration-doc' },
  { path: 'docs/github-workflow.md', category: 'workflow-doc' },
  { path: 'SECURITY.md', category: 'security-doc' },
  { path: '.github/copilot-instructions.md', category: 'governance-doc' },
  { path: 'CHANGELOG.md', category: 'changelog' },
];

import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_SNIPPET } from '../constants.js';

export interface ImportResult {
  entriesCreated: number;
  entriesSkipped: number;
  projectType: string | undefined;
}

export interface ProjectMemoryFreshnessStatus {
  hasImportedEntries: boolean;
  isStale: boolean;
  staleEntryCount: number;
  staleEntries: string[];
  lastImportedAt?: string;
}

interface ScannedImportFile {
  path: string;
  content: string;
  category: ImportScanCategory;
}

interface ImportEntryCandidate {
  entry: MemoryEntry;
  content: string;
  sourcePaths: string[];
  sourceFingerprint: string;
}

interface ImportEntryProcessingResult {
  path: string;
  title: string;
  status: 'created' | 'refreshed' | 'unchanged' | 'preserved-manual-edits' | 'rejected';
  sourcePaths: string[];
  sourceFingerprint: string;
  reason?: string;
}

interface ImportEntryMetadata {
  entryPath: string;
  generatorVersion: number;
  generatedAt: string;
  sourcePaths: string[];
  sourceFingerprint: string;
  bodyFingerprint: string;
}

interface ImportBuildSnapshot {
  now: string;
  ssotRoot: vscode.Uri;
  scanned: Map<string, ScannedImportFile>;
  projectType: string | undefined;
  entries: ImportEntryCandidate[];
  readme: { path: string; content: string } | undefined;
  architectureDoc: { path: string; content: string } | undefined;
}

const IMPORT_GENERATOR_VERSION = 2;

/**
 * Import an existing project into AtlasMind by scanning workspace files
 * and populating the SSOT memory with project metadata, architecture,
 * dependencies, and conventions.
 */
export async function importProject(
  workspaceRoot: vscode.Uri,
  atlas: AtlasMindContext,
): Promise<ImportResult> {
  const snapshot = await buildImportSnapshot(workspaceRoot);
  if (!snapshot) {
    vscode.window.showErrorMessage('AtlasMind SSOT path must be a safe relative path inside the workspace.');
    return { entriesCreated: 0, entriesSkipped: 0, projectType: undefined };
  }

  const { now, ssotRoot, scanned, projectType, entries, readme, architectureDoc } = snapshot;

  // 5. Project soul (upgrade starter template when it is still blank)
  const soulUri = vscode.Uri.joinPath(ssotRoot, 'project_soul.md');
  try {
    const existing = Buffer.from(await vscode.workspace.fs.readFile(soulUri)).toString('utf-8');
    if (shouldRefreshProjectSoul(existing)) {
      const updated = buildProjectSoul(existing, {
        projectType,
        readme: readme?.content,
        architectureDoc: architectureDoc?.content,
        governanceDoc: scanned.get('.github/copilot-instructions.md')?.content,
      });
      await vscode.workspace.fs.writeFile(soulUri, Buffer.from(updated, 'utf-8'));
    } else if (existing.includes('{{PROJECT_TYPE}}') && projectType) {
      const updated = existing.replace('{{PROJECT_TYPE}}', projectType);
      await vscode.workspace.fs.writeFile(soulUri, Buffer.from(updated, 'utf-8'));
    }
  } catch {
    // Non-fatal
  }

  // ── Upsert entries into memory ──────────────────────────────
  let created = 0;
  let skipped = 0;
  const processedEntries: ImportEntryProcessingResult[] = [];

  for (const candidate of entries) {
    const metadata: ImportEntryMetadata = {
      entryPath: candidate.entry.path,
      generatorVersion: IMPORT_GENERATOR_VERSION,
      generatedAt: now,
      sourcePaths: candidate.sourcePaths,
      sourceFingerprint: candidate.sourceFingerprint,
      bodyFingerprint: getImportBodyFingerprint(candidate.content),
    };
    const wrappedContent = appendImportMetadata(candidate.content, metadata);
    const targetUri = vscode.Uri.joinPath(ssotRoot, candidate.entry.path);
    const existingContent = await tryReadTextFile(targetUri);
    const existingMetadata = parseImportMetadata(existingContent);
    if (existingMetadata) {
      const existingBody = stripImportMetadata(existingContent ?? '');
      if (getImportBodyFingerprint(existingBody) !== existingMetadata.bodyFingerprint) {
        skipped++;
        processedEntries.push({
          path: candidate.entry.path,
          title: candidate.entry.title,
          status: 'preserved-manual-edits',
          sourcePaths: candidate.sourcePaths,
          sourceFingerprint: candidate.sourceFingerprint,
          reason: 'Existing imported file has local edits; AtlasMind preserved it.',
        });
        continue;
      }
      if (
        existingMetadata.generatorVersion === metadata.generatorVersion
        && existingMetadata.sourceFingerprint === metadata.sourceFingerprint
      ) {
        skipped++;
        processedEntries.push({
          path: candidate.entry.path,
          title: candidate.entry.title,
          status: 'unchanged',
          sourcePaths: candidate.sourcePaths,
          sourceFingerprint: candidate.sourceFingerprint,
        });
        continue;
      }
    }

    const result = atlas.memoryManager.upsert(candidate.entry, wrappedContent);
    if (result.status === 'created' || result.status === 'updated') {
      created++;
      processedEntries.push({
        path: candidate.entry.path,
        title: candidate.entry.title,
        status: existingContent ? 'refreshed' : 'created',
        sourcePaths: candidate.sourcePaths,
        sourceFingerprint: candidate.sourceFingerprint,
      });
    } else {
      skipped++;
      processedEntries.push({
        path: candidate.entry.path,
        title: candidate.entry.title,
        status: 'rejected',
        sourcePaths: candidate.sourcePaths,
        sourceFingerprint: candidate.sourceFingerprint,
        reason: result.reason,
      });
    }
  }

  const supplementalEntries: ImportEntryCandidate[] = [];
  const reportFingerprint = hashImportValue(processedEntries.map(item => `${item.path}:${item.status}:${item.sourceFingerprint}`));
  const importCatalog = buildImportCatalog(processedEntries);
  if (importCatalog) {
    supplementalEntries.push({
      entry: {
        path: 'index/import-catalog.md',
        title: 'Import Catalog',
        tags: ['import', 'index', 'catalog'],
        lastModified: now,
        snippet: truncate(importCatalog, MAX_IMPORT_SNIPPET),
        sourcePaths: processedEntries.map(item => item.path),
        sourceFingerprint: reportFingerprint,
        bodyFingerprint: getImportBodyFingerprint(importCatalog),
        documentClass: 'index',
        evidenceType: 'generated-index',
      },
      content: importCatalog,
      sourcePaths: processedEntries.map(item => item.path),
      sourceFingerprint: reportFingerprint,
    });
  }

  const freshnessReport = buildImportFreshnessReport(processedEntries);
  if (freshnessReport) {
    supplementalEntries.push({
      entry: {
        path: 'index/import-freshness.md',
        title: 'Import Freshness Report',
        tags: ['import', 'index', 'freshness'],
        lastModified: now,
        snippet: truncate(freshnessReport, MAX_IMPORT_SNIPPET),
        sourcePaths: processedEntries.map(item => item.path),
        sourceFingerprint: reportFingerprint,
        bodyFingerprint: getImportBodyFingerprint(freshnessReport),
        documentClass: 'index',
        evidenceType: 'generated-index',
      },
      content: freshnessReport,
      sourcePaths: processedEntries.map(item => item.path),
      sourceFingerprint: reportFingerprint,
    });
  }

  for (const candidate of supplementalEntries) {
    const metadata: ImportEntryMetadata = {
      entryPath: candidate.entry.path,
      generatorVersion: IMPORT_GENERATOR_VERSION,
      generatedAt: now,
      sourcePaths: candidate.sourcePaths,
      sourceFingerprint: candidate.sourceFingerprint,
      bodyFingerprint: getImportBodyFingerprint(candidate.content),
    };
    const wrappedContent = appendImportMetadata(candidate.content, metadata);
    const targetUri = vscode.Uri.joinPath(ssotRoot, candidate.entry.path);
    const existingContent = await tryReadTextFile(targetUri);
    const existingMetadata = parseImportMetadata(existingContent);
    if (
      existingMetadata
      && existingMetadata.generatorVersion === metadata.generatorVersion
      && existingMetadata.sourceFingerprint === metadata.sourceFingerprint
      && getImportBodyFingerprint(stripImportMetadata(existingContent ?? '')) === existingMetadata.bodyFingerprint
    ) {
      skipped++;
      continue;
    }

    const result = atlas.memoryManager.upsert(candidate.entry, wrappedContent);
    if (result.status === 'created' || result.status === 'updated') {
      created++;
    } else {
      skipped++;
    }
  }

  // ── Agent instruction stubs ───────────────────────────────────────────────
  // Generate a stub in agents/ for each registered agent that does not yet have
  // one. Manually-created docs (no import metadata footer) are never overwritten.
  // Updated stubs are rewritten only when the agent definition fingerprint changes.
  const registeredAgents = typeof atlas.agentRegistry?.listAgents === 'function'
    ? atlas.agentRegistry.listAgents()
    : [];
  for (const agent of registeredAgents) {
    const safeId = agent.id
      .replace(/[^a-z0-9_-]/gi, '-')
      .toLowerCase()
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '');
    const agentEntryPath = `agents/${safeId}.md`;
    const agentSourceFingerprint = hashImportValue([
      agent.id, agent.name, agent.role, agent.description,
      agent.systemPrompt, (agent.skills ?? []).join(','),
      String(agent.costLimitUsd ?? ''), (agent.allowedModels ?? []).join(','),
    ]);
    const agentTargetUri = vscode.Uri.joinPath(ssotRoot, agentEntryPath);
    const existingAgentContent = await tryReadTextFile(agentTargetUri);
    const existingAgentMeta = parseImportMetadata(existingAgentContent);

    if (existingAgentContent !== undefined && !existingAgentMeta) {
      // Manually-created file — preserve it
      skipped++;
      continue;
    }
    if (existingAgentMeta?.sourceFingerprint === agentSourceFingerprint) {
      // Agent definition unchanged
      skipped++;
      continue;
    }

    const skillList = agent.skills.length > 0 ? agent.skills.join(', ') : 'none';
    const modelList = agent.allowedModels && agent.allowedModels.length > 0
      ? agent.allowedModels.join(', ')
      : 'any';
    const promptPreview = truncate(agent.systemPrompt, 1_200);
    const configLines = [
      `- **Skills:** ${skillList}`,
      `- **Allowed models:** ${modelList}`,
      ...(agent.costLimitUsd !== undefined ? [`- **Cost limit:** $${agent.costLimitUsd.toFixed(2)} USD per task`] : []),
      `- **Type:** ${agent.builtIn ? 'Built-in (shipped with AtlasMind)' : 'Custom'}`,
    ];
    const agentStubContent = [
      `# ${agent.name}`,
      '',
      `**Role:** ${agent.role}`,
      '',
      agent.description,
      '',
      '## System Prompt',
      '',
      promptPreview,
      '',
      '## Configuration',
      '',
      ...configLines,
    ].join('\n');
    const agentBodyFingerprint = getImportBodyFingerprint(agentStubContent);
    const agentEntry: MemoryEntry = {
      path: agentEntryPath,
      title: `${agent.name} — Agent Instructions`,
      tags: ['import', 'agent', safeId],
      lastModified: now,
      snippet: truncate(agentStubContent, MAX_IMPORT_SNIPPET),
      sourcePaths: ['agentRegistry'],
      sourceFingerprint: agentSourceFingerprint,
      bodyFingerprint: agentBodyFingerprint,
      documentClass: 'agent',
      evidenceType: 'imported',
    };
    const agentMetadata: ImportEntryMetadata = {
      entryPath: agentEntryPath,
      generatorVersion: IMPORT_GENERATOR_VERSION,
      generatedAt: now,
      sourcePaths: ['agentRegistry'],
      sourceFingerprint: agentSourceFingerprint,
      bodyFingerprint: agentBodyFingerprint,
    };
    const wrappedAgentContent = appendImportMetadata(agentStubContent, agentMetadata);
    const agentResult = atlas.memoryManager.upsert(agentEntry, wrappedAgentContent);
    if (agentResult.status === 'created' || agentResult.status === 'updated') {
      created++;
    } else {
      skipped++;
    }
  }

  // ── Security policy sync marker ───────────────────────────────────────────
  // When SECURITY.md exists, write a record in misadventures/ that tracks the
  // policy content. This resolves the Security delta (which fires when SECURITY.md
  // is newer than any misadventures/ entry) after each sync that detects a change.
  const securityDoc = scanned.get('SECURITY.md');
  if (securityDoc) {
    const securityEntryPath = 'misadventures/security-policy-sync.md';
    const securitySourceFingerprint = hashImportValue([securityDoc.path, securityDoc.content]);
    const securityTargetUri = vscode.Uri.joinPath(ssotRoot, securityEntryPath);
    const existingSecurityContent = await tryReadTextFile(securityTargetUri);
    const existingSecurityMeta = parseImportMetadata(existingSecurityContent);

    if (existingSecurityMeta?.sourceFingerprint !== securitySourceFingerprint) {
      const excerpt = truncate(securityDoc.content, 2_000);
      const securitySyncContent = [
        '# Security Policy Sync',
        '',
        `Synchronized from \`${securityDoc.path}\` during SSOT import on ${now}.`,
        '',
        '## Policy Content',
        '',
        excerpt,
      ].join('\n');
      const securityBodyFingerprint = getImportBodyFingerprint(securitySyncContent);
      const securityEntry: MemoryEntry = {
        path: securityEntryPath,
        title: 'Security Policy Sync',
        tags: ['import', 'security', 'policy'],
        lastModified: now,
        snippet: truncate(securitySyncContent, MAX_IMPORT_SNIPPET),
        sourcePaths: [securityDoc.path],
        sourceFingerprint: securitySourceFingerprint,
        bodyFingerprint: securityBodyFingerprint,
        documentClass: 'misadventure',
        evidenceType: 'imported',
      };
      const securityMetadata: ImportEntryMetadata = {
        entryPath: securityEntryPath,
        generatorVersion: IMPORT_GENERATOR_VERSION,
        generatedAt: now,
        sourcePaths: [securityDoc.path],
        sourceFingerprint: securitySourceFingerprint,
        bodyFingerprint: securityBodyFingerprint,
      };
      const wrappedSecurityContent = appendImportMetadata(securitySyncContent, securityMetadata);
      const securityResult = atlas.memoryManager.upsert(securityEntry, wrappedSecurityContent);
      if (securityResult.status === 'created' || securityResult.status === 'updated') {
        created++;
      } else {
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  // ── Reload memory from disk to pick up any files already there ──
  const ssotUri = vscode.Uri.joinPath(
    workspaceRoot,
    vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', 'project_memory'),
  );
  await atlas.memoryManager.loadFromDisk(ssotUri);
  atlas.memoryRefresh.fire();

  return { entriesCreated: created, entriesSkipped: skipped, projectType };
}

export async function getProjectMemoryFreshness(
  workspaceRoot: vscode.Uri,
): Promise<ProjectMemoryFreshnessStatus> {
  const snapshot = await buildImportSnapshot(workspaceRoot);
  if (!snapshot) {
    return {
      hasImportedEntries: false,
      isStale: false,
      staleEntryCount: 0,
      staleEntries: [],
    };
  }

  const importedEntries = await collectImportedEntryMetadata(snapshot.ssotRoot);
  if (importedEntries.length === 0) {
    const legacyImportedEntries = await collectLegacyImportedEntries(snapshot);
    if (legacyImportedEntries.length > 0) {
      return {
        hasImportedEntries: true,
        isStale: true,
        staleEntryCount: legacyImportedEntries.length,
        staleEntries: legacyImportedEntries.map(entry => entry.entry.path),
      };
    }

    return {
      hasImportedEntries: false,
      isStale: false,
      staleEntryCount: 0,
      staleEntries: [],
    };
  }

  const trackedImportPaths = new Set([
    'index/import-catalog.md',
    'index/import-freshness.md',
  ]);
  const currentCandidates = new Map(snapshot.entries.map(candidate => [candidate.entry.path, candidate]));
  const importedByPath = new Map(importedEntries.map(metadata => [metadata.entryPath, metadata]));
  const stalePaths = new Set<string>();

  for (const candidate of snapshot.entries) {
    const metadata = importedByPath.get(candidate.entry.path);
    if (!metadata || metadata.sourceFingerprint !== candidate.sourceFingerprint) {
      stalePaths.add(candidate.entry.path);
    }
  }

  for (const metadata of importedEntries) {
    if (trackedImportPaths.has(metadata.entryPath)) {
      continue;
    }
    if (!currentCandidates.has(metadata.entryPath)) {
      stalePaths.add(metadata.entryPath);
    }
  }

  const lastImportedAt = importedEntries
    .map(entry => entry.generatedAt)
    .sort((left, right) => right.localeCompare(left))[0];

  return {
    hasImportedEntries: true,
    isStale: stalePaths.size > 0,
    staleEntryCount: stalePaths.size,
    staleEntries: [...stalePaths].sort(),
    lastImportedAt,
  };
}

async function collectLegacyImportedEntries(snapshot: ImportBuildSnapshot): Promise<ImportEntryCandidate[]> {
  const legacyEntries: ImportEntryCandidate[] = [];

  for (const candidate of snapshot.entries) {
    const targetUri = vscode.Uri.joinPath(snapshot.ssotRoot, candidate.entry.path);
    const existingContent = await tryReadTextFile(targetUri);
    if (!existingContent) {
      continue;
    }

    if (parseImportMetadata(existingContent)) {
      continue;
    }

    if (looksLikeLegacyImportedEntry(existingContent)) {
      legacyEntries.push(candidate);
    }
  }

  return legacyEntries;
}

function looksLikeLegacyImportedEntry(content: string): boolean {
  const normalized = content.toLowerCase();
  return normalized.includes('tags: #import')
    || normalized.includes('tags: #import ')
    || normalized.includes('tags: #import\n')
    || normalized.includes('# import catalog')
    || normalized.includes('# import freshness report');
}

function inferMemoryDocumentClass(entryPath: string): MemoryDocumentClass {
  const normalized = entryPath.replace(/\\/g, '/').toLowerCase();
  if (normalized === 'project_soul.md') {
    return 'project-soul';
  }

  const segment = normalized.split('/')[0] ?? '';
  switch (segment) {
    case 'architecture':
      return 'architecture';
    case 'roadmap':
      return 'roadmap';
    case 'decisions':
      return 'decision';
    case 'misadventures':
      return 'misadventure';
    case 'ideas':
      return 'idea';
    case 'domain':
      return 'domain';
    case 'operations':
      return 'operations';
    case 'agents':
      return 'agent';
    case 'skills':
      return 'skill';
    case 'index':
      return 'index';
    default:
      return 'other';
  }
}

function inferMemoryEvidenceType(entryPath: string, sourcePaths: string[]): MemoryEvidenceType {
  if (entryPath.replace(/\\/g, '/').startsWith('index/')) {
    return 'generated-index';
  }

  return sourcePaths.length > 0 ? 'imported' : 'manual';
}

async function buildImportSnapshot(
  workspaceRoot: vscode.Uri,
): Promise<ImportBuildSnapshot | undefined> {
  const config = vscode.workspace.getConfiguration('atlasmind');
  const ssotRelPath = getValidatedSsotPath(config.get<string>('ssotPath', 'project_memory'));
  if (!ssotRelPath) {
    return undefined;
  }

  const ssotRoot = vscode.Uri.joinPath(workspaceRoot, ssotRelPath);
  await ensureSsotStructure(ssotRoot);

  const scanned = await scanImportFiles(workspaceRoot);
  const directoryListing = await getTopLevelDirectoryListing(workspaceRoot);
  const projectType = detectProjectType(scanned);
  const codebaseMap = await buildFocusedDirectoryMap(workspaceRoot);
  const now = new Date().toISOString();
  const entries: ImportEntryCandidate[] = [];
  const pushEntry = (
    entryPath: string,
    title: string,
    tags: string[],
    content: string,
    sourcePaths: string[],
    fingerprintInputs: Array<string | undefined>,
  ) => {
    const sourceFingerprint = hashImportValue(fingerprintInputs.filter((value): value is string => typeof value === 'string'));
    entries.push({
      entry: {
        path: entryPath,
        title,
        tags,
        lastModified: now,
        snippet: truncate(content, MAX_IMPORT_SNIPPET),
        sourcePaths,
        sourceFingerprint,
        bodyFingerprint: getImportBodyFingerprint(content),
        documentClass: inferMemoryDocumentClass(entryPath),
        evidenceType: inferMemoryEvidenceType(entryPath, sourcePaths),
      },
      content,
      sourcePaths,
      sourceFingerprint,
    });
  };

  const readme = findFirstByCategory(scanned, 'readme');
  if (readme) {
    pushEntry(
      'architecture/project-overview.md',
      'Project Overview',
      ['import', 'overview', 'readme'],
      readme.content,
      [readme.path],
      [readme.path, readme.content],
    );
  }

  const manifest = findFirstByCategory(scanned, 'manifest');
  if (manifest) {
    const dependencySummary = extractDependencySummary(manifest.path, manifest.content);
    pushEntry(
      'architecture/dependencies.md',
      'Project Dependencies',
      ['import', 'dependencies', detectEcosystem(manifest.path)],
      dependencySummary,
      [manifest.path],
      [manifest.path, manifest.content, dependencySummary],
    );
  }

  if (directoryListing) {
    const structureContent = `# Project Structure\n\nTop-level contents of the workspace:\n\n\`\`\`\n${directoryListing}\n\`\`\`\n`;
    pushEntry(
      'architecture/project-structure.md',
      'Project Structure',
      ['import', 'structure', 'architecture'],
      structureContent,
      ['workspace-root'],
      [directoryListing],
    );
  }

  if (codebaseMap) {
    pushEntry(
      'architecture/codebase-map.md',
      'Codebase Map',
      ['import', 'structure', 'codebase'],
      codebaseMap,
      ['src', 'tests', 'docs', 'wiki', 'project_memory', '.github'],
      [codebaseMap],
    );
  }

  const conventions = buildConventionsSummary(scanned);
  if (conventions) {
    pushEntry(
      'domain/conventions.md',
      'Build & Tooling Conventions',
      ['import', 'conventions', 'tooling'],
      conventions,
      ['tsconfig.json', '.gitignore', '.editorconfig', '.prettierrc', 'eslint.config.js', '.eslintrc.json', '.eslintrc.js', 'Dockerfile', 'docker-compose.yml', 'Makefile'],
      [conventions],
    );
  }

  const productCapabilities = buildProductCapabilitiesSummary(readme, manifest, projectType);
  if (productCapabilities) {
    pushEntry(
      'domain/product-capabilities.md',
      'Product Capabilities',
      ['import', 'product', 'capabilities'],
      productCapabilities,
      [readme?.path ?? 'README.md', manifest?.path ?? 'package.json'],
      [projectType, readme?.content, manifest?.content, productCapabilities],
    );
  }

  const architectureDoc = scanned.get('docs/architecture.md');
  const architectureSummary = buildSectionSummary(
    'Runtime & Surface Architecture',
    'docs/architecture.md',
    architectureDoc?.content,
    ['System Diagram', 'Activation Flow', 'CLI Flow', 'Core Services', 'Data Flow', 'Security Boundaries', 'Quality Gates'],
  );
  if (architectureSummary) {
    pushEntry(
      'architecture/runtime-and-surfaces.md',
      'Runtime & Surface Architecture',
      ['import', 'architecture', 'runtime'],
      architectureSummary,
      ['docs/architecture.md'],
      [architectureDoc?.content, architectureSummary],
    );
  }

  const routingDoc = scanned.get('docs/model-routing.md');
  const routingSummary = buildSectionSummary(
    'Model Routing Summary',
    'docs/model-routing.md',
    routingDoc?.content,
    ['Overview', 'Routing Inputs', 'Task Profiles', 'Selection Algorithm', 'Supported Providers', 'Cost Estimation'],
  );
  if (routingSummary) {
    pushEntry(
      'architecture/model-routing.md',
      'Model Routing Summary',
      ['import', 'architecture', 'routing'],
      routingSummary,
      ['docs/model-routing.md'],
      [routingDoc?.content, routingSummary],
    );
  }

  const agentsDoc = scanned.get('docs/agents-and-skills.md');
  const agentsSummary = buildSectionSummary(
    'Agents & Skills Summary',
    'docs/agents-and-skills.md',
    agentsDoc?.content,
    ['Agents', 'Ephemeral Sub-Agents (Project Execution)', 'Skills', 'Skill Assignment', 'Security Scanning', 'Built-in Skills', 'MCP-Sourced Skills'],
  );
  if (agentsSummary) {
    pushEntry(
      'architecture/agents-and-skills.md',
      'Agents & Skills Summary',
      ['import', 'architecture', 'agents', 'skills'],
      agentsSummary,
      ['docs/agents-and-skills.md'],
      [agentsDoc?.content, agentsSummary],
    );
  }

  const developmentWorkflow = buildOperationsSummary(scanned);
  if (developmentWorkflow) {
    pushEntry(
      'operations/development-workflow.md',
      'Development Workflow',
      ['import', 'operations', 'workflow'],
      developmentWorkflow,
      ['docs/development.md', 'docs/github-workflow.md'],
      [scanned.get('docs/development.md')?.content, scanned.get('docs/github-workflow.md')?.content, developmentWorkflow],
    );
  }

  const configurationSummary = buildSectionSummary(
    'Configuration Reference Summary',
    'docs/configuration.md',
    scanned.get('docs/configuration.md')?.content,
    ['Model Routing', 'SSOT Memory', 'Sidebar UI', 'Tool Safety & Chat Context', 'Project Execution (`/project`)', 'Tool Webhooks', 'Orchestrator Tunables', 'Budget', 'Experimental', 'Voice', 'API Keys'],
  );
  if (configurationSummary) {
    pushEntry(
      'operations/configuration-reference.md',
      'Configuration Reference Summary',
      ['import', 'operations', 'configuration'],
      configurationSummary,
      ['docs/configuration.md'],
      [scanned.get('docs/configuration.md')?.content, configurationSummary],
    );
  }

  const safetySummary = buildSafetySummary(scanned);
  if (safetySummary) {
    pushEntry(
      'operations/security-and-safety.md',
      'Security & Safety Summary',
      ['import', 'operations', 'security', 'safety'],
      safetySummary,
      ['SECURITY.md', 'docs/architecture.md', '.github/copilot-instructions.md'],
      [scanned.get('SECURITY.md')?.content, scanned.get('docs/architecture.md')?.content, scanned.get('.github/copilot-instructions.md')?.content, safetySummary],
    );
  }

  const governanceSummary = buildGovernanceSummary(scanned);
  if (governanceSummary) {
    pushEntry(
      'decisions/development-guardrails.md',
      'Development Guardrails',
      ['import', 'decisions', 'governance'],
      governanceSummary,
      ['.github/copilot-instructions.md', 'docs/github-workflow.md'],
      [scanned.get('.github/copilot-instructions.md')?.content, scanned.get('docs/github-workflow.md')?.content, governanceSummary],
    );
  }

  const releaseSummary = buildReleaseSummary(scanned.get('CHANGELOG.md')?.content, manifest);
  if (releaseSummary) {
    pushEntry(
      'roadmap/release-history.md',
      'Release History Snapshot',
      ['import', 'roadmap', 'release'],
      releaseSummary,
      ['CHANGELOG.md', manifest?.path ?? 'package.json'],
      [scanned.get('CHANGELOG.md')?.content, manifest?.content, releaseSummary],
    );
  }

  const licenseFile = findFirstByCategory(scanned, 'license');
  if (licenseFile) {
    const licenseType = detectLicenseType(licenseFile.content);
    const licenseContent = `# Project License\n\nDetected license: **${licenseType}**\n\nSource: \`${licenseFile.path}\`\n`;
    pushEntry(
      'domain/license.md',
      'Project License',
      ['import', 'license'],
      licenseContent,
      [licenseFile.path],
      [licenseFile.path, licenseFile.content, licenseType],
    );
  }

  return {
    now,
    ssotRoot,
    scanned,
    projectType,
    entries,
    readme,
    architectureDoc,
  };
}

async function scanImportFiles(workspaceRoot: vscode.Uri): Promise<Map<string, ScannedImportFile>> {
  const scanned = new Map<string, ScannedImportFile>();

  for (const spec of IMPORT_SCAN_FILES) {
    const fileUri = vscode.Uri.joinPath(workspaceRoot, spec.path);
    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(bytes).toString('utf-8').slice(0, MAX_IMPORT_FILE_BYTES);
      scanned.set(spec.path, { path: spec.path, content, category: spec.category });
    } catch {
      // File doesn't exist — skip
    }
  }

  return scanned;
}

async function getTopLevelDirectoryListing(workspaceRoot: vscode.Uri): Promise<string> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(workspaceRoot);
    return entries
      .map(([name, type]) => type === vscode.FileType.Directory ? `${name}/` : name)
      .sort()
      .join('\n');
  } catch {
    return '';
  }
}

function isTextLikeFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.md')
    || lower.endsWith('.txt')
    || lower.endsWith('.json')
    || lower.endsWith('.yml')
    || lower.endsWith('.yaml');
}

async function collectImportedEntryMetadata(ssotRoot: vscode.Uri): Promise<ImportEntryMetadata[]> {
  const metadata: ImportEntryMetadata[] = [];
  await walkImportedEntryMetadata(ssotRoot, metadata);
  return metadata;
}

async function walkImportedEntryMetadata(root: vscode.Uri, metadata: ImportEntryMetadata[]): Promise<void> {
  let children: [string, vscode.FileType][];
  try {
    children = await vscode.workspace.fs.readDirectory(root);
  } catch {
    return;
  }

  for (const [name, type] of children) {
    if (name === '.gitkeep') {
      continue;
    }

    const childUri = vscode.Uri.joinPath(root, name);
    if (type === vscode.FileType.Directory) {
      await walkImportedEntryMetadata(childUri, metadata);
      continue;
    }

    if (type !== vscode.FileType.File || !isTextLikeFile(name)) {
      continue;
    }

    const content = await tryReadTextFile(childUri);
    const parsed = parseImportMetadata(content);
    if (parsed) {
      metadata.push(parsed);
    }
  }
}

// ── Import helpers ────────────────────────────────────────────

function findFirstByCategory(
  scanned: Map<string, ScannedImportFile>,
  category: string,
): { path: string; content: string } | undefined {
  for (const [path, info] of scanned) {
    if (info.category === category) {
      return { path, content: info.content };
    }
  }
  return undefined;
}

function detectProjectType(scanned: Map<string, ScannedImportFile>): string | undefined {
  const pkg = scanned.get('package.json');
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content);
      if (parsed.contributes || parsed.engines?.vscode) { return 'VS Code Extension'; }
      if (parsed.bin) { return 'CLI Tool'; }
      if (parsed.main && !parsed.dependencies?.['express'] && !parsed.dependencies?.['next'] && !parsed.dependencies?.['react']) {
        return 'Library';
      }
      if (parsed.dependencies?.['next'] || parsed.dependencies?.['react'] || parsed.dependencies?.['vue'] || parsed.dependencies?.['angular']) {
        return 'Web App';
      }
      if (parsed.dependencies?.['express'] || parsed.dependencies?.['fastify'] || parsed.dependencies?.['koa']) {
        return 'API Server';
      }
    } catch { /* not valid JSON; continue */ }
  }
  if (scanned.has('Cargo.toml')) { return 'Rust Project'; }
  if (scanned.has('pyproject.toml')) { return 'Python Project'; }
  if (scanned.has('go.mod')) { return 'Go Project'; }
  if (scanned.has('pom.xml') || scanned.has('build.gradle')) { return 'Java Project'; }
  if (scanned.has('Gemfile')) { return 'Ruby Project'; }
  if (scanned.has('composer.json')) { return 'PHP Project'; }
  return undefined;
}

function detectEcosystem(manifestPath: string): string {
  if (manifestPath === 'package.json') { return 'node'; }
  if (manifestPath === 'Cargo.toml') { return 'rust'; }
  if (manifestPath === 'pyproject.toml') { return 'python'; }
  if (manifestPath === 'go.mod') { return 'go'; }
  if (manifestPath === 'pom.xml' || manifestPath === 'build.gradle') { return 'java'; }
  if (manifestPath === 'Gemfile') { return 'ruby'; }
  if (manifestPath === 'composer.json') { return 'php'; }
  return 'other';
}

function extractDependencySummary(manifestPath: string, content: string): string {
  if (manifestPath === 'package.json') {
    return extractNpmDependencies(content);
  }
  // For non-JSON manifests, return the raw content with a header
  const ecosystem = detectEcosystem(manifestPath);
  return `# Dependencies (${ecosystem})\n\nSource: \`${manifestPath}\`\n\n\`\`\`\n${truncate(content, 2500)}\n\`\`\`\n`;
}

function extractNpmDependencies(content: string): string {
  try {
    const pkg = JSON.parse(content);
    const lines: string[] = ['# Dependencies (node)', ''];
    if (pkg.name) { lines.push(`**Package**: ${pkg.name}`); }
    if (pkg.version) { lines.push(`**Version**: ${pkg.version}`); }
    if (pkg.description) { lines.push(`**Description**: ${pkg.description}`); }
    lines.push('');

    const deps = pkg.dependencies ?? {};
    const devDeps = pkg.devDependencies ?? {};
    const depKeys = Object.keys(deps);
    const devKeys = Object.keys(devDeps);

    if (depKeys.length > 0) {
      lines.push(`## Dependencies (${depKeys.length})`);
      for (const key of depKeys) { lines.push(`- ${key}: ${deps[key]}`); }
      lines.push('');
    }
    if (devKeys.length > 0) {
      lines.push(`## Dev Dependencies (${devKeys.length})`);
      for (const key of devKeys) { lines.push(`- ${key}: ${devDeps[key]}`); }
      lines.push('');
    }

    const scripts = pkg.scripts ?? {};
    const scriptKeys = Object.keys(scripts);
    if (scriptKeys.length > 0) {
      lines.push(`## NPM Scripts (${scriptKeys.length})`);
      for (const key of scriptKeys) { lines.push(`- \`${key}\`: \`${scripts[key]}\``); }
      lines.push('');
    }

    return lines.join('\n');
  } catch {
    return `# Dependencies (node)\n\n\`\`\`json\n${truncate(content, 2500)}\n\`\`\`\n`;
  }
}

function buildConventionsSummary(scanned: Map<string, ScannedImportFile>): string | undefined {
  const lines: string[] = ['# Build & Tooling Conventions', ''];
  let hasAny = false;

  const tsconfig = scanned.get('tsconfig.json');
  if (tsconfig) {
    hasAny = true;
    lines.push('## TypeScript');
    try {
      const parsed = JSON.parse(tsconfig.content);
      const co = parsed.compilerOptions ?? {};
      if (co.target) { lines.push(`- Target: ${co.target}`); }
      if (co.module) { lines.push(`- Module: ${co.module}`); }
      if (co.strict !== undefined) { lines.push(`- Strict: ${co.strict}`); }
      if (co.outDir) { lines.push(`- OutDir: ${co.outDir}`); }
    } catch {
      lines.push('- tsconfig.json present (could not parse)');
    }
    lines.push('');
  }

  for (const eslintFile of ['.eslintrc.json', '.eslintrc.js', 'eslint.config.js']) {
    if (scanned.has(eslintFile)) {
      hasAny = true;
      lines.push(`## Linting\n- ESLint config: \`${eslintFile}\``);
      lines.push('');
      break;
    }
  }

  if (scanned.has('.prettierrc')) {
    hasAny = true;
    lines.push('## Formatting\n- Prettier config: `.prettierrc`');
    lines.push('');
  }

  if (scanned.has('.editorconfig')) {
    hasAny = true;
    lines.push('## Editor Config\n- `.editorconfig` present');
    lines.push('');
  }

  if (scanned.has('Dockerfile') || scanned.has('docker-compose.yml')) {
    hasAny = true;
    lines.push('## Containers');
    if (scanned.has('Dockerfile')) { lines.push('- `Dockerfile` present'); }
    if (scanned.has('docker-compose.yml')) { lines.push('- `docker-compose.yml` present'); }
    lines.push('');
  }

  if (scanned.has('Makefile')) {
    hasAny = true;
    lines.push('## Build System\n- `Makefile` present');
    lines.push('');
  }

  const gitignore = scanned.get('.gitignore');
  if (gitignore) {
    hasAny = true;
    const ignoreEntries = gitignore.content
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .slice(0, 20);
    lines.push('## Git Ignore (top entries)');
    for (const entry of ignoreEntries) { lines.push(`- ${entry.trim()}`); }
    lines.push('');
  }

  return hasAny ? lines.join('\n') : undefined;
}

function detectLicenseType(content: string): string {
  const lower = content.toLowerCase();
  if (lower.includes('mit license') || lower.includes('permission is hereby granted, free of charge')) { return 'MIT'; }
  if (lower.includes('apache license') && lower.includes('version 2.0')) { return 'Apache-2.0'; }
  if (lower.includes('gnu general public license') && lower.includes('version 3')) { return 'GPL-3.0'; }
  if (lower.includes('gnu general public license') && lower.includes('version 2')) { return 'GPL-2.0'; }
  if (lower.includes('bsd 2-clause')) { return 'BSD-2-Clause'; }
  if (lower.includes('bsd 3-clause')) { return 'BSD-3-Clause'; }
  if (lower.includes('isc license')) { return 'ISC'; }
  if (lower.includes('mozilla public license')) { return 'MPL-2.0'; }
  if (lower.includes('unlicense')) { return 'Unlicense'; }
  return 'Unknown';
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) { return text; }
  return text.slice(0, maxLen) + '\n…(truncated)';
}

async function ensureSsotStructure(ssotRoot: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(ssotRoot);

  for (const entry of SSOT_FOLDERS) {
    if (entry.endsWith('.md')) {
      const fileUri = vscode.Uri.joinPath(ssotRoot, entry);
      if (!(await pathExists(fileUri))) {
        await ensureParentDirectory(fileUri, ssotRoot);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(getStarterContent(entry), 'utf-8'));
      }
      continue;
    }

    const dirUri = vscode.Uri.joinPath(ssotRoot, entry);
    await vscode.workspace.fs.createDirectory(dirUri);
    const keepUri = vscode.Uri.joinPath(dirUri, '.gitkeep');
    if (!(await pathExists(keepUri))) {
      await vscode.workspace.fs.writeFile(keepUri, new Uint8Array());
    }
  }
}

async function countSsotFiles(root: vscode.Uri): Promise<number> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(root);
    let total = 0;
    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory) {
        total += await countSsotFiles(vscode.Uri.joinPath(root, name));
      } else if (name !== '.gitkeep') {
        total += 1;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

async function tryReadTextFile(fileUri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    return Buffer.from(bytes).toString('utf-8');
  } catch {
    return undefined;
  }
}

function appendImportMetadata(content: string, metadata: ImportEntryMetadata): string {
  const metadataLines = [
    '<!-- atlasmind-import',
    `entry-path: ${metadata.entryPath}`,
    `generator-version: ${metadata.generatorVersion}`,
    `generated-at: ${metadata.generatedAt}`,
    `source-paths: ${metadata.sourcePaths.join(' | ')}`,
    `source-fingerprint: ${metadata.sourceFingerprint}`,
    `body-fingerprint: ${metadata.bodyFingerprint}`,
    '-->',
  ];
  return `${stripImportMetadata(content).trimEnd()}\n\n${metadataLines.join('\n')}\n`;
}

function getImportBodyFingerprint(content: string): string {
  return hashImportValue([stripImportMetadata(content).trimEnd()]);
}

function parseImportMetadata(content: string | undefined): ImportEntryMetadata | undefined {
  if (!content) {
    return undefined;
  }

  const match = /<!-- atlasmind-import\n([\s\S]*?)\n-->\s*$/u.exec(content);
  if (!match) {
    return undefined;
  }

  const metadata = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) {
      continue;
    }
    metadata.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }

  const entryPath = metadata.get('entry-path');
  const generatorVersion = Number.parseInt(metadata.get('generator-version') ?? '', 10);
  const generatedAt = metadata.get('generated-at');
  const sourceFingerprint = metadata.get('source-fingerprint');
  const bodyFingerprint = metadata.get('body-fingerprint');
  if (!entryPath || !Number.isFinite(generatorVersion) || !generatedAt || !sourceFingerprint || !bodyFingerprint) {
    return undefined;
  }

  return {
    entryPath,
    generatorVersion,
    generatedAt,
    sourcePaths: (metadata.get('source-paths') ?? '')
      .split('|')
      .map(item => item.trim())
      .filter(Boolean),
    sourceFingerprint,
    bodyFingerprint,
  };
}

function stripImportMetadata(content: string): string {
  return content.replace(/\n?<!-- atlasmind-import\n[\s\S]*?\n-->\s*$/u, '').trimEnd();
}

function hashImportValue(parts: string[]): string {
  let hash = 2166136261;
  const source = parts.join('\u241F');
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function purgeProjectMemory(
  workspaceRoot: vscode.Uri,
  atlas: AtlasMindContext,
): Promise<{ ssotPath: string; removedFiles: number }> {
  const config = vscode.workspace.getConfiguration('atlasmind');
  const ssotRelPath = getValidatedSsotPath(config.get<string>('ssotPath', 'project_memory'));
  if (!ssotRelPath) {
    throw new Error('AtlasMind SSOT path must be a safe relative path inside the workspace.');
  }

  const ssotRoot = vscode.Uri.joinPath(workspaceRoot, ssotRelPath);
  const removedFiles = await countSsotFiles(ssotRoot);
  if (await pathExists(ssotRoot)) {
    await vscode.workspace.fs.delete(ssotRoot, { recursive: true, useTrash: false });
  }

  await ensureSsotStructure(ssotRoot);
  await atlas.memoryManager.loadFromDisk(ssotRoot);
  atlas.memoryRefresh.fire();

  return { ssotPath: ssotRelPath, removedFiles };
}

async function buildFocusedDirectoryMap(workspaceRoot: vscode.Uri): Promise<string | undefined> {
  const focusDirectories = ['src', 'tests', 'docs', 'wiki', 'project_memory', '.github'];
  const lines: string[] = ['# Codebase Map', '', 'Focused recursive directory view captured during import.', ''];
  let hasAny = false;

  for (const directory of focusDirectories) {
    const childUri = vscode.Uri.joinPath(workspaceRoot, directory);
    const section = await renderDirectoryTree(childUri, directory, 0, 2);
    if (!section) {
      continue;
    }
    hasAny = true;
    lines.push(`## ${directory}`);
    lines.push('```text');
    lines.push(section);
    lines.push('```');
    lines.push('');
  }

  return hasAny ? lines.join('\n') : undefined;
}

async function renderDirectoryTree(
  root: vscode.Uri,
  label: string,
  depth: number,
  maxDepth: number,
): Promise<string | undefined> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(root);
    if (entries.length === 0) {
      return undefined;
    }
    const lines: string[] = [label.endsWith('/') ? label : `${label}/`];
    const sorted = [...entries].sort(([aName, aType], [bName, bType]) => {
      if (aType !== bType) {
        return aType === vscode.FileType.Directory ? -1 : 1;
      }
      return aName.localeCompare(bName);
    });
    const limited = sorted.slice(0, 20);

    for (const [name, type] of limited) {
      const indent = '  '.repeat(depth + 1);
      const isDirectory = type === vscode.FileType.Directory;
      lines.push(`${indent}${isDirectory ? `${name}/` : name}`);
      if (isDirectory && depth + 1 < maxDepth) {
        const nested = await renderDirectoryTree(vscode.Uri.joinPath(root, name), name, depth + 1, maxDepth);
        if (nested) {
          const nestedLines = nested.split('\n').slice(1);
          for (const nestedLine of nestedLines) {
            lines.push(nestedLine);
          }
        }
      }
    }

    if (sorted.length > limited.length) {
      lines.push(`${'  '.repeat(depth + 1)}... (${sorted.length - limited.length} more entries)`);
    }

    return lines.join('\n');
  } catch {
    return undefined;
  }
}

function buildProductCapabilitiesSummary(
  readme: { path: string; content: string } | undefined,
  manifest: { path: string; content: string } | undefined,
  projectType: string | undefined,
): string | undefined {
  const lines: string[] = ['# Product Capabilities', ''];
  let hasAny = false;

  if (projectType) {
    hasAny = true;
    lines.push(`Project type: **${projectType}**.`);
    lines.push('');
  }

  if (readme) {
    hasAny = true;
    const whatIsAtlas = extractMarkdownSections(readme.content, ['What is AtlasMind?', 'Core Workflows', 'Configuration']);
    lines.push(`Imported from \`${readme.path}\`.`);
    lines.push('');
    lines.push(whatIsAtlas || truncate(readme.content, 2_500));
    lines.push('');
  }

  if (manifest) {
    try {
      const parsed = JSON.parse(manifest.content);
      const slashCommands = parsed.contributes?.chatParticipants?.[0]?.commands ?? [];
      const extensionCommands = parsed.contributes?.commands ?? [];
      const features: string[] = [];
      for (const command of slashCommands) {
        if (typeof command?.name === 'string') {
          features.push(`- /${command.name}`);
        }
      }
      if (features.length > 0) {
        hasAny = true;
        lines.push('## Slash Commands');
        lines.push(...features);
        lines.push('');
      }
      if (extensionCommands.length > 0) {
        hasAny = true;
        lines.push(`## Extension Commands\n- ${extensionCommands.length} commands contributed through package.json.`);
        lines.push('');
      }
    } catch {
      // Ignore parse failures.
    }
  }

  return hasAny ? lines.join('\n') : undefined;
}

function buildSectionSummary(
  title: string,
  sourcePath: string,
  content: string | undefined,
  headings: string[],
): string | undefined {
  if (!content) {
    return undefined;
  }

  const extracted = extractMarkdownSections(content, headings);
  const body = extracted || truncate(content, 3_000);
  return `# ${title}\n\nSource: \`${sourcePath}\`\n\n${body}`;
}

function buildOperationsSummary(scanned: Map<string, ScannedImportFile>): string | undefined {
  const development = scanned.get('docs/development.md')?.content;
  const workflow = scanned.get('docs/github-workflow.md')?.content;
  if (!development && !workflow) {
    return undefined;
  }

  const parts = ['# Development Workflow', ''];
  if (development) {
    parts.push('## Build, Test, And Local Development');
    parts.push(extractMarkdownSections(development, ['Prerequisites', 'Setup', 'Build', 'CLI', 'Run', 'Package And Publish', 'Lint', 'Test', 'Versioning Workflow']) || truncate(development, 2_500));
    parts.push('');
  }
  if (workflow) {
    parts.push('## GitHub Workflow Standards');
    parts.push(extractMarkdownSections(workflow, ['Goals', 'Branch Strategy', 'Pull Request Workflow', 'Release Flow', 'Release Hygiene']) || truncate(workflow, 2_000));
    parts.push('');
  }
  return parts.join('\n');
}

function buildSafetySummary(scanned: Map<string, ScannedImportFile>): string | undefined {
  const architecture = scanned.get('docs/architecture.md')?.content;
  const security = scanned.get('SECURITY.md')?.content;
  const governance = scanned.get('.github/copilot-instructions.md')?.content;
  if (!architecture && !security && !governance) {
    return undefined;
  }

  const parts = ['# Security & Safety Summary', ''];
  if (governance) {
    parts.push('## Guardrail Principles');
    parts.push(extractBulletsFromSection(governance, 'Safety-First Principle') || truncate(governance, 1_500));
    parts.push('');
  }
  if (architecture) {
    parts.push('## Runtime Boundaries');
    parts.push(extractMarkdownSections(architecture, ['Security Boundaries', 'Quality Gates']) || truncate(architecture, 1_800));
    parts.push('');
  }
  if (security) {
    parts.push('## Repository Security Policy');
    parts.push(truncate(security, 1_800));
    parts.push('');
  }
  return parts.join('\n');
}

function buildGovernanceSummary(scanned: Map<string, ScannedImportFile>): string | undefined {
  const governance = scanned.get('.github/copilot-instructions.md')?.content;
  const workflow = scanned.get('docs/github-workflow.md')?.content;
  if (!governance && !workflow) {
    return undefined;
  }

  const parts = ['# Development Guardrails', ''];
  if (governance) {
    parts.push('## Repository Rules');
    parts.push(extractMarkdownSections(governance, ['Critical Rules', 'Safety-First Principle', 'Documentation Maintenance', 'Version Tracking', 'Coding Standards', 'Security', 'Commits']) || truncate(governance, 2_200));
    parts.push('');
  }
  if (workflow) {
    parts.push('## Branch And Release Policy');
    parts.push(extractMarkdownSections(workflow, ['Branch Strategy', 'Pull Request Workflow', 'Release Flow', 'Release Hygiene']) || truncate(workflow, 1_600));
    parts.push('');
  }
  return parts.join('\n');
}

function buildReleaseSummary(changelog: string | undefined, manifest: { path: string; content: string } | undefined): string | undefined {
  if (!changelog && !manifest) {
    return undefined;
  }

  const parts = ['# Release History Snapshot', ''];
  if (manifest) {
    try {
      const parsed = JSON.parse(manifest.content);
      if (typeof parsed.version === 'string') {
        parts.push(`Current manifest version: **${parsed.version}**.`);
        parts.push('');
      }
    } catch {
      // Ignore parse failures.
    }
  }
  if (changelog) {
    parts.push(truncate(changelog, 3_000));
  }
  return parts.join('\n');
}

function buildImportCatalog(entries: ImportEntryProcessingResult[]): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  const lines = ['# Import Catalog', '', '## Generated Entries'];
  for (const entry of entries) {
    const sourceLabel = entry.sourcePaths.length > 0 ? ` (sources: ${entry.sourcePaths.join(', ')})` : '';
    lines.push(`- \`${entry.path}\` — ${entry.title} [${entry.status}]${sourceLabel}`);
  }
  lines.push('');
  lines.push('This file is generated by `/import` so operators can see which structured memory artifacts were created, refreshed, preserved, or skipped for the current workspace.');
  return lines.join('\n');
}

function buildImportFreshnessReport(entries: ImportEntryProcessingResult[]): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  const lines = [
    '# Import Freshness Report',
    '',
    '## Status Legend',
    '- `created` — new import artifact generated this run.',
    '- `refreshed` — source content changed and the generated memory was updated.',
    '- `unchanged` — source fingerprint matched the last generated version, so the file was left untouched.',
    '- `preserved-manual-edits` — AtlasMind detected local edits in a generated file and skipped overwriting it.',
    '- `rejected` — the candidate was not written because memory validation rejected it.',
    '',
    '## Entries',
  ];

  for (const entry of entries) {
    lines.push(`### ${entry.title}`);
    lines.push(`- Path: \`${entry.path}\``);
    lines.push(`- Status: \`${entry.status}\``);
    lines.push(`- Source fingerprint: \`${entry.sourceFingerprint}\``);
    if (entry.sourcePaths.length > 0) {
      lines.push(`- Sources: ${entry.sourcePaths.join(', ')}`);
    }
    if (entry.reason) {
      lines.push(`- Note: ${entry.reason}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function shouldRefreshProjectSoul(existing: string): boolean {
  return existing.includes('<!-- Describe the high-level goal of this project -->')
    || existing.includes('<!-- Link to decisions/ folder entries -->')
    || existing.includes('{{PROJECT_TYPE}}');
}

function buildProjectSoul(
  existing: string,
  context: { projectType: string | undefined; readme?: string; architectureDoc?: string; governanceDoc?: string },
): string {
  const projectType = context.projectType ?? 'Unknown';
  const visionSource = extractMarkdownSections(context.readme ?? '', ['What is AtlasMind?']);
  const vision = firstMeaningfulParagraph(visionSource || context.readme || '');
  const principles = extractBulletsFromSection(context.governanceDoc ?? '', 'Safety-First Principle');

  return [
    '# Project Soul',
    '',
    '> This file is the living identity of the project.',
    '',
    '## Project Type',
    projectType,
    '',
    '## Vision',
    vision || 'Maintain a developer-centric multi-agent orchestrator that routes work safely across models, preserves long-term project memory, and makes autonomous execution reviewable inside VS Code.',
    '',
    '## Principles',
    principles || '- Default to the safest reasonable behavior.\n- Keep project knowledge structured, current, and reviewable.\n- Prefer explicit approvals and traceable automation for risky work.\n- Treat documentation, versioning, and release hygiene as part of correctness.',
    '',
    '## Key Decisions',
    '- Safety and security regressions are correctness bugs, not polish work.',
    '- Long-term project context belongs in the SSOT under `project_memory/`.',
    '- Provider credentials live in SecretStorage, not in project memory or source.',
    '- `develop` is the routine integration branch and `master` is the protected release-ready branch.',
    '- See `decisions/development-guardrails.md`, `operations/security-and-safety.md`, and `architecture/runtime-and-surfaces.md` for supporting detail.',
    '',
    '## Imported References',
    '- architecture/project-overview.md',
    '- architecture/runtime-and-surfaces.md',
    '- architecture/model-routing.md',
    '- architecture/agents-and-skills.md',
    '- operations/development-workflow.md',
    '- decisions/development-guardrails.md',
  ].join('\n');
}

function extractMarkdownSections(content: string, wantedHeadings: string[]): string | undefined {
  if (!content.trim()) {
    return undefined;
  }

  const headingLookup = new Set(wantedHeadings.map(heading => heading.toLowerCase()));
  const lines = content.split(/\r?\n/);
  const collected: string[] = [];
  let activeHeading: string | undefined;
  let activeLevel = 0;

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      const level = match[1].length;
      const heading = match[2].trim();
      const normalized = heading.toLowerCase();

      if (activeHeading && level <= activeLevel) {
        activeHeading = undefined;
        activeLevel = 0;
      }

      if (headingLookup.has(normalized)) {
        activeHeading = heading;
        activeLevel = level;
        collected.push(line);
        continue;
      }
    }

    if (activeHeading) {
      collected.push(line);
    }
  }

  const output = collected.join('\n').trim();
  return output.length > 0 ? truncate(output, 3_000) : undefined;
}

function extractBulletsFromSection(content: string, sectionHeading: string): string | undefined {
  const section = extractMarkdownSections(content, [sectionHeading]);
  if (!section) {
    return undefined;
  }
  const bullets = section
    .split(/\r?\n/)
    .filter(line => /^-\s+/.test(line.trim()))
    .join('\n');
  return bullets.length > 0 ? bullets : undefined;
}

function firstMeaningfulParagraph(content: string): string | undefined {
  const paragraphs = content
    .split(/\r?\n\s*\r?\n/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 0 && !paragraph.startsWith('#') && !paragraph.startsWith('<'));
  return paragraphs[0];
}
