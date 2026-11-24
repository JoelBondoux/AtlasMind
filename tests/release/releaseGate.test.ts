import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script, no type declarations
import * as gate from '../../scripts/release-gate/gate-core.mjs';

/**
 * The Marketplace release gate's rules (scripts/release-gate/gate-core.mjs).
 *
 * The rules Joel set on 2026-11-23: a release reaches the Marketplace only
 * through the gate; the gate fails closed and has no bypass; at most two
 * publications per UK day; a publish window ships the newest release that
 * passes, never one per commit.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const published = (pairs: Array<[string, string]>) =>
  gate.readMarketplaceVersions({ versions: pairs.map(([version, lastUpdated]) => ({ version, lastUpdated })) });

describe('daily publish limit', () => {
  const now = Date.parse('2026-11-23T21:00:00Z');

  it('allows a newer release when fewer than two went out today', () => {
    const mv = published([['0.516.8', '2026-11-23T09:31:00Z'], ['0.516.7', '2026-11-03T05:02:09Z']]);
    expect(gate.publishDecision({ candidate: '0.516.9', marketplaceVersions: mv, now })).toMatchObject({ ok: true });
  });

  it('refuses a third publication on the same UK day', () => {
    const mv = published([['0.516.9', '2026-11-23T20:00:00Z'], ['0.516.8', '2026-11-23T09:31:00Z']]);
    expect(gate.publishDecision({ candidate: '0.517.0', marketplaceVersions: mv, now })).toMatchObject({ ok: false, kind: 'daily-limit' });
  });

  it('counts the day in UK time, not UTC', () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in BST: a new UK day.
    const mv = published([['1.0.1', '2026-06-30T10:00:00Z'], ['1.0.0', '2026-06-30T09:00:00Z']]);
    expect(gate.publishedToday(mv, Date.parse('2026-06-30T23:30:00Z'))).toBe(0);
    expect(gate.publishedToday(mv, Date.parse('2026-06-30T22:30:00Z'))).toBe(2);
  });

  it('fails closed on Marketplace data it cannot read', () => {
    expect(() => gate.readMarketplaceVersions({})).toThrow(/refusing to guess/);
    expect(() => gate.readMarketplaceVersions({ versions: [{ version: '1.0.0', lastUpdated: 'soon' }] })).toThrow(/unreadable/);
  });
});

describe('what needs publishing', () => {
  const mv = published([['0.516.7', '2026-11-03T05:02:09Z'], ['0.516.4', '2026-11-03T00:22:50Z']]);

  it('does nothing for a version the Marketplace already has, or an older one', () => {
    const now = Date.now();
    expect(gate.publishDecision({ candidate: '0.516.7', marketplaceVersions: mv, now })).toMatchObject({ ok: false, kind: 'not-needed' });
    expect(gate.publishDecision({ candidate: '0.516.5', marketplaceVersions: mv, now })).toMatchObject({ ok: false, kind: 'not-needed' });
  });

  it('tries the newest release first and ignores old and malformed tags', () => {
    expect(gate.windowCandidates(['v0.516.4', 'v0.516.7', 'v0.517.0', 'v0.516.10', 'nightly', 'v1.0'], '0.516.7'))
      .toEqual(['0.517.0', '0.516.10']);
    expect(gate.windowCandidates(['v0.516.7'], '0.516.7')).toEqual([]);
  });
});

describe('VSIX secret scan', () => {
  it('flags secret-bearing files and token shapes, and never repeats the secret', () => {
    const token = `ghp_${'a1B2'.repeat(9)}`;
    const findings = gate.scanFile('extension/out/config.js', `const t = "${token}";`);
    expect(findings).toEqual([{ file: 'extension/out/config.js', rule: 'GitHub token' }]);
    expect(JSON.stringify(findings)).not.toContain(token);
    expect(gate.scanFile('extension/.env', '')).toHaveLength(1);
    expect(gate.scanFile('extension/certs/server.pem', '')).toHaveLength(1);
    expect(gate.scanFile('extension/.npmrc', '//registry.npmjs.org/:_authToken=abc')).toHaveLength(2);
    expect(gate.scanFile('extension/x.txt', `-----BEGIN OPENSSH PRIVATE KEY-----
${'b3BlbnNzaC1rZXktdjEAAAAA'.repeat(3)}
${'QyNTUxOQAAACBcZXJ0aWZp'.repeat(3)}
`)).toHaveLength(1);
    expect(gate.scanFile('extension/x.txt', 'AKIAZ7Q2WXYV3KLMNOPQ')).toHaveLength(1);
  });

  it('passes ordinary code and placeholder example files', () => {
    expect(gate.scanFile('extension/out/extension.js', 'const key = process.env.ANTHROPIC_API_KEY;')).toEqual([]);
    expect(gate.scanFile('extension/.env.example', 'ANTHROPIC_API_KEY=')).toEqual([]);
    // Found in 0.516.7's VSIX: a PEM header a parser checks for, and AWS's documented example key.
    expect(gate.scanFile('extension/node_modules/jose/dist/webapi/key/import.js', "if (pkcs8.indexOf('-----BEGIN PRIVATE KEY-----') !== 0)")).toEqual([]);
    expect(gate.scanFile('extension/out/constants.js', "example: 'AKIAIOSFODNN7EXAMPLE'")).toEqual([]);
  });
});

describe('no bypass', () => {
  it('accepts only --publish, --azure-credential and --report', () => {
    expect(gate.parseGateArgs(['--publish', '--report', 'r.json'])).toMatchObject({ publish: true, report: 'r.json' });
    for (const flag of ['--skip-tests', '--force', '--no-verify', '--bypass', '--allow-package-secrets']) {
      expect(() => gate.parseGateArgs([flag])).toThrow(/no skip or bypass/);
    }
  });

  it('routes every npm publish script through the gate', () => {
    const scripts: Record<string, string> = JSON.parse(read('package.json')).scripts;
    const publishing = Object.entries(scripts).filter(([, cmd]) => /vsce(\.cmd)?\s+publish|release-gate\.mjs.*--publish/.test(cmd));
    expect(publishing.length).toBeGreaterThan(0);
    for (const [name, cmd] of publishing) {
      expect(cmd, name).toMatch(/^node scripts\/release-gate\/release-(gate|window)\.mjs/);
    }
  });

  it('publishes from CI only through the gate, and never on a bare tag push', () => {
    const workflows = ['publish.yml', 'release.yml', 'ci.yml'].map((f) => read(`.github/workflows/${f}`));
    for (const wf of workflows) expect(wf).not.toMatch(/vsce(@\S+)?\s+publish/);
    const publishYml = read('.github/workflows/publish.yml');
    expect(publishYml).not.toMatch(/^\s*push:\s*$/m);
    expect(publishYml).toMatch(/release-gate\.mjs --publish --azure-credential/);
  });

  it('runs the full local CI, security suite, audit, secret scan, install and smoke, in that order', () => {
    const source = read('scripts/release-gate/release-gate.mjs');
    const order = ["'npm ci'", "'local CI'", "'security tests'", "'npm audit'", "'package'", "'secret scan'", "'install'", "'smoke'", "'publish'"]
      .map((step) => source.indexOf(`must(${step}`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(source).toMatch(/'ci:local'/);
    expect(source).toMatch(/--audit-level=high/);
  });
});
