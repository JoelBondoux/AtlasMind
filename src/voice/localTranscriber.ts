import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

/** Minimal subset of `child_process.spawn`; injectable for tests. */
export type SpawnLike = typeof nodeSpawn;

/** Reports download progress; `total` is 0 when the server omits Content-Length. */
export type ProgressFn = (received: number, total: number) => void;

/** A downloadable GGML Whisper model. */
export interface ModelArtifact {
  id: string;
  url: string;
  sha256: string;
  fileName: string;
}

/** A downloadable prebuilt whisper.cpp CLI bundle. */
export interface BinaryArtifact {
  url: string;
  sha256: string;
  /** Local file name for the cached archive. */
  archiveName: string;
  /** Sub-directory name the archive is extracted into. */
  extractDirName: string;
  /** Path to the executable relative to the extraction directory. */
  executableRelPath: string;
}

/**
 * Pinned GGML models (Hugging Face `ggerganov/whisper.cpp`). Checksums verified
 * against the published Xet pointer for each file.
 */
export const WHISPER_MODELS: Record<string, ModelArtifact> = {
  base: {
    id: 'base',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    fileName: 'ggml-base.bin',
  },
};

export const DEFAULT_MODEL_ID = 'base';

/**
 * Official prebuilt whisper.cpp CLI. Only Windows x64 ships an official prebuilt
 * asset (verified by downloading and hashing v1.8.6's `whisper-bin-x64.zip`).
 * Other platforms must point `atlasmind.voice.whisperCliPath` at an installed
 * `whisper-cli` (e.g. `brew install whisper-cpp`).
 */
export const WINDOWS_X64_BINARY: BinaryArtifact = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.6/whisper-bin-x64.zip',
  sha256: 'b07ea0b1b4115a38e1a7b07debf581f0b77d999925f8acb8f39d322b0ba0a822',
  archiveName: 'whisper-bin-x64-v1.8.6.zip',
  extractDirName: 'whisper-v1.8.6-x64',
  executableRelPath: path.join('Release', 'whisper-cli.exe'),
};

/** Resolves the local paths to the whisper-cli executable and a GGML model. */
export interface WhisperAssetProvider {
  /** Absolute path to a ready-to-run whisper-cli executable. */
  binaryPath(onProgress?: ProgressFn): Promise<string>;
  /** Absolute path to a verified GGML model file. */
  modelPath(modelId: string, onProgress?: ProgressFn): Promise<string>;
}

/** Downloads, verifies, and caches the whisper-cli binary and GGML models. */
export interface AssetProviderDeps {
  /** Base directory for cached assets (typically the extension's globalStorage). */
  storageDir: string;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Returns the user-configured `whisperCliPath`, or '' when unset. */
  whisperCliPath?: () => string;
  spawn?: SpawnLike;
  /** Streaming download+verify; injectable so tests avoid the network. */
  download?: (url: string, dest: string, sha256: string, onProgress?: ProgressFn) => Promise<void>;
}

export class DownloadingWhisperAssetProvider implements WhisperAssetProvider {
  private readonly _storageDir: string;
  private readonly _platform: NodeJS.Platform;
  private readonly _arch: string;
  private readonly _whisperCliPath: () => string;
  private readonly _spawn: SpawnLike;
  private readonly _download: (url: string, dest: string, sha256: string, onProgress?: ProgressFn) => Promise<void>;

  constructor(deps: AssetProviderDeps) {
    this._storageDir = deps.storageDir;
    this._platform = deps.platform ?? process.platform;
    this._arch = deps.arch ?? process.arch;
    this._whisperCliPath = deps.whisperCliPath ?? (() => '');
    this._spawn = deps.spawn ?? nodeSpawn;
    this._download = deps.download ?? downloadAndVerify;
  }

