import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Each guarded boundary outside the tool loop, exercised for real: with a dry
 * run on, the effect is not invoked and a record is produced; with it off,
 * behaviour is what it was. Processes are mocked at `node:child_process` and
 * the network at `fetch`, so a guard that let something through would show up
 * as a call on the mock rather than as a real deploy.
 */

const childProcess = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  exec: childProcess.exec,
  execFile: childProcess.execFile,
  spawn: childProcess.spawn,
  default: childProcess,
}));

import { DryRunLedger } from '../../src/core/dryRun.ts';
import { DryRunHost, installDryRunHost } from '../../src/core/dryRunHost.ts';
import { RoutineRunner } from '../../src/core/routineRunner.ts';
import { planRoutineExecution } from '../../src/core/routineExecutionPolicy.ts';
import {
  applyPromotionRemediation,
  checkHealthUrl,
  runPromotion,
  runRollback,
} from '../../src/core/promotionRunner.ts';
import { GhClient, runGhOrThrow } from '../../src/core/ghClient.ts';
import { execFileAsync, runRuntimeInstallPlan } from '../../src/mcp/mcpRuntime.ts';
import { BuzzCliBridge } from '../../src/mcp/buzzCliBridge.ts';
import { createArdTransport } from '../../src/ard/ardClient.ts';
import { performHttpProbe } from '../../src/views/lensLiveTransport.ts';
import { performDirectSqlProbe, performSqlHttpProbe } from '../../src/views/lensDatabaseTransport.ts';
import { AtlasMindAcpAgent } from '../../src/acp/atlasMindAcpAgent.ts';
import { parseAcpAgentArgs } from '../../src/cli/acpAgent.ts';
import { McpEnvironmentScanner } from '../../src/mcp/mcpEnvironmentScanner.ts';
import type { DeliveryConfig, DeploymentStage, PromotionPlan, RoutineDefinition } from '../../src/types.ts';

let ledger: DryRunLedger;
let notify: ReturnType<typeof vi.fn<(message: string) => void>>;
let uninstall: (() => void) | undefined;
let dryRun = false;

beforeEach(() => {
  vi.clearAllMocks();
  dryRun = false;
  ledger = new DryRunLedger();
  notify = vi.fn<(message: string) => void>();
  uninstall = installDryRunHost(new DryRunHost({ isEnabled: () => dryRun, record: record => ledger.record(record), notify }));
  childProcess.exec.mockImplementation((_command: string, _options: unknown, callback: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
    callback(null, { stdout: 'ran', stderr: '' });
  });
  childProcess.execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.find(arg => typeof arg === 'function') as (error: Error | null, stdout: string | { stdout: string; stderr: string }, stderr?: string) => void;
    callback(null, 'ran', '');
  });
});

afterEach(() => {
  uninstall?.();
  vi.unstubAllGlobals();
});

function rules(): string[] {
  return ledger.list().map(record => record.rule);
}

// ── Routines and /ship ─────────────────────────────────────────

const ROUTINE: RoutineDefinition = {
  id: 'ship',
  name: 'Ship',
  description: 'Build and publish',
  steps: [
    { id: 'build', label: 'Build', run: 'npm run build', on_fail: 'abort' },
    { id: 'publish', label: 'Publish', run: 'npm publish', on_fail: 'abort' },
  ],
};

