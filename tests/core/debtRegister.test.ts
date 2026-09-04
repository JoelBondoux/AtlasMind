import { describe, it, expect } from 'vitest';
import {
  DEBT_RULES,
  MAX_MARKERS_PER_FILE,
  scanForDebtMarkers,
  scopeDebtCandidates,
  commentStartIndex,
  parseCustomDebtMarkers,
  buildDebtMarkerGuidance,
  BUILT_IN_DEBT_MARKERS,
  customMarkerRules,
  isCustomMarkerRule,
  MAX_CUSTOM_MARKERS,
  debtEntryId,
  reconcileDebtScan,
  setDebtStatus,
  sortDebtEntries,
  buildDebtWorkPrompt,
  deriveDebtMetrics,
  deriveDebtFromSignals,
  isDependencyPullRequest,
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

describe('component-scoped debt scans', () => {
  const gameplayScope = {
    componentId: 'gameplay',
    componentLabel: 'Gameplay',
    vcs: 'git' as const,
    visibility: 'visible' as const,
    scannedFileCount: 1,
    truncated: false,
  };
  const contentScope = {
    componentId: 'content',
    componentLabel: 'Content',
    vcs: 'perforce' as const,
    visibility: 'not-visible' as const,
    scannedFileCount: 0,
    truncated: false,
    reason: 'Perforce state is not connected.',
  };

  it('keeps identical paths in different components as different entries', () => {
    const base = scanForDebtMarkers([file('src/a.ts', '// TODO: retry')]);
    const gameplay = scopeDebtCandidates(base, gameplayScope);
    const tools = scopeDebtCandidates(base, { componentId: 'tools', componentLabel: 'Tools' });
    expect(debtEntryId(gameplay[0]!)).not.toBe(debtEntryId(tools[0]!));
  });

  it('adopts one legacy unscoped entry instead of duplicating it on the first scoped scan', () => {
    const base = scanForDebtMarkers([file('src/a.ts', '// TODO: retry')]);
    const legacy = reconcileDebtScan(EMPTY, base, ['src/a.ts'], AT);
    const scoped = scopeDebtCandidates(base, gameplayScope);
    const migrated = reconcileDebtScan(
      legacy.register,
      scoped,
      [{ componentId: 'gameplay', path: 'src/a.ts' }],
      LATER,
      [gameplayScope],
    );
    expect(migrated.register.entries).toHaveLength(1);
    expect(migrated.register.entries[0]).toMatchObject({
      id: debtEntryId(scoped[0]!),
      componentId: 'gameplay',
      componentLabel: 'Gameplay',
      detectedAt: AT,
    });
    expect(migrated.added).toEqual([]);
  });

  it('only obsoletes evidence in the component that was actually scanned', () => {
    const base = scanForDebtMarkers([file('src/a.ts', '// TODO: retry')]);
    const candidates = [
      ...scopeDebtCandidates(base, gameplayScope),
      ...scopeDebtCandidates(base, { componentId: 'tools', componentLabel: 'Tools' }),
    ];
    const first = reconcileDebtScan(
      EMPTY,
      candidates,
      [
        { componentId: 'gameplay', path: 'src/a.ts' },
        { componentId: 'tools', path: 'src/a.ts' },
      ],
      AT,
      [gameplayScope, contentScope],
    );
    const second = reconcileDebtScan(
      first.register,
      candidates.filter(candidate => candidate.componentId === 'tools'),
      [{ componentId: 'gameplay', path: 'src/a.ts' }],
      LATER,
      [gameplayScope, contentScope],
    );
    expect(second.register.entries.find(entry => entry.componentId === 'gameplay')?.status).toBe('obsolete');
    expect(second.register.entries.find(entry => entry.componentId === 'tools')?.status).toBe('open');
  });

  it('round-trips visible and not-visible scan coverage and publishes it in the mirror', () => {
    const register = reconcileDebtScan(EMPTY, [], [], AT, [gameplayScope, contentScope]).register;
    const round = sanitizeDebtRegister(JSON.parse(JSON.stringify(register)));
    expect(round.lastScanScope).toEqual([gameplayScope, contentScope]);
    const markdown = renderDebtMarkdown(round);
    expect(markdown).toContain('| Gameplay | `git` | visible | 1 |');
    expect(markdown).toContain('| Content | `perforce` | not-visible — Perforce state is not connected. | 0 |');
  });

  it('does not synthesize a visible zero for an unreadable component', () => {
    const register = reconcileDebtScan(EMPTY, [], [], AT, [contentScope]).register;
    expect(register.lastScanScope?.[0]).toMatchObject({ visibility: 'not-visible', scannedFileCount: 0 });
    expect(register.entries).toEqual([]);
  });

  it('drops the whole stored coverage claim when one component record is malformed', () => {
    const raw = reconcileDebtScan(EMPTY, [], [], AT, [gameplayScope, contentScope]).register as unknown as {
      lastScanScope: Array<Record<string, unknown>>;
    };
    delete raw.lastScanScope[1]!.scannedFileCount;
    expect(sanitizeDebtRegister(raw).lastScanScope).toBeUndefined();
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

describe('debt derived from signals nobody wrote down', () => {
  const NOW = Date.parse('2026-07-29T12:00:00.000Z');
  const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

  it('recognises a dependency bot by author, label or branch — never by title', () => {
    // Bots rename their own templates between versions. A title match would
    // silently stop working on an upgrade nobody connected to the change.
    expect(isDependencyPullRequest({ author: 'dependabot[bot]' })).toBe(true);
    expect(isDependencyPullRequest({ author: 'renovate[bot]' })).toBe(true);
    expect(isDependencyPullRequest({ labels: ['dependencies'] })).toBe(true);
    expect(isDependencyPullRequest({ headRefName: 'dependabot/npm_and_yarn/x' })).toBe(true);
    expect(isDependencyPullRequest({ author: 'joel' })).toBe(false);
  });

  it('does not treat a human pull request about dependencies as a bot update', () => {
    expect(isDependencyPullRequest({ author: 'joel', headRefName: 'chore/upgrade-deps' })).toBe(false);
  });

  it('records a dependency update only once it is genuinely stale', () => {
    const fresh = deriveDebtFromSignals({
      now: NOW,
      pullRequests: [{ number: 1, title: 'Bump x', state: 'open', author: 'dependabot[bot]', createdAt: daysAgo(3) }],
    });
    const stale = deriveDebtFromSignals({
      now: NOW,
      pullRequests: [{ number: 1, title: 'Bump x', state: 'open', author: 'dependabot[bot]', createdAt: daysAgo(30) }],
    });
    expect(fresh).toEqual([]);
    expect(stale).toHaveLength(1);
    expect(stale[0].severity).toBe('high');
  });

  it('ignores a dependency update that was already merged or closed', () => {
    expect(deriveDebtFromSignals({
      now: NOW,
      pullRequests: [{ number: 1, title: 'Bump x', state: 'merged', author: 'dependabot[bot]', createdAt: daysAgo(90) }],
    })).toEqual([]);
  });

  it('records a declared-but-unevidenced testing methodology', () => {
    const found = deriveDebtFromSignals({
      now: NOW,
      uncoveredMethodologies: [{ id: 'load-testing', label: 'Load testing' }],
    });
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe('uncovered-methodology');
    expect(found[0].evidencePath).toBe('project_memory/index/testing-config.json');
  });

  it('records an absent pipeline, and only when there genuinely is none', () => {
    expect(deriveDebtFromSignals({ now: NOW, ciWorkflowCount: 0 })).toHaveLength(1);
    expect(deriveDebtFromSignals({ now: NOW, ciWorkflowCount: 2 })).toEqual([]);
    // Absent means "not read", which is not the same as zero.
    expect(deriveDebtFromSignals({ now: NOW })).toEqual([]);
  });

  it('rejects a stale-document path that escapes the workspace', () => {
    expect(deriveDebtFromSignals({ now: NOW, staleDocuments: [{ path: '../../etc/passwd' }] })).toEqual([]);
    expect(deriveDebtFromSignals({ now: NOW, staleDocuments: [{ path: 'docs/a.md' }] })).toHaveLength(1);
  });

  it('grades derived entries with the same rule table as scanned ones', () => {
    // A derived entry and a written one must be comparable, or the register
    // holds two incompatible scales.
    const derived = deriveDebtFromSignals({ now: NOW, ciWorkflowCount: 0 });
    expect(DEBT_RULES.some(rule => rule.id === derived[0].rule)).toBe(true);
  });

  it('gives derived entries stable ids too, so a rescan recognises them', () => {
    const first = deriveDebtFromSignals({ now: NOW, ciWorkflowCount: 0 });
    const second = deriveDebtFromSignals({ now: NOW + 86_400_000, ciWorkflowCount: 0 });
    expect(debtEntryId(first[0])).toBe(debtEntryId(second[0]));
  });
});

describe('buildDebtWorkPrompt — a record, not a work order', () => {
  const entry = () => reconcileDebtScan(
    EMPTY, scanForDebtMarkers([file('src/a.ts', '// HACK: bypasses the cache')]), ['src/a.ts'], AT,
  ).added[0];

  it('says the entry is not a mandate to change anything', () => {
    // Plenty of debt is worth keeping. An agent treating every entry as a work
    // order would spend a morning reversing three deliberate trade-offs.
    const prompt = buildDebtWorkPrompt(entry());
    expect(prompt).toMatch(/NOT a work order/);
    expect(prompt).toMatch(/Deliberate trade-offs live in this register too/);
  });

  it('offers "worth keeping" as a real answer alongside "worth fixing"', () => {
    expect(buildDebtWorkPrompt(entry())).toMatch(/worth keeping, with the reason it was the right call/);
  });

  it('says propose, do not apply', () => {
    // The same division every agent in this workflow works under: rules decide,
    // agents explain.
    expect(buildDebtWorkPrompt(entry())).toMatch(/Propose; do not apply/);
  });

  it('carries the evidence and the rule that graded it', () => {
    const prompt = buildDebtWorkPrompt(entry());
    expect(prompt).toContain('src/a.ts:1');
    expect(prompt).toContain('broken-marker');
  });

  it('is deterministic for a given entry', () => {
    expect(buildDebtWorkPrompt(entry())).toBe(buildDebtWorkPrompt(entry()));
  });
});

describe('a project can declare its own markers', () => {
  it('reads `NAME` and `NAME:severity`', () => {
    expect(parseCustomDebtMarkers(['DEBT', 'REVISIT:high', 'NOTE:low'])).toEqual([
      { marker: 'DEBT', severity: 'medium' },
      { marker: 'REVISIT', severity: 'high' },
      { marker: 'NOTE', severity: 'low' },
    ]);
  });

  it('grades an unqualified marker medium', () => {
    // Somebody who bothered to declare a marker is asserting that something is
    // wrong — the same argument that puts FIXME above TODO.
    expect(parseCustomDebtMarkers(['DEBT'])[0].severity).toBe('medium');
  });

  it('refuses a marker that is a regular expression', () => {
    // The marker becomes part of a pattern. `.*` would match every comment and
    // `(?:` would throw inside the scanner.
    expect(parseCustomDebtMarkers(['.*', '(?:', '[a-z]+', 'A|B'])).toEqual([]);
  });

  it('will not let a project redefine a built-in', () => {
    // Grading your own TODO as high would make two projects' registers
    // incomparable, which is the one thing the rule table exists to prevent.
    expect(parseCustomDebtMarkers(['TODO:high', 'FIXME:low'])).toEqual([]);
  });

  it('caps the count and the length, and de-duplicates', () => {
    const many = Array.from({ length: 60 }, (_, i) => `MARKER${i}`);
    expect(parseCustomDebtMarkers(many)).toHaveLength(MAX_CUSTOM_MARKERS);
    expect(parseCustomDebtMarkers(['X'.repeat(40)])).toEqual([]);
    expect(parseCustomDebtMarkers(['DEBT', 'debt', 'DEBT:high'])).toHaveLength(1);
  });

  it('is total', () => {
    expect(parseCustomDebtMarkers(undefined)).toEqual([]);
    expect(parseCustomDebtMarkers('DEBT')).toEqual([]);
    expect(parseCustomDebtMarkers([null, 42, {}])).toEqual([]);
  });

  it('finds a declared marker in a comment, at its declared severity', () => {
    const found = scanForDebtMarkers(
      [file('src/a.ts', '// REVISIT: this needs a second look')],
      [{ marker: 'REVISIT', severity: 'high' }],
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('high');
    expect(found[0].rule).toBe('custom-marker-revisit');
  });

  it('applies the same comment rule to a declared marker', () => {
    // A custom marker inside a string is data too.
    expect(scanForDebtMarkers(
      [file('a.ts', `const s = 'REVISIT: not a comment';`)],
      [{ marker: 'REVISIT', severity: 'high' }],
    )).toEqual([]);
    expect(scanForDebtMarkers(
      [file('a.ts', '// Prose about when to REVISIT something.')],
      [{ marker: 'REVISIT', severity: 'high' }],
    )).toEqual([]);
  });

  it('finds nothing extra when no markers are declared', () => {
    expect(scanForDebtMarkers([file('a.ts', '// REVISIT: x')])).toEqual([]);
  });

  it('still grades a credential mention high, whatever the marker is called', () => {
    // The one grade that is never negotiable. Exempting custom markers would
    // let a project downgrade it by declaring its own word for it.
    const found = scanForDebtMarkers(
      [file('a.ts', '// NOTE: sanitize this token before logging')],
      [{ marker: 'NOTE', severity: 'low' }],
    );
    expect(found[0].severity).toBe('high');
    expect(found[0].rule).toBe('security-marker');
    expect(found[0].domain).toBe('security');
  });

  it('publishes a declared rule for each marker', () => {
    // A grade whose rule is not written down is a grade nobody can check.
    const rules = customMarkerRules([{ marker: 'REVISIT', severity: 'high' }]);
    expect(rules[0].id).toBe('custom-marker-revisit');
    expect(rules[0].describes).toContain('atlasmind.debt.markers');
    expect(isCustomMarkerRule(rules[0].id)).toBe(true);
    expect(isCustomMarkerRule('security-marker')).toBe(false);
    expect(isCustomMarkerRule('../etc/passwd')).toBe(false);
  });

  it('keeps a declared rule id through a round trip', () => {
    // Rewriting it to `todo-marker` would silently lose the provenance every
    // entry is supposed to carry, in a file the project committed.
    const register = sanitizeDebtRegister({
      entries: [{
        id: 'x', evidencePath: 'a.ts', detectedAt: AT,
        rule: 'custom-marker-revisit', severity: 'high',
      }],
    });
    expect(register.entries[0].rule).toBe('custom-marker-revisit');
  });

  it('rejects a rule id that is neither shipped nor a valid custom one', () => {
    const register = sanitizeDebtRegister({
      entries: [{ id: 'x', evidencePath: 'a.ts', detectedAt: AT, rule: 'custom-marker-../evil' }],
    });
    expect(register.entries[0].rule).toBe('todo-marker');
  });

  it('publishes the declared rules in the mirror', () => {
    const register = reconcileDebtScan(
      EMPTY,
      scanForDebtMarkers([file('a.ts', '// REVISIT: x')], [{ marker: 'REVISIT', severity: 'high' }]),
      ['a.ts'], AT,
    ).register;
    const markdown = renderDebtMarkdown(register, [{ marker: 'REVISIT', severity: 'high' }]);
    expect(markdown).toContain('custom-marker-revisit');
    expect(markdown).toContain('atlasmind.debt.markers');
  });
});

describe('agents are told which markers to use', () => {
  it('names every built-in with its grade', () => {
    // An agent choosing between TODO and FIXME is making a grading decision,
    // and it should know it is making one.
    const guidance = buildDebtMarkerGuidance();
    for (const marker of BUILT_IN_DEBT_MARKERS) {
      expect(guidance, marker).toContain(marker);
    }
    expect(guidance).toMatch(/Graded low/);
    expect(guidance).toMatch(/Graded medium/);
  });

  it('names the project\'s own markers alongside them', () => {
    const guidance = buildDebtMarkerGuidance([{ marker: 'REVISIT', severity: 'high' }]);
    expect(guidance).toContain('REVISIT');
    expect(guidance).toMatch(/declared by this project. Graded high/);
  });

  it('says why the marker matters rather than only that it is required', () => {
    // An agent that marks a shortcut its own way produces debt the register
    // cannot see, and emptiness then reads as "no debt".
    expect(buildDebtMarkerGuidance()).toMatch(/invisible/);
    expect(buildDebtMarkerGuidance()).toMatch(/rather than "not detected"/);
  });

  it('states the position rule, which is the one people get wrong', () => {
    expect(buildDebtMarkerGuidance()).toMatch(/must be the first word of the comment/);
  });

  it('warns that a credential mention is graded high regardless', () => {
    expect(buildDebtMarkerGuidance()).toMatch(/graded high whichever word you used/);
  });

  it('stays short enough to sit in front of a real task', () => {
    // This is prepended to every code-writing agent's prompt. A paragraph
    // competing with the actual task is a paragraph that gets skimmed.
    expect(buildDebtMarkerGuidance().length).toBeLessThan(1200);
  });
});
