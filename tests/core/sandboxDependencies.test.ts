import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SANDBOX_DEPENDENCY_LIST_ARGV,
  SANDBOX_DEPENDENCY_MANAGERS,
  SANDBOX_DEPENDENCY_PROBE_FILES,
  SANDBOX_DEPENDENCY_RECORDS_MAX,
  SANDBOX_DEPENDENCY_RULES,
  deriveSandboxDependencyKey,
  detectSandboxDependencies,
  forgetSandboxDependencyVolumes,
  normalizeSandboxArch,
  parseSandboxDependencyVolumeList,
  parseSandboxVolumeInspection,
  planSandboxDependencyPreparation,
  readSandboxDependencyFile,
  readSandboxDependencyState,
  recordSandboxDependencyVolume,
  renderSandboxDependencySection,
  runSandboxDependencyPreparation,
  sandboxDependencyRemoveArgv,
  sandboxVolumeInspectArgv,
  sanitizeSandboxDependencyRecords,
  type SandboxDependencyFile,
  type SandboxDependencyKeyInput,
  type SandboxDependencyPrepareInput,
  type SandboxDependencyPreparePlan,
  type SandboxDependencyReaderDeps,
  type SandboxDependencyRecord,
} from '../../src/core/sandboxDependencies.ts';
import {
  assessSandboxAttestation,
  isSandboxDependencyVolumeName,
  type SandboxAttestation,
  type SandboxHostFacts,
  type SandboxProbe,
} from '../../src/core/sandboxPlan.ts';
import { classifyHostCommand, DryRunLedger } from '../../src/core/dryRun.ts';
import { DryRunHost, installDryRunHost } from '../../src/core/dryRunHost.ts';
import type { SandboxProcessOutcome } from '../../src/core/sandboxRunner.ts';

const DIGEST = `sha256:${'0123456789abcdef'.repeat(4)}`;
const IMAGE = `ghcr.io/atlasmind/sandbox-node@${DIGEST}`;
const NOW = new Date('2026-10-08T12:00:00.000Z');
const LINUX_HOST: SandboxHostFacts = { os: 'linux', user: { uid: 1000, gid: 1000 }, homeDir: '/home/joel' };
const WIN_HOST: SandboxHostFacts = { os: 'win32', homeDir: 'C:\\Users\\joel' };
const LINUX_ROOT = '/home/joel/dev/app';
const WIN_ROOT = 'C:\\Users\\joel\\dev\\app';
const LOCK = Buffer.from('{"name":"app","lockfileVersion":3,"packages":{}}\n');
const LOCK_SHA = createHash('sha256').update(LOCK).digest('hex');

function bytes(text: string | Buffer): SandboxDependencyFile {
  return { present: true, bytes: typeof text === 'string' ? Buffer.from(text) : text };
}

function files(overrides: Record<string, SandboxDependencyFile | undefined> = {}): Record<string, SandboxDependencyFile | undefined> {
  return { 'package.json': bytes('{"name":"app","dependencies":{"is-number":"7.0.0"}}'), 'package-lock.json': bytes(LOCK), ...overrides };
}

function probe(overrides: Partial<SandboxProbe> = {}): SandboxProbe {
  return {
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
  };
}

function confirmed(overrides: Partial<SandboxProbe> = {}): SandboxAttestation {
  const attestation = assessSandboxAttestation(probe(overrides), { engine: 'auto', image: IMAGE }, NOW);
  expect(attestation.status).toBe('confirmed');
  return attestation;
}

function keyInput(overrides: Partial<SandboxDependencyKeyInput> = {}): SandboxDependencyKeyInput {
  return {
    manager: 'npm',
    lockfileSha256: LOCK_SHA,
    imageDigest: DIGEST,
    engine: 'docker',
    arch: 'x64',
    owner: 'image-user',
    installScripts: false,
    ...overrides,
  };
}

function prepareInput(overrides: Partial<SandboxDependencyPrepareInput> = {}): SandboxDependencyPrepareInput {
  return {
    detection: detectSandboxDependencies(files()),
    attestation: confirmed(),
    configuration: { engine: 'auto', image: IMAGE, cpus: 2, memoryGb: 4 },
    host: WIN_HOST,
    root: WIN_ROOT,
    installScripts: false,
    runId: 'abcdef012345',
    now: NOW,
    ...overrides,
  };
}

