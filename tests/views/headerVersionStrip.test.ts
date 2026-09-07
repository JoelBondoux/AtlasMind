import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The seam between the delivery pipeline and the dashboard header.
 *
 * The bug this replaced was invisible in exactly this way: the header rendered
 * two plausible pills forever, so a project that added a Staging stage saw no
 * change and had no reason to suspect the header was not reading the pipeline
 * at all. A wiring regression here fails the same silent way — the pills either
 * disappear or quietly revert to naming branches.
 */

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

const panel = read('src/views/projectDashboardPanel.ts');
const webview = read('media/projectDashboard.js');

describe('the header reads the delivery pipeline', () => {
  it('feeds the strip from the same stage views the Delivery page renders', () => {
    // Not a second collection pass: reading `stagePipeline.stages` is what stops
    // the header and the Delivery page reporting different versions.
    expect(panel).toContain('buildVersionStrip({');
    expect(panel).toMatch(/stages: stagePipeline\.stages/);
  });

  it('supplies the working copy version and the dirty flag', () => {
    // The working-tree pill is the only reading taken from disk rather than
    // git, and the dirty flag is the only thing that makes it worth a slot.
    expect(panel).toContain('workingVersion: packageSnapshot.version');
    expect(panel).toContain('workingTreeDirty: gitSnapshot.dirty');
  });

  it('renders from the derived strip rather than from branch fields', () => {
    const start = webview.indexOf('function renderVersionStrip(snapshot)');
    const end = webview.indexOf('function renderVersionPill(pill)', start);
    expect(start, 'renderVersionStrip not found').toBeGreaterThan(-1);
    expect(end, 'renderVersionPill not found after it').toBeGreaterThan(start);
    const body = webview.slice(start, end);

    expect(body).toContain('snapshot.versionStrip');
    // The old hardcoded pair, which named branches rather than stages.
    expect(body).not.toContain('snapshot.versions.current.branch');
    expect(body).not.toContain("renderVersionPill('Production'");
  });

  it('states the remainder instead of silently dropping a stage', () => {
    const start = webview.indexOf('function renderVersionStrip(snapshot)');
    const body = webview.slice(start, webview.indexOf('function renderVersionPill(pill)', start));
    expect(body).toContain('strip.droppedByCap');
    // And the overflow goes to the page that owns the full list.
    expect(body).toContain('data-payload="delivery"');
  });

  it('renders a reason rather than a blank when no version could be read', () => {
    const start = webview.indexOf('function renderVersionPill(pill)');
    const body = webview.slice(start, start + 1200);
    expect(body).toContain('pill.version');
    expect(body).toContain('no version');
  });
});

/**
 * A channel chip is a claim about how a project releases. It has to come from
 * something the project declared, or the header is asserting a release process
 * on the project's behalf — the same failure the "no version" placeholder
 * exists to avoid one column over.
 */
describe('the header names the release channel a branch produces', () => {
  it('takes the policy from the committed workflow file, never from a guess', () => {
    expect(panel).toContain('workflowConfigManager?.getConfig()?.versioning === undefined');
    expect(panel).toContain('policy: workflowConfigManager!.getConfig()!.versioning!');
  });

  it('renders a chip only when the pill carries a channel', () => {
    const start = webview.indexOf('function renderVersionPill(pill)');
    const body = webview.slice(start, webview.indexOf('function renderOverview(snapshot)', start));
    expect(body).toContain('pill.channel');
    expect(body).toContain('dashboard-version-pill-channel');
    // The falsy branch renders nothing at all — not a placeholder, and not a
    // default channel name.
    expect(body).toMatch(/pill\.channel[\s\S]*?:\s*'';/);
  });

  it('styles the chip', () => {
    expect(panel).toContain('.dashboard-version-pill-channel {');
  });
});

describe('a stage pill can move the checkout, under guard', () => {
  const checkout = panel.slice(
    panel.indexOf('private async checkoutVersionPillBranch'),
    panel.indexOf('private async saveRoadmap'),
  );

  it('found the handler', () => {
    expect(checkout.length).toBeGreaterThan(200);
  });

  it('puts the branch before the disambiguator, never after it', () => {
    // `checkout <branch> --` switches branch. `checkout -- <branch>` reads the
    // name as a pathspec and restores a *file* of that name from the index,
    // discarding uncommitted work on it. The two differ by one argument
    // position and by everything else.
    expect(checkout).toContain("['checkout', branch, '--']");
    expect(checkout).not.toContain("'checkout', '--', branch");
  });

  it('never forces, stashes or discards', () => {
    // Quoted argument forms only. A bare substring search matches the prose
    // above the method, which says the word "stashes" precisely because the
    // code does not do it — the debt register learned this the same way.
    for (const forbidden of ["'--force'", "'-f'", "'stash'", "'reset'", "'--hard'"]) {
      expect(checkout, `${forbidden} must not be passed to git on this path`).not.toContain(forbidden);
    }
  });

  it('refuses a pill that names no branch it could switch to', () => {
    // The working-tree pill is a reading from disk and has no ref; the current
    // pill is the branch already checked out.
    expect(checkout).toContain('pill.isWorkingTree || pill.isCurrent || !pill.ref');
  });

  it('resolves the pill from the strip it last sent, not from the message', () => {
    // The webview posts an id. A branch name arriving from the webview would be
    // a ref this panel never drew.
    expect(checkout).toContain('this.lastSnapshot?.versionStrip.pills');
    expect(checkout).toContain('entry.id === pillId');
  });

  it('will not create a branch as a side effect of a click', () => {
    expect(checkout).toContain('refs/heads/');
    expect(checkout).toContain('There is no local branch called');
  });

  it('names the uncommitted work before anything runs', () => {
    expect(checkout).toContain("['status', '--porcelain']");
    expect(checkout).toContain('modal: true');
  });

  it('sends the pill id and nothing else from the webview', () => {
    const start = webview.indexOf("versionStrip?.addEventListener('click'");
    expect(start, 'the strip has no listener of its own').toBeGreaterThan(-1);
    const body = webview.slice(start, start + 1200);
    expect(body).toContain("type: 'versionPillCheckout'");
    // The payload is the pill id. Nothing here reads a ref, a branch or a label.
    expect(body).not.toContain('pill.ref');
  });

  it('only offers the control on a pill that can use it', () => {
    const start = webview.indexOf('function renderVersionPill(pill)');
    const body = webview.slice(start, webview.indexOf('function renderOverview(snapshot)', start));
    expect(body).toContain('!pill.isWorkingTree && !pill.isCurrent && pill.ref');
  });

  it('outlines the stage you are standing on', () => {
    expect(panel).toContain('.dashboard-version-pill-current {');
    expect(panel).toMatch(/\.dashboard-version-pill-current \{[\s\S]*?outline:/);
  });
});