  public async modelPath(modelId: string, onProgress?: ProgressFn): Promise<string> {
    const model = WHISPER_MODELS[modelId] ?? WHISPER_MODELS[DEFAULT_MODEL_ID];
    const dir = path.join(this._storageDir, 'models');
    const dest = path.join(dir, model.fileName);
    if (await isValidFile(dest, model.sha256)) { return dest; }
    await fsp.mkdir(dir, { recursive: true });
    await this._download(model.url, dest, model.sha256, onProgress);
    return dest;
  }

  public async binaryPath(onProgress?: ProgressFn): Promise<string> {
    // 1. Explicit user-provided whisper-cli (works on every platform).
    const custom = this._whisperCliPath().trim();
    if (custom && (await pathExists(custom))) { return custom; }

    // 2. Auto-provision the official prebuilt — Windows x64 only.
    if (this._platform === 'win32' && this._arch === 'x64') {
      return this._ensureWindowsBinary(onProgress);
    }

    throw new Error(
      'No whisper-cli executable is available. Install whisper.cpp and set ' +
        '"atlasmind.voice.whisperCliPath" to the whisper-cli binary ' +
        '(for example, `brew install whisper-cpp` on macOS).',
    );
  }

  private async _ensureWindowsBinary(onProgress?: ProgressFn): Promise<string> {
    const artifact = WINDOWS_X64_BINARY;
    const binRoot = path.join(this._storageDir, 'bin');
    const extractDir = path.join(binRoot, artifact.extractDirName);
    const exe = path.join(extractDir, artifact.executableRelPath);
    if (await pathExists(exe)) { return exe; }

    const archive = path.join(binRoot, artifact.archiveName);
    await fsp.mkdir(binRoot, { recursive: true });
    if (!(await isValidFile(archive, artifact.sha256))) {
      await this._download(artifact.url, archive, artifact.sha256, onProgress);
    }
    await fsp.mkdir(extractDir, { recursive: true });
    await this._extractZip(archive, extractDir);
    if (!(await pathExists(exe))) {
      throw new Error(`whisper-cli not found after extracting ${artifact.archiveName}.`);
    }
    return exe;
  }

  /** Windows-only extraction via PowerShell. Paths are app-controlled (globalStorage). */
  private async _extractZip(zipPath: string, destDir: string): Promise<void> {
    const command =
      `Expand-Archive -LiteralPath '${psQuote(zipPath)}' -DestinationPath '${psQuote(destDir)}' -Force`;
    await new Promise<void>((resolve, reject) => {
      const child = this._spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < 4096) { stderr += chunk.toString(); } });
      child.on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
      child.on('close', (code) => {
        if (code === 0) { resolve(); }
        else { reject(new Error(`Expand-Archive failed (code ${code})${stderr ? `: ${stderr.trim()}` : ''}.`)); }
      });
    });
  }
}

/** Options for a single transcription. */
export interface TranscribeOptions {
  /** Model id (default `base`). */
  modelId?: string;
  /** BCP 47 / whisper language code; empty or 'auto' lets whisper detect. */
  language?: string;
  /** Reports asset-download progress on first use. */
  onProgress?: ProgressFn;
}

/**
 * On-device speech-to-text using a local whisper.cpp CLI.
 *
 * Audio is captured in the webview and handed to {@link transcribe} as a 16 kHz
 * mono 16-bit WAV buffer. The audio never leaves the machine; only the model and
 * (on Windows) the CLI are downloaded, both SHA-256-verified over HTTPS. The WAV
 * is written to a temp file, transcribed, and deleted; whisper-cli is spawned
 * without a shell with the file path as an argv element.
 */
export class LocalTranscriber {
  private readonly _assets: WhisperAssetProvider;
  private readonly _spawn: SpawnLike;
  private readonly _storageDir: string;
  private _current: ChildProcess | undefined;

  constructor(deps: { assets: WhisperAssetProvider; spawn?: SpawnLike; storageDir: string }) {
    this._assets = deps.assets;
    this._spawn = deps.spawn ?? nodeSpawn;
    this._storageDir = deps.storageDir;
  }

