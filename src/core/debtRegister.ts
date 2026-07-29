/**
 * The technical-debt register — stage 7.
 *
 * Taking on debt is often the right call; the metaphor is exact, and borrowing
 * to ship sooner is legitimate. The danger is the interest you pay by forgetting
 * it exists. Recording it is the entire discipline: a solo developer has no
 * colleague who remembers the shortcut, and a studio has no shared memory of it
 * either.
 *
 * Three properties carry the weight, and each exists because the obvious
 * alternative destroys the register's value.
 *
 * **Severity comes from a declared rule table, never from a model.** A score
 * produced last Tuesday is not comparable with one produced today, and
 * comparability is the entire point — a register you cannot sort or age is a
 * list. Every entry names the rule that assigned its severity, so the number can
 * be argued with rather than taken on trust.
 *
 * **Severity does not drift with age.** The obvious feature is to escalate an
 * item the longer it sits, and it is wrong for the same reason: an entry whose
 * severity changed while nothing about the code changed cannot be compared with
 * last month's. Age is reported *alongside* severity as its own fact, and the
 * surface can sort by it.
 *
 * **Entries transition; they are never deleted.** A resolved item is evidence
 * that the work was done. A vanished one is a gap in the record, and a record
 * with gaps is a record nobody can rely on. When evidence disappears without
 * anybody saying they fixed it, the entry becomes `obsolete` rather than
 * `resolved` — because "the line is gone" and "somebody did the work" are
 * different facts and only one of them is an accomplishment.
 *
 * Pure and `vscode`-free; persistence uses node `fs` only.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEBT_SSOT_PATH = 'project_memory/operations/tech-debt.json';
export const DEBT_SUMMARY_SSOT_PATH = 'project_memory/operations/tech-debt.md';

/** Where the debt lives. Engineering domains, deliberately not risk domains. */
export type DebtDomain =
  | 'code'
  | 'test'
  | 'dependency'
  | 'documentation'
  | 'infrastructure'
  | 'security';

export type DebtSeverity = 'low' | 'medium' | 'high';

/**
 * The lifecycle.
 *
 * `resolved` and `obsolete` are deliberately distinct. `resolved` means somebody
 * did the work; `obsolete` means the evidence disappeared and nobody said they
 * fixed it — a file deleted, a function rewritten, a marker moved. Collapsing
 * them would let a register report progress it cannot actually attest to.
 */
export type DebtStatus = 'open' | 'accepted' | 'scheduled' | 'resolved' | 'obsolete';

export interface DebtTransition {
  at: string;
  from: DebtStatus;
  to: DebtStatus;
  note?: string;
}

export interface DebtEntry {
  /** Stable across scans: derived from domain + path + marker, never random. */
  id: string;
  domain: DebtDomain;
  title: string;
  /** Workspace-relative. The register points at evidence, never at a feeling. */
  evidencePath: string;
  evidenceLine?: number;
  detectedAt: string;
  severity: DebtSeverity;
  /** The rule that assigned the severity, so it can be argued with. */
  rule: string;
  status: DebtStatus;
  /** Every status change, in order. The register's memory. */
  transitions: DebtTransition[];
}

export interface DebtRegister {
  version: 1;
  entries: DebtEntry[];
  updatedAt?: string;
  /** When the last scan ran, so a stale register says so. */
  lastScanAt?: string;
}

// ── The declared severity rules ──────────────────────────────────

export interface DebtRule {
  id: string;
  domain: DebtDomain;
  severity: DebtSeverity;
  /** Shown wherever the severity is shown. The rule is the justification. */
  describes: string;
}

/**
 * Severity, by declared rule. Ordered; first match wins.
 *
 * The ordering is part of the contract. `security` is checked first because a
 * security marker is never a medium whatever else it looks like, and a rule
 * table where that depended on which pattern matched first would be a table
 * nobody could reason about.
 *
 * `FIXME`, `HACK` and `XXX` outrank `TODO` on a real distinction rather than
 * folklore: a `FIXME` asserts that something is *wrong*, a `TODO` asserts that
 * something is *absent*. Broken beats missing.
 */
export const DEBT_RULES: readonly DebtRule[] = [
  {
    id: 'security-marker',
    domain: 'security',
    severity: 'high',
    describes: 'A marker mentioning security, a credential, or an injection. Never graded lower whatever else it looks like.',
  },
  {
    id: 'broken-marker',
    domain: 'code',
    severity: 'medium',
    describes: 'A `FIXME`, `HACK` or `XXX`. These assert that something is wrong, which outranks something being absent.',
  },
  {
    id: 'todo-marker',
    domain: 'code',
    severity: 'low',
    describes: 'A `TODO`. Something absent rather than something broken.',
  },
  {
    id: 'stale-dependency-pr',
    domain: 'dependency',
    severity: 'high',
    describes: 'A dependency update open longer than the stale threshold. An unmerged security update is worse than an unopened one, because somebody already decided it mattered.',
  },
  {
    id: 'uncovered-methodology',
    domain: 'test',
    severity: 'medium',
    describes: 'A testing methodology enabled with no evidence it runs. The gap between what a project says it does and what it does.',
  },
  {
    id: 'stale-document',
    domain: 'documentation',
    severity: 'low',
    describes: 'A tracked document past its review baseline. Low because a stale document is usually still mostly true.',
  },
  {
    id: 'missing-ci',
    domain: 'infrastructure',
    severity: 'medium',
    describes: 'No CI workflow. On a solo project CI is not a supplement to review — it is the review.',
  },
];

