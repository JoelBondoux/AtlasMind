import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDryRunRecord,
  createDryRunSkillContext,
  createDryRunTurn,
  decideDryRun,
  describeSimulatedResult,
  DRY_RUN_BLOCKED_ERROR_NAME,
  DRY_RUN_BUILTIN_TABLE,
  DRY_RUN_CONTEXT_METHODS,
  DRY_RUN_LEDGER_CAPACITY,
  DRY_RUN_LOOP_TOOLS,
  DRY_RUN_RULES,
  DryRunLedger,
  formatDryRunLedgerLine,
  isDryRunTurn,
  latchDryRun,
  previewDryRunArgs,
  readDryRunSetting,
  recordDryRun,
  summarizeDryRun,
  type DryRunRecord,
} from '../../src/core/dryRun.ts';
import { classifyToolInvocation } from '../../src/core/toolPolicy.ts';
import type { SkillExecutionContext } from '../../src/types.ts';

const ROOT = path.resolve(__dirname, '..', '..');

function record(overrides: Partial<DryRunRecord> = {}): DryRunRecord {
  return buildDryRunRecord({
    at: '2026-10-08T00:00:00.000Z',
    taskId: 'task-1',
    toolName: overrides.toolName ?? 'file-write',
    args: { path: 'notes.md', content: 'x' },
    rule: overrides.rule ?? 'dry-run.default',
    policy: classifyToolInvocation(overrides.toolName ?? 'file-write', {}),
    wouldHaveAsked: true,
  });
}

