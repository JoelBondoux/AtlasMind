import { describe, expect, it } from 'vitest';
import {
  DataPrivacyManager,
  defaultDataPrivacyConfig,
  globToRegExp,
  REDACTION_PLACEHOLDER,
} from '../../src/core/dataPrivacyManager.ts';
import type { DataPrivacyConfig } from '../../src/types.ts';

function configWith(overrides: Partial<DataPrivacyConfig>): DataPrivacyConfig {
  return { ...defaultDataPrivacyConfig(), enabled: true, ...overrides };
}

describe('DataPrivacyManager — enablement & trust', () => {
  it('classifies nothing when the policy is disabled', () => {
    const mgr = new DataPrivacyManager(
      configWith({ enabled: false, rules: [{ id: 'r1', kind: 'term', value: 'Acme', sensitivity: 'proprietary', enabled: true }] }),
    );
    expect(mgr.classifyText('Acme internal roadmap').hasClassified).toBe(false);
  });

  it('treats no model as trusted when the trusted list is empty (deny by default)', () => {
    const mgr = new DataPrivacyManager(configWith({ trustedModelIds: [] }));
    expect(mgr.isModelTrusted('local/llama')).toBe(false);
    expect(mgr.isModelTrusted(undefined)).toBe(false);
  });

  it('only trusts explicitly listed models', () => {
    const mgr = new DataPrivacyManager(configWith({ trustedModelIds: ['local/llama'] }));
    expect(mgr.isModelTrusted('local/llama')).toBe(true);
    expect(mgr.isModelTrusted('anthropic/claude')).toBe(false);
  });
});

describe('DataPrivacyManager — term & regex rules', () => {
  it('matches a literal term on a word boundary, case-insensitively', () => {
    const mgr = new DataPrivacyManager(
      configWith({ rules: [{ id: 'r1', kind: 'term', value: 'Acme', sensitivity: 'proprietary', enabled: true }] }),
    );
    expect(mgr.classifyText('The acme project is secret').hasClassified).toBe(true);
    expect(mgr.classifyText('acmeish is a different word').hasClassified).toBe(false);
  });

  it('skips disabled rules and invalid regexes without throwing', () => {
    const mgr = new DataPrivacyManager(
      configWith({
        rules: [
          { id: 'off', kind: 'term', value: 'Acme', sensitivity: 'proprietary', enabled: false },
          { id: 'bad', kind: 'regex', value: '(', sensitivity: 'secret', enabled: true },
        ],
      }),
    );
    expect(mgr.classifyText('Acme (').hasClassified).toBe(false);
  });
});

describe('DataPrivacyManager — compliance packs', () => {
  it('flags an email when GDPR is enabled', () => {
    const mgr = new DataPrivacyManager(configWith({ compliancePacks: ['gdpr-pii'] }));
    const result = mgr.classifyText('reach me at john@example.com');
    expect(result.hasClassified).toBe(true);
    expect(result.matches[0].label).toContain('email');
  });

  it('does not flag a Luhn-invalid card-like number', () => {
    const mgr = new DataPrivacyManager(configWith({ compliancePacks: ['pci-dss'] }));
    expect(mgr.classifyText('order ref 4111111111111112').hasClassified).toBe(false);
    expect(mgr.classifyText('card 4111 1111 1111 1111').hasClassified).toBe(true);
  });
});

describe('DataPrivacyManager — redaction fail-safe', () => {
  const cfg = configWith({
    trustedModelIds: ['local/llama'],
    compliancePacks: ['gdpr-pii'],
    rules: [{ id: 'r1', kind: 'term', value: 'ProjectX', sensitivity: 'secret', enabled: true }],
  });

  it('redacts classified content for an un-trusted model', () => {
    const mgr = new DataPrivacyManager(cfg);
    const out = mgr.redactForModel('ProjectX contact: john@example.com', 'anthropic/claude');
    expect(out.text).not.toContain('ProjectX');
    expect(out.text).not.toContain('john@example.com');
    expect(out.text).toContain(REDACTION_PLACEHOLDER);
    expect(out.redactedCount).toBeGreaterThan(0);
  });

  it('passes classified content through unchanged for a trusted model', () => {
    const mgr = new DataPrivacyManager(cfg);
    const out = mgr.redactForModel('ProjectX contact: john@example.com', 'local/llama');
    expect(out.text).toBe('ProjectX contact: john@example.com');
    expect(out.redactedCount).toBe(0);
  });
});

describe('DataPrivacyManager — path classification', () => {
  const mgr = new DataPrivacyManager(
    configWith({
      rules: [
        { id: 'p1', kind: 'path', value: 'secrets/**', sensitivity: 'secret', enabled: true },
        { id: 'p2', kind: 'path', value: '**/*.key', sensitivity: 'secret', enabled: true },
      ],
    }),
  );

  it('matches folder globs and extension globs', () => {
    expect(mgr.classifyPath('secrets/prod/db.txt')?.id).toBe('p1');
    expect(mgr.classifyPath('src/tls/server.key')?.id).toBe('p2');
    expect(mgr.classifyPath('src/index.ts')).toBeUndefined();
  });

  it('resolves absolute paths against the workspace root and rejects traversal escapes', () => {
    const root = '/home/u/proj';
    expect(mgr.classifyPath('/home/u/proj/secrets/a.txt', root)?.id).toBe('p1');
    expect(mgr.classifyPath('/etc/passwd', root)).toBeUndefined();
  });
});

describe('DataPrivacyManager — activity log', () => {
  it('records catches, dedupes nothing, and notifies the listener', () => {
    const mgr = new DataPrivacyManager(configWith({ compliancePacks: ['gdpr-pii'] }));
    const seen: number[] = [];
    mgr.setActivityListener(events => seen.push(events.length));

    mgr.recordCatch([{ source: 'pack:gdpr-pii:email', label: 'GDPR — email', sensitivity: 'confidential' }], false);
    mgr.recordCatch([
      { source: 'rule:r1', label: 'Codename', sensitivity: 'secret' },
      { source: 'pack:gdpr-pii:phone', label: 'GDPR — phone', sensitivity: 'confidential' },
    ], true);

    const activity = mgr.getActivity();
    expect(activity).toHaveLength(3);
    expect(activity[0].trusted).toBe(false);
    expect(activity[1].trusted).toBe(true);
    expect(seen).toEqual([1, 3]);
  });

  it('ignores empty match arrays', () => {
    const mgr = new DataPrivacyManager(configWith({}));
    mgr.recordCatch([], false);
    expect(mgr.getActivity()).toHaveLength(0);
  });

  it('restores previously persisted activity', () => {
    const mgr = new DataPrivacyManager(configWith({}));
    mgr.setActivity([{ ts: 1, source: 'rule:r1', label: 'X', sensitivity: 'secret', trusted: false }]);
    expect(mgr.getActivity()).toHaveLength(1);
  });
});

describe('globToRegExp', () => {
  it('** crosses directories, * does not', () => {
    expect(globToRegExp('**/*.key').test('a/b/c.key')).toBe(true);
    expect(globToRegExp('*.key').test('a/b.key')).toBe(false);
    expect(globToRegExp('secrets/**').test('secrets/a/b.txt')).toBe(true);
    expect(globToRegExp('secrets').test('secrets/a.txt')).toBe(true);
  });
});
