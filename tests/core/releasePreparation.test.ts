import { describe, it, expect } from 'vitest';
import {
  extractChangelogSection,
  evaluateReleaseGates,
  buildReleasePlan,
  describeReleasePlan,
  MAX_RELEASE_NOTES_CHARS,
} from '../../src/core/releasePreparation';

const CHANGELOG = [
  '# Changelog',
  '',
  'All notable changes to this project are documented in this file.',
  '',
  '## [0.3.0] - 2026-07-29',
  '',
  '### Added',
  '- The thing that this release is about.',
  '- A second line, kept verbatim.',
  '',
  '## [0.2.0] - 2026-07-01',
  '',
  '### Fixed',
  '- Something older.',
  '',
].join('\n');

describe('extractChangelogSection — the notes are copied, never composed', () => {
  it('returns the section body byte-for-byte', () => {
    const notes = extractChangelogSection(CHANGELOG, '0.3.0');
    expect(notes?.heading).toBe('## [0.3.0] - 2026-07-29');
    expect(notes?.body).toBe([
      '### Added',
      '- The thing that this release is about.',
      '- A second line, kept verbatim.',
    ].join('\n'));
  });

  it('stops at the next version heading rather than running to the end', () => {
    const notes = extractChangelogSection(CHANGELOG, '0.3.0');
    expect(notes?.body).not.toContain('Something older');
  });

  it('finds the last section in the file, which has no successor heading', () => {
    const notes = extractChangelogSection(CHANGELOG, '0.2.0');
    expect(notes?.body).toBe(['### Fixed', '- Something older.'].join('\n'));
  });

  it('accepts every heading shape a real changelog uses', () => {
    // Refusing three of the four would report a perfectly good changelog as
    // missing its entry, which sends the user editing a file that is correct.
    for (const heading of ['## [1.0.0] - 2026-01-01', '## [1.0.0]', '## 1.0.0', '## [v1.0.0] — codename']) {
      const doc = `# Changelog\n\n${heading}\n\n- Body.\n`;
      expect(extractChangelogSection(doc, '1.0.0')?.body, heading).toBe('- Body.');
    }
  });

  it('matches the version exactly, not by prefix', () => {
    // `0.1.0` must not match the `0.1.10` section sitting above it.
    const doc = '# Changelog\n\n## [0.1.10]\n\n- Ten.\n\n## [0.1.0]\n\n- Zero.\n';
    expect(extractChangelogSection(doc, '0.1.0')?.body).toBe('- Zero.');
    expect(extractChangelogSection(doc, '0.1.1')).toBeUndefined();
  });

  it('is total — no input shape throws', () => {
    expect(extractChangelogSection(undefined, '1.0.0')).toBeUndefined();
    expect(extractChangelogSection('', '1.0.0')).toBeUndefined();
    expect(extractChangelogSection(CHANGELOG, '')).toBeUndefined();
    expect(extractChangelogSection('## [not a version]', '1.0.0')).toBeUndefined();
    expect(extractChangelogSection(CHANGELOG, '9.9.9')).toBeUndefined();
  });

  it('marks truncation instead of silently shortening', () => {
    const long = `# Changelog\n\n## [1.0.0]\n\n${'x'.repeat(MAX_RELEASE_NOTES_CHARS + 500)}\n`;
    const notes = extractChangelogSection(long, '1.0.0');
    expect(notes?.truncated).toBe(true);
    expect(notes?.body).toContain('Truncated by AtlasMind');
  });

  it('reports a secret shape without editing the text', () => {
    // Detection only. The published notes must be what the author reviewed, so
    // the finding blocks the release rather than rewriting it.
    const doc = '# Changelog\n\n## [1.0.0]\n\n- Set `api_key: AKIAIOSFODNN7EXAMPLEKEY123`.\n';
    const notes = extractChangelogSection(doc, '1.0.0');
    expect(notes?.secretTypes.length).toBeGreaterThan(0);
    expect(notes?.body).toContain('AKIAIOSFODNN7EXAMPLEKEY123');
    expect(notes?.body).not.toContain('[REDACTED]');
  });
});