describe('the rules', () => {
  it('has unique ids, and the last rule simulates', () => {
    const ids = DRY_RUN_RULES.map(rule => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DRY_RUN_RULES.at(-1)).toMatchObject({ id: 'dry-run.default', action: 'simulate' });
  });

  it.each([
    ['quarantine-read', { handle: 'q1' }, { builtIn: true }, 'dry-run.quarantine-release', 'execute'],
    ['find-tool', { query: 'deploy' }, undefined, 'dry-run.find-tool-local', 'execute'],
    ['nothing-has-this-name', {}, undefined, 'dry-run.unknown-skill', 'simulate'],
    ['mcp:crm:list_customers', {}, { builtIn: false }, 'dry-run.not-builtin', 'simulate'],
    ['mcp:crm:list_customers', {}, { builtIn: true }, 'dry-run.not-builtin', 'simulate'],
    ['file-read', { path: 'a' }, { builtIn: false }, 'dry-run.not-builtin', 'simulate'],
    ['custom-deploy', {}, { builtIn: true }, 'dry-run.not-tabled', 'simulate'],
    ['file-read', { path: 'a' }, { builtIn: true }, 'dry-run.local-read', 'execute'],
    ['atlasmind-settings', { action: 'get', key: 'atlasmind.dryRun.enabled' }, { builtIn: true }, 'dry-run.args-read', 'execute'],
    ['atlasmind-settings', { action: 'set', key: 'atlasmind.dryRun.enabled', value: false }, { builtIn: true }, 'dry-run.default', 'simulate'],
    ['file-write', { path: 'a', content: 'b' }, { builtIn: true }, 'dry-run.default', 'simulate'],
    ['web-fetch', { url: 'https://example.com/?q=secret' }, { builtIn: true }, 'dry-run.default', 'simulate'],
    ['terminal-run', { command: 'git', args: ['status'] }, { builtIn: true }, 'dry-run.default', 'simulate'],
  ] as const)('%s %j (%j) → %s / %s', (toolName, args, skill, rule, action) => {
    const decision = decideDryRun({ toolName, args: { ...args }, skill: skill ? { ...skill } : undefined });
    expect(decision.rule).toBe(rule);
    expect(decision.action).toBe(action);
    expect(DRY_RUN_RULES.find(entry => entry.id === rule)?.action).toBe(action);
  });

  it('says whether the call would have asked, under the mode it was given', () => {
    const read = decideDryRun({ toolName: 'file-read', args: {}, skill: { builtIn: true }, approvalMode: 'ask-on-write' });
    expect(read.wouldHaveAsked).toBe(false);
    const write = decideDryRun({ toolName: 'file-write', args: {}, skill: { builtIn: true }, approvalMode: 'ask-on-write' });
    expect(write.wouldHaveAsked).toBe(true);
    const anyRead = decideDryRun({ toolName: 'file-read', args: {}, skill: { builtIn: true }, approvalMode: 'always-ask' });
    expect(anyRead.wouldHaveAsked).toBe(true);
  });

  it('carries the non-bypassable ceiling and the provenance escalation', () => {
    const push = decideDryRun({ toolName: 'git-push', args: { branch: 'main' }, skill: { builtIn: true } });
    expect(push.ceiling).toBeTruthy();
    const tainted = decideDryRun({
      toolName: 'file-write', args: {}, skill: { builtIn: true }, approvalMode: 'allow-safe-readonly',
      escalation: { decision: 'fresh-approval', rule: 'taint.workspace-write' },
    });
    expect(tainted.escalation).toEqual({ decision: 'fresh-approval', rule: 'taint.workspace-write' });
    expect(tainted.wouldHaveAsked).toBe(true);
    const free = decideDryRun({ toolName: 'file-write', args: {}, skill: { builtIn: true }, escalation: { decision: 'free', rule: 'taint.out-of-scope' } });
    expect(free.escalation).toBeUndefined();
  });

  /**
   * The property the mode exists for: a call runs only when it is a built-in
   * whose effective class this time is a local read — or one of the two tools
   * the loop answers from what it already holds.
   */
  it('execute ⇒ a built-in local read (or a loop tool)', () => {
    const names = fc.oneof(
      fc.constantFrom(...Object.keys(DRY_RUN_BUILTIN_TABLE)),
      fc.constantFrom(DRY_RUN_LOOP_TOOLS.findTool, DRY_RUN_LOOP_TOOLS.quarantineRelease),
      fc.string().map(name => `mcp:srv:${name}`),
      fc.string(),
    );
    const args = fc.dictionary(
      fc.constantFrom('action', 'path', 'key', 'command', 'args', 'remote', 'url'),
      fc.oneof(fc.constantFrom('get', 'set', 'list', 'delete', 'show', 'git', 'npm'), fc.boolean(), fc.array(fc.string())),
    );
    const skill = fc.option(fc.record({ builtIn: fc.option(fc.boolean(), { nil: undefined }) }), { nil: undefined });
    fc.assert(fc.property(names, args, skill, (toolName, toolArgs, registered) => {
      const decision = decideDryRun({ toolName, args: toolArgs, skill: registered });
      if (decision.action !== 'execute') {
        return;
      }
      if (toolName === DRY_RUN_LOOP_TOOLS.findTool || toolName === DRY_RUN_LOOP_TOOLS.quarantineRelease) {
        return;
      }
      expect(registered?.builtIn).toBe(true);
      expect(toolName.startsWith('mcp:')).toBe(false);
      const row = DRY_RUN_BUILTIN_TABLE[toolName as keyof typeof DRY_RUN_BUILTIN_TABLE];
      expect(row).toBeDefined();
      const effective = row.class === 'local-read'
        || (row.class === 'args' && ['read', 'git-read'].includes(classifyToolInvocation(toolName, toolArgs).category));
      expect(effective).toBe(true);
    }), { numRuns: 500 });
  });

  it('never executes a name it has not tabled, whatever it claims to be', () => {
    fc.assert(fc.property(fc.string(), fc.boolean(), (name, builtIn) => {
      fc.pre(!Object.prototype.hasOwnProperty.call(DRY_RUN_BUILTIN_TABLE, name));
      fc.pre(name !== DRY_RUN_LOOP_TOOLS.findTool && name !== DRY_RUN_LOOP_TOOLS.quarantineRelease);
      expect(decideDryRun({ toolName: name, args: {}, skill: { builtIn } }).action).toBe('simulate');
    }));
  });

  it('gives every row a reason', () => {
    for (const [id, row] of Object.entries(DRY_RUN_BUILTIN_TABLE)) {
      expect(row.reason.length, id).toBeGreaterThan(10);
    }
  });
});

