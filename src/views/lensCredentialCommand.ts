/**
 * Storing and clearing the credentials the live lenses use.
 *
 * The connection string never appears in the committed declaration file, so
 * there has to be somewhere to put it, and this is that somewhere: VS Code
 * SecretStorage, namespaced under {@link LENS_SECRET_PREFIX}, entered through a
 * password-style box.
 *
 * Four decisions, all about what is *not* done with the value:
 *
 * **It is never echoed.** `password: true` on the input box, no logging, no
 * output channel, and the confirmation afterwards names the key and the parsed
 * host — never the string.
 *
 * **It is validated by parsing, not by trying it.** A mistyped connection string
 * fails here, where the user can still see what they pasted, rather than at
 * probe time where the only safe error message is a vague one. Validating by
 * *connecting* would mean a stray keystroke opens a socket to whatever host the
 * typo produced.
 *
 * **The parsed summary is shown back, because that is the check that matters.**
 * Host, database, user and TLS mode. If somebody has pasted their production
 * string into the staging endpoint, this is the moment they can see it — and it
 * is the same summary the probe confirmation will show later, so the two cannot
 * disagree.
 *
 * **A read-only role is recommended every single time.** AtlasMind cannot verify
 * what a credential may do; the constant queries and the read-only transaction
 * are its own guarantees, and least privilege is the one that does not depend on
 * AtlasMind being correct. Saying so once in the docs and never at the moment of
 * decision would be saying it where nobody is listening.
 */

import * as vscode from 'vscode';

import {
  describeConnection,
  lensSecretKey,
  READ_ONLY_ROLE_GUIDANCE,
  summarizeConnectionString,
} from '../core/lensCredentials.js';
import {
  findLensEndpoint,
  LENS_ENDPOINT_FILE,
  normalizeLensEndpointFile,
} from '../core/lensEndpoints.js';
import { dialectOfKind } from '../core/lensProbePolicy.js';
import type { LensEndpointDeclaration } from '../types.js';

interface CredentialPick extends vscode.QuickPickItem {
  endpoint: LensEndpointDeclaration;
}

/** Store the credential for one declared endpoint. */
export async function storeLensCredential(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showInformationMessage('Open a workspace before storing an AtlasMind Lens credential.');
    return;
  }

  const endpoints = await readCredentialEndpoints(folder);
  if (endpoints === undefined) {
    return;
  }
  if (endpoints.length === 0) {
    void vscode.window.showInformationMessage(
      `No endpoint in ${LENS_ENDPOINT_FILE} declares a \`secretRef\`. Add one first — the file names the `
      + 'key; this command fills it in.',
    );
    return;
  }

  const picked = await vscode.window.showQuickPick<CredentialPick>(
    await Promise.all(endpoints.map(async endpoint => ({
      label: endpoint.label,
      description: `${endpoint.kind} · ${endpoint.stage}`,
      detail: await describeStoredState(context, endpoint),
      endpoint,
    }))),
    {
      title: 'AtlasMind Lens — store a credential',
      placeHolder: 'The value goes to the OS keychain, never to the repository',
      matchOnDescription: true,
    },
  );
  if (!picked) {
    return;
  }

  const endpoint = findLensEndpoint({ version: 1, endpoints }, picked.endpoint.id);
  if (!endpoint?.secretRef) {
    return;
  }
  const key = lensSecretKey(endpoint.secretRef);
  if (!key) {
    void vscode.window.showWarningMessage(
      `\`${endpoint.secretRef}\` is not a usable secret name. Use letters, digits, dots, dashes and `
      + 'underscores only.',
    );
    return;
  }

  const dialect = dialectOfKind(endpoint.kind);
  const value = await vscode.window.showInputBox({
    title: `Credential for ${endpoint.label}`,
    prompt: dialect
      ? `Paste the ${dialect} connection string. ${READ_ONLY_ROLE_GUIDANCE}`
      : `Paste the token or key for this endpoint. ${READ_ONLY_ROLE_GUIDANCE}`,
    // Never echoed, and VS Code keeps it out of the input history.
    password: true,
    ignoreFocusOut: true,
    validateInput: raw => {
      if (raw.trim() === '') {
        return 'Enter a value, or press Escape to cancel.';
      }
      if (dialect && !summarizeConnectionString(raw, dialect)) {
        // Validated by parsing, never by connecting: a stray keystroke must not
        // open a socket to whatever host the typo produced.
        return `That does not parse as a ${dialect} connection string (expected \`${dialect}://…\`).`;
      }
      return undefined;
    },
  });
  if (value === undefined) {
    return;
  }

  await context.secrets.store(key, value);

  // The summary is the check that matters: if somebody has pasted production
  // into the staging endpoint, this is where they see it.
  const summary = dialect ? summarizeConnectionString(value, dialect) : undefined;
  const detail = summary ? ` → ${describeConnection(summary)}` : '';
  if (summary?.tls === 'disabled') {
    void vscode.window.showWarningMessage(
      `Stored for ${endpoint.label}${detail}. This connection string disables TLS, so the credential and `
      + 'everything read will cross the network in the clear.',
    );
    return;
  }
  void vscode.window.showInformationMessage(
    `Stored for ${endpoint.label}${detail}. ${READ_ONLY_ROLE_GUIDANCE}`,
  );
}