function okPlan(overrides: Partial<SandboxDependencyPrepareInput> = {}): Extract<SandboxDependencyPreparePlan, { ok: true }> {
  const plan = planSandboxDependencyPreparation(prepareInput(overrides));
  if (!plan.ok) {
    throw new Error(`${plan.rule}: ${plan.reason}`);
  }
  return plan;
}

function record(overrides: Partial<SandboxDependencyRecord> = {}): SandboxDependencyRecord {
  const derived = deriveSandboxDependencyKey(keyInput({ owner: '1000:1000' }));
  if (!derived.ok) {
    throw new Error(derived.reason);
  }
  return {
    volume: derived.volume,
    key: derived.key,
    root: LINUX_ROOT,
    manager: 'npm',
    lockfile: 'package-lock.json',
    lockfileSha256: LOCK_SHA,
    engine: 'docker',
    image: IMAGE,
    arch: 'x64',
    installScripts: false,
    preparedAt: '2026-10-08T11:00:00.000Z',
    ...overrides,
  };
}

function readerDeps(overrides: Partial<SandboxDependencyReaderDeps> & { files?: Record<string, SandboxDependencyFile | undefined> } = {}): SandboxDependencyReaderDeps {
  const table = overrides.files ?? files();
  return {
    readFile: async absolutePath => table[path.basename(absolutePath)] ?? { present: false },
    records: overrides.records ?? (() => [record()]),
    inspectVolume: overrides.inspectVolume ?? (async () => ({ status: 'present', labels: { 'atlasmind.deps': '1', 'atlasmind.deps.key': record().key } })),
  };
}

let uninstall: Array<() => void> = [];
afterEach(() => {
  for (const undo of uninstall) {
    undo();
  }
  uninstall = [];
});

describe('sandboxDependencies: detection', () => {
  it('a folder with no package.json needs nothing', () => {
    expect(detectSandboxDependencies({})).toMatchObject({ status: 'not-a-node-project' });
  });

  it('finds npm and hashes the lockfile\'s exact bytes', () => {
    expect(detectSandboxDependencies(files())).toEqual({
      status: 'found', manager: 'npm', lockfile: 'package-lock.json', lockfileSha256: LOCK_SHA, mounts: ['package.json', 'package-lock.json'],
    });
  });

  it('prefers npm-shrinkwrap.json, as npm itself does', () => {
    expect(detectSandboxDependencies(files({ 'npm-shrinkwrap.json': bytes('{}') }))).toMatchObject({ manager: 'npm', lockfile: 'npm-shrinkwrap.json' });
  });

  it('finds pnpm and Yarn 1', () => {
    expect(detectSandboxDependencies(files({ 'package-lock.json': undefined, 'pnpm-lock.yaml': bytes('lockfileVersion: 9') })))
      .toMatchObject({ manager: 'pnpm', lockfile: 'pnpm-lock.yaml' });
    expect(detectSandboxDependencies(files({ 'package-lock.json': undefined, 'yarn.lock': bytes('# yarn lockfile v1\n') })))
      .toMatchObject({ manager: 'yarn', lockfile: 'yarn.lock' });
  });

  it.each([
    ['no lockfile', { 'package-lock.json': undefined }, 'lockfile-present'],
    ['two managers', { 'yarn.lock': bytes('# yarn lockfile v1') }, 'one-manager'],
    ['bun beside npm', { 'bun.lockb': bytes('x') }, 'one-manager'],
    ['bun alone', { 'package-lock.json': undefined, 'bun.lock': bytes('x') }, 'supported-manager'],
    ['Yarn 2+ by its rc file', { 'package-lock.json': undefined, 'yarn.lock': bytes('x'), '.yarnrc.yml': bytes('nodeLinker: pnp') }, 'supported-manager'],
    ['Yarn 2+ by its lockfile', { 'package-lock.json': undefined, 'yarn.lock': bytes('__metadata:\n  version: 8') }, 'supported-manager'],
    ['npm workspaces', { 'package.json': bytes('{"workspaces":["packages/*"]}') }, 'no-workspaces'],
    ['pnpm workspaces', { 'pnpm-workspace.yaml': bytes('packages: []') }, 'no-workspaces'],
    ['a manifest that is not JSON', { 'package.json': bytes('{ nope') }, 'manifest-readable'],
    ['a manifest that is an array', { 'package.json': bytes('[]') }, 'manifest-readable'],
    ['a symlinked manifest', { 'package.json': { present: true, refused: 'not-a-regular-file' } }, 'manifest-readable'],
    ['a symlinked lockfile', { 'package-lock.json': { present: true, refused: 'not-a-regular-file' } }, 'lockfile-readable'],
    ['an oversized lockfile', { 'package-lock.json': { present: true, refused: 'too-large' } }, 'lockfile-readable'],
  ] as const)('refuses %s by a named rule', (_label, overrides, rule) => {
    expect(detectSandboxDependencies(files(overrides as Record<string, SandboxDependencyFile | undefined>))).toMatchObject({ status: 'refused', rule });
  });

  it('reads only constant file names, and every detection rule is declared', () => {
    expect(SANDBOX_DEPENDENCY_PROBE_FILES.every(name => /^[.a-z-]+(?:\.[a-z]+)?$/.test(name) && !name.includes('/'))).toBe(true);
    const ids = SANDBOX_DEPENDENCY_RULES.map(rule => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('sandboxDependencies: the real file reader', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never follows a symlink: a lockfile pointing elsewhere is refused, not read', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atlasmind-deps-'));
    made.push(dir);
    writeFileSync(path.join(dir, 'secret'), 'aws_secret_access_key=x');
    writeFileSync(path.join(dir, 'package.json'), '{}');
    mkdirSync(path.join(dir, 'node_modules'));
    let linked = true;
    try {
      symlinkSync(path.join(dir, 'secret'), path.join(dir, 'package-lock.json'));
    } catch {
      linked = false; // Windows without the symlink privilege: the directory case below still proves lstat.
    }
    if (linked) {
      expect(await readSandboxDependencyFile(path.join(dir, 'package-lock.json'))).toEqual({ present: true, refused: 'not-a-regular-file' });
    }
    expect(await readSandboxDependencyFile(path.join(dir, 'node_modules'))).toEqual({ present: true, refused: 'not-a-regular-file' });
    expect(await readSandboxDependencyFile(path.join(dir, 'absent.json'))).toEqual({ present: false });
    const manifest = await readSandboxDependencyFile(path.join(dir, 'package.json'));
    expect(manifest.present && 'bytes' in manifest && Buffer.from(manifest.bytes).toString()).toBe('{}');
  });
});

