import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveGameDebt, collectGameDebt } from '../../src/core/gameDebt.js';
import { scanGameAssetInventory } from '../../src/core/gameAssetInventory.js';
import { buildGameProjectComposition } from '../../src/core/projectComposition.js';
import { debtEntryId, reconcileDebtScan, setDebtStatus, sanitizeDebtRegister, renderDebtMarkdown } from '../../src/core/debtRegister.js';
import type { AvailableUpstreamDivergenceReport } from '../../src/core/upstreamDivergence.js';
import type { GameProfile } from '../../src/core/gameProfile.js';

const AT = '2026-10-19T12:00:00.000Z';
const scratch = mkdtempSync(path.join(os.tmpdir(), 'am-game-debt-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const composition = buildGameProjectComposition('engine-fork-studio');
composition.components.find(c => c.id === 'engine')!.upstream = { remote: 'upstream', ref: 'main' };
const home = composition.components.find(c => c.home)!;
const profile: GameProfile = { version: 1, contentRoots: [{ componentId: home.id, location: 'Content' }],
  forkDebtThresholds: [{ componentId: 'engine', metric: 'commitsBehind', maximum: 10 }],
};
const fork = (behind = 11): AvailableUpstreamDivergenceReport => ({
  status: 'available', componentId: 'engine', componentLabel: 'Engine fork', upstream: { remote: 'upstream', ref: 'main' },
  observedAt: AT, mergeBase: 'a'.repeat(40), commitsAhead: 2, commitsBehind: behind, filesDiverged: 4,
  divergedPaths: [], conflictPronePathCount: 1, conflictPronePaths: [], pathsTruncated: false, trend: { status: 'first-look' },
});
let counter = 0;
function inventory() {
  const root = path.join(scratch, String(++counter));
  mkdirSync(path.join(root, 'Content'), { recursive: true });
  writeFileSync(path.join(root, 'Content', 'texture.png'), new Uint8Array([1]));
  writeFileSync(path.join(root, 'Content', 'texture.png.meta'), 'import error: private raw metadata');
  const report = scanGameAssetInventory({ confirmed: true, targets: [{ component: home, componentRoot: root, contentRoots: ['Content'] }] });
  return { root, report };
}

describe('game debt uses declared rules and bounded observed facts', () => {
  it('derives all four signals without preserving raw asset/source content', () => {
    const { report } = inventory();
    const result = deriveGameDebt({ composition, profile, inventory: report, divergence: [fork()], sourceFiles: [{
      componentId: home.id, path: 'src/Player.cs', content: '// TUNING: movement-speed hidden raw value',
    }] });
    expect(result.candidates.map(c => c.rule).sort()).toEqual(['game-asset-outside-lfs', 'game-fork-threshold', 'game-import-error', 'game-tuning-in-code']);
    expect(result.candidates.find(c => c.rule === 'game-fork-threshold')?.evidenceDetail).toContain('11');
    expect(result.candidates.find(c => c.rule === 'game-fork-threshold')?.evidenceDetail).toContain('10');
    expect(JSON.stringify(result)).not.toContain('private raw metadata');
    expect(JSON.stringify(result)).not.toContain('hidden raw value');
  });
  it('does not invent a threshold or treat equality as a breach', () => {
    expect(deriveGameDebt({ composition, profile: { version: 1 }, divergence: [fork()] }).candidates).toEqual([]);
    expect(deriveGameDebt({ composition, profile, divergence: [fork(10)] }).candidates).toEqual([]);
    expect(deriveGameDebt({ composition, profile: { ...profile, forkDebtThresholds: [{ componentId: 'engine', metric: 'commitsBehind', maximum: 0 }] }, divergence: [fork(1)] }).candidates).toHaveLength(1);
  });
  it('requires matching engine component and upstream, never a descriptive burden or displayed-path count', () => {
    const other = { ...fork(), upstream: { remote: 'other', ref: 'main' } };
    expect(deriveGameDebt({ composition, profile, divergence: [other] }).candidates).toEqual([]);
    const result = deriveGameDebt({ composition, profile, divergence: [{ ...fork(), pathsTruncated: true }] });
    expect(result.candidates).toHaveLength(1);
  });
  it('requires explicit tuning comments, never arbitrary constants or quoted examples', () => {
    const result = deriveGameDebt({ composition, profile, sourceFiles: [{ componentId: home.id, path: 'src/test.cs',
      content: 'const float speed = 42;\nvar example = "// TUNING: fake";\n// TUNING: actual-speed\n',
    }] });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.title).toContain('actual-speed');
    expect(result.candidates[0]?.evidenceLine).toBe(3);
  });
  it('does not lower security-sensitive tuning markers or retain their raw note', () => {
    const result = deriveGameDebt({ composition, profile, sourceFiles: [{ componentId: home.id, path: 'src/Player.cs', content: '// TUNING: movement-speed security bypass sk-ant-' + 'a'.repeat(30) }] });
    expect(result.candidates[0]?.rule).toBe('game-sensitive-tuning');
    expect(result.candidates[0]?.severity).toBe('high');
    expect(JSON.stringify(result)).not.toContain('sk-ant-');
  });
  it('does not derive LFS findings for unreadable or non-Git coverage', () => {
    const { report } = inventory();
    const component = report.components[0]!;
    if (component.status !== 'available') { throw new Error('fixture inventory unreadable'); }
    for (const status of ['unreadable', 'not-visible'] as const) {
      const result = deriveGameDebt({ composition, profile, inventory: { ...report, components: [{ ...component, lfs: { status } }] } });
      expect(result.candidates.some(c => c.rule === 'game-asset-outside-lfs')).toBe(false);
    }
  });
});

describe('unknown evidence never clears old game findings', () => {
  it('keeps a finding through an unreadable scan and obsoletes it only after an assessed negative', () => {
    const result = deriveGameDebt({ composition, profile, divergence: [fork()] });
    const first = reconcileDebtScan({ version: 1, entries: [] }, result.candidates, [], AT).register;
    const entry = first.entries[0]!;
    const unknown = deriveGameDebt({ composition, profile, previous: first.entries });
    const held = reconcileDebtScan(first, [], [{ componentId: home.id, path: entry.evidencePath }], AT, undefined, unknown.assessedIds).register;
    expect(held.entries[0]?.status).toBe('open');
    const clear = deriveGameDebt({ composition, profile, divergence: [fork(2)], previous: held.entries });
    const cleared = reconcileDebtScan(held, [], [], AT, undefined, clear.assessedIds).register;
    expect(cleared.entries[0]?.status).toBe('obsolete');
  });
  it('keeps the same id and accepted decision as measured distance changes', () => {
    const one = deriveGameDebt({ composition, profile, divergence: [fork(11)] });
    const two = deriveGameDebt({ composition, profile, divergence: [fork(20)] });
    expect(debtEntryId(one.candidates[0]!)).toBe(debtEntryId(two.candidates[0]!));
    let register = reconcileDebtScan({ version: 1, entries: [] }, one.candidates, [], AT).register;
    register = setDebtStatus(register, register.entries[0]!.id, 'accepted', AT);
    const after = reconcileDebtScan(register, two.candidates, [], AT).register;
    expect(after.entries[0]?.status).toBe('accepted');
    expect(after.entries[0]?.evidenceDetail).toContain('20');
  });
  it('does not collide on two long asset paths', () => {
    const one = { domain: 'infrastructure' as const, title: 'Binary asset outside declared Git LFS coverage', rule: 'game-asset-outside-lfs', severity: 'medium' as const, evidencePath: 'Content/' + 'a'.repeat(220) + '1.png' };
    expect(debtEntryId(one)).not.toBe(debtEntryId({ ...one, evidencePath: one.evidencePath.replace('1.png', '2.png') }));
  });
});

it('does no inventory or Git work before confirmation, or without a usable profile', async () => {
  const runGit = async () => { throw new Error('unexpected Git'); };
  const result = await collectGameDebt({ confirmed: false, composition, profile, roots: [], sourceFiles: [] }, runGit);
  expect(result.candidates).toEqual([]);
  expect(result.notes.join(' ')).toContain('confirmation');
});


it('collects assets on explicit request without executing Git when no threshold is declared', async () => {
  const { root } = inventory();
  const result = await collectGameDebt({ confirmed: true, composition, profile: { ...profile, forkDebtThresholds: [] }, roots: [{ componentId: home.id, fsPath: root }], sourceFiles: [] }, async () => { throw new Error('must not inspect Git'); });
  expect(result.candidates.some(c => c.rule === 'game-asset-outside-lfs')).toBe(true);
});

it('keeps previously found LFS debt through a partial scan and obsoletes it only after complete clean coverage', () => {
  const { root, report } = inventory();
  const first = deriveGameDebt({ composition, profile, inventory: report });
  let register = reconcileDebtScan({ version: 1, entries: [] }, first.candidates, [], AT).register;
  const component = report.components[0]!;
  if (component.status !== 'available') { throw new Error('fixture missing'); }
  const partial = deriveGameDebt({ composition, profile, inventory: { ...report, components: [{ ...component, truncated: true, lfs: { status: 'partial', uncoveredPaths: [] } }] }, previous: register.entries });
  register = reconcileDebtScan(register, [], register.entries.map(e => ({ componentId: e.componentId, path: e.evidencePath })), AT, undefined, partial.assessedIds).register;
  expect(register.entries.every(e => e.status === 'open')).toBe(true);
  writeFileSync(path.join(root, '.gitattributes'), '*.png filter=lfs\n');
  const fresh = scanGameAssetInventory({ confirmed: true, targets: [{ component: home, componentRoot: root, contentRoots: ['Content'] }] });
  const clean = deriveGameDebt({ composition, profile, inventory: fresh, previous: register.entries });
  const after = reconcileDebtScan(register, clean.candidates, [], AT, undefined, clean.assessedIds).register;
  expect(after.entries.find(e => e.rule === 'game-asset-outside-lfs')?.status).toBe('obsolete');
  expect(after.entries.find(e => e.rule === 'game-import-error')?.status).toBe('open');
});


it('withholds all negative authority when the candidate cap omits findings', () => {
  const { report } = inventory();
  const base = report.components[0]!;
  if (base.status !== 'available') { throw new Error('fixture inventory missing'); }
  const paths = Array.from({ length: 501 }, (_, i) => `Content/texture-${i}.png`);
  const full = { ...report, components: [{ ...base, assets: paths.map(p => ({ ...base.assets[0]!, path: p, binary: true })), lfs: { status: 'assessed' as const, uncoveredPaths: paths } }] };
  const result = deriveGameDebt({ composition, profile, inventory: full, divergence: [fork(11)] });
  expect(result.candidates).toHaveLength(500);
  expect(result.candidates.some(c => c.rule === 'game-fork-threshold' && c.severity === 'high')).toBe(true);
  expect(result.assessedIds).toEqual([]);
  expect(result.notes.join(' ')).toContain('limit');
});

it('round-trips measured evidence and assessment notes without turning obsolete into resolved', () => {
  const result = deriveGameDebt({ composition, profile, divergence: [fork()] });
  const register = reconcileDebtScan({ version: 1, entries: [] }, result.candidates, [], AT).register;
  register.lastGameScanNotes = ['LFS not-visible'];
  const read = sanitizeDebtRegister(register);
  expect(read.entries[0]?.rule).toBe('game-fork-threshold');
  expect(read.entries[0]?.evidenceDetail).toContain('11');
  expect(read.lastGameScanNotes).toEqual(['LFS not-visible']);
  expect(renderDebtMarkdown(read)).toContain('declared maximum');
  expect(renderDebtMarkdown(read)).toContain('Game signal coverage');
});
