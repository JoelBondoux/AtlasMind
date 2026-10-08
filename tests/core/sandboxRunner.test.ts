import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The execution sandbox's runner, end to end with a fake engine.
 *
 * Processes are mocked at `node:child_process`, so a path that ran something on
 * the host instead of handing it to the engine shows up as a call on the mock —
 * the property every test here is ultimately about.
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

import {
  SANDBOX_COVERED_PATHS,
  SANDBOX_HOST_PATHS,
  SANDBOX_ORPHAN_MIN_AGE_MS,
  SANDBOX_REFUSED_EXIT_CODE,
  SANDBOX_REPROBE_BUDGET_MS,
  SandboxHost,
  createSandboxProcessRunner,
  describeSandboxRefusal,
  hostExecutionRefusal,
  installSandboxHost,
  installedSandboxHost,
  isSandboxDependencyRefusal,
  selectSandboxOrphans,
  type SandboxCommandRequest,
  type SandboxHostDeps,
  type SandboxProcessOutcome,
} from '../../src/core/sandboxRunner.ts';
import {
  SANDBOX_TMPFS,
  type SandboxConfiguration,
  type SandboxEngine,
  type SandboxHostFacts,
  type SandboxMode,
  type SandboxProbe,
} from '../../src/core/sandboxPlan.ts';
import {
  SandboxProbeCache,
  readSandboxConfiguration,
  readSandboxModeSetting,
  type SandboxConfigurationReading,
  type SandboxProbeReport,
} from '../../src/core/sandboxProbe.ts';
import { DryRunLedger } from '../../src/core/dryRun.ts';
import { DryRunHost, installDryRunHost } from '../../src/core/dryRunHost.ts';
import { RoutineRunner } from '../../src/core/routineRunner.ts';
import { planRoutineExecution } from '../../src/core/routineExecutionPolicy.ts';
import type { RoutineDefinition } from '../../src/types.ts';
import type { WorkspaceCommandProbe } from '../../src/core/windowsShimBypass.ts';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIGEST = `sha256:${'0123456789abcdef'.repeat(4)}`;
const IMAGE = `ghcr.io/atlasmind/sandbox-node@${DIGEST}`;
const NOW = new Date('2026-10-08T12:00:00.000Z');
const HOST: SandboxHostFacts = { os: 'linux', user: { uid: 1000, gid: 1000 }, homeDir: '/home/joel' };
const ROOT = '/home/joel/dev/app';
const NAME = `atlasmind-sbx-r${NOW.getTime().toString(36).padStart(9, '0')}deadbeef`;

function configuration(overrides: Partial<SandboxConfiguration> = {}): SandboxConfiguration {
  return { mode: 'require', engine: 'auto', image: IMAGE, cpus: 2, memoryGb: 4, ...overrides };
}

function probeReading(overrides: Partial<SandboxProbe> = {}): SandboxProbeReport {
  return {
    probe: {
      engine: 'docker',
      cliPresent: true,
      infoOk: true,
      serverOs: 'linux',
      arch: 'x86_64',
      runtimes: ['runc'],
      rootless: false,
      image: IMAGE,
      imageDigest: DIGEST,
      canary: 'passed',
      probedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      ...overrides,
    },
    steps: [],
  };
}

interface Call { engine: SandboxEngine; argv: string[]; timeoutMs: number }

interface Harness {
  host: SandboxHost;
  calls: Call[];
  cache: SandboxProbeCache;
  probe: ReturnType<typeof vi.fn<(configuration: SandboxConfiguration, root: string) => Promise<SandboxProbeReport>>>;
  readConfiguration: ReturnType<typeof vi.fn<() => SandboxConfigurationReading>>;
  setMode: (mode: SandboxMode) => void;
  setNow: (date: Date) => void;
  script: (fn: (call: Call) => SandboxProcessOutcome | Promise<SandboxProcessOutcome>) => void;
}

