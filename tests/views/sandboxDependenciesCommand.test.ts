import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  inspect, showWarningMessage, showInformationMessage, showErrorMessage, showQuickPick, withProgress, workspaceState,
} = vi.hoisted(() => ({
  inspect: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showQuickPick: vi.fn(),
  withProgress: vi.fn(),
  workspaceState: { trusted: true },
}));

vi.mock('vscode', () => ({
  ProgressLocation: { Notification: 15 },
  window: { showWarningMessage, showInformationMessage, showErrorMessage, showQuickPick, withProgress },
  workspace: {
    getConfiguration: (section: string) => ({ inspect: (key: string) => inspect(`${section}.${key}`) }),
    get isTrusted() {
      return workspaceState.trusted;
    },
  },
}));

vi.mock('../../src/utils/workspaceRoots', () => ({ defaultWorkspaceRootPath: () => 'C:\\Users\\joel\\dev\\app' }));

import {
  describeSandboxDependencyPlan,
  prepareSandboxDependencies,
  removeSandboxDependencyVolumes,
  type SandboxDependencyCommandDeps,
  type SandboxDependencyStore,
} from '../../src/views/sandboxDependenciesCommand';
import { SandboxProbeCache, type SandboxProbeReport } from '../../src/core/sandboxProbe';
import {
  detectSandboxDependencies,
  planSandboxDependencyPreparation,
  type SandboxDependencyRecord,
} from '../../src/core/sandboxDependencies';
import type { SandboxHostFacts } from '../../src/core/sandboxPlan';
import type { SandboxProcessOutcome } from '../../src/core/sandboxRunner';
import { DryRunLedger } from '../../src/core/dryRun';
import { DryRunHost, installDryRunHost } from '../../src/core/dryRunHost';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIGEST = `sha256:${'0123456789abcdef'.repeat(4)}`;
const IMAGE = `ghcr.io/atlasmind/sandbox-node@${DIGEST}`;
const NOW = new Date('2026-10-08T12:00:00.000Z');
const HOST: SandboxHostFacts = { os: 'win32', homeDir: 'C:\\Users\\joel' };
const ROOT = 'C:\\Users\\joel\\dev\\app';
const LOCK = Buffer.from('{"lockfileVersion":3}');
const DETECTION = detectSandboxDependencies({
  'package.json': { present: true, bytes: Buffer.from('{"name":"app"}') },
  'package-lock.json': { present: true, bytes: LOCK },
});

function reading(): SandboxProbeReport {
  return {
    probe: {
      engine: 'docker', cliPresent: true, infoOk: true, serverOs: 'linux', arch: 'x86_64', runtimes: ['runc'], rootless: false,
      image: IMAGE, imageDigest: DIGEST, canary: 'passed', probedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    },
    steps: [],
  };
}

function memoryStore(initial: unknown = []): SandboxDependencyStore & { value: unknown } {
  const store = {
    value: initial,
    get: vi.fn(() => store.value),
    update: vi.fn(async (_key: string, value: unknown) => { store.value = value; }),
  };
  return store;
}

function engine(fn: (argv: readonly string[]) => SandboxProcessOutcome = () => ({ kind: 'exited', exitCode: 0, stdout: '', stderr: '' })) {
  const calls: string[][] = [];
  return {
    calls,
    run: vi.fn(async (_engine: string, argv: readonly string[]) => {
      calls.push([...argv]);
      return fn(argv);
    }),
  };
}

function deps(overrides: Partial<SandboxDependencyCommandDeps> = {}): Partial<SandboxDependencyCommandDeps> {
  const cache = new SandboxProbeCache();
  cache.record(reading());
  return {
    cache,
    host: HOST,
    root: () => ROOT,
    realpath: async target => target,
    probe: vi.fn(async () => reading()),
    detect: async () => DETECTION,
    isTrusted: () => true,
    now: () => NOW,
    runId: () => 'abcdef012345',
    ...overrides,
  };
}

let uninstall: Array<() => void> = [];

beforeEach(() => {
  inspect.mockReset().mockImplementation((key: string) => (key === 'atlasmind.sandbox.image' ? { globalValue: IMAGE } : undefined));
  showWarningMessage.mockReset();
  showInformationMessage.mockReset();
  showErrorMessage.mockReset();
  showQuickPick.mockReset();
  withProgress.mockReset().mockImplementation(async (_options: unknown, task: () => Promise<unknown>) => task());
  workspaceState.trusted = true;
});

