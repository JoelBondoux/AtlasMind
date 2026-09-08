/**
 * What is publicly known to be wrong with this project's code and its
 * dependencies — the advisory feed behind the Security page.
 *
 * The page could say whether a `SECURITY.md` exists and which dependency
 * monitors are configured. It could not say whether any of them had *found*
 * anything, so a repository with eleven open vulnerability alerts and one with
 * none looked identical: four green governance cards either way.
 *
 * Six rules.
 *
 * **Severity comes from the publisher, never re-graded here.** GitHub's
 * advisory database and CodeQL both ship a severity; inventing a local score
 * would produce a number nobody else's tooling agrees with, and an alert that
 * reads `low` here and `critical` in the security tab is worse than no number.
 * An advisory with no severity stays `unknown` rather than defaulting to
 * something reassuring.
 *
 * **A dismissal is a decision, not a fix.** Dismissed alerts are counted apart
 * and never folded into anything that reads as resolved: somebody deciding a
 * finding does not apply here is a fact about the *decision*, and rolling it in
 * with fixed ones would let a project dismiss its way to a clean board.
 *
 * **Unassessed is not clean.** A source that was not read says so. Zero open is
 * claimed only where something actually looked, because "no vulnerabilities"
 * and "nobody checked" are the two states this surface must never confuse.
 *
 * **A feature that is switched off is a finding, not an absence.** A repository
 * with Dependabot alerts disabled is reported as *disabled* — that is a
 * decision somebody can change, and showing it as an empty list would make the
 * riskiest configuration look like the safest one.
 *
 * **The text is third-party and treated as such**: control characters stripped,
 * lengths clamped, counts capped, non-`https` links dropped, and nothing here
 * throws — a malformed feed yields fewer items, never a broken page.
 *
 * **Ranked by consequence, capped, with the remainder stated.** Critical before
 * high before the rest, dependency and code findings interleaved by severity
 * rather than grouped by source, because the severity is the thing that decides
 * what gets looked at first.
 *
 * Pure — no `fs`, no network, no clock. The caller runs `gh` and hands the text
 * in; nothing here decides when to look.
 */

export type AdvisorySource = 'dependency' | 'code-scanning';

export type AdvisorySeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export type AdvisorySourceState = 'ready' | 'disabled' | 'not-assessed' | 'failed';

export type AdvisoryFeedRuleId =
  | 'severity-from-the-publisher'
  | 'dismissed-is-a-decision'
  | 'unassessed-is-not-clean'
  | 'disabled-is-a-finding'
  | 'untrusted-text'
  | 'ranked-and-capped';

export interface AdvisoryFeedRule {
  id: AdvisoryFeedRuleId;
  description: string;
}

/** Published with every feed, so the surface shows the rules that graded it. */
export const ADVISORY_FEED_RULES: readonly AdvisoryFeedRule[] = [
  {
    id: 'severity-from-the-publisher',
    description: 'Severity is GitHub\'s or CodeQL\'s, never re-graded here. An advisory with none stays unknown rather than defaulting to something reassuring.',
  },
  {
    id: 'dismissed-is-a-decision',
    description: 'A dismissed alert is counted apart and never folded into anything that reads as fixed. Otherwise a project can dismiss its way to a clean board.',
  },
  {
    id: 'unassessed-is-not-clean',
    description: 'A source nobody read says so. Zero open is claimed only where something actually looked.',
  },
  {
    id: 'disabled-is-a-finding',
    description: 'Alerts switched off is reported as switched off. Showing it as an empty list would make the riskiest configuration look like the safest one.',
  },
  {
    id: 'untrusted-text',
    description: 'Advisory text comes from outside the project: it is control-stripped, clamped and capped, non-https links are dropped, and a malformed feed yields fewer items rather than an error.',
  },
  {
    id: 'ranked-and-capped',
    description: 'Ranked by severity across both sources, because severity decides what is looked at first. Capped, with the number not shown stated.',
  },
];

export interface AdvisoryItem {
  source: AdvisorySource;
  /** The alert number as GitHub knows it, so a person can find it again. */
  reference: string;
  severity: AdvisorySeverity;
  /** What the advisory says, clamped. */
  title: string;
  /** The package for a dependency alert; the rule id for a code-scanning one. */
  subject: string;
  /** Manifest path, or file and line. */
  location?: string;
  url?: string;
  /** The first version that carries the fix, where the advisory names one. */
  fixedIn?: string;
}

