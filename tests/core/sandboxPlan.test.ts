import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SANDBOX_ARGV_RULES,
  SANDBOX_ATTESTATION_RULES,
  SANDBOX_ELIGIBILITY_RULES,
  SANDBOX_ENV_ALLOWLIST,
  SANDBOX_FIXED_ENV,
  SANDBOX_INTERACTION_RULES,
  SANDBOX_PLAN_RULES,
  SANDBOX_PROBE_MAX_AGE_MS,
  assessSandboxAttestation,
  assessSandboxEligibility,
  buildSandboxArgv,
  parseSandboxImageReference,
  planExecution,
  readSandboxMode,
  selectSandboxEnv,
  type SandboxAttestation,
  type SandboxConfiguration,
  type SandboxHostFacts,
  type SandboxInvocation,
  type SandboxProbe,
  type SandboxRunSpec,
} from '../../src/core/sandboxPlan.ts';
import { classifyHostCommand } from '../../src/core/dryRun.ts';
import { TAINT_ESCALATION } from '../../src/core/contextProvenance.ts';
import { classifyUnattendedStep } from '../../src/core/scheduledRoutinePolicy.ts';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const DIGEST = `sha256:${'0123456789abcdef'.repeat(4)}`;
const IMAGE = `ghcr.io/atlasmind/sandbox-node@${DIGEST}`;
const NOW = new Date('2026-10-08T12:00:00.000Z');
const PROBED_AT = '2026-10-08T11:58:00.000Z';

function probe(overrides: Partial<SandboxProbe> = {}): SandboxProbe {
  return {
    engine: 'docker',
    cliPresent: true,
    infoOk: true,
    serverOs: 'linux',
    arch: 'x64',
    runtimes: ['io.containerd.runc.v2', 'runc'],
    rootless: false,
    image: IMAGE,
    imageDigest: DIGEST,
    canary: 'passed',
    probedAt: PROBED_AT,
    ...overrides,
  };
}

function configuration(overrides: Partial<SandboxConfiguration> = {}): SandboxConfiguration {
  return { mode: 'require', engine: 'auto', image: IMAGE, cpus: 2, memoryGb: 4, ...overrides };
}

const LINUX_HOST: SandboxHostFacts = { os: 'linux', user: { uid: 1000, gid: 1000 }, homeDir: '/home/joel' };
const DARWIN_HOST: SandboxHostFacts = { os: 'darwin', homeDir: '/Users/joel' };
const WIN_HOST: SandboxHostFacts = { os: 'win32', homeDir: 'C:\\Users\\joel' };

function spec(overrides: Partial<SandboxRunSpec> = {}): SandboxRunSpec {
  return {
    engine: 'docker',
    image: IMAGE,
    runId: 'r1a2b3c4d5',
    host: LINUX_HOST,
    rootless: false,
    cpus: 2,
    memoryGb: 4,
    executable: 'npm',
    args: ['run', 'test'],
    root: '/home/joel/dev/app',
    cwd: '/home/joel/dev/app',
    env: { CI: 'true', ANTHROPIC_API_KEY: 'sk-ant-secret', HOME: '/home/joel', PATH: '/usr/bin' },
    ...overrides,
  };
}

function invocation(overrides: Partial<SandboxInvocation> = {}): SandboxInvocation {
  return {
    runId: 'r1a2b3c4d5',
    executable: 'npm',
    args: ['run', 'test'],
    root: '/home/joel/dev/app',
    cwd: '/home/joel/dev/app',
    env: {},
    ...overrides,
  };
}

function confirmed(overrides: Partial<SandboxProbe> = {}): SandboxAttestation {
  const attestation = assessSandboxAttestation(probe(overrides), configuration(), NOW);
  expect(attestation.status).toBe('confirmed');
  return attestation;
}

/** The engine options: everything before the image, which is where user input must not become an option. */
function optionSection(argv: readonly string[]): string[] {
  const index = argv.indexOf(IMAGE);
  expect(index).toBeGreaterThan(0);
  return argv.slice(0, index);
}

