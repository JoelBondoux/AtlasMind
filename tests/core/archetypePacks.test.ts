import { describe, expect, it } from 'vitest';
import {
  allArchetypePacks,
  archetypePack,
  resolveArchetypePack,
  traitAdditions,
} from '../../src/core/archetypePacks.ts';
import {
  ARCHETYPE_TRAITS,
  PROJECT_ARCHETYPES,
  type ProjectArchetype,
} from '../../src/core/projectArchetype.ts';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../../src/types.ts';

const KNOWN_METHODOLOGIES = new Set(TESTING_METHODOLOGY_DEFINITIONS.map(def => def.id));

describe('every archetype has a complete pack', () => {
  it.each(PROJECT_ARCHETYPES)('%s has a pack', archetype => {
    const pack = archetypePack(archetype);
    expect(pack.archetype).toBe(archetype);
    expect(pack.label.length).toBeGreaterThan(2);
    expect(pack.blurb.length).toBeGreaterThan(30);
  });

  it('covers all six axes for every archetype', () => {
    // The six the specialisation exists for. A pack missing one silently makes
    // that axis generic for that shape.
    for (const pack of allArchetypePacks()) {
      expect(pack.ci.length, `${pack.archetype} ci`).toBeGreaterThan(0);
      expect(pack.release.channel.length, `${pack.archetype} release`).toBeGreaterThan(0);
      expect(pack.testing.recommended.length, `${pack.archetype} testing`).toBeGreaterThan(0);
      expect(pack.documentation.length, `${pack.archetype} docs`).toBeGreaterThan(0);
      expect(pack.intelligence.watchPaths.length, `${pack.archetype} intelligence`).toBeGreaterThan(0);
      // `refactor` is allowed to be empty only for `generic`, which declines to
      // guess rather than having nothing to say.
      if (pack.archetype !== 'generic') {
        expect(pack.refactor.length, `${pack.archetype} refactor`).toBeGreaterThan(0);
      }
    }
  });

  it('gives every recommendation a rationale, so it can be judged', () => {
    for (const pack of allArchetypePacks()) {
      expect(pack.testing.rationale.length, pack.archetype).toBeGreaterThan(40);
      for (const step of pack.ci) {
        expect(step.rationale.length, `${pack.archetype}/${step.id}`).toBeGreaterThan(30);
      }
      for (const doc of pack.documentation) {
        expect(doc.why.length, `${pack.archetype}/${doc.path}`).toBeGreaterThan(20);
      }
      for (const item of pack.refactor) {
        expect(item.detail.length, `${pack.archetype}/${item.id}`).toBeGreaterThan(30);
      }
    }
  });
});

describe('recommendations are things the archetype can actually produce', () => {
  it('names only real testing methodologies', () => {
    // A recommendation for a methodology that does not exist would create a gap
    // nobody could ever close.
    for (const pack of allArchetypePacks()) {
      for (const id of [...pack.testing.recommended, ...pack.testing.discouraged]) {
        expect(KNOWN_METHODOLOGIES.has(id), `${pack.archetype}: ${id}`).toBe(true);
      }
    }
  });

  it('never recommends and discourages the same methodology', () => {
    for (const pack of allArchetypePacks()) {
      const overlap = pack.testing.recommended.filter(id => pack.testing.discouraged.includes(id));
      expect(overlap, pack.archetype).toEqual([]);
    }
  });

  it('explains every discouragement', () => {
    // "Do not enable this" without a reason is indistinguishable from an
    // oversight, and somebody will enable it anyway.
    for (const pack of allArchetypePacks()) {
      if (pack.testing.discouraged.length > 0) {
        expect(pack.testing.discouragedReason?.length ?? 0, pack.archetype).toBeGreaterThan(40);
      }
    }
  });

  it('discourages visual testing where there is nothing to look at', () => {
    // The concrete case of the rule: an unclosable gap teaches people to ignore
    // gaps, which is worse than having no recommendation at all.
    expect(archetypePack('api').testing.discouraged).toContain('visual');
    expect(archetypePack('cli').testing.discouraged).toContain('visual');
    expect(archetypePack('library').testing.discouraged).toContain('visual');
  });
});