describe('the setting', () => {
  it('is off only for false or absent; anything unreadable reads as on', () => {
    expect(readDryRunSetting(false)).toBe(false);
    expect(readDryRunSetting(undefined)).toBe(false);
    expect(readDryRunSetting(null)).toBe(false);
    expect(readDryRunSetting(true)).toBe(true);
    expect(readDryRunSetting('false')).toBe(true);
    expect(readDryRunSetting(0)).toBe(true);
  });
});

describe('sticky for the turn', () => {
  it('turns on at once and stays on until the turn ends', () => {
    const turn = createDryRunTurn(false);
    expect(latchDryRun(turn, false)).toBe(false);
    expect(latchDryRun(turn, true)).toBe(true);
    expect(latchDryRun(turn, false)).toBe(true);
  });

  it('a turn that started dry stays dry when the setting goes off', () => {
    const turn = createDryRunTurn(true);
    expect(latchDryRun(turn, false)).toBe(true);
  });

  it('recognises a cell and refuses anything shaped otherwise', () => {
    expect(isDryRunTurn(createDryRunTurn(false))).toBe(true);
    expect(isDryRunTurn({ active: 'yes', records: [] })).toBe(false);
    expect(isDryRunTurn(undefined)).toBe(false);
  });
});

describe('the context backstop', () => {
  /** Every member of SkillExecutionContext, read from the interface rather than the table. */
  function declaredContextMembers(): string[] {
    const source = readFileSync(path.join(ROOT, 'src', 'types.ts'), 'utf8');
    const start = source.indexOf('export interface SkillExecutionContext {');
    const body = source.slice(start, source.indexOf('\n}', start));
    return [...body.matchAll(/^ {2}(\w+)\??[(:]/gm)].map(match => match[1]!);
  }

  it('grades every member the interface declares, and nothing else', () => {
    expect(Object.keys(DRY_RUN_CONTEXT_METHODS).sort()).toEqual(declaredContextMembers().sort());
  });

  function fullContext(): { context: SkillExecutionContext; calls: string[] } {
    const calls: string[] = [];
    const context: Record<string, unknown> = { workspaceRootPath: '/workspace' };
    for (const member of Object.keys(DRY_RUN_CONTEXT_METHODS)) {
      if (member === 'workspaceRootPath') {
        continue;
      }
      context[member] = vi.fn((..._args: unknown[]) => {
        calls.push(member);
        return member === 'withResolutionRoot' ? context : Promise.resolve(undefined);
      });
    }
    return { context: context as unknown as SkillExecutionContext, calls };
  }

  it('passes reads through, refuses every effect, and names the method it refused', async () => {
    const { context, calls } = fullContext();
    const blocked: string[] = [];
    const wrapped = createDryRunSkillContext(context, method => blocked.push(method));
    for (const [member, kind] of Object.entries(DRY_RUN_CONTEXT_METHODS)) {
      const value = (wrapped as unknown as Record<string, unknown>)[member];
      if (member === 'workspaceRootPath') {
        expect(value).toBe('/workspace');
        continue;
      }
      expect(typeof value, member).toBe('function');
      const fn = value as (...args: unknown[]) => unknown;
      if (kind === 'effect') {
        expect(() => fn('x'), member).toThrow(expect.objectContaining({ name: DRY_RUN_BLOCKED_ERROR_NAME }));
      } else {
        await fn('x');
      }
    }
    const effects = Object.entries(DRY_RUN_CONTEXT_METHODS).filter(([, kind]) => kind === 'effect').map(([member]) => member);
    expect(calls.filter(member => effects.includes(member))).toEqual([]);
    expect(blocked.sort()).toEqual(effects.sort());
  });

  it('wraps a derived context the same way', () => {
    const { context, calls } = fullContext();
    const wrapped = createDryRunSkillContext(context, () => undefined);
    const derived = wrapped.withResolutionRoot!('/workspace/.git/wt');
    expect(() => derived.writeFile('/workspace/a', 'x')).toThrow(expect.objectContaining({ name: DRY_RUN_BLOCKED_ERROR_NAME }));
    expect(calls).toEqual(['withResolutionRoot']);
  });

  it('leaves out members the table does not name and optional ones the host lacks', () => {
    const context = {
      workspaceRootPath: '/w',
      readFile: vi.fn(),
      smuggled: vi.fn(),
    } as unknown as SkillExecutionContext;
    const wrapped = createDryRunSkillContext(context, () => undefined) as unknown as Record<string, unknown>;
    expect(wrapped['smuggled']).toBeUndefined();
    expect(wrapped['launchDebugSession']).toBeUndefined();
    expect(typeof wrapped['readFile']).toBe('function');
  });
});

describe('what the model and the operator are told', () => {
  it('says nothing ran, what would have, and keeps a secret out of the preview', () => {
    const args = { url: 'https://example.com/hook', headers: { Authorization: 'Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123' } };
    const decision = decideDryRun({ toolName: 'http-request', args, skill: { builtIn: true } });
    const text = describeSimulatedResult('http-request', decision, previewDryRunArgs(args));
    expect(text.startsWith('[DRY RUN — nothing was executed]')).toBe(true);
    expect(text).toContain('Would have asked for approval: yes');
    expect(text).toContain('do not claim that it happened');
    expect(text).not.toContain('abcdefghijklmnopqrstuvwxyz0123');
  });

  it('records a fingerprint that ignores key order', () => {
    const one = buildDryRunRecord({ at: 'a', taskId: 't', toolName: 'x', args: { a: 1, b: 2 }, rule: 'r', policy: classifyToolInvocation('x', {}), wouldHaveAsked: false });
    const two = buildDryRunRecord({ at: 'a', taskId: 't', toolName: 'x', args: { b: 2, a: 1 }, rule: 'r', policy: classifyToolInvocation('x', {}), wouldHaveAsked: false });
    expect(one.argsFingerprint).toBe(two.argsFingerprint);
  });

  it('summarises a dry turn, states what the cap left out, and says nothing for a live one', () => {
    expect(summarizeDryRun(createDryRunTurn(false))).toBeUndefined();
    const empty = createDryRunTurn(true);
    expect(summarizeDryRun(empty)).toContain('asked for nothing that would have acted');

    const turn = createDryRunTurn(true);
    for (let index = 0; index < 205; index += 1) {
      recordDryRun(turn, record());
    }
    recordDryRun(turn, record({ rule: 'dry-run.backstop', toolName: 'context.writeFile' }));
    turn.executedReads = 2;
    const summary = summarizeDryRun(turn)!;
    expect(turn.records.length).toBe(200);
    expect(turn.omittedRecords).toBe(6);
    expect(summary).toContain('**Dry run — nothing was executed.**');
    expect(summary).toContain('2 local reads run');
    expect(summary).toMatch(/…and \d+ more/);
  });

  it('formats a ledger line with the rule and the fingerprint, not the arguments', () => {
    const line = formatDryRunLedgerLine(record());
    expect(line).toContain('dry-run.default');
    expect(line).toMatch(/args#[0-9a-f]{16}/);
  });
});

describe('the ledger', () => {
  it('keeps the newest records, counts what it dropped, and survives a failing listener', () => {
    const ledger = new DryRunLedger(3);
    const seen: string[] = [];
    ledger.onRecord(() => { throw new Error('listener broke'); });
    const stop = ledger.onRecord(entry => seen.push(entry.taskId));
    for (let index = 0; index < 5; index += 1) {
      ledger.record({ ...record(), taskId: `t${index}` });
    }
    expect(ledger.list().map(entry => entry.taskId)).toEqual(['t2', 't3', 't4']);
    expect(ledger.dropped()).toBe(2);
    expect(seen).toHaveLength(5);
    stop();
    ledger.record(record());
    expect(seen).toHaveLength(5);
    expect(DRY_RUN_LEDGER_CAPACITY).toBe(500);
  });
});
