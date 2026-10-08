import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

/**
 * Approval relaxation for confirmed-sandbox execution. The properties every
 * test here comes back to: a terminal write skips its prompt only when it will
 * run in a confirmed container, nothing that already decides a call (dry run,
 * the ceiling, taint, the never-bypassable list) is ever loosened by it, and
 * the run happens on the very session the decision was made on.
 */

const childProcess = vi.hoisted(() => ({ exec: vi.fn(), execFile: vi.fn(), spawn: vi.fn() }));
vi.mock('node:child_process', () => ({
  exec: childProcess.exec,
  execFile: childProcess.execFile,
  spawn: childProcess.spawn,
  default: childProcess,
}));

import {
  SANDBOX_RELAXABLE_TOOLS,
  SANDBOX_RELAXATION_RULES,
  describeSandboxRelaxationState,
  evaluateSandboxApprovalRelaxation,
  readRelaxTerminalApprovalsSetting,
  type RelaxTerminalApprovalsReading,
  type SandboxRelaxationFacts,
  type SandboxRelaxationSession,
} from '../../src/core/sandboxApprovalRelaxation.ts';
import {
  SANDBOX_INTERACTION_RULES,
  planExecution,
  type SandboxAttestation,
  type SandboxConfiguration,
  type SandboxHostFacts,
  type SandboxMode,
  type SandboxProbe,
} from '../../src/core/sandboxPlan.ts';
import { SandboxProbeCache, renderSandboxCheckReport, type SandboxProbeReport } from '../../src/core/sandboxProbe.ts';
import { SandboxHost, type SandboxHostDeps } from '../../src/core/sandboxRunner.ts';
import { classifyToolInvocation, toolBypassCeiling } from '../../src/core/toolPolicy.ts';
import { TAINT_ESCALATION } from '../../src/core/contextProvenance.ts';
import type { ToolInvocationPolicy } from '../../src/types.ts';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIGEST = `sha256:${'0123456789abcdef'.repeat(4)}`;
const IMAGE = `ghcr.io/atlasmind/sandbox-node@${DIGEST}`;
const NOW = new Date('2026-10-08T12:00:00.000Z');
const HOST: SandboxHostFacts = { os: 'linux', user: { uid: 1000, gid: 1000 }, homeDir: '/home/joel' };
const ROOT = '/home/joel/dev/app';

const ON: RelaxTerminalApprovalsReading = { enabled: true };
const OFF: RelaxTerminalApprovalsReading = { enabled: false };

function configuration(overrides: Partial<SandboxConfiguration> = {}): SandboxConfiguration {
  return { mode: 'require', engine: 'auto', image: IMAGE, cpus: 2, memoryGb: 4, ...overrides };
}

function confirmed(overrides: Partial<Extract<SandboxAttestation, { status: 'confirmed' }>> = {}): SandboxAttestation {
  const probedAt = new Date(NOW.getTime() - 60_000).toISOString();
  return {
    status: 'confirmed',
    id: 'sbx-att-0123456789ab-test',
    engine: 'docker',
    strength: 'container',
    image: IMAGE,
    digest: DIGEST,
    rootless: false,
    probedAt,
    expiresAt: new Date(NOW.getTime() + 9 * 60_000).toISOString(),
    rules: [],
    ...overrides,
  };
}

function session(overrides: Partial<SandboxRelaxationSession> = {}): SandboxRelaxationSession {
  return { id: 'sbx-session-test-1', mode: 'require', configuration: configuration(), attestation: confirmed(), host: HOST, ...overrides };
}

function facts(overrides: Partial<SandboxRelaxationFacts> = {}, command = 'make', args: string[] = ['build']): SandboxRelaxationFacts {
  const toolArgs = { command, args };
  const policy = classifyToolInvocation('terminal-run', toolArgs);
  return {
    toolName: 'terminal-run',
    args: toolArgs,
    policy,
    dryRun: false,
    allowTerminalWrite: true,
    tainted: false,
    bypassCeiling: toolBypassCeiling(policy),
    relaxSetting: ON,
    ...overrides,
  };
}

