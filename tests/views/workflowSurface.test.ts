import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The Workflow page is a teaching surface, which puts a handful of properties
 * beyond "it renders" into the load-bearing category:
 *
 * - Its `?` explanations must survive a re-render, because `render()` rebuilds
 *   every page's `innerHTML` on every host status push and a native
 *   `<details open>` would snap shut mid-read.
 * - Its toggles must keep keyboard focus, or the page is unusable without a
 *   mouse — which for a surface aimed at people learning is worse than useless.
 * - Its empty states must explain the feature rather than report emptiness, and
 *   must never render an unmeasured value as a confident zero.
 *
 * None of those can be asserted by type-checking, so they are asserted against
 * the real webview source here.
 */

const WEBVIEW_SCRIPT = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
);

/** The body of a named render function, up to the next one. */
function renderSource(name: string, until: string): string {
  const start = WEBVIEW_SCRIPT.indexOf(`function ${name}(snapshot)`);
  expect(start, `${name} is missing from the webview script`).toBeGreaterThan(-1);
  const end = WEBVIEW_SCRIPT.indexOf(`function ${until}(snapshot)`, start);
  return WEBVIEW_SCRIPT.slice(start, end === -1 ? undefined : end);
}

/** The body of `renderWorkflow`, up to the next top-level render function. */
function workflowRenderSource(): string {
  const start = WEBVIEW_SCRIPT.indexOf('function renderWorkflow(snapshot)');
  expect(start, 'renderWorkflow is missing from the webview script').toBeGreaterThan(-1);
  const end = WEBVIEW_SCRIPT.indexOf('function renderRoadmap(snapshot)', start);
  return WEBVIEW_SCRIPT.slice(start, end === -1 ? undefined : end);
}

/**
 * The same body with `//` comment lines removed.
 *
 * Needed because several comments here quote the very strings they exist to
 * forbid — "never 0% passing" is the clearest statement of the rule and would
 * otherwise trip the assertion enforcing it.
 */
function workflowRenderedStrings(): string {
  return workflowRenderSource()
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
}

describe('the Workflow page exists on both sides of the boundary', () => {
  it('renders a workflow section and is wired into the page template', () => {
    expect(WEBVIEW_SCRIPT).toContain("pageSectionOpen('workflow')");
    expect(WEBVIEW_SCRIPT).toContain('${renderWorkflow(snapshot)}');
  });

  it('sits in the nav under "The work"', () => {
    expect(WEBVIEW_SCRIPT).toContain("['workflow', 'Workflow']");
  });
});

describe('help disclosures survive a re-render', () => {
  it('holds open/closed state in the module closure, not in the DOM', () => {
    // `render()` replaces innerHTML wholesale. Module state survives that; a
    // native <details open> attribute does not.
    expect(WEBVIEW_SCRIPT).toContain('workflowHelpOpen: {}');
    expect(WEBVIEW_SCRIPT).toContain("state.workflowHelpOpen[payload] = !state.workflowHelpOpen[payload]");
  });

  it('does not use a native <details> element for workflow help', () => {
    const source = workflowRenderSource() + WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function renderWorkflowHelp'),
      WEBVIEW_SCRIPT.indexOf('function renderWorkflow(snapshot)'),
    );
    expect(source).not.toContain('<details');
  });

  it('reflects its state in aria-expanded and names what it controls', () => {
    const source = WEBVIEW_SCRIPT.slice(WEBVIEW_SCRIPT.indexOf('function renderWorkflowHelp'));
    expect(source).toContain('aria-expanded=');
    expect(source).toContain('aria-controls=');
  });
});