const RULE_BY_ID = new Map(DEBT_RULES.map(rule => [rule.id, rule]));

export function debtRule(id: string): DebtRule | undefined {
  return RULE_BY_ID.get(id);
}

const SEVERITY_RANK: Record<DebtSeverity, number> = { high: 0, medium: 1, low: 2 };

/**
 * Rank entries for display: severity, then age, then id.
 *
 * Stable and total — the same register always renders in the same order, which
 * is what lets a diff of the markdown mirror mean something. `id` is the final
 * tiebreak precisely because it never changes.
 */
export function sortDebtEntries(entries: readonly DebtEntry[]): DebtEntry[] {
  return [...entries].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    // Oldest first within a severity: the thing that has been ignored longest
    // is the thing most worth looking at.
    if (a.detectedAt !== b.detectedAt) {
      return a.detectedAt < b.detectedAt ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ── Marker scanning ──────────────────────────────────────────────

/**
 * A marker only counts when it *opens a comment*.
 *
 * Two rules, and both were learned by running this scanner over the repository
 * that contains it — which promptly reported its own rule table, its own tests,
 * and the dashboard copy describing the feature, as technical debt.
 *
 * **It must be inside a comment.** `'// TODO: x'` in a test fixture, `TODO` in a
 * regex literal, and `<code>TODO</code>` in a template string are all *data*.
 * Only a comment expresses a deferred decision.
 *
 * **It must be the first word of that comment.** A marker being *discussed* —
 * "a `FIXME` asserts that something is wrong" — is documentation, not debt. Real
 * markers are written at the start: `// TODO: …`, `/* FIXME: … *\/`, `* HACK: …`.
 * Requiring that position costs nothing in recall and removes the entire class
 * of prose false positives.
 *
 * The rule is strict on purpose. A register full of false positives is one
 * people stop reading, which costs more than the entries it would have caught.
 */
/** The markers AtlasMind knows without being told. */
export const BUILT_IN_DEBT_MARKERS = ['TODO', 'FIXME', 'HACK', 'XXX'] as const;

/** How many custom markers a project may declare, and how long each may be. */
export const MAX_CUSTOM_MARKERS = 20;
export const MAX_MARKER_LENGTH = 24;

export interface CustomDebtMarker {
  marker: string;
  severity: DebtSeverity;
}

/**
 * Parse the markers a project declares.
 *
 * Written as `NAME` or `NAME:severity`, because a settings array of strings
 * is something somebody can read and edit in one line; an array of objects is
 * a form. An unqualified marker is `medium` — somebody who bothered to declare
 * a marker is asserting that something is *wrong*, which is the same argument
 * that puts `FIXME` above `TODO`.
 *
 * **Constrained, not cleaned.** A marker becomes part of a regular expression,
 * so `.*` or `(?:` from a settings file would either match every line or throw
 * inside the scanner. The charset here is what makes escaping unnecessary
 * rather than merely careful — but the escape is applied anyway, because a
 * defence that depends on a second function staying strict is not a defence.
 */
export function parseCustomDebtMarkers(value: unknown): CustomDebtMarker[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: CustomDebtMarker[] = [];
  const seen = new Set<string>();
  const builtIn = new Set<string>(BUILT_IN_DEBT_MARKERS);

  for (const entry of value.slice(0, MAX_CUSTOM_MARKERS * 4)) {
    if (typeof entry !== 'string' || out.length >= MAX_CUSTOM_MARKERS) {
      continue;
    }
    const [rawMarker, rawSeverity] = entry.split(':', 2);
    const marker = (rawMarker ?? '').trim().toUpperCase();
    // Letters, digits, underscore and hyphen only. Anything else is either a
    // typo or an attempt to write a pattern.
    if (!/^[A-Z0-9_-]{2,}$/.test(marker) || marker.length > MAX_MARKER_LENGTH) {
      continue;
    }
    // A built-in already has a declared rule with a stated reason. Letting a
    // project redefine `TODO` as high would make two projects' registers
    // incomparable, which is the one thing the rule table exists to prevent.
    if (builtIn.has(marker) || seen.has(marker)) {
      continue;
    }
    seen.add(marker);
    const severity = (rawSeverity ?? '').trim().toLowerCase();
    out.push({
      marker,
      severity: severity === 'low' || severity === 'high' ? severity : 'medium',
    });
  }
  return out;
}

/** The rule id a custom marker grades under. Stable, and greppable. */
export function customMarkerRuleId(marker: string): string {
  return `custom-marker-${marker.toLowerCase()}`;
}

/** True for a rule id this project declared rather than one AtlasMind ships. */
export function isCustomMarkerRule(id: string): boolean {
  return /^custom-marker-[a-z0-9_-]{2,24}$/.test(id);
}

/** The declared rules for a project's own markers, for the mirror and the UI. */
export function customMarkerRules(markers: readonly CustomDebtMarker[]): DebtRule[] {
  return markers.map(entry => ({
    id: customMarkerRuleId(entry.marker),
    domain: 'code' as DebtDomain,
    severity: entry.severity,
    describes: `A \`${entry.marker}\` marker, declared by this project in `
      + '`atlasmind.debt.markers`. Graded where the project put it, so its entries stay '
      + 'comparable with each other over time.',
  }));
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MARKER_AT_COMMENT_START = /^[\s*\-:>]*\b(TODO|FIXME|HACK|XXX)\b\s*[:(-]?\s*(.*)$/;

/**
 * Where a comment starts on this line, or -1.
 *
 * A deliberately small scanner rather than a regex, because the question is
 * "is this delimiter inside a string" and a regex cannot answer it. It tracks
 * quotes and escapes and nothing else — enough to tell a comment from a string
 * literal in every language this scanner reads, and honest about not being a
 * parser.
 */
export function commentStartIndex(line: string): number {
  let quote = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '/' && (line[index + 1] === '/' || line[index + 1] === '*')) {
      return index + 2;
    }
    if (char === '#') {
      return index + 1;
    }
    if (char === '<' && line.startsWith('<!--', index)) {
      return index + 4;
    }
  }
  // A continuation line inside a block comment has no opener of its own; the
  // leading asterisk is the only thing marking it.
  const continuation = /^\s*\*+/.exec(line);
  return continuation ? continuation[0].length : -1;
}

/** Cues that force the security rule regardless of which marker was used. */
const SECURITY_CUES = /\b(security|secret|credential|password|token|auth|injection|xss|csrf|sanitiz|escap)/i;

export interface DebtScanFile {
  /** Workspace-relative path. */
  path: string;
  content: string;
}

export interface DebtScanCandidate {
  domain: DebtDomain;
  title: string;
  evidencePath: string;
  evidenceLine?: number;
  severity: DebtSeverity;
  rule: string;
}

/** How many markers a single file may contribute, so one file cannot flood it. */
export const MAX_MARKERS_PER_FILE = 40;

/**
 * Find debt markers in file contents.
 *
 * Pure: the caller decides which files to read, so this is testable without a
 * workspace and cannot be surprised by one.
 */
export function scanForDebtMarkers(
  files: readonly DebtScanFile[],
  customMarkers: readonly CustomDebtMarker[] = [],
): DebtScanCandidate[] {
  const found: DebtScanCandidate[] = [];
  const custom = new Map(customMarkers.map(entry => [entry.marker, entry]));
  // Built on every call rather than cached: the marker set comes from a
  // setting the user can change between scans, and a cached pattern would
  // quietly keep scanning for the markers they removed.
  const pattern = custom.size === 0
    ? MARKER_AT_COMMENT_START
    : new RegExp(
      String.raw`^[\s*\-:>]*\b(` 
      + [...BUILT_IN_DEBT_MARKERS, ...custom.keys()].map(escapeForRegExp).join('|')
      + String.raw`)\b\s*[:(-]?\s*(.*)$`,
    );

  for (const file of files) {
    let perFile = 0;
    const lines = file.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (perFile >= MAX_MARKERS_PER_FILE) {
        break;
      }
      const line = lines[index]!;
      // A long line is either minified or generated; either way its markers are
      // not somebody's deferred decision.
      if (line.length > 400) {
        continue;
      }
      const commentAt = commentStartIndex(line);
      if (commentAt < 0) {
        continue;
      }
      const match = pattern.exec(line.slice(commentAt));
      if (!match) {
        continue;
      }
      perFile += 1;
      const marker = match[1]!;
      const note = (match[2] ?? '').trim();
      // The security override applies to a project's own markers too. A
      // marker mentioning a credential is a high finding whoever named it —
      // exempting custom markers would let a project downgrade the one grade
      // that is never negotiable, by declaring its own word for it.
      const secure = SECURITY_CUES.test(line);
      const declaredCustom = custom.get(marker);
      const rule = secure
        ? 'security-marker'
        : declaredCustom
          ? customMarkerRuleId(marker)
          : marker === 'TODO' ? 'todo-marker' : 'broken-marker';
      const severity = secure
        ? 'high' as DebtSeverity
        : declaredCustom?.severity ?? RULE_BY_ID.get(rule)!.severity;
      const domain: DebtDomain = secure ? 'security' : 'code';

      found.push({
        domain,
        title: `${marker}${note ? `: ${clampTitle(note)}` : ''}`,
        evidencePath: file.path,
        evidenceLine: index + 1,
        severity,
        rule,
      });
    }
  }

  return found;
}

function clampTitle(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}…` : cleaned;
}

/**
 * A stable id for a candidate.
 *
 * Derived from what identifies the debt — domain, path, and the marker itself —
 * rather than from a counter or a timestamp. That is what lets a rescan
 * *recognise* an entry it has seen before instead of creating a duplicate, and
 * recognition is the difference between a register and a growing pile.
 *
 * The line number is deliberately **not** part of the id: code moves, and an
 * entry that got a new id every time somebody added an import above it would
 * lose its whole history on a whitespace change.
 */
export function debtEntryId(candidate: DebtScanCandidate): string {
  const slug = `${candidate.domain}:${candidate.evidencePath}:${candidate.title}`
    .toLowerCase()
    .replace(/[^a-z0-9:/._-]+/g, '-')
    .replace(/-+/g, '-');
  return slug.length > 160 ? slug.slice(0, 160) : slug;
}

// ── Debt from signals the dashboard already has ──────────────────

/**
 * Whether a pull request is an automated dependency update.
 *
 * Recognised by **author or label**, not by title. Bots rename their own
 * templates between versions, and a title match would silently stop working on
 * an upgrade nobody connected to the change — the sort of failure that is
 * invisible until somebody wonders why a number went to zero.
 */
export function isDependencyPullRequest(pr: {
  author?: string;
  labels?: readonly string[];
  headRefName?: string;
}): boolean {
  const author = (pr.author ?? '').toLowerCase();
  if (author.includes('dependabot') || author.includes('renovate') || author.includes('snyk-bot')) {
    return true;
  }
  if ((pr.labels ?? []).some(label => /^(dependencies|dependency|deps)$/i.test(label.trim()))) {
    return true;
  }
  const head = (pr.headRefName ?? '').toLowerCase();
  return head.startsWith('dependabot/') || head.startsWith('renovate/');
}

/** How long a dependency update may sit before it counts as debt. */
export const STALE_DEPENDENCY_PR_DAYS = 14;

export interface DebtSignalInput {
  now: number;
  /** Merged and open pull requests, already sanitized by the tracker. */
  pullRequests?: readonly {
    number: number;
    title: string;
    state: string;
    author?: string;
    labels?: readonly string[];
    headRefName?: string;
    createdAt: string;
  }[];
  /** Enabled testing methodologies with no evidence they run. */
  uncoveredMethodologies?: readonly { id: string; label: string }[];
  /** Documents past their review baseline. */
  staleDocuments?: readonly { path: string }[];
  /** Whether the repository has any CI workflow at all. */
  ciWorkflowCount?: number;
}

/**
 * Derive debt entries from signals the dashboard already gathered.
 *
 * The marker scan finds what somebody *wrote down*; this finds what the project
 * is doing that nobody wrote down at all — an unmerged dependency update, a
 * testing methodology that is declared and not evidenced, a document past its
 * review date, an absent pipeline. Those are the four things that reliably rot
 * quietly, and none of them leaves a `TODO`.
 *
 * Pure, and it costs nothing: every input is already on the dashboard for
 * another page. Each candidate carries the same declared rule as a scanned one,
 * so a derived entry and a written one are graded by the same table.
 */
export function deriveDebtFromSignals(input: DebtSignalInput): DebtScanCandidate[] {
  const found: DebtScanCandidate[] = [];

  for (const pr of input.pullRequests ?? []) {
    if (pr.state !== 'open' || !isDependencyPullRequest(pr)) {
      continue;
    }
    const created = Date.parse(pr.createdAt);
    if (!Number.isFinite(created)) {
      continue;
    }
    const days = Math.floor((input.now - created) / (24 * 60 * 60 * 1000));
    if (days < STALE_DEPENDENCY_PR_DAYS) {
      continue;
    }
    const rule = RULE_BY_ID.get('stale-dependency-pr')!;
    found.push({
      domain: rule.domain,
      severity: rule.severity,
      rule: rule.id,
      title: `Dependency update #${pr.number} open ${days} days`,
      // The pull request *is* the evidence, and it is the thing a person needs
      // to open. A file path here would point at nothing in particular.
      evidencePath: `.github/pull-request-${pr.number}`,
    });
  }

  for (const methodology of input.uncoveredMethodologies ?? []) {
    const rule = RULE_BY_ID.get('uncovered-methodology')!;
    found.push({
      domain: rule.domain,
      severity: rule.severity,
      rule: rule.id,
      title: `${methodology.label} is enabled with no evidence it runs`,
      evidencePath: 'project_memory/index/testing-config.json',
    });
  }

  for (const document of input.staleDocuments ?? []) {
    const normalized = normalizeEvidencePath(document.path);
    if (!normalized) {
      continue;
    }
    const rule = RULE_BY_ID.get('stale-document')!;
    found.push({
      domain: rule.domain,
      severity: rule.severity,
      rule: rule.id,
      title: 'Past its review baseline',
      evidencePath: normalized,
    });
  }

  if (input.ciWorkflowCount === 0) {
    const rule = RULE_BY_ID.get('missing-ci')!;
    found.push({
      domain: rule.domain,
      severity: rule.severity,
      rule: rule.id,
      title: 'No CI workflow',
      evidencePath: '.github/workflows',
    });
  }

  return found;
}

