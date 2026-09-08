import type * as vscode from 'vscode';

import type { ChatPanelHost } from './chatPanel.js';

/**
 * A chat turn that outlived the window it was typed into.
 *
 * Closing a chat surface used to abort whatever it was doing. That is defensible
 * for a deliberate close and indefensible for the case it also covered: a
 * sidebar view is *disposed by VS Code* when you click another view, so looking
 * away killed the run. The two are indistinguishable from inside `dispose()`,
 * which is why the answer is to make surviving safe rather than to guess which
 * one happened.
 *
 * What makes it safe is that the transcript was never the webview's. Every
 * streamed chunk is written to `sessionConversation` before it is pushed to the
 * browser — the panel says so about itself — so a run with nowhere to draw is
 * still a run whose output is being recorded, and reopening the chat shows the
 * finished answer.
 *
 * Three rules:
 *
 * **A detached run is announced, never silent.** It is still spending money and
 * may still be editing files. A run nobody can see is the one thing worse than a
 * run that stopped: `describeBackgroundRuns` exists so a surface cannot report
 * this in its own words and get it wrong.
 *
 * **It stays stoppable.** The registry holds the abort, so closing the window is
 * no longer the way to stop a run and there is still a way.
 *
 * **Detaching is not the default answer to a disposal.** A surface that has
 * nothing running is simply gone, and a caller that says not to keep runs gets
 * the old behaviour exactly — see `shouldDetachOnDispose`.
 */

export interface BackgroundChatRun {
  /** The task the orchestrator knows this run by. */
  taskId: string;
  /** The session its answer is being written into. Reopening this shows the result. */
  sessionId: string;
  /** What the run was asked to do, already clamped for display. */
  label: string;
  startedAt: number;
  /** Ends the run. The registry holds it so a closed window is not the only stop. */
  stop: () => void;
}

/** Longest prompt fragment carried as a label. Long enough to recognise, short enough for a tooltip. */
const MAX_LABEL_LENGTH = 60;

/**
 * Reduce a prompt to something safe to show in a status-bar tooltip.
 *
 * Control characters are stripped because the prompt is user text that reaches a
 * UI string, and newlines in a tooltip produce a shape nobody intended. Clamped
 * on a word boundary where there is one, since a mid-word cut reads as a bug
 * rather than as an abbreviation.
 */
