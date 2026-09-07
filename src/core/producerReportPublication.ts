/**
 * What may leave the machine, decided before anything is published.
 *
 * The producer's report is useful precisely because it can be sent to somebody
 * — and that is also the whole risk. **A GitHub Pages site is public by default
 * even when the repository is private**; restricting access is a GitHub
 * Enterprise Cloud feature. So on a free or Pro account, "publish the report"
 * means publish to the open internet, and the report can carry stakeholder
 * names and assignments, a register of commercial, legal and ethical findings,
 * and — if cost history is set to `repository` — what the project has spent.
 *
 * `projectDirectorManager` goes out of its way *not* to hoard personal data,
 * preferring a reference it resolves on demand. Publishing that section to a
 * public URL would undo it in one step, which is why this module exists as a
 * gate rather than as a rendering option.
 *
 * Five rules.
 *
 * **Deny by default, per section.** Publishing is off until switched on, and
 * turning it on publishes only what a client actually asks for: roadmap progress
 * by gate, and delivery readiness. People, risks and money each need their own
 * switch.
 *
 * **Withholding is reported, never silent.** A published page that quietly drops
 * its cost section looks like a project that spent nothing. Every withheld
 * section is named in the result so the page can say *this section is not
 * published* — the same rule the report itself follows for a section it could
 * not gather.
 *
 * **A private repository gets a different warning, not a quieter one.** GitHub's
 * default says *publish publicly*; somebody who made their repository private
 * has already expressed the opposite. Where those disagree, saying so in plain
 * words is the minimum.
 *
 * **Unknown visibility is treated as public.** If we could not determine whether
 * the repository is private, the safe assumption is the one that keeps a secret
 * — which here means assuming the page will be world-readable and warning
 * accordingly.
 *
 * **This module never publishes anything.** It returns a decision. The caller
 * confirms and acts, so a policy change cannot become a publication.
 *
 * Pure: no `vscode`, no `fs`, no network, no clock.
 */

import type { ProducerReportData } from './producerReport.js';

/** The sections a reader can be given, each independently switchable. */
export type PublishableSection = 'gates' | 'delivery' | 'risks' | 'cost';

export interface PublicationSettings {
  /** Master switch. Nothing publishes while this is false. */
  enabled: boolean;
  /** Sections explicitly switched on, beyond the always-safe defaults. */
  sections: Partial<Record<PublishableSection, boolean>>;
}

/**
 * Sections published when publishing is on and nothing else is configured.
 *
 * Progress and readiness are what a client asks for and neither names a person
 * nor a sum of money. Risks and cost are deliberately absent: they are the two
 * that turn a status page into a disclosure.
 */
export const DEFAULT_PUBLISHED_SECTIONS: readonly PublishableSection[] = ['gates', 'delivery'];

/** Sections that stay off until switched on individually, and why. */
export const SENSITIVE_SECTIONS: Readonly<Record<string, string>> = {
  risks: 'Commercial, legal and ethical findings, with the decisions recorded against them.',
  cost: 'What the project has spent, and on what.',
};

export type RepositoryVisibility = 'public' | 'private' | 'unknown';

export interface PublicationDecision {
  /** True only when the master switch is on and at least one section survives. */
  publish: boolean;
  publishedSections: readonly PublishableSection[];
  /** Named so the page can state the omission rather than appearing complete. */
  withheldSections: readonly PublishableSection[];
  /** Shown before publishing. Never empty when `publish` is true. */
  warnings: readonly string[];
  /** Why nothing is being published, when nothing is. */
  reason?: string;
}

function isOn(settings: PublicationSettings, section: PublishableSection): boolean {
  const explicit = settings.sections[section];
  if (explicit !== undefined) { return explicit; }
  return DEFAULT_PUBLISHED_SECTIONS.includes(section);
}

const ALL_SECTIONS: readonly PublishableSection[] = ['gates', 'delivery', 'risks', 'cost'];

/**
 * What would be published, and what the user must be told first.
 *
 * `visibility` is the repository's, not the page's — the page is public either
 * way, and that gap is the point of the warning.
 */
export function decidePublication(
  settings: PublicationSettings,
  visibility: RepositoryVisibility,
): PublicationDecision {
  if (!settings.enabled) {
    return {
      publish: false,
      publishedSections: [],
      withheldSections: ALL_SECTIONS,
      warnings: [],
      reason: 'Publishing is switched off.',
    };
  }

  const publishedSections = ALL_SECTIONS.filter(section => isOn(settings, section));
  const withheldSections = ALL_SECTIONS.filter(section => !isOn(settings, section));

  if (publishedSections.length === 0) {
    return {
      publish: false,
      publishedSections: [],
      withheldSections,
      warnings: [],
      reason: 'Publishing is on, but every section is switched off.',
    };
  }

  const warnings: string[] = [];

  // Stated for every publication, not only the surprising case: the page is
  // world-readable and that is the fact somebody needs in front of them.
  warnings.push(
    visibility === 'private'
      ? 'This repository is private, but a GitHub Pages site published from it is still readable by anyone '
        + 'with the link — access control requires GitHub Enterprise Cloud. The page will be public.'
      : visibility === 'unknown'
        ? 'The repository\'s visibility could not be determined. Assume the published page is readable by '
          + 'anyone with the link.'
        : 'The published page will be readable by anyone with the link.',
  );

  for (const section of publishedSections) {
    const sensitive = SENSITIVE_SECTIONS[section];
    if (sensitive) {
      warnings.push(`Publishing "${section}" makes this public: ${sensitive}`);
    }
  }

  return { publish: true, publishedSections, withheldSections, warnings };
}

export interface PublishableReport {
  data: ProducerReportData;
  withheldSections: readonly PublishableSection[];
}

/**
 * A copy of the report carrying only the sections cleared for publication.
 *
 * A **copy**: the locally generated report keeps everything, because the person
 * who ran it is entitled to their own project's data. Only the outbound artefact
 * is narrowed.
 *
 * A withheld section becomes `not-assessed` with its entries dropped rather than
 * being deleted from the object, so the rendered page still shows the heading
 * and says something is missing. A page that silently omits cost reads as a
 * project that spent nothing, which is the failure this whole module exists to
 * avoid — and it would be perverse to introduce it here while preventing it
 * everywhere else.
 */
export function buildPublishableReport(
  data: ProducerReportData,
  decision: PublicationDecision,
): PublishableReport {
  const withheld = new Set(decision.withheldSections);
  const blanked = <T>(section: { state: string; entries: readonly T[] }, key: PublishableSection) =>
    withheld.has(key)
      ? { state: 'not-assessed' as const, entries: [] as readonly T[] }
      : section as { state: ProducerReportData['gates']['state']; entries: readonly T[] };

  return {
    data: {
      ...data,
      gates: blanked(data.gates, 'gates'),
      delivery: blanked(data.delivery, 'delivery'),
      risks: blanked(data.risks, 'risks'),
      cost: withheld.has('cost')
        ? { state: 'not-assessed', lines: [] }
        : data.cost,
    },
    withheldSections: decision.withheldSections,
  };
}
