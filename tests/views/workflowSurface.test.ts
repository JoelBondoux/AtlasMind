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

/** The host side: the panel's own markup and stylesheet. */
const HOST_PANEL = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
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
      WEBVIEW_SCRIPT.indexOf('function renderInfoHelp'),
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
    expect(source).toMatch(/<button type="button" class="wf-help-toggle\$\{/);
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
  });

  it('lets the Pipeline page read the data it renders', () => {
    // It used to send you to the Issues tab, because CI was only ever fetched
    // as a side effect of that refresh. A page whose whole subject is "did the
    // build pass" could not go and find out.
    expect(pipelineSource).toContain('pipeline-refresh');
    expect(pipelineSource).toContain('Read CI result');
    expect(pipelineSource).not.toContain('Open the Issues tab and refresh');
  });

  it('distinguishes "the run list could not be read" from "nothing failed"', () => {
    // An empty run list means one of two opposite things, and only one of them
    // is news about the build.
    expect(pipelineSource).toContain('The run list could not be read');
    expect(pipelineSource).toContain('${fetchFailure ?');
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
    expect(pipelineSource).toContain('No CI result has been read yet');
    expect(pipelineSource).toContain('This does not mean the build passed');
    expect(workflowRenderedStrings()).not.toMatch(/0%\s*passing/i);
  });

  it('keeps "not read", "no failures", and "failed but unreadable" as three distinct states', () => {
    // Collapsing any pair lets one read as another. The worst collapse is
    // "we could not read the log" showing as "nothing failed".
    // These live in Activity now; the states are the contract, not the tab.
    expect(WEBVIEW_SCRIPT).toContain('No CI result has been read yet');
    expect(WEBVIEW_SCRIPT).toContain('This does not mean the build passed');
    expect(WEBVIEW_SCRIPT).toContain('The run list could not be read');
    expect(WEBVIEW_SCRIPT).toContain('its log could not be read');
    expect(WEBVIEW_SCRIPT).toContain('That is not evidence that the build passed');
  });

  it('shows an unknown CI classification as itself rather than dressing it up', () => {
    const failure = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function renderCiFailure'),
      WEBVIEW_SCRIPT.indexOf('function formatDuration(verdict)'),
    );
    expect(failure).toContain('AtlasMind is not guessing');
    expect(failure).toContain('needs a human');
  });

  it('reports log truncation and redaction rather than hiding them', () => {
    const failure = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function renderCiFailure'),
      WEBVIEW_SCRIPT.indexOf('function formatDuration(verdict)'),
    );
    expect(failure).toContain('report.truncated');
    expect(failure).toContain('report.redacted');
  });

  it('escapes every log evidence line before rendering it', () => {
    // A CI log is untrusted: it echoes branch names, commit messages, and
    // whatever else ended up in the build output.
    const failure = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function renderCiFailure'),
      WEBVIEW_SCRIPT.indexOf('function formatDuration(verdict)'),
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

describe('the Pipeline CI management surface', () => {
  const source = (): string => renderSource('renderPipeline', 'renderWorkflow');

  it('teaches definition, assignment, and enforcement as separate layers', () => {
    expect(source()).toContain('Definition — a workflow file');
    expect(source()).toContain('Assignment — the on: section');
    expect(source()).toContain('Enforcement — a required status check');
    expect(source()).toContain('<strong>Define</strong>');
    expect(source()).toContain('<strong>Assign</strong>');
    expect(source()).toContain('<strong>Enforce</strong>');
  });

  it('stays useful before CI run history has been fetched', () => {
    const body = source();
    expect(body).toContain('${renderPipelineTabs(snapshot, runs, pipelineSection, setup)}');
    expect(body).toContain('setup: overviewContent');
    expect(body).toContain('activity: renderPipelineActivity(');
    expect(body).toContain('tests: renderPipelineTests(');
    expect(body).toContain('rules: renderPipelineRules(');
    expect(body).not.toMatch(/if \(!intel\)\s*\{\s*return/);
  });

  it('renders a provider-aware local runner command centre before any job starts', () => {
    const body = source();
    expect(body).toContain('Trusted local CI · temporary runner');
    expect(body).toContain('GitHub Actions → Docker');
    expect(body).toContain('Buildkite');
    expect(body).toContain('Semaphore');
    expect(body).toContain('pipeline-runner-inspect');
    expect(body).toContain('pipeline-runner-start');
    expect(body).toContain('pipeline-runner-output');
    expect(body).toContain('Evidence boundary:');
  });

  it('shows the actual resource calculation and Docker shutdown guard', () => {
    const body = source();
    expect(body).toContain('Docker capacity');
    expect(body).toContain('Runner limit');
    expect(body).toContain('Desktop reserve');
    expect(body).toContain('Other containers');
    expect(body).toContain('runnerResources.explanation');
    expect(body).toContain('Machine-scoped policy');
  });

  it('posts no workflow, image, branch, label, or resource value when starting', () => {
    expect(WEBVIEW_SCRIPT).toContain("vscode.postMessage({ type: 'startLocalCiRunner' });");
    expect(WEBVIEW_SCRIPT).not.toMatch(/type: 'startLocalCiRunner',\s*payload/);
    expect(WEBVIEW_SCRIPT).toContain("vscode.postMessage({ type: 'inspectLocalCiRunner' });");
  });

  it('shows workflow triggers, jobs, safeguards, and declared delivery bindings', () => {
    const body = source();
    expect(body).toContain('workflow.triggers');
    expect(body).toContain('workflow.jobs');
    expect(body).toContain('workflow.hasExplicitPermissions');
    expect(body).toContain('workflow.hasConcurrency');
    expect(body).toContain('requiredChecks');
    expect(body).toContain('Confirm the same names are required in GitHub branch protection');
  });

  it('sends no YAML, command, path, or branch in the create request', () => {
    expect(WEBVIEW_SCRIPT).toContain("vscode.postMessage({ type: 'createCiStarter' });");
    expect(WEBVIEW_SCRIPT).not.toMatch(/type: 'createCiStarter',\s*payload/);
  });

  it('reviews an existing workflow by opaque filename rather than browser-authored content', () => {
    expect(WEBVIEW_SCRIPT).toContain("type: 'reviewCiWorkflow', payload: payload");
    const host = readFileSync(
      path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
      'utf8',
    );
    expect(host).toContain("collectWorkflowSnapshot(workspaceRoot)).find(candidate => candidate.id === workflowId)");
    expect(host).toContain("flag: 'wx'");
    expect(host).toContain('UNREADABLE_CI_WORKFLOW_CAUTION');
    expect(host).toContain('could not inspect every existing workflow');
    expect(host).toContain('Existing files are never overwritten.');
  });
});

describe('Pipeline Studio progressive workflow', () => {
  const css = readFileSync(
    path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
    'utf8',
  );
  const localCiSource = readFileSync(
    path.join(process.cwd(), 'src', 'core', 'localCiRunner.ts'),
    'utf8',
  );

  it('offers four views named by what a person is doing, and remaps the old eight', () => {
    // Four views named by what a person is doing, not by which subsystem
    // produced the data. Setup is addressable but is deliberately not a tab.
    expect(WEBVIEW_SCRIPT).toContain("const PIPELINE_SECTIONS = ['activity', 'canvas', 'tests', 'rules', 'setup']");
    expect(WEBVIEW_SCRIPT).toContain("label: 'Activity'");
    expect(WEBVIEW_SCRIPT).toContain("label: 'Canvas'");
    expect(WEBVIEW_SCRIPT).toContain("label: 'Rules'");
    expect(WEBVIEW_SCRIPT).toContain('Next: ${escapeHtml(focus.title)}');
    expect(WEBVIEW_SCRIPT).toContain('role="tablist" aria-label="Pipeline views"');
    // A tab id persisted by the eight-tab layout must still land somewhere real.
    expect(WEBVIEW_SCRIPT).toContain('PIPELINE_SECTION_ALIASES');
    expect(WEBVIEW_SCRIPT).toContain("overview: 'setup', builds: 'activity', analytics: 'activity'");
  });

  it('uses reusable accessible information controls instead of decorative icons', () => {
    expect(WEBVIEW_SCRIPT).toContain("return renderWorkflowHelp(id, payload, { symbol: 'i' });");
    expect(WEBVIEW_SCRIPT).toContain("const symbol = options.symbol === 'i' ? 'i' : '?';");
    expect(WEBVIEW_SCRIPT).toContain('aria-expanded=');
    expect(WEBVIEW_SCRIPT).toContain('aria-controls=');
    expect(css).toContain('.info-help-toggle');
  });

  it('animates measured dials into a resolved tick and respects reduced motion', () => {
    const dial = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function renderPipelineDial'),
      WEBVIEW_SCRIPT.indexOf('function renderPipelineTabs'),
    );
    expect(dial).toContain('data-anim-key="ci-dial:');
    expect(dial).toContain('ci-dial-check');
    expect(dial).toContain("options.resolved === true");
    expect(css).toContain('.ci-status-dial.is-resolved .ci-dial-check');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.ci-dial-value');
  });

  it('provides a persistent read-only graph for pointer and keyboard users', () => {
    // The canvas gained overlays but never gained the ability to edit a
    // workflow — that promise is the reason dragging is safe.
    expect(WEBVIEW_SCRIPT).toContain('Dragging changes presentation only. Nothing here edits a workflow.');
    expect(WEBVIEW_SCRIPT).toContain("node.addEventListener('pointerdown'");
    expect(WEBVIEW_SCRIPT).toContain('node.setPointerCapture(event.pointerId)');
    expect(WEBVIEW_SCRIPT).toContain('ArrowLeft: [-1, 0], ArrowRight: [1, 0]');
    expect(WEBVIEW_SCRIPT).toContain('pipelineNodePositions: state.pipelineNodePositions');
    expect(WEBVIEW_SCRIPT).toContain("data-action=\"pipeline-graph-reset\"");
  });

  it('shows current test evidence without inventing flake or timing history', () => {
    expect(WEBVIEW_SCRIPT).toContain('Latest test report');
    expect(WEBVIEW_SCRIPT).toContain('History required');
    expect(WEBVIEW_SCRIPT).toContain('reports no flake count');
    expect(WEBVIEW_SCRIPT).toContain('Timing not recorded');
    expect(WEBVIEW_SCRIPT).toContain('never turns “no report” into zero failures');
  });

  it('measures answer time and reliability from observed timestamps, and says over what', () => {
    // The Analytics tab is gone. Its one durable contract — never present a
    // measurement without the window and the caveat — moved into Activity.
    expect(WEBVIEW_SCRIPT).toContain('Recent history');
    expect(WEBVIEW_SCRIPT).toContain('Height is elapsed time including queue wait');
    // The strip now carries a time axis, and the caption states what the axis
    // is *not*: bars are one per run and evenly spaced, so a burst and a steady
    // month draw identically. An axis implying otherwise would read as more
    // information than the strip has.
    expect(WEBVIEW_SCRIPT).toContain('ci-ribbon-axis');
    expect(WEBVIEW_SCRIPT).toContain('spaced one per run rather than by when they happened');
    expect(WEBVIEW_SCRIPT).toContain('Median elapsed time including queue wait, which needs at least 3 completed runs');
    expect(WEBVIEW_SCRIPT).toContain('Needs 3 completed runs');
    expect(WEBVIEW_SCRIPT).toContain('Runs GitHub returned for this branch');
  });

  it('maps monorepo impact and supply-chain controls without claiming a registry exists', () => {
    expect(WEBVIEW_SCRIPT).toContain('Build only what changed');
    expect(WEBVIEW_SCRIPT).toContain('it is not a dependency-graph claim');
    expect(WEBVIEW_SCRIPT).toContain('Supply-chain inventory');
    expect(WEBVIEW_SCRIPT).toContain('(values unread)');
    expect(WEBVIEW_SCRIPT).toContain('Registry adapter not configured');
    expect(WEBVIEW_SCRIPT).toContain('does not host packages or claim cache hits');
  });

  it('reports GPU capability separately from container privilege', () => {
    expect(WEBVIEW_SCRIPT).toContain('Graphics capability');
    expect(WEBVIEW_SCRIPT).toContain('Docker GPU runtime');
    expect(WEBVIEW_SCRIPT).toContain('CI container access');
    expect(WEBVIEW_SCRIPT).toContain('Off by policy');
    expect(WEBVIEW_SCRIPT).toContain('The runner command never adds --gpus.');
  });

  it('guides a novice through installation without pretending a permanent daemon is needed', () => {
    expect(WEBVIEW_SCRIPT).toContain('No permanent runner daemon:');
    expect(WEBVIEW_SCRIPT).toContain('Inspect before installing anything');
    expect(WEBVIEW_SCRIPT).toContain('operating-system applications installed outside this workspace');
    expect(WEBVIEW_SCRIPT).toContain('do not write application files into this repository');
    expect(WEBVIEW_SCRIPT).toContain('Open Docker’s official installation guide');
    // The GitHub CLI card now leads with an install AtlasMind can run after
    // showing the exact command, with the official page kept beside it — the
    // link is the fallback for platforms with no reviewed command, not the
    // only route.
    expect(WEBVIEW_SCRIPT).toContain('Install it for me');
    expect(WEBVIEW_SCRIPT).toContain('pipeline-install-gh');
    expect(WEBVIEW_SCRIPT).toContain('Official installation page');
    expect(WEBVIEW_SCRIPT).toContain('gh auth login --hostname github.com --web');
    expect(WEBVIEW_SCRIPT).toContain('This may be run in the VS Code terminal');
    expect(WEBVIEW_SCRIPT).toContain('AtlasMind never runs an installer for you.');
    expect(WEBVIEW_SCRIPT).not.toContain('winget install --exact --id Docker.DockerDesktop');
    expect(WEBVIEW_SCRIPT).not.toContain('brew install --cask docker');
    expect(css).toContain('LOCAL_CI_SETUP_HELP_URLS');
    expect(css).toContain("Object.hasOwn(LOCAL_CI_SETUP_HELP_URLS, candidate['payload'])");
  });

  it('separates effective permission, prerequisite inspection, queueing, and runner start', () => {
    expect(WEBVIEW_SCRIPT).toContain('permission ${runnerEnablement.effective ? \'On\' : \'Off\'}');
    expect(WEBVIEW_SCRIPT).toContain('Inspect this computer');
    expect(WEBVIEW_SCRIPT).toContain('gh workflow run ${escapeHtml(runner.workflowFile');
    expect(WEBVIEW_SCRIPT).toContain('Copy the complete GitHub queue command');
    expect(WEBVIEW_SCRIPT).toContain('typed, not run');
    expect(WEBVIEW_SCRIPT).toContain("vscode.postMessage({ type: 'copyLocalCiQueueCommand' });");
    expect(WEBVIEW_SCRIPT).toContain("vscode.postMessage({ type: 'sendLocalCiQueueCommandToTerminal' });");
    expect(WEBVIEW_SCRIPT).toContain('PowerShell, Command Prompt, bash or zsh');
    expect(WEBVIEW_SCRIPT).not.toContain('<code>--ref ${escapeHtml(runner.trustedBranch');
    expect(WEBVIEW_SCRIPT).toContain('Cancel the stale run before queueing this checkout');
    expect(WEBVIEW_SCRIPT).toContain('Check GitHub queue → review start plan');
    expect(WEBVIEW_SCRIPT).toContain('It cannot include uncommitted or unpushed files');
    expect(WEBVIEW_SCRIPT).toContain('checks both pending and queued runs');
    expect(WEBVIEW_SCRIPT).not.toContain("actionLabel: runner.enabled ? 'Inspect machine' : 'Enable runner'");
    expect(css).toContain('.ci-machine-setup');
    expect(localCiSource).toContain("'--status', 'pending'");
    expect(localCiSource).toContain('preflightIssue: error.issue');
    expect(css).toContain("configuration.inspect<boolean>('ci.localRunner.enabled')");
    expect(css).toContain('this.localCiRunnerInstance?.applyConfiguration(configuration, false);');
    expect(css).toContain('enablement: readLocalCiRunnerEnablement()');
  });

  it('offers to queue the trusted workflow itself, without letting the page say what gets queued', () => {
    // Step 2 of the borrowed-machine guide used to be an instruction. It is now
    // an offer, with the typed command kept as the manual fallback.
    expect(WEBVIEW_SCRIPT).toContain('data-action="pipeline-queue-run"');
    expect(WEBVIEW_SCRIPT).toContain('Queue the run…');
    expect(WEBVIEW_SCRIPT).toContain('Or run it yourself');

    // The message carries no payload. That is the safety property: the host
    // rebuilds the invocation from settings, so a crafted message can ask for
    // the queue step and can never supply a workflow file or a ref.
    expect(WEBVIEW_SCRIPT).toContain("vscode.postMessage({ type: 'queueLocalCiWorkflowRun' });");
    expect(WEBVIEW_SCRIPT).not.toMatch(/type: 'queueLocalCiWorkflowRun', payload/);
    expect(HOST_PANEL).toContain("| { type: 'queueLocalCiWorkflowRun' }");
    expect(HOST_PANEL).toContain('buildLocalCiQueueInvocation(configuration)');

    // Confirmed modally, naming the repository, and recorded before it happens.
    expect(HOST_PANEL).toContain('Queue a workflow run on ${evidence.repoSlug}?');
    expect(HOST_PANEL).toContain("action: 'queueLocalCiWorkflowRun',");
    expect(HOST_PANEL).toContain("stageId: 'ci',");
  });

  it('establishes which commit a dispatch would run, and reports an unknown as one', () => {
    // A dispatch runs the remote tip, not the checkout on screen. Getting this
    // wrong in the reassuring direction is the whole hazard: a dialog saying
    // your work is included when it is not.
    expect(HOST_PANEL).toContain('gatherLocalCiQueueEvidence');
    expect(HOST_PANEL).toContain('Which commit runs: unknown.');
    expect(HOST_PANEL).toContain('NOT your checkout at');
    // Every field optional, so absent means "not established" rather than "fine".
    expect(HOST_PANEL).toContain('{ repoSlug?: string; remoteHeadSha?: string; localHeadSha?: string; dirty?: boolean }');
  });

  it('no longer promises that AtlasMind will not dispatch a workflow', () => {
    // The start-plan dialog carried that sentence. Gaining a dispatch button
    // makes it false, and a confirmation dialog making a promise the product
    // does not keep is worse than one that makes none. The container's own
    // inability is unchanged and still stated.
    expect(HOST_PANEL).not.toContain('AtlasMind will not dispatch or rerun a workflow.');
    expect(HOST_PANEL).toContain('Nothing it runs can dispatch or rerun a workflow.');
  });

  it('gives the borrowed-machine drawer a summary the shared rules can lay out', () => {
    // The summary held a bare text node, which the shared flex rule pushed to
    // the far right behind a lone chevron — the whole of setup, presented as a
    // right-aligned footnote. The span/small pair is what those rules target.
    expect(WEBVIEW_SCRIPT).toContain('<summary><span>${escapeHtml(needsSetup');
    expect(WEBVIEW_SCRIPT).toContain('Borrowed machine — setup, capacity and safety detail');
    expect(css).toContain('.ci-runner-drawer > summary {');
  });

  it('moves focus to the terminal when it types a command there', () => {
    // The withheld newline is the gate. It only works if the next keystroke
    // reaches the terminal rather than the webview the caret is still in.
    const sendBlock = HOST_PANEL.slice(
      HOST_PANEL.indexOf('private sendLocalCiCommandToTerminal'),
      HOST_PANEL.indexOf('private sendLocalCiCommandToTerminal') + 1200,
    );
    expect(sendBlock).toContain('terminal.show();');
    expect(sendBlock).not.toContain('terminal.show(true);');
    expect(sendBlock).toContain('terminal.sendText(resolved.command, false);');
  });

  it('keeps setup focused on one next action and progressively discloses depth', () => {
    expect(WEBVIEW_SCRIPT).toContain('class="panel-card ci-journey-card ci-next-action-card"');
    expect(WEBVIEW_SCRIPT).toContain('class="ci-journey-progress"');
    expect(WEBVIEW_SCRIPT).toContain('<summary>Show all four setup steps</summary>');
    expect(WEBVIEW_SCRIPT).not.toContain('Live command deck');
    expect(WEBVIEW_SCRIPT).not.toContain('What is ready right now?');
    // Deleted, not collapsed: a capability grid is a second navigation system
    // competing with the tabs, and the run history it fronted now leads Activity.
    expect(WEBVIEW_SCRIPT).not.toContain('Explore specialist dashboards');
    expect(WEBVIEW_SCRIPT).not.toContain('ci-capability-card');
    expect(WEBVIEW_SCRIPT).not.toContain('Show recent CI results');
  });

  it('puts runner action first and collapses diagnostics that are not needed yet', () => {
    const body = renderSource('renderPipeline', 'renderWorkflow');
    const card = body.slice(body.indexOf('const runnerCard'), body.indexOf('const counts'));
    expect(body).toContain('aria-label="Next local runner action"');
    expect(body).toContain('class="ci-runner-progress"');
    expect(body).toContain('Computer setup details');
    expect(body).toContain('Hardware, limits, providers, and security details');
    expect(card.indexOf('aria-label="Next local runner action"')).toBeLessThan(card.indexOf('${setupCard}'));
    expect(card.indexOf('${setupCard}')).toBeLessThan(card.indexOf('Hardware, limits, providers, and security details'));
    expect(css).toContain('.ci-progressive-details');
    expect(css).toContain('.ci-runner-focus');
  });
});

/**
 * The Release page carries a property the others do not: it is the only surface
 * describing an action that cannot be undone. Everything here follows from that.
 */
describe('the Release page', () => {
  const source = (): string => renderSource('renderRelease', 'renderPipeline');
  const rendered = (): string => source()
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');

  it('exists on both sides of the boundary and sits under "Ship & record"', () => {
    expect(WEBVIEW_SCRIPT).toContain("pageSectionOpen('release')");
    expect(WEBVIEW_SCRIPT).toContain('${renderRelease(snapshot)}');
    expect(WEBVIEW_SCRIPT).toContain("['release', 'Release']");
  });

  it('states that publishing stays with the human', () => {
    // The page shows a plan, gates and a set of notes; a reader could easily
    // assume the button that is not there exists. Say so rather than rely on
    // its absence being noticed.
    expect(rendered()).toMatch(/stay with you|stays with you/);
  });

  it('renders unknown gates as their own state, not as failures', () => {
    expect(rendered()).toContain('GATE_TONE');
    // The tone map is declared above the render function, so it is asserted
    // against the whole script rather than the extracted body.
    expect(WEBVIEW_SCRIPT).toMatch(/GATE_TONE = \{[^}]*unknown: 'tag-warn'/);
    expect(WEBVIEW_SCRIPT).toMatch(/GATE_TONE = \{[^}]*fail: 'tag-critical'/);
    expect(WEBVIEW_SCRIPT).toMatch(/GATE_WORD = \{[^}]*unknown: 'unknown'/);
  });

  it('sends each gate to where its evidence lives, and only where the host declared one', () => {
    expect(rendered()).toContain('data-action="release-gate-open"');
    // The page reads the destination; it never decides one. The table is
    // host-side, and a gate with no declared destination is simply not
    // clickable rather than routed somewhere plausible.
    expect(rendered()).toContain('(gateView.destinations || {})[gate.id]');
    expect(HOST_PANEL).toContain('resolveReleaseGateDestination(gate.id)');
    expect(WEBVIEW_SCRIPT).toContain("if (action === 'release-gate-open')");
  });

  it('orders the gates urgent-first by default, using the ranking the host computed', () => {
    expect(WEBVIEW_SCRIPT).toContain("releaseGateSort: typeof persistedWebviewState.releaseGateSort === 'string'");
    expect(WEBVIEW_SCRIPT).toMatch(/releaseGateSort[\s\S]{0,120}: 'urgency'/);
    // Order is looked up, never recomputed here: a second opinion about which
    // gate is most urgent is a second opinion that can disagree.
    expect(rendered()).toContain('gateView.order[gateSort]');
  });

  it('opens showing every gate, so a filter can never hide one you never chose to hide', () => {
    expect(WEBVIEW_SCRIPT).toMatch(/releaseGateFilter[\s\S]{0,140}: 'all'/);
  });

  it('filters and sorts without a round trip, because a way of looking must not fail', () => {
    expect(WEBVIEW_SCRIPT).toContain("if (action === 'release-gate-filter')");
    expect(WEBVIEW_SCRIPT).toContain("if (action === 'release-gate-sort')");
    // Neither posts to the host.
    const handlers = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf("if (action === 'release-gate-filter')"),
      WEBVIEW_SCRIPT.indexOf("if (action === 'release-gate-open')"),
    );
    expect(handlers).not.toContain('vscode.postMessage');
  });

  it('states what a filter is hiding, and counts every status over the whole board', () => {
    expect(rendered()).toContain('gateView.summaries || {})[gateFilter]');
    // A chip counting only what the filter admits would read "Blocked 0" the
    // moment somebody selected "Ready".
    expect(rendered()).toContain('gateView.counts || {}');
    expect(HOST_PANEL).toContain('Counts over the whole set');
  });

  it('marks gate urgency with a border rather than a filled card', () => {
    // Eight saturated cards read as an alarm even when three say "unknown".
    expect(HOST_PANEL).toContain('.wf-gate-fail { border-left-color: var(--dash-critical); }');
    expect(HOST_PANEL).toContain('.wf-gate-unknown { border-left-color: var(--dash-warn); }');
  });

  it('distinguishes "releases not read" from "no releases"', () => {
    // Both produce an empty list, and only one of them justifies telling
    // somebody their delivery cadence is unmeasurable.
    expect(rendered()).toContain('Releases have not been read');
    expect(rendered()).toContain('no published releases yet');
  });

  it('explains the feature in its empty states rather than reporting emptiness', () => {
    expect(rendered()).toContain('No changelog section for this version');
    expect(rendered()).toMatch(/copied verbatim/);
  });

  it('never offers to strip a secret out of the notes', () => {
    // Refusal, not redaction: publishing an edited version of what the author
    // reviewed, without saying what was removed, is the worse failure.
    expect(rendered()).toMatch(/will not publish a redacted version/);
    expect(rendered()).not.toMatch(/redact (them|it) (for you|automatically)/i);
  });

  it('shows the declared change-failure rule wherever the number appears', () => {
    expect(rendered()).toContain('rel.changeFailureRule');
  });

  it('names the releases the failure rule counted', () => {
    expect(rendered()).toMatch(/argued with/);
  });

  it('renders every verdict through the shared helper, never as a bare value', () => {
    // `renderVerdict` is what turns "not measured" into an em dash with its
    // reason instead of a confident zero.
    expect(rendered()).toContain('renderVerdict(verdict, format)');
    expect(rendered()).not.toMatch(/dora\.\w+\s*\+\s*'%'/);
  });

  it('keeps the DORA bands honest about being an orientation, not a certification', () => {
    expect(rendered()).toMatch(/not a certification/);
  });
});

/**
 * The workflow configuration card is the only control on the dashboard that
 * edits a file the team reviews. That makes two things load-bearing: it must
 * say so, and it must never write without showing the exact change first.
 */
describe('the workflow configuration card', () => {
  const rendered = (): string => workflowRenderedStrings();

  it('offers to declare a workflow rather than creating one silently', () => {
    // Every other persisted document seeds itself on first read. This one does
    // not, because it gets committed — writing one because somebody opened a
    // tab would be putting words in their mouth in a file others review.
    expect(rendered()).toContain('create-workflow-config');
    expect(rendered()).toContain('This project has no declared workflow');
  });

  it('says declaring a workflow turns nothing on', () => {
    expect(rendered()).toMatch(/Declaring a workflow turns nothing on/);
  });

  it('sends only a stage id and a boolean, never a command or a path', () => {
    expect(WEBVIEW_SCRIPT).toContain("type: 'editWorkflowConfig'");
    expect(WEBVIEW_SCRIPT).toMatch(/stages: \[\{ id: payload, enabled: !stage\.enabled \}\]/);
  });

  it('reads the current value from the snapshot the button was drawn from', () => {
    // A toggle sends the inverse of what it displayed. Reading the value from
    // anywhere else means a click arriving after a refresh flips a stage the
    // user never looked at.
    expect(WEBVIEW_SCRIPT).toContain('function workflowStageById(id)');
    expect(WEBVIEW_SCRIPT).toContain('wfStageCache =');
  });

  it('states that the file cannot raise what actually happens', () => {
    expect(rendered()).toMatch(/lowest of/);
  });

  it('uses the standard outline and status-tag treatment without tinting row contents', () => {
    expect(rendered()).toContain("workflow-stage-segment ${stage.enabled ? 'is-enabled' : 'is-disabled'}");
    expect(rendered()).toContain("${stage.enabled ? 'Enabled' : 'Disabled'}");
    expect(rendered()).toContain("workflow-stage-state ${stage.enabled ? 'tag-good' : ''}");
    expect(rendered()).toContain('class="workflow-stage-marker"');
    expect(rendered()).toContain('aria-pressed=');

    const css = readFileSync(
      path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
      'utf8',
    );
    expect(css).toContain('.workflow-stage-segment.is-enabled');
    expect(css).toContain('.workflow-stage-segment.is-disabled');
    expect(css).toContain('border-left-width: 4px');
    expect(css).not.toContain('.workflow-stage-segment.is-enabled .workflow-stage-marker');
    expect(css).not.toContain('.workflow-stage-segment.is-disabled .workflow-stage-marker');
  });

  it('warns before writing rather than after', () => {
    expect(rendered()).toMatch(/you will see the exact change first/i);
  });

  it('reports a file it must not overwrite instead of offering to edit it', () => {
    expect(rendered()).toContain('cfg.notice');
  });
});

describe('the workflow card shows what an empty command means', () => {
  const rendered = (): string => workflowRenderedStrings();

  it('distinguishes a set command, an empty one, and no command at all', () => {
    // Absent means the stage needs none. Empty means it needs one and has none,
    // and that emptiness is the blocker rather than an oversight.
    expect(rendered()).toContain('stage.command !== undefined');
    expect(rendered()).toMatch(/emptiness <em>is<\/em> the blocker/);
  });

  it('carries blockers derived by the host rather than re-deriving them', () => {
    // Two copies of "what is stopping this stage" would eventually disagree,
    // and the one on screen would be the one nobody tested.
    expect(rendered()).toContain('blockersFor(stage.id)');
    expect(rendered()).toContain('cfg.blockers');
    expect(rendered()).not.toContain("stage.command === ''");
  });

  it('surfaces configuration problems rather than keeping them host-side', () => {
    expect(rendered()).toContain('cfg.problems');
  });
});

describe('the audit card', () => {
  const rendered = (): string => workflowRenderedStrings();

  it('says an empty ledger means nothing has run, not that nothing went wrong', () => {
    // The single most likely misreading of an empty audit trail, and the one
    // that would make it worse than useless.
    expect(rendered()).toMatch(/means nothing has run, not that nothing went wrong/);
  });

  it('shows a determinism breach with both fingerprints', () => {
    // A count tells somebody they have a problem; the fingerprints and dates
    // tell them where to look.
    expect(rendered()).toContain('breach.inputsFingerprint');
    expect(rendered()).toContain('output.outputsFingerprint');
  });

  it('shows a capped level alongside the one that was asked for', () => {
    expect(rendered()).toContain('asked for');
    expect(rendered()).toContain('record.limitedBy');
  });

  it('states that dropped records were dropped rather than forgetting silently', () => {
    expect(rendered()).toContain('droppedByCap');
    expect(rendered()).toMatch(/never quietly forgets/);
  });
});

describe('the Tech Debt page', () => {
  const source = (): string => renderSource('renderDebt', 'renderRelease');
  const rendered = (): string => source()
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');

  it('exists on both sides of the boundary and sits under "The code"', () => {
    expect(WEBVIEW_SCRIPT).toContain("pageSectionOpen('debt')");
    expect(WEBVIEW_SCRIPT).toContain('${renderDebt(snapshot)}');
    expect(WEBVIEW_SCRIPT).toContain("['debt', 'Tech Debt']");
  });

  it('says an empty register means nothing was scanned, not that there is no debt', () => {
    // The single most likely misreading, and the one that makes the page worse
    // than useless.
    expect(rendered()).toMatch(/does not mean there is no debt/);
  });

  it('publishes the rule that graded each entry rather than a bare severity', () => {
    // Comparability is the whole reason to keep the register, and a grade you
    // cannot check is a grade you cannot compare.
    expect(rendered()).toContain('entry.rule');
    expect(rendered()).toContain('debt.rules');
  });

  it('says severity does not drift with age', () => {
    expect(rendered()).toMatch(/does not drift with age/);
  });

  it('keeps resolved and obsolete apart', () => {
    expect(rendered()).toMatch(/not the same as resolved/);
  });

  it('offers no way to delete an entry', () => {
    // Entries transition. A delete button would make the register a list.
    expect(rendered()).not.toMatch(/data-action="delete-debt/);
    expect(rendered()).not.toMatch(/removeDebt|deleteDebt/);
  });

  it('sends only an id and a known status, never a path', () => {
    // The evidence path is looked up in the register host-side; the webview
    // never supplies one.
    expect(WEBVIEW_SCRIPT).toContain("type: 'openDebtEvidence', payload: { id: payload }");
    expect(rendered()).not.toMatch(/payload="[^"]*evidencePath/);
  });
});

describe('handing a debt entry to an agent', () => {
  const rendered = (): string => renderSource('renderDebt', 'renderRelease');

  it('sends only the entry id — never the prompt or the path', () => {
    // The prompt is built host-side from the entry looked up by id, so the
    // webview cannot influence what an agent is told.
    expect(WEBVIEW_SCRIPT).toContain("type: 'workOnDebt', payload: { id: payload }");
    expect(rendered()).toContain("renderAtlasDiscussAction('work-on-debt', entry.id");
  });

  it('does not label it as fixing, because the answer may be to keep it', () => {
    expect(rendered()).toContain('Ask AtlasMind to review this debt entry');
    expect(rendered()).toContain('propose whether to fix, retain, or reclassify it');
    expect(rendered()).not.toMatch(/Fix it with Atlas/);
  });
});

describe('searching the debt register', () => {
  const source = (): string => renderSource('renderDebt', 'renderRelease');
  const rendered = (): string => source()
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');

  it('searches what somebody already knows: the text, the path, or the marker', () => {
    expect(rendered()).toContain("(entry.title || '').toLowerCase().includes(needle)");
    expect(rendered()).toContain("(entry.evidencePath || '').toLowerCase().includes(needle)");
    expect(rendered()).toContain("(entry.rule || '').toLowerCase().includes(needle)");
  });

  it('offers a filter chip only for rules that actually graded something', () => {
    // A filter for a rule with no entries is a button that does nothing.
    expect(rendered()).toContain('const rulesInUse = [...new Set(allOpen.map(entry => entry.rule))]');
    expect(rendered()).toContain('rulesInUse.length > 1');
  });

  it('says how many were hidden rather than looking like the register shrank', () => {
    // Otherwise a filtered view is indistinguishable from work disappearing —
    // in a register whose whole promise is that nothing is ever deleted.
    expect(rendered()).toContain("openEntries.length + ' of ' + allOpen.length");
    expect(rendered()).toMatch(/Nothing matches that/);
  });

  it('keeps the search box focused across a re-render', () => {
    // `render()` rebuilds the page on every host push. Without this, typing a
    // second character is impossible.
    expect(WEBVIEW_SCRIPT).toContain("active.id === 'debt-search-input'");
    expect(WEBVIEW_SCRIPT).toContain("activeId === 'debt-search-input'");
  });

  it('uses the same segmented control the other filters use', () => {
    expect(rendered()).toContain('class="segmented"');
  });
});

describe('review comments on the Pull Requests page', () => {

  it('distinguishes "not fetched" from "no line comments"', () => {
    // Absent offers the button; empty says the review left a summary only.
    // Collapsing them would either hide the button forever or offer it forever.
    expect(WEBVIEW_SCRIPT).toContain("if (comments === undefined)");
    expect(WEBVIEW_SCRIPT).toMatch(/No line comments on this review/);
    expect(WEBVIEW_SCRIPT).toContain('Read the review comments');
  });

  it('offers the file button only when the host trusted the path', () => {
    // The path arrives from a third party. One that could not be trusted is
    // emptied host-side, and an empty path must not become something clickable.
    expect(WEBVIEW_SCRIPT).toMatch(/comment\.path\s*$/m);
    expect(WEBVIEW_SCRIPT).toMatch(/no file named/);
  });

  it('sends only a number and an index, never the text or the path', () => {
    // Both are looked up host-side, which is what keeps third-party text out of
    // the message that reaches a model.
    expect(WEBVIEW_SCRIPT).toContain("type: 'addressReviewComment'");
    expect(WEBVIEW_SCRIPT).not.toMatch(/addressReviewComment[\s\S]{0,120}comment\.body/);
  });

  it('escapes the comment body it renders', () => {
    expect(WEBVIEW_SCRIPT).toContain('escapeHtml(comment.body)');
  });

  it('scopes the action to one comment rather than the whole review', () => {
    // `renderReviewComments` sits above `renderPullRequests`, so it is asserted
    // against the whole script rather than the extracted body.
    expect(WEBVIEW_SCRIPT).toContain('Address this one');
  });
});

describe('the label and milestone taxonomy', () => {
  const source = (): string => renderSource('renderTaxonomy', 'renderDebt');
  const rendered = (): string => source()
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');

  it('says why the label set matters, not just what it is', () => {
    // The drafter takes labels only from the declared set and drops the rest.
    // That rule is only as good as the set behind it.
    expect(rendered()).toMatch(/only from the declared taxonomy/);
    expect(rendered()).toMatch(/only as good as the set behind it/);
  });

  it('warns that a deletion takes the label off every issue', () => {
    expect(rendered()).toMatch(/one step GitHub cannot undo/);
    expect(rendered()).toMatch(/AtlasMind names the issues before you confirm/);
  });

  it('suggests renaming instead of deleting', () => {
    expect(rendered()).toMatch(/rename it rather than deleting it/);
  });

  it('offers no way to delete a milestone', () => {
    // Deleting one detaches every issue from it silently; closing preserves the
    // record, which is what a milestone is for.
    expect(rendered()).toContain('close-milestone');
    expect(rendered()).not.toMatch(/data-action="delete-milestone"/);
    expect(rendered()).toMatch(/closed, never deleted/);
  });

  it('renders a colour only when the host validated it', () => {
    // The value goes into a style attribute. An unvalidated one is an injection,
    // so the host returns '' and the swatch is simply absent.
    expect(rendered()).toContain('label.color ?');
    expect(rendered()).toContain("style=\"background:#${escapeAttr(label.color)}\"");
  });

  it('distinguishes "not read" from "no labels"', () => {
    expect(rendered()).toContain('Not read yet');
    expect(rendered()).toMatch(/has no labels/);
  });

  it('reports taxonomy drift as a comparison rather than an error', () => {
    expect(rendered()).toContain('drift.summary');
    expect(rendered()).not.toMatch(/invalid|error/i);
  });
});

describe('the automation gates are controls, not a read-out', () => {
  const rendered = (): string => workflowRenderedStrings();

  it('says what must change to reach the first writing rung', () => {
    // "Not permitted" tells somebody they are blocked. This tells them which
    // switches — the difference between a dead end and a next step.
    expect(rendered()).toContain('enablement.requirements');
    expect(rendered()).toMatch(/must change/);
    expect(rendered()).toMatch(/rung where AtlasMind starts changing things other people can see/);
  });

  it('says so plainly when nothing is holding it back', () => {
    expect(rendered()).toMatch(/Nothing is holding/);
  });

  it('offers a switch and a link to the setting behind it', () => {
    expect(rendered()).toContain('data-action="workflow-gate"');
    expect(rendered()).toContain('data-action="setting"');
  });

  it('does not offer a switch that another scope would make a no-op', () => {
    // Writing `true` to the workspace while the user scope says `false` flips a
    // switch and changes nothing — the same silent no-op as a dead button,
    // arriving through the settings system.
    expect(rendered()).toContain('blockedFor(key).length && !on');
    expect(rendered()).toMatch(/held by/);
  });

  it('asks before allowing and not before restricting', () => {
    // A dialog in front of somebody reaching for the brake teaches them to
    // dismiss dialogs. The asymmetry lives host-side; the label carries it.
    expect(rendered()).toMatch(/'Turn off' : 'Allow/);
    expect(rendered()).toMatch(/Turning one off takes effect at once/);
  });

  it('says which scope it writes to', () => {
    expect(rendered()).toMatch(/Written to this workspace/);
  });

  it('gives the ceiling a picker rather than a switch, because it is a level', () => {
    expect(rendered()).toContain('data-action="automation-ceiling"');
    expect(rendered()).toContain('class="segmented"');
  });
});

describe('the page answers "what moved", not only "what is the state"', () => {
  const rendered = (): string => workflowRenderedStrings();

  it('puts the delta first in the grid', () => {
    // The ladder is a setting you change once; this is the part that differs
    // every day. A page whose first card never changes is one people stop
    // reading.
    const grid = rendered();
    expect(grid.indexOf('${deltaCard}')).toBeGreaterThan(-1);
    expect(grid.indexOf('${deltaCard}')).toBeLessThan(grid.indexOf('${healthCard}'));
    expect(grid.indexOf('${deltaCard}')).toBeLessThan(grid.indexOf('${ladderCard}'));
  });

  it('renders a first look as an explanation rather than an empty state', () => {
    // "Nothing here" at the exact moment somebody decides whether to trust a
    // surface is the worst time to say nothing useful.
    expect(rendered()).toMatch(/no earlier reading to compare/);
    expect(rendered()).toMatch(/Nothing is missing and nothing is wrong/);
  });

  it('says what the comparison covers when nothing moved', () => {
    // A clean result only means something if you can see what was looked for.
    expect(rendered()).toMatch(/The comparison covers/);
    expect(rendered()).toMatch(/deliberately excluded/);
  });

  it('labels each change by direction rather than only by number', () => {
    expect(rendered()).toContain('DELTA_WORD');
    expect(rendered()).toMatch(/worsened: 'worse'/);
    expect(rendered()).toMatch(/'no-longer-readable': 'went quiet'/);
  });

  it('states the cap rather than truncating silently', () => {
    expect(rendered()).toMatch(/droppedByCap > 0/);
    expect(rendered()).toMatch(/more moved than are listed here/);
  });

  it('offers a way to clear a delta that has been read', () => {
    // Otherwise the list keeps reporting news you have already acted on.
    expect(rendered()).toContain('data-action="delta-seen"');
    expect(rendered()).toMatch(/Mark as seen/);
  });

  it('takes its wording from the host and composes none of it', () => {
    // The webview renders `headline` and `summary`; it never writes a sentence
    // making a claim about the project.
    expect(rendered()).toContain('escapeHtml(delta.headline)');
    expect(rendered()).toContain('escapeHtml(change.summary)');
  });
});

describe('Pipeline route surface', () => {
  /**
   * The page used to describe one route in four guided steps and the rest as
   * brochure cards, so the cheapest option was not offered at all.
   */
  it('offers running the checks here as a route of its own', () => {
    expect(WEBVIEW_SCRIPT).toContain('pipeline-run-here');
    expect(WEBVIEW_SCRIPT).toContain("id: 'rules'");
    expect(WEBVIEW_SCRIPT).toContain('What can run a check on this machine');
  });

  /**
   * A capability nobody established must not render as a tick, and must not
   * render as blank either — a blank reads as "no", which is a different claim.
   */
  it('marks a square the policy refuses, and says why on the square', () => {
    // The capability cards became grid cells. The rule they carried survives:
    // a refusal is never an empty square, because empty reads as merely unused.
    expect(WEBVIEW_SCRIPT).toContain("blocked: '\u2715'");
    expect(WEBVIEW_SCRIPT).toContain('cell.state === \'blocked\' ? cell.reason');
    expect(WEBVIEW_SCRIPT).toContain('locked by policy');
  });

  /**
   * Policy and machine are different questions. A route the rules allow but
   * this laptop cannot run must not look like one the rules refuse, or a Docker
   * outage reads as a decision somebody made.
   */
  it('keeps "allowed by policy" apart from "usable on this machine"', () => {
    expect(WEBVIEW_SCRIPT).toContain('!cell.usableHere');
    expect(WEBVIEW_SCRIPT).toContain('not usable on this machine right now');
    expect(WEBVIEW_SCRIPT).toContain('ci-cell-unusable-key');
  });

  /**
   * A decision that cites the allowance without saying whether the allowance
   * was actually read is the failure the meter exists to prevent, one layer up.
   */
  it('always shows the allowance reading beside the routing decisions', () => {
    expect(WEBVIEW_SCRIPT).toContain('ci-rules-credit');
    expect(WEBVIEW_SCRIPT).toContain('pipeline-refresh-credit');
    expect(WEBVIEW_SCRIPT).toContain('has not been checked');
  });

  it('shows what the same engine would decide right now, and why the others lost', () => {
    // The grid states the policy; the dry run states what it means today, on
    // this machine, with this allowance reading.
    expect(WEBVIEW_SCRIPT).toContain('If checks ran right now');
    expect(WEBVIEW_SCRIPT).toContain('decision.sentence');
    expect(WEBVIEW_SCRIPT).toContain('Why not the others');
  });

  /**
   * "Nobody has decided" and "somebody decided nothing" are different states
   * with different fixes; only the first is worth offering to create a file for.
   */
  it('separates an absent routing file from one that decides nothing', () => {
    expect(WEBVIEW_SCRIPT).toContain('No routing file yet');
    expect(WEBVIEW_SCRIPT).toContain('declares no rules');
    expect(WEBVIEW_SCRIPT).toContain('pipeline-create-routing');
  });
});

describe('Pipeline section reachability and defaults', () => {
  /**
   * The regression this pins: the Builds and Where-it-runs tabs shipped
   * without being added to the section allowlist, so clicking either coerced
   * back to 'overview' — the tab was drawn, and did not open. Every tab id
   * rendered must be a member of PIPELINE_SECTIONS.
   */
  it('lists every rendered tab in the section allowlist', () => {
    const literal = WEBVIEW_SCRIPT.match(/const PIPELINE_SECTIONS = \[([^\]]+)\]/)?.[1] ?? '';
    // The ids come from the tab renderer itself, not from a hand-maintained
    // list: a list here would go stale exactly the way the allowlist did, and
    // the next unreachable tab would pass this test too.
    const tabsStart = WEBVIEW_SCRIPT.indexOf('function renderPipelineTabs');
    const tabsEnd = WEBVIEW_SCRIPT.indexOf('function pipelineSetupState');
    expect(tabsStart).toBeGreaterThan(-1);
    expect(tabsEnd).toBeGreaterThan(tabsStart);
    const tabsBody = WEBVIEW_SCRIPT.slice(tabsStart, tabsEnd);
    const renderedIds = [...tabsBody.matchAll(/id: '([a-z-]+)'/g)].map(match => match[1]);
    // A silent slice or regex miss must not pass vacuously.
    expect(renderedIds.length).toBeGreaterThanOrEqual(4);
    for (const id of renderedIds) {
      expect(literal, `tab '${id}' must be reachable`).toContain(`'${id}'`);
    }
  });

  /**
   * Onboarding is the default only while there is nothing else to show. A
   * project with build or run history opens on Builds; an explicit tab choice
   * always wins over both.
   */
  it('gives the page to setup only while setup is unfinished, and respects an explicit choice', () => {
    expect(WEBVIEW_SCRIPT).toContain("? persistedWebviewState.pipelineSection : null");
    // The whole resolution, head included, so an explicit choice provably wins
    // before the default is consulted — and the default is latched once rather
    // than recomputed, so a background refresh cannot move the view.
    expect(WEBVIEW_SCRIPT).toMatch(
      /PIPELINE_SECTIONS\.includes\(chosen\)\s*\?\s*chosen\s*:\s*state\.pipelineSectionDefault/,
    );
    expect(WEBVIEW_SCRIPT).toContain("state.pipelineSectionDefault = setup.complete ? 'activity' : 'setup'");
    expect(WEBVIEW_SCRIPT).toContain('!PIPELINE_SECTIONS.includes(state.pipelineSectionDefault)');
  });

  /**
   * One answer to "is setup done", shared by the journey card and the header
   * chip. Two computations would eventually disagree on the same screen.
   */
  it('judges setup completeness once, on durable facts', () => {
    expect(WEBVIEW_SCRIPT).toContain('function pipelineSetupState(');
    expect(WEBVIEW_SCRIPT).toContain('complete: workflowReady && machineReady && hasRun');
    expect(WEBVIEW_SCRIPT).toContain('const setup = pipelineSetupState(runner, buildRecords, runs);');
    expect(WEBVIEW_SCRIPT).toContain('data-payload="setup"');
  });

  /**
   * The full-size journey card was the page's landing experience forever,
   * including for people who finished it. Complete setup earns one line with
   * the steps behind a disclosure — and completeness is judged on the durable
   * steps plus build history, because queueing and lending reset per run.
   */
  it('collapses the journey once setup is durable and anything has built', () => {
    expect(WEBVIEW_SCRIPT).toContain('ci-journey-complete');
    // The <strong> form is unique to the collapsed card; the bare words also
    // appear in the full card's heading and would keep passing without it.
    expect(WEBVIEW_SCRIPT).toContain('<strong>Setup complete</strong>');
    expect(WEBVIEW_SCRIPT).toContain('setupDone && hasEverBuilt');
    expect(WEBVIEW_SCRIPT).toContain('do not mean setup regressed');
    // The fifth argument is what feeds hasEverBuilt; dropping it would make
    // the gate permanently false and the collapse unreachable.
    expect(WEBVIEW_SCRIPT).toContain('renderPipelineJourney(assessment, intel, runner, workflows, buildRecords)');
  });
});

/**
 * The body of a pipeline sub-renderer, up to the next named function.
 *
 * `renderSource` cannot be reused here: these functions do not take `snapshot`,
 * so its signature match never finds them. Scoping matters because several
 * assertions below pin copy that could drift into an unrelated renderer and
 * keep passing there — a scoped miss fails, an unscoped one lies.
 */
function pipelineSource(name: string, until: string): string {
  const start = WEBVIEW_SCRIPT.indexOf(`function ${name}(`);
  expect(start, `${name} is missing from the webview script`).toBeGreaterThan(-1);
  const end = WEBVIEW_SCRIPT.indexOf(`function ${until}(`, start + 1);
  return WEBVIEW_SCRIPT.slice(start, end === -1 ? undefined : end);
}

describe('Pipeline routing edits and failure actions', () => {
  /**
   * Every gesture is one click on a square, and both halves of what it names
   * are closed vocabularies the host re-resolves.
   */
  it('makes every allowed square editable, carrying only two closed ids', () => {
    expect(WEBVIEW_SCRIPT).toContain('pipeline-route-cell');
    expect(WEBVIEW_SCRIPT).toContain("type: 'cycleCiRoutingCell'");
    expect(WEBVIEW_SCRIPT).toContain('payload: { workload: payload.slice(0, sep), route: payload.slice(sep + 1) }');
    expect(WEBVIEW_SCRIPT).toContain('pipeline-route-exhaust');
    expect(WEBVIEW_SCRIPT).toContain("type: 'toggleCiRoutingExhaustion'");
  });

  it('says on the card that nothing here runs, and edits become a reviewed diff', () => {
    const src = pipelineSource('renderPipelineRules', 'renderRulesExecutors');
    expect(src).toContain('nothing runs as a result');
    expect(src).toContain('your team reviews as a diff');
  });

  /**
   * The classified failure used to live only inside a collapsed disclosure on
   * the setup tab — the last place anybody goes once a build fails. It now
   * renders on Builds with the one action that was always missing: handing the
   * fenced report to a chat session.
   */
  it('leads Activity with the classified failure and an ask-Atlas action', () => {
    // The failure is the only thing on this page asking for a decision, so it
    // outranks history and the run stream rather than sitting inside them.
    expect(WEBVIEW_SCRIPT).toContain('ci-activity-lead');
    expect(WEBVIEW_SCRIPT).toContain('Needs you · latest failure');
    expect(WEBVIEW_SCRIPT).toContain('${renderCiFailure(report)}');
    expect(WEBVIEW_SCRIPT).toContain('pipeline-ci-failure-work');
    expect(WEBVIEW_SCRIPT).toContain("vscode.postMessage({ type: 'workOnCiFailure' })");
    // The lead is built inside Activity, not passed in from a dead renderer.
    expect(WEBVIEW_SCRIPT).toContain('activity: renderPipelineActivity(');
  });
});

describe('Activity — measurement honesty', () => {
  const activity = pipelineSource('renderPipelineActivity', 'describeBuildObservation');

  /**
   * The ribbon is the measurement. Height is elapsed time and colour is
   * outcome, so both dimensions have to come from the same runs the metrics
   * beside them are computed from — a second tally would let the picture and
   * the numbers disagree on one row.
   */
  it('draws duration and outcome from the same run series as the metrics', () => {
    expect(activity).toContain('renderRunRibbon(row.entries)');
    expect(activity).toContain('pipelineWorkflowSeries(runs)');
    const series = pipelineSource('pipelineWorkflowSeries', 'pipelineFlakyWorkflows');
    expect(series).toContain('durationMs: pipelineRunDurationMs(run)');
    expect(series).toContain('outcome: pipelineRunOutcome(run)');
  });

  /**
   * Reliability means the same thing here as everywhere else: a cancelled run
   * is a completed run nobody should read as a failure. Widening the bucket
   * once produced a workflow reported as failing three times on a page that
   * also said nothing had failed.
   */
  it('counts only genuine failures toward reliability', () => {
    const series = pipelineSource('pipelineWorkflowSeries', 'pipelineFlakyWorkflows');
    expect(series).toContain("['failure', 'timed_out', 'startup_failure']");
    expect(series).toContain('passed + failed > 0 ? Math.round((passed / (passed + failed)) * 100) : undefined');
  });

  /** A median from two samples is noise; the guard is applied and stated. */
  it('refuses a typical-duration claim without enough samples', () => {
    const series = pipelineSource('pipelineWorkflowSeries', 'pipelineFlakyWorkflows');
    expect(series).toContain('durations.length >= 3 ? durations[Math.floor(durations.length / 2)] : undefined');
    expect(activity).toContain('Needs 3 completed runs');
  });

  /** Every figure names the window it was measured over, on the element itself. */
  it('states the window beside each number rather than in prose somewhere else', () => {
    expect(activity).toContain('over the last ${row.sampleSize} run');
    expect(activity).toContain('Median elapsed time including queue wait');
    expect(activity).toContain('Runs per week across the span of this sample');
    expect(activity).toContain('Runs GitHub returned for this branch');
  });

  /**
   * Published rule, checkable by hand: the reader can open the two runs and
   * agree or disagree. A flakiness score nobody can reproduce gets ignored.
   */
  it('publishes the flakiness rule beside the flakiness list', () => {
    expect(activity).toContain('Passed and failed on the same commit');
    const flaky = pipelineSource('pipelineFlakyWorkflows', 'renderPipelineActivity');
    expect(flaky).toContain('entry.pass && entry.fail');
  });
});

describe('Activity — one stream, honest about what it saw', () => {
  const activity = pipelineSource('renderPipelineActivity', 'describeBuildObservation');

  it('shows every route in one list', () => {
    expect(WEBVIEW_SCRIPT).toContain('renderPipelineActivity');
    expect(WEBVIEW_SCRIPT).toContain("id: 'activity'");
    expect(activity).toContain('ci-activity-stream');
  });

  /**
   * The rule that keeps this page from inventing reassurance. A build AtlasMind
   * only started, on a terminal it does not read, must never carry a tick.
   */
  it('says plainly when it cannot report how a build ended', () => {
    expect(WEBVIEW_SCRIPT).toContain('does not read it, so it cannot report how they ended');
    expect(activity).toContain('no verdict by design');
    // Marked, never blank — a blank mark reads as "no", which is a claim.
    expect(WEBVIEW_SCRIPT).toContain("mark: '?'");
    // And the mark now publishes what it means, rather than leaving a reader to
    // infer a white question mark from context.
    expect(WEBVIEW_SCRIPT).toContain('Marked rather than blank, because a blank reads as a pass.');
  });

  it('marks hosted progress as polled rather than streamed', () => {
    expect(WEBVIEW_SCRIPT).toContain('Checked at intervals rather than streamed');
  });

  /**
   * An unfetched hosted history and a genuinely empty one are different facts;
   * rendering them alike would let the first read as a quiet week.
   */
  it('keeps unfetched hosted history distinct from empty history', () => {
    expect(activity).toContain('Hosted history has not been loaded');
    expect(activity).toContain('not evidence that nothing ran on GitHub');
    expect(activity).toContain('That is not evidence that the build passed');
  });
});

describe('Tests — three bands in triage order', () => {
  const tests = pipelineSource('renderPipelineTests', 'renderPipelineRules');

  it('leads with what is broken, then policy evidence, then what nothing covers', () => {
    expect(tests.indexOf('Failing now')).toBeGreaterThan(-1);
    expect(tests.indexOf('Failing now')).toBeLessThan(tests.indexOf('Declared policies'));
    expect(tests.indexOf('Declared policies')).toBeLessThan(tests.indexOf('Suggested missing tests'));
  });

  /**
   * The rule inherited from the coverage engine and the one most worth keeping:
   * AtlasMind reads pass and fail from a report the suite wrote and never runs
   * anything to find out, so no report is *no verdict*, never zero failures.
   */
  it('never turns a missing report into zero failures', () => {
    expect(tests).toContain('No test report to read');
    expect(tests).toContain('no verdict');
    expect(tests).toContain('not the same as zero failures');
    expect(tests).toContain('never runs your tests to find out');
  });

  /** A verdict older than the code it judged says so. */
  it('says when the report predates the newest test file', () => {
    expect(tests).toContain('report.stale');
    expect(tests).toContain('older than your newest test file');
  });

  /**
   * The band nothing surfaced before: declared endpoints, roles and migrations
   * no test names, each with the action that would fix it.
   */
  it('surfaces declared subjects nothing tests, with a draft action each', () => {
    expect(tests).toContain('Suggested missing tests');
    expect(tests).toContain('entry.covered');
    expect(tests).toContain('pipeline-test-draft');
    expect(tests).toContain('declared in ');
    expect(WEBVIEW_SCRIPT).toContain("type: 'draftMissingTest'");
  });

  /**
   * Zero uncovered subjects reads as complete, so a policy with no extractor
   * must say it has none rather than report a clean zero.
   */
  it('states how many policies subjects can even be extracted for', () => {
    expect(tests).toContain('not extractable');
    expect(tests).toContain('zero uncovered would read as complete');
    expect(tests).toContain('says nothing about coverage');
  });

  it('offers to work through the failures without running anything', () => {
    expect(tests).toContain('pipeline-tests-fix');
    expect(WEBVIEW_SCRIPT).toContain("type: 'workOnFailingTests'");
  });
});

describe('Canvas — overlays on one graph', () => {
  const canvas = pipelineSource('renderPipelineGraph', 'renderCanvasNodePanel');

  /**
   * GitLab deprecated its separate dependency-graph tab and Buildkite merged
   * three sibling views into one Steps surface: a second picture of the same
   * facts always loses to a toggle on the first.
   */
  it('adds overlays to the existing graph rather than new views', () => {
    expect(canvas).toContain('ci-overlay-toggles');
    for (const overlay of ["id: 'status'", "id: 'routing'", "id: 'delivery'"]) {
      expect(canvas).toContain(overlay);
    }
    expect(WEBVIEW_SCRIPT).toContain("action === 'pipeline-overlay'");
    // Independently switchable: somebody debugging a red build should not have
    // routing badges in the way.
    expect(WEBVIEW_SCRIPT).toContain('state.pipelineOverlays[payload] = !state.pipelineOverlays[payload]');
  });

  /**
   * The canvas and Activity read the same runs. A second derivation would let
   * one surface call a workflow red while the other calls it green.
   */
  it('paints status from the same runs Activity uses', () => {
    expect(canvas).toContain('pipelineRunOutcome(run)');
    expect(canvas).toContain('const latest = new Map()');
  });

  /** No runs read is not evidence that anything passed. */
  it('says nothing is painted when no runs have been read', () => {
    expect(canvas).toContain('not evidence that anything passed');
  });

  /**
   * Routes are chosen per kind of check, not per workflow file. Badging each
   * file with a route would invent a mapping the engine does not have.
   */
  it('refuses to invent a per-workflow routing mapping', () => {
    expect(canvas).toContain('Routes are chosen per kind of check, not per workflow file');
  });

  /**
   * Promotion has its own guarded surface. Showing the stages is a reading;
   * moving the gate onto a canvas is a separate decision with its own review.
   */
  it('shows delivery stages read-only', () => {
    expect(canvas).toContain('readOnly: true');
    expect(canvas).toContain('promotion has its own guarded surface');
  });

  it('opens a workflow panel on click but never on a drag', () => {
    expect(canvas).toContain('data-node-select');
    expect(WEBVIEW_SCRIPT).toContain('drag.moved = true');
    expect(WEBVIEW_SCRIPT).toContain('if (!wasDrag && node.dataset.nodeSelect !== undefined)');
    expect(WEBVIEW_SCRIPT).toContain('keep opening panels nobody asked for');
  });
});

describe('Rules — setup is findable, and optional stays optional', () => {
  const executors = pipelineSource('renderRulesExecutors', 'renderPipelineGraph');
  const rules = pipelineSource('renderPipelineRules', 'renderRulesExecutors');

  /**
   * The regression this pins. Demoting the runner into a collapsed drawer was
   * right for a configured machine and wrong during setup: the journey's
   * "prepare this computer" step lands on Rules, and what it wanted was a
   * closed disclosure below a policy grid.
   */
  it('opens the borrowed-machine drawer and leads the view while setup is unfinished', () => {
    expect(executors).toContain("${drawerOpen ? ' open' : ''}");
    expect(executors).toContain('the next step, and what is blocking it');
    expect(executors).toContain('ci-executors-setup');
    // Leading the view, not sitting under the grid.
    expect(rules).toContain('runnerNeedsYou ? executors + intro : intro + executors');
    expect(rules).toContain("runnerNeedsYou ? executorsCard : ''");
  });

  /**
   * The second half of the same regression. A machine whose blockers are all
   * resolved reads `available`, but the journey's "Queue one trusted job" step
   * still sends somebody here for the queue command — which lives on the
   * runner card, inside the drawer. Closing the drawer the moment the machine
   * is ready hid the command from exactly the visit it exists for.
   */
  it('keeps the drawer open and the card leading until one job has actually run', () => {
    expect(rules).toContain("runnerEntry.status === 'available'");
    expect(rules).toContain('setup && !setup.hasRun');
    expect(executors).toContain('const drawerOpen = needsSetup || needsFirstRun');
    expect(executors).toContain('queue one trusted job');
    expect(executors).toContain('the queue command and the start plan');
    // The Pipeline page hands Rules the same setup reading the journey uses,
    // so the two surfaces cannot disagree about whether anything has run.
    expect(WEBVIEW_SCRIPT).toContain('renderPipelineRules(delivery.routes || [], delivery.routing || {}, runnerCard, setup)');
  });

  /**
   * `gh workflow run` resolves workflows through GitHub's registry, which only
   * knows files on the default branch — so a freshly scaffolded workflow
   * answers HTTP 404 with an API URL that reads like a wrong folder. The queue
   * step says so where the command is offered, because everything about that
   * error suggests moving a file that is already in the right place.
   */
  it('pre-empts the dispatch 404 in the queue step itself', () => {
    expect(WEBVIEW_SCRIPT).toContain('HTTP 404: workflow not found on the default branch');
    expect(WEBVIEW_SCRIPT).toContain('GitHub only registers a dispatchable workflow once the file exists');
    expect(WEBVIEW_SCRIPT).toContain('a push runs the workflow from the pushed commit itself');
  });

  it('offers the setup action on the row, not only inside the drawer', () => {
    expect(executors).toContain('pipeline-runner-inspect');
    expect(executors).toContain('Set up this machine');
  });

  /**
   * An executor nothing routes to is a capability you declined, not a chore
   * you have not finished. Saying "needs setup" against `act` made the list
   * feel endless.
   */
  it('calls an unused executor optional rather than unfinished', () => {
    expect(executors).toContain("route.necessity === 'core'");
    expect(executors).toContain("used ? 'needs setup' : 'optional'");
    expect(executors).toContain('Optional alternative');
    expect(executors).toContain('you can leave it');
    expect(executors).toContain('no adapter yet');
  });

  /**
   * Before any routing file exists an empty rule set means undecided, not
   * unwanted — otherwise the borrowed machine reads as optional at the exact
   * moment somebody is trying to set it up.
   */
  it('treats no rules as undecided rather than as nothing being needed', () => {
    expect(executors).toContain('(core && referenced.size === 0)');
    expect(executors).toContain('undecided, not unwanted');
    expect(rules).toContain("|| !(routing.matrix || []).length");
  });
});

/**
 * The Atlas action pill.
 *
 * "Ask Atlas" names who is being asked and never what they will do, so a row
 * of these buttons was a row of identical circles distinguishable only by
 * hovering each one. The glyph is the second symbol that closes that gap —
 * and, being a second copy of a table the host also holds, the thing most
 * likely to drift.
 */
describe('the Atlas action pill', () => {
  const HOST_SOURCE = readFileSync(
    path.join(process.cwd(), 'src', 'views', 'webviewUtils.ts'),
    'utf8',
  );

  /** The glyph table as written in a source file, keyed by intent. */
  function glyphTable(source: string): Record<string, string> {
    const start = source.indexOf('ATLAS_ACTION_GLYPHS = {');
    expect(start, 'the glyph table is missing').toBeGreaterThan(-1);
    const end = source.indexOf('};', start);
    const body = source.slice(start, end);
    const table: Record<string, string> = {};
    for (const match of body.matchAll(/^\s*(\w+): '(.*)',$/gm)) {
      table[match[1] as string] = match[2] as string;
    }
    return table;
  }

  /**
   * Two copies of one vocabulary, because the webview script is a string
   * handed to a browser and cannot import from the host. The duplication is
   * unavoidable; the divergence is not.
   */
  it('uses the same glyph for the same intent on the host and in the webview', () => {
    const host = glyphTable(HOST_SOURCE);
    const page = glyphTable(WEBVIEW_SCRIPT);
    expect(Object.keys(host).length).toBeGreaterThan(0);
    expect(page).toEqual(host);
  });

  /**
   * The glyph narrows the action; it never carries it alone. A symbol set
   * nobody has learnt yet must not be the only statement of what a button
   * does, so the tooltip and the accessible name stay full sentences and the
   * glyph is hidden from assistive technology rather than read out as a
   * trigram.
   */
  it('keeps the sentence in the tooltip and hides the glyph from screen readers', () => {
    for (const source of [HOST_SOURCE, WEBVIEW_SCRIPT]) {
      const button = source.slice(source.indexOf('atlas-discuss-action icon-only'));
      expect(button).toContain('atlas-discuss-glyph');
      expect(button.slice(0, button.indexOf('atlas-discuss-label'))).toContain('aria-hidden="true"');
      expect(button).toContain('aria-label=');
      expect(button).toContain('title=');
    }
  });

  /** An intent nobody set still renders a pill rather than a bare mark. */
  it('falls back to the discuss glyph when no intent is declared', () => {
    expect(HOST_SOURCE).toContain("ATLAS_ACTION_GLYPHS[options.intent ?? 'discuss']");
    expect(WEBVIEW_SCRIPT).toContain('ATLAS_ACTION_GLYPHS[options.intent] || ATLAS_ACTION_GLYPHS.discuss');
  });
});

/**
 * Reaching the record a verdict is about.
 *
 * The Pipeline page can say a policy is unevidenced; only the Testing page can
 * say what it would take. A verdict with no way through to its subject is the
 * dead end this rebuild exists to remove.
 */
describe('cross-page links out of the Pipeline page', () => {
  const PANEL_SOURCE = readFileSync(
    path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
    'utf8',
  );

  it('opens the policy card on the Testing page from a declared-policy row', () => {
    const tests = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function renderPipelineTests'),
      WEBVIEW_SCRIPT.indexOf('function renderPipelineRules'),
    );
    expect(tests).toContain('data-action="dashboard-focus" data-page="testing"');
    expect(tests).toContain('data-focus-kind="testing-policy"');
  });

  /**
   * The kind was declared in `types.ts` and rendered as a focus attribute on
   * every policy card while being absent from both allowlists, so any link to
   * a policy degraded silently to "the right page, no record". Both copies
   * validate independently; both must know the kind.
   */
  it('accepts testing-policy as a focus kind on the host and in the webview', () => {
    const hostList = PANEL_SOURCE.slice(
      PANEL_SOURCE.indexOf('const DASHBOARD_FOCUS_KINDS'),
      PANEL_SOURCE.indexOf('];', PANEL_SOURCE.indexOf('const DASHBOARD_FOCUS_KINDS')),
    );
    expect(hostList).toContain("'testing-policy'");
    const pageList = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('const DASHBOARD_FOCUS_KINDS'),
      WEBVIEW_SCRIPT.indexOf('];', WEBVIEW_SCRIPT.indexOf('const DASHBOARD_FOCUS_KINDS')),
    );
    expect(pageList).toContain("'testing-policy'");
  });

  /** A collapsed card answers the click with a heading and nothing else. */
  it('expands the policy card the link named', () => {
    expect(WEBVIEW_SCRIPT).toContain("target.focus.kind === 'testing-policy'");
    expect(WEBVIEW_SCRIPT).toContain('state.testingExpandedIds = [target.focus.id]');
  });
});

