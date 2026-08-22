/**
 * VersioningPolicy — how a project numbers its software across several branches.
 *
 * AtlasMind could already classify a commit range into a bump level
 * (`classifyBumpLevel`), increment a release line (`bumpVersion`), and say which
 * version sits on which delivery stage (`versionStrip`). What it had nowhere to
 * put was the decision *joining* those three: that `develop` produces
 * `1.5.0-beta.3`, that `main` produces `1.5.0`, and that those are the same
 * release line at two points on its way out. Without it a project with four
 * branches had exactly one version — the manifest's — and every stage reported
 * whatever that branch's copy of the manifest happened to say, which is a fact
 * about merge order rather than about what is deployed anywhere.
 *
 * The professional norm this models is not one decision but three: a **scheme**
 * (SemVer, or CalVer where there is no API contract to promise), a **source**
 * for the number (derived from tags at release time, or held in the manifest),
 * and — the part that only exists once there is more than one branch — a
 * **channel map** from branch to pre-release identifier and distribution tag.
 *
 * Five rules carry the semantics. Each is here because the obvious alternative
 * is wrong in a way that is quiet:
 *
 * 1. **A version is minted once and only gains identity as it flows forward.**
 *    `1.5.0-beta.3` then `1.5.0-rc.1` then `1.5.0` never changes the release
 *    line, and `promoteVersion` *refuses* a promotion that would change major,
 *    minor or patch rather than performing it. Two different numbers are not the
 *    same artifact, and a channel's entire value is the claim that they are — a
 *    promotion that quietly re-mints turns the release candidate somebody tested
 *    into a version nobody tested, under a name saying otherwise.
 *
 * 2. **The branch chooses the channel, never the number.** Channels are matched
 *    against the branch and the number comes from the release line. The map is
 *    keyed on the same branch refs the delivery pipeline already carries, so the
 *    header, the Delivery page and this module cannot end up holding three
 *    opinions about what `develop` is.
 *
 * 3. **Undeclared is not defaulted.** No policy in `workflow.json` yields
 *    `declared: false` and no version at all, never a silent SemVer assumption.
 *    A project that never chose a scheme must not be graded against one, and the
 *    recommendation is offered separately (`recommendedVersioningPolicy`) so
 *    adopting it stays somebody's decision rather than a default nobody saw.
 *
 * 4. **The rule that produced a number travels with it**, as the debt register
 *    and the roadmap's estimates already do. A suggested version whose reasoning
 *    is invisible is a number people either follow blindly or ignore entirely.
 *
 * 5. **An unparseable version is refused, never coerced.** The obvious
 *    implementation reads `parseInt(part) || 0`, which turns nonsense into
 *    `0.0.0` — and `0.0.0` compares older than everything, so a corrupt manifest
 *    would sail through the very gate that exists to catch it. A version that is
 *    not a version produces a refusal carrying the reason.
 *
 * Pure. No `vscode`, no `fs`, and no clock of its own — `now` is injected,
 * because a CalVer plan computed from an ambient clock can be neither tested nor
 * replayed. The semver primitives are imported from `promotionRunner` rather
 * than reimplemented: a second copy of "what does this version mean" is exactly
 * the drift this codebase keeps paying for elsewhere.
 */

import { bumpVersion, classifyBumpLevel, compareSemver, type BumpLevel } from './semver.js';

// -- Types --------------------------------------------------------

export type VersioningScheme = 'semver' | 'calver' | 'manual';

/**
 * Where the authoritative number lives.
 *
 * `tag` is the professional norm — CI computes from the last tag and writes the
 * manifest at release time, so no commit carries a bump and no merge conflicts
 * on it. `manifest` is the hand-maintained alternative, which some projects
 * (AtlasMind among them) choose deliberately.
 */
export type VersionSource = 'manifest' | 'tag';

/** How finished a channel's output is. Orders promotion; see `promoteVersion`. */
export type ChannelStability = 'preview' | 'candidate' | 'stable';

