import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  inspect, openTextDocument, showTextDocument, showInformationMessage, showWarningMessage, withProgress,
} = vi.hoisted(() => ({
  inspect: vi.fn(),
  openTextDocument: vi.fn(),
  showTextDocument: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  withProgress: vi.fn(),
}));

vi.mock('vscode', () => ({
  ProgressLocation: { Notification: 15 },
  window: { withProgress, showTextDocument, showInformationMessage, showWarningMessage },
  workspace: {
    getConfiguration: (section: string) => ({ inspect: (key: string) => inspect(`${section}.${key}`) }),
    openTextDocument,
  },
}));

vi.mock('../../src/utils/workspaceRoots', () => ({ defaultWorkspaceRootPath: () => '/home/joel/dev/app' }));

import { checkExecutionSandbox } from '../../src/views/sandboxCheckCommand';
import { SandboxProbeCache, type SandboxEngineRunner, type SandboxRunOutcome } from '../../src/core/sandboxProbe';
import type { SandboxHostFacts } from '../../src/core/sandboxPlan';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIGEST = `sha256:${'0123456789abcdef'.repeat(4)}`;
const IMAGE = `ghcr.io/atlasmind/sandbox-node@${DIGEST}`;
const NOW = new Date('2026-10-08T12:00:00.000Z');
const HOST: SandboxHostFacts = { os: 'linux', user: { uid: 1000, gid: 1000 }, homeDir: '/home/joel' };
const DOCKER_INFO = JSON.stringify({
  OSType: 'linux', Architecture: 'x86_64', NCPU: 8, MemTotal: 16 * 1024 ** 3, SecurityOptions: ['name=seccomp,profile=builtin'],
});

function runner(overrides: Record<string, SandboxRunOutcome> = {}): { run: SandboxEngineRunner; calls: string[][] } {
  const calls: string[][] = [];
  const script: Record<string, SandboxRunOutcome> = {
    'docker --version': { ok: true, stdout: 'Docker version 27' },
    'docker info': { ok: true, stdout: DOCKER_INFO },
    'docker image': { ok: true, stdout: JSON.stringify([`x@${DIGEST}`]) },
    'docker run': { ok: true, stdout: '' },
    ...overrides,
  };
  return {
    calls,
    run: async (engine, args) => {
      calls.push([engine, ...args]);
      return script[`${engine} ${args[0]}`] ?? { ok: false, kind: 'not-found', detail: 'not found' };
    },
  };
}

function settings(values: Record<string, { globalValue?: unknown; workspaceValue?: unknown }>): void {
  inspect.mockImplementation((key: string) => values[key]);
}

describe('AtlasMind: Check Execution Sandbox', () => {
  beforeEach(() => {
    inspect.mockReset();
    openTextDocument.mockReset().mockImplementation(async (options: unknown) => options);
    showTextDocument.mockReset();
    showInformationMessage.mockReset();
    showWarningMessage.mockReset();
    withProgress.mockReset().mockImplementation(async (_options: unknown, task: () => Promise<unknown>) => task());
  });

  it('probes on request, records the reading, and opens a report that says it is not enforced yet', async () => {
    settings({ 'atlasmind.sandbox.image': { globalValue: IMAGE } });
    const cache = new SandboxProbeCache();
    const fake = runner();
    const markdown = await checkExecutionSandbox({ runner: fake.run, cache, host: HOST, now: () => NOW, dryRun: () => false });

    expect(cache.latest()?.probe.canary).toBe('passed');
    expect(cache.attestation({ engine: 'auto', image: IMAGE }, NOW).status).toBe('confirmed');
    expect(openTextDocument).toHaveBeenCalledWith({ language: 'markdown', content: markdown });
    expect(markdown).toContain('**Confirmed**');
    expect(markdown).toContain('Not enforced yet');
    expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('Not enforced yet'));
    // The canary mounts the folder commands would run in.
    expect(fake.calls.find(call => call[1] === 'run')).toContain('type=bind,source=/home/joel/dev/app,target=/work');
  });

  it('reports the failing rule and how to fix it, as a warning', async () => {
    settings({ 'atlasmind.sandbox.image': { globalValue: 'node:22' } });
    const markdown = await checkExecutionSandbox({
      runner: runner().run, cache: new SandboxProbeCache(), host: HOST, now: () => NOW, dryRun: () => false,
    });
    expect(markdown).toMatch(/`image-pinned` \| \*\*failed\*\*/);
    expect(markdown).toContain('docker pull');
    expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('unavailable'));
    expect(showInformationMessage).not.toHaveBeenCalled();
  });

  it('ignores an image a repository sets, and runs nothing for it', async () => {
    const hostile = `evil.example/x@sha256:${'e'.repeat(64)}`;
    settings({ 'atlasmind.sandbox.image': { workspaceValue: hostile } });
    const fake = runner();
    const markdown = await checkExecutionSandbox({ runner: fake.run, cache: new SandboxProbeCache(), host: HOST, now: () => NOW, dryRun: () => false });
    expect(fake.calls.flat()).not.toContain(hostile);
    expect(markdown).toContain('Settings that were ignored');
    expect(markdown).toMatch(/`image-pinned` \| \*\*failed\*\*/);
  });

  it('probes nothing when a setting cannot be used', async () => {
    settings({ 'atlasmind.sandbox.engine': { globalValue: 'dokcer' } });
    const fake = runner();
    const cache = new SandboxProbeCache();
    const markdown = await checkExecutionSandbox({ runner: fake.run, cache, host: HOST, now: () => NOW, dryRun: () => false });
    expect(fake.calls).toEqual([]);
    expect(cache.latest()).toBeUndefined();
    expect(withProgress).not.toHaveBeenCalled();
    expect(markdown).toContain('Nothing was probed.');
  });

  it('in a dry run, says the canary was not started and is never confirmed', async () => {
    settings({ 'atlasmind.sandbox.image': { globalValue: IMAGE } });
    const markdown = await checkExecutionSandbox({
      runner: runner({ 'docker run': { ok: false, kind: 'dry-run', detail: 'Dry run is on' } }).run,
      cache: new SandboxProbeCache(),
      host: HOST,
      now: () => NOW,
      dryRun: () => true,
    });
    expect(markdown).toContain('Dry run is on');
    expect(markdown).toMatch(/`canary-passed` \| \*\*failed\*\*/);
    expect(markdown).not.toContain('**Confirmed**');
  });

  it('is registered under the declared command id and loads lazily', () => {
    const commands = readFileSync(path.join(ROOT_DIR, 'src', 'commands.ts'), 'utf8');
    expect(commands).toContain("registerCommand('atlasmind.checkExecutionSandbox'");
    expect(commands).toContain("import('./views/sandboxCheckCommand.js')");
  });

  it('never probes on activation or a timer — only the command starts it', () => {
    const extension = readFileSync(path.join(ROOT_DIR, 'src', 'extension.ts'), 'utf8');
    expect(extension).not.toContain('probeSandbox');
    expect(extension).not.toContain('sandboxCheckCommand');
  });
});