describe('the shapes really do differ', () => {
  it('gives games a frame budget and libraries an API surface check', () => {
    expect(archetypePack('game').ci.map(s => s.id)).toContain('perf-budget');
    expect(archetypePack('library').ci.map(s => s.id)).toContain('api-surface');
    expect(archetypePack('website').ci.map(s => s.id)).toContain('link-check');
    expect(archetypePack('api').ci.map(s => s.id)).toContain('contract');
    expect(archetypePack('cli').ci.map(s => s.id)).toContain('cross-platform');
  });

  it('recommends mutation testing for libraries and not for websites', () => {
    // A library's tests are its specification, so a surviving mutant is a
    // promise nothing enforces. A content site has too little logic to measure.
    expect(archetypePack('library').testing.recommended).toContain('mutation');
    expect(archetypePack('website').testing.discouraged).toContain('mutation');
  });

  it('gives each shape a distinct release channel', () => {
    const channels = allArchetypePacks()
      .filter(pack => pack.archetype !== 'generic')
      .map(pack => pack.release.channel);
    expect(new Set(channels).size).toBeGreaterThan(3);
  });

  it('gives each shape its own notion of a hotspot', () => {
    // The point of archetype-aware intelligence: "most frequently changed" is
    // the wrong answer for a game and for an API, in different ways.
    expect(archetypePack('game').intelligence.hotspotNote).toContain('per-frame');
    expect(archetypePack('library').intelligence.hotspotNote).toContain('public entry point');
    expect(archetypePack('api').intelligence.hotspotNote).toContain('endpoint');
  });
});

describe('generic declines to guess rather than having nothing', () => {
  it('keeps only the universally applicable expectations', () => {
    const pack = archetypePack('generic');
    expect(pack.testing.recommended).toEqual(['unit']);
    expect(pack.refactor).toEqual([]);
    expect(pack.release.channel).toBe('Not declared');
  });

  it('still expects a changelog, which applies to every shape', () => {
    expect(archetypePack('generic').documentation.map(d => d.path)).toContain('CHANGELOG.md');
  });
});

describe('traits add without contradicting', () => {
  it.each(ARCHETYPE_TRAITS)('%s produces well-formed additions', trait => {
    const additions = traitAdditions(trait);
    for (const step of additions.ci) {
      expect(step.rationale.length, `${trait}/${step.id}`).toBeGreaterThan(30);
    }
    for (const doc of additions.documentation) {
      expect(doc.why.length, `${trait}/${doc.path}`).toBeGreaterThan(20);
    }
  });

  it('merges trait steps into the archetype pack', () => {
    const resolved = resolveArchetypePack('library', ['is-published-package']);
    expect(resolved.ci.map(s => s.id)).toContain('publish-dry-run');
    expect(resolved.ci.map(s => s.id)).toContain('api-surface');
  });

  it('does not duplicate a step the archetype already declares', () => {
    // `desktop` already carries an unsigned-artifact heuristic; the
    // ships-binaries trait must not add a second copy.
    const resolved = resolveArchetypePack('desktop', ['ships-binaries']);
    const ids = resolved.refactor.map(item => item.id);
    expect(ids.filter(id => id === 'unsigned-artifact').length).toBe(1);
  });

  it('keeps the archetype entry when a trait would collide', () => {
    // Archetype entries come first, so a trait cannot silently replace a
    // specific expectation with a weaker generic one.
    const base = archetypePack('desktop').refactor.find(item => item.id === 'unsigned-artifact');
    const resolved = resolveArchetypePack('desktop', ['ships-binaries']);
    expect(resolved.refactor.find(item => item.id === 'unsigned-artifact')).toEqual(base);
  });

  it('is unchanged when no traits apply', () => {
    expect(resolveArchetypePack('cli', [])).toEqual(archetypePack('cli'));
  });

  it('composes several traits', () => {
    const resolved = resolveArchetypePack('library', ['is-published-package', 'platform-hosted', 'has-native-build']);
    const ids = resolved.ci.map(s => s.id);
    expect(ids).toContain('publish-dry-run');
    expect(ids).toContain('platform-validate');
    expect(ids).toContain('toolchain-pin');
  });

  it('adds a privacy expectation only when personal data is involved', () => {
    const without = resolveArchetypePack('api', []);
    const with_ = resolveArchetypePack('api', ['handles-personal-data']);
    expect(without.documentation.map(d => d.path)).not.toContain('docs/privacy.md');
    expect(with_.documentation.map(d => d.path)).toContain('docs/privacy.md');
    expect(with_.ci.map(s => s.id)).toContain('secret-scan');
  });
});

describe('pack ids are stable and unique', () => {
  it('has no duplicate step ids within a pack', () => {
    for (const pack of allArchetypePacks()) {
      const ids = pack.ci.map(step => step.id);
      expect(new Set(ids).size, pack.archetype).toBe(ids.length);
    }
  });

  it('has no duplicate documentation paths within a pack', () => {
    for (const pack of allArchetypePacks()) {
      const paths = pack.documentation.map(doc => doc.path);
      expect(new Set(paths).size, pack.archetype).toBe(paths.length);
    }
  });

  it('resolves a pack for every archetype and trait combination without throwing', () => {
    for (const archetype of PROJECT_ARCHETYPES) {
      expect(() => resolveArchetypePack(archetype as ProjectArchetype, ARCHETYPE_TRAITS)).not.toThrow();
    }
  });
});
