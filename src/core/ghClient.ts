/**
 * The single boundary between AtlasMind and the GitHub CLI.
 *
 * Before this module there were three independent `gh` call sites — one in the
 * dashboard panel, one in the bootstrapper, and one that built a command
 * *string* for later shell execution. Three call sites means three answers to
 * "is this argument escaped?", and only one of them needs to be wrong.
 *
 * Three properties are load-bearing:
 *
 * 1. **No shell, ever.** Every call is `execFile(cmd, args)` with an argv array.
 *    A repository name, an issue title, or a branch name can therefore contain
 *    a semicolon, a backtick, or a newline without becoming a second command.
 *    `assertNoShellMetacharacters` is belt-and-braces on top of that, and a test
 *    asserts no caller passes a composed string.
 *
 * 2. **AtlasMind holds no credential.** It shells to an already-authenticated
 *    `gh`. The user's GitHub authorisation is managed by GitHub's own tooling,
 *    lives in the OS keychain, and is revocable there. There is no token
 *    setting, and adding one would move a secret AtlasMind does not need into a
 *    place it does not belong.
 *
 * 3. **A failure names its fix.** "Command failed with exit code 1" is not
 *    actionable. {@link classifyGhFailure} distinguishes not-installed from
 *    not-authenticated from rate-limited, and each carries the command that
 *    resolves it.
 *
 * The process runner is injected, so this module is unit-testable without a
 * `gh` binary and without `vscode`.
 */

/** Why a `gh` call did not produce an answer. */
export type GhFailureKind =
  /** The CLI is not on PATH. */
  | 'no-cli'
  /** Installed, but not signed in for this repository. */
  | 'not-authenticated'
  /** Signed in, but GitHub is refusing on quota. */
  | 'rate-limited'
  /** Signed in, but not permitted to do this. */
  | 'forbidden'
  /** The resource does not exist, or is not visible to this account. */
  | 'not-found'
  /** The call took longer than its budget. */
  | 'timeout'
  /** Anything else. */
  | 'error';

export interface GhFailure {
  kind: GhFailureKind;
  /** One sentence, safe to show a user. */
  detail: string;
  /** The command that resolves it, where one exists. */
  fixCommand?: string;
}

export type GhResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: GhFailure };

/**
 * A `gh` failure as a throwable, for call sites whose contract is exceptions.
 *
 * Several existing callers are written around try/catch and would be riskier to
 * invert than to adapt. Carrying the classified {@link GhFailure} on the error
 * means those sites keep their shape without the diagnosis being re-derived
 * from a message string — which is how two slightly different classifications
 * of the same failure end up in one codebase.
 */
export class GhError extends Error {
  readonly failure: GhFailure;

  constructor(failure: GhFailure) {
    super(failure.detail);
    this.name = 'GhError';
    this.failure = failure;
  }
}

/** The classified failure behind an error, whatever form it arrived in. */
export function ghFailureOf(error: unknown): GhFailure {
  return error instanceof GhError ? error.failure : classifyGhFailure(error);
}

/** Injected so tests never spawn a process. */
export interface GhProcessRunner {
  (
    command: string,
    args: readonly string[],
    options: { cwd: string; timeout: number; maxBuffer: number },
  ): Promise<{ stdout: string; stderr: string }>;
}

export interface GhClientOptions {
  workspaceRoot: string;
  run: GhProcessRunner;
  /** Per-call budget. `gh` is a network call; a render path must never wait on it. */
  timeoutMs?: number;
  maxBufferBytes?: number;
}

/** Eight seconds, matching the existing dashboard call site. */
export const DEFAULT_GH_TIMEOUT_MS = 8_000;
/** One megabyte. An issue list is text; anything larger is a bug or an attack. */
export const DEFAULT_GH_MAX_BUFFER = 1024 * 1024;

/**
 * Characters that would matter *if* a command were ever composed as a string.
 *
 * Nothing here composes one, so this check can never fire in correct code —
 * which is exactly why it is worth having. It converts a future refactor that
 * reintroduces string composition from a silent vulnerability into a loud
 * failure at the call site.
 */
