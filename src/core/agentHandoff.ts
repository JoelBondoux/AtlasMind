/**
 * Agent handoff — delegated execution, and the authorization that does not
 * come with it.
 *
 * Until now collaboration in AtlasMind was structural: a subtask declares
 * `dependsOn` and a `role`, the planner orders them, and one agent's output
 * becomes another's input. Nothing could *ask* another agent a question
 * mid-task. This is that, and it is the one place in the workflow where an
 * agent gains a capability rather than a fact, so it is worth being exact about
 * what it does and does not grant.
 *
 * **A handoff transfers the question, not the permissions.**
 *
 * The delegate runs with `intersection(caller's skills, target's skills)` —
 * never the union. That is the whole security argument, and it is worth stating
 * why the appealing alternative is wrong. Handing off to a specialist *feels*
 * like it should give you their tools; that is what makes it a specialist. But
 * if it did, any restricted agent could obtain any capability by asking a
 * permissive one for it, and every restriction in the system would become a
 * suggestion. Privilege escalation by delegation is a classic precisely because
 * the escalating step always looks reasonable in isolation.
 *
 * What a handoff *does* buy is real: the delegate's expertise — its system
 * prompt, its role framing, its rubric — applied to the problem, within the
 * caller's authority. That is the honest trade.
 *
 * **An empty intersection is a refusal, not a tool-less run.** A delegate with
 * no tools cannot check anything, and a model with no ability to check produces
 * confident prose. Refusing names the missing capability instead.
 *
 * **Depth and cycles are bounded.** A → B → A is a loop; A → B → C → D → … is a
 * budget nobody agreed to. Both refuse, and both name the chain.
 *
 * Pure and `vscode`-free; the orchestrator supplies the execution.
 */

/** Handoffs deep. Three is enough for specialist → specialist and no more. */
export const MAX_HANDOFF_DEPTH = 3;

/** The longest a scoped context may be. Beyond this it is not scoped. */
export const MAX_HANDOFF_CONTEXT_CHARS = 8000;

export interface HandoffRequest {
  targetAgentId: string;
  /** Why this belongs to the target. Recorded, and shown to the delegate. */
  reason: string;
  /** The question, and only what the delegate needs to answer it. */
  question: string;
}

/** One link in the delegation chain, oldest first. */
export interface HandoffChainLink {
  agentId: string;
  taskId: string;
}

export type HandoffRefusalKind =
  | 'unavailable'
  | 'unknown-agent'
  | 'self'
  | 'cycle'
  | 'depth'
  | 'no-shared-capability'
  | 'malformed';

export interface HandoffRefusal {
  kind: HandoffRefusalKind;
  /** What to tell the calling agent. Actionable, never just "denied". */
  detail: string;
}

export interface HandoffDecision {
  allowed: boolean;
  /** Skills the delegate may use. Never wider than the caller's. */
  grantedSkillIds: string[];
  /** Skills the target normally has and does not get here, for the record. */
  withheldSkillIds: string[];
  refusal?: HandoffRefusal;
}

export interface HandoffEvaluationInput {
  request: HandoffRequest;
  /** The chain that led here, oldest first. Empty for a top-level agent. */
  chain: readonly HandoffChainLink[];
  callerAgentId: string;
  /** Agent ids that exist in this workspace. */
  knownAgentIds: readonly string[];
  /** What the caller may currently use. The ceiling. */
  callerSkillIds: readonly string[];
  /** What the target would normally use. */
  targetSkillIds: readonly string[];
}

/**
 * Decide whether a handoff may happen, and with what.
 *
 * Ordered so the first refusal a caller sees is the one closest to what they
 * did wrong: shape, then identity, then the chain, then capability. Being told
 * "no shared capability" is unhelpful when the real problem is a typo in the
 * agent id.
 */
