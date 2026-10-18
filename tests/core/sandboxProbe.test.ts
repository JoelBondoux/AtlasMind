import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SANDBOX_CANARY_COMMAND,
  SANDBOX_ENGINE_ORDER,
  SANDBOX_SETTING_DEFAULTS,
  SANDBOX_SETTING_RULES,
  SandboxProbeCache,
  createSandboxEngineRunner,
  describeSandboxRemediation,
  probeSandbox,
  readSandboxConfiguration,
  readSandboxHostFacts,
  renderSandboxCheckReport,
  repoDigestsInclude,
  sharedSandboxProbeCache,
  type SandboxEngineRunner,
  type SandboxProbeReport,
  type SandboxRunOutcome,
  type SandboxSettingInspection,
  type SandboxSettingKey,
} from '../../src/core/sandboxProbe.ts';
import {
  SANDBOX_ATTESTATION_RULES,
  SANDBOX_PROBE_MAX_AGE_MS,
  assessSandboxAttestation,
  type SandboxConfiguration,
  type SandboxEngine,
  type SandboxHostFacts,
} from '../../src/core/sandboxPlan.ts';
import { DryRunHost, installDryRunHost } from '../../src/core/dryRunHost.ts';
import type { WorkspaceCommandProbe } from '../../src/core/windowsShimBypass.ts';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const DIGEST = `sha256:${'0123456789abcdef'.repeat(4)}`;
const IMAGE = `ghcr.io/atlasmind/sandbox-node@${DIGEST}`;
const NOW = new Date('2026-10-08T12:00:00.000Z');
const LINUX_HOST: SandboxHostFacts = { os: 'linux', user: { uid: 1000, gid: 1000 }, homeDir: '/home/joel' };
const WIN_HOST: SandboxHostFacts = { os: 'win32', homeDir: 'C:\\Users\\joel' };
const ROOT = '/home/joel/dev/app';

const DOCKER_INFO = JSON.stringify({
  OSType: 'linux', Architecture: 'x86_64', NCPU: 8, MemTotal: 16 * 1024 ** 3,
  ServerVersion: '27.1.0', Runtimes: { runc: {}, 'io.containerd.runc.v2': {} },
  SecurityOptions: ['name=seccomp,profile=builtin', 'name=cgroupns'],
});
const PODMAN_INFO = JSON.stringify({
  host: {
    os: 'linux', arch: 'amd64', cpus: 4, memTotal: 8 * 1024 ** 3,
    security: { rootless: true }, ociRuntime: { name: 'crun' },
  },
});

function configuration(overrides: Partial<SandboxConfiguration> = {}): SandboxConfiguration {
  return { mode: 'require', engine: 'auto', image: IMAGE, cpus: 2, memoryGb: 4, ...overrides };
}

type Script = Partial<Record<string, SandboxRunOutcome | ((args: readonly string[]) => SandboxRunOutcome)>>;

/**
 * A fake engine. Keys are `<engine> <first arg>`; anything unscripted is a
 * missing CLI, so a test only states what it is about.
 */
function fakeRunner(script: Script): { runner: SandboxEngineRunner; calls: Array<{ engine: SandboxEngine; args: string[]; timeoutMs: number }> } {
  const calls: Array<{ engine: SandboxEngine; args: string[]; timeoutMs: number }> = [];
  const runner: SandboxEngineRunner = async (engine, args, timeoutMs) => {
    calls.push({ engine, args: [...args], timeoutMs });
    const key = `${engine} ${args[0] ?? ''}`;
    const entry = script[key] ?? script[`${engine} ${args.slice(0, 2).join(' ')}`];
    if (!entry) {
      return { ok: false, kind: 'not-found', detail: `${engine} was not found on PATH.` };
    }
    return typeof entry === 'function' ? entry(args) : entry;
  };
  return { runner, calls };
}

const HEALTHY_DOCKER: Script = {
  'docker --version': { ok: true, stdout: 'Docker version 27.1.0, build abc' },
  'docker info': { ok: true, stdout: DOCKER_INFO },
  'docker image inspect': { ok: true, stdout: JSON.stringify([`ghcr.io/atlasmind/sandbox-node@${DIGEST}`]) },
  'docker run': { ok: true, stdout: '' },
};

async function probe(script: Script, overrides: Partial<Parameters<typeof probeSandbox>[0]> = {}) {
  const fake = fakeRunner(script);
  const report = await probeSandbox({
    configuration: configuration(),
    host: LINUX_HOST,
    canaryRoot: ROOT,
    runner: fake.runner,
    now: () => NOW,
    runId: () => 'canary0123456789',
    ...overrides,
  });
  const attestation = assessSandboxAttestation(report.probe, overrides.configuration ?? configuration(), NOW);
  return { report, attestation, calls: fake.calls };
}

