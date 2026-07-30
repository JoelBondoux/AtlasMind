import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GH_MAX_BUFFER,
  DEFAULT_GH_TIMEOUT_MS,
  GhClient,
  assertNoShellMetacharacters,
  classifyGhFailure,
  type GhProcessRunner,
} from '../../src/core/ghClient.ts';

/** A runner that records how it was called and returns whatever is scripted. */
const runnerReturning = (stdout: string): { run: GhProcessRunner; calls: unknown[][] } => {
  const calls: unknown[][] = [];
  const run: GhProcessRunner = async (command, args, options) => {
    calls.push([command, [...args], options]);
    return { stdout, stderr: '' };
  };
  return { run, calls };
};

const runnerThrowing = (error: unknown): GhProcessRunner => async () => {
  throw error;
};

const client = (run: GhProcessRunner): GhClient => new GhClient({ workspaceRoot: '/repo', run });

describe('assertNoShellMetacharacters', () => {
  it('accepts ordinary arguments', () => {
    expect(() => assertNoShellMetacharacters(['issue', 'list', '--json', 'number,title'])).not.toThrow();
  });

  it('rejects anything that would matter if a command were ever composed', () => {
    // Nothing in this module composes a command string, so this can never fire
    // in correct code. That is the point: it converts a future refactor that
    // reintroduces string composition from a silent hole into a loud failure.
    for (const bad of ['a; rm -rf /', 'a && b', 'a | b', '`whoami`', '$(id)', 'a > f', 'a\nb']) {
      expect(() => assertNoShellMetacharacters([bad]), bad).toThrow(/shell metacharacter/);
    }
  });

  it('permits characters that are only special to a shell it never uses', () => {
    // Quotes and spaces are safe in an argv array and appear in real issue
    // titles; rejecting them would break ordinary use for no security gain.
    expect(() => assertNoShellMetacharacters(["it's broken", 'a "quoted" title', 'a b'])).not.toThrow();
  });
});

describe('classifyGhFailure — a failure names its fix', () => {
  it('detects a missing CLI and offers an install command', () => {
    const failure = classifyGhFailure(new Error('spawn gh ENOENT'));
    expect(failure.kind).toBe('no-cli');
    expect(failure.fixCommand).toBeTruthy();
  });

  it('detects Windows and POSIX not-found wording', () => {
    expect(classifyGhFailure(new Error("'gh' is not recognized as an internal command")).kind).toBe('no-cli');
    expect(classifyGhFailure(new Error('gh: command not found')).kind).toBe('no-cli');
  });

  it('detects an unauthenticated CLI and offers the login command', () => {
    const failure = classifyGhFailure(new Error('gh auth login required: Bad credentials'));
    expect(failure.kind).toBe('not-authenticated');
    expect(failure.fixCommand).toBe('gh auth login');
  });

  it('detects rate limiting before it looks like an auth problem', () => {
    // Ordering matters: a rate-limit message can mention tokens, and sending
    // somebody to re-authenticate when they are simply throttled wastes their
    // time and does not help.
    const failure = classifyGhFailure(new Error('API rate limit exceeded for token'));
    expect(failure.kind).toBe('rate-limited');
  });

  it('distinguishes forbidden from not-found', () => {
    expect(classifyGhFailure(new Error('HTTP 403: Resource not accessible')).kind).toBe('forbidden');
    expect(classifyGhFailure(new Error('HTTP 404: Not Found')).kind).toBe('not-found');
  });

  it('detects a timeout', () => {
    expect(classifyGhFailure(new Error('ETIMEDOUT')).kind).toBe('timeout');
  });

  it('falls back to a truncated message rather than an empty detail', () => {
    const failure = classifyGhFailure(new Error('x'.repeat(1000)));
    expect(failure.kind).toBe('error');
    expect(failure.detail.length).toBeLessThan(360);
  });

  it('handles a non-Error throw', () => {
    expect(classifyGhFailure('plain string').kind).toBe('error');
    expect(classifyGhFailure(undefined).kind).toBe('error');
  });
});

