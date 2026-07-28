import { describe, expect, it } from 'vitest';
import {
  MAX_ROADMAP_GATES,
  MVP_GATE_ID,
  ROADMAP_GATES_END,
  ROADMAP_GATES_START,
  builtInMvpGate,
  extractItemGates,
  formatItemGateTags,
  normalizeGates,
  parseRoadmapGates,
  renderRoadmapGatesBlock,
  sanitizeGateSelection,
  slugifyGateId,
  stripRoadmapGatesBlock,
  upsertRoadmapGatesBlock,
  type RoadmapGate,
} from '../../src/core/roadmapGates.ts';

const ITEMS_END = '<!-- atlasmind:roadmap-items:end -->';

const gate = (id: string, label = id): RoadmapGate => ({ id, label, order: 0, builtIn: false });

describe('slugifyGateId', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugifyGateId('Public Beta')).toBe('public-beta');
    expect(slugifyGateId('  v1.0  ')).toBe('v1.0');
  });

  it('rejects input that cannot become a tag', () => {
    expect(slugifyGateId('')).toBe('');
    expect(slugifyGateId('   ')).toBe('');
    expect(slugifyGateId('###')).toBe('');
    expect(slugifyGateId(42)).toBe('');
    expect(slugifyGateId(undefined)).toBe('');
  });

  it('caps the length so a tag stays readable', () => {
    expect(slugifyGateId('a'.repeat(80)).length).toBeLessThanOrEqual(24);
  });
});

describe('parseRoadmapGates', () => {
  it('always yields the built-in MVP gate first, even for an empty document', () => {
    const gates = parseRoadmapGates('');
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ id: MVP_GATE_ID, builtIn: true, order: 0 });
  });

  it('reads declared gates in file order', () => {
    const doc = [
      ROADMAP_GATES_START,
      '- `#beta` — Public beta',
      '- `#v1` — Version 1.0',
      ROADMAP_GATES_END,
    ].join('\n');
    const gates = parseRoadmapGates(doc);
    expect(gates.map(g => g.id)).toEqual(['mvp', 'beta', 'v1']);
    expect(gates[1]!.label).toBe('Public beta');
    expect(gates.map(g => g.order)).toEqual([0, 1, 2]);
  });

  it('keeps MVP even when the block omits it, and honours a custom MVP label', () => {
    const withoutMvp = parseRoadmapGates([ROADMAP_GATES_START, '- `#beta` — Beta', ROADMAP_GATES_END].join('\n'));
    expect(withoutMvp[0]!.id).toBe('mvp');

    const relabelled = parseRoadmapGates([ROADMAP_GATES_START, '- `#mvp` — First usable release', ROADMAP_GATES_END].join('\n'));
    expect(relabelled[0]).toMatchObject({ id: 'mvp', label: 'First usable release', builtIn: true });
  });

  it('ignores unparseable lines and duplicate ids', () => {
    const doc = [
      ROADMAP_GATES_START,
      'not a list item',
      '- nonsense without a tag',
      '- `#beta` — Beta',
      '- `#beta` — Beta again',
      ROADMAP_GATES_END,
    ].join('\n');
    expect(parseRoadmapGates(doc).map(g => g.id)).toEqual(['mvp', 'beta']);
  });

  it('bounds how many gates a document can declare', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `- \`#g${i}\` — Gate ${i}`);
    const gates = parseRoadmapGates([ROADMAP_GATES_START, ...lines, ROADMAP_GATES_END].join('\n'));
    expect(gates.length).toBeLessThanOrEqual(MAX_ROADMAP_GATES);
  });
});

describe('normalizeGates', () => {
  it('keeps mvp first and drops unusable ids', () => {
    const gates = normalizeGates([gate('beta', 'Beta'), gate('###'), gate('beta', 'Duplicate')]);
    expect(gates.map(g => g.id)).toEqual(['mvp', 'beta']);
    expect(gates[0]!.builtIn).toBe(true);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 40 }, (_, i) => gate(`g${i}`));
    expect(normalizeGates(many).length).toBe(MAX_ROADMAP_GATES);
  });

  it('accepts undefined', () => {
    expect(normalizeGates(undefined)).toEqual([builtInMvpGate()]);
  });
});

