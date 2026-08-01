/**
 * The research digest — three questions, in a fixed order, answered from the
 * register and nothing else.
 *
 * 1. What changed outside?
 * 2. What does it mean for what we are building?
 * 3. What is still unassessed?
 *
 * **Question 3 is always rendered, including when it is empty.** Dropping it
 * because it is inconvenient is precisely how a digest starts congratulating you
 * for not looking, and the third question is the only one that can say "you have
 * never checked whether anyone is regulating this".
 *
 * **No model is in this path.** The plan left the "so what" open between a fenced
 * model reading and a declared table; this is the declared table. The deciding
 * argument is that the same register must produce the same digest — that is what
 * makes it reviewable, diffable in git, and safe to skim. A generated paragraph
 * is a claim nobody checked, sitting in a committed file, attributed to the
 * project. Each scan's `implication` is written once in the catalog, published,
 * and arguable; a caller that still wants a model's opinion can ask for one and
 * show it fenced, unpersisted, the way `agentHandoff` does.
 *
 * **Question 1 is a delta, so it obeys the delta rules.** `observedDelta` already
 * catalogued the five ways a "what changed" report lies, and every one of them
 * applies here with a sharper edge, because the subject is the outside world
 * rather than the working tree:
 *
 * 1. *No baseline is a first look* — not eighteen changes, at the exact moment
 *    somebody decides whether to trust this.
 * 2. *Unknown to known is not zero to n.* A competition scan going from never-run
 *    to twelve findings is not twelve competitors appearing. This is the rule
 *    most likely to be broken by accident and the most alarming when it is.
 * 3. *Known to unknown is news*, ranked above the movement it hides — a scan that
 *    can no longer run explains the silence underneath it.
 * 4. *A changed scope discards the baseline* rather than subtracting two
 *    unrelated readings.
 * 5. *Never report your own actions back.* Findings the user dismissed or
 *    actioned since the baseline are not "changes outside"; reporting them trains
 *    people to ignore the section.
 *
 * Ranking is by consequence rather than magnitude, with declaration order
 * breaking ties so the digest cannot shuffle between renders. Caps state their
 * remainder.
 *
 * Pure and clock-injected.
 */

import {
  RESEARCH_SCANS,
  researchScan,
  type ResearchScanId,
  type ResearchSeverity,
} from './researchScanCatalog.js';
import {
  hasBeenScanned,
  lastRunFor,
  openResearchFindings,
  researchQuestions,
  type ResearchFinding,
  type ResearchRegister,
} from './researchRegister.js';
import type { ResearchSchedule } from './researchSchedule.js';

/** Lines shown per section before the remainder is stated. */
export const MAX_DIGEST_LINES = 8;

export interface ResearchDigestBaseline {
  readonly takenAt: string;
  /** Finding ids known when the baseline was taken. */
  readonly knownFindingIds: readonly string[];
  /** Scans that had produced an answer at that point. */
  readonly assessedScans: readonly ResearchScanId[];
  /**
   * What the baseline was taken against. A different project is a different
   * question, and subtracting two unrelated readings would invent movement.
   */
  readonly scope: string;
}

export interface ResearchDigestLine {
  readonly text: string;
  readonly severity?: ResearchSeverity;
  readonly scanId?: ResearchScanId;
  /** The finding this line came from, so every claim is traceable. */
  readonly findingId?: string;
}

export type ResearchDigestStatus = 'first-look' | 'scope-changed' | 'compared';

export interface ResearchDigest {
  readonly status: ResearchDigestStatus;
  readonly changed: readonly ResearchDigestLine[];
  readonly meaning: readonly ResearchDigestLine[];
  readonly unassessed: readonly ResearchDigestLine[];
  readonly droppedByCap: number;
  readonly summary: string;
  readonly nextBaseline: ResearchDigestBaseline;
}

export interface ResearchDigestInput {
  readonly register: ResearchRegister;
  readonly schedule: ResearchSchedule;
  readonly baseline?: ResearchDigestBaseline;
  /** Project identity. A change discards the baseline rather than subtracting. */
  readonly scope: string;
  readonly now: Date;
}

const SEVERITY_ORDER: Readonly<Record<ResearchSeverity, number>> = { high: 0, medium: 1, low: 2 };

function catalogIndex(scanId: ResearchScanId): number {
  return RESEARCH_SCANS.findIndex(scan => scan.id === scanId);
}

/** Consequence, then catalog order. Never magnitude. */
function rankFindings(a: ResearchFinding, b: ResearchFinding): number {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || catalogIndex(a.scanId) - catalogIndex(b.scanId)
    || a.id.localeCompare(b.id);
}

