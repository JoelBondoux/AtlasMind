import { describe, expect, it } from 'vitest';
import {
  acpToolRisk,
  chooseAllowOption,
  chooseDenyOption,
  describeAcpToolCall,
  resolveAcpPermission,
  selectAcpMcpServers,
} from '../../src/providers/acpPermission.ts';
import { ACP_TOOL_KINDS, type AcpPermissionRequest, type AcpToolCall } from '../../src/providers/acpProtocol.ts';
import type { McpServerConfig } from '../../src/types.ts';

const TOOL_CALL: AcpToolCall = {
  toolCallId: 'call_1',
  title: 'Run the build',
  kind: 'execute',
  status: 'pending',
  locations: [],
  isUpdate: false,
};

function permissionRequest(options: AcpPermissionRequest['options']): AcpPermissionRequest {
  return { sessionId: 'sess_1', toolCall: TOOL_CALL, options };
}

const ALLOW_ONCE = { optionId: 'a1', name: 'Allow once', kind: 'allow_once' } as const;
const ALLOW_ALWAYS = { optionId: 'a2', name: 'Always allow', kind: 'allow_always' } as const;
const REJECT_ONCE = { optionId: 'r1', name: 'Reject', kind: 'reject_once' } as const;
const REJECT_ALWAYS = { optionId: 'r2', name: 'Never allow', kind: 'reject_always' } as const;

describe('acpToolRisk', () => {
  it('maps every kind the schema defines, with no gaps', () => {
    for (const kind of ACP_TOOL_KINDS) {
      const risk = acpToolRisk(kind);
      expect(risk.category).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(risk.risk);
    }
  });

  it('treats an unidentifiable kind as the worst thing it could be', () => {
    // `ToolKind::Other` is `#[serde(other)]`, so anything a newer agent invents
    // lands there. That is exactly the case that must be logged most severely.
    expect(acpToolRisk('other')).toEqual({ category: 'terminal-write', risk: 'high' });
  });

  it('rates command execution and deletion above reads', () => {
    expect(acpToolRisk('execute').risk).toBe('high');
    expect(acpToolRisk('delete').risk).toBe('high');
    expect(acpToolRisk('read').risk).toBe('low');
    expect(acpToolRisk('search').risk).toBe('low');
  });

  it('routes network fetches to the network category, not to read', () => {
    // A fetch can carry context outward; that is a different decision from
    // reading a local file.
    expect(acpToolRisk('fetch').category).toBe('network');
  });

  it('reuses AtlasMind\'s own risk taxonomy so audit records stay comparable', () => {
    expect(acpToolRisk('edit').category).toBe('workspace-write');
    expect(acpToolRisk('move').category).toBe('workspace-write');
  });
});

describe('option selection', () => {
  it('never chooses allow_always, even when it is offered first', () => {
    // A grant made this way lives in the agent's own persistent state, where the
    // user can neither see nor revoke it.
    expect(chooseAllowOption([ALLOW_ALWAYS, ALLOW_ONCE])).toEqual(ALLOW_ONCE);
    expect(chooseAllowOption([ALLOW_ALWAYS])).toBeUndefined();
  });

  it('prefers reject_once over reject_always', () => {
    expect(chooseDenyOption([REJECT_ALWAYS, REJECT_ONCE])).toEqual(REJECT_ONCE);
  });

  it('falls back to reject_always rather than failing to deny', () => {
    expect(chooseDenyOption([REJECT_ALWAYS])).toEqual(REJECT_ALWAYS);
  });
});