describe('extractItemGates', () => {
  const gates = normalizeGates([gate('beta', 'Beta'), gate('v1', 'v1.0'), gate('v10', 'v10')]);

  it('splits declared tags from the text', () => {
    const parsed = extractItemGates('Ship onboarding flow #mvp #beta', gates);
    expect(parsed.text).toBe('Ship onboarding flow');
    expect(parsed.gates.sort()).toEqual(['beta', 'mvp']);
  });

  it('leaves an undeclared hashtag alone', () => {
    const parsed = extractItemGates('Fix the #2 case #notagate', gates);
    expect(parsed.text).toBe('Fix the #2 case #notagate');
    expect(parsed.gates).toEqual([]);
  });

  it('does not let one gate match inside a longer tag', () => {
    const parsed = extractItemGates('Migrate the store #v10', gates);
    expect(parsed.gates).toEqual(['v10']);
    expect(parsed.text).toBe('Migrate the store');
  });

  it('matches case-insensitively but returns the canonical id', () => {
    expect(extractItemGates('Do the thing #MVP', gates).gates).toEqual(['mvp']);
  });

  it('tolerates non-string input', () => {
    expect(extractItemGates(undefined as unknown as string, gates)).toEqual({ text: '', gates: [] });
  });
});

describe('formatItemGateTags', () => {
  const gates = normalizeGates([gate('beta', 'Beta'), gate('v1', 'v1.0')]);

  it('writes tags in declared order', () => {
    expect(formatItemGateTags(['v1', 'mvp'], gates)).toBe(' #mvp #v1');
  });

  it('writes nothing when the item is on no gate', () => {
    expect(formatItemGateTags([], gates)).toBe('');
    expect(formatItemGateTags(undefined, gates)).toBe('');
  });

  it('drops ids that are not declared', () => {
    expect(formatItemGateTags(['ghost'], gates)).toBe('');
  });
});

describe('sanitizeGateSelection', () => {
  const gates = normalizeGates([gate('beta', 'Beta')]);

  it('keeps only declared ids, de-duplicated', () => {
    expect(sanitizeGateSelection(['mvp', 'beta', 'mvp', 'ghost'], gates)).toEqual(['mvp', 'beta']);
  });

  it('returns nothing for non-array input', () => {
    expect(sanitizeGateSelection('mvp', gates)).toEqual([]);
    expect(sanitizeGateSelection(null, gates)).toEqual([]);
  });
});

describe('gates block round trip', () => {
  it('inserts the block after the backlog and reads back what it wrote', () => {
    const document = [
      '# Developer Roadmap',
      '',
      '## Prioritized Backlog',
      '<!-- atlasmind:roadmap-items:start -->',
      '- [ ] Ship onboarding #mvp',
      ITEMS_END,
      '',
      '## Prioritisation Notes',
    ].join('\n');

    const gates = normalizeGates([gate('beta', 'Public beta')]);
    const next = upsertRoadmapGatesBlock(document, gates, ITEMS_END);
    expect(next.indexOf(ROADMAP_GATES_START)).toBeGreaterThan(next.indexOf(ITEMS_END));
    expect(next).toContain('- `#beta` — Public beta');
    expect(next).toContain('## Prioritisation Notes');
    expect(parseRoadmapGates(next).map(g => g.id)).toEqual(['mvp', 'beta']);
  });

  it('replaces an existing block instead of appending a second one', () => {
    const first = upsertRoadmapGatesBlock('# Roadmap\n', normalizeGates([gate('beta', 'Beta')]), ITEMS_END);
    const second = upsertRoadmapGatesBlock(first, normalizeGates([gate('v2', 'Version 2')]), ITEMS_END);
    expect(second.match(new RegExp(ROADMAP_GATES_START, 'g'))).toHaveLength(1);
    expect(second).not.toContain('#beta');
    expect(parseRoadmapGates(second).map(g => g.id)).toEqual(['mvp', 'v2']);
  });

  it('renders the block with a heading so the file stays readable', () => {
    expect(renderRoadmapGatesBlock(normalizeGates([]))).toContain('### Release gates');
  });

  it('strips the block so its list lines cannot be read as backlog items', () => {
    const document = ['- [ ] Real item', renderRoadmapGatesBlock(normalizeGates([gate('beta', 'Beta')]))].join('\n');
    const stripped = stripRoadmapGatesBlock(document);
    expect(stripped).toContain('- [ ] Real item');
    expect(stripped).not.toContain('#beta');
  });

  it('leaves a document without the block untouched when stripping', () => {
    expect(stripRoadmapGatesBlock('# Roadmap\n- [ ] item\n')).toBe('# Roadmap\n- [ ] item\n');
  });
});