/** Stability as a rank, so a promotion can tell forward from backward. */
export const CHANNEL_RANK: Record<ChannelStability, number> = {
  preview: 0,
  candidate: 1,
  stable: 2,
};

export interface VersionChannel {
  /** Stable id, referenced by messages and by the surfaces. */
  id: string;
  /** What a person calls it. */
  label: string;
  /**
   * The branch this channel is produced from. A trailing `/` + `*` matches by
   * prefix, so `release/` + `*` covers `release/1.5`; anything else is exact.
   */
  branch: string;
  /**
   * The pre-release identifier this channel stamps — `beta` produces
   * `1.5.0-beta.1`. Absent means the channel publishes finished versions.
   */
  prerelease?: string;
  /** The distribution tag a publish lands on: `latest`, `next`, `rc`. */
  distTag: string;
  stability: ChannelStability;
}

export interface VersioningPolicy {
  scheme: VersioningScheme;
  source: VersionSource;
  /**
   * Whether the bump level is read from Conventional Commits. `none` means a
   * human decides the level, and no level is suggested.
   */
  commitConvention: 'conventional' | 'none';
  /** Branch to channel, in declaration order. Ties in matching break on it. */
  channels: VersionChannel[];
  /** Tag format, so a project that does not prefix with `v` is not told it is wrong. */
  tagPrefix: string;
}

/** A version, parsed. */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers; empty for a finished version. */
  prerelease: string[];
  /** Build metadata, carried but never compared. */
  build?: string;
  /** `major.minor.patch`, with no pre-release and no metadata. */
  core: string;
}

export type VersionPlanRuleId =
  | 'not-declared'
  | 'manual'
  | 'calver'
  | 'unparseable'
  | 'no-channel'
  | 'continue-prerelease'
  | 'open-prerelease'
  | 'finalize'
  | 'bump-stable';

export interface VersionPlanRule {
  id: VersionPlanRuleId;
  /** The rule's own words, published beside the number it produced. */
  text: string;
}

/**
 * The declared rule table.
 *
 * Published with every plan, for the reason the debt register publishes its
 * severity table: a number produced by a rule nobody can read is a number nobody
 * can argue with, and the arguing is the point.
 */
export const VERSION_PLAN_RULES: Record<VersionPlanRuleId, string> = {
  'not-declared': 'No versioning policy is declared, so no version is derived.',
  manual: 'The scheme is manual, so the version is whatever the manifest holds.',
  calver: 'CalVer: the version is the release date, with an ordinal separating same-period releases.',
  unparseable: 'The version this would build on is not a version, so nothing is derived from it.',
  'no-channel': 'This branch has no declared channel, so it produces no version of its own.',
  'continue-prerelease': 'This release line already has a pre-release on this channel, so the ordinal advances.',
  'open-prerelease': 'The commit range warrants a bump and this is a pre-release channel, so a pre-release opens on the bumped line.',
  finalize: 'This channel publishes finished versions, so the pre-release identity is dropped and the release line stands.',
  'bump-stable': 'The commit range warrants a bump on the last released version.',
};

export interface VersionPlanInput {
  /** Absent means no policy is declared — reported, never defaulted. */
  policy?: VersioningPolicy;
  currentBranch: string;
  /** The version the manifest holds right now. */
  manifestVersion: string;
  /**
   * Every tag that could be read, in any order. **Absent means nobody looked**,
   * which is stated as a note rather than treated as "there are none" — the
   * difference decides whether a pre-release ordinal can be trusted.
   */
  existingTags?: readonly string[];
  /** Commit subjects since the last release, for the bump classification. */
  commitSubjects?: readonly string[];
  /** The newest finished release, when one was readable. */
  lastStableVersion?: string;
  /** Injected clock, for CalVer. Absent refuses a CalVer plan rather than guessing. */
  now?: number;
}

