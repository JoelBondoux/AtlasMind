/**
 * Where the roadmap graph lives on disk.
 *
 * The backlog itself stays exactly where it was — `roadmap/improvement-plan.md`,
 * a hand-editable markdown list, still the one file that says what the work is.
 * This module holds everything a markdown checkbox cannot: a deadline, a branch
 * name, an estimate, a position on a canvas, who added it and when, and the
 * links between items.
 *
 * Four rules:
 *
 * 1. **The markdown is the source of truth for *what exists*; this file is only
 *    ever an overlay.** A node whose item is gone from the backlog is not
 *    resurrected — it is reconciled away. Anything else and deleting a line from
 *    the plan would leave it on the canvas, which is the worst possible
 *    disagreement between two views of one roadmap.
 *
 * 2. **Identity is durable and carried by the markdown.** The item line holds an
 *    `<!-- rm:id -->` anchor, so renaming an item keeps its deadline, its
 *    position and its links. Ids are minted only for items that actually gained
 *    graph data, so a backlog nobody has put on the canvas stays clean.
 *
 * 3. **A record whose anchor was lost is repaired, not duplicated.** Somebody
 *    will hand-edit that file and delete a comment. Matching on normalized text
 *    recovers the record; failing to would silently orphan a deadline somebody
 *    set.
 *
 * 4. **Reads never throw and never seed over a newer file.** Same contract as
 *    every other register here: `interpretVersionedDocument` decides whether a
 *    document is corrupt (replaceable) or from the future (never replaceable).
 *
 * `fs`-only, `vscode`-free, and unit-tested. The graph semantics live in
 * `roadmapGraph.ts`.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { interpretVersionedDocument, type VersionedDocumentRead } from './schemaMigration.js';
import type { RoadmapImportRecord } from './roadmapImport.js';
import {
  MAX_ROADMAP_GRAPH_NODES,
  ROADMAP_EDGE_RULES,
  edgeKey,
  normalizeRoadmapNodeText,
  parseRoadmapDeadline,
  type RoadmapEdge,
  type RoadmapEdgeRuleId,
  type RoadmapLayoutOrientation,
  type RoadmapNodeOrigin,
  type RoadmapNodeRecord,
} from './roadmapGraph.js';

export const ROADMAP_GRAPH_FILE = 'roadmap/roadmap-graph.json';
export const ROADMAP_GRAPH_SUMMARY_FILE = 'roadmap/roadmap-graph.md';

/** Enough links for a real plan; past this the canvas is unreadable anyway. */
export const MAX_ROADMAP_EDGES = 800;
/** A branch name that will not break a ref or a terminal. */
const MAX_BRANCH_LENGTH = 120;
const MAX_ID_LENGTH = 40;

export interface RoadmapGraphDocument {
  version: number;
  nodes: RoadmapNodeRecord[];
  edges: RoadmapEdge[];
  /**
   * Whether AtlasMind may propose links nobody drew.
   *
   * On by default: suggestions are drawn dashed and change nothing until
   * accepted, so the deny-by-default reflex does not apply — there is no action
   * to withhold, only a reading to offer. A project that finds them noisy turns
   * them off here rather than in a setting, because it is a property of *this
   * roadmap* and belongs in the file the team commits.
   */
  suggestLinks: boolean;
  /**
   * Suggestions somebody looked at and said no to.
   *
   * Persisted, because a suggestion derived from a rule is derived again on
   * every render: without this, dismissing one would clear it until the next
   * refresh and the feature would read as broken. Stored as a rejection rather
   * than as a reversed edge — "these two are unrelated" and "the other one comes
   * first" are different statements, and only the second belongs in the plan.
   */
  dismissed: Array<{ from: string; to: string }>;
  /**
   * Which way the tree runs on the canvas.
   *
   * A property of this roadmap rather than of whoever is looking, so it lives
   * here and not in a setting: two people opening the same plan should see the
   * same picture, and which orientation reads better depends on the shape of the
   * graph rather than on the person.
   */
  layoutOrientation: RoadmapLayoutOrientation;
  updatedAt: string;
}

export function seedRoadmapGraphDocument(now: Date = new Date()): RoadmapGraphDocument {
  return { version: 1, nodes: [], edges: [], suggestLinks: true, dismissed: [], layoutOrientation: 'horizontal', updatedAt: now.toISOString() };
}