function deps(open: SandboxRelaxationSession | (() => Promise<SandboxRelaxationSession>) | undefined, now = NOW) {
  return {
    ...(open === undefined ? {} : { openSession: vi.fn(typeof open === 'function' ? open : async () => open) }),
    resolveFolders: async (cwd: string | undefined) => ({ root: ROOT, cwd: cwd ? path.posix.join(ROOT, cwd) : ROOT }),
    now: () => now,
  };
}

describe('the precedence table', () => {
  it('is declared in the order the gate applies it, and names an outcome for each rule', () => {
    expect(SANDBOX_RELAXATION_RULES.map(rule => rule.id)).toEqual([
      'dry-run',
      'terminal-write-ceiling',
      'taint',
      'never-bypassable',
      'terminal-write-only',
      'relaxation-off',
      'invocation-unreadable',
      'session-unavailable',
      'mode-not-require',
      'attestation-unconfirmed',
      'route-not-sandbox',
      'relaxed',
    ]);
    expect(Object.fromEntries(SANDBOX_RELAXATION_RULES.map(rule => [rule.id, rule.outcome]))).toMatchObject({
      'dry-run': 'simulate',
      'terminal-write-ceiling': 'refuse',
      taint: 'ask',
      relaxed: 'relaxed',
    });
    // Exactly one rule relaxes, and it is last: everything above it can stop it.
    expect(SANDBOX_RELAXATION_RULES.filter(rule => rule.outcome === 'relaxed').map(rule => rule.id)).toEqual(['relaxed']);
  });

  it('every rule says why in words', () => {
    for (const rule of SANDBOX_RELAXATION_RULES) {
      expect(rule.description.length).toBeGreaterThan(40);
    }
  });

  it('only terminal-run is relaxable, and test-run is not a terminal write here', () => {
    expect(SANDBOX_RELAXABLE_TOOLS).toEqual(['terminal-run']);
    // test-run is graded by the unknown-tool fallback (its name says "run"), so it is
    // on the never-bypassable list and well out of reach of this opt-in.
    expect(classifyToolInvocation('test-run', {}).category).not.toBe('terminal-write');
  });

  it('records the opt-in in the sandbox\'s own interaction rules, with taint still unrelaxed beside it', () => {
    const ids = SANDBOX_INTERACTION_RULES.map(rule => rule.id);
    expect(ids).toContain('approvals-relaxed-only-by-opt-in');
    expect(ids).toContain('taint-not-relaxed');
    expect(TAINT_ESCALATION['terminal-write']).toMatchObject({ tainted: 'fresh-approval', suspected: 'fresh-approval' });
  });
});

describe('the setting: your user value, nothing else', () => {
  it('reads true only from your user settings', () => {
    expect(readRelaxTerminalApprovalsSetting({ globalValue: true })).toEqual({ enabled: true });
    expect(readRelaxTerminalApprovalsSetting(undefined)).toEqual({ enabled: false });
    expect(readRelaxTerminalApprovalsSetting({ defaultValue: true }).enabled).toBe(false);
  });

  it('ignores a workspace or folder value, and says so', () => {
    const fromRepo = readRelaxTerminalApprovalsSetting({ workspaceValue: true });
    expect(fromRepo.enabled).toBe(false);
    expect(fromRepo.ignored).toContain('ignored');
    const folder = readRelaxTerminalApprovalsSetting({ globalValue: false, workspaceFolderValue: true });
    expect(folder.enabled).toBe(false);
    expect(folder.ignored).toBeDefined();
  });

  it('refuses a value that is not a boolean rather than coercing it', () => {
    for (const value of ['true', 1, 'yes', {}]) {
      const reading = readRelaxTerminalApprovalsSetting({ globalValue: value });
      expect(reading.enabled).toBe(false);
      expect(reading.problem).toBeDefined();
    }
  });

  it('no workspace value can ever enable it (property)', () => {
    const any = fc.oneof(fc.boolean(), fc.string(), fc.integer(), fc.constant(undefined), fc.constant(null));
    fc.assert(fc.property(any, any, (workspaceValue, workspaceFolderValue) => {
      expect(readRelaxTerminalApprovalsSetting({ workspaceValue, workspaceFolderValue }).enabled).toBe(false);
    }));
  });
});

