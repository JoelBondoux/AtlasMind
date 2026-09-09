/**
 * The two commands that make the codebase index usable: build one, and search it.
 *
 * Everything with a rule in it lives in `core/codebaseIndex.ts` and
 * `providers/embedders.ts`, both of which are pure and tested. This file is the
 * wiring — gathering candidate files, choosing an embedder, showing the
 * confirmation, and putting results in front of somebody — and it is kept thin
 * on purpose so nothing decidable happens here.
 *
 * Two things it does decide, and both are stated:
 *
 * **The embedder is chosen by what is available, and the choice is shown.** A
 * local embedding model if one is configured and answers a probe; otherwise the
 * token-hash fallback, which works everywhere and is not semantic. Falling back
 * silently would leave somebody believing they had semantic search when they had
 * word matching, which is the single most misleading thing this feature could do.
 *
 * **Building is confirmed, searching is not.** A build costs minutes and, with a
 * remote embedder, would cost privacy; the dialog carries the plan's own
 * disclosure sentence rather than a summary of it, so the words somebody agrees
 * to are the words the module composed. A search reads a local file.
 */

import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import {
  buildCodebaseIndex,
  contentHash,
  isIndexablePath,
  planCodebaseIndex,
  searchCodebaseIndex,
  type CodebaseIndex,
  type Embedder,
  type IndexCandidate,
} from '../core/codebaseIndex.js';
import {
  readCodebaseIndex,
  writeCodebaseIndex,
} from '../core/codebaseIndexStore.js';
import {
  createOllamaEmbedder,
  createTokenHashEmbedder,
  probeOllamaEmbedder,
  tokenHashVector,
} from '../providers/embedders.js';

/** Ceiling on how many files one build will read. Stated when it bites. */
const MAX_CANDIDATE_FILES = 5_000;

