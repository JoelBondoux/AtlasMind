/**
 * Which files in this repository are UI, and which adapter would read each one.
 *
 * The Studio could already *map* a design target onto a source file, and could
 * not tell you what there was to map. Every mapping began with somebody typing a
 * workspace-relative path from memory, which is fine on a project you wrote last
 * week and useless on the one you have just been handed — the exact case the
 * Studio exists for. Nothing in `uiRepositoryMapping` scans anything; it
 * validates a path it is given.
 *
 * Five rules, and the first two are why this is a scanner rather than a guess.
 *
 * **A surface is recognised by a declared rule, never inferred from content.**
 * Every candidate names the rule that classified it, and the rule table travels
 * in the report, so the list a person is choosing from can be argued with. A
 * classifier that said "this looks like UI" would be unfalsifiable, and the
 * failure would be a picker quietly missing the one file somebody wanted.
 *
 * **Extension and location decide, not a model and not the file's prose.** The
 * rules read the path — `.tsx`, `.html`, `.svelte`, a `media/` webview script —
 * and at most confirm with a bounded look at the head of the file. Reading a
 * whole tree to decide what is UI would cost a filesystem walk on every render
 * for a question the path already answers.
 *
 * **What was excluded is counted, never silently dropped.** `node_modules`,
 * build output and test files are skipped by rule, and the report says how many
 * — a scan that found nothing because it was pointed at a `dist/` tree looks
 * identical to a project with no UI unless it says so.
 *
 * **Bounded three ways, with the truncation stated.** Directories visited, files
 * examined, and surfaces returned each have a cap. Hitting one sets
 * `truncated`, because a picker showing the first 200 of 4,000 files while
 * claiming to be the list is worse than one that admits it stopped.
 *
 * **Never throws.** An unreadable directory is a miss, not a failure: the caller
 * is drawing a list, and half a list is more useful than an error where a list
 * should be. Under-reporting is the safe direction here — a surface this misses
 * can still be mapped by typing its path, which is exactly what happened before.
 *
 * Pure apart from the injected reader, so the rules are unit-testable without a
 * filesystem.
 */

import type { UiRepositoryAdapterId } from '../types.js';

/** How many directories the walk will enter before giving up. */
export const UI_SURFACE_SCAN_MAX_DIRECTORIES = 600;
/** How many files the walk will look at. */
export const UI_SURFACE_SCAN_MAX_FILES = 4_000;
/** How many surfaces are returned. */
export const UI_SURFACE_SCAN_MAX_SURFACES = 200;
/** How much of a file is read when a rule needs to confirm itself. */
export const UI_SURFACE_SCAN_HEAD_BYTES = 4_096;

/**
 * Directories never entered.
 *
 * Dependencies and build output are the two ways a scan turns into a list of
 * somebody else's components — and `out/`, `dist/` and `coverage/` contain
 * *derived* copies of this project's own UI, which is worse: they look right,
 * and mapping a design target onto one records a source that the next build
 * overwrites.
 */
export const UI_SURFACE_SCAN_SKIPPED_DIRECTORIES: readonly string[] = [
  'node_modules', '.git', 'out', 'dist', 'build', 'coverage', '.next', '.nuxt',
  '.svelte-kit', '.turbo', '.cache', 'vendor', '.vscode-test', '.stryker-tmp',
];

/** What a rule decided a file is. */
export type UiSurfaceKind = 'component' | 'page' | 'stylesheet' | 'webview';

export interface UiSurfaceRule {
  id: string;
  /** Published with the report so the list can be argued with. */
  description: string;
  adapterId: UiRepositoryAdapterId;
  kind: UiSurfaceKind;
}

/**
 * The rule table.
 *
 * Deliberately short. Each entry is a claim that a file of this shape is
 * something a person could open in the Studio and mean to edit — and every rule
 * that is not obviously true of every project in its ecosystem is left out,
 * because a picker full of near-misses is one nobody trusts.
 */
export const UI_SURFACE_RULES: readonly UiSurfaceRule[] = [
  {
    id: 'react-component',
    description: 'A .tsx or .jsx file that is not a test, a declaration, or a story.',
    adapterId: 'react',
    kind: 'component',
  },
  {
    id: 'html-page',
    description: 'A .html or .htm file.',
    adapterId: 'static-html-css',
    kind: 'page',
  },
  {
    id: 'stylesheet-tokens',
    description: 'A .css file whose head declares custom properties, so it carries design tokens.',
    adapterId: 'static-html-css',
    kind: 'stylesheet',
  },
  {
    id: 'single-file-component',
    description: 'A .vue or .svelte single-file component.',
    adapterId: 'custom',
    kind: 'component',
  },
  {
    id: 'vscode-webview-script',
    description: 'A script under media/ whose head builds markup, which is how a VS Code webview renders.',
    adapterId: 'vscode-webview',
    kind: 'webview',
  },
];

export interface UiSurfaceCandidate {
  /** Workspace-relative, forward-slashed. */
  path: string;
  /** File name alone, for a list that does not need the whole path to read. */
  label: string;
  adapterId: UiRepositoryAdapterId;
  kind: UiSurfaceKind;
  /** The rule that classified it. */
  ruleId: string;
  bytes: number;
}

export interface UiSurfaceScanReport {
  surfaces: UiSurfaceCandidate[];
  /** Files a rule looked at. */
  filesExamined: number;
  /** Files skipped because a rule excluded them, so "nothing found" is explicable. */
  filesExcluded: number;
  /** A cap was reached; the list is a prefix rather than the answer. */
  truncated: boolean;
  /** Published so a caller can show why a file is in the list. */
  rules: readonly UiSurfaceRule[];
}

