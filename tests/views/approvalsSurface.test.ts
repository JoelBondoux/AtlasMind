import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The Approvals page is rendered by `media/projectDashboard.js` and served by
 * `src/views/projectDashboardPanel.ts`. Three properties of that split are worth
 * pinning, because breaking any of them would look like an ordinary refactor and
 * would quietly turn the register into one that certifies things nobody agreed
 * to:
 *
 * the browser must name a subject by an **opaque option id** the host published,
 * never by a path — otherwise a message could point the register at any file;
 * the browser must never supply the **prompt** an agent reads; and recording a
 * decision must **name a person**, because an approval by nobody cannot answer
 * the question the register exists for.
 */

const WEBVIEW_SCRIPT = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
);
const HOST_SOURCE = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
);

function webviewHandler(action: string, until: string): string {
  const start = WEBVIEW_SCRIPT.indexOf(`action === '${action}'`);
  expect(start, action).toBeGreaterThan(0);
  const end = WEBVIEW_SCRIPT.indexOf(`action === '${until}'`, start);
  expect(end, until).toBeGreaterThan(start);
  return WEBVIEW_SCRIPT.slice(start, end);
}

describe('the browser names a subject, never a path', () => {
  it('posts the opaque option id and nothing that could be read directly', () => {
    const handler = webviewHandler('approval-raise', 'decide-approval');
    expect(handler).toContain("type: 'raiseApproval'");
    expect(handler).toContain('subjectId: subjectId');
    // No path, no file, no content: the host resolves the id against the same
    // allowlist it published on this render.
    expect(handler).not.toContain('content:');
    expect(handler).not.toContain('path:');
  });

  it('resolves the id host-side against a rebuilt allowlist', () => {
    const start = HOST_SOURCE.indexOf('private async handleRaiseApproval');
    expect(start).toBeGreaterThan(0);
    const handler = HOST_SOURCE.slice(start, start + 1600);
    expect(handler).toContain('this.approvalSubjects().get(payload.subjectId)');
    // A subject that cannot be read is refused rather than recorded, because an
    // approval nobody could ever check is the state this register exists to
    // make visible rather than to create.
    expect(handler).toContain('subject.content === undefined');
  });

  it('builds the allowlist from declared roadmap items and tracked documents only', () => {
    const start = HOST_SOURCE.indexOf('function collectApprovalSubjects');
    expect(start).toBeGreaterThan(0);
    const collector = HOST_SOURCE.slice(start, HOST_SOURCE.indexOf('\n/**', start + 10));
    expect(collector).toContain("kind: 'roadmap-item'");
    expect(collector).toContain("kind: 'document'");
    // The durable anchor, never the positional id — a request keyed on
    // `roadmap-3` would point at a different item after any insert.
    expect(collector).toContain('item.nodeId');
  });
});

describe('a decision names a person', () => {
  it('refuses to record one when nobody is named', () => {
    const start = HOST_SOURCE.indexOf('private async handleDecideApproval');
    expect(start).toBeGreaterThan(0);
    const handler = HOST_SOURCE.slice(start, start + 2600);
    expect(handler).toContain('const actor = this.approvalActor();');
    expect(handler).toContain('if (!actor)');
  });

  it('confirms before recording, unlike the other register writes here', () => {
    const start = HOST_SOURCE.indexOf('private async handleDecideApproval');
    const handler = HOST_SOURCE.slice(start, start + 2600);
    expect(handler).toContain('modal: true');
    // And the dialog says what a self-approval is, rather than letting a
    // formality look like a review.
    expect(handler).toContain('self-approved');
  });
});

describe('the agent helps decide and never decides', () => {
  it('sends only an id from the browser', () => {
    const start = WEBVIEW_SCRIPT.indexOf("action === 'review-approval'");
    expect(start).toBeGreaterThan(0);
    const handler = WEBVIEW_SCRIPT.slice(start, start + 240);
    expect(handler).toContain("type: 'reviewApproval'");
    expect(handler).not.toContain('draftPrompt');
  });

  it('rebuilds the prompt from the register host-side', () => {
    const start = HOST_SOURCE.indexOf('private async handleReviewApproval');
    expect(start).toBeGreaterThan(0);
    const handler = HOST_SOURCE.slice(start, start + 800);
    expect(handler).toContain('buildApprovalReviewPrompt(request)');
  });
});

describe('the page states what it is and is not', () => {
  it('says an approval is a record rather than a gate', () => {
    const start = WEBVIEW_SCRIPT.indexOf('function renderApprovals(');
    expect(start).toBeGreaterThan(0);
    const page = WEBVIEW_SCRIPT.slice(start, WEBVIEW_SCRIPT.indexOf('\n  // ──', start));
    expect(page).toContain('not a permission');
    expect(page).toContain('nothing here blocks a release');
  });

  it('says an empty register means nobody raised a request', () => {
    const start = WEBVIEW_SCRIPT.indexOf('function renderApprovals(');
    const page = WEBVIEW_SCRIPT.slice(start, WEBVIEW_SCRIPT.indexOf('\n  // ──', start));
    expect(page).toContain('It means nobody raised a request');
  });

  it('never offers to reassign an unrouted request', () => {
    const start = WEBVIEW_SCRIPT.indexOf('function renderApprovals(');
    const page = WEBVIEW_SCRIPT.slice(start, WEBVIEW_SCRIPT.indexOf('\n  // ──', start));
    expect(page).toContain('will not reassign');
    expect(page).not.toContain('reassignApproval');
  });
});