describe('sandboxDependencies: the key', () => {
  it('is deterministic, and names a volume AtlasMind would make', () => {
    const first = deriveSandboxDependencyKey(keyInput());
    const second = deriveSandboxDependencyKey(keyInput());
    expect(first).toEqual(second);
    expect(first.ok && isSandboxDependencyVolumeName(first.volume)).toBe(true);
    expect(first.ok && first.volume).toBe(`atlasmind-deps-${first.ok ? first.key.slice(0, 16) : ''}`);
  });

  it('changes when the lockfile, the image, the platform, the owner or the scripts choice changes', () => {
    const base = deriveSandboxDependencyKey(keyInput());
    for (const change of [
      { lockfileSha256: 'f'.repeat(64) },
      { imageDigest: `sha256:${'f'.repeat(64)}` },
      { arch: 'arm64' },
      { owner: '1000:1000' },
      { installScripts: true },
      { manager: 'pnpm' as const },
      { engine: 'podman' as const },
    ]) {
      const other = deriveSandboxDependencyKey(keyInput(change));
      expect(other.ok && base.ok && other.key !== base.key && other.volume !== base.volume, JSON.stringify(change)).toBe(true);
    }
  });

  it('reads x86_64 and amd64 as x64, and refuses what it cannot read', () => {
    expect(deriveSandboxDependencyKey(keyInput({ arch: 'x86_64' }))).toEqual(deriveSandboxDependencyKey(keyInput({ arch: 'amd64' })));
    expect(normalizeSandboxArch('aarch64')).toBe('arm64');
    expect(normalizeSandboxArch('')).toBeUndefined();
    for (const bad of [
      keyInput({ manager: 'bun' as never }), keyInput({ lockfileSha256: 'abc' }), keyInput({ imageDigest: 'latest' }),
      keyInput({ arch: '../x' }), keyInput({ owner: 'root' }), keyInput({ engine: 'nerdctl' as never }),
    ]) {
      expect(deriveSandboxDependencyKey(bad).ok).toBe(false);
    }
  });

  it('property: any two different lockfiles name different volumes', () => {
    fc.assert(fc.property(
      fc.uint8Array({ minLength: 1, maxLength: 64 }), fc.uint8Array({ minLength: 1, maxLength: 64 }),
      (left, right) => {
        fc.pre(Buffer.compare(Buffer.from(left), Buffer.from(right)) !== 0);
        const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
        const a = deriveSandboxDependencyKey(keyInput({ lockfileSha256: sha(left) }));
        const b = deriveSandboxDependencyKey(keyInput({ lockfileSha256: sha(right) }));
        expect(a.ok && b.ok && a.volume !== b.volume).toBe(true);
        expect(a.ok && isSandboxDependencyVolumeName(a.volume)).toBe(true);
      },
    ), { numRuns: 200 });
  });
});

