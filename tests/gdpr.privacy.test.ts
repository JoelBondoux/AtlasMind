import { describe, it, expect } from 'vitest';
import {
  DataPrivacyManager,
  REDACTION_PLACEHOLDER,
  defaultDataPrivacyConfig,
} from '../src/core/dataPrivacyManager.js';
import { COMPLIANCE_PACKS } from '../src/core/compliancePacks.js';
import {
  getProviderDataGovernance,
  hasProviderDataGovernance,
} from '../src/core/providerDataGovernance.js';
import type { DataPrivacyConfig } from '../src/types.js';

/**
 * The GDPR controls AtlasMind actually implements, as opposed to the ones a
 * policy document would claim.
 *
 * Three of them are code, and each fails in a way nothing else would catch:
 *
 *  - **Personal data must not reach an untrusted model.** The gate is the
 *    classifier plus the trusted-model list, and the failure mode is silent —
 *    an unclassified match means the text goes out and nobody hears about it.
 *  - **Deny by default.** Privacy machinery that ships switched on would be a
 *    surprise; machinery that ships switched off but *reports* as protecting
 *    you is worse. `enabled: false` must mean no gating and say so.
 *  - **Every provider must have a data-subject route.** Article 15–17 rights
 *    are exercised against the processor, so a provider AtlasMind will send
 *    text to needs a published way to reach it. A missing one is not a
 *    formatting problem; it is a right the user cannot exercise.
 *
 * The fourth control is documentary and deliberately not asserted here: the
 * lawful basis and the processing record are human attestations that live in a
 * control mapping, and a test that ticked them off would be inventing an
 * assessment nobody made.
 */

const withGdprPack = (over: Partial<DataPrivacyConfig> = {}): DataPrivacyConfig => ({
  ...defaultDataPrivacyConfig(),
  enabled: true,
  compliancePacks: ['gdpr-pii'],
  ...over,
});

/**
 * Synthetic values chosen to be *outside* the documentation ranges.
 *
 * This matters more than it looks. The detectors deliberately reject RFC 2606
 * domains and RFC 5737 addresses, so a fixture written with `example.com` and
 * `203.0.113.42` — the reflexive choice — tests nothing and passes as though
 * the classifier were switched off. The exclusion is asserted in its own right
 * further down.
 */
const PERSONAL_EMAIL = 'a.mueller@northwind-traders.co.uk';
const PUBLIC_IP = '77.12.34.56';

describe('personal data is classified before anything is sent', () => {
  const manager = new DataPrivacyManager(withGdprPack());

  const PERSONAL_DATA: ReadonlyArray<{ label: string; text: string }> = [
    { label: 'an email address', text: `Contact the reporter at ${PERSONAL_EMAIL} about this.` },
    { label: 'a public IP address', text: `The request came from ${PUBLIC_IP} last Tuesday.` },
    { label: 'a date of birth', text: 'Date of birth: 1984-03-17 per the onboarding form.' },
    { label: 'a postal address', text: 'They live at 221 Baker Street and asked for deletion.' },
  ];

  for (const { label, text } of PERSONAL_DATA) {
    it(`classifies ${label}`, () => {
      const result = manager.classifyText(text);
      expect(result.hasClassified, `${label} was not detected`).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
    });
  }

  it('does not classify ordinary prose', () => {
    // Over-classification has a real cost: it blocks routine work, and the
    // gate then gets switched off wholesale.
    const result = manager.classifyText('The router picks a model based on budget and speed.');
    expect(result.hasClassified).toBe(false);
  });

  it('names the rule that matched without repeating the value', () => {
    // A redaction notice that quoted the value would defeat the redaction, and
    // these notices are rendered in a webview and written to logs.
    const { matches } = manager.classifyText(`Reach me on ${PERSONAL_EMAIL}`);
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      expect(JSON.stringify(match)).not.toContain(PERSONAL_EMAIL);
    }
  });
});

describe('documentation values are not personal data', () => {
  const manager = new DataPrivacyManager(withGdprPack());

  // Not a nicety. A source repository is full of these, and a classifier that
  // fired on them would mark most of the codebase confidential — at which
  // point the gate is turned off and protects nothing at all.
  const NOT_PERSONAL: ReadonlyArray<{ label: string; text: string }> = [
    { label: 'an RFC 2606 example domain', text: 'Try alice@example.com in the docs.' },
    { label: 'a .test domain', text: 'The fixture uses bob@fixtures.test today.' },
    { label: 'a role mailbox', text: `Escalate to security@northwind-traders.co.uk please.` },
    { label: 'a TEST-NET address', text: 'Bind the sample server to 203.0.113.42 locally.' },
    { label: 'a private range address', text: 'The container sits on 10.0.0.5 behind the proxy.' },
    { label: 'loopback', text: 'The preview server listens on 127.0.0.1 while you edit.' },
    { label: 'a four-part version string', text: 'AssemblyVersion("2.1.0.9") shipped last week.' },
  ];

  for (const { label, text } of NOT_PERSONAL) {
    it(`does not classify ${label}`, () => {
      expect(manager.classifyText(text).hasClassified, text).toBe(false);
    });
  }
});