export interface AdvisoryFeed {
  state: 'ok' | 'not-assessed';
  items: AdvisoryItem[];
  counts: Record<AdvisorySeverity, number>;
  openCount: number;
  /** Alerts somebody dismissed. A decision, never folded into a fix. */
  dismissedCount: number;
  /** Open alerts beyond the cap. Stated rather than silently dropped. */
  notShownCount: number;
  dependencyState: AdvisorySourceState;
  codeScanningState: AdvisorySourceState;
  /** Why the reading is incomplete, when it is. */
  note?: string;
  rules: readonly AdvisoryFeedRule[];
}

const MAX_ITEMS = 12;
const MAX_TEXT = 180;
const MAX_INPUT_ALERTS = 500;

const SEVERITY_RANK: Record<AdvisorySeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, unknown: 4,
};

/** Control characters out, whitespace collapsed, length clamped. */
function clean(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== 'string') { return ''; }
  const stripped = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
}

/**
 * A link only when it is `https`.
 *
 * These are rendered as clickable, and an advisory feed is exactly the sort of
 * text somebody would like you to click something in.
 */
function safeUrl(value: unknown): string | undefined {
  const candidate = clean(value, 400);
  if (!candidate) { return undefined; }
  try {
    return new URL(candidate).protocol === 'https:' ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function severityOf(value: unknown): AdvisorySeverity {
  const raw = typeof value === 'string' ? value.toLowerCase().trim() : '';
  switch (raw) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'medium':
    case 'moderate': return 'medium';
    case 'low':
    case 'note':
    case 'warning': return raw === 'low' ? 'low' : raw === 'warning' ? 'medium' : 'low';
    // Anything else — including an empty string, and any word a future GitHub
    // release invents — is unknown. Guessing in the reassuring direction is the
    // one guess this module must never make.
    default: return 'unknown';
  }
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.slice(0, MAX_INPUT_ALERTS) : [];
  } catch {
    return [];
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export interface ParsedAlerts {
  open: AdvisoryItem[];
  dismissed: number;
}

/**
 * `gh api repos/{slug}/dependabot/alerts` as items.
 *
 * Never throws: a body that is not the expected shape yields nothing, which the
 * caller reports as a failed read rather than as a clean repository.
 */
export function parseDependabotAlerts(raw: string): ParsedAlerts {
  const open: AdvisoryItem[] = [];
  let dismissed = 0;

  for (const entry of parseJsonArray(raw)) {
    const alert = record(entry);
    const state = clean(alert['state'], 40).toLowerCase();
    if (state === 'dismissed') { dismissed += 1; continue; }
    // `fixed` and `auto_dismissed` are history, not work: the surface is about
    // what is open now, and a fixed alert on the board is noise that makes the
    // open ones harder to see.
    if (state !== 'open') { continue; }

    const advisory = record(alert['security_advisory']);
    const vulnerability = record(alert['security_vulnerability']);
    const dependency = record(alert['dependency']);
    const packageRecord = record(vulnerability['package'] ?? record(dependency['package']));
    const patched = record(vulnerability['first_patched_version']);
    const number = clean(alert['number'] ?? '', 20) || clean(String(alert['number'] ?? ''), 20);

    open.push({
      source: 'dependency',
      reference: number || '?',
      severity: severityOf(advisory['severity'] ?? vulnerability['severity']),
      title: clean(advisory['summary']) || 'Advisory with no summary',
      subject: clean(packageRecord['name'], 80) || 'unknown package',
      ...(clean(dependency['manifest_path'], 200) ? { location: clean(dependency['manifest_path'], 200) } : {}),
      ...(safeUrl(alert['html_url']) ? { url: safeUrl(alert['html_url']) as string } : {}),
      ...(clean(patched['identifier'], 60) ? { fixedIn: clean(patched['identifier'], 60) } : {}),
    });
  }

  return { open, dismissed };
}

/**
 * `gh api repos/{slug}/code-scanning/alerts` as items.
 *
 * The rule id is the subject rather than the message, because the id is what a
 * person searches for and what a dismissal is recorded against.
 */
export function parseCodeScanningAlerts(raw: string): ParsedAlerts {
  const open: AdvisoryItem[] = [];
  let dismissed = 0;

  for (const entry of parseJsonArray(raw)) {
    const alert = record(entry);
    const state = clean(alert['state'], 40).toLowerCase();
    if (state === 'dismissed') { dismissed += 1; continue; }
    if (state !== 'open') { continue; }

    const rule = record(alert['rule']);
    const instance = record(alert['most_recent_instance']);
    const location = record(record(instance['location']));
    const path = clean(location['path'], 200);
    const line = Number(location['start_line']);
    const number = clean(String(alert['number'] ?? ''), 20);

    open.push({
      source: 'code-scanning',
      reference: number || '?',
      // Security severity where the rule carries one — `rule.severity` is
      // `warning`/`error`, which is a lint grade rather than a risk grade.
      severity: severityOf(rule['security_severity_level'] ?? rule['severity']),
      title: clean(record(instance['message'])['text'] ?? rule['description']) || 'Finding with no description',
      subject: clean(rule['id'], 80) || 'unknown rule',
      ...(path ? { location: Number.isFinite(line) && line > 0 ? `${path}:${line}` : path } : {}),
      ...(safeUrl(alert['html_url']) ? { url: safeUrl(alert['html_url']) as string } : {}),
    });
  }

  return { open, dismissed };
}

export interface AdvisoryFeedInput {
  /** Absent means nobody read it — never the same as an empty result. */
  dependency?: { state: AdvisorySourceState; alerts?: ParsedAlerts };
  codeScanning?: { state: AdvisorySourceState; alerts?: ParsedAlerts };
}

/** The feed the Security page renders. */
export function buildAdvisoryFeed(input: AdvisoryFeedInput = {}): AdvisoryFeed {
  const dependencyState = input.dependency?.state ?? 'not-assessed';
  const codeScanningState = input.codeScanning?.state ?? 'not-assessed';

  const collected = [
    ...(dependencyState === 'ready' ? input.dependency?.alerts?.open ?? [] : []),
    ...(codeScanningState === 'ready' ? input.codeScanning?.alerts?.open ?? [] : []),
  ];
  const dismissedCount = (dependencyState === 'ready' ? input.dependency?.alerts?.dismissed ?? 0 : 0)
    + (codeScanningState === 'ready' ? input.codeScanning?.alerts?.dismissed ?? 0 : 0);

  // Interleaved by severity rather than grouped by source: severity is what
  // decides what somebody looks at first, and grouping would bury a critical
  // dependency alert under a page of medium code findings.
  const ranked = [...collected].sort((left, right) =>
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || left.source.localeCompare(right.source)
    || left.reference.localeCompare(right.reference));

  const counts: Record<AdvisorySeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const item of ranked) { counts[item.severity] += 1; }

  const anyRead = dependencyState === 'ready' || codeScanningState === 'ready';

  return {
    state: anyRead ? 'ok' : 'not-assessed',
    items: ranked.slice(0, MAX_ITEMS),
    counts,
    openCount: ranked.length,
    dismissedCount,
    notShownCount: Math.max(0, ranked.length - MAX_ITEMS),
    dependencyState,
    codeScanningState,
    ...(noteFor(dependencyState, codeScanningState) === undefined
      ? {}
      : { note: noteFor(dependencyState, codeScanningState) as string }),
    rules: ADVISORY_FEED_RULES,
  };
}

function describeSource(state: AdvisorySourceState, label: string): string | undefined {
  switch (state) {
    case 'disabled':
      // A finding in its own right: it is a setting somebody can change, and an
      // empty list would make the riskiest configuration look like the safest.
      return `${label} is switched off for this repository, so nothing is being checked.`;
    case 'not-assessed':
      return `${label} was not read, so this says nothing about it.`;
    case 'failed':
      return `${label} could not be read.`;
    default:
      return undefined;
  }
}

function noteFor(dependency: AdvisorySourceState, codeScanning: AdvisorySourceState): string | undefined {
  const parts = [
    describeSource(dependency, 'Dependency alerts'),
    describeSource(codeScanning, 'Code scanning'),
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(' ');
}

/** One sentence for the card header. */
export function describeAdvisoryFeed(feed: AdvisoryFeed): string {
  if (feed.state === 'not-assessed') {
    return 'No advisories have been read, so nothing here says this project is clear.';
  }
  if (feed.openCount === 0) {
    const dismissed = feed.dismissedCount > 0
      ? ` ${feed.dismissedCount} dismissed ${feed.dismissedCount === 1 ? 'alert stands' : 'alerts stand'} as a decision rather than a fix.`
      : '';
    return `Nothing open in what was read.${dismissed}`;
  }
  const serious = feed.counts.critical + feed.counts.high;
  return `${feed.openCount} open advisor${feed.openCount === 1 ? 'y' : 'ies'}`
    + (serious > 0 ? `, ${serious} critical or high` : ', none critical or high')
    + (feed.dismissedCount > 0 ? `, and ${feed.dismissedCount} dismissed by decision.` : '.');
}
