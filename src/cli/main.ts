#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createAtlasRuntime } from '../runtime/core.js';
import type { SecretStore } from '../runtime/secrets.js';
import { LocalEchoAdapter } from '../providers/registry.js';
import { OpenAiCompatibleAdapter } from '../providers/openai-compatible.js';
import { AnthropicAdapter } from '../providers/anthropic.js';
import type { ProviderAdapter } from '../providers/adapter.js';
import type { BudgetMode, SpeedMode, ProviderId, AgentDefinition, OrchestratorHooks, TaskRequest, ProjectProgressUpdate } from '../types.js';
import { NodeMemoryManager } from './nodeMemoryManager.js';
import { createNodeSkillExecutionContext } from './nodeSkillContext.js';
import { NodeCostTracker } from './nodeCostTracker.js';
import { classifyToolInvocation } from '../core/toolPolicy.js';

const AZURE_OPENAI_API_VERSION = '2024-10-21';
const DEFAULT_SSOT_PATH = 'project_memory';

type AtlasCliRuntime = ReturnType<typeof createAtlasRuntime> & {
  memoryManager: NodeMemoryManager;
  costTracker: NodeCostTracker;
};

export interface ParsedCliArgs {
  command?: string;
  subcommand?: string;
  positional: string[];
  options: {
    workspace?: string;
    ssot?: string;
    provider?: ProviderId;
    model?: string;
    allowWrites: boolean;
    budget: BudgetMode;
    speed: SpeedMode;
    json: boolean;
    dailyLimitUsd?: number;
    dryRun: boolean;
    fix: boolean;
    watch: boolean;
  };
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positional: string[] = [];
  const options: ParsedCliArgs['options'] = {
    allowWrites: false,
    budget: 'balanced',
    speed: 'balanced',
    json: false,
    dryRun: false,
    fix: false,
    watch: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index] ?? '';
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }

    const nextValue = argv[index + 1];
    switch (value) {
      case '--workspace':
        options.workspace = nextValue;
        index += 1;
        break;
      case '--ssot':
        options.ssot = nextValue;
        index += 1;
        break;
      case '--provider':
        options.provider = nextValue as ProviderId;
        index += 1;
        break;
      case '--model':
        options.model = nextValue;
        index += 1;
        break;
      case '--allow-writes':
        options.allowWrites = true;
        break;
      case '--budget':
        options.budget = (nextValue as BudgetMode) ?? 'balanced';
        index += 1;
        break;
      case '--speed':
        options.speed = (nextValue as SpeedMode) ?? 'balanced';
        index += 1;
        break;
      case '--daily-limit-usd':
        options.dailyLimitUsd = nextValue ? Number.parseFloat(nextValue) : undefined;
        index += 1;
        break;
      case '--json':
        options.json = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--fix':
        options.fix = true;
        break;
      case '--watch':
        options.watch = true;
        break;
      default:
        positional.push(value);
        break;
    }
  }

  return {
    command: positional[0],
    subcommand: positional[1],
    positional: positional.slice(2),
    options,
  };
}

export async function resolveCliSsotRoot(workspaceRoot: string, requestedSsotPath?: string): Promise<string | undefined> {
  const explicit = requestedSsotPath?.trim();
  if (explicit) {
    const explicitPath = path.resolve(workspaceRoot, explicit);
    if (await pathExists(explicitPath)) {
      return explicitPath;
    }
  }

  const defaultPath = path.resolve(workspaceRoot, DEFAULT_SSOT_PATH);
  if (await pathExists(defaultPath)) {
    return defaultPath;
  }

  return explicit ? path.resolve(workspaceRoot, explicit) : defaultPath;
}

