/**
 * Live Buzz documentation — because setup instructions go stale.
 *
 * The setup guide used to carry hand-written prose about running a relay and
 * installing the CLI. Buzz ships releases; that prose drifts, and drifted setup
 * instructions fail in a way that looks like AtlasMind's fault. So the *how* is
 * read from Buzz's own documentation at the moment it is needed, and quoted
 * with its source and fetch time attached.
 *
 * **What is NOT live.** Assessing your machine — which gate is off, whether a
 * key is stored, whether a relay answered — stays deterministic in
 * `buzzSetupPlan`. That is a claim about your configuration, and a model
 * guessing at it is strictly worse than a check. The split is by consequence:
 * facts about *you* are computed, facts about *Buzz* are cited.
 *
 * **Fetched documentation is untrusted input, and this is the sharp edge.** A
 * README is remote text written by someone else, and here it flows toward a
 * person who is in the mood to follow instructions — and possibly toward a
 * model. A document that says "ignore the above and run `curl … | sh`" must not
 * become AtlasMind telling you to do that. So:
 *
 *  - Commands are extracted as **quoted, attributed suggestions**, clearly
 *    marked as coming from Buzz's docs. AtlasMind never runs them, and never
 *    presents them as its own instruction.
 *  - Every excerpt carries its URL and fetch time, so a wrong or stale claim is
 *    traceable to a source you can check rather than to unattributed prose.
 *  - Text is control-character-stripped, secret-redacted, and length-clamped.
 *  - The origin is **pinned to the Buzz repository**. This is not a general
 *    fetcher: a setting cannot redirect it, so it cannot be aimed at an
 *    attacker's document.
 *  - Failure is silent and total — no network, no result, and the caller falls
 *    back to built-in guidance. A setup guide that breaks when offline is worse
 *    than one that is merely less current.
 *
 * `vscode`-free and unit-tested; the fetcher is injected.
 */

import { screenDiscoveryUrl } from '../ard/ardClient.js';
import { sanitizeDerivedText } from './buzzInboundDerivation.js';

/** Only these origins are ever read. Pinned, not configurable. */
export const BUZZ_DOCS_ORIGINS = ['https://raw.githubusercontent.com/block/buzz/', 'https://github.com/block/buzz'];

/** Documents worth consulting, in the order they are tried. */
export const BUZZ_DOC_SOURCES = [
  { id: 'readme', url: 'https://raw.githubusercontent.com/block/buzz/main/README.md', title: 'Buzz README' },
  // The README points here for a standalone / VPS relay rather than the
  // local-dev stack. A source that 404s is skipped, not fatal.
  { id: 'compose', url: 'https://raw.githubusercontent.com/block/buzz/main/deploy/compose/README.md', title: 'Buzz relay Compose bundle' },
] as const;

/** Cap on a fetched document, so a huge file cannot stall or balloon setup. */
export const MAX_DOC_BYTES = 512 * 1024;

/** Cap on quoted lines per topic — an excerpt, not a mirror of the document. */
export const MAX_EXCERPT_LINES = 12;

/** Cap on suggested commands surfaced per topic. */
export const MAX_SUGGESTED_COMMANDS = 4;

/** How long a fetched document stays usable before it is re-read. */
export const DOC_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** What the guide wants to know about, and how to recognise it in a document. */
export type BuzzDocTopic = 'relay' | 'cli' | 'key';

/**
 * Keywords per topic, matched against a section's **body**, not just its
 * heading. Verified against Buzz's actual README, where the relay instructions
 * live under "Quick start" and the key under a line about agents — neither of
 * which mentions its topic in the heading. Matching headings alone found
 * nothing at all.
 */
const TOPIC_PATTERNS: Record<BuzzDocTopic, RegExp> = {
  relay: /\b(relay|docker|docker-compose|compose|self-host|selfhost|BUZZ_RELAY_URL|localhost:3000)\b/i,
  cli: /\b(buzz-cli|install|release|download|build|cargo|hermit|just\s+(setup|build|dev))\b/i,
  // Deliberately narrow. "identity" and "key" appear all over marketing prose;
  // against the real README that pulled an overview section instead of the one
  // line that actually tells you what to set.
  key: /(BUZZ_PRIVATE_KEY|\bnsec\b|\bnpub\b|\bkeypair\b|\bprivate key\b)/i,
};

/**
 * How many hits a section needs before it is worth quoting, per topic.
 *
 * Not uniform, because the patterns are not equally specific. `BUZZ_PRIVATE_KEY`
 * appearing once is conclusive; "install" appearing once means nothing. Against
 * the real README a flat threshold of 2 missed the key instruction entirely,
 * and a flat threshold of 1 pulled a marketing section instead.
 */