const COMMON_HEAD = [
  'run', '--rm', '--init', '--pull', 'never',
  '--name', 'atlasmind-sbx-r1a2b3c4d5',
  '--label', 'atlasmind.sandbox=1',
  '--network', 'none',
  '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges',
  '--read-only',
  '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m',
  '--pids-limit', '512',
  '--cpus', '2',
  '--memory', '4096m',
  '--memory-swap', '4096m',
];

describe('sandboxPlan: golden argv per host', () => {
  it('Linux host, Docker: runs as the editor\'s uid:gid', () => {
    const result = buildSandboxArgv(spec());
    expect(result).toEqual({
      ok: true,
      command: 'docker',
      rejectedEnv: [],
      argv: [
        ...COMMON_HEAD,
        '--user', '1000:1000',
        '--mount', 'type=bind,source=/home/joel/dev/app,target=/work',
        '--workdir', '/work',
        '--env', 'HOME=/tmp',
        '--env', 'TMPDIR=/tmp',
        '--env', 'CI=true',
        IMAGE, 'npm', 'run', 'test',
      ],
    });
  });

  it('Linux host, rootless Podman: keep-id before --user', () => {
    const result = buildSandboxArgv(spec({ engine: 'podman', rootless: true, cwd: '/home/joel/dev/app/packages/web' }));
    expect(result.ok && result.command).toBe('podman');
    expect(result.ok && result.argv).toEqual([
      ...COMMON_HEAD,
      '--userns', 'keep-id',
      '--user', '1000:1000',
      '--mount', 'type=bind,source=/home/joel/dev/app,target=/work',
      '--workdir', '/work/packages/web',
      '--env', 'HOME=/tmp',
      '--env', 'TMPDIR=/tmp',
      '--env', 'CI=true',
      IMAGE, 'npm', 'run', 'test',
    ]);
  });

  it('macOS host: no --user, since the engine runs in its own VM', () => {
    const result = buildSandboxArgv(spec({
      host: DARWIN_HOST,
      root: '/Users/joel/dev/app',
      cwd: '/Users/joel/dev/app',
      env: {},
      executable: './node_modules/.bin/vitest',
      args: ['run'],
    }));
    expect(result.ok && result.argv).toEqual([
      ...COMMON_HEAD,
      '--mount', 'type=bind,source=/Users/joel/dev/app,target=/work',
      '--workdir', '/work',
      '--env', 'HOME=/tmp',
      '--env', 'TMPDIR=/tmp',
      IMAGE, './node_modules/.bin/vitest', 'run',
    ]);
  });

  it('Windows host: a drive path by --mount, and a forward-slash workdir', () => {
    const result = buildSandboxArgv(spec({
      host: WIN_HOST,
      root: 'C:\\Users\\joel\\dev\\app',
      cwd: 'C:\\Users\\joel\\dev\\app\\src\\core',
      env: { NODE_OPTIONS: '--max-old-space-size=4096' },
      args: ['test', '--', '--reporter=dot'],
    }));
    expect(result.ok && result.argv).toEqual([
      ...COMMON_HEAD,
      '--mount', 'type=bind,source=C:\\Users\\joel\\dev\\app,target=/work',
      '--workdir', '/work/src/core',
      '--env', 'HOME=/tmp',
      '--env', 'TMPDIR=/tmp',
      '--env', 'NODE_OPTIONS=--max-old-space-size=4096',
      IMAGE, 'npm', 'test', '--', '--reporter=dot',
    ]);
    expect(result.ok && result.argv.some(arg => arg === '-v' || arg === '--volume')).toBe(false);
  });
});

