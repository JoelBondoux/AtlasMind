import {
  buildHostDryRunRecord,
  classifyHostCommand,
  describeHostDryRunNotice,
  DryRunBlockedError,
  readDryRunSetting,
  type DryRunHostEffect,
} from './dryRun.js';
import type { DryRunRecord } from '../types.js';

/**
 * The dry run outside the tool loop.
 *
 * `dryRun.ts` decides, inside `runAgenticLoop`, which tool calls a dry turn
 * runs. Everything else AtlasMind does on its own account — a routine, a
 * promotion, a branch deleted from the dashboard, an issue filed, a Director
 * email, a Buzz post, a terminal command, a timer rewriting memory — happens in
 * a host surface the loop never sees. This is the one service those surfaces
 * ask, so the switch in the status bar means the same thing everywhere it
 * claims to.
 *
 * Four rules:
 *
 * 1. **One record of would-have-run actions.** An interception becomes a
 *    `DryRunRecord` — the shape the tool loop writes — and goes to the same
 *    ledger and the same "AtlasMind Dry Run" output channel. Two logs of one
 *    run would be two partial answers to "what would it have done".
 * 2. **A person who asked is told.** An interception of something somebody
 *    pressed raises a notification naming the action and saying dry run is
 *    on. A button that silently does nothing reads as broken, and a person who
 *    believes a deploy happened is worse off than one who was told it did not.
 *    Automatic writes are recorded without a notification, because a timer
 *    that raised one every pass would teach people to dismiss them.
 * 3. **Unreadable is on.** A setting nobody can read, or a reader that
 *    throws, is taken as a dry run, as `readDryRunSetting` already does.
 * 4. **Installed once, by the process that owns the switch.** The extension
 *    installs a host at activation, before any surface exists; the CLI and the
 *    ACP agent install one for `--dry-run`. A process that installed none —
 *    a unit test, a library import, the bundled MCP server — has no dry-run
 *    switch to honour, and reads as off.
 *
 * The guard is the effect's own boundary wherever there is one (`ghClient`,
 * `mcpRuntime.execFileAsync`, `promotionRunner`, `routineRunner`,
 * `mcpServerRegistry.callTool`), so a surface added later inherits it rather
 * than having to remember it. `tests/security/dryRunCoverage.test.ts` fails on a
 * source file with a side-effect call shape that is neither guarded nor
 * exempted with a written reason.
 */

export interface DryRunHostOptions {
  /** The raw `atlasmind.dryRun.enabled` value; read on every check. */
  isEnabled: () => unknown;
  /** Where a record goes — the session's `DryRunLedger`. */
  record: (record: DryRunRecord) => void;
  /** Shows a notice to a person. Absent in a headless process. */
  notify?: (message: string) => void;
  now?: () => Date;
}

/** The same notice is not repeated inside this window, so one press is one notification. */
const NOTICE_REPEAT_WINDOW_MS = 3_000;

export class DryRunHost {
  private readonly lastNotice = new Map<string, number>();

  constructor(private readonly options: DryRunHostOptions) {}

  isActive(): boolean {
    try {
      return readDryRunSetting(this.options.isEnabled());
    } catch {
      return true;
    }
  }

  /**
   * Records the effect and returns the record when a dry run is on; returns
   * `undefined`, recording nothing, when the caller should go ahead.
   */
  intercept(effect: DryRunHostEffect): DryRunRecord | undefined {
    if (!this.isActive()) {
      return undefined;
    }
    const now = this.options.now?.() ?? new Date();
    const record = buildHostDryRunRecord(effect, now.toISOString());
    try {
      this.options.record(record);
    } catch {
      // A ledger that fails must not turn a refusal into an action.
    }
    if (effect.userInitiated !== false && this.options.notify) {
      const notice = describeHostDryRunNotice(record);
      const last = this.lastNotice.get(notice);
      if (last === undefined || now.getTime() - last >= NOTICE_REPEAT_WINDOW_MS) {
        this.lastNotice.set(notice, now.getTime());
        try {
          this.options.notify(notice);
        } catch {
          // The record is already in the ledger.
        }
      }
    }
    return record;
  }
}

let installed: DryRunHost | undefined;

/** Install the process's dry-run host. Returns an uninstaller for disposal and tests. */
export function installDryRunHost(host: DryRunHost): () => void {
  installed = host;
  return () => {
    if (installed === host) {
      installed = undefined;
    }
  };
}

/** Whether this process is in a dry run right now. No host installed reads as off. */
export function isDryRunActive(): boolean {
  return installed?.isActive() ?? false;
}

/**
 * The guard for a caller that can report a refusal itself: returns the record
 * when the effect must not happen, `undefined` when it may.
 */
export function interceptDryRun(effect: DryRunHostEffect): DryRunRecord | undefined {
  return installed?.intercept(effect);
}

/** The guard for a caller whose contract is exceptions: throws `DryRunBlockedError`. */
export function guardDryRun(effect: DryRunHostEffect): void {
  const record = interceptDryRun(effect);
  if (record) {
    throw new DryRunBlockedError(record);
  }
}

/**
 * Grades a command with `classifyHostCommand` and, in a dry run, refuses one
 * that acts. A read always passes, so a surface that renders from git or gh
 * keeps rendering.
 */
export function guardHostCommand(
  surface: string,
  command: string,
  args: readonly string[],
  options: { userInitiated?: boolean } = {},
): void {
  if (!isDryRunActive()) {
    return;
  }
  const grade = classifyHostCommand(command, args);
  if (grade.kind === 'read') {
    return;
  }
  const name = command.trim().split(/[\\/]/).pop() || command;
  const shown = [name, ...args].join(' ');
  guardDryRun({
    surface,
    kind: grade.effect,
    summary: `run \`${shown.length > 160 ? `${shown.slice(0, 157)}…` : shown}\``,
    details: { command: name, args: [...args], grade: grade.reason },
    ...(options.userInitiated === undefined ? {} : { userInitiated: options.userInitiated }),
  });
}
