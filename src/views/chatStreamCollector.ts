/**
 * A `vscode.ChatResponseStream` that writes into memory instead of a chat view.
 *
 * The slash-command handlers in `chat/participant.ts` are the good kind of code
 * to reuse: deterministic, model-free, and already the *authoritative* answer to
 * "what does `/agents` say". What stopped the AtlasMind chat panel using them was
 * purely mechanical — they emit into a `ChatResponseStream`, which only VS Code's
 * chat view provides. So the panel had no dispatch at all and every slash command
 * silently became a model call.
 *
 * This is the adapter that removes that excuse. It collects the four stream
 * methods the handlers actually use — `markdown`, `button`, `progress`,
 * `reference`, verified by enumerating every `stream.*` call in the participant —
 * and hands the panel back something it can render.
 *
 * **Reuse, not reimplementation, is the point.** A second `/agents` written for
 * the panel would answer the same question differently within a release or two,
 * and nothing would notice. Anything the handlers gain — a new gate, a corrected
 * count, a safety refusal — reaches both surfaces here for free.
 *
 * The remaining methods of the interface are implemented as **inert stubs rather
 * than throws**: an unused capability that throws would convert "this handler
 * called something we do not render" into a failed command, which is a worse
 * outcome than a missing anchor. What was dropped is recorded in
 * {@link CollectedChatResponse.unsupported} so it is visible rather than
 * invisible.
 *
 * Depends on `vscode` only for its types and `MarkdownString`, so it is unit
 * tested against the mock the rest of the suite uses.
 */

import * as vscode from 'vscode';

/** A button a handler offered, kept as data so the webview never names a command. */
export interface CollectedChatButton {
  /** Stable id the webview echoes back. Commands stay extension-side. */
  id: string;
  title: string;
  command: string;
  args: unknown[];
}

export interface CollectedChatResponse {
  /** Everything the handler wrote, joined in order. */
  markdown: string;
  /** Buttons, in the order offered, de-duplicated by command + arguments. */
  buttons: CollectedChatButton[];
  /** The last progress line, which is the only one still meaningful at the end. */
  progress: string | undefined;
  /** Workspace files the handler cited, as display paths. */
  references: string[];
  /** Stream features a handler used that this adapter does not render. */
  unsupported: string[];
}

/**
 * Collects a handler's output.
 *
 * Deliberately not a `vscode.ChatResponseStream` by `implements` clause: that
 * interface grows between VS Code releases, and declaring conformance would make
 * an unrelated API addition a compile error in AtlasMind. The cast happens at the
 * single call site, where the handlers' actual requirements are known and pinned
 * by test.
 */
export class ChatStreamCollector {
  private readonly chunks: string[] = [];
  private readonly collectedButtons: CollectedChatButton[] = [];
  private readonly buttonKeys = new Set<string>();
  private readonly collectedReferences: string[] = [];
  private readonly dropped = new Set<string>();
  private lastProgress: string | undefined;

  markdown(value: string | vscode.MarkdownString): void {
    const text = typeof value === 'string' ? value : value?.value ?? '';
    if (text.length > 0) {
      this.chunks.push(text);
    }
  }

  /**
   * A button becomes a chip the panel can render.
   *
   * `command` is kept **here**, extension-side, and only `id` crosses to the
   * webview — the same rule the Buzz guide's chips already follow. A webview that
   * could name the command to execute would be a webview that could execute any
   * command, which is the boundary this project treats as untrusted by default.
   */
  button(command: vscode.Command): void {
    const commandId = typeof command?.command === 'string' ? command.command : '';
    if (!commandId) {
      return;
    }
    const args = Array.isArray(command.arguments) ? command.arguments : [];
    // Handlers legitimately offer the same action twice in one response (a step's
    // primary action, then a closing "do this next"). Rendering both would put
    // two identical chips side by side.
    const key = `${commandId}|${safeKey(args)}`;
    if (this.buttonKeys.has(key)) {
      return;
    }
    this.buttonKeys.add(key);
    this.collectedButtons.push({
      id: `chat-action-${this.collectedButtons.length + 1}`,
      title: typeof command.title === 'string' && command.title.trim().length > 0
        ? command.title.trim()
        : commandId,
      command: commandId,
      args,
    });
  }