export function buildResearchDigest(input: ResearchDigestInput): ResearchDigest {
  const open = openResearchFindings(input.register);
  const baseline = input.baseline?.scope === input.scope ? input.baseline : undefined;
  const status: ResearchDigestStatus = input.baseline === undefined
    ? 'first-look'
    : baseline === undefined
      ? 'scope-changed'
      : 'compared';

  const changed: ResearchDigestLine[] = [];
  let dropped = 0;

  // ── Rule 3, first: a scan that can no longer run explains the quiet under it ──
  for (const scan of input.schedule.scans) {
    const wasAssessed = baseline?.assessedScans.includes(scan.scanId) ?? false;
    if (wasAssessed && scan.state === 'blocked') {
      changed.push({
        text: `The ${scan.label.toLowerCase()} scan can no longer run — ${scan.blocker ?? 'it is blocked'} `
          + 'Anything it would have found is unknown rather than absent.',
        scanId: scan.scanId,
        severity: 'high',
      });
    }
  }

  if (status === 'compared' && baseline) {
    const known = new Set(baseline.knownFindingIds);
    const assessed = new Set(baseline.assessedScans);

    // ── Rule 2: unknown → known is a first assessment, not an appearance ──
    for (const scan of RESEARCH_SCANS) {
      if (assessed.has(scan.id) || !hasBeenScanned(input.register, scan.id)) {
        continue;
      }
      const count = open.filter(finding => finding.scanId === scan.id).length;
      changed.push({
        text: `${scan.label} was assessed for the first time: ${count} open finding${count === 1 ? '' : 's'}. `
          + 'These were not new developments — they were simply never looked for before.',
        scanId: scan.id,
        severity: count > 0 ? 'medium' : 'low',
      });
    }

    // ── Genuinely new, from scans that had already been assessed ──
    // Rule 5 lives here by omission: only `open` findings are considered, so a
    // finding the user dismissed or actioned is never reported back at them.
    const fresh = open
      .filter(finding => !known.has(finding.id) && assessed.has(finding.scanId))
      .sort(rankFindings);
    for (const finding of fresh) {
      changed.push({
        text: `${researchScan(finding.scanId).label}: ${finding.title}`,
        severity: finding.severity,
        scanId: finding.scanId,
        findingId: finding.id,
      });
    }

    // A finding that stopped being reproduced is movement too, and quieter.
    const gone = input.register.findings.filter(finding =>
      finding.status === 'superseded'
      && known.has(finding.id)
      && Date.parse(finding.lastSeenAt) < Date.parse(baseline.takenAt));
    for (const finding of gone.sort(rankFindings)) {
      changed.push({
        text: `No longer reproduced: ${finding.title}`,
        severity: 'low',
        scanId: finding.scanId,
        findingId: finding.id,
      });
    }
  } else {
    // ── Rule 1: no baseline is a first look, and says so ──
    const headline = status === 'scope-changed'
      ? 'The project this baseline was taken against has changed, so the previous reading was discarded '
        + 'rather than subtracted. This is a first look at the new one.'
      : 'This is the first digest, so nothing here is a change — it is what the register currently holds.';
    changed.push({ text: headline });
    for (const finding of [...open].sort(rankFindings)) {
      changed.push({
        text: `${researchScan(finding.scanId).label}: ${finding.title}`,
        severity: finding.severity,
        scanId: finding.scanId,
        findingId: finding.id,
      });
    }
  }

  const changedShown = changed.slice(0, MAX_DIGEST_LINES);
  dropped += changed.length - changedShown.length;

  // ── Question 2, from the declared implication table ──
  const meaning: ResearchDigestLine[] = [];
  const byScan = new Map<ResearchScanId, ResearchFinding[]>();
  for (const finding of open) {
    const bucket = byScan.get(finding.scanId) ?? [];
    bucket.push(finding);
    byScan.set(finding.scanId, bucket);
  }
  const scanOrder = [...byScan.keys()].sort((a, b) => {
    const worstA = Math.min(...byScan.get(a)!.map(finding => SEVERITY_ORDER[finding.severity]));
    const worstB = Math.min(...byScan.get(b)!.map(finding => SEVERITY_ORDER[finding.severity]));
    return worstA - worstB || catalogIndex(a) - catalogIndex(b);
  });
  for (const scanId of scanOrder) {
    const findings = byScan.get(scanId)!.sort(rankFindings);
    const scan = researchScan(scanId);
    const high = findings.filter(finding => finding.severity === 'high').length;
    meaning.push({
      text: `**${scan.label}** — ${scan.implication} `
        + `${findings.length} open finding${findings.length === 1 ? '' : 's'}`
        + `${high > 0 ? `, ${high} graded high` : ''}.`,
      scanId,
      ...(findings[0] ? { severity: findings[0].severity, findingId: findings[0].id } : {}),
    });
  }
  const meaningShown = meaning.slice(0, MAX_DIGEST_LINES);
  dropped += meaning.length - meaningShown.length;

  // ── Question 3, always rendered ──
  const unassessed: ResearchDigestLine[] = [];
  for (const scan of RESEARCH_SCANS) {
    if (hasBeenScanned(input.register, scan.id)) {
      continue;
    }
    const run = lastRunFor(input.register, scan.id);
    const why = run?.outcome === 'no-source'
      ? 'attempted, but no research source could answer it'
      : run?.outcome === 'failed'
        ? 'attempted and failed'
        : 'never run';
    unassessed.push({ text: `**${scan.label}** — ${why}. ${scan.question}`, scanId: scan.id });
  }
  for (const run of input.register.runs) {
    if (run.unassessed) {
      unassessed.push({
        text: `**${researchScan(run.scanId).label}** ran but could not assess: ${run.unassessed}`,
        scanId: run.scanId,
      });
    }
  }
  const questionCount = researchQuestions(input.register).length;
  if (questionCount > 0) {
    unassessed.push({
      text: `${questionCount} claim${questionCount === 1 ? '' : 's'} recorded without a source. `
        + 'Held as questions to research, deliberately not counted as evidence.',
    });
  }

  return {
    status,
    changed: changedShown,
    meaning: meaningShown,
    // Never capped. A truncated list of what nobody looked at is the one place a
    // cap would defeat the section's purpose.
    unassessed,
    droppedByCap: dropped,
    summary: summarizeDigest(status, changedShown.length, meaningShown.length, unassessed.length),
    nextBaseline: {
      takenAt: input.now.toISOString(),
      knownFindingIds: input.register.findings.map(finding => finding.id),
      assessedScans: RESEARCH_SCANS
        .filter(scan => hasBeenScanned(input.register, scan.id))
        .map(scan => scan.id),
      scope: input.scope,
    },
  };
}