describe('sandboxDependencies: readiness', () => {
  it('is ready when a recorded preparation and the engine\'s volume agree on the key', async () => {
    const state = await readSandboxDependencyState(LINUX_ROOT, confirmed(), LINUX_HOST, readerDeps());
    expect(state).toEqual({
      status: 'ready', root: LINUX_ROOT, volume: record().volume, key: record().key, manager: 'npm',
      lockfile: 'package-lock.json', installScripts: false, preparedAt: '2026-10-08T11:00:00.000Z',
    });
  });

  it('finds the install-scripts variant too', async () => {
    const derived = deriveSandboxDependencyKey(keyInput({ owner: '1000:1000', installScripts: true }));
    const scripts = record(derived.ok ? { volume: derived.volume, key: derived.key, installScripts: true } : {});
    const state = await readSandboxDependencyState(LINUX_ROOT, confirmed(), LINUX_HOST, readerDeps({
      records: () => [scripts],
      inspectVolume: async () => ({ status: 'present', labels: { 'atlasmind.deps.key': scripts.key } }),
    }));
    expect(state).toMatchObject({ status: 'ready', installScripts: true, volume: scripts.volume });
  });

  it('needs nothing for a folder that is not a Node project, and reads nothing from the engine', async () => {
    const inspectVolume = vi.fn();
    const state = await readSandboxDependencyState(LINUX_ROOT, confirmed(), LINUX_HOST, readerDeps({ files: {}, inspectVolume }));
    expect(state.status).toBe('not-a-node-project');
    expect(inspectVolume).not.toHaveBeenCalled();
  });

  it('a changed lockfile is not ready, and says it changed', async () => {
    const changed = files({ 'package-lock.json': bytes('{"lockfileVersion":3,"packages":{"x":{}}}') });
    const state = await readSandboxDependencyState(LINUX_ROOT, confirmed(), LINUX_HOST, readerDeps({ files: changed }));
    expect(state).toMatchObject({ status: 'not-prepared', rule: 'prepared' });
    expect(state.status === 'not-prepared' && state.reason).toContain('has changed since dependencies were prepared');
  });

  it.each([
    ['no record', { records: () => [] }, 'prepared'],
    ['the volume is gone', { inspectVolume: async () => ({ status: 'absent' as const }) }, 'volume-present'],
    ['the engine could not say', { inspectVolume: async () => ({ status: 'unknown' as const, detail: 'daemon down' }) }, 'volume-present'],
    ['the volume carries another key', { inspectVolume: async () => ({ status: 'present' as const, labels: { 'atlasmind.deps.key': 'x' } }) }, 'volume-matches'],
    ['the reader throws', { inspectVolume: async () => { throw new Error('boom'); } }, 'assessed'],
  ] as const)('is not ready when %s', async (_label, overrides, rule) => {
    const state = await readSandboxDependencyState(LINUX_ROOT, confirmed(), LINUX_HOST, readerDeps(overrides as Partial<SandboxDependencyReaderDeps>));
    expect(state).toMatchObject({ status: 'not-prepared', rule });
  });

  it('is not ready without a confirmed attestation, or an architecture, or for another user', async () => {
    expect(await readSandboxDependencyState(LINUX_ROOT, undefined, LINUX_HOST, readerDeps())).toMatchObject({ rule: 'attested' });
    expect(await readSandboxDependencyState(LINUX_ROOT, confirmed({ arch: '' }), LINUX_HOST, readerDeps())).toMatchObject({ rule: 'platform-known' });
    expect(await readSandboxDependencyState(LINUX_ROOT, confirmed(), { ...LINUX_HOST, user: { uid: 1001, gid: 1001 } }, readerDeps()))
      .toMatchObject({ rule: 'prepared' });
  });

  it('a refused detection is the reason, by its own rule', async () => {
    expect(await readSandboxDependencyState(LINUX_ROOT, confirmed(), LINUX_HOST, readerDeps({ files: files({ 'package-lock.json': undefined }) })))
      .toMatchObject({ status: 'not-prepared', rule: 'lockfile-present' });
  });
});

