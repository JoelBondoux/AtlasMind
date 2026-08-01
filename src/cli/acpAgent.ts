#!/usr/bin/env node
/**
 * AtlasMind as an ACP agent.
 *
 * This process is intentionally stdio-only: an ACP client explicitly launches
 * it for one local connection. It opens no socket and exposes no remote listener.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { createAtlasRuntime } from '../runtime/core.js';
import { NodeMemoryManager } from './nodeMemoryManager.js';
import { NodeCostTracker } from './nodeCostTracker.js';
import { createNodeSkillExecutionContext } from './nodeSkillContext.js';
import {
  AcpPermissionBroker,
  AtlasMindAcpAgent,
} from '../acp/atlasMindAcpAgent.js';
import { BuzzAcpReplyPublisher } from '../acp/buzzReplyPublisher.js';
import {
  BuzzCliBridge,
  loadBuzzCliBridgeConfig,
  type BuzzCliEnvironment,
} from '../mcp/buzzCliBridge.js';
import {
  createCliProviderAdapters,
  resolveCliSsotRoot,
  syncProviderAvailability,
} from './main.js';

interface AcpAgentCliOptions {
  workspaceRoot: string;
  ssotPath?: string;
  dailyLimitUsd: number;
  buzzAutoReply: boolean;
}

export function parseAcpAgentArgs(
  argv: string[],
  cwd = process.cwd(),
): { options?: AcpAgentCliOptions; help: boolean; version: boolean; errors: string[] } {
  let workspaceRoot = cwd;
  let ssotPath: string | undefined;
  let dailyLimitUsd = 0;
  let buzzAutoReply = false;
  let help = false;
  let version = false;
  const errors: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const value = (): string | undefined => {
      const candidate = argv[index + 1];
      if (!candidate || candidate.startsWith('--')) {
        errors.push(`Missing value for ${arg}.`);
        return undefined;
      }
      index += 1;
      return candidate;
    };
    switch (arg) {
      case '--workspace': {
        const candidate = value();
        if (candidate) { workspaceRoot = candidate; }
        break;
      }
      case '--ssot':
        ssotPath = value();
        break;
      case '--daily-limit-usd': {
        const candidate = value();
        const parsed = Number(candidate);
        if (candidate && (!Number.isFinite(parsed) || parsed < 0)) {
          errors.push(`Invalid daily limit "${candidate}". Expected a non-negative number.`);
        } else if (candidate) {
          dailyLimitUsd = parsed;
        }
        break;
      }
      case '--buzz-auto-reply':
        buzzAutoReply = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      case '--version':
        version = true;
        break;
      default:
        errors.push(`Unknown option: ${arg}`);
        break;
    }
  }

  return {
    options: errors.length === 0
      ? {
        workspaceRoot: path.resolve(workspaceRoot),
        ssotPath,
        dailyLimitUsd,
        buzzAutoReply,
      }
      : undefined,
    help,
    version,
    errors,
  };
}

export async function runAcpAgent(
  options: AcpAgentCliOptions,
  streams: { stdin: NodeJS.ReadableStream; stdout: NodeJS.WritableStream } = {
    stdin: process.stdin,
    stdout: process.stdout,
  },
): Promise<void> {
  const version = await readAtlasMindVersion();
  const memoryManager = new NodeMemoryManager();
  const ssotRoot = await resolveCliSsotRoot(options.workspaceRoot, options.ssotPath);
  if (ssotRoot && await pathExists(ssotRoot)) {
    await memoryManager.loadFromDisk(ssotRoot);
  }

  const costTracker = new NodeCostTracker(options.dailyLimitUsd);
  const skillContext = createNodeSkillExecutionContext(options.workspaceRoot, memoryManager);
  const adapters = createCliProviderAdapters();
  const permissionBroker = new AcpPermissionBroker();
  const runtime = createAtlasRuntime({
    memoryStore: memoryManager,
    costTracker,
    skillContext,
    providerAdapters: adapters,
    hooks: {
      toolApprovalGate: (taskId, toolName, args) =>
        permissionBroker.authorize(taskId, toolName, args),
    },
  });
  syncProviderAvailability(runtime.modelRouter, adapters);

  let replyPublisher: BuzzAcpReplyPublisher | undefined;
  if (options.buzzAutoReply) {
    const bridge = new BuzzCliBridge(loadBuzzCliBridgeConfig({
      ...(process.env as BuzzCliEnvironment),
      ATLASMIND_BUZZ_ENABLED: 'true',
    }));
    await bridge.assertReady();
    replyPublisher = new BuzzAcpReplyPublisher(bridge);
  }

  const implementation = new AtlasMindAcpAgent({
    workspaceRoot: options.workspaceRoot,
    version,
    runtime,
    permissionBroker,
    replyPublisher,
    log: message => process.stderr.write(`[atlasmind-acp] ${message}\n`),
  });

  // Keep the ESM-only official SDK behind a dynamic import so AtlasMind's
  // CommonJS extension/CLI build remains compatible with VS Code's host.
  const acp = await import('@agentclientprotocol/sdk');
  const output = Writable.toWeb(streams.stdout as NodeJS.WritableStream) as WritableStream<Uint8Array>;
  const input = Readable.toWeb(streams.stdin as NodeJS.ReadableStream) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(output, input);
  const connection = acp
    .agent({ name: 'atlasmind' })
    .onRequest('initialize', ctx => implementation.initialize(ctx.params))
    .onRequest('authenticate', async () => ({}))
    .onRequest('session/new', ctx => implementation.newSession(ctx.params))
    .onRequest('session/prompt', ctx => implementation.prompt(ctx.params, ctx.client))
    .onNotification('session/cancel', ctx => implementation.cancel(ctx.params))
    .connect(stream);
  await connection.closed;
}

export async function runAcpAgentCli(): Promise<number> {
  const parsed = parseAcpAgentArgs(process.argv.slice(2));
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      process.stderr.write(`${error}\n`);
    }
    process.stderr.write('\n');
    printHelp(process.stderr);
    return 1;
  }
  if (parsed.help) {
    printHelp(process.stdout);
    return 0;
  }
  if (parsed.version) {
    process.stdout.write(`AtlasMind ACP agent ${await readAtlasMindVersion()}\n`);
    return 0;
  }
  await runAcpAgent(parsed.options!);
  return 0;
}

function printHelp(output: NodeJS.WritableStream): void {
  output.write([
    'AtlasMind ACP Agent (stdio)',
    '',
    'Usage:',
    '  atlasmind-acp --workspace <absolute-path> [options]',
    '',
    'Options:',
    '  --workspace <path>       Restrict the agent to this workspace (default: current directory)',
    '  --ssot <relative-path>   Override the SSOT path (default: project_memory)',
    '  --daily-limit-usd <n>    Stop model requests at this daily cost ceiling',
    '  --buzz-auto-reply        Publish final answers through Buzz’s communication-only CLI bridge',
    '  --help                   Show this help',
    '  --version                Show the AtlasMind version',
    '',
    'Provider credentials are read from the same ATLASMIND_PROVIDER_* environment variables as',
    'the AtlasMind CLI. The process is local stdio only and opens no listening socket.',
    '',
  ].join('\n'));
}

async function readAtlasMindVersion(): Promise<string> {
  try {
    const packagePath = path.resolve(__dirname, '..', '..', 'package.json');
    const parsed = JSON.parse(await fs.readFile(packagePath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

if (require.main === module) {
  void runAcpAgentCli().then(
    code => { process.exitCode = code; },
    error => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
