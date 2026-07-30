import { describe, it, expect } from 'vitest';
import {
  evaluateHandoff,
  buildHandoffPrompt,
  formatHandoffResult,
  describeHandoffRefusal,
  MAX_HANDOFF_DEPTH,
  type HandoffEvaluationInput,
} from '../../src/core/agentHandoff';

const base: HandoffEvaluationInput = {
  request: { targetAgentId: 'security-reviewer', reason: 'auth change', question: 'Is this token check sound?' },
  chain: [],
  callerAgentId: 'backend-engineer',
  knownAgentIds: ['backend-engineer', 'security-reviewer', 'docs-writer'],
  callerSkillIds: ['file-read', 'file-search'],
  targetSkillIds: ['file-read', 'file-search', 'terminal-run'],
};

const evaluate = (overrides: Partial<HandoffEvaluationInput> = {}) =>
  evaluateHandoff({ ...base, ...overrides });

describe('a handoff transfers the question, not the permissions', () => {
  it('grants the intersection of caller and target skills', () => {
    const decision = evaluate();
    expect(decision.allowed).toBe(true);
    expect(decision.grantedSkillIds).toEqual(['file-read', 'file-search']);
  });

  it('never grants a skill the caller does not have', () => {
    // The whole security argument. If a handoff granted the union, any
    // restricted agent could obtain any capability by asking a permissive one,
    // and every restriction in the system would become a suggestion.
    const decision = evaluate();
    expect(decision.grantedSkillIds).not.toContain('terminal-run');
    expect(decision.withheldSkillIds).toEqual(['terminal-run']);
  });

  it('does not widen the grant when the caller has skills the target lacks', () => {
    const decision = evaluate({
      callerSkillIds: ['file-read', 'file-write', 'terminal-run'],
      targetSkillIds: ['file-read'],
    });
    expect(decision.grantedSkillIds).toEqual(['file-read']);
  });

  it('is never wider than the caller, for any combination', () => {
    // Pinned exhaustively rather than argued: the property is the point.
    const universe = ['a', 'b', 'c'];
    for (let callerMask = 0; callerMask < 8; callerMask += 1) {
      for (let targetMask = 0; targetMask < 8; targetMask += 1) {
        const callerSkillIds = universe.filter((_, i) => (callerMask >> i) & 1);
        const targetSkillIds = universe.filter((_, i) => (targetMask >> i) & 1);
        const decision = evaluate({ callerSkillIds, targetSkillIds });
        for (const granted of decision.grantedSkillIds) {
          expect(callerSkillIds, `${callerMask}/${targetMask}`).toContain(granted);
        }
      }
    }
  });

  it('refuses rather than running a delegate with no tools', () => {
    // A delegate that cannot check anything produces confident prose, which is
    // worse than an honest refusal naming the missing capability.
    const decision = evaluate({ callerSkillIds: ['file-read'], targetSkillIds: ['terminal-run'] });
    expect(decision.allowed).toBe(false);
    expect(decision.refusal?.kind).toBe('no-shared-capability');
    expect(decision.refusal?.detail).toMatch(/prose rather than an answer/);
  });
});

describe('the chain is bounded', () => {
  const link = (agentId: string) => ({ agentId, taskId: `t-${agentId}` });

  it('refuses a cycle and names the chain', () => {
    const decision = evaluate({
      chain: [link('security-reviewer'), link('docs-writer')],
      callerAgentId: 'docs-writer',
    });
    expect(decision.refusal?.kind).toBe('cycle');
    expect(decision.refusal?.detail).toContain('security-reviewer');
  });

  it('refuses beyond the depth cap', () => {
    const chain = Array.from({ length: MAX_HANDOFF_DEPTH }, (_, i) => link(`agent-${i}`));
    expect(evaluate({ chain }).refusal?.kind).toBe('depth');
  });

  it('allows exactly up to the cap', () => {
    const chain = Array.from({ length: MAX_HANDOFF_DEPTH - 1 }, (_, i) => link(`agent-${i}`));
    expect(evaluate({ chain }).allowed).toBe(true);
  });

  it('refuses handing off to yourself', () => {
    // Not a safety issue — it just does nothing, at the price of a model call.
    const decision = evaluate({ request: { ...base.request, targetAgentId: 'backend-engineer' } });
    expect(decision.refusal?.kind).toBe('self');
  });
});