describe('help toggles stay reachable by keyboard', () => {
  it('re-focuses the toggle that triggered the render', () => {
    // The existing focus-restoration path covers three hardcoded inputs only.
    // Without this, every activation of a "?" silently drops focus to <body>.
    expect(WEBVIEW_SCRIPT).toContain('refocusAfterRender');
    expect(WEBVIEW_SCRIPT).toContain('data-action="workflow-help"][data-payload=');
    expect(WEBVIEW_SCRIPT).toContain('const refocusSelector = refocusAfterRender;');
    expect(WEBVIEW_SCRIPT).toContain("refocusAfterRender = '';");
  });

  it('clears the pending selector so it cannot leak into an unrelated render', () => {
    const renderStart = WEBVIEW_SCRIPT.indexOf('const refocusSelector = refocusAfterRender;');
    const clearAt = WEBVIEW_SCRIPT.indexOf("refocusAfterRender = '';", renderStart);
    expect(clearAt).toBeGreaterThan(renderStart);
  });

  it('uses a real button so it inherits the shared focus ring', () => {
    const source = WEBVIEW_SCRIPT.slice(WEBVIEW_SCRIPT.indexOf('function renderWorkflowHelp'));
    expect(source).toContain('<button type="button" class="wf-help-toggle"');
  });

  it('escapes the id before building a selector from it', () => {
    expect(WEBVIEW_SCRIPT).toContain('function cssEscape(');
    expect(WEBVIEW_SCRIPT).toContain('cssEscape(payload)');
  });
});

describe('empty states teach rather than report emptiness', () => {
  const source = workflowRenderSource();
  // These contracts moved with their content when Issues, Pull Requests and
  // Pipeline each got a page. The assertions follow them rather than being
  // dropped — the rule is about the surface, not about which file it lives in.
  const prSource = renderSource('renderPullRequests', 'renderPipeline');
  const pipelineSource = renderSource('renderPipeline', 'renderWorkflow');

  it('explains what issue intake is for when issues were never loaded', () => {
    expect(prSource).toContain('Open the Issues tab and refresh');
    expect(pipelineSource).toContain('Open the Issues tab and refresh');
  });

  it('distinguishes "no pull requests loaded" from "none open"', () => {
    // A row of zeroes for a list nobody fetched is the same class of lie as
    // "0 failing" for a test suite that never ran.
    expect(prSource).toContain('Pull requests have not been loaded');
    expect(prSource).toContain('No open pull requests');
    // Chosen by presence, not by a count — an empty-but-loaded list still
    // renders real zeroes while an unloaded one renders the explanation.
    expect(prSource).toMatch(/if \(!metrics\)/);
  });

  it('never renders an unmeasured CI state as a passing or zero-failure result', () => {
    // "No report ⇒ no verdict, never 0 failing" — inherited from the testing
    // policy coverage contract, and the most important honesty rule here.
    expect(pipelineSource).toContain('CI has not been read');
    expect(pipelineSource).toContain('reports no verdict rather than implying a green build');
    expect(workflowRenderedStrings()).not.toMatch(/0%\s*passing/i);
  });

  it('keeps "not read", "no failures", and "failed but unreadable" as three distinct states', () => {
    // Collapsing any pair lets one read as another. The worst collapse is
    // "we could not read the log" showing as "nothing failed".
    expect(pipelineSource).toContain('CI has not been read');
    expect(pipelineSource).toContain('No failing runs');
    expect(pipelineSource).toContain('its log could not be read');
  });

  it('shows an unknown CI classification as itself rather than dressing it up', () => {
    const failure = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function renderCiFailure'),
      WEBVIEW_SCRIPT.indexOf('function formatDuration'),
    );
    expect(failure).toContain('AtlasMind is not guessing');
    expect(failure).toContain('needs a human');
  });

  it('reports log truncation and redaction rather than hiding them', () => {
    const failure = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function renderCiFailure'),
      WEBVIEW_SCRIPT.indexOf('function formatDuration'),
    );
    expect(failure).toContain('report.truncated');
    expect(failure).toContain('report.redacted');
  });

  it('escapes every log evidence line before rendering it', () => {
    // A CI log is untrusted: it echoes branch names, commit messages, and
    // whatever else ended up in the build output.
    const failure = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function renderCiFailure'),
      WEBVIEW_SCRIPT.indexOf('function formatDuration'),
    );
    expect(failure).toContain('report.evidenceLines || []).map(line => escapeHtml(line))');
    expect(failure).toContain('escapeHtml(report.jobName');
  });

  it('lets long log lines scroll inside their own container', () => {
    // A single long line must never make the page body scroll horizontally.
    const css = readFileSync(
      path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
      'utf8',
    );
    const block = css.slice(css.indexOf('.wf-ci-evidence'), css.indexOf('.wf-glossary dt'));
    expect(block).toContain('overflow: auto');
    expect(block).toContain('max-height');
  });

  it('renders an absent verdict as an em dash with its reason, never as zero', () => {
    const verdict = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function renderVerdict(verdict, format)'),
      WEBVIEW_SCRIPT.indexOf('function renderWorkflow(snapshot)'),
    );
    expect(verdict).toContain("verdict.known === true");
    expect(verdict).toContain('wf-unknown');
    expect(verdict).toContain('—');
  });

  it('names the components excluded from the health score', () => {
    // A score of 80 must not be readable as "80% of everything is fine".
    expect(source).toContain('Not counted in the score');
    expect(source).toContain('left out rather than scored zero');
  });
});

