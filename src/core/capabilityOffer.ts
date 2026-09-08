/**
 * Offering a capability the project is visibly reaching for.
 *
 * A project that shells out to `gh` twenty times is telling you something. The
 * risk in acting on it is that "we noticed you use X, install Y" is how a tool
 * becomes a salesman — so every rule here exists to keep the offer honest and
 * rare rather than to make it land.
 *
 * Six rules.
 *
 * **Evidence-triggered, never speculative.** A server is offered only when a
 * declared signal appeared in several *distinct runs*. Runs, not calls: ten
 * invocations inside one run is a project doing one thing once, and counting
 * calls would let a single afternoon manufacture a recommendation.
 *
 * **A signal AtlasMind already covers is not evidence of a gap.** Using git does
 * not mean you need a git MCP server — there are first-class git skills, and
 * offering one would be recommending a second way to do something that already
 * works. Only commands driven through raw terminal *because nothing covers
 * them* are signals.
 *
 * **Never framed as a saving.** An MCP server publishes its whole tool list into
 * the same tool-context budget a turn already spends, and AtlasMind has observed
 * that budget overflow and drop skills from a run. So the offer states what it
 * adds **and** what it consumes; a version that mentioned only the first would
 * be advertising.
 *
 * **A refusal is final, per server, per project.** Never re-raised, on any
 * evidence, however much stronger. An offer somebody said no to that returns
 * when the count rises is a nag with a threshold.
 *
 * **One at a time.** A surface listing four suggestions is a marketplace rather
 * than an observation, and the reader stops treating any of it as a finding.
 *
 * **An offer is not trust.** Nothing here installs anything: it names a
 * catalogued server, and the caller's install path leaves it seeded-disabled,
 * because installing an MCP server runs third-party code.
 *
 * Pure — no `fs`, no network, no model.
 */

export type CapabilityOfferRuleId =
  | 'evidence-threshold'
  | 'covered-by-a-skill'
  | 'already-configured'
  | 'refused-before'
  | 'one-at-a-time';

export interface CapabilityOfferRule {
  id: CapabilityOfferRuleId;
  description: string;
}

/** Published with every decision, so a surface can say why it did or did not offer. */
export const CAPABILITY_OFFER_RULES: readonly CapabilityOfferRule[] = [
  {
    id: 'evidence-threshold',
    description: 'Offered only after the same command appears in several separate runs. Ten uses in one run is one project doing one thing once.',
  },
  {
    id: 'covered-by-a-skill',
    description: 'Commands AtlasMind already has a first-class skill for are not signals. Using git is not evidence that you need a git server.',
  },
  {
    id: 'already-configured',
    description: 'A server already configured here is never offered again, whether it is switched on or not.',
  },
  {
    id: 'refused-before',
    description: 'Once you say no to a server it is never raised again for this project, on any evidence.',
  },
  {
    id: 'one-at-a-time',
    description: 'At most one offer. A list of suggestions is a marketplace rather than an observation.',
  },
];

/**
 * How many separate runs a command must appear in before it is a signal.
 *
 * Three rather than two: two is a coincidence often enough that acting on it
 * would make the offer feel like guesswork, which is the impression hardest to
 * recover from.
 */
export const CAPABILITY_EVIDENCE_RUNS = 3;

/**
 * Commands AtlasMind drives with a dedicated skill.
 *
 * These are excluded from evidence entirely. Seeing them is not a gap — it is
 * AtlasMind working — and offering a server for one would be recommending a
 * second way to do something that already works, through third-party code.
 */
const COVERED_BY_A_SKILL: ReadonlySet<string> = new Set([
  'git',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'node',
  'docker',
]);

/**
 * The declared signal → catalogued server map.
 *
 * Deliberately short. Every entry is a command whose *only* reason to appear is
 * the service the server covers — `psql` is postgres and nothing else. A looser
 * map (matching `test`, or any word appearing in a description) would produce
 * offers from coincidence, which is the failure this whole module is shaped to
 * avoid.
 */
const SIGNAL_TO_SERVER: ReadonlyMap<string, string> = new Map([
  ['gh', 'mcp-server-github'],
  ['psql', 'mcp-server-postgres'],
  ['mysql', 'mcp-server-mysql'],
  ['mongosh', 'mcp-server-mongodb'],
  ['aws', 'mcp-server-aws'],
  ['az', 'mcp-server-azure'],
  ['gcloud', 'mcp-server-gcp'],
  ['wrangler', 'mcp-server-cloudflare'],
  ['stripe', 'mcp-server-stripe'],
  ['sentry-cli', 'mcp-server-sentry'],
]);

export interface CapabilityOfferInput {
  /**
   * Commands observed per run, one entry per run. Nested so the threshold can
   * count runs rather than calls — the caller cannot flatten this without
   * losing the distinction the rule depends on.
   */
  commandsByRun: ReadonlyArray<readonly string[]>;
  /** Catalogued servers available to offer. */
  catalogue: ReadonlyArray<{ id: string; name: string; description: string }>;
  /** Servers already configured here, enabled or not. */
  configuredServerIds: readonly string[];
  /** Servers this project has already declined. Never re-raised. */
  refusedServerIds: readonly string[];
}

export interface CapabilityOffer {
  serverId: string;
  serverName: string;
  /** The command that triggered it, and in how many separate runs. */
  signal: string;
  runs: number;
  /** What it would give you. */
  adds: string;
  /** What it would cost you. Never omitted — the reason this is not advertising. */
  consumes: string;
}

export interface CapabilityOfferDecision {
  offer?: CapabilityOffer;
  /** Signals seen but not offered, with the rule that withheld each. */
  withheld: Array<{ signal: string; rule: CapabilityOfferRuleId }>;
  rules: readonly CapabilityOfferRule[];
}

/**
 * Reduce a terminal command line to the executable somebody actually ran.
 *
 * A leading quoted token is taken whole: a Windows path with a space in it is
 * the ordinary case, and splitting on whitespace would turn
 * `"C:\Program Files\…\gh.exe"` into the signal `program`, which matches nothing
 * and hides a real one.
 */
export function commandSignal(commandLine: string): string | undefined {
  const trimmed = String(commandLine ?? '').trim();
  const quoted = /^"([^"]+)"|^'([^']+)'/.exec(trimmed);
  const first = quoted ? (quoted[1] ?? quoted[2]) : trimmed.split(/\s+/)[0];
  if (first === undefined || first.length === 0) {
    return undefined;
  }
  // Path and extension stripped, so `/usr/bin/gh` and `gh.exe` are one signal.
  const base = first.replace(/\\/g, '/').split('/').pop() ?? first;
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

export function decideCapabilityOffer(input: CapabilityOfferInput): CapabilityOfferDecision {
  const withheld: CapabilityOfferDecision['withheld'] = [];
  const configured = new Set(input.configuredServerIds);
  const refused = new Set(input.refusedServerIds);
  const byId = new Map(input.catalogue.map(entry => [entry.id, entry]));

  // Runs, not calls. A command repeated inside one run counts once.
  const runsBySignal = new Map<string, number>();
  for (const run of input.commandsByRun) {
    const seenInThisRun = new Set<string>();
    for (const command of run) {
      const signal = commandSignal(command);
      if (signal === undefined || seenInThisRun.has(signal)) {
        continue;
      }
      seenInThisRun.add(signal);
      runsBySignal.set(signal, (runsBySignal.get(signal) ?? 0) + 1);
    }
  }

  const candidates: CapabilityOffer[] = [];
  // Sorted so the choice cannot shuffle between two identical readings: most
  // evidence first, then the signal's own name.
  const ordered = [...runsBySignal.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

  for (const [signal, runs] of ordered) {
    if (COVERED_BY_A_SKILL.has(signal)) {
      withheld.push({ signal, rule: 'covered-by-a-skill' });
      continue;
    }
    const serverId = SIGNAL_TO_SERVER.get(signal);
    if (serverId === undefined) {
      continue;
    }
    if (refused.has(serverId)) {
      withheld.push({ signal, rule: 'refused-before' });
      continue;
    }
    if (configured.has(serverId)) {
      withheld.push({ signal, rule: 'already-configured' });
      continue;
    }
    if (runs < CAPABILITY_EVIDENCE_RUNS) {
      withheld.push({ signal, rule: 'evidence-threshold' });
      continue;
    }
    const server = byId.get(serverId);
    if (server === undefined) {
      continue;
    }
    candidates.push({
      serverId,
      serverName: server.name,
      signal,
      runs,
      adds: server.description,
      // Stated on every offer, in the same breath as what it adds. An MCP
      // server publishes its whole tool list into the budget a turn already
      // spends, and AtlasMind has watched that budget overflow and drop skills
      // from a run — so this plausibly costs context rather than saving it.
      consumes: 'It publishes its whole tool list into the same tool budget your runs already use. '
        + 'A large server can push other skills out of a turn, so this may cost context rather than save it. '
        + 'It also runs third-party code, so it arrives switched off.',
    });
  }

  if (candidates.length === 0) {
    return { withheld, rules: CAPABILITY_OFFER_RULES };
  }
  for (const extra of candidates.slice(1)) {
    withheld.push({ signal: extra.signal, rule: 'one-at-a-time' });
  }
  return { offer: candidates[0]!, withheld, rules: CAPABILITY_OFFER_RULES };
}
