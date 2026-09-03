import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Two buttons on the Workflow page did nothing.
 *
 * `atlasmind.openSettings` was never added to the dashboard's command
 * allowlist, so both "Open settings" and "Change the project shape" posted a
 * message the host silently dropped. Silently is the part that mattered: from
 * the outside a dropped command is indistinguishable from a broken feature and
 * from one that quietly worked, so nobody could tell which — and the buttons
 * shipped that way.
 *
 * The allowlist is correct policy; a hand-maintained list that drifts from the
 * markup is not. This test is what keeps them together.
 */

const PANEL = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
);

const WEBVIEW = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
);

/** The command ids the host will actually execute. */
function allowlist(): Set<string> {
  const start = PANEL.indexOf('const ALLOWED_DASHBOARD_COMMANDS = new Set([');
  expect(start, 'ALLOWED_DASHBOARD_COMMANDS is missing').toBeGreaterThan(-1);
  const end = PANEL.indexOf(']);', start);
  return new Set([...PANEL.slice(start, end).matchAll(/'([^']+)'/g)].map(match => match[1]!));
}

/** The command ids the markup asks for. */
function requested(): string[] {
  return [...WEBVIEW.matchAll(/data-action="command"\s+data-payload="([^"]+)"/g)]
    .map(match => match[1]!)
    // Template interpolation is resolved at render time and cannot be checked
    // here; those are covered by the panelFlows surface tests instead.
    .filter(id => !id.includes('${'));
}

describe('every command a button asks for is one the host will run', () => {
  it('has no dashboard button pointing at a command that would be dropped', () => {
    const allowed = allowlist();
    const missing = [...new Set(requested())].filter(id => !allowed.has(id));
    expect(missing, `not allowlisted: ${missing.join(', ')}`).toEqual([]);
  });

  it('found some, so the extraction is not silently matching nothing', () => {
    // A test that checks an empty list against an empty list passes forever.
    expect(requested().length).toBeGreaterThan(5);
    expect(allowlist().size).toBeGreaterThan(5);
  });
});

describe('a blocked command says so', () => {
  it('warns rather than dropping the message', () => {
    const start = PANEL.indexOf("case 'openCommand':");
    const source = PANEL.slice(start, start + 900);
    expect(source).toContain('} else {');
    expect(source).toMatch(/showWarningMessage/);
  });

  it('says it is a bug in AtlasMind rather than blaming the user', () => {
    const start = PANEL.indexOf("case 'openCommand':");
    expect(PANEL.slice(start, start + 900)).toMatch(/not something you did/);
  });
});

describe('opening one setting', () => {
  it('is constrained to the atlasmind namespace', () => {
    // A hand-written list of every settable key would drift the moment somebody
    // added a setting, and drifting is exactly how the buttons above died. The
    // command only filters a UI — it changes nothing.
    const start = PANEL.indexOf("case 'openSettingKey':");
    expect(start).toBeGreaterThan(-1);
    const source = PANEL.slice(start, start + 800);
    expect(source).toMatch(/\^atlasmind\\\./);
    expect(source).toContain("'workbench.action.openSettings'");
  });

  it('points the shape button at the setting it actually changes', () => {
    // It used to open the whole Settings panel, which does not render the
    // archetype at all — so even allowlisted it would have shown nothing.
    expect(WEBVIEW).toContain('data-action="setting" data-payload="atlasmind.workflow.archetype"');
  });
});

describe('dashboard refresh feedback', () => {
  it('uses one in-button progress renderer for every repository refresh surface', () => {
    expect(WEBVIEW).toContain('function renderRefreshAction(');
    expect(WEBVIEW).toContain("renderRefreshAction('issues-refresh', 'Refresh issues'");
    expect(WEBVIEW).toContain("renderRefreshAction('issues-refresh', 'Refresh GitHub activity'");
    expect(WEBVIEW).toContain("renderRefreshAction('branch-review-refresh', 'Refresh PR & CI'");
    expect(WEBVIEW).toContain("renderRefreshAction('branch-fetch', 'Fetch latest from remotes'");
    expect(WEBVIEW).toContain("inspection ? 'Refresh review details' : 'Review details'");
  });

  it('drives busy state from host start and finish messages', () => {
    const refresh = PANEL.slice(
      PANEL.indexOf('private async handleRefreshIssues()'),
      PANEL.indexOf('private classifyIssueFailure(', PANEL.indexOf('private async handleRefreshIssues()')),
    );
    expect(refresh).toContain("type: 'repositoryRefreshBusy', payload: true");
    expect(refresh).toContain("type: 'repositoryRefreshBusy', payload: false");
    const busyStart = refresh.indexOf("payload: true");
    expect(busyStart).toBeLessThan(refresh.indexOf('await this.syncState()', busyStart));
    expect(WEBVIEW).toContain("message.type === 'repositoryRefreshBusy'");
    expect(WEBVIEW).toContain("aria-busy=\"${busy ? 'true' : 'false'}\"");
  });

  it('offers a panel-wide keyboard shortcut without scrolling to the top', () => {
    expect(PANEL).toContain('aria-keyshortcuts="Control+Shift+R Meta+Shift+R"');
    expect(PANEL).toContain('Ctrl/Cmd+Shift+R');
    expect(WEBVIEW).toContain("event.key.toLowerCase() === 'r'");
    expect(WEBVIEW).toContain("requestRepositoryRefresh('refresh')");
    expect(WEBVIEW).toContain('event.preventDefault()');
  });

  it('draws progress inside the button and honours reduced motion', () => {
    expect(PANEL).toContain('.refresh-progress-button.is-refreshing::before');
    expect(PANEL).toContain('--vscode-progressBar-background');
    expect(PANEL).toContain('@keyframes dashboardRefreshProgress');
    expect(PANEL).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

/**
 * The same class, one level down.
 *
 * Within an hour of fixing two buttons whose *command* was not allowlisted, a
 * new button shipped with `data-action="open-file"` where the handler answers to
 * `file`. The click handler falls through every `if` and returns, so the button
 * does nothing and says nothing — identical symptom, different table.
 *
 * A `data-action` the click handler does not recognise is always a bug, and it
 * is one nothing in the type system or the build can see.
 */
describe('every data-action has a handler', () => {
  /**
   * Action names *any* listener compares against.
   *
   * Two forms, because there are two listeners. The click handler destructures
   * the attribute and compares `action === '...'`; the change handler reads
   * `getAttribute('data-action') === '...'` directly, because a `<select>` fires
   * `change` rather than `click`. Matching only the first reported a working
   * dropdown as dead — which is worth remembering, because a test that cries
   * wolf about a feature that works gets the feature 'fixed'.
   */
  function handled(): Set<string> {
    return new Set([
      ...[...WEBVIEW.matchAll(/action === '([a-z0-9-]+)'/g)].map(match => match[1]!),
      ...[...WEBVIEW.matchAll(/getAttribute\('data-action'\) === '([a-z0-9-]+)'/g)].map(match => match[1]!),
    ]);
  }

  /** Action names the markup emits. */
  function emitted(): string[] {
    return [...WEBVIEW.matchAll(/data-action="([a-z0-9-]+)"/g)].map(match => match[1]!);
  }

  it('has no button whose action would fall through', () => {
    const known = handled();
    const missing = [...new Set(emitted())].filter(action => !known.has(action));
    expect(missing, `no handler for: ${missing.join(', ')}`).toEqual([]);
  });

  it('found both sides, so it is not comparing two empty sets', () => {
    expect(emitted().length).toBeGreaterThan(20);
    expect(handled().size).toBeGreaterThan(20);
  });
});

describe('gate writes are checked against a known set, not a pattern', () => {
  it('validates the setting key against the copy table', () => {
    // A surface that could name any `atlasmind.*` key could flip something that
    // is not a workflow gate at all — and the confirmation dialog would then
    // describe the wrong thing, which is worse than no dialog.
    expect(PANEL).toContain("Object.prototype.hasOwnProperty.call(WORKFLOW_GATE_COPY, payload['key'])");
  });

  it('keeps the dialog copy host-side', () => {
    // The webview asks to change a gate and never supplies the sentence saying
    // what that means.
    expect(PANEL).toContain('const WORKFLOW_GATE_COPY');
    expect(WEBVIEW).not.toContain('WORKFLOW_GATE_COPY');
  });

  it('describes every gate it will write', () => {
    const table = PANEL.slice(
      PANEL.indexOf('const WORKFLOW_GATE_COPY'),
      PANEL.indexOf('const AUTOMATION_LEVEL_COPY'),
    );
    for (const key of [
      'atlasmind.workflow.enabled',
      'atlasmind.workflow.allowIssueWrites',
      'atlasmind.workflow.allowPullRequestWrites',
      'atlasmind.workflow.allowReleaseWrites',
      'atlasmind.workflow.allowProtectedRefWrites',
    ]) {
      expect(table, key).toContain(key);
    }
  });
});

describe('the delta baseline is per-developer', () => {
  it('stores it in workspaceState, never in the SSOT', () => {
    // project_memory/ is git-tracked, so a baseline there would mean "when did
    // *anybody* last look", would show as an uncommitted change every time the
    // dashboard opened, and would conflict between two people on the same day.
    const store = PANEL.slice(
      PANEL.indexOf('const OBSERVED_BASELINE_STATE_KEY'),
      PANEL.indexOf('function clearHeldObservedDelta'),
    );
    expect(store).toContain('workspaceState');
    expect(store).not.toMatch(/project_memory|writeFile|ssotPath/);
  });

  it('holds the computed delta instead of recomputing per render', () => {
    // Advancing the baseline on every render would empty the delta from the
    // second render onwards — the surface would work once and then quietly
    // report nothing forever.
    expect(PANEL).toContain('let heldObservedDelta');
    expect(PANEL).toMatch(/heldObservedDelta\?\.root === root/);
  });

  it('stores a baseline even on a first look', () => {
    expect(PANEL).toMatch(/Stored even on a first look/);
  });

  it('degrades to a first look when storage fails rather than throwing', () => {
    const store = PANEL.slice(
      PANEL.indexOf('function resolveObservedDelta'),
      PANEL.indexOf('function withObservedDelta'),
    );
    expect((store.match(/catch/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the delta out of the pure builder', () => {
    // `buildGuidedWorkflowSnapshot` is pure over its input; editor storage is
    // not an input.
    expect(PANEL).toContain("}): Omit<DashboardGuidedWorkflowSnapshot, 'delta'> {");
  });
});

describe('a GitHub deep link is resolved by the host, never named by the webview', () => {
  it('sends a page and a link id, and no URL', () => {
    // A surface that could name the URL to open could name any URL, and
    // `openExternal` hands it to the browser without asking whose it is.
    expect(WEBVIEW).toContain("type: 'openGithubLink'");
    const row = WEBVIEW.slice(WEBVIEW.indexOf('function githubLinkRow'), WEBVIEW.indexOf('const state = {'));
    expect(row).not.toMatch(/https?:\/\//);
    expect(row).not.toContain('link.url');
  });

  it('validates only the shape, because the id is checked by resolution', () => {
    const guard = PANEL.slice(
      PANEL.indexOf("if (candidate['type'] === 'openGithubLink')"),
      PANEL.indexOf("if (candidate['type'] === 'markDeltaSeen')"),
    );
    expect(guard).toContain("typeof payload['page'] === 'string'");
    expect(guard).toContain("typeof payload['id'] === 'string'");
  });

  it('builds the URL from the slug and a constant path', () => {
    const handler = PANEL.slice(
      PANEL.indexOf('private async handleOpenGithubLink'),
      PANEL.indexOf('private async handleSetWorkflowGate'),
    );
    expect(handler).toContain('resolveGithubLink(payload.page, payload.id, parseRepoSlug(source))');
    // Nothing from the message reaches `openExternal` except through resolution.
    expect(handler).not.toMatch(/Uri\.parse\(payload/);
    expect(handler).toContain('if (url === undefined)');
  });

  it('carries the slug in the snapshot but re-validates it on the way back', () => {
    // The slug is the repository's name and already on screen, so sending it is
    // harmless — but it comes back through `parseRepoSlug` rather than being
    // interpolated into a URL on trust.
    expect(PANEL).toContain('this.lastGitRemoteUrl = message.payload.githubLinks.slug;');
    expect(PANEL).toContain('parseRepoSlug(source)');
  });

  it('derives the repository from the git remote, not a network call', () => {
    // `gh repo view` needs an authenticated CLI, and a route *to* GitHub is most
    // useful on exactly the setups where `gh` is not working.
    expect(PANEL).toContain("runGit(workspaceRoot, ['remote', 'get-url', 'origin'])");
    expect(PANEL).toContain('buildGithubLinksSnapshot(gitSnapshot.remoteUrl ?? dashboardIssues.repoSlug)');
  });

  it('renders both routing rows from the one place that knows which page it is building', () => {
    // `renderPageIntro` runs inside each page's own render, where
    // `state.activePage` would give every page the active one's links.
    // The same argument applies to the cross-page strip, so both are built
    // here and neither may migrate into a per-page renderer.
    expect(WEBVIEW).toContain('+ githubLinkRow(id)');
    expect(WEBVIEW).toContain('+ nextStepRow(id);');
    expect(WEBVIEW).not.toContain('githubLinkRow(state.activePage)');
    expect(WEBVIEW).not.toContain('nextStepRow(state.activePage)');
  });
});

describe('a roadmap item can be raised as an issue', () => {
  it('sends only an item id, never the issue text', () => {
    // The webview never composes the wording of something posted publicly in the
    // user's name. The host derives the text from the roadmap it holds.
    expect(WEBVIEW).toContain("type: 'draftIssueFromRoadmap'");
    expect(WEBVIEW).toContain("payload: { itemId: payload }");
    const guard = PANEL.slice(
      PANEL.indexOf("if (candidate['type'] === 'draftIssueFromRoadmap')"),
      PANEL.indexOf("if (candidate['type'] === 'openGithubLink')"),
    );
    expect(guard).toContain("typeof payload['itemId'] === 'string'");
    expect(guard).not.toMatch(/title|body|labels/);
  });

  it('drafts into the composer rather than filing', () => {
    // Two steps, because the alternative is a button that publishes.
    const handler = PANEL.slice(
      PANEL.indexOf('private async handleDraftIssueFromRoadmap'),
      PANEL.indexOf('   * Open the GitHub page a dashboard page is about.'),
    );
    expect(handler).toContain("type: 'issueDraft'");
    expect(handler).not.toContain("'issue', 'create'");
    expect(handler).not.toContain('runGh');
  });

  it('passes the repository real labels and invents none', () => {
    const handler = PANEL.slice(
      PANEL.indexOf('private async handleDraftIssueFromRoadmap'),
      PANEL.indexOf('   * Open the GitHub page a dashboard page is about.'),
    );
    expect(handler).toContain('this.taxonomyState?.labels.map(label => label.name) ?? []');
  });

  it('confirms before drafting from an item already ticked off', () => {
    const handler = PANEL.slice(
      PANEL.indexOf('private async handleDraftIssueFromRoadmap'),
      PANEL.indexOf('   * Open the GitHub page a dashboard page is about.'),
    );
    expect(handler).toContain('draft.alreadyComplete');
    expect(handler).toContain('modal: true');
  });

  it('does not offer the button on a completed item', () => {
    expect(WEBVIEW).toMatch(/item\.completed \? '' : `<button[^`]*roadmap-raise-issue/);
  });
});

describe('an unlinked pull request can become a tracking-issue draft', () => {
  it('sends only the pull-request number and lets the host derive all text', () => {
    expect(WEBVIEW).toContain("type: 'draftIssueFromPullRequest'");
    const guard = PANEL.slice(
      PANEL.indexOf("if (candidate['type'] === 'draftIssueFromPullRequest')"),
      PANEL.indexOf("if (candidate['type'] === 'openGithubLink')"),
    );
    expect(guard).toContain("payload?.['number']");
    expect(guard).not.toMatch(/title|body|labels/);
  });

  it('resolves the current PR, refuses linked work, and opens the composer', () => {
    const handler = PANEL.slice(
      PANEL.indexOf('private async handleDraftIssueFromPullRequest'),
      PANEL.indexOf('   * Append an ideation card'),
    );
    expect(handler).toContain('this.pullRequestsState?.find');
    expect(handler).toContain('pullRequest.linkedIssues.length > 0');
    expect(handler).toContain('derivePullRequestIssueDraft');
    expect(handler).toContain("type: 'issueDraft'");
    expect(handler).not.toContain("'issue', 'create'");
    expect(handler).not.toContain('runGh');
  });
});

describe('GitHub activity refreshes on dashboard use without request fan-out', () => {
  it('starts from the ready handshake and visible-panel reveal path', () => {
    expect(PANEL).toMatch(/case 'ready':[\s\S]{0,180}refreshRepositoryActivityIfStale/);
    expect(PANEL).toMatch(/webviewPanel\.visible[\s\S]{0,180}refreshRepositoryActivityIfStale/);
  });

  it('makes the dashboard-wide Refresh button update GitHub-backed pages too', () => {
    expect(PANEL).toMatch(/case 'refresh':[\s\S]{0,260}handleRefreshIssues/);
  });

  it('shares one in-flight guard across automatic and manual refreshes', () => {
    const refresh = PANEL.slice(
      PANEL.indexOf('private refreshRepositoryActivityIfStale'),
      PANEL.indexOf('private classifyIssueFailure'),
    );
    expect(refresh).toContain('this.repositoryActivityRefreshRunning');
    expect(refresh).toContain('this.repositoryActivityLastAttemptAt');
    expect(refresh).toContain('finally');
  });
});

describe('a milestone can be attached on create', () => {
  it('passes --milestone, which it never did', () => {
    // A milestone could be declared in the taxonomy and attached to nothing.
    expect(PANEL).toContain("args.push('--milestone', known.title);");
  });

  it('refuses a milestone the repository does not have', () => {
    // `gh` fails on an unknown milestone and the failure arrives as a raw CLI
    // error rather than an explanation.
    expect(PANEL).toContain('this.taxonomyState?.milestones.find(entry => entry.title === requested.trim())');
    expect(PANEL).toMatch(/is not a milestone on \$\{slug\}/);
    expect(PANEL).toMatch(/Nothing has been created/);
  });

  it('offers only open milestones in the composer', () => {
    expect(WEBVIEW).toContain("filter(m => m && m.state !== 'closed')");
  });

  it('keeps the prefill in module state, which render() cannot discard', () => {
    // `render()` rebuilds every section's innerHTML, so a value written into the
    // DOM on arrival would vanish on the next status push.
    expect(WEBVIEW).toContain('issuePrefill: undefined,');
    expect(WEBVIEW).toContain('state.issuePrefill = message.payload;');
  });

  it('clears the prefill on send and on cancel', () => {
    // Otherwise reopening the composer shows a draft nobody asked for.
    const composer = WEBVIEW.slice(WEBVIEW.indexOf("if (action === 'issues-new-cancel')"), WEBVIEW.indexOf("if (action === 'issues-comment')"));
    expect((composer.match(/state\.issuePrefill = undefined;/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