/**
 * The executor row's link to a route's own site.
 *
 * The page names a route id; the host owns the destination. That is what lets
 * a row offer a link without ever being able to choose one — and it only works
 * if the host's allowlist knows every id the page can send.
 */
describe('executor documentation links', () => {
  const PANEL_SOURCE = readFileSync(
    path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
    'utf8',
  );

  it('sends the route id, never a URL', () => {
    const executors = WEBVIEW_SCRIPT.slice(WEBVIEW_SCRIPT.indexOf('function renderRulesExecutors'));
    expect(executors).toContain('data-action="pipeline-setup-help" data-payload="${escapeAttr(route.id)}"');
    expect(executors).toContain('route.docsUrl');
    // The row asks whether a link exists; it never interpolates the address.
    expect(executors).not.toContain('href=');
  });

  it('resolves every linked route id through the host allowlist', () => {
    const table = PANEL_SOURCE.slice(
      PANEL_SOURCE.indexOf('const LOCAL_CI_SETUP_HELP_URLS'),
      PANEL_SOURCE.indexOf('};', PANEL_SOURCE.indexOf('const LOCAL_CI_SETUP_HELP_URLS')),
    );
    for (const id of ['act', 'buildkite', 'woodpecker']) {
      expect(table).toContain(`findCiRoute('${id}')?.docsUrl`);
    }
  });
});