describe('security and CSP conventions', () => {
  const source = workflowRenderSource();

  it('uses no inline event handlers', () => {
    expect(source).not.toMatch(/\son(click|change|input|submit)=/);
  });

  it('renders documentation URLs as text rather than as anchors', () => {
    // The dashboard CSP requires a nonce for scripts and routes external
    // navigation through the host, so a raw href is either dead or a hole.
    const help = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function renderWorkflowHelp'),
      WEBVIEW_SCRIPT.indexOf('function renderWorkflow(snapshot)'),
    );
    expect(help).not.toContain('<a href');
  });

  it('escapes every snapshot value it puts directly into markup', () => {
    // Named fields rather than a catch-all regex. Note the deliberate omission
    // of `stage.ownerAgentId` and `stage.determinism`: those are composed into
    // a guidance-line *data* string, which `renderWorkflowHelp` escapes at
    // render time. The invariant covering them is the one asserted below.
    const mustBeEscaped = [
      'stage.name', 'stage.blurb',
      'step.title', 'step.detail', 'step.proficiency', 'release.drift',
    ];
    const whole = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function renderWorkflowHelp'),
      WEBVIEW_SCRIPT.indexOf('function renderRoadmap(snapshot)'),
    );
    for (const field of mustBeEscaped) {
      const raw = new RegExp(`\\$\\{\\s*${field.replace('.', '\\.')}`);
      const escaped = new RegExp(`escape(Html|Attr)\\([^)]*${field.replace('.', '\\.')}`);
      if (raw.test(whole)) {
        expect(escaped.test(whole), `${field} is interpolated without escaping`).toBe(true);
      }
    }
  });

  it('escapes branch names, which come from the repository rather than from us', () => {
    expect(source).toContain('escapeHtml(branches.nonConforming.slice(0, 8).join');
  });

  it('escapes every part of a guidance line, whatever was composed into it', () => {
    // This is what makes composing a stage's owner or determinism note into a
    // guidance line safe: the escape happens once, at the single point every
    // line passes through on its way into markup.
    const help = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function renderWorkflowHelp'),
      WEBVIEW_SCRIPT.indexOf('function snapshotGlossary'),
    );
    expect(help).toContain("escapeHtml(line.text || '')");
    expect(help).toContain('escapeHtml(line.command)');
    expect(help).toContain('escapeHtml(line.url)');
    expect(help).toContain("escapeHtml(payload.why || '')");
    expect(help).toContain('escapeHtml(item)');
    expect(help).toContain('escapeHtml(entry.term)');
    expect(help).toContain('escapeHtml(entry.definition)');
  });
});

describe('the page costs nothing to open', () => {
  it('makes no network request from the render path', () => {
    const source = workflowRenderSource();
    expect(source).not.toContain('postMessage');
  });
});