describe('RoutineRunner', () => {
  it('runs no step, writes no run history and records the routine in a dry run', async () => {
    dryRun = true;
    const history = { upsertRun: vi.fn() };
    const plan = planRoutineExecution(ROUTINE, {});
    const onProgress = vi.fn();
    const result = await new RoutineRunner(history as never).run(ROUTINE, plan, '/repo', onProgress, vi.fn());

    expect(childProcess.exec).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(history.upsertRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, succeeded: false, steps: [] });
    expect(result.refusedReason).toContain('Dry run is on');
    expect(rules()).toEqual(['dry-run.host-process']);
    expect(ledger.list()[0]!.argsPreview).toContain('npm publish');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('runs every step as before when dry run is off', async () => {
    const history = { upsertRun: vi.fn() };
    const plan = planRoutineExecution(ROUTINE, {});
    const result = await new RoutineRunner(history as never).run(ROUTINE, plan, '/repo', vi.fn(), vi.fn());
    expect(childProcess.exec).toHaveBeenCalledTimes(2);
    expect(result.succeeded).toBe(true);
    expect(result.dryRun).toBeUndefined();
    expect(history.upsertRun).toHaveBeenCalledTimes(1);
    expect(ledger.list()).toEqual([]);
  });
});

// ── Promotion, rollback, remediation, health check ─────────────

function stage(id: string, name: string, over: Partial<DeploymentStage> = {}): DeploymentStage {
  return {
    id,
    name,
    kind: 'staging',
    rank: 1,
    description: '',
    config: {},
    hosting: { healthCheckUrl: 'https://example.com/health' },
    data: {},
    backupPolicy: { required: false },
    promotionPolicy: { requiresApproval: false, requireVersionBump: false, requireChangelog: false, requiredChecks: [] },
    rollbackPolicy: { command: 'npm run rollback' },
    isProtected: false,
    ...over,
  } as DeploymentStage;
}

const FROM = stage('staging', 'Staging');
const TO = stage('production', 'Production');
const CONFIG: DeliveryConfig = { version: 1, stages: [FROM, TO], paths: [{ id: 'p1', fromStageId: 'staging', toStageId: 'production' }] };
const PLAN: PromotionPlan = {
  pathId: 'p1',
  fromStageId: 'staging',
  toStageId: 'production',
  fromName: 'Staging',
  toName: 'Production',
  steps: [
    { id: 'backup-db', kind: 'backup', label: 'Back up', detail: '', command: 'npm run backup', managed: true },
    { id: 'deploy-main', kind: 'deploy', label: 'Deploy', detail: '', command: 'npm run deploy', managed: false },
    { id: 'verify-health', kind: 'verify', label: 'Verify', detail: '', managed: true },
  ],
  checks: [],
  blockers: [],
  requiresApproval: false,
  isProtected: false,
  viaPullRequest: false,
  hasRoutine: false,
};

describe('promotionRunner', () => {
  it('returns the plan as the record and runs no command or health check in a dry run', async () => {
    dryRun = true;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const onProgress = vi.fn();
    const result = await runPromotion({ workspaceRoot: '/repo', plan: PLAN, config: CONFIG, onProgress });

    expect(childProcess.exec).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.succeeded).toBe(false);
    expect(result.steps.map(step => [step.id, step.skipped, step.output])).toEqual([
      ['backup-db', true, 'Dry run: would have run npm run backup'],
      ['deploy-main', true, 'Dry run: would have run npm run deploy'],
      ['verify-health', true, 'Dry run: would have checked https://example.com/health.'],
    ]);
    expect(rules()).toEqual(['dry-run.host-process']);
  });

  it('runs the deploy as before when dry run is off', async () => {
    const result = await runPromotion({
      workspaceRoot: '/repo',
      plan: { ...PLAN, steps: PLAN.steps.filter(step => step.kind !== 'verify') },
      config: CONFIG,
    });
    expect(childProcess.exec).toHaveBeenCalledTimes(2);
    expect(result.succeeded).toBe(true);
    expect(result.dryRun).toBeUndefined();
    expect(ledger.list()).toEqual([]);
  });

  it('runs no rollback command in a dry run, and runs it when off', async () => {
    dryRun = true;
    const held = await runRollback('/repo', 'npm run rollback');
    expect(childProcess.exec).not.toHaveBeenCalled();
    expect(held).toMatchObject({ ok: false, dryRun: true });
    expect(held.output).toContain('npm run rollback');

    dryRun = false;
    const ran = await runRollback('/repo', 'npm run rollback');
    expect(childProcess.exec).toHaveBeenCalledTimes(1);
    expect(ran.ok).toBe(true);
  });

  it('edits and commits nothing for a remediation in a dry run', async () => {
    dryRun = true;
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-dry-remediation-'));
    try {
      const pkg = '{\n  "name": "x",\n  "version": "1.0.0"\n}\n';
      await writeFile(path.join(root, 'package.json'), pkg, 'utf8');
      const result = await applyPromotionRemediation(root, {
        resolves: ['version'], targetVersion: '1.1.0', bumpLevel: 'minor', bumpReason: 'feat',
        editsChangelog: true, commits: true, summary: 'Bump to 1.1.0 and add a changelog entry',
      });
      expect(result).toMatchObject({ ok: false, committed: false, dryRun: true });
      expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(pkg);
      expect(childProcess.execFile).not.toHaveBeenCalled();
      expect(rules()).toEqual(['dry-run.host-git']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('sends no health check in a dry run', async () => {
    dryRun = true;
    const result = await checkHealthUrl('https://example.com/health');
    expect(result).toMatchObject({ ok: false, status: 0 });
    expect(result.error).toContain('Dry run');
    expect(rules()).toEqual(['dry-run.host-network']);
  });
});

// ── gh, and the shared process helper ──────────────────────────

describe('the gh boundary', () => {
  it('refuses a gh write before any process starts, and says so without blaming gh', async () => {
    dryRun = true;
    const run = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const client = new GhClient({ workspaceRoot: '/repo', run });
    const result = await client.exec(['issue', 'create', '--title', 'x', '--body', 'y']);
    expect(run).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.detail).toContain('Dry run is on');
    expect(!result.ok && result.failure.detail).not.toContain('GitHub CLI failed');
    expect(rules()).toEqual(['dry-run.host-github']);
  });

  it('still runs gh reads in a dry run', async () => {
    dryRun = true;
    const run = vi.fn(async () => ({ stdout: '[]', stderr: '' }));
    const client = new GhClient({ workspaceRoot: '/repo', run });
    await expect(client.exec(['issue', 'list', '--json', 'number'])).resolves.toEqual({ ok: true, value: '[]' });
    await expect(client.exec(['api', 'repos/o/r/milestones'])).resolves.toMatchObject({ ok: true });
    expect(run).toHaveBeenCalledTimes(2);
    expect(ledger.list()).toEqual([]);
  });

  it('runs a gh write as before when dry run is off', async () => {
    const run = vi.fn(async () => ({ stdout: 'https://github.com/o/r/issues/1', stderr: '' }));
    const client = new GhClient({ workspaceRoot: '/repo', run });
    await expect(client.exec(['issue', 'create', '--title', 'x', '--body', 'y'])).resolves.toMatchObject({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('throws the notice from runGhOrThrow for a write', async () => {
    dryRun = true;
    await expect(runGhOrThrow('/repo', ['label', 'delete', 'bug', '--yes'])).rejects.toThrow(/Dry run is on/);
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });
});

describe('mcpRuntime', () => {
  it('rejects an installer through the process helper, and lets a version probe run', async () => {
    dryRun = true;
    await expect(execFileAsync('winget', ['install', 'GitHub.cli'])).rejects.toThrow(/Dry run is on/);
    expect(childProcess.execFile).not.toHaveBeenCalled();
    await expect(execFileAsync('node', ['--version'])).resolves.toMatchObject({ stdout: 'ran' });
    expect(childProcess.execFile).toHaveBeenCalledTimes(1);
  });

  it('runs no install plan in a dry run and records it once', async () => {
    dryRun = true;
    const result = await runRuntimeInstallPlan('uvx', {
      packageManager: 'winget', displayName: 'uv', command: 'winget', args: ['install', 'astral-sh.uv'], humanCommand: 'winget install astral-sh.uv',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Dry run is on');
    expect(childProcess.execFile).not.toHaveBeenCalled();
    expect(ledger.list()).toHaveLength(1);
  });

  it('runs an installer when dry run is off', async () => {
    await expect(execFileAsync('winget', ['install', 'GitHub.cli'])).resolves.toMatchObject({ stdout: 'ran' });
    expect(childProcess.execFile).toHaveBeenCalledTimes(1);
  });
});

// ── Messages: Buzz, the ACP agent's Buzz reply ─────────────────

const CHANNEL_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('Buzz', () => {
  const config = { cliPath: 'buzz', relayUrl: 'http://localhost:3000', privateKey: 'a'.repeat(64), allowRemoteRelay: false };

  it('sends no post and opens no DM in a dry run', async () => {
    dryRun = true;
    const executor = { execute: vi.fn() };
    const bridge = new BuzzCliBridge(config, executor);
    await expect(bridge.postMessage(CHANNEL_ID, 'hello')).rejects.toThrow(/Dry run is on/);
    await expect(bridge.sendDirectMessage('c'.repeat(64), 'hello')).rejects.toThrow(/Dry run is on/);
    expect(executor.execute).not.toHaveBeenCalled();
    expect(rules()).toEqual(['dry-run.host-message', 'dry-run.host-message']);
  });

  it('posts as before when dry run is off', async () => {
    const executor = { execute: vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify({ event_id: 'b'.repeat(64), accepted: true }), stderr: '' })) };
    const bridge = new BuzzCliBridge(config, executor);
    await bridge.postMessage(CHANNEL_ID, 'hello').catch(() => undefined);
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('answers the ACP client and publishes nothing to Buzz in a dry run', async () => {
    const publish = vi.fn(async () => true);
    const runtime = {
      orchestrator: {
        processTaskWithAgent: vi.fn(async () => ({
          id: 't', agentId: 'default', modelUsed: 'local/echo', response: 'answer', costUsd: 0, inputTokens: 1, outputTokens: 1, durationMs: 1,
        })),
      },
      agentRegistry: { get: vi.fn(() => ({ id: 'default', name: 'AtlasMind', skills: [] })) },
    };
    const client = { notify: vi.fn(async () => undefined), request: vi.fn() };
    const workspaceRoot = path.resolve('C:/workspace');
    const agent = new AtlasMindAcpAgent({ workspaceRoot, version: '1.0.0', runtime: runtime as never, replyPublisher: { publish } });
    const { sessionId } = await agent.newSession({ cwd: workspaceRoot, mcpServers: [] } as never);

    dryRun = true;
    await agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'hi' }] } as never, client);
    expect(publish).not.toHaveBeenCalled();
    expect(rules()).toEqual(['dry-run.host-message']);

    dryRun = false;
    await agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'hi again' }] } as never, client);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('gives the ACP agent a --dry-run flag, off unless asked for', () => {
    expect(parseAcpAgentArgs([], 'C:/w').options?.dryRun).toBe(false);
    expect(parseAcpAgentArgs(['--dry-run'], 'C:/w').options?.dryRun).toBe(true);
    expect(parseAcpAgentArgs(['--buzz-persona-manifest', 'C:/s/m.json'], 'C:/w').options?.buzzPersonaManifest).toMatch(/m\.json$/);
    expect(parseAcpAgentArgs(['--buzz-persona-manifest'], 'C:/w').errors).toEqual(['Missing value for --buzz-persona-manifest.']);
  });
});

// ── The network: Resource Discovery, live-service probes ───────

describe('network reads that carry somebody\'s data', () => {
  it('sends no Resource Discovery request in a dry run', async () => {
    dryRun = true;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const transport = createArdTransport();
    await expect(transport('https://registry.example.com/search', {
      method: 'POST', headers: {}, body: '{"query":"x"}', timeoutMs: 1000, maxBytes: 1000, trustedLocal: true,
    })).rejects.toThrow(/Dry run is on/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rules()).toEqual(['dry-run.host-network']);
  });

  it('sends no live-service probe in a dry run, and sends it when off', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const request = { kind: 'openapi', method: 'GET', url: 'https://api.example.com/openapi.json', headers: {}, timeoutMs: 1000, maxResponseBytes: 10_000 } as const;

    dryRun = true;
    await expect(performHttpProbe(request as never)).resolves.toMatchObject({ ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();

    dryRun = false;
    await performHttpProbe(request as never);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('opens no database connection and queries no SQL endpoint in a dry run', async () => {
    dryRun = true;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const direct = await performDirectSqlProbe({ kind: 'postgres', dialect: 'postgres', connectionString: 'postgres://u:p@db.example.com/x', timeoutMs: 1000, maxResponseBytes: 1000 } as never, 'db', '2026-10-08T00:00:00Z');
    const overHttp = await performSqlHttpProbe({ kind: 'sql-http', vendor: 'neon', url: 'https://x.neon.tech/sql', connectionString: 'postgres://u:p@x/y', timeoutMs: 1000, maxResponseBytes: 1000 } as never, 'neon', '2026-10-08T00:00:00Z');
    expect(direct).toMatchObject({ ok: false });
    expect(overHttp).toMatchObject({ ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rules()).toEqual(['dry-run.host-network', 'dry-run.host-network']);
    expect(ledger.list().map(record => record.argsPreview).join(' ')).not.toContain('u:p@');
  });
});

// ── Automatic writes ──────────────────────────────────────────

describe('automatic writes', () => {
  it('serves the MCP environment scan from memory and leaves the committed cache alone in a dry run', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-dry-mcpenv-'));
    try {
      dryRun = true;
      const scanner = new McpEnvironmentScanner(root);
      const scan = await scanner.scan();
      expect(scan).toBeDefined();
      await expect(readFile(path.join(root, 'project_memory', 'operations', 'mcp-environment.json'), 'utf8')).rejects.toThrow();
      expect(rules()).toEqual(['dry-run.host-auto-write']);
      expect(notify).not.toHaveBeenCalled();

      dryRun = false;
      await scanner.scan();
      await expect(readFile(path.join(root, 'project_memory', 'operations', 'mcp-environment.json'), 'utf8')).resolves.toContain('"version"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
