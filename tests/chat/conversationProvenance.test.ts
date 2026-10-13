import { describe, expect, it } from 'vitest';
import {
  buildProjectRunSubTaskArtifacts,
  conversationTaintNote,
  openConversationProvenance,
  renderAssistantResponseFooter,
} from '../../src/chat/participant.ts';
import { SessionConversation } from '../../src/chat/sessionConversation.ts';
import type { SubTaskResult, TurnProvenance } from '../../src/types.ts';

/**
 * The chat-surface half of carrying taint across turns: how a turn is seeded
 * from its conversation, and how the conversation says so under the turn.
 */

const FETCHED: TurnProvenance = {
  level: 'third-party',
  injectionSuspected: false,
  sources: [{ origin: 'tool-result', toolName: 'web-fetch', provenance: 'third-party', rule: 'provenance.network-skill', injectionSuspected: false }],
  omittedSources: 0,
};

describe('openConversationProvenance', () => {
  it('seeds a turn from what the conversation has read, marking it as earlier', () => {
    const conversation = new SessionConversation();
    const sessionId = conversation.createSession();
    conversation.recordProvenance(sessionId, FETCHED);

    const cell = openConversationProvenance(conversation, sessionId);

    expect(cell.current.level).toBe('third-party');
    expect(cell.current.sources[0]).toMatchObject({ toolName: 'web-fetch', carried: true });
  });

  it('starts a clean conversation clean', () => {
    const conversation = new SessionConversation();
    const sessionId = conversation.createSession();
    expect(openConversationProvenance(conversation, sessionId).current.level).toBe('operator');
  });

  it('treats a native thread whose earlier turns AtlasMind never recorded as third-party', () => {
    // A window reload re-maps a native thread to a fresh session, while VS Code
    // still sends the thread's own history. Those turns are in the prompt.
    const conversation = new SessionConversation();
    const sessionId = conversation.spawnSession();

    const cell = openConversationProvenance(conversation, sessionId, true);

    expect(cell.current.level).toBe('third-party');
    expect(cell.current.sources[0]?.rule).toBe('provenance.session-unrecorded');
  });

  it('does not invent that case once AtlasMind has recorded the thread', () => {
    const conversation = new SessionConversation();
    const sessionId = conversation.spawnSession();
    conversation.recordTurn('first', 'answer', sessionId);
    expect(openConversationProvenance(conversation, sessionId, true).current.level).toBe('operator');
  });
});

describe('the untrusted-content note under a turn', () => {
  it('says nothing for a clean conversation, so its footer is exactly as before', () => {
    expect(conversationTaintNote({ level: 'operator', injectionSuspected: false, sources: [], omittedSources: 0 }, undefined)).toBeUndefined();
    const footer = renderAssistantResponseFooter({ modelUsed: 'local/echo-1', costUsd: 0 });
    expect(footer).not.toContain('Untrusted content');
  });

  it('reads the scope setting — an unreadable value is the stricter scope', () => {
    const workspace: TurnProvenance = {
      level: 'workspace',
      injectionSuspected: false,
      sources: [{ origin: 'workspace-file', provenance: 'workspace', rule: 'provenance.origin.workspace-file', injectionSuspected: false }],
      omittedSources: 0,
    };
    expect(conversationTaintNote(workspace, 'third-party')).toBeUndefined();
    expect(conversationTaintNote(workspace, 'nonsense')).toContain('untrusted repository content');
  });

  it('renders under the turn, escaped, because a tool name is chosen by whoever runs the server', () => {
    const note = conversationTaintNote({
      ...FETCHED,
      sources: [{ origin: 'tool-result', toolName: 'mcp:evil:[click](https://x.test)', provenance: 'third-party', rule: 'provenance.mcp-tool', injectionSuspected: false }],
    }, undefined)!;
    const footer = renderAssistantResponseFooter({ modelUsed: 'local/echo-1', untrustedContentNote: note });
    expect(footer).toContain('**Untrusted content:**');
    expect(footer).toContain('new conversation');
    expect(footer).not.toContain('[click](https://x.test)');
  });

  it('renders even on a turn with no other footer', () => {
    expect(renderAssistantResponseFooter({ untrustedContentNote: 'This conversation includes third-party content.' }))
      .toContain('Untrusted content');
  });
});

describe('run history keeps what each subtask read', () => {
  it('carries a subtask\'s provenance onto its artifact, and omits it when unrecorded', () => {
    const base: SubTaskResult = { subTaskId: 'a', title: 'A', status: 'completed', output: 'done', costUsd: 0, durationMs: 1 };
    const [recorded, unrecorded] = buildProjectRunSubTaskArtifacts([{ ...base, provenance: FETCHED }, { ...base, subTaskId: 'b' }]);
    expect(recorded?.provenance).toEqual(FETCHED);
    expect(unrecorded && 'provenance' in unrecorded).toBe(false);
  });
});
