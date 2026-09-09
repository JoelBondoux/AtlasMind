/**
 * Import declared absence from a calendar file the user chose.
 *
 * `rotaImport` holds every rule — what counts as an absence, why `DTEND` is
 * read one day short, why a date that needs a guessed timezone is refused. This
 * is the thin half: pick a person, pick a file, show what would be written, and
 * write it only if they agree.
 *
 * Three properties live here rather than in the module.
 *
 * **The person is chosen before the file is read**, so the order of the dialogs
 * says what the import is about to do. Picking a file first and then being
 * asked whose it is invites the answer "whoever it looks like", which is the
 * one thing the module refuses to work out.
 *
 * **The confirmation shows the entries themselves**, not a count. A dialog
 * cannot show somebody what is composed after they agree, and the interesting
 * number in an import like this is the one that was *not* imported — a feed of
 * shifts that yields two absences is the rule working, and it should look like
 * it worked rather than like the file was nearly empty.
 *
 * **The file is read from disk and nothing is fetched.** A calendar feed URL is
 * a credential; the person downloads the file themselves. There is no URL entry
 * box here on purpose.
 */

import * as vscode from 'vscode';
import { readFile, stat } from 'node:fs/promises';
import type { ProjectDirectorConfig } from '../types.js';
import {
  MAX_ICS_BYTES,
  ROTA_SOURCES,
  applyRotaImport,
  planRotaImport,
} from '../core/rotaImport.js';

export interface RotaImportDeps {
  /** The roster as it stands. */
  config: () => ProjectDirectorConfig | undefined;
  /** Persist an updated roster. The same path every other Director edit takes. */
  save: (config: ProjectDirectorConfig) => Promise<void>;
}

/** Run the import, start to finish. Returns quietly when anything is cancelled. */
export async function importRotaFromCalendar(deps: RotaImportDeps): Promise<void> {
  const config = deps.config();
  if (!config) {
    void vscode.window.showWarningMessage(
      'There is no Project Director roster yet. Open the Project Dashboard → Director and add the people on the team first.',
    );
    return;
  }
  const members = config.teamMembers;
  if (members.length === 0) {
    void vscode.window.showWarningMessage(
      'Nobody is on the delivery team yet. Add a teammate on the Director page, then import their calendar.',
    );
    return;
  }

  // Whose calendar this is, asked first and answered by a person.
  const picked = await vscode.window.showQuickPick(
    members.map(member => ({
      label: config.contacts.find(contact => contact.id === member.contactId)?.name ?? member.contactId,
      description: member.discipline,
      contactId: member.contactId,
    })),
    {
      title: 'Import absence from a calendar',
      placeHolder: 'Whose calendar is this? It is never worked out from the file.',
    },
  );
  if (!picked) {
    return;
  }

  const guidance = ROTA_SOURCES
    .map(source => `${source.name}: ${source.export}`)
    .join('\n\n');
  const chosen = await vscode.window.showOpenDialog({
    title: `Calendar file for ${picked.label}`,
    canSelectMany: false,
    openLabel: 'Read this calendar',
    filters: { iCalendar: ['ics', 'ical', 'ifb'] },
  });
  const file = chosen?.[0];
  if (!file) {
    void vscode.window.showInformationMessage(`No file chosen. How to export one:\n\n${guidance}`, { modal: true });
    return;
  }

  let text: string;
  try {
    const info = await stat(file.fsPath);
    if (info.size > MAX_ICS_BYTES) {
      // Refused rather than truncated: half a calendar read as a whole one
      // would report absence that stops at an arbitrary point.
      void vscode.window.showWarningMessage(
        `That file is ${Math.round(info.size / 1024 / 1024)} MB, past the ${MAX_ICS_BYTES / 1024 / 1024} MB limit. Export a narrower date range rather than the whole calendar.`,
      );
      return;
    }
    text = await readFile(file.fsPath, 'utf8');
  } catch (error) {
    void vscode.window.showWarningMessage(
      `That file could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const existing = config.rota ?? [];
  const plan = planRotaImport({ text, contactId: picked.contactId, existing });

  if (plan.refusal) {
    // The refusal is the finding, and it says which of two things to change.
    void vscode.window.showWarningMessage(plan.refusal, { modal: true, detail: guidance });
    return;
  }
  if (plan.entries.length === 0) {
    void vscode.window.showInformationMessage(plan.summary, { modal: true });
    return;
  }

  const confirmed = await vscode.window.showInformationMessage(
    `Record ${plan.entries.length} absence${plan.entries.length === 1 ? '' : 's'} for ${picked.label}?`,
    { modal: true, detail: buildImportDetail(plan.summary, plan.entries) },
    'Record them',
  );
  if (confirmed !== 'Record them') {
    return;
  }

  await deps.save({ ...config, rota: applyRotaImport(existing, plan) });
  void vscode.window.showInformationMessage(
    `Recorded. The workload reading on the Director page uses these; nothing else changed.`,
  );
}

function buildImportDetail(
  summary: string,
  entries: ReadonlyArray<{ from: string; to: string; note?: string }>,
): string {
  const lines = [summary, ''];
  // Every entry, not a sample. These become a committed record of when a named
  // person is away, so the list somebody agrees to is the list that is written.
  for (const entry of entries.slice(0, 40)) {
    lines.push(`  ${entry.from} to ${entry.to}${entry.note ? ` — ${entry.note}` : ''}`);
  }
  if (entries.length > 40) {
    lines.push(`  …and ${entries.length - 40} more.`);
  }
  lines.push('');
  lines.push('Absence you typed by hand is kept. Nothing is deleted, and re-importing an amended calendar updates these rather than adding duplicates.');
  return lines.join('\n');
}
