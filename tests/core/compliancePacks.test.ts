import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_PACKS,
  getCompliancePack,
  resolveCompliancePacks,
  passesLuhn,
  passesIbanChecksum,
  isPersonalEmail,
  isPublicIpv4,
} from '../../src/core/compliancePacks.ts';
import type { ComplianceDetector } from '../../src/core/compliancePacks.ts';

/** Run one detector the way DataPrivacyManager does, returning the matched span. */
function firstHit(detector: ComplianceDetector, text: string): string | undefined {
  detector.pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = detector.pattern.exec(text)) !== null) {
    if (!detector.validate || detector.validate(match[0])) {
      detector.pattern.lastIndex = 0;
      return match[0];
    }
    if (match.index === detector.pattern.lastIndex) {
      detector.pattern.lastIndex += 1;
    }
  }
  detector.pattern.lastIndex = 0;
  return undefined;
}

/** Every detector across every built-in pack. */
function allDetectors(): Array<{ packId: string; detector: ComplianceDetector }> {
  return COMPLIANCE_PACKS.flatMap((pack) => pack.detectors.map((detector) => ({ packId: pack.id, detector })));
}

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

  it('GDPR email detector fires on a personal address and stays quiet on plain prose', () => {
    const pack = getCompliancePack('gdpr-pii')!;
    const email = pack.detectors.find((d) => d.id === 'email')!;
    expect(firstHit(email, 'contact jane.doe@acme-corp.co.uk for details')).toBe('jane.doe@acme-corp.co.uk');
    expect(firstHit(email, 'there is no address here at all')).toBeUndefined();
  });

  it('PCI card detector only treats Luhn-valid candidates as hits', () => {
    const pack = getCompliancePack('pci-dss')!;
    const card = pack.detectors.find((d) => d.id === 'card-pan')!;
    expect(card.validate?.('4111111111111111')).toBe(true);
    expect(card.validate?.('4111111111111112')).toBe(false);
  });
});

describe('email personhood validator', () => {
  it('accepts addresses that plausibly identify a person', () => {
    expect(isPersonalEmail('jane.doe@acme-corp.co.uk')).toBe(true);
    expect(isPersonalEmail('j.bondoux@joelbondoux.net')).toBe(true);
  });

  it('rejects role mailboxes and automated senders', () => {
    expect(isPersonalEmail('noreply@anthropic.com')).toBe(false);
    expect(isPersonalEmail('no-reply@github.com')).toBe(false);
    expect(isPersonalEmail('support@company.dev')).toBe(false);
    expect(isPersonalEmail('security@acme.io')).toBe(false);
    expect(isPersonalEmail('ci@build-server.net')).toBe(false);
  });

  it('rejects reserved and documentation domains', () => {
    expect(isPersonalEmail('jane.doe@example.com')).toBe(false);
    expect(isPersonalEmail('someone@test.invalid')).toBe(false);
    expect(isPersonalEmail('user@localhost')).toBe(false);
  });
});

describe('public IPv4 validator', () => {
  it('accepts routable addresses', () => {
    expect(isPublicIpv4('81.2.69.142')).toBe(true);
    expect(isPublicIpv4('1.0.0.1')).toBe(true);
  });

  it('rejects loopback, private, link-local and CGNAT ranges', () => {
    for (const ip of ['127.0.0.1', '0.0.0.0', '10.0.0.5', '172.16.4.1', '172.31.255.254', '192.168.1.1', '169.254.10.2', '100.64.0.1']) {
      expect(isPublicIpv4(ip), ip).toBe(false);
    }
  });

  it('rejects documentation, benchmark, multicast and broadcast ranges', () => {
    for (const ip of ['192.0.2.5', '198.51.100.7', '203.0.113.9', '198.18.0.1', '224.0.0.1', '255.255.255.0', '255.255.255.255']) {
      expect(isPublicIpv4(ip), ip).toBe(false);
    }
  });

  it('does not over-exclude public space adjacent to reserved blocks', () => {
    // 192.0.1/24 and 203.0.114/24 sit beside reserved /24s but are allocated.
    expect(isPublicIpv4('192.0.1.10')).toBe(true);
    expect(isPublicIpv4('203.0.114.10')).toBe(true);
    expect(isPublicIpv4('198.51.101.10')).toBe(true);
    expect(isPublicIpv4('172.32.0.1')).toBe(true);
  });

  it('rejects malformed quads', () => {
    expect(isPublicIpv4('999.1.1.1')).toBe(false);
    expect(isPublicIpv4('1.2.3')).toBe(false);
  });
});

/**
 * The regression guard for the false-positive class that made the privacy gate
 * fire on ordinary work. These detectors run over the whole assembled task
 * context — source, logs, memory, and chat history — so anything here that
 * classifies would silently gate an unrelated task. See the precision note in
 * `compliancePacks.ts`.
 */
