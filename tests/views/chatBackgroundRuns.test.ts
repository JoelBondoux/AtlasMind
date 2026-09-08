import { describe, expect, it, vi } from 'vitest';

import {
  BackgroundChatRuns,
  createDetachedChatHost,
  describeBackgroundRuns,
  describeBackgroundRunsDetail,
  selectBusyRun,
  shouldDetachOnDispose,
  toBackgroundRunLabel,
} from '../../src/views/chatBackgroundRuns.ts';

/**
 * A chat turn that outlived the window it was typed into.
 *
 * Closing the chat used to abort whatever it was doing — defensible for a
 * deliberate close, and wrong for the case it also covered: VS Code disposes a
 * sidebar view's webview when you click another view, so looking away killed
 * the run. The two are indistinguishable from inside `dispose()`, which is why
 * surviving is made safe rather than guessed at.
 */

function run(taskId: string, label = taskId, stop = () => {}) {
  return { taskId, sessionId: `session-${taskId}`, label, startedAt: 0, stop };
}

describe('deciding whether a closed window takes its work with it', () => {
  it('keeps a run going when the setting allows it', () => {
    expect(shouldDetachOnDispose({ hasActiveRun: true, continueInBackground: true })).toBe(true);
  });

  it('stops as before when the setting is off', () => {
    // Somebody who relies on closing the chat to stop the agent gets exactly
    // the old behaviour, not a version of it.
    expect(shouldDetachOnDispose({ hasActiveRun: true, continueInBackground: false })).toBe(false);
  });

  it('never registers a surface that had nothing running', () => {
    // Said here rather than at the call site, so an empty run cannot reach the
    // registry and leave a status bar announcing work that does not exist.
    expect(shouldDetachOnDispose({ hasActiveRun: false, continueInBackground: true })).toBe(false);
  });
});