describe('sandboxDependencies: engine reads and removal', () => {
  it('reads labels, an absent volume, and refuses to read anything else as absent', () => {
    expect(parseSandboxVolumeInspection({ kind: 'exited', exitCode: 0, stdout: '{"atlasmind.deps.key":"k"}\n', stderr: '' }))
      .toEqual({ status: 'present', labels: { 'atlasmind.deps.key': 'k' } });
    expect(parseSandboxVolumeInspection({ kind: 'exited', exitCode: 0, stdout: 'null', stderr: '' })).toEqual({ status: 'present', labels: {} });
    expect(parseSandboxVolumeInspection({ kind: 'exited', exitCode: 1, stdout: '', stderr: 'Error response from daemon: get x: no such volume' }))
      .toEqual({ status: 'absent' });
    expect(parseSandboxVolumeInspection({ kind: 'exited', exitCode: 1, stdout: '', stderr: 'permission denied' }).status).toBe('unknown');
    expect(parseSandboxVolumeInspection({ kind: 'timeout', stdout: '', stderr: '' }).status).toBe('unknown');
    expect(parseSandboxVolumeInspection({ kind: 'exited', exitCode: 0, stdout: '{nope', stderr: '' }).status).toBe('unknown');
  });

  it('inspecting and listing are reads; creating, preparing and removing are effects', () => {
    expect(classifyHostCommand('docker', sandboxVolumeInspectArgv('atlasmind-deps-0123456789abcdef')).kind).toBe('read');
    expect(classifyHostCommand('podman', [...SANDBOX_DEPENDENCY_LIST_ARGV]).kind).toBe('read');
    for (const step of okPlan({ host: LINUX_HOST, root: LINUX_ROOT }).steps) {
      expect(classifyHostCommand('docker', step.argv).kind, step.id).toBe('effect');
    }
    expect(classifyHostCommand('docker', sandboxDependencyRemoveArgv(['atlasmind-deps-0123456789abcdef'])!).kind).toBe('effect');
  });

  it('lists only names AtlasMind makes, and removes only those — never with --force', () => {
    expect(parseSandboxDependencyVolumeList('atlasmind-deps-0123456789abcdef\r\nmy-db-data\natlasmind-deps-0123456789abcdef\n--privileged\n'))
      .toEqual(['atlasmind-deps-0123456789abcdef']);
    expect(sandboxDependencyRemoveArgv(['atlasmind-deps-0123456789abcdef'])).toEqual(['volume', 'rm', 'atlasmind-deps-0123456789abcdef']);
    expect(sandboxDependencyRemoveArgv(['atlasmind-deps-0123456789abcdef', 'pgdata'])).toBeUndefined();
    expect(sandboxDependencyRemoveArgv([])).toBeUndefined();
  });
});

describe('sandboxDependencies: records', () => {
  it('keeps well-formed records and drops anything else, never repairing it', () => {
    const good = record();
    const raw = [
      good,
      { ...good, volume: 'atlasmind-deps-ffffffffffffffff' }, // name not derived from its key
      { ...good, manager: 'bun' },
      { ...good, lockfile: '../../etc/passwd' },
      { ...good, image: 'node:20' },
      { ...good, preparedAt: 'yesterday' },
      'nonsense',
      null,
    ];
    expect(sanitizeSandboxDependencyRecords(raw)).toEqual([good]);
    expect(sanitizeSandboxDependencyRecords({})).toEqual([]);
  });

  it('upserts newest first, caps the list, and forgets removed volumes', () => {
    const many = Array.from({ length: SANDBOX_DEPENDENCY_RECORDS_MAX + 5 }, (_, index) => {
      const derived = deriveSandboxDependencyKey(keyInput({ lockfileSha256: createHash('sha256').update(String(index)).digest('hex') }));
      return record(derived.ok ? { volume: derived.volume, key: derived.key } : {});
    });
    let list: SandboxDependencyRecord[] = [];
    for (const entry of many) {
      list = recordSandboxDependencyVolume(list, entry);
    }
    expect(list).toHaveLength(SANDBOX_DEPENDENCY_RECORDS_MAX);
    expect(list[0]).toEqual(many[many.length - 1]);
    expect(recordSandboxDependencyVolume(list, { ...list[3]!, preparedAt: NOW.toISOString() })).toHaveLength(SANDBOX_DEPENDENCY_RECORDS_MAX);
    expect(forgetSandboxDependencyVolumes(list, [list[0]!.volume])).toHaveLength(SANDBOX_DEPENDENCY_RECORDS_MAX - 1);
  });
});