function summarizeDigest(
  status: ResearchDigestStatus,
  changed: number,
  meaning: number,
  unassessed: number,
): string {
  if (status !== 'compared') {
    return status === 'first-look'
      ? `First look: ${meaning} area${meaning === 1 ? '' : 's'} with open findings, ${unassessed} unassessed.`
      : `Baseline discarded — the project changed. ${unassessed} unassessed.`;
  }
  if (changed === 0 && unassessed === 0) {
    return 'Nothing changed outside, and everything is assessed.';
  }
  const parts: string[] = [];
  if (changed > 0) {
    parts.push(`${changed} change${changed === 1 ? '' : 's'} outside`);
  }
  if (unassessed > 0) {
    parts.push(`${unassessed} still unassessed`);
  }
  return parts.join(', ') + '.';
}

/**
 * The digest as markdown.
 *
 * Rolling rather than dated: git already keeps the previous one, and a folder of
 * dated reports is a folder nobody opens. The three headings are always present.
 */
export function renderResearchDigestMarkdown(digest: ResearchDigest, now: Date): string {
  const lines: string[] = [
    '# Research digest',
    '',
    '> Generated by AtlasMind from the research register. Deterministic: the same register produces',
    '> the same digest. No claim here was written by a model — every line traces to a recorded',
    '> finding, and every finding carries the URL it came from.',
    '',
    `_${now.toISOString()}_`,
    '',
    `**${digest.summary}**`,
    '',
    '## 1. What changed outside',
    '',
  ];
  if (digest.changed.length === 0) {
    lines.push('_Nothing._', '');
  } else {
    for (const line of digest.changed) {
      lines.push(`- ${line.text}${line.severity ? ` \`${line.severity}\`` : ''}`);
    }
    lines.push('');
  }

  lines.push('## 2. What it means for what we are building', '');
  if (digest.meaning.length === 0) {
    lines.push('_No open findings, so nothing to weigh._', '');
  } else {
    for (const line of digest.meaning) {
      lines.push(`- ${line.text}`);
    }
    lines.push('');
  }

  lines.push('## 3. What is still unassessed', '');
  if (digest.unassessed.length === 0) {
    lines.push('_Every declared scan has produced an answer._', '');
  } else {
    for (const line of digest.unassessed) {
      lines.push(`- ${line.text}`);
    }
    lines.push('');
  }

  if (digest.droppedByCap > 0) {
    lines.push(
      `_${digest.droppedByCap} further line${digest.droppedByCap === 1 ? '' : 's'} not shown. `
      + 'The register holds all of them._',
      '',
    );
  }
  return lines.join('\n');
}