describe('the registry is the stop that replaces closing the window', () => {
  it('holds a run until it finishes on its own', () => {
    const runs = new BackgroundChatRuns();
    runs.add(run('a'));
    expect(runs.has('a')).toBe(true);
    runs.remove('a');
    expect(runs.list()).toEqual([]);
  });

  it('removing one that was never there is not an error', () => {
    // The run finishing calls this unconditionally, because it cannot know
    // whether its surface outlived it.
    const runs = new BackgroundChatRuns();
    expect(() => runs.remove('never-registered')).not.toThrow();
  });

  it('stops a run and forgets it before the abort unwinds', () => {
    // The abort unwinds the run, which calls back into `remove`. A registry
    // still holding the entry at that point reports work already told to stop.
    const runs = new BackgroundChatRuns();
    const seen: string[][] = [];
    runs.onDidChange(() => seen.push(runs.list().map(entry => entry.taskId)));
    runs.add(run('a', 'a', () => { seen.push(runs.list().map(entry => entry.taskId)); }));

    expect(runs.stop('a')).toBe(true);

    // add → [a]; the change from stop → []; then the stop callback sees [].
    expect(seen).toEqual([['a'], [], []]);
  });

  it('survives a run that throws on the way out', () => {
    const runs = new BackgroundChatRuns();
    runs.add(run('a', 'a', () => { throw new Error('already gone'); }));
    expect(() => runs.stop('a')).not.toThrow();
    expect(runs.list()).toEqual([]);
  });

  it('stops every run without one failure hiding the rest', () => {
    const stopped: string[] = [];
    const runs = new BackgroundChatRuns();
    runs.add(run('a', 'a', () => { throw new Error('boom'); }));
    runs.add(run('b', 'b', () => { stopped.push('b'); }));

    runs.stopAll();

    expect(stopped).toEqual(['b']);
    expect(runs.list()).toEqual([]);
  });

  it('keeps a listener that throws from silencing the others', () => {
    const runs = new BackgroundChatRuns();
    const seen: number[] = [];
    runs.onDidChange(() => { throw new Error('cannot redraw'); });
    runs.onDidChange(() => seen.push(runs.list().length));

    runs.add(run('a'));

    expect(seen).toEqual([1]);
  });

  it('lets a listener stop being told', () => {
    const runs = new BackgroundChatRuns();
    const listener = vi.fn();
    const subscription = runs.onDidChange(listener);
    subscription.dispose();
    runs.add(run('a'));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('which run a reopened chat adopts', () => {
  function candidate(name: string, sessionId: string, detached = false) {
    return { sessionId, detached, execution: name };
  }

  it('prefers a run on the session being shown', () => {
    // A surface must not report work from a conversation it is not showing.
    const picked = selectBusyRun([candidate('other', 's2'), candidate('mine', 's1')], 's1');
    expect(picked?.execution).toBe('mine');
  });

  it('prefers a live run over a detached one on the same session', () => {
    // Two runs can share a session: close a chat mid-answer, reopen it, ask
    // something else. The one just started is the one being watched, and the
    // detached one is already named in the status bar.
    const picked = selectBusyRun([candidate('detached', 's1', true), candidate('live', 's1')], 's1');
    expect(picked?.execution).toBe('live');
  });

  it('adopts a detached run when that is all there is', () => {
    // The whole point: a reopened chat gets its stop button back rather than
    // being told to go and find the status bar.
    const picked = selectBusyRun([candidate('detached', 's1', true)], 's1');
    expect(picked?.execution).toBe('detached');
  });

  it('falls back to another session, live before detached', () => {
    // Inherited behaviour — `busy` is gated on the session matching, so this
    // only ever supplies the streaming target.
    expect(selectBusyRun([candidate('d', 's9', true), candidate('l', 's8')], 's1')?.execution).toBe('l');
  });

  it('keeps the arrival order when two are equally good', () => {
    // Strictly-better wins only, so the choice cannot shuffle between two
    // identical renders.
    const picked = selectBusyRun([candidate('first', 's1'), candidate('second', 's1')], 's1');
    expect(picked?.execution).toBe('first');
  });

  it('behaves exactly as before when nothing is detached', () => {
    // The rule this replaced was "same session, else the first one". With no
    // detached candidates the new ordering has to agree with it, or adopting a
    // background run would have changed what an ordinary two-panel chat does.
    const all = [candidate('a', 's1'), candidate('b', 's2'), candidate('c', 's3')];
    for (const session of ['s1', 's2', 's3', 'unknown']) {
      const expected = all.find(entry => entry.sessionId === session) ?? all[0];
      expect(selectBusyRun(all, session)?.execution).toBe(expected!.execution);
    }
  });

  it('has nothing to adopt when nothing is running', () => {
    expect(selectBusyRun([], 's1')).toBeUndefined();
  });

  it('still finds a run when no session is named', () => {
    expect(selectBusyRun([candidate('only', 's1', true)])?.execution).toBe('only');
  });
});

describe('what a status bar is allowed to say', () => {
  it('says nothing when nothing is running', () => {
    // An item that is always present is one nobody reads.
    expect(describeBackgroundRuns([])).toBe('');
    expect(describeBackgroundRunsDetail([])).toBe('');
  });

  it('writes singular and plural out rather than counting into one sentence', () => {
    expect(describeBackgroundRuns([run('a')])).toBe('1 chat still running');
    expect(describeBackgroundRuns([run('a'), run('b')])).toBe('2 chats still running');
  });

  it('names each run, so stopping the right one is possible', () => {
    const detail = describeBackgroundRunsDetail([run('a', 'Fix the login redirect'), run('b', 'Write the release notes')]);
    expect(detail).toContain('Fix the login redirect');
    expect(detail).toContain('Write the release notes');
    expect(detail).toContain('reopen AtlasMind Chat');
  });
});

describe('a prompt reduced to something a tooltip can hold', () => {
  it('flattens the newlines a tooltip would render as a shape nobody intended', () => {
    expect(toBackgroundRunLabel('fix the\n\n  login   bug')).toBe('fix the login bug');
  });

  it('strips control characters, because a prompt is user text reaching a UI string', () => {
    const label = toBackgroundRunLabel(`fix${String.fromCharCode(7)}the${String.fromCharCode(27)}bug`);
    expect(label).toBe('fix the bug');
  });

  it('clamps on a word boundary, since a mid-word cut reads as a bug', () => {
    const label = toBackgroundRunLabel('refactor the authentication middleware and every call site that depends on it');
    expect(label.endsWith('…')).toBe(true);
    expect(label.length).toBeLessThanOrEqual(61);
    expect(label).not.toMatch(/\s…$/);
  });

  it('gives an empty prompt something to be called', () => {
    expect(toBackgroundRunLabel('   ')).toBe('a chat turn');
  });
});

describe('the host a detached run draws to', () => {
  it('accepts a post and reports that nothing received it', async () => {
    // The alternative was guarding 104 call sites, which is 104 chances to miss
    // one — and a missed one throws "Webview is disposed" into the middle of a
    // run and ends it, which is the behaviour being removed.
    const host = createDetachedChatHost();
    await expect(host.webview.postMessage({ type: 'status' })).resolves.toBe(false);
  });

  it('reports itself as not visible, which is what a waiting approval checks', () => {
    // `false` rather than absent: the chat uses this to decide whether a tool
    // approval needs announcing, and a detached run is exactly the case where
    // nobody is looking at the chat.
    expect(createDetachedChatHost().visible).toBe(false);
  });

  it('returns something disposable from every subscription', () => {
    const host = createDetachedChatHost();
    expect(() => host.webview.onDidReceiveMessage(() => {}).dispose()).not.toThrow();
    expect(() => host.onDidDispose(() => {}).dispose()).not.toThrow();
  });

  it('offers no way to reveal or focus a surface that is gone', () => {
    const host = createDetachedChatHost();
    expect(host.reveal).toBeUndefined();
    expect(host.show).toBeUndefined();
  });
});
