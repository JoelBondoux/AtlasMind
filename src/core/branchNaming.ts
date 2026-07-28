/**
 * Deriving a branch name from the issue it serves.
 *
 * A branch name is the only context a colleague — or you, next week — gets
 * before opening anything. `feat/142-derive-branch-names` says what and why;
 * `fix2` says neither. Deriving it also means the link back to the issue is
 * never forgotten, because it was never typed.
 *
 * Three properties are load-bearing, and each is asserted by test:
 *
 * 1. **Pure and predictable.** Same inputs, same name, every time. Collisions
 *    resolve by a deterministic ordinal suffix — never a hash, never a
 *    timestamp — because a developer who runs the same command twice must get a
 *    name they could have predicted rather than one they have to go and read.
 *
 * 2. **Incapable of producing a protected name.** The result always carries a
 *    `<type>/` prefix, so it can never collide with `main`, `master`,
 *    `production`, or a `release/*` pattern. That is a structural guarantee
 *    rather than a filter applied afterwards.
 *
 * 3. **Refuses rather than invents.** An empty slug after sanitisation is
 *    reported as a refusal with a reason, not quietly replaced by a generated
 *    id. An unreadable branch name is worse than a question.
 *
 * Pure, `vscode`-free, and unit-tested. See `docs/guided-github-workflow.md` §3.2.
 */

/** The conventional branch types, matching the commit-type vocabulary. */
export const BRANCH_TYPES = ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf'] as const;

export type BranchType = typeof BRANCH_TYPES[number];

/**
 * Refs git itself rejects, plus the ones that break tooling.
 *
 * Mirrors the validation already applied by AtlasMind's branch and push skills,
 * so a derived name cannot pass here and fail there.
 */
const INVALID_REF_CHARS = /[~^:\s\\?*[\]]|\.\.|@\{/;

/**
 * Names no derived branch may ever equal.
 *
 * The `<type>/` prefix already makes this unreachable; the set is kept as a
 * belt-and-braces assertion so a future change to the format cannot silently
 * make a protected name derivable.
 */
export const PROTECTED_BRANCH_NAMES = new Set([
  'main', 'master', 'production', 'prod', 'release', 'stable', 'develop', 'development',
]);

const PROTECTED_PREFIXES = ['release/', 'hotfix/'];

/** Default cap. Long enough to stay descriptive, short enough for a terminal. */
export const DEFAULT_BRANCH_MAX_LENGTH = 60;

export interface BranchNameRequest {
  type: BranchType;
  /** The issue this branch closes. Omitted only when there genuinely isn't one. */
  issueNumber?: number;
  /** The issue title, or a description of the work. */
  title: string;
  maxLength?: number;
  /** Names already taken — locally or on the remote. Drives the ordinal suffix. */
  existing?: readonly string[];
}

export type BranchNameResult =
  | { ok: true; name: string; slug: string }
  | { ok: false; reason: string };

/**
 * Reduce a title to an ASCII slug.
 *
 * Accents are folded to their base letter rather than dropped, so "Café" yields
 * `cafe` instead of `caf` — dropping produces a word that reads as a typo, and a
 * branch name is read far more often than it is typed.
 */
export function slugifyBranchTitle(title: string, maxLength: number): string {
  if (typeof title !== 'string') {
    return '';
  }
  const folded = title
    .normalize('NFKD')
    // Strip combining marks left behind by the decomposition.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  const words = folded
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return '';
  }

  // Truncate at a word boundary. A slug cut mid-word reads as a mistake, and the
  // last partial word carries almost no meaning anyway.
  const out: string[] = [];
  let length = 0;
  for (const word of words) {
    const added = out.length === 0 ? word.length : word.length + 1;
    if (length + added > maxLength) {
      break;
    }
    out.push(word);
    length += added;
  }

  // A single word longer than the budget would otherwise yield an empty slug,
  // which would be reported as a refusal for a title that is perfectly usable.
  if (out.length === 0) {
    return words[0]!.slice(0, maxLength);
  }

  return out.join('-');
}

