import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckpointManager } from '../../src/core/checkpointManager.ts';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function makeTempWorkspace(): Promise<{ workspaceRoot: string; storageRoot: string; filePath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlasmind-checkpoint-'));
  tempRoots.push(root);
  const workspaceRoot = path.join(root, 'workspace');
  const storageRoot = path.join(root, 'storage');
  await fs.mkdir(workspaceRoot, { recursive: true });
  const filePath = path.join(workspaceRoot, 'src', 'app.ts');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'before', 'utf-8');
  return { workspaceRoot, storageRoot, filePath };
}

describe('CheckpointManager', () => {
  it('persists checkpoints so rollback survives a new manager instance', async () => {
    const { workspaceRoot, storageRoot, filePath } = await makeTempWorkspace();

    const firstManager = new CheckpointManager(workspaceRoot, storageRoot);
    await firstManager.captureFiles('task-1', [filePath]);
    await fs.writeFile(filePath, 'after', 'utf-8');

    const secondManager = new CheckpointManager(workspaceRoot, storageRoot);
    const result = await secondManager.rollbackLatest();

    expect(result.ok).toBe(true);
    expect(result.restoredPaths).toEqual([filePath]);
    expect(await fs.readFile(filePath, 'utf-8')).toBe('before');
  });

  it('rejects checkpoint paths outside the workspace root', async () => {
    const { workspaceRoot, storageRoot } = await makeTempWorkspace();
    const manager = new CheckpointManager(workspaceRoot, storageRoot);
    const outsidePath = path.join(path.dirname(workspaceRoot), 'outside.txt');

    await expect(manager.captureFiles('task-2', [outsidePath])).rejects.toThrow('outside the workspace');
  });
});