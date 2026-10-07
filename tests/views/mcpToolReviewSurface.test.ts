import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderHeldTools, validatePanelMessage } from '../../src/views/mcpPanel.ts';
import type { McpHeldTool, McpServerState } from '../../src/types.ts';

/**
 * The MCP panel's "Review changed tools" view, asserted against the real
 * renderer and message validator.
 *
 * Everything this view draws was written by a third-party server — and the
 * tools it shows are held precisely because that text may be hostile — so it
 * is the last place an unescaped value can afford to slip through. Its one
 * control registers a tool as a skill an agent can call, so the message it
 * sends must name *which version was reviewed* and nothing else.
 */

const HOST_PANEL = readFileSync(path.join(process.cwd(), 'src', 'views', 'mcpPanel.ts'), 'utf8');
const HELD_ID = '0123456789abcdef0123456789abcdef';
const HOSTILE = '<img src=x onerror="alert(1)"> `${x}` </pre><script>alert(2)</script>';

function heldTool(overrides: Partial<McpHeldTool> = {}): McpHeldTool {
  return {
    id: HELD_ID,
    serverId: 'srv-1',
    toolName: `evil${HOSTILE}`,
    verdict: 'description-changed',
    rule: 'pin.description-changed',
    reason: 'The description changed since it was approved.',
    findings: [{ rule: 'tool-instruction-tag', severity: 'flag', location: 'description', snippet: HOSTILE, message: 'An instruction-style tag.' }],
    description: HOSTILE,
    schemaPreview: `{"note":"${HOSTILE}"}`,
    descriptionHash: 'a'.repeat(64),
    schemaHash: 'b'.repeat(64),
    previous: { description: HOSTILE, schemaPreview: '{}', pinnedAt: '2026-10-01T00:00:00.000Z', approvedBy: 'first-sight' },
    heldAt: '2026-10-07T00:00:00.000Z',
    ...overrides,
  };
}

function serverWith(held: McpHeldTool[]): McpServerState {
  return {
    config: { id: 'srv-1', name: 'Server', transport: 'stdio', command: 'node', enabled: true },
    status: 'connected',
    tools: [],
    heldTools: held,
  };
}

describe('the review view escapes everything a server wrote', () => {
  const html = renderHeldTools(serverWith([heldTool()]));

  it('never emits the hostile markup raw', () => {
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</pre><script>');
    expect(html).toContain('&lt;img');
  });

  it('shows the approved and the offered text side by side', () => {
    expect(html).toContain('Approved 2026-10-01');
    expect(html).toContain('Offered now');
    expect(html).toContain('tool-instruction-tag');
    expect(html).toContain('pin.description-changed');
  });

  it('says plainly when nothing was ever approved', () => {
    const fresh = renderHeldTools(serverWith([heldTool({ verdict: 'new-tool', rule: 'pin.new-tool', previous: undefined })]));
    expect(fresh).toContain('never been approved');
  });

  it('renders nothing for a server with nothing held', () => {
    expect(renderHeldTools(serverWith([]))).toBe('');
  });
});

describe('the Approve button names a reviewed version, never a tool', () => {
  const html = renderHeldTools(serverWith([heldTool()]));

  it('carries only the server id and the opaque held id', () => {
    const button = html.match(/<button[^>]*data-action="approve-held"[^>]*>/)?.[0] ?? '';
    expect(button).toContain(`data-held-id="${HELD_ID}"`);
    expect(button).toContain('data-id="srv-1"');
    expect(button).not.toContain('evil');
  });

  it('posts those two ids and nothing else from the webview', () => {
    expect(HOST_PANEL).toContain("vscode.postMessage({ type: 'approveHeldTool', payload: { serverId: id, heldId: btn.dataset.heldId } })");
  });

  it('validates the message: an opaque hex id and a plain server id, or nothing', () => {
    expect(validatePanelMessage({ type: 'approveHeldTool', payload: { serverId: 'srv-1', heldId: HELD_ID } }))
      .toEqual({ type: 'approveHeldTool', payload: { serverId: 'srv-1', heldId: HELD_ID } });
    for (const payload of [
      { serverId: 'srv-1', heldId: 'read_file' },
      { serverId: 'srv-1', heldId: HELD_ID.toUpperCase() },
      { serverId: 'srv-1', heldId: `${HELD_ID}0` },
      { serverId: '../../etc', heldId: HELD_ID },
      { serverId: '', heldId: HELD_ID },
      { heldId: HELD_ID },
      null,
    ]) {
      expect(validatePanelMessage({ type: 'approveHeldTool', payload }), JSON.stringify(payload)).toBeNull();
    }
  });

  it('carries the extra fields of a message no further than the validator', () => {
    const message = validatePanelMessage({ type: 'approveHeldTool', payload: { serverId: 'srv-1', heldId: HELD_ID, description: 'trust me' } });
    expect(message).toEqual({ type: 'approveHeldTool', payload: { serverId: 'srv-1', heldId: HELD_ID } });
  });
});

describe('the host decides', () => {
  const handler = HOST_PANEL.slice(
    HOST_PANEL.indexOf('private async handleApproveHeldTool('),
    HOST_PANEL.indexOf('// ── Environment scan handlers'),
  );

  it('confirms a flagged tool in a modal that names what the scan found', () => {
    expect(handler).toContain('modal: true');
    expect(handler).toContain("finding.severity === 'flag'");
    expect(handler).toContain('finding.rule');
  });

  it('leaves the version check to the registry, which re-hashes the live tool', () => {
    expect(handler).toContain('this.registry.approveHeldTool(serverId, heldId)');
  });

  it('shows the review callout and the held badge only when something is held', () => {
    expect(HOST_PANEL).toContain('${renderHeldToolsCallout(heldCount)}');
    expect(HOST_PANEL).toContain("heldCount > 0 ? `<button");
  });
});
