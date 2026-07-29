import { describe, it, expect } from 'vitest';
import {
  DEBT_RULES,
  MAX_MARKERS_PER_FILE,
  scanForDebtMarkers,
  commentStartIndex,
  debtEntryId,
  reconcileDebtScan,
  setDebtStatus,
  sortDebtEntries,
  deriveDebtMetrics,
  sanitizeDebtRegister,
  normalizeEvidencePath,
  renderDebtMarkdown,
  type DebtRegister,
  type DebtScanCandidate,
} from '../../src/core/debtRegister';

const AT = '2026-07-29T12:00:00.000Z';
const LATER = '2026-08-29T12:00:00.000Z';
const EMPTY: DebtRegister = { version: 1, entries: [] };

const file = (path: string, content: string) => ({ path, content });

describe('the severity rules are declared, not decided', () => {
  it('grades a security marker high whatever marker was used', () => {
    // A security marker is never a medium. If that depended on which pattern
    // matched first, the table would be one nobody could reason about.
    const found = scanForDebtMarkers([file('src/a.ts', '// TODO: sanitize this input before use')]);
    expect(found[0].severity).toBe('high');
    expect(found[0].rule).toBe('security-marker');
    expect(found[0].domain).toBe('security');
  });

  it('ranks a broken marker above a missing one', () => {
    // A FIXME asserts something is *wrong*; a TODO asserts something is
    // *absent*. Broken beats missing — a real distinction, not folklore.
    expect(scanForDebtMarkers([file('a.ts', '// FIXME: this drops errors')])[0].severity).toBe('medium');
    expect(scanForDebtMarkers([file('a.ts', '// TODO: add a retry')])[0].severity).toBe('low');
    expect(scanForDebtMarkers([file('a.ts', '// HACK: works by accident')])[0].severity).toBe('medium');
  });

  it('names the rule on every entry so the grade can be argued with', () => {
    for (const found of scanForDebtMarkers([file('a.ts', '// TODO: x'), file('b.ts', '// XXX: y')])) {
      expect(DEBT_RULES.some(rule => rule.id === found.rule), found.rule).toBe(true);
    }
  });

  it('gives every rule a stated reason rather than a bare grade', () => {
    for (const rule of DEBT_RULES) {
      expect(rule.describes.length, rule.id).toBeGreaterThan(30);
    }
  });
});

describe('scanning', () => {
  it('does not treat a word containing a marker as debt', () => {
    // A register full of false positives is one people stop reading, which
    // costs more than the entries it would have caught.
    expect(scanForDebtMarkers([file('a.ts', 'const todoList = [];')])).toEqual([]);
    expect(scanForDebtMarkers([file('TODOS.md', 'Some prose about a todolist.')])).toEqual([]);
  });

  it('records the line, so the register points at evidence', () => {
    const found = scanForDebtMarkers([file('src/a.ts', 'one\ntwo\n// TODO: three')]);
    expect(found[0].evidenceLine).toBe(3);
    expect(found[0].evidencePath).toBe('src/a.ts');
  });

  it('skips a long line, which is minified or generated rather than deferred', () => {
    expect(scanForDebtMarkers([file('a.js', `${'x'.repeat(420)} // TODO: y`)])).toEqual([]);
  });

  it('caps what one file can contribute', () => {
    const content = Array.from({ length: 100 }, (_, i) => `// TODO: item ${i}`).join('\n');
    expect(scanForDebtMarkers([file('a.ts', content)])).toHaveLength(MAX_MARKERS_PER_FILE);
  });

  it('keeps the note but clamps it', () => {
    const found = scanForDebtMarkers([file('a.ts', `// TODO: ${'x'.repeat(300)}`)]);
    expect(found[0].title.length).toBeLessThanOrEqual(130);
    expect(found[0].title.startsWith('TODO: ')).toBe(true);
  });
});

describe('entry ids are stable, which is what makes a rescan recognise rather than duplicate', () => {
  const candidate = (line: number): DebtScanCandidate => ({
    domain: 'code', title: 'TODO: add a retry', evidencePath: 'src/a.ts',
    evidenceLine: line, severity: 'low', rule: 'todo-marker',
  });

  it('does not change when the code moves down the file', () => {
    // An entry that got a new id every time somebody added an import above it
    // would lose its whole history on a whitespace change.
    expect(debtEntryId(candidate(10))).toBe(debtEntryId(candidate(200)));
  });

  it('differs for a different file or a different marker', () => {
    expect(debtEntryId({ ...candidate(1), evidencePath: 'src/b.ts' })).not.toBe(debtEntryId(candidate(1)));
    expect(debtEntryId({ ...candidate(1), title: 'TODO: something else' })).not.toBe(debtEntryId(candidate(1)));
  });
});

