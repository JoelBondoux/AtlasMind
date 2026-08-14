import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Accessibility, checked where this project's markup actually lives.
 *
 * There is no DOM to run `axe` against. Every AtlasMind surface is a webview
 * whose HTML is assembled from template strings in `src/views/*.ts` and
 * `media/*.js`, so there is no rendered page in a test process to hand to a
 * scanner — and installing a headless browser to render a panel that needs a
 * live `vscode` API would be a large amount of machinery to check a handful of
 * static properties.
 *
 * The properties below are static ones, which is a real limitation worth
 * stating rather than papering over: automated checks catch roughly a third of
 * WCAG issues even with a full DOM, and this catches less. Keyboard order,
 * focus traps and whether an `aria-label` says anything *useful* still need a
 * person. What it does catch is the regression that actually recurs here — a
 * new icon-only button shipped with no accessible name, which for a
 * screen-reader user is a control that announces itself as "button".
 *
 * `tests/views/themeContrast.test.ts` covers the other half (computed contrast
 * against a real dark theme) and takes the same static-analysis approach for
 * the same reason.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every file that emits webview markup. */
function markupFiles(): { file: string; text: string }[] {
  const files: { file: string; text: string }[] = [];
  const views = path.join(ROOT, 'src', 'views');
  for (const name of readdirSync(views)) {
    if (name.endsWith('.ts')) {
      files.push({ file: `src/views/${name}`, text: readFileSync(path.join(views, name), 'utf8') });
    }
  }
  const media = path.join(ROOT, 'media');
  for (const name of readdirSync(media)) {
    if (name.endsWith('.js')) {
      files.push({ file: `media/${name}`, text: readFileSync(path.join(media, name), 'utf8') });
    }
  }
  return files;
}

const FILES = markupFiles();

/** An opening `<button …>` tag together with everything up to its close. */
const BUTTON = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;

/**
 * Does this button announce itself as something?
 *
 * Text content, an `aria-label`, an `aria-labelledby`, or a `title`. Template
 * interpolation counts: `${label}` is a name, just not one visible here.
 */
function hasAccessibleName(attributes: string, inner: string): boolean {
  if (/aria-label\s*=|aria-labelledby\s*=|\btitle\s*=/.test(attributes)) {
    return true;
  }
  const text = inner
    // Nested tags contribute their own text, so strip the tags not the content.
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0;
}

describe('every button in a webview announces itself', () => {
  it('found markup to check', () => {
    // Without this the whole suite passes if the scan stops matching.
    const total = FILES.reduce((sum, entry) => sum + [...entry.text.matchAll(BUTTON)].length, 0);
    expect(FILES.length).toBeGreaterThan(0);
    expect(total, 'no buttons found — the scan is broken, not the markup').toBeGreaterThan(20);
  });

  it('gives every button text, an aria-label, or a title', () => {
    const unnamed: string[] = [];

    for (const { file, text } of FILES) {
      for (const match of text.matchAll(BUTTON)) {
        const [full, attributes = '', inner = ''] = match;
        if (!hasAccessibleName(attributes, inner)) {
          const line = text.slice(0, match.index).split('\n').length;
          unnamed.push(`${file}:${line} ${full.slice(0, 90).replace(/\s+/g, ' ')}`);
        }
      }
    }

    expect(unnamed, 'a button with no accessible name announces itself as "button"').toEqual([]);
  });
});

describe('interactive controls are reachable and correctly typed', () => {
  it('never leaves a button inside a form untyped', () => {
    // A `<button>` inside a `<form>` defaults to `type="submit"`. In a webview
    // that is a full reload of the panel, which reads to the user as the panel
    // resetting itself — and for a keyboard user it happens on Enter, so it is
    // reached by exactly the people least able to recover from it.
    //
    // Only *inside a form* is a hard failure, because that is where the default
    // does something. Four panels have forms.
    const offenders: string[] = [];

    for (const { file, text } of FILES) {
      for (const form of text.matchAll(/<form\b[\s\S]*?<\/form>/g)) {
        for (const button of (form[0] ?? '').matchAll(BUTTON)) {
          if (!/\btype\s*=/.test(button[1] ?? '')) {
            const line = text.slice(0, (form.index ?? 0) + (button.index ?? 0)).split('\n').length;
            offenders.push(`${file}:${line}`);
          }
        }
      }
    }

    expect(offenders, 'an untyped button inside a form submits and reloads the panel').toEqual([]);
  });

  /**
   * Untyped buttons outside a form, capped rather than banned.
   *
   * There are 52. Outside a form the default is inert, so this is a
   * consistency and future-proofing concern rather than a live defect — and
   * failing on all 52 today would mean the check is deleted before it ever
   * catches the one that lands inside a form later.
   *
   * **Lower this when you fix one; never raise it to make a build green.**
   */
  const UNTYPED_BUTTON_CEILING = 52;

  it(`has no more than ${UNTYPED_BUTTON_CEILING} untyped buttons overall`, () => {
    const untyped: string[] = [];

    for (const { file, text } of FILES) {
      for (const match of text.matchAll(BUTTON)) {
        if (!/\btype\s*=/.test(match[1] ?? '')) {
          const line = text.slice(0, match.index).split('\n').length;
          untyped.push(`${file}:${line}`);
        }
      }
    }

    expect(
      untyped.length,
      untyped.length > UNTYPED_BUTTON_CEILING ? `untyped buttons rose to ${untyped.length}:\n${untyped.join('\n')}` : '',
    ).toBeLessThanOrEqual(UNTYPED_BUTTON_CEILING);
    // Ratchets downward too, so a cleanup cannot silently leave room for new ones.
    expect(
      untyped.length,
      `${UNTYPED_BUTTON_CEILING - untyped.length} were fixed — lower UNTYPED_BUTTON_CEILING to ${untyped.length}`,
    ).toBe(UNTYPED_BUTTON_CEILING);
  });

  it('never puts a click handler on a non-interactive element without a role', () => {
    // A clickable `<div>` is invisible to the keyboard and to assistive
    // technology. The panels use delegated `data-action` handlers, so this
    // looks for the element carrying one without being focusable.
    const offenders: string[] = [];

    for (const { file, text } of FILES) {
      for (const match of text.matchAll(/<(div|span|li)\b([^>]*\bdata-action\s*=[^>]*)>/g)) {
        const attributes = match[2] ?? '';
        const focusable = /\btabindex\s*=/.test(attributes);
        const hasRole = /\brole\s*=/.test(attributes);
        if (!focusable && !hasRole) {
          const line = text.slice(0, match.index).split('\n').length;
          offenders.push(`${file}:${line} <${match[1]} …>`);
        }
      }
    }

    expect(
      offenders,
      'an element with a click action needs a role and tabindex, or it should be a <button>',
    ).toEqual([]);
  });
});

describe('the document itself is announced', () => {
  it('sets a language on every webview document', () => {
    // Without `lang`, a screen reader announces the page in the user's default
    // voice, which mispronounces everything when they do not match.
    const documents = FILES.filter(entry => /<html\b/.test(entry.text));
    expect(documents.length, 'no webview documents found — the scan is broken').toBeGreaterThan(0);

    const missing = documents
      .filter(entry => [...entry.text.matchAll(/<html\b([^>]*)>/g)].some(match => !/\blang\s*=/.test(match[1] ?? '')))
      .map(entry => entry.file);

    expect(missing).toEqual([]);
  });
});
