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

describe('activity strip', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = mountChatWebview();
  });

  function strip() {
    return harness.window.document.getElementById('status');
  }

  it('stays hidden while nothing is happening', () => {
    // A bubble permanently announcing "Ready." is the instrumentation this
    // replaced, not an improvement on it.
    expect(strip()?.classList.contains('idle')).toBe(true);

    harness.send({ type: 'status', payload: 'Ready.' });
    expect(strip()?.classList.contains('idle')).toBe(true);
    expect(strip()?.textContent).toBe('');
  });

  it('appears with its own text once something is happening', () => {
    harness.send({ type: 'status', payload: 'Working on it…' });

    expect(strip()?.classList.contains('idle')).toBe(false);
    expect(strip()?.textContent).toContain('Working on it');
  });

  it('goes quiet again when the work finishes', () => {
    harness.send({ type: 'status', payload: 'Working on it…' });
    harness.send({ type: 'status', payload: 'Ready.' });

    expect(strip()?.classList.contains('idle')).toBe(true);
  });

  it('sits inside the thread frame, at the end of the thread', () => {
    const status = strip();
    const surface = harness.window.document.getElementById('chatSurface');
    const transcript = harness.window.document.getElementById('transcript');

    // Inside the bordered frame, directly after the messages: it is the last
    // thing in the thread rather than a caption on the panel.
    expect(surface?.contains(status ?? null)).toBe(true);
    expect(status?.previousElementSibling?.id).toBe('transcript');

    // But *not* inside the transcript itself, which is what matters: the
    // transcript is cleared and rebuilt on every render, so a strip living in
    // there would be destroyed by the next state message and would scroll away
    // with the messages in between.
    expect(transcript?.contains(status ?? null)).toBe(false);
  });

  it('collapses the frame during a run instead of holding an empty box open', () => {
    harness.send(stateWith([USER_TURN], { activeSurface: 'run' }));
    harness.send({ type: 'busy', payload: false });

    const surface = harness.window.document.getElementById('chatSurface');
    expect(surface?.classList.contains('run-mode')).toBe(true);
    expect(harness.window.document.getElementById('transcript')?.classList.contains('hidden')).toBe(true);
  });
});

describe('stopping a turn', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = mountChatWebview();
    // A turn in flight with nothing written yet: the state that used to insist
    // the model "has not stopped".
    harness.send(stateWith([USER_TURN, { ...ASSISTANT_TURN, content: '' }], {
      busy: true,
      busyAssistantMessageId: 'm2',
    }));
  });

  function thinking() {
    return harness.window.document.querySelector('.thinking-indicator')?.textContent ?? '';
  }

  it('describes waiting without answering a question nobody asked', () => {
    // The old copy was "The model has not stopped; waiting for the next token
    // batch" — a denial, in vocabulary from inside this repository.
    expect(thinking()).toContain('Thinking');
    expect(thinking()).not.toContain('has not stopped');
    expect(thinking()).not.toContain('token batch');
  });

  it('says it is stopping the moment Stop is pressed', () => {
    const stop = harness.window.document.getElementById('stopPrompt');
    stop?.dispatchEvent(new harness.window.Event('click'));

    // The contradiction this closes: the panel used to keep claiming the model
    // had not stopped while the operator watched to see whether Stop worked.
    expect(thinking()).toContain('Stopping');
    expect(thinking()).not.toContain('has not stopped');
    expect(harness.window.document.getElementById('status')?.textContent).toContain('Stopping');
    expect(harness.posted.some(message => message.type === 'stopPrompt')).toBe(true);
  });

  it('stops claiming to stop once the turn is over', () => {
    harness.window.document.getElementById('stopPrompt')?.dispatchEvent(new harness.window.Event('click'));
    harness.send({ type: 'busy', payload: false });
    harness.send(stateWith([USER_TURN, ASSISTANT_TURN]));

    expect(harness.window.document.querySelector('.thinking-indicator')).toBeNull();
    expect(harness.errors).toEqual([]);
  });
});

describe('context meter', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = mountChatWebview();
  });

  function meter() {
    return harness.window.document.getElementById('contextMeter');
  }

  it('stays hidden when there is nothing to measure against', () => {
    // A meter that cannot measure is absent, not zero.
    harness.send(stateWith([USER_TURN]));
    expect(meter()?.classList.contains('hidden')).toBe(true);
  });

  it('measures against the model window when a model is known', () => {
    harness.send(stateWith([USER_TURN, ASSISTANT_TURN], {
      contextMeter: {
        estimatedTokens: 4000, modelId: 'anthropic/opus-5', contextWindow: 200000,
        contextChars: 16000, charBudget: 2500, turnCount: 2, turnLimit: 6,
      },
    }));

    expect(meter()?.classList.contains('hidden')).toBe(false);
    expect(harness.window.document.getElementById('contextMeterLabel')?.textContent)
      .toContain('200k tokens');
    expect(meter()?.getAttribute('title')).toContain('anthropic/opus-5');
  });

  it('falls back to the session budget rather than inventing a window', () => {
    // Claiming a percentage of a window nobody has chosen would be a number
    // made up to fill a bar.
    harness.send(stateWith([USER_TURN], {
      contextMeter: {
        estimatedTokens: 300, contextChars: 1200, charBudget: 2500, turnCount: 3, turnLimit: 6,
      },
    }));

    const label = harness.window.document.getElementById('contextMeterLabel')?.textContent ?? '';
    expect(label).toContain('3 of 6 turns');
    expect(label).not.toContain('tokens');
    expect(meter()?.getAttribute('title')).toContain('session budget');
  });

  it('warns as the window fills', () => {
    harness.send(stateWith([USER_TURN], {
      contextMeter: {
        estimatedTokens: 95000, modelId: 'openai/gpt-5', contextWindow: 100000,
        contextChars: 380000, charBudget: 2500, turnCount: 20, turnLimit: 6,
      },
    }));
    expect(meter()?.classList.contains('warn')).toBe(true);
  });

  it('counts the unsent draft as you type', () => {
    harness.send(stateWith([USER_TURN], {
      contextMeter: {
        estimatedTokens: 100, modelId: 'openai/gpt-5', contextWindow: 1000,
        contextChars: 400, charBudget: 2500, turnCount: 1, turnLimit: 6,
      },
    }));
    const before = harness.window.document.getElementById('contextMeterFill')?.getAttribute('style') ?? '';

    const input = harness.window.document.getElementById('promptInput') as HTMLTextAreaElement;
    // 4,000 characters is ~1,000 tokens at the estimator's four-to-one, which
    // takes 100 + 1,000 past this model's 1,000-token window.
    input.value = 'x'.repeat(4000);
    input.dispatchEvent(new harness.window.Event('input'));

    const after = harness.window.document.getElementById('contextMeterFill')?.getAttribute('style') ?? '';
    expect(after).not.toBe(before);
    expect(meter()?.classList.contains('warn')).toBe(true);
  });
});

describe('dictation', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = mountChatWebview();
    harness.send(stateWith([USER_TURN]));
  });

  it('inserts a transcript into the composer and never submits it', () => {
    // Speech recognition gets words wrong, and a mis-heard sentence that sends
    // itself is a turn nobody asked for, with a cost attached.
    harness.send({ type: 'transcriptReady', payload: { text: 'add tests for the router' } });

    const input = harness.window.document.getElementById('promptInput') as HTMLTextAreaElement;
    expect(input.value).toContain('add tests for the router');
    expect(harness.posted.some(message => message.type === 'submitPrompt')).toBe(false);
  });

  it('says so when the window cannot record, rather than failing silently', () => {
    // jsdom has no mediaDevices, which is the same shape as a host that denies
    // the microphone.
    harness.window.document.getElementById('dictate')?.dispatchEvent(new harness.window.Event('click'));

    expect(harness.window.document.getElementById('status')?.textContent)
      .toContain('cannot record audio');
    expect(harness.errors).toEqual([]);
  });
});

describe('links in a reply', () => {
  let harness: Harness;

  function linksIn(content: string): HTMLAnchorElement[] {
    harness.send(stateWith([USER_TURN, { ...ASSISTANT_TURN, content }]));
    const transcript = harness.window.document.getElementById('transcript');
    return [...(transcript?.querySelectorAll('.chat-content a') ?? [])] as HTMLAnchorElement[];
  }

  beforeEach(() => {
    harness = mountChatWebview();
  });

  it('makes a file path openable instead of struck through or inert', () => {
    // The reported shape: a reply listing test files rendered every path with a
    // line through it, which reads as "this file was deleted" for files that
    // exist. Paths were reaching the blocked-link branch, whose only visual
    // signal was strikethrough.
    const links = linksIn('See [tests/e2e/initial-render.spec.ts](tests/e2e/initial-render.spec.ts).');

    expect(links).toHaveLength(1);
    expect(links[0].classList.contains('file-link')).toBe(true);
    expect(links[0].classList.contains('blocked-link')).toBe(false);

    links[0].dispatchEvent(new harness.window.Event('click'));
    expect(harness.posted).toContainEqual({
      type: 'openFileReference',
      payload: 'tests/e2e/initial-render.spec.ts',
    });
  });

  it('treats an absolute path and a file: URI as the same kind of reference', () => {
    // Both are how a model names a local file; only the relative form used to
    // pass, so the same file was a link or a strikethrough depending on spelling.
    for (const href of ['C:\\repo\\src\\a.ts', 'file:///c:/repo/src/a.ts', './src/a.ts:12']) {
      const links = linksIn(`Open [a.ts](${href}) now.`);
      expect(links[0].classList.contains('file-link'), href).toBe(true);
    }
  });

  it('still refuses a script scheme, and no longer strikes it through', () => {
    const links = linksIn('Click [here](javascript:alert(1)) now.');

    expect(links[0].classList.contains('blocked-link')).toBe(true);
    expect(links[0].classList.contains('file-link')).toBe(false);
    expect(links[0].getAttribute('href')).toBe('#');
    links[0].dispatchEvent(new harness.window.Event('click'));
    expect(harness.posted.some(message => message.type === 'openFileReference')).toBe(false);
  });

  it('leaves an ordinary web link alone', () => {
    const links = linksIn('See [the docs](https://example.com/guide).');

    expect(links[0].getAttribute('href')).toBe('https://example.com/guide');
    expect(links[0].classList.contains('file-link')).toBe(false);
    expect(links[0].classList.contains('blocked-link')).toBe(false);
  });
});
