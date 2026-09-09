import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The auto-updater rewrites an agent's system prompt on a cadence and registers
 * the result — a prompt edit deployed with no failing build. The gate is the
 * whole reason the eval harness exists, so three properties of the wiring are
 * pinned here: it runs **before** the rewrite is registered, an unverified
 * rewrite is **held**, and a verifier that throws does not count as a pass.
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), 'src', 'core', 'agentAutoUpdater.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('the gate runs before anything is registered', () => {
  it('decides the hold before register and save', () => {
    const decide = SOURCE.indexOf('const decision = await this.decideHold(');
    const register = SOURCE.indexOf('this.agents.register(updated);');
    expect(decide).toBeGreaterThan(0);
    expect(register).toBeGreaterThan(decide);
  });

  it('returns the original agent when held', () => {
    expect(SOURCE).toContain('if (decision.hold) {');
    expect(SOURCE).toContain('return agent;');
  });

  it('does not gate a run that produced no change', () => {
    // performUpdate returns the original agent on every failure path, and
    // replaying golden cases against an unchanged definition would spend money
    // to learn nothing.
    expect(SOURCE).toContain('if (updated === agent) {');
  });
});

describe('an unverified rewrite is held, not shipped', () => {
  it('passes an absent verdict straight to the gate', () => {
    expect(SOURCE).toContain('shouldHoldAgentUpdate(undefined, declared)');
  });

  it('treats a throwing verifier as unverified rather than as a pass', () => {
    const start = SOURCE.indexOf('private async decideHold(');
    const body = SOURCE.slice(start, SOURCE.indexOf('\n  private async performUpdate(', start));
    expect(body).toContain('has not verified anything');
  });

  it('holds nothing when no verifier is configured, and says so', () => {
    const start = SOURCE.indexOf('private async decideHold(');
    const body = SOURCE.slice(start, SOURCE.indexOf('\n  private async performUpdate(', start));
    expect(body).toContain('was not checked against anything');
  });
});

describe('a held update is recorded', () => {
  it('keeps why, so a surface can say why an agent stopped updating', () => {
    // An update that silently stops happening is indistinguishable from one
    // that never came due.
    expect(SOURCE).toContain('heldUpdate(agentId: string)');
    expect(SOURCE).toContain('this.lastHold.set(agent.id, decision)');
    expect(SOURCE).toContain('this.lastHold.delete(agent.id)');
  });
});
