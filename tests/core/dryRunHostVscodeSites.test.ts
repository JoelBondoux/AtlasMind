import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The guarded sites that need `vscode`: webhook delivery, which reads its
 * settings from the workspace configuration, and the roadmap rule written into
 * instruction files when the Roadmap page opens.
 */

const settings = vi.hoisted(() => new Map<string, unknown>());

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({ get: (key: string, fallback?: unknown) => (settings.has(key) ? settings.get(key) : fallback) }),
    fs: {
      writeFile: async (uri: { fsPath: string }, data: Uint8Array) => {
        mkdirSync(path.dirname(uri.fsPath), { recursive: true });
        writeFileSync(uri.fsPath, Buffer.from(data));
      },
    },
  },
  window: { showWarningMessage: vi.fn() },
  Uri: { file: (p: string) => ({ path: p, fsPath: p }) },
  default: {},
}));

import { DryRunLedger } from '../../src/core/dryRun.ts';
import { DryRunHost, installDryRunHost } from '../../src/core/dryRunHost.ts';
import { ToolWebhookDispatcher } from '../../src/core/toolWebhookDispatcher.ts';
import { ROADMAP_SYNC_BLOCK_START, syncRoadmapInstructions } from '../../src/utils/testingProtocolSync.ts';
import { removeTempDir } from '../helpers/tempDir';

let ledger: DryRunLedger;
let notify: ReturnType<typeof vi.fn<(message: string) => void>>;
let uninstall: (() => void) | undefined;
let dryRun = false;

beforeEach(() => {
  dryRun = false;
  ledger = new DryRunLedger();
  notify = vi.fn<(message: string) => void>();
  uninstall = installDryRunHost(new DryRunHost({ isEnabled: () => dryRun, record: record => ledger.record(record), notify }));
  settings.clear();
});

afterEach(() => {
  uninstall?.();
  vi.unstubAllGlobals();
});

function dispatcher() {
  settings.set('toolWebhookEnabled', true);
  settings.set('toolWebhookUrl', 'https://hooks.example.com/atlas');
  settings.set('toolWebhookEvents', ['tool.completed']);
  const context = {
    secrets: { get: vi.fn(async () => undefined) },
    workspaceState: { get: vi.fn(() => true), update: vi.fn() },
    globalState: { get: vi.fn(() => []), update: vi.fn() },
  };
  const output = { appendLine: vi.fn() };
  return { webhooks: new ToolWebhookDispatcher(context as never, output as never), output };
}

describe('webhooks', () => {
  it('sends no webhook in a dry run; the test button says so and an event does not', async () => {
    dryRun = true;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { webhooks, output } = dispatcher();

    await webhooks.emit({ event: 'tool.completed', timestamp: 'now', toolName: 'file-write' });
    expect(notify).not.toHaveBeenCalled();
    await webhooks.sendTestEvent();
    expect(notify).toHaveBeenCalledTimes(1);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ledger.list().map(record => record.rule)).toEqual(['dry-run.host-message', 'dry-run.host-message']);
    expect(output.appendLine).toHaveBeenCalledWith(expect.stringContaining('not sent: dry run is on'));
  });

  it('delivers as before when dry run is off', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { webhooks } = dispatcher();
    await webhooks.sendTestEvent();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(ledger.list()).toEqual([]);
  });
});

describe('the roadmap rule written when the Roadmap page opens', () => {
  it('writes no instruction file in a dry run, and is not reported as a failure', async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'atlas-dry-roadmap-'));
    try {
      dryRun = true;
      const result = await syncRoadmapInstructions(workspace, 'project_memory');
      expect(existsSync(path.join(workspace, 'AGENTS.md'))).toBe(false);
      expect(result.success).toBe(true);
      expect(result.summary).toContain('Dry run is on');
      expect(ledger.list().map(record => record.rule)).toEqual(['dry-run.host-auto-write']);
      expect(notify).not.toHaveBeenCalled();

      dryRun = false;
      await syncRoadmapInstructions(workspace, 'project_memory');
      expect(readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8')).toContain(ROADMAP_SYNC_BLOCK_START);
    } finally {
      removeTempDir(workspace);
    }
  });
});
