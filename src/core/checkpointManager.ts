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
  files: Map<string, FileSnapshot>;
}

const MAX_CHECKPOINTS = 10;

export class CheckpointManager {
  private checkpoints: CheckpointRecord[] = [];

  constructor(private workspaceRootPath: string) {}

  async captureFiles(taskId: string, absolutePaths: string[]): Promise<void> {
    const uniquePaths = [...new Set(absolutePaths.map(filePath => path.resolve(filePath)))];
    if (uniquePaths.length === 0) {
      return;
    }

    const checkpoint = this.getOrCreateCheckpoint(taskId);
    for (const absolutePath of uniquePaths) {
      if (checkpoint.files.has(absolutePath)) {
        continue;
      }

      const snapshot = await this.readSnapshot(absolutePath);
      checkpoint.files.set(absolutePath, snapshot);
    }
  }

  async rollbackLatest(): Promise<{ ok: boolean; summary: string; restoredPaths: string[] }> {
    const checkpoint = this.checkpoints.pop();
    if (!checkpoint) {
      return {
        ok: false,
        summary: 'No checkpoint is available to roll back.',
        restoredPaths: [],
      };
    }

    const restoredPaths: string[] = [];

    for (const snapshot of checkpoint.files.values()) {
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
      files: new Map<string, FileSnapshot>(),
    };
    this.checkpoints.push(created);
    if (this.checkpoints.length > MAX_CHECKPOINTS) {
      this.checkpoints.shift();
    }
    return created;
  }

  private async readSnapshot(absolutePath: string): Promise<FileSnapshot> {
    const resolvedPath = path.resolve(absolutePath);
    if (!resolvedPath.startsWith(path.resolve(this.workspaceRootPath))) {
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
}
