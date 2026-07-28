import { describe, expect, it } from 'vitest';

import {
  MAX_ATTENTION_SUMMARY,
  decideApprovalAttention,
  describePendingApprovals,
  type ApprovalAttentionInput,
} from '../../src/core/approvalAttention.ts';

const REQUEST = { id: 'r1', summary: 'Run `npm test` in the workspace', risk: 'medium', toolName: 'terminal' };

function input(overrides: Partial<ApprovalAttentionInput> = {}): ApprovalAttentionInput {
  return {
    previousIds: [],
    pending: [REQUEST],
    surfaceVisible: false,
    revealEnabled: true,
    ...overrides,
  };
}

describe('decideApprovalAttention', () => {
  it('announces a new request when the panel is not on screen', () => {
    // The reported failure: the approval bar was waiting in the AtlasMind
    // panel while the user was in VS Code's own chat, with nothing to say so.
    const attention = decideApprovalAttention(input());
    expect(attention?.reveal).toBe(true);
    expect(attention?.notify).toBe(true);
    expect(attention?.summary).toContain('npm test');
  });

  it('stays silent when the panel is already on screen', () => {
    // Interrupting someone toward something they are already looking at is how
    // prompts get trained into reflex dismissal.
    const attention = decideApprovalAttention(input({ surfaceVisible: true }));
    expect(attention?.reveal).toBe(false);
    expect(attention?.notify).toBe(false);
  });

  it('records the ids even when it stays silent, so they never announce late', () => {
    const attention = decideApprovalAttention(input({ surfaceVisible: true }));
    expect(attention?.announcedIds).toEqual(['r1']);
  });

  it('says nothing when nothing new arrived', () => {
    // This fires on every change to the pending list, including a resolution —
    // re-announcing would notify every time you approved something.
    expect(decideApprovalAttention(input({ previousIds: ['r1'] }))).toBeUndefined();
    expect(decideApprovalAttention(input({ pending: [] }))).toBeUndefined();
  });

  it('announces only the genuinely new request when others were already known', () => {
    const attention = decideApprovalAttention(input({
      previousIds: ['r1'],
      pending: [REQUEST, { id: 'r2', summary: 'Delete build output' }],
    }));
    expect(attention?.summary).toContain('Delete build output');
    expect(attention?.summary).not.toContain('npm test');
    expect(attention?.announcedIds).toEqual(['r1', 'r2']);
  });

  it('still notifies when reveal is switched off', () => {
    // Turning reveal off should stop the panel taking focus, not leave someone
    // unaware that a run is blocked.
    const attention = decideApprovalAttention(input({ revealEnabled: false }));
    expect(attention?.reveal).toBe(false);
    expect(attention?.notify).toBe(true);
  });

  it('notifies even while revealing, because a reveal can be missed', () => {
    // The window may not be focused; a notification persists until dismissed.
    const attention = decideApprovalAttention(input());
    expect(attention?.reveal && attention.notify).toBe(true);
  });

  it('ignores requests with no usable id rather than announcing a blank', () => {
    const attention = decideApprovalAttention(input({
      pending: [{ id: '' }, { id: undefined as unknown as string }],
    }));
    expect(attention).toBeUndefined();
  });
});

describe('describePendingApprovals', () => {
  it('names the action, not just that an approval exists', () => {
    // "Approval required" gives no reason to switch to it.
    expect(describePendingApprovals([REQUEST])).toBe('Run `npm test` in the workspace');
  });

  it('falls back to the tool name when there is no summary', () => {
    expect(describePendingApprovals([{ id: 'r1', toolName: 'terminal' }])).toBe('terminal');
    expect(describePendingApprovals([{ id: 'r1' }])).toBe('a tool call');
  });

  it('counts the rest rather than listing them', () => {
    const summary = describePendingApprovals([REQUEST, { id: 'r2' }, { id: 'r3' }]);
    expect(summary).toContain('+2 more waiting');
  });

  it('clamps a long summary to one line', () => {
    const summary = describePendingApprovals([{ id: 'r1', summary: 'x'.repeat(500) }]);
    expect(summary.length).toBeLessThanOrEqual(MAX_ATTENTION_SUMMARY + 2);
    expect(summary).toContain('…');
  });

  it('returns empty for an empty list', () => {
    expect(describePendingApprovals([])).toBe('');
  });
});