afterEach(() => {
  for (const undo of uninstall.splice(0)) {
    undo();
  }
});

describe('AtlasMind: Prepare Sandbox Dependencies', () => {
  it('shows every command and what network access means before anything starts — and cancelling starts nothing', async () => {
    const fake = engine();
    showWarningMessage.mockResolvedValue(undefined);
    const said = await prepareSandboxDependencies(memoryStore(), deps({ run: fake.run }));
    expect(said).toBe('Not prepared: cancelled.');
    expect(fake.calls).toEqual([]);
    const [title, options, ...buttons] = showWarningMessage.mock.calls[0]!;
    expect(title).toContain('network access');
    expect(options).toMatchObject({ modal: true });
    expect(buttons).toEqual(['Prepare', 'Prepare With Install Scripts…']);
    const detail = (options as { detail: string }).detail;
    expect(detail).toContain('One container reaches the network');
    expect(detail).toContain('mounted read-only');
    expect(detail).toContain('Install scripts are not run (--ignore-scripts)');
    expect(detail).toContain('[NETWORK]');
    expect(detail).toMatch(/docker run --rm .* npm ci .*--ignore-scripts/);
    expect(detail).toContain(`type=bind,source=${ROOT}\\package-lock.json,target=/work/package-lock.json,readonly`);
  });

  it('prepares on Prepare, records the volume, and says a lockfile change needs it again', async () => {
    const fake = engine();
    const store = memoryStore();
    showWarningMessage.mockResolvedValue('Prepare');
    const said = await prepareSandboxDependencies(store, deps({ run: fake.run }));
    expect(said).toContain('prepared in atlasmind-deps-');
    expect(said).toContain('needs preparing again');
    expect(fake.calls.map(argv => argv.slice(0, 2))).toEqual([['volume', 'rm'], ['volume', 'create'], ['run', '--rm']]);
    expect(fake.calls[2]).toContain('--ignore-scripts');
    const records = store.value as SandboxDependencyRecord[];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      root: ROOT, manager: 'npm', installScripts: false, lockfileSha256: createHash('sha256').update(LOCK).digest('hex'), preparedAt: NOW.toISOString(),
    });
    expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('prepared in'));
  });

  it('runs install scripts only after a second, separate confirmation', async () => {
    const declined = engine();
    showWarningMessage.mockResolvedValueOnce('Prepare With Install Scripts…').mockResolvedValueOnce(undefined);
    expect(await prepareSandboxDependencies(memoryStore(), deps({ run: declined.run }))).toBe('Not prepared: install scripts were not confirmed.');
    expect(declined.calls).toEqual([]);
    expect(showWarningMessage.mock.calls[1]![0]).toContain('install scripts');
    expect((showWarningMessage.mock.calls[1]![1] as { detail: string }).detail).toContain('arbitrary code');

    showWarningMessage.mockReset().mockResolvedValueOnce('Prepare With Install Scripts…').mockResolvedValueOnce('Run Install Scripts');
    const confirmed = engine();
    const store = memoryStore();
    await prepareSandboxDependencies(store, deps({ run: confirmed.run }));
    expect(confirmed.calls.at(-1)).not.toContain('--ignore-scripts');
    expect((store.value as SandboxDependencyRecord[])[0]!.installScripts).toBe(true);
  });

  it('refuses in an untrusted workspace, before reading or running anything', async () => {
    const fake = engine();
    const detect = vi.fn();
    const said = await prepareSandboxDependencies(memoryStore(), deps({ run: fake.run, isTrusted: () => false, detect }));
    expect(said).toContain('not trusted');
    expect(detect).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);
    expect(showWarningMessage).toHaveBeenCalledTimes(1);
  });

  it('stops when the sandbox is unavailable, after probing once', async () => {
    const cache = new SandboxProbeCache();
    const probe = vi.fn(async () => ({ ...reading(), probe: { ...reading().probe, serverOs: 'windows' } }));
    const fake = engine();
    const said = await prepareSandboxDependencies(memoryStore(), deps({ run: fake.run, cache, probe }));
    expect(probe).toHaveBeenCalledTimes(1);
    expect(said).toContain('the sandbox is unavailable (linux-engine)');
    expect(fake.calls).toEqual([]);
  });

  it('says why when there is nothing it may prepare', async () => {
    const said = await prepareSandboxDependencies(memoryStore(), deps({
      run: engine().run,
      detect: async () => detectSandboxDependencies({ 'package.json': { present: true, bytes: Buffer.from('{}') } }),
    }));
    expect(said).toContain('not prepared');
    expect(said).toContain('lockfile');
  });

  it('asks before replacing a volume that is already ready', async () => {
    const plan = planSandboxDependencyPreparation({
      detection: DETECTION,
      attestation: new SandboxProbeCache().attestation({ engine: 'auto', image: IMAGE }, NOW),
      configuration: { engine: 'auto', image: IMAGE, cpus: 2, memoryGb: 4 },
      host: HOST, root: ROOT, installScripts: false, runId: 'abcdef012345', now: NOW,
    });
    expect(plan.ok).toBe(false); // no reading in a fresh cache
    const cache = new SandboxProbeCache();
    cache.record(reading());
    const ready = planSandboxDependencyPreparation({
      detection: DETECTION, attestation: cache.attestation({ engine: 'auto', image: IMAGE }, NOW),
      configuration: { engine: 'auto', image: IMAGE, cpus: 2, memoryGb: 4 }, host: HOST, root: ROOT, installScripts: false, runId: 'abcdef012345', now: NOW,
    });
    if (!ready.ok) {
      throw new Error(ready.reason);
    }
    const store = memoryStore([{
      volume: ready.volume, key: ready.key, root: ROOT, manager: 'npm', lockfile: 'package-lock.json', lockfileSha256: ready.lockfileSha256,
      engine: 'docker', image: IMAGE, arch: 'x64', installScripts: false, preparedAt: '2026-10-08T11:00:00.000Z',
    }]);
    const fake = engine(argv => (argv[1] === 'inspect'
      ? { kind: 'exited', exitCode: 0, stdout: JSON.stringify({ 'atlasmind.deps.key': ready.key }), stderr: '' }
      : { kind: 'exited', exitCode: 0, stdout: '', stderr: '' }));
    showInformationMessage.mockResolvedValue(undefined);
    expect(await prepareSandboxDependencies(store, deps({ cache, run: fake.run, detect: async () => DETECTION })))
      .toBe('Already prepared; left as it is.');
    expect(fake.calls).toEqual([['volume', 'inspect', '--format', '{{json .Labels}}', ready.volume]]);
  });

  it('a dry run records the preparation and starts nothing', async () => {
    const ledger = new DryRunLedger();
    uninstall.push(installDryRunHost(new DryRunHost({ isEnabled: () => true, record: entry => ledger.record(entry), notify: () => undefined })));
    const fake = engine();
    showWarningMessage.mockResolvedValue('Prepare');
    const store = memoryStore();
    const said = await prepareSandboxDependencies(store, deps({ run: fake.run }));
    expect(said).toContain('not prepared');
    expect(fake.calls).toEqual([]);
    expect(store.update).not.toHaveBeenCalled();
  });

  it('a failed install records nothing and says which step failed', async () => {
    const fake = engine(argv => (argv[0] === 'run' ? { kind: 'exited', exitCode: 1, stdout: '', stderr: 'npm error code EINTEGRITY' } : { kind: 'exited', exitCode: 0, stdout: '', stderr: '' }));
    showWarningMessage.mockResolvedValue('Prepare');
    const store = memoryStore();
    const said = await prepareSandboxDependencies(store, deps({ run: fake.run }));
    expect(said).toContain('"install" step failed');
    expect(said).toContain('EINTEGRITY');
    expect(store.update).not.toHaveBeenCalled();
    expect(fake.calls.at(-1)!.slice(0, 3)).toEqual(['volume', 'rm', '--force']);
  });

  it('describes the plan with every step, in order, network marked', () => {
    const cache = new SandboxProbeCache();
    cache.record(reading());
    const plan = planSandboxDependencyPreparation({
      detection: DETECTION, attestation: cache.attestation({ engine: 'auto', image: IMAGE }, NOW),
      configuration: { engine: 'auto', image: IMAGE, cpus: 2, memoryGb: 4 }, host: HOST, root: ROOT, installScripts: false, runId: 'abcdef012345', now: NOW,
    });
    if (!plan.ok) {
      throw new Error(plan.reason);
    }
    const text = describeSandboxDependencyPlan(plan);
    expect(text.match(/\[NETWORK\]/g)).toHaveLength(1);
    expect(text).toContain('1. Remove any earlier');
    expect(text).toContain('3. [NETWORK] Install exactly package-lock.json');
  });
});

