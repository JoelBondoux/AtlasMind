import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildShopifyProjectComposition,
  deriveProjectTopologies,
  normalizeComponentLocation,
  sanitizeProjectComposition,
  selectEffectiveProjectComposition,
  validateProjectComposition,
  type ProjectComposition,
} from '../../src/core/projectComposition.ts';

const fixture = JSON.parse(readFileSync(path.resolve(
  process.cwd(),
  'tests/fixtures/game-engines/composite/home/project_memory/operations/workflow.json',
), 'utf8')) as { composition: unknown };

const declared = (): ProjectComposition => sanitizeProjectComposition(fixture.composition)!;

describe('sanitizeProjectComposition', () => {
  it('reads the composite fixture and preserves its declared order', () => {
    const composition = declared();
    expect(composition.components.map(component => component.id)).toEqual(['gameplay', 'backend', 'content']);
    expect(composition.components.find(component => component.home)?.id).toBe('gameplay');
  });

  it('is total and refuses an incomplete declaration rather than dropping one component', () => {
    expect(() => sanitizeProjectComposition({ components: [null] })).not.toThrow();
    expect(sanitizeProjectComposition({ components: [null] })).toBeUndefined();
    expect(sanitizeProjectComposition({ components: [] })).toBeUndefined();
  });

  it('requires exactly one home and unique component ids', () => {
    const raw = fixture.composition as { components: Array<Record<string, unknown>> };
    expect(sanitizeProjectComposition({ components: raw.components.map(component => ({ ...component, home: false })) }))
      .toBeUndefined();
    expect(sanitizeProjectComposition({ components: raw.components.map(component => ({ ...component, home: true })) }))
      .toBeUndefined();
    expect(sanitizeProjectComposition({ components: [raw.components[0], { ...raw.components[1], id: 'gameplay' }] }))
      .toBeUndefined();
  });

  it('preserves unknown composition, component, and upstream fields through extra', () => {
    const base = declared();
    const raw = {
      futureComposition: { enabled: true },
      components: base.components.map((component, index) => ({
        ...component,
        ...(index === 0 ? {
          futureComponent: 7,
          archetype: { ...component.archetype, futureArchetype: 'kept' },
          upstream: { remote: 'origin', ref: 'main', futureUpstream: 'kept' },
        } : {}),
      })),
    };
    const composition = sanitizeProjectComposition(raw)!;
    expect(composition.extra).toEqual({ futureComposition: { enabled: true } });
    expect(composition.components[0]?.extra).toEqual({ futureComponent: 7 });
    expect(composition.components[0]?.archetype.extra).toEqual({ futureArchetype: 'kept' });
    expect(composition.components[0]?.upstream?.extra).toEqual({ futureUpstream: 'kept' });
  });

  it('keeps an own __proto__ field as data without changing an object prototype', () => {
    const raw = JSON.parse(JSON.stringify(fixture.composition).replace(
      '"components":', '"__proto__":{"polluted":true},"components":',
    )) as unknown;
    const composition = sanitizeProjectComposition(raw)!;
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(Object.prototype.hasOwnProperty.call(composition.extra, '__proto__')).toBe(true);
    expect(composition.extra?.['__proto__']).toEqual({ polluted: true });
  });

  it('accepts portable locations and refuses absolute or traversing ones', () => {
    expect(normalizeComponentLocation('.')).toBe('.');
    expect(normalizeComponentLocation('packages\\gameplay')).toBe('packages/gameplay');
    expect(normalizeComponentLocation('../outside')).toBeUndefined();
    expect(normalizeComponentLocation('C:\\machine-only')).toBeUndefined();
    expect(normalizeComponentLocation('/machine-only')).toBeUndefined();
  });
});

describe('composition policy', () => {
  it('expresses a Shopify theme, app, and extension without game-specific fields', () => {
    const composition = buildShopifyProjectComposition(['extension', 'theme', 'app'])!;

    expect(composition.components.map(component => component.id)).toEqual([
      'shopify-theme',
      'shopify-app',
      'shopify-extension',
    ]);
    expect(composition.components.map(component => component.location)).toEqual(['theme', '.', 'extensions']);
    expect(composition.components.filter(component => component.home).map(component => component.id))
      .toEqual(['shopify-app']);
    expect(composition.components.map(component => component.archetype.archetype))
      .toEqual(['website', 'web-app', 'library']);
    expect(JSON.stringify(composition)).not.toMatch(/game|engine/iu);
    expect(sanitizeProjectComposition(composition)).toEqual(composition);
  });

  it('uses the only selected Shopify shape as home and refuses an empty selection', () => {
    expect(buildShopifyProjectComposition(['extension', 'extension'])?.components).toEqual([
      expect.objectContaining({ id: 'shopify-extension', location: '.', home: true }),
    ]);
    expect(buildShopifyProjectComposition([])).toBeUndefined();
  });

  it('derives every applicable topology and stores none of them', () => {
    const composition = declared();
    expect(deriveProjectTopologies(composition, { workspaceFolderCount: 3, gitRootCount: 2 }))
      .toEqual(['multi-repo', 'multi-root', 'hybrid']);
    expect(composition).not.toHaveProperty('topology');
  });

  it('does not infer a topology from evidence the caller did not gather', () => {
    const composition = declared();
    expect(deriveProjectTopologies(composition)).toEqual(['hybrid']);
  });

  it('reports an unresolved component but never removes it', () => {
    const composition = declared();
    const problems = validateProjectComposition(composition, { workspaceLocations: ['home', 'backend'] });
    expect(problems).toContainEqual(expect.objectContaining({ componentId: 'content', kind: 'unresolved-location' }));
    expect(composition.components.map(component => component.id)).toContain('content');
  });

  it('reports unreadable and unknown as unknown rather than clean or empty', () => {
    const composition = declared();
    composition.components[0]!.vcs = 'unknown';
    const problems = validateProjectComposition(composition, {
      workspaceLocations: ['home', 'backend', 'content'],
      unreadableLocations: ['home'],
    });
    expect(problems).toContainEqual(expect.objectContaining({ componentId: 'gameplay', kind: 'unreadable-location' }));
    expect(problems).toContainEqual(expect.objectContaining({ componentId: 'gameplay', kind: 'unknown-vcs' }));
    expect(problems.map(problem => problem.detail).join(' ')).toMatch(/unknown/i);
  });

  it('keeps a detector proposal separate until somebody declares it', () => {
    const proposal = declared();
    const fallback = sanitizeProjectComposition({
      components: [{
        id: 'workspace', label: 'Workspace', location: '.', role: 'application',
        archetype: { archetype: 'generic', traits: [] }, vcs: 'unknown', home: true,
      }],
    })!;
    const unresolved = selectEffectiveProjectComposition(undefined, fallback, proposal);
    expect(unresolved).toMatchObject({ effective: fallback, source: 'fallback', proposal });
    expect(unresolved.effective).not.toBe(proposal);

    const resolved = selectEffectiveProjectComposition(proposal, fallback);
    expect(resolved).toMatchObject({ effective: proposal, source: 'declared' });
  });
});
