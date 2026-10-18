import * as vscode from 'vscode';
import {
  assessBrief,
  PROJECT_BRIEF_FILENAME,
  readBriefDocumentBody,
  renderBriefDocument,
} from '../core/projectBrief.js';

/**
 * Asking for the project in the owner's own words, at the start.
 *
 * `projectBrief` keeps the brief verbatim and grounds everything read out of
 * it; this is the part that makes sure somebody is *asked*. The question used
 * to live only on an empty Ideation board, which nobody opens first — so the
 * one fact AtlasMind cannot detect was the one it never requested. Now
 * `/bootstrap` asks it before any specific question, and the Get Started
 * walkthrough has a step for it (`atlasmind.describeProject`).
 *
 * Four rules.
 *
 * **Skippable, and a skip is recorded as a skip.** Blank or Escape is "not
 * given", and nothing is filled in on the owner's behalf — not from the
 * product summary, not from the README, not from a model. A brief somebody did
 * not write is not a brief.
 *
 * **Kept exactly as typed.** The answer goes through `assessBrief`, which only
 * strips control characters and caps the length, and is written with
 * `renderBriefDocument` to the one path every surface reads.
 *
 * **A thin answer is refused with the reason, and can be added to.** The input
 * comes back holding what was typed, with the refusal as its prompt; after
 * three thin answers it stops asking and records "not given" rather than
 * keeping somebody in a loop.
 *
 * **Never overwritten without a confirmation that says so.** Bootstrap writes
 * create-only; the command asks before replacing, naming what is lost.
 */

export type BriefPromptOutcome =
  | { status: 'given'; text: string }
  | { status: 'not-given'; reason: 'skipped' | 'too-thin' };

const BRIEF_PROMPT_TITLE = 'The project in your own words';
const BRIEF_PROMPT_TEXT = 'Who is it for, what should it do, and what should be true once it works? A couple of sentences is enough. Saved exactly as you write it. Leave blank or press Escape to skip.';
const BRIEF_PROMPT_PLACEHOLDER = 'A booking tool for dog groomers working on their own. They lose track of appointments taken by text. It works when a groomer sees their whole week in one place.';
const MAX_BRIEF_ATTEMPTS = 3;

/** Ask for the brief. Writes nothing. */
export async function promptForProjectBrief(): Promise<BriefPromptOutcome> {
  let prompt = BRIEF_PROMPT_TEXT;
  let value: string | undefined;
  for (let attempt = 0; attempt < MAX_BRIEF_ATTEMPTS; attempt += 1) {
    const raw = await vscode.window.showInputBox({
      title: BRIEF_PROMPT_TITLE,
      prompt,
      placeHolder: BRIEF_PROMPT_PLACEHOLDER,
      ignoreFocusOut: true,
      ...(value === undefined ? {} : { value }),
    });
    if (typeof raw !== 'string' || raw.trim() === '') {
      return { status: 'not-given', reason: 'skipped' };
    }
    const assessment = assessBrief(raw);
    if (assessment.usable) {
      return { status: 'given', text: assessment.text };
    }
    // Asked again holding what was typed, so adding to it is one keystroke
    // away rather than a retype.
    value = raw;
    prompt = `${assessment.refusal ?? 'That cannot be read into anything yet.'} Add to it, or clear it to skip.`;
  }
  return { status: 'not-given', reason: 'too-thin' };
}

function projectBriefUri(ssotRoot: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(ssotRoot, PROJECT_BRIEF_FILENAME);
}

/** The brief on disk, with its header removed; `undefined` when there is none. */
export async function readProjectBriefAt(ssotRoot: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(projectBriefUri(ssotRoot));
    return readBriefDocumentBody(Buffer.from(bytes).toString('utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Write the brief.
 *
 * `replace: false` is create-only: a brief already on disk is kept and the
 * result says so. Only a caller that has confirmed the replacement with the
 * owner passes `true`.
 */
export async function writeProjectBriefAt(
  ssotRoot: vscode.Uri,
  text: string,
  now: Date,
  options: { replace: boolean },
): Promise<'written' | 'kept-existing'> {
  const uri = projectBriefUri(ssotRoot);
  if (!options.replace && (await readProjectBriefAt(ssotRoot)) !== undefined) {
    return 'kept-existing';
  }
  await vscode.workspace.fs.createDirectory(ssotRoot);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(renderBriefDocument(text, now.toISOString()), 'utf-8'));
  return 'written';
}

/**
 * `AtlasMind: Describe the Project in Your Own Words` — the walkthrough's
 * step, and anybody's way back to the question later.
 *
 * One act: it writes the brief and stops. Reading it into cards is offered as
 * the next step, on the Ideation board, where the chain shows what each step
 * would write before it writes it.
 */
export async function describeProjectInOwnWords(
  workspaceRoot: vscode.Uri,
  ssotRelPath: string,
  now: () => Date = () => new Date(),
): Promise<'written' | 'replaced' | 'not-given' | 'kept'> {
  const ssotRoot = vscode.Uri.joinPath(workspaceRoot, ssotRelPath);
  const existing = await readProjectBriefAt(ssotRoot);
  if (existing !== undefined) {
    const choice = await vscode.window.showWarningMessage(
      'A project brief is already recorded.',
      {
        modal: true,
        detail: 'It is your own description of the project. Replacing it cannot be undone from here — the previous text is only recoverable from git.',
      },
      'Open it',
      'Replace it',
    );
    if (choice === 'Open it') {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(projectBriefUri(ssotRoot)));
      return 'kept';
    }
    if (choice !== 'Replace it') {
      return 'kept';
    }
  }

  const outcome = await promptForProjectBrief();
  if (outcome.status === 'not-given') {
    void vscode.window.showInformationMessage(
      outcome.reason === 'too-thin'
        ? 'Nothing was saved: the brief stayed too short to read anything out of. Say who it is for and what should be true once it works.'
        : 'Nothing was saved. The brief is recorded as not given, and nothing is filled in for you.',
    );
    return 'not-given';
  }

  await writeProjectBriefAt(ssotRoot, outcome.text, now(), { replace: existing !== undefined });
  const next = await vscode.window.showInformationMessage(
    `Saved to ${ssotRelPath}/${PROJECT_BRIEF_FILENAME}, exactly as written. Reading it into cards is the next step, and it is a separate one.`,
    'Continue on the Ideation board',
  );
  if (next === 'Continue on the Ideation board') {
    await vscode.commands.executeCommand('atlasmind.openProjectIdeation');
  }
  return existing === undefined ? 'written' : 'replaced';
}
