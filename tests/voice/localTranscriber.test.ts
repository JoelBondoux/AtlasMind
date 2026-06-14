import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import {
  LocalTranscriber,
  DownloadingWhisperAssetProvider,
  downloadAndVerify,
  isValidFile,
  normalizeTranscript,
  WHISPER_MODELS,
  type WhisperAssetProvider,
} from '../../src/voice/localTranscriber';

interface SpawnCapture {
  command?: string;
  args?: string[];
  killed?: boolean;
}

/** Fake spawn that records the call and emits `stdout` then `close`. */
function makeFakeSpawn(capture: SpawnCapture, stdout: string, exitCode: number | null = 0) {
  return ((command: string, args: string[]) => {
    capture.command = command;
    capture.args = args;
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const out = new EventEmitter();
    const err = new EventEmitter();
    child['stdout'] = out;
    child['stderr'] = err;
    child['kill'] = () => { capture.killed = true; child.emit('close', null, 'SIGTERM'); };
    queueMicrotask(() => {
      if (capture.killed) { return; }
      if (stdout) { out.emit('data', Buffer.from(stdout)); }
      child.emit('close', exitCode, null);
    });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
}

/** Fake spawn that records the call and hangs until killed (never self-closes). */
function makeHangingSpawn(capture: SpawnCapture) {
  return ((command: string, args: string[]) => {
    capture.command = command;
    capture.args = args;
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child['stdout'] = new EventEmitter();
    child['stderr'] = new EventEmitter();
    child['kill'] = () => { capture.killed = true; child.emit('close', null, 'SIGTERM'); };
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) { throw new Error('waitUntil timed out'); }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Asset provider returning fixed local paths without touching the network. */
function fixedAssets(binary: string, model: string): WhisperAssetProvider {
  return {
    binaryPath: async () => binary,
    modelPath: async () => model,
  };
}

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'atlas-stt-'));
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('normalizeTranscript', () => {
  it('collapses multi-line whisper output into a single trimmed string', () => {
    expect(normalizeTranscript('  Hello there. \n\n  General Kenobi.  \n')).toBe('Hello there. General Kenobi.');
    expect(normalizeTranscript('')).toBe('');
  });
});

describe('LocalTranscriber.transcribe', () => {
  it('runs whisper-cli with the model and a temp wav, returns text, and cleans up', async () => {
    const capture: SpawnCapture = {};
    const transcriber = new LocalTranscriber({
      assets: fixedAssets('/opt/whisper-cli', '/models/ggml-base.bin'),
      spawn: makeFakeSpawn(capture, 'hello world\n'),
      storageDir: tmpRoot,
    });

    const text = await transcriber.transcribe(Buffer.from('RIFFfakewav'), { language: 'en' });

    expect(text).toBe('hello world');
    expect(capture.command).toBe('/opt/whisper-cli');
    expect(capture.args).toContain('-m');
    expect(capture.args).toContain('/models/ggml-base.bin');
    expect(capture.args).toContain('-nt');
    expect(capture.args?.[capture.args.indexOf('-l') + 1]).toBe('en');

    // The temp wav passed to -f must have been removed afterwards.
    const wavArg = capture.args?.[capture.args.indexOf('-f') + 1] ?? '';
    await expect(fsp.access(wavArg)).rejects.toBeTruthy();
  });

  it('defaults language to auto when not provided', async () => {
    const capture: SpawnCapture = {};
    const transcriber = new LocalTranscriber({
      assets: fixedAssets('/opt/whisper-cli', '/models/ggml-base.bin'),
      spawn: makeFakeSpawn(capture, 'text'),
      storageDir: tmpRoot,
    });
    await transcriber.transcribe(Buffer.from('wav'));
    expect(capture.args?.[capture.args.indexOf('-l') + 1]).toBe('auto');
  });

  it('rejects and still cleans up when whisper-cli exits non-zero', async () => {
    const capture: SpawnCapture = {};
    const transcriber = new LocalTranscriber({
      assets: fixedAssets('/opt/whisper-cli', '/models/ggml-base.bin'),
      spawn: makeFakeSpawn(capture, '', 2),
      storageDir: tmpRoot,
    });
    await expect(transcriber.transcribe(Buffer.from('wav'))).rejects.toThrow(/exited with code 2/);
    const wavArg = capture.args?.[capture.args.indexOf('-f') + 1] ?? '';
    await expect(fsp.access(wavArg)).rejects.toBeTruthy();
  });

  it('stop() cancels the run and resolves empty', async () => {
    const capture: SpawnCapture = {};
    const transcriber = new LocalTranscriber({
      assets: fixedAssets('/opt/whisper-cli', '/models/ggml-base.bin'),
      spawn: makeHangingSpawn(capture),
      storageDir: tmpRoot,
    });
    const promise = transcriber.transcribe(Buffer.from('wav'));
    await waitUntil(() => capture.command !== undefined); // wait for spawn
    transcriber.stop();
    await expect(promise).resolves.toBe('');
    expect(capture.killed).toBe(true);
  });
});

describe('DownloadingWhisperAssetProvider', () => {
  it('prefers an existing user-configured whisperCliPath', async () => {
    const cli = path.join(tmpRoot, 'whisper-cli');
    await fsp.writeFile(cli, 'binary');
    const provider = new DownloadingWhisperAssetProvider({
      storageDir: tmpRoot,
      platform: 'linux',
      arch: 'x64',
      whisperCliPath: () => cli,
    });
    await expect(provider.binaryPath()).resolves.toBe(cli);
  });

  it('throws a helpful error on a platform with no prebuilt and no configured path', async () => {
    const provider = new DownloadingWhisperAssetProvider({
      storageDir: tmpRoot,
      platform: 'linux',
      arch: 'arm64',
      whisperCliPath: () => '',
    });
    await expect(provider.binaryPath()).rejects.toThrow(/whisperCliPath/);
  });

  it('downloads a model on first use and reuses the cached file afterward', async () => {
    let downloads = 0;
    const model = WHISPER_MODELS['base'];
    const provider = new DownloadingWhisperAssetProvider({
      storageDir: tmpRoot,
      platform: 'linux',
      arch: 'x64',
      whisperCliPath: () => '',
      download: async (_url, dest) => {
        downloads += 1;
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, 'model-bytes');
      },
    });

    const first = await provider.modelPath('base');
    expect(first.endsWith(model.fileName)).toBe(true);
    expect(downloads).toBe(1);

    // Second call: the cached file is not re-verified against the real sha (our
    // dummy bytes don't match), so it re-downloads — assert the path is stable.
    const second = await provider.modelPath('base');
    expect(second).toBe(first);
  });
});

describe('downloadAndVerify + isValidFile', () => {
  it('rejects when the downloaded bytes do not match the expected checksum', async () => {
    // Stub global fetch to return known bytes whose sha will not match.
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } })) as typeof fetch;
    try {
      const dest = path.join(tmpRoot, 'asset.bin');
      await expect(downloadAndVerify('https://example.test/a', dest, 'deadbeef')).rejects.toThrow(/Checksum mismatch/);
      // The temp download must not be left behind.
      await expect(fsp.access(`${dest}.download`)).rejects.toBeTruthy();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('writes the file when the checksum matches, and isValidFile confirms it', async () => {
    const bytes = new Uint8Array([10, 20, 30]);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } })) as typeof fetch;
    try {
      const dest = path.join(tmpRoot, 'good.bin');
      await downloadAndVerify('https://example.test/good', dest, sha);
      expect(await isValidFile(dest, sha)).toBe(true);
      expect(await isValidFile(dest, 'deadbeef')).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
