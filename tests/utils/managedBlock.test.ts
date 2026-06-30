import { describe, it, expect } from 'vitest';
import { upsertManagedBlock, stripManagedBlock } from '../../src/utils/managedBlock.js';

const MARKERS = { start: '<!-- m:start -->', end: '<!-- m:end -->' };

describe('upsertManagedBlock', () => {
  it('appends a block to content with no existing block, preserving prior text', () => {
    const out = upsertManagedBlock('# Title\n\nbody', 'NEW', MARKERS);
    expect(out).toContain('# Title');
    expect(out).toContain('body');
    expect(out).toContain(`${MARKERS.start}\nNEW\n${MARKERS.end}`);
    // Prior content comes before the block.
    expect(out.indexOf('body')).toBeLessThan(out.indexOf(MARKERS.start));
  });

  it('creates a block when content is empty', () => {
    expect(upsertManagedBlock('', 'NEW', MARKERS)).toBe(`${MARKERS.start}\nNEW\n${MARKERS.end}\n`);
  });

  it('replaces an existing block in place and preserves surrounding text', () => {
    const existing = `head\n\n${MARKERS.start}\nOLD\n${MARKERS.end}\n\ntail`;
    const out = upsertManagedBlock(existing, 'NEW', MARKERS);
    expect(out).toContain('NEW');
    expect(out).not.toContain('OLD');
    expect(out).toContain('head');
    expect(out).toContain('tail');
    // Exactly one block.
    expect(out.split(MARKERS.start).length - 1).toBe(1);
  });

  it('is idempotent when re-applying the same body', () => {
    const once = upsertManagedBlock('head\n\ntail', 'BODY', MARKERS);
    const twice = upsertManagedBlock(once, 'BODY', MARKERS);
    expect(twice).toBe(once);
  });
});

describe('stripManagedBlock', () => {
  it('removes the block and preserves surrounding content', () => {
    const content = `head\n\n${MARKERS.start}\nBLK\n${MARKERS.end}\n\ntail`;
    const out = stripManagedBlock(content, MARKERS);
    expect(out).toContain('head');
    expect(out).toContain('tail');
    expect(out).not.toContain('BLK');
    expect(out).not.toContain(MARKERS.start);
  });

  it('returns content unchanged when no block is present', () => {
    expect(stripManagedBlock('just text', MARKERS)).toBe('just text');
  });
});