describe('sandboxPlan: the image is pinned by digest or refused', () => {
  it('accepts name@sha256:<64 hex>, with or without a registry and port', () => {
    expect(parseSandboxImageReference(IMAGE)).toEqual({ ok: true, reference: IMAGE, name: 'ghcr.io/atlasmind/sandbox-node', digest: DIGEST });
    expect(parseSandboxImageReference(`node@${DIGEST}`).ok).toBe(true);
    expect(parseSandboxImageReference(`localhost:5000/team/node@${DIGEST}`).ok).toBe(true);
  });

  it.each([
    ['node'],
    ['node:20'],
    ['ghcr.io/atlasmind/sandbox-node:latest'],
  ])('refuses the tag-only %s rather than resolving it', value => {
    const result = parseSandboxImageReference(value);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/not pinned by digest/);
  });

  it('refuses a tag beside the digest, because the tag is not what runs', () => {
    const result = parseSandboxImageReference(`node:20@${DIGEST}`);
    expect(!result.ok && result.reason).toMatch(/tag beside its digest/);
    expect(parseSandboxImageReference(`localhost:5000/node:20@${DIGEST}`).ok).toBe(false);
  });

  it('never coerces: case, whitespace, short and non-sha256 digests are refused', () => {
    for (const value of [
      `node@${DIGEST.toUpperCase()}`,
      `Node@${DIGEST}`,
      ` node@${DIGEST}`,
      `node@${DIGEST} `,
      `node@sha256:${'a'.repeat(63)}`,
      `node@sha512:${'a'.repeat(128)}`,
      '',
      `-node@${DIGEST}`,
    ]) {
      expect(parseSandboxImageReference(value).ok, value).toBe(false);
    }
    expect(parseSandboxImageReference(undefined).ok).toBe(false);
  });

  it('refuses the argv for a tag-only image too', () => {
    expect(buildSandboxArgv(spec({ image: 'node:20' }))).toMatchObject({ ok: false, rule: 'image-pinned' });
  });
});

describe('sandboxPlan: attestation', () => {
  it('confirms a complete, fresh, Linux reading of the pinned image', () => {
    const attestation = assessSandboxAttestation(probe(), configuration(), NOW);
    expect(attestation).toMatchObject({
      status: 'confirmed',
      engine: 'docker',
      strength: 'container',
      image: IMAGE,
      digest: DIGEST,
      probedAt: PROBED_AT,
      expiresAt: '2026-10-08T12:08:00.000Z',
    });
    expect(attestation.status === 'confirmed' && attestation.rules).toEqual(SANDBOX_ATTESTATION_RULES.map(rule => rule.id));
    // Stable for one reading, so an approval record can cite it.
    expect(assessSandboxAttestation(probe(), configuration(), NOW)).toEqual(attestation);
  });

  it('refuses a Windows-container engine as unavailable, not as a weaker sandbox', () => {
    expect(assessSandboxAttestation(probe({ serverOs: 'windows' }), configuration(), NOW))
      .toMatchObject({ status: 'unavailable', rule: 'linux-engine' });
    expect(assessSandboxAttestation(probe({ serverOs: '' }), configuration(), NOW))
      .toMatchObject({ status: 'unavailable', rule: 'linux-engine' });
  });

  it('refuses a stale probe, a probe at exactly the limit, and one dated in the future', () => {
    const stale = new Date(Date.parse(PROBED_AT) + 11 * 60 * 1000);
    expect(assessSandboxAttestation(probe(), configuration(), stale)).toMatchObject({ status: 'unavailable', rule: 'probe-fresh' });
    const atLimit = new Date(Date.parse(PROBED_AT) + SANDBOX_PROBE_MAX_AGE_MS);
    expect(assessSandboxAttestation(probe(), configuration(), atLimit)).toMatchObject({ rule: 'probe-fresh' });
    const before = new Date(Date.parse(PROBED_AT) - 1000);
    expect(assessSandboxAttestation(probe(), configuration(), before)).toMatchObject({ rule: 'probe-fresh' });
    expect(assessSandboxAttestation(probe({ probedAt: 'yesterday' }), configuration(), NOW)).toMatchObject({ rule: 'probe-fresh' });
  });

  it('reports the first failing rule, in declaration order', () => {
    expect(assessSandboxAttestation(undefined, configuration(), NOW)).toMatchObject({ rule: 'probed' });
    expect(assessSandboxAttestation(probe({ cliPresent: false, infoOk: false }), configuration(), NOW)).toMatchObject({ rule: 'cli-present' });
    expect(assessSandboxAttestation(probe({ infoOk: false }), configuration(), NOW)).toMatchObject({ rule: 'engine-answers' });
    expect(assessSandboxAttestation(probe(), configuration({ engine: 'podman' }), NOW)).toMatchObject({ rule: 'engine-matches-setting' });
    expect(assessSandboxAttestation(probe({ canary: 'not-run' }), configuration(), NOW)).toMatchObject({ rule: 'canary-passed' });
    expect(assessSandboxAttestation(probe({ canary: 'failed' }), configuration(), NOW)).toMatchObject({ rule: 'canary-passed' });
  });

  it('refuses an unknown user mapping, rootless Docker and rootful Podman', () => {
    expect(assessSandboxAttestation(probe({ rootless: undefined }), configuration(), NOW)).toMatchObject({ rule: 'user-namespace-known' });
    expect(assessSandboxAttestation(probe({ rootless: true }), configuration(), NOW)).toMatchObject({ rule: 'user-namespace-known' });
    expect(assessSandboxAttestation(probe({ engine: 'podman', rootless: false }), configuration(), NOW))
      .toMatchObject({ rule: 'user-namespace-known' });
    expect(assessSandboxAttestation(probe({ engine: 'podman', rootless: true }), configuration(), NOW).status).toBe('confirmed');
  });

  it('refuses a tag-only configured image, an absent image, and a probe of a different image', () => {
    expect(assessSandboxAttestation(probe({ image: 'node:20' }), configuration({ image: 'node:20' }), NOW)).toMatchObject({ rule: 'image-pinned' });
    expect(assessSandboxAttestation(probe(), configuration({ image: '' }), NOW)).toMatchObject({ rule: 'image-pinned' });
    expect(assessSandboxAttestation(probe({ imageDigest: undefined }), configuration(), NOW)).toMatchObject({ rule: 'image-present' });
    expect(assessSandboxAttestation(probe({ image: `node@${DIGEST}` }), configuration(), NOW)).toMatchObject({ rule: 'image-present' });
  });
});