/**
 * The Activity view's three legibility contracts.
 *
 * All three come from the same complaint, which is worth stating once: this
 * page compresses a lot into very little — a glyph, a colour, a bar height, a
 * bar position — and every compression is a private vocabulary until it is
 * published. A reader who cannot decode the marks is not reading a dense
 * dashboard, they are looking at decoration.
 */
describe('the Activity view explains its own notation', () => {

  /**
   * Every mark carries its sentence in the same table the legend renders from,
   * so the key on the card cannot drift from the marks above it.
   */
  it('publishes a meaning for every status mark, from one table', () => {
    const table = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('const PIPELINE_BUILD_STATUS = {'),
      WEBVIEW_SCRIPT.indexOf('const PIPELINE_BUILD_OBSERVATION'),
    );
    for (const status of ['passed', 'failed', 'running', 'cancelled', 'unknown']) {
      expect(table, `${status} is missing from the status table`).toContain(`${status}: {`);
    }
    // Five entries, five meanings: a mark with no sentence is the defect.
    expect([...table.matchAll(/meaning: '/g)]).toHaveLength(5);
    expect(WEBVIEW_SCRIPT).toContain('function renderPipelineBuildLegend');
    expect(WEBVIEW_SCRIPT).toContain('What the marks mean');
  });

  /**
   * Outcome and observation are independent, and the legend has to say so — an
   * unobserved run has no outcome to report, which is why it is marked rather
   * than left blank, and reading the question mark as a failure is the mistake
   * the two-vocabulary split exists to prevent.
   */
  it('keeps how it ended separate from how closely it was watched', () => {
    expect(WEBVIEW_SCRIPT).toContain('const PIPELINE_BUILD_OBSERVATION');
    for (const mode of ['live', 'polled', 'unobserved']) {
      expect(WEBVIEW_SCRIPT).toContain(`${mode}:`);
    }
    expect(WEBVIEW_SCRIPT).toContain('They are independent');
  });

  /**
   * A filtered list that also restates its own count as the total is how
   * somebody concludes nothing failed today.
   */
  it('never lets a filter rewrite the total', () => {
    expect(WEBVIEW_SCRIPT).toContain('the count above is every recorded build');
    expect(WEBVIEW_SCRIPT).toContain('statusFilter !== \'all\'');
  });

  it('offers an order and a grouping, not just a stream', () => {
    expect(WEBVIEW_SCRIPT).toContain('PIPELINE_STREAM_SORTS');
    expect(WEBVIEW_SCRIPT).toContain('set-pipeline-stream-sort');
    expect(WEBVIEW_SCRIPT).toContain('set-pipeline-stream-view');
    expect(WEBVIEW_SCRIPT).toContain('By pipeline');
  });

  /**
   * Cancelled is not failed. Folding it into the failure filter would report a
   * cancellation as a defect, which is the same mistake the reliability figure
   * on this page already refuses to make.
   */
  it('does not count a cancellation as a failure in the filter', () => {
    expect(WEBVIEW_SCRIPT).toContain('no-verdict');
    expect(WEBVIEW_SCRIPT).toContain('const hasVerdict = build =>');
  });

  /** A cap that hides rows says how many, and offers them. */
  it('states the remainder rather than truncating quietly', () => {
    expect(WEBVIEW_SCRIPT).toContain('Show ${hidden} more');
    expect(WEBVIEW_SCRIPT).toContain('pipeline-stream-expand');
  });
});

/**
 * Automatic CI refresh is the one control in this panel that spends something
 * without being asked again, so its defaults and its gates are the whole design.
 *
 * It was four permanently visible segmented buttons on one card of one page.
 * It is a pop-out on every steady-state refresh button now, which changes two
 * things this file has to keep honest: the cadence must stay visible while its
 * control is folded away, and the poll must actually behave the way the menu
 * says it does from whichever page you set it on.
 */
const CADENCE_TABLE = WEBVIEW_SCRIPT.slice(
  WEBVIEW_SCRIPT.indexOf('const CI_REFRESH_CADENCES'),
  WEBVIEW_SCRIPT.indexOf('const CI_REFRESH_COST_NOTE'),
);

describe('the automatic CI refresh cadence', () => {
  it('is off by default, and off is a declared choice rather than an absence', () => {
    // First in the list and zero-valued: a cadence control whose default polls
    // would spend a rate limit nobody agreed to.
    expect(CADENCE_TABLE.indexOf("id: 'off'")).toBeGreaterThan(-1);
    expect(CADENCE_TABLE.indexOf("id: 'off'")).toBeLessThan(CADENCE_TABLE.indexOf("id: '1m'"));
    expect(CADENCE_TABLE).toContain('ms: 0');
    expect(WEBVIEW_SCRIPT).toContain("persistedWebviewState.ciRefreshCadence : 'off'");
  });

  /** The shortest cadence is a minute: faster is a poll nobody reads. */
  it('offers nothing faster than a minute', () => {
    const intervals = [...CADENCE_TABLE.matchAll(/ms: (\d+)/g)].map(match => Number(match[1]));
    expect(intervals.filter(value => value > 0).every(value => value >= 60000)).toBe(true);
  });

  /**
   * Two gates, each closing a way this could spend a request nobody wanted: a
   * hidden panel, and a fetch already in flight.
   *
   * A third — the Pipeline page had to be active — was deliberately removed
   * when the control moved onto every refresh button. It defeated the cadence
   * people most want (one minute, to watch a run you just started, which is
   * exactly when you go and do something else), and a rule holding on one page
   * out of fourteen would be contradicted by the affordance everywhere else.
   * Its absence is asserted, because re-adding it would look like a fix.
   */
  it('does not poll while hidden or already fetching, and no longer cares which page is open', () => {
    const sync = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function syncCiRefreshCadence'),
      WEBVIEW_SCRIPT.indexOf('document.addEventListener(\'visibilitychange\''),
    );
    expect(sync).toContain('document.hidden');
    expect(sync).toContain('state.repositoryRefreshBusy');
    expect(sync).not.toContain('state.activePage');
  });

  /** A restored cadence starts its timer, rather than only looking as if it had. */
  it('honours a cadence restored from a previous session at startup', () => {
    // The only callers used to be the click handler and the visibility
    // listener, so reopening the panel with a cadence saved showed it as
    // running and fetched nothing until you switched tabs away and back.
    const tail = WEBVIEW_SCRIPT.slice(WEBVIEW_SCRIPT.lastIndexOf("vscode.postMessage({ type: 'ready' })") - 800);
    expect(tail).toContain('syncCiRefreshCadence();');
    expect(tail).toContain('syncRefreshCadenceIndicators();');
  });

  /** A persisted cadence is untrusted input like any other. */
  it('validates a restored cadence against the declared list', () => {
    expect(WEBVIEW_SCRIPT).toContain("['off', '1m', '5m', '15m'].includes(persistedWebviewState.ciRefreshCadence)");
    expect(WEBVIEW_SCRIPT).toContain('CI_REFRESH_CADENCES.some(entry => entry.id === id)');
  });
});

describe('the cadence pop-out', () => {
  it('replaced the permanently visible segmented row', () => {
    // The row cost a line and a half of every Pipeline render for a setting
    // most people choose once, and was unreachable from the other thirteen
    // pages that display what it refreshes.
    expect(WEBVIEW_SCRIPT).not.toContain('renderPipelineAutoRefresh');
    expect(WEBVIEW_SCRIPT).not.toContain('set-pipeline-auto-refresh');
    expect(HOST_PANEL).not.toContain('ci-autorefresh');
  });

  it('is one menu shared by every trigger rather than one per button', () => {
    // N menus in the document is N chances for one to be left open behind a
    // re-render, and needs an id per copy that survives renders it cannot see.
    // The Lens panel's info popover already solved this the same way.
    const menu = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('const ciRefreshCadenceMenu'),
      WEBVIEW_SCRIPT.indexOf("vscode.postMessage({ type: 'ready' })"),
    );
    expect(menu).toContain('document.body.appendChild(node)');
    expect(WEBVIEW_SCRIPT.match(/className = 'refresh-cadence-menu'/g)?.length).toBe(1);
  });

  it('states what the cadence costs where the choice is made', () => {
    const note = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('const CI_REFRESH_COST_NOTE'),
      WEBVIEW_SCRIPT.indexOf('function currentCiRefreshCadence'),
    );
    expect(note).toMatch(/rate limit/);
    expect(note).toMatch(/spends money/);
  });

  it('keeps a running cadence legible while the menu is closed', () => {
    // The one thing a pop-out can get badly wrong: hiding a setting that
    // spends a rate limit behind a control that gives no sign it is on.
    expect(CADENCE_TABLE).toContain("short: '5m'");
    const sync = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function syncRefreshCadenceIndicators'),
      WEBVIEW_SCRIPT.indexOf('const ciRefreshCadenceMenu'),
    );
    expect(sync).toContain("classList.toggle('is-on', running)");
    expect(sync).toContain('choice.short');
    expect(HOST_PANEL).toContain('.refresh-cadence-toggle.is-on');
  });

  it('is reachable from the header, so it is on every page', () => {
    // The header is the "wherever": it is the one refresh control present on
    // all fourteen pages, and it sits outside #dashboard-root, so its trigger
    // is written into the host markup rather than produced by a renderer.
    const start = HOST_PANEL.indexOf('<span class="refresh-split">');
    expect(start, 'the header refresh is not a split button').toBeGreaterThan(-1);
    const header = HOST_PANEL.slice(start, HOST_PANEL.indexOf('</span>\n', HOST_PANEL.indexOf('refresh-cadence-caret', start)));
    expect(header).toContain('id="dashboard-refresh"');
    expect(header).toContain('data-refresh-cadence');
    expect(header).toContain('aria-haspopup="menu"');
  });

  it('is offered only on controls the cadence actually governs', () => {
    // A git fetch and a single branch's review are different operations, and a
    // first-load or retry control would be offering to schedule repeats of a
    // read that has never once succeeded.
    for (const [call, expected] of [
      ["renderRefreshAction('pipeline-refresh', 'Refresh'", true],
      ["renderRefreshAction('issues-refresh', 'Refresh issues'", true],
      ["renderRefreshAction('branch-review-refresh', 'Refresh PR & CI'", true],
      ["renderRefreshAction('branch-fetch'", false],
      ["renderRefreshAction('issues-refresh', 'Load issues'", false],
      ["renderRefreshAction('pipeline-refresh', 'Try again'", false],
    ] as [string, boolean][]) {
      const at = WEBVIEW_SCRIPT.indexOf(call);
      expect(at, `${call} not found`).toBeGreaterThan(-1);
      const site = WEBVIEW_SCRIPT.slice(at, WEBVIEW_SCRIPT.indexOf('})', at) + 2);
      expect(site.includes('cadence: true'), `${call} cadence: ${expected}`).toBe(expected);
    }
  });

  it('can be closed and left by the keyboard', () => {
    const menu = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('const ciRefreshCadenceMenu'),
      WEBVIEW_SCRIPT.indexOf("vscode.postMessage({ type: 'ready' })"),
    );
    expect(menu).toContain("event.key === 'Escape'");
    expect(menu).toContain("event.key !== 'ArrowDown'");
    expect(menu).toContain('restoreFocus: true');
    expect(menu).toContain("setAttribute('role', 'menu')");
  });
});

