import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A setting is a promise: it appears in the VS Code settings UI, it has a
 * description saying what it does, and a user who changes it expects something
 * to happen. Nothing in the build checks that the promise is kept — a setting
 * can be declared, documented, shipped, and read by no code at all.
 *
 * Three had. `atlasmind.remote.enabled` claimed to control whether remote
 * connections are accepted while the real gate was a command plus a workspace
 * approval, so setting it `false` gave false assurance; and the two Buzz
 * autonomous-reply settings described a feature that was never wired (it failed
 * safe, so the effect was a promise rather than a hole). They were found by an
 * audit, which is to say: by someone deciding to look.
 *
 * This makes the audit permanent. Every declared setting must be read somewhere,
 * and no configuration read may carry a redundant `atlasmind.` prefix — reading
 * `atlasmind.ssotPath` from `getConfiguration('atlasmind')` resolves to
 * `atlasmind.atlasmind.ssotPath`, which is declared nowhere and always
 * undefined. Two of those shipped, hidden behind a `??` fallback.
 */

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  contributes: { configuration: { properties: Record<string, unknown> } };
};
const DECLARED = Object.keys(pkg.contributes.configuration.properties);

function collectSources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'out', '.git', 'coverage'].includes(entry.name)) {
          walk(full);
        }
      } else if (/\.ts$/.test(entry.name)) {
        out.push({ file: path.relative(ROOT, full), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

const SOURCES = collectSources();
const ALL_TEXT = SOURCES.map(source => source.text).join('\n');

/**
 * Settings that are legitimately never read by extension code.
 *
 * Each entry needs a reason, because "add it to the allowlist" is how a guard
 * like this quietly stops guarding anything.
 */
const NOT_READ_BY_DESIGN: Record<string, string> = {
  // Declared so the setting exists and can be edited, but the behaviour behind
  // it is not wired yet. Their descriptions say so; see the roadmap.
  'atlasmind.buzz.autonomousReplies': 'Declared but not yet wired — description says so.',
  'atlasmind.buzz.autonomousReplyLimitPerHour': 'Declared but not yet wired — description says so.',
  'atlasmind.remote.enabled': 'Declared but not the real gate — description says so.',
};

/** Sections read via `getConfiguration('atlasmind.<section>')`, so keys appear as leaves. */
function isReadSomewhere(key: string): boolean {
  const short = key.replace(/^atlasmind\./, '');
  const leaf = short.split('.').pop() ?? short;
  return ALL_TEXT.includes(`'${short}'`)
    || ALL_TEXT.includes(`"${short}"`)
    || ALL_TEXT.includes(`'${key}'`)
    // A scoped read: getConfiguration('atlasmind.voice').get('sttEnabled')
    || (short.includes('.') && ALL_TEXT.includes(`getConfiguration('atlasmind.${short.split('.')[0]}')`) && ALL_TEXT.includes(`'${leaf}'`));
}

describe('every declared setting is honoured by code', () => {
  it('has no setting that nothing reads', () => {
    const dead = DECLARED
      .filter(key => !(key in NOT_READ_BY_DESIGN))
      .filter(key => !isReadSomewhere(key));

    expect(dead, `declared settings that no code reads: ${dead.join(', ')}`).toEqual([]);
  });

  it('keeps the not-wired allowlist honest', () => {
    // An allowlisted setting that IS now read should leave the list, otherwise
    // the list slowly becomes a place where dead settings go to be forgotten.
    for (const [key, reason] of Object.entries(NOT_READ_BY_DESIGN)) {
      expect(DECLARED, `${key} is allowlisted but no longer declared`).toContain(key);
      expect(reason.length, `${key} needs a reason`).toBeGreaterThan(10);
    }
  });

  it('says plainly in the description when a setting is not yet wired', () => {
    // The failure mode these caused was a false promise, so the mitigation is
    // that the description cannot read like a working feature.
    const properties = pkg.contributes.configuration.properties as Record<string, { description?: string; markdownDescription?: string }>;
    for (const key of Object.keys(NOT_READ_BY_DESIGN)) {
      const text = `${properties[key]?.description ?? ''} ${properties[key]?.markdownDescription ?? ''}`;
      expect(text, `${key} must disclose that it is not active`).toMatch(/not yet|no effect|does not currently|not the control/i);
    }
  });
});

describe('configuration reads are well-formed', () => {
  it('never double-prefixes a key', () => {
    // getConfiguration('atlasmind').get('atlasmind.x') reads
    // atlasmind.atlasmind.x — declared nowhere, always undefined.
    const offenders: string[] = [];
    for (const { file, text } of SOURCES) {
      const patterns = [
        /getConfiguration\(\s*'atlasmind'\s*\)\s*\.\s*(?:get|update|inspect)(?:<[^>]*>)?\(\s*'(atlasmind\.[^']+)'/g,
        /\b(?:configuration|config|cfg)\s*\.\s*(?:get|update|inspect)(?:<[^>]*>)?\(\s*'(atlasmind\.[^']+)'/g,
      ];
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          offenders.push(`${file}: ${match[1]}`);
        }
      }
    }
    expect(offenders, `double-prefixed configuration reads: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('declares every setting under the atlasmind namespace', () => {
    const stray = DECLARED.filter(key => !key.startsWith('atlasmind.'));
    expect(stray).toEqual([]);
  });
});