describe('reconciling a scan', () => {
  const scan = (content: string) => scanForDebtMarkers([file('src/a.ts', content)]);

  it('adds what is new and recognises what it has seen', () => {
    const first = reconcileDebtScan(EMPTY, scan('// TODO: retry'), ['src/a.ts'], AT);
    expect(first.added).toHaveLength(1);
    const second = reconcileDebtScan(first.register, scan('// TODO: retry'), ['src/a.ts'], LATER);
    expect(second.added).toEqual([]);
    expect(second.unchanged).toBe(1);
    expect(second.register.entries).toHaveLength(1);
  });

  it('keeps the original detection date when an entry persists', () => {
    // Otherwise every rescan resets the clock and nothing ever ages.
    const first = reconcileDebtScan(EMPTY, scan('// TODO: retry'), ['src/a.ts'], AT);
    const second = reconcileDebtScan(first.register, scan('\n\n// TODO: retry'), ['src/a.ts'], LATER);
    expect(second.register.entries[0].detectedAt).toBe(AT);
    expect(second.register.entries[0].evidenceLine).toBe(3);
  });

  it('marks vanished evidence obsolete, never resolved', () => {
    // "The line is gone" and "somebody did the work" are different facts, and a
    // register that inferred accomplishment would report progress it cannot
    // attest to.
    const first = reconcileDebtScan(EMPTY, scan('// TODO: retry'), ['src/a.ts'], AT);
    const second = reconcileDebtScan(first.register, [], ['src/a.ts'], LATER);
    expect(second.wentObsolete).toHaveLength(1);
    expect(second.register.entries[0].status).toBe('obsolete');
    expect(second.register.entries[0].transitions[0].note).toMatch(/not marked resolved/);
  });

  it('never deletes an entry', () => {
    const first = reconcileDebtScan(EMPTY, scan('// TODO: retry'), ['src/a.ts'], AT);
    const second = reconcileDebtScan(first.register, [], ['src/a.ts'], LATER);
    expect(second.register.entries).toHaveLength(1);
  });

  it('leaves entries alone when their file was not scanned', () => {
    // A scan of `src/` must never mark everything in `docs/` as gone.
    const first = reconcileDebtScan(EMPTY, scan('// TODO: retry'), ['src/a.ts'], AT);
    const second = reconcileDebtScan(first.register, [], ['docs/other.md'], LATER);
    expect(second.wentObsolete).toEqual([]);
    expect(second.register.entries[0].status).toBe('open');
  });

  it('reopens a resolved entry whose evidence came back, and records it', () => {
    // Work that came undone is one of the more useful things a register can
    // tell you, so it is a recorded transition rather than a silent revert.
    const first = reconcileDebtScan(EMPTY, scan('// TODO: retry'), ['src/a.ts'], AT);
    const resolved = setDebtStatus(first.register, first.added[0].id, 'resolved', AT, 'Fixed it');
    const again = reconcileDebtScan(resolved, scan('// TODO: retry'), ['src/a.ts'], LATER);
    expect(again.reopened).toHaveLength(1);
    expect(again.register.entries[0].status).toBe('open');
    expect(again.register.entries[0].transitions.map(t => t.to)).toEqual(['resolved', 'open']);
  });
});

describe('transitions', () => {
  it('records every status change in order', () => {
    const first = reconcileDebtScan(EMPTY, scanForDebtMarkers([file('a.ts', '// TODO: x')]), ['a.ts'], AT);
    const id = first.added[0].id;
    let register = setDebtStatus(first.register, id, 'accepted', AT, 'Shipping anyway');
    register = setDebtStatus(register, id, 'resolved', LATER);
    expect(register.entries[0].transitions.map(t => `${t.from}->${t.to}`))
      .toEqual(['open->accepted', 'accepted->resolved']);
  });

  it('does not record a transition to the status it already has', () => {
    const first = reconcileDebtScan(EMPTY, scanForDebtMarkers([file('a.ts', '// TODO: x')]), ['a.ts'], AT);
    const register = setDebtStatus(first.register, first.added[0].id, 'open', LATER);
    expect(register.entries[0].transitions).toEqual([]);
  });
});

