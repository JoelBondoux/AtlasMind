import { describe, it, expect } from 'vitest';
import { evaluateHandoff, MAX_HANDOFF_DEPTH } from '../src/core/agentHandoff.js';
import type { HandoffChainLink, HandoffEvaluationInput } from '../src/core/agentHandoff.js';

/**
 * Delegation between agents, and the authority that must not travel with it.
 *
 * `tests/core/agentHandoff.test.ts` walks the subset lattice and the refusal
 * ordering. This file asks the collaboration question those cannot: across a
 * *sequence* of hand-offs, does authority stay bounded? Every individual
 * hand-off can be correct while the chain as a whole leaks — that is the whole
 * failure mode, and it is invisible to a test that evaluates one hop.
 *
 * The property is monotone narrowing: a chain's granted capabilities are a
 * subset of every prefix's, so the third agent in a chain can never hold
 * something the first did not. If it did, any restricted agent could obtain any
 * capability by asking a permissive one twice, and every restriction in the
 * system would be a suggestion.
 */

const input = (over: Partial<HandoffEvaluationInput> = {}): HandoffEvaluationInput => ({
  request: { targetAgentId: 'b', question: 'What is wrong here?' },
  chain: [],
  callerAgentId: 'a',
  knownAgentIds: ['a', 'b', 'c', 'd'],
  callerSkillIds: ['file-read', 'text-search'],
  targetSkillIds: ['file-read', 'text-search', 'file-write'],
  ...over,
});

describe('a hand-off transfers the question, not the permissions', () => {
  it('grants the intersection of caller and target', () => {
    const decision = evaluateHandoff(input());
    expect(decision.allowed).toBe(true);
    expect([...decision.grantedSkillIds].sort()).toEqual(['file-read', 'text-search']);
  });

  it('withholds what the target has and the caller does not', () => {
    // Reported rather than silently dropped: the delegate is running with less
    // than it normally would, and its answer should be read in that light.
    expect(evaluateHandoff(input()).withheldSkillIds).toContain('file-write');
  });

  it('refuses rather than running a delegate that can check nothing', () => {
    // A model with no tools produces confident prose, which is worse than a
    // refusal because it looks like a result.
    const decision = evaluateHandoff(input({
      callerSkillIds: ['file-read'],
      targetSkillIds: ['file-write'],
    }));
    expect(decision.allowed).toBe(false);
    expect(decision.refusal?.kind).toBe('no-shared-capability');
  });
});

describe('authority narrows along a chain and never widens', () => {
  /** Walk a chain of hand-offs, carrying each grant forward as the next ceiling. */
  function walk(steps: ReadonlyArray<{ id: string; skills: string[] }>, start: string[]) {
    let ceiling = start;
    let callerId = 'a';
    const chain: HandoffChainLink[] = [];
    const grants: string[][] = [];

    for (const step of steps) {
      const decision = evaluateHandoff(input({
        request: { targetAgentId: step.id, question: 'and now?' },
        chain: [...chain],
        callerAgentId: callerId,
        knownAgentIds: ['a', 'b', 'c', 'd'],
        callerSkillIds: ceiling,
        targetSkillIds: step.skills,
      }));
      if (!decision.allowed) {
        return { grants, stoppedAt: step.id, refusal: decision.refusal };
      }
      grants.push([...decision.grantedSkillIds]);
      ceiling = [...decision.grantedSkillIds];
      chain.push({ agentId: step.id } as HandoffChainLink);
      callerId = step.id;
    }
    return { grants, stoppedAt: undefined, refusal: undefined };
  }

  it('never grants a later agent something an earlier one did not hold', () => {
    const result = walk(
      [
        { id: 'b', skills: ['file-read', 'text-search', 'file-write'] },
        // `c` is *more* permissive than what the chain currently holds. This is
        // the escalation attempt, and the grant must not follow it upward.
        { id: 'c', skills: ['file-read', 'text-search', 'file-write', 'terminal-run'] },
      ],
      ['file-read', 'text-search'],
    );

    expect(result.grants.length).toBe(2);
    for (const [index, grant] of result.grants.entries()) {
      expect(grant, `hop ${index + 1} widened the grant`).not.toContain('terminal-run');
      expect(grant).not.toContain('file-write');
    }
    // Monotone: each hop is a subset of the one before it.
    expect(new Set(result.grants[1]).size).toBeLessThanOrEqual(new Set(result.grants[0]).size);
  });

  it('collapses to a refusal once the chain has narrowed to nothing', () => {
    const result = walk(
      [
        { id: 'b', skills: ['file-read', 'text-search'] },
        { id: 'c', skills: ['file-read'] },
        // Shares nothing with what is left.
        { id: 'd', skills: ['terminal-run'] },
      ],
      ['file-read', 'text-search'],
    );

    expect(result.stoppedAt).toBe('d');
    expect(result.refusal?.kind).toBe('no-shared-capability');
  });

  it('stops at the declared depth rather than recursing indefinitely', () => {
    const chain: HandoffChainLink[] = Array.from(
      { length: MAX_HANDOFF_DEPTH },
      (_, index) => ({ agentId: `agent-${index}` } as HandoffChainLink),
    );
    const decision = evaluateHandoff(input({ chain }));

    expect(decision.allowed).toBe(false);
    expect(decision.refusal?.kind).toBe('depth');
    // Naming the chain matters: a bare "too deep" leaves nobody able to see
    // which delegation loop produced it.
    expect(decision.refusal?.detail.length ?? 0).toBeGreaterThan(0);
  });

  it('refuses a cycle even when every hop in it would be allowed alone', () => {
    const decision = evaluateHandoff(input({
      request: { targetAgentId: 'b', question: 'again?' },
      chain: [{ agentId: 'b' } as HandoffChainLink],
    }));

    expect(decision.allowed).toBe(false);
    expect(decision.refusal?.kind).toBe('cycle');
  });

  it('refuses an agent that does not exist rather than guessing at one', () => {
    const decision = evaluateHandoff(input({
      request: { targetAgentId: 'nobody', question: 'hello?' },
    }));
    expect(decision.allowed).toBe(false);
    expect(decision.refusal?.kind).toBe('unknown-agent');
  });

  it('refuses an agent naming itself', () => {
    const decision = evaluateHandoff(input({
      request: { targetAgentId: 'a', question: 'hello?' },
      callerAgentId: 'a',
    }));
    expect(decision.allowed).toBe(false);
  });
});