export function toBackgroundRunLabel(prompt: string): string {
  const flattened = String(prompt ?? '')
    // Built from a string rather than written as a literal so the control
    // characters it matches are not themselves control characters in this file.
    .replace(new RegExp('[\\u0000-\\u001F\\u007F]', 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (flattened.length === 0) {
    return 'a chat turn';
  }
  if (flattened.length <= MAX_LABEL_LENGTH) {
    return flattened;
  }
  const clamped = flattened.slice(0, MAX_LABEL_LENGTH);
  const lastSpace = clamped.lastIndexOf(' ');
  return `${(lastSpace > MAX_LABEL_LENGTH / 2 ? clamped.slice(0, lastSpace) : clamped).trimEnd()}…`;
}

/**
 * Whether a disposal should keep the run going.
 *
 * Deliberately not "is the setting on" alone. A surface with nothing running has
 * nothing to keep, and saying so here rather than at the call site is what stops
 * an empty run being registered and a status bar claiming work that does not
 * exist.
 */
export function shouldDetachOnDispose(input: {
  hasActiveRun: boolean;
  continueInBackground: boolean;
}): boolean {
  return input.hasActiveRun && input.continueInBackground;
}

/**
 * What to say about the runs still going, or nothing.
 *
 * Empty when there are none, because a status-bar item that is always present
 * is one nobody reads. Singular and plural are written out rather than counted
 * into one sentence: "1 chats" is the sort of thing that makes people trust a
 * surface less than the number deserves.
 */
export function describeBackgroundRuns(runs: readonly BackgroundChatRun[]): string {
  if (runs.length === 0) {
    return '';
  }
  return runs.length === 1
    ? '1 chat still running'
    : `${runs.length} chats still running`;
}

/** The tooltip: what each one is, so stopping the right one is possible. */
export function describeBackgroundRunsDetail(runs: readonly BackgroundChatRun[]): string {
  if (runs.length === 0) {
    return '';
  }
  const lines = runs.map(run => `• ${run.label}`);
  return [
    runs.length === 1
      ? 'A chat is still running after its window closed.'
      : `${runs.length} chats are still running after their windows closed.`,
    ...lines,
    '',
    'Their answers are being written to the chat session — reopen AtlasMind Chat to read them.',
  ].join('\n');
}

/**
 * A run a chat surface could show and stop, and whether its own window is gone.
 *
 * Generic over the execution so this file stays free of the panel's internals —
 * it decides *which* run a surface adopts, not what a run is.
 */
export interface BusyRunCandidate<T> {
  sessionId: string;
  /** True when the surface that started it has been disposed. */
  detached: boolean;
  execution: T;
}

/**
 * Which run a chat surface shows as busy, and stops when asked.
 *
 * The panel already adopted runs started in *another open* panel — busy state
 * and the stop button both resolve through one lookup across every live
 * surface. A detached run was invisible to it for one reason: its panel left
 * the live set. Feeding those candidates in is the whole of the adoption, so a
 * reopened chat gets the stop button back rather than being told to use the
 * status bar.
 *
 * The order is declared rather than incidental. **This session first**, because
 * a surface must not report work from a conversation it is not showing. **Live
 * before detached** within that, because two runs can share a session — close a
 * chat mid-answer, reopen it, ask something else — and the one the operator
 * just started is the one they are watching, while the detached one is already
 * named in the status bar. Falling back to another session's run at all is
 * inherited behaviour: `busy` is gated on the session matching, so it only ever
 * supplies the streaming target, and changing it here would be a different
 * change wearing this one's clothes.
 */
export function selectBusyRun<T>(
  candidates: ReadonlyArray<BusyRunCandidate<T>>,
  sessionId?: string,
): BusyRunCandidate<T> | undefined {
  const rank = (candidate: BusyRunCandidate<T>): number => {
    const sameSession = sessionId !== undefined && candidate.sessionId === sessionId;
    if (sameSession) {
      return candidate.detached ? 1 : 0;
    }
    return candidate.detached ? 3 : 2;
  };

  let best: BusyRunCandidate<T> | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const candidateRank = rank(candidate);
    // Strictly better only, so ties keep the order they arrived in and the
    // choice cannot shuffle between two identical renders.
    if (candidateRank < bestRank) {
      best = candidate;
      bestRank = candidateRank;
    }
  }
  return best;
}

/**
 * The runs that outlived their surfaces.
 *
 * A registry rather than a field on the panel, because the panel is the thing
 * that went away. Change is an event so a status bar can be built on it without
 * this module importing one.
 */
export class BackgroundChatRuns {
  private readonly runs = new Map<string, BackgroundChatRun>();
  private readonly listeners = new Set<() => void>();

  public add(run: BackgroundChatRun): void {
    this.runs.set(run.taskId, run);
    this.emit();
  }

  /** Called when the run finishes on its own, and by `stop`. Absent is not an error. */
  public remove(taskId: string): void {
    if (this.runs.delete(taskId)) {
      this.emit();
    }
  }

  public list(): BackgroundChatRun[] {
    return [...this.runs.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  public has(taskId: string): boolean {
    return this.runs.has(taskId);
  }

  /**
   * Stop one run.
   *
   * Removed from the registry before the abort rather than after: the abort
   * unwinds the run, which calls back into `remove`, and a registry still
   * holding the entry at that point reports work that has already been told to
   * stop.
   */
  public stop(taskId: string): boolean {
    const run = this.runs.get(taskId);
    if (!run) {
      return false;
    }
    this.runs.delete(taskId);
    this.emit();
    try {
      run.stop();
    } catch {
      // A run that cannot be told to stop is already gone.
    }
    return true;
  }

  public stopAll(): void {
    for (const taskId of [...this.runs.keys()]) {
      this.stop(taskId);
    }
  }

  public onDidChange(listener: () => void): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A surface that cannot redraw must not stop the others being told.
      }
    }
  }
}

/** One registry for the window. Runs are per-process; so is this. */
export const backgroundChatRuns = new BackgroundChatRuns();

/**
 * A host that accepts everything and does nothing, for a panel whose surface is
 * gone.
 *
 * The alternative was guarding 104 `postMessage` call sites, which is 104
 * chances to miss one — and a missed one throws "Webview is disposed" into the
 * middle of a run and ends it, which is the behaviour being removed. Swapping
 * the host makes the guarantee structural: there is no live webview left to
 * call.
 *
 * `visible` is `false` rather than absent, and that is load-bearing: the chat
 * uses it to decide whether a waiting tool approval needs announcing, and a
 * detached run is exactly the case where nobody is looking at the chat.
 */
export function createDetachedChatHost(): ChatPanelHost {
  const inert: vscode.Disposable = { dispose: () => { /* nothing was attached */ } };
  return {
    webview: {
      // Assigned during setup only, which cannot happen once detached.
      html: '',
      postMessage: () => Promise.resolve(false),
      onDidReceiveMessage: () => inert,
      // Never reached — HTML is built before a panel can be detached — but it
      // must return something of the right shape rather than throw.
      asWebviewUri: (localResource: vscode.Uri) => localResource,
      cspSource: '',
    },
    onDidDispose: () => inert,
    visible: false,
  };
}
