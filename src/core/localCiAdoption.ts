/**
 * Runners that outlived the editor.
 *
 * A local CI container is started by the extension host but is not owned by it:
 * `docker run` is a detached lifetime, and closing VS Code — or a crash, or a
 * window reload — leaves the container executing the GitHub job it claimed.
 * That is the **right** behaviour and is deliberately kept: the job is real
 * work, GitHub is waiting on it, and killing it because a window closed would
 * throw away minutes of compute and report a failure nobody caused.
 *
 * What was missing is the other half. Nothing looked for such a container when
 * the editor came back, so a run in progress was invisible: the page said the
 * machine was idle while a container held its whole CPU and memory budget, and
 * the run's outcome was never recorded. This module is the reconciliation —
 * *what is still running here, and what did I leave behind?*
 *
 * Four rules:
 *
 * - **Only containers AtlasMind started are ever considered.** Matched on the
 *   `com.atlasmind.local-ci` label *and* the container-name shape, because a
 *   label is a string anybody can set on their own container and the two
 *   together are a much stronger claim than either alone.
 * - **Running and finished are different findings with different offers.** A
 *   live one is *adopted* — reattach to its output and record its verdict when
 *   it ends. A finished one is a *stray*: nothing is running, and the only
 *   useful action is to clear it away.
 * - **A stray is reported, never removed automatically.** It is the only
 *   evidence that a run happened at all, and deleting it on sight would erase
 *   the record of the crash somebody is trying to understand.
 * - **An unreadable row is skipped, not guessed at.** `docker ps` output is
 *   parsed defensively; a row that cannot be read yields nothing rather than a
 *   container name that might be somebody else's.
 */

/** The container-name shape `LocalCiRunnerManager` produces. */
const OWNED_CONTAINER_NAME = /^atlasmind-ci-[a-f0-9]{1,12}-[a-f0-9-]{4,36}$/;
export const LOCAL_CI_OWNER_LABEL = 'com.atlasmind.local-ci';
export const LOCAL_CI_RUN_LABEL = 'com.atlasmind.local-ci.run';

export interface OwnedLocalCiContainer {
  name: string;
  /** The GitHub run id this container was started for, when the label carries one. */
  runId?: number;
  /** `running` is adoptable; anything else is a stray. */
  running: boolean;
  /** Docker's own words for the state, for display only. */
  status: string;
}

export interface LocalCiContainerReconciliation {
  /** A live runner from an earlier session, if one is present. */
  adoptable?: OwnedLocalCiContainer;
  /** Finished containers left behind, newest first as Docker lists them. */
  strays: OwnedLocalCiContainer[];
  /** More than one live runner should be impossible; reported rather than picked between. */
  ambiguous: boolean;
}

interface DockerPsRow {
  Names?: unknown;
  Labels?: unknown;
  State?: unknown;
  Status?: unknown;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max).trim() : '';
}

/**
 * Read one `docker ps --all --format {{json .}}` row per line.
 *
 * Labels arrive as a comma-separated `key=value` list, which is why the run id
 * is extracted with an anchored per-entry match rather than a substring search:
 * `com.atlasmind.local-ci.run=12` must not be read out of somebody else's
 * `not-com.atlasmind.local-ci.run=12`.
 */
export function parseOwnedLocalCiContainers(raw: string): OwnedLocalCiContainer[] {
  const containers: OwnedLocalCiContainer[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let row: DockerPsRow;
    try {
      row = JSON.parse(trimmed) as DockerPsRow;
    } catch {
      continue;
    }
    const name = text(row.Names, 80);
    if (!OWNED_CONTAINER_NAME.test(name)) {
      continue;
    }
    const labels = text(row.Labels, 2000).split(',').map(entry => entry.trim());
    if (!labels.includes(`${LOCAL_CI_OWNER_LABEL}=true`)) {
      continue;
    }
    const runEntry = labels.find(entry => entry.startsWith(`${LOCAL_CI_RUN_LABEL}=`));
    const runValue = runEntry ? Number.parseInt(runEntry.slice(LOCAL_CI_RUN_LABEL.length + 1), 10) : Number.NaN;
    const state = text(row.State, 40).toLowerCase();
    const status = text(row.Status, 120);
    containers.push({
      name,
      ...(Number.isSafeInteger(runValue) && runValue > 0 ? { runId: runValue } : {}),
      running: state === 'running' || (state === '' && /^up\b/i.test(status)),
      status: status || state || 'unknown',
    });
  }
  return containers;
}

/** Split owned containers into the one to adopt and the ones to clear away. */
export function reconcileLocalCiContainers(containers: readonly OwnedLocalCiContainer[]): LocalCiContainerReconciliation {
  const running = containers.filter(container => container.running);
  const strays = containers.filter(container => !container.running);
  return {
    ...(running.length > 0 ? { adoptable: running[0] } : {}),
    strays,
    ambiguous: running.length > 1,
  };
}

/**
 * The sentence the Pipeline page shows about an adopted runner.
 *
 * Written here rather than in the webview so the chat surface and the page
 * cannot describe the same container differently.
 */
export function describeAdoptedRunner(container: OwnedLocalCiContainer): string {
  const which = container.runId === undefined
    ? 'a job'
    : `queued run #${container.runId}`;
  return `A runner this computer started earlier is still executing ${which}. `
    + 'It kept going while VS Code was closed; AtlasMind has reattached to its output and will record the result when it finishes.';
}