// ── Reconciling a scan against the register ──────────────────────

export interface DebtReconcileResult {
  register: DebtRegister;
  added: DebtEntry[];
  /** Entries whose evidence has gone, transitioned to `obsolete`. */
  wentObsolete: DebtEntry[];
  /** Entries that were already recorded and still exist. */
  unchanged: number;
  /** Entries a previous run marked resolved that have reappeared. */
  reopened: DebtEntry[];
}

/**
 * Fold a scan into the register.
 *
 * Nothing is deleted. A candidate not previously seen is added; one already
 * present keeps its status and history and only updates its line number, which
 * is the field allowed to move. An entry whose evidence is no longer in the scan
 * transitions to `obsolete` — never to `resolved`, because nobody said they
 * fixed it and a register that inferred accomplishment would be reporting
 * progress it cannot attest to.
 *
 * An entry marked `resolved` whose marker comes back is **reopened**, and that
 * transition is recorded rather than glossed over: work that came undone is one
 * of the more useful things a register can tell you.
 *
 * `scannedPaths` is what makes obsolescence safe. Only entries whose file was
 * actually looked at can go obsolete — a scan of `src/` must never mark
 * everything in `docs/` as gone.
 */
export function reconcileDebtScan(
  register: DebtRegister,
  candidates: readonly DebtScanCandidate[],
  scannedPaths: readonly string[],
  at: string,
): DebtReconcileResult {
  const scanned = new Set(scannedPaths);
  const seen = new Map<string, DebtScanCandidate>();
  for (const candidate of candidates) {
    seen.set(debtEntryId(candidate), candidate);
  }

  const added: DebtEntry[] = [];
  const wentObsolete: DebtEntry[] = [];
  const reopened: DebtEntry[] = [];
  let unchanged = 0;

  const entries = register.entries.map(entry => {
    const match = seen.get(entry.id);
    if (match) {
      seen.delete(entry.id);
      if (entry.status === 'resolved' || entry.status === 'obsolete') {
        const revived: DebtEntry = {
          ...entry,
          status: 'open',
          // The line may have moved; everything else about the entry is what it
          // always was, including when it was first detected.
          ...(match.evidenceLine === undefined ? {} : { evidenceLine: match.evidenceLine }),
          transitions: [...entry.transitions, {
            at,
            from: entry.status,
            to: 'open' as DebtStatus,
            note: 'The evidence reappeared.',
          }],
        };
        reopened.push(revived);
        return revived;
      }
      unchanged += 1;
      return match.evidenceLine === entry.evidenceLine
        ? entry
        : { ...entry, ...(match.evidenceLine === undefined ? {} : { evidenceLine: match.evidenceLine }) };
    }

    // Not in the scan. Only meaningful if the file was actually looked at.
    const wasScanned = scanned.has(entry.evidencePath);
    if (!wasScanned || entry.status === 'obsolete' || entry.status === 'resolved') {
      return entry;
    }
    const gone: DebtEntry = {
      ...entry,
      status: 'obsolete',
      transitions: [...entry.transitions, {
        at,
        from: entry.status,
        to: 'obsolete' as DebtStatus,
        note: 'The evidence is no longer present. Nobody recorded fixing it, so this is not marked resolved.',
      }],
    };
    wentObsolete.push(gone);
    return gone;
  });

  for (const [id, candidate] of seen) {
    const entry: DebtEntry = {
      id,
      domain: candidate.domain,
      title: candidate.title,
      evidencePath: candidate.evidencePath,
      ...(candidate.evidenceLine === undefined ? {} : { evidenceLine: candidate.evidenceLine }),
      detectedAt: at,
      severity: candidate.severity,
      rule: candidate.rule,
      status: 'open',
      transitions: [],
    };
    added.push(entry);
    entries.push(entry);
  }

  return {
    register: { version: 1, entries, updatedAt: at, lastScanAt: at },
    added,
    wentObsolete,
    unchanged,
    reopened,
  };
}