export function evaluateHandoff(input: HandoffEvaluationInput): HandoffDecision {
  const deny = (kind: HandoffRefusalKind, detail: string): HandoffDecision => ({
    allowed: false,
    grantedSkillIds: [],
    withheldSkillIds: [],
    refusal: { kind, detail },
  });

  const target = (input.request.targetAgentId ?? '').trim();
  const question = (input.request.question ?? '').trim();
  if (!target || !question) {
    return deny('malformed', 'A handoff needs a target agent and a question. Neither is optional.');
  }

  if (!input.knownAgentIds.includes(target)) {
    return deny(
      'unknown-agent',
      `There is no agent \`${target}\` in this workspace. Available: ${
        input.knownAgentIds.slice(0, 20).join(', ') || 'none'}.`,
    );
  }

  if (target === input.callerAgentId) {
    // Not a safety issue — it just does nothing, at the price of a whole model
    // call. Saying so is more useful than letting it run.
    return deny('self', 'You are already that agent. Answer the question yourself.');
  }

  if (input.chain.some(link => link.agentId === target)) {
    return deny(
      'cycle',
      `\`${target}\` is already in this delegation chain (${describeChain(input.chain)}). `
      + 'Handing back would loop.',
    );
  }

  if (input.chain.length >= MAX_HANDOFF_DEPTH) {
    return deny(
      'depth',
      `Delegation is ${MAX_HANDOFF_DEPTH} deep already (${describeChain(input.chain)}). `
      + 'Answer with what you have, or report what is missing.',
    );
  }

  // The rule. Intersection, never union — see the module header.
  const callerSkills = new Set(input.callerSkillIds);
  const granted = input.targetSkillIds.filter(skill => callerSkills.has(skill));
  const withheld = input.targetSkillIds.filter(skill => !callerSkills.has(skill));

  if (granted.length === 0) {
    return deny(
      'no-shared-capability',
      `\`${target}\` normally uses ${input.targetSkillIds.join(', ') || 'no tools'}, and you have none of `
      + 'those. A delegate with no tools cannot check anything, so this would be prose rather than an '
      + 'answer. Ask for the capability you are missing instead.',
    );
  }

  return { allowed: true, grantedSkillIds: granted, withheldSkillIds: withheld };
}

function describeChain(chain: readonly HandoffChainLink[]): string {
  return chain.map(link => link.agentId).join(' → ') || 'none';
}

/**
 * The prompt the delegate receives.
 *
 * Two things it must know and would otherwise assume wrongly. First, that it is
 * answering a question rather than owning the task — a delegate that started
 * redesigning the caller's approach would be worse than no delegate. Second,
 * that it is running with the *caller's* permissions, so a tool it normally has
 * may be missing and that is deliberate, not a fault to work around.
 */
export function buildHandoffPrompt(
  request: HandoffRequest,
  decision: HandoffDecision,
  callerAgentId: string,
): string {
  return [
    `\`${callerAgentId}\` has delegated a question to you.`,
    '',
    `Why you: ${clamp(request.reason, 400) || 'not stated'}`,
    '',
    '--- the question ---',
    clamp(request.question, MAX_HANDOFF_CONTEXT_CHARS),
    '--- end ---',
    '',
    'Answer the question. Do not take over the task, redesign the approach, or start work beyond',
    'what was asked — the caller keeps ownership and will act on what you say.',
    decision.withheldSkillIds.length > 0
      ? `\nYou are running with the caller's permissions, which are narrower than your own: ${
        decision.withheldSkillIds.join(', ')} ${
        decision.withheldSkillIds.length === 1 ? 'is' : 'are'} not available here. That is deliberate. `
        + 'If you cannot answer without it, say so rather than working around it.'
      : '',
  ].filter(line => line !== '').join('\n');
}

/**
 * The delegate's answer, as the caller sees it.
 *
 * Fenced because it is model output being fed back into another model's
 * reasoning, which is the same boundary every other untrusted surface in this
 * codebase gets. The delegate is not hostile, but it is not authoritative
 * either, and an answer that arrived looking like a tool result would be
 * believed more than it has earned.
 */
export function formatHandoffResult(
  targetAgentId: string,
  answer: string,
  decision: HandoffDecision,
): string {
  return [
    `\`${targetAgentId}\` answered. This is another agent's opinion, not a verified result —`,
    'check anything you are about to rely on.',
    decision.withheldSkillIds.length > 0
      ? `It ran without ${decision.withheldSkillIds.join(', ')}, so it could not check those things itself.`
      : '',
    '',
    '--- answer ---',
    clamp(answer, MAX_HANDOFF_CONTEXT_CHARS) || '(the delegate returned nothing)',
    '--- end answer ---',
  ].filter(line => line !== '').join('\n');
}

/** Clamp and strip control characters. Marks truncation rather than hiding it. */
function clamp(value: string, max: number): string {
  const cleaned = (value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ');
  return cleaned.length > max ? `${cleaned.slice(0, max)}\n… (truncated)` : cleaned;
}

/** How a refusal reads to the calling agent. Always says what to do instead. */
export function describeHandoffRefusal(refusal: HandoffRefusal): string {
  return `Handoff refused (${refusal.kind}). ${refusal.detail}`;
}