type GateResult = 'simulate' | 'refuse' | 'prompt' | 'skip';

/** The gate's visible result for a decision, under an approval mode that would otherwise ask. */
function gateResult(outcome: string): GateResult {
  return outcome === 'relaxed' ? 'skip' : outcome === 'ask' ? 'prompt' : (outcome as GateResult);
}

describe('the exhaustive table: (mode, relax, attestation, eligibility, taint, dry run, ceiling) → prompt / skip / refuse', () => {
  const modes: SandboxMode[] = ['off', 'require'];
  const attestations = ['confirmed', 'unavailable', 'expired'] as const;
  const commands = [
    { eligible: true, command: 'make', args: ['build'] },
    { eligible: false, command: 'curl', args: ['https://example.com'] },
  ];
  const cases: Array<[SandboxMode, boolean, typeof attestations[number], boolean, boolean, boolean, boolean]> = [];
  for (const mode of modes) {
    for (const relax of [false, true]) {
      for (const attestation of attestations) {
        for (const { eligible } of commands) {
          for (const tainted of [false, true]) {
            for (const dryRun of [false, true]) {
              for (const ceiling of [false, true]) {
                cases.push([mode, relax, attestation, eligible, tainted, dryRun, ceiling]);
              }
            }
          }
        }
      }
    }
  }

  it('covers every combination', () => {
    expect(cases).toHaveLength(2 * 2 * 3 * 2 * 2 * 2 * 2);
  });

  it.each(cases)('mode %s, relax %s, attestation %s, eligible %s, tainted %s, dry run %s, terminal writes allowed %s', async (
    mode, relax, attestationKind, eligible, tainted, dryRun, allowTerminalWrite,
  ) => {
    const { command, args } = commands.find(entry => entry.eligible === eligible)!;
    const attestation: SandboxAttestation = attestationKind === 'confirmed'
      ? confirmed()
      : attestationKind === 'expired'
        ? confirmed({ expiresAt: new Date(NOW.getTime() - 1).toISOString() })
        : { status: 'unavailable', rule: 'canary-passed', reason: 'The canary failed.' };
    const opened = session({ mode, configuration: configuration({ mode }), attestation });
    const d = deps(opened);
    const decision = await evaluateSandboxApprovalRelaxation(
      facts({ dryRun, tainted, allowTerminalWrite, relaxSetting: relax ? ON : OFF }, command, args),
      d,
    );

    // The specification, in precedence order.
    const expected: GateResult = dryRun
      ? 'simulate'
      : !allowTerminalWrite
        ? 'refuse'
        : tainted
          ? 'prompt'
          : relax && mode === 'require' && attestationKind === 'confirmed' && eligible
            ? 'skip'
            : 'prompt';
    expect(gateResult(decision.outcome)).toBe(expected);

    // A person who has not opted in (or a call stopped above the opt-in) gets no session opened.
    if (dryRun || !allowTerminalWrite || tainted || !relax) {
      expect(d.openSession).not.toHaveBeenCalled();
    }
    if (tainted && !dryRun && allowTerminalWrite) {
      expect(decision.rule).toBe('taint');
    }
  });
});

