import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Cross-panel wiring invariants.
 *
 * These catch the class of defect where a control renders perfectly but cannot
 * possibly work — an inline handler the CSP blocks, a browser API the webview
 * host does not implement, data embedded where the parser will not decode it.
 * Every one of them is invisible to type-checking and to lint, and each was
 * found live in the codebase.
 */

const VIEWS_DIR = path.join(process.cwd(), 'src', 'views');
const MEDIA_DIR = path.join(process.cwd(), 'media');

const panelFiles = readdirSync(VIEWS_DIR)
  .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  .map(file => path.join(VIEWS_DIR, file));

const mediaFiles = readdirSync(MEDIA_DIR)
  .filter(file => file.endsWith('.js'))
  .map(file => path.join(MEDIA_DIR, file));

/**
 * Strip every comment form these files use — JS line and block comments (which
 * also covers CSS block comments) and HTML comments. Without this the checks
 * below match the notes explaining why each pattern is banned, which is a
 * self-defeating way to fail.
 */
function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

const allWebviewSources = [...panelFiles, ...mediaFiles].map(file => ({
  file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
  text: stripComments(readFileSync(file, 'utf8')),
}));

describe('webview CSP compliance', () => {
  it('never emits inline event-handler attributes', () => {
    // getWebviewHtmlShell sets script-src to a nonce with no 'unsafe-inline',
    // so an onclick="" attribute is silently blocked. The Skill Scanner panel
    // wired *every* control this way and not one of its buttons worked.
    const offenders: string[] = [];
    for (const { file, text } of allWebviewSources) {
      const matches = text.match(/\son(click|change|input|submit|mouseover|mouseenter|keydown|keyup|focus|blur)\s*=\s*["']/gi);
      if (matches) {
        offenders.push(`${file} (${matches.length}×${matches[0]!.trim()})`);
      }
    }
    expect(offenders, `inline handlers are blocked by the webview CSP: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('webview host API compatibility', () => {
  it('never calls window.prompt / alert / confirm', () => {
    // VS Code webviews do not implement these. window.prompt() returns
    // undefined without showing anything, which is how the Tool Webhook
    // panel's "Set / Update Token" button became a no-op.
    const offenders: string[] = [];
    for (const { file, text } of allWebviewSources) {
      for (const api of ['prompt', 'alert', 'confirm']) {
        const re = new RegExp(`(^|[^.\\w])window\\.${api}\\s*\\(`, 'g');
        if (re.test(text)) {
          offenders.push(`${file} → window.${api}()`);
        }
      }
    }
    expect(offenders, `unsupported in VS Code webviews: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('webview data embedding', () => {
  it('never HTML-escapes JSON into a <script> element', () => {
    // <script> is a raw-text element: the parser does not decode character
    // references inside it, so escaped JSON arrives still carrying &quot; and
    // JSON.parse throws on the panel's first statement. Data belongs on a
    // data-* attribute, where entities *are* decoded.
    const offenders: string[] = [];
    for (const { file, text } of allWebviewSources) {
      if (/<script[^>]*type=["']application\/json["'][^>]*>\$\{[^}]*escapeHtml/.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders, `escaped JSON inside <script> cannot be parsed: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('CSS custom property names', () => {
  it('uses no dotted --vscode-* names', () => {
    // `var(--vscode-charts.blue, #40a6ff)` parses as an invalid name, so the
    // declaration is dropped and only the fallback ever applies — which looks
    // like it works until the fallback is wrong for the active theme.
    const offenders: string[] = [];
    for (const { file, text } of allWebviewSources) {
      const matches = text.match(/var\(\s*--[a-z-]*\.[a-z-]+/gi);
      if (matches) {
        offenders.push(`${file}: ${[...new Set(matches)].join(', ')}`);
      }
    }
    expect(offenders, `invalid custom-property names: ${offenders.join(' | ')}`).toEqual([]);
  });
});

describe('theme safety', () => {
  // Panels render inside VS Code, which may be on a light or a dark theme.
  // Colour has to be derived from --vscode-* theme variables; anything fixed is
  // wrong in one of the two. A hex is fine as the *fallback* in
  // `var(--vscode-x, #abc)` — it only applies when the variable is absent.
  const CSS_PARTNER: Record<string, string> = {
    'media/projectDashboard.js': 'src/views/projectDashboardPanel.ts',
    'media/projectIdeation.js': 'src/views/projectIdeationPanel.ts',
    'media/chatPanel.js': 'src/views/chatWebviewMarkup.ts',
    // Website Studio keeps its CSS in a sibling module rather than in the panel:
    // the wireframe canvas pushed the panel's inline CSS and script past what a
    // template string can hold readably. Both the panel's own markup and the
    // canvas script are painted from there, so both name it as their partner.
    'media/websiteStudio.js': 'src/views/websiteStudioStyles.ts',
    'src/views/websiteStudioPanel.ts': 'src/views/websiteStudioStyles.ts',
  };

  /** Remove `var(--x, fallback)` so a fallback hex is not mistaken for a value. */
  function stripVarFallbacks(line: string): string {
    let out = line;
    let previous = '';
    while (out !== previous) {
      previous = out;
      out = out.replace(/var\(\s*--[a-zA-Z0-9-]+\s*,[^()]*\)/g, 'var(--x)');
    }
    return out;
  }

  it('never paints fixed-colour text onto a themed background', () => {
    // The precise failure is a *fixed* text colour over a background that moves
    // with the theme — that is what produces black-on-dark. A fixed text colour
    // over an equally fixed background is fine and often deliberate: the
    // ideation cards are coloured sticky notes, and status chips pick their own
    // contrast. So a rule is only an offender when it pins `color` without also
    // pinning `background`.
    //
    // Personality Profile is exempt outright: it has a bespoke warm palette the
    // user has asked to keep.
    const EXEMPT = new Set(['src/views/personalityProfilePanel.ts']);
    const FIXED = /(#[0-9a-fA-F]{3,8}|\brgba?\(|\bblack\b|\bwhite\b)/;
    const offenders: string[] = [];

    for (const { file, text } of allWebviewSources) {
      if (EXEMPT.has(file)) { continue; }
      // Work rule-by-rule, not line-by-line: a rule routinely declares its
      // background and its colour on separate lines, and judging the colour
      // without seeing the background misreads a deliberate chip as a bug.
      for (const match of text.matchAll(/\{([^{}]*)\}/g)) {
        const block = stripVarFallbacks(match[1]!);
        const colorMatch = /(^|[\s;])color:\s*([^;]+)/.exec(block);
        if (!colorMatch) { continue; }
        const value = colorMatch[2]!;
        // A colour built on a themed variable still tracks the theme, even when
        // mixed; only a wholly fixed value can be wrong in one theme.
        if (!FIXED.test(value) || value.includes('var(--')) { continue; }
        const pinsBackground = /background(-color|-image)?:\s*[^;]*(#[0-9a-fA-F]{3,8}|\brgba?\()/.test(block);
        if (pinsBackground) { continue; }
        offenders.push(`${file} → color: ${value.trim().slice(0, 60)}`);
      }
    }

    // Two badge rules remain: white/near-black text on a themed chart colour,
    // where the pairing is legible in both themes and changing it would be a
    // restyle rather than a fix.
    const BASELINE = new Set([
      'src/views/settingsPanel.ts → color: #fff',
      'src/views/settingsPanel.ts → color: #1a1a1a',
    ]);

    const regressions = offenders.filter(entry => !BASELINE.has(entry));
    expect(regressions, `fixed text colour on a themed background: ${regressions.join(' | ')}`).toEqual([]);
  });

  it('tints text away from the page background rather than always lightening', () => {
    // `color-mix(..., white 20%)` on a text colour is correct on a dark theme
    // and backwards on a light one, where it washes the text out against the
    // page. `var(--tint-away)` resolves to white on dark and black on light,
    // so the accent always moves away from the background.
    const shell = readFileSync(path.join(VIEWS_DIR, 'webviewUtils.ts'), 'utf8');
    expect(shell).toContain('--tint-away: white');
    expect(shell).toContain('body.vscode-light');
    expect(shell).toMatch(/body\.vscode-light\s*\{[^}]*--tint-away:\s*black/);

    const EXEMPT = new Set(['src/views/personalityProfilePanel.ts']);
    const offenders: string[] = [];
    for (const { file, text } of allWebviewSources) {
      if (EXEMPT.has(file)) { continue; }
      for (const match of text.matchAll(/(^|[\s;{])color:\s*color-mix\([^;]*/gm)) {
        if (/\b(white|black)\b/.test(match[0])) {
          offenders.push(`${file} → ${match[0].trim().slice(0, 70)}`);
        }
      }
    }
    expect(offenders, `text colour-mix still pinned to a literal: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('defines every custom property it uses', () => {
    // An undefined custom property makes the whole declaration invalid, so the
    // rule silently vanishes rather than failing loudly — `--atlas-panel-fg`,
    // `--panel-border` and `--dash-fg` were each dropping styling this way.
    const shared = readFileSync(path.join(VIEWS_DIR, 'dashboardTheme.ts'), 'utf8')
      + readFileSync(path.join(VIEWS_DIR, 'dashboardWidgets.ts'), 'utf8');
    const offenders: string[] = [];
    for (const { file, text } of allWebviewSources) {
      const partnerRel = CSS_PARTNER[file];
      const partner = partnerRel ? readFileSync(path.join(process.cwd(), partnerRel), 'utf8') : '';
      const scope = text + partner + shared;
      const used = new Set([...text.matchAll(/var\((--(?:atlas|dash|run|panel)[a-z-]*)\s*\)/g)].map(m => m[1]!));
      const defined = new Set([...scope.matchAll(/^\s*(--(?:atlas|dash|run|panel)[a-z-]*)\s*:/gm)].map(m => m[1]!));
      for (const token of used) {
        if (!defined.has(token)) { offenders.push(`${file} → ${token}`); }
      }
    }
    expect(offenders, `undefined custom properties: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('button paint ownership', () => {
  // The shared shell paints only unclassed buttons (`button:not([class])`).
  // A classed button must therefore declare its own background somewhere, or
  // it renders as bare text. Before the shell rule was scoped, a class with no
  // rule at all silently inherited the primary fill — which is how a
  // destructive "Remove" became the loudest control on its page, and how chat
  // toggles ended up louder when OFF than when ON.
  const CSS_PARTNER: Record<string, string> = {
    'media/projectDashboard.js': 'src/views/projectDashboardPanel.ts',
    'media/projectIdeation.js': 'src/views/projectIdeationPanel.ts',
    'media/chatPanel.js': 'src/views/chatWebviewMarkup.ts',
    // Website Studio keeps its CSS in a sibling module rather than in the panel:
    // the wireframe canvas pushed the panel's inline CSS and script past what a
    // template string can hold readably. Both the panel's own markup and the
    // canvas script are painted from there, so both name it as their partner.
    'media/websiteStudio.js': 'src/views/websiteStudioStyles.ts',
    'src/views/websiteStudioPanel.ts': 'src/views/websiteStudioStyles.ts',
  };
  // `webviewUtils.ts` joins the shared-CSS scope because QUICK_REPLY_CSS lives
  // there: quick-reply pills render on four surfaces, so their paint is defined
  // once and interpolated into each panel's CSS rather than copied per panel.
  // `lensVisuals.ts` is the same kind of module for the eight Lens surfaces:
  // one definition of the card, the button, and the ⓘ, interpolated into each
  // panel's CSS. Reading it here keeps the guard meaningful for those panels
  // rather than making them opt out of it.
  const shared = readFileSync(path.join(VIEWS_DIR, 'dashboardTheme.ts'), 'utf8')
    + readFileSync(path.join(VIEWS_DIR, 'dashboardWidgets.ts'), 'utf8')
    + readFileSync(path.join(VIEWS_DIR, 'lensVisuals.ts'), 'utf8')
    + readFileSync(path.join(VIEWS_DIR, 'webviewUtils.ts'), 'utf8');

  // Fragments produced by template interpolation, not real class names.
  const NOISE = /[${}?=()'"+:]|^$/;

  it('gives every classed button a background rule of its own', () => {
    const orphans: string[] = [];
    for (const { file, text } of allWebviewSources) {
      const partnerRel = CSS_PARTNER[file];
      const partner = partnerRel ? readFileSync(path.join(process.cwd(), partnerRel), 'utf8') : '';
      const scope = text + partner + shared;

      const classLists = new Set<string>();
      for (const m of text.matchAll(/<button\b[^>]*?\bclass=["']([^"']*)["']/g)) {
        const raw = m[1]!;
        // A partly- or wholly-interpolated attribute cannot be split into class
        // names reliably — `class="${state.x === y ? 'a' : ''}"` shreds into
        // fragments, and `class="${cls} is-actionable"` hides the real class in
        // a variable. Skipping them trades a little coverage for zero false
        // alarms; every orphan this check was written to catch was a literal.
        if (raw.includes('${')) { continue; }
        classLists.add(raw);
      }
      for (const list of classLists) {
        const classes = list.split(/\s+/).filter(c => c && !NOISE.test(c));
        if (classes.length === 0) { continue; }
        const covered = classes.some(cls => {
          const escaped = cls.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
          // `s` flag: CSS rules span lines, so a line-wise match would miss them.
          return new RegExp(`\\.${escaped}[^{}]*\\{[^{}]*background`, 's').test(scope);
        });
        if (!covered) { orphans.push(`${file} → .${classes.join('.')}`); }
      }
    }
    expect(orphans, `classed buttons with no background of their own: ${orphans.join(' | ')}`).toEqual([]);
  });

  it('scopes the shell primary paint to unclassed buttons', () => {
    const shell = readFileSync(path.join(VIEWS_DIR, 'webviewUtils.ts'), 'utf8');
    expect(shell).toContain('button:not([class])');
    // A bare `button:hover { background: … }` outranks every single-class
    // variant at (0,1,1) vs (0,1,0), regardless of source order.
    expect(shell).not.toMatch(/\n\s*button:hover\s*\{/);
  });

  // Scoping the paint above removed `color` from every classed button, and a
  // <button> with no author colour falls back to the UA keyword `buttontext` —
  // black in Chromium whatever the VS Code theme is. Card titles that only set
  // `font-weight` went black-on-black across four dashboards. Nothing caught it:
  // a contrast audit reads *declared* colours, and this was an absent one.
  it('gives every button an explicit text colour so the UA default cannot leak', () => {
    const shell = readFileSync(path.join(VIEWS_DIR, 'webviewUtils.ts'), 'utf8');
    const base = /\n\s*button\s*\{([^}]*)\}/.exec(shell);
    expect(base, 'shell has no base `button { … }` rule').not.toBeNull();
    expect(base![1], 'base button rule must declare a colour').toMatch(/(?:^|[\s;])color\s*:/);
  });

  it('pairs colour and background on text-entry controls', () => {
    // Same failure mode: unstyled, these take the UA `field`/`fieldtext` pair.
    // Declaring only one half lets the other be inherited into same-on-same.
    const shell = readFileSync(path.join(VIEWS_DIR, 'webviewUtils.ts'), 'utf8');
    const rule = /:where\(input[^)]*\)[^{]*\{([^}]*)\}/.exec(shell);
    expect(rule, 'shell has no text-entry control defaults').not.toBeNull();
    expect(rule![1]).toMatch(/(?:^|[\s;])color\s*:/);
    expect(rule![1]).toMatch(/(?:^|[\s;])background\s*:/);
  });
});

describe('generated glyphs survive encoding', () => {
  // Two panels shipped `content: " ▾"` with the character's UTF-8 lead bytes
  // stripped, leaving a raw U+0015 control char followed by a literal "BE". It
  // rendered as tofu next to every hero badge and nothing failed. A control
  // character in source is never intentional, so this is safe to assert flatly.
  it('has no C0 control characters in webview source', () => {
    // Tested by code point rather than a character class: a regex literal
    // spelling out C0 would itself contain the bytes this check exists to ban.
    const ALLOWED = new Set([0x09, 0x0a, 0x0d]);
    const offenders: string[] = [];
    for (const { file, text } of allWebviewSources) {
      text.split('\n').forEach((line, index) => {
        for (const char of line) {
          const code = char.codePointAt(0)!;
          if (code < 0x20 && !ALLOWED.has(code)) {
            offenders.push(`${file}:${index + 1} contains U+${code.toString(16).padStart(4, '0').toUpperCase()}`);
            return;
          }
        }
      });
    }
    expect(offenders, offenders.join(' | ')).toEqual([]);
  });
});

describe('skill scanner panel', () => {
  const source = readFileSync(path.join(VIEWS_DIR, 'skillScannerPanel.ts'), 'utf8');

  it('resets built-in overrides without deleting the user\'s custom rules', () => {
    // The control says "Reset all built-ins". It used to post
    // saveAll { overrides: {}, customRules: [] }, which also wiped every custom
    // rule the user had written — an unannounced destructive side effect.
    expect(source).not.toContain("type: 'saveAll'");
    expect(source).toContain("type: 'resetAllBuiltIns'");
    expect(source).toContain('customRules: current.customRules');
  });

  it('confirms the destructive reset before firing', () => {
    expect(source).toContain('reset-all-confirm');
  });

  it('validates each inbound message against its own shape', () => {
    // isPanelMessage used to accept any object with a string `type`, so the
    // saveAll branch handed an unvalidated payload straight to replaceConfig()
    // — the rule set that decides which skills may run.
    expect(source).toContain('function isSerializedScanRule');
    expect(source).toMatch(/case 'resetRule':\s*\n\s*case 'deleteRule':/);
    expect(source).not.toMatch(/typeof \(raw as Record<string, unknown>\)\['type'\] === 'string'\s*\n\s*\);/);
  });

  it('renders no VS Code codicon tokens into raw HTML', () => {
    const codicons = source.match(/\$\((?!\{)[a-z-]+\)/g) ?? [];
    expect(codicons, `codicon syntax is not interpreted in webview HTML: ${codicons.join(', ')}`).toEqual([]);
  });
});

describe('codicon usage across panels', () => {
  it('never emits codicon syntax into webview markup', () => {
    // `$(eye)` is understood by tree items, the status bar and QuickPicks — but
    // not in a webview, where it renders as literal text. QuickPick labels and
    // `$(id)`-style DOM helpers are legitimate, so only lines that are building
    // HTML are flagged.
    const offenders: string[] = [];
    for (const { file, text } of allWebviewSources) {
      text.split('\n').forEach((line, index) => {
        const hasTag = /<[a-z][a-z0-9]*[\s/>]/i.test(line);
        const codicon = line.match(/\$\((?!\{)[a-z][a-z0-9-]*\)/g);
        if (hasTag && codicon) {
          offenders.push(`${file}:${index + 1} → ${[...new Set(codicon)].join(' ')}`);
        }
      });
    }
    expect(offenders, `codicons do not render in webview HTML: ${offenders.join(' | ')}`).toEqual([]);
  });
});

describe('no control advertises a capability it lacks', () => {
  it('chat ships no unwired dictation button', () => {
    // #toggleDictation rendered as a fully live control — aria-pressed, a
    // .listening state, a pulse animation — with zero references in any
    // script. In-chat dictation is not implemented; the button only implied
    // it was.
    const markup = readFileSync(path.join(VIEWS_DIR, 'chatWebviewMarkup.ts'), 'utf8');
    expect(markup).not.toContain('toggleDictation');
    expect(markup).not.toContain('mic-btn');
  });

  it('wires open-file buttons by delegation, so late-injected ones work', () => {
    // Settings binds at load, but the AI-instruction paths are injected by
    // innerHTML after a scan returns — a one-shot querySelectorAll never saw
    // them, leaving every one of those buttons dead.
    const settings = readFileSync(path.join(VIEWS_DIR, 'settingsPanel.ts'), 'utf8');
    expect(settings).not.toMatch(/document\.querySelectorAll\('\[data-open-file\]'\)/);
    expect(settings).toMatch(/closest\('\[data-open-file\]'\)/);
  });

  it('does not offer a drag handle where the layout is computed', () => {
    // A projected lens derives card positions, so the drag read a stored
    // origin while the card was drawn somewhere else — the first move
    // teleported it.
    const script = readFileSync(path.join(process.cwd(), 'media', 'projectIdeation.js'), 'utf8');
    expect(script).toContain('function isProjectedLens');
    expect(script).toMatch(/if \(isProjectedLens\(state\.boardLens\)\) \{\s*return;/);
    const panel = readFileSync(path.join(VIEWS_DIR, 'projectIdeationPanel.ts'), 'utf8');
    expect(panel).toContain('.ideation-board-projected .ideation-card-head');
  });
});

describe('mcp hero badge filters', () => {
  const source = readFileSync(path.join(VIEWS_DIR, 'mcpPanel.ts'), 'utf8');

  it('filters on tokens that cannot collide as substrings', () => {
    // "connected" is a substring of "disconnected", so the connected filter
    // matched the servers it was meant to exclude; "enabled" was never in the
    // search haystack at all, so that badge matched nothing.
    expect(source).toContain('data-search-query="status:connected"');
    expect(source).toContain('data-search-query="state:enabled"');
    expect(source).toContain('`status:${status}`');
    expect(source).toContain("`state:${config.enabled ? 'enabled' : 'disabled'}`");
  });
});

describe('ideation inspector', () => {
  const script = readFileSync(path.join(process.cwd(), 'media', 'projectIdeation.js'), 'utf8');

  it('updates the score readout while the slider moves', () => {
    // The readout was rendered once and only caught up on the next full
    // re-render, so dragging gave no numeric feedback.
    expect(script).toContain("target.getAttribute('type') === 'range'");
    expect(script).toContain("field.querySelector('.stat-detail')");
  });
});

describe('chat panel controls', () => {
  const script = readFileSync(path.join(process.cwd(), 'media', 'chatPanel.js'), 'utf8');

  it('persists the font scale to the host, not just to webview state', () => {
    // vscode.setState dies with the webview. The host already handles
    // 'saveFontScale' and seeds the scale from globalState on load, so without
    // this the A- / A+ buttons reset every time the panel was reopened.
    expect(script).toContain("type: 'saveFontScale'");
  });

  it('arms close-on-outside-click when the model menu opens', () => {
    // It used to be registered at render time with a self-removing handler, so
    // the first click anywhere consumed it — usually before the menu had ever
    // been opened, leaving the dropdown stuck open afterwards.
    expect(script).toContain('closeOnOutsideClick');
    expect(script).toMatch(/if \(willOpen\) \{\s*document\.addEventListener\('click', closeOnOutsideClick/);
  });

  it('does not present an empty response as an answer and points to rendered reply chips', () => {
    expect(script).toContain('!/^Answered from context/i.test(thoughtSummary)');
    expect(script).toContain('No usable answer was returned.');
    expect(script).toContain('Choose an option below, or type a different response.');
  });
});

describe('webview content sizing', () => {
  const shell = readFileSync(path.join(VIEWS_DIR, 'webviewUtils.ts'), 'utf8');
  const ideation = readFileSync(path.join(VIEWS_DIR, 'projectIdeationPanel.ts'), 'utf8');

  it('does not make inline text and controls zero-width flex candidates', () => {
    const structuralRule = /:where\(([^)]*)\)\s*\{\s*min-width:\s*0;/.exec(shell);
    expect(structuralRule, 'shared structural min-width rule is missing').not.toBeNull();
    const selectors = structuralRule![1]!.split(',').map(value => value.trim());
    expect(selectors).not.toEqual(expect.arrayContaining([
      'button',
      'label',
      'span',
      'strong',
      'small',
      'em',
      'a',
    ]));
  });

  it('wraps prose at word boundaries and reserves anywhere breaks for URLs', () => {
    const proseRule = /:where\(p,[^)]*\)\s*\{([^}]*)\}/.exec(shell);
    expect(proseRule, 'shared prose wrapping rule is missing').not.toBeNull();
    expect(proseRule![1]).toMatch(/overflow-wrap:\s*break-word/);
    expect(proseRule![1]).toMatch(/word-break:\s*normal/);

    const linkRule = /:where\(a\)\s*\{([^}]*)\}/.exec(shell);
    expect(linkRule, 'shared long-link containment rule is missing').not.toBeNull();
    expect(linkRule![1]).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('lets buttons use their content width without exceeding their panel', () => {
    const buttonRule = /\n\s*button\s*\{([^}]*)\}/.exec(shell);
    expect(buttonRule, 'shared button rule is missing').not.toBeNull();
    expect(buttonRule![1]).toMatch(/max-width:\s*100%/);
    expect(buttonRule![1]).toMatch(/white-space:\s*normal/);
  });

  it('keeps ideation labels and badges intact while flexible text gets the space', () => {
    expect(ideation).toMatch(/\.ideation-dist-row\s*\{[^}]*grid-template-columns:\s*max-content\s+minmax\(0,\s*1fr\)\s+max-content/s);
    expect(ideation).toMatch(/\.ideation-check\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
    expect(ideation).toMatch(/\.ideation-check input\[type="checkbox"\]\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
  });
});

describe('tool webhook panel', () => {
  const source = readFileSync(path.join(VIEWS_DIR, 'toolWebhookPanel.ts'), 'utf8');

  it('collects the bearer token in an inline field', () => {
    expect(source).toContain('id="tokenInput"');
    expect(source).toContain('type="password"');
  });

  it('never renders a stored token back into the markup', () => {
    // The token lives in SecretStorage; the panel may report whether one is
    // configured but must not echo the value.
    expect(source).not.toMatch(/value="\$\{[^}]*token[^}]*\}"/i);
  });
});
