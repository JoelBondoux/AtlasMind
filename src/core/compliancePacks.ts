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
 *
 * PRECISION IS A SAFETY PROPERTY. These detectors run over the *whole assembled
 * task context* — retrieved memory, file evidence, and conversation history —
 * not over the user's request. In a source repository that corpus is full of
 * numbers, IP-shaped version strings, role mailboxes, and capitalised
 * identifiers. A detector that fires on ordinary code does real damage: it
 * silently restricts model routing, redacts useful context, and floods the
 * Privacy dashboard with meaningless "catches" until the operator switches the
 * whole policy off — at which point genuine regulated data is protected by
 * nothing. Every detector below is therefore anchored on a cue that ordinary
 * code does not contain (an explicit `phone:`/`SWIFT:` label, a `+` country
 * code, a clinical context) or is paired with a validator that rejects the
 * structurally-impossible (reserved IP ranges, role and example-domain
 * mailboxes). Prefer a missed heuristic hit over a detector that cries wolf;
 * targeted custom `DataPrivacyRule`s cover project-specific data far better
 * than a broad pattern ever will.
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

/**
 * Local parts that identify a role or automated sender rather than a person.
 * `noreply@`, `support@`, and CI mailboxes are not personal data, and they
 * appear in almost every `package.json`, licence header, and commit trailer.
 */
const ROLE_EMAIL_LOCALS = /^(?:no-?reply|do-?not-?reply|postmaster|mailer-daemon|webmaster|hostmaster|abuse|support|info|admin|administrator|help|hello|contact|sales|marketing|billing|security|team|dev|devnull|root|notifications?|alerts?|automated|bot|ci|build|jenkins|git)$/i;

/** Reserved / documentation domains (RFC 2606, RFC 6761) — never a real person. */
const RESERVED_EMAIL_DOMAINS = /(?:^|\.)(?:example\.(?:com|net|org)|example|test|invalid|localhost|local|localdomain)$/i;

/**
 * True when an address plausibly identifies a natural person. Rejects role
 * mailboxes and reserved/example domains, which are the dominant source of
 * email false positives in a source repository.
 */
export function isPersonalEmail(match: string): boolean {
  const at = match.lastIndexOf('@');
  if (at === -1) {
    return false;
  }
  return !ROLE_EMAIL_LOCALS.test(match.slice(0, at)) && !RESERVED_EMAIL_DOMAINS.test(match.slice(at + 1));
}

/**
 * True when a dotted quad is a routable public address. Loopback, private,
 * link-local, CGNAT, benchmark, documentation (TEST-NET), multicast and
 * reserved ranges are excluded: they identify no subscriber, so they are not
 * personal data, and they are exactly the addresses that appear in bind
 * configs, netmasks, and compose files. Ranges are narrowed to their real CIDR
 * so genuinely public space is never silently under-detected.
 */
export function isPublicIpv4(match: string): boolean {
  const parts = match.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) {
    return false; // this-network, private, loopback
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return false; // private
  }
  if (a === 192 && b === 168) {
    return false; // private
  }
  if (a === 169 && b === 254) {
    return false; // link-local
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return false; // carrier-grade NAT
  }
  if (a === 192 && b === 0 && (c === 0 || c === 2)) {
    return false; // IETF protocol assignments / TEST-NET-1
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return false; // benchmarking
  }
  if (a === 198 && b === 51 && c === 100) {
    return false; // TEST-NET-2
  }
  if (a === 203 && b === 0 && c === 113) {
    return false; // TEST-NET-3
  }
  if (a >= 224) {
    return false; // multicast, reserved, broadcast
  }
  return true;
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
  validate: isPersonalEmail,
};

const PHONE_DETECTOR: ComplianceDetector = {
  id: 'phone',
  label: 'phone number',
  // A bare run of digit groups is indistinguishable from coordinates, timing
  // tables, or SVG path data, so a number must carry a phone cue: either an
  // explicit label ("phone:", "mobile") or a leading `+` country code. Grouped
  // national numbers with neither are deliberately not matched — a targeted
  // custom rule is the right tool for a project that stores them unlabelled.
  pattern: new RegExp([
    /\b(?:phone|telephone|tel|mobile|cell|fax|whatsapp)\b[\s:#.=-]{0,4}\+?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}/.source,
    /\+\d{1,3}(?:[\s.-]?\d{2,4}){2,5}/.source,
  ].join('|'), 'gi'),
  validate: (m) => {
    const digits = m.replace(/\D/g, '').length;
    return digits >= 9 && digits <= 15;
  },
};

const IPV4_DETECTOR: ComplianceDetector = {
  id: 'ipv4',
  label: 'IP address',
  // The lookbehinds drop four-part version strings ("FileVersion 1.0.0.1",
  // "v1.0.0.1", `AssemblyVersion("2.1.0.9")`), which are otherwise valid dotted
  // quads; `isPublicIpv4` then drops every non-routable range.
  pattern: /(?<!(?:version|revision|release|build|assembly|schema|sdk|driver|firmware|package)\W{0,4})(?<!\bv\W?)\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/gi,
  validate: isPublicIpv4,
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
    description: 'EU personal data: personal email addresses, labelled or international phone numbers, public IP addresses, postal addresses, and dates of birth.',
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
        // "diagnosis" / "diagnostic" are core debugging vocabulary, so the bare
        // stem is not a PHI signal — it only counts in a clinical construction
        // ("clinical diagnosis", "diagnosed with"). The remaining terms have no
        // ordinary software meaning.
        pattern: /\b(?:prognosis|prescription|prescribed|medication|patient\s+(?:id|name|record)|medical\s+record|health\s+plan|treatment\s+plan|icd-?10|mrn|(?:clinical|medical|patient)\s+diagnos\w+|diagnos(?:is|ed)\s+(?:with|of)\b)/gi,
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
    description: 'California consumer data: the GDPR contact detectors plus device and advertising identifiers.',
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
    description: 'Bank identifiers: IBAN (checksum-validated) and labelled SWIFT/BIC codes.',
    sensitivity: 'proprietary',
    detectors: [
      IBAN_DETECTOR,
      {
        id: 'swift-bic',
        label: 'SWIFT/BIC code',
        // A bare 8/11-character upper-case token is not a usable signal: it
        // matches any capitalised identifier or heading of that length
        // ("ENVIRONMENT", "DEVELOPMENT", "RELEASE1"). The code must be
        // introduced by a SWIFT/BIC cue; `validate` then requires the code
        // itself to be upper-case, since the cue is matched case-insensitively.
        pattern: /\b(?:swift|bic)(?:\s+code)?\b\s*[:#=]?\s*[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gi,
        validate: (m) => /[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(m.trim()),
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