export interface VersionPlan {
  /** False when no policy is declared. Everything else is then advisory. */
  declared: boolean;
  scheme: VersioningScheme;
  /** The channel this branch produces, when one matched. */
  channel?: VersionChannel;
  /** The version this branch's next build would carry. Absent when refused. */
  nextVersion?: string;
  /** The tag that version would take, prefix applied. Absent when refused. */
  nextTag?: string;
  /** The declared rule that decided it. Always present, including on a refusal. */
  rule: VersionPlanRule;
  /** The bump the commit range warrants. Absent when the convention is off. */
  bumpLevel?: BumpLevel;
  /** What could not be established. Never fatal, always stated. */
  notes: string[];
  /** Set when no number could be produced. */
  refusal?: { reason: string; detail: string };
}

// -- Parsing ------------------------------------------------------

const CORE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PRERELEASE_IDENTIFIER = /^[0-9A-Za-z-]+$/;

/**
 * Parse a version, refusing anything that is not one.
 *
 * Deliberately strict where `compareSemver` is lenient, and the asymmetry is the
 * design: comparison is asked about values that already exist and must produce
 * *some* answer, while parsing is asked whether a value may be built on. Leading
 * zeroes are refused because `01.2.3` and `1.2.3` are the same number, and two
 * spellings of one version is how a tag stops matching the release it names.
 */
export function parseVersion(value: unknown): ParsedVersion | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().replace(/^v/i, '');
  if (!trimmed || trimmed.length > 120) {
    return undefined;
  }
  const plus = trimmed.indexOf('+');
  const build = plus === -1 ? undefined : trimmed.slice(plus + 1);
  const withoutBuild = plus === -1 ? trimmed : trimmed.slice(0, plus);
  if (build !== undefined && !/^[0-9A-Za-z.-]+$/.test(build)) {
    return undefined;
  }

  const dash = withoutBuild.indexOf('-');
  const coreText = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const preText = dash === -1 ? '' : withoutBuild.slice(dash + 1);

  const match = CORE_PATTERN.exec(coreText);
  if (!match) {
    return undefined;
  }
  const prerelease = preText ? preText.split('.') : [];
  if (prerelease.some(part => !PRERELEASE_IDENTIFIER.test(part))) {
    return undefined;
  }
  // A numeric identifier may not carry a leading zero, for the same reason the
  // core may not: two spellings of one ordinal.
  if (prerelease.some(part => /^0\d+$/.test(part))) {
    return undefined;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease,
    ...(build === undefined ? {} : { build }),
    core: `${match[1]}.${match[2]}.${match[3]}`,
  };
}

/** Render a parsed version back to its string form, metadata dropped. */
export function formatVersion(parsed: ParsedVersion): string {
  return parsed.prerelease.length > 0
    ? `${parsed.core}-${parsed.prerelease.join('.')}`
    : parsed.core;
}

// -- Channel matching ---------------------------------------------

const PATTERN_SUFFIX = '/*';

/**
 * The channel a branch produces.
 *
 * An exact branch match always beats a pattern, and among patterns the longest
 * prefix wins — so a `release/1.5` channel declared beside a `release/` pattern
 * behaves the way whoever declared both plainly meant. Declaration order breaks
 * a genuine tie, so the answer cannot depend on which entry was written first
 * by accident.
 */
export function channelForBranch(
  policy: VersioningPolicy,
  branch: string,
): VersionChannel | undefined {
  const name = (branch ?? '').trim();
  if (!name) {
    return undefined;
  }
  const exact = policy.channels.find(channel => channel.branch === name);
  if (exact) {
    return exact;
  }
  let best: VersionChannel | undefined;
  let bestLength = -1;
  for (const channel of policy.channels) {
    if (!channel.branch.endsWith(PATTERN_SUFFIX)) {
      continue;
    }
    const prefix = channel.branch.slice(0, -1);
    if (name.startsWith(prefix) && prefix.length > bestLength) {
      best = channel;
      bestLength = prefix.length;
    }
  }
  return best;
}

/** The channel that publishes finished versions, when the policy declares one. */
export function stableChannel(policy: VersioningPolicy): VersionChannel | undefined {
  return policy.channels.find(
    channel => channel.stability === 'stable' && channel.prerelease === undefined,
  );
}

// -- The recommended default --------------------------------------

/**
 * The policy AtlasMind would suggest, given the branches a project already has.
 *
 * Offered, never applied — rule 3. SemVer with Conventional Commits and a
 * branch-to-channel map is the majority professional practice, and the shape
 * below is what semantic-release, release-please and Changesets all converge on:
 * one linear release line, with the branch deciding the pre-release identifier
 * and the distribution tag rather than a separate number.
 */
export function recommendedVersioningPolicy(input: {
  integrationBranch: string;
  releaseBranch: string;
  tagPrefix?: string;
  /** True when the project keeps the number in the manifest by choice. */
  manifestSourced?: boolean;
}): VersioningPolicy {
  const integration = (input.integrationBranch || 'develop').trim();
  const release = (input.releaseBranch || 'main').trim();
  const channels: VersionChannel[] = [
    {
      id: 'stable',
      label: 'Stable',
      branch: release,
      distTag: 'latest',
      stability: 'stable',
    },
    {
      id: 'candidate',
      label: 'Release candidate',
      branch: `release${PATTERN_SUFFIX}`,
      prerelease: 'rc',
      distTag: 'rc',
      stability: 'candidate',
    },
  ];
  // A project whose integration branch *is* its release branch gets one channel,
  // not two identical ones: trunk-based development is a supported shape, not a
  // misconfiguration to pad out.
  if (integration && integration !== release) {
    channels.splice(1, 0, {
      id: 'preview',
      label: 'Preview',
      branch: integration,
      prerelease: 'beta',
      distTag: 'next',
      stability: 'preview',
    });
  }
  return {
    scheme: 'semver',
    source: input.manifestSourced ? 'manifest' : 'tag',
    commitConvention: 'conventional',
    channels,
    tagPrefix: input.tagPrefix ?? 'v',
  };
}

// -- Derivation ---------------------------------------------------

const rule = (id: VersionPlanRuleId): VersionPlanRule => ({ id, text: VERSION_PLAN_RULES[id] });

/**
 * What the current branch's next version would be, and which declared rule says so.
 *
 * Nothing is written and nothing is tagged. A plan is a reading.
 */
export function deriveVersionPlan(input: VersionPlanInput): VersionPlan {
  const notes: string[] = [];

  if (!input.policy) {
    return {
      declared: false,
      scheme: 'manual',
      rule: rule('not-declared'),
      notes: ['No versioning policy is declared for this project.'],
      refusal: {
        reason: 'not-declared',
        detail: 'Declare a versioning policy in the workflow file to derive a version per branch.',
      },
    };
  }

  const policy = input.policy;
  const prefix = policy.tagPrefix ?? 'v';
  const tagged = (version: string): string => `${prefix}${version}`;

  if (policy.scheme === 'manual') {
    const parsed = parseVersion(input.manifestVersion);
    if (!parsed) {
      return {
        declared: true,
        scheme: 'manual',
        rule: rule('unparseable'),
        notes: ['The manifest version could not be parsed.'],
        refusal: { reason: 'unparseable', detail: `\`${input.manifestVersion}\` is not a version.` },
      };
    }
    const next = formatVersion(parsed);
    return {
      declared: true,
      scheme: 'manual',
      ...(channelForBranch(policy, input.currentBranch) === undefined
        ? {}
        : { channel: channelForBranch(policy, input.currentBranch) }),
      nextVersion: next,
      nextTag: tagged(next),
      rule: rule('manual'),
      notes,
    };
  }

  if (policy.scheme === 'calver') {
    return deriveCalverPlan(policy, input, notes, tagged);
  }

  return deriveSemverPlan(policy, input, notes, tagged);
}

function deriveCalverPlan(
  policy: VersioningPolicy,
  input: VersionPlanInput,
  notes: string[],
  tagged: (version: string) => string,
): VersionPlan {
  if (input.now === undefined) {
    return {
      declared: true,
      scheme: 'calver',
      rule: rule('calver'),
      notes: ['The current date was not supplied, so no CalVer version was derived.'],
      refusal: {
        reason: 'no-clock',
        detail: 'A CalVer version is a fact about today, and today was not provided.',
      },
    };
  }
  const date = new Date(input.now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  // The ordinal counts what already shipped this period. Absent tags mean nobody
  // looked, which is stated rather than read as "nothing shipped" — the same
  // distinction the attention feed refuses to collapse.
  if (input.existingTags === undefined) {
    notes.push('Tags were not read, so this ordinal may already be taken.');
  }
  const used = (input.existingTags ?? [])
    .map(tag => parseVersion(tag))
    .filter((parsed): parsed is ParsedVersion => parsed !== undefined)
    .filter(parsed => parsed.major === year && parsed.minor === month)
    .map(parsed => parsed.patch);
  const ordinal = used.length === 0 ? 0 : Math.max(...used) + 1;
  const next = `${year}.${month}.${ordinal}`;
  const channel = channelForBranch(policy, input.currentBranch);

  return {
    declared: true,
    scheme: 'calver',
    ...(channel === undefined ? {} : { channel }),
    nextVersion: next,
    nextTag: tagged(next),
    rule: rule('calver'),
    notes,
  };
}

function deriveSemverPlan(
  policy: VersioningPolicy,
  input: VersionPlanInput,
  notes: string[],
  tagged: (version: string) => string,
): VersionPlan {
  const channel = channelForBranch(policy, input.currentBranch);
  if (!channel) {
    return {
      declared: true,
      scheme: 'semver',
      rule: rule('no-channel'),
      notes: [`\`${input.currentBranch}\` matches no declared channel.`],
      refusal: {
        reason: 'no-channel',
        detail: 'Feature branches produce no version of their own. That is the normal case, not a fault.',
      },
    };
  }

  const bumpLevel: BumpLevel | undefined =
    policy.commitConvention === 'conventional'
      ? classifyBumpLevel(input.commitSubjects ?? [])
      : undefined;
  if (policy.commitConvention === 'conventional' && (input.commitSubjects ?? []).length === 0) {
    notes.push('No commits were read, so the bump level falls to patch.');
  }

  // The line to build on is the last *finished* release wherever one is known:
  // the manifest may already carry a pre-release of the line being prepared, and
  // bumping on top of that skips a version number nobody ever released.
  const baseText = input.lastStableVersion ?? input.manifestVersion;
  const base = parseVersion(baseText);
  if (!base) {
    return {
      declared: true,
      scheme: 'semver',
      channel,
      rule: rule('unparseable'),
      notes: [...notes, `\`${baseText}\` is not a version.`],
      refusal: { reason: 'unparseable', detail: `Cannot derive a version from \`${baseText}\`.` },
    };
  }

  if (input.existingTags === undefined) {
    notes.push('Tags were not read, so an open pre-release on this line would not have been seen.');
  }

  if (channel.prerelease === undefined) {
    const manifest = parseVersion(input.manifestVersion);
    // A finished channel. Where the manifest already carries a pre-release ahead
    // of the last release, this is that line being finished — rule 1: the
    // release line is preserved and only the pre-release identity drops away.
    if (manifest && manifest.prerelease.length > 0 && compareSemver(manifest.core, base.core) > 0) {
      return {
        declared: true,
        scheme: 'semver',
        channel,
        nextVersion: manifest.core,
        nextTag: tagged(manifest.core),
        rule: rule('finalize'),
        ...(bumpLevel === undefined ? {} : { bumpLevel }),
        notes,
      };
    }
    const next = bumpVersion(base.core, bumpLevel ?? 'patch');
    return {
      declared: true,
      scheme: 'semver',
      channel,
      nextVersion: next,
      nextTag: tagged(next),
      rule: rule('bump-stable'),
      ...(bumpLevel === undefined ? {} : { bumpLevel }),
      notes,
    };
  }

  // A pre-release channel. Continue the line already open where there is one, so
  // a second beta does not re-open at `.1` and collide with the first.
  const identifier = channel.prerelease;
  const open = highestPrerelease(input.existingTags ?? [], identifier, base.core);
  if (open) {
    const next = `${open.core}-${identifier}.${open.ordinal + 1}`;
    return {
      declared: true,
      scheme: 'semver',
      channel,
      nextVersion: next,
      nextTag: tagged(next),
      rule: rule('continue-prerelease'),
      ...(bumpLevel === undefined ? {} : { bumpLevel }),
      notes,
    };
  }

  const line = bumpVersion(base.core, bumpLevel ?? 'patch');
  const next = `${line}-${identifier}.1`;
  return {
    declared: true,
    scheme: 'semver',
    channel,
    nextVersion: next,
    nextTag: tagged(next),
    rule: rule('open-prerelease'),
    ...(bumpLevel === undefined ? {} : { bumpLevel }),
    notes,
  };
}

/**
 * The highest open pre-release on `identifier`, above `afterCore`.
 *
 * Only lines *ahead of* the last release count: a `1.4.0-beta.2` left behind
 * when `1.4.0` shipped is history, and continuing it would produce a version
 * SemVer orders below something already published.
 */
function highestPrerelease(
  tags: readonly string[],
  identifier: string,
  afterCore: string,
): { core: string; ordinal: number } | undefined {
  let best: { core: string; ordinal: number } | undefined;
  for (const tag of tags) {
    const parsed = parseVersion(tag);
    if (!parsed || parsed.prerelease.length !== 2) {
      continue;
    }
    const [name, ordinalText] = parsed.prerelease;
    if (name !== identifier || !/^\d+$/.test(ordinalText)) {
      continue;
    }
    if (compareSemver(parsed.core, afterCore) <= 0) {
      continue;
    }
    const ordinal = Number.parseInt(ordinalText, 10);
    if (!best) {
      best = { core: parsed.core, ordinal };
      continue;
    }
    const lineDiff = compareSemver(parsed.core, best.core);
    if (lineDiff > 0 || (lineDiff === 0 && ordinal > best.ordinal)) {
      best = { core: parsed.core, ordinal };
    }
  }
  return best;
}

// -- Promotion ----------------------------------------------------

export type PromotionRefusal = 're-mint' | 'backward' | 'unparseable' | 'same-channel' | 'no-channel';

export type VersionPromotion =
  | { ok: true; version: string; tag: string; from?: VersionChannel; to: VersionChannel; rule: string }
  | { ok: false; reason: PromotionRefusal; detail: string };

/**
 * Move a version from the channel it is on to another one.
 *
 * This is rule 1 made executable. The release line — major, minor and patch — is
 * carried across untouched; only the pre-release identity changes. A promotion
 * that would alter the line is **refused**, not performed, because the artifact
 * on the other side would be a different one wearing the tested one's name.
 *
 * Moving backwards is refused for the same reason from the other direction:
 * `1.5.0` demoted to a preview channel would produce `1.5.0-beta.1`, which
 * SemVer orders *below* the version it came from — a release going backwards.
 */
export function promoteVersion(
  policy: VersioningPolicy,
  version: string,
  toChannelId: string,
): VersionPromotion {
  const parsed = parseVersion(version);
  if (!parsed) {
    return { ok: false, reason: 'unparseable', detail: `\`${version}\` is not a version.` };
  }
  const target = policy.channels.find(channel => channel.id === toChannelId);
  if (!target) {
    return {
      ok: false,
      reason: 'no-channel',
      detail: `No channel is declared with the id \`${toChannelId}\`.`,
    };
  }

  const currentIdentifier = parsed.prerelease[0];
  const from = policy.channels.find(channel =>
    currentIdentifier === undefined
      ? channel.prerelease === undefined
      : channel.prerelease === currentIdentifier);

  if (currentIdentifier !== undefined && !from) {
    return {
      ok: false,
      reason: 'unparseable',
      detail: `${version} carries a \`${currentIdentifier}\` pre-release, which no declared channel produces.`,
    };
  }
  if (from && from.id === target.id) {
    return {
      ok: false,
      reason: 'same-channel',
      detail: `${version} is already on ${target.label}. Advancing its ordinal is a build, not a promotion.`,
    };
  }
  const fromRank = from ? CHANNEL_RANK[from.stability] : CHANNEL_RANK.stable;
  if (CHANNEL_RANK[target.stability] < fromRank) {
    return {
      ok: false,
      reason: 'backward',
      detail: from
        ? `${target.label} is less finished than ${from.label}. The result would order below ${version}, which no release may do.`
        : `${version} is already finished. Moving it to ${target.label} would order it below itself.`,
    };
  }

  const next = target.prerelease === undefined
    ? parsed.core
    : `${parsed.core}-${target.prerelease}.1`;
  return {
    ok: true,
    version: next,
    tag: `${policy.tagPrefix ?? 'v'}${next}`,
    ...(from === undefined ? {} : { from }),
    to: target,
    rule: `The release line ${parsed.core} is carried across unchanged; only the channel identity changes.`,
  };
}

// -- Description --------------------------------------------------

/** The one-line account, for a card kicker. Names the rule, not just the number. */
export function describeVersionPlan(plan: VersionPlan): string {
  if (!plan.declared) {
    return 'No versioning policy is declared. AtlasMind is not assuming one.';
  }
  if (plan.refusal) {
    return `No version derived: ${plan.refusal.detail}`;
  }
  const where = plan.channel ? ` on ${plan.channel.label}` : '';
  return `Next${where}: ${plan.nextTag ?? plan.nextVersion} — ${plan.rule.text}`;
}

// -- Boundary -----------------------------------------------------

const MAX_CHANNELS = 12;
const IDENTIFIER = /^[0-9A-Za-z-]+$/;

/**
 * Read a policy out of the committed workflow file.
 *
 * Every field is validated rather than cleaned. A pre-release identifier ends up
 * inside a version string that reaches `git tag` and a package registry, so a
 * nearly-valid one made plausible fails later, somewhere nobody connects back to
 * this file. A channel that does not survive is dropped rather than repaired —
 * but one bad channel does not discard the document, because losing a team's
 * whole versioning decision to a typo in the fourth channel is the worse
 * failure. `validateVersioningPolicy` is what reports the loss.
 */
export function sanitizeVersioningPolicy(input: unknown): VersioningPolicy | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const scheme = raw['scheme'];
  if (scheme !== 'semver' && scheme !== 'calver' && scheme !== 'manual') {
    return undefined;
  }
  const source: VersionSource = raw['source'] === 'manifest' ? 'manifest' : 'tag';
  const commitConvention = raw['commitConvention'] === 'none' ? 'none' : 'conventional';
  const prefixRaw = raw['tagPrefix'];
  const tagPrefix =
    typeof prefixRaw === 'string' && /^[A-Za-z-]{0,8}$/.test(prefixRaw) ? prefixRaw : 'v';

  const channels: VersionChannel[] = [];
  const seen = new Set<string>();
  const rawChannels = Array.isArray(raw['channels']) ? raw['channels'].slice(0, MAX_CHANNELS) : [];
  for (const entry of rawChannels) {
    const channel = sanitizeChannel(entry);
    if (!channel || seen.has(channel.id)) {
      continue;
    }
    seen.add(channel.id);
    channels.push(channel);
  }

  return { scheme, source, commitConvention, channels, tagPrefix };
}