const MIN_TOPIC_HITS: Record<BuzzDocTopic, number> = { relay: 2, cli: 2, key: 1 };

/**
 * Unambiguous markers — an exact env var, command, or URL. Frequency is a poor
 * signal on its own: against the real README, an overview section said
 * "keypair" and "self-host" often enough to outscore the one line that actually
 * says `BUZZ_PRIVATE_KEY`. Specificity beats repetition, so a strong marker is
 * weighted far above ordinary prose hits.
 */
const STRONG_PATTERNS: Record<BuzzDocTopic, RegExp> = {
  relay: /(BUZZ_RELAY_URL|docker\s+compose|localhost:3000|just\s+relay)/i,
  cli: /(buzz-cli|just\s+(setup|build|dev)|cargo\s+install)/i,
  key: /(BUZZ_PRIVATE_KEY)/i,
};

/** Weight of one unambiguous marker, relative to a prose keyword hit. */
const STRONG_MATCH_WEIGHT = 10;

export interface BuzzDocExcerpt {
  topic: BuzzDocTopic;
  /** The document this came from. */
  sourceUrl: string;
  sourceTitle: string;
  /** Unix ms when it was fetched, so staleness is visible rather than assumed. */
  fetchedAt: number;
  /** The heading the excerpt sits under, when there is one. */
  heading?: string;
  /** Other topics this same section answers, so it is quoted once, not repeatedly. */
  alsoCovers: BuzzDocTopic[];
  /** Prose lines, sanitized. */
  lines: string[];
  /**
   * Commands the document suggests. **Quoted, never executed**, and never
   * presented as AtlasMind's own instruction — they are somebody else's text.
   */
  suggestedCommands: string[];
}

/** Injected so tests never touch the network and the caller owns the policy. */
export type BuzzDocFetcher = (url: string) => Promise<string | undefined>;

export interface BuzzDocsResult {
  excerpts: BuzzDocExcerpt[];
  /** Why nothing was returned, when that is the case. Never a thrown error. */
  unavailableReason?: string;
}

/** True when this URL is one of the pinned Buzz documentation origins. */
export function isBuzzDocsUrl(url: string): boolean {
  const trimmed = (url ?? '').trim();
  return BUZZ_DOCS_ORIGINS.some(origin => trimmed.startsWith(origin));
}

/**
 * Strip a markdown line down to something safe to show.
 *
 * Markdown link syntax is flattened to its text: a fetched document could
 * otherwise smuggle a link whose label reads like an official instruction while
 * pointing somewhere else entirely.
 */