/**
 * CI on each pull request.
 *
 * The tracker has fetched `statusChecks` for every pull request since v0.200
 * and the page never rendered them, so the one question a reviewer arrives with
 * — *is this branch green?* — was answerable only on GitHub.
 */
describe('the pull request page charts CI per pull request', () => {
  const chart = WEBVIEW_SCRIPT.slice(
    WEBVIEW_SCRIPT.indexOf('function renderPullRequestCiChart'),
    WEBVIEW_SCRIPT.indexOf('function renderPullRequests(snapshot)'),
  );

  it('renders a bar per pull request from the checks already fetched', () => {
    expect(chart.length).toBeGreaterThan(500);
    expect(chart).toContain('pr-ci-bar');
    expect(chart).toContain('pr.statusChecks');
  });

  /**
   * The rule this page shares with every other surface here: not looked at and
   * nothing there are different facts, and drawing them the same way puts "we
   * did not check" and "nothing is verifying this" in the same pixels.
   */
  it('keeps an unfetched rollup distinct from a pull request with no checks', () => {
    expect(chart).toContain('!Array.isArray(checks)');
    expect(chart).toContain('not read');
    expect(chart).toContain('not evidence that nothing ran');
    expect(chart).toContain('checks.length === 0');
    expect(chart).toContain('no checks');
    expect(chart).toContain('Nothing is verifying');
  });

  /** A check still running has no verdict, and green-so-far is how a PR merges early. */
  it('never counts a running check as passed', () => {
    const outcome = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function pullRequestCheckOutcome'),
      WEBVIEW_SCRIPT.indexOf('function renderPullRequestCiChart'),
    );
    expect(outcome).toContain("conclusion === 'success'");
    expect(outcome).toContain("return 'running'");
    // A conclusion nothing recognises is not a pass either.
    expect(outcome).toContain("return conclusion ? 'other' : 'running'");
    expect(chart).toContain('buckets.running');
    expect(chart).toContain('running');
  });

  /**
   * Skipped, cancelled and neutral ran and decided nothing. Folding them into
   * either pass or fail would report a skipped job as green.
   */
  it('gives checks that decided nothing their own bucket', () => {
    const outcome = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf('function pullRequestCheckOutcome'),
      WEBVIEW_SCRIPT.indexOf('function renderPullRequestCiChart'),
    );
    for (const conclusion of ['cancelled', 'skipped', 'neutral', 'stale']) {
      expect(outcome).toContain(conclusion);
    }
    expect(chart).toContain('skipped, cancelled or neutral');
  });

  /** Every colour on the bar says what it means, on the card. */
  it('publishes a key for the segments', () => {
    for (const key of ['passed', 'failed', 'running', 'other']) {
      expect(chart).toContain(`pr-ci-key ${key}`);
    }
  });
});

