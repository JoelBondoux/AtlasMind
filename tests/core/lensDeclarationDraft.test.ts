import { describe, expect, it } from 'vitest';

import {
  buildLensDeclarationDraftPrompt,
  extractJsonDocument,
  LENS_DRAFT_MAX_ENTRIES,
  looksLikeSecretValue,
  mergeLensDeclarationDraft,
  renderLensDraftSummary,
  reviewLensDeclarationDraft,
} from '../../src/core/lensDeclarationDraft.js';
import type { LensDeclarationKind } from '../../src/core/lensDeclarations.js';

const ALL_ANCHORS_RESOLVE = { anchorExists: () => true };
const NO_ANCHORS_RESOLVE = { anchorExists: () => false };

function machineDraft(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    machines: [{
      id: 'order',
      label: 'Order lifecycle',
      initial: 'draft',
      states: [
        { id: 'draft', label: 'Draft', terminal: false },
        { id: 'paid', label: 'Paid', terminal: true },
      ],
      transitions: [{ id: 'pay', from: 'draft', to: 'paid', event: 'payment.succeeded' }],
      ...overrides,
    }],
  });
}

function settingDraft(setting: Record<string, unknown>): string {
  return JSON.stringify({ version: 1, settings: [setting] });
}

describe('reviewLensDeclarationDraft — refusal', () => {
  it('refuses a reply with no JSON document rather than writing an empty file', () => {
    const review = reviewLensDeclarationDraft('state', 'I had a look but could not find any state machines.', ALL_ANCHORS_RESOLVE);
    expect(review.outcome).toBe('refused');
    expect(review.document).toBeUndefined();
    expect(review.corrections.some(entry => entry.rule === 'no-document')).toBe(true);
  });

  it('refuses a draft the real normalizer rejects, and does not repair it', () => {
    // `initial` names a state that does not exist. Inventing the missing state,
    // or dropping the machine and keeping the rest, would both be AtlasMind
    // authoring project topology.
    const broken = JSON.stringify({
      version: 1,
      machines: [{ id: 'order', label: 'Order', initial: 'nowhere', states: [], transitions: [] }],
    });
    const review = reviewLensDeclarationDraft('state', broken, ALL_ANCHORS_RESOLVE);
    expect(review.outcome).toBe('refused');
    expect(review.document).toBeUndefined();
    expect(review.corrections.some(entry => entry.rule === 'refused-by-schema')).toBe(true);
  });

  it('refuses a draft that declares nothing', () => {
    const review = reviewLensDeclarationDraft('state', JSON.stringify({ version: 1, machines: [] }), ALL_ANCHORS_RESOLVE);
    expect(review.outcome).toBe('refused');
    expect(review.corrections.some(entry => entry.rule === 'empty-draft')).toBe(true);
  });

  it('never throws, whatever the reply is', () => {
    const replies = ['', '```json\n{oh no\n```', '{"version": 99}', 'null', '[]', '{"version":1,"machines":"no"}'];
    for (const reply of replies) {
      expect(() => reviewLensDeclarationDraft('state', reply, ALL_ANCHORS_RESOLVE)).not.toThrow();
    }
  });
});

describe('reviewLensDeclarationDraft — anchors', () => {
  it('keeps the declaration but drops a source link that does not resolve, and says so', () => {
    const draft = machineDraft({
      states: [
        { id: 'draft', label: 'Draft', terminal: false, source: { workspacePath: 'src/invented.ts' } },
        { id: 'paid', label: 'Paid', terminal: true },
      ],
    });
    const review = reviewLensDeclarationDraft('state', draft, NO_ANCHORS_RESOLVE);

    expect(review.outcome).toBe('accepted');
    expect(review.declarationCount).toBe(1);
    const dropped = review.corrections.filter(entry => entry.rule === 'anchor-dropped');
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped[0]?.detail).toContain('src/invented.ts');
    expect(JSON.stringify(review.document)).not.toContain('invented.ts');
  });

  it('keeps a source link that does resolve', () => {
    const draft = machineDraft({
      states: [
        { id: 'draft', label: 'Draft', terminal: false, source: { workspacePath: 'src/orders.ts' } },
        { id: 'paid', label: 'Paid', terminal: true },
      ],
    });
    const review = reviewLensDeclarationDraft('state', draft, ALL_ANCHORS_RESOLVE);
    expect(review.outcome).toBe('accepted');
    expect(JSON.stringify(review.document)).toContain('src/orders.ts');
    expect(review.corrections.some(entry => entry.rule === 'anchor-dropped')).toBe(false);
  });

  it('never probes a path outside the workspace', () => {
    const probed: string[] = [];
    const traversals = ['../../../etc/passwd', '/etc/passwd', 'C:/Windows/win.ini', '..\\..\\secrets.env'];
    for (const workspacePath of traversals) {
      const draft = machineDraft({
        states: [
          { id: 'draft', label: 'Draft', terminal: false, source: { workspacePath } },
          { id: 'paid', label: 'Paid', terminal: true },
        ],
      });
      reviewLensDeclarationDraft('state', draft, {
        anchorExists: candidate => { probed.push(candidate); return true; },
      });
    }
    expect(probed).toEqual([]);
  });
});

