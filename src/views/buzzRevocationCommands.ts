/**
 * Revoke and restore a Buzz identity in AtlasMind — the user-facing half of
 * `src/core/buzzRevocation.ts`.
 *
 * Revoking writes the user's own settings (never a workspace's: a revocation
 * the repository holds is the repository's, and the union rule already makes
 * it win), and says plainly what it does not do. AtlasMind holds no owner key,
 * so it cannot revoke an identity in Buzz; it shows the exact command the
 * owner runs with their own key, and is honest that an archive hides an
 * identity rather than locking it out.
 */

import * as vscode from 'vscode';
import { describeIdentity, type BuzzIdentity } from '../core/buzzDirectory.js';
import { readBuzzRevocationSettings } from '../core/buzzInboundService.js';
import {
  BUZZ_REVOCATION_REASONS,
  buzzArchiveCommand,
  withRevocation,
  withoutRevocation,
  type BuzzRevocationReason,
} from '../core/buzzRevocation.js';
import { normalizeBuzzPubkey } from '../core/buzzSigner.js';

const REASON_DESCRIPTIONS: Record<BuzzRevocationReason, string> = {
  compromised: 'Its secret key may have leaked',
  rotated: 'It was replaced by a new key',
  retired: 'It is no longer used',
  'bot-rebuilt': 'The agent was rebuilt under another identity',
  'left-organization': 'Its person left the organisation',
  spam: 'It posts unwanted messages',
};

export interface BuzzRevocationCommandDeps {
  /** Identities seen this session, most recent first, with any verified owner. */
  listIdentities: () => BuzzIdentity[];
}

export function registerBuzzRevocationCommands(deps: BuzzRevocationCommandDeps): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('atlasmind.buzz.revokeIdentity', async () => revokeIdentity(deps)),
    vscode.commands.registerCommand('atlasmind.buzz.restoreIdentity', async () => restoreIdentity()),
  ];
}

async function revokeIdentity(deps: BuzzRevocationCommandDeps): Promise<void> {
  const revoked = readBuzzRevocationSettings().revoked;
  const identities = deps.listIdentities().filter(identity => !revoked.has(identity.pubkey));
  const PASTE = '$(key) Enter an npub or hex public key…';
  const picked = await vscode.window.showQuickPick(
    [
      ...identities.map(identity => ({
        label: describeIdentity(identity),
        description: identity.attestedBy ? `agent · authorised by ${identity.attestedBy.slice(0, 12)}…` : identity.pubkey.slice(0, 16),
        detail: identity.lastMessage,
        pubkey: identity.pubkey,
      })),
      { label: PASTE, description: '', detail: undefined, pubkey: '' },
    ],
    { title: 'Revoke a Buzz identity in AtlasMind', placeHolder: 'Identities seen this session, most recent first' },
  );
  if (!picked) {
    return;
  }
  let pubkey = picked.pubkey;
  if (!pubkey) {
    const typed = await vscode.window.showInputBox({
      title: 'Revoke a Buzz identity in AtlasMind',
      prompt: 'An npub or 64-character hex public key. Never paste an nsec here.',
      ignoreFocusOut: true,
      validateInput: value => {
        if (/^\s*nsec1/i.test(value)) {
          return 'That is a secret key. Do not paste it anywhere — treat it as exposed and revoke the public key it belongs to.';
        }
        return value.trim() === '' || normalizeBuzzPubkey(value) ? undefined : 'Not an npub or 64-character hex public key.';
      },
    });
    const normalized = typed ? normalizeBuzzPubkey(typed) : undefined;
    if (!normalized) {
      return;
    }
    pubkey = normalized;
  }

  const reasonPick = await vscode.window.showQuickPick(
    BUZZ_REVOCATION_REASONS.map(reason => ({ label: reason, description: REASON_DESCRIPTIONS[reason] })),
    { title: 'Why is it being revoked?' },
  );
  if (!reasonPick) {
    return;
  }
  const reason = reasonPick.label as BuzzRevocationReason;
  const archive = buzzArchiveCommand(pubkey, reason);
  const name = identities.find(identity => identity.pubkey === pubkey);
  const label = name ? describeIdentity(name) : `${pubkey.slice(0, 12)}…`;

  const COPY = 'Revoke, and copy the Buzz command';
  const choice = await vscode.window.showWarningMessage(
    `Revoke ${label} in AtlasMind?`,
    {
      modal: true,
      detail: `AtlasMind will ignore messages from ${label}, and from any agent it authorised, and will not turn them into work. `
        + 'This does not revoke it in Buzz — AtlasMind holds no owner key.\n\n'
        + (archive
          ? `To revoke it in Buzz too, its owner runs this with their own key:\n\n${archive.display}\n\n`
            + 'Archiving hides the identity on the relay, and an archived identity can un-archive itself. '
            + 'To lock it out, the relay owner also removes it from the relay\'s members.'
          : ''),
    },
    'Revoke in AtlasMind',
    COPY,
  );
  if (!choice) {
    return;
  }
  const cfg = vscode.workspace.getConfiguration('atlasmind');
  const current = cfg.inspect<unknown>('buzz.revokedIdentities')?.globalValue;
  await cfg.update(
    'buzz.revokedIdentities',
    withRevocation(current, { pubkey, reason, revokedAt: new Date().toISOString().slice(0, 10) }),
    vscode.ConfigurationTarget.Global,
  );
  if (choice === COPY && archive) {
    await vscode.env.clipboard.writeText(archive.display);
  }
  void vscode.window.showInformationMessage(
    `${label} is revoked in AtlasMind.${choice === COPY && archive ? ' The Buzz archive command is on the clipboard for its owner.' : ''}`,
  );
}

