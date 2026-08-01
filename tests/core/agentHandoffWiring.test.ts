import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyToolInvocation } from '../../src/core/toolPolicy';
import { getBuiltinWorkspaceTools } from '../../src/core/builtinWorkspaceTools';

/**
 * The handoff policy is unit-tested in `agentHandoff.test.ts`. These are the
 * properties that live in the *wiring* — where a mistake would leave the policy
 * intact and route around it anyway.
 */

const ORCHESTRATOR = readFileSync(
  path.join(process.cwd(), 'src', 'core', 'orchestrator.ts'),
  'utf8',
);

const TOOLS = readFileSync(
  path.join(process.cwd(), 'src', 'core', 'builtinWorkspaceTools.ts'),
  'utf8',
);

/** The body of `runDelegatedAgent`. */
function delegateSource(): string {
  const start = ORCHESTRATOR.indexOf('private async runDelegatedAgent(');
  expect(start, 'runDelegatedAgent is missing').toBeGreaterThan(-1);
  const end = ORCHESTRATOR.indexOf('\n  async processTaskWithAgent', start);
  return ORCHESTRATOR.slice(start, end === -1 ? undefined : end);
}

describe('the caller cannot name itself', () => {
  it('takes the caller identity from what the orchestrator is running', () => {
    // A model able to name its own caller could name a more privileged one, and
    // the whole ceiling is computed from that identity.
    expect(delegateSource()).toContain('const caller = this.currentExecution;');
    expect(delegateSource()).toContain('callerSkillIds: caller.skillIds');
  });

  it('does not read a caller id from the request', () => {
    expect(delegateSource()).not.toMatch(/request\.caller/);
  });

  it('records the caller from the resolved turn-narrowed skill list, not the definition', () => {
    // A planner subtask is an ephemeral agent that is not in the registry, so a
    // lookup by id would find nothing and hand back an empty ceiling — refusing
    // every handoff for a reason that looks like policy and is a missing record.
    expect(ORCHESTRATOR).toContain('skillIds: activeAgentSkills.map(skill => skill.id)');
  });

  it('refuses when nothing is executing rather than assuming a caller', () => {
    expect(delegateSource()).toMatch(/Nothing is currently executing/);
  });
});

describe('the delegate is narrowed, not the registered agent', () => {
  it('builds a copy with the granted skills rather than mutating the target', () => {
    // Mutating the registered agent would leak this run's ceiling into every
    // later use of it.
    const source = delegateSource();
    expect(source).toContain('skills: decision.grantedSkillIds');
    expect(source).toContain('...targetAgent,');
    expect(source).not.toMatch(/targetAgent\.skills\s*=/);
  });

  it('reaches only enabled agents', () => {
    // A disabled agent is one somebody switched off. Reaching it through
    // delegation would route around that.
    expect(delegateSource()).toContain('this.agents.listEnabledAgents()');
  });

  it('does not inherit the caller\'s budget', () => {
    // A delegate answering one question is a smaller job than whatever the
    // caller is doing; running it at the caller's budget would make a handoff
    // an unbounded cost multiplier.
    expect(delegateSource()).toContain("constraints: { budget: 'balanced', speed: 'balanced' }");
  });
});

describe('the chain survives the call', () => {
  it('removes its entry when the delegated run finishes, however it finishes', () => {
    const source = delegateSource();
    expect(source).toContain('} finally {');
    expect(source).toContain('this.handoffChains.delete(delegateTaskId)');
  });

  it('restores the caller identity rather than clearing it', () => {
    // The caller is still running. Losing its identity here would make its
    // *next* handoff look like it had no caller at all.
    expect(delegateSource()).toContain('this.currentExecution = outerExecution;');
  });

  it('returns a sentence on failure rather than throwing', () => {
    // A thrown error becomes a tool failure the model retries, and retrying a
    // refusal helps nobody.
    expect(delegateSource()).toMatch(/Answer with what you have, or report what is missing/);
  });
});

describe('the tool surface', () => {
  const tool = getBuiltinWorkspaceTools().find(entry => entry.id === 'agent-handoff');

  it('is registered', () => {
    expect(tool).toBeDefined();
    expect(tool?.builtIn).toBe(true);
  });

  it('tells the model it runs with the caller\'s permissions', () => {
    // The natural assumption — that a specialist brings its own tools — is the
    // one that would turn every restriction into a suggestion.
    expect(tool?.description).toMatch(/runs with YOUR permissions/);
    expect(tool?.description).toMatch(/a tool you do not have, it does not get either/);
  });

  it('tells the model the caller keeps ownership', () => {
    expect(tool?.description).toMatch(/you keep ownership/);
  });

  it('refuses cleanly when the context has no orchestrator behind it', async () => {
    // The CLI context and unit tests have no orchestrator. A stack trace here
    // would be something the model tries to work around.
    const result = await tool!.execute(
      { agent_id: 'x', question: 'y' },
      { workspaceRootPath: undefined } as never,
    );
    expect(String(result)).toContain('Handoff refused (unavailable)');
    expect(String(result)).toContain('Answer with what you have');
  });

  it('does not let the model supply its own caller identity', () => {
    // The fields exist on the seam for the orchestrator to fill; the tool must
    // never populate them from arguments.
    const source = TOOLS.slice(TOOLS.indexOf('function makeAgentHandoffTool'));
    expect(source).toMatch(/callerAgentId: '',/);
    expect(source).not.toMatch(/callerAgentId: String\(params/);
  });
});

describe('approval classification', () => {
  it('is not labelled as network access, which it is not', () => {
    const policy = classifyToolInvocation('agent-handoff', { agent_id: 'security-reviewer' });
    expect(policy.category).not.toBe('network');
  });

  it('says approving it does not pre-approve what the delegate goes on to do', () => {
    // The risk being approved is spend, not action: every tool the delegate
    // reaches for passes through this same gate on its own account.
    const policy = classifyToolInvocation('agent-handoff', { agent_id: 'security-reviewer' });
    expect(policy.summary).toContain('security-reviewer');
    expect(policy.summary).toMatch(/approved separately/);
  });

  it('names the agent generically when the argument is missing', () => {
    expect(classifyToolInvocation('agent-handoff', {}).summary).toContain('another agent');
  });
});