/** Transition one entry, recording the change. Returns a new register. */
export function setDebtStatus(
  register: DebtRegister,
  id: string,
  status: DebtStatus,
  at: string,
  note?: string,
): DebtRegister {
  return {
    ...register,
    updatedAt: at,
    entries: register.entries.map(entry => (entry.id === id && entry.status !== status
      ? {
        ...entry,
        status,
        transitions: [...entry.transitions, {
          at,
          from: entry.status,
          to: status,
          ...(note === undefined ? {} : { note: clampTitle(note) }),
        }],
      }
      : entry)),
  };
}

// ── Telling agents which markers to use ──────────────────────────

/**
 * The instruction an agent needs before it leaves a shortcut behind.
 *
 * An agent that writes temporary code and marks it `@todo`, `NOTE`, or nothing
 * at all has produced debt the register cannot see — and invisible debt is
 * worse than no register, because the register's emptiness now reads as an
 * absence of debt rather than an absence of *detection*. That is the same
 * confident-zero failure this codebase keeps finding, arriving from a direction
 * nobody was watching.
 *
 * Kept short deliberately: this is prepended to every code-writing agent's
 * prompt and to other tools' instruction files, and a paragraph competing for
 * attention with the actual task is a paragraph that gets skimmed.
 *
 * The severities are stated because an agent choosing between `TODO` and
 * `FIXME` is making a grading decision, and it should know it is making one.
 */
