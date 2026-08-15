import { describe, expect, it } from 'vitest';

import {
  answerConversationRecall,
  parseConversationRecallRequest,
} from '../../src/core/conversationRecall.ts';
import type { SessionTranscriptEntry } from '../../src/chat/sessionConversation.ts';

const transcriptOf = (prompts: string[]): SessionTranscriptEntry[] =>
  prompts.flatMap((prompt, index) => ([
    { id: `u${index}`, role: 'user' as const, content: prompt, timestamp: new Date(index * 2000).toISOString() },
    { id: `a${index}`, role: 'assistant' as const, content: `reply ${index}`, timestamp: new Date(index * 2000 + 1000).toISOString() },
  ]));

describe('parseConversationRecallRequest', () => {
  // Observed: "what was my question two turns ago?" was answered with a
  // paraphrase of the task in progress — a question the operator never asked.
  it.each([
    ['what was my question two turns ago?', 2],
    ['what was my question 3 turns ago', 3],
    ['what did I ask two messages back?', 2],
    ['what was my last question?', 1],
    ['what did I just ask?', 1],
    ['remind me what I asked', 1],
  ])('reads %j as %i turns back', (prompt, turnsBack) => {
    expect(parseConversationRecallRequest(prompt)).toEqual({ turnsBack });
  });

  it.each([
    // About the assistant's answers, which is interpretation and a model's job.
    'what did you say about the cache?',
    'what was your last answer?',
    // Ordinary questions that merely contain the words.
    'what does this code do?',
    'which test should I ask the team to review?',
    'add a question mark to the prompt',
    // Too long to be this, whatever it contains.
    `what was my question about ${'x'.repeat(140)}`,
  ])('does not claim %j', prompt => {
    expect(parseConversationRecallRequest(prompt)).toBeUndefined();
  });
});

describe('answerConversationRecall', () => {
  const transcript = transcriptOf([
    'add caching',
    'bump the version and update the changelog',
    'which delivery stage should I promote first?',
    'what was my question two turns ago?',
  ]);

  it('quotes the exact message rather than paraphrasing it', () => {
    // A paraphrase of a verbatim record is strictly worse than a quotation, and
    // it is what produced a question the operator had never asked.
    const answer = answerConversationRecall(
      { turnsBack: 2 }, transcript, 'what was my question two turns ago?',
    );
    expect(answer.quoted).toBe('bump the version and update the changelog');
    expect(answer.markdown).toContain('> bump the version and update the changelog');
  });

  it('does not count the question being asked right now', () => {
    // "Two turns ago" means two before this one, which is what a person means.
    const answer = answerConversationRecall(
      { turnsBack: 1 }, transcript, 'what was my question two turns ago?',
    );
    expect(answer.quoted).toBe('which delivery stage should I promote first?');
  });

  it('says the session does not reach that far rather than returning the oldest', () => {
    // Returning the oldest would read as the one requested.
    const answer = answerConversationRecall({ turnsBack: 9 }, transcript, undefined);
    expect(answer.quoted).toBeUndefined();
    expect(answer.markdown).toMatch(/only goes back/i);
  });

  it('handles a session with nothing before this question', () => {
    const answer = answerConversationRecall({ turnsBack: 1 }, transcriptOf(['hello']), 'hello');
    expect(answer.quoted).toBeUndefined();
    expect(answer.markdown).toMatch(/first thing you have asked/i);
  });

  it('truncates a long message rather than rewriting it', () => {
    const long = `deploy ${'x'.repeat(600)}`;
    const answer = answerConversationRecall({ turnsBack: 1 }, transcriptOf([long]), undefined);
    expect(answer.markdown).toContain('…');
    expect(answer.markdown).toContain('deploy xxx');
  });
});