describe('probeSandbox — a healthy engine', () => {
  it('reads Docker, finds the pinned image, runs the canary, and is confirmed by the B1 rules', async () => {
    const { report, attestation, calls } = await probe(HEALTHY_DOCKER);
    expect(report.probe).toMatchObject({
      engine: 'docker', cliPresent: true, infoOk: true, serverOs: 'linux', arch: 'x64',
      rootless: false, image: IMAGE, imageDigest: DIGEST, canary: 'passed', probedAt: NOW.toISOString(),
    });
    expect(attestation.status).toBe('confirmed');
    expect(calls.map(call => `${call.engine} ${call.args[0]}`)).toEqual([
      'docker --version', 'docker info', 'docker image', 'docker run',
    ]);
  });

  it('runs the canary through buildSandboxArgv: no network, one mount, the constant test command, never pulled', async () => {
    const { report, calls } = await probe(HEALTHY_DOCKER);
    const run = calls.find(call => call.args[0] === 'run')!;
    expect(run.args).toEqual(report.canaryArgv);
    expect(run.args).toContain('--network');
    expect(run.args[run.args.indexOf('--network') + 1]).toBe('none');
    expect(run.args[run.args.indexOf('--pull') + 1]).toBe('never');
    expect(run.args.filter(arg => arg === '--mount')).toHaveLength(1);
    expect(run.args).toContain(`type=bind,source=${ROOT},target=/work`);
    expect(run.args.slice(-4)).toEqual([IMAGE, SANDBOX_CANARY_COMMAND.executable, ...SANDBOX_CANARY_COMMAND.args]);
    expect(run.args).toContain('--name');
    expect(run.args[run.args.indexOf('--name') + 1]).toBe('atlasmind-sbx-canary0123456789');
  });

  it('only ever inspects the validated reference, after the format flag', async () => {
    const { calls } = await probe(HEALTHY_DOCKER);
    const inspect = calls.find(call => call.args[0] === 'image')!;
    expect(inspect.args).toEqual(['image', 'inspect', '--format', '{{json .RepoDigests}}', IMAGE]);
  });

  it('reads rootless Podman from its own info shape', async () => {
    const { report, attestation } = await probe({
      'podman --version': { ok: true, stdout: 'podman version 5.2.0' },
      'podman info': { ok: true, stdout: PODMAN_INFO },
      'podman image inspect': { ok: true, stdout: JSON.stringify([`ghcr.io/atlasmind/sandbox-node@${DIGEST}`]) },
      'podman run': { ok: true, stdout: '' },
    });
    expect(report.probe).toMatchObject({ engine: 'podman', rootless: true, serverOs: 'linux', arch: 'x64', runtimes: ['crun'] });
    expect(attestation.status).toBe('confirmed');
    expect(report.canaryArgv).toContain('keep-id');
  });
});

describe('probeSandbox — engine order', () => {
  it('tries Docker before Podman under auto, and stops at the first engine that answers', async () => {
    expect(SANDBOX_ENGINE_ORDER).toEqual(['docker', 'podman']);
    const { calls } = await probe(HEALTHY_DOCKER);
    expect(calls.some(call => call.engine === 'podman')).toBe(false);
  });

  it('falls through to Podman when Docker is installed but its engine does not answer', async () => {
    const { report } = await probe({
      'docker --version': { ok: true, stdout: 'Docker version 27' },
      'docker info': { ok: false, kind: 'exit', detail: 'Cannot connect to the Docker daemon' },
      'podman --version': { ok: true, stdout: 'podman version 5' },
      'podman info': { ok: true, stdout: PODMAN_INFO },
    });
    expect(report.probe.engine).toBe('podman');
    expect(report.probe.infoOk).toBe(true);
  });

  it('reports the installed engine when none answers, not the absent one', async () => {
    const { report, attestation } = await probe({
      'docker --version': { ok: true, stdout: 'Docker version 27' },
      'docker info': { ok: false, kind: 'exit', detail: 'Cannot connect to the Docker daemon' },
    });
    expect(report.probe.engine).toBe('docker');
    expect(attestation).toMatchObject({ status: 'unavailable', rule: 'engine-answers' });
  });

  it('tries only the named engine when one is configured', async () => {
    const { calls, attestation } = await probe(HEALTHY_DOCKER, { configuration: configuration({ engine: 'podman' }) });
    expect(calls.every(call => call.engine === 'podman')).toBe(true);
    expect(attestation).toMatchObject({ status: 'unavailable', rule: 'cli-present' });
  });
});