function sanitizeChannel(value: unknown): VersionChannel | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
  if (!IDENTIFIER.test(id) || id.length > 40) {
    return undefined;
  }
  const branch = sanitizeChannelBranch(raw['branch']);
  if (branch === undefined) {
    return undefined;
  }
  const stabilityRaw = raw['stability'];
  const stability: ChannelStability =
    stabilityRaw === 'stable' || stabilityRaw === 'candidate' || stabilityRaw === 'preview'
      ? stabilityRaw
      : 'preview';

  const prereleaseRaw = raw['prerelease'];
  let prerelease: string | undefined;
  if (typeof prereleaseRaw === 'string' && prereleaseRaw.trim()) {
    const candidate = prereleaseRaw.trim();
    // Refused rather than cleaned: this becomes part of a tag. A purely numeric
    // identifier is refused too, because `1.5.0-2.1` reads as an ordinal pair
    // rather than as a channel and nothing downstream could tell them apart.
    if (!IDENTIFIER.test(candidate) || candidate.length > 20 || /^\d+$/.test(candidate)) {
      return undefined;
    }
    prerelease = candidate;
  }

  const distRaw = raw['distTag'];
  const distTag =
    typeof distRaw === 'string' && IDENTIFIER.test(distRaw.trim()) && distRaw.trim().length <= 40
      ? distRaw.trim()
      : (prerelease ?? 'latest');

  const labelRaw = raw['label'];
  // A label is display text, so it is *cleaned* rather than refused: the
  // opposite call from the branch and the pre-release identifier, and for the
  // opposite reason. Nothing downstream executes a label, so a stripped
  // control character costs one character, while a refused channel would cost
  // the whole channel.
  const label = typeof labelRaw === 'string' ? cleanChannelLabel(labelRaw) : '';

  return {
    id,
    label: label || id,
    branch,
    ...(prerelease === undefined ? {} : { prerelease }),
    distTag,
    stability,
  };
}

