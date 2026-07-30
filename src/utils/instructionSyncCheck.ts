/**
 * Deciding whether the AtlasMind blocks in an agent instruction file are stale.
 *
 * The point of this module is a constraint: it runs from a **git hook**, so it
 * has no VS Code host, no agent registry, and no extension state. That rules out
 * the obvious implementation — re-render each block and compare — because the
 * renderers need a `ProjectTestingConfig`, the agent list, and a settings
 * reader, none of which exist in a shell.
 *
 * It also rules out the tempting one: a second copy of the rendering, kept
 * "close enough". That is the drift this project keeps finding the hard way, and
 * here it would report a file as stale on every commit until somebody disabled
 * the check — which is worse than no check, because it removes the check *and*
 * teaches that AtlasMind's gates cry wolf.
 *
 * So the sync records what it rendered *from*: a digest of the source document,
 * written into the block as a comment. Staleness is then a comparison of two
 * digests, which needs nothing but the filesystem.
 *
 * **What this detects, precisely:** the source document changed after the block
 * was written. That is the realistic failure — you edit the workflow or the
 * testing matrix and forget to sync. It does **not** detect a hand-edit inside
 * the block that leaves the digest alone; the block says it is overwritten on
 * the next sync, and it is. Claiming more than this would be the more dangerous
 * error, so the reason strings say which check ran.
 *
 * Pure apart from an injected reader, and `vscode`-free by necessity.
 */

import { createHash } from 'node:crypto';

/** A digest short enough to sit in a comment and long enough to not collide. */
export const SOURCE_DIGEST_LENGTH = 16;

const DIGEST_PREFIX = 'atlasmind:source-digest:';

/**
 * The digest comment the sync writes into a block, and the hook reads back.
 *
 * An HTML comment so it renders as nothing in every tool that displays these
 * files as markdown — an agent reading the file sees the rules, not bookkeeping.
 */
export function formatSourceDigestComment(digest: string): string {
  return `<!-- ${DIGEST_PREFIX}${digest} -->`;
}

/** Digest of a source document's exact bytes. */
export function digestSource(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, SOURCE_DIGEST_LENGTH);
}

/** One kind of managed block, and the file it is rendered from. */
export interface InstructionBlockKind {
  id: string;
  /** Human name, for the message the hook prints. */
  label: string;
  markers: { start: string; end: string };
  /**
   * Workspace-relative source document.
   *
   * Only file-backed blocks can be checked this way. The debt-markers block is
   * driven by a VS Code *setting*, which a git hook cannot read at all — so it
   * is deliberately absent from the checked set rather than approximated. Saying
   * "checked" about something unchecked is the failure mode this whole module is
   * arranged to avoid.
   */
  sourcePath: string;
}

export interface StaleInstructionBlock {
  /** Workspace-relative instruction file. */
  path: string;
  kind: string;
  label: string;
  /** Why it is stale, in the words the hook prints. */
  reason: string;
}

export interface InstructionSyncCheckInput {
  /** Instruction files that exist, with their contents. */
  targets: Array<{ path: string; text: string }>;
  /** Source documents that exist, with their contents, keyed by relative path. */
  sources: Map<string, string>;
  kinds: readonly InstructionBlockKind[];
}

/**
 * Read the digest a block recorded, or `undefined` when it has none.
 *
 * `undefined` covers two different situations that are treated the same on
 * purpose: the block is absent, or it predates digest recording. Both mean "this
 * cannot be shown current", and both are resolved by running a sync.
 */
export function readRecordedDigest(text: string, markers: { start: string; end: string }): string | undefined {
  const start = text.indexOf(markers.start);
  const end = text.indexOf(markers.end);
  if (start === -1 || end === -1 || end < start) {
    return undefined;
  }
  const body = text.slice(start + markers.start.length, end);
  const match = new RegExp(`<!--\\s*${DIGEST_PREFIX}([0-9a-f]{4,64})\\s*-->`).exec(body);
  return match?.[1];
}

/**
 * Every block that cannot be shown current.
 *
 * A file with **no** block of a given kind is not reported: instruction files
 * are opt-in per tool, and a project that has never synced Cursor should not be
 * told Cursor is out of date. The check is "a block that exists is current",
 * not "every tool has every block" — the second would turn adopting one tool
 * into a standing complaint about the eight you do not use.
 *
 * A source document that does not exist is likewise skipped rather than
 * reported: there is nothing to be stale against.
 */
export function findStaleInstructionBlocks(input: InstructionSyncCheckInput): StaleInstructionBlock[] {
  const stale: StaleInstructionBlock[] = [];
  for (const kind of input.kinds) {
    const source = input.sources.get(kind.sourcePath);
    if (source === undefined) {
      continue;
    }
    const expected = digestSource(source);
    for (const target of input.targets) {
      if (target.text.indexOf(kind.markers.start) === -1) {
        continue; // This tool does not carry this block. Not a fault.
      }
      const recorded = readRecordedDigest(target.text, kind.markers);
      if (recorded === expected) {
        continue;
      }
      stale.push({
        path: target.path,
        kind: kind.id,
        label: kind.label,
        reason: recorded === undefined
          ? `no recorded digest — written before AtlasMind tracked ${kind.sourcePath}`
          : `${kind.sourcePath} changed since this block was written`,
      });
    }
  }
  return stale;
}

/**
 * The message the hook prints. Kept here so the wording is tested rather than
 * living in a shell script where nothing checks it.
 *
 * Names the files and the command, because "instruction files are stale" is a
 * verdict and not an instruction. The escape hatch is stated too: a gate whose
 * bypass is undocumented gets bypassed with `--no-verify`, which disables every
 * other check in the hook along with this one.
 */
export function formatStaleReport(stale: readonly StaleInstructionBlock[]): string {
  if (stale.length === 0) {
    return '';
  }
  const byPath = new Map<string, StaleInstructionBlock[]>();
  for (const entry of stale) {
    const list = byPath.get(entry.path) ?? [];
    list.push(entry);
    byPath.set(entry.path, list);
  }
  const lines: string[] = [
    `ERROR: ${byPath.size} AI instruction file${byPath.size === 1 ? '' : 's'} ${byPath.size === 1 ? 'has' : 'have'} a stale AtlasMind block:`,
    '',
  ];
  for (const [path, entries] of byPath) {
    lines.push(`  ${path}`);
    for (const entry of entries) {
      lines.push(`    - ${entry.label}: ${entry.reason}`);
    }
  }
  lines.push(
    '',
    'Run "AtlasMind: Sync Testing Protocols to AI Agents" (or /sync-instructions) and stage the result.',
    '',
    'Nothing was modified — this check never edits files, so the commit you reviewed',
    'is the commit that lands. To skip it for one commit:',
    '  ATLASMIND_SKIP_INSTRUCTION_CHECK=1 git commit ...',
    'To turn it off for this workspace, untick "Verify AI instruction sets before each commit"',
    'on the Settings -> AI Instructions page.',
  );
  return lines.join('\n');
}
