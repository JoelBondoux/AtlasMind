import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  buildHostDryRunRecord,
  classifyHostCommand,
  describeHostDryRunNotice,
  DRY_RUN_BLOCKED_ERROR_NAME,
  DRY_RUN_HOST_EFFECTS,
  DRY_RUN_HOST_EXEMPTIONS,
  DryRunBlockedError,
  DryRunLedger,
  isDryRunBlockedError,
  type DryRunHostEffect,
} from '../../src/core/dryRun.ts';
import {
  DryRunHost,
  guardDryRun,
  guardHostCommand,
  installDryRunHost,
  interceptDryRun,
  isDryRunActive,
} from '../../src/core/dryRunHost.ts';

const EFFECT: DryRunHostEffect = {
  surface: 'routine',
  kind: 'process',
  summary: 'run the "ship" routine (2 steps)',
  details: { steps: ['npm run build', 'npm publish --token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'] },
};

let uninstall: (() => void) | undefined;

function install(enabled: unknown, notify = vi.fn()) {
  const ledger = new DryRunLedger();
  const host = new DryRunHost({ isEnabled: () => enabled, record: record => ledger.record(record), notify, now: () => new Date('2026-10-08T00:00:00Z') });
  uninstall = installDryRunHost(host);
  return { ledger, host, notify };
}

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