async function main(): Promise<number> {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (!parsed.command || parsed.command === 'help' || parsed.command === '--help') {
    printHelp();
    return 0;
  }
  if (parsed.command === '--version' || parsed.command === 'version') {
    process.stdout.write('AtlasMind CLI (dev)\n');
    return 0;
  }

  const workspaceRoot = path.resolve(parsed.options.workspace ?? process.cwd());
  const ssotRoot = await resolveCliSsotRoot(workspaceRoot, parsed.options.ssot);
  const memoryManager = new NodeMemoryManager();
  if (ssotRoot && await pathExists(ssotRoot)) {
    await memoryManager.loadFromDisk(ssotRoot);
  }

  const costTracker = new NodeCostTracker(parsed.options.dailyLimitUsd ?? 0);
  const skillContext = createNodeSkillExecutionContext(workspaceRoot, memoryManager);
  const adapters = createCliProviderAdapters();
  const runtime = createAtlasRuntime({
    memoryStore: memoryManager,
    costTracker,
    skillContext,
    providerAdapters: adapters,
    hooks: createCliRuntimeHooks({ allowWrites: parsed.options.allowWrites }),
  });
  const cliRuntime: AtlasCliRuntime = {
    ...runtime,
    memoryManager,
    costTracker,
  };

  syncProviderAvailability(cliRuntime.modelRouter, adapters);

  switch (parsed.command) {
    case 'chat':
      return runChatCommand(cliRuntime, parsed, workspaceRoot);
    case 'project':
      return runProjectCommand(cliRuntime, parsed);
    case 'memory':
      return runMemoryCommand(cliRuntime, parsed);
    case 'providers':
      return runProvidersCommand(cliRuntime, parsed);
    case 'build':
      return runBuildCommand(parsed, workspaceRoot);
    case 'lint':
      return runLintCommand(parsed, workspaceRoot);
    case 'test':
      return runTestCommand(parsed, workspaceRoot);
    default:
      process.stderr.write(`Unknown command: ${parsed.command}\n\n`);
      printHelp();
      return 1;
  }
}

