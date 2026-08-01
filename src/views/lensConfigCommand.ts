import * as vscode from 'vscode';

import {
  buildLensConfigResolutionMap,
  LENS_CONFIG_FILE,
  normalizeLensConfigFile,
} from '../core/lensConfigResolution.js';
import type { LensConfigSettingDeclaration } from '../core/lensConfigResolution.js';
import { LensConfigPanel } from './lensConfigPanel.js';

interface SettingPick extends vscode.QuickPickItem { setting: LensConfigSettingDeclaration }
interface WorkspacePick extends vscode.QuickPickItem { folder: vscode.WorkspaceFolder }

/** Select and explain one explicitly declared configuration precedence chain. */
export async function reviewWorkspaceConfiguration(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    void vscode.window.showInformationMessage('Open a workspace before reviewing AtlasMind Lens configuration resolution.');
    return;
  }
  const folder = await chooseWorkspaceFolder(folders);
  if (!folder) return;
  const uri = vscode.Uri.joinPath(folder.uri, ...LENS_CONFIG_FILE.split('/'));
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))) as unknown;
  } catch (error) {
    void vscode.window.showInformationMessage(
      isFileNotFound(error)
        ? `Add ${LENS_CONFIG_FILE} to this workspace to declare configuration precedence safely.`
        : `AtlasMind Lens refused ${LENS_CONFIG_FILE} because it is malformed or unreadable.`,
    );
    return;
  }
  const file = normalizeLensConfigFile(raw);
  if (!file) {
    void vscode.window.showWarningMessage(`AtlasMind Lens refused invalid entries in ${LENS_CONFIG_FILE}.`);
    return;
  }
  if (file.settings.length === 0) {
    void vscode.window.showInformationMessage(`${LENS_CONFIG_FILE} does not declare any settings.`);
    return;
  }
  const selected = await vscode.window.showQuickPick<SettingPick>(
    file.settings.map(setting => ({
      label: setting.label ?? setting.key,
      description: setting.key,
      detail: `${setting.sources.length} precedence sources · values ${setting.valuePolicy === 'masked' ? 'masked' : 'displayable'}`,
      setting,
    })),
    {
      title: 'AtlasMind Lens — choose a configuration setting',
      placeHolder: 'Choose an explicitly declared precedence chain',
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!selected) return;
  LensConfigPanel.createOrShow(buildLensConfigResolutionMap(selected.setting, { name: folder.name, index: folder.index }));
}

async function chooseWorkspaceFolder(folders: readonly vscode.WorkspaceFolder[]): Promise<vscode.WorkspaceFolder | undefined> {
  if (folders.length === 1) return folders[0];
  const active = vscode.window.activeTextEditor
    ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
    : undefined;
  const selected = await vscode.window.showQuickPick<WorkspacePick>(
    folders.map(folder => ({
      label: folder.name,
      description: folder.uri.fsPath,
      picked: folder.name === active?.name && folder.index === active.index,
      folder,
    })),
    { title: 'AtlasMind Lens — choose a workspace', placeHolder: `Choose where to read ${LENS_CONFIG_FILE}` },
  );
  return selected?.folder;
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound' ||
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'FileNotFound';
}
