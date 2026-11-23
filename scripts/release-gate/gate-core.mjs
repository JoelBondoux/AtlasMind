// Pure rules of the Marketplace release gate. No I/O here, so every rule is
// unit-tested (tests/release/releaseGate.test.ts); release-gate.mjs and
// release-window.mjs do the running.

/** At most this many Marketplace publications per UK calendar day. */
export const DAILY_PUBLISH_LIMIT = 2;

/** The day boundary is the maintainer's: UK time, so BST is handled. */
export const PUBLISH_TIME_ZONE = 'Europe/London';

/** `YYYY-MM-DD` for an instant, in UK time. */
export function ukDate(instant) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PUBLISH_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(instant));
}

/** Parse `1.2.3` (a leading `v` allowed). Anything else is not a release. */
export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text).trim());
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`not a release version: ${pa ? b : a}`);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * The Marketplace's own record, as `vsce show --json` returns it, reduced to
 * what the gate needs. Unreadable data throws: the gate fails closed rather
 * than guessing that nothing was published today.
 */
export function readMarketplaceVersions(showJson) {
  const versions = showJson?.versions;
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error('Marketplace listing has no versions; refusing to guess what is published');
  }
  return versions.map((v) => {
    if (!parseVersion(v.version) || Number.isNaN(Date.parse(v.lastUpdated))) {
      throw new Error(`Marketplace listing has an unreadable version entry: ${JSON.stringify(v)}`);
    }
    return { version: v.version, publishedAt: v.lastUpdated };
  });
}

export function latestPublished(marketplaceVersions) {
  return marketplaceVersions.reduce((best, v) => (compareVersions(v.version, best) > 0 ? v.version : best),
    marketplaceVersions[0].version);
}

/** How many versions the Marketplace shows as published on `now`'s UK day. */
export function publishedToday(marketplaceVersions, now) {
  const today = ukDate(now);
  return marketplaceVersions.filter((v) => ukDate(v.publishedAt) === today).length;
}

/**
 * May `candidate` be published now? Returns `{ ok, reason }`. The daily limit
 * is checked here, inside the publish path, so nobody has to remember it.
 */
export function publishDecision({ candidate, marketplaceVersions, now }) {
  const latest = latestPublished(marketplaceVersions);
  if (marketplaceVersions.some((v) => v.version === candidate)) {
    return { ok: false, kind: 'not-needed', reason: `v${candidate} is already on the Marketplace` };
  }
  if (compareVersions(candidate, latest) <= 0) {
    return { ok: false, kind: 'not-needed', reason: `v${candidate} is not newer than the Marketplace's v${latest}` };
  }
  const count = publishedToday(marketplaceVersions, now);
  if (count >= DAILY_PUBLISH_LIMIT) {
    return {
      ok: false,
      kind: 'daily-limit',
      reason: `${count} versions already published today (${ukDate(now)}, UK); the limit is ${DAILY_PUBLISH_LIMIT}`,
    };
  }
  return { ok: true, kind: 'allowed', reason: `v${candidate} is newer than v${latest}; ${count} of ${DAILY_PUBLISH_LIMIT} publications used today` };
}

/**
 * Release tags newer than the Marketplace, newest first: the order a publish
 * window tries them in, so the latest release that passes is the one shipped.
 */
export function windowCandidates(tags, marketplaceLatest) {
  return tags
    .filter((t) => parseVersion(t))
    .map((t) => t.replace(/^v/, ''))
    .filter((v) => compareVersions(v, marketplaceLatest) > 0)
    .sort((a, b) => compareVersions(b, a));
}

/** Content that must never ship in a VSIX. High-signal patterns only. */
export const SECRET_PATTERNS = [
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----\s*(?:[A-Za-z0-9+/=]{20,}\s*){2}/ },
  { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { name: 'AWS access key id', re: /\b(?:AKIA|ASIA)(?![0-9A-Z]{9}EXAMPLE\b)[0-9A-Z]{16}\b/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{32,}/ },
  { name: 'OpenAI API key', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/ },
  { name: 'Slack token', re: /\bxox[abprs]-[0-9]{6,}-[A-Za-z0-9-]{10,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'npm auth in .npmrc', re: /_authToken\s*=\s*[^\s$]/ },
];

/** File names that are a secret by being there at all. */
export const SECRET_FILE_NAMES = /(?:^|\/)(?:\.env(?:\.[^/]*)?|id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:pem|p12|pfx|key)|\.npmrc|\.netrc)$/i;

/** Placeholder `.env.example`-style files document variables and carry none. */
const EXAMPLE_ENV = /(?:^|\/)\.env\.(?:example|sample|template)$/i;

/**
 * Findings for one file of the VSIX: `[{ file, rule }]`. Never the matched
 * text, so a report can be shared without repeating the secret it found.
 */
export function scanFile(file, text) {
  const findings = [];
  const normalised = file.replace(/\\/g, '/');
  if (SECRET_FILE_NAMES.test(normalised) && !EXAMPLE_ENV.test(normalised)) {
    findings.push({ file: normalised, rule: 'secret-bearing file name' });
  }
  if (typeof text === 'string') {
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(text)) findings.push({ file: normalised, rule: name });
    }
  }
  return findings;
}

/** Arguments the gate accepts. Anything else is refused: there is no bypass. */
export const GATE_FLAGS = new Set(['--publish', '--azure-credential']);

export function parseGateArgs(argv) {
  const flags = new Set();
  let report;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--report') { report = argv[i += 1]; continue; }
    if (!GATE_FLAGS.has(arg)) throw new Error(`unknown argument ${arg}: the gate has no skip or bypass options`);
    flags.add(arg);
  }
  return { publish: flags.has('--publish'), azureCredential: flags.has('--azure-credential'), report };
}
