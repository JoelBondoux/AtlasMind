import { describe, expect, it, vi } from 'vitest';
import { httpRequestSkill } from '../../src/skills/httpRequest.ts';
import type { SkillExecutionContext } from '../../src/types.ts';

function makeContext(
  overrides: Partial<SkillExecutionContext> = {},
): SkillExecutionContext {
  return {
    workspaceRootPath: '/workspace',
    queryMemory: vi.fn().mockResolvedValue([]),
    upsertMemory: vi.fn().mockReturnValue({ status: 'created' }),
    deleteMemory: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    findFiles: vi.fn().mockResolvedValue([]),
    searchInFiles: vi.fn().mockResolvedValue([]),
    listDirectory: vi.fn().mockResolvedValue([]),
    runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
    getGitStatus: vi.fn().mockResolvedValue(''),
    getGitDiff: vi.fn().mockResolvedValue(''),
    rollbackLastCheckpoint: vi.fn().mockResolvedValue({ ok: true, summary: 'Rolled back.', restoredPaths: [] }),
    applyGitPatch: vi.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    getGitLog: vi.fn().mockResolvedValue(''),
    gitBranch: vi.fn().mockResolvedValue(''),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    moveFile: vi.fn().mockResolvedValue(undefined),
    getDiagnostics: vi.fn().mockResolvedValue([]),
    getDocumentSymbols: vi.fn().mockResolvedValue([]),
    findReferences: vi.fn().mockResolvedValue([]),
    goToDefinition: vi.fn().mockResolvedValue([]),
    renameSymbol: vi.fn().mockResolvedValue({ filesChanged: 0, editsApplied: 0 }),
    fetchUrl: vi.fn().mockResolvedValue({ ok: true, status: 200, body: '' }),
    httpRequest: vi.fn().mockResolvedValue({ ok: true, status: 200, body: '{}' }),
    getCodeActions: vi.fn().mockResolvedValue([]),
    applyCodeAction: vi.fn().mockResolvedValue({ applied: true }),
    getTerminalOutput: vi.fn().mockResolvedValue(''),
    getInstalledExtensions: vi.fn().mockResolvedValue([]),
    getPortForwards: vi.fn().mockResolvedValue([]),
    getTestResults: vi.fn().mockResolvedValue([]),
    getActiveDebugSession: vi.fn().mockResolvedValue(null),
    listTerminals: vi.fn().mockResolvedValue([]),
    getSpecialistApiKey: vi.fn().mockResolvedValue(undefined),
    getOutputChannelNames: vi.fn().mockResolvedValue([]),
    getAtlasMindOutputLog: vi.fn().mockResolvedValue(''),
    getDebugSessions: vi.fn().mockResolvedValue([]),
    evaluateDebugExpression: vi.fn().mockResolvedValue(''),
    ...overrides,
  };
}

describe('http-request egress screen', () => {
  it.each([
    ['http://localhost:8080/admin', /egress\.local-name/],
    ['https://169.254.169.254/latest/api/token', /egress\.blocked-address/],
    ['https://0x7f.1/', /egress\.blocked-address/],
    ['https://[fd00::1]/', /egress\.blocked-address/],
    ['http://api.example.com/', /egress\.scheme/],
    ['https://admin:hunter2@api.example.com/', /egress\.credentials/],
  ])('refuses %s before calling httpRequest', async (url, rule) => {
    const httpRequest = vi.fn();
    const result = await httpRequestSkill.execute({ url, method: 'PUT', body: '{}' }, makeContext({ httpRequest }));
    expect(result).toMatch(/^Error: Refused/);
    expect(result).toMatch(rule);
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('sends an ordinary public https request through the context unchanged', async () => {
    const httpRequest = vi.fn().mockResolvedValue({ ok: true, status: 201, body: '{"id":1}' });
    const result = await httpRequestSkill.execute(
      { url: 'https://api.example.com/items', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' },
      makeContext({ httpRequest }),
    );
    expect(httpRequest).toHaveBeenCalledWith('https://api.example.com/items', expect.objectContaining({ method: 'POST', body: '{"a":1}' }));
    expect(result).toContain('status: 201');
  });
});
