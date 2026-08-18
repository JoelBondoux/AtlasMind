/**
 * How much of this computer locally-run tests and checks may use.
 *
 * The Docker-based local CI runner was the only governed execution path:
 * `--cpus`, `--memory`, swap off, a pids limit and a 25% reserve. Every path
 * that runs on the host itself — the post-write auto-verification `npm test`,
 * the test-run and npm-scripts skills, the "Run here" pipeline route — had no
 * CPU, memory or worker governance at all, and those are exactly the paths
 * that can take a desktop down: Jest defaults to (cores − 1) workers, Stryker
 * to (cores − 1) concurrent *test runners*, and on a 24-thread machine an
 * ungoverned mutation run is ~23 ts-jest processes plus TypeScript checkers.
 * Measured on the machine that motivated this module, that is 40–60 GB of
 * commit charge on top of a ~48 GB baseline — commit exhaustion, which Windows
 * expresses as a black screen with corrupted desktop graphics, not a clean
 * failure anybody can read.
 *
 * Five rules:
 *
 * - **The reserve is for the operating system, and it is measured on the
 *   host.** Not on the Docker/WSL VM, whose "total memory" is already a slice
 *   of the machine. The floors are deliberately aggressive — a desktop that
 *   survives is worth more than a test run that finishes sooner — and they are
 *   floors on the *reserve*, so a bigger machine reserves proportionally more,
 *   never less.
 * - **One slider, every path.** `atlasmind.testing.resourceShare` states the
 *   percentage of the host that testing may use; the budget is the *lower* of
 *   that share and what the reserve leaves. Two knobs answering one question
 *   would eventually disagree, and the answer people trusted would be
 *   whichever surface they read last.
 * - **A budget can shrink a run but never refuse one.** Host paths clamp to a
 *   1-CPU / 1-GB floor rather than erroring: refusing to run tests at all is a
 *   worse outcome than running them slowly, and the container runner keeps its own
 *   separate refusal minimums because a container *can* be declined.
 * - **A throttle is appended only where it is known to be understood.** A
 *   `--maxWorkers` flag reaches Jest and Vitest, `--concurrency` reaches
 *   Stryker, and nothing is appended to a script whose body is unknown, is a
 *   compound command, or already states its own limit — a project that chose
 *   its parallelism has answered the question, and second-guessing it would
 *   make the setting an override rather than a default.
 * - **The environment cap is a merge, never a replacement.** `NODE_OPTIONS`
 *   routinely carries flags the machine needs (`--use-system-ca` on this one);
 *   a heap cap that clobbered them would break npm to protect it.
 */

export interface TestResourceHost {
  cpuCount: number;
  memoryGb: number;
}

export interface TestResourceBudget {
  /** The share that was actually applied, after clamping. */
  sharePercent: number;
  /** Logical CPUs testing may occupy. */
  cpus: number;
  /** Memory in GB testing may occupy, all processes together. */
  memoryGb: number;
  /** Worker cap for parallel test runners (Jest/Vitest `--maxWorkers`). */
  maxWorkers: number;
  /** Concurrency cap for mutation runs (Stryker `--concurrency`). */
  mutationConcurrency: number;
  /** Per-Node-process heap cap for `NODE_OPTIONS --max-old-space-size`. */
  perProcessHeapMb: number;
  /** What is left for the operating system, stated so a surface can say it. */
  reserveCpus: number;
  reserveMemoryGb: number;
  /** The rule that produced these numbers, for any surface that renders them. */
  rule: string;
}

export const TEST_RESOURCE_SHARE_DEFAULT = 50;
export const TEST_RESOURCE_SHARE_MIN = 10;
export const TEST_RESOURCE_SHARE_MAX = 90;
/**
 * The OS reserve floors. `max(floor, 25% of the host)` in both dimensions —
 * on a 24-thread / 64 GB machine that reserves 6 CPUs and 16 GB whatever the
 * slider says. 8 GB rather than the container path's old 2 GB because the
 * number that matters on Windows is *commit*, and a desktop session with a
 * browser, a compositor and an editor idles far above 2 GB.
 */
export const TEST_RESOURCE_RESERVE_MIN_CPUS = 2;
export const TEST_RESOURCE_RESERVE_MIN_MEMORY_GB = 8;

const HEAP_MB_MIN = 512;
const HEAP_MB_MAX = 4096;

/** Clamp a raw setting value onto the legal share range, defaulting the rest. */
export function clampTestResourceShare(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : TEST_RESOURCE_SHARE_DEFAULT;
  return Math.min(TEST_RESOURCE_SHARE_MAX, Math.max(TEST_RESOURCE_SHARE_MIN, numeric));
}