/**
 * Clean a channel label for display.
 *
 * Written as a scan rather than a regular expression because the character
 * class it needs is the one most often mistyped, and a control character that
 * survives reaches a webview.
 */
function cleanChannelLabel(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out.split(' ').filter(Boolean).join(' ').slice(0, 60).trim();
}

/**
 * A channel's branch. Validated, never cleaned — it reaches `git`.
 *
 * Mirrors `roadmapGraphStore`'s refusal set, with one addition: a trailing
 * pattern marker is a declared wildcard rather than an illegal character, so it
 * is removed before the rest of the name is checked.
 */
function sanitizeChannelBranch(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) {
    return undefined;
  }
  const isPattern = trimmed.endsWith(PATTERN_SUFFIX);
  const bare = isPattern ? trimmed.slice(0, -PATTERN_SUFFIX.length) : trimmed;
  if (!bare) {
    return undefined;
  }
  if (
    /[~^:\s\\?*[\]]|\.\.|@\{/.test(bare)
    || bare.startsWith('-')
    || bare.endsWith('/')
    || bare.endsWith('.lock')
  ) {
    return undefined;
  }
  return trimmed;
}

/**
 * Does the policy describe branches this repository actually has?
 *
 * A channel naming a branch nobody created is **reported, never dropped** — the
 * same call `workflowConfig` makes about an unresolvable owner. A silently
 * removed channel reads as a channel nobody declared, and the team is left
 * looking for the setting they are certain they wrote.
 */