/**
 * A stage that is not green now offers two ways forward.
 *
 * The Workflow page could say stage 5 was amber and leave you to navigate to
 * the evidence by memory — a report card with no route to the classroom.
 */
describe('unfinished workflow stages offer a way forward', () => {
  const actions = WEBVIEW_SCRIPT.slice(
    WEBVIEW_SCRIPT.indexOf('const WF_STAGE_PAGE'),
    WEBVIEW_SCRIPT.indexOf('function renderWorkflow(snapshot)'),
  );

  /**
   * Every stage the curriculum declares must map somewhere, or the link is
   * silently missing on exactly the stage somebody is stuck on.
   */
  it('maps all eight stages to the page that owns their evidence', () => {
    for (const stage of [
      'planning', 'branching', 'development', 'pull-request',
      'ci', 'release', 'maintenance', 'automation',
    ]) {
      expect(actions, `${stage} has no owning page`).toContain(`${stage.includes('-') ? `'${stage}'` : stage}:`);
    }
    // Two are deliberately not what their name suggests, and both would be
    // wrong if derived: development is about the working tree, and the
    // automation policy is the workflow file this page already shows.
    expect(actions).toContain("development: 'repo'");
    expect(actions).toContain("automation: 'workflow'");
  });

  /** A finished stage gets no action row: noise makes the amber ones harder to find. */
  it('offers nothing on a stage that is already done', () => {
    expect(actions).toContain("if (stage.status === 'done')");
    expect(actions).toContain("return '';");
  });

  it('links to the owning page through the existing navigation bridge', () => {
    expect(actions).toContain('data-action="page" data-payload="${escapeAttr(page)}"');
    expect(actions).toContain('Open ${escapeHtml(label)}');
  });

  /**
   * The webview posts an id. Every word of the prompt is rebuilt host side, so
   * a crafted message can name a stage but never supply the text that reaches
   * the model — the boundary the issue, debt and testing handoffs all keep.
   */
  it('sends only the stage id to the host', () => {
    expect(WEBVIEW_SCRIPT).toContain("vscode.postMessage({ type: 'resolveWorkflowStage', payload: payload })");
    const panel = readFileSync(
      path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
      'utf8',
    );
    expect(panel).toContain("candidate['type'] === 'resolveWorkflowStage'");
    expect(panel).toContain('handleResolveWorkflowStage');
    // Rebuilt from the assessment the page was drawn from, not from the message.
    expect(panel).toContain('this.lastWorkflowStages');
  });

  /**
   * Asking how to complete something already complete produces confident advice
   * about work nobody needs to do. The button is not drawn on a green stage, so
   * a request for one arrived by a route worth declining.
   */
  it('refuses to advise on a stage that is already finished', () => {
    const panel = readFileSync(
      path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
      'utf8',
    );
    const handler = panel.slice(
      panel.indexOf('private async handleResolveWorkflowStage'),
      panel.indexOf("/** Type into the user's configured VS Code shell"),
    );
    expect(handler).toContain("stage.status === 'done'");
    expect(handler).toContain('is already complete');
    // Only the outstanding steps travel: handing over the finished ones invites
    // a plan that redoes them.
    expect(handler).toContain("(stage.steps ?? []).filter(step => step.status !== 'done')");
    // And the automation ceiling is stated only when the workflow file declares
    // one — defaulting would assert a ceiling nobody chose, in a prompt that
    // then tells a model to respect it.
    expect(handler).toContain('permitted');
    expect(handler).toContain('...(permitted');
  });
});

