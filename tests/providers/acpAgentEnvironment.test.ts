import { describe, expect, it } from 'vitest';
import { acpCommandName, assessAcpAgentEnvironment, ACP_AGENT_PATH_VARIABLES } from '../../src/providers/acpAgentEnvironment.ts';

const exists = (paths: string[]) => (candidate: string) => paths.includes(candidate);

describe('acpAgentEnvironment', () => {
  it('names an agent by its file name, whatever path or shim launched it', () => {
    expect(acpCommandName('codex-acp')).toBe('codex-acp');
    expect(acpCommandName('C:\\npm\\codex-acp.cmd')).toBe('codex-acp');
    expect(acpCommandName('/usr/local/bin/codex-acp')).toBe('codex-acp');
    expect(acpCommandName('Codex-ACP.EXE')).toBe('codex-acp');
  });

  it('refuses a declared path that does not exist, naming the variable and why it went stale', () => {
    const result = assessAcpAgentEnvironment(
      { id: 'codex', command: 'codex-acp', env: { CODEX_PATH: 'C:\\Users\\me\\OpenAI\\Codex\\bin\\896a\\codex.exe' } },
      { platform: 'win32', fileExists: () => false },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.variable).toBe('CODEX_PATH');
    expect(result.message).toContain('"codex" agent');
    expect(result.message).toMatch(/new folder each time it updates/);
  });

  it('spells an existing Windows path with forward slashes for an agent that drops backslashes', () => {
    const path = 'C:\\Program Files\\Codex\\codex.exe';
    const result = assessAcpAgentEnvironment(
      { id: 'codex', command: 'codex-acp', env: { CODEX_PATH: path, OTHER: 'a\\b' } },
      { platform: 'win32', fileExists: exists([path]) },
    );
    // Only the declared variable changes; anything else is the user's to spell.
    expect(result).toEqual({ ok: true, env: { CODEX_PATH: 'C:/Program Files/Codex/codex.exe', OTHER: 'a\\b' }, adjusted: ['CODEX_PATH'] });
  });

  it('leaves a path already in forward slashes, and non-Windows paths, untouched', () => {
    expect(assessAcpAgentEnvironment(
      { id: 'codex', command: 'codex-acp', env: { CODEX_PATH: 'C:/Codex/codex.exe' } },
      { platform: 'win32', fileExists: () => true },
    )).toMatchObject({ ok: true, adjusted: [] });
    expect(assessAcpAgentEnvironment(
      { id: 'codex', command: 'codex-acp', env: { CODEX_PATH: '/opt/codex' } },
      { platform: 'linux', fileExists: () => true },
    )).toMatchObject({ ok: true, adjusted: [] });
  });

  it('does not check a bare command name, which the agent resolves on its own PATH', () => {
    expect(assessAcpAgentEnvironment(
      { id: 'codex', command: 'codex-acp', env: { CODEX_PATH: 'codex' } },
      { platform: 'win32', fileExists: () => false },
    )).toMatchObject({ ok: true, adjusted: [] });
  });

  it('inspects only declared variables of declared agents', () => {
    // A guess about what a third-party program does with its environment is
    // the unverified contract this provider refuses everywhere else.
    expect(assessAcpAgentEnvironment(
      { id: 'other', command: 'claude-agent-acp', env: { CODEX_PATH: 'C:\\missing\\codex.exe' } },
      { platform: 'win32', fileExists: () => false },
    )).toMatchObject({ ok: true, adjusted: [] });
    for (const rule of ACP_AGENT_PATH_VARIABLES) {
      expect(rule.verifiedWith).toMatch(/\d/);
    }
  });
});
