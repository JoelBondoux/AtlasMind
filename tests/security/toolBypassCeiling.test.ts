import { describe, expect, it } from 'vitest';

import type { ToolApprovalMode, ToolInvocationPolicy, ToolRiskCategory } from '../../src/types.ts';
import {
  NEVER_BYPASSABLE_TOOLS,
  classifyToolInvocation,
  isToolBypassable,
  requiresToolApproval,
  toolBypassCeiling,
} from '../../src/core/toolPolicy.ts';
import { ToolApprovalManager } from '../../src/core/toolApprovalManager.ts';

/**
 * What Autopilot cannot buy.
 *
 * `shouldBypass` returned `true` for every category the moment autopilot was
 * on, and autopilot is offered as an answer to any approval dialog — so one
 * click on a low-risk tool bought unattended approval for the rest of the
 * session, including a `git push` and any MCP tool AtlasMind could not
 * identify.
 */

const ALL_CATEGORIES: ToolRiskCategory[] = [
  'read', 'workspace-write', 'terminal-read', 'terminal-write',
  'git-read', 'git-write', 'network', 'network-read',
  'audio-input', 'audio-output',
];
const ALL_RISKS: Array<ToolInvocationPolicy['risk']> = ['low', 'medium', 'high'];
const ALL_MODES: ToolApprovalMode[] = ['always-ask', 'ask-on-write', 'ask-on-external', 'allow-safe-readonly'];

function policy(category: ToolRiskCategory, risk: ToolInvocationPolicy['risk']): ToolInvocationPolicy {
  return { category, risk, summary: `${category} at ${risk}` };
}

describe('the ceiling holds against every bypass route', () => {
  it.each(NEVER_BYPASSABLE_TOOLS.map(rule => [rule.category, rule.risk] as const))(
    'refuses to bypass %s/%s under autopilot',
    (category, risk) => {
      const manager = new ToolApprovalManager();
      manager.enableAutopilot();

      expect(manager.isAutopilot()).toBe(true);
      expect(manager.shouldBypass('task-1', policy(category, risk))).toBe(false);
    },
  );

  it.each(NEVER_BYPASSABLE_TOOLS.map(rule => [rule.category, rule.risk] as const))(
    'refuses to bypass %s/%s under a whole-task bypass',
    (category, risk) => {
      const manager = new ToolApprovalManager();
      manager.bypassTask('task-1');

      expect(manager.shouldBypass('task-1', policy(category, risk))).toBe(false);
    },
  );

  it.each(NEVER_BYPASSABLE_TOOLS.map(rule => [rule.category, rule.risk] as const))(
    'refuses to bypass %s/%s under a category bypass for that very category',
    (category, risk) => {
      const manager = new ToolApprovalManager();
      manager.bypassCategory('task-1', category);

      expect(manager.shouldBypass('task-1', policy(category, risk))).toBe(false);
    },
  );

  it('holds against every bypass granted at once', () => {
    const manager = new ToolApprovalManager();
    manager.enableAutopilot();
    manager.bypassTask('task-1');
    for (const category of ALL_CATEGORIES) {
      manager.bypassCategory('task-1', category);
    }

    for (const rule of NEVER_BYPASSABLE_TOOLS) {
      expect(manager.shouldBypass('task-1', policy(rule.category, rule.risk))).toBe(false);
    }
  });

  it('is not waivable by the approval mode either', () => {
    // The ceiling lives in the bypass, so a mode that skipped approval would
    // route around it entirely. Every mode must already require approval for a
    // ceilinged invocation.
    for (const rule of NEVER_BYPASSABLE_TOOLS) {
      for (const mode of ALL_MODES) {
        expect(
          requiresToolApproval(mode, policy(rule.category, rule.risk)),
          `${mode} skipped approval for ${rule.category}/${rule.risk}`,
        ).toBe(true);
      }
    }
  });
});

describe('the ceiling stays narrow enough to be kept', () => {
  it('leaves autopilot useful for ordinary work', () => {
    // A ceiling over every high-risk category would prompt on every file write,
    // and a gate that prompts constantly gets switched off wholesale — which is
    // worse than one that is slightly permissive.
    const manager = new ToolApprovalManager();
    manager.enableAutopilot();

    expect(manager.shouldBypass('t', policy('workspace-write', 'high'))).toBe(true);
    expect(manager.shouldBypass('t', policy('terminal-write', 'high'))).toBe(true);
    expect(manager.shouldBypass('t', policy('git-write', 'high'))).toBe(true);
    expect(manager.shouldBypass('t', policy('network-read', 'low'))).toBe(true);
  });

  it('covers a small minority of the (category, risk) space', () => {
    const total = ALL_CATEGORIES.length * ALL_RISKS.length;
    const ceilinged = ALL_CATEGORIES
      .flatMap(category => ALL_RISKS.map(risk => policy(category, risk)))
      .filter(p => !isToolBypassable(p));

    expect(ceilinged.length).toBeGreaterThan(0);
    expect(ceilinged.length / total).toBeLessThan(0.2);
  });
});

describe('the tools that actually land on the ceiling', () => {
  it.each([
    ['git-push', {}],
    ['git-branch', { action: 'delete', remote: true }],
    ['mcp:someserver:delete_records', {}],
    ['mcp:someserver:wibble', {}],
  ])('%s cannot be bypassed', (toolName, args) => {
    // Driven through the real classifier rather than a hand-built policy, so
    // the ceiling is tested against the grades the product actually assigns.
    const classified = classifyToolInvocation(toolName, args as Record<string, unknown>);
    const manager = new ToolApprovalManager();
    manager.enableAutopilot();

    expect(manager.shouldBypass('task-1', classified)).toBe(false);
  });

  it('an unidentified external tool is the case that matters most', () => {
    // An MCP server AtlasMind has never seen falls here on its name alone.
    // Under autopilot it used to be approved without anybody reading it.
    const classified = classifyToolInvocation('mcp:vendor:zorblat', {});

    expect(classified.category).toBe('network');
    expect(classified.risk).toBe('high');
    expect(isToolBypassable(classified)).toBe(false);
  });

  it('still bypasses an ordinary MCP read', () => {
    const classified = classifyToolInvocation('mcp:vendor:list_tables', {});
    const manager = new ToolApprovalManager();
    manager.enableAutopilot();

    expect(manager.shouldBypass('task-1', classified)).toBe(true);
  });
});

describe('the reason is available, not just the refusal', () => {
  it('explains why a dialog reappeared after autopilot was switched on', () => {
    // A prompt that comes back with no explanation reads as a bug in the
    // bypass, which is how somebody concludes the feature is broken.
    const reason = toolBypassCeiling(classifyToolInvocation('git-push', {}));

    expect(reason).toBeDefined();
    expect(reason).toMatch(/cannot be undone/i);
  });

  it('says nothing about an invocation it does not stop', () => {
    expect(toolBypassCeiling(policy('workspace-write', 'high'))).toBeUndefined();
  });
});
