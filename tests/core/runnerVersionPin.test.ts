import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_CI_IMAGE, DEFAULT_LOCAL_CI_IMAGE_TAG } from '../../src/core/localCiRunner.ts';
import {
  REVIEWED_RUNNER_IMAGES,
  RUNNER_UPDATE_GRACE_DAYS,
  assessRunnerVersionPin,
  compareRunnerVersions,
  parseLatestRunnerRelease,
  reviewedRunnerVersionForImage,
} from '../../src/core/runnerVersionPin.ts';

const NOW = Date.parse('2026-11-27T12:00:00Z');

describe('the reviewed runner image table', () => {
  it('names the shipped default image, so its version is known rather than guessed', () => {
    const version = reviewedRunnerVersionForImage(DEFAULT_LOCAL_CI_IMAGE);
    expect(version).toBeDefined();
    expect(DEFAULT_LOCAL_CI_IMAGE_TAG).toBe(`ghcr.io/actions/actions-runner:${version}`);
    expect(REVIEWED_RUNNER_IMAGES[0]!.version).toBe(version);
  });

  it('ships runner 2.338.2 by its verified index digest', () => {
    expect(DEFAULT_LOCAL_CI_IMAGE).toBe('ghcr.io/actions/actions-runner@sha256:6d0b2d80d80f143f77dcb676e50920100bbb547e39e883454d57f45ab8c31300');
    expect(reviewedRunnerVersionForImage(DEFAULT_LOCAL_CI_IMAGE)).toBe('2.338.2');
  });

  it('still recognises the previous pin, so a machine that kept it is told it is behind', () => {
    expect(reviewedRunnerVersionForImage('ghcr.io/actions/actions-runner@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda')).toBe('2.336.0');
  });

  it('does not claim a version for a tag, a local derivative or a lookalike digest', () => {
    expect(reviewedRunnerVersionForImage('ghcr.io/actions/actions-runner:2.338.2')).toBeUndefined();
    expect(reviewedRunnerVersionForImage('my-runner:local')).toBeUndefined();
    expect(reviewedRunnerVersionForImage('evil.example/actions-runner@sha256:6d0b2d80d80f143f77dcb676e50920100bbb547e39e883454d57f45ab8c31300')).toBeUndefined();
  });

  it('keeps every entry a full digest of the official image with a plain version', () => {
    for (const entry of REVIEWED_RUNNER_IMAGES) {
      expect(entry.indexDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(entry.reviewedOn).toMatch(/^\d{4}-\d\d-\d\d$/);
    }
  });
});

describe('reading GitHub\'s latest runner release', () => {
  it('reads the tag and publication time', () => {
    expect(parseLatestRunnerRelease('{"tag":"v2.339.0","published":"2026-11-20T10:00:00Z"}'))
      .toEqual({ version: '2.339.0', publishedAt: '2026-11-20T10:00:00Z' });
  });

  it('refuses anything that is not a plain version, never coercing it', () => {
    expect(parseLatestRunnerRelease('{"tag":"latest","published":"2026-11-20T10:00:00Z"}')).toBeUndefined();
    expect(parseLatestRunnerRelease('{"tag":"v2.339.0-beta","published":"x"}')).toBeUndefined();
    expect(parseLatestRunnerRelease('not json')).toBeUndefined();
    expect(parseLatestRunnerRelease('{"tag":"v2.339.0","published":"yesterday"}')).toEqual({ version: '2.339.0' });
  });

  it('compares numerically, not as text', () => {
    expect(compareRunnerVersions('2.338.10', '2.338.2')).toBeGreaterThan(0);
    expect(compareRunnerVersions('2.336.0', '2.338.2')).toBeLessThan(0);
    expect(compareRunnerVersions('2.338.2', '2.338.2')).toBe(0);
  });
});

describe('assessing the pinned runner version', () => {
  it('is current when the pin matches the latest release', () => {
    const verdict = assessRunnerVersionPin({ image: DEFAULT_LOCAL_CI_IMAGE, latest: { version: '2.338.2', publishedAt: '2026-10-26T14:45:12Z' }, now: NOW });
    expect(verdict.state).toBe('current');
    expect(verdict.warning).toBeUndefined();
  });

  it('warns when the pin is behind, asking a person to review and bump the digest', () => {
    const verdict = assessRunnerVersionPin({ image: DEFAULT_LOCAL_CI_IMAGE, latest: { version: '2.339.0', publishedAt: '2026-11-25T00:00:00Z' }, now: NOW });
    expect(verdict).toMatchObject({ state: 'behind', pinnedVersion: '2.338.2', latestVersion: '2.339.0' });
    expect(verdict.warning).toMatch(/2\.338\.2/);
    expect(verdict.warning).toMatch(/2\.339\.0/);
    expect(verdict.warning).toMatch(/imagetools inspect ghcr\.io\/actions\/actions-runner:2\.339\.0/);
    expect(verdict.warning).toMatch(/atlasmind\.ci\.localRunner\.image/);
    // Within the grace period it is a review prompt, not an alarm.
    expect(verdict.warning).not.toMatch(/stop sending/);
  });

  it('says GitHub may stop sending jobs once the newer release is past the grace period', () => {
    const published = new Date(NOW - (RUNNER_UPDATE_GRACE_DAYS + 1) * 86_400_000).toISOString();
    const verdict = assessRunnerVersionPin({
      image: 'ghcr.io/actions/actions-runner@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda',
      latest: { version: '2.338.2', publishedAt: published },
      now: NOW,
    });
    expect(verdict.state).toBe('behind');
    expect(verdict.overdue).toBe(true);
    expect(verdict.warning).toMatch(/stop sending/);
  });

  it('says what it could not check rather than reporting an unknown image as current', () => {
    const custom = assessRunnerVersionPin({ image: 'my-runner:local', latest: { version: '2.338.2' }, now: NOW });
    expect(custom.state).toBe('unknown-image');
    expect(custom.warning).toMatch(/cannot tell which runner version/i);
    const offline = assessRunnerVersionPin({ image: DEFAULT_LOCAL_CI_IMAGE, latest: undefined, now: NOW });
    expect(offline.state).toBe('unknown-latest');
    expect(offline.warning).toMatch(/could not read/i);
  });

  it('treats a pin newer than GitHub\'s latest as current, not as behind', () => {
    expect(assessRunnerVersionPin({ image: DEFAULT_LOCAL_CI_IMAGE, latest: { version: '2.338.1' }, now: NOW }).state).toBe('current');
  });
});
