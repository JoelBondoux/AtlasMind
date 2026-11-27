/**
 * A TLS-inspection root the operator chose, verified before the runner trusts it.
 *
 * Antivirus and corporate proxies that inspect HTTPS re-sign traffic with a
 * local root the host trusts and a Linux container does not, so the runner's
 * registration fails with `PartialChain`. The tempting fixes all switch
 * verification off (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `curl -k`, the runner's
 * own TLS-disable switch) and AtlasMind uses none of them. Instead the operator
 * names the root's public certificate and its SHA-256 fingerprint, and the root
 * is added to the container's own trust store — after five checks:
 *
 * 1. **Exactly one PEM certificate and nothing else.** A private key, a bundle
 *    of several certificates, or anything that is not a certificate is refused.
 *    AtlasMind never reads a private key or a host credential store.
 * 2. **The fingerprint matches the pin**, given separately. The pin is what
 *    makes the choice explicit: a file that changes on disk is refused, not
 *    silently trusted.
 * 3. **It is a certificate authority** (`basicConstraints CA:TRUE`).
 * 4. **It is a self-signed root**: it names itself as issuer and its own key
 *    verifies its signature. An intermediate is refused — trusting one would
 *    accept everything its parent signs without saying so.
 * 5. **It is inside its validity period** at the time it is used.
 *
 * Image builds receive the root only as a BuildKit secret (`--secret`), which
 * is mounted for one `RUN` step and never written into a layer.
 *
 * `node:crypto`, `node:fs` and `node:path` only; nothing here runs a process.
 */

import { X509Certificate, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

export const LOCAL_CI_CA_BUILD_SECRET_ID = 'atlasmind_ca';
const MAX_PEM_BYTES = 65_536;
const PEM_CERTIFICATE = /^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----$/;

export interface LocalCiTrustAnchor {
  /** Normalised PEM (LF line endings, trailing newline). Public data. */
  pem: string;
  /** `pem` base64-encoded on one line, for sending over a container's stdin. */
  pemBase64: string;
  /** Lower-case hex, no separators. */
  fingerprintSha256: string;
  subject: string;
  validTo: string;
}

export type LocalCiTrustAnchorResult =
  | { ok: true; anchor: LocalCiTrustAnchor }
  | { ok: false; reason: string };

/** Accepts `ab:cd:…`, upper or lower case, optionally prefixed as OpenSSL or Windows print it. */
export function normalizeCaFingerprint(value: string): string | undefined {
  const stripped = value.trim()
    .replace(/^sha-?256\s*(fingerprint)?\s*[=:]?\s*/i, '')
    .replace(/[:\s]/g, '')
    .toLowerCase();
  return /^[a-f0-9]{64}$/.test(stripped) ? stripped : undefined;
}

export function validateLocalCiTrustAnchor(pemText: string, fingerprint: string, now: Date = new Date()): LocalCiTrustAnchorResult {
  if (typeof pemText !== 'string' || pemText.length > MAX_PEM_BYTES) {
    return { ok: false, reason: 'The trust anchor file is too large to be one certificate.' };
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pemText)) {
    return { ok: false, reason: 'The trust anchor file contains a private key. Export only the public root certificate; AtlasMind never reads private keys.' };
  }
  const trimmed = pemText.trim();
  const certificateCount = (trimmed.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length;
  if (certificateCount !== 1 || !PEM_CERTIFICATE.test(trimmed)) {
    return { ok: false, reason: 'The trust anchor file must hold exactly one PEM certificate (-----BEGIN CERTIFICATE-----) and nothing else.' };
  }
  const pinned = normalizeCaFingerprint(fingerprint);
  if (!pinned) {
    return { ok: false, reason: 'A SHA-256 certificate fingerprint (64 hex characters) is required beside the trust anchor file.' };
  }
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(trimmed);
  } catch {
    return { ok: false, reason: 'The trust anchor file is not a readable X.509 certificate.' };
  }
  const actual = certificate.fingerprint256.replace(/:/g, '').toLowerCase();
  if (actual !== pinned) {
    return { ok: false, reason: `The trust anchor's SHA-256 fingerprint ${actual} does not match the pinned ${pinned}. Check the file before changing the pin.` };
  }
  if (!certificate.ca) {
    return { ok: false, reason: 'The trust anchor is not a certificate authority (basicConstraints CA:TRUE); only a root CA can be trusted this way.' };
  }
  if (!certificate.checkIssued(certificate) || !certificate.verify(certificate.publicKey)) {
    return { ok: false, reason: 'The trust anchor is not a self-signed root certificate (it may be an intermediate). Export the root itself.' };
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs) || nowMs < Date.parse(certificate.validFrom) || nowMs > Date.parse(certificate.validTo)) {
    return { ok: false, reason: `The trust anchor is outside its validity period (${certificate.validFrom} to ${certificate.validTo}).` };
  }
  const pem = `${certificate.toString().replace(/\r\n/g, '\n').trim()}\n`;
  // Re-derive the fingerprint from the normalised text: what is sent must be what was checked.
  const der = Buffer.from(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''), 'base64');
  if (createHash('sha256').update(der).digest('hex') !== pinned) {
    return { ok: false, reason: 'The trust anchor changed while it was being normalised; nothing was trusted.' };
  }
  return {
    ok: true,
    anchor: {
      pem,
      pemBase64: Buffer.from(pem, 'utf8').toString('base64'),
      fingerprintSha256: pinned,
      subject: certificate.subject.replace(/\n/g, ', '),
      validTo: certificate.validTo,
    },
  };
}