describe('probeSandbox — every failure is a named unavailable reason', () => {
  const cases: Array<[string, Script, Partial<Parameters<typeof probeSandbox>[0]>, string]> = [
    ['no engine installed', {}, {}, 'cli-present'],
    ['engine not running', { ...HEALTHY_DOCKER, 'docker info': { ok: false, kind: 'exit', detail: 'daemon not running' } }, {}, 'engine-answers'],
    ['engine answers unreadably', { ...HEALTHY_DOCKER, 'docker info': { ok: true, stdout: '{"ServerErrors":["x"]}' } }, {}, 'engine-answers'],
    ['engine times out', { ...HEALTHY_DOCKER, 'docker info': { ok: false, kind: 'timeout', detail: '' } }, {}, 'engine-answers'],
    ['Windows-container mode', { ...HEALTHY_DOCKER, 'docker info': { ok: true, stdout: DOCKER_INFO.replace('"linux"', '"windows"') } }, {}, 'linux-engine'],
    ['rootless unknown', {
      ...HEALTHY_DOCKER,
      'docker info': { ok: true, stdout: JSON.stringify({ OSType: 'linux', Architecture: 'x86_64', NCPU: 8, MemTotal: 1e10 }) },
    }, {}, 'user-namespace-known'],
    ['rootless Docker', {
      ...HEALTHY_DOCKER,
      'docker info': { ok: true, stdout: DOCKER_INFO.replace('"name=cgroupns"', '"name=rootless"') },
    }, {}, 'user-namespace-known'],
    ['no image configured', HEALTHY_DOCKER, { configuration: configuration({ image: '' }) }, 'image-pinned'],
    ['tag-only image', HEALTHY_DOCKER, { configuration: configuration({ image: 'node:22' }) }, 'image-pinned'],
    ['image absent locally', { ...HEALTHY_DOCKER, 'docker image inspect': { ok: false, kind: 'exit', detail: 'No such image' } }, {}, 'image-present'],
    ['image present under another digest', { ...HEALTHY_DOCKER, 'docker image inspect': { ok: true, stdout: '["x@sha256:' + 'f'.repeat(64) + '"]' } }, {}, 'image-present'],
    ['canary fails', { ...HEALTHY_DOCKER, 'docker run': { ok: false, kind: 'exit', detail: 'invalid mount config' } }, {}, 'canary-passed'],
    ['canary times out', { ...HEALTHY_DOCKER, 'docker run': { ok: false, kind: 'timeout', detail: '' }, 'docker rm': { ok: true, stdout: '' } }, {}, 'canary-passed'],
    ['no folder open', HEALTHY_DOCKER, { canaryRoot: undefined }, 'canary-passed'],
    ['folder refused by the argv rules', HEALTHY_DOCKER, { canaryRoot: '/home/joel' }, 'canary-passed'],
    ['runner throws', { ...HEALTHY_DOCKER, 'docker run': () => { throw new Error('boom'); } }, {}, 'canary-passed'],
  ];

  it.each(cases)('%s', async (_name, script, overrides, rule) => {
    const { attestation, report } = await probe(script, overrides);
    expect(attestation).toMatchObject({ status: 'unavailable', rule });
    expect(report.steps.length).toBeGreaterThan(0);
    for (const step of report.steps) {
      expect(step.detail.length).toBeGreaterThan(0);
    }
  });

  it('does not hand an unpinned image to the engine at all', async () => {
    const { calls } = await probe(HEALTHY_DOCKER, { configuration: configuration({ image: '--help' }) });
    expect(calls.some(call => call.args.includes('--help'))).toBe(false);
    expect(calls.some(call => call.args[0] === 'image')).toBe(false);
  });

  it('does not start a canary when an earlier rule already fails', async () => {
    const { calls, report } = await probe({
      ...HEALTHY_DOCKER,
      'docker info': { ok: true, stdout: DOCKER_INFO.replace('"linux"', '"windows"') },
    });
    expect(calls.some(call => call.args[0] === 'run')).toBe(false);
    expect(report.steps.find(step => step.id === 'canary')).toMatchObject({ outcome: 'skipped' });
    expect(report.probe.canary).toBe('not-run');
  });

  it('removes a timed-out canary by its name and nothing else', async () => {
    const { calls, report } = await probe({
      ...HEALTHY_DOCKER,
      'docker run': { ok: false, kind: 'timeout', detail: '' },
      'docker rm': { ok: true, stdout: '' },
    });
    expect(calls.at(-1)!.args).toEqual(['rm', '--force', 'atlasmind-sbx-canary0123456789']);
    expect(report.probe.canary).toBe('failed');
    expect(report.steps.at(-1)).toMatchObject({ id: 'canary-cleanup', outcome: 'ok' });
  });

  it('redacts and bounds what an engine says before a person reads it', async () => {
    const secret = `sk-ant-api03-${'a'.repeat(90)}`;
    const { report } = await probe({
      ...HEALTHY_DOCKER,
      'docker run': { ok: false, kind: 'exit', detail: `\u001b[31merror\u001b[0m ${secret}\n${'x'.repeat(2000)}` },
    });
    const canary = report.steps.find(step => step.id === 'canary')!;
    expect(canary.detail).not.toContain(secret);
    expect(canary.detail).not.toContain('\u001b');
    expect(canary.detail.length).toBeLessThanOrEqual(300);
  });

  it('dates the reading when it starts, never later', async () => {
    let tick = 0;
    const { report } = await probe(HEALTHY_DOCKER, { now: () => new Date(NOW.getTime() + (tick++) * 60_000) });
    expect(report.probe.probedAt).toBe(NOW.toISOString());
  });

  it('is never confirmed unless a canary actually ran and passed (property)', async () => {
    const outcome = fc.oneof(
      fc.constant<SandboxRunOutcome>({ ok: true, stdout: '' }),
      fc.constantFrom<SandboxRunOutcome['ok']>(false).map(() => ({ ok: false, kind: 'exit', detail: 'x' }) as SandboxRunOutcome),
      fc.constant<SandboxRunOutcome>({ ok: false, kind: 'dry-run', detail: 'x' }),
      fc.constant<SandboxRunOutcome>({ ok: false, kind: 'timeout', detail: '' }),
    );
    await fc.assert(fc.asyncProperty(outcome, outcome, outcome, outcome, async (version, info, image, run) => {
      const script: Script = {
        'docker --version': version,
        'docker info': info.ok ? { ok: true, stdout: DOCKER_INFO } : info,
        'docker image inspect': image.ok ? HEALTHY_DOCKER['docker image inspect'] : image,
        'docker run': run,
        'docker rm': { ok: true, stdout: '' },
      };
      const { attestation, calls } = await probe(script, { configuration: configuration({ engine: 'docker' }) });
      const canaryRan = calls.some(call => call.args[0] === 'run');
      if (attestation.status === 'confirmed') {
        expect(canaryRan && run.ok).toBe(true);
      }
    }), { numRuns: 120 });
  });
});