describe('sandboxPlan: eligibility', () => {
  it.each([
    ['git', ['status'], 'git'],
    ['C:\\Program Files\\Git\\cmd\\git.exe', ['log'], 'git'],
    ['gh', ['pr', 'list'], 'github-cli'],
    ['docker', ['ps'], 'container-engine'],
    ['podman', ['run', 'x'], 'container-engine'],
    ['curl', ['https://example.com'], 'network-client'],
    ['ssh', ['host'], 'network-client'],
    ['npm', ['publish'], 'leaves-the-machine'],
    ['bash', ['-c', 'npm publish'], 'leaves-the-machine'],
    ['npm', ['ci'], 'installs-packages'],
    ['npx', ['vitest'], 'installs-packages'],
    ['npm', ['version', 'patch'], 'changes-history'],
  ] as const)('never sandboxes %s %j (%s)', (executable, args, rule) => {
    expect(assessSandboxEligibility(executable, args)).toMatchObject({ eligible: false, rule });
  });

  it.each([
    ['npm', ['run', 'test']],
    ['npm', ['test']],
    ['node', ['scripts/check.mjs']],
    ['./node_modules/.bin/vitest', ['run']],
    ['tsc', ['--noEmit']],
  ] as const)('sandboxes %s %j', (executable, args) => {
    expect(assessSandboxEligibility(executable, args)).toEqual({ eligible: true });
  });

  it('speaks the unattended-routine vocabulary rather than a second one', () => {
    for (const command of ['npm ci', 'npm install left-pad', 'pip install x', 'npm publish', 'npm version patch']) {
      const [executable, ...args] = command.split(' ');
      const routine = classifyUnattendedStep(command);
      const sandbox = assessSandboxEligibility(executable!, args);
      expect(routine, command).toBeDefined();
      expect(sandbox.eligible === false && sandbox.rule, command).toBe(routine!.id);
    }
  });
});