async function restoreIdentity(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('atlasmind');
  const inspected = cfg.inspect<unknown>('buzz.revokedIdentities');
  const all = readBuzzRevocationSettings().revoked;
  if (all.size === 0) {
    void vscode.window.showInformationMessage('No Buzz identity is revoked in AtlasMind.');
    return;
  }
  const workspaceHeld = new Set([
    ...readBuzzRevocationSettingsFrom([inspected?.workspaceValue, inspected?.workspaceFolderValue]),
  ]);
  const picked = await vscode.window.showQuickPick(
    [...all.values()].map(entry => ({
      label: `${entry.pubkey.slice(0, 16)}…`,
      description: `${entry.reason}${entry.revokedAt ? ` · ${entry.revokedAt}` : ''}${workspaceHeld.has(entry.pubkey) ? ' · also revoked by this workspace' : ''}`,
      pubkey: entry.pubkey,
    })),
    { title: 'Trust a revoked Buzz identity again' },
  );
  if (!picked) {
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Trust ${picked.label} again?`,
    { modal: true, detail: 'AtlasMind will turn its messages into work again. If its key was compromised, restore only a new key, not this one.' },
    'Trust again',
  );
  if (confirm !== 'Trust again') {
    return;
  }
  await cfg.update('buzz.revokedIdentities', withoutRevocation(inspected?.globalValue, picked.pubkey), vscode.ConfigurationTarget.Global);
  if (workspaceHeld.has(picked.pubkey)) {
    void vscode.window.showWarningMessage(
      'Removed from your settings, but this workspace\'s settings also revoke it, so it stays revoked here. A revocation anywhere wins.',
    );
  }
}

function readBuzzRevocationSettingsFrom(values: unknown[]): string[] {
  return values.flatMap(value => (Array.isArray(value) ? value : []))
    .map(entry => (typeof entry === 'string' ? entry : (entry as Record<string, unknown> | null)?.['pubkey']))
    .filter((raw): raw is string => typeof raw === 'string')
    .map(raw => normalizeBuzzPubkey(raw))
    .filter((pubkey): pubkey is string => pubkey !== undefined);
}