describe('what is never relaxed', () => {
  it('anything but a terminal write asks as before', async () => {
    for (const [toolName, args] of [
      ['file-write', { path: 'a.ts', content: 'x' }],
      ['git-commit', { message: 'm' }],
      ['git-push', { branch: 'feature/x' }],
      ['web-fetch', { url: 'https://example.com' }],
      ['terminal-run', { command: 'npm', args: ['test'] }],
    ] as Array<[string, Record<string, unknown>]>) {
      const policy = classifyToolInvocation(toolName, args);
      const decision = await evaluateSandboxApprovalRelaxation(
        { ...facts(), toolName, args, policy, bypassCeiling: toolBypassCeiling(policy) },
        deps(session()),
      );
      expect(decision.outcome, toolName).not.toBe('relaxed');
    }
  });

  it('a never-bypassable call is not reached by the relaxation', async () => {
    const decision = await evaluateSandboxApprovalRelaxation(
      facts({ bypassCeiling: 'It changes something on another machine.' }),
      deps(session()),
    );
    expect(decision.rule).toBe('never-bypassable');
  });

  it('a terminal write through a tool whose command cannot be read asks', async () => {
    const policy: ToolInvocationPolicy = { category: 'terminal-write', risk: 'high', summary: 'run docker run' };
    const docker = await evaluateSandboxApprovalRelaxation(
      { ...facts(), toolName: 'docker-cli', args: { command: 'run' }, policy, bypassCeiling: undefined },
      deps(session()),
    );
    expect(docker.rule).toBe('terminal-write-only');
    for (const args of [{ command: 'make', args: 'build' }, { command: 'make', args: ['build', 3] }, { command: '' }, { command: 'make', cwd: 4 }]) {
      const decision = await evaluateSandboxApprovalRelaxation(
        { ...facts(), args: args as Record<string, unknown> },
        deps(session()),
      );
      expect(decision.rule).toBe('invocation-unreadable');
    }
  });

  it('no sandbox host, an unresolvable folder, a throwing open, or unusable settings: asks', async () => {
    expect((await evaluateSandboxApprovalRelaxation(facts(), deps(undefined))).rule).toBe('session-unavailable');
    expect((await evaluateSandboxApprovalRelaxation(facts(), { ...deps(session()), resolveFolders: async () => undefined })).rule)
      .toBe('session-unavailable');
    expect((await evaluateSandboxApprovalRelaxation(facts(), deps(async () => { throw new Error('engine gone'); }))).rule)
      .toBe('session-unavailable');
    expect((await evaluateSandboxApprovalRelaxation(facts(), deps(session({ configuration: undefined })))).rule)
      .toBe('session-unavailable');
  });

  it('a command routed elsewhere names the plan rule that stopped it', async () => {
    const git = await evaluateSandboxApprovalRelaxation(facts({}, 'git', ['commit', '-m', 'x']), deps(session()));
    expect(git.rule).toBe('route-not-sandbox');
    expect(git.reason).toContain('eligibility/git');
    const outside = await evaluateSandboxApprovalRelaxation(
      { ...facts(), args: { command: 'make', args: ['build'], cwd: '../../etc' } },
      deps(session()),
    );
    expect(outside.rule).toBe('route-not-sandbox');
  });
});

