import { describe, expect, it } from 'vitest';
import {
  CONTRADICTIONS_PATH,
  PRODUCT_FACTS_PATH,
  buildContradictionsStarter,
  buildDefaultMaintainedPagesSection,
  buildMaintainedPagesSection,
  buildProductFactsStarter,
  describeVersionDrift,
  parseMaintainedPages,
  parseOpenContradictions,
} from '../../src/bootstrap/maintainedPages.ts';

describe('parseMaintainedPages', () => {
  it('reads the shapes people actually write', () => {
    const soul = [
      '# Soul',
      '',
      '## Maintained Pages',
      '- decisions/the-user-rulings.md — rulings, newest first',
      '- `architecture/tier-system.md` — tiers',
      '* [Combat](architecture/combat-ai.md) — combat',
      '- project_memory/product/capabilities.md — product facts',
      '',
      '## Imported References',
      '- architecture/project-overview.md',
    ].join('\n');

    expect([...parseMaintainedPages(soul)].sort()).toEqual([
      'architecture/combat-ai.md',
      'architecture/tier-system.md',
      'decisions/the-user-rulings.md',
      'product/capabilities.md',
    ]);
  });

  it('stops at the next section, so imported references are not claimed', () => {
    const soul = '## Maintained Pages\n- a.md\n\n## Imported References\n- b.md\n';
    expect(parseMaintainedPages(soul).has('b.md')).toBe(false);
  });

  it('ignores paths that escape the memory root or are not files', () => {
    const soul = '## Maintained Pages\n- ../secrets.md\n- C:/elsewhere/x.md\n- just prose here\n- ok.md\n';
    expect([...parseMaintainedPages(soul)]).toEqual(['ok.md']);
  });

  it('returns nothing for a soul without the section', () => {
    expect(parseMaintainedPages('# Soul\n\n## Vision\nx\n').size).toBe(0);
    expect(parseMaintainedPages(undefined).size).toBe(0);
  });

  it('strips a configured memory root', () => {
    expect([...parseMaintainedPages('## Maintained Pages\n- memory/x.md\n', 'memory')]).toEqual(['x.md']);
  });
});

describe('maintained pages section', () => {
  it('lists the scaffolded product-facts page by default, and that list parses back', () => {
    const section = buildDefaultMaintainedPagesSection();
    expect(section.startsWith('## Maintained Pages')).toBe(true);
    expect([...parseMaintainedPages(section)]).toEqual([PRODUCT_FACTS_PATH, CONTRADICTIONS_PATH]);
  });

  it("carries a project's own list over verbatim when the soul is rewritten", () => {
    const soul = '# Soul\n\n## Maintained Pages\n- decisions/rulings.md — mine\n\n## Vision\nx\n';
    expect(buildMaintainedPagesSection(soul)).toBe('## Maintained Pages\n- decisions/rulings.md — mine');
  });

  it('falls back to the default when the soul has none', () => {
    expect(buildMaintainedPagesSection('# Soul\n')).toBe(buildDefaultMaintainedPagesSection());
  });
});

describe('product-facts starter', () => {
  it('says it is maintained and carries no import footer', () => {
    const starter = buildProductFactsStarter();
    expect(starter).toContain('Maintained page');
    expect(starter).not.toContain('atlasmind-import');
  });
});

describe('describeVersionDrift', () => {
  it('names both versions when they differ', () => {
    expect(describeVersionDrift('0.10.483', '0.11.2')).toBe('generated from version 0.10.483; the manifest is now at 0.11.2');
  });

  it('makes no claim when a version is unknown or unchanged', () => {
    expect(describeVersionDrift(undefined, '1.0.0')).toBeUndefined();
    expect(describeVersionDrift('1.0.0', undefined)).toBeUndefined();
    expect(describeVersionDrift('1.0.0', '1.0.0')).toBeUndefined();
  });
});

describe('parseOpenContradictions', () => {
  it('starts empty: the format example in the starter is not an entry', () => {
    expect(parseOpenContradictions(buildContradictionsStarter())).toEqual([]);
  });

  it('lists unticked entries and ignores ticked, resolved, fenced and commented ones', () => {
    const log = [
      '# Contradictions',
      '',
      '```',
      '- [ ] example in a fence',
      '```',
      '<!-- - [ ] example in a comment -->',
      '',
      '## Open',
      '- [ ] 2026-11-02 — free-tier world limit — `product/capabilities.md` says 3; `src/tiers.ts` says 5 — needs a ruling — found by Claude Code',
      '- [x] 2026-11-01 — ticked but not yet moved',
      '',
      '## Resolved',
      '- [ ] left unticked under Resolved',
    ].join('\n');
    expect(parseOpenContradictions(log)).toEqual([
      '2026-11-02 — free-tier world limit — `product/capabilities.md` says 3; `src/tiers.ts` says 5 — needs a ruling — found by Claude Code',
    ]);
  });

  it('returns nothing for a missing log', () => {
    expect(parseOpenContradictions(undefined)).toEqual([]);
  });
});
