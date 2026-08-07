import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  deriveSectionLabels,
  emptyWireframe,
  isLinkSourceKind,
  MAX_WIREFRAME_DEPTH,
  MAX_WIREFRAME_ELEMENTS,
  orderedWireframeElements,
  sanitizeWireframe,
  WIREFRAME_CANVAS_HEIGHT,
  WIREFRAME_CANVAS_WIDTH,
  WIREFRAME_KIND_CATALOG,
  wireframeAncestry,
  wireframeFromSections,
  wireframeKindSpec,
} from '../../src/core/websiteWireframe.js';
import type { WebsiteWireframe } from '../../src/types.js';

function element(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    kind: 'section',
    label: id,
    rect: { x: 0, y: 0, width: 500, height: 200 },
    designPrompt: '',
    notes: '',
    ...overrides,
  };
}

describe('websiteWireframe', () => {
  describe('sanitizeWireframe', () => {
    it('returns undefined for anything that is not an object', () => {
      for (const input of [undefined, null, 'wireframe', 42, []]) {
        expect(sanitizeWireframe(input)).toBeUndefined();
      }
    });

    it('drops an element with no usable id rather than inventing one', () => {
      // An invented id looks like a real element to every later reader while
      // pointing at nothing the author drew.
      const result = sanitizeWireframe({
        elements: [element('good'), { ...element('x'), id: '' }, { ...element('y'), id: 'has spaces' }],
      });
      expect(result?.elements.map(item => item.id)).toEqual(['good']);
    });

    it('drops a duplicate id', () => {
      const result = sanitizeWireframe({ elements: [element('a'), element('a')] });
      expect(result?.elements).toHaveLength(1);
    });

    it('falls back to the kind default rather than zero for a missing rect', () => {
      // A zero-size element exists in the data and cannot be seen or clicked.
      const result = sanitizeWireframe({ elements: [{ ...element('a'), rect: undefined, kind: 'hero' }] });
      const spec = wireframeKindSpec('hero');
      expect(result?.elements[0]?.rect.width).toBe(spec.defaultWidth);
      expect(result?.elements[0]?.rect.height).toBe(spec.defaultHeight);
    });

    it('clamps a rect that runs off the canvas', () => {
      const result = sanitizeWireframe({
        elements: [{ ...element('a'), rect: { x: 5_000, y: -20, width: 9_999, height: 99_999 } }],
      });
      const rect = result!.elements[0]!.rect;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(WIREFRAME_CANVAS_WIDTH);
      expect(rect.y + rect.height).toBeLessThanOrEqual(WIREFRAME_CANVAS_HEIGHT);
    });

    it('coerces a non-finite coordinate instead of storing NaN', () => {
      const result = sanitizeWireframe({
        elements: [{ ...element('a'), rect: { x: Number.NaN, y: Infinity, width: -Infinity, height: Number.NaN } }],
      });
      const rect = result!.elements[0]!.rect;
      for (const value of [rect.x, rect.y, rect.width, rect.height]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    });

    it('caps the element count', () => {
      const many = Array.from({ length: MAX_WIREFRAME_ELEMENTS + 25 }, (_, index) => element(`e${index}`));
      expect(sanitizeWireframe({ elements: many })?.elements).toHaveLength(MAX_WIREFRAME_ELEMENTS);
    });

    it('treats an unknown kind as custom rather than refusing the element', () => {
      const result = sanitizeWireframe({ elements: [{ ...element('a'), kind: 'wormhole' }] });
      expect(result?.elements[0]?.kind).toBe('custom');
    });

    it('defaults an unrecognised breakpoint to desktop', () => {
      expect(sanitizeWireframe({ breakpoint: 'watch', elements: [] })?.breakpoint).toBe('desktop');
    });

    describe('parent resolution', () => {
      it('drops a parent that is not present, keeping the element', () => {
        // Dropping the element would delete work because of a bad drag.
        const result = sanitizeWireframe({ elements: [element('a', { parentId: 'ghost' })] });
        expect(result?.elements).toHaveLength(1);
        expect(result?.elements[0]?.parentId).toBeUndefined();
      });

      it('drops a parent whose kind cannot contain children', () => {
        const result = sanitizeWireframe({
          elements: [element('text', { kind: 'text' }), element('card', { kind: 'card', parentId: 'text' })],
        });
        expect(result?.elements.find(item => item.id === 'card')?.parentId).toBeUndefined();
      });

      it('keeps a valid nesting', () => {
        const result = sanitizeWireframe({
          elements: [element('grid', { kind: 'grid' }), element('card', { kind: 'card', parentId: 'grid' })],
        });
        expect(result?.elements.find(item => item.id === 'card')?.parentId).toBe('grid');
      });

      it('refuses a self-parent', () => {
        const result = sanitizeWireframe({ elements: [element('a', { parentId: 'a' })] });
        expect(result?.elements[0]?.parentId).toBeUndefined();
      });

      it('breaks a two-element cycle without hanging', () => {
        const result = sanitizeWireframe({
          elements: [element('a', { parentId: 'b' }), element('b', { parentId: 'a' })],
        });
        expect(result?.elements.every(item => item.parentId === undefined || item.parentId !== item.id)).toBe(true);
        // The graph must be a forest: nothing may still reach itself.
        for (const item of result!.elements) {
          expect(reachesItself(result!, item.id)).toBe(false);
        }
      });

      it('refuses a chain deeper than the cap', () => {
        const chain = [
          element('a', { kind: 'section' }),
          element('b', { kind: 'section', parentId: 'a' }),
          element('c', { kind: 'section', parentId: 'b' }),
          element('d', { kind: 'section', parentId: 'c' }),
        ];
        const result = sanitizeWireframe({ elements: chain })!;
        for (const item of result.elements) {
          expect(wireframeAncestry(result, item.id).length).toBeLessThan(MAX_WIREFRAME_DEPTH);
        }
      });
    });

    // Replaced with a space rather than deleted, matching `issueTracker`'s
    // boundary. Deleting would silently join two words that were separate, so a
    // label carrying a stray control byte would read as a different word.
    it('replaces control characters in a label with a space and collapses the run', () => {
      const result = sanitizeWireframe({
        elements: [element('a', { label: 'Hero\u0007 ban\u0000ner' })],
      });
      expect(result?.elements[0]?.label).toBe('Hero ban ner');
    });
  });

  describe('properties', () => {
    // The sanitizer's contract is total: any input, no throw, always a forest
    // whose rectangles are finite and on-canvas.
    const arbitraryElement = fc.record({
      id: fc.oneof(fc.string(), fc.constant(undefined), fc.integer()),
      kind: fc.oneof(fc.constantFrom(...WIREFRAME_KIND_CATALOG.map(spec => spec.kind)), fc.string()),
      label: fc.oneof(fc.string(), fc.constant(undefined)),
      parentId: fc.oneof(fc.string(), fc.constant(undefined)),
      rect: fc.oneof(
        fc.record({
          x: fc.oneof(fc.double(), fc.constant(Number.NaN)),
          y: fc.oneof(fc.double(), fc.constant(Infinity)),
          width: fc.double(),
          height: fc.double(),
        }),
        fc.constant(undefined),
        fc.string(),
      ),
      designPrompt: fc.oneof(fc.string(), fc.constant(undefined)),
      notes: fc.oneof(fc.string(), fc.constant(undefined)),
    }, { requiredKeys: [] });

    it('never throws and never yields an off-canvas or non-finite rect', () => {
      fc.assert(fc.property(fc.array(arbitraryElement, { maxLength: 30 }), elements => {
        const result = sanitizeWireframe({ elements });
        if (!result) { return true; }
        for (const item of result.elements) {
          const { x, y, width, height } = item.rect;
          for (const value of [x, y, width, height]) {
            if (!Number.isFinite(value)) { return false; }
          }
          if (x < 0 || y < 0) { return false; }
          if (x + width > WIREFRAME_CANVAS_WIDTH + 0.01) { return false; }
          if (y + height > WIREFRAME_CANVAS_HEIGHT + 0.01) { return false; }
        }
        return true;
      }), { numRuns: 250 });
    });

    it('never yields a parent cycle', () => {
      fc.assert(fc.property(fc.array(arbitraryElement, { maxLength: 20 }), elements => {
        const result = sanitizeWireframe({ elements });
        if (!result) { return true; }
        return result.elements.every(item => !reachesItself(result, item.id));
      }), { numRuns: 250 });
    });

    it('never yields a parent id that is not present', () => {
      fc.assert(fc.property(fc.array(arbitraryElement, { maxLength: 20 }), elements => {
        const result = sanitizeWireframe({ elements });
        if (!result) { return true; }
        const ids = new Set(result.elements.map(item => item.id));
        return result.elements.every(item => item.parentId === undefined || ids.has(item.parentId));
      }), { numRuns: 250 });
    });
  });

  describe('orderedWireframeElements', () => {
    it('puts parents before their children', () => {
      const wireframe = sanitizeWireframe({
        elements: [
          element('card', { kind: 'card', parentId: 'grid', rect: { x: 0, y: 10, width: 300, height: 100 } }),
          element('grid', { kind: 'grid', rect: { x: 0, y: 0, width: 900, height: 400 } }),
        ],
      })!;
      const order = orderedWireframeElements(wireframe).map(item => item.id);
      expect(order.indexOf('grid')).toBeLessThan(order.indexOf('card'));
    });

    it('is stable for elements sharing a position', () => {
      // Without the id tie-break the canvas reshuffles between renders and
      // selection lands on a different element than the one clicked.
      const build = (): WebsiteWireframe => sanitizeWireframe({
        elements: [
          element('zzz', { rect: { x: 10, y: 10, width: 200, height: 100 } }),
          element('aaa', { rect: { x: 10, y: 10, width: 200, height: 100 } }),
        ],
      })!;
      expect(orderedWireframeElements(build()).map(item => item.id))
        .toEqual(orderedWireframeElements(build()).map(item => item.id));
      expect(orderedWireframeElements(build())[0]?.id).toBe('aaa');
    });
  });

  describe('deriveSectionLabels', () => {
    it('lists only top-level labels, top to bottom', () => {
      const wireframe = sanitizeWireframe({
        elements: [
          element('hero', { kind: 'hero', label: 'Hero', rect: { x: 0, y: 0, width: 1000, height: 300 } }),
          element('grid', { kind: 'grid', label: 'Services', rect: { x: 0, y: 320, width: 1000, height: 300 } }),
          element('card', { kind: 'card', label: 'One service', parentId: 'grid', rect: { x: 10, y: 330, width: 300, height: 200 } }),
        ],
      })!;
      expect(deriveSectionLabels(wireframe)).toEqual(['Hero', 'Services']);
    });
  });

  describe('wireframeFromSections', () => {
    it('stacks the sections in order without overlapping', () => {
      const wireframe = wireframeFromSections(['Nav', 'Hero band', 'Services', 'Footer']);
      expect(wireframe.elements.map(item => item.label)).toEqual(['Nav', 'Hero band', 'Services', 'Footer']);
      const sorted = [...wireframe.elements].sort((a, b) => a.rect.y - b.rect.y);
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1]!;
        expect(sorted[index]!.rect.y).toBeGreaterThanOrEqual(previous.rect.y);
      }
    });

    it('reads obvious structural words but leaves anything else a plain section', () => {
      const wireframe = wireframeFromSections(['Main navigation', 'Some copy about us', 'Footer']);
      expect(wireframe.elements[0]?.kind).toBe('nav');
      expect(wireframe.elements[1]?.kind).toBe('section');
      expect(wireframe.elements[2]?.kind).toBe('footer');
    });

    it('drops blanks and survives an empty list', () => {
      expect(wireframeFromSections(['', '   ']).elements).toHaveLength(0);
      expect(wireframeFromSections([]).elements).toHaveLength(0);
    });

    it('produces a wireframe the sanitizer accepts unchanged in shape', () => {
      const built = wireframeFromSections(['Nav', 'Hero', 'Footer']);
      const sanitized = sanitizeWireframe(built);
      expect(sanitized?.elements).toHaveLength(built.elements.length);
    });
  });

  describe('the kind catalog', () => {
    it('marks nav, cta and footer as the link sources, and nothing else', () => {
      const sources = WIREFRAME_KIND_CATALOG.filter(spec => spec.linkSource).map(spec => spec.kind);
      expect(sources.sort()).toEqual(['cta', 'footer', 'nav']);
      expect(isLinkSourceKind('hero')).toBe(false);
      expect(isLinkSourceKind('nav')).toBe(true);
    });

    it('gives every kind a default that fits the canvas', () => {
      for (const spec of WIREFRAME_KIND_CATALOG) {
        expect(spec.defaultWidth).toBeGreaterThan(0);
        expect(spec.defaultWidth).toBeLessThanOrEqual(WIREFRAME_CANVAS_WIDTH);
        expect(spec.defaultHeight).toBeGreaterThan(0);
      }
    });
  });

  it('emptyWireframe is a usable empty canvas', () => {
    expect(emptyWireframe().elements).toEqual([]);
    expect(emptyWireframe('mobile').breakpoint).toBe('mobile');
  });
});

/** Walk up from an element and report whether it reaches itself. */
function reachesItself(wireframe: WebsiteWireframe, id: string): boolean {
  const byId = new Map(wireframe.elements.map(item => [item.id, item]));
  const seen = new Set<string>();
  let cursor = byId.get(id)?.parentId;
  let steps = 0;
  while (cursor && steps < 100) {
    if (cursor === id) { return true; }
    if (seen.has(cursor)) { return false; }
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId;
    steps += 1;
  }
  return false;
}