describe('GhClient', () => {
  it('passes arguments as an argv array and never as a composed string', () => {
    const { run, calls } = runnerReturning('ok');
    return client(run).exec(['issue', 'list', '--limit', '10']).then(() => {
      expect(calls[0]?.[0]).toBe('gh');
      expect(calls[0]?.[1]).toEqual(['issue', 'list', '--limit', '10']);
    });
  });

  it('applies the workspace root, timeout and buffer cap', async () => {
    const { run, calls } = runnerReturning('ok');
    await client(run).exec(['repo', 'view']);
    expect(calls[0]?.[2]).toEqual({
      cwd: '/repo',
      timeout: DEFAULT_GH_TIMEOUT_MS,
      maxBuffer: DEFAULT_GH_MAX_BUFFER,
    });
  });

  it('trims stdout', async () => {
    const result = await client(runnerReturning('  acme/widget \n').run).exec(['repo', 'view']);
    expect(result).toEqual({ ok: true, value: 'acme/widget' });
  });

  it('returns a failure rather than throwing, so a surface keeps rendering', async () => {
    // A dashboard that throws on a network failure disappears exactly when you
    // wanted it to tell you what was wrong.
    const result = await client(runnerThrowing(new Error('spawn gh ENOENT'))).exec(['repo', 'view']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('no-cli');
    }
  });

  it('refuses an argument with a shell metacharacter without spawning anything', async () => {
    const run = vi.fn<GhProcessRunner>();
    const result = await client(run).exec(['issue', 'create', '--title', 'x; rm -rf /']);
    expect(run).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  describe('json', () => {
    it('parses a JSON body', async () => {
      const result = await client(runnerReturning('{"a":1}').run).json<{ a: number }>(['api', 'x']);
      expect(result).toEqual({ ok: true, value: { a: 1 } });
    });

    it('reports malformed output as a failure rather than crashing', async () => {
      // gh occasionally writes a warning to stdout ahead of its JSON.
      const result = await client(runnerReturning('warning: something\n{"a":1}').run).json(['api', 'x']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.detail).toContain('not valid JSON');
      }
    });

    it('propagates an exec failure without attempting to parse it', async () => {
      const result = await client(runnerThrowing(new Error('Bad credentials'))).json(['api', 'x']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.kind).toBe('not-authenticated');
      }
    });
  });

  describe('probe', () => {
    it('reports installed and authenticated when auth status succeeds', async () => {
      expect(await client(runnerReturning('Logged in').run).probe())
        .toEqual({ installed: true, authenticated: true });
    });

    it('requires positive evidence before claiming the CLI is installed', async () => {
      // An unclassifiable failure is not evidence of presence. Reading it as
      // "installed" would have a caller skip offering to install the very thing
      // that is missing; being wrong the other way just offers a needless install.
      const unknown = await client(runnerThrowing(new Error('something entirely unexpected'))).probe();
      expect(unknown.installed).toBe(false);
      expect(unknown.authenticated).toBe(false);

      const timedOut = await client(runnerThrowing(new Error('ETIMEDOUT'))).probe();
      expect(timedOut.installed).toBe(false);
    });

    it('accepts failures only a running gh could produce as proof it exists', async () => {
      for (const [message, kind] of [
        ['You are not logged into any GitHub hosts', 'not-authenticated'],
        ['API rate limit exceeded', 'rate-limited'],
        ['HTTP 403: Resource not accessible', 'forbidden'],
        ['HTTP 404: Not Found', 'not-found'],
      ] as const) {
        const probe = await client(runnerThrowing(new Error(message))).probe();
        expect(probe.installed, `${kind} should prove gh ran`).toBe(true);
        expect(probe.authenticated).toBe(false);
      }
    });

    it('distinguishes not-installed from installed-but-signed-out', async () => {
      // These are different problems with different fixes, and collapsing them
      // sends half the users to the wrong remedy.
      const missing = await client(runnerThrowing(new Error('spawn gh ENOENT'))).probe();
      expect(missing.installed).toBe(false);
      expect(missing.authenticated).toBe(false);

      const signedOut = await client(runnerThrowing(new Error('You are not logged into any GitHub hosts'))).probe();
      expect(signedOut.installed).toBe(true);
      expect(signedOut.authenticated).toBe(false);
      expect(signedOut.failure?.fixCommand).toBe('gh auth login');
    });
  });

  it('asks for the repository slug with a projection rather than a full payload', async () => {
    const { run, calls } = runnerReturning('acme/widget');
    const result = await client(run).repoSlug();
    expect(result).toEqual({ ok: true, value: 'acme/widget' });
    expect(calls[0]?.[1]).toContain('--json');
    expect(calls[0]?.[1]).toContain('nameWithOwner');
  });
});
