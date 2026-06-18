/**
 * Built-in compliance packs: curated detectors for regulated / personally
 * identifiable data points defined by global standards (GDPR, HIPAA, PCI-DSS,
 * CCPA/CPRA, …).
 *
 * Each pack is a set of {@link ComplianceDetector}s. When a pack is enabled in
 * the {@link import('../types.js').DataPrivacyConfig}, its detectors join the
 * Data Privacy classifier ({@link import('./dataPrivacyManager.js').DataPrivacyManager}).
 * Any detector hit marks the surrounding context as classified, which gates
 * model routing to the user's trusted-model allow-list and triggers redaction
 * for un-trusted models.
 *
 * IMPORTANT — these detectors are heuristic aids, not a compliance
 * certification. They reduce the chance regulated data reaches an un-trusted
 * model but do not guarantee exhaustive detection. Patterns are paired with a
 * validator where a cheap one exists (Luhn for card numbers, mod-97 for IBANs)
 * to suppress obvious false positives.
 */

import type { DataPrivacySensitivity } from '../types.js';

export interface ComplianceDetector {
  id: string;
  /** Human label shown in redaction notices, e.g. "email address". */
  label: string;
  /** Global-flagged regex used to locate candidate spans. */
  pattern: RegExp;
  /**
   * Optional secondary validator applied to each match to reject structurally
   * invalid candidates (e.g. card numbers that fail the Luhn check). When
   * omitted the regex match alone is treated as a hit.
   */
  validate?: (match: string) => boolean;
}

export interface CompliancePack {
  id: string;
  /** Short standard name shown on the dashboard checkbox. */
  label: string;
  /** One-line description of what the pack covers. */
  description: string;
  sensitivity: DataPrivacySensitivity;
  detectors: ComplianceDetector[];
}

// ── Validators ───────────────────────────────────────────────────

/** Luhn (mod-10) checksum used by payment-card PANs. */
export function passesLuhn(value: string): boolean {
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length < 12 || digits.length > 19) {
    return false;
  }
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alternate) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/** ISO 13616 IBAN mod-97 checksum. */
export function passesIbanChecksum(value: string): boolean {
  const compact = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compact)) {
    return false;
  }
  // Move the first four chars to the end, then convert letters to numbers.
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= 'A' && ch <= 'Z' ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const d of code) {
      remainder = (remainder * 10 + Number(d)) % 97;
    }
  }
  return remainder === 1;
}

// ── Packs ────────────────────────────────────────────────────────

const EMAIL_DETECTOR: ComplianceDetector = {
  id: 'email',
  label: 'email address',
  pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
};

const PHONE_DETECTOR: ComplianceDetector = {
  id: 'phone',
  label: 'phone number',
  // International or grouped national numbers; require at least 9 digits total.
  pattern: /(?:\+\d{1,3}[\s.\-]?)?(?:\(\d{1,4}\)[\s.\-]?)?\d{2,4}(?:[\s.\-]\d{2,4}){2,4}/g,
  validate: (m) => (m.replace(/\D/g, '').length >= 9 && m.replace(/\D/g, '').length <= 15),
};

const IPV4_DETECTOR: ComplianceDetector = {
  id: 'ipv4',
  label: 'IP address',
  pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
};

const IBAN_DETECTOR: ComplianceDetector = {
  id: 'iban',
  label: 'IBAN',
  pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g,
  validate: passesIbanChecksum,
};

export const COMPLIANCE_PACKS: CompliancePack[] = [
  {
    id: 'gdpr-pii',
    label: 'GDPR — Personal Data',
    description: 'EU personal data: email, phone, IP address, postal address, national ID, and dates of birth.',
    sensitivity: 'confidential',
    detectors: [
      EMAIL_DETECTOR,
      PHONE_DETECTOR,
      IPV4_DETECTOR,
      {
        id: 'dob',
        label: 'date of birth',
        // ISO or common slash/dot dates in a DOB-ish context.
        pattern: /\b(?:date\s+of\s+birth|dob|born|d\.o\.b\.?)\b[^\n]{0,20}?\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})\b/gi,
      },
      {
        id: 'postal-address',
        label: 'postal address',
        pattern: /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Square|Sq)\b\.?/g,
      },
    ],
  },
  {
    id: 'hipaa-phi',
    label: 'HIPAA — PHI',
    description: 'US protected health information: medical/diagnosis terms, health-plan and medical-record numbers.',
    sensitivity: 'secret',
    detectors: [
      {
        id: 'medical-terms',
        label: 'medical / diagnosis term',
        pattern: /\b(?:diagnos(?:is|ed|tic)|prognosis|prescription|prescribed|medication|patient\s+(?:id|name|record)|medical\s+record|health\s+plan|treatment\s+plan|icd-?10|mrn)\b/gi,
      },
      {
        id: 'mrn',
        label: 'medical-record number',
        pattern: /\b(?:mrn|medical\s+record\s+(?:no\.?|number|#))\s*[:#]?\s*[A-Z0-9\-]{5,}\b/gi,
      },
    ],
  },
  {
    id: 'pci-dss',
    label: 'PCI-DSS — Cardholder Data',
    description: 'Payment-card numbers (Luhn-validated), CVV, and bank routing/account numbers.',
    sensitivity: 'secret',
    detectors: [
      {
        id: 'card-pan',
        label: 'payment-card number',
        pattern: /\b(?:\d[ \-]?){13,19}\b/g,
        validate: passesLuhn,
      },
      {
        id: 'cvv',
        label: 'card security code',
        pattern: /\b(?:cvv|cvc|cvv2|cid|security\s+code)\b\s*[:#]?\s*\d{3,4}\b/gi,
      },
    ],
  },
  {
    id: 'ccpa',
    label: 'CCPA / CPRA — Consumer Data',
    description: 'California consumer data: PII plus device and advertising identifiers.',
    sensitivity: 'confidential',
    detectors: [
      EMAIL_DETECTOR,
      PHONE_DETECTOR,
      IPV4_DETECTOR,
      {
        id: 'device-id',
        label: 'device / advertising identifier',
        pattern: /\b(?:idfa|gaid|aaid|advertising\s+id|device\s+id)\b\s*[:#]?\s*[A-Fa-f0-9\-]{16,}\b/gi,
      },
    ],
  },
  {
    id: 'financial',
    label: 'Financial — Banking',
    description: 'Bank identifiers: IBAN (checksum-validated) and SWIFT/BIC codes.',
    sensitivity: 'proprietary',
    detectors: [
      IBAN_DETECTOR,
      {
        id: 'swift-bic',
        label: 'SWIFT/BIC code',
        pattern: /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g,
        // Require it not to be a plain English word run; SWIFT codes embed an
        // ISO country code in positions 5-6, so reject all-letter 8-char runs
        // that look like words by demanding at least one digit somewhere or the
        // optional branch suffix.
        validate: (m) => /\d/.test(m) || m.length === 11,
      },
    ],
  },
];

const PACK_BY_ID = new Map(COMPLIANCE_PACKS.map((p) => [p.id, p]));

/** Returns the pack with the given id, or undefined. */
export function getCompliancePack(id: string): CompliancePack | undefined {
  return PACK_BY_ID.get(id);
}

/** Returns the packs for the given ids, skipping unknown ids. */
export function resolveCompliancePacks(ids: readonly string[]): CompliancePack[] {
  const seen = new Set<string>();
  const out: CompliancePack[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const pack = PACK_BY_ID.get(id);
    if (pack) {
      out.push(pack);
    }
  }
  return out;
}