export function buildDebtMarkerGuidance(customMarkers: readonly CustomDebtMarker[] = []): string {
  const lines = [
    'When you leave temporary code, a shortcut, or a deferred decision behind, mark it with a',
    'comment beginning with one of these. AtlasMind scans for them and records each one with its',
    'file, its line, and the rule that graded it — anything marked another way is invisible, and an',
    'empty register then reads as "no debt" rather than "not detected".',
    '',
    '- `TODO:` — something absent. Graded low.',
    '- `FIXME:` — something wrong. Graded medium.',
    '- `HACK:` / `XXX:` — works, but not the way it should. Graded medium.',
  ];

  for (const entry of customMarkers) {
    lines.push(`- \`${entry.marker}:\` — declared by this project. Graded ${entry.severity}.`);
  }

  lines.push(
    '',
    'The marker must be the first word of the comment: `// TODO: replace this` is recorded,',
    '`// a TODO for later` is not. A marker mentioning a credential, a token or sanitising is',
    'graded high whichever word you used.',
  );

  return lines.join('\n');
}

// ── Handing an entry to an agent ─────────────────────────────────

/**
 * The prompt for working on a debt entry.
 *
 * Unlike an issue body or a review comment, a debt entry is **not** untrusted
 * third-party text — AtlasMind wrote it, from a marker in the user's own
 * repository, through a sanitizer. So the fence here does a different job. It
 * exists to stop the *agent* mistaking a recorded shortcut for a mandate: the
 * register says a decision was deferred, not that it should now be reversed.
 * Plenty of debt is worth keeping, and an agent that treated every entry as a
 * work order would spend a morning "fixing" three deliberate trade-offs.
 *
 * Hence: propose, do not apply. That is `refactorer`'s whole remit, and stating
 * it in the prompt costs one line and removes the most likely misreading.
 */
