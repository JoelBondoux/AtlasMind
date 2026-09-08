import { describe, expect, it } from 'vitest';
import {
  ORIGIN_POLICY,
  describeEgressAudit,
  prepareEgress,
  type ModelContextOrigin,
  type OriginTaggedText,
} from '../../src/core/modelEgress.js';

/** A synthetic value the redactor recognises. Never a real credential. */
const FAKE_GITHUB_TOKEN = `ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`;
const FAKE_OPENAI_KEY = `sk-${'A'.repeat(32)}`;

const EXTERNAL = { strictOrigins: true, external: true } as const;
const LOCAL = { strictOrigins: true, external: false } as const;

function part(origin: ModelContextOrigin, text: string): OriginTaggedText {
  return { origin, text };
}

/**
 * Requirement: repository-derived, retrieved, attached, session, memory,
 * tool-result and generated context must be redacted before transmission.
 */
describe('a synthetic secret in every redacted origin', () => {
  const redactedOrigins: ModelContextOrigin[] = [
    'session-context',
    'native-chat-context',
    'attachment',
    'workspace-file',
    'tool-result',
    'project-memory',
    'background-memory',
    'generated-instruction',
  ];

  for (const origin of redactedOrigins) {
    it(`removes it from ${origin}`, () => {
      const result = prepareEgress([part(origin, `token is ${FAKE_GITHUB_TOKEN} here`)], EXTERNAL);
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') { return; }
      expect(result.parts[0]?.text).not.toContain(FAKE_GITHUB_TOKEN);
      expect(result.parts[0]?.text).toContain('[REDACTED]');
      expect(result.audit[0]?.redactedCount).toBeGreaterThan(0);
      expect(result.audit[0]?.redactedRules).toContain('github-token');
    });
  }

  it('leaves clean text byte-identical', () => {
    const text = 'Nothing sensitive in this sentence at all.';
    const result = prepareEgress([part('workspace-file', text)], EXTERNAL);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') { return; }
    expect(result.parts[0]?.text).toBe(text);
    expect(result.audit[0]?.redactedCount).toBe(0);
  });
});

/**
 * Quietly editing what somebody typed means they believe they sent one thing
 * and sent another.
 */
describe('a user-authored prompt is never silently rewritten', () => {
  it('stops and asks when it carries a secret bound for an external provider', () => {
    const result = prepareEgress([part('user-prompt', `use ${FAKE_OPENAI_KEY} please`)], EXTERNAL);
    expect(result.status).toBe('needs-confirmation');
    if (result.status !== 'needs-confirmation') { return; }
    expect(result.origin).toBe('user-prompt');
    expect(result.redactedRules).toContain('openai-key');
    expect(result.reason).toMatch(/will not rewrite your prompt/i);
  });

  it('offers a redacted alternative rather than only refusing', () => {
    const result = prepareEgress([part('user-prompt', `key ${FAKE_OPENAI_KEY}`)], EXTERNAL);
    expect(result.status).toBe('needs-confirmation');
    if (result.status !== 'needs-confirmation') { return; }
    expect(result.redactedAlternative[0]?.text).not.toContain(FAKE_OPENAI_KEY);
    expect(result.redactedAlternative[0]?.text).toContain('[REDACTED]');
  });

  /**
   * Sending your own key to a model on your own hardware is not exfiltration,
   * and prompting for it would train people through the dialog that matters.
   */
  it('does not interrupt when the destination is local', () => {
    const result = prepareEgress([part('user-prompt', `key ${FAKE_OPENAI_KEY}`)], LOCAL);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') { return; }
    expect(result.parts[0]?.text).toContain(FAKE_OPENAI_KEY);
  });

  it('passes a clean user prompt through untouched', () => {
    const text = 'Refactor the router please.';
    const result = prepareEgress([part('user-prompt', text)], EXTERNAL);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') { return; }
    expect(result.parts[0]?.text).toBe(text);
  });
});