describe('sandboxPlan: what is mounted', () => {
  it.each([
    ['the home directory', '/home/joel', '/home/joel'],
    ['an ancestor of home', '/home', '/home'],
    ['a credential folder', '/home/joel/.ssh/keys', '/home/joel/.ssh/keys'],
    ['a folder holding the engine socket', '/var', '/var'],
    ['/run', '/run', '/run'],
  ])('refuses %s', (_label, root, cwd) => {
    expect(buildSandboxArgv(spec({ root, cwd }))).toMatchObject({ ok: false, rule: 'mount-sensitive' });
  });

  it('refuses a folder containing the ssh agent socket when the host names it', () => {
    const host = { ...LINUX_HOST, sensitivePaths: ['/home/joel/dev/agent.sock'] };
    expect(buildSandboxArgv(spec({ host, root: '/home/joel/dev', cwd: '/home/joel/dev' }))).toMatchObject({ rule: 'mount-sensitive' });
  });

  it('refuses the Windows home, case-insensitively', () => {
    expect(buildSandboxArgv(spec({ host: WIN_HOST, root: 'c:\\users\\joel', cwd: 'c:\\users\\joel' })))
      .toMatchObject({ rule: 'mount-sensitive' });
  });

  it.each([
    ['/', '/'],
    ['/home/joel/dev/app/', '/home/joel/dev/app/'],
    ['/home/joel/dev/../dev/app', '/home/joel/dev/app'],
    ['relative/app', 'relative/app'],
    ['/home/joel/dev/a,readonly=false', '/home/joel/dev/a,readonly=false'],
    ['/home/joel/dev/"quoted"', '/home/joel/dev/"quoted"'],
  ])('refuses %s as a mount root', (root, cwd) => {
    expect(buildSandboxArgv(spec({ root, cwd }))).toMatchObject({ ok: false, rule: 'mount-root' });
  });

  it('refuses a Windows drive root and a UNC share', () => {
    expect(buildSandboxArgv(spec({ host: WIN_HOST, root: 'C:\\', cwd: 'C:\\' }))).toMatchObject({ rule: 'mount-root' });
    expect(buildSandboxArgv(spec({ host: WIN_HOST, root: '\\\\server\\share\\app', cwd: '\\\\server\\share\\app' })))
      .toMatchObject({ rule: 'mount-root' });
  });

  it('refuses a working directory outside the mounted folder', () => {
    expect(buildSandboxArgv(spec({ cwd: '/home/joel/dev/other' }))).toMatchObject({ rule: 'working-directory' });
    expect(buildSandboxArgv(spec({ cwd: 'packages' }))).toMatchObject({ rule: 'working-directory' });
  });
});