/** Remove a stored credential. */
export async function clearLensCredential(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return;
  }
  const endpoints = await readCredentialEndpoints(folder);
  if (!endpoints?.length) {
    void vscode.window.showInformationMessage(`No endpoint in ${LENS_ENDPOINT_FILE} declares a \`secretRef\`.`);
    return;
  }
  const picked = await vscode.window.showQuickPick<CredentialPick>(
    await Promise.all(endpoints.map(async endpoint => ({
      label: endpoint.label,
      description: endpoint.secretRef,
      detail: await describeStoredState(context, endpoint),
      endpoint,
    }))),
    { title: 'AtlasMind Lens — clear a stored credential', placeHolder: 'Choose which credential to remove' },
  );
  if (!picked?.endpoint.secretRef) {
    return;
  }
  const key = lensSecretKey(picked.endpoint.secretRef);
  if (!key) {
    return;
  }
  await context.secrets.delete(key);
  void vscode.window.showInformationMessage(
    `Cleared the stored credential for ${picked.endpoint.label}. The endpoint stays declared, and its next `
    + 'probe will report that nothing is stored.',
  );
}

/** Resolve an endpoint's credential. The one reader; nothing else touches the store. */
export async function resolveLensEndpointSecret(
  context: vscode.ExtensionContext,
  secretRef: string,
): Promise<string | undefined> {
  const key = lensSecretKey(secretRef);
  return key ? context.secrets.get(key) : undefined;
}

async function describeStoredState(
  context: vscode.ExtensionContext,
  endpoint: LensEndpointDeclaration,
): Promise<string> {
  if (!endpoint.secretRef) {
    return 'No secretRef declared';
  }
  const key = lensSecretKey(endpoint.secretRef);
  if (!key) {
    return `\`${endpoint.secretRef}\` is not a usable secret name`;
  }
  const stored = await context.secrets.get(key);
  if (stored === undefined) {
    return `Nothing stored under \`${endpoint.secretRef}\``;
  }
  const dialect = dialectOfKind(endpoint.kind);
  const summary = dialect ? summarizeConnectionString(stored, dialect) : undefined;
  // Only ever the parsed summary — never a prefix, a length, or a masked
  // rendering of the value, all of which leak something about it.
  return summary ? `Stored · ${describeConnection(summary)}` : 'Stored';
}

async function readCredentialEndpoints(
  folder: vscode.WorkspaceFolder,
): Promise<LensEndpointDeclaration[] | undefined> {
  const uri = vscode.Uri.joinPath(folder.uri, ...LENS_ENDPOINT_FILE.split('/'));
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))) as unknown;
  } catch {
    void vscode.window.showInformationMessage(
      `${LENS_ENDPOINT_FILE} is missing or unreadable. Declare an endpoint before storing its credential.`,
    );
    return undefined;
  }
  const normalized = normalizeLensEndpointFile(raw);
  if (!normalized) {
    void vscode.window.showWarningMessage(`AtlasMind Lens refused ${LENS_ENDPOINT_FILE}.`);
    return undefined;
  }
  return normalized.file.endpoints.filter(endpoint => endpoint.secretRef);
}