export function buildDebtWorkPrompt(entry: DebtEntry): string {
  const rule = RULE_BY_ID.get(entry.rule);
  return [
    `Look at this recorded technical debt: ${entry.title}`,
    '',
    `Evidence: ${entry.evidencePath}${entry.evidenceLine ? `:${entry.evidenceLine}` : ''}`,
    `Domain: ${entry.domain}. Recorded ${entry.detectedAt.slice(0, 10)}.`,
    rule ? `Graded ${entry.severity} by the rule \`${rule.id}\`: ${rule.describes}` : '',
    '',
    'This is a record that a decision was deferred. It is NOT a work order, and it is not a',
    'judgement that the code is wrong. Deliberate trade-offs live in this register too, and',
    'reversing one because it was written down would be worse than leaving it.',
    '',
    'Read the evidence first. Then say which of these it is:',
    '  - worth fixing now, with the smallest correct change;',
    '  - worth keeping, with the reason it was the right call;',
    '  - already resolved, and the entry is stale.',
    '',
    'Propose; do not apply. Nothing here authorises an edit.',
  ].filter(line => line !== '').join('\n');
}

// ── Metrics ──────────────────────────────────────────────────────

export interface DebtMetrics {
  total: number;
  open: number;
  /** Open entries by severity, highest first. */
  bySeverity: Array<{ key: string; label: string; value: number }>;
  byDomain: Array<{ key: string; label: string; value: number }>;
  /** Age buckets over open entries. */
  ageDistribution: Array<{ key: string; label: string; value: number }>;
  /** Median age in days of open entries, or undefined when there are none. */
  medianAgeDays?: number;
  /** The oldest open entry, which is usually the interesting one. */
  oldest?: DebtEntry;
  resolved: number;
  obsolete: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function deriveDebtMetrics(register: DebtRegister, now: number): DebtMetrics {
  const open = register.entries.filter(entry =>
    entry.status === 'open' || entry.status === 'accepted' || entry.status === 'scheduled');

  const severity = new Map<string, number>();
  const domain = new Map<string, number>();
  const ages: number[] = [];
  const buckets = new Map<string, number>([['0-7', 0], ['8-30', 0], ['31-90', 0], ['90+', 0]]);

  for (const entry of open) {
    severity.set(entry.severity, (severity.get(entry.severity) ?? 0) + 1);
    domain.set(entry.domain, (domain.get(entry.domain) ?? 0) + 1);
    const detected = Date.parse(entry.detectedAt);
    if (!Number.isFinite(detected)) {
      continue;
    }
    const days = Math.max(0, Math.floor((now - detected) / MS_PER_DAY));
    ages.push(days);
    const bucket = days <= 7 ? '0-7' : days <= 30 ? '8-30' : days <= 90 ? '31-90' : '90+';
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }

  const sortedAges = [...ages].sort((a, b) => a - b);
  const oldest = sortDebtEntries(open).slice().sort((a, b) =>
    (a.detectedAt < b.detectedAt ? -1 : a.detectedAt > b.detectedAt ? 1 : 0))[0];

  return {
    total: register.entries.length,
    open: open.length,
    bySeverity: (['high', 'medium', 'low'] as const)
      .filter(key => (severity.get(key) ?? 0) > 0)
      .map(key => ({ key, label: key, value: severity.get(key)! })),
    byDomain: [...domain.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({ key, label: key, value })),
    ageDistribution: [...buckets.entries()].map(([key, value]) => ({
      key,
      label: key === '90+' ? 'over 90 days' : `${key} days`,
      value,
    })),
    ...(sortedAges.length > 0
      ? { medianAgeDays: sortedAges[Math.floor(sortedAges.length / 2)]! }
      : {}),
    ...(oldest === undefined ? {} : { oldest }),
    resolved: register.entries.filter(entry => entry.status === 'resolved').length,
    obsolete: register.entries.filter(entry => entry.status === 'obsolete').length,
  };
}

// ── Persistence ──────────────────────────────────────────────────

const DOMAINS: readonly DebtDomain[] = ['code', 'test', 'dependency', 'documentation', 'infrastructure', 'security'];
const SEVERITIES: readonly DebtSeverity[] = ['low', 'medium', 'high'];
const STATUSES: readonly DebtStatus[] = ['open', 'accepted', 'scheduled', 'resolved', 'obsolete'];

export function sanitizeDebtRegister(input: unknown): DebtRegister {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { version: 1, entries: [] };
  }
  const raw = input as Record<string, unknown>;
  const entries = Array.isArray(raw['entries'])
    ? raw['entries']
      .slice(0, 5000)
      .map(entry => sanitizeEntry(entry))
      .filter((entry): entry is DebtEntry => entry !== undefined)
    : [];
  return {
    version: 1,
    entries,
    ...(typeof raw['updatedAt'] === 'string' ? { updatedAt: raw['updatedAt'] } : {}),
    ...(typeof raw['lastScanAt'] === 'string' ? { lastScanAt: raw['lastScanAt'] } : {}),
  };
}