describe('properties', () => {
  const arbitraryFacts = fc.record({
    dryRun: fc.boolean(),
    tainted: fc.boolean(),
    allowTerminalWrite: fc.boolean(),
    relax: fc.boolean(),
    mode: fc.constantFrom<SandboxMode>('off', 'require'),
    attestation: fc.constantFrom('confirmed', 'unavailable', 'expired', 'absent'),
    command: fc.constantFrom('make', 'npm', 'node', 'git', 'curl', 'pytest', 'cargo', 'sh'),
    args: fc.array(fc.constantFrom('build', 'test', 'install', 'publish', '-c', 'echo hi', 'run', 'lint'), { maxLength: 3 }),
    tool: fc.constantFrom('terminal-run', 'file-write', 'docker-cli', 'test-run'),
  });

  type Sample = typeof arbitraryFacts extends fc.Arbitrary<infer T> ? T : never;

  function build(sample: Sample) {
    const attestation: SandboxAttestation | undefined = sample.attestation === 'confirmed'
      ? confirmed()
      : sample.attestation === 'expired'
        ? confirmed({ expiresAt: new Date(NOW.getTime() - 1).toISOString() })
        : sample.attestation === 'unavailable'
          ? { status: 'unavailable', rule: 'probed', reason: 'Not probed.' }
          : undefined;
    const opened = session({ mode: sample.mode, configuration: configuration({ mode: sample.mode }), ...(attestation ? { attestation } : { attestation: undefined }) });
    const toolArgs = { command: sample.command, args: sample.args };
    const policy = classifyToolInvocation(sample.tool, toolArgs);
    const input: SandboxRelaxationFacts = {
      toolName: sample.tool,
      args: toolArgs,
      policy,
      dryRun: sample.dryRun,
      allowTerminalWrite: sample.allowTerminalWrite,
      tainted: sample.tainted,
      bypassCeiling: toolBypassCeiling(policy),
      relaxSetting: sample.relax ? ON : OFF,
    };
    return { opened, input };
  }

  it('relaxed ⇒ require, a confirmed attestation, the exact session opened, and a sandbox route for this exact command', async () => {
    await fc.assert(fc.asyncProperty(arbitraryFacts, async sample => {
      const { opened, input } = build(sample);
      const decision = await evaluateSandboxApprovalRelaxation(input, deps(opened));
      if (decision.outcome !== 'relaxed') {
        return;
      }
      expect(decision.session).toBe(opened);
      expect(decision.session.mode).toBe('require');
      expect(decision.session.attestation?.status).toBe('confirmed');
      expect(input.policy.category).toBe('terminal-write');
      const plan = planExecution(
        { runId: 'rpropertycheck00', executable: sample.command, args: sample.args, root: ROOT, cwd: ROOT, env: {} },
        decision.session.attestation,
        decision.session.configuration!,
        HOST,
        NOW,
      );
      expect(plan.route).toBe('sandbox');
    }), { numRuns: 400 });
  });

  it('tainted ⇒ never relaxed; dry run ⇒ simulated; ceiling off ⇒ refused or simulated', async () => {
    await fc.assert(fc.asyncProperty(arbitraryFacts, async sample => {
      const { opened, input } = build(sample);
      const decision = await evaluateSandboxApprovalRelaxation(input, deps(opened));
      if (sample.tainted) {
        expect(decision.outcome).not.toBe('relaxed');
      }
      if (sample.dryRun) {
        expect(decision.outcome).toBe('simulate');
      }
      if (!sample.relax || sample.mode === 'off') {
        expect(decision.outcome).not.toBe('relaxed');
      }
    }), { numRuns: 400 });
  });
});

// ── The gate and the runner read one session ─────────────────────

function probeReading(overrides: Partial<SandboxProbe> = {}): SandboxProbeReport {
  return {
    probe: {
      engine: 'docker',
      cliPresent: true,
      infoOk: true,
      serverOs: 'linux',
      arch: 'x86_64',
      runtimes: ['runc'],
      rootless: false,
      image: IMAGE,
      imageDigest: DIGEST,
      canary: 'passed',
      probedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      ...overrides,
    },
    steps: [],
  };
}

function realHost() {
  let now = NOW;
  let mode: SandboxMode = 'require';
  const calls: string[][] = [];
  const cache = new SandboxProbeCache();
  cache.record(probeReading());
  const probe = vi.fn(async () => probeReading({ probedAt: now.toISOString() }));
  const hostDeps: SandboxHostDeps = {
    readMode: () => mode,
    readConfiguration: () => ({ configuration: configuration(), problems: [], ignored: [] }),
    cache,
    probe,
    run: async (_engine, argv) => {
      calls.push([...argv]);
      return { kind: 'exited', exitCode: 0, stdout: 'built', stderr: '' };
    },
    host: HOST,
    now: () => now,
    realpath: async target => target,
    randomHex: () => 'deadbeef',
  };
  return {
    host: new SandboxHost(hostDeps),
    calls,
    cache,
    probe,
    setNow: (date: Date) => { now = date; },
    setMode: (next: SandboxMode) => { mode = next; },
    now: () => now,
  };
}