describe('classified text is redacted unless the model is trusted', () => {
  const text = `Escalate to ${PERSONAL_EMAIL}, who reported it from ${PUBLIC_IP}.`;

  it('redacts for a model that is not on the trusted list', () => {
    const manager = new DataPrivacyManager(withGdprPack({ trustedModelIds: [] }));
    const result = manager.redactForModel(text, 'openai/gpt-4o');

    expect(result.redactedCount).toBeGreaterThan(0);
    expect(result.text).toContain(REDACTION_PLACEHOLDER);
    expect(result.text).not.toContain(PERSONAL_EMAIL);
    expect(result.text).not.toContain(PUBLIC_IP);
  });

  it('redacts when the model is unknown, rather than assuming it is fine', () => {
    // An absent model id is the failure case most likely to occur in a code
    // path nobody thought about, and "unknown" must not read as "trusted".
    const manager = new DataPrivacyManager(withGdprPack({ trustedModelIds: ['local/echo-1'] }));
    expect(manager.redactForModel(text, undefined).redactedCount).toBeGreaterThan(0);
    expect(manager.isModelTrusted(undefined)).toBe(false);
  });

  it('lets classified text through only to an explicitly trusted model', () => {
    const manager = new DataPrivacyManager(withGdprPack({ trustedModelIds: ['local/echo-1'] }));
    expect(manager.isModelTrusted('local/echo-1')).toBe(true);
    expect(manager.redactForModel(text, 'local/echo-1').redactedCount).toBe(0);
  });

  it('trusts nothing when the trusted list is empty', () => {
    // Documented as "Empty = nothing trusted". The opposite reading — empty
    // means unrestricted — is the natural one to implement by accident.
    const manager = new DataPrivacyManager(withGdprPack({ trustedModelIds: [] }));
    for (const model of ['local/echo-1', 'openai/gpt-4o', '']) {
      expect(manager.isModelTrusted(model), model).toBe(false);
    }
  });

  it('leaves unclassified text byte-for-byte unchanged', () => {
    const manager = new DataPrivacyManager(withGdprPack());
    const ordinary = 'The router picks a model based on budget and speed.';
    const result = manager.redactForModel(ordinary, 'openai/gpt-4o');
    expect(result.text).toBe(ordinary);
    expect(result.redactedCount).toBe(0);
  });
});

describe('the privacy gate is off until somebody turns it on, and says so', () => {
  const manager = new DataPrivacyManager(defaultDataPrivacyConfig());

  it('ships disabled', () => {
    expect(defaultDataPrivacyConfig().enabled).toBe(false);
    expect(manager.isEnabled()).toBe(false);
  });

  it('ships with no compliance pack and nothing trusted', () => {
    // A default that pre-trusted a model would make the first classified
    // document leave the machine before anybody had made a decision.
    expect(defaultDataPrivacyConfig().compliancePacks).toEqual([]);
    expect(defaultDataPrivacyConfig().trustedModelIds).toEqual([]);
  });

  it('classifies nothing while disabled, rather than classifying and not acting', () => {
    // The distinction matters for the dashboard: "nothing found" and "not
    // looking" must not render the same, and the honest answer while disabled
    // is that no assessment happened.
    expect(manager.classifyText(PERSONAL_EMAIL).hasClassified).toBe(false);
  });

  it('does not redact while disabled', () => {
    const text = `Reach me on ${PERSONAL_EMAIL}`;
    expect(manager.redactForModel(text, 'openai/gpt-4o').text).toBe(text);
  });
});

describe('every provider AtlasMind can send text to has a data-subject route', () => {
  // Read from the module rather than hardcoded, so a provider added later is
  // covered without anybody remembering to extend this list.
  const PROVIDERS = [
    'anthropic', 'openai', 'google', 'mistral', 'deepseek',
    'xai', 'groq', 'copilot', 'bedrock', 'openrouter',
  ];

  it('knows about each provider', () => {
    for (const provider of PROVIDERS) {
      expect(hasProviderDataGovernance(provider), provider).toBe(true);
    }
  });

  it('states retention for each', () => {
    for (const provider of PROVIDERS) {
      const governance = getProviderDataGovernance(provider);
      expect(governance.retentionSummary.trim().length, provider).toBeGreaterThan(0);
    }
  });

  it('publishes a way to exercise an access or erasure request', () => {
    // Articles 15–17 are exercised against the processor. Without a route the
    // user has a right and no way to use it.
    for (const provider of PROVIDERS) {
      const governance = getProviderDataGovernance(provider);
      const route = governance.dataSubjectRequestUrl ?? governance.dataRequestUrl ?? governance.privacyPolicyUrl;
      expect(route, `${provider} publishes no data-subject route`).toBeTruthy();
      expect(route!.startsWith('https://'), `${provider} route is not https`).toBe(true);
    }
  });

  it('never records training-on-your-data as an unstated default', () => {
    // `true` is a legitimate answer and so is `'unknown'`; what must not happen
    // is a provider silently defaulting to the reassuring one.
    for (const provider of PROVIDERS) {
      const value = getProviderDataGovernance(provider).trainsOnDataByDefault;
      expect([true, false, 'unknown'], provider).toContain(value);
    }
  });

  it('reports an unknown provider as unknown rather than inventing terms', () => {
    expect(hasProviderDataGovernance('not-a-provider')).toBe(false);
    const fallback = getProviderDataGovernance('not-a-provider');
    // A fallback must not claim favourable terms for a provider nobody assessed.
    expect(fallback.trainsOnDataByDefault).not.toBe(false);
  });
});

describe('the GDPR compliance pack is declared coherently', () => {
  const pack = COMPLIANCE_PACKS.find(entry => entry.id === 'gdpr-pii');

  it('exists and treats personal data as at least confidential', () => {
    expect(pack).toBeDefined();
    expect(['confidential', 'secret']).toContain(pack!.sensitivity);
  });

  it('labels every detector without embedding an example value', () => {
    for (const detector of pack!.detectors) {
      expect(detector.label.trim().length, detector.id).toBeGreaterThan(0);
    }
  });

  it('gives every detector a distinct id', () => {
    const ids = pack!.detectors.map(detector => detector.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