describe('unknown origins fail closed', () => {
  it('throws in strict mode, where somebody can fix the call site', () => {
    expect(() => prepareEgress(
      [{ origin: 'invented-origin' as ModelContextOrigin, text: 'x' }],
      EXTERNAL,
    )).toThrow(/unknown context origin/i);
  });

  /**
   * Loud where it helps, safe where it cannot: production treats an unlabelled
   * part as the most sensitive class rather than the least.
   */
  it('treats it as the most restrictive class in production', () => {
    const result = prepareEgress(
      [{ origin: 'invented-origin' as ModelContextOrigin, text: `t ${FAKE_GITHUB_TOKEN}` }],
      { strictOrigins: false, external: true },
    );
    // confirmOnSecret is on for the unknown class, so it stops rather than sending.
    expect(result.status).toBe('needs-confirmation');
  });

  it('truncates an unknown origin to the smallest limit', () => {
    const result = prepareEgress(
      [{ origin: 'invented-origin' as ModelContextOrigin, text: 'x'.repeat(20_000) }],
      { strictOrigins: false, external: false },
    );
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') { return; }
    expect(result.parts[0]?.text.length).toBe(8_000);
  });
});

describe('size limits are per origin', () => {
  it('holds background memory to a tighter limit than a user prompt', () => {
    expect(ORIGIN_POLICY['background-memory'].maxChars)
      .toBeLessThan(ORIGIN_POLICY['user-prompt'].maxChars);
  });

  it('records that a part was cut rather than cutting it silently', () => {
    const result = prepareEgress([part('background-memory', 'y'.repeat(20_000))], EXTERNAL);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') { return; }
    expect(result.audit[0]?.truncated).toBe(true);
    expect(result.parts[0]?.text.length).toBe(ORIGIN_POLICY['background-memory'].maxChars);
  });
});

describe('images are not described as redacted', () => {
  it('passes them through and marks them opaque', () => {
    const result = prepareEgress([part('image-attachment', 'binary-ish')], EXTERNAL);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') { return; }
    expect(result.audit[0]?.opaque).toBe(true);
    expect(result.audit[0]?.redactedCount).toBe(0);
    expect(result.carriesOpaqueContent).toBe(true);
  });

  it('reports no opaque content when there is none', () => {
    const result = prepareEgress([part('workspace-file', 'text')], EXTERNAL);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') { return; }
    expect(result.carriesOpaqueContent).toBe(false);
  });
});

/**
 * A log that helps you debug a leak by reproducing it is not a safety feature.
 */
describe('the audit log carries categories, never content', () => {
  it('names the rules and counts, and no matched value', () => {
    const result = prepareEgress([part('workspace-file', `k ${FAKE_GITHUB_TOKEN}`)], EXTERNAL);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') { return; }
    const line = describeEgressAudit(result.audit, 'anthropic', 'claude-sonnet-5');
    expect(line).toContain('provider=anthropic');
    expect(line).toContain('rules=github-token');
    expect(line).toContain('redactions=1');
    expect(line).not.toContain(FAKE_GITHUB_TOKEN);
    expect(line).not.toContain('ghp_');
  });

  it('contains no fragment of the prompt body', () => {
    const secretish = 'internal-project-codename-thunderbird';
    const result = prepareEgress([part('project-memory', secretish)], EXTERNAL);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') { return; }
    expect(describeEgressAudit(result.audit, 'openai', 'gpt')).not.toContain(secretish);
  });
});

describe('every declared origin has a policy', () => {
  it('leaves no origin unpoliced', () => {
    const origins: ModelContextOrigin[] = [
      'user-prompt', 'system-prompt', 'session-context', 'native-chat-context',
      'attachment', 'workspace-file', 'tool-result', 'project-memory',
      'background-memory', 'generated-instruction', 'image-attachment',
    ];
    for (const origin of origins) {
      expect(ORIGIN_POLICY[origin]).toBeDefined();
      expect(ORIGIN_POLICY[origin].description.length).toBeGreaterThan(0);
    }
  });
});
