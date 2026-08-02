import type { LensVisualTarget, LensWorkspaceIdentity } from '../types.js';
import { createSourceLensTarget, normalizeLensTarget } from './lensTarget.js';

export const LENS_CHANGE_STORY_MAX_COMMITS = 100;
export const LENS_CHANGE_STORY_MAX_CHANGES = 300;

export type LensChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'unmerged';
export type LensChangeCategory =
  | 'source'
  | 'test'
  | 'contract-schema'
  | 'configuration'
  | 'migration'
  | 'documentation'
  | 'automation'
  | 'other';

export interface LensChangeCommit {
  hash: string;
  subject: string;
  author: string;
  authoredAt: string;
}

export interface LensChangedPath {
  status: LensChangeStatus;
  workspacePath: string;
  previousPath?: string;
}

export interface LensChangeStoryInput {
  branch: string;
  baseRef: string;
  mergeBase: string;
  workspace: LensWorkspaceIdentity;
  commits: LensChangeCommit[];
  changes: LensChangedPath[];
  worktreeDirty: boolean;
  commitsTruncated?: boolean;
  changesTruncated?: boolean;
}

export interface LensChangeStoryItem extends LensChangedPath {
  id: string;
  category: LensChangeCategory;
  component: string;
  target?: LensVisualTarget;
}

export interface LensChangeStoryMap {
  version: 1;
  id: string;
  branch: string;
  baseRef: string;
  mergeBase: string;
  commits: LensChangeCommit[];
  changes: LensChangeStoryItem[];
  categoryCounts: Partial<Record<LensChangeCategory, number>>;
  componentCounts: Array<{ component: string; count: number }>;
  notices: string[];
  truncated: boolean;
}

/** Build a conservative local-branch story from already collected read-only Git evidence. */
export function buildLensChangeStory(candidate: LensChangeStoryInput): LensChangeStoryMap {
  const branch = boundedExactText(candidate.branch, 300);
  const baseRef = boundedExactText(candidate.baseRef, 500);
  const mergeBase = normalizeHash(candidate.mergeBase);
  const workspace = normalizeWorkspace(candidate.workspace);
  if (!branch || !baseRef || !mergeBase || !workspace || !Array.isArray(candidate.commits) || !Array.isArray(candidate.changes)) {
    throw new Error('AtlasMind Lens refused an invalid change-story input.');
  }
  const commitsTruncated = candidate.commitsTruncated === true || candidate.commits.length > LENS_CHANGE_STORY_MAX_COMMITS;
  const changesTruncated = candidate.changesTruncated === true || candidate.changes.length > LENS_CHANGE_STORY_MAX_CHANGES;
  const commits = candidate.commits.slice(0, LENS_CHANGE_STORY_MAX_COMMITS).map(normalizeCommit);
  if (commits.some(commit => !commit)) throw new Error('AtlasMind Lens refused invalid commit evidence.');
  const seenChanges = new Set<string>();
  const changes: LensChangeStoryItem[] = [];
  for (const raw of candidate.changes.slice(0, LENS_CHANGE_STORY_MAX_CHANGES)) {
    const change = normalizeChange(raw);
    const identity = change ? `${change.status}:${change.workspacePath}:${change.previousPath ?? ''}` : '';
    if (!change || seenChanges.has(identity)) throw new Error('AtlasMind Lens refused invalid or duplicate path evidence.');
    seenChanges.add(identity);
    const category = classifyPath(change.workspacePath);
    const component = change.workspacePath.split('/')[0] ?? change.workspacePath;
    const id = `lens-change:${stableHash(identity)}`;
    const target = change.status === 'deleted' ? undefined : toTarget(change, workspace, id, category);
    changes.push({ ...change, id, category, component, ...(target ? { target } : {}) });
  }
  const categoryCounts: Partial<Record<LensChangeCategory, number>> = {};
  const components = new Map<string, number>();
  for (const change of changes) {
    categoryCounts[change.category] = (categoryCounts[change.category] ?? 0) + 1;
    components.set(change.component, (components.get(change.component) ?? 0) + 1);
  }
  const componentCounts = [...components.entries()]
    .map(([component, count]) => ({ component, count }))
    .sort((left, right) => right.count - left.count || left.component.localeCompare(right.component))
    .slice(0, 30);
  const truncated = commitsTruncated || changesTruncated;
  return {
    version: 1,
    id: `lens-change-story:${stableHash(`${workspace.name}:${workspace.index}:${baseRef}:${branch}:${mergeBase}`)}`,
    branch,
    baseRef,
    mergeBase,
    commits: commits as LensChangeCommit[],
    changes,
    categoryCounts,
    componentCounts,
    notices: [
      `This story compares the selected local base's merge-base with ${branch} HEAD; it is a review aid, not a replacement for the Git diff.`,
      'Path categories are filename/folder signals only. A changed file does not prove an affected runtime journey, contract, test behaviour, deployment, or documentation outcome.',
      'Pull-request body, reviews, CI state, linked issues, remote checks, runtime evidence, and semantic diff meaning are not read by this local slice.',
      candidate.worktreeDirty
        ? 'The working tree has uncommitted changes. They are intentionally excluded from this committed branch story.'
        : 'The working tree was clean when this story was collected.',
      (categoryCounts['contract-schema'] ?? 0) > 0
        ? 'Contract/schema-like paths changed; compatibility and migration consequences require their dedicated evidence reviews.'
        : 'No contract/schema-like path was classified; that is missing path evidence, not proof that public contracts are unaffected.',
      (categoryCounts.test ?? 0) > 0
        ? 'Test-like paths changed; this map does not execute them or infer pass/fail and coverage.'
        : 'No test-like path was classified; that is not proof that the branch is untested.',
      ...(truncated ? ['The commit or changed-path budget was reached; this is a bounded partial story.'] : []),
    ],
    truncated,
  };
}