/**
 * The bar strip's time axis says something true when both ends fall in the
 * same bucket.
 *
 * `relativeLabel` has day granularity, so a strip whose runs all happened today
 * rendered **today** at both ends — which says nothing, and worse implies a
 * span the strip does not cover.
 */
describe('the run strip’s axis labels', () => {
  const ribbon = WEBVIEW_SCRIPT.slice(
    WEBVIEW_SCRIPT.indexOf('function renderRunRibbon'),
    WEBVIEW_SCRIPT.indexOf('const PIPELINE_RIBBON_WINDOW'),
  );

  it('states the span instead of repeating one label at both ends', () => {
    expect(ribbon).toContain('oldest !== newest');
    expect(ribbon).toContain('all within');
    expect(ribbon).toContain('spanMs');
  });

  /** Under a minute of runs is not "all within 0s". */
  it('has a floor for a span too short to name', () => {
    expect(ribbon).toContain('all within a minute');
    expect(ribbon).toContain('spanMs >= 60000');
  });

  /** One stamp is not a span, and no stamps is not a zero-length one. */
  it('renders no scale at all below two timestamps', () => {
    expect(ribbon).toContain('stamps.length < 2');
  });
});

/**
 * How the project numbers its software across branches.
 *
 * The property worth protecting is the one that is easiest to lose to
 * helpfulness: a project that has declared nothing must be told so, rather than
 * shown a scheme AtlasMind picked for it. A recommendation rendered as though it
 * were the policy would be indistinguishable, on screen, from a decision
 * somebody made.
 */
