import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SkillExecutionContext } from '../types.js';
import { NodeMemoryManager } from './nodeMemoryManager.js';

const execFileAsync = promisify(execFile);
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'out', 'dist', 'coverage']);

export function createNodeSkillExecutionContext(
  workspaceRootPath: string,
  memoryManager: NodeMemoryManager,
): SkillExecutionContext {
  const absoluteWorkspaceRoot = path.resolve(workspaceRootPath);

  return {
    workspaceRootPath: absoluteWorkspaceRoot,
    queryMemory(query, maxResults) {
      return memoryManager.queryRelevant(query, maxResults);
    },
    upsertMemory(entry) {
      return memoryManager.upsert(entry);
    },
    deleteMemory(entryPath) {
      return memoryManager.delete(entryPath);
    },
    async readFile(absolutePath) {
      const resolvedPath = assertInsideWorkspace(absoluteWorkspaceRoot, absolutePath, 'readFile');
      return fs.readFile(resolvedPath, 'utf-8');
    },
    async writeFile(absolutePath, content) {
      const resolvedPath = assertInsideWorkspace(absoluteWorkspaceRoot, absolutePath, 'writeFile');
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.writeFile(resolvedPath, content, 'utf-8');
    },
    async findFiles(globPattern) {
      const files = await walkWorkspaceFiles(absoluteWorkspaceRoot);
      return files.filter(filePath => matchesGlob(toWorkspaceRelativePath(absoluteWorkspaceRoot, filePath), globPattern));
    },
    async searchInFiles(query, options) {
      const includePattern = options?.includePattern?.trim() || '**/*';
      const maxResults = clampInteger(options?.maxResults, 20, 1, 200);
      const matcher = options?.isRegexp === true ? new RegExp(query, 'i') : query.toLowerCase();
      const files = await walkWorkspaceFiles(absoluteWorkspaceRoot);
      const matches: Array<{ path: string; line: number; text: string }> = [];

      for (const filePath of files) {
        const relativePath = toWorkspaceRelativePath(absoluteWorkspaceRoot, filePath);
        if (!matchesGlob(relativePath, includePattern)) {
          continue;
        }

        let content: string;
        try {
          content = await fs.readFile(filePath, 'utf-8');
        } catch {
          continue;
        }
        if (content.includes('\u0000')) {
          continue;
        }

        const lines = content.split(/\r?\n/g);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? '';
          const matched = typeof matcher === 'string'
            ? line.toLowerCase().includes(matcher)
            : matcher.test(line);
          if (!matched) {
            continue;
          }
          matches.push({ path: filePath, line: index + 1, text: line.trim() });
          if (matches.length >= maxResults) {
            return matches;
          }
        }
      }

      return matches;
    },
    async listDirectory(absolutePath) {
      const targetPath = absolutePath?.trim() ? assertInsideWorkspace(absoluteWorkspaceRoot, absolutePath, 'listDirectory') : absoluteWorkspaceRoot;
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      return entries.map(entry => ({
        path: path.join(targetPath, entry.name),
        type: entry.isDirectory() ? 'directory' as const : 'file' as const,
      }));
    },
    async runCommand(executable, args = [], options) {
      const cwd = options?.cwd ? assertInsideWorkspace(absoluteWorkspaceRoot, options.cwd, 'runCommand') : absoluteWorkspaceRoot;
      try {
        const result = await execFileAsync(executable, args, {
          cwd,
          timeout: clampInteger(options?.timeoutMs, 30000, 1000, 300000),
          maxBuffer: 1024 * 1024 * 4,
        });
        return { ok: true, exitCode: 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
      } catch (error) {
        const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string };
        return {
          ok: false,
          exitCode: typeof failure.code === 'number' ? failure.code : 1,
          stdout: failure.stdout ?? '',
          stderr: failure.stderr ?? failure.message ?? 'Command failed.',
        };
      }
    },
    getGitStatus() {
      return runGitText(absoluteWorkspaceRoot, ['status', '--short', '--branch']);
    },
    getGitDiff(options) {
      const args = ['diff'];
      if (options?.staged) {
        args.push('--cached');
      }
      if (options?.ref) {
        args.push(options.ref);
      }
      return runGitText(absoluteWorkspaceRoot, args);
    },
    async rollbackLastCheckpoint() {
      return { ok: false, summary: 'Checkpoint rollback is not supported in the CLI yet.', restoredPaths: [] };
    },
    async applyGitPatch(patch, options) {
      const tempPath = path.join(os.tmpdir(), `atlasmind-${Date.now()}.patch`);
      await fs.writeFile(tempPath, patch, 'utf-8');
      try {
        const args = ['apply'];
        if (options?.checkOnly) {
          args.push('--check');
        }
        if (options?.stage) {
          args.push('--index');
        }
        args.push(tempPath);
        const output = await runGitDetailed(absoluteWorkspaceRoot, args);
        return { ok: output.exitCode === 0, stdout: output.stdout, stderr: output.stderr };
      } finally {
        await fs.unlink(tempPath).catch(() => undefined);
      }
    },
    getGitLog(options) {
      const args = ['log', '--oneline', `--max-count=${clampInteger(options?.maxCount, 20, 1, 200)}`];
      if (options?.ref) {
        args.push(options.ref);
      }
      if (options?.filePath) {
        args.push('--', assertInsideWorkspace(absoluteWorkspaceRoot, options.filePath, 'getGitLog'));
      }
      return runGitText(absoluteWorkspaceRoot, args);
    },
    gitBranch(action, name) {
      const argsByAction: Record<string, string[]> = {
        list: ['branch', '--list'],
        create: ['branch', name ?? ''],
        switch: ['switch', name ?? ''],
        delete: ['branch', '--delete', name ?? ''],
      };
      return runGitText(absoluteWorkspaceRoot, argsByAction[action]);
    },
    async deleteFile(absolutePath) {
      const resolvedPath = assertInsideWorkspace(absoluteWorkspaceRoot, absolutePath, 'deleteFile');
      await fs.unlink(resolvedPath);
    },
    async moveFile(sourcePath, destPath) {
      const source = assertInsideWorkspace(absoluteWorkspaceRoot, sourcePath, 'moveFile');
      const dest = assertInsideWorkspace(absoluteWorkspaceRoot, destPath, 'moveFile');
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.rename(source, dest);
    },
    async getDiagnostics() {
      return [];
    },
    async getSpecialistApiKey(providerId) {
      const envKey = providerId.toUpperCase().replace(/-/g, '_');
      const value = process.env[`ATLASMIND_SPECIALIST_${envKey}_APIKEY`];
      return value || undefined;
    },
    async getOutputChannelNames() {
      return [];
    },
    async getAtlasMindOutputLog() {
      return 'Output channel reading is not available in the CLI environment.';
    },
    async getDebugSessions() {
      return [];
    },
    async evaluateDebugExpression(_expression, _frameId) {
      return 'Error: Debug session evaluation is not available in the CLI environment.';
    },
    async getDocumentSymbols() {
      return [];
    },
    async findReferences() {
      return [];
    },
    async goToDefinition() {
      return [];
    },
    async renameSymbol() {
      return { filesChanged: 0, editsApplied: 0 };
    },
    async fetchUrl(url, options) {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(clampInteger(options?.timeoutMs, 10000, 1000, 60000)),
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      const maxBytes = clampInteger(options?.maxBytes, 500000, 1024, 5_000_000);
      return {
        ok: response.ok,
        status: response.status,
        body: buffer.subarray(0, maxBytes).toString('utf-8'),
      };
    },
    async getCodeActions() {
      return [];
    },
    async applyCodeAction() {
      return { applied: false, reason: 'Code actions are not supported in the CLI yet.' };
    },
    async getTestResults() {
      return [];
    },
    async getActiveDebugSession() {
      return null;
    },
    async listTerminals() {
      return [];
    },
    async getTerminalOutput() {
      return '';
    },
    async getInstalledExtensions() {
      return [];
    },
    async getPortForwards() {
      return [];
    },
  };
}

function assertInsideWorkspace(workspaceRoot: string, targetPath: string, operation: string): string {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) && !resolved.startsWith(workspaceRoot)) {
    throw new Error(`${operation}: path must stay inside the workspace.`);
  }
  return resolved;
}

async function walkWorkspaceFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) {
        continue;
      }
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  await walk(rootPath);
  return files;
}

function toWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join('/');
}

function matchesGlob(relativePath: string, globPattern: string): boolean {
  const regex = globToRegExp(globPattern);
  return regex.test(relativePath);
}

function globToRegExp(globPattern: string): RegExp {
  const escaped = globPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, candidate));
}

async function runGitText(workspaceRoot: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', args, { cwd: workspaceRoot, maxBuffer: 1024 * 1024 * 4 });
    return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string; code?: number };
    return `${failure.stdout ?? ''}${failure.stderr ?? failure.message ?? 'Git command failed.'}`.trim();
  }
}

async function runGitDetailed(workspaceRoot: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync('git', args, { cwd: workspaceRoot, maxBuffer: 1024 * 1024 * 4 });
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string; code?: number };
    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message ?? 'Git command failed.',
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
    };
  }
}