import { readFileSync } from 'node:fs';
import path from 'node:path';

import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildChatWebviewHtml } from '../../src/views/chatWebviewMarkup.ts';

/**
 * The chat webview, actually executed.
 *
 * Every other test of `media/chatPanel.js` in this repo asserts its **source
 * text**, because there was no DOM to run it in. That gap shipped a real defect:
 * extracting `buildMessageElement` out of `renderTranscript` left `selectedRun`
 * behind as a free variable, so every assistant bubble threw a `ReferenceError`
 * mid-render. The user's own message appeared, nothing after it did, and the
 * status line still said the reply was ready — because the exception happened in
 * the renderer, not in the turn. No source-text assertion could have seen it, and
 * the compiler cannot help: this file is `@ts-nocheck` by necessity.
 *
 * So this harness renders. It is deliberately small — mount the real markup, run
 * the real script, push a state message the way the host does, and look at what
 * came out — because its value is entirely in being *executed*, not in breadth.
 */

const MEDIA_DIR = path.join(process.cwd(), 'media');

interface Harness {
  window: JSDOM['window'];
  posted: Array<{ type?: string; payload?: unknown }>;
  send(message: unknown): void;
  bubbles(): string[];
  errors: string[];
}

function mountChatWebview(): Harness {
  const html = buildChatWebviewHtml({ scriptUri: '', cspSource: 'vscode-webview:' });
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const posted: Array<{ type?: string; payload?: unknown }> = [];
  const errors: string[] = [];

  // Shims for the handful of APIs a real webview host provides and jsdom does
  // not. Kept minimal on purpose: anything stubbed here is behaviour this test
  // is no longer checking.
  (window as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = () => ({
    postMessage: (message: unknown) => { posted.push(message as { type?: string }); },
    getState: () => undefined,
    setState: () => undefined,
  });
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  window.Element.prototype.scrollIntoView = () => undefined;
  window.addEventListener('error', event => {
    errors.push(String((event as unknown as { message?: string }).message ?? ''));
  });

  window.eval(readFileSync(path.join(MEDIA_DIR, 'chatPanel.js'), 'utf8'));

  return {
    window,
    posted,
    errors,
    send(message: unknown) {
      window.dispatchEvent(new window.MessageEvent('message', { data: message }));
    },
    bubbles() {
      const transcript = window.document.getElementById('transcript');
      return [...(transcript?.querySelectorAll('[data-entry-id]') ?? [])]
        .map(node => node.getAttribute('data-entry-id') ?? '');
    },
  };
}

function stateWith(transcript: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    type: 'state',
    payload: {
      activeSurface: 'chat',
      selectedSessionId: 'chat-1',
      busy: false,
      sessions: [{ id: 'chat-1', title: 'Chat', createdAt: '', updatedAt: '', turnCount: 1, preview: '', isActive: true }],
      transcript,
      attachments: [],
      pendingToolApprovals: [],
      projectRuns: [],
      openFiles: [],
      slashCommands: [{ name: 'cost', description: 'What this workspace has spent' }],
      ...overrides,
    },
  };
}

const USER_TURN = { id: 'm1', role: 'user', content: 'Tell me about our current ci tests', timestamp: '2026-08-15T00:00:00.000Z' };
const ASSISTANT_TURN = {
  id: 'm2',
  role: 'assistant',
  content: 'We run three workflows.\n\n```ts\nconst a: number = 1;\n```\n',
  timestamp: '2026-08-15T00:00:01.000Z',
  meta: { modelUsed: 'mistral/ministral-8b-latest', costUsd: 0.0001, inputTokens: 10, outputTokens: 5 },
};

describe('chat webview, rendered', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = mountChatWebview();
  });

  it('renders the assistant reply, not just the question', () => {
    harness.send(stateWith([USER_TURN, ASSISTANT_TURN]));

    expect(harness.errors, `webview threw: ${harness.errors.join(', ')}`).toEqual([]);
    expect(harness.bubbles()).toEqual(['m1', 'm2']);
    const transcript = harness.window.document.getElementById('transcript');
    expect(transcript?.textContent).toContain('We run three workflows.');
  });

  it('renders an assistant reply that is tied to a selected run', () => {
    // The exact shape that broke: `selectedRun` is read only on the assistant
    // branch, so a transcript of user messages alone would have looked fine.
    harness.send(stateWith([USER_TURN, ASSISTANT_TURN], {
      selectedRunId: 'run-1',
      selectedRun: { id: 'run-1', chatMessageId: 'm2', goal: 'Check CI', status: 'completed', updatedAt: '' },
    }));

    expect(harness.errors).toEqual([]);
    expect(harness.bubbles()).toEqual(['m1', 'm2']);
  });

  it('keeps rendering while a turn streams, and after it finishes', () => {
    // Drives the incremental path: same ids, growing content, busy true.
    harness.send(stateWith([USER_TURN, { ...ASSISTANT_TURN, content: 'We run' }], {
      busy: true, busyAssistantMessageId: 'm2', streamingModels: ['mistral/ministral-8b-latest'],
    }));
    harness.send(stateWith([USER_TURN, { ...ASSISTANT_TURN, content: 'We run three' }], {
      busy: true, busyAssistantMessageId: 'm2', streamingModels: ['mistral/ministral-8b-latest'],
    }));
    harness.send(stateWith([USER_TURN, ASSISTANT_TURN]));

    expect(harness.errors).toEqual([]);
    expect(harness.bubbles()).toEqual(['m1', 'm2']);
    expect(harness.window.document.getElementById('transcript')?.textContent)
      .toContain('We run three workflows.');
  });

  it('appends a new turn without discarding the ones already shown', () => {
    harness.send(stateWith([USER_TURN, ASSISTANT_TURN], { busy: true, busyAssistantMessageId: 'm2' }));
    harness.send(stateWith([
      USER_TURN,
      ASSISTANT_TURN,
      { id: 'm3', role: 'user', content: 'and the release one?', timestamp: '2026-08-15T00:00:02.000Z' },
    ], { busy: true, busyAssistantMessageId: 'm2' }));

    expect(harness.errors).toEqual([]);
    expect(harness.bubbles()).toEqual(['m1', 'm2', 'm3']);
  });

  it('highlights a fenced block without letting markup through', () => {
    harness.send(stateWith([USER_TURN, ASSISTANT_TURN]));

    const code = harness.window.document.querySelector('.chat-code-block code');
    expect(code, 'code block did not render').not.toBeNull();
    // Whatever the highlighter did or did not do, the text must survive exactly.
    expect(code?.textContent).toBe('const a: number = 1;');
  });

  it('opens the command list on a leading slash and not on a path', () => {
    harness.send(stateWith([USER_TURN]));
    const input = harness.window.document.getElementById('promptInput') as HTMLTextAreaElement;
    const list = harness.window.document.getElementById('composerTypeahead');

    input.value = '/co';
    input.selectionStart = 3;
    input.selectionEnd = 3;
    input.dispatchEvent(new harness.window.Event('input'));
    expect(list?.classList.contains('hidden')).toBe(false);
    expect(list?.textContent).toContain('/cost');

    // A path mid-sentence is prose, matching the router's own rule.
    input.value = 'look at /usr/local/bin';
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    input.dispatchEvent(new harness.window.Event('input'));
    expect(list?.classList.contains('hidden')).toBe(true);
  });
});
