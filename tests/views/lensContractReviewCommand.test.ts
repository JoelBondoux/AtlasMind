import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFiles,
  openTextDocument,
  readFile,
  showQuickPick,
  showWarningMessage,
  showInformationMessage,
  showContractReview,
  folder,
  openApiUri,
  sqlUri,
  typeScriptUri,
} = vi.hoisted(() => {
  const uri = (path: string) => ({ scheme: 'file', path, fsPath: path, toString: () => `file://${path}` });
  return {
    findFiles: vi.fn(),
    openTextDocument: vi.fn(),
    readFile: vi.fn(),
    showQuickPick: vi.fn(),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showContractReview: vi.fn(),
    folder: { name: 'atlasmind', index: 0, uri: uri('/workspace') },
    openApiUri: uri('/workspace/openapi.json'),
    sqlUri: uri('/workspace/schema.sql'),
    typeScriptUri: uri('/workspace/create-user.dto.ts'),
  };
});

vi.mock('vscode', () => ({
  ProgressLocation: { Notification: 15 },
  Uri: {
    joinPath: (base: { path: string; fsPath: string }, ...parts: string[]) => ({
      scheme: 'file',
      path: `${base.path}/${parts.join('/')}`,
      fsPath: `${base.fsPath}/${parts.join('/')}`,
      toString: () => `file://${base.path}/${parts.join('/')}`,
    }),
  },
  FileSystemError: class extends Error {
    code = 'FileNotFound';
  },
  window: {
    showQuickPick,
    showWarningMessage,
    showInformationMessage,
    withProgress: vi.fn((_options: unknown, task: (progress: { report(): void }, token: { isCancellationRequested: boolean }) => unknown) =>
      task({ report: vi.fn() }, { isCancellationRequested: false })),
  },
  workspace: {
    workspaceFolders: [folder],
    findFiles,
    openTextDocument,
    getWorkspaceFolder: vi.fn(() => folder),
    asRelativePath: vi.fn((uri: { path: string }) => uri.path.replace('/workspace/', '')),
    fs: { readFile },
  },
}));

vi.mock('../../src/views/lensContractReviewPanel', () => ({
  LensContractReviewPanel: { createOrShow: showContractReview },
}));

import { reviewWorkspaceContractWiring } from '../../src/views/lensContractReviewCommand';

const OPENAPI = JSON.stringify({
  openapi: '3.1.0',
  components: {
    schemas: {
      CreateUser: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string' } },
      },
    },
  },
});
const SQL = `CREATE TABLE accounts (id INTEGER PRIMARY KEY);
CREATE TABLE users (email TEXT NOT NULL, account_id INTEGER REFERENCES accounts(id));`;
const TYPESCRIPT = 'export interface CreateUserDto { email: string; }';

describe('Lens contract review command', () => {
  beforeEach(() => {
    findFiles.mockReset().mockResolvedValue([openApiUri, sqlUri, typeScriptUri]);
    openTextDocument.mockReset().mockImplementation((uri: { path: string }) => Promise.resolve({
      getText: () => uri.path.endsWith('.sql')
        ? SQL
        : uri.path.endsWith('.ts') ? TYPESCRIPT : OPENAPI,
    }));
    readFile.mockReset().mockImplementation((uri: { path: string }) => Promise.resolve(new TextEncoder().encode(JSON.stringify(
      uri.path.endsWith('lens-data-trust.json')
        ? {
          version: 1,
          fields: [{
            id: 'api-email',
            contractId: 'lens-contract:openapi:fixture',
            fieldPath: 'email',
            classification: 'confidential',
            controls: ['authorization'],
          }],
        }
        : { version: 1, mappings: [], suppressions: [] },
    ))));
    showQuickPick.mockReset();
    showWarningMessage.mockReset();
    showInformationMessage.mockReset();
    showContractReview.mockReset();
  });

  it('can compare a code-side TypeScript declaration directly with a SQL table', async () => {
    showQuickPick
      .mockImplementationOnce(async (items: Array<{ label: string }>) => items.find(item => item.label.includes('CreateUserDto')))
      .mockImplementationOnce(async (items: Array<{ label: string }>) => items.find(item => item.label.includes('users')));

    await reviewWorkspaceContractWiring();

    expect(showContractReview).toHaveBeenCalledWith(expect.objectContaining({
      upstream: expect.objectContaining({ label: 'CreateUserDto', sourceKind: 'typescript' }),
      downstream: expect.objectContaining({ label: 'users', sourceKind: 'sql' }),
    }));
  });

  it('discovers supported declarations, asks for an ordered pair, and opens the review panel', async () => {
    showQuickPick
      .mockImplementationOnce(async (items: Array<{ label: string }>) => items.find(item => item.label.includes('CreateUser')))
      .mockImplementationOnce(async (items: Array<{ label: string }>) => items.find(item => item.label.includes('users')));

    await reviewWorkspaceContractWiring();

    expect(showContractReview).toHaveBeenCalledWith(expect.objectContaining({
      upstream: expect.objectContaining({ label: 'CreateUser', layer: 'api' }),
      downstream: expect.objectContaining({ label: 'users', layer: 'database' }),
      mappingFile: { version: 1, mappings: [], suppressions: [] },
      dataTrustPolicy: expect.objectContaining({ version: 1, fields: expect.any(Array) }),
      relations: expect.arrayContaining([
        expect.objectContaining({
          label: 'users.account_id → accounts.id',
          to: expect.objectContaining({ fieldId: expect.any(String) }),
        }),
      ]),
    }));
  });

  it('fails closed when the repository mapping file is malformed', async () => {
    readFile.mockResolvedValue(new TextEncoder().encode('{ bad-json'));
    showQuickPick
      .mockImplementationOnce(async (items: unknown[]) => items[0])
      .mockImplementationOnce(async (items: unknown[]) => items[0]);

    await reviewWorkspaceContractWiring();

    expect(showContractReview).not.toHaveBeenCalled();
    expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('.atlasmind/lens-mappings.json'));
  });
});