const READY = {
  currentVersion: '0.3.0',
  changelog: CHANGELOG,
  existingTags: ['v0.2.0'],
  lastReleasedVersion: '0.2.0',
  workingTreeClean: true,
  ciConclusion: 'success' as const,
  testingEvidence: { assessable: 3, evidenced: 3, unevidenced: [], hasReport: true, failing: 0 },
};

describe('evaluateReleaseGates', () => {
  it('passes every gate when everything is in order', () => {
    const gates = evaluateReleaseGates(READY, extractChangelogSection(CHANGELOG, '0.3.0'));
    expect(gates.every(gate => gate.status === 'pass')).toBe(true);
  });

  it('never treats an unknown as a pass', () => {
    // Shipping on an unknown is exactly the habit this stage exists to break.
    const gates = evaluateReleaseGates(
      { currentVersion: '0.3.0', changelog: CHANGELOG },
      extractChangelogSection(CHANGELOG, '0.3.0'),
    );
    const unknowns = gates.filter(gate => gate.status === 'unknown');
    expect(unknowns.length).toBeGreaterThan(0);
    expect(buildReleasePlan({ currentVersion: '0.3.0', changelog: CHANGELOG }).ready).toBe(false);
  });

  it('blocks an existing tag, whether or not it carries the prefix', () => {
    for (const tags of [['v0.3.0'], ['0.3.0']]) {
      const gate = evaluateReleaseGates({ ...READY, existingTags: tags }, extractChangelogSection(CHANGELOG, '0.3.0'))
        .find(entry => entry.id === 'tag-free');
      expect(gate?.status, tags.join()).toBe('fail');
    }
  });

  it('never advises deleting a published tag', () => {
    const gate = evaluateReleaseGates({ ...READY, existingTags: ['v0.3.0'] }, extractChangelogSection(CHANGELOG, '0.3.0'))
      .find(entry => entry.id === 'tag-free');
    expect(gate?.fixHint).toMatch(/Never delete or move/);
  });

  it('blocks a version that is already published', () => {
    const gate = evaluateReleaseGates({ ...READY, lastReleasedVersion: '0.3.0' }, extractChangelogSection(CHANGELOG, '0.3.0'))
      .find(entry => entry.id === 'version-ahead');
    expect(gate?.status).toBe('fail');
    expect(gate?.detail).toContain('already published');
  });

  it('refuses a secret rather than offering to strip it', () => {
    const doc = '# Changelog\n\n## [0.3.0]\n\n- token: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n';
    const gate = evaluateReleaseGates({ ...READY, changelog: doc }, extractChangelogSection(doc, '0.3.0'))
      .find(entry => entry.id === 'notes-clean');
    expect(gate?.status).toBe('fail');
    expect(gate?.fixHint).toMatch(/rotate the credential/);
    expect(gate?.fixHint).toMatch(/no way to know what was removed/);
    // The detail names the shape, never the value.
    expect(gate?.detail).not.toContain('ghp_');
  });

  it('separates a red build from an unread one', () => {
    const red = evaluateReleaseGates({ ...READY, ciConclusion: 'failure' }, undefined).find(g => g.id === 'ci-green');
    const unread = evaluateReleaseGates({ ...READY, ciConclusion: undefined }, undefined).find(g => g.id === 'ci-green');
    expect(red?.status).toBe('fail');
    expect(unread?.status).toBe('unknown');
  });

  it('gives every unpassed gate something to do about it', () => {
    const gates = evaluateReleaseGates({ currentVersion: '9.9.9' }, undefined);
    for (const gate of gates.filter(entry => entry.status === 'fail')) {
      expect(gate.fixHint, gate.id).toBeTruthy();
    }
  });
});