function sanitizeEntry(input: unknown): DebtEntry | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const id = typeof raw['id'] === 'string' ? raw['id'].slice(0, 200) : '';
  const evidencePath = normalizeEvidencePath(raw['evidencePath']);
  const detectedAt = typeof raw['detectedAt'] === 'string' ? raw['detectedAt'] : '';
  // An entry with no id, no evidence or no date is a fragment. Repairing it
  // would invent a record, which is the one thing a register must not do.
  if (!id || !evidencePath || !detectedAt) {
    return undefined;
  }
  const line = Number(raw['evidenceLine']);
  return {
    id,
    domain: DOMAINS.includes(raw['domain'] as DebtDomain) ? raw['domain'] as DebtDomain : 'code',
    title: clampTitle(typeof raw['title'] === 'string' ? raw['title'] : 'Untitled'),
    evidencePath,
    ...(Number.isFinite(line) && line > 0 ? { evidenceLine: Math.floor(line) } : {}),
    detectedAt,
    // An unrecognised severity reads as `low`, never as `high`: a register that
    // inflated on a typo would train people to discount it.
    severity: SEVERITIES.includes(raw['severity'] as DebtSeverity) ? raw['severity'] as DebtSeverity : 'low',
    // A project's own rule ids are kept as well as the shipped ones. Rewriting
    // one to `todo-marker` would lose the grading provenance every entry is
    // supposed to carry — and would do it silently, on a file the project
    // committed.
    rule: typeof raw['rule'] === 'string' && (RULE_BY_ID.has(raw['rule']) || isCustomMarkerRule(raw['rule']))
      ? raw['rule']
      : 'todo-marker',
    // An unrecognised status reads as `open`. The safe direction is the one
    // that keeps work visible.
    status: STATUSES.includes(raw['status'] as DebtStatus) ? raw['status'] as DebtStatus : 'open',
    transitions: Array.isArray(raw['transitions'])
      ? raw['transitions'].slice(0, 100)
        .map(entry => sanitizeTransition(entry))
        .filter((entry): entry is DebtTransition => entry !== undefined)
      : [],
  };
}

function sanitizeTransition(input: unknown): DebtTransition | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw['at'] !== 'string' || !raw['at']) {
    return undefined;
  }
  return {
    at: raw['at'],
    from: STATUSES.includes(raw['from'] as DebtStatus) ? raw['from'] as DebtStatus : 'open',
    to: STATUSES.includes(raw['to'] as DebtStatus) ? raw['to'] as DebtStatus : 'open',
    ...(typeof raw['note'] === 'string' ? { note: clampTitle(raw['note']) } : {}),
  };
}

