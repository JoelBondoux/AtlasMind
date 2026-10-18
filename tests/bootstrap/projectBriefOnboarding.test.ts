import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  showInputBox: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showTextDocument: vi.fn(),
  openTextDocument: vi.fn(),
  executeCommand: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    fs: {
      readFile: async (uri: { path: string }) => {
        const text = mocks.files.get(uri.path);
        if (text === undefined) {
          throw new Error('ENOENT');
        }
        return Buffer.from(text, 'utf-8');
      },
      writeFile: async (uri: { path: string }, data: Uint8Array) => {
        mocks.writeFile(uri.path);
        mocks.files.set(uri.path, Buffer.from(data).toString('utf-8'));
      },
      createDirectory: async () => undefined,
    },
    openTextDocument: mocks.openTextDocument,
  },
  Uri: {
    joinPath: (base: { path: string }, ...segments: string[]) => {
      const joined = [base.path.replace(/\/+$/, ''), ...segments].join('/').replace(/\/+/g, '/');
      return { path: joined, fsPath: joined };
    },
  },
  window: {
    showInputBox: mocks.showInputBox,
    showWarningMessage: mocks.showWarningMessage,
    showInformationMessage: mocks.showInformationMessage,
    showTextDocument: mocks.showTextDocument,
  },
  commands: { executeCommand: mocks.executeCommand },
}));

import {
  describeProjectInOwnWords,
  promptForProjectBrief,
  readProjectBriefAt,
  writeProjectBriefAt,
} from '../../src/bootstrap/projectBriefOnboarding';

const ROOT = { path: '/workspace', fsPath: '/workspace' };
const SSOT = { path: '/workspace/project_memory', fsPath: '/workspace/project_memory' };
const BRIEF_PATH = '/workspace/project_memory/project-brief.md';
const BRIEF = 'a booking tool for dog groomers.  they lose texts. It works when a groomer sees the whole week in one place.';
const NOW = () => new Date('2026-10-08T09:00:00.000Z');

beforeEach(() => {
  mocks.files.clear();
  for (const fn of [mocks.showInputBox, mocks.showWarningMessage, mocks.showInformationMessage, mocks.showTextDocument, mocks.openTextDocument, mocks.executeCommand, mocks.writeFile]) {
    fn.mockReset();
  }
});

describe('asking for the brief', () => {
  it('keeps what was typed exactly, spelling and spacing included', async () => {
    mocks.showInputBox.mockResolvedValueOnce(`  ${BRIEF}  `);
    expect(await promptForProjectBrief()).toEqual({ status: 'given', text: BRIEF });
  });

  it('records blank and Escape as not given — a skip, never a gap to fill', async () => {
    mocks.showInputBox.mockResolvedValueOnce(undefined);
    expect(await promptForProjectBrief()).toEqual({ status: 'not-given', reason: 'skipped' });
    mocks.showInputBox.mockResolvedValueOnce('   ');
    expect(await promptForProjectBrief()).toEqual({ status: 'not-given', reason: 'skipped' });
  });

  it('refuses a thin answer with the reason, holding what was typed so it can be added to', async () => {
    mocks.showInputBox.mockResolvedValueOnce('an app').mockResolvedValueOnce(BRIEF);
    expect(await promptForProjectBrief()).toEqual({ status: 'given', text: BRIEF });
    const second = mocks.showInputBox.mock.calls[1]?.[0] as { prompt: string; value?: string };
    expect(second.value).toBe('an app');
    expect(second.prompt).toContain('who it is for');
  });

  it('stops asking after three thin answers and records not given', async () => {
    mocks.showInputBox.mockResolvedValue('an app');
    expect(await promptForProjectBrief()).toEqual({ status: 'not-given', reason: 'too-thin' });
    expect(mocks.showInputBox).toHaveBeenCalledTimes(3);
  });
});

describe('writing it', () => {
  it('writes the document every surface reads, and reads the same brief back', async () => {
    expect(await writeProjectBriefAt(SSOT as never, BRIEF, NOW(), { replace: false })).toBe('written');
    expect(mocks.files.get(BRIEF_PATH)).toContain('AtlasMind does not edit this file');
    expect(await readProjectBriefAt(SSOT as never)).toBe(BRIEF);
  });

  it('is create-only unless a replacement was confirmed', async () => {
    mocks.files.set(BRIEF_PATH, '# Project brief\n\n---\n\nThe owner wrote this earlier and it stays exactly as it is.\n');
    expect(await writeProjectBriefAt(SSOT as never, BRIEF, NOW(), { replace: false })).toBe('kept-existing');
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});

describe('the Describe the Project command', () => {
  it('writes the brief and offers the Ideation board as the separate next step', async () => {
    mocks.showInputBox.mockResolvedValueOnce(BRIEF);
    mocks.showInformationMessage.mockResolvedValueOnce('Continue on the Ideation board');
    expect(await describeProjectInOwnWords(ROOT as never, 'project_memory', NOW)).toBe('written');
    expect(await readProjectBriefAt(SSOT as never)).toBe(BRIEF);
    expect(String(mocks.showInformationMessage.mock.calls[0]?.[0])).toContain('separate one');
    expect(mocks.executeCommand).toHaveBeenCalledWith('atlasmind.openProjectIdeation');
  });

  it('writes nothing when the brief is skipped', async () => {
    mocks.showInputBox.mockResolvedValueOnce(undefined);
    expect(await describeProjectInOwnWords(ROOT as never, 'project_memory', NOW)).toBe('not-given');
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(String(mocks.showInformationMessage.mock.calls[0]?.[0])).toContain('nothing is filled in');
  });

  it('asks before replacing a brief, saying what is lost, and keeps it when declined', async () => {
    const existing = '# Project brief\n\n---\n\nThe owner wrote this earlier and it stays exactly as it is.\n';
    mocks.files.set(BRIEF_PATH, existing);
    mocks.showWarningMessage.mockResolvedValueOnce(undefined);
    expect(await describeProjectInOwnWords(ROOT as never, 'project_memory', NOW)).toBe('kept');
    const [, options] = mocks.showWarningMessage.mock.calls[0] as [string, { modal: boolean; detail: string }];
    expect(options.modal).toBe(true);
    expect(options.detail).toContain('cannot be undone');
    expect(mocks.showInputBox).not.toHaveBeenCalled();
    expect(mocks.files.get(BRIEF_PATH)).toBe(existing);
  });

  it('replaces only after the confirmation', async () => {
    mocks.files.set(BRIEF_PATH, '# Project brief\n\n---\n\nThe owner wrote this earlier and it stays exactly as it is.\n');
    mocks.showWarningMessage.mockResolvedValueOnce('Replace it');
    mocks.showInputBox.mockResolvedValueOnce(BRIEF);
    expect(await describeProjectInOwnWords(ROOT as never, 'project_memory', NOW)).toBe('replaced');
    expect(await readProjectBriefAt(SSOT as never)).toBe(BRIEF);
  });
});