describe('sandboxDependencies: the preparation plan', () => {
  it('Windows host: removes, creates, then installs with network — the two files read-only, writing only to the volume', () => {
    const plan = okPlan();
    const volume = plan.volume;
    expect(plan.steps.map(step => step.id)).toEqual(['remove-previous', 'create-volume', 'install']);
    expect(plan.steps.map(step => step.network)).toEqual([false, false, true]);
    expect(plan.steps[0]!.argv).toEqual(['volume', 'rm', '--force', volume]);
    expect(plan.steps[1]!.argv).toEqual([
      'volume', 'create', '--label', 'atlasmind.deps=1', '--label', `atlasmind.deps.key=${plan.key}`,
      '--label', 'atlasmind.deps.manager=npm', '--label', 'atlasmind.deps.scripts=0', volume,
    ]);
    expect(plan.steps[2]!.argv).toEqual([
      'run', '--rm', '--init', '--pull', 'never',
      '--name', 'atlasmind-deps-prep-abcdef012345',
      '--label', 'atlasmind.deps.prepare=1',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--pids-limit', '512',
      '--cpus', '2', '--memory', '4096m', '--memory-swap', '4096m',
      '--mount', `type=bind,source=${WIN_ROOT}\\package.json,target=/work/package.json,readonly`,
      '--mount', `type=bind,source=${WIN_ROOT}\\package-lock.json,target=/work/package-lock.json,readonly`,
      '--mount', `type=volume,source=${volume},target=/work/node_modules`,
      '--workdir', '/work',
      '--env', 'HOME=/tmp',
      '--env', 'TMPDIR=/tmp',
      IMAGE, 'npm', 'ci', '--no-audit', '--no-fund', '--no-update-notifier', '--loglevel=error', '--ignore-scripts',
    ]);
    expect(plan.cleanup).toEqual(['volume', 'rm', '--force', volume]);
    expect(plan.disclosure.join(' ')).toContain('reaches the network');
    expect(plan.disclosure.join(' ')).toContain('Install scripts are not run');
  });

  it('Linux host: first makes the empty volume the editor\'s user\'s, with no network and only CHOWN, then installs as that user', () => {
    const plan = okPlan({ host: LINUX_HOST, root: LINUX_ROOT });
    expect(plan.steps.map(step => step.id)).toEqual(['remove-previous', 'create-volume', 'set-ownership', 'install']);
    const own = plan.steps[2]!.argv;
    expect(own).toEqual([
      'run', '--rm', '--init', '--pull', 'never',
      '--name', 'atlasmind-deps-own-abcdef012345',
      '--label', 'atlasmind.deps.prepare=1',
      '--network', 'none',
      '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
      '--security-opt', 'no-new-privileges',
      '--read-only',
      '--pids-limit', '64',
      '--user', '0:0',
      '--mount', `type=volume,source=${plan.volume},target=/work/node_modules`,
      IMAGE, 'chown', '1000:1000', '/work/node_modules',
    ]);
    const install = plan.steps[3]!.argv;
    expect(install.slice(install.indexOf('--user'), install.indexOf('--user') + 2)).toEqual(['--user', '1000:1000']);
    expect(install).toContain(`type=bind,source=${LINUX_ROOT}/package-lock.json,target=/work/package-lock.json,readonly`);
  });

  it('rootless Podman on Linux keeps the user mapping through every step', () => {
    const plan = okPlan({ host: LINUX_HOST, root: LINUX_ROOT, attestation: confirmed({ engine: 'podman', rootless: true }) });
    expect(plan.engine).toBe('podman');
    for (const step of plan.steps.filter(entry => entry.argv[0] === 'run')) {
      expect(step.argv.join(' '), step.id).toContain('--userns keep-id');
    }
  });

  it('install scripts are a different volume, and drop --ignore-scripts', () => {
    const off = okPlan();
    const on = okPlan({ installScripts: true });
    expect(on.volume).not.toBe(off.volume);
    expect(on.steps.at(-1)!.argv).not.toContain('--ignore-scripts');
    expect(off.steps.at(-1)!.argv).toContain('--ignore-scripts');
    expect(on.disclosure.join(' ')).toContain('Install scripts RUN');
  });

  it.each([
    ['nothing was detected', { detection: { status: 'not-a-node-project', reason: 'x' } as const }, 'detected'],
    ['detection refused', { detection: detectSandboxDependencies(files({ 'package-lock.json': undefined })) }, 'detected'],
    ['no attestation', { attestation: undefined }, 'attested'],
    ['an expired attestation', { now: new Date(NOW.getTime() + 11 * 60_000) }, 'attested'],
    ['another image configured', { configuration: { engine: 'auto' as const, image: `node@${DIGEST}`, cpus: 2, memoryGb: 4 } }, 'configuration-matches'],
    ['a bad run id', { runId: 'A;rm -rf' }, 'run-id'],
    ['your home directory as the folder', { root: 'C:\\Users\\joel' }, 'mount'],
    ['a folder inside ~/.ssh', { host: LINUX_HOST, root: '/home/joel/.ssh/keys' }, 'mount'],
    ['a relative folder', { root: 'dev\\app' }, 'mount'],
    ['root on Linux', { host: { ...LINUX_HOST, user: { uid: 0, gid: 0 } }, root: LINUX_ROOT }, 'host-user'],
    ['limits that cannot be stated', { configuration: { engine: 'auto' as const, image: IMAGE, cpus: 0, memoryGb: 4 } }, 'limits'],
    ['an unknown architecture', { attestation: confirmed({ arch: 'mips?' }) }, 'key'],
  ] as const)('refuses when %s, by a named rule', (_label, overrides, rule) => {
    expect(planSandboxDependencyPreparation(prepareInput(overrides as Partial<SandboxDependencyPrepareInput>))).toMatchObject({ ok: false, rule });
  });

  it('property: only the install reaches the network; nothing mounts the socket, home or more than the two files and the volume', () => {
    const hosts: Array<[SandboxHostFacts, string, string]> = [
      [LINUX_HOST, LINUX_ROOT, '/'], [WIN_HOST, WIN_ROOT, '\\'], [{ os: 'darwin', homeDir: '/Users/joel' }, '/Users/joel/dev/app', '/'],
    ];
    fc.assert(fc.property(
      fc.constantFrom(...hosts), fc.constantFrom(...SANDBOX_DEPENDENCY_MANAGERS.map(manager => manager.id)),
      fc.boolean(), fc.constantFrom<'docker' | 'podman'>('docker', 'podman'),
      ([host, root, sep], manager, installScripts, engine) => {
        const managerRow = SANDBOX_DEPENDENCY_MANAGERS.find(entry => entry.id === manager)!;
        const lockfile = managerRow.lockfiles.at(-1)!;
        const detection = detectSandboxDependencies({ 'package.json': bytes('{}'), [lockfile]: bytes('lock') });
        const plan = planSandboxDependencyPreparation(prepareInput({
          detection, host, root, installScripts, attestation: confirmed({ engine, rootless: engine === 'podman' }),
        }));
        expect(plan.ok).toBe(true);
        if (!plan.ok) {
          return;
        }
        for (const step of plan.steps) {
          const imageAt = step.argv.indexOf(IMAGE);
          const options = imageAt === -1 ? step.argv : step.argv.slice(0, imageAt);
          const text = options.join(' ');
          expect(text).not.toContain('--privileged');
          expect(text).not.toMatch(/docker\.sock|podman\.sock/);
          expect(options.some(arg => arg === '-v' || arg === '--volume' || arg === '--volumes-from' || arg.startsWith('--network=host'))).toBe(false);
          if (step.argv[0] !== 'run') {
            expect(step.network).toBe(false);
            continue;
          }
          expect(options[options.indexOf('--cap-drop') + 1]).toBe('ALL');
          const added = options.flatMap((arg, index) => (arg === '--cap-add' ? [options[index + 1]] : []));
          expect(added).toEqual(step.id === 'set-ownership' ? ['CHOWN'] : []);
          const networkNone = options.includes('--network') && options[options.indexOf('--network') + 1] === 'none';
          expect(networkNone).toBe(!step.network);
          expect(step.network).toBe(step.id === 'install');
          const mounts = options.flatMap((arg, index) => (arg === '--mount' ? [options[index + 1] ?? ''] : []));
          const volumes = mounts.filter(mount => mount.startsWith('type=volume,'));
          expect(volumes).toEqual([`type=volume,source=${plan.volume},target=/work/node_modules`]);
          const binds = mounts.filter(mount => mount.startsWith('type=bind,'));
          expect(binds).toEqual(step.id === 'install'
            ? ['package.json', lockfile].map(name => `type=bind,source=${root}${sep}${name},target=/work/${name},readonly`)
            : []);
          expect(mounts).toHaveLength(binds.length + volumes.length);
        }
      },
    ), { numRuns: 120 });
  });
});