describe('probeSandbox — dry run', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  it('reads the engine but never starts the canary, so the sandbox is unavailable, not confirmed', async () => {
    const records: unknown[] = [];
    uninstall = installDryRunHost(new DryRunHost({ isEnabled: () => true, record: record => records.push(record) }));
    // The real runner, with a command probe that can resolve nothing — so if the
    // guard ever let the canary through, it would fail as not-found rather than
    // start a real container on the machine running the tests.
    const guarded = createSandboxEngineRunner({
      platform: 'win32',
      findExecutable: () => undefined,
      fileExists: () => false,
      readDirectory: () => [],
      readJsonFile: () => undefined,
    } satisfies WorkspaceCommandProbe);
    const reads = fakeRunner(HEALTHY_DOCKER).runner;
    const runner: SandboxEngineRunner = (engine, args, timeoutMs) => (
      args[0] === 'run' ? guarded(engine, args, timeoutMs) : reads(engine, args, timeoutMs)
    );
    const { report, attestation } = await probe({}, { runner });
    expect(report.probe.canary).toBe('not-run');
    expect(report.steps.find(step => step.id === 'canary')).toMatchObject({ outcome: 'blocked' });
    expect(attestation).toMatchObject({ status: 'unavailable', rule: 'canary-passed' });
    expect(records).toHaveLength(1);
  });

  it('grades every probe read as a read and the canary as an effect', async () => {
    const { classifyHostCommand } = await import('../../src/core/dryRun.ts');
    for (const engine of ['docker', 'podman'] as const) {
      expect(classifyHostCommand(engine, ['--version']).kind).toBe('read');
      expect(classifyHostCommand(engine, engine === 'docker' ? ['info', '--format', '{{json .}}'] : ['info', '--format', 'json']).kind).toBe('read');
      expect(classifyHostCommand(engine, ['image', 'inspect', '--format', '{{json .RepoDigests}}', IMAGE]).kind).toBe('read');
    }
    const { report } = await probe(HEALTHY_DOCKER);
    expect(classifyHostCommand('docker', report.canaryArgv!).kind).toBe('effect');
    expect(classifyHostCommand('docker', ['rm', '--force', 'atlasmind-sbx-x']).kind).toBe('effect');
  });
});