  /** Ensure the model and binary are present, downloading on first use. */
  public async ensureReady(modelId: string = DEFAULT_MODEL_ID, onProgress?: ProgressFn): Promise<void> {
    await this._assets.binaryPath(onProgress);
    await this._assets.modelPath(modelId, onProgress);
  }

  /** Transcribe a 16 kHz mono 16-bit WAV buffer to text. */
  public async transcribe(wav: Buffer, options: TranscribeOptions = {}): Promise<string> {
    const modelId = options.modelId ?? DEFAULT_MODEL_ID;
    const binary = await this._assets.binaryPath(options.onProgress);
    const model = await this._assets.modelPath(modelId, options.onProgress);

    const tmpDir = path.join(this._storageDir, 'tmp');
    await fsp.mkdir(tmpDir, { recursive: true });
    const wavPath = path.join(tmpDir, `capture-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    await fsp.writeFile(wavPath, wav);

    const language = (options.language ?? '').trim() || 'auto';
    const args = ['-m', model, '-f', wavPath, '-nt', '-np', '-l', language];

    try {
      return await this._runWhisper(binary, args);
    } finally {
      await safeUnlink(wavPath);
    }
  }

  /** Cancel any in-progress transcription. */
  public stop(): void {
    if (this._current) {
      try { this._current.kill(); } catch { /* ignore */ }
      this._current = undefined;
    }
  }

  public dispose(): void {
    this.stop();
  }

  private _runWhisper(binary: string, args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this._spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this._current = child;

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < 8192) { stderr += chunk.toString(); } });
      child.on('error', (err) => {
        if (this._current === child) { this._current = undefined; }
        reject(err instanceof Error ? err : new Error(String(err)));
      });
      child.on('close', (code, signal) => {
        if (this._current === child) { this._current = undefined; }
        if (signal) { resolve(''); return; } // cancelled via stop()
        if (code === 0) { resolve(normalizeTranscript(stdout)); return; }
        reject(new Error(`whisper-cli exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}.`));
      });
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Collapse whisper-cli's per-segment stdout into a single trimmed string. */
export function normalizeTranscript(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stream a download to disk, verifying its SHA-256 before committing the file. */
export async function downloadAndVerify(
  url: string,
  dest: string,
  sha256: string,
  onProgress?: ProgressFn,
): Promise<void> {
  const fetchImpl = (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch;
  if (!fetchImpl) { throw new Error('fetch is not available in this runtime; cannot download whisper assets.'); }

  const response = await fetchImpl(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  const hash = createHash('sha256');
  const tmp = `${dest}.download`;
  const out = createWriteStream(tmp);
  let received = 0;

  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { break; }
      hash.update(value);
      received += value.length;
      if (!out.write(value)) { await once(out, 'drain'); }
      onProgress?.(received, total);
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    await safeUnlink(tmp);
    throw err instanceof Error ? err : new Error(String(err));
  }

  const actual = hash.digest('hex').toLowerCase();
  if (actual !== sha256.toLowerCase()) {
    await safeUnlink(tmp);
    throw new Error(`Checksum mismatch for ${url}: expected ${sha256}, got ${actual}`);
  }
  await fsp.rename(tmp, dest);
}

/** True when `file` exists and its SHA-256 matches `expectedSha`. */
export async function isValidFile(file: string, expectedSha: string): Promise<boolean> {
  if (!(await pathExists(file))) { return false; }
  const actual = await sha256File(file);
  return actual.toLowerCase() === expectedSha.toLowerCase();
}

async function sha256File(file: string): Promise<string> {
  const buffer = await fsp.readFile(file);
  return createHash('sha256').update(buffer).digest('hex');
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function safeUnlink(target: string): Promise<void> {
  try {
    await fsp.unlink(target);
  } catch {
    /* ignore */
  }
}

/** Escape single quotes for a PowerShell single-quoted string literal. */
function psQuote(value: string): string {
  return value.replace(/'/g, "''");
}
