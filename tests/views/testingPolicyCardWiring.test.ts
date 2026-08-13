import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The Testing policy cards cross the webview boundary, which is the one place
 * in this feature where a mistake is a security problem rather than a bug.
 *
 * The rule the codebase already keeps: **the webview supplies data, never
 * content.** A card posts an opaque policy id and nothing else; every string the
 * resulting action uses — the scaffold paths, the follow-up text, the issue
 * title and body — is rebuilt host-side from the current snapshot. So a crafted
 * message can name a policy that does not exist, and can never supply a command
 * to run, a path to write, or text to publish under the user's name.
 *
 * Source-level assertions because the webview script is a string in a template
 * literal and the host is a different file: there is no single runtime where
 * both halves can be exercised together.
 */
const ROOT = path.resolve(__dirname, '../..');
const WEBVIEW = readFileSync(path.join(ROOT, 'media/projectDashboard.js'), 'utf8');
const HOST = readFileSync(path.join(ROOT, 'src/views/projectDashboardPanel.ts'), 'utf8');

const ACTIONS = [
  { dataAction: 'testing-policy-scaffold', message: 'scaffoldTestingPolicy', handler: 'handleScaffoldTestingPolicy' },
  { dataAction: 'testing-policy-followup', message: 'createTestingFollowUp', handler: 'handleCreateTestingFollowUp' },
  { dataAction: 'testing-policy-issue', message: 'raiseTestingIssue', handler: 'handleRaiseTestingIssue' },
] as const;

describe('the policy card actions are wired end to end', () => {
  it('renders every action the webview knows how to dispatch', () => {
    for (const action of ACTIONS) {
      expect(WEBVIEW, `${action.dataAction} is dispatched but never rendered`)
        .toContain(`data-action="${action.dataAction}"`);
    }
  });

  it('posts a message the host declares, dispatches and implements', () => {
    for (const action of ACTIONS) {
      expect(WEBVIEW, `${action.message} is never posted`).toContain(`'${action.message}'`);
      expect(HOST, `${action.message} is not in the message union`).toContain(`type: '${action.message}'`);
      expect(HOST, `${action.message} has no dispatch case`).toContain(`case '${action.message}':`);
      expect(HOST, `${action.handler} is not implemented`).toContain(`private async ${action.handler}(`);
    }
  });

  it('validates every one of them before dispatch', () => {
    // An unvalidated message type reaches the handler with whatever payload the
    // page had. The validator is the boundary, so a missing entry here is the
    // whole guarantee gone for that action.
    const validatorStart = HOST.indexOf("candidate['type'] === 'scaffoldTestingPolicy'");
    expect(validatorStart, 'no validator block for the testing policy actions').toBeGreaterThan(-1);
    const validator = HOST.slice(
      validatorStart,
      HOST.indexOf("candidate['type'] === 'assignDashboardWorkOwner'", validatorStart),
    );
    for (const action of ACTIONS) {
      expect(validator, `${action.message} is not validated`).toContain(action.message);
    }
    expect(validator, 'the policy id is not constrained to an identifier charset')
      .toMatch(/\[a-z0-9-\]\{1,64\}/);
  });

  it('posts only the policy id — never a path, command, or body', () => {
    // The payload shape is the guarantee. Widening it is what would let the
    // page name a file to write or text to publish.
    const dispatch = WEBVIEW.slice(
      WEBVIEW.indexOf("action === 'testing-policy-scaffold'"),
      WEBVIEW.indexOf("action === 'branch-toggle-all'"),
    );
    expect(dispatch).toContain('payload: { policyId: payload }');
    for (const key of ['path', 'command', 'body', 'title', 'labels']) {
      expect(dispatch, `payload must not carry ${key}`).not.toContain(`${key}:`);
    }
  });
});

describe('the card is expandable without losing its other controls', () => {
  it('keeps the expansion toggle out of the action buttons', () => {
    // The toggle wraps the header only. If the action buttons were inside it,
    // `closest('[data-action]')` would resolve every click to the toggle and
    // no action on an open card could ever fire.
    const cardBlock = WEBVIEW.slice(
      WEBVIEW.indexOf('data-action="testing-policy-toggle"'),
      WEBVIEW.indexOf('${expanded ? renderPolicyCardDetail('),
    );
    expect(cardBlock).toContain('</button>');
    const afterButton = cardBlock.slice(cardBlock.lastIndexOf('</button>'));
    expect(afterButton).not.toContain('data-action="testing-policy-scaffold"');
  });

  it('tracks open cards as a list, so two can be compared', () => {
    expect(WEBVIEW).toContain('testingExpandedIds: []');
    expect(WEBVIEW).toMatch(/state\.testingExpandedIds\.includes\(/);
  });

  it('reuses the shared owner control rather than inventing assignment', () => {
    // A second assignment path would write Director records the Director page
    // does not recognise.
    const detailBlock = WEBVIEW.slice(
      WEBVIEW.indexOf('function renderPolicyCardDetail'),
      WEBVIEW.indexOf('function renderPolicyCoverage'),
    );
    expect(detailBlock).toContain("renderDirectorOwnerControl('testing-policy'");
  });
});

describe('severity never files anything by itself', () => {
  it('has no automatic issue creation on the testing path', () => {
    // Severity decides what is offered and emphasised. Every issue write stays
    // behind the same confirmation as the rest of the dashboard.
    const handler = HOST.slice(
      HOST.indexOf('private async handleRaiseTestingIssue('),
      HOST.indexOf('private async handleAssignDashboardWorkOwner('),
    );
    expect(handler).toContain('this.handleIssueWrite(');
    expect(handler).not.toMatch(/execFile|spawn|gh['"]\s*,/);
  });

  it('drops labels the repository does not declare, and says so', () => {
    const handler = HOST.slice(
      HOST.indexOf('private async handleRaiseTestingIssue('),
      HOST.indexOf('private async handleAssignDashboardWorkOwner('),
    );
    expect(handler).toContain('declared.has(label)');
    expect(handler).toMatch(/Labels not applied/);
  });
});
