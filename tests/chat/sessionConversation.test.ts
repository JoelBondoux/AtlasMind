import { describe, it, expect } from 'vitest';
import { SessionConversation } from '../../src/chat/sessionConversation';

describe('SessionConversation', () => {
  it('should be able to add a turn', () => {
    const conversation = new SessionConversation();
    conversation.recordTurn('hello', 'world');
    expect(conversation.getTranscript()).toHaveLength(2);
  });
});