/** Filesystem access, injected so every rule is testable without a disk. */
export interface UiSurfaceScanProbe {
  /** Entries of a workspace-relative directory. `''` is the root. */
  readDirectory(relativePath: string): ReadonlyArray<{ name: string; isDirectory: boolean; bytes: number }>;
  /** First bytes of a workspace-relative file, or `undefined` if unreadable. */
  readHead(relativePath: string): string | undefined;
}

/** A test file, a type declaration, or a story — none of them a surface to edit. */
function isExcludedFileName(name: string): boolean {
  return /\.(test|spec|stories|story)\.[jt]sx?$/i.test(name)
    || /\.d\.ts$/i.test(name)
    || /\.min\.(js|css)$/i.test(name);
}

/**
 * Which rule, if any, claims this file.
 *
 * Exported because it is the whole policy: a test that walks this can assert
 * what the picker will contain without standing up a directory tree.
 */
export function classifyUiSurface(
  relativePath: string,
  readHead: (path: string) => string | undefined,
): UiSurfaceRule | undefined {
  // Defensive here rather than only in the walker: this is exported as the
  // policy, so a caller reaching it directly gets the same "never throws"
  // guarantee the module claims. An unreadable file is a rule that did not
  // match, which is the under-reporting direction and the safe one.
  const head = (path: string): string | undefined => {
    try {
      return readHead(path);
    } catch {
      return undefined;
    }
  };
  const name = relativePath.split('/').pop() ?? '';
  if (name.length === 0 || isExcludedFileName(name)) {
    return undefined;
  }
  if (/\.[jt]sx$/i.test(name)) {
    return UI_SURFACE_RULES[0];
  }
  if (/\.html?$/i.test(name)) {
    return UI_SURFACE_RULES[1];
  }
  if (/\.css$/i.test(name)) {
    // A stylesheet earns a place only if it declares tokens. Every project has
    // stylesheets; the ones worth offering as a *design* surface are the ones
    // holding custom properties, and that cannot be read off the path.
    const css = head(relativePath);
    return css && css.includes('--') && /--[a-z0-9-]+\s*:/i.test(css) ? UI_SURFACE_RULES[2] : undefined;
  }
  if (/\.(vue|svelte)$/i.test(name)) {
    return UI_SURFACE_RULES[3];
  }
  if (/^media\//i.test(relativePath) && /\.[cm]?js$/i.test(name)) {
    // A webview script is a script that builds markup. Without this check the
    // rule would claim every helper and polyfill in the same folder.
    const script = head(relativePath);
    return script && /innerHTML|acquireVsCodeApi|insertAdjacentHTML/.test(script) ? UI_SURFACE_RULES[4] : undefined;
  }
  return undefined;
}

/**
 * Walk the workspace and list the UI surfaces in it.
 *
 * Breadth-first so a cap truncates the deepest, least-likely paths rather than
 * whichever branch the walk happened to descend first.
 */
export function scanUiSurfaces(probe: UiSurfaceScanProbe): UiSurfaceScanReport {
  const surfaces: UiSurfaceCandidate[] = [];
  const queue: string[] = [''];
  let directoriesVisited = 0;
  let filesExamined = 0;
  let filesExcluded = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (directoriesVisited >= UI_SURFACE_SCAN_MAX_DIRECTORIES || filesExamined >= UI_SURFACE_SCAN_MAX_FILES) {
      truncated = true;
      break;
    }
    const directory = queue.shift() as string;
    directoriesVisited += 1;
    let entries: ReadonlyArray<{ name: string; isDirectory: boolean; bytes: number }>;
    try {
      entries = probe.readDirectory(directory);
    } catch {
      // An unreadable directory is a miss. The caller is drawing a list.
      continue;
    }
    for (const entry of entries) {
      const relativePath = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (entry.name.startsWith('.') && entry.name !== '.vscode') {
          filesExcluded += 1;
          continue;
        }
        if (UI_SURFACE_SCAN_SKIPPED_DIRECTORIES.includes(entry.name)) {
          filesExcluded += 1;
          continue;
        }
        queue.push(relativePath);
        continue;
      }
      if (filesExamined >= UI_SURFACE_SCAN_MAX_FILES) {
        truncated = true;
        break;
      }
      filesExamined += 1;
      // No wrapper here: `classifyUiSurface` swallows a failing read itself, so
      // a second try/catch would only hide a rule that genuinely threw.
      const rule = classifyUiSurface(relativePath, path => probe.readHead(path));
      if (!rule) {
        filesExcluded += 1;
        continue;
      }
      if (surfaces.length >= UI_SURFACE_SCAN_MAX_SURFACES) {
        truncated = true;
        continue;
      }
      surfaces.push({
        path: relativePath,
        label: entry.name,
        adapterId: rule.adapterId,
        kind: rule.kind,
        ruleId: rule.id,
        bytes: entry.bytes,
      });
    }
  }

  // Grouped by adapter then path, so the list reads as "the React ones, the
  // static ones" rather than in whatever order the walk produced.
  surfaces.sort((left, right) => left.adapterId === right.adapterId
    ? left.path.localeCompare(right.path)
    : left.adapterId.localeCompare(right.adapterId));

  return {
    surfaces,
    filesExamined,
    filesExcluded,
    truncated,
    rules: UI_SURFACE_RULES,
  };
}