export function planTestResourceBudget(host: TestResourceHost, sharePercent: number): TestResourceBudget {
  const cpuCount = Math.max(1, Math.floor(host.cpuCount));
  const memoryGb = Math.max(1, host.memoryGb);
  const share = clampTestResourceShare(sharePercent);
  const reserveCpus = Math.max(TEST_RESOURCE_RESERVE_MIN_CPUS, Math.ceil(cpuCount * 0.25));
  const reserveMemoryGb = Math.max(TEST_RESOURCE_RESERVE_MIN_MEMORY_GB, Math.ceil(memoryGb * 0.25));
  const shareCpus = Math.floor((cpuCount * share) / 100);
  const shareMemoryGb = Math.floor((memoryGb * share) / 100);
  // The floor is 1, not a refusal: a host path that cannot run tests at all is
  // worse than one that runs them on a single worker.
  const cpus = Math.max(1, Math.min(shareCpus, cpuCount - reserveCpus));
  const budgetMemoryGb = Math.max(1, Math.min(shareMemoryGb, Math.floor(memoryGb - reserveMemoryGb)));
  const maxWorkers = cpus;
  // A mutation runner's workers are whole test runtimes, not test workers —
  // each is a Jest/Vitest process tree of its own — so they are budgeted at
  // half the worker cap and no more than one per 2 GB of budget.
  const mutationConcurrency = Math.max(1, Math.min(Math.floor(maxWorkers / 2) || 1, Math.floor(budgetMemoryGb / 2) || 1));
  const perProcessHeapMb = Math.min(
    HEAP_MB_MAX,
    Math.max(HEAP_MB_MIN, Math.floor((budgetMemoryGb * 1024) / (maxWorkers + 1))),
  );
  const reserveHonoured = cpuCount - reserveCpus >= 1 && memoryGb - reserveMemoryGb >= 1;
  return {
    sharePercent: share,
    cpus,
    memoryGb: budgetMemoryGb,
    maxWorkers,
    mutationConcurrency,
    perProcessHeapMb,
    reserveCpus,
    reserveMemoryGb,
    rule: reserveHonoured
      ? `min(${share}% of ${cpuCount} CPUs / ${memoryGb} GB, host minus a reserve of ${reserveCpus} CPUs / ${reserveMemoryGb} GB)`
      : `this machine is smaller than the OS reserve (${reserveCpus} CPUs / ${reserveMemoryGb} GB), so testing keeps the 1 CPU / 1 GB floor`,
  };
}

export type ThrottledTestRunner = 'jest' | 'vitest' | 'stryker';

export interface TestCommandThrottle {
  /** Flags to append after the script's own arguments (`--` handled by the caller). */
  extraArgs: string[];
  runner: ThrottledTestRunner | undefined;
  /** Why flags were or were not appended. */
  rule: string;
}

const COMPOUND_COMMAND = /(\&\&|\|\||[;|<>])/;
const DECLARED_LIMIT = /--max-?workers|--concurrency|--pool(?:=|\s)|--runInBand|--threads(?:=|\s)/i;

/**
 * Which throttle flags one npm script body can safely carry.
 *
 * Biased to false negatives on purpose: a script that cannot be *confidently*
 * throttled gets no flags and relies on the environment caps instead. The
 * flags would land after `npm run <script> --`, i.e. on whatever the script's
 * last command is — appending to a compound command would hand `--maxWorkers`
 * to something that may not be a test runner at all.
 */
export function planTestCommandThrottle(scriptBody: string | undefined, budget: TestResourceBudget): TestCommandThrottle {
  if (!scriptBody || !scriptBody.trim()) {
    return { extraArgs: [], runner: undefined, rule: 'script body unknown; environment caps only' };
  }
  const body = scriptBody.trim();
  if (COMPOUND_COMMAND.test(body)) {
    return { extraArgs: [], runner: undefined, rule: 'compound command; appended flags would reach only its last step' };
  }
  if (DECLARED_LIMIT.test(body)) {
    return { extraArgs: [], runner: undefined, rule: 'the script states its own parallelism, which is respected' };
  }
  const runner = detectThrottledRunner(body);
  if (runner === 'jest' || runner === 'vitest') {
    return {
      extraArgs: [`--maxWorkers=${budget.maxWorkers}`],
      runner,
      rule: `${runner} accepts --maxWorkers; capped at ${budget.maxWorkers} by ${budget.rule}`,
    };
  }
  if (runner === 'stryker') {
    return {
      extraArgs: ['--concurrency', String(budget.mutationConcurrency)],
      runner,
      rule: `stryker accepts --concurrency; capped at ${budget.mutationConcurrency} because each runner is a whole test runtime`,
    };
  }
  return { extraArgs: [], runner: undefined, rule: 'not a runner with a known worker flag; environment caps only' };
}

/** Leading tokens that are launchers or assignments, not the command itself. */
const LAUNCHER_TOKENS = new Set(['cross-env', 'npx', 'node', 'pnpm', 'yarn', 'npm', 'exec', 'run']);

function detectThrottledRunner(body: string): ThrottledTestRunner | undefined {
  const tokens = body.split(/\s+/);
  for (const token of tokens.slice(0, 6)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      continue;
    }
    const basename = token.replace(/["']/g, '').split(/[\\/]/).pop() ?? '';
    if (basename.startsWith('jest')) {
      return 'jest';
    }
    if (basename.startsWith('vitest')) {
      return 'vitest';
    }
    if (basename.startsWith('stryker')) {
      return 'stryker';
    }
    if (token.startsWith('-') || LAUNCHER_TOKENS.has(basename.toLowerCase())) {
      continue;
    }
    // The first real command is something else; appending flags to it would be
    // a guess, and a wrong guess is an argv error in somebody's test run.
    return undefined;
  }
  return undefined;
}

/**
 * Merge the per-process heap cap into an environment without disturbing it.
 *
 * `NODE_OPTIONS` is inherited by every Node child, which is what makes it the
 * one lever that reaches Jest and Vitest workers this code never spawns
 * directly. An existing `--max-old-space-size` — the project or the user
 * making their own choice — is left exactly as it is.
 */
export function withTestResourceEnv(
  baseEnv: Readonly<Record<string, string | undefined>>,
  budget: TestResourceBudget,
): Record<string, string | undefined> {
  const existing = baseEnv['NODE_OPTIONS'] ?? '';
  if (/--max-old-space-size/.test(existing)) {
    return { ...baseEnv };
  }
  const merged = `${existing} --max-old-space-size=${budget.perProcessHeapMb}`.trim();
  return { ...baseEnv, NODE_OPTIONS: merged };
}