async function relaxOn(h: ReturnType<typeof realHost>) {
  const decision = await evaluateSandboxApprovalRelaxation(facts(), {
    openSession: root => h.host.openSession(root),
    resolveFolders: async () => ({ root: ROOT, cwd: ROOT }),
    now: h.now,
  });
  expect(decision.outcome).toBe('relaxed');
  if (decision.outcome !== 'relaxed') {
    throw new Error('not relaxed');
  }
  return decision;
}

const REQUEST = { executable: 'make', args: ['build'], root: ROOT, cwd: ROOT, env: {}, timeoutMs: 30_000 };

describe('session divergence between the gate and the runner is impossible', () => {
  it('the relaxed approval hands back a session the host itself opened, and the runner honours it', async () => {
    const h = realHost();
    const decision = await relaxOn(h);
    const result = await h.host.runCommand(REQUEST, decision.session);
    expect(result.ok).toBe(true);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toContain('--network');
    expect(h.calls[0]!.join(' ')).toContain(IMAGE);
  });

  it('an attestation that expires between the gate and the spawn is a refusal: no prompt after the fact, no re-probe, no run', async () => {
    const h = realHost();
    const decision = await relaxOn(h);
    h.setNow(new Date(Date.parse(decision.audit.expiresAt) + 1));
    const result = await h.host.runCommand(REQUEST, decision.session);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('plan/attestation-expired');
    expect(h.probe).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  it('a re-probe between the gate and the spawn cannot move the run onto another reading (property: inject any change)', async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom('canary-failed', 'other-image', 'mode-off', 'fresh-reading', 'nothing'),
      fc.integer({ min: 0, max: 20 * 60_000 }),
      async (change, elapsed) => {
        const h = realHost();
        const decision = await relaxOn(h);
        if (change === 'canary-failed') {
          h.cache.record(probeReading({ canary: 'failed' }));
        } else if (change === 'other-image') {
          h.cache.record(probeReading({ image: `other@${DIGEST}` }));
        } else if (change === 'mode-off') {
          h.setMode('off');
        } else if (change === 'fresh-reading') {
          h.cache.record(probeReading({ probedAt: new Date(NOW.getTime() + elapsed).toISOString() }));
        }
        h.setNow(new Date(NOW.getTime() + elapsed));
        const result = await h.host.runCommand(REQUEST, decision.session);
        // Either it ran on exactly the attested image, or it was refused for the
        // session's own expiry. Never a fresh reading, never the host.
        if (Date.parse(decision.audit.expiresAt) <= NOW.getTime() + elapsed) {
          expect(result.stderr).toContain('plan/attestation-expired');
          expect(h.calls).toEqual([]);
        } else {
          expect(result.ok).toBe(true);
          expect(h.calls[0]!.join(' ')).toContain(decision.audit.image);
        }
        expect(h.probe).not.toHaveBeenCalled();
        expect(childProcess.execFile).not.toHaveBeenCalled();
      },
    ), { numRuns: 60 });
  });

  it('a copy of the relaxed session is refused by the runner — only the object the gate checked is honoured', async () => {
    const h = realHost();
    const decision = await relaxOn(h);
    const result = await h.host.runCommand(REQUEST, { ...decision.session });
    expect(result.stderr).toContain('was not opened by AtlasMind\'s sandbox host');
    expect(h.calls).toEqual([]);
  });
});