describe('AtlasMind: Remove Sandbox Dependency Volumes', () => {
  const MINE = 'atlasmind-deps-0123456789abcdef';
  const OTHER = 'atlasmind-deps-fedcba9876543210';

  function listing(names: string[]) {
    return engine(argv => (argv[1] === 'ls'
      ? { kind: 'exited', exitCode: 0, stdout: `${names.join('\n')}\npgdata\n`, stderr: '' }
      : { kind: 'exited', exitCode: 0, stdout: '', stderr: '' }));
  }

  it('lists only AtlasMind volumes, removes only what you pick, without --force, after a modal', async () => {
    let names = [MINE, OTHER];
    const fake = engine(argv => {
      if (argv[1] === 'ls') {
        return { kind: 'exited', exitCode: 0, stdout: `${names.join('\n')}\npgdata\n`, stderr: '' };
      }
      if (argv[1] === 'rm') {
        names = names.filter(name => !argv.includes(name));
      }
      return { kind: 'exited', exitCode: 0, stdout: '', stderr: '' };
    });
    inspect.mockImplementation((key: string) => (key === 'atlasmind.sandbox.engine' ? { globalValue: 'docker' } : undefined));
    showQuickPick.mockImplementation(async (items: Array<{ label: string }>) => items.filter(item => item.label === MINE));
    showWarningMessage.mockResolvedValue('Remove');
    const store = memoryStore([]);
    const said = await removeSandboxDependencyVolumes(store, deps({ run: fake.run }));
    const items = showQuickPick.mock.calls[0]![0] as Array<{ label: string }>;
    expect(items.map(item => item.label)).toEqual([MINE, OTHER]);
    expect(fake.calls).toContainEqual(['volume', 'rm', MINE]);
    expect(fake.calls.flat()).not.toContain('--force');
    expect(said).toBe('removed 1 volume(s).');
    expect(showWarningMessage.mock.calls[0]![1]).toMatchObject({ modal: true });
  });

  it('removes nothing when the modal is declined, and says when nothing answered', async () => {
    const fake = listing([MINE]);
    showQuickPick.mockImplementation(async (items: unknown[]) => items);
    showWarningMessage.mockResolvedValue(undefined);
    expect(await removeSandboxDependencyVolumes(memoryStore(), deps({ run: fake.run }))).toBe('Nothing removed.');
    expect(fake.calls.some(argv => argv[1] === 'rm')).toBe(false);

    const silent = engine(() => ({ kind: 'not-found', detail: 'docker was not found' }));
    expect(await removeSandboxDependencyVolumes(memoryStore(), deps({ run: silent.run }))).toBe('No engine answered.');
  });

  it('a dry run removes nothing', async () => {
    const ledger = new DryRunLedger();
    uninstall.push(installDryRunHost(new DryRunHost({ isEnabled: () => true, record: entry => ledger.record(entry), notify: () => undefined })));
    const fake = listing([MINE]);
    inspect.mockImplementation((key: string) => (key === 'atlasmind.sandbox.engine' ? { globalValue: 'docker' } : undefined));
    showQuickPick.mockImplementation(async (items: unknown[]) => items);
    showWarningMessage.mockResolvedValue('Remove');
    expect(await removeSandboxDependencyVolumes(memoryStore(), deps({ run: fake.run }))).toBe('Dry run: nothing removed.');
    expect(fake.calls.some(argv => argv[1] === 'rm')).toBe(false);
  });
});

describe('the commands are declared and wired', () => {
  it('declares both commands and registers them against the global state', () => {
    const manifest = readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8');
    const commands = readFileSync(path.join(ROOT_DIR, 'src', 'commands.ts'), 'utf8');
    for (const id of ['atlasmind.prepareSandboxDependencies', 'atlasmind.removeSandboxDependencyVolumes']) {
      expect(manifest).toContain(`"command": "${id}"`);
      expect(commands).toContain(`'${id}'`);
    }
    expect(commands).toContain('prepareSandboxDependencies(context.globalState)');
    expect(commands).toContain('removeSandboxDependencyVolumes(context.globalState)');
  });

  it('never starts a process itself: every engine command goes through the injected runner', () => {
    const source = readFileSync(path.join(ROOT_DIR, 'src', 'views', 'sandboxDependenciesCommand.ts'), 'utf8');
    expect(source).not.toMatch(/child_process|execFile|spawn\(/);
  });
});