describe('the Release page states how versions are numbered', () => {
  const source = (): string => renderSource('renderRelease', 'renderPipeline');
  const rendered = (): string => source()
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');

  it('reads the plan and its rule from the host, and computes neither', () => {
    expect(rendered()).toContain('rel.versioning');
    expect(rendered()).toContain('versioning.plan');
    expect(HOST_PANEL).toContain('deriveVersionPlan({');
    expect(HOST_PANEL).toContain('describeVersionPlan(versionPlan)');
  });

  it('says "not declared" rather than showing a scheme nobody chose', () => {
    expect(rendered()).toContain('not declared');
    expect(rendered()).toContain('has not declared how it versions');
    // The recommendation is offered by the host only in that case, so a project
    // with a policy never sees a second one beside it reading as a correction.
    expect(HOST_PANEL).toContain('input.versioningPolicy !== undefined ? {} : {');
    expect(HOST_PANEL).toContain('recommended: recommendedVersioningPolicy({');
  });

  it('names the file a policy is adopted in, because that is the whole decision', () => {
    expect(rendered()).toContain('workflow.json');
  });

  it('shows what each declared branch produces, and where it publishes', () => {
    expect(rendered()).toContain('channel.branch');
    expect(rendered()).toContain('channel.distTag');
    expect(rendered()).toContain('channel.prerelease');
    expect(rendered()).toContain('finished versions');
  });

  it('carries the notes, so a reading taken without tags says so', () => {
    expect(rendered()).toContain('vPlan.notes');
  });

  it('publishes the rule table the plan was graded by', () => {
    expect(HOST_PANEL).toContain('Object.entries(VERSION_PLAN_RULES)');
  });

  it('promises that nothing here writes or tags a version', () => {
    expect(rendered()).toMatch(/never writes|Nothing here writes|is a reading/);
  });
});

