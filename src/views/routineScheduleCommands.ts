/**
 * The two commands for scheduled routines: manage them, and add the built-in
 * nightly dependency check.
 *
 * `routineSchedule`, `scheduledRoutinePolicy` and `RoutineScheduler` hold every
 * rule. This is the thin half, and three properties live here.
 *
 * **Ambient is said where the decision is made.** The picker's placeholder and
 * the approval dialog both say a scheduled routine runs only while the editor
 * is open. A schedule shown as "every day at 02:00" with no qualifier is a
 * promise an extension cannot keep.
 *
 * **The approval dialog shows the split the runner will act on** — what runs
 * unattended, where it stops and why — composed by
 * `describeUnattendedApproval` from the same plan. Approving records a
 * fingerprint of the steps as shown, so a step edited afterwards was not
 * approved.
 *
 * **The template is written create-only.** A `dependency-check.md` somebody has
 * already edited is opened, never overwritten.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import type { AtlasMindContext } from '../extension.js';
import type { RoutineScheduleEntry } from '../core/routineSchedule.js';
import { planRoutineExecution } from '../core/routineExecutionPolicy.js';
import {
  DEPENDENCY_CHECK_ROUTINE_FILE,
  DEPENDENCY_CHECK_ROUTINE_TEMPLATE,
  describeUnattendedApproval,
} from '../core/scheduledRoutinePolicy.js';

const STATE_LABELS: Readonly<Record<RoutineScheduleEntry['state'], string>> = {
  invalid: 'schedule unreadable',
  off: 'scheduling switched off',
  'not-approved': 'not approved',
  changed: 'changed since approved',
  blocked: 'blocked',
  running: 'running now',
  waiting: 'waiting for another run',
  due: 'due',
  current: 'scheduled',
};

const MASTER_SETTING = 'atlasmind.routines.scheduling.enabled';

function entryDetail(entry: RoutineScheduleEntry): string {
  const parts: string[] = [];
  if (entry.description) {
    parts.push(entry.description);
  }
  if (entry.blocker) {
    parts.push(entry.blocker);
  }
  if (entry.note) {
    parts.push(entry.note);
  }
  if (entry.lastRun) {
    const outcome = entry.lastOutcome === 'interrupted'
      ? 'Last run was interrupted — the editor closed or the host stopped before it finished.'
      : entry.lastRun.summary;
    parts.push(`${outcome}${entry.lastRun.reviewedAt ? ' (reviewed)' : ''}`);
  } else if (entry.nextWindowAt && entry.approvedAt) {
    parts.push(`Next: ${new Date(entry.nextWindowAt).toLocaleString()}.`);
  }
  return parts.join(' ');
}

export async function manageScheduledRoutines(atlas: AtlasMindContext): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const scheduler = atlas.routineScheduler;
  if (!root || !scheduler) {
    void vscode.window.showWarningMessage('Open a workspace folder to schedule its routines.');
    return;
  }
  await atlas.routineRegistry.reload(root).catch(() => undefined);
  const board = scheduler.board();

  if (board.entries.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      'No routine declares a schedule. Add `schedule: daily at 02:00` (or `weekly on monday at 09:00`, or '
        + '`every 6 hours`) to a routine in project_memory/routines/, or start from the nightly dependency check.',
      'Add the nightly dependency check',
    );
    if (choice === 'Add the nightly dependency check') {
      await addDependencyCheckRoutine(atlas);
    }
    return;
  }

  type EntryItem = vscode.QuickPickItem & { entry: RoutineScheduleEntry };
  const picked = await vscode.window.showQuickPick<EntryItem>(
    board.entries.map(entry => ({
      label: entry.routineName,
      description: `${entry.scheduleText} · ${STATE_LABELS[entry.state]}`,
      detail: entryDetail(entry),
      entry,
    })),
    {
      title: 'Scheduled routines',
      placeHolder: `${board.summary} Ambient, not background: nothing runs while the editor is closed.`,
      matchOnDetail: true,
    },
  );
  if (!picked) {
    return;
  }
  const entry = picked.entry;
  const routine = atlas.routineRegistry.get(entry.routineId);
  if (!routine) {
    return;
  }

  const actions: string[] = [];
  if (entry.state !== 'invalid' && (entry.approvedAt === undefined || entry.state === 'changed')) {
    actions.push(entry.state === 'changed' ? 'Review and approve again…' : 'Approve to run unattended…');
  }
  if (entry.approvedAt !== undefined) {
    actions.push('Stop scheduling it');
  }
  if (entry.lastRun && !entry.lastRun.reviewedAt) {
    actions.push('Mark the last report reviewed');
  }
  if (entry.lastRun?.worktreePath) {
    actions.push('Open the worktree it left');
  }
  actions.push('Open the routine file');
  if (!board.enabled) {
    actions.push('Open the scheduling setting');
  }

  const action = await vscode.window.showQuickPick(actions, { title: `${entry.routineName} — ${entryDetail(entry)}` });
  switch (action) {
    case 'Approve to run unattended…':
    case 'Review and approve again…': {
      // No values: nobody will be present to give `${message}` at 02:00.
      const plan = planRoutineExecution(routine, {});
      const detail = describeUnattendedApproval(routine, entry.description ?? entry.scheduleText, plan);
      if (plan.status === 'refused') {
        void vscode.window.showWarningMessage(detail, { modal: true });
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Approve "${routine.name}" to run on its own?`,
        { modal: true, detail },
        'Approve',
      );
      if (confirm !== 'Approve') {
        return;
      }
      await scheduler.approve(routine);
      void vscode.window.showInformationMessage(board.enabled
        ? `"${routine.name}" is approved. Its next window is the first one it runs in — a window before now was not missed.`
        : `"${routine.name}" is approved, and nothing will run until ${MASTER_SETTING} is switched on.`);
      return;
    }
    case 'Stop scheduling it':
      await scheduler.revoke(routine.id);
      void vscode.window.showInformationMessage(`"${routine.name}" will no longer run on its own. Its last report is kept.`);
      return;
    case 'Mark the last report reviewed':
      await scheduler.markReviewed(routine.id);
      return;
    case 'Open the worktree it left':
      if (entry.lastRun?.worktreePath) {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(entry.lastRun.worktreePath), { forceNewWindow: true });
      }
      return;
    case 'Open the routine file':
      if (routine.source) {
        await vscode.window.showTextDocument(vscode.Uri.file(routine.source));
      }
      return;
    case 'Open the scheduling setting':
      await vscode.commands.executeCommand('workbench.action.openSettings', MASTER_SETTING);
      return;
    default:
      return;
  }
}

/** Write the built-in template, create-only, and open it. */
export async function addDependencyCheckRoutine(atlas: AtlasMindContext): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    void vscode.window.showWarningMessage('Open a workspace folder to add a routine to it.');
    return;
  }
  const folder = path.join(root, 'project_memory', 'routines');
  const file = path.join(folder, DEPENDENCY_CHECK_ROUTINE_FILE);
  let created = true;
  try {
    await mkdir(folder, { recursive: true });
    // `wx`: fail if it exists. A routine somebody has edited is theirs.
    await writeFile(file, DEPENDENCY_CHECK_ROUTINE_TEMPLATE, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') {
      void vscode.window.showErrorMessage(`Could not add the routine: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    created = false;
  }
  await atlas.routineRegistry.reload(root).catch(() => undefined);
  atlas.routinesRefresh.fire();
  await vscode.window.showTextDocument(vscode.Uri.file(file));
  const choice = await vscode.window.showInformationMessage(
    created
      ? 'Added the nightly dependency check. It asks to run daily at 02:00; nothing runs until you approve it.'
      : `${DEPENDENCY_CHECK_ROUTINE_FILE} already exists, so it was opened rather than replaced.`,
    'Manage Scheduled Routines',
  );
  if (choice === 'Manage Scheduled Routines') {
    await manageScheduledRoutines(atlas);
  }
}
