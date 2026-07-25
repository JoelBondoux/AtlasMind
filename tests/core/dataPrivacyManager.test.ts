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
    const result = mgr.classifyText('reach me at john.smith@acme-corp.co.uk');
    expect(result.hasClassified).toBe(true);
    expect(result.matches[0].label).toContain('email');
  });

  it('does not flag a Luhn-invalid card-like number', () => {
    const mgr = new DataPrivacyManager(configWith({ compliancePacks: ['pci-dss'] }));
    expect(mgr.classifyText('order ref 4111111111111112').hasClassified).toBe(false);
    expect(mgr.classifyText('card 4111 1111 1111 1111').hasClassified).toBe(true);
  });

  it('does not flag role mailboxes or reserved domains as personal data', () => {
    const mgr = new DataPrivacyManager(configWith({ compliancePacks: ['gdpr-pii'] }));
    expect(mgr.classifyText('Co-Authored-By: Claude <noreply@anthropic.com>').hasClassified).toBe(false);
    expect(mgr.classifyText('"author": "jane@example.com"').hasClassified).toBe(false);
  });

  /**
   * The end-to-end guard for the regression that made the gate fire on ordinary
   * work: with every pack enabled, a corpus of plain source, logs, and prose
   * must stay unclassified. `classifyText` is what the orchestrator's routing
   * gate calls, so a hit here is a task silently gated.
   */
  it('leaves an ordinary source-repository corpus unclassified with every pack enabled', () => {
    const mgr = new DataPrivacyManager(
      configWith({ compliancePacks: ['gdpr-pii', 'hipaa-phi', 'pci-dss', 'ccpa', 'financial'] }),
    );
    const corpus = [
      'server.listen(3000, "127.0.0.1") // bind loopback',
      'ports: - "0.0.0.0:8080:8080"',
      'netmask 255.255.255.0 for the bridge network',
      'FileVersion 1.0.0.1 shipped; AssemblyVersion("2.1.0.9")',
      'd="M 100 200 300 400 150 250"',
      '2026-07-25 10 requests handled in 45ms',
      'Co-Authored-By: Claude <noreply@anthropic.com>',
      '// Copyright (c) 2026 support@company.dev',
      'Set the ENVIRONMENT variable before running DEVELOPMENT builds.',
      'The diagnostic output shows a null deref; this is the diagnosis.',
      'Please review the orchestration process.',
    ].join('\n');
    const result = mgr.classifyText(corpus);
    expect(result.matches.map((m) => `${m.source} (${m.label})`)).toEqual([]);
    expect(result.hasClassified).toBe(false);
  });

  it('assigns the hard-gating "secret" tier only to cardholder data and PHI', () => {
    const mgr = new DataPrivacyManager(
      configWith({ compliancePacks: ['gdpr-pii', 'hipaa-phi', 'pci-dss'] }),
    );
    expect(mgr.classifyText('reach me at jane.doe@acme-corp.co.uk').matches[0].sensitivity).toBe('confidential');
    expect(mgr.classifyText('card 4111 1111 1111 1111').matches[0].sensitivity).toBe('secret');
    expect(mgr.classifyText('patient record 88213').matches[0].sensitivity).toBe('secret');
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
    const out = mgr.redactForModel('ProjectX contact: john.smith@acme-corp.co.uk', 'anthropic/claude');
    expect(out.text).not.toContain('ProjectX');
    expect(out.text).not.toContain('john.smith@acme-corp.co.uk');
    expect(out.text).toContain(REDACTION_PLACEHOLDER);
    expect(out.redactedCount).toBeGreaterThan(0);
  });

  it('passes classified content through unchanged for a trusted model', () => {
    const mgr = new DataPrivacyManager(cfg);
    const out = mgr.redactForModel('ProjectX contact: john.smith@acme-corp.co.uk', 'local/llama');
    expect(out.text).toBe('ProjectX contact: john.smith@acme-corp.co.uk');
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