describe('refusals are ordered closest-to-the-mistake first', () => {
  it('reports a typo in the agent id before anything about capability', () => {
    // Being told "no shared capability" is unhelpful when the real problem is
    // that the agent name is misspelt.
    const decision = evaluate({
      request: { ...base.request, targetAgentId: 'securty-reviewer' },
      callerSkillIds: [],
    });
    expect(decision.refusal?.kind).toBe('unknown-agent');
    expect(decision.refusal?.detail).toContain('security-reviewer');
  });

  it('reports a malformed request before looking anything up', () => {
    expect(evaluate({ request: { targetAgentId: '', reason: '', question: 'x' } }).refusal?.kind).toBe('malformed');
    expect(evaluate({ request: { targetAgentId: 'docs-writer', reason: '', question: '  ' } }).refusal?.kind)
      .toBe('malformed');
  });

  it('always says what to do instead, never just "denied"', () => {
    const refusals = [
      evaluate({ request: { targetAgentId: '', reason: '', question: '' } }),
      evaluate({ request: { ...base.request, targetAgentId: 'nope' } }),
      evaluate({ request: { ...base.request, targetAgentId: 'backend-engineer' } }),
      evaluate({ callerSkillIds: [], targetSkillIds: ['terminal-run'] }),
    ];
    for (const decision of refusals) {
      expect(decision.refusal?.detail.length, decision.refusal?.kind).toBeGreaterThan(30);
      expect(describeHandoffRefusal(decision.refusal!)).toContain(decision.refusal!.kind);
    }
  });
});

describe('the delegate is told what it is and what it is not', () => {
  it('says it is answering a question, not taking over', () => {
    // A delegate that started redesigning the caller's approach would be worse
    // than no delegate at all.
    const prompt = buildHandoffPrompt(base.request, evaluate(), 'backend-engineer');
    expect(prompt).toMatch(/Do not take over the task/);
    expect(prompt).toMatch(/the caller keeps ownership/);
  });

  it('names the tools it is not getting, and says that is deliberate', () => {
    const prompt = buildHandoffPrompt(base.request, evaluate(), 'backend-engineer');
    expect(prompt).toContain('terminal-run');
    expect(prompt).toMatch(/That is deliberate/);
    expect(prompt).toMatch(/rather than working around it/);
  });

  it('says nothing about withheld tools when none are withheld', () => {
    const decision = evaluate({ targetSkillIds: ['file-read'] });
    expect(buildHandoffPrompt(base.request, decision, 'backend-engineer'))
      .not.toMatch(/narrower than your own/);
  });

  it('clamps a question that is not actually scoped', () => {
    const prompt = buildHandoffPrompt(
      { ...base.request, question: 'x'.repeat(20_000) }, evaluate(), 'a',
    );
    expect(prompt).toContain('(truncated)');
  });

  it('strips control characters from anything it embeds', () => {
    const prompt = buildHandoffPrompt(
      { ...base.request, reason: 'a\u0000b\u001bc' }, evaluate(), 'a',
    );
    expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(prompt)).toBe(false);
  });
});

describe('the answer comes back as an opinion, not a result', () => {
  it('says it is another agent, not a verified result', () => {
    // Model output being fed into another model's reasoning. An answer that
    // arrived looking like a tool result would be believed more than it earned.
    const formatted = formatHandoffResult('security-reviewer', 'Looks fine.', evaluate());
    expect(formatted).toMatch(/not a verified result/);
    expect(formatted).toMatch(/check anything you are about to rely on/);
  });

  it('says which checks the delegate could not make itself', () => {
    const formatted = formatHandoffResult('security-reviewer', 'Looks fine.', evaluate());
    expect(formatted).toContain('terminal-run');
    expect(formatted).toMatch(/could not check those things itself/);
  });

  it('says so when the delegate returned nothing', () => {
    expect(formatHandoffResult('x', '', evaluate())).toContain('the delegate returned nothing');
  });

  it('fences the answer', () => {
    const formatted = formatHandoffResult('x', 'body', evaluate());
    expect(formatted).toContain('--- answer ---');
    expect(formatted).toContain('--- end answer ---');
  });
});
