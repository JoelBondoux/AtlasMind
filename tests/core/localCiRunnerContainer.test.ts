import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildLocalCiRunnerContainerArgs, buildLocalCiRunnerStdinPrelude } from '../../src/core/localCiRunner.ts';
import { validateLocalCiTrustAnchor } from '../../src/core/localCiTrustAnchor.ts';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'trust-anchor');
const CA_SHA256 = 'b7a5b710470c2975bf64044ee614f328de3e56b14497b075dff7a352c509dc5c';

function anchor() {
  const result = validateLocalCiTrustAnchor(readFileSync(path.join(FIXTURES, 'ca.pem'), 'utf8'), CA_SHA256, new Date('2026-11-27T12:00:00Z'));
  if (!result.ok) throw new Error(result.reason);
  return result.anchor;
}

const base = {
  containerName: 'atlasmind-ci-0123456789ab-deadbeef',
  runId: 42,
  imageId: `sha256:${'a'.repeat(64)}`,
  resources: { cpus: 4, memoryGb: 8, pidsLimit: 1024 },
  repoSlug: 'octo/app',
  runnerLabel: 'atlasmind-trusted-linux-x64',
  runnerName: 'atlasmind-host-01234567',
};

/** The bash program the container runs, and the positional arguments after it. */
function program(args: readonly string[]): { script: string; positional: string[] } {
  const at = args.findIndex(arg => arg === '-c' || arg === '-lc');
  return { script: args[at + 1]!, positional: args.slice(at + 2) };
}

describe('the ephemeral runner container', () => {
  it('registers with --disableupdate, so the job runs on the reviewed image and not a runtime download', () => {
    const { script } = program(buildLocalCiRunnerContainerArgs(base));
    expect(script).toMatch(/\.\/config\.sh [^;]*--ephemeral/);
    expect(script).toMatch(/\.\/config\.sh [^;]*--disableupdate/);
    expect(script).toMatch(/--no-default-labels/);
  });

  it('keeps the hardened shape: no mount, no socket, no added capability, non-root, the token on stdin only', () => {
    const args = buildLocalCiRunnerContainerArgs(base);
    const joined = args.join(' ');
    expect(joined).not.toMatch(/(^| )(-v|--volume|--mount)( |=)/);
    expect(joined).not.toMatch(/docker\.sock/);
    expect(joined).not.toMatch(/--cap-add/);
    expect(joined).not.toMatch(/--user/);
    expect(joined).not.toMatch(/--privileged/);
    expect(args).toContain('--cap-drop');
    expect(args[args.indexOf('--cap-drop') + 1]).toBe('ALL');
    expect(args).toContain('no-new-privileges:true');
    expect(args).toContain('--pull');
    expect(args[args.indexOf('--pull') + 1]).toBe('never');
    expect(joined).not.toMatch(/TOKEN=/);
    const { script, positional } = program(args);
    expect(script).toMatch(/read -r TOKEN/);
    expect(positional).toEqual(['_', 'https://github.com/octo/app', 'atlasmind-trusted-linux-x64', 'atlasmind-host-01234567']);
  });

  it('sends nothing ahead of the token when no trust anchor is configured', () => {
    expect(buildLocalCiRunnerStdinPrelude(undefined)).toBe('');
  });

  it('installs a verified trust anchor into the container\'s own store, then drops to the runner user', () => {
    const ca = anchor();
    const args = buildLocalCiRunnerContainerArgs({ ...base, trustAnchor: ca });
    const joined = args.join(' ');
    // Root only for the install step, with exactly the two capabilities needed to leave root.
    expect(args[args.indexOf('--user') + 1]).toBe('0:0');
    const added = args.flatMap((arg, index) => (arg === '--cap-add' ? [args[index + 1]] : []));
    expect(added.sort()).toEqual(['SETGID', 'SETUID']);
    expect(args[args.indexOf('--cap-drop') + 1]).toBe('ALL');
    expect(args).toContain('no-new-privileges:true');
    // Still no host mount: the certificate travels on stdin, not through the filesystem.
    expect(joined).not.toMatch(/(^| )(-v|--volume|--mount)( |=)/);
    const { script, positional } = program(args);
    expect(script).toMatch(/update-ca-certificates/);
    // The fingerprint is re-checked inside the container before the store is touched.
    expect(script).toMatch(/openssl x509 [^;]*-fingerprint -sha256/);
    expect(script.indexOf('-fingerprint')).toBeLessThan(script.indexOf('update-ca-certificates'));
    expect(script).toMatch(/setpriv --reuid=runner --regid=runner --init-groups/);
    // config.sh and run.sh run as the runner, never as root.
    expect(script.indexOf('setpriv')).toBeLessThan(script.indexOf('./config.sh'));
    expect(script).toMatch(/--disableupdate/);
    expect(positional).toContain(CA_SHA256);
    // TLS verification is never switched off.
    expect(joined).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED|GIT_SSL_NO_VERIFY|--insecure|-k /);
  });

  it('sends the certificate as one base64 line ahead of the token', () => {
    const ca = anchor();
    const prelude = buildLocalCiRunnerStdinPrelude(ca);
    expect(prelude).toBe(`${ca.pemBase64}\n`);
    expect(prelude.split('\n')).toHaveLength(2);
  });
});