function workspaceRoot(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

/**
 * Where the index is kept.
 *
 * Extension storage, never the workspace: the index is derived, per developer,
 * and would be a terrible thing to commit. `codebaseIndexStore` states the full
 * reasoning.
 */
function indexDirectory(atlas: AtlasMindContext): string | undefined {
  const storage = atlas.extensionContext.storageUri ?? atlas.extensionContext.globalStorageUri;
  return storage?.fsPath;
}

/**
 * Read every candidate file, skipping what the index would refuse anyway.
 *
 * The path filter runs before the read rather than after, so a repository full
 * of `node_modules` costs no I/O to ignore.
 */
async function collectCandidates(): Promise<{ candidates: IndexCandidate[]; truncated: boolean }> {
  const uris = await vscode.workspace.findFiles(
    '**/*',
    '**/{node_modules,.git,dist,out,build,coverage,.next,.nuxt,vendor,__pycache__,.venv,venv,target}/**',
    MAX_CANDIDATE_FILES + 1,
  );
  const truncated = uris.length > MAX_CANDIDATE_FILES;
  const candidates: IndexCandidate[] = [];
  const root = workspaceRoot();
  for (const uri of uris.slice(0, MAX_CANDIDATE_FILES)) {
    const relative = root ? vscode.workspace.asRelativePath(uri, false) : uri.fsPath;
    if (!isIndexablePath(relative)) {
      continue;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      candidates.push({ path: relative, content: new TextDecoder().decode(bytes) });
    } catch {
      // Unreadable now. Left out entirely rather than indexed as empty, which
      // would claim coverage of a file nothing could search.
    }
  }
  return { candidates, truncated };
}

interface EmbedderChoice {
  embedder: Embedder;
  /** Why this one. Shown, never inferred by the reader from the results. */
  note: string;
}

/**
 * Pick an embedder, and say which and why.
 *
 * A configured local model is probed rather than assumed: the probe discovers
 * the vector width and is simultaneously the cheapest check that the model
 * exists and is an embedding model. When it fails, the reason is carried into
 * the note rather than swallowed — "it silently used the fallback" is a support
 * conversation nobody should have to have.
 */
async function chooseEmbedder(): Promise<EmbedderChoice> {
  const configuration = vscode.workspace.getConfiguration('atlasmind.codebaseIndex');
  const model = configuration.get<string>('embeddingModel', '').trim();
  const origin = configuration.get<string>('ollamaUrl', 'http://127.0.0.1:11434').trim();

  if (model.length > 0) {
    const probe = await probeOllamaEmbedder(origin, model, { fetch: globalThis.fetch as never });
    if (probe.ok && probe.dimensions !== undefined) {
      return {
        embedder: createOllamaEmbedder(origin, model, probe.dimensions, { fetch: globalThis.fetch as never }),
        note: `Using ${model} on your local Ollama (${probe.dimensions} dimensions). Nothing leaves this machine.`,
      };
    }
    return {
      embedder: createTokenHashEmbedder(),
      note: `${model} could not be used, so this falls back to the built-in token-hash embedder, which matches shared vocabulary rather than shared meaning. Reason: ${probe.reason ?? 'unknown'}`,
    };
  }

  return {
    embedder: createTokenHashEmbedder(),
    note: 'Using the built-in token-hash embedder: it needs no model and nothing leaves this machine, but it matches shared vocabulary rather than shared meaning. Set atlasmind.codebaseIndex.embeddingModel to a local embedding model for semantic results.',
  };
}

export async function buildCodebaseIndexCommand(atlas: AtlasMindContext): Promise<void> {
  const directory = indexDirectory(atlas);
  if (!workspaceRoot() || !directory) {
    void vscode.window.showWarningMessage('Open a workspace folder before building a codebase index.');
    return;
  }

  const choice = await chooseEmbedder();
  const { candidates, truncated } = await collectCandidates();
  if (candidates.length === 0) {
    void vscode.window.showWarningMessage('No indexable source files were found in this workspace.');
    return;
  }

  const plan = planCodebaseIndex(candidates, choice.embedder.descriptor);
  if (plan.chunkCount === 0) {
    void vscode.window.showWarningMessage('Every candidate file was excluded, so there is nothing to index.');
    return;
  }

  const refusedForSecrets = plan.excluded.filter(entry => entry.reason === 'looks-like-secret').length;
  const confirmed = await vscode.window.showInformationMessage(
    'Build a searchable index of this codebase?',
    {
      modal: true,
      detail: [
        // The plan's own sentence, not a summary of it: what somebody agrees to
        // should be the words the module composed.
        plan.disclosure,
        choice.note,
        refusedForSecrets > 0
          ? `${refusedForSecrets} file${refusedForSecrets === 1 ? '' : 's'} will be skipped because ${refusedForSecrets === 1 ? 'it contains' : 'they contain'} something shaped like a credential. An indexed secret is a retrievable one.`
          : '',
        truncated
          ? `This workspace has more than ${MAX_CANDIDATE_FILES} files; only the first ${MAX_CANDIDATE_FILES} were considered, and the index will say so.`
          : '',
      ].filter(Boolean).join('\n\n'),
    },
    'Build index',
  );
  if (confirmed !== 'Build index') {
    return;
  }

  try {
    const index = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'AtlasMind: indexing the codebase', cancellable: false },
      async () => buildCodebaseIndex(plan, choice.embedder, new Date().toISOString()),
    );
    await writeCodebaseIndex(directory, index);
    void vscode.window.showInformationMessage(
      `Indexed ${index.files.length} file${index.files.length === 1 ? '' : 's'} in ${index.chunks.length} chunks.`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // A refusal from the index builder is a correctness guard, not a glitch, so
    // it is reported as written rather than reduced to "indexing failed".
    void vscode.window.showErrorMessage(`The index was not built: ${detail.slice(0, 400)}`);
  }
}

