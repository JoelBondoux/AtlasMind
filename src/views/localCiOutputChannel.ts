/**
 * The one output channel for local CI.
 *
 * The dashboard's runner and the reviewed-PR command each created their own
 * channel ("AtlasMind Local CI" and "AtlasMind: Reviewed PR Local CI"), so the
 * lines a person needed after a failed reviewed-PR run were in whichever one
 * they had not opened, and the dashboard's "Open runner output" button showed
 * the other. One channel, created once, shared by both: a container's death
 * and the dispatch that led to it read as one story.
 */

import * as vscode from 'vscode';

export const LOCAL_CI_OUTPUT_CHANNEL_NAME = 'AtlasMind Local CI';

let channel: vscode.OutputChannel | undefined;

/** The shared channel, created on first use and never disposed by a caller. */
export function getLocalCiOutputChannel(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel(LOCAL_CI_OUTPUT_CHANNEL_NAME);
  return channel;
}
