/**
 * Bringing a client's feedback back into the project.
 *
 * The client leaves comments in their own browser, on the site as it is hosted
 * on their own staging environment, and returns them either as a downloaded file
 * or through a webhook the team already owns. This is the file half: read what
 * they sent, run it through the same sanitizer the workspace file uses, and
 * report exactly what happened to each comment.
 *
 * The import is deliberately talkative. A comment that names an element which no
 * longer exists is *kept and flagged*, not dropped — the likeliest cause is that
 * somebody deleted the thing the client was asking about, which is precisely the
 * feedback that must not vanish. Reporting a bare count would hide it.
 */

import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { WebsiteWorkspaceManager } from '../core/websiteWorkspaceManager.js';
import { WebsiteReviewManager } from '../core/websiteContentManager.js';
import { describeImport, importReviewFeedback } from '../core/websiteReviewBundle.js';
import { WEBSITE_REVIEW_SUMMARY_SSOT_PATH } from '../core/websiteReviewComments.js';

/** Anything larger is not a feedback file. */
const MAX_FEEDBACK_BYTES = 2 * 1024 * 1024;

export async function importWebsiteFeedbackFile(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage('Open a workspace folder before importing client feedback.');
    return;
  }
  if (!vscode.workspace.getConfiguration('atlasmind').get<boolean>('website.review.enabled', false)) {
    void vscode.window.showErrorMessage(
      'Client review is off. Turn on atlasmind.website.review.enabled to record feedback.',
    );
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Import feedback',
    filters: { 'Feedback export': ['json'] },
    title: 'Choose the feedback file your client sent back',
  });
  const chosen = picked?.[0];
  if (!chosen) {
    return;
  }

  let parsed: unknown;
  try {
    const raw = await readFile(chosen.fsPath, 'utf8');
    if (raw.length > MAX_FEEDBACK_BYTES) {
      void vscode.window.showErrorMessage('That file is too large to be a feedback export.');
      return;
    }
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    // A file we cannot read is reported as such rather than silently importing
    // nothing, which would look like "the client sent no feedback".
    void vscode.window.showErrorMessage(
      `Could not read that feedback file: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const workspace = new WebsiteWorkspaceManager(workspaceRoot).load();
  const reviewManager = new WebsiteReviewManager(workspaceRoot);
  const result = importReviewFeedback(reviewManager.load(), parsed, workspace.pages);

  if (result.imported.length === 0 && result.duplicates === 0) {
    void vscode.window.showWarningMessage(describeImport(result));
    return;
  }

  await reviewManager.save(result.record, workspace.pages);

  const message = describeImport(result);
  if (result.unresolved.length > 0) {
    // Named individually rather than counted: "three comments refer to something
    // missing" is not actionable, and one of them is probably the important one.
    const detail = result.unresolved.map(item => `  • ${item.commentId} ${item.reason}`).join('\n');
    void vscode.window.showWarningMessage(`${message}\n\n${detail}`, { modal: false });
  } else {
    void vscode.window.showInformationMessage(message);
  }

  const open = await vscode.window.showInformationMessage(
    'Open the review summary?',
    'Open',
  );
  if (open === 'Open') {
    await vscode.window.showTextDocument(
      vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders![0]!.uri,
        ...WEBSITE_REVIEW_SUMMARY_SSOT_PATH.split('/'),
      ),
    );
  }
}