describe('sandboxPlan: the rest of the argv rules', () => {
  it.each([
    ['C:\\Program Files\\nodejs\\node.exe'],
    ['/usr/bin/node'],
    ['../escape'],
    ['./a/../b'],
    ['-rm'],
    [''],
  ])('refuses the host-shaped or option-shaped executable %j', executable => {
    expect(buildSandboxArgv(spec({ executable }))).toMatchObject({ ok: false, rule: 'executable' });
  });

  it('refuses a Linux host whose user is unknown or root', () => {
    expect(buildSandboxArgv(spec({ host: { ...LINUX_HOST, user: undefined } }))).toMatchObject({ rule: 'host-user' });
    expect(buildSandboxArgv(spec({ host: { ...LINUX_HOST, user: { uid: 0, gid: 0 } } }))).toMatchObject({ rule: 'host-user' });
    expect(buildSandboxArgv(spec({ host: { ...LINUX_HOST, user: { uid: -1, gid: 1000 } } }))).toMatchObject({ rule: 'host-user' });
    expect(buildSandboxArgv(spec({ rootless: true }))).toMatchObject({ rule: 'host-user' });
    expect(buildSandboxArgv(spec({ engine: 'podman', rootless: false }))).toMatchObject({ rule: 'host-user' });
  });

  it('refuses limits it cannot state, and an unsupported host', () => {
    for (const [cpus, memoryGb] of [[0, 4], [2, 0], [Number.NaN, 4], [2, Number.POSITIVE_INFINITY], [1.234, 4], [65, 4], [2, 1000]]) {
      expect(buildSandboxArgv(spec({ cpus, memoryGb })), `${cpus}/${memoryGb}`).toMatchObject({ rule: 'limits' });
    }
    expect(buildSandboxArgv(spec({ host: { ...LINUX_HOST, os: 'freebsd' } }))).toMatchObject({ rule: 'host-os' });
    expect(buildSandboxArgv(spec({ runId: 'ABC' }))).toMatchObject({ rule: 'run-id' });
  });

  it('lets only allowlisted environment cross, and reports a listed name whose value is refused', () => {
    const result = selectSandboxEnv({
      NODE_OPTIONS: '--require /work/evil.js --max-old-space-size=4096',
      CI: 'true',
      ANTHROPIC_API_KEY: 'sk-ant-x',
      GITHUB_TOKEN: 'ghp_x',
      SSH_AUTH_SOCK: '/tmp/agent',
      HOME: '/home/joel',
      NODE_ENV: undefined,
    });
    expect(result).toEqual({ pairs: [['CI', 'true']], rejected: ['NODE_OPTIONS'] });
  });

  it('every refusal names a declared rule', () => {
    const declared = new Set<string>(SANDBOX_ARGV_RULES.map(rule => rule.id));
    for (const bad of [
      spec({ image: 'node' }), spec({ runId: '' }), spec({ host: { ...LINUX_HOST, os: 'aix' } }),
      spec({ host: { ...LINUX_HOST, user: undefined } }), spec({ cpus: 0 }), spec({ root: '/' }),
      spec({ root: '/home', cwd: '/home' }), spec({ cwd: '/etc' }), spec({ executable: '/bin/sh' }),
    ]) {
      const result = buildSandboxArgv(bad);
      expect(result.ok).toBe(false);
      expect(declared.has(!result.ok ? result.rule : '')).toBe(true);
    }
  });
});