// ── The markdown anchor ───────────────────────────────────────────────────

/**
 * The durable id carried in a backlog line.
 *
 * An HTML comment, so it is invisible in every markdown renderer and in the
 * GitHub view of the file, while remaining a plain, greppable, hand-editable
 * token for anybody reading the raw text.
 */
const NODE_ANCHOR = /<!--\s*rm:([a-z0-9][a-z0-9-]{0,38})\s*-->/i;

export function extractRoadmapNodeAnchor(text: string): { text: string; nodeId?: string } {
  const source = String(text ?? '');
  const match = source.match(NODE_ANCHOR);
  if (match === null) {
    return { text: source.trim() };
  }
  return {
    text: source.replace(NODE_ANCHOR, '').replace(/\s{2,}/g, ' ').trim(),
    nodeId: (match[1] ?? '').toLowerCase(),
  };
}

export function renderRoadmapNodeAnchor(nodeId: string): string {
  return ` <!-- rm:${nodeId} -->`;
}

/**
 * Mint an id for an item that is gaining graph data.
 *
 * Derived from the text plus a de-duplicating ordinal — never a timestamp or a
 * random value — so the same backlog, wired up twice, produces the same file.
 * A roadmap is committed; two developers doing the same thing must not produce a
 * diff.
 */
export function mintRoadmapNodeId(text: string, taken: ReadonlySet<string>): string {
  const slug = String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
    .replace(/-+$/g, '');
  const base = slug.length > 0 ? slug : 'item';
  if (!taken.has(base)) {
    return base;
  }
  for (let ordinal = 2; ordinal < 1000; ordinal += 1) {
    const candidate = `${base}-${ordinal}`.slice(0, MAX_ID_LENGTH);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${taken.size + 1}`.slice(0, MAX_ID_LENGTH);
}

// ── Boundary ──────────────────────────────────────────────────────────────

function clampString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  // Control characters first: these values reach an HTML attribute, a terminal
  // (the branch name) and a committed markdown mirror.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return cleaned.length === 0 ? undefined : cleaned.slice(0, max);
}

function sanitizeId(value: unknown): string | undefined {
  const cleaned = clampString(value, MAX_ID_LENGTH);
  return cleaned !== undefined && /^[a-z0-9][a-z0-9-]*$/i.test(cleaned) ? cleaned.toLowerCase() : undefined;
}

/**
 * A branch name is validated, never cleaned into shape.
 *
 * It reaches a `git` invocation, and a nearly-valid name made plausible is worse
 * than a rejected one: the user sees a name, copies it, and the checkout fails
 * somewhere else. Mirrors `branchNaming`'s own refusal set.
 */
function sanitizeBranch(value: unknown): string | undefined {
  const cleaned = clampString(value, MAX_BRANCH_LENGTH);
  if (cleaned === undefined) {
    return undefined;
  }
  if (/[~^:\s\\?*[\]]|\.\.|@\{/.test(cleaned) || cleaned.startsWith('-') || cleaned.endsWith('/') || cleaned.endsWith('.lock')) {
    return undefined;
  }
  return cleaned;
}

function sanitizeTimestamp(value: unknown): string | undefined {
  const cleaned = clampString(value, 40);
  if (cleaned === undefined) {
    return undefined;
  }
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function sanitizePosition(value: unknown): { x: number; y: number } | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const x = Number(record['x']);
  const y = Number(record['y']);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return { x: Math.max(0, Math.min(40000, Math.round(x))), y: Math.max(0, Math.min(40000, Math.round(y))) };
}

const RULE_IDS = new Set<string>(ROADMAP_EDGE_RULES.map(rule => rule.id));

export function sanitizeRoadmapNodeRecord(value: unknown): RoadmapNodeRecord | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = sanitizeId(record['id']);
  if (id === undefined) {
    return undefined;
  }
  const branch = sanitizeBranch(record['branch']);
  const deadline = parseRoadmapDeadline(record['deadline']);
  const estimate = Number(record['estimateDays']);
  const addedAt = sanitizeTimestamp(record['addedAt']);
  const addedBy = sanitizeId(record['addedBy']);
  const completedAt = sanitizeTimestamp(record['completedAt']);
  const completedBy = sanitizeId(record['completedBy']);
  // Kept even when it names nobody in the roster. Deleting a contact is not
  // a statement that their work became unassigned, and the two must stay
  // distinguishable on the by-person view.
  const assigneeId = sanitizeId(record['assigneeId']);
  const position = sanitizePosition(record['position']);
  const origin = sanitizeRoadmapOrigin(record['origin']);
  const imported = sanitizeRoadmapImport(record['imported']);

  return {
    id,
    normalizedText: normalizeRoadmapNodeText(clampString(record['normalizedText'], 400) ?? ''),
    ...(branch === undefined ? {} : { branch }),
    ...(deadline === undefined ? {} : { deadline }),
    ...(Number.isFinite(estimate) && estimate > 0 ? { estimateDays: Math.min(365, Math.round(estimate * 2) / 2) } : {}),
    // `aiAssisted` is only stored when it was actually decided: `undefined`
    // means "never chosen" and resolves to the default, while `false` is a
    // decision to grade this node without the discount. Collapsing the two
    // would silently re-apply a discount somebody turned off.
    ...(typeof record['aiAssisted'] === 'boolean' ? { aiAssisted: record['aiAssisted'] } : {}),
    ...(assigneeId === undefined ? {} : { assigneeId }),
    ...(addedAt === undefined ? {} : { addedAt }),
    ...(addedBy === undefined ? {} : { addedBy }),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(completedBy === undefined ? {} : { completedBy }),
    ...(position === undefined ? {} : { position }),
    ...(imported === undefined ? {} : { imported }),
    ...(origin === undefined ? {} : { origin }),
  };
}

/**
 * Where a line was imported from.
 *
 * Refused whole rather than partially repaired, exactly as `sanitizeRoadmapOrigin`
 * is: a record missing its key or its source is one no re-import can reconcile
 * against, so keeping half of it would produce a line that looks tracked and
 * silently duplicates on the next run. `importedTitleNormalized` is allowed to
 * be empty — that reads as "we do not know what the source said", which the
 * planner treats as a possible update rather than a conflict, and inventing a
 * value would manufacture a conflict nobody has.
 */
function sanitizeRoadmapImport(value: unknown): RoadmapImportRecord | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const kind = record['kind'];
  if (kind !== 'markdown' && kind !== 'github-issues' && kind !== 'github-project' && kind !== 'spreadsheet') {
    return undefined;
  }
  const sourceId = clampString(record['sourceId'], 300);
  const sourceLabel = clampString(record['sourceLabel'], 200);
  if (sourceId === undefined || sourceLabel === undefined) {
    return undefined;
  }
  const importedAt = sanitizeTimestamp(record['importedAt']);
  const url = typeof record['url'] === 'string' && /^https:\/\//i.test(record['url'].trim())
    ? record['url'].trim().slice(0, 500)
    : undefined;
  return {
    kind,
    sourceId,
    sourceLabel,
    importedTitleNormalized: clampString(record['importedTitleNormalized'], 400) ?? '',
    ...(importedAt === undefined ? {} : { importedAt }),
    ...(url === undefined ? {} : { url }),
  };
}

/**
 * The register a roadmap item was raised from.
 *
 * Refused entirely rather than partially repaired when the kind or the id is
 * unreadable: a provenance line naming a register nobody can look the finding up
 * in is worse than no provenance, because it reads as a link somebody could
 * follow.
 */
function sanitizeRoadmapOrigin(value: unknown): RoadmapNodeOrigin | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const kind = record['kind'];
  if (kind !== 'gap' && kind !== 'debt' && kind !== 'risk') {
    return undefined;
  }
  const sourceId = clampString(record['sourceId'], 120);
  if (sourceId === undefined || !/^[\w.:/-]+$/.test(sourceId)) {
    return undefined;
  }
  const raisedAt = sanitizeTimestamp(record['raisedAt']);
  return {
    kind,
    sourceId,
    sourceTitle: clampString(record['sourceTitle'], 300) ?? '',
    ...(raisedAt === undefined ? {} : { raisedAt }),
  };
}

export function sanitizeRoadmapEdge(value: unknown): RoadmapEdge | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const from = sanitizeId(record['from']);
  const to = sanitizeId(record['to']);
  if (from === undefined || to === undefined || from === to) {
    return undefined;
  }
  const rule = typeof record['rule'] === 'string' && RULE_IDS.has(record['rule'])
    ? record['rule'] as RoadmapEdgeRuleId
    : undefined;
  const createdAt = sanitizeTimestamp(record['createdAt']);
  const createdBy = sanitizeId(record['createdBy']);
  const evidence = clampString(record['evidence'], 200);
  return {
    from,
    to,
    // Everything persisted here is part of the plan. An edge is only `derived`
    // while it is a suggestion, and suggestions are never written — so a stored
    // edge saying otherwise is normalised rather than trusted.
    origin: 'declared',
    ...(rule === undefined ? {} : { rule }),
    ...(evidence === undefined ? {} : { evidence }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(createdBy === undefined ? {} : { createdBy }),
  };
}

export function sanitizeRoadmapGraphDocument(value: unknown): RoadmapGraphDocument | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const version = Number(record['version']);
  if (!Number.isFinite(version) || version < 1) {
    return undefined;
  }

  const nodes: RoadmapNodeRecord[] = [];
  const seenNodes = new Set<string>();
  for (const entry of Array.isArray(record['nodes']) ? record['nodes'] : []) {
    const node = sanitizeRoadmapNodeRecord(entry);
    if (node === undefined || seenNodes.has(node.id) || nodes.length >= MAX_ROADMAP_GRAPH_NODES) {
      continue;
    }
    seenNodes.add(node.id);
    nodes.push(node);
  }

  const edges: RoadmapEdge[] = [];
  const seenEdges = new Set<string>();
  for (const entry of Array.isArray(record['edges']) ? record['edges'] : []) {
    const edge = sanitizeRoadmapEdge(entry);
    if (edge === undefined || edges.length >= MAX_ROADMAP_EDGES) {
      continue;
    }
    const key = edgeKey(edge);
    // A duplicate is dropped; a reversal is kept, because two people declaring
    // opposite orders is a real disagreement the graph reports as a cycle rather
    // than resolving on their behalf.
    if (seenEdges.has(key)) {
      continue;
    }
    seenEdges.add(key);
    edges.push(edge);
  }

  const dismissed: Array<{ from: string; to: string }> = [];
  const seenDismissed = new Set<string>();
  for (const entry of Array.isArray(record['dismissed']) ? record['dismissed'] : []) {
    if (typeof entry !== 'object' || entry === null || dismissed.length >= MAX_ROADMAP_EDGES) {
      continue;
    }
    const from = sanitizeId((entry as Record<string, unknown>)['from']);
    const to = sanitizeId((entry as Record<string, unknown>)['to']);
    if (from === undefined || to === undefined || from === to) {
      continue;
    }
    const key = edgeKey({ from, to });
    if (seenDismissed.has(key)) {
      continue;
    }
    seenDismissed.add(key);
    dismissed.push({ from, to });
  }

  return {
    version: Math.round(version),
    nodes,
    edges,
    suggestLinks: record['suggestLinks'] !== false,
    dismissed,
    layoutOrientation: record['layoutOrientation'] === 'vertical' ? 'vertical' : 'horizontal',
    updatedAt: sanitizeTimestamp(record['updatedAt']) ?? new Date(0).toISOString(),
  };
}

function isRoadmapGraphDocument(value: unknown): value is RoadmapGraphDocument {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record['nodes']) && Array.isArray(record['edges']);
}

// ── Persistence ───────────────────────────────────────────────────────────

export function readRoadmapGraphFile(
  workspaceRoot: string,
  ssotPath: string,
): VersionedDocumentRead<RoadmapGraphDocument> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(workspaceRoot, ssotPath, ROADMAP_GRAPH_FILE), 'utf8'));
  } catch {
    return { preserveExisting: false };
  }
  const read = interpretVersionedDocument('roadmap-graph', parsed, isRoadmapGraphDocument);
  if (read.config === undefined) {
    return read;
  }
  const clean = sanitizeRoadmapGraphDocument(read.config);
  return clean === undefined
    ? { preserveExisting: read.preserveExisting }
    : { ...read, config: clean };
}

/** The document, or a seed. Callers that must not overwrite check `preserveExisting`. */
export function readRoadmapGraph(workspaceRoot: string, ssotPath: string): RoadmapGraphDocument {
  return readRoadmapGraphFile(workspaceRoot, ssotPath).config ?? seedRoadmapGraphDocument(new Date(0));
}

export async function writeRoadmapGraph(
  workspaceRoot: string,
  ssotPath: string,
  document: RoadmapGraphDocument,
  now: Date = new Date(),
): Promise<void> {
  const jsonPath = path.join(workspaceRoot, ssotPath, ROADMAP_GRAPH_FILE);
  const summaryPath = path.join(workspaceRoot, ssotPath, ROADMAP_GRAPH_SUMMARY_FILE);
  await mkdir(path.dirname(jsonPath), { recursive: true });
  const updated: RoadmapGraphDocument = { ...document, version: 1, updatedAt: now.toISOString() };
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8'),
    writeFile(summaryPath, renderRoadmapGraphMarkdown(updated), 'utf-8'),
  ]);
}

// ── Reconciliation ────────────────────────────────────────────────────────

/** What the backlog currently holds, as reconciliation needs to see it. */
export interface RoadmapReconcileItem {
  /** The anchor found on the line, when the line carries one. */
  nodeId?: string;
  text: string;
  completed: boolean;
}

export interface RoadmapReconcileResult {
  document: RoadmapGraphDocument;
  /** Item index → the node id it resolved to, for callers rewriting the markdown. */
  resolved: Map<number, string>;
  /** Records dropped because their item is no longer in the backlog. */
  droppedNodeIds: string[];
  /** Edges dropped because an end of them was. */
  droppedEdges: number;
  changed: boolean;
}

/**
 * Bring the overlay back into agreement with the backlog.
 *
 * Three repairs, in order of how much they cost to get wrong:
 *
 * - An item with an anchor keeps its record. Always. This is the whole reason
 *   the anchor exists.
 * - An item **without** one adopts a record whose stored text still matches,
 *   provided no anchored item already claimed it — this is the hand-edit repair,
 *   and the guard is what stops two items fighting over one deadline.
 * - A record no item claimed is dropped, along with any edge that touched it.
 *   Keeping it would put a node on the canvas that is not on the roadmap.
 *
 * Nothing here mints an id: minting is a *write*, and reconciliation runs on
 * every render. Ids are minted by `assignRoadmapNodeIds` when a node actually
 * gains data worth keeping.
 */
export function reconcileRoadmapGraph(
  document: RoadmapGraphDocument,
  items: readonly RoadmapReconcileItem[],
): RoadmapReconcileResult {
  const byId = new Map(document.nodes.map(node => [node.id, node]));
  const resolved = new Map<number, string>();
  const claimed = new Set<string>();

  items.forEach((item, index) => {
    if (item.nodeId !== undefined && byId.has(item.nodeId) && !claimed.has(item.nodeId)) {
      claimed.add(item.nodeId);
      resolved.set(index, item.nodeId);
    }
  });

  // Second pass so an anchored item always beats a text match for the same
  // record — otherwise a duplicated line could steal an anchored item's history.
  const byText = new Map<string, RoadmapNodeRecord[]>();
  for (const node of document.nodes) {
    if (claimed.has(node.id) || node.normalizedText.length === 0) {
      continue;
    }
    const bucket = byText.get(node.normalizedText) ?? [];
    bucket.push(node);
    byText.set(node.normalizedText, bucket);
  }
  items.forEach((item, index) => {
    if (resolved.has(index)) {
      return;
    }
    const candidates = byText.get(normalizeRoadmapNodeText(item.text)) ?? [];
    const adopted = candidates.find(candidate => !claimed.has(candidate.id));
    if (adopted !== undefined) {
      claimed.add(adopted.id);
      resolved.set(index, adopted.id);
    }
  });

  // An anchored item whose record vanished (a hand-deleted JSON entry) still
  // owns its id, so the anchor keeps meaning something and the node can be
  // re-populated without renumbering the file.
  items.forEach((item, index) => {
    if (!resolved.has(index) && item.nodeId !== undefined && !claimed.has(item.nodeId)) {
      claimed.add(item.nodeId);
      resolved.set(index, item.nodeId);
    }
  });

  const droppedNodeIds = document.nodes.filter(node => !claimed.has(node.id)).map(node => node.id);
  const live = new Set(claimed);
  const nodes = document.nodes.filter(node => live.has(node.id));
  const edges = document.edges.filter(edge => live.has(edge.from) && live.has(edge.to));
  const droppedEdges = document.edges.length - edges.length;
  const dismissed = document.dismissed.filter(entry => live.has(entry.from) && live.has(entry.to));

  return {
    document: { ...document, nodes, edges, dismissed },
    resolved,
    droppedNodeIds,
    droppedEdges,
    changed: droppedNodeIds.length > 0 || droppedEdges > 0,
  };
}

/**
 * Give every item an id, minting where one is missing.
 *
 * Called when the canvas saves — the point at which the roadmap stops being a
 * plain list and starts being a graph. Deterministic, so re-running it produces
 * no diff.
 */
export function assignRoadmapNodeIds(
  items: readonly RoadmapReconcileItem[],
  existing: ReadonlySet<string>,
): string[] {
  const taken = new Set(existing);
  return items.map(item => {
    if (item.nodeId !== undefined && !taken.has(item.nodeId)) {
      taken.add(item.nodeId);
      return item.nodeId;
    }
    if (item.nodeId !== undefined && existing.has(item.nodeId)) {
      // Already ours from a previous pass in this same run.
      return item.nodeId;
    }
    const minted = mintRoadmapNodeId(item.text, taken);
    taken.add(minted);
    return minted;
  });
}

// ── The markdown mirror ───────────────────────────────────────────────────

/**
 * A human-readable mirror of the overlay.
 *
 * Same reason every other register here has one: the JSON is the source of
 * truth, and a committed plan that can only be read by the tool that wrote it is
 * a plan nobody reviews in a pull request.
 */
export function renderRoadmapGraphMarkdown(document: RoadmapGraphDocument): string {
  const lines: string[] = [
    '# Roadmap graph',
    '',
    '> Generated by AtlasMind from the Roadmap canvas. The backlog itself lives in',
    '> `improvement-plan.md`; this file holds the deadlines, estimates, branch names',
    '> and dependency links that a markdown checkbox cannot carry.',
    '',
    `Last updated: ${document.updatedAt}`,
    '',
    `Suggested links: ${document.suggestLinks ? 'on — AtlasMind proposes links, and nothing is applied until somebody accepts it' : 'off — only links drawn by hand are shown'}`,
    '',
    `Layout: ${document.layoutOrientation === 'vertical' ? 'vertical — the tree runs top to bottom' : 'horizontal — the tree runs left to right'}. Nodes moved by hand keep their position whichever way the tree runs.`,
    '',
    '## Nodes',
    '',
  ];

  if (document.nodes.length === 0) {
    lines.push('No roadmap item has graph data yet.', '');
  } else {
    lines.push('| Id | Item | Branch | Deadline | Estimate | AI-assisted | Added | Completed |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const node of document.nodes) {
      lines.push([
        '',
        `\`${node.id}\``,
        node.normalizedText.length > 0 ? node.normalizedText.slice(0, 80) : '—',
        node.branch ?? '—',
        node.deadline ?? '—',
        node.estimateDays === undefined ? 'derived' : `${node.estimateDays}d`,
        node.aiAssisted === false ? 'no' : 'yes',
        formatWho(node.addedAt, node.addedBy),
        formatWho(node.completedAt, node.completedBy),
        '',
      ].join(' | ').trim());
    }
    lines.push('');
  }

  lines.push('## Links', '');
  if (document.edges.length === 0) {
    lines.push('No dependencies declared. Everything on the roadmap can be started independently.', '');
  } else {
    lines.push('| Must land first | Before | Source | Recorded |');
    lines.push('|---|---|---|---|');
    for (const edge of document.edges) {
      lines.push(`| \`${edge.from}\` | \`${edge.to}\` | ${edge.rule === undefined ? 'drawn by hand' : `accepted suggestion (${edge.rule})`} | ${formatWho(edge.createdAt, edge.createdBy)} |`);
    }
    lines.push('');
  }

  lines.push(
    '## How a link gets suggested',
    '',
    'A suggestion is drawn dashed and changes nothing until somebody accepts it. It can never',
    'contradict a link drawn by hand, and it can never make the plan circular.',
    '',
    '| Rule | What it looks for |',
    '|---|---|',
    ...ROADMAP_EDGE_RULES.map(rule => `| ${rule.label} | ${rule.detail} |`),
    '',
  );

  return `${lines.join('\n')}\n`;
}

function formatWho(at: string | undefined, by: string | undefined): string {
  if (at === undefined && by === undefined) {
    return '—';
  }
  const when = at === undefined ? 'date not recorded' : at.slice(0, 10);
  return by === undefined ? when : `${when} · ${by}`;
}
