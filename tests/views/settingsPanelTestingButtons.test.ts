import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The three Testing-page action buttons, guarded at the source level.
 *
 * Both failures pinned here were live in the file rather than hypothetical.
 *
 * **Double binding.** `scaffoldTestingFramework` and `syncTestingProtocols` were
 * bound through `bindCommandButton` *and* through the busy-state loop added
 * beside it. Two listeners on one button post the message twice, and the
 * scaffold — a filesystem pass, an outbound instruction sync, and sometimes an
 * agent task — would have run twice on a single click. Nothing on screen would
 * have shown it, because the second run reports "already exists" for everything
 * the first one wrote.
 *
 * **A busy button with no guaranteed reset.** Auto-assess set "Assessing…" and
 * disabled itself on click, and the host repainted only on the one success
 * path. Dismissing the quick pick — the most likely thing a user does — left a
 * dead control reading "Assessing…" until the panel was closed and reopened.
 *
 * Source-level assertions because the webview script is a string inside a
 * template literal: there is no DOM to mount, and the compiler checks nothing
 * about what that string says.
 */
const SOURCE = readFileSync(
  path.resolve(__dirname, '../../src/views/settingsPanel.ts'),
  'utf8',
);

const ACTION_BUTTONS = [
  'autoAssessTestingConfig',
  'scaffoldTestingFramework',
  'syncTestingProtocols',
] as const;

describe('the Testing page action buttons', () => {
  it('each post their message from exactly one click listener', () => {
    const doubleBound = ACTION_BUTTONS.filter(id => {
      const viaHelper = SOURCE.includes(`bindCommandButton('${id}'`);
      const viaBusyLoop = new RegExp(`\\['${id}',\\s*'[^']+'\\]`).test(SOURCE);
      return viaHelper && viaBusyLoop;
    });
    expect(
      doubleBound,
      'bound twice — one click would post the message twice and run the action twice',
    ).toEqual([]);
  });

  it('each are bound at least once, so the button is not inert', () => {
    const unbound = ACTION_BUTTONS.filter(id =>
      !SOURCE.includes(`bindCommandButton('${id}'`) &&
      !new RegExp(`\\['${id}',\\s*'[^']+'\\]`).test(SOURCE),
    );
    expect(unbound).toEqual([]);
  });

  it('each repaint the panel however the handler exits', () => {
    // The busy state is only safe with an unconditional reset. `finally` is the
    // reset: it covers the early returns (no workspace, unsaved matrix,
    // dismissed picker, declined confirmation) and a thrown error alike.
    for (const id of ACTION_BUTTONS) {
      const caseBlock = SOURCE.slice(SOURCE.indexOf(`case '${id}':`));
      const body = caseBlock.slice(0, caseBlock.indexOf('return;'));
      expect(body, `${id} must repaint in a finally`).toMatch(/finally\s*\{[^}]*webview\.html/);
    }
  });

  it('never repaints twice for one click', () => {
    // The handler repaints in its `finally`, so the method it calls must not.
    const method = SOURCE.slice(SOURCE.indexOf('private async runScaffoldTestingFramework'));
    const body = method.slice(0, method.indexOf('\n  }'));
    expect(body).not.toMatch(/webview\.html\s*=/);
  });
});

describe('the embedded webview script stays inside its template literal', () => {
  it('uses no backtick in the busy-state block', () => {
    // The whole script is a template literal in this file. A backtick in a
    // comment there terminates it, and the failure surfaces as a parse error
    // hundreds of lines away with no obvious cause. (It did.)
    const start = SOURCE.indexOf("['autoAssessTestingConfig'");
    expect(start).toBeGreaterThan(-1);
    const block = SOURCE.slice(start - 900, start + 700);
    expect(block).not.toContain('`');
  });
});