describe('the audit record', () => {
  it('cites the rule, the session, the attestation id and probe time, the image and its digest', async () => {
    const h = realHost();
    const decision = await relaxOn(h);
    const attestation = decision.session.attestation as Extract<SandboxAttestation, { status: 'confirmed' }>;
    expect(decision.audit).toMatchObject({
      rule: 'sandbox-relaxation/relaxed',
      sandboxSessionId: decision.session.id,
      attestationId: attestation.id,
      probedAt: attestation.probedAt,
      image: IMAGE,
      digest: DIGEST,
    });
    for (const fragment of [attestation.id, attestation.probedAt, DIGEST, IMAGE, 'sandbox-relaxation/relaxed', decision.session.id]) {
      expect(decision.audit.line).toContain(fragment);
    }
    expect(decision.audit.line).not.toMatch(/[\r\n]/);
  });

  it('never writes a secret from the command into the line', async () => {
    const secret = 'sk-ant-api03-' + 'A'.repeat(90);
    const toolArgs = { command: 'make', args: [`TOKEN=${secret}`] };
    const policy = classifyToolInvocation('terminal-run', toolArgs);
    const decision = await evaluateSandboxApprovalRelaxation(
      { ...facts(), args: toolArgs, policy, taskId: 'task-1' },
      deps(session()),
    );
    expect(decision.outcome).toBe('relaxed');
    if (decision.outcome === 'relaxed') {
      expect(decision.audit.line).not.toContain(secret);
      expect(decision.audit.line).toContain('task task-1');
    }
  });
});

