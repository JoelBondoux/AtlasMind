import * as vscode from 'vscode';

import {
  buildLensStateMap,
  LENS_STATE_FILE,
  normalizeLensStateMachineFile,
} from '../core/lensStateMachine.js';
import type { LensStateMachineDeclaration } from '../core/lensStateMachine.js';
import { LensStatePanel } from './lensStatePanel.js';

interface StateMachinePick extends vscode.QuickPickItem {
  machine: LensStateMachineDeclaration;
}

interface WorkspacePick extends vscode.QuickPickItem {
  folder: vscode.WorkspaceFolder;
}

/** Open a model-free lifecycle map sourced from the selected workspace's explicit declaration file. */
export async function reviewWorkspaceStateLifecycle(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    void vscode.window.showInformationMessage('Open a workspace before reviewing an AtlasMind Lens state lifecycle.');
    return;
  }
  const folder = await chooseWorkspaceFolder(folders);
  if (!folder) return;

  const uri = vscode.Uri.joinPath(folder.uri, ...LENS_STATE_FILE.split('/'));
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))) as unknown;
  } catch (error) {
    void vscode.window.showInformationMessage(
      isFileNotFound(error)
        ? `Add ${LENS_STATE_FILE} to this workspace to declare lifecycle states and transitions.`
        : `AtlasMind Lens refused ${LENS_STATE_FILE} because it is malformed or unreadable.`,
    );
    return;
  }
  const file = normalizeLensStateMachineFile(raw);
  if (!file) {
    void vscode.window.showWarningMessage(`AtlasMind Lens refused invalid entries in ${LENS_STATE_FILE}.`);
    return;
  }
  if (file.machines.length === 0) {
    void vscode.window.showInformationMessage(`${LENS_STATE_FILE} does not declare any state machines.`);
    return;
  }
  const selected = await vscode.window.showQuickPick<StateMachinePick>(
    file.machines.map(machine => ({
      label: machine.label,
      description: machine.id,
      detail: `${machine.states.length} states · ${machine.transitions.length} transitions${machine.description ? ` · ${machine.description}` : ''}`,
      machine,
    })),
    {
      title: 'AtlasMind Lens — choose a state lifecycle',
      placeHolder: 'Choose an explicitly declared state machine',
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!selected) return;
  LensStatePanel.createOrShow(buildLensStateMap(selected.machine, { name: folder.name, index: folder.index }));
}

async function chooseWorkspaceFolder(
  folders: readonly vscode.WorkspaceFolder[],
): Promise<vscode.WorkspaceFolder | undefined> {
  if (folders.length === 1) return folders[0];
  const active = vscode.window.activeTextEditor
    ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
    : undefined;
  const selected = await vscode.window.showQuickPick<WorkspacePick>(
    folders.map(folder => ({
      label: folder.name,
      description: folder.uri.fsPath,
      picked: folder.index === active?.index && folder.name === active.name,
      folder,
    })),
    { title: 'AtlasMind Lens — choose a workspace', placeHolder: `Choose where to read ${LENS_STATE_FILE}` },
  );
  return selected?.folder;
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound' ||
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'FileNotFound';
}