describe('resolveAcpPermission — deny by default in shape', () => {
  it('selects allow_once when approved', () => {
    expect(resolveAcpPermission(permissionRequest([ALLOW_ONCE, REJECT_ONCE]), true))
      .toEqual({ action: 'select', optionId: 'a1', allowed: true });
  });

  it('selects a rejection when declined', () => {
    expect(resolveAcpPermission(permissionRequest([ALLOW_ONCE, REJECT_ONCE]), false))
      .toEqual({ action: 'select', optionId: 'r1', allowed: false });
  });

  it('DECLINES an approved request whose only allow option is permanent', () => {
    // Approval of one operation is not consent to a standing grant.
    expect(resolveAcpPermission(permissionRequest([ALLOW_ALWAYS, REJECT_ONCE]), true))
      .toEqual({ action: 'select', optionId: 'r1', allowed: false });
  });

  it('errors rather than inventing an option id when nothing is offered', () => {
    expect(resolveAcpPermission(permissionRequest([]), true).action).toBe('error');
    expect(resolveAcpPermission(permissionRequest([]), false).action).toBe('error');
  });

  it('errors when there is no way to decline', () => {
    const resolution = resolveAcpPermission(permissionRequest([ALLOW_ONCE]), false);
    expect(resolution.action).toBe('error');
  });

  it('errors when approval could only be granted permanently and denial is impossible', () => {
    const resolution = resolveAcpPermission(permissionRequest([ALLOW_ALWAYS]), true);
    expect(resolution.action).toBe('error');
  });

  it('never returns an allowed selection for any input when approval is withheld', () => {
    // Exhaustive over every subset of the four option kinds: withholding
    // approval must never produce `allowed: true`.
    const kinds = [ALLOW_ONCE, ALLOW_ALWAYS, REJECT_ONCE, REJECT_ALWAYS];
    for (let mask = 0; mask < 16; mask += 1) {
      const options = kinds.filter((_, index) => (mask & (1 << index)) !== 0);
      const resolution = resolveAcpPermission(permissionRequest(options), false);
      expect(resolution.action === 'select' && resolution.allowed).toBe(false);
    }
  });

  it('never selects the allow_always option id for any input at all', () => {
    const kinds = [ALLOW_ONCE, ALLOW_ALWAYS, REJECT_ONCE, REJECT_ALWAYS];
    for (let mask = 0; mask < 16; mask += 1) {
      const options = kinds.filter((_, index) => (mask & (1 << index)) !== 0);
      for (const approved of [true, false]) {
        const resolution = resolveAcpPermission(permissionRequest(options), approved);
        if (resolution.action === 'select') {
          expect(resolution.optionId).not.toBe(ALLOW_ALWAYS.optionId);
        }
      }
    }
  });
});

describe('describeAcpToolCall', () => {
  it('leads with a verb derived from the structured kind, not the agent\'s title', () => {
    // A tool that titles itself "Reading a file" while declaring `execute` is
    // still announced as running a command.
    const described = describeAcpToolCall({ ...TOOL_CALL, title: 'Reading a file', kind: 'execute' });
    expect(described).toBe('Run a command: Reading a file');
  });

  it('names the paths involved, and summarises a long list', () => {
    const described = describeAcpToolCall({
      ...TOOL_CALL,
      kind: 'edit',
      locations: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
    });
    expect(described).toContain('a.ts, b.ts, c.ts');
    expect(described).toContain('+2 more');
  });

  it('falls back to the call id when the agent gives no title', () => {
    expect(describeAcpToolCall({ ...TOOL_CALL, title: '' })).toContain('call_1');
  });
});

describe('selectAcpMcpServers — the allowlist is the grant', () => {
  const stdio = (over: Partial<McpServerConfig>): McpServerConfig => ({
    id: 'id', name: 'docs', transport: 'stdio', command: 'npx', args: ['-y', 'server'], enabled: true, ...over,
  });

  it('hands over nothing when the allowlist is empty', () => {
    expect(selectAcpMcpServers([stdio({})], []).servers).toEqual([]);
  });

  it('hands over an allowlisted stdio server with its args and env', () => {
    const { servers } = selectAcpMcpServers([stdio({ env: { MODE: 'ro' } })], ['docs']);
    expect(servers).toEqual([
      { name: 'docs', command: 'npx', args: ['-y', 'server'], env: [{ name: 'MODE', value: 'ro' }] },
    ]);
  });

  it('matches the allowlist case-insensitively and ignores stray whitespace', () => {
    expect(selectAcpMcpServers([stdio({})], ['  DOCS ']).servers).toHaveLength(1);
  });

  it('REFUSES a server whose credentials live in SecretStorage', () => {
    // Ticking a checkbox must not silently copy a key the user gave AtlasMind
    // into another vendor's process environment.
    const { servers, skipped } = selectAcpMcpServers([stdio({ secretEnvKeys: ['API_KEY'] })], ['docs']);
    expect(servers).toEqual([]);
    expect(skipped[0]!.reason).toMatch(/credentials/i);
  });

  it('refuses HTTP servers, whose headers carry bearer tokens', () => {
    const { servers, skipped } = selectAcpMcpServers(
      [{ id: 'id', name: 'api', transport: 'http', url: 'https://example.com/mcp', enabled: true }],
      ['api'],
    );
    expect(servers).toEqual([]);
    expect(skipped[0]!.reason).toMatch(/stdio/i);
  });

  it('reports a disabled server rather than silently omitting it', () => {
    const { servers, skipped } = selectAcpMcpServers([stdio({ enabled: false })], ['docs']);
    expect(servers).toEqual([]);
    expect(skipped[0]!.reason).toMatch(/disabled/i);
  });

  it('says nothing about servers that were never allowlisted', () => {
    // Not on the list is the normal case, not an exception to report.
    expect(selectAcpMcpServers([stdio({ name: 'other' })], ['docs']).skipped).toEqual([]);
  });
});