/** The working tree's current hashes, for the freshness comparison. */
async function currentHashes(): Promise<Map<string, string>> {
  const { candidates } = await collectCandidates();
  return new Map(candidates.map(candidate => [candidate.path, contentHash(candidate.content)]));
}

/**
 * Embed a query with the *same* embedder the index was built with.
 *
 * Not the currently configured one: a query vector from a different model is
 * not comparable with the stored vectors, and the result would be a plausible
 * ranking of nothing. Where the index was built by a model that is no longer
 * reachable, the search is refused with that reason rather than answered badly.
 */
async function embedQuery(index: CodebaseIndex, query: string): Promise<number[] | { refusal: string }> {
  if (index.embedder.kind === 'token-hash') {
    return tokenHashVector(query, index.embedder.dimensions);
  }
  const model = index.embedder.id.startsWith('ollama:') ? index.embedder.id.slice('ollama:'.length) : '';
  const origin = vscode.workspace.getConfiguration('atlasmind.codebaseIndex')
    .get<string>('ollamaUrl', 'http://127.0.0.1:11434').trim();
  if (!model) {
    return { refusal: `This index was built by ${index.embedder.label}, which AtlasMind cannot reach to embed a query. Rebuild the index.` };
  }
  try {
    const embedder = createOllamaEmbedder(origin, model, index.embedder.dimensions, { fetch: globalThis.fetch as never });
    const vectors = await embedder.embed([query]);
    const vector = vectors[0];
    if (!vector || vector.length !== index.embedder.dimensions) {
      return { refusal: `${model} answered with a ${vector?.length ?? 0}-dimension vector where this index expects ${index.embedder.dimensions}. Rebuild the index.` };
    }
    return vector;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { refusal: `${model} could not be reached to embed the query: ${detail.slice(0, 200)}` };
  }
}

export async function searchCodebaseCommand(atlas: AtlasMindContext, provided?: string): Promise<void> {
  const directory = indexDirectory(atlas);
  if (!workspaceRoot() || !directory) {
    void vscode.window.showWarningMessage('Open a workspace folder before searching the codebase.');
    return;
  }
  const index = readCodebaseIndex(directory);
  if (!index) {
    const build = await vscode.window.showInformationMessage(
      'This workspace has no codebase index yet.',
      'Build one now',
    );
    if (build === 'Build one now') {
      await buildCodebaseIndexCommand(atlas);
    }
    return;
  }

  const query = provided ?? await vscode.window.showInputBox({
    prompt: 'Search the codebase',
    placeHolder: 'what the code should do, in your own words',
  });
  if (!query || query.trim().length === 0) {
    return;
  }

  const vector = await embedQuery(index, query.trim());
  if (!Array.isArray(vector)) {
    void vscode.window.showWarningMessage(vector.refusal);
    return;
  }

  const outcome = searchCodebaseIndex(index, vector, await currentHashes(), Date.now());
  if (outcome.hits.length === 0) {
    // The coverage sentence carries the caveat about what the embedder can and
    // cannot do, so "nothing found" is never presented as a fact about the code.
    void vscode.window.showInformationMessage(outcome.coverage.summary);
    return;
  }

  const picked = await vscode.window.showQuickPick(
    outcome.hits.map(hit => ({
      label: `${hit.path}:${hit.startLine}`,
      description: `${Math.round(hit.score * 100)}% match`,
      detail: `lines ${hit.startLine}–${hit.endLine}`,
      hit,
    })),
    { title: outcome.coverage.summary, placeHolder: 'Open a result' },
  );
  if (!picked) {
    return;
  }

  const root = workspaceRoot();
  if (!root) {
    return;
  }
  const uri = vscode.Uri.joinPath(root.uri, picked.hit.path);
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const line = Math.max(0, picked.hit.startLine - 1);
  const range = new vscode.Range(line, 0, line, 0);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  editor.selection = new vscode.Selection(range.start, range.start);
}