/**
 * A workspace-relative path, or empty when it is not one.
 *
 * Rejects traversal and absolute paths rather than normalising them. This value
 * becomes a link somebody clicks, and a register that quietly rewrote a path
 * would be pointing at a different file than the one it recorded.
 */
export function normalizeEvidencePath(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed.length > 400) {
    return '';
  }
  if (trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed) || trimmed.split('/').includes('..')) {
    return '';
  }
  return trimmed;
}

export function readDebtRegister(workspaceRoot: string): DebtRegister {
  try {
    return sanitizeDebtRegister(
      JSON.parse(readFileSync(path.join(workspaceRoot, DEBT_SSOT_PATH), 'utf8')),
    );
  } catch {
    return { version: 1, entries: [] };
  }
}

export async function writeDebtRegister(
  workspaceRoot: string,
  register: DebtRegister,
  customMarkers: readonly CustomDebtMarker[] = [],
): Promise<void> {
  const jsonPath = path.join(workspaceRoot, DEBT_SSOT_PATH);
  const summaryPath = path.join(workspaceRoot, DEBT_SUMMARY_SSOT_PATH);
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(register, null, 2), 'utf-8'),
    writeFile(summaryPath, renderDebtMarkdown(register, customMarkers), 'utf-8'),
  ]);
}

/** Deterministic markdown mirror — the same register renders identically. */
export function renderDebtMarkdown(
  register: DebtRegister,
  customMarkers: readonly CustomDebtMarker[] = [],
): string {
  const open = sortDebtEntries(register.entries.filter(entry =>
    entry.status === 'open' || entry.status === 'accepted' || entry.status === 'scheduled'));
  const closed = sortDebtEntries(register.entries.filter(entry =>
    entry.status === 'resolved' || entry.status === 'obsolete'));

  const lines: string[] = [
    '# Technical debt',
    '',
    '> Generated from `tech-debt.json` by AtlasMind. Entries **transition** —',
    '> they are never deleted. Hand edits to this file are lost.',
    '',
    `- **Open:** ${open.length} · **closed:** ${closed.length}`,
    ...(register.lastScanAt ? [`- **Last scan:** ${register.lastScanAt}`] : ['- **Never scanned.** Nothing here was found automatically.']),
    '',
    'Severity comes from a **declared rule**, never from a judgement call. The rule',
    'is named on every entry so the grade can be argued with, and it does **not**',
    'drift with age — an entry whose severity changed while nothing about the code',
    'changed could not be compared with last month\'s.',
    '',
  ];

  if (open.length > 0) {
    lines.push(
      '## Open',
      '',
      '| Severity | Domain | What | Where | Since | Rule |',
      '|---|---|---|---|---|---|',
      ...open.map(entry => [
        '',
        entry.severity,
        entry.domain,
        entry.title,
        `\`${entry.evidencePath}${entry.evidenceLine ? `:${entry.evidenceLine}` : ''}\``,
        entry.detectedAt.slice(0, 10),
        `\`${entry.rule}\``,
        '',
      ].join(' | ').trim()),
      '',
    );
  } else {
    lines.push('## Open', '', '_Nothing open._ An empty register means nothing was found or nothing was scanned — not that no debt exists.', '');
  }

  if (closed.length > 0) {
    lines.push(
      '## Closed',
      '',
      '`resolved` means somebody did the work. `obsolete` means the evidence went',
      'away and nobody said they fixed it — a different fact, and only one of them',
      'is an accomplishment.',
      '',
      '| Status | What | Where | Since |',
      '|---|---|---|---|',
      ...closed.slice(0, 100).map(entry => [
        '',
        entry.status,
        entry.title,
        `\`${entry.evidencePath}\``,
        entry.detectedAt.slice(0, 10),
        '',
      ].join(' | ').trim()),
      '',
    );
  }

  lines.push(
    '## The rules',
    '',
    '| Rule | Domain | Severity | Why |',
    '|---|---|---|---|',
    ...[...DEBT_RULES, ...customMarkerRules(customMarkers)]
      .map(rule => ['', `\`${rule.id}\``, rule.domain, rule.severity, rule.describes, ''].join(' | ').trim()),
    '',
  );

  return lines.join('\n');
}

/** Holds the register for the extension host. */
export class DebtRegisterManager {
  private register: DebtRegister;

  constructor(private readonly workspaceRoot: string | undefined) {
    this.register = workspaceRoot ? readDebtRegister(workspaceRoot) : { version: 1, entries: [] };
  }

  get(): DebtRegister {
    return this.register;
  }

  /** True once a register file exists — not merely once it has entries. */
  hasRegister(): boolean {
    return this.register.lastScanAt !== undefined || this.register.entries.length > 0;
  }

  reload(): void {
    this.register = this.workspaceRoot ? readDebtRegister(this.workspaceRoot) : { version: 1, entries: [] };
  }

  async save(register: DebtRegister, customMarkers: readonly CustomDebtMarker[] = []): Promise<void> {
    this.register = register;
    if (this.workspaceRoot) {
      await writeDebtRegister(this.workspaceRoot, register, customMarkers);
    }
  }
}