export interface LocalCiTrustAnchorSettings {
  /** `atlasmind.ci.localRunner.additionalCaFile` */
  file: string;
  /** `atlasmind.ci.localRunner.additionalCaSha256` */
  sha256: string;
}

/** Read and validate the configured anchor. Neither setting means none; one without the other is refused. */
export async function readLocalCiTrustAnchor(
  settings: LocalCiTrustAnchorSettings,
  options: { now?: Date; read?: (file: string) => Promise<string> } = {},
): Promise<{ ok: true; anchor: LocalCiTrustAnchor | undefined } | { ok: false; reason: string }> {
  const file = settings.file.trim();
  const pin = settings.sha256.trim();
  if (!file && !pin) {
    return { ok: true, anchor: undefined };
  }
  if (!file || !pin) {
    return { ok: false, reason: 'Set atlasmind.ci.localRunner.additionalCaFile and additionalCaSha256 together, or neither.' };
  }
  if (!path.isAbsolute(file) || /[\u0000-\u001f]/.test(file)) {
    return { ok: false, reason: 'atlasmind.ci.localRunner.additionalCaFile must be an absolute path to the public root certificate.' };
  }
  let text: string;
  try {
    text = await (options.read ?? (target => readFile(target, 'utf8')))(file);
  } catch {
    return { ok: false, reason: `The trust anchor file ${file} could not be read.` };
  }
  return validateLocalCiTrustAnchor(text, pin, options.now ?? new Date());
}

/**
 * `docker build` / `docker buildx build` arguments that hand the anchor to a
 * build as a BuildKit secret. A Dockerfile uses it for one step and keeps
 * verification on, for example:
 *
 *   RUN --mount=type=secret,id=atlasmind_ca,target=/run/secrets/atlasmind_ca.pem \
 *       NODE_EXTRA_CA_CERTS=/run/secrets/atlasmind_ca.pem npm ci
 *
 * The secret is never a `--build-arg` (which is recorded in the image history)
 * and never part of the build context (which `COPY` would bake into a layer).
 */
export function localCiCaBuildSecretArgs(caFile: string): string[] {
  if (!path.isAbsolute(caFile)) {
    throw new Error('The trust anchor passed to a build must be an absolute path.');
  }
  if (/[,"'\u0000-\u001f]/.test(caFile)) {
    throw new Error('The trust anchor path contains a character that would change the meaning of --secret.');
  }
  return ['--secret', `id=${LOCAL_CI_CA_BUILD_SECRET_ID},src=${caFile}`];
}