describe('reviewLensDeclarationDraft — secrets', () => {
  it('withholds a credential-shaped value and records the source as present instead', () => {
    const draft = settingDraft({
      id: 'stripe',
      key: 'STRIPE_URL',
      valuePolicy: 'display',
      sources: [{
        id: 'env',
        label: 'Environment',
        kind: 'environment',
        precedence: 10,
        applies: true,
        value: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
      }],
    });
    const review = reviewLensDeclarationDraft('config', draft, ALL_ANCHORS_RESOLVE);

    expect(review.outcome).toBe('accepted');
    const serialized = JSON.stringify(review.document);
    expect(serialized).not.toContain('sk-ant-api03');
    expect(serialized).toContain('"present":true');
    expect(review.corrections.some(entry => entry.rule === 'value-withheld')).toBe(true);
  });

  it('masks a setting whose key reads as a credential even when the value looks harmless', () => {
    const draft = settingDraft({
      id: 'api-key',
      key: 'SERVICE_API_KEY',
      valuePolicy: 'display',
      sources: [{ id: 'env', label: 'Environment', kind: 'environment', precedence: 10, applies: true, value: 'abc' }],
    });
    const review = reviewLensDeclarationDraft('config', draft, ALL_ANCHORS_RESOLVE);

    expect(review.outcome).toBe('accepted');
    expect(JSON.stringify(review.document)).not.toContain('abc');
    expect(review.corrections.some(entry => entry.rule === 'policy-forced-masked')).toBe(true);
  });

  it('masks a setting that arrived with no value policy at all', () => {
    const draft = settingDraft({
      id: 'log-level',
      key: 'LOG_LEVEL',
      sources: [{ id: 'env', label: 'Environment', kind: 'environment', precedence: 10, applies: true, value: 'debug' }],
    });
    const review = reviewLensDeclarationDraft('config', draft, ALL_ANCHORS_RESOLVE);

    expect(review.outcome).toBe('accepted');
    expect(review.corrections.some(entry => entry.rule === 'policy-forced-masked')).toBe(true);
    expect(JSON.stringify(review.document)).not.toContain('debug');
  });

  it('leaves an ordinary display setting alone', () => {
    const draft = settingDraft({
      id: 'log-level',
      key: 'LOG_LEVEL',
      valuePolicy: 'display',
      sources: [
        { id: 'default', label: 'Built-in default', kind: 'default', precedence: 0, applies: true, value: 'info' },
        { id: 'env', label: 'Environment', kind: 'environment', precedence: 10, applies: false, value: 'debug' },
      ],
    });
    const review = reviewLensDeclarationDraft('config', draft, ALL_ANCHORS_RESOLVE);

    expect(review.outcome).toBe('accepted');
    expect(JSON.stringify(review.document)).toContain('info');
    expect(review.corrections).toEqual([]);
  });

  it('detects credential shapes in a value without treating length as a signal', () => {
    expect(looksLikeSecretValue('ghp_' + 'a'.repeat(36))).toBe(true);
    expect(looksLikeSecretValue('postgresql://user:hunter2@db.internal:5432/app')).toBe(true);
    expect(looksLikeSecretValue('a-perfectly-ordinary-but-quite-long-configuration-value')).toBe(false);
    expect(looksLikeSecretValue('info')).toBe(false);
  });
});

describe('reviewLensDeclarationDraft — bounds', () => {
  it('caps a draft at a reviewable size and states the truncation', () => {
    const machines = Array.from({ length: LENS_DRAFT_MAX_ENTRIES + 5 }, (_, index) => ({
      id: `machine-${index}`,
      label: `Machine ${index}`,
      initial: 'a',
      states: [{ id: 'a', label: 'A', terminal: true }],
      transitions: [],
    }));
    const review = reviewLensDeclarationDraft('state', JSON.stringify({ version: 1, machines }), ALL_ANCHORS_RESOLVE);

    expect(review.outcome).toBe('accepted');
    expect(review.declarationCount).toBe(LENS_DRAFT_MAX_ENTRIES);
    expect(review.corrections.some(entry => entry.rule === 'entries-capped')).toBe(true);
  });

  it('stamps the version rather than trusting the model to get it right', () => {
    const draft = JSON.parse(machineDraft()) as Record<string, unknown>;
    draft.version = 7;
    const review = reviewLensDeclarationDraft('state', JSON.stringify(draft), ALL_ANCHORS_RESOLVE);
    expect(review.outcome).toBe('accepted');
    expect(review.document?.version).toBe(1);
  });
});