describe('DryRunHost', () => {
  it('reads as off in a process that installed no host', () => {
    expect(isDryRunActive()).toBe(false);
    expect(interceptDryRun(EFFECT)).toBeUndefined();
    expect(() => guardDryRun(EFFECT)).not.toThrow();
    expect(() => guardHostCommand('test', 'git', ['push'])).not.toThrow();
  });

  it('records nothing and lets the effect run when dry run is off', () => {
    const { ledger, notify } = install(false);
    expect(isDryRunActive()).toBe(false);
    expect(interceptDryRun(EFFECT)).toBeUndefined();
    expect(ledger.list()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('records, and tells the person who asked, when dry run is on', () => {
    const { ledger, notify } = install(true);
    const record = interceptDryRun(EFFECT);
    expect(record).toBeDefined();
    expect(ledger.list()).toEqual([record]);
    expect(record).toMatchObject({ taskId: 'host:routine', toolName: 'routine', rule: 'dry-run.host-process', category: 'terminal-write', risk: 'high' });
    expect(notify).toHaveBeenCalledTimes(1);
    const notice = notify.mock.calls[0]![0] as string;
    expect(notice).toContain('Dry run is on');
    expect(notice).toContain('run the "ship" routine');
  });

  it('reads a malformed setting, or a reader that throws, as on', () => {
    install('yes please');
    expect(isDryRunActive()).toBe(true);
    uninstall?.();
    const host = new DryRunHost({ isEnabled: () => { throw new Error('unreadable'); }, record: () => undefined });
    uninstall = installDryRunHost(host);
    expect(isDryRunActive()).toBe(true);
  });

  it('keeps automatic writes quiet but still recorded', () => {
    const { ledger, notify } = install(true);
    interceptDryRun({ ...EFFECT, kind: 'auto-write', userInitiated: false });
    expect(ledger.list()).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('raises one notice for one press, not one per step', () => {
    const { ledger, notify } = install(true);
    interceptDryRun(EFFECT);
    interceptDryRun(EFFECT);
    expect(ledger.list()).toHaveLength(2);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('never stores the arguments, only a fingerprint and a redacted preview', () => {
    const { ledger } = install(true);
    interceptDryRun(EFFECT);
    const [record] = ledger.list();
    expect(record!.argsPreview).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(record!.argsFingerprint).toMatch(/^[0-9a-f]+$/);
  });

  it('refuses, even when the ledger or the notifier throws', () => {
    const host = new DryRunHost({
      isEnabled: () => true,
      record: () => { throw new Error('ledger down'); },
      notify: () => { throw new Error('ui down'); },
    });
    uninstall = installDryRunHost(host);
    expect(interceptDryRun(EFFECT)).toBeDefined();
  });

  it('throws a DryRunBlocked error a caller can recognise', () => {
    install(true);
    let caught: unknown;
    try {
      guardDryRun(EFFECT);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DryRunBlockedError);
    expect((caught as Error).name).toBe(DRY_RUN_BLOCKED_ERROR_NAME);
    expect(isDryRunBlockedError(caught)).toBe(true);
    expect(isDryRunBlockedError(new Error('other'))).toBe(false);
  });

  it('lets reads through guardHostCommand and refuses writes', () => {
    const { ledger } = install(true);
    expect(() => guardHostCommand('dashboard', 'git', ['status', '--porcelain'])).not.toThrow();
    expect(() => guardHostCommand('dashboard', 'gh', ['issue', 'list', '--json', 'number'])).not.toThrow();
    expect(ledger.list()).toEqual([]);
    expect(() => guardHostCommand('dashboard', 'git', ['push', 'origin', '--delete', 'feat/x'])).toThrow(DryRunBlockedError);
    expect(() => guardHostCommand('dashboard', 'gh', ['issue', 'create', '--title', 'x'])).toThrow(DryRunBlockedError);
    expect(ledger.list().map(record => record.rule)).toEqual(['dry-run.host-git', 'dry-run.host-github']);
  });

  it('only uninstalls the host it installed', () => {
    const first = new DryRunHost({ isEnabled: () => true, record: () => undefined });
    const second = new DryRunHost({ isEnabled: () => true, record: () => undefined });
    const removeFirst = installDryRunHost(first);
    uninstall = installDryRunHost(second);
    removeFirst();
    expect(isDryRunActive()).toBe(true);
  });
});

describe('classifyHostCommand', () => {
  const reads: Array<[string, string[]]> = [
    ['git', ['status', '--porcelain']],
    ['git', ['-C', '/repo', 'branch', '--format=%(refname:short)']],
    ['git', ['branch', '--show-current']],
    ['git', ['branch', '--list', 'feat/*']],
    ['git', ['log', '--oneline', '-5']],
    ['git', ['rev-parse', '--abbrev-ref', 'HEAD']],
    ['git', ['config', '--get', 'user.name']],
    ['git', ['config', 'user.email']],
    ['git', ['remote']],
    ['git', ['remote', 'get-url', 'origin']],
    ['git', ['tag', '--list']],
    ['git', ['symbolic-ref', '--quiet', '--short', 'HEAD']],
    ['git', ['ls-remote', 'origin']],
    ['git', ['check-ref-format', '--branch', 'x']],
    ['gh', ['issue', 'list', '--json', 'number']],
    ['gh', ['pr', 'view', '12']],
    ['gh', ['repo', 'view', '--json', 'nameWithOwner']],
    ['gh', ['api', 'repos/o/r/milestones']],
    ['gh', ['api', '-X', 'GET', 'user']],
    ['gh', ['auth', 'status']],
    ['docker', ['info', '--format', '{{json .}}']],
    ['docker', ['image', 'inspect', 'x']],
    ['docker', ['logs', 'runner']],
    ['node', ['--version']],
    ['hugo', ['version']],
    ['C:\\Program Files\\Git\\cmd\\git.exe', ['status']],
  ];
  const effects: Array<[string, string[], string]> = [
    ['git', ['push', 'origin', 'main'], 'git'],
    ['git', ['fetch', '--all'], 'git'],
    ['git', ['pull', '--ff-only'], 'git'],
    ['git', ['switch', 'main'], 'git'],
    ['git', ['branch', '-d', '--', 'feat/x'], 'git'],
    ['git', ['branch', 'feat/new', 'abc123'], 'git'],
    ['git', ['config', 'user.name', 'Somebody'], 'git'],
    ['git', ['config', '--unset', 'user.name'], 'git'],
    ['git', ['remote', 'add', 'x', 'https://example.com'], 'git'],
    ['git', ['tag', 'v1.0.0'], 'git'],
    ['git', ['stash'], 'git'],
    ['git', ['worktree', 'remove', 'x'], 'git'],
    ['git', ['diff', '--output=patch.diff'], 'git'],
    ['git', ['commit', '-m', 'x'], 'git'],
    ['git', [], 'git'],
    ['gh', ['issue', 'create', '--title', 'x'], 'github'],
    ['gh', ['issue', 'close', '12'], 'github'],
    ['gh', ['label', 'delete', 'bug'], 'github'],
    ['gh', ['run', 'cancel', '9'], 'github'],
    ['gh', ['api', '--method', 'POST', 'repos/o/r/statuses/sha'], 'github'],
    ['gh', ['api', '-XPATCH', 'repos/o/r'], 'github'],
    ['gh', ['api', 'repos/o/r/issues', '-f', 'title=x'], 'github'],
    ['gh', ['api', 'graphql', '-F', 'query=@q.graphql'], 'github'],
    ['gh', ['release', 'download', 'v1'], 'github'],
    ['gh', ['repo', 'create', 'x', '--public'], 'github'],
    ['docker', ['run', '--rm', 'x'], 'process'],
    ['docker', ['rm', '--force', 'x'], 'process'],
    ['docker', ['logs', '--follow', 'x'], 'process'],
    ['docker', ['desktop', 'start'], 'process'],
    ['npm', ['run', 'build'], 'process'],
    ['npm', ['test'], 'process'],
    ['winget', ['install', 'GitHub.cli'], 'process'],
    ['node', ['script.js', '--version'], 'process'],
  ];

  it.each(reads)('grades %s %j a read', (command, args) => {
    expect(classifyHostCommand(command, args).kind).toBe('read');
  });

  it.each(effects)('grades %s %j an effect', (command, args, effect) => {
    const grade = classifyHostCommand(command, args);
    expect(grade).toMatchObject({ kind: 'effect', effect });
  });

  it('grades any executable it does not know as an effect unless asked only for a version', () => {
    fc.assert(fc.property(
      fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/).filter(name => !['git', 'gh', 'docker'].includes(name)),
      fc.array(fc.string({ maxLength: 12 }), { minLength: 1, maxLength: 4 }),
      (command, args) => {
        const grade = classifyHostCommand(command, args);
        const versionProbe = args.length === 1 && ['--version', '-v', '-V', 'version', '--help', '-h'].includes(args[0]!.trim());
        expect(grade.kind).toBe(versionProbe ? 'read' : 'effect');
      },
    ));
  });

  it('grades any git subcommand outside the published read set as an effect', () => {
    const readish = new Set([
      'status', 'log', 'diff', 'show', 'rev-parse', 'rev-list', 'merge-base', 'for-each-ref', 'describe',
      'ls-files', 'ls-tree', 'ls-remote', 'cat-file', 'blame', 'shortlog', 'name-rev', 'grep', 'var',
      'version', 'count-objects', 'show-ref', 'cherry', 'check-ref-format', 'check-ignore', 'check-attr',
      'whatchanged', 'help', 'branch', 'tag', 'remote', 'config', 'stash', 'worktree', 'symbolic-ref',
    ]);
    fc.assert(fc.property(
      fc.stringMatching(/^[a-z][a-z-]{1,14}$/).filter(sub => !readish.has(sub)),
      fc.array(fc.stringMatching(/^[a-z0-9./-]{1,10}$/), { maxLength: 3 }),
      (subcommand, rest) => {
        expect(classifyHostCommand('git', [subcommand, ...rest]).kind).toBe('effect');
      },
    ));
  });

  it('never lets a gh api call that carries a field through as a read, whatever else it says', () => {
    fc.assert(fc.property(
      fc.constantFrom('-f', '-F', '--field', '--raw-field', '--input'),
      fc.array(fc.constantFrom('-X', 'GET', '--jq', '.x', 'repos/o/r'), { maxLength: 4 }),
      (flag, noise) => {
        expect(classifyHostCommand('gh', ['api', ...noise, flag, 'a=b']).kind).toBe('effect');
      },
    ));
  });
});

describe('the host rule table', () => {
  it('names a distinct rule for every kind', () => {
    const rules = Object.values(DRY_RUN_HOST_EFFECTS).map(row => row.rule);
    expect(new Set(rules).size).toBe(rules.length);
    for (const rule of rules) {
      expect(rule).toMatch(/^dry-run\.host-[a-z-]+$/);
    }
  });

  it('publishes the exemptions it allows, each with a reason', () => {
    expect(DRY_RUN_HOST_EXEMPTIONS.map(entry => entry.id)).toEqual([
      'dry-run.exempt-read',
      'dry-run.exempt-model-call',
      'dry-run.exempt-operator-save',
      'dry-run.exempt-own-bookkeeping',
    ]);
    for (const entry of DRY_RUN_HOST_EXEMPTIONS) {
      expect(entry.description.length).toBeGreaterThan(60);
    }
  });

  it('builds a record with the tool-loop shape, so one ledger holds both', () => {
    const record = buildHostDryRunRecord({ ...EFFECT, surface: 'Promotion Runner!' }, '2026-10-08T00:00:00.000Z');
    expect(Object.keys(record).sort()).toEqual([
      'argsFingerprint', 'argsPreview', 'at', 'category', 'risk', 'rule', 'summary', 'taskId', 'toolName', 'wouldHaveAsked',
    ]);
    expect(record.toolName).toBe('promotion-runner-');
    expect(describeHostDryRunNotice(record)).toMatch(/^Dry run is on, so AtlasMind did not run the "ship" routine/);
  });
});
