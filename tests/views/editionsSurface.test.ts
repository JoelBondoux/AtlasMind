import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { isProjectDashboardMessage } from '../../src/views/projectDashboardPanel.ts';

const WEBVIEW = readFileSync(path.join(process.cwd(), 'media', 'projectDashboard.js'), 'utf8');
const HOST = readFileSync(path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'), 'utf8');

function editionsRender(): string {
  const start = WEBVIEW.indexOf('function renderEditions(snapshot)');
  expect(start, 'renderEditions is missing').toBeGreaterThan(-1);
  const end = WEBVIEW.indexOf('function renderVersions(snapshot)', start);
  expect(end, 'renderVersions should follow Editions').toBeGreaterThan(start);
  return WEBVIEW.slice(start, end);
}

describe('Editions dashboard surface', () => {
  it('keeps the directly-served dashboard script syntactically executable', () => {
    expect(() => new Function(WEBVIEW)).not.toThrow();
  });

  it('keeps designed offerings distinct from shipped Versions', () => {
    expect(WEBVIEW).toContain("['editions', 'Editions']");
    expect(WEBVIEW).toContain("['versions', 'Versions']");
    expect(WEBVIEW).toContain("pageSectionOpen('editions')");
    expect(WEBVIEW).toContain('${renderEditions(snapshot)}');
    expect(WEBVIEW.indexOf('${renderEditions(snapshot)}')).toBeLessThan(WEBVIEW.indexOf('${renderVersions(snapshot)}'));
  });

  it('renders offering columns, feature rows, editable cells and explicit unknowns', () => {
    const source = editionsRender();
    expect(source).toContain('edition-tier-heading');
    expect(source).toContain('edition-feature-heading');
    expect(source).toContain('edition-cell-edit');
    expect(source).toContain("const status = cell ? cell.status : 'unknown'");
    expect(source).toContain('Missing means not decided');
    expect(source).toContain('“Not offered” is an explicit gating decision');
  });

  it('shows pricing, dates, files, current status and portfolio graphics', () => {
    const source = editionsRender();
    expect(source).toContain("tier.pricing || 'pricing not set'");
    expect(source).toContain("tier.releaseDate || 'date not set'");
    expect(source).toContain('editionFileLinks(');
    expect(source).toContain('edition-distribution');
    expect(source).toContain('edition-skyline');
    expect(source).toContain('decisionCoveragePercent');
  });

  it('offers add, edit and confirmed removal for all three matrix dimensions', () => {
    const source = WEBVIEW.slice(WEBVIEW.indexOf("if (action === 'edition-filter')"), WEBVIEW.indexOf('// Filter and sort are ways of looking', WEBVIEW.indexOf("if (action === 'edition-filter')")));
    expect(source).toContain("action === 'edition-tier-add'");
    expect(source).toContain("action === 'edition-feature-add'");
    expect(source).toContain("action === 'edition-cell-edit'");
    expect(source).toContain("type: 'deleteReleaseMatrixEntity'");
    expect(HOST).toContain("'Remove from matrix'");
    expect(HOST).toContain('Referenced workspace files are not deleted.');
  });

  it('routes file and roadmap actions through host-owned records', () => {
    expect(WEBVIEW).toContain("type: 'openReleaseMatrixFile'");
    expect(WEBVIEW).toContain("'addReleaseMatrixRoadmap'");
    expect(WEBVIEW).toContain("'removeReleaseMatrixRoadmap'");
    expect(HOST).toContain('resolveReleaseMatrixAction(rawKey)');
    expect(HOST).toContain('const target = links?.[payload.index]');
    expect(HOST).toContain('resolved.entity.roadmapText');
    expect(HOST).not.toContain('addRoadmapItemFromExternalSurface(this.atlas, message.payload');
  });

  it('offers repository discovery, native source selection and a reviewed import preview', () => {
    expect(WEBVIEW).toContain('Import design document…');
    expect(WEBVIEW).toContain("type: 'scanReleaseMatrixDocuments'");
    expect(WEBVIEW).toContain('renderEditionImportPreview()');
    expect(WEBVIEW).toContain('Import reviewed features');
    expect(HOST).toContain("vscode.workspace.findFiles(");
    expect(HOST).toContain("vscode.window.showQuickPick(options");
    expect(HOST).toContain("vscode.window.showOpenDialog({");
    expect(HOST).toContain('The design document changed after preview. Rescan it before importing.');
    expect(HOST).toContain('Existing names, statuses, pricing, parameters and file links are not replaced.');
  });

  it('scans root-level design documents as well as nested project documents', () => {
    expect(HOST).toContain("vscode.workspace.findFiles('*.{md,mdx,txt,json}'");
    expect(HOST).toContain("vscode.workspace.findFiles('**/*.{md,mdx,txt,json}'");
  });

  it('keeps import replies in the message handler and scan actions in the click handler', () => {
    const secondaryStart = WEBVIEW.indexOf('function handleSecondaryMessage(message)');
    const secondaryEnd = WEBVIEW.indexOf('// The header sits outside #dashboard-root', secondaryStart);
    const clickStart = WEBVIEW.indexOf("root?.addEventListener('click'", secondaryEnd);
    const clickEnd = WEBVIEW.indexOf("root?.addEventListener('change'", clickStart);
    expect(secondaryStart).toBeGreaterThan(-1);
    expect(secondaryEnd).toBeGreaterThan(secondaryStart);
    expect(clickStart).toBeGreaterThan(secondaryEnd);
    expect(clickEnd).toBeGreaterThan(clickStart);
    expect(WEBVIEW.slice(secondaryStart, secondaryEnd)).toContain("message.type === 'releaseMatrixImportPreview'");
    expect(WEBVIEW.slice(clickStart, clickEnd)).toContain("action === 'edition-import-scan'");
    expect(WEBVIEW.slice(clickStart, clickEnd)).not.toContain("message.type === 'releaseMatrixImportPreview'");
  });

  it('shows reviewable roadmap and Issue matches and keeps their navigation host-owned', () => {
    expect(WEBVIEW).toContain('No plausible roadmap match');
    expect(WEBVIEW).toContain('No plausible Issue match');
    expect(WEBVIEW).toContain("type: 'openReleaseMatrixIssue'");
    expect(WEBVIEW).toContain("type: 'removeReleaseMatrixIssue'");
    expect(HOST).toContain('matchReleaseDesignFeatures(plan, roadmapCandidates, issueCandidates)');
    expect(HOST).toContain("page: 'issues', focus: { kind: 'issue'");
    expect(HOST).toContain('The feature remains in the editions matrix and the GitHub Issue is not changed or deleted.');
  });
});

describe('Editions dashboard message boundary', () => {
  it('accepts bounded edits and rejects invalid statuses or oversized content', () => {
    expect(isProjectDashboardMessage({
      type: 'saveReleaseMatrixTier',
      payload: { name: 'Pro', kind: 'tier', status: 'planned', pricing: '£12/month', fileLinks: ['docs/tiers.md'] },
    })).toBe(true);
    expect(isProjectDashboardMessage({
      type: 'saveReleaseMatrixTier',
      payload: { name: 'Pro', kind: 'tier', status: 'secret-status' },
    })).toBe(false);
    expect(isProjectDashboardMessage({
      type: 'saveReleaseMatrixCell',
      payload: { featureId: 'sync', tierId: 'pro', status: 'ready', parameters: 'x'.repeat(1_001) },
    })).toBe(false);
  });

  it('accepts only closed entity keys and bounded file indices', () => {
    expect(isProjectDashboardMessage({ type: 'addReleaseMatrixRoadmap', payload: 'cell:sync:pro' })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'addReleaseMatrixRoadmap', payload: 'cell:../../secret:pro' })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'openReleaseMatrixFile', payload: { entityKey: 'feature:sync', index: 2 } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openReleaseMatrixFile', payload: { entityKey: 'feature:sync', index: 99 } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'openReleaseMatrixIssue', payload: { entityKey: 'feature:sync', index: 0 } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'openReleaseMatrixIssue', payload: { entityKey: 'tier:pro', index: 0 } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'removeReleaseMatrixIssue', payload: { entityKey: 'feature:sync', index: 0 } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'removeReleaseMatrixIssue', payload: { entityKey: 'cell:sync:pro', index: 0 } })).toBe(false);
  });

  it('accepts only bounded, unique import selections', () => {
    expect(isProjectDashboardMessage({ type: 'scanReleaseMatrixDocuments' })).toBe(true);
    expect(isProjectDashboardMessage({
      type: 'applyReleaseMatrixImport',
      payload: {
        previewId: '00f8db6d-4cab-42f1-b726-c898f96a2778',
        selections: [{ featureImportId: 'cloud-sync', include: true, linkRoadmap: true, linkIssue: false }],
      },
    })).toBe(true);
    expect(isProjectDashboardMessage({
      type: 'applyReleaseMatrixImport',
      payload: {
        previewId: 'preview',
        selections: [
          { featureImportId: 'cloud-sync', include: true, linkRoadmap: true, linkIssue: false },
          { featureImportId: 'cloud-sync', include: true, linkRoadmap: false, linkIssue: true },
        ],
      },
    })).toBe(false);
  });
});