async function runChatCommand(runtime: AtlasCliRuntime, parsed: ParsedCliArgs, workspaceRoot: string): Promise<number> {
  const prompt = parsed.subcommand ? [parsed.subcommand, ...parsed.positional].join(' ').trim() : parsed.positional.join(' ').trim();
  if (!prompt) {
    process.stderr.write('Usage: atlasmind chat <prompt>\n');
    return 1;
  }

  const request: TaskRequest = {
    id: `cli-chat-${Date.now()}`,
    userMessage: prompt,
    context: { workspaceRootPath: workspaceRoot, interface: 'cli' },
    constraints: {
      budget: parsed.options.budget,
      speed: parsed.options.speed,
      ...(parsed.options.provider ? { preferredProvider: parsed.options.provider } : {}),
    },
    timestamp: new Date().toISOString(),
  };

  const agent = withRequestedModel(runtime.agentRegistry.get('default'), parsed.options.model);
  if (!agent) {
    process.stderr.write('AtlasMind default agent is unavailable.\n');
    return 1;
  }

  let streamed = false;
  const result = await runtime.orchestrator.processTaskWithAgent(request, agent, chunk => {
    streamed = true;
    process.stdout.write(chunk);
  });

  if (!streamed) {
    process.stdout.write(`${result.response}\n`);
  } else if (!result.response.endsWith('\n')) {
    process.stdout.write('\n');
  }

  if (parsed.options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  return 0;
}

async function runProjectCommand(runtime: AtlasCliRuntime, parsed: ParsedCliArgs): Promise<number> {
  const goal = parsed.subcommand ? [parsed.subcommand, ...parsed.positional].join(' ').trim() : parsed.positional.join(' ').trim();
  if (!goal) {
    process.stderr.write('Usage: atlasmind project <goal>\n');
    return 1;
  }

  const result = await runtime.orchestrator.processProject(
    goal,
    {
      budget: parsed.options.budget,
      speed: parsed.options.speed,
      ...(parsed.options.provider ? { preferredProvider: parsed.options.provider } : {}),
    },
    update => renderProjectProgress(update),
  );

  if (parsed.options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${result.synthesis}\n`);
  }

  const summary = runtime.costTracker.getSummary();
  process.stderr.write(`\nCost: $${summary.totalCostUsd.toFixed(4)} across ${summary.totalRequests} request(s).\n`);
  return 0;
}

async function runMemoryCommand(runtime: AtlasCliRuntime, parsed: ParsedCliArgs): Promise<number> {
  if (parsed.subcommand === 'list') {
    const entries = runtime.memoryManager.listEntries();
    for (const entry of entries) {
      process.stdout.write(`${entry.path} - ${entry.title}\n`);
    }
    return 0;
  }

  if (parsed.subcommand === 'query') {
    const query = parsed.positional.join(' ').trim();
    if (!query) {
      process.stderr.write('Usage: atlasmind memory query <query>\n');
      return 1;
    }
    const matches = await runtime.memoryManager.queryRelevant(query, 10);
    for (const match of matches) {
      process.stdout.write(`${match.path}\n${match.snippet}\n\n`);
    }
    return 0;
  }

  process.stderr.write('Usage: atlasmind memory <list|query>\n');
  return 1;
}

async function runProvidersCommand(runtime: AtlasCliRuntime, parsed: ParsedCliArgs): Promise<number> {
  if (parsed.subcommand && parsed.subcommand !== 'list') {
    process.stderr.write('Usage: atlasmind providers list\n');
    return 1;
  }

  const registered = new Set(runtime.providerRegistry.list().map(adapter => adapter.providerId));
  const rows = runtime.modelRouter.listProviders().map(provider => ({
    id: provider.id,
    enabled: provider.enabled,
    configured: registered.has(provider.id),
    models: provider.models.length,
  }));

  if (parsed.options.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  } else {
    for (const row of rows) {
      process.stdout.write(`${row.id}\tconfigured=${row.configured ? 'yes' : 'no'}\tenabled=${row.enabled ? 'yes' : 'no'}\tmodels=${row.models}\n`);
    }
  }
  return 0;
}

async function runBuildCommand(parsed: ParsedCliArgs, workspaceRoot: string): Promise<number> {
  if (parsed.options.dryRun) {
    process.stdout.write('Dry run: would execute the project build command.\n');
    process.stdout.write('Build command: npm run build (or detected build script)\n');
    return 0;
  }
  process.stdout.write('Running build...\n');
  const { spawn } = await import('node:child_process');
  return new Promise(resolve => {
    let settled = false;
    const resolveOnce = (code: number): void => {
      if (settled) { return; }
      settled = true;
      resolve(code);
    };
    const proc = spawn('npm', ['run', 'build'], {
      cwd: workspaceRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    proc.on('error', error => {
      process.stderr.write(`Failed to start build command: ${error.message}\n`);
      resolveOnce(1);
    });
    proc.on('close', code => resolveOnce(code ?? 1));
  });
}

async function runLintCommand(parsed: ParsedCliArgs, workspaceRoot: string): Promise<number> {
  const args = ['run', 'lint'];
  if (parsed.options.fix) {
    args.push('--', '--fix');
  }
  process.stdout.write(`Running lint${parsed.options.fix ? ' --fix' : ''}...\n`);
  const { spawn } = await import('node:child_process');
  return new Promise(resolve => {
    let settled = false;
    const resolveOnce = (code: number): void => {
      if (settled) { return; }
      settled = true;
      resolve(code);
    };
    const proc = spawn('npm', args, {
      cwd: workspaceRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    proc.on('error', error => {
      process.stderr.write(`Failed to start lint command: ${error.message}\n`);
      resolveOnce(1);
    });
    proc.on('close', code => resolveOnce(code ?? 1));
  });
}

async function runTestCommand(parsed: ParsedCliArgs, workspaceRoot: string): Promise<number> {
  const args = ['run', 'test'];
  if (parsed.options.watch) {
    args.push('--', '--watch');
  }
  process.stdout.write(`Running tests${parsed.options.watch ? ' (watch mode)' : ''}...\n`);
  const { spawn } = await import('node:child_process');
  return new Promise(resolve => {
    let settled = false;
    const resolveOnce = (code: number): void => {
      if (settled) { return; }
      settled = true;
      resolve(code);
    };
    const proc = spawn('npm', args, {
      cwd: workspaceRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    proc.on('error', error => {
      process.stderr.write(`Failed to start test command: ${error.message}\n`);
      resolveOnce(1);
    });
    proc.on('close', code => resolveOnce(code ?? 1));
  });
}

function createCliProviderAdapters(): ProviderAdapter[] {
  const secretStore = new EnvSecretStore();
  const adapters: ProviderAdapter[] = [
    new LocalEchoAdapter({
      secrets: secretStore,
      getBaseUrl: () => process.env['ATLASMIND_LOCAL_OPENAI_BASE_URL'],
    }),
  ];

  if (hasSecret('atlasmind.provider.anthropic.apiKey')) {
    adapters.push(new AnthropicAdapter(secretStore));
  }

  const openAiCompatConfigs: Array<ConstructorParameters<typeof OpenAiCompatibleAdapter>[0]> = [
    { providerId: 'openai', compatibilityMode: 'openai-modern-chat', baseUrl: 'https://api.openai.com/v1', secretKey: 'atlasmind.provider.openai.apiKey', displayName: 'OpenAI' },
    { providerId: 'zai', baseUrl: 'https://api.z.ai/api/paas/v4', secretKey: 'atlasmind.provider.zai.apiKey', displayName: 'z.ai' },
    { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', secretKey: 'atlasmind.provider.deepseek.apiKey', displayName: 'DeepSeek' },
    { providerId: 'mistral', baseUrl: 'https://api.mistral.ai/v1', secretKey: 'atlasmind.provider.mistral.apiKey', displayName: 'Mistral' },
    { providerId: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', secretKey: 'atlasmind.provider.google.apiKey', displayName: 'Google Gemini' },
    { providerId: 'xai', baseUrl: 'https://api.x.ai/v1', secretKey: 'atlasmind.provider.xai.apiKey', displayName: 'xAI' },
    { providerId: 'cohere', baseUrl: 'https://api.cohere.ai/compatibility/v1', secretKey: 'atlasmind.provider.cohere.apiKey', displayName: 'Cohere' },
    { providerId: 'huggingface', baseUrl: 'https://router.huggingface.co/v1', secretKey: 'atlasmind.provider.huggingface.apiKey', displayName: 'Hugging Face Inference' },
    { providerId: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1', secretKey: 'atlasmind.provider.nvidia.apiKey', displayName: 'NVIDIA NIM' },
    {
      providerId: 'perplexity',
      baseUrl: 'https://api.perplexity.ai/v1',
      secretKey: 'atlasmind.provider.perplexity.apiKey',
      displayName: 'Perplexity',
      chatCompletionsPath: '/sonar',
      modelsPath: null,
      staticModels: ['sonar', 'sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research'],
    },
  ];

  for (const config of openAiCompatConfigs) {
    if (hasSecret(config.secretKey)) {
      adapters.push(new OpenAiCompatibleAdapter(config, secretStore));
    }
  }

  if (hasSecret('atlasmind.provider.azure.apiKey') && process.env['ATLASMIND_AZURE_OPENAI_ENDPOINT'] && process.env['ATLASMIND_AZURE_OPENAI_DEPLOYMENTS']) {
    adapters.push(new OpenAiCompatibleAdapter(
      {
        providerId: 'azure',
        compatibilityMode: 'openai-modern-chat',
        baseUrl: 'https://example.openai.azure.com',
        resolveBaseUrl: () => process.env['ATLASMIND_AZURE_OPENAI_ENDPOINT'] ?? '',
        resolveChatCompletionsPath: requestModel => `/openai/deployments/${encodeURIComponent(stripProviderPrefix(requestModel))}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`,
        secretKey: 'atlasmind.provider.azure.apiKey',
        displayName: 'Azure OpenAI',
        authHeaderName: 'api-key',
        authScheme: 'raw',
        modelsPath: null,
        modelListProvider: () => (process.env['ATLASMIND_AZURE_OPENAI_DEPLOYMENTS'] ?? '')
          .split(',')
          .map(item => item.trim())
          .filter(Boolean),
      },
      secretStore,
    ));
  }

  return adapters;
}

export function createCliRuntimeHooks(options?: { allowWrites?: boolean }): OrchestratorHooks {
  return {
    toolApprovalGate: createCliToolApprovalGate(options?.allowWrites ?? false),
  };
}

export function createCliToolApprovalGate(allowWrites = false): OrchestratorHooks['toolApprovalGate'] {
  return async (_taskId, toolName, args) => {
    const policy = classifyToolInvocation(toolName, args);

    switch (policy.category) {
      case 'read':
      case 'git-read':
      case 'terminal-read':
        return { approved: true };

      case 'workspace-write':
      case 'git-write':
      case 'terminal-write':
        if (allowWrites) {
          return { approved: true };
        }
        return {
          approved: false,
          reason:
            `CLI blocked write-capable tool "${toolName}" (${policy.summary}). ` +
            'Re-run with --allow-writes if you intentionally want AtlasMind CLI to modify the workspace.',
        };

      default:
        return {
          approved: false,
          reason:
            `CLI blocked external or high-risk tool "${toolName}" (${policy.summary}). ` +
            'AtlasMind CLI only permits read-only tooling by default.',
        };
    }
  };
}

function syncProviderAvailability(modelRouter: AtlasCliRuntime['modelRouter'], adapters: ProviderAdapter[]): void {
  const registeredIds = new Set(adapters.map(adapter => adapter.providerId));
  for (const provider of modelRouter.listProviders()) {
    modelRouter.registerProvider({
      ...provider,
      enabled: registeredIds.has(provider.id),
      models: provider.models.map(model => ({ ...model, enabled: registeredIds.has(provider.id) && model.enabled })),
    });
  }
}

function withRequestedModel(agent: AgentDefinition | undefined, modelId?: string): AgentDefinition | undefined {
  if (!agent) {
    return undefined;
  }
  if (!modelId) {
    return agent;
  }
  return { ...agent, allowedModels: [modelId] };
}

function renderProjectProgress(update: ProjectProgressUpdate): void {
  switch (update.type) {
    case 'planned':
      process.stderr.write(`Planned ${update.plan.subTasks.length} subtask(s).\n`);
      break;
    case 'batch-start':
      process.stderr.write(`Starting batch ${update.batchIndex}/${update.totalBatches}: ${update.subTaskIds.join(', ')}\n`);
      break;
    case 'subtask-start':
      process.stderr.write(`→ ${update.title}\n`);
      break;
    case 'subtask-done':
      process.stderr.write(`✓ ${update.result.title} (${update.completed}/${update.total})\n`);
      break;
    case 'synthesizing':
      process.stderr.write('Synthesizing final report...\n');
      break;
    case 'error':
      process.stderr.write(`Error: ${update.message}\n`);
      break;
  }
}

class EnvSecretStore implements SecretStore {
  async get(key: string): Promise<string | undefined> {
    const value = process.env[toEnvVarName(key)];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }
}

function hasSecret(key: string): boolean {
  const value = process.env[toEnvVarName(key)];
  return typeof value === 'string' && value.trim().length > 0;
}

function toEnvVarName(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function stripProviderPrefix(modelId: string): string {
  const slash = modelId.indexOf('/');
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

function printHelp(): void {
  process.stdout.write([
    'AtlasMind CLI',
    '',
    'Usage:',
    '  atlasmind chat <prompt> [--provider <id>] [--model <provider/model>]',
    '  atlasmind project <goal> [--provider <id>]',
    '  atlasmind memory list',
    '  atlasmind memory query <query>',
    '  atlasmind providers list',
    '  atlasmind build [--dry-run]',
    '  atlasmind lint [--fix]',
    '  atlasmind test [--watch]',
    '',
    'Options:',
    '  --workspace <path>        Run against a specific workspace root',
    '  --ssot <relative-path>    Override the SSOT path (default: project_memory when present)',
    '  --allow-writes           Permit write-capable workspace and git tools in CLI mode',
    '  --budget <mode>           cheap | balanced | expensive | auto',
    '  --speed <mode>            fast | balanced | considered | auto',
    '  --daily-limit-usd <n>     Block requests when the CLI budget would be exceeded',
    '  --json                    Emit machine-readable JSON for supported commands',
    '  --dry-run                 Preview build command without executing (used with build)',
    '  --fix                     Auto-fix lint issues (used with lint)',
    '  --watch                   Run tests in watch mode (used with test)',
    '',
    'Provider configuration:',
    '  The CLI reads provider credentials from environment variables derived from the VS Code secret keys,',
    '  for example ATLASMIND_PROVIDER_OPENAI_APIKEY, ATLASMIND_PROVIDER_ANTHROPIC_APIKEY,',
    '  and ATLASMIND_LOCAL_OPENAI_BASE_URL for local OpenAI-compatible endpoints.',
    '',
  ].join('\n'));
}

if (require.main === module) {
  void main().then(
    exitCode => {
      process.exitCode = exitCode;
    },
    error => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}