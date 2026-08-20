import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ROADMAP_GRAPH_FILE,
  ROADMAP_GRAPH_SUMMARY_FILE,
  assignRoadmapNodeIds,
  extractRoadmapNodeAnchor,
  mintRoadmapNodeId,
  readRoadmapGraph,
  readRoadmapGraphFile,
  reconcileRoadmapGraph,
  renderRoadmapGraphMarkdown,
  renderRoadmapNodeAnchor,
  sanitizeRoadmapEdge,
  sanitizeRoadmapGraphDocument,
  sanitizeRoadmapNodeRecord,
  seedRoadmapGraphDocument,
  writeRoadmapGraph,
  type RoadmapGraphDocument,
} from '../../src/core/roadmapGraphStore.ts';

const roots: string[] = [];

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'atlasmind-roadmap-'));
  roots.push(root);
  mkdirSync(path.join(root, 'project_memory', 'roadmap'), { recursive: true });
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

const doc = (overrides: Partial<RoadmapGraphDocument> = {}): RoadmapGraphDocument => ({
  ...seedRoadmapGraphDocument(new Date('2026-08-20T00:00:00Z')),
  ...overrides,
});

describe('the markdown anchor', () => {
  it('round-trips through a backlog line', () => {
    const line = `Ship the export${renderRoadmapNodeAnchor('ship-the-export')}`;
    expect(extractRoadmapNodeAnchor(line)).toEqual({ text: 'Ship the export', nodeId: 'ship-the-export' });
  });

  it('is invisible to the item text — it never reaches a title or an issue draft', () => {
    const parsed = extractRoadmapNodeAnchor('Ship the export <!-- rm:ship -->');
    expect(parsed.text).toBe('Ship the export');
    expect(parsed.text).not.toContain('rm:');
  });

  it('leaves a line without one alone', () => {
    expect(extractRoadmapNodeAnchor('Ship the export')).toEqual({ text: 'Ship the export' });
  });

  it('ignores a comment that is not an anchor', () => {
    const parsed = extractRoadmapNodeAnchor('Ship the export <!-- a note -->');
    expect(parsed.nodeId).toBeUndefined();
    expect(parsed.text).toBe('Ship the export <!-- a note -->');
  });
});

describe('mintRoadmapNodeId', () => {
  it('derives a readable, deterministic id from the text', () => {
    expect(mintRoadmapNodeId('Ship the invoice export', new Set())).toBe('ship-the-invoice-export');
    expect(mintRoadmapNodeId('Ship the invoice export', new Set()))
      .toBe(mintRoadmapNodeId('Ship the invoice export', new Set()));
  });

  it('de-duplicates by ordinal, never by a timestamp or a random value', () => {
    // The roadmap is committed. Two people wiring up the same backlog must not
    // produce a diff, which rules out anything non-deterministic.
    expect(mintRoadmapNodeId('Ship it', new Set(['ship-it']))).toBe('ship-it-2');
    expect(mintRoadmapNodeId('Ship it', new Set(['ship-it', 'ship-it-2']))).toBe('ship-it-3');
  });

  it('falls back to a usable id when the text slugifies to nothing', () => {
    expect(mintRoadmapNodeId('!!!', new Set())).toBe('item');
  });
});

describe('assignRoadmapNodeIds', () => {
  it('keeps ids a line already carries', () => {
    expect(assignRoadmapNodeIds(
      [{ nodeId: 'kept', text: 'Something', completed: false }],
      new Set(['kept']),
    )).toEqual(['kept']);
  });

  it('mints only where one is missing, without colliding', () => {
    const ids = assignRoadmapNodeIds([
      { nodeId: 'ship-it', text: 'Ship it', completed: false },
      { text: 'Ship it', completed: false },
    ], new Set(['ship-it']));
    expect(ids).toEqual(['ship-it', 'ship-it-2']);
  });
});

describe('sanitizeRoadmapNodeRecord', () => {
  it('refuses a record with no usable id', () => {
    expect(sanitizeRoadmapNodeRecord({ id: '' })).toBeUndefined();
    expect(sanitizeRoadmapNodeRecord({ id: 'has space' })).toBeUndefined();
    expect(sanitizeRoadmapNodeRecord(null)).toBeUndefined();
  });

  it('refuses a branch name that would break a git ref rather than cleaning it', () => {
    // A nearly-valid name made plausible fails later, at `git checkout`, where
    // nobody connects it back to the card it came from.
    expect(sanitizeRoadmapNodeRecord({ id: 'a', branch: 'feat/has space' })?.branch).toBeUndefined();
    expect(sanitizeRoadmapNodeRecord({ id: 'a', branch: 'feat/two..dots' })?.branch).toBeUndefined();
    expect(sanitizeRoadmapNodeRecord({ id: 'a', branch: 'feat/fine-name' })?.branch).toBe('feat/fine-name');
  });

  it('drops a deadline that is not a real calendar date', () => {
    expect(sanitizeRoadmapNodeRecord({ id: 'a', deadline: 'soon' })?.deadline).toBeUndefined();
    expect(sanitizeRoadmapNodeRecord({ id: 'a', deadline: '2026-09-01' })?.deadline).toBe('2026-09-01');
  });

  it('keeps `aiAssisted: false` as a decision and an absent one as unset', () => {
    expect(sanitizeRoadmapNodeRecord({ id: 'a', aiAssisted: false })).toHaveProperty('aiAssisted', false);
    expect(sanitizeRoadmapNodeRecord({ id: 'a' })).not.toHaveProperty('aiAssisted');
    expect(sanitizeRoadmapNodeRecord({ id: 'a', aiAssisted: 'yes' })).not.toHaveProperty('aiAssisted');
  });

  it('clamps a position rather than trusting it', () => {
    expect(sanitizeRoadmapNodeRecord({ id: 'a', position: { x: -50, y: 9e9 } })?.position)
      .toEqual({ x: 0, y: 40000 });
    expect(sanitizeRoadmapNodeRecord({ id: 'a', position: { x: 'left', y: 4 } })?.position).toBeUndefined();
  });

  it('refuses a negative or absurd estimate', () => {
    expect(sanitizeRoadmapNodeRecord({ id: 'a', estimateDays: -3 })).not.toHaveProperty('estimateDays');
    expect(sanitizeRoadmapNodeRecord({ id: 'a', estimateDays: 10000 })?.estimateDays).toBe(365);
  });
});

describe('sanitizeRoadmapEdge', () => {
  it('refuses a self-link and a link with a missing end', () => {
    expect(sanitizeRoadmapEdge({ from: 'a', to: 'a' })).toBeUndefined();
    expect(sanitizeRoadmapEdge({ from: 'a' })).toBeUndefined();
  });

  it('normalises a stored edge to `declared` — a suggestion is never persisted', () => {
    expect(sanitizeRoadmapEdge({ from: 'a', to: 'b', origin: 'derived' })?.origin).toBe('declared');
  });

  it('keeps only a rule that is in the published table', () => {
    expect(sanitizeRoadmapEdge({ from: 'a', to: 'b', rule: 'gate-sequence' })?.rule).toBe('gate-sequence');
    expect(sanitizeRoadmapEdge({ from: 'a', to: 'b', rule: 'made-up' })).not.toHaveProperty('rule');
  });
});

describe('sanitizeRoadmapGraphDocument', () => {
  it('drops duplicate nodes and duplicate links', () => {
    const clean = sanitizeRoadmapGraphDocument({
      version: 1,
      nodes: [{ id: 'a', normalizedText: 'a' }, { id: 'a', normalizedText: 'a again' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }],
    });
    expect(clean?.nodes).toHaveLength(1);
    expect(clean?.edges).toHaveLength(1);
  });

  it('keeps a reversed pair — two people disagreeing is a finding, not a duplicate', () => {
    const clean = sanitizeRoadmapGraphDocument({
      version: 1,
      nodes: [],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    });
    expect(clean?.edges).toHaveLength(2);
  });

  it('defaults suggestions on, and honours an explicit off', () => {
    expect(sanitizeRoadmapGraphDocument({ version: 1, nodes: [], edges: [] })?.suggestLinks).toBe(true);
    expect(sanitizeRoadmapGraphDocument({ version: 1, nodes: [], edges: [], suggestLinks: false })?.suggestLinks).toBe(false);
  });

  it('defaults the layout to horizontal and only accepts the two it knows', () => {
    expect(sanitizeRoadmapGraphDocument({ version: 1, nodes: [], edges: [] })?.layoutOrientation).toBe('horizontal');
    expect(sanitizeRoadmapGraphDocument({ version: 1, nodes: [], edges: [], layoutOrientation: 'vertical' })?.layoutOrientation).toBe('vertical');
    expect(sanitizeRoadmapGraphDocument({ version: 1, nodes: [], edges: [], layoutOrientation: 'diagonal' })?.layoutOrientation).toBe('horizontal');
  });

  it('never throws on hostile input', () => {
    expect(() => sanitizeRoadmapGraphDocument({ version: 1, nodes: 'nope', edges: 42, dismissed: null })).not.toThrow();
    expect(sanitizeRoadmapGraphDocument('nope')).toBeUndefined();
    expect(sanitizeRoadmapGraphDocument({ nodes: [], edges: [] })).toBeUndefined();
  });
});

describe('reconcileRoadmapGraph', () => {
  it('resolves an anchored item to its record', () => {
    const result = reconcileRoadmapGraph(
      doc({ nodes: [{ id: 'ship', normalizedText: 'ship it' }] }),
      [{ nodeId: 'ship', text: 'Ship it, renamed', completed: false }],
    );
    expect(result.resolved.get(0)).toBe('ship');
    expect(result.droppedNodeIds).toEqual([]);
  });

  it('survives a rename — the anchor is the key, not the text', () => {
    const result = reconcileRoadmapGraph(
      doc({ nodes: [{ id: 'ship', normalizedText: 'ship it', deadline: '2026-09-01' }] }),
      [{ nodeId: 'ship', text: 'Something else entirely', completed: false }],
    );
    expect(result.document.nodes[0]?.deadline).toBe('2026-09-01');
  });

  it('repairs a record whose anchor was hand-deleted, by text', () => {
    const result = reconcileRoadmapGraph(
      doc({ nodes: [{ id: 'ship', normalizedText: 'ship it' }] }),
      [{ text: 'Ship it', completed: false }],
    );
    expect(result.resolved.get(0)).toBe('ship');
  });

  it('never lets a text match steal an anchored item’s record', () => {
    const result = reconcileRoadmapGraph(
      doc({ nodes: [{ id: 'ship', normalizedText: 'ship it' }] }),
      [{ text: 'Ship it', completed: false }, { nodeId: 'ship', text: 'Ship it', completed: false }],
    );
    expect(result.resolved.get(1)).toBe('ship');
    expect(result.resolved.get(0)).toBeUndefined();
  });

  it('drops a record whose item left the backlog, and the links touching it', () => {
    const result = reconcileRoadmapGraph(
      doc({
        nodes: [{ id: 'kept', normalizedText: 'kept' }, { id: 'gone', normalizedText: 'gone' }],
        edges: [{ from: 'gone', to: 'kept', origin: 'declared' }],
      }),
      [{ nodeId: 'kept', text: 'Kept', completed: false }],
    );
    expect(result.droppedNodeIds).toEqual(['gone']);
    expect(result.document.edges).toEqual([]);
    expect(result.droppedEdges).toBe(1);
    expect(result.changed).toBe(true);
  });

  it('drops a dismissal whose items are gone, so it cannot resurface against new work', () => {
    const result = reconcileRoadmapGraph(
      doc({ dismissed: [{ from: 'gone', to: 'also-gone' }] }),
      [{ nodeId: 'kept', text: 'Kept', completed: false }],
    );
    expect(result.document.dismissed).toEqual([]);
  });

  it('mints nothing — reconciliation runs on every render and must not write', () => {
    const result = reconcileRoadmapGraph(doc(), [{ text: 'Brand new', completed: false }]);
    expect(result.resolved.size).toBe(0);
    expect(result.document.nodes).toEqual([]);
  });
});