describe('sandboxPlan: mode and plan', () => {
  it('reads absent and off as off, and every other value as require — there is no prefer', () => {
    expect(readSandboxMode(undefined)).toBe('off');
    expect(readSandboxMode(null)).toBe('off');
    expect(readSandboxMode('off')).toBe('off');
    expect(readSandboxMode('require')).toBe('require');
    expect(readSandboxMode('prefer')).toBe('require');
    expect(readSandboxMode('Off')).toBe('require');
    expect(readSandboxMode('')).toBe('require');
  });

  it('runs on the host, unchanged, when the sandbox is off', () => {
    expect(planExecution(invocation(), undefined, configuration({ mode: 'off' }), LINUX_HOST, NOW))
      .toMatchObject({ route: 'host', rule: 'sandbox-off' });
  });

  it('plans the sandbox under require when everything holds', () => {
    const attestation = confirmed();
    const plan = planExecution(invocation({ env: { CI: 'true' } }), attestation, configuration(), LINUX_HOST, NOW);
    expect(plan).toMatchObject({ route: 'sandbox', rule: 'sandboxed', command: 'docker', rejectedEnv: [] });
    expect(plan.route === 'sandbox' && plan.attestationId).toBe(attestation.status === 'confirmed' ? attestation.id : '');
  });

  it('refuses rather than falling back to the host', () => {
    expect(planExecution(invocation({ executable: 'git', args: ['status'] }), confirmed(), configuration(), LINUX_HOST, NOW))
      .toMatchObject({ route: 'refuse', stage: 'eligibility', rule: 'git' });
    expect(planExecution(invocation(), undefined, configuration(), LINUX_HOST, NOW))
      .toMatchObject({ route: 'refuse', stage: 'attestation', rule: 'probed' });
    const unavailable = assessSandboxAttestation(probe({ serverOs: 'windows' }), configuration(), NOW);
    expect(planExecution(invocation(), unavailable, configuration(), LINUX_HOST, NOW))
      .toMatchObject({ route: 'refuse', stage: 'attestation', rule: 'linux-engine' });
    expect(planExecution(invocation({ executable: '/usr/bin/npm' }), confirmed(), configuration(), LINUX_HOST, NOW))
      .toMatchObject({ route: 'refuse', stage: 'argv', rule: 'executable' });
  });

  it('refuses an attestation that has expired since it was made', () => {
    const later = new Date(Date.parse(PROBED_AT) + SANDBOX_PROBE_MAX_AGE_MS + 1);
    expect(planExecution(invocation(), confirmed(), configuration(), LINUX_HOST, later))
      .toMatchObject({ route: 'refuse', stage: 'plan', rule: 'attestation-expired' });
  });

  it('refuses an attestation for an image or engine the settings no longer name', () => {
    const otherImage = `node@${DIGEST}`;
    expect(planExecution(invocation(), confirmed(), configuration({ image: otherImage }), LINUX_HOST, NOW))
      .toMatchObject({ route: 'refuse', rule: 'attestation-for-other-configuration' });
    expect(planExecution(invocation(), confirmed(), configuration({ engine: 'podman' }), LINUX_HOST, NOW))
      .toMatchObject({ route: 'refuse', rule: 'attestation-for-other-configuration' });
  });

  it('declares every rule id once', () => {
    for (const table of [SANDBOX_ATTESTATION_RULES, SANDBOX_ELIGIBILITY_RULES, SANDBOX_ARGV_RULES, SANDBOX_PLAN_RULES, SANDBOX_INTERACTION_RULES]) {
      const ids = table.map(rule => rule.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(table.every(rule => rule.description.length > 20)).toBe(true);
    }
  });
});

describe('sandboxPlan: what a sandbox does not change', () => {
  it('dry run wins: the engine launch is graded an effect, so a dry run records it and runs nothing', () => {
    const plan = planExecution(invocation(), confirmed(), configuration(), LINUX_HOST, NOW);
    expect(plan.route).toBe('sandbox');
    if (plan.route === 'sandbox') {
      expect(classifyHostCommand(plan.command, plan.argv).kind).toBe('effect');
    }
    expect(SANDBOX_INTERACTION_RULES.map(rule => rule.id)).toContain('dry-run-wins');
  });

  it('taint is not relaxed: a terminal write after untrusted content still needs a fresh approval', () => {
    // The sandbox rests on this row staying where it is; it has no input that could lower it.
    expect(TAINT_ESCALATION['terminal-write']).toMatchObject({ tainted: 'fresh-approval', suspected: 'fresh-approval' });
    expect(SANDBOX_INTERACTION_RULES.map(rule => rule.id)).toEqual(
      expect.arrayContaining(['taint-not-relaxed', 'unattended-unchanged', 'approvals-relaxed-only-by-opt-in']),
    );
  });

  it('is pure: no vscode, no child_process, and nothing from the executor at runtime', () => {
    const source = readFileSync(path.join(ROOT_DIR, 'src', 'core', 'sandboxPlan.ts'), 'utf8');
    const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gm)];
    expect(imports.length).toBeGreaterThan(0);
    for (const [, typeOnly, from] of imports) {
      expect(from).not.toBe('vscode');
      expect(from).not.toMatch(/child_process/);
      if (from === './localCiRunner.js' || from === './contextProvenance.js' || from === './dryRun.js') {
        expect(typeOnly, `${from} may only be imported for types`).toBeTruthy();
      }
    }
  });
});

// ── Properties ───────────────────────────────────────────────────

const ALLOWED_ENV_NAMES = new Set([...Object.keys(SANDBOX_ENV_ALLOWLIST), ...SANDBOX_FIXED_ENV.map(([name]) => name)]);

const envArb = fc.dictionary(
  fc.oneof(fc.constantFrom(...Object.keys(SANDBOX_ENV_ALLOWLIST), 'ANTHROPIC_API_KEY', 'HOME', 'PATH', 'SSH_AUTH_SOCK', 'DOCKER_HOST'), fc.string()),
  fc.oneof(fc.string(), fc.constantFrom('true', '1', '--max-old-space-size=2048', '/var/run/docker.sock', '--privileged')),
);

const argsArb = fc.array(
  fc.oneof(fc.string(), fc.constantFrom('--privileged', '-v', '/var/run/docker.sock:/var/run/docker.sock', '--network', 'host', '--mount')),
  { maxLength: 8 },
);