describe('the state the status bar and the check report show', () => {
  it('is active only when every standing condition holds', () => {
    const base = { setting: ON, mode: 'require' as const, allowTerminalWrite: true, attestation: confirmed() };
    expect(describeSandboxRelaxationState(base)).toMatchObject({ state: 'active', active: true, headline: 'Terminal writes run sandboxed without asking' });
    expect(describeSandboxRelaxationState({ ...base, setting: OFF }).state).toBe('off');
    expect(describeSandboxRelaxationState({ ...base, setting: { enabled: false, ignored: 'A workspace value was ignored.' } }).state)
      .toBe('setting-ignored');
    expect(describeSandboxRelaxationState({ ...base, mode: 'off' }).state).toBe('mode-off');
    expect(describeSandboxRelaxationState({ ...base, allowTerminalWrite: false }).state).toBe('terminal-writes-blocked');
    expect(describeSandboxRelaxationState({ ...base, attestation: { status: 'unavailable', rule: 'probed', reason: 'x' } }).state)
      .toBe('waiting-for-attestation');
    expect(describeSandboxRelaxationState({ ...base, attestation: undefined }).state).toBe('waiting-for-attestation');
    for (const state of [{ ...base, setting: OFF }, { ...base, mode: 'off' as const }, { ...base, allowTerminalWrite: false }]) {
      expect(describeSandboxRelaxationState(state).active).toBe(false);
    }
  });

  it('says, when active, that each call is still checked', () => {
    const view = describeSandboxRelaxationState({ setting: ON, mode: 'require', allowTerminalWrite: true, attestation: confirmed() });
    expect(view.detail).toContain('untrusted content asks');
  });

  it('the check report shows the relaxation state and every rule in order', () => {
    const markdown = renderSandboxCheckReport({
      reading: { configuration: configuration(), problems: [], ignored: [] },
      attestation: confirmed(),
      hostOs: 'linux',
      dryRun: false,
      now: NOW,
      mode: 'require',
      relaxation: { setting: ON, allowTerminalWrite: true },
    });
    expect(markdown).toContain('## Approval relaxation');
    expect(markdown).toContain('**Terminal writes run sandboxed without asking** (`active`)');
    const positions = SANDBOX_RELAXATION_RULES.map(rule => markdown.indexOf(`| \`${rule.id}\` |`));
    expect(positions.every(position => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(markdown).toContain('atlasmind.sandbox.relaxTerminalApprovals');
    expect(markdown).not.toContain('Approvals are unchanged: a command still asks');
  });

  it('the report says nothing about relaxation when it was not told the setting', () => {
    const markdown = renderSandboxCheckReport({
      reading: { configuration: configuration(), problems: [], ignored: [] },
      attestation: confirmed(),
      hostOs: 'linux',
      dryRun: false,
      now: NOW,
      mode: 'require',
    });
    expect(markdown).not.toContain('## Approval relaxation');
  });
});

describe('the extension gate applies the table where the table says', () => {
  const source = readFileSync(path.join(ROOT_DIR, 'src', 'extension.ts'), 'utf8');
  const start = source.indexOf('const toolApprovalGate = async (');
  const gate = source.slice(start, source.indexOf('const generatedSkillApprovalGate', start));

  it('checks the ceiling, then taint, then the relaxation, then the approval mode and bypasses', () => {
    const order = [
      "policy.category === 'terminal-write' && !configuration.get<boolean>('allowTerminalWrite', false)",
      "meta?.escalation?.decision === 'fresh-approval'",
      'evaluateSandboxApprovalRelaxation(',
      'startupModules.requiresToolApproval(mode, policy)',
      'toolApprovalManager.shouldBypass(taskId, policy)',
    ].map(marker => gate.indexOf(marker));
    expect(order.every(index => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('passes taint whether or not it was acknowledged, and returns the very session it checked with the audit', () => {
    expect(gate).toContain('tainted: meta?.escalation !== undefined');
    expect(gate).toContain('relaxSetting: readRelaxTerminalApprovalsSetting(inspectSandboxRelaxSetting())');
    expect(gate).toContain('outputChannel.appendLine(relaxation.audit.line)');
    expect(gate).toContain('return { approved: true, sandboxSession: relaxation.session, audit: relaxation.audit }');
  });
});

describe('purity', () => {
  it('imports no vscode and nothing that executes at runtime', () => {
    const source = readFileSync(path.join(ROOT_DIR, 'src', 'core', 'sandboxApprovalRelaxation.ts'), 'utf8');
    expect(source).not.toMatch(/from 'vscode'/);
    expect(source).not.toMatch(/child_process/);
    const runtimeImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map(match => match[1]);
    expect(runtimeImports.sort()).toEqual(['../utils/secretRedactor.js', './sandboxPlan.js']);
  });
});

describe('installed dependencies at the gate', () => {
  it('does not relax a command the runner would refuse for want of prepared dependencies', async () => {
    const notPrepared = session({ dependencies: { status: 'not-prepared', root: ROOT, rule: 'prepared', reason: 'No dependencies.' } });
    const decision = await evaluateSandboxApprovalRelaxation(facts({}, 'node', ['scripts/build.mjs']), deps(notPrepared));
    expect(decision).toMatchObject({ outcome: 'ask', rule: 'route-not-sandbox' });
    expect(decision.reason).toContain('dependencies/dependencies-not-prepared');
  });

  it('relaxes it once a volume is ready for that folder, and a command that loads no packages either way', async () => {
    const ready = session({
      dependencies: {
        status: 'ready', root: ROOT, volume: 'atlasmind-deps-0123456789abcdef', key: '0123456789abcdef'.repeat(4),
        manager: 'npm', lockfile: 'package-lock.json', installScripts: false, preparedAt: NOW.toISOString(),
      },
    });
    expect((await evaluateSandboxApprovalRelaxation(facts({}, 'node', ['scripts/build.mjs']), deps(ready))).outcome).toBe('relaxed');
    const notPrepared = session({ dependencies: { status: 'not-prepared', root: ROOT, rule: 'prepared', reason: 'No dependencies.' } });
    expect((await evaluateSandboxApprovalRelaxation(facts(), deps(notPrepared))).outcome).toBe('relaxed');
  });
});