export function validateVersioningPolicy(
  policy: VersioningPolicy,
  knownBranches: readonly string[],
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (policy.channels.length === 0) {
    errors.push('No channels are declared, so no branch produces a version.');
  }
  if (policy.scheme === 'semver' && policy.channels.length > 0 && !stableChannel(policy)) {
    errors.push('No channel publishes finished versions, so nothing could ever be released.');
  }

  const branches = new Set(knownBranches);
  const identifiers = new Map<string, string>();
  for (const channel of policy.channels) {
    if (
      knownBranches.length > 0
      && !channel.branch.endsWith(PATTERN_SUFFIX)
      && !branches.has(channel.branch)
    ) {
      warnings.push(
        `Channel \`${channel.label}\` names the branch \`${channel.branch}\`, which does not exist.`,
      );
    }
    if (channel.prerelease) {
      const existing = identifiers.get(channel.prerelease);
      if (existing) {
        // Two channels stamping one identifier leaves the identifier unable to
        // say which channel a version came from, which is its whole job.
        errors.push(
          `Channels \`${existing}\` and \`${channel.label}\` both stamp \`${channel.prerelease}\`.`,
        );
      } else {
        identifiers.set(channel.prerelease, channel.label);
      }
    }
  }
  return { errors, warnings };
}