function normalizeCommit(value: LensChangeCommit): LensChangeCommit | undefined {
  const hash = normalizeHash(value?.hash);
  const subject = boundedText(value?.subject, 500);
  const author = boundedText(value?.author, 200);
  const authoredAt = boundedExactText(value?.authoredAt, 100);
  return hash && subject && author && authoredAt && !Number.isNaN(Date.parse(authoredAt))
    ? { hash, subject, author, authoredAt }
    : undefined;
}

function normalizeChange(value: LensChangedPath): LensChangedPath | undefined {
  const status = normalizeStatus(value?.status);
  const workspacePath = normalizeRelativePath(value?.workspacePath);
  const previousPath = value?.previousPath === undefined ? undefined : normalizeRelativePath(value.previousPath);
  if (!status || !workspacePath || (value.previousPath !== undefined && !previousPath)) return undefined;
  if ((status === 'renamed' || status === 'copied') !== Boolean(previousPath)) return undefined;
  return { status, workspacePath, ...(previousPath ? { previousPath } : {}) };
}

function normalizeStatus(value: unknown): LensChangeStatus | undefined {
  return typeof value === 'string' && ['added', 'modified', 'deleted', 'renamed', 'copied', 'type-changed', 'unmerged'].includes(value)
    ? value as LensChangeStatus
    : undefined;
}

function classifyPath(workspacePath: string): LensChangeCategory {
  const lower = workspacePath.toLowerCase();
  if (/(^|\/)(test|tests|__tests__|spec|specs|e2e|integration|contract-tests?)(\/|$)|\.(test|spec)\.[^/]+$/.test(lower)) return 'test';
  if (/(^|\/)(migrations?|database\/migrations?)(\/|$)|(^|\/)\d{6,}[_-].*\.sql$/.test(lower)) return 'migration';
  if (/(^|\/)(\.github\/workflows|\.gitlab-ci|ci|scripts)(\/|$)|(^|\/)(dockerfile|jenkinsfile)$/.test(lower)) return 'automation';
  if (/(^|\/)(docs?|wiki)(\/|$)|\.(md|mdx|rst|adoc)$/.test(lower)) return 'documentation';
  if (/(^|\/)(openapi|swagger|schema|schemas|contracts?)(\/|$)|\.(graphql|gql|proto|avsc)$|(^|\/)(openapi|swagger)[^/]*\.(json|ya?ml)$/.test(lower)) return 'contract-schema';
  if (/(^|\/)(config|configs|\.vscode)(\/|$)|(^|\/)(package(-lock)?\.json|tsconfig[^/]*\.json|\.env[^/]*|.*\.config\.[^/]+)$|\.(toml|ini)$/.test(lower)) return 'configuration';
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|java|kt|kts|go|rs|cs|cpp|c|h|hpp|swift|rb|php|vue|svelte|sql)$/.test(lower)) return 'source';
  return 'other';
}

function toTarget(
  change: LensChangedPath,
  workspace: LensWorkspaceIdentity,
  id: string,
  category: LensChangeCategory,
): LensVisualTarget | undefined {
  const base = createSourceLensTarget({
    kind: 'file',
    label: change.workspacePath.split('/').at(-1) ?? change.workspacePath,
    detail: `${change.status} · ${category}${change.previousPath ? ` · from ${change.previousPath}` : ''}`,
    workspace,
    workspacePath: change.workspacePath,
  });
  return normalizeLensTarget({
    ...base,
    id,
    kind: 'relation',
    evidence: { kind: 'source', source: 'git diff --name-status', confidence: 1 },
  });
}

function normalizeHash(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{7,64}$/i.test(value) ? value.toLowerCase() : undefined;
}

function normalizeWorkspace(value: LensWorkspaceIdentity): LensWorkspaceIdentity | undefined {
  const name = boundedText(value?.name, 200);
  return name && Number.isInteger(value?.index) && value.index >= 0 ? { name, index: value.index } : undefined;
}

function normalizeRelativePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.length > 1000 || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return undefined;
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..' || /[\u0000-\u001f\u007f]/.test(segment))
    ? undefined
    : segments.join('/');
}

function boundedExactText(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximum) : undefined;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