describe('sandboxDependencies: running a preparation', () => {
  function scripted(fn: (argv: readonly string[]) => SandboxProcessOutcome) {
    const calls: string[][] = [];
    return {
      calls,
      run: async (_engine: string, argv: readonly string[]) => {
        calls.push([...argv]);
        return fn(argv);
      },
    };
  }
  const ok: SandboxProcessOutcome = { kind: 'exited', exitCode: 0, stdout: '', stderr: '' };

  it('runs every step in order and returns the record — only when the install finished', async () => {
    const plan = okPlan({ host: LINUX_HOST, root: LINUX_ROOT });
    const engine = scripted(() => ok);
    const outcome = await runSandboxDependencyPreparation(plan, { run: engine.run, now: () => NOW });
    expect(engine.calls).toEqual(plan.steps.map(step => step.argv));
    expect(outcome).toMatchObject({
      status: 'prepared',
      record: { volume: plan.volume, key: plan.key, root: LINUX_ROOT, lockfileSha256: LOCK_SHA, arch: 'x64', preparedAt: NOW.toISOString() },
    });
  });

  it('a failed install removes the volume, so a half-prepared one never carries the name', async () => {
    const plan = okPlan();
    const engine = scripted(argv => (argv[0] === 'run' ? { kind: 'exited', exitCode: 1, stdout: '', stderr: 'npm error code E404' } : ok));
    const outcome = await runSandboxDependencyPreparation(plan, { run: engine.run, now: () => NOW });
    expect(outcome).toMatchObject({ status: 'failed', failedStep: 'install' });
    expect(outcome.status === 'failed' && outcome.detail).toContain('E404');
    expect(engine.calls.at(-1)).toEqual(plan.cleanup);
  });

  it('a timed-out install removes its container by name, then the volume', async () => {
    const plan = okPlan();
    const engine = scripted(argv => (argv[0] === 'run' ? { kind: 'timeout', stdout: '', stderr: '' } : ok));
    await runSandboxDependencyPreparation(plan, { run: engine.run, now: () => NOW });
    expect(engine.calls.slice(-2)).toEqual([['rm', '--force', plan.installContainer], plan.cleanup]);
  });

  it('a volume still in use stops it before anything is created or installed', async () => {
    const plan = okPlan();
    const engine = scripted(() => ({ kind: 'exited', exitCode: 1, stdout: '', stderr: 'volume is in use' }));
    const outcome = await runSandboxDependencyPreparation(plan, { run: engine.run, now: () => NOW });
    expect(outcome).toMatchObject({ status: 'failed', failedStep: 'remove-previous' });
    expect(engine.calls).toEqual([plan.steps[0]!.argv]);
  });

  it('a dry run records it and starts nothing', async () => {
    const ledger = new DryRunLedger();
    uninstall.push(installDryRunHost(new DryRunHost({ isEnabled: () => true, record: entry => ledger.record(entry), notify: () => undefined })));
    const engine = scripted(() => ok);
    const outcome = await runSandboxDependencyPreparation(okPlan(), { run: engine.run, now: () => NOW });
    expect(outcome.status).toBe('dry-run');
    expect(engine.calls).toEqual([]);
  });
});

describe('sandboxDependencies: report', () => {
  it('says what each state means, and that clean-up is on request', () => {
    expect(renderSandboxDependencySection(undefined).join('\n')).toContain('Not assessed');
    expect(renderSandboxDependencySection({ status: 'not-prepared', root: LINUX_ROOT, rule: 'prepared', reason: 'No dependencies.' }, [record()]).join('\n'))
      .toMatch(/Not prepared[\s\S]*Prepare Sandbox Dependencies[\s\S]*Remove Sandbox Dependency Volumes/);
    expect(renderSandboxDependencySection({
      status: 'ready', root: LINUX_ROOT, volume: record().volume, key: record().key, manager: 'npm', lockfile: 'package-lock.json',
      installScripts: false, preparedAt: '2026-10-08T11:00:00.000Z',
    }).join('\n')).toContain('**Ready**');
  });
});
