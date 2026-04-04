import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface FileSnapshot {
  path: string;
  existed: boolean;
  content?: string;
}

interface CheckpointRecord {
  id: string;
  taskId: string;
  createdAt: string;
  files: FileSnapshot[];
}

import { MAX_CHECKPOINTS } from '../constants.js';

export class CheckpointManager {
  private checkpoints: CheckpointRecord[] = [];
  private loaded = false;
  private readonly metadataPath: string;

  constructor(
    private workspaceRootPath: string,
    private storageRootPath: string,
  ) {
    this.metadataPath = path.join(this.storageRootPath, 'checkpoints.json');
  }

  async captureFiles(taskId: string, absolutePaths: string[]): Promise<void> {
    await this.ensureLoaded();
    const uniquePaths = [...new Set(absolutePaths.map(filePath => path.resolve(filePath)))];
    if (uniquePaths.length === 0) {
      return;
    }

    const checkpoint = this.getOrCreateCheckpoint(taskId);
    for (const absolutePath of uniquePaths) {
      if (checkpoint.files.some(snapshot => snapshot.path === absolutePath)) {
        continue;
      }

      const snapshot = await this.readSnapshot(absolutePath);
      checkpoint.files.push(snapshot);
    }

    await this.persist();
  }

  async rollbackLatest(): Promise<{ ok: boolean; summary: string; restoredPaths: string[] }> {
    await this.ensureLoaded();
    const checkpoint = this.checkpoints.pop();
    if (!checkpoint) {
      return {
        ok: false,
        summary: 'No checkpoint is available to roll back.',
        restoredPaths: [],
      };
    }

    const restoredPaths: string[] = [];

    for (const snapshot of checkpoint.files) {
      if (snapshot.existed) {
        await fs.mkdir(path.dirname(snapshot.path), { recursive: true });
        await fs.writeFile(snapshot.path, snapshot.content ?? '', 'utf-8');
      } else {
        await fs.rm(snapshot.path, { force: true });
      }
      restoredPaths.push(snapshot.path);
    }

    return {
      ok: true,
      summary:
        `Rolled back checkpoint ${checkpoint.id} from ${checkpoint.createdAt}. ` +
        `Restored ${restoredPaths.length} file${restoredPaths.length === 1 ? '' : 's'}.`,
      restoredPaths,
    };
  }

  private getOrCreateCheckpoint(taskId: string): CheckpointRecord {
    const existing = this.checkpoints.find(checkpoint => checkpoint.taskId === taskId);
    if (existing) {
      return existing;
    }

    const created: CheckpointRecord = {
      id: `checkpoint-${Date.now()}-${this.checkpoints.length + 1}`,
      taskId,
      createdAt: new Date().toISOString(),
      files: [],
    };
    this.checkpoints.push(created);
    if (this.checkpoints.length > MAX_CHECKPOINTS) {
      this.checkpoints.shift();
    }
    return created;
  }

  private async readSnapshot(absolutePath: string): Promise<FileSnapshot> {
    const resolvedPath = path.resolve(absolutePath);
    if (!isPathInside(resolvedPath, this.workspaceRootPath)) {
      throw new Error(`Checkpoint path is outside the workspace: ${absolutePath}`);
    }

    try {
      const content = await fs.readFile(resolvedPath, 'utf-8');
      return {
        path: resolvedPath,
        existed: true,
        content,
      };
    } catch {
      return {
        path: resolvedPath,
        existed: false,
      };
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await fs.mkdir(this.storageRootPath, { recursive: true });
    try {
      const raw = await fs.readFile(this.metadataPath, 'utf-8');
      const parsed = JSON.parse(raw) as { checkpoints?: CheckpointRecord[] };
      this.checkpoints = Array.isArray(parsed.checkpoints)
        ? parsed.checkpoints
          .filter(isCheckpointRecord)
          .slice(-MAX_CHECKPOINTS)
        : [];
    } catch {
      this.checkpoints = [];
    }

    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(this.storageRootPath, { recursive: true });
    const payload = JSON.stringify({ checkpoints: this.checkpoints }, null, 2);
    await fs.writeFile(this.metadataPath, payload, 'utf-8');
  }
}

function isCheckpointRecord(value: unknown): value is CheckpointRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const maybe = value as Record<string, unknown>;
  return typeof maybe['id'] === 'string'
    && typeof maybe['taskId'] === 'string'
    && typeof maybe['createdAt'] === 'string'
    && Array.isArray(maybe['files'])
    && maybe['files'].every(isFileSnapshot);
}

function isFileSnapshot(value: unknown): value is FileSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const maybe = value as Record<string, unknown>;
  return typeof maybe['path'] === 'string'
    && typeof maybe['existed'] === 'boolean'
    && (typeof maybe['content'] === 'string' || typeof maybe['content'] === 'undefined');
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedRoot = path.resolve(rootPath);
  if (resolvedCandidate === resolvedRoot) {
    return true;
  }

  const normalizedCandidate = process.platform === 'win32'
    ? resolvedCandidate.toLowerCase()
    : resolvedCandidate;
  const normalizedRoot = process.platform === 'win32'
    ? resolvedRoot.toLowerCase()
    : resolvedRoot;

  return normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}
