import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The gate candidate scan, asserted against the real webview and host source.
 *
 * The scan proposes items for a release gate and the person picks some; the
 * properties worth pinning are the ones that would still compile if broken —
 * that the page names items by id and never sends their text, that the host
 * re-derives the candidates and refuses anything else, and that nothing reaches
 * the roadmap file without a modal that names every item.
 */

const WEBVIEW = readFileSync(path.join(process.cwd(), 'media', 'projectDashboard.js'), 'utf8').replace(/\r\n/g, '\n');
const HOST = readFileSync(path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'), 'utf8').replace(/\r\n/g, '\n');

function functionIn(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `${signature} is missing`).toBeGreaterThan(-1);
  const next = source.indexOf('\n  function ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

function actionBlock(action: string): string {
  const start = WEBVIEW.indexOf(`if (action === '${action}')`);
  expect(start, `the ${action} handler is missing`).toBeGreaterThan(-1);
  const end = WEBVIEW.indexOf('\n    if (action ===', start + 1);
  return WEBVIEW.slice(start, end);
}

function hostMethod(name: string): string {
  const start = HOST.indexOf(`private async ${name}(`);
  expect(start, `${name} is missing from the host`).toBeGreaterThan(-1);
  const end = HOST.indexOf('\n  private ', start + 1);
  return HOST.slice(start, end);
}

describe('the Find candidates action', () => {
  it('sits beside the gate selector and beside the canvas gate picker', () => {
    expect(functionIn(WEBVIEW, 'function renderGateSelector(')).toContain('renderGateScanButton(active)');
    expect(functionIn(WEBVIEW, 'function renderRoadmapEmphasisControls(')).toContain('renderGateScanButton(emphasisedGate)');
  });

  it('carries the AtlasMind mark and says nothing is tagged until you confirm', () => {
    const button = functionIn(WEBVIEW, 'function renderGateScanButton(');
    expect(button).toContain('atlas-discuss-action');
    expect(button).toContain('data-action="roadmap-gate-scan"');
    expect(button).toContain('nothing is tagged until you pick items and confirm');
  });

  it('opens the scan the snapshot already carries, without a message', () => {
    expect(actionBlock('roadmap-gate-scan')).not.toContain('postMessage');
    expect(actionBlock('roadmap-gate-candidate-pick')).not.toContain('postMessage');
    expect(actionBlock('roadmap-gate-scan-close')).not.toContain('postMessage');
  });

  it('only lets a candidate the scan offered be picked', () => {
    const pick = actionBlock('roadmap-gate-candidate-pick');
    expect(pick).toContain('candidate.id === payload');
    expect(pick).toContain('if (offered)');
  });
});

describe('what the page may say', () => {
  it('posts a gate id and the picked ids, and no item text', () => {
    const include = actionBlock('roadmap-gate-candidates-include');
    expect(include).toContain("type: 'includeRoadmapGateCandidates'");
    expect(include).toContain('payload: { gateId: report.gateId, itemIds: state.roadmapGateScanPicks.slice() }');
    expect(include).not.toMatch(/\.text\b/);
  });

  it('declares the message with ids only', () => {
    expect(HOST).toContain("| { type: 'includeRoadmapGateCandidates'; payload: { gateId: string; itemIds: string[] } }");
  });

  it('validates the payload rather than cleaning it', () => {
    const validator = functionIn(HOST.replace(/\nfunction /g, '\n  function '), 'function isGateCandidateIncludePayload(');
    expect(validator).toContain('slugifyGateId(gateId) === gateId');
    expect(validator).toContain('itemIds.length <= GATE_CANDIDATE_CAP * 2');
    expect(validator).toMatch(/every\(id => typeof id === 'string' && \/\^\[a-z0-9\]/);
    expect(HOST).toContain("if (candidate['type'] === 'includeRoadmapGateCandidates') {\n    return isGateCandidateIncludePayload(candidate['payload']);");
  });

  it('drops picks that stop being candidates when a new snapshot arrives', () => {
    expect(WEBVIEW).toContain('state.roadmapGateScanPicks = state.roadmapGateScanPicks.filter(id => offered.has(id));');
  });
});

describe('the host decides, and asks first', () => {
  const handler = hostMethod('handleIncludeRoadmapGateCandidates');

  it('re-runs the scan from disk and refuses anything that is not a candidate now', () => {
    expect(handler).toContain('collectRoadmapSnapshot(context.workspaceRoot, context.ssotPath)');
    expect(handler).toContain('resolveGateCandidateSelection(report, payload.itemIds)');
  });

  it('checks the text as well as the position, so an insert cannot redirect the tag', () => {
    expect(handler).toContain('normalizeRoadmapNodeText(item.text) === normalizeRoadmapNodeText(candidate.text)');
  });

  it('shows a modal naming every item before the write, and writes only on its button', () => {
    const modal = handler.indexOf('modal: true');
    const confirm = handler.indexOf("if (confirmation !== 'Add to gate')");
    const write = handler.indexOf('this.writeRoadmapDocument(');
    expect(modal).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(modal);
    expect(write).toBeGreaterThan(confirm);
    expect(handler).toContain('targets.map(({ candidate }) =>');
  });

  it('writes through the one roadmap writer, adding the tag and keeping every other gate', () => {
    expect(handler).toContain('this.writeRoadmapDocument(context, items, context.gates)');
    expect(handler).toContain('gates: [...item.gates, gate.id]');
    expect(handler).not.toContain('fs.writeFile');
  });

  it('builds the render and the check from the same function', () => {
    expect(HOST).toContain('gateCandidates: buildGateCandidatesView(gates, items, graph)');
  });
});

describe('the candidate list cannot overstate itself', () => {
  const panel = functionIn(WEBVIEW, 'function renderGateCandidatePanel(');

  it('escapes every piece of item text and evidence it draws', () => {
    expect(panel).toContain('escapeHtml(candidate.text)');
    expect(panel).toContain('escapeHtml(match.evidence)');
    expect(panel).toContain('escapeHtml(skip.reason)');
    expect(panel).toContain('escapeHtml(report.summary');
    expect(panel).not.toMatch(/\$\{\s*candidate\.text\s*\}/);
  });

  it('names the rule behind every candidate and publishes the table', () => {
    expect(panel).toContain('ruleLabel(candidate.leadingRule)');
    expect(panel).toContain('ruleLabel(match.rule)');
    expect(panel).toContain('escapeHtml(rule.detail)');
  });

  it('keeps could-not-assess distinct from nothing-matched, and states the remainder', () => {
    expect(panel).toContain("unassessable: 'Could not assess'");
    expect(panel).toContain("none: 'Nothing matched'");
    expect(panel).toContain('Not assessed');
    expect(panel).toContain('report.remainder');
  });
});