function harness(options: {
  mode?: SandboxMode;
  reading?: SandboxProbeReport | undefined;
  config?: SandboxConfiguration;
  probeResult?: () => Promise<SandboxProbeReport>;
  readMode?: () => SandboxMode;
  dependencies?: SandboxHostDeps['dependencies'] | null;
} = {}): Harness {
  let mode: SandboxMode = options.mode ?? 'require';
  let now = NOW;
  const calls: Call[] = [];
  let respond: (call: Call) => SandboxProcessOutcome | Promise<SandboxProcessOutcome> = () => (
    { kind: 'exited', exitCode: 0, stdout: 'ok', stderr: '' }
  );
  const cache = new SandboxProbeCache();
  const initial = 'reading' in options ? options.reading : probeReading();
  if (initial) {
    cache.record(initial);
  }
  const probe = vi.fn<(configuration: SandboxConfiguration, root: string) => Promise<SandboxProbeReport>>(
    options.probeResult ?? (async () => probeReading({ probedAt: now.toISOString() })),
  );
  const readConfiguration = vi.fn<() => SandboxConfigurationReading>(() => ({
    configuration: options.config ?? configuration(),
    problems: [],
    ignored: [],
  }));
  const deps: SandboxHostDeps = {
    readMode: options.readMode ?? (() => mode),
    readConfiguration,
    cache,
    probe,
    run: async (engine, argv, { timeoutMs }) => {
      const call = { engine, argv: [...argv], timeoutMs };
      calls.push(call);
      return respond(call);
    },
    host: HOST,
    now: () => now,
    realpath: async target => target,
    randomHex: () => 'deadbeef',
    // A folder with no package.json unless a test says otherwise: these tests
    // are about the container, and `sandboxDependencies` has its own.
    ...(options.dependencies === null
      ? {}
      : { dependencies: options.dependencies ?? (async root => ({ status: 'not-a-node-project' as const, root, reason: 'No package.json.' })) }),
  };
  return {
    host: new SandboxHost(deps),
    calls,
    cache,
    probe,
    readConfiguration,
    setMode: next => { mode = next; },
    setNow: date => { now = date; },
    script: fn => { respond = fn; },
  };
}

function request(overrides: Partial<SandboxCommandRequest> = {}): SandboxCommandRequest {
  return { executable: 'npm', args: ['test'], root: ROOT, cwd: ROOT, env: {}, timeoutMs: 30_000, ...overrides };
}

let uninstall: Array<() => void> = [];

beforeEach(() => {
  vi.clearAllMocks();
  uninstall = [];
});

afterEach(() => {
  for (const undo of uninstall) {
    undo();
  }
  vi.useRealTimers();
});

describe('SandboxHost.runCommand — in the container', () => {
  it('hands the engine the exact constant-shaped argv, and only allowlisted environment', async () => {
    const h = harness();
    const result = await h.host.runCommand(request({
      cwd: `${ROOT}/packages/web`,
      env: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-secret', CI: 'true', NODE_OPTIONS: '--require ./evil.js' },
    }));

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.engine).toBe('docker');
    expect(h.calls[0]!.argv).toEqual([
      'run', '--rm', '--init', '--pull', 'never',
      '--name', NAME,
      '--label', 'atlasmind.sandbox=1',
      '--network', 'none',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--read-only',
      '--tmpfs', SANDBOX_TMPFS,
      '--pids-limit', '512',
      '--cpus', '2',
      '--memory', '4096m',
      '--memory-swap', '4096m',
      '--user', '1000:1000',
      '--mount', `type=bind,source=${ROOT},target=/work`,
      '--workdir', '/work/packages/web',
      '--env', 'HOME=/tmp',
      '--env', 'TMPDIR=/tmp',
      '--env', 'CI=true',
      IMAGE, 'npm', 'test',
    ]);
    expect(h.calls[0]!.argv.join(' ')).not.toContain('sk-ant-secret');
    expect(h.calls[0]!.argv.join(' ')).not.toContain('PATH=');
    expect(result).toMatchObject({ ok: true, exitCode: 0, stdout: 'ok' });
    // A rejected allowlisted name is named, never its value.
    expect(result.stderr).toContain('NODE_OPTIONS');
    expect(result.stderr).not.toContain('evil');
    expect(h.host.liveContainers()).toEqual([]);
  });

  it('passes the command\'s own exit code through, and clips its output the way runCommand does', async () => {
    const h = harness();
    h.script(() => ({ kind: 'exited', exitCode: 3, stdout: `${'x'.repeat(70 * 1024)}TAIL`, stderr: 'boom' }));
    const result = await h.host.runCommand(request());
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.stdout.startsWith('…[earlier output truncated]')).toBe(true);
    expect(result.stdout.endsWith('TAIL')).toBe(true);
    expect(result.stderr).toBe('boom');
  });

  it('on a timeout, removes the container by its own name from the host', async () => {
    const h = harness();
    h.script(call => (call.argv[0] === 'run'
      ? { kind: 'timeout', stdout: 'partial', stderr: '' }
      : { kind: 'exited', exitCode: 0, stdout: '', stderr: '' }));
    const result = await h.host.runCommand(request({ timeoutMs: 5_000 }));
    expect(h.calls.map(call => call.argv)).toEqual([expect.arrayContaining(['run']), ['rm', '--force', NAME]]);
    expect(h.calls[0]!.timeoutMs).toBe(5_000);
    expect(result.ok).toBe(false);
    expect(result.stdout).toBe('partial');
    expect(result.stderr).toContain(`the container ${NAME} was removed`);
    expect(h.host.liveContainers()).toEqual([]);
  });

  it('removes the container whenever the CLI did not exit on its own, not only on a timeout', async () => {
    const h = harness();
    h.script(call => (call.argv[0] === 'run'
      ? { kind: 'error', detail: 'The command wrote more than 4 MiB of output, so it was stopped.' }
      : { kind: 'exited', exitCode: 0, stdout: '', stderr: '' }));
    const result = await h.host.runCommand(request());
    expect(h.calls[1]!.argv).toEqual(['rm', '--force', NAME]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('4 MiB');
  });

  it('mounts a scheduled run\'s worktree, and nothing else', async () => {
    const worktree = `${ROOT}/.git/atlasmind-worktrees/scheduled-nightly-20261008-1200`;
    const h = harness();
    const result = await h.host.runCommand(request({ executable: 'sh', args: ['-c', 'npm run build'], root: worktree, cwd: worktree }));
    expect(result.ok).toBe(true);
    const argv = h.calls[0]!.argv;
    expect(argv.filter(arg => arg === '--mount')).toHaveLength(1);
    expect(argv).toContain(`type=bind,source=${worktree},target=/work`);
    expect(argv.slice(-3)).toEqual(['sh', '-c', 'npm run build']);
  });

  it('a command reported missing by the engine CLI is refused, not run elsewhere', async () => {
    const h = harness();
    h.script(() => ({ kind: 'not-found', detail: 'docker was not found on PATH.' }));
    const result = await h.host.runCommand(request());
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toMatch(/^Not run: sandbox unavailable — /);
    expect(childProcess.execFile).not.toHaveBeenCalled();
    expect(childProcess.exec).not.toHaveBeenCalled();
  });
});

