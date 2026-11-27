import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_CI_CA_BUILD_SECRET_ID,
  localCiCaBuildSecretArgs,
  normalizeCaFingerprint,
  readLocalCiTrustAnchor,
  validateLocalCiTrustAnchor,
} from '../../src/core/localCiTrustAnchor.ts';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'trust-anchor');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');
const CA_SHA256 = 'b7a5b710470c2975bf64044ee614f328de3e56b14497b075dff7a352c509dc5c';
const NOW = new Date('2026-11-27T12:00:00Z');

describe('validating an operator-supplied TLS inspection root', () => {
  it('accepts a self-signed, in-date CA whose fingerprint matches, and returns only public data', () => {
    const anchor = validateLocalCiTrustAnchor(fixture('ca.pem'), CA_SHA256, NOW);
    expect(anchor.ok).toBe(true);
    if (!anchor.ok) return;
    expect(anchor.anchor.fingerprintSha256).toBe(CA_SHA256);
    expect(anchor.anchor.subject).toMatch(/AtlasMind Test Inspection Root/);
    expect(anchor.anchor.pem).toMatch(/^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+-----END CERTIFICATE-----\n$/);
    expect(anchor.anchor.pemBase64).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(anchor.anchor.pemBase64, 'base64').toString('utf8')).toBe(anchor.anchor.pem);
  });

  it('accepts the colon-separated, upper-case fingerprint Windows and OpenSSL print', () => {
    const colons = CA_SHA256.toUpperCase().match(/../g)!.join(':');
    expect(normalizeCaFingerprint(colons)).toBe(CA_SHA256);
    expect(validateLocalCiTrustAnchor(fixture('ca.pem'), `SHA256 Fingerprint=${colons}`, NOW).ok).toBe(true);
  });

  it('refuses a fingerprint that does not match, naming both', () => {
    const wrong = validateLocalCiTrustAnchor(fixture('ca.pem'), 'ab'.repeat(32), NOW);
    expect(wrong).toMatchObject({ ok: false });
    if (wrong.ok) return;
    expect(wrong.reason).toMatch(/does not match/);
    expect(wrong.reason).toContain(CA_SHA256);
  });

  it('refuses a missing or malformed fingerprint rather than skipping the pin', () => {
    expect(validateLocalCiTrustAnchor(fixture('ca.pem'), '', NOW).ok).toBe(false);
    expect(validateLocalCiTrustAnchor(fixture('ca.pem'), 'abc', NOW).ok).toBe(false);
    expect(validateLocalCiTrustAnchor(fixture('ca.pem'), 'sha1:' + 'ab'.repeat(20), NOW).ok).toBe(false);
  });

  it('refuses a certificate that is not a CA', () => {
    const leaf = validateLocalCiTrustAnchor(fixture('leaf.pem'), '81629d1374f3677471fec0363b603be10ae7f14df519c83f7bc7e4495dd3e45d', NOW);
    expect(leaf).toMatchObject({ ok: false });
    expect(!leaf.ok && leaf.reason).toMatch(/not a certificate authority/i);
    const selfSignedLeaf = validateLocalCiTrustAnchor(fixture('selfsigned-leaf.pem'), 'bd42b2269b5688ef37f741f4429c065b0be64d56a1afa339a1c6872874a902a4', NOW);
    expect(!selfSignedLeaf.ok && selfSignedLeaf.reason).toMatch(/not a certificate authority/i);
  });

  it('refuses a CA that is not self-signed, such as an intermediate', () => {
    const intermediate = validateLocalCiTrustAnchor(fixture('intermediate.pem'), '61f24d827c5e893f704f1a934a7ac2345aa8f00122824ef437df595f5b3dd2c1', NOW);
    expect(intermediate).toMatchObject({ ok: false });
    expect(!intermediate.ok && intermediate.reason).toMatch(/self-signed root/i);
  });

  it('refuses a CA outside its validity period', () => {
    expect(validateLocalCiTrustAnchor(fixture('ca.pem'), CA_SHA256, new Date('2099-01-01T00:00:00Z'))).toMatchObject({ ok: false });
    const early = validateLocalCiTrustAnchor(fixture('ca.pem'), CA_SHA256, new Date('2001-01-01T00:00:00Z'));
    expect(!early.ok && early.reason).toMatch(/validity/i);
  });

  it('refuses a private key, a bundle of several certificates, or anything that is not one PEM certificate', () => {
    const key = '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----\n';
    const refusedKey = validateLocalCiTrustAnchor(key, CA_SHA256, NOW);
    expect(!refusedKey.ok && refusedKey.reason).toMatch(/private key/i);
    const withKey = `${fixture('ca.pem')}${key}`;
    expect(validateLocalCiTrustAnchor(withKey, CA_SHA256, NOW).ok).toBe(false);
    expect(validateLocalCiTrustAnchor(`${fixture('ca.pem')}${fixture('intermediate.pem')}`, CA_SHA256, NOW).ok).toBe(false);
    expect(validateLocalCiTrustAnchor('hello', CA_SHA256, NOW).ok).toBe(false);
    expect(validateLocalCiTrustAnchor('x'.repeat(70_000), CA_SHA256, NOW).ok).toBe(false);
  });
});

describe('reading the trust anchor settings', () => {
  it('is off when neither setting is given', async () => {
    expect(await readLocalCiTrustAnchor({ file: '', sha256: '' }, { now: NOW })).toEqual({ ok: true, anchor: undefined });
  });

  it('requires both settings together, and an absolute path', async () => {
    expect((await readLocalCiTrustAnchor({ file: path.join(FIXTURES, 'ca.pem'), sha256: '' }, { now: NOW })).ok).toBe(false);
    expect((await readLocalCiTrustAnchor({ file: '', sha256: CA_SHA256 }, { now: NOW })).ok).toBe(false);
    const relative = await readLocalCiTrustAnchor({ file: 'ca.pem', sha256: CA_SHA256 }, { now: NOW });
    expect(!relative.ok && relative.reason).toMatch(/absolute/);
  });

  it('reads and validates the file', async () => {
    const read = await readLocalCiTrustAnchor({ file: path.join(FIXTURES, 'ca.pem'), sha256: CA_SHA256 }, { now: NOW });
    expect(read.ok && read.anchor?.fingerprintSha256).toBe(CA_SHA256);
    const missing = await readLocalCiTrustAnchor({ file: path.join(FIXTURES, 'absent.pem'), sha256: CA_SHA256 }, { now: NOW });
    expect(!missing.ok && missing.reason).toMatch(/could not be read/);
  });
});

describe('passing the trust anchor to an image build', () => {
  it('passes it as a BuildKit secret, never as a build argument or build context file', () => {
    const args = localCiCaBuildSecretArgs('/etc/atlasmind/inspection-root.pem');
    expect(args).toEqual(['--secret', `id=${LOCAL_CI_CA_BUILD_SECRET_ID},src=/etc/atlasmind/inspection-root.pem`]);
    expect(args.join(' ')).not.toMatch(/--build-arg/);
  });

  it('refuses a path that could break out of the --secret value', () => {
    expect(() => localCiCaBuildSecretArgs('relative.pem')).toThrow(/absolute/);
    expect(() => localCiCaBuildSecretArgs('/tmp/a,src=/etc/shadow')).toThrow();
    expect(() => localCiCaBuildSecretArgs('/tmp/a\nb')).toThrow();
  });
});
