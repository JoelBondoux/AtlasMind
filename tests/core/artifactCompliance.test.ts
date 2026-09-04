import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_COMPLIANCE_RULES,
  buildArtifactCompliancePrompt,
  classifyArtifactCompliance,
  type ArtifactComplianceSubject,
} from '../../src/core/artifactCompliance.ts';

function subject(overrides: Partial<ArtifactComplianceSubject> = {}): ArtifactComplianceSubject {
  return {
    label: 'SECURITY.md',
    description: 'Vulnerability reporting policy.',
    path: 'SECURITY.md',
    type: 'persistent',
    origin: 'manual',
    lifecycle: 'source',
    retention: 'keep',
    exists: false,
    ...overrides,
  };
}

describe('classifyArtifactCompliance', () => {
  it('reviews an artifact that is present, whatever its retention says', () => {
    // Presence outranks everything: a file that exists cannot be missing.
    expect(classifyArtifactCompliance(subject({ exists: true }))).toBe('review');
    expect(classifyArtifactCompliance(subject({ exists: true, type: 'ephemeral', retention: 'discard' }))).toBe('review');
  });

  it('asks for an absent artifact the repository is expected to keep to be written', () => {
    expect(classifyArtifactCompliance(subject())).toBe('author');
    expect(classifyArtifactCompliance(subject({ label: '.gitignore', origin: 'tooling' }))).toBe('author');
  });

  it('never asks for a produced artifact to be authored', () => {
    // `out/`, `dist/`, `coverage/`, `node_modules/` and a packaged .vsix are
    // absent most of the time and that absence is usually correct. Asking an
    // agent to create the missing coverage directory invites it to fabricate
    // one, which writes a lie about the project into the repository.
    const produced: Array<Partial<ArtifactComplianceSubject>> = [
      { label: 'out/', type: 'ephemeral', origin: 'generated', lifecycle: 'build', retention: 'discard' },
      { label: 'coverage/', type: 'ephemeral', origin: 'generated', lifecycle: 'test', retention: 'discard' },
      { label: 'node_modules/', type: 'ephemeral', origin: 'tooling', lifecycle: 'build', retention: 'cache' },
      { label: '*.vsix', type: 'ephemeral', origin: 'generated', lifecycle: 'build', retention: 'cache' },
    ];
    for (const overrides of produced) {
      expect(classifyArtifactCompliance(subject(overrides)), String(overrides.label)).toBe('explain');
    }
  });

  it('matches the rule that derives the amber rows, rather than agreeing by coincidence', () => {
    // `needsAttention` is `persistent && keep && !exists`. The set of rows the
    // inventory paints amber and the set that offer to author a file must be the
    // same set, or the page marks something urgent and offers nothing for it.
    const cases: ArtifactComplianceSubject[] = [
      subject(),
      subject({ exists: true }),
      subject({ type: 'ephemeral' }),
      subject({ retention: 'cache' }),
      subject({ retention: 'discard' }),
      subject({ type: 'ephemeral', retention: 'discard' }),
    ];
    for (const candidate of cases) {
      const needsAttention = candidate.type === 'persistent' && candidate.retention === 'keep' && !candidate.exists;
      expect(classifyArtifactCompliance(candidate) === 'author').toBe(needsAttention);
    }
  });
});

describe('buildArtifactCompliancePrompt', () => {
  it('names the declared rule that chose the request', () => {
    const ruleIds = new Set(ARTIFACT_COMPLIANCE_RULES.map(rule => rule.id));
    for (const candidate of [subject(), subject({ exists: true }), subject({ type: 'ephemeral' })]) {
      const request = buildArtifactCompliancePrompt(candidate);
      expect(ruleIds.has(request.intent)).toBe(true);
      expect(request.rule.length).toBeGreaterThan(0);
      expect(request.action.length).toBeGreaterThan(0);
    }
  });

  it('tells a review to read what is there and change the least that closes a gap', () => {
    const request = buildArtifactCompliancePrompt(subject({ label: 'README.md', path: 'README.md', exists: true }));

    expect(request.intent).toBe('review');
    expect(request.prompt).toContain('Read README.md in full');
    expect(request.prompt).toContain('Do not rewrite the file wholesale');
    // "This is current" has to be an acceptable answer, or the hand-off becomes
    // a generator of speculative busywork on files that are already fine.
    expect(request.prompt).toContain('Say plainly if you find nothing wrong');
  });

  it('tells an author request to look for an existing equivalent before creating one', () => {
    // The inventory probes a fixed list of paths, so a LICENCE or a
    // docs/SECURITY.md reads as missing. A second copy is worse than the gap.
    const request = buildArtifactCompliancePrompt(subject());

    expect(request.intent).toBe('author');
    expect(request.prompt).toContain('Search the workspace first');
    expect(request.prompt).toContain('Do not invent facts');
    expect(request.prompt).toContain('placeholder');
  });

  it('forbids authoring a produced artifact in the prompt, not merely in the classifier', () => {
    // The classifier decides which prompt is sent; the prompt is what the model
    // reads. A rule enforced only in the first is one an agent never sees.
    const request = buildArtifactCompliancePrompt(subject({
      label: 'coverage/',
      path: 'coverage',
      type: 'ephemeral',
      origin: 'generated',
      lifecycle: 'test',
      retention: 'discard',
    }));

    expect(request.intent).toBe('explain');
    expect(request.prompt).toContain('do not create one');
    expect(request.prompt).toContain('Do not author, generate, or commit a coverage/');
    expect(request.prompt).toContain('What produces coverage in this project');
  });

  it('strips control characters out of a detected filename before it reaches the draft', () => {
    // Only the *.vsix row takes its path from a directory listing, but the
    // boundary is treated the same way at every entrance.
    const request = buildArtifactCompliancePrompt(subject({
      label: '*.vsix',
      path: 'atlasmind\u001b[31m-0.1.0.vsix',
      type: 'ephemeral',
      origin: 'generated',
      retention: 'cache',
      exists: true,
    }));

    // Newlines are the prompt's own structure; anything else in the control
    // range would have come from the workspace, and `safe` collapses it.
    expect(/[\u0000-\u0009\u000b-\u001f\u007f]/.test(request.prompt)).toBe(false);
    expect(request.prompt).toContain('atlasmind [31m-0.1.0.vsix');
  });

  it('produces the same draft every time it is asked', () => {
    // No model is in this path, so the draft is reviewable: the same row always
    // produces the same request, and a change to it is a diff somebody can read.
    expect(buildArtifactCompliancePrompt(subject()).prompt)
      .toBe(buildArtifactCompliancePrompt(subject()).prompt);
  });
});
