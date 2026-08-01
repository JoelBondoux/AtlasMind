import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../../src/types.ts';

/**
 * The methodology registry grew from 14 to 23 in v0.66.0, and four pieces of
 * user-facing copy kept saying 14 — the Testing page badge read "13 / 14 active"
 * while the table below it listed 23 rows, and the bootstrap and auto-assess
 * pickers both offered "the full list of 14 methodologies".
 *
 * That is a small error with a specific cost: a user reading "13 / 14 active"
 * concludes the project has very nearly everything switched on, when it has just
 * over half. The Testing page's whole job is to report what is and is not in
 * force, so a denominator it invented is the one number it must not get wrong.
 *
 * This test pins the *rule* rather than the number: the count must be derived
 * from the registry, so the next time the registry grows nothing has to be
 * remembered.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const COPY_SOURCES = [
  'media/projectDashboard.js',
  'src/views/settingsPanel.ts',
  'src/bootstrap/bootstrapper.ts',
];

describe('testing methodology count in user-facing copy', () => {
  it('is never written as a literal', () => {
    const offenders: string[] = [];

    for (const relativePath of COPY_SOURCES) {
      const source = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
      source.split(/\r?\n/).forEach((line, index) => {
        // "N methodologies", "N / N active", "of N methodologies" — any bare
        // number standing where the registry size belongs.
        if (/\b\d+\s+methodolog(y|ies)\b/i.test(line) || /\/\s*\d+\s+active\b/i.test(line)) {
          offenders.push(`${relativePath}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders, `Derive the count from TESTING_METHODOLOGY_DEFINITIONS.length instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('has a registry the copy can be derived from', () => {
    // A guard on the guard: if the registry were ever emptied or renamed, the
    // test above would pass vacuously.
    expect(TESTING_METHODOLOGY_DEFINITIONS.length).toBeGreaterThan(1);
    expect(new Set(TESTING_METHODOLOGY_DEFINITIONS.map(definition => definition.id)).size)
      .toBe(TESTING_METHODOLOGY_DEFINITIONS.length);
  });
});
