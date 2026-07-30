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