describe('the default runner', () => {
  it('refuses to start a script shim as the engine, and never a shell', async () => {
    const runner = createSandboxEngineRunner({
      platform: 'win32',
      findExecutable: name => (name === 'docker' ? 'C:\\tools\\docker.cmd' : name === 'node' ? 'C:\\node\\node.exe' : undefined),
      fileExists: () => true,
      readDirectory: () => ['docker-cli'],
      readJsonFile: () => ({ name: 'docker-cli', bin: { docker: 'bin/docker.js' } }),
    });
    const outcome = await runner('docker', ['--version'], 1000);
    expect(outcome).toMatchObject({ ok: false, kind: 'not-found' });
  });

  it('reports an engine missing from PATH as not found', async () => {
    const runner = createSandboxEngineRunner({
      platform: 'win32',
      findExecutable: () => undefined,
      fileExists: () => false,
      readDirectory: () => [],
      readJsonFile: () => undefined,
    });
    expect(await runner('podman', ['--version'], 1000)).toMatchObject({ ok: false, kind: 'not-found' });
  });

  it('only runs docker or podman', async () => {
    const runner = createSandboxEngineRunner();
    expect(await runner('bash' as SandboxEngine, ['-c', 'true'], 1000)).toMatchObject({ ok: false, kind: 'error' });
  });

  it('is written with execFile and an argument vector, never a shell', () => {
    const source = readFileSync(path.join(ROOT_DIR, 'src', 'core', 'sandboxProbe.ts'), 'utf8');
    expect(source).toMatch(/execFile\(\s*resolution\.command,\s*resolution\.args/);
    expect(source).not.toMatch(/shell\s*:\s*true/);
    expect(source).not.toMatch(/\bspawn\(|\bexecSync\(|\bexec\(/);
    expect(source).toContain("guardHostCommand('sandbox', engine, args)");
  });
});

describe('repoDigestsInclude', () => {
  it('matches the pinned digest whatever name the engine records', () => {
    expect(repoDigestsInclude(JSON.stringify([`docker.io/library/node@${DIGEST}`]), DIGEST)).toBe(true);
    expect(repoDigestsInclude(JSON.stringify([`node@${DIGEST}`]), DIGEST)).toBe(true);
    expect(repoDigestsInclude('null', DIGEST)).toBe(false);
    expect(repoDigestsInclude('not json', DIGEST)).toBe(false);
    expect(repoDigestsInclude(JSON.stringify([`node@${DIGEST}extra`]), DIGEST)).toBe(false);
  });
});

describe('SandboxProbeCache', () => {
  async function reading(at: Date): Promise<SandboxProbeReport> {
    const { report } = await probe(HEALTHY_DOCKER, { now: () => at });
    return report;
  }

  it('keeps a reading fresh for exactly the B1 window, and never one dated in the future', async () => {
    const cache = new SandboxProbeCache();
    expect(cache.fresh(NOW)).toBeUndefined();
    cache.record(await reading(NOW));
    expect(cache.fresh(NOW)).toBeDefined();
    expect(cache.fresh(new Date(NOW.getTime() + SANDBOX_PROBE_MAX_AGE_MS - 1))).toBeDefined();
    expect(cache.fresh(new Date(NOW.getTime() + SANDBOX_PROBE_MAX_AGE_MS))).toBeUndefined();
    expect(cache.fresh(new Date(NOW.getTime() - 1))).toBeUndefined();
    expect(cache.latest()).toBeDefined();
  });

  it('agrees with the attestation about staleness (property)', async () => {
    const cache = new SandboxProbeCache();
    cache.record(await reading(NOW));
    fc.assert(fc.property(fc.integer({ min: -60_000, max: 2 * SANDBOX_PROBE_MAX_AGE_MS }), offset => {
      const at = new Date(NOW.getTime() + offset);
      const confirmed = cache.attestation(configuration(), at).status === 'confirmed';
      expect(confirmed).toBe(cache.fresh(at) !== undefined);
    }));
  });

  it('says a reading is for another image when the settings changed since', async () => {
    const cache = new SandboxProbeCache();
    cache.record(await reading(NOW));
    const other = `ghcr.io/atlasmind/other@sha256:${'1'.repeat(64)}`;
    expect(cache.attestation(configuration({ image: other }), NOW)).toMatchObject({ status: 'unavailable', rule: 'image-present' });
  });

  it('is one shared instance', () => {
    expect(sharedSandboxProbeCache()).toBe(sharedSandboxProbeCache());
  });
});

describe('readSandboxConfiguration', () => {
  function reader(values: Partial<Record<SandboxSettingKey, SandboxSettingInspection>>) {
    return (key: SandboxSettingKey) => values[key];
  }

  it('reads the declared defaults when nothing is set', () => {
    expect(readSandboxConfiguration(reader({}))).toEqual({
      configuration: { ...SANDBOX_SETTING_DEFAULTS },
      problems: [],
      ignored: [],
    });
    expect(SANDBOX_SETTING_DEFAULTS).toEqual({ mode: 'off', engine: 'auto', image: '', cpus: 2, memoryGb: 4 });
  });

  it('never reads a workspace image, engine or limit, and says it ignored them', () => {
    const hostile = `evil.example/x@sha256:${'e'.repeat(64)}`;
    const result = readSandboxConfiguration(reader({
      image: { globalValue: IMAGE, workspaceValue: hostile },
      engine: { workspaceFolderValue: 'podman' },
      cpus: { workspaceValue: 64 },
      memoryGb: { workspaceValue: 256 },
    }));
    expect(result.configuration).toMatchObject({ image: IMAGE, engine: 'auto', cpus: 2, memoryGb: 4 });
    expect(result.ignored).toHaveLength(4);
    expect(result.ignored.join(' ')).toContain('atlasmind.sandbox.image');
  });

  it('takes the tightest mode: a workspace can require the sandbox, never switch it off', () => {
    expect(readSandboxConfiguration(reader({ mode: { workspaceValue: 'require' } })).configuration?.mode).toBe('require');
    expect(readSandboxConfiguration(reader({ mode: { globalValue: 'require', workspaceValue: 'off' } })).configuration?.mode).toBe('require');
    expect(readSandboxConfiguration(reader({ mode: { globalValue: 'off', workspaceFolderValue: 'off' } })).configuration?.mode).toBe('off');
    expect(readSandboxConfiguration(reader({ mode: { globalValue: 'prefer' } })).configuration?.mode).toBe('require');
  });

  it('a mode can only ever be loosened by every scope agreeing (property)', () => {
    const value = fc.option(fc.constantFrom('off', 'require', 'prefer', ''), { nil: undefined });
    fc.assert(fc.property(value, value, value, (globalValue, workspaceValue, workspaceFolderValue) => {
      const mode = readSandboxConfiguration(reader({ mode: { globalValue, workspaceValue, workspaceFolderValue } })).configuration?.mode;
      const anyRequire = [globalValue, workspaceValue, workspaceFolderValue].some(v => v !== undefined && v !== 'off');
      expect(mode).toBe(anyRequire ? 'require' : 'off');
    }));
  });

  it('refuses a value it cannot use rather than coercing it', () => {
    const result = readSandboxConfiguration(reader({
      engine: { globalValue: 'dokcer' },
      image: { globalValue: 42 },
      cpus: { globalValue: '2' },
      memoryGb: { globalValue: Number.NaN },
    }));
    expect(result.configuration).toBeUndefined();
    expect(result.problems).toHaveLength(4);
  });

  it('publishes a read rule for every setting', () => {
    expect(Object.keys(SANDBOX_SETTING_RULES).sort()).toEqual(['cpus', 'engine', 'image', 'memoryGb', 'mode']);
  });
});

describe('the sandbox settings in package.json', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')) as {
    contributes: { configuration: unknown; commands: Array<{ command: string; title: string }> };
  };
  const sections = Array.isArray(manifest.contributes.configuration)
    ? manifest.contributes.configuration as Array<{ properties: Record<string, Record<string, unknown>> }>
    : [manifest.contributes.configuration as { properties: Record<string, Record<string, unknown>> }];
  const properties = Object.assign({}, ...sections.map(section => section.properties)) as Record<string, Record<string, unknown>>;

  it('declares all five, closed by default', () => {
    expect(properties['atlasmind.sandbox.mode']).toMatchObject({ default: 'off', enum: ['off', 'require'] });
    expect(properties['atlasmind.sandbox.engine']).toMatchObject({ default: 'auto', enum: ['auto', 'docker', 'podman'] });
    expect(properties['atlasmind.sandbox.image']).toMatchObject({ default: '' });
    expect(properties['atlasmind.sandbox.cpus']).toMatchObject({ default: 2, minimum: 0.25, maximum: 64 });
    expect(properties['atlasmind.sandbox.memoryGb']).toMatchObject({ default: 4, minimum: 0.5, maximum: 256 });
  });

  it('declares the approval relaxation off by default and readable only from your user settings', () => {
    // 0.501.0 added it (this test used to assert its absence, before the
    // relaxation existed). Off, and machine-scoped so a repository's value is
    // never the one that loosens your approvals.
    expect(properties['atlasmind.sandbox.relaxTerminalApprovals']).toMatchObject({ type: 'boolean', default: false, scope: 'machine' });
  });

  it('machine-scopes everything a repository must not choose', () => {
    for (const key of ['engine', 'image', 'cpus', 'memoryGb']) {
      expect(properties[`atlasmind.sandbox.${key}`]!['scope']).toBe('machine');
    }
  });

  it('says require refuses rather than falling back to your machine, and no longer calls itself unenforced', () => {
    // 0.500.0 wired the runner: the "not enforced yet" wording this test used
    // to require would now be false, so it is required to be gone.
    const description = String(properties['atlasmind.sandbox.mode']!['description']);
    const markdown = String(properties['atlasmind.sandbox.mode']!['markdownDescription']);
    expect(description).toContain('never on your machine instead');
    expect(markdown).toContain('**refused**');
    expect(`${description} ${markdown}`.toLowerCase()).not.toContain('not enforced');
  });

  it('declares no prefer mode', () => {
    expect(JSON.stringify(properties['atlasmind.sandbox.mode'])).not.toContain('"prefer"');
  });

  it('suggests a digest-pinned image pattern the runtime agrees with', () => {
    const pattern = new RegExp(String(properties['atlasmind.sandbox.image']!['pattern']));
    expect(pattern.test('')).toBe(true);
    expect(pattern.test(IMAGE)).toBe(true);
    expect(pattern.test('node:22')).toBe(false);
    expect(pattern.test(`node:22@${DIGEST}`)).toBe(false);
  });

  it('contributes the check command', () => {
    expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({
      command: 'atlasmind.checkExecutionSandbox',
      title: 'AtlasMind: Check Execution Sandbox',
    }));
  });
});

describe('readSandboxHostFacts', () => {
  it('names the ssh agent so it is never mounted, and only an absolute one', () => {
    const facts = readSandboxHostFacts({ SSH_AUTH_SOCK: process.platform === 'win32' ? 'C:\\agent.sock' : '/tmp/agent.sock' });
    expect(facts.sensitivePaths).toHaveLength(1);
    expect(readSandboxHostFacts({ SSH_AUTH_SOCK: 'relative.sock' }).sensitivePaths).toEqual([]);
    expect(facts.homeDir.length).toBeGreaterThan(0);
    expect(facts.os).toBe(process.platform);
  });
});

describe('remediation and the report', () => {
  it('has steps for every attestation rule', () => {
    for (const rule of SANDBOX_ATTESTATION_RULES) {
      expect(describeSandboxRemediation(rule.id, { engine: 'docker', image: IMAGE, hostOs: 'win32' }).length).toBeGreaterThan(0);
    }
  });

  it('tells the person how to pull and pin, and never names a digest of its own', () => {
    const pin = describeSandboxRemediation('image-pinned', { engine: 'docker', image: 'node:22', hostOs: 'linux' }).join('\n');
    expect(pin).toContain('docker pull');
    expect(pin).toContain('{{index .RepoDigests 0}}');
    expect(pin).not.toMatch(/sha256:[a-f0-9]{64}/);
    const present = describeSandboxRemediation('image-present', { engine: 'podman', image: IMAGE, hostOs: 'linux' }).join('\n');
    expect(present).toContain(`podman pull ${IMAGE}`);
    expect(present).toContain('never pulls');
  });

  it('lists every rule: passed above the failure, the failure with its reason, and nothing below claimed as passing', async () => {
    const { report, attestation } = await probe({ ...HEALTHY_DOCKER, 'docker image inspect': { ok: false, kind: 'exit', detail: 'No such image' } });
    const markdown = renderSandboxCheckReport({
      reading: { configuration: configuration(), problems: [], ignored: [] },
      report,
      attestation,
      hostOs: 'linux',
      dryRun: false,
      now: NOW,
    });
    for (const rule of SANDBOX_ATTESTATION_RULES) {
      expect(markdown).toContain(`\`${rule.id}\``);
    }
    expect(markdown).toMatch(/`image-pinned` \| passed/);
    expect(markdown).toMatch(/`image-present` \| \*\*failed\*\*/);
    expect(markdown).toMatch(/`canary-passed` \| not evaluated/);
    expect(markdown).toMatch(/`probe-fresh` \| not evaluated/);
    expect(markdown).toContain('**Unavailable**');
    expect(markdown).toContain('**Enforced.**');
    expect(markdown).toContain(`docker pull ${IMAGE}`);
  });

  it('shows the exact canary argv when confirmed, and says the mode decides whether it is used', async () => {
    const { report, attestation } = await probe(HEALTHY_DOCKER);
    const markdown = renderSandboxCheckReport({
      reading: { configuration: configuration(), problems: [], ignored: [] },
      report,
      attestation,
      hostOs: 'linux',
      dryRun: false,
      now: NOW,
    });
    expect(markdown).toContain('**Confirmed**');
    expect(markdown).toContain(['docker', ...report.canaryArgv!].join(' '));
    expect(markdown).not.toContain('**failed**');
    // The configuration here asks for require.
    expect(markdown).toContain('**Enforced.**');
    expect(markdown).toContain('never on your machine instead');
    expect(markdown.toLowerCase()).not.toContain('not enforced');
    // Confirmed under off is a sandbox that could run commands and does not.
    const off = renderSandboxCheckReport({
      reading: { configuration: configuration({ mode: 'off' }), problems: [], ignored: [] },
      report,
      attestation,
      hostOs: 'linux',
      dryRun: false,
      now: NOW,
    });
    expect(off).toContain('**Off.**');
    expect(off).toContain('run on your machine');
    // An explicit mode wins over the reading's, for settings that could not be used.
    expect(renderSandboxCheckReport({
      reading: { problems: ['x'], ignored: [] }, attestation, hostOs: 'linux', dryRun: false, now: NOW, mode: 'require',
    })).toContain('Mode: **require**');
  });

  it('escapes table cells so engine output cannot break the table', async () => {
    const { report, attestation } = await probe({ ...HEALTHY_DOCKER, 'docker run': { ok: false, kind: 'exit', detail: 'a | b' } });
    const markdown = renderSandboxCheckReport({
      reading: { configuration: configuration(), problems: [], ignored: [] }, report, attestation, hostOs: 'linux', dryRun: false, now: NOW,
    });
    expect(markdown).toContain('a \\| b');
  });

  it('escapes a backslash before the pipe after it, so the pipe stays escaped and the cell whole', async () => {
    // Engine output `C:\work\| tail`: escaping only the pipe gives `C:\work\\|`, a literal
    // backslash and then a live pipe that splits the cell.
    const { report, attestation } = await probe({ ...HEALTHY_DOCKER, 'docker run': { ok: false, kind: 'exit', detail: 'C:\\work\\| tail' } });
    const markdown = renderSandboxCheckReport({
      reading: { configuration: configuration(), problems: [], ignored: [] }, report, attestation, hostOs: 'linux', dryRun: false, now: NOW,
    });
    expect(markdown).toContain('C:\\\\work\\\\\\| tail');
  });

  it('says nothing was probed when the settings could not be used', () => {
    const markdown = renderSandboxCheckReport({
      reading: { problems: ['atlasmind.sandbox.engine must be auto, docker or podman.'], ignored: [] },
      attestation: { status: 'unavailable', rule: 'probed', reason: 'The sandbox settings could not be used, so nothing was probed.' },
      hostOs: 'win32',
      dryRun: false,
      now: NOW,
    });
    expect(markdown).toContain('Nothing was probed.');
    expect(markdown).toMatch(/`probed` \| \*\*failed\*\*/);
  });
});

describe('the probe on a Windows host', () => {
  it('builds the canary with a drive-letter mount and no --user', async () => {
    const { report, attestation } = await probe(HEALTHY_DOCKER, { host: WIN_HOST, canaryRoot: 'D:\\dev\\app' });
    expect(attestation.status).toBe('confirmed');
    expect(report.canaryArgv).toContain('type=bind,source=D:\\dev\\app,target=/work');
    expect(report.canaryArgv).not.toContain('--user');
  });
});

describe('module boundaries', () => {
  it('pulls nothing: no pull, push, build or login command anywhere in the probe', () => {
    const source = readFileSync(path.join(ROOT_DIR, 'src', 'core', 'sandboxProbe.ts'), 'utf8')
      .split(/\r?\n/)
      .filter(line => !/^\s*(?:\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(source).not.toMatch(/\[\s*'(?:pull|push|build|login|load|import)'/);
  });

  it('does not import vscode', () => {
    const source = readFileSync(path.join(ROOT_DIR, 'src', 'core', 'sandboxProbe.ts'), 'utf8');
    expect(source).not.toMatch(/from 'vscode'/);
  });
});

