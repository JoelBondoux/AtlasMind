/**
 * Minimal vscode stub for unit tests.
 * Only includes the surface area used by modules under test.
 */
export const workspace = {
  fs: {
    readFile: async () => Buffer.from(''),
    writeFile: async () => undefined,
    readDirectory: async () => [],
    stat: async () => ({ mtime: 0 }),
    delete: async () => undefined,
  },
  workspaceFolders: undefined,
  getConfiguration: () => ({ get: () => undefined }),
  findFiles: async () => [],
  onDidSaveTextDocument: () => ({ dispose: () => undefined }),
  onDidCreateFiles: () => ({ dispose: () => undefined }),
  onDidDeleteFiles: () => ({ dispose: () => undefined }),
  onDidRenameFiles: () => ({ dispose: () => undefined }),
  onDidChangeConfiguration: () => ({ dispose: () => undefined }),
};

function toUriSegment(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    const candidate = value as { path?: string; fsPath?: string };
    return candidate.path ?? candidate.fsPath ?? '';
  }
  return '';
}

export const Uri = {
  joinPath: (...args: unknown[]) => {
    const [base, ...segments] = args;
    const basePath = toUriSegment(base).replace(/[\\/]+$/, '');
    const suffix = segments
      .map(segment => toUriSegment(segment))
      .filter(Boolean)
      .map(segment => segment.replace(/^[\\/]+|[\\/]+$/g, ''))
      .filter(Boolean)
      .join('/');
    const joined = suffix.length > 0
      ? [basePath, suffix].filter(Boolean).join('/')
      : basePath;
    return { path: joined, fsPath: joined };
  },
  file: (_path: string) => ({ path: _path, fsPath: _path }),
};

export const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };

export class ThemeColor {
  constructor(public id: string) {}
}

export class ThemeIcon {
  constructor(public id: string, public color?: ThemeColor) {}
}

export class TreeItem {
  description?: string;
  tooltip?: unknown;
  iconPath?: unknown;
  contextValue?: string;

  constructor(
    public label: string,
    public collapsibleState: number = TreeItemCollapsibleState.None,
  ) {}
}

export class MarkdownString {
  isTrusted?: boolean | { enabledCommands?: string[] };

  constructor(public value: string, _supportThemeIcons?: boolean) {}

  appendMarkdown(text: string): void {
    this.value += text;
  }
}

export class EventEmitter<T> {
  readonly event = (_listener: (event: T) => unknown) => ({ dispose: () => undefined });

  fire(_data: T): void {}

  dispose(): void {}
}

export const window = {
  createOutputChannel: () => ({ appendLine: () => undefined, dispose: () => undefined }),
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  createTreeView: (_id: string, options: unknown) => ({ ...((typeof options === 'object' && options !== null) ? options : {}), dispose: () => undefined }),
  registerTreeDataProvider: () => ({ dispose: () => undefined }),
  registerWebviewViewProvider: () => ({ dispose: () => undefined }),
  terminals: [] as Array<{ name: string }>,
};

export class DataTransferItem {
  constructor(public value: string) {}

  asString(): Promise<string> {
    return Promise.resolve(this.value);
  }
}

export class DataTransfer {
  private readonly items = new Map<string, DataTransferItem>();

  set(mimeType: string, item: DataTransferItem): void {
    this.items.set(mimeType, item);
  }

  get(mimeType: string): DataTransferItem | undefined {
    return this.items.get(mimeType);
  }
}

export const commands = {
  registerCommand: () => ({ dispose: () => undefined }),
};

export const tests = {
  testResults: [] as Array<{ id: string; completedAt: number; durationMs?: number; counts: Record<string, number> }>,
};

export const debug = {
  activeDebugSession: undefined as { id: string; name: string; type: string } | undefined,
};

export const lm = {
  selectChatModels: async () => [],
  onDidChangeChatModels: () => ({ dispose: () => undefined }),
};

export class LanguageModelTextPart {
  constructor(public value: string) {}
}

export class LanguageModelToolCallPart {
  constructor(public callId: string, public name: string, public input: object) {}
}

export class LanguageModelToolResultPart {
  constructor(public callId: string, public content: unknown[]) {}
}

export const LanguageModelChatMessage = {
  User: (content: unknown) => ({ role: 'user', content }),
  Assistant: (content: unknown) => ({ role: 'assistant', content }),
};

export const chat = {
  createChatParticipant: () => ({ iconPath: undefined, dispose: () => undefined }),
};

export default {};
