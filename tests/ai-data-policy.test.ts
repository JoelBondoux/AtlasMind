import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/utils/secretRedactor.js';
import { sanitizeResearchRegister, seedResearchRegister } from '../src/core/researchRegister.js';

/**
 * What may leave this machine, and in what state.
 *
 * The redaction boundary is only as good as its worst path: one un-redacted
 * field defeats the policy everywhere else it is applied. So the assertions
 * here are about *coverage and composition* rather than about any one pattern —
 * every secret shape the redactor claims to know, checked in the positions
 * secrets actually turn up in (mid-sentence, several per document, inside JSON,
 * beside a lookalike that must survive).
 *
 * Two properties beyond "does it match":
 *
 *  - **Idempotence.** Redaction runs at more than one boundary, and a second
 *    pass must not corrupt the first. A redactor that re-matched its own
 *    output would compound quietly and only show up in something already sent.
 *  - **Non-destruction.** Text with no secret in it must come back byte-for-
 *    byte. A redactor that mangles ordinary prose gets switched off, and then
 *    it protects nothing at all.
 *
 * `project_memory/` is git-tracked, which is why the register sanitizer is
 * checked here too: it is the same policy — derive, never mirror — applied to
 * text on its way to disk rather than to a model.
 */

/** One example per pattern the redactor declares. All synthetic. */
const SECRET_SHAPES: ReadonlyArray<{ label: string; sample: string }> = [
  { label: 'anthropic-key', sample: 'sk-ant-api03-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4' },
  { label: 'openai-key', sample: 'sk-proj-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4' },
  { label: 'github-token', sample: 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8' },
  { label: 'bearer-token', sample: 'Bearer ' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4' },
  { label: 'db-connection-string', sample: 'postgresql://user:hunter2@db.example.com:5432/app' },
  { label: 'generic-assignment', sample: 'api_key = "A1b2C3d4E5f6G7h8I9j0"' },
  {
    label: 'pem-private-key',
    sample: '-----BEGIN PRIVATE KEY-----\nA1b2C3d4E5f6G7h8I9j0\n-----END PRIVATE KEY-----',
  },
];

describe('the redaction boundary covers every shape it claims to', () => {
  for (const { label, sample } of SECRET_SHAPES) {
    it(`removes a ${label} standing alone`, () => {
      const result = redactSecrets(sample);
      expect(result.redactedCount).toBeGreaterThan(0);
      expect(result.text).toContain('[REDACTED]');
    });

    it(`removes a ${label} embedded in surrounding prose`, () => {
      // A pattern anchored to the start of a line is the classic near-miss:
      // it passes the case above and fails on a real document.
      const document = `Here is the config we discussed: ${sample} — let me know if it works.`;
      expect(redactSecrets(document).text).not.toContain(sample);
    });
  }

  it('removes every secret in a document that holds several', () => {
    // A redactor that stops after the first match leaves the rest, and every
    // single-secret test above still passes.
    const document = SECRET_SHAPES.map(shape => `value: ${shape.sample}`).join('\n');
    const redacted = redactSecrets(document).text;

    for (const { label, sample } of SECRET_SHAPES) {
      expect(redacted, `${label} survived a multi-secret document`).not.toContain(sample);
    }
  });

  it('reports which kinds it found, so a warning can say what happened', () => {
    const result = redactSecrets(SECRET_SHAPES.map(shape => shape.sample).join('\n'));
    expect(result.redactedTypes.length).toBeGreaterThan(1);
    expect(new Set(result.redactedTypes).size).toBe(result.redactedTypes.length);
  });
});

describe('redaction is safe to apply twice and harmless when there is nothing to do', () => {
  it('is idempotent', () => {
    // Redaction happens at more than one boundary. A second pass that re-matched
    // the first pass's output would compound invisibly.
    const document = SECRET_SHAPES.map(shape => shape.sample).join('\n\n');
    const once = redactSecrets(document).text;
    const twice = redactSecrets(once).text;
    expect(twice).toBe(once);
  });

  it('returns ordinary text unchanged', () => {
    fc.assert(
      fc.property(
        // Plain words and punctuation: no key shapes, no long random tokens.
        fc.array(fc.constantFrom('the', 'router', 'picks', 'a', 'model.', 'Then', 'it', 'runs.'), { maxLength: 40 }),
        words => {
          const text = words.join(' ');
          const result = redactSecrets(text);
          expect(result.text).toBe(text);
          expect(result.redactedCount).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('leaves an empty string alone rather than throwing', () => {
    expect(redactSecrets('').text).toBe('');
    expect(redactSecrets(undefined as unknown as string).redactedCount).toBe(0);
  });

  it('does not redact a word that merely mentions a secret', () => {
    // Over-redaction is a real cost: it strips the sentence that explains a
    // bug, and the boundary then gets bypassed "just this once".
    const prose = 'Store the api key in SecretStorage, never in settings.';
    expect(redactSecrets(prose).text).toBe(prose);
  });
});

describe('the same policy applies to text on its way to a git-tracked file', () => {
  it('redacts a secret that reached the research register', () => {
    // `project_memory/` is committed. A secret written there is a secret in
    // the repository's history, which no later redaction can undo.
    const now = new Date('2026-01-01T00:00:00.000Z');
    const register = sanitizeResearchRegister(
      {
        ...seedResearchRegister(now),
        findings: [{
          title: `Vendor key ${SECRET_SHAPES[0]!.sample}`,
          detail: `Seen at ${SECRET_SHAPES[1]!.sample}`,
          citations: ['https://example.com/a'],
        }],
      },
      now,
    );

    const serialized = JSON.stringify(register);
    expect(serialized).not.toContain(SECRET_SHAPES[0]!.sample);
    expect(serialized).not.toContain(SECRET_SHAPES[1]!.sample);
  });
});