describe('declared composition is visible on every migrated repository surface', () => {
  const between = (startName: string, endName: string): string => {
    const start = WEBVIEW_SCRIPT.indexOf(`function ${startName}(`);
    const end = WEBVIEW_SCRIPT.indexOf(`function ${endName}(`, start + 1);
    expect(start, `${startName} is missing`).toBeGreaterThan(-1);
    expect(end, `${endName} is missing`).toBeGreaterThan(start);
    return WEBVIEW_SCRIPT.slice(start, end);
  };

  it('labels git status per component and renders not-visible instead of zero', () => {
    const source = between('renderRepo', 'renderRuntime');
    expect(source).toContain('componentReadings');
    expect(source).toContain('Git visibility by component');
    expect(source).toContain('not visible');
    expect(source).toContain('Every count in this headline is scoped to');
  });

  it('labels the detailed issue board and names tracker coverage by component', () => {
    const source = between('renderIssues', 'renderIssueRow');
    expect(source).toContain('issues.scopeLabel');
    expect(source).toContain('Tracker visibility by component');
    expect(source).toContain('componentPortfolio.scopeLabel');
  });

  it('publishes the exact debt scan boundary and labels each entry with its component', () => {
    const source = between('renderDebt', 'renderPipelineDial');
    expect(source).toContain('debt.lastScanScope');
    expect(source).toContain('Last scan scope');
    expect(source).toContain('entry.componentLabel');
    expect(HOST_PANEL).toContain('scopeDebtCandidates(');
  });

  it('labels both CI inventory and observed-delta partial coverage', () => {
    const pipeline = between('renderPipeline', 'renderWorkflowStageActions');
    const workflow = workflowRenderSource();
    expect(pipeline).toContain('delivery.componentCi');
    expect(pipeline).toContain('CI inventory by component');
    expect(pipeline).toContain('delivery.ciScopeLabel');
    expect(workflow).toContain('delta.scope');
    expect(workflow).toContain('Partial component coverage');
    expect(HOST_PANEL).toContain('resolveWorkspaceScope(');
  });
});
