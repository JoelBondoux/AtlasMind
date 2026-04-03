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
  },
  workspaceFolders: undefined,
  getConfiguration: () => ({ get: () => undefined }),
  findFiles: async () => [],
};

export const Uri = {
  joinPath: (..._args: unknown[]) => ({ path: '', fsPath: '' }),
  file: (_path: string) => ({ path: _path, fsPath: _path }),
};

export const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };

export const window = {
  createOutputChannel: () => ({ appendLine: () => undefined, dispose: () => undefined }),
};

export const lm = {
  selectChatModels: async () => [],
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