describe('benign source-repository corpus stays unclassified', () => {
  const BENIGN: Record<string, string> = {
    'SVG path data': 'd="M 100 200 300 400 150 250"',
    'ISO timestamp in a log line': '2026-07-25 10 requests handled in 45ms',
    'build timing table': 'compile 1200 340 890 1100 ms',
    'coordinate array': 'const box = [10 20 640 480];',
    'localhost bind address': 'server.listen(3000, "127.0.0.1")',
    'compose bind address': 'ports: - "0.0.0.0:8080:8080"',
    'subnet mask': 'netmask 255.255.255.0 for the bridge network',
    'private LAN addresses': 'router at 192.168.1.1 and 10.0.0.5',
    'four-part file version': 'FileVersion 1.0.0.1 shipped',
    'assembly version call': 'AssemblyVersion("2.1.0.9")',
    'prefixed version': 'upgraded to v1.0.0.1 last week',
    'package.json author': '"author": "noreply@example.com"',
    'licence header': '// Copyright (c) 2026 support@company.dev',
    'commit trailer': 'Co-Authored-By: Claude <noreply@anthropic.com>',
    'ALLCAPS word in prose': 'Set the ENVIRONMENT variable before running.',
    'ALLCAPS heading': '## DEVELOPMENT\nRun npm install first.',
    'placeholder token': 'Replace <INFORMATION> with the payload.',
    'release tag': 'Tag RELEASE1 was pushed to origin.',
    'diagnostic prose': 'The diagnostic output shows a null deref.',
    'diagnosis prose': 'This is the diagnosis: the loop is O(n^2).',
    'semver range': 'typescript ^6.1.0 held back per policy',
    'grouped trace id': 'trace 4021 8873 2210 recorded',
    'plain request': 'Please review the orchestration process.',
  };

  for (const [name, text] of Object.entries(BENIGN)) {
    it(`does not classify: ${name}`, () => {
      const hits = allDetectors()
        .map(({ packId, detector }) => ({ packId, id: detector.id, hit: firstHit(detector, text) }))
        .filter((entry) => entry.hit !== undefined)
        .map((entry) => `${entry.packId}:${entry.id} matched "${entry.hit}"`);
      expect(hits).toEqual([]);
    });
  }
});

/** The corresponding recall guard — tightening precision must not blind the packs. */
describe('regulated data is still detected', () => {
  const CASES: Array<{ name: string; text: string; packId: string; detectorId: string }> = [
    { name: 'personal email', text: 'escalate to jane.doe@acme-corp.co.uk please', packId: 'gdpr-pii', detectorId: 'email' },
    { name: 'labelled phone', text: 'Phone: 020 7946 0958 (desk)', packId: 'gdpr-pii', detectorId: 'phone' },
    { name: 'international phone', text: 'reachable on +44 20 7946 0958', packId: 'gdpr-pii', detectorId: 'phone' },
    { name: 'mobile label', text: 'mobile 07700 900123', packId: 'gdpr-pii', detectorId: 'phone' },
    { name: 'public IP', text: 'client connected from 81.2.69.142', packId: 'gdpr-pii', detectorId: 'ipv4' },
    { name: 'date of birth', text: 'date of birth 1984-03-11', packId: 'gdpr-pii', detectorId: 'dob' },
    { name: 'postal address', text: 'ship to 42 Baker Street', packId: 'gdpr-pii', detectorId: 'postal-address' },
    { name: 'SWIFT code', text: 'SWIFT: DEUTDEFF500 for the transfer', packId: 'financial', detectorId: 'swift-bic' },
    { name: 'BIC lower-case cue', text: 'bic code NWBKGB2L', packId: 'financial', detectorId: 'swift-bic' },
    { name: 'IBAN', text: 'account GB82 WEST 1234 5698 7654 32', packId: 'financial', detectorId: 'iban' },
    { name: 'patient record', text: 'patient record 88213 attached', packId: 'hipaa-phi', detectorId: 'medical-terms' },
    { name: 'clinical diagnosis', text: 'clinical diagnosis recorded last week', packId: 'hipaa-phi', detectorId: 'medical-terms' },
    { name: 'diagnosed with', text: 'she was diagnosed with the condition in May', packId: 'hipaa-phi', detectorId: 'medical-terms' },
    { name: 'card PAN', text: 'card 4111 1111 1111 1111 on file', packId: 'pci-dss', detectorId: 'card-pan' },
    { name: 'CVV', text: 'cvv: 123', packId: 'pci-dss', detectorId: 'cvv' },
  ];

  for (const { name, text, packId, detectorId } of CASES) {
    it(`detects ${name}`, () => {
      const detector = getCompliancePack(packId)!.detectors.find((d) => d.id === detectorId)!;
      expect(firstHit(detector, text)).toBeDefined();
    });
  }
});

/**
 * The gate's two-tier response keys off `sensitivity`, so the tier each pack
 * carries is load-bearing, not cosmetic.
 */
describe('pack sensitivity tiers', () => {
  it('keeps cardholder data and PHI at the hard-gating "secret" tier', () => {
    expect(getCompliancePack('pci-dss')!.sensitivity).toBe('secret');
    expect(getCompliancePack('hipaa-phi')!.sensitivity).toBe('secret');
  });

  it('keeps the heuristic contact packs at the advisory "confidential" tier', () => {
    expect(getCompliancePack('gdpr-pii')!.sensitivity).toBe('confidential');
    expect(getCompliancePack('ccpa')!.sensitivity).toBe('confidential');
  });
});