  progress(value: string): void {
    if (typeof value === 'string' && value.trim().length > 0) {
      this.lastProgress = value.trim();
    }
  }

  /**
   * A cited file, kept as a display path.
   *
   * Detected **structurally** rather than with `instanceof vscode.Uri`: a
   * `Location` is just an object carrying a `uri`, and `instanceof` against the
   * `vscode` namespace throws outright where `Uri` is not a constructor — which
   * is true in the test mock and would also be true of a `Uri` that crossed an
   * extension-host boundary. Reading the two fields that matter cannot fail that
   * way, and this method must not be able to take a command down with it.
   */
  reference(value: vscode.Uri | vscode.Location): void {
    const candidate = value as { fsPath?: unknown; path?: unknown; uri?: { fsPath?: unknown; path?: unknown } };
    const uri = typeof candidate?.fsPath === 'string' || typeof candidate?.path === 'string'
      ? candidate
      : candidate?.uri;
    const shown = typeof uri?.fsPath === 'string' && uri.fsPath.length > 0
      ? uri.fsPath
      : typeof uri?.path === 'string' ? uri.path : '';
    if (shown && !this.collectedReferences.includes(shown)) {
      this.collectedReferences.push(shown);
    }
  }

  // ── Interface surface the handlers do not currently use ──────────
  //
  // Present so a handler that starts using one degrades to a note rather than a
  // crash. Each records itself, so "the panel dropped something" is a fact the
  // response carries instead of a difference somebody has to notice by eye.

  anchor(_value: unknown, _title?: string): void { this.dropped.add('anchor'); }
  filetree(_value: unknown, _baseUri: unknown): void { this.dropped.add('filetree'); }
  push(_part: unknown): void { this.dropped.add('push'); }
  codeblockUri(_uri: unknown): void { this.dropped.add('codeblockUri'); }
  textEdit(..._args: unknown[]): void { this.dropped.add('textEdit'); }
  notebookEdit(..._args: unknown[]): void { this.dropped.add('notebookEdit'); }
  confirmation(..._args: unknown[]): void { this.dropped.add('confirmation'); }
  warning(value: string | vscode.MarkdownString): void {
    // A warning is content, not decoration: dropping it would hide the one line
    // a handler chose to emphasise.
    const text = typeof value === 'string' ? value : value?.value ?? '';
    if (text.length > 0) {
      this.chunks.push(`> ⚠️ ${text}`);
    }
  }

  /** What the handler produced. */
  collect(): CollectedChatResponse {
    return {
      markdown: this.chunks.join('\n\n').trim(),
      buttons: [...this.collectedButtons],
      progress: this.lastProgress,
      references: [...this.collectedReferences],
      unsupported: [...this.dropped].sort(),
    };
  }

  /** The shape the handlers expect. Cast confined to one place. */
  asStream(): vscode.ChatResponseStream {
    return this as unknown as vscode.ChatResponseStream;
  }
}

/**
 * Render a collected response as the assistant's message.
 *
 * Progress lines are dropped rather than shown: they described work that has
 * since finished, and a transcript reading "Checking…" under a completed answer
 * describes a state that no longer exists. Dropped stream features are reported,
 * because a silently truncated answer is the failure this whole path replaces.
 */
export function renderCollectedResponse(collected: CollectedChatResponse): string {
  const parts: string[] = [];
  if (collected.markdown) {
    parts.push(collected.markdown);
  }
  if (collected.references.length > 0) {
    parts.push(`**Referenced:**\n${collected.references.map(item => `- \`${item}\``).join('\n')}`);
  }
  if (collected.unsupported.length > 0) {
    parts.push(
      `> Part of this reply used a chat feature this panel cannot draw (${collected.unsupported.join(', ')}). `
      + 'Run the same command with `@atlas` in the VS Code chat view to see it in full.',
    );
  }
  return parts.length > 0
    ? parts.join('\n\n')
    // A handler that wrote nothing is a bug in that handler, but reporting
    // nothing at all would look like the panel swallowing the command — which is
    // exactly the symptom this path exists to remove.
    : 'That command produced no output. This is an AtlasMind bug — please report it.';
}

/** Stable key for de-duplication, tolerating arguments that cannot be serialised. */
function safeKey(args: readonly unknown[]): string {
  try {
    return JSON.stringify(args) ?? '';
  } catch {
    return String(args.length);
  }
}