describe('buildReleasePlan', () => {
  it('is ready only when nothing is outstanding', () => {
    const plan = buildReleasePlan(READY);
    expect(plan.ready).toBe(true);
    expect(plan.blockedBy).toEqual([]);
    expect(plan.tag).toBe('v0.3.0');
  });

  it('suggests the next version from the last published one, not the manifest', () => {
    // The manifest may already be bumped. Bumping on top of a bump silently
    // skips a version number, and a skipped version looks like a lost release.
    const plan = buildReleasePlan({ ...READY, commitSubjects: ['feat: a thing'] });
    expect(plan.suggestedLevel).toBe('minor');
    expect(plan.suggestedVersion).toBe('0.3.0');
  });

  it('classifies the bump with the promotion runner rule, not a second parser', () => {
    expect(buildReleasePlan({ ...READY, commitSubjects: ['fix: x'] }).suggestedLevel).toBe('patch');
    expect(buildReleasePlan({ ...READY, commitSubjects: ['feat!: x'] }).suggestedLevel).toBe('major');
  });

  it('honours a repository that does not prefix its tags', () => {
    expect(buildReleasePlan({ ...READY, tagPrefix: '' }).tag).toBe('0.3.0');
  });

  it('names the first blocker rather than counting them', () => {
    const plan = buildReleasePlan({ currentVersion: '0.4.0', changelog: CHANGELOG, existingTags: [] });
    expect(plan.ready).toBe(false);
    expect(describeReleasePlan(plan)).toContain('changelog entry');
    expect(describeReleasePlan(plan)).not.toMatch(/\d+ gates/);
  });

  it('says plainly that publishing stays with the human', () => {
    expect(describeReleasePlan(buildReleasePlan(READY))).toMatch(/stays with you/);
  });
});

describe('evaluateReleaseGates — the declared testing policy', () => {
  const gate = (testingEvidence: unknown) =>
    evaluateReleaseGates(
      { ...READY, ...(testingEvidence === undefined ? { testingEvidence: undefined } : { testingEvidence }) } as never,
      extractChangelogSection(CHANGELOG, '0.3.0'),
    ).find(entry => entry.id === 'tests-evidenced');

  it('reports unknown when coverage was never gathered', () => {
    // A published version can never be replaced, so "we did not check" must stay
    // distinguishable from "we checked and it was fine". `unknown` is not a pass,
    // so the release is not ready.
    expect(gate(undefined)?.status).toBe('unknown');
  });

  it('fails on a methodology the project declared and did not evidence', () => {
    const result = gate({ assessable: 4, evidenced: 1, unevidenced: ['Mutation', 'End-to-End', 'Contract'], hasReport: true, failing: 0 });
    expect(result?.status).toBe('fail');
    expect(result?.detail).toContain('Mutation');
    // Both resolutions are legitimate: add the evidence, or stop declaring it.
    expect(result?.fixHint).toContain('stop declaring');
  });

  it('fails on a failing test before it looks at evidence', () => {
    const result = gate({ assessable: 4, evidenced: 4, unevidenced: [], hasReport: true, failing: 2 });
    expect(result?.status).toBe('fail');
    expect(result?.detail).toContain('2 tests failing');
  });

  it('reports unknown when everything is evidenced but nothing was ever run', () => {
    const result = gate({ assessable: 3, evidenced: 3, unevidenced: [], hasReport: false, failing: 0 });
    expect(result?.status).toBe('unknown');
    expect(result?.detail).toContain('unknown rather than clean');
  });

  it('reports unknown rather than pass when no methodology is declared at all', () => {
    // Nothing to check against is not the same as checking and finding nothing
    // wrong, and a release must not be waved through on the absence of a standard.
    expect(gate({ assessable: 0, evidenced: 0, unevidenced: [], hasReport: true, failing: 0 })?.status).toBe('unknown');
  });

  it('passes only when every declared methodology has evidence and the report is clean', () => {
    expect(gate({ assessable: 3, evidenced: 3, unevidenced: [], hasReport: true, failing: 0 })?.status).toBe('pass');
  });
});
