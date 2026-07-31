import { describe, expect, it } from 'vitest';
import {
  ACP_HOST_DEFAULTS,
  ACP_HOST_TOKEN_MIN_LENGTH,
  isAuthorizedRequest,
  isLoopbackOnlyEndpoint,
  reuseBlockedBecause,
  shouldHostExit,
  type AcpSessionFingerprint,
} from '../../src/providers/acpHostPolicy.ts';

const BASE: AcpSessionFingerprint = {
  agentId: 'claude',
  command: 'claude-agent-acp',
  args: [],
  cwd: '/work',
  mcpServerNames: [],
  isolatedSettings: true,
  settingsStamp: 'stamp-1',
};
const HEALTHY = { exited: false, idleMs: 0 };
const LIMITS = { maxIdleMs: 60_000 };

describe('reusing a live agent session', () => {
  it('reuses when nothing that mattered has changed', () => {
    expect(reuseBlockedBecause(BASE, { ...BASE }, HEALTHY, LIMITS)).toBeUndefined();
  });

  it('never reuses a session across the isolation boundary', () => {
    // The load-bearing one. A turn that may act must not inherit a session
    // created with the user's settings withheld, and a completion-only turn
    // must not inherit one created with them loaded. Enabling delegated
    // execution mid-session would otherwise keep silently using the old shape.
    expect(reuseBlockedBecause(BASE, { ...BASE, isolatedSettings: false }, HEALTHY, LIMITS))
      .toBe('isolation-changed');
    expect(reuseBlockedBecause({ ...BASE, isolatedSettings: false }, BASE, HEALTHY, LIMITS))
      .toBe('isolation-changed');
  });

  it('drops a session whose on-disk instructions changed underneath it', () => {
    // The agent read CLAUDE.md and its MCP config at session/new. A live
    // session is running on whatever they said then, not what they say now.
    expect(reuseBlockedBecause(BASE, { ...BASE, settingsStamp: 'stamp-2' }, HEALTHY, LIMITS))
      .toBe('settings-file-changed');
  });

  it('distinguishes every way reuse can be unsafe', () => {
    // A boolean here would make a stale session indistinguishable from a
    // healthy one, and the reported reason is what a user debugs from.
    expect(reuseBlockedBecause(BASE, { ...BASE, agentId: 'codex' }, HEALTHY, LIMITS)).toBe('agent-changed');
    expect(reuseBlockedBecause(BASE, { ...BASE, command: 'other' }, HEALTHY, LIMITS)).toBe('agent-changed');
    expect(reuseBlockedBecause(BASE, { ...BASE, args: ['--acp'] }, HEALTHY, LIMITS)).toBe('agent-changed');
    expect(reuseBlockedBecause(BASE, { ...BASE, cwd: '/elsewhere' }, HEALTHY, LIMITS)).toBe('cwd-changed');
    expect(reuseBlockedBecause(BASE, { ...BASE, mcpServerNames: ['docs'] }, HEALTHY, LIMITS)).toBe('mcp-servers-changed');
    expect(reuseBlockedBecause(BASE, BASE, { exited: false, idleMs: 60_000 }, LIMITS)).toBe('idle-expired');
    expect(reuseBlockedBecause(BASE, BASE, { exited: true, idleMs: 0 }, LIMITS)).toBe('agent-exited');
  });

  it('reports the root cause, not the first difference noticed', () => {
    // An exited agent that is also idle and also for a different cwd is an
    // exited agent. Reporting "idle-expired" sends somebody to look at a
    // timeout that was never the problem.
    const wrecked = { ...BASE, cwd: '/elsewhere', settingsStamp: 'stamp-9' };
    expect(reuseBlockedBecause(BASE, wrecked, { exited: true, idleMs: 999_999 }, LIMITS))
      .toBe('agent-exited');
  });
});

