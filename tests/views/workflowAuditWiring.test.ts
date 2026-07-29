import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The audit record is only worth having if it is complete, and completeness is
 * a property of the *call sites*, not of the module. Three things have to hold
 * and none of them can be type-checked:
 *
 * - the record is written **before** the action, not after;
 * - a record that cannot be written **stops** the action;
 * - what gets recorded is a **fingerprint**, never the payload — this ledger is
 *   committed, and issue bodies and review comments are third-party text.
 *
 * These read the real source so a later edit cannot quietly drop one.
 */

const PANEL = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
);

const AUDIT = readFileSync(
  path.join(process.cwd(), 'src', 'core', 'workflowAuditRecord.ts'),
  'utf8',
);

/** The body of a named private method, up to the next `private` or `public`. */
function methodSource(name: string): string {
  // `runRecorded<T>` carries a type parameter, so the opening paren does not
  // immediately follow the name.
  const start = PANEL.search(new RegExp(`private async ${name}\\b`));
  expect(start, `${name} is missing from the panel`).toBeGreaterThan(-1);
  const end = PANEL.indexOf('\n  private ', start + 10);
  return PANEL.slice(start, end === -1 ? undefined : end);
}

describe('record, then act', () => {
  const runner = methodSource('runRecorded');

  it('writes the opening record before calling the action', () => {
    // A record written afterwards is missing exactly when it matters most,
    // because the run that crashed is the run somebody needs to read about.
    const recordAt = runner.indexOf('await this.auditLedger.record(opened)');
    const actAt = runner.indexOf('await act()');
    expect(recordAt).toBeGreaterThan(-1);
    expect(actAt).toBeGreaterThan(recordAt);
  });

  it('returns without acting when the record cannot be written', () => {
    // The whole point of the ledger is that it is complete. An action that
    // quietly skipped its record because a disk was full would be the one
    // nobody could account for later.
    const recordAt = runner.indexOf('await this.auditLedger.record(opened)');
    const returnAt = runner.indexOf('return undefined;', recordAt);
    const actAt = runner.indexOf('await act()');
    expect(returnAt).toBeGreaterThan(recordAt);
    expect(returnAt).toBeLessThan(actAt);
  });

  it('says why it refused rather than failing silently', () => {
    expect(runner).toMatch(/could not write its audit record/);
    expect(runner).toMatch(/nobody could account for later/);
  });

  it('closes the record as failed when the action throws', () => {
    expect(runner).toContain("outcome: 'failed'");
  });
});

describe('what reaches the committed ledger', () => {
  it('fingerprints inputs rather than storing them', () => {
    // `project_memory/` is git-tracked. Storing what was processed would commit
    // issue bodies, review comments and CI logs into the repository.
    expect(AUDIT).toContain('inputsFingerprint');
    expect(AUDIT).toMatch(/git-tracked/);
    // The record type has no field that could hold a payload.
    const recordType = AUDIT.slice(
      AUDIT.indexOf('export interface WorkflowRunRecord {'),
      AUDIT.indexOf('export interface WorkflowHistoryFile {'),
    );
    expect(recordType).not.toMatch(/\binputs\??:/);
    expect(recordType).not.toMatch(/\boutputs\??:/);
    expect(recordType).not.toMatch(/\bbody\??:/);
  });

  it('records an actor coarsely, never a name or an address', () => {
    // The file is committed, so a name here would be personal data in a public
    // repository — and git already records who committed, far better.
    expect(AUDIT).toContain("export type WorkflowActor = 'user' | 'agent' | 'automation';");
  });

  it('passes only the argv array and the repository as inputs at each call site', () => {
    for (const method of ['handleIssueWrite', 'handlePullRequestWrite']) {
      const source = methodSource(method);
      expect(source, method).toContain('inputs: { repo: slug, action: message.type, args }');
    }
  });
});

describe('the issue-write ladder gate', () => {
  const handler = methodSource('handleIssueWrite');

  it('consults the ladder before building or sending anything', () => {
    // `allowIssueWrites` shipped as a documented safety switch that nothing
    // consulted. A switch somebody can turn off believing it stops issue
    // writes, which it did not, is a false assurance.
    const gateAt = handler.indexOf("this.automationFor('issueWrites'");
    const sendAt = handler.indexOf('await runGh(');
    expect(gateAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(gateAt);
  });

  it('returns rather than falling through when the ladder refuses', () => {
    const gateAt = handler.indexOf('if (!permits(decision.level, FIRST_WRITING_LEVEL))');
    const returnAt = handler.indexOf('return;', gateAt);
    const sendAt = handler.indexOf('await runGh(');
    expect(gateAt).toBeGreaterThan(-1);
    expect(returnAt).toBeGreaterThan(gateAt);
    expect(returnAt).toBeLessThan(sendAt);
  });

  it('records the refusal, so a blocked action is still accounted for', () => {
    expect(handler).toContain('this.recordRefusal(');
  });

  it('names the gate that refused, so nobody toggles four settings at random', () => {
    expect(handler).toContain('decision.detail');
  });
});

describe('a refusal is recorded best-effort, not blockingly', () => {
  const refusal = methodSource('recordRefusal');

  it('swallows a write failure, because nothing was about to happen', () => {
    // The blocking rule exists to stop an *action* going unaccounted for. A
    // refusal has no action, so failing to record it cannot create that gap —
    // and blocking there would turn a refusal into an error.
    expect(refusal).toMatch(/nothing happened, so there is nothing unaccounted for/i);
    expect(refusal).toContain("outcome: 'refused'");
  });
});