const SHELL_METACHARACTERS = /[;&|`$><\n\r]/;

export function assertNoShellMetacharacters(args: readonly string[]): void {
  for (const arg of args) {
    if (SHELL_METACHARACTERS.test(arg)) {
      throw new Error(
        `Refusing to run gh: argument contains a shell metacharacter. Arguments are passed as an argv array and must never be composed into a command string.`,
      );
    }
  }
}

/**
 * Turn a thrown error into the specific thing that is wrong.
 *
 * Ordered most-specific first. The `auth` test runs before the generic error
 * fallback because an unauthenticated `gh` fails with a message that also
 * contains the word "error", and reporting that as an unknown failure would
 * send someone to read logs instead of running one command.
 */
export function classifyGhFailure(error: unknown): GhFailure {
  const message = error instanceof Error ? error.message : String(error);

  if (/ENOENT|not recognized|command not found|spawn gh/i.test(message)) {
    return {
      kind: 'no-cli',
      detail: 'The GitHub CLI (`gh`) is not installed, so AtlasMind cannot read this repository.',
      fixCommand: process.platform === 'win32'
        ? 'winget install --id GitHub.cli'
        : process.platform === 'darwin'
          ? 'brew install gh'
          : 'See https://github.com/cli/cli#installation',
    };
  }

  if (/ETIMEDOUT|timed out|timeout/i.test(message)) {
    return {
      kind: 'timeout',
      detail: 'The GitHub CLI did not respond in time.',
    };
  }

  if (/rate limit|API rate limit exceeded|secondary rate/i.test(message)) {
    return {
      kind: 'rate-limited',
      detail: 'GitHub is rate-limiting this account. Wait for the window to reset before retrying.',
      fixCommand: 'gh api rate_limit',
    };
  }

  if (/auth|login|credential|token|Bad credentials|not logged/i.test(message)) {
    return {
      kind: 'not-authenticated',
      detail: 'The GitHub CLI is installed but not authenticated for this repository.',
      fixCommand: 'gh auth login',
    };
  }

  if (/HTTP 403|Forbidden|Resource not accessible/i.test(message)) {
    return {
      kind: 'forbidden',
      detail: 'This account is not permitted to perform that action on this repository.',
      fixCommand: 'gh auth status',
    };
  }

  if (/HTTP 404|Not Found|could not resolve to a Repository/i.test(message)) {
    return {
      kind: 'not-found',
      detail: 'GitHub could not find that resource, or this account cannot see it.',
    };
  }

  return {
    kind: 'error',
    detail: `The GitHub CLI failed: ${message.slice(0, 300)}`,
  };
}

/**
 * A `gh` invocation.
 *
 * Every method returns a {@link GhResult} rather than throwing, because every
 * caller is a surface that must keep rendering when GitHub is unreachable. A
 * dashboard that throws on a network failure is a dashboard that disappears
 * exactly when you wanted to know what was wrong.
 */
export class GhClient {
  private readonly workspaceRoot: string;
  private readonly run: GhProcessRunner;
  private readonly timeoutMs: number;
  private readonly maxBufferBytes: number;

  constructor(options: GhClientOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.run = options.run;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_GH_TIMEOUT_MS;
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_GH_MAX_BUFFER;
  }

  /** Raw stdout, trimmed. */
  async exec(args: readonly string[]): Promise<GhResult<string>> {
    try {
      assertNoShellMetacharacters(args);
      const { stdout } = await this.run('gh', args, {
        cwd: this.workspaceRoot,
        timeout: this.timeoutMs,
        maxBuffer: this.maxBufferBytes,
      });
      return { ok: true, value: stdout.trim() };
    } catch (error) {
      return { ok: false, failure: classifyGhFailure(error) };
    }
  }

  /**
   * Parsed JSON.
   *
   * A malformed body is a failure rather than an exception: `gh` occasionally
   * writes a warning to stdout ahead of its JSON, and a surface should report
   * that as "could not read" rather than crashing on it.
   */
  async json<T>(args: readonly string[]): Promise<GhResult<T>> {
    const result = await this.exec(args);
    if (!result.ok) {
      return result;
    }
    try {
      return { ok: true, value: JSON.parse(result.value) as T };
    } catch {
      return {
        ok: false,
        failure: {
          kind: 'error',
          detail: 'The GitHub CLI returned output that was not valid JSON.',
        },
      };
    }
  }

  /** `owner/name` for the current workspace, or a failure explaining why not. */
  async repoSlug(): Promise<GhResult<string>> {
    return this.exec(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
  }

  /**
   * Whether `gh` is installed and authenticated, without assuming either.
   *
   * `installed` requires **positive evidence that the binary ran** — either it
   * succeeded, or it failed in a way only a running `gh` can produce (it told
   * us we are signed out, or GitHub itself refused us). An unclassifiable
   * failure reports `installed: false`, because "we could not tell" is not
   * "it is there": reading an unknown error as success would have a caller skip
   * offering to install the very thing that is missing. Being wrong the other
   * way merely offers an install that turns out to be unnecessary.
   */
  async probe(): Promise<{ installed: boolean; authenticated: boolean; failure?: GhFailure }> {
    const result = await this.exec(['auth', 'status']);
    if (result.ok) {
      return { installed: true, authenticated: true };
    }
    const { failure } = result;
    // Each of these can only be produced by a `gh` that actually executed.
    const ranSuccessfullyEnoughToProveItExists =
      failure.kind === 'not-authenticated'
      || failure.kind === 'rate-limited'
      || failure.kind === 'forbidden'
      || failure.kind === 'not-found';
    return {
      installed: ranSuccessfullyEnoughToProveItExists,
      authenticated: false,
      failure,
    };
  }
}

/**
 * Run `gh` and return stdout, throwing {@link GhError} on failure.
 *
 * The adapter for call sites whose contract is exceptions. Everything still
 * goes through {@link GhClient}, so the no-shell guarantee and the failure
 * classification are the same ones every other caller gets.
 */
export async function runGhOrThrow(
  workspaceRoot: string,
  args: readonly string[],
  options: { timeoutMs?: number; maxBufferBytes?: number } = {},
): Promise<string> {
  const client = new GhClient({
    workspaceRoot,
    run: nodeGhRunner,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
  });
  const result = await client.exec(args);
  if (!result.ok) {
    throw new GhError(result.failure);
  }
  return result.value;
}

/**
 * Stream `gh` stdout directly into another process without retaining it.
 *
 * The local CI runner uses this for GitHub's short-lived registration token:
 * `gh` writes the token and Docker reads it, while AtlasMind never receives a
 * string it could accidentally log, persist, or send to a webview. The same
 * argv-only and bounded-failure rules as {@link runGhOrThrow} apply.
 */
export async function pipeGhStdoutOrThrow(
  workspaceRoot: string,
  args: readonly string[],
  destination: NodeJS.WritableStream,
  options: { timeoutMs?: number; maxStderrBytes?: number } = {},
): Promise<void> {
  assertNoShellMetacharacters(args);
  const { spawn } = await import('node:child_process');
  const timeoutMs = options.timeoutMs ?? DEFAULT_GH_TIMEOUT_MS;
  const maxStderrBytes = options.maxStderrBytes ?? 64 * 1024;

  await new Promise<void>((resolve, reject) => {
    const child = spawn('gh', [...args], {
      cwd: workspaceRoot,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error === undefined) {
        resolve();
      } else {
        reject(new GhError(classifyGhFailure(error)));
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`gh timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < maxStderrBytes) {
        stderr += chunk.slice(0, maxStderrBytes - stderr.length);
      }
    });
    child.on('error', finish);
    destination.on('error', error => {
      child.kill();
      finish(error);
    });
    child.stdout.pipe(destination);
    child.on('close', code => {
      if (code === 0) {
        finish();
      } else {
        finish(new Error(stderr.trim() || `gh exited with code ${String(code)}`));
      }
    });
  });
}

/**
 * The default runner, built on `node:child_process`.
 *
 * Separated from the class so the class itself imports nothing and can be
 * exercised in a unit test with a fake.
 */
export async function nodeGhRunner(
  command: string,
  args: readonly string[],
  options: { cwd: string; timeout: number; maxBuffer: number },
): Promise<{ stdout: string; stderr: string }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const { stdout, stderr } = await execFileAsync(command, [...args], {
    cwd: options.cwd,
    windowsHide: true,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
}
