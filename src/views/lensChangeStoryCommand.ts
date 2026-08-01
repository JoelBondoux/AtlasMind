import { execFile } from 'node:child_process';
import path from 'node:path';

import * as vscode from 'vscode';

import {
  buildLensChangeStory,
  LENS_CHANGE_STORY_MAX_CHANGES,
  LENS_CHANGE_STORY_MAX_COMMITS,
} from '../core/lensChangeStory.js';
import type { LensChangeCommit, LensChangedPath, LensChangeStatus } from '../core/lensChangeStory.js';
import { LensChangeStoryPanel } from './lensChangeStoryPanel.js';

interface WorkspacePick extends vscode.QuickPickItem { folder: vscode.WorkspaceFolder }
interface BasePick extends vscode.QuickPickItem { ref: string }

/** Build a bounded committed-branch review story from local read-only Git evidence. */
export async function reviewWorkspaceChangeStory(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    void vscode.window.showInformationMessage('Open a workspace before reviewing an AtlasMind Lens change story.');
    return;
  }
  const folder = await chooseWorkspaceFolder(folders);
  if (!folder) return;
  const workspaceRoot = path.resolve(folder.uri.fsPath);
  try {
    const repositoryRoot = path.resolve(await runGit(workspaceRoot, ['rev-parse', '--show-toplevel']));
    if (!isSamePath(repositoryRoot, workspaceRoot)) {
      void vscode.window.showInformationMessage('AtlasMind Lens Change Story currently requires the workspace folder to be the Git repository root.');
      return;
    }
    const branch = await readBranch(workspaceRoot);
    const refs = await readBaseRefs(workspaceRoot, branch);
    if (refs.length === 0) {
      void vscode.window.showInformationMessage('AtlasMind Lens found no local or remote base refs for this repository.');
      return;
    }
    const base = await vscode.window.showQuickPick<BasePick>(
      refs.map((ref, index) => ({
        label: ref,
        description: index === 0 ? 'Suggested base' : undefined,
        picked: index === 0,
        ref,
      })),
      { title: 'AtlasMind Lens — choose the change-story base', placeHolder: `Compare a merge-base with ${branch} HEAD` },
    );
    if (!base) return;
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'AtlasMind Lens: reading committed branch evidence', cancellable: false },
      async () => collectChangeStory(workspaceRoot, folder, branch, base.ref),
    );
    LensChangeStoryPanel.createOrShow(result);
  } catch {
    void vscode.window.showWarningMessage('AtlasMind Lens could not build a safe local change story from this repository.');
  }
}

async function collectChangeStory(
  workspaceRoot: string,
  folder: vscode.WorkspaceFolder,
  branch: string,
  baseRef: string,
) {
  const mergeBase = await runGit(workspaceRoot, ['merge-base', '--', baseRef, 'HEAD']);
  const [commitOutput, changeOutput, worktreeOutput] = await Promise.all([
    runGit(workspaceRoot, ['log', '-z', `--max-count=${LENS_CHANGE_STORY_MAX_COMMITS + 1}`, '--format=%H%n%aI%n%an%n%s', `${mergeBase}..HEAD`, '--']),
    runGit(workspaceRoot, ['diff', '--name-status', '-z', '--find-renames', mergeBase, 'HEAD', '--']),
    runGit(workspaceRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']),
  ]);
  const commits = parseCommits(commitOutput);
  const changes = parseChanges(changeOutput);
  return buildLensChangeStory({
    branch,
    baseRef,
    mergeBase,
    workspace: { name: folder.name, index: folder.index },
    commits,
    changes,
    worktreeDirty: worktreeOutput.length > 0,
    commitsTruncated: commits.length > LENS_CHANGE_STORY_MAX_COMMITS,
    changesTruncated: changes.length > LENS_CHANGE_STORY_MAX_CHANGES,
  });
}

async function chooseWorkspaceFolder(folders: readonly vscode.WorkspaceFolder[]): Promise<vscode.WorkspaceFolder | undefined> {
  if (folders.length === 1) return folders[0];
  const active = vscode.window.activeTextEditor
    ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
    : undefined;
  const selected = await vscode.window.showQuickPick<WorkspacePick>(
    folders.map(folder => ({
      label: folder.name,
      description: folder.uri.fsPath,
      picked: folder.name === active?.name && folder.index === active.index,
      folder,
    })),
    { title: 'AtlasMind Lens — choose a workspace', placeHolder: 'Choose a Git repository root' },
  );
  return selected?.folder;
}

async function readBranch(workspaceRoot: string): Promise<string> {
  try {
    return await runGit(workspaceRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  } catch {
    return 'detached HEAD';
  }
}

async function readBaseRefs(workspaceRoot: string, branch: string): Promise<string[]> {
  const rawRefs = await runGit(workspaceRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']);
  const refs = rawRefs.split(/\r?\n/).map(value => value.trim()).filter(isSafeRef);
  let suggested: string | undefined;
  try {
    suggested = (await runGit(workspaceRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])).trim();
  } catch {
    suggested = ['develop', 'main', 'master', 'origin/develop', 'origin/main', 'origin/master'].find(candidate => refs.includes(candidate));
  }
  return [...new Set([...(suggested ? [suggested] : []), ...refs.filter(ref => ref !== branch && ref !== 'origin/HEAD')])].slice(0, 200);
}

function parseCommits(value: string): LensChangeCommit[] {
  return value.split('\0').flatMap(record => {
    const lines = record.replace(/^\r?\n|\r?\n$/g, '').split(/\r?\n/);
    if (lines.length < 4) return [];
    const [hash, authoredAt, author, ...subject] = lines;
    return [{ hash: hash!, authoredAt: authoredAt!, author: author!, subject: subject.join(' ') }];
  });
}

function parseChanges(value: string): LensChangedPath[] {
  const tokens = value.split('\0');
  const changes: LensChangedPath[] = [];
  for (let index = 0; index < tokens.length;) {
    const rawStatus = tokens[index++];
    if (!rawStatus) break;
    const status = toStatus(rawStatus);
    if (!status) throw new Error('Unsupported Git path status.');
    if (status === 'renamed' || status === 'copied') {
      const previousPath = tokens[index++];
      const workspacePath = tokens[index++];
      if (!previousPath || !workspacePath) throw new Error('Incomplete Git rename/copy evidence.');
      changes.push({ status, workspacePath, previousPath });
    } else {
      const workspacePath = tokens[index++];
      if (!workspacePath) throw new Error('Incomplete Git path evidence.');
      changes.push({ status, workspacePath });
    }
  }
  return changes;
}

function toStatus(value: string): LensChangeStatus | undefined {
  if (value.startsWith('R')) return 'renamed';
  if (value.startsWith('C')) return 'copied';
  if (value.startsWith('A')) return 'added';
  if (value.startsWith('M')) return 'modified';
  if (value.startsWith('D')) return 'deleted';
  if (value.startsWith('T')) return 'type-changed';
  if (value.startsWith('U')) return 'unmerged';
  return undefined;
}

function isSafeRef(value: string): boolean {
  return value.length > 0 && value.length <= 500 && !value.startsWith('-') && !/[\u0000-\u0020\u007f~^:?*[\\]/.test(value) && !value.includes('..') && !value.endsWith('.');
}

function isSamePath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function runGit(workspaceRoot: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: workspaceRoot, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trimEnd());
    });
  });
}