describe('persistence', () => {
  it('writes both the JSON and the human-readable mirror', async () => {
    const root = workspace();
    await writeRoadmapGraph(root, 'project_memory', doc({
      nodes: [{ id: 'ship', normalizedText: 'ship it', deadline: '2026-09-01' }],
    }));
    expect(existsSync(path.join(root, 'project_memory', ROADMAP_GRAPH_FILE))).toBe(true);
    expect(readFileSync(path.join(root, 'project_memory', ROADMAP_GRAPH_SUMMARY_FILE), 'utf8'))
      .toContain('2026-09-01');
  });

  it('round-trips', async () => {
    const root = workspace();
    await writeRoadmapGraph(root, 'project_memory', doc({
      nodes: [{ id: 'a', normalizedText: 'a', position: { x: 10, y: 20 } }],
      edges: [{ from: 'a', to: 'b', origin: 'declared' }],
      suggestLinks: false,
      layoutOrientation: 'vertical',
    }));
    const read = readRoadmapGraph(root, 'project_memory');
    expect(read.nodes[0]?.position).toEqual({ x: 10, y: 20 });
    expect(read.edges).toHaveLength(1);
    expect(read.suggestLinks).toBe(false);
    expect(read.layoutOrientation).toBe('vertical');
  });

  it('treats a missing file as nothing to preserve', () => {
    const read = readRoadmapGraphFile(workspace(), 'project_memory');
    expect(read.config).toBeUndefined();
    expect(read.preserveExisting).toBe(false);
  });

  it('treats a corrupt file as replaceable, not as a file to protect', () => {
    const root = workspace();
    writeFileSync(path.join(root, 'project_memory', ROADMAP_GRAPH_FILE), 'not json at all', 'utf8');
    expect(readRoadmapGraphFile(root, 'project_memory').preserveExisting).toBe(false);
  });

  it('refuses to hand back a file written by a newer AtlasMind', () => {
    // The distinction that stops this build silently overwriting a colleague's
    // work: corrupt is replaceable, futuristic never is.
    const root = workspace();
    writeFileSync(
      path.join(root, 'project_memory', ROADMAP_GRAPH_FILE),
      JSON.stringify({ version: 99, nodes: [], edges: [] }),
      'utf8',
    );
    const read = readRoadmapGraphFile(root, 'project_memory');
    expect(read.preserveExisting).toBe(true);
    expect(read.config).toBeUndefined();
  });
});

describe('renderRoadmapGraphMarkdown', () => {
  it('publishes the rules that decide a suggestion', () => {
    const markdown = renderRoadmapGraphMarkdown(doc());
    expect(markdown).toContain('How a link gets suggested');
    expect(markdown).toContain('Names what it waits for');
  });

  it('says plainly when nothing is linked rather than showing an empty table', () => {
    expect(renderRoadmapGraphMarkdown(doc())).toContain('No dependencies declared');
  });

  it('distinguishes a hand-drawn link from an accepted suggestion', () => {
    const markdown = renderRoadmapGraphMarkdown(doc({
      edges: [
        { from: 'a', to: 'b', origin: 'declared' },
        { from: 'c', to: 'd', origin: 'declared', rule: 'gate-sequence' },
      ],
    }));
    expect(markdown).toContain('drawn by hand');
    expect(markdown).toContain('accepted suggestion (gate-sequence)');
  });

  it('reports an unrecorded date as unrecorded, never as a guess', () => {
    const markdown = renderRoadmapGraphMarkdown(doc({ nodes: [{ id: 'a', normalizedText: 'a' }] }));
    expect(markdown).not.toContain('1970');
  });
});