describe('SandboxHost.runCommand — refused, never the host', () => {
  it('refuses git under require, naming the rule, and starts nothing', async () => {
    const h = harness();
    const result = await h.host.runCommand(request({ executable: 'git', args: ['commit', '-m', 'x'] }));
    expect(result).toMatchObject({ ok: false, exitCode: SANDBOX_REFUSED_EXIT_CODE, stdout: '' });
    expect(result.stderr).toMatch(/^Not run: never run in the sandbox — /);
    expect(result.stderr).toContain('[rule: eligibility/git');
    expect(h.calls).toEqual([]);
  });

  it('refuses when the sandbox is unavailable, and does not re-probe a fresh unavailable reading', async () => {
    const h = harness({ reading: probeReading({ canary: 'failed' }) });
    const result = await h.host.runCommand(request());
    expect(result.stderr).toMatch(/^Not run: sandbox unavailable — /);
    expect(result.stderr).toContain('attestation/canary-passed');
    expect(result.stderr).toContain('Check Execution Sandbox');
    expect(h.probe).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it('refuses when the settings cannot be used, rather than guessing', async () => {
    const h = harness();
    h.readConfiguration.mockReturnValue({ problems: ['atlasmind.sandbox.cpus must be a number.'], ignored: [] });
    const result = await h.host.runCommand(request());
    expect(result.stderr).toContain('the sandbox settings cannot be used: atlasmind.sandbox.cpus must be a number.');
    expect(h.calls).toEqual([]);
    expect(h.probe).not.toHaveBeenCalled();
  });

  it('refuses a host path as the executable — the container has no such file', async () => {
    const h = harness();
    const result = await h.host.runCommand(request({ executable: '/usr/local/bin/node' }));
    expect(result.stderr).toContain('argv/executable');
    expect(h.calls).toEqual([]);
  });

  it('routes every command to the engine or a refusal, whatever the command and the reading (property)', async () => {
    const executables = fc.constantFrom(
      'npm', 'node', 'npx', 'git', 'gh', 'curl', 'docker', 'bash', 'sh', 'pytest', './node_modules/.bin/vitest',
      'C:\\tools\\node.exe', '/bin/sh', '../escape', '',
    );
    const readings = fc.constantFrom('fresh', 'failed-canary', 'stale', 'absent', 'other-image', 'windows-engine');
    await fc.assert(fc.asyncProperty(
      executables,
      fc.array(fc.string({ maxLength: 12 }), { maxLength: 4 }),
      readings,
      async (executable, args, state) => {
        const reading = state === 'absent'
          ? undefined
          : probeReading({
            ...(state === 'failed-canary' ? { canary: 'failed' as const } : {}),
            ...(state === 'stale' ? { probedAt: new Date(NOW.getTime() - 11 * 60_000).toISOString() } : {}),
            ...(state === 'other-image' ? { image: `x/y@sha256:${'f'.repeat(64)}` } : {}),
            ...(state === 'windows-engine' ? { serverOs: 'windows' } : {}),
          });
        // A re-probe, when one happens, reads an engine that does not answer.
        const h = harness({
          reading,
          probeResult: async () => probeReading({ cliPresent: false, probedAt: NOW.toISOString() }),
        });
        const result = await h.host.runCommand(request({ executable, args }));
        for (const call of h.calls) {
          expect(['docker', 'podman']).toContain(call.engine);
          expect(['run', 'rm']).toContain(call.argv[0]);
        }
        const ran = h.calls.some(call => call.argv[0] === 'run');
        if (ran) {
          expect(state).toBe('fresh');
          expect(result.exitCode).toBe(0);
        } else {
          expect(result.ok).toBe(false);
          expect(result.stderr.startsWith('Not run:')).toBe(true);
        }
        expect(childProcess.execFile).not.toHaveBeenCalled();
        expect(childProcess.exec).not.toHaveBeenCalled();
      },
    ), { numRuns: 150 });
  });
});

describe('the reading a command rests on', () => {
  it('re-probes a stale reading once, mounting the folder the command runs in, and then runs', async () => {
    const h = harness({ reading: probeReading({ probedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString() }) });
    const result = await h.host.runCommand(request());
    expect(h.probe).toHaveBeenCalledTimes(1);
    expect(h.probe.mock.calls[0]![1]).toBe(ROOT);
    expect(result.ok).toBe(true);
  });

  it('re-probes a reading taken of a different image', async () => {
    const h = harness({ reading: probeReading({ image: `other/img@sha256:${'a'.repeat(64)}` }) });
    await h.host.runCommand(request());
    expect(h.probe).toHaveBeenCalledTimes(1);
  });

  it('shares one probe between commands that arrive together', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const h = harness({
      reading: undefined,
      probeResult: async () => {
        await gate;
        return probeReading({ probedAt: NOW.toISOString() });
      },
    });
    const first = h.host.runCommand(request());
    const second = h.host.runCommand(request({ args: ['run', 'lint'] }));
    await Promise.resolve();
    release();
    const results = await Promise.all([first, second]);
    expect(h.probe).toHaveBeenCalledTimes(1);
    expect(results.every(result => result.ok)).toBe(true);
  });

  it('gives up on a probe that outlasts its budget, and refuses', async () => {
    vi.useFakeTimers();
    const h = harness({ reading: undefined, probeResult: () => new Promise<SandboxProbeReport>(() => undefined) });
    const pending = h.host.runCommand(request());
    await vi.advanceTimersByTimeAsync(SANDBOX_REPROBE_BUDGET_MS);
    const result = await pending;
    expect(result.stderr).toMatch(/^Not run: sandbox unavailable — /);
    expect(result.stderr).toContain('attestation/probed');
    expect(h.calls).toEqual([]);
  });
});

describe('one session, one decision', () => {
  it('a bound session decides, even if the cache changes after it was opened', async () => {
    const h = harness();
    const session = await h.host.openSession(ROOT);
    expect(session.mode).toBe('require');
    expect(session.attestation?.status).toBe('confirmed');
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.configuration)).toBe(true);
    h.cache.record(probeReading({ canary: 'failed' }));
    const result = await h.host.runCommand(request(), session);
    expect(result.ok).toBe(true);
    expect(h.probe).not.toHaveBeenCalled();
  });

  it('a bound session that has expired is refused, never re-probed', async () => {
    const h = harness();
    const session = await h.host.openSession(ROOT);
    h.setNow(new Date(NOW.getTime() + 15 * 60_000));
    const result = await h.host.runCommand(request(), session);
    expect(result.stderr).toContain('plan/attestation-expired');
    expect(h.probe).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it('honours only a session this host opened — one assembled elsewhere is refused, whatever it claims', async () => {
    const h = harness();
    const genuine = await h.host.openSession(ROOT);
    const forged = { ...genuine };
    const result = await h.host.runCommand(request(), forged);
    expect(result.stderr).toContain('was not opened by AtlasMind\'s sandbox host');
    expect(h.calls).toEqual([]);
    // Another host's session is no better.
    const other = await harness().host.openSession(ROOT);
    expect((await h.host.runCommand(request(), other)).stderr).toContain('was not opened');
    expect(h.calls).toEqual([]);
  });

  it('the tighter of the session and the settings wins', async () => {
    const h = harness({ mode: 'off' });
    const off = await h.host.openSession(ROOT);
    expect(off).toMatchObject({ mode: 'off', problems: [] });
    expect(off.attestation).toBeUndefined();
    expect(h.host.isRequired(off)).toBe(false);
    h.setMode('require');
    expect(h.host.isRequired(off)).toBe(true);
    const required = await h.host.openSession(ROOT);
    h.setMode('off');
    expect(h.host.isRequired(required)).toBe(true);
  });

  it('reads an unreadable mode as require', () => {
    const h = harness({ readMode: () => { throw new Error('no settings'); } });
    expect(h.host.liveMode()).toBe('require');
    expect(h.host.isRequired()).toBe(true);
  });
});

describe('mode off is untouched', () => {
  it('asks only the mode: no settings, no probe, no engine (property)', async () => {
    await fc.assert(fc.asyncProperty(fc.string(), fc.array(fc.string(), { maxLength: 3 }), async () => {
      const h = harness({ mode: 'off' });
      expect(h.host.isRequired()).toBe(false);
      expect((await h.host.sweepOrphans()).removed).toEqual([]);
      expect(h.readConfiguration).not.toHaveBeenCalled();
      expect(h.probe).not.toHaveBeenCalled();
      expect(h.calls).toEqual([]);
    }), { numRuns: 25 });
  });

  it('keeps runCommand\'s host path exactly as it was, behind one early return under require', () => {
    const source = readFileSync(path.join(ROOT_DIR, 'src', 'extension.ts'), 'utf8');
    const start = source.indexOf('    async runCommand(executable, args, options) {');
    const end = source.indexOf('    testResourceBudget() {', start);
    const body = source.slice(start, end);
    const gate = body.indexOf('if (sandboxHost?.isRequired(sandboxSession)) {');
    const hostPath = body.indexOf('const resolution = resolveWorkspaceCommand(');
    expect(gate).toBeGreaterThan(0);
    expect(hostPath).toBeGreaterThan(gate);
    // The sandbox branch returns; it never falls through to the host.
    expect(body.slice(gate, hostPath)).toMatch(/return sandboxHost\.runCommand\(/);
    // The host branch itself is the one it always was.
    const host = body.slice(hostPath);
    expect(host).toContain('shell: false');
    expect(host).toContain('os.setPriority(pending.child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)');
    expect(host).toContain('maxBuffer: 4 * 1024 * 1024');
    expect(host).toContain('clipCommandOutput(stdout)');
  });
});

describe('dry run wins', () => {
  function installDry(isEnabled: () => boolean): DryRunLedger {
    const ledger = new DryRunLedger();
    uninstall.push(installDryRunHost(new DryRunHost({ isEnabled, record: record => ledger.record(record) })));
    return ledger;
  }

  it('records the command and starts nothing — not even a probe', async () => {
    const ledger = installDry(() => true);
    const h = harness({ reading: undefined });
    const result = await h.host.runCommand(request());
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('Dry run is on');
    expect(h.probe).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
    expect(ledger.list()).toHaveLength(1);
    expect(ledger.list()[0]!.summary).toContain('in the execution sandbox');
  });

  it('a switch turned on between the decision and the spawn still stops the engine launch', async () => {
    let checks = 0;
    installDry(() => {
      checks += 1;
      return checks > 1;
    });
    const h = harness();
    const result = await h.host.runCommand(request());
    expect(result.stderr).toContain('Dry run is on');
    expect(h.calls).toEqual([]);
  });

  it('a sweep in a dry run lists, and removes nothing', async () => {
    installDry(() => true);
    const h = harness();
    const old = `atlasmind-sbx-r${(NOW.getTime() - SANDBOX_ORPHAN_MIN_AGE_MS - 1).toString(36).padStart(9, '0')}00000000`;
    h.script(call => ({ kind: 'exited', exitCode: 0, stdout: call.argv[0] === 'ps' ? old : '', stderr: '' }));
    const report = await h.host.sweepOrphans();
    expect(report.removed).toEqual([]);
    expect(h.calls.map(call => call.argv[0])).toEqual(['ps', 'ps']);
  });
});

describe('orphans', () => {
  const at = (ms: number, suffix = '00000000') => `atlasmind-sbx-r${ms.toString(36).padStart(9, '0')}${suffix}`;

  it('selects only this runner\'s containers that no live call can own', () => {
    const old = at(NOW.getTime() - SANDBOX_ORPHAN_MIN_AGE_MS);
    const young = at(NOW.getTime() - 60_000);
    const live = at(NOW.getTime() - SANDBOX_ORPHAN_MIN_AGE_MS - 5, 'aaaaaaaa');
    const future = at(NOW.getTime() + 60_000);
    const names = [old, young, live, future, 'atlasmind-sbx-canary0123456789ab', 'my-own-container', ` ${old} `, ''];
    expect(selectSandboxOrphans(names, NOW, new Set([live]))).toEqual([old, old]);
  });

  it('sweeps under require: lists by label, removes the old ones by name', async () => {
    const h = harness();
    const old = at(NOW.getTime() - SANDBOX_ORPHAN_MIN_AGE_MS - 1);
    const young = at(NOW.getTime() - 1_000);
    h.script(call => ({ kind: 'exited', exitCode: 0, stdout: call.engine === 'docker' && call.argv[0] === 'ps' ? `${old}\n${young}\n` : '', stderr: '' }));
    const report = await h.host.sweepOrphans();
    expect(report.removed).toEqual([old]);
    expect(h.calls[0]).toMatchObject({ engine: 'docker', argv: ['ps', '--all', '--filter', 'label=atlasmind.sandbox=1', '--format', '{{.Names}}'] });
    expect(h.calls).toContainEqual(expect.objectContaining({ engine: 'docker', argv: ['rm', '--force', old] }));
    expect(h.calls.flatMap(call => call.argv)).not.toContain(young);
  });

  it('on deactivation, removes this window\'s live containers by name', async () => {
    const h = harness();
    let finish!: (outcome: SandboxProcessOutcome) => void;
    h.script(call => (call.argv[0] === 'run'
      ? new Promise<SandboxProcessOutcome>(resolve => { finish = resolve; })
      : { kind: 'exited', exitCode: 0, stdout: '', stderr: '' }));
    const pending = h.host.runCommand(request());
    await vi.waitFor(() => expect(h.host.liveContainers()).toEqual([NAME]));
    expect(await h.host.stopOwnContainers()).toEqual([NAME]);
    expect(h.calls[1]!.argv).toEqual(['rm', '--force', NAME]);
    finish({ kind: 'exited', exitCode: 137, stdout: '', stderr: 'killed' });
    expect((await pending).exitCode).toBe(137);
  });
});

describe('the installed host and the paths that ask it', () => {
  it('no host installed reads as off; an installed require host refuses host-only paths', async () => {
    expect(installedSandboxHost()).toBeUndefined();
    expect(hostExecutionRefusal('a debug session')).toBeUndefined();
    const h = harness();
    uninstall.push(installSandboxHost(h.host));
    expect(installedSandboxHost()).toBe(h.host);
    expect(hostExecutionRefusal('a debug session')).toMatch(/^Not run: atlasmind\.sandbox\.mode is require, and a debug session runs on this machine/);
    h.setMode('off');
    expect(hostExecutionRefusal('a debug session')).toBeUndefined();
  });

  it('every covered path asks the installed host', () => {
    const asks = /installedSandboxHost\(\)|hostExecutionRefusal\(/;
    for (const row of SANDBOX_COVERED_PATHS) {
      expect(readFileSync(path.join(ROOT_DIR, row.file), 'utf8'), row.id).toMatch(asks);
    }
    const extension = readFileSync(path.join(ROOT_DIR, 'src', 'extension.ts'), 'utf8');
    expect(extension).toContain('hostExecutionRefusal(\'an ACP agent\\\'s command\')');
    expect(extension).toContain('hostExecutionRefusal(\'a debug session\', sandboxSession)');
    expect(extension).toContain('hostExecutionRefusal(\'evaluating an expression in a debug session\', sandboxSession)');
    expect(extension).toContain('installSandboxHost(sandboxHost)');
    expect(extension).toContain('stopOwnContainers()');
    const chat = readFileSync(path.join(ROOT_DIR, 'src', 'views', 'chatPanel.ts'), 'utf8');
    expect(chat).toContain('hostExecutionRefusal(\'a managed-terminal follow-up command\')');
    const routine = readFileSync(path.join(ROOT_DIR, 'src', 'core', 'routineRunner.ts'), 'utf8');
    expect(routine.indexOf('installedSandboxHost()')).toBeLessThan(routine.indexOf('await execAsync(command'));
    expect(SANDBOX_HOST_PATHS.map(row => row.id)).toEqual(['git-tools', 'operator-surfaces', 'mcp-tools', 'synthesized-skills', 'cli']);
  });

  it('reads the mode by the tightest-scope rule, the same as the full reading', () => {
    const value = fc.option(fc.constantFrom('off', 'require', 'prefer', ''), { nil: undefined });
    fc.assert(fc.property(value, value, value, (globalValue, workspaceValue, workspaceFolderValue) => {
      const inspection = { globalValue, workspaceValue, workspaceFolderValue };
      expect(readSandboxModeSetting(inspection)).toBe(
        readSandboxConfiguration(key => (key === 'mode' ? inspection : undefined)).configuration?.mode,
      );
    }));
  });
});

describe('routine steps under require', () => {
  const ROUTINE: RoutineDefinition = {
    id: 'check',
    name: 'Check',
    description: 'Build and test',
    steps: [
      { id: 'build', label: 'Build', run: 'npm run build', on_fail: 'abort' },
      { id: 'test', label: 'Test', run: 'npm test', on_fail: 'abort' },
    ],
  };

  it('run in the sandbox as sh -c, never through the host shell', async () => {
    const h = harness();
    uninstall.push(installSandboxHost(h.host));
    const history = { upsertRun: vi.fn() };
    const result = await new RoutineRunner(history as never).run(ROUTINE, planRoutineExecution(ROUTINE, {}), ROOT, vi.fn(), vi.fn());
    expect(result.succeeded).toBe(true);
    expect(h.calls.map(call => call.argv.slice(-3))).toEqual([['sh', '-c', 'npm run build'], ['sh', '-c', 'npm test']]);
    expect(childProcess.exec).not.toHaveBeenCalled();
  });

  it('are refused, and stop the routine, when the sandbox is unavailable', async () => {
    const h = harness({ reading: probeReading({ canary: 'failed' }) });
    uninstall.push(installSandboxHost(h.host));
    const history = { upsertRun: vi.fn() };
    const result = await new RoutineRunner(history as never).run(ROUTINE, planRoutineExecution(ROUTINE, {}), ROOT, vi.fn(), vi.fn());
    expect(result.succeeded).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.exitCode).toBe(SANDBOX_REFUSED_EXIT_CODE);
    expect(result.steps[0]!.stderr).toMatch(/^Not run: sandbox unavailable/);
    expect(childProcess.exec).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it('run on the host exactly as before under off', async () => {
    const h = harness({ mode: 'off' });
    uninstall.push(installSandboxHost(h.host));
    childProcess.exec.mockImplementation((_command: string, _options: unknown, callback: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      callback(null, { stdout: 'ran', stderr: '' });
    });
    const history = { upsertRun: vi.fn() };
    const result = await new RoutineRunner(history as never).run(ROUTINE, planRoutineExecution(ROUTINE, {}), ROOT, vi.fn(), vi.fn());
    expect(result.succeeded).toBe(true);
    expect(childProcess.exec).toHaveBeenCalledTimes(2);
    expect(h.calls).toEqual([]);
  });
});

describe('describeSandboxRefusal', () => {
  it('leads with what kind of refusal it is and names the rule', () => {
    expect(describeSandboxRefusal({ route: 'refuse', stage: 'argv', rule: 'mount-sensitive', reason: 'The folder is your home.' }))
      .toBe('Not run: the sandbox cannot run it as asked — The folder is your home. [rule: argv/mount-sensitive; atlasmind.sandbox.mode is require]');
  });
});

describe('createSandboxProcessRunner', () => {
  const posix: WorkspaceCommandProbe = {
    platform: 'linux',
    findExecutable: () => undefined,
    exists: () => false,
    readText: () => undefined,
  } as unknown as WorkspaceCommandProbe;

  function respond(error: Error | null, stdout = '', stderr = ''): void {
    childProcess.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args.find(arg => typeof arg === 'function') as (e: Error | null, out: string, err: string) => void;
      callback(error, stdout, stderr);
    });
  }

  it('starts the engine with an argument vector and never a shell', async () => {
    respond(null, 'out', 'err');
    const outcome = await createSandboxProcessRunner(posix)('docker', ['run', 'a b', '&&', 'x'], { timeoutMs: 1234 });
    expect(outcome).toEqual({ kind: 'exited', exitCode: 0, stdout: 'out', stderr: 'err' });
    const [command, argv, options] = childProcess.execFile.mock.calls[0]!;
    expect(command).toBe('docker');
    expect(argv).toEqual(['run', 'a b', '&&', 'x']);
    expect(options).toMatchObject({ shell: false, timeout: 1234, windowsHide: true });
  });

  it('reads a non-zero exit, a missing CLI, a timeout and an output overflow as four different things', async () => {
    const run = createSandboxProcessRunner(posix);
    respond(Object.assign(new Error('exit'), { code: 2 }), 'o', 'e');
    expect(await run('docker', ['run'], { timeoutMs: 1 })).toEqual({ kind: 'exited', exitCode: 2, stdout: 'o', stderr: 'e' });
    respond(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    expect((await run('docker', ['run'], { timeoutMs: 1 })).kind).toBe('not-found');
    respond(Object.assign(new Error('slow'), { killed: true, signal: 'SIGTERM' }), 'partial');
    expect(await run('podman', ['run'], { timeoutMs: 1 })).toEqual({ kind: 'timeout', stdout: 'partial', stderr: '' });
    respond(Object.assign(new Error('big'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }));
    expect((await run('docker', ['run'], { timeoutMs: 1 })).kind).toBe('error');
  });

  it('refuses to start anything but docker or podman', async () => {
    const outcome = await createSandboxProcessRunner(posix)('bash' as SandboxEngine, ['-c', 'x'], { timeoutMs: 1 });
    expect(outcome.kind).toBe('error');
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });
});

describe('installed dependencies', () => {
  const VOLUME = 'atlasmind-deps-0123456789abcdef';
  const READY = {
    status: 'ready' as const, root: ROOT, volume: VOLUME, key: '0123456789abcdef'.repeat(4), manager: 'npm',
    lockfile: 'package-lock.json', installScripts: false, preparedAt: '2026-10-08T11:00:00.000Z',
  };

  it('refuses a command that loads packages when none are prepared — exit 126, no engine call, and a scheduled run can tell why', async () => {
    const h = harness({
      dependencies: async root => ({ status: 'not-prepared', root, rule: 'prepared', reason: 'No dependencies are prepared for this package-lock.json.' }),
    });
    const result = await h.host.runCommand(request());
    expect(result).toMatchObject({ ok: false, exitCode: SANDBOX_REFUSED_EXIT_CODE });
    expect(result.stderr).toMatch(/^Not run: dependencies not prepared — No dependencies are prepared/);
    expect(result.stderr).toContain('[rule: dependencies/dependencies-not-prepared');
    expect(isSandboxDependencyRefusal(result.stderr)).toBe(true);
    expect(h.calls).toEqual([]);
    expect(childProcess.execFile).not.toHaveBeenCalled();
    expect(childProcess.exec).not.toHaveBeenCalled();
  });

  it('mounts the ready volume over node_modules, read for the folder the command mounts', async () => {
    const reader = vi.fn(async () => READY);
    const h = harness({ dependencies: reader });
    const result = await h.host.runCommand(request());
    expect(result.ok).toBe(true);
    expect(reader).toHaveBeenCalledWith(ROOT, expect.objectContaining({ status: 'confirmed' }));
    expect(h.calls[0]!.argv).toContain(`type=volume,source=${VOLUME},target=/work/node_modules`);
  });

  it('with no reader, the state is not assessed: packages are refused, other commands still run', async () => {
    const h = harness({ dependencies: null });
    expect((await h.host.runCommand(request())).stderr).toContain('dependencies/dependencies-not-assessed');
    expect((await h.host.runCommand(request({ executable: 'make', args: ['lint'] }))).ok).toBe(true);
  });

  it('a reader that throws is not ready, and says so', async () => {
    const h = harness({ dependencies: async () => { throw new Error('disk gone'); } });
    const result = await h.host.runCommand(request());
    expect(result.stderr).toContain('dependencies not prepared');
    expect(result.stderr).toContain('disk gone');
    expect(h.calls).toEqual([]);
  });

  it('a bound session carries the state it was opened with; another folder\'s state does not count', async () => {
    const h = harness({ dependencies: async root => ({ ...READY, root }) });
    const session = await h.host.openSession(ROOT);
    expect(session.dependencies).toMatchObject({ status: 'ready', root: ROOT });
    expect(Object.isFrozen(session.dependencies)).toBe(true);
    const elsewhere = await h.host.runCommand(request({ root: '/home/joel/dev/other', cwd: '/home/joel/dev/other' }), session);
    expect(elsewhere.stderr).toContain('dependencies/dependencies-not-assessed');
    expect((await h.host.runCommand(request(), session)).ok).toBe(true);
  });

  it('isSandboxDependencyRefusal reads only the refusal itself', () => {
    expect(isSandboxDependencyRefusal('npm ERR! [rule: dependencies/x]')).toBe(false);
    expect(isSandboxDependencyRefusal('Not run: sandbox unavailable — x [rule: attestation/probed; atlasmind.sandbox.mode is require]')).toBe(false);
  });

  it('a scheduled run whose test step needs dependencies reports "not prepared", never a failed test', async () => {
    const h = harness({
      dependencies: async root => ({ status: 'not-prepared', root, rule: 'prepared', reason: 'No dependencies are prepared.' }),
    });
    uninstall.push(installSandboxHost(h.host));
    const routine: RoutineDefinition = {
      id: 'nightly', name: 'Nightly', description: '', steps: [{ id: 'test', label: 'Run the tests', run: 'npm test', on_fail: 'abort' }],
    };
    const history = { upsertRun: vi.fn() };
    const result = await new RoutineRunner(history as never).run(routine, planRoutineExecution(routine, {}), ROOT, vi.fn(), vi.fn());
    expect(result.succeeded).toBe(false);
    expect(isSandboxDependencyRefusal(result.steps[0]!.stderr)).toBe(true);
    expect(childProcess.exec).not.toHaveBeenCalled();
  });
});