const hostArb = fc.constantFrom<[SandboxHostFacts, string]>(
  [LINUX_HOST, '/home/joel/dev/app'],
  [DARWIN_HOST, '/Users/joel/dev/app'],
  [WIN_HOST, 'C:\\Users\\joel\\dev\\app'],
);

describe('sandboxPlan: properties', () => {
  it('the engine options never grant privilege, the socket, a second mount, a network or an unlisted variable', () => {
    fc.assert(fc.property(
      hostArb, fc.constantFrom('docker', 'podman'), argsArb, envArb,
      fc.constantFrom('npm', 'node', './node_modules/.bin/vitest', 'pytest'),
      ([host, root], engine, args, env, executable) => {
        const result = buildSandboxArgv(spec({ engine, rootless: engine === 'podman', host, root, cwd: root, args, env, executable }));
        if (!result.ok) {
          return;
        }
        const options = optionSection(result.argv);
        expect(options).not.toContain('--privileged');
        expect(options.some(arg => arg.includes('docker.sock') || arg.includes('podman.sock'))).toBe(false);
        expect(options.filter(arg => arg === '--mount')).toHaveLength(1);
        expect(options.some(arg => arg === '-v' || arg === '--volume' || arg.startsWith('--volume=') || arg === '--volumes-from')).toBe(false);
        expect(options[options.indexOf('--mount') + 1]).toBe(`type=bind,source=${root},target=/work`);
        expect(options.filter(arg => arg === '--network')).toHaveLength(1);
        expect(options[options.indexOf('--network') + 1]).toBe('none');
        expect(options.some(arg => arg.startsWith('--network=') || arg === '--net' || arg.startsWith('--net='))).toBe(false);
        expect(options).toContain('--read-only');
        expect(options[options.indexOf('--cap-drop') + 1]).toBe('ALL');
        expect(options.some(arg => arg === '--cap-add' || arg.startsWith('--device'))).toBe(false);
        options.forEach((arg, index) => {
          if (arg === '--env' || arg === '-e') {
            const pair = options[index + 1] ?? '';
            const name = pair.slice(0, pair.indexOf('='));
            expect(pair.includes('='), pair).toBe(true);
            expect(ALLOWED_ENV_NAMES.has(name), name).toBe(true);
          }
        });
        // The command and its arguments follow the image untouched.
        expect(result.argv.slice(options.length)).toEqual([IMAGE, executable, ...args]);
      },
    ), { numRuns: 300 });
  });

  it('require never routes to the host, whatever else is true', () => {
    const attestationArb = fc.oneof(
      fc.constant<SandboxAttestation | undefined>(undefined),
      fc.constant<SandboxAttestation | undefined>(assessSandboxAttestation(probe(), configuration(), NOW)),
      fc.constant<SandboxAttestation | undefined>(assessSandboxAttestation(probe({ serverOs: 'windows' }), configuration(), NOW)),
      fc.constant<SandboxAttestation | undefined>(assessSandboxAttestation(probe({ canary: 'failed' }), configuration(), NOW)),
    );
    fc.assert(fc.property(
      fc.oneof(fc.constant('require'), fc.string().filter(value => value !== 'off')),
      attestationArb,
      fc.constantFrom('npm', 'git', 'gh', 'docker', 'curl', '/usr/bin/node', 'node', 'npx'),
      argsArb,
      envArb,
      fc.integer({ min: -20 * 60 * 1000, max: 20 * 60 * 1000 }),
      fc.constantFrom(IMAGE, '', 'node:20', `node@${DIGEST}`),
      fc.constantFrom<SandboxConfiguration['engine']>('auto', 'docker', 'podman'),
      (mode, attestation, executable, args, env, skew, image, engine) => {
        const plan = planExecution(
          invocation({ executable, args, env }),
          attestation,
          { mode: mode as SandboxConfiguration['mode'], engine, image, cpus: 2, memoryGb: 4 },
          LINUX_HOST,
          new Date(NOW.getTime() + skew),
        );
        expect(plan.route).not.toBe('host');
      },
    ), { numRuns: 400 });
  });
});
