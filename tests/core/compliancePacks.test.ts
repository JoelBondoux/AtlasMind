import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_PACKS,
  getCompliancePack,
  resolveCompliancePacks,
  passesLuhn,
  passesIbanChecksum,
} from '../../src/core/compliancePacks.ts';

describe('compliance pack validators', () => {
  it('Luhn accepts valid card numbers and rejects invalid ones', () => {
    expect(passesLuhn('4111111111111111')).toBe(true); // canonical Visa test PAN
    expect(passesLuhn('4111 1111 1111 1111')).toBe(true); // spaced
    expect(passesLuhn('4111111111111112')).toBe(false); // bad check digit
    expect(passesLuhn('1234')).toBe(false); // too short
  });

  it('IBAN mod-97 accepts valid IBANs and rejects invalid ones', () => {
    expect(passesIbanChecksum('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(passesIbanChecksum('GB82WEST12345698765432')).toBe(true);
    expect(passesIbanChecksum('GB00WEST12345698765432')).toBe(false); // bad checksum
    expect(passesIbanChecksum('not-an-iban')).toBe(false);
  });
});

describe('compliance pack registry', () => {
  it('resolves known pack ids and skips unknown ones', () => {
    const packs = resolveCompliancePacks(['gdpr-pii', 'does-not-exist', 'gdpr-pii']);
    expect(packs.map((p) => p.id)).toEqual(['gdpr-pii']); // deduped, unknown dropped
  });

  it('every pack has at least one detector with a global regex', () => {
    for (const pack of COMPLIANCE_PACKS) {
      expect(pack.detectors.length).toBeGreaterThan(0);
      for (const det of pack.detectors) {
        expect(det.pattern.flags).toContain('g');
      }
    }
  });

  it('GDPR email detector fires on an address and stays quiet on plain prose', () => {
    const pack = getCompliancePack('gdpr-pii')!;
    const email = pack.detectors.find((d) => d.id === 'email')!;
    email.pattern.lastIndex = 0;
    expect(email.pattern.test('contact jane.doe@example.com for details')).toBe(true);
    email.pattern.lastIndex = 0;
    expect(email.pattern.test('there is no address here at all')).toBe(false);
  });

  it('PCI card detector only treats Luhn-valid candidates as hits', () => {
    const pack = getCompliancePack('pci-dss')!;
    const card = pack.detectors.find((d) => d.id === 'card-pan')!;
    expect(card.validate?.('4111111111111111')).toBe(true);
    expect(card.validate?.('4111111111111112')).toBe(false);
  });
});