describe('sorting is stable and total', () => {
  it('orders by severity, then oldest, then id', () => {
    const entry = (id: string, severity: 'low' | 'medium' | 'high', detectedAt: string) => ({
      id, domain: 'code' as const, title: id, evidencePath: 'a.ts',
      detectedAt, severity, rule: 'todo-marker', status: 'open' as const, transitions: [],
    });
    const sorted = sortDebtEntries([
      entry('c', 'low', AT), entry('a', 'high', LATER), entry('b', 'high', AT),
    ]);
    expect(sorted.map(e => e.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('metrics', () => {
  const now = Date.parse('2026-09-29T12:00:00.000Z');

  it('counts only open work as open', () => {
    const first = reconcileDebtScan(EMPTY, scanForDebtMarkers([
      file('a.ts', '// TODO: x'), file('b.ts', '// FIXME: y'),
    ]), ['a.ts', 'b.ts'], AT);
    const register = setDebtStatus(first.register, first.added[0].id, 'resolved', LATER);
    const metrics = deriveDebtMetrics(register, now);
    expect(metrics.total).toBe(2);
    expect(metrics.open).toBe(1);
    expect(metrics.resolved).toBe(1);
  });

  it('reports no median age for an empty register rather than zero', () => {
    // Zero days would read as "everything is fresh", which is the opposite of
    // "there is nothing here".
    expect(deriveDebtMetrics(EMPTY, now).medianAgeDays).toBeUndefined();
  });

  it('ages entries into declared buckets', () => {
    const first = reconcileDebtScan(EMPTY, scanForDebtMarkers([file('a.ts', '// TODO: x')]), ['a.ts'], AT);
    const buckets = deriveDebtMetrics(first.register, now).ageDistribution;
    expect(buckets.find(bucket => bucket.key === '31-90')?.value).toBe(1);
  });
});

describe('reading a register a human may have edited', () => {
  it('is total', () => {
    expect(sanitizeDebtRegister(undefined).entries).toEqual([]);
    expect(sanitizeDebtRegister('nonsense').entries).toEqual([]);
    expect(sanitizeDebtRegister({ entries: 'no' }).entries).toEqual([]);
  });

  it('drops a fragment rather than inventing a record', () => {
    expect(sanitizeDebtRegister({ entries: [{ id: 'x' }] }).entries).toEqual([]);
  });

  it('reads an unrecognised severity as low, never as high', () => {
    // A register that inflated on a typo would train people to discount it.
    const register = sanitizeDebtRegister({
      entries: [{ id: 'x', evidencePath: 'a.ts', detectedAt: AT, severity: 'CRITICAL!!' }],
    });
    expect(register.entries[0].severity).toBe('low');
  });

  it('reads an unrecognised status as open, keeping work visible', () => {
    const register = sanitizeDebtRegister({
      entries: [{ id: 'x', evidencePath: 'a.ts', detectedAt: AT, status: 'done-ish' }],
    });
    expect(register.entries[0].status).toBe('open');
  });

  it('rejects a path that escapes the workspace rather than normalising it', () => {
    // This value becomes a link somebody clicks. Rewriting it would point at a
    // different file than the one that was recorded.
    expect(normalizeEvidencePath('../../etc/passwd')).toBe('');
    expect(normalizeEvidencePath('/etc/passwd')).toBe('');
    expect(normalizeEvidencePath('C:/Windows/System32')).toBe('');
    expect(normalizeEvidencePath('src/a.ts')).toBe('src/a.ts');
    expect(normalizeEvidencePath('src\\a.ts')).toBe('src/a.ts');
  });

  it('round-trips a real register', () => {
    const first = reconcileDebtScan(EMPTY, scanForDebtMarkers([file('a.ts', '// TODO: x')]), ['a.ts'], AT);
    expect(sanitizeDebtRegister(JSON.parse(JSON.stringify(first.register)))).toEqual(first.register);
  });
});

describe('the mirror', () => {
  it('is deterministic', () => {
    const first = reconcileDebtScan(EMPTY, scanForDebtMarkers([file('a.ts', '// TODO: x')]), ['a.ts'], AT);
    expect(renderDebtMarkdown(first.register)).toBe(renderDebtMarkdown(first.register));
  });

  it('says an empty register means nothing was found or scanned, not that no debt exists', () => {
    expect(renderDebtMarkdown(EMPTY)).toMatch(/not that no debt exists/);
    expect(renderDebtMarkdown(EMPTY)).toMatch(/Never scanned/);
  });

  it('explains that severity does not drift with age', () => {
    expect(renderDebtMarkdown(EMPTY)).toMatch(/does \*\*not\*\*[\s\S]{0,40}drift with age/);
  });

  it('publishes the rule table, so a grade can be checked against it', () => {
    const markdown = renderDebtMarkdown(EMPTY);
    for (const rule of DEBT_RULES) {
      expect(markdown, rule.id).toContain(rule.id);
    }
  });

  it('distinguishes resolved from obsolete where both appear', () => {
    const first = reconcileDebtScan(EMPTY, scanForDebtMarkers([file('a.ts', '// TODO: x')]), ['a.ts'], AT);
    const resolved = setDebtStatus(first.register, first.added[0].id, 'resolved', LATER);
    expect(renderDebtMarkdown(resolved)).toMatch(/only one of them[\s\S]{0,30}is an accomplishment/);
  });
});

/**
 * These were learned by running the scanner over the repository that contains
 * it, which promptly reported its own rule table, its own tests, and the
 * dashboard copy describing the feature as technical debt — 29 entries, every
 * one of them false. A register full of those is one people stop reading, which
 * costs more than the entries it would have caught.
 */
describe('a marker only counts when it opens a comment', () => {
  it('ignores a marker inside a string literal', () => {
    // A test fixture containing '// TODO: x' is data, not a deferred decision.
    expect(scanForDebtMarkers([file('a.test.ts', `expect(scan('// TODO: fix')).toEqual([]);`)])).toEqual([]);
    expect(scanForDebtMarkers([file('a.ts', `const s = "// FIXME: nope";`)])).toEqual([]);
  });

  it('ignores a marker inside a template literal', () => {
    expect(scanForDebtMarkers([file('a.js', 'const html = `<code>TODO</code>`;')])).toEqual([]);
  });

  it('ignores a marker inside a regex literal', () => {
    expect(scanForDebtMarkers([file('a.ts', 'const P = /\b(TODO|FIXME)\b/;')])).toEqual([]);
  });

  it('ignores a marker being discussed rather than declared', () => {
    // "a FIXME asserts that something is wrong" is documentation. Real markers
    // are written at the start of the comment.
    expect(scanForDebtMarkers([file('a.ts', ' * A `FIXME` asserts that something is wrong.')])).toEqual([]);
    expect(scanForDebtMarkers([file('a.ts', '// These assert that a TODO is absent rather than broken.')])).toEqual([]);
  });

  it('still catches a marker written the way people write them', () => {
    const shapes = [
      '// TODO: add a retry',
      '  // FIXME(bob): drops errors',
      '/* HACK: works by accident */',
      '   * XXX: revisit this',
      '# TODO: python style',
      '<!-- TODO: html style -->',
    ];
    for (const shape of shapes) {
      expect(scanForDebtMarkers([file('a.ts', shape)]), shape).toHaveLength(1);
    }
  });

  it('is not confused by a comment delimiter inside a string', () => {
    // The reason this needs a scanner rather than a regex.
    expect(scanForDebtMarkers([file('a.ts', `const url = 'https://x'; // TODO: real host`)])).toHaveLength(1);
    expect(scanForDebtMarkers([file('a.ts', `const s = 'a // TODO: b';`)])).toEqual([]);
  });

  it('does not treat a private field as a comment', () => {
    expect(scanForDebtMarkers([file('a.ts', 'class A { #todoCount = 0; }')])).toEqual([]);
  });
});

describe('commentStartIndex', () => {
  it('finds the opener outside a string and not inside one', () => {
    expect(commentStartIndex('// x')).toBe(2);
    expect(commentStartIndex("const s = 'a // b';")).toBe(-1);
    expect(commentStartIndex('  * continuation')).toBe(3);
    expect(commentStartIndex('plain code')).toBe(-1);
  });

  it('handles an escaped quote without losing track of the string', () => {
    expect(commentStartIndex(String.raw`const s = 'it\'s // not a comment';`)).toBe(-1);
  });
});
