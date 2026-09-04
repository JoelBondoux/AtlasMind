import type { TestingMethodologyId } from '../types.js';

/**
 * Which edition of a standard each testing methodology models, and when
 * AtlasMind last checked that control set.
 *
 * A catalog with no edition on it silently grades a project against whichever
 * version happened to be current when the code was written. ISO 27001 went 2013
 * to 2022 and renumbered most of Annex A; PCI DSS went 4.0 to 4.0.1 with
 * future-dated requirements becoming mandatory; NIST SP 800-53 is on Rev. 5;
 * the EU AI Act phases in over years. A register assessed against one edition
 * is **about a different document** from one assessed against the next, and
 * saying so is the whole job of this file.
 *
 * ── Declared for all sixty-nine, never absent ────────────────────────────
 *
 * `kind: 'none'` is a decision somebody made — "TDD is a practice with no
 * governing standard" — where a missing entry is a decision nobody made. A test
 * pins totality, so a methodology cannot be added without answering the
 * question. Most of the catalogue genuinely has no standard; several
 * non-compliance ones do (`accessibility` tracks WCAG, `security-testing`
 * tracks the OWASP ASVS), which is why this covers the whole catalogue rather
 * than only the twenty-four governance regimes.
 *
 * ── One home, so a version cannot drift ──────────────────────────────────
 *
 * Kept as a table keyed by id rather than as a field on each of the sixty-nine
 * definitions, because this is the file that gets *edited* when an edition
 * moves. A new edition is a one-line diff a reviewer can read, not a hunt
 * through twelve hundred lines of catalogue.
 *
 * ── How this stays current ───────────────────────────────────────────────
 *
 * Three channels, and one thing AtlasMind must never do.
 *
 * A new edition ships **with the extension**: the catalog is code, and a
 * revision arrives as a release with a changelog entry and a declared control
 * mapping. The `regulatory` research scan
 * ({@link ./researchScanCatalog.ts}) is the early warning — it raises a *cited*
 * finding that an edition was published and sets {@link supersededBy}; it never
 * edits this table, because a scan reports and a human decides. And a project
 * can declare additional controls of its own in its register.
 *
 * **AtlasMind never fetches, mirrors or generates the standards themselves.**
 * ISO and PCI control text is copyrighted and licensed — ISO 27001 costs money
 * and may not be redistributed — so mirroring it would be a licensing problem
 * wearing a feature's clothes. What ships is a paraphrase beside the official
 * reference. And no control text is ever model-generated: a hallucinated
 * control in a compliance catalog is the worst artifact this product could
 * produce.
 *
 * ── `verifiedAt` is a claim, and it decays ───────────────────────────────
 *
 * It means: on this date, somebody checked that this is the current edition and
 * that the control set matches it. It is not a guarantee that it is current
 * *now*. {@link isStandardStale} is what turns it back into a question, and the
 * surfaces show it as a warning rather than letting an old date sit quietly.
 */

/** How long a verification stands before it is worth checking again. */
export const STANDARD_VERIFICATION_HORIZON_MONTHS = 18;

export type StandardTracking =
  | {
    readonly kind: 'tracked';
    /** The standard's own name, as it would be cited. */
    readonly name: string;
    /** The edition this project's control set models. */
    readonly edition: string;
    /** ISO date somebody last confirmed this is the current edition. */
    readonly verifiedAt: string;
    readonly publishedUrl?: string;
    /**
     * A newer edition is known to exist and is **not** modelled here.
     *
     * Set deliberately, usually from a cited regulatory research finding. It is
     * the honest state between an edition being published and the catalog
     * catching up — far better than a `verifiedAt` that quietly goes stale.
     */
    readonly supersededBy?: { readonly edition: string; readonly publishedOn: string };
  }
  | {
    readonly kind: 'none';
    /** Why this methodology has no edition to track. */
    readonly reason: string;
  };