describe('extractJsonDocument', () => {
  it('prefers a fenced block over surrounding prose', () => {
    const reply = 'Here is what I found.\n\n```json\n{"version":1,"machines":[]}\n```\n\nHope that helps.';
    expect(extractJsonDocument(reply)).toEqual({ version: 1, machines: [] });
  });

  it('falls back to a bare object', () => {
    expect(extractJsonDocument('Sure: {"version":1,"settings":[]}')).toEqual({ version: 1, settings: [] });
  });

  it('returns undefined rather than throwing on junk', () => {
    expect(extractJsonDocument('no json at all')).toBeUndefined();
    expect(extractJsonDocument('```json\nnot json\n```')).toBeUndefined();
  });
});

describe('mergeLensDeclarationDraft', () => {
  it('never replaces an entry the user already wrote', () => {
    const existing = {
      version: 1,
      machines: [{ id: 'order', label: 'MY hand-written version', initial: 'a', states: [], transitions: [] }],
    };
    const draft = {
      version: 1,
      machines: [
        { id: 'order', label: 'The model version', initial: 'b', states: [], transitions: [] },
        { id: 'invoice', label: 'Invoice', initial: 'c', states: [], transitions: [] },
      ],
    };
    const merged = mergeLensDeclarationDraft('state', existing, draft);

    expect(merged.kept).toBe(1);
    expect(merged.added).toBe(1);
    expect(merged.skipped).toBe(1);
    const machines = merged.document.machines as Array<{ id: string; label: string }>;
    expect(machines).toHaveLength(2);
    expect(machines[0]?.label).toBe('MY hand-written version');
    expect(machines[1]?.id).toBe('invoice');
  });

  it('merges into an absent file without inventing a base', () => {
    const draft = { version: 1, settings: [{ id: 'log-level' }] };
    const merged = mergeLensDeclarationDraft('config', undefined, draft);
    expect(merged.kept).toBe(0);
    expect(merged.added).toBe(1);
    expect(merged.document.version).toBe(1);
  });

  it('carries both lists for the mappings file', () => {
    const draft = { version: 1, mappings: [{ id: 'a' }], suppressions: [{ id: 'b' }] };
    const merged = mergeLensDeclarationDraft('mappings', { version: 1, mappings: [], suppressions: [{ id: 'b' }] }, draft);
    expect(merged.added).toBe(1);
    expect(merged.skipped).toBe(1);
  });
});

describe('buildLensDeclarationDraftPrompt', () => {
  const kinds: LensDeclarationKind[] = ['state', 'config', 'mappings', 'trust'];

  it('states the anchor rule, the secret rule, and the entry cap for every kind', () => {
    for (const kind of kinds) {
      const prompt = buildLensDeclarationDraftPrompt(kind);
      expect(prompt).toContain('checked against the filesystem');
      expect(prompt).toContain('committed');
      expect(prompt).toContain(String(LENS_DRAFT_MAX_ENTRIES));
      expect(prompt.toLowerCase()).toContain('credential');
    }
  });

  it('names the file it is drafting', () => {
    expect(buildLensDeclarationDraftPrompt('state')).toContain('.atlasmind/lens-state.json');
    expect(buildLensDeclarationDraftPrompt('trust')).toContain('.atlasmind/lens-data-trust.json');
  });
});

describe('renderLensDraftSummary', () => {
  it('lists every correction in full rather than counting them', () => {
    const draft = machineDraft({
      states: [
        { id: 'draft', label: 'Draft', terminal: false, source: { workspacePath: 'src/invented.ts' } },
        { id: 'paid', label: 'Paid', terminal: true },
      ],
    });
    const review = reviewLensDeclarationDraft('state', draft, NO_ANCHORS_RESOLVE);
    const summary = renderLensDraftSummary(review, { document: {}, added: 1, skipped: 0, kept: 0 });

    expect(summary).toContain('src/invented.ts');
    expect(summary).toContain('proposal');
  });

  it('says nothing was written when the draft was refused', () => {
    const review = reviewLensDeclarationDraft('state', 'no json here', ALL_ANCHORS_RESOLVE);
    expect(renderLensDraftSummary(review)).toContain('Nothing was written.');
  });
});
