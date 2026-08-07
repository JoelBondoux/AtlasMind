import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

import {
  buildLensDeclarationStarter,
  findLensDeclarationDescriptor,
  inspectLensDeclarations,
  isLensDeclarationKind,
  lensDeclarationStatusLabel,
  type LensDeclarationKind,
} from '../core/lensDeclarations.js';

interface LensSetupPick extends vscode.QuickPickItem {
  declarationKind: LensDeclarationKind | 'all' | 'guide';
}

interface WorkspacePick extends vscode.QuickPickItem {
  folder: vscode.WorkspaceFolder;
}

/** Register the one setup entry point shared by onboarding, Settings, Dashboard, and error messages. */
export function registerLensDeclarationSetup(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('atlasmind.lens.setupDeclarations', (kind?: unknown) =>
      setupWorkspaceLensDeclarations(isLensDeclarationKind(kind) ? kind : undefined)),
  );
}

/**
 * Explain why a declaration-backed Lens cannot use the active editor, then
 * provide the shortest safe route to a valid starter file.
 */
export async function showMissingLensDeclarationGuidance(
  kind: LensDeclarationKind,
  folder: vscode.WorkspaceFolder,
): Promise<void> {
  const descriptor = findLensDeclarationDescriptor(kind);
  const choice = await vscode.window.showInformationMessage(
    `${descriptor.label} does not analyze the active file. It needs the repository declaration ${descriptor.workspacePath}.`,
    'Show me how',
    'Create starter',
  );
  // "Show me how" leads, and is the default an Enter press lands on. Offering
  // the empty starter first was the original dead end: it produced a valid file
  // and no idea what goes in it.
  if (choice === 'Show me how') {
    await vscode.commands.executeCommand('atlasmind.lens.openDeclarationGuide', kind);
  } else if (choice === 'Create starter') {
    await createOrOpenStarter(folder, kind);
  }
}

/** Open the declaration setup picker, optionally scoped to one file or workspace. */
export async function setupWorkspaceLensDeclarations(
  requestedKind?: LensDeclarationKind,
  requestedFolder?: vscode.WorkspaceFolder,
): Promise<void> {
  const folder = requestedFolder ?? await chooseWorkspaceFolder();
  if (!folder) {
    return;
  }

  if (requestedKind) {
    await createOrOpenStarter(folder, requestedKind);
    return;
  }

  const snapshot = inspectLensDeclarations(folder.uri.fsPath);
  const missing = snapshot.files.filter(file => file.status === 'missing');
  const picks: LensSetupPick[] = [
    {
      // First, because it is the answer to the question people actually have.
      // Creating an empty starter is only useful once you know what goes in it.
      label: '$(book) Show me what these files are for',
      description: 'Guide',
      detail: 'What each declaration does, a worked example, and an option to have Atlas propose a first draft from your repository.',
      declarationKind: 'guide' as const,
    },
    ...(missing.length > 1 ? [{
      label: '$(new-folder) Create all missing starters',
      description: `${missing.length} files`,
      detail: 'Create valid empty State Lifecycle and Configuration Resolution declarations without overwriting anything.',
      declarationKind: 'all' as const,
    }] : []),
    ...snapshot.files.map(file => ({
    label: `${file.status === 'ready' ? '$(check)' : file.status === 'missing' ? '$(new-file)' : '$(edit)'} ${file.label}`,
    description: lensDeclarationStatusLabel(file.status),
    detail: file.status === 'missing'
      ? `Create ${file.workspacePath} as a valid empty starter, then fill it using schema autocomplete.`
      : file.status === 'empty'
        ? `Open ${file.workspacePath} and add the repository's declarations.`
        : file.status === 'ready'
          ? `Open ${file.workspacePath} (${file.declarationCount} declaration${file.declarationCount === 1 ? '' : 's'}).`
          : `Open ${file.workspacePath} to repair it using the installed schema.`,
    declarationKind: file.kind,
    })),
  ];
  const selected = await vscode.window.showQuickPick(picks, {
    title: 'AtlasMind Lens — repository declarations',
    placeHolder: 'Choose a declaration to create, complete, inspect, or repair',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!selected) {
    return;
  }
  if (selected.declarationKind === 'guide') {
    // Opens on the first thing that still needs doing, or State Lifecycle when
    // everything is already declared.
    const next = snapshot.files.find(file => file.required && file.status !== 'ready') ?? snapshot.files[0];
    await vscode.commands.executeCommand('atlasmind.lens.openDeclarationGuide', next.kind);
  } else if (selected.declarationKind === 'all') {
    for (const file of missing) {
      await createOrOpenStarter(folder, file.kind);
    }
  } else {
    await createOrOpenStarter(folder, selected.declarationKind);
  }
}

async function chooseWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    void vscode.window.showInformationMessage('Open a workspace before setting up AtlasMind Lens declarations.');
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }
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
    {
      title: 'AtlasMind Lens — choose a workspace',
      placeHolder: 'Declaration files are stored in the selected repository root',
    },
  );
  return selected?.folder;
}

async function createOrOpenStarter(folder: vscode.WorkspaceFolder, kind: LensDeclarationKind): Promise<void> {
  // From the declaration table, never a local conditional. This was a two-armed
  // `kind === 'state' ? … : …`, which quietly sent every kind that was not
  // `state` to the configuration file the moment a third kind existed.
  const relativePath = findLensDeclarationDescriptor(kind).workspacePath;
  const uri = vscode.Uri.joinPath(folder.uri, ...relativePath.split('/'));
  if (folder.uri.scheme !== 'file' && folder.uri.scheme !== 'vscode-remote') {
    void vscode.window.showWarningMessage(
      `AtlasMind cannot safely create ${relativePath} in the "${folder.uri.scheme}" virtual filesystem. Create it through that filesystem's own editor, then run Lens setup again.`,
    );
    return;
  }
  const status = inspectLensDeclarations(folder.uri.fsPath).files.find(file => file.kind === kind)?.status;

  if (status === 'missing') {
    try {
      // `wx` is the create-only guarantee. A preflight followed by
      // `workspace.fs.writeFile` could overwrite a file created in between.
      // Disk-backed local and remote extension hosts both expose `fsPath`;
      // virtual providers fail visibly rather than losing that invariant.
      await mkdir(path.dirname(uri.fsPath), { recursive: true });
      await writeFile(uri.fsPath, buildLensDeclarationStarter(kind), { encoding: 'utf8', flag: 'wx' });
      void vscode.window.showInformationMessage(
        `Created ${relativePath}. Add project-authored declarations using the installed schema and autocomplete.`,
      );
    } catch (error) {
      if (!isAlreadyExists(error)) {
        const detail = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`AtlasMind could not create ${relativePath}: ${detail}`);
        return;
      }
    }
  }

  try {
    await vscode.window.showTextDocument(uri, { preview: false });
  } catch {
    void vscode.window.showWarningMessage(`AtlasMind could not open ${relativePath}. Check the workspace file permissions.`);
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    ((error as { code?: unknown }).code === 'EEXIST' || (error as { code?: unknown }).code === 'FileExists');
}