/**
 * Derive a branch name.
 *
 * Refuses rather than guessing when the title reduces to nothing — a title of
 * "!!!" or "日本語" produces no ASCII slug, and inventing `feat/142-branch`
 * would be worse than asking.
 */
export function deriveBranchName(request: BranchNameRequest): BranchNameResult {
  const type = request.type;
  if (!BRANCH_TYPES.includes(type)) {
    return { ok: false, reason: `\`${String(type)}\` is not a branch type. Use one of: ${BRANCH_TYPES.join(', ')}.` };
  }

  const maxLength = Math.max(12, Math.floor(request.maxLength ?? DEFAULT_BRANCH_MAX_LENGTH));
  const issue = request.issueNumber;
  const hasIssue = typeof issue === 'number' && Number.isInteger(issue) && issue > 0;

  // Budget the slug against what the prefix already spends, so `maxLength` is a
  // promise about the whole name rather than about one part of it.
  const prefix = hasIssue ? `${type}/${issue}-` : `${type}/`;
  const slugBudget = maxLength - prefix.length;
  if (slugBudget < 3) {
    return { ok: false, reason: `A maximum length of ${maxLength} leaves no room for a description after \`${prefix}\`.` };
  }

  const slug = slugifyBranchTitle(request.title, slugBudget);
  if (!slug) {
    return {
      ok: false,
      reason: 'That title contains no characters usable in a branch name. Supply a name yourself.',
    };
  }

  const base = `${prefix}${slug}`;
  const name = resolveCollision(base, request.existing ?? []);

  // Structural guarantees, re-checked rather than assumed. If a future change to
  // the format ever made one of these reachable, it fails here rather than
  // producing a branch that cannot be pushed or that shadows a protected ref.
  if (INVALID_REF_CHARS.test(name) || name.endsWith('.lock') || name.endsWith('/')) {
    return { ok: false, reason: `\`${name}\` is not a valid git ref.` };
  }
  if (PROTECTED_BRANCH_NAMES.has(name) || PROTECTED_PREFIXES.some(p => name.startsWith(p))) {
    return { ok: false, reason: `\`${name}\` would collide with a protected branch.` };
  }

  return { ok: true, name, slug };
}

/**
 * Append `-2`, `-3`, … until the name is free.
 *
 * Ordinal rather than a hash or a timestamp, so the second attempt at the same
 * issue is predictably `-2` and the developer can tell at a glance that it is a
 * retry rather than a different piece of work.
 */
function resolveCollision(base: string, existing: readonly string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) {
    return base;
  }
  for (let ordinal = 2; ordinal < 1000; ordinal += 1) {
    const candidate = `${base}-${ordinal}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  // Unreachable in practice; returning the base lets the caller's ref-exists
  // blocker report the real problem rather than this function inventing one.
  return base;
}

/** Whether an existing branch name matches the convention. */
export function matchesBranchConvention(name: string): boolean {
  if (typeof name !== 'string') {
    return false;
  }
  const pattern = new RegExp(`^(${BRANCH_TYPES.join('|')})/(\\d+-)?[a-z0-9]+(-[a-z0-9]+)*$`);
  return pattern.test(name);
}

/**
 * Map a conventional-commit type, or a label, onto a branch type.
 *
 * Returns `undefined` rather than defaulting to `feat`, so a caller decides
 * what to do about an unrecognised input instead of silently mislabelling the
 * work — a branch typed `feat` for a bug fix distorts every later filter.
 */
export function inferBranchType(hint: string | undefined): BranchType | undefined {
  if (typeof hint !== 'string') {
    return undefined;
  }
  const normalized = hint.toLowerCase().trim().replace(/^type:/, '');
  if ((BRANCH_TYPES as readonly string[]).includes(normalized)) {
    return normalized as BranchType;
  }
  const aliases: Record<string, BranchType> = {
    bug: 'fix',
    bugfix: 'fix',
    feature: 'feat',
    enhancement: 'feat',
    documentation: 'docs',
    doc: 'docs',
    chore: 'chore',
    maintenance: 'chore',
    performance: 'perf',
    tests: 'test',
    testing: 'test',
  };
  return aliases[normalized];
}
