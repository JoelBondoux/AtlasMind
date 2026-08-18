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
    expect(pipelineSource).toContain('No CI result has been read yet');
    expect(pipelineSource).toContain('No failing runs');
    expect(pipelineSource).toContain('its log could not be read');
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
    expect(body).toContain('${renderPipelineTabs(snapshot, runs)}');
    expect(body).toContain('overview: overviewContent');
    expect(body).toContain('workflow: `<div class="ci-studio-stack">${renderPipelineGraph(workflows, requiredChecks)}${managerCard}</div>`');
    expect(body).toContain('runner: runnerCard');
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

  it('starts with a beginner route and keeps specialist tools in named views', () => {
    expect(WEBVIEW_SCRIPT).toContain("const PIPELINE_SECTIONS = ['overview', 'workflow', 'runner', 'tests', 'analytics', 'packages']");
    expect(WEBVIEW_SCRIPT).toContain("label: 'Start here'");
    expect(WEBVIEW_SCRIPT).toContain("label: 'Workflow map'");
    expect(WEBVIEW_SCRIPT).toContain("label: 'Packages & repo'");
    expect(WEBVIEW_SCRIPT).toContain('Setup · ${completedSteps} of 4 complete');
    expect(WEBVIEW_SCRIPT).toContain('Next: ${escapeHtml(focus.title)}');
    expect(WEBVIEW_SCRIPT).toContain('role="tablist" aria-label="Pipeline Studio views"');
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
    expect(WEBVIEW_SCRIPT).toContain('Read-only map. Dragging changes presentation only.');
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

  it('charts bounded answer time and reliability using observed GitHub timestamps', () => {
    expect(WEBVIEW_SCRIPT).toContain('Feedback speed and reliability');
    expect(WEBVIEW_SCRIPT).toContain('Answer-time waterfall');
    expect(WEBVIEW_SCRIPT).toContain('Workflow reliability');
    expect(WEBVIEW_SCRIPT).toContain('includes queue time as well as execution');
    expect(WEBVIEW_SCRIPT).toContain('Needs 3 completed samples');
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
    expect(WEBVIEW_SCRIPT).toContain('Send complete command to terminal — typed, not run');
    expect(WEBVIEW_SCRIPT).toContain("vscode.postMessage({ type: 'copyLocalCiQueueCommand' });");
    expect(WEBVIEW_SCRIPT).toContain("vscode.postMessage({ type: 'sendLocalCiQueueCommandToTerminal' });");
    expect(WEBVIEW_SCRIPT).toContain('PowerShell, Command Prompt, bash, and zsh');
    expect(WEBVIEW_SCRIPT).not.toContain('<code>--ref ${escapeHtml(runner.trustedBranch');
    expect(WEBVIEW_SCRIPT).toContain('Cancel the stale run before queueing this checkout');
    expect(WEBVIEW_SCRIPT).toContain('Check GitHub queue → review start plan');
    expect(WEBVIEW_SCRIPT).toContain('queues the commit already pushed to the');
    expect(WEBVIEW_SCRIPT).toContain('checks both pending and queued runs');
    expect(WEBVIEW_SCRIPT).not.toContain("actionLabel: runner.enabled ? 'Inspect machine' : 'Enable runner'");
    expect(css).toContain('.ci-machine-setup');
    expect(localCiSource).toContain("'--status', 'pending'");
    expect(localCiSource).toContain('preflightIssue: error.issue');
    expect(css).toContain("configuration.inspect<boolean>('ci.localRunner.enabled')");
    expect(css).toContain('this.localCiRunnerInstance?.applyConfiguration(configuration, false);');
    expect(css).toContain('enablement: readLocalCiRunnerEnablement()');
  });

  it('keeps setup focused on one next action and progressively discloses depth', () => {
    expect(WEBVIEW_SCRIPT).toContain('class="panel-card ci-journey-card ci-next-action-card"');
    expect(WEBVIEW_SCRIPT).toContain('class="ci-journey-progress"');
    expect(WEBVIEW_SCRIPT).toContain('<summary>Show all four setup steps</summary>');
    expect(WEBVIEW_SCRIPT).toContain('<summary>Explore specialist dashboards</summary>');
    expect(WEBVIEW_SCRIPT).toContain('<summary>Show recent CI results</summary>');
    expect(WEBVIEW_SCRIPT).not.toContain('Live command deck');
    expect(WEBVIEW_SCRIPT).not.toContain('What is ready right now?');
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
    expect(WEBVIEW_SCRIPT).toContain("id: 'routes'");
    expect(WEBVIEW_SCRIPT).toContain('Where it runs');
  });

  /**
   * A capability nobody established must not render as a tick, and must not
   * render as blank either — a blank reads as "no", which is a different claim.
   */
  it('renders an unknown capability as its own mark', () => {
    expect(WEBVIEW_SCRIPT).toContain('ci-cap unknown');
    expect(WEBVIEW_SCRIPT).toContain('never assume yes');
  });

  it('states what each route proves rather than only whether it is usable', () => {
    expect(WEBVIEW_SCRIPT).toContain('ci-route-evidence');
    expect(WEBVIEW_SCRIPT).toContain('evidenceCaveat');
  });

  /**
   * A decision that cites the allowance without saying whether the allowance
   * was actually read is the failure the meter exists to prevent, one layer up.
   */
  it('always shows the allowance reading beside the routing decisions', () => {
    expect(WEBVIEW_SCRIPT).toContain('ci-routing-credit');
    expect(WEBVIEW_SCRIPT).toContain('pipeline-refresh-credit');
    expect(WEBVIEW_SCRIPT).toContain('has not been checked');
  });

  it('names the rule behind every routing decision, and why the others lost', () => {
    expect(WEBVIEW_SCRIPT).toContain('decision.ruleId');
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

describe('Pipeline build list', () => {
  it('shows every route in one list', () => {
    expect(WEBVIEW_SCRIPT).toContain('renderPipelineBuilds');
    expect(WEBVIEW_SCRIPT).toContain("id: 'builds'");
  });

  /**
   * The rule that keeps this page from inventing reassurance. A build AtlasMind
   * only started, on a terminal it does not read, must never carry a tick.
   */
  it('says plainly when it cannot report how a build ended', () => {
    expect(WEBVIEW_SCRIPT).toContain('does not read it, so it cannot report how they ended');
    expect(WEBVIEW_SCRIPT).toContain('no verdict by design');
  });

  it('marks hosted progress as polled rather than streamed', () => {
    expect(WEBVIEW_SCRIPT).toContain('checked at intervals, not streamed');
  });

  /**
   * An unfetched hosted history and a genuinely empty one are different facts;
   * rendering them alike would let the first read as a quiet week.
   */
  it('keeps unfetched hosted history distinct from empty history', () => {
    expect(WEBVIEW_SCRIPT).toContain('Hosted history has not been loaded');
    expect(WEBVIEW_SCRIPT).toContain('not evidence that nothing ran there');
  });
});