describe('the host must not be reachable off-machine', () => {
  it('accepts named pipes and unix sockets', () => {
    expect(isLoopbackOnlyEndpoint('\\\\.\\pipe\\atlasmind-acp-abc')).toBe(true);
    expect(isLoopbackOnlyEndpoint('/tmp/atlasmind-acp.sock')).toBe(true);
    expect(isLoopbackOnlyEndpoint('C:\\Users\\x\\acp.sock')).toBe(true);
  });

  it('refuses anything that is a network socket, loopback included', () => {
    // A TCP endpoint is reachable by every process and every user on the box.
    // Named pipes and unix sockets carry OS access control, so the transport
    // choice IS the access control — there is no "but it is only localhost".
    for (const bad of ['tcp:8080', '127.0.0.1:8080', '0.0.0.0:1', 'http://localhost:9', 'ws://x', '']) {
      expect(isLoopbackOnlyEndpoint(bad)).toBe(false);
    }
  });
});

describe('authorizing a request', () => {
  const token = 'a'.repeat(ACP_HOST_TOKEN_MIN_LENGTH);

  it('accepts only the exact per-launch token', () => {
    expect(isAuthorizedRequest(token, token)).toBe(true);
    expect(isAuthorizedRequest(token, `${token}x`)).toBe(false);
    expect(isAuthorizedRequest(token, undefined)).toBe(false);
    expect(isAuthorizedRequest(token, '')).toBe(false);
  });

  it('refuses to authorize against a weak or absent expectation', () => {
    // A host that came up without a real token must not accept anything —
    // "no token configured" is the one case where every request looks valid.
    expect(isAuthorizedRequest('', '')).toBe(false);
    expect(isAuthorizedRequest('short', 'short')).toBe(false);
  });
});

describe('when the host should stop', () => {
  it('exits once no editor owns it', () => {
    expect(shouldHostExit({ liveOwnerPids: [], idleMs: 0 }, LIMITS))
      .toEqual({ exit: true, reason: 'no-owners' });
  });

  it('exits when it has had nothing to do for long enough', () => {
    // Covers the owner that died without unregistering — a PID list that is
    // non-empty but stale would otherwise keep the host alive forever.
    expect(shouldHostExit({ liveOwnerPids: [1234], idleMs: 60_000 }, LIMITS))
      .toEqual({ exit: true, reason: 'idle' });
  });

  it('keeps running while an owner is present and work is recent', () => {
    expect(shouldHostExit({ liveOwnerPids: [1234], idleMs: 0 }, LIMITS)).toEqual({ exit: false });
  });

  it('outlives one window but not all of them', () => {
    // The whole reason for a host: three projects share one agent. But a user
    // who closes the editor must not be left with Claude Code running.
    expect(shouldHostExit({ liveOwnerPids: [1, 2, 3], idleMs: 0 }, LIMITS).exit).toBe(false);
    expect(shouldHostExit({ liveOwnerPids: [3], idleMs: 0 }, LIMITS).exit).toBe(false);
    expect(shouldHostExit({ liveOwnerPids: [], idleMs: 0 }, LIMITS).exit).toBe(true);
  });
});

describe('defaults', () => {
  it('expires a session sooner than the host that holds it', () => {
    // Otherwise the host would exit while still advertising a reusable session.
    expect(ACP_HOST_DEFAULTS.sessionMaxIdleMs).toBeLessThan(ACP_HOST_DEFAULTS.hostMaxIdleMs);
  });

  it('supervises far more often than it expires anything', () => {
    expect(ACP_HOST_DEFAULTS.supervisionIntervalMs).toBeLessThan(ACP_HOST_DEFAULTS.sessionMaxIdleMs);
  });

  it('bounds the host rather than letting it live forever', () => {
    expect(ACP_HOST_DEFAULTS.hostMaxIdleMs).toBeGreaterThan(0);
    expect(Number.isFinite(ACP_HOST_DEFAULTS.hostMaxIdleMs)).toBe(true);
  });
});