export const METHODOLOGY_STANDARDS: Readonly<Record<TestingMethodologyId, StandardTracking>> = {
  'tdd': { kind: 'none', reason: 'A way of working rather than a published specification. There is no edition of it to fall behind.' },
  'bdd': { kind: 'none', reason: 'A way of working rather than a published specification. There is no edition of it to fall behind.' },
  'atdd': { kind: 'none', reason: 'A way of working rather than a published specification. There is no edition of it to fall behind.' },
  'sdd': { kind: 'none', reason: 'A way of working rather than a published specification. There is no edition of it to fall behind.' },
  'v-model': { kind: 'none', reason: 'A way of working rather than a published specification. There is no edition of it to fall behind.' },
  'unit': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'integration': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'mutation': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'property': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'continuous': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'white-box': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'e2e': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'snapshot': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'contract': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'mbt': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'test-design': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'black-box': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'gray-box': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'performance': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'security-testing': { kind: 'tracked', name: 'OWASP Application Security Verification Standard', edition: '4.0.3', verifiedAt: '2026-09-04', publishedUrl: 'https://owasp.org/www-project-application-security-verification-standard/' },
  'visual': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'exploratory': { kind: 'none', reason: 'A way of working rather than a published specification. There is no edition of it to fall behind.' },
  'agile-testing': { kind: 'none', reason: 'A way of working rather than a published specification. There is no edition of it to fall behind.' },
  'dead-field': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'type-drift': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'dependency-graph': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'cross-surface-parity': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'cross-representation': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'cross-version-parity': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'semantic-constraint': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'anti-uniformity': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'output-schema-drift': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'hallucination-detection': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'chaos': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'accessibility': { kind: 'tracked', name: 'W3C WCAG', edition: '2.2', verifiedAt: '2026-09-04', publishedUrl: 'https://www.w3.org/TR/WCAG22/' },
  'observability': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'data-quality': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'schema-migration': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'compatibility': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'state-drift': { kind: 'none', reason: 'A testing technique rather than a published specification. Its tooling has versions; the practice does not.' },
  'prompt-regression': { kind: 'none', reason: 'A testing technique rather than a published specification. The field moves quickly, but not as numbered editions anybody publishes.' },
  'model-routing': { kind: 'none', reason: 'A testing technique rather than a published specification. The field moves quickly, but not as numbered editions anybody publishes.' },
  'guardrail': { kind: 'none', reason: 'A testing technique rather than a published specification. The field moves quickly, but not as numbered editions anybody publishes.' },
  'agent-collaboration': { kind: 'none', reason: 'A testing technique rather than a published specification. The field moves quickly, but not as numbered editions anybody publishes.' },
  'determinism-boundary': { kind: 'none', reason: 'A testing technique rather than a published specification. The field moves quickly, but not as numbered editions anybody publishes.' },
  'iso-27001': { kind: 'tracked', name: 'ISO/IEC 27001', edition: '2022', verifiedAt: '2026-09-04', publishedUrl: 'https://www.iso.org/standard/27001' },
  'soc2': { kind: 'tracked', name: 'AICPA Trust Services Criteria', edition: '2017 (with 2022 points of focus)', verifiedAt: '2026-09-04', publishedUrl: 'https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2' },
  'gdpr': { kind: 'tracked', name: 'Regulation (EU) 2016/679', edition: '2016', verifiedAt: '2026-09-04', publishedUrl: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj' },
  'hipaa': { kind: 'tracked', name: 'HIPAA Security Rule, 45 CFR Part 164', edition: '2013 Omnibus', verifiedAt: '2026-09-04', publishedUrl: 'https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164' },
  'pci-dss': { kind: 'tracked', name: 'PCI DSS', edition: '4.0.1', verifiedAt: '2026-09-04', publishedUrl: 'https://www.pcisecuritystandards.org/document_library/' },
  'nist-800-53': { kind: 'tracked', name: 'NIST SP 800-53', edition: 'Rev. 5', verifiedAt: '2026-09-04', publishedUrl: 'https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final' },
  'change-management': { kind: 'none', reason: 'An internal control rather than a published standard of its own. An assessor examines it under whichever regime is in scope — ISO 27001, SOC 2 — which do carry editions.' },
  'audit-trail': { kind: 'none', reason: 'An internal control rather than a published standard of its own. An assessor examines it under whichever regime is in scope — ISO 27001, SOC 2 — which do carry editions.' },
  'rbac-compliance': { kind: 'none', reason: 'An internal control rather than a published standard of its own. An assessor examines it under whichever regime is in scope — ISO 27001, SOC 2 — which do carry editions.' },
  'data-retention': { kind: 'none', reason: 'An internal control rather than a published standard of its own. An assessor examines it under whichever regime is in scope — ISO 27001, SOC 2 — which do carry editions.' },
  'sbom': { kind: 'tracked', name: 'CycloneDX', edition: '1.6', verifiedAt: '2026-09-04', publishedUrl: 'https://cyclonedx.org/specification/overview/' },
  'dependency-licensing': { kind: 'tracked', name: 'SPDX License List', edition: '3.25', verifiedAt: '2026-09-04', publishedUrl: 'https://spdx.org/licenses/' },
  'license-compatibility': { kind: 'tracked', name: 'SPDX License List', edition: '3.25', verifiedAt: '2026-09-04', publishedUrl: 'https://spdx.org/licenses/' },
  'secure-build-pipeline': { kind: 'tracked', name: 'SLSA', edition: 'v1.0', verifiedAt: '2026-09-04', publishedUrl: 'https://slsa.dev/spec/v1.0/' },
  'ai-safety-compliance': { kind: 'tracked', name: 'EU AI Act, Regulation (EU) 2024/1689', edition: '2024', verifiedAt: '2026-09-04', publishedUrl: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj' },
  'model-output-risk': { kind: 'none', reason: 'No single published standard governs this yet. The EU AI Act obligations that touch it are tracked under ai-safety-compliance.' },
  'bias-fairness': { kind: 'none', reason: 'No single published standard governs this yet. The EU AI Act obligations that touch it are tracked under ai-safety-compliance.' },
  'explainability': { kind: 'none', reason: 'No single published standard governs this yet. The EU AI Act obligations that touch it are tracked under ai-safety-compliance.' },
  'ai-data-policy': { kind: 'none', reason: 'No single published standard governs this yet. The EU AI Act obligations that touch it are tracked under ai-safety-compliance.' },
  'financial-compliance': { kind: 'tracked', name: 'DORA, Regulation (EU) 2022/2554', edition: '2022', verifiedAt: '2026-09-04', publishedUrl: 'https://eur-lex.europa.eu/eli/reg/2022/2554/oj' },
  'medical-compliance': { kind: 'tracked', name: 'IEC 62304', edition: '2006 + AMD1:2015', verifiedAt: '2026-09-04', publishedUrl: 'https://www.iso.org/standard/64686.html' },
  'automotive-compliance': { kind: 'tracked', name: 'ISO 26262', edition: '2018', verifiedAt: '2026-09-04', publishedUrl: 'https://www.iso.org/standard/68383.html' },
  'aviation-compliance': { kind: 'tracked', name: 'RTCA DO-178C', edition: '2011', verifiedAt: '2026-09-04', publishedUrl: 'https://www.rtca.org/' },
  'energy-compliance': { kind: 'tracked', name: 'NERC CIP', edition: 'CIP-002 to CIP-013, Version 5/6 family', verifiedAt: '2026-09-04', publishedUrl: 'https://www.nerc.com/pa/Stand/Pages/CIPStandards.aspx' },
};

export function standardTrackingFor(id: TestingMethodologyId): StandardTracking | undefined {
  return METHODOLOGY_STANDARDS[id];
}

/**
 * Is this verification old enough to be worth repeating?
 *
 * A known-newer edition counts as stale immediately, whatever the date says:
 * the point is not how long ago somebody looked but whether what they found
 * still holds.
 */
export function isStandardStale(
  tracking: StandardTracking | undefined,
  now: Date = new Date(),
): boolean {
  if (!tracking || tracking.kind !== 'tracked') {
    return false;
  }
  if (tracking.supersededBy) {
    return true;
  }
  const verified = Date.parse(tracking.verifiedAt);
  if (!Number.isFinite(verified)) {
    // An unreadable date is not a recent one. Unknown is never current.
    return true;
  }
  const horizon = new Date(verified);
  horizon.setMonth(horizon.getMonth() + STANDARD_VERIFICATION_HORIZON_MONTHS);
  return now.getTime() > horizon.getTime();
}

/** One line for a card or a mirror header. Never claims more than it knows. */
export function describeStandardTracking(
  tracking: StandardTracking | undefined,
  now: Date = new Date(),
): string {
  if (!tracking) {
    return 'No edition is recorded for this methodology.';
  }
  if (tracking.kind === 'none') {
    return tracking.reason;
  }
  const base = `Modelled against ${tracking.name} ${tracking.edition}. `
    + `Last checked ${tracking.verifiedAt.slice(0, 10)}.`;
  if (tracking.supersededBy) {
    return `${base} ${tracking.supersededBy.edition} was published on `
      + `${tracking.supersededBy.publishedOn.slice(0, 10)} and is not modelled here yet.`;
  }
  return isStandardStale(tracking, now)
    ? `${base} That is more than ${STANDARD_VERIFICATION_HORIZON_MONTHS} months ago — worth confirming it is still the current edition.`
    : base;
}
