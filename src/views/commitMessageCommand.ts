import * as vscode from 'vscode';

import type { AtlasMindContext } from '../extension.js';
import {
  COMMIT_MESSAGE_SYSTEM_PROMPT,
  buildCommitDraftRequest,
  cleanCommitMessage,
  describeCommitDraftRefusal,
} from '../core/commitMessageDraft.js';
import { findRepositoryFor, getGitApi } from './gitExtensionApi.js';

/**
 * Write a commit message into the Source Control box.
 *
 * Sits in the SCM title bar beside the other actions there, because that is
 * where somebody is when they want one — asking them to open a chat panel,
 * describe their own change and paste the answer back is the workflow this
 * replaces.
 *
 * **It writes to the input box and stops.** Nothing is committed, nothing is
 * staged, and an existing message is replaced only after asking. The box is a
 * text field the operator reads and presses a button on, which is the gate;
 * adding a confirmation dialog in front of a suggestion would be friction
 * without a decision behind it.
 *
 * Every failure is named. An absent Git extension, no repository, nothing
 * staged, a diff that could not be read and an empty reply each say which —
 * "could not generate a commit message" would leave somebody re-running it.
 */
export async function generateCommitMessage(atlas: AtlasMindContext): Promise<void> {
  const api = await getGitApi();
  if (!api) {
    void vscode.window.showWarningMessage(
      'AtlasMind needs the built-in Git extension to read your staged changes, and it is not available here.',
    );
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const repository = findRepositoryFor(api, workspaceRoot);
  if (!repository) {
    void vscode.window.showWarningMessage('No Git repository is open, so there are no staged changes to describe.');
    return;
  }

  if (!repository.inputBox || typeof repository.diff !== 'function') {
    void vscode.window.showWarningMessage(
      'The Git extension did not expose the commit box or the staged diff, so AtlasMind cannot fill it in.',
    );
    return;
  }

  // Asked before the model call, not after: spending on a draft the operator
  // then declines to have written is worse than one extra question.
  const existing = repository.inputBox.value.trim();
  if (existing.length > 0) {
    const replace = await vscode.window.showWarningMessage(
      'Replace the commit message you have already written?',
      { modal: true, detail: `Current message:\n\n${existing.slice(0, 400)}${existing.length > 400 ? '…' : ''}` },
      'Replace it',
    );
    if (replace !== 'Replace it') {
      return;
    }
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.SourceControl, title: 'AtlasMind: writing a commit message…' },
    async () => {
      let diff: string;
      try {
        diff = await repository.diff!(true);
      } catch {
        void vscode.window.showWarningMessage(describeCommitDraftRefusal('diff-unreadable'));
        return;
      }

      const request = buildCommitDraftRequest(diff);
      if ('refused' in request) {
        void vscode.window.showInformationMessage(describeCommitDraftRefusal(request.refused));
        return;
      }

      let reply: string;
      try {
        reply = await atlas.orchestrator.draftCommitMessage(COMMIT_MESSAGE_SYSTEM_PROMPT, request.prompt);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `AtlasMind could not draft a commit message: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }

      const message = cleanCommitMessage(reply);
      if (typeof message !== 'string') {
        void vscode.window.showWarningMessage(describeCommitDraftRefusal(message.refused));
        return;
      }

      repository.inputBox!.value = message;

      if (request.truncated) {
        // Said rather than left to be discovered: a message describing half a
        // change reads exactly like one describing all of it.
        void vscode.window.showInformationMessage(
          'The staged diff was too large to send in full, so this message describes the first part of it. Check it covers everything before committing.',
        );
      }
    },
  );
}