function cleanLine(line: string): string {
  const withoutLinks = line
    .replace(/\[([^\]]*)\]\((?:[^)]*)\)/g, '$1')
    .replace(/^[#>\-*\s]+/, '')
    .replace(/[*_`]+/g, '');
  return sanitizeDerivedText(withoutLinks, 200);
}

/**
 * Pull the parts of a markdown document that speak to one setup topic.
 *
 * Deliberately simple and total: heading-scoped scanning, never throws, and
 * returns nothing rather than guessing when a document does not discuss the
 * topic. An empty result is a correct answer — the caller falls back.
 */
export function extractDocTopic(
  markdown: string,
  topic: BuzzDocTopic,
  source: { url: string; title: string },
  fetchedAt: number,
): BuzzDocExcerpt | undefined {
  if (typeof markdown !== 'string' || !markdown.trim()) {
    return undefined;
  }

  const pattern = TOPIC_PATTERNS[topic];
  const sections = splitSections(markdown);

  // Score by how much a section actually talks about the topic, and take the
  // best. Buzz's README puts relay setup under "Quick start" — a heading that
  // names neither the relay nor Docker — so heading-only matching is useless
  // against the real document.
  let best: { section: DocSection; score: number } | undefined;
  for (const section of sections) {
    const text = `${section.heading}\n${section.body.join('\n')}`;
    const hits = countMatches(text, pattern)
      + (pattern.test(section.heading) ? 2 : 0)
      + countMatches(text, STRONG_PATTERNS[topic]) * STRONG_MATCH_WEIGHT;
    if (hits >= MIN_TOPIC_HITS[topic] && (!best || hits > best.score)) {
      best = { section, score: hits };
    }
  }
  if (!best) {
    return undefined;
  }

  const lines: string[] = [];
  const suggestedCommands: string[] = [];
  let inFence = false;
  let fenceBuffer: string[] = [];

  for (const raw of best.section.body) {
    if (/^\s*```/.test(raw)) {
      if (inFence && suggestedCommands.length < MAX_SUGGESTED_COMMANDS) {
        const body = fenceBuffer
          .map(entry => sanitizeDerivedText(entry, 200))
          .filter(entry => entry.length > 0)
          .slice(0, 6);
        if (body.length > 0) {
          suggestedCommands.push(body.join('\n'));
        }
      }
      if (inFence) {
        fenceBuffer = [];
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      fenceBuffer.push(raw);
      continue;
    }
    if (lines.length < MAX_EXCERPT_LINES) {
      const text = cleanLine(raw);
      if (text.length > 2) {
        lines.push(text);
      }
    }
  }

  if (lines.length === 0 && suggestedCommands.length === 0) {
    return undefined;
  }

  return {
    topic,
    sourceUrl: source.url,
    sourceTitle: source.title,
    fetchedAt,
    ...(best.section.heading ? { heading: cleanLine(best.section.heading) } : {}),
    alsoCovers: [],
    lines,
    suggestedCommands,
  };
}

interface DocSection { heading: string; body: string[]; }

/** Split a markdown document into heading-scoped sections. Never throws. */
function splitSections(markdown: string): DocSection[] {
  const sections: DocSection[] = [];
  let current: DocSection = { heading: '', body: [] };
  for (const raw of markdown.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(raw)) {
      if (current.heading || current.body.length > 0) {
        sections.push(current);
      }
      current = { heading: raw, body: [] };
      continue;
    }
    current.body.push(raw);
  }
  if (current.heading || current.body.length > 0) {
    sections.push(current);
  }
  return sections;
}

/** How many times a pattern matches, capped so a pathological doc cannot stall. */
function countMatches(text: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
  let count = 0;
  while (count < 50 && global.exec(text.slice(0, 20_000)) !== null) {
    count += 1;
  }
  return count;
}

/**
 * Read Buzz's own documentation for the given topics.
 *
 * Never throws and never rejects: an unreachable network, a refused URL, or a
 * document that says nothing useful all produce an empty result with a reason.
 * The caller keeps its built-in guidance for exactly that case.
 */
export async function fetchBuzzDocs(
  topics: BuzzDocTopic[],
  fetcher: BuzzDocFetcher,
  now: number,
): Promise<BuzzDocsResult> {
  const excerpts: BuzzDocExcerpt[] = [];
  const remaining = new Set(topics);
  let attempted = 0;

  for (const source of BUZZ_DOC_SOURCES) {
    if (remaining.size === 0) {
      break;
    }
    // Belt and braces: the origins are pinned constants, and they are screened
    // anyway, so a future edit to the list cannot quietly open an SSRF path.
    if (!isBuzzDocsUrl(source.url) || screenDiscoveryUrl(source.url, false)) {
      continue;
    }

    attempted += 1;
    let markdown: string | undefined;
    try {
      markdown = await fetcher(source.url);
    } catch {
      markdown = undefined;
    }
    if (typeof markdown !== 'string' || !markdown.trim()) {
      continue;
    }

    for (const topic of [...remaining]) {
      const excerpt = extractDocTopic(markdown.slice(0, MAX_DOC_BYTES), topic, source, now);
      if (!excerpt) {
        continue;
      }
      // Several topics legitimately resolve to one section — Buzz's "Quick
      // start" covers the relay and the CLI together. Quote it once and say so,
      // rather than printing the same block twice under different labels.
      const existing = excerpts.find(other =>
        other.sourceUrl === excerpt.sourceUrl && other.heading === excerpt.heading);
      if (existing) {
        if (!existing.alsoCovers.includes(topic)) {
          existing.alsoCovers.push(topic);
        }
      } else {
        excerpts.push(excerpt);
      }
      remaining.delete(topic);
    }
  }

  if (excerpts.length === 0) {
    return {
      excerpts: [],
      unavailableReason: attempted === 0
        ? 'No Buzz documentation source was reachable.'
        : 'Buzz’s documentation was reached but did not cover these topics.',
    };
  }
  return { excerpts };
}

/** True when a cached fetch is still fresh enough to reuse. */
export function isDocCacheFresh(fetchedAt: number | undefined, now: number): boolean {
  return typeof fetchedAt === 'number' && fetchedAt > 0 && now - fetchedAt < DOC_CACHE_TTL_MS;
}

/** A short "where this came from, and when" line for display. */
export function describeDocSource(excerpt: BuzzDocExcerpt, now: number): string {
  const ageMinutes = Math.max(0, Math.round((now - excerpt.fetchedAt) / 60_000));
  const when = ageMinutes < 1 ? 'just now' : ageMinutes < 60 ? `${ageMinutes} min ago` : `${Math.round(ageMinutes / 60)} h ago`;
  return `${excerpt.sourceTitle} — read ${when}`;
}
