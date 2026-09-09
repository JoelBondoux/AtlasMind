import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';
import { buildWebsiteDeliveryView, isProjectDashboardMessage } from '../../src/views/projectDashboardPanel.ts';

/**
 * Website delivery on the Dashboard's Delivery page — the framework, the three
 * hosting environments, the platform targets and the n8n map — moved here from
 * UI Studio because choosing a host is a delivery decision, not a design one.
 *
 * Three claims are pinned. The view is built by the host from the saved plan
 * (grades, readiness and drift derived, never restated). The webview posts the
 * three arrays it owns and a catalog id, nothing else, and the host re-reads
 * the rest of the plan from disk at the moment of the save. And the Studio's
 * own save re-reads these fields from disk too, so neither surface can undo
 * the other's work.
 */
const ROOT = process.cwd();
const dashboardScript = readFileSync(path.join(ROOT, 'media', 'projectDashboard.js'), 'utf8');
const dashboardPanel = readFileSync(path.join(ROOT, 'src', 'views', 'projectDashboardPanel.ts'), 'utf8');
const studioPanel = readFileSync(path.join(ROOT, 'src', 'views', 'websiteStudioPanel.ts'), 'utf8');
const studioScript = readFileSync(path.join(ROOT, 'media', 'websiteStudio.js'), 'utf8');

describe('website delivery view', () => {
  it('grades every framework against the primary platform and keeps an incompatible one visible with its reason', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.platforms = config.platforms.map(platform => ({ ...platform, primary: platform.id === 'shopify' }));
    const view = buildWebsiteDeliveryView({ config, preserveExisting: false }, undefined, false);
    const hugo = view.frameworks.find(spec => spec.id === 'hugo')!;
    // Removing the option would leave somebody wondering where Hugo went.
    expect(hugo.compatibility).toBe('unsupported');
    expect(hugo.reason).toContain('Liquid');
    expect(view.gradedAgainst).toBe('Shopify');
    expect(view.canSetUpStack).toBe(false);
    expect(view.stack).toBeUndefined();
    expect(view.stackSummary).toBeUndefined();
  });

  it('says there is nothing to compare against rather than showing a reassuring blank, and states readiness per environment', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    const view = buildWebsiteDeliveryView({ config, preserveExisting: false }, undefined, true);
    expect(view.drift.compared).toBe(false);
    expect(view.drift.summary).toContain('No Delivery pipeline is configured');
    expect(view.hostingEnvironments.map(environment => environment.id)).toEqual(['develop', 'staging', 'production']);
    for (const environment of view.hostingEnvironments) {
      expect(['ready', 'needs-setup', 'blocked']).toContain(environment.readiness.status);
    }
    expect(view.hostingEnvironments.find(environment => environment.id === 'production')!.promotionProtected).toBe(true);
    expect(view.platforms.every(platform => platform.description.length > 0)).toBe(true);
  });

  it('summarises the chosen stack as the commands it implies', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.stack = { frameworkId: 'astro', platformId: 'cloudflare-pages', packageManager: 'npm', decidedAt: '2026-09-09T00:00:00.000Z' };
    const view = buildWebsiteDeliveryView({ config, preserveExisting: true, notice: 'newer build' }, undefined, true);
    expect(view.readOnly).toBe(true);
    expect(view.notice).toBe('newer build');
    expect(view.frameworks.find(spec => spec.id === 'astro')!.selected).toBe(true);
    expect(view.stackSummary?.output).toBe('dist');
    expect(view.stackSummary?.build).toContain('build');
  });
});

describe('website delivery messages', () => {
  it('admits the three arrays, a catalog framework id and the setup request, and nothing wider', () => {
    expect(isProjectDashboardMessage({ type: 'saveWebsiteDelivery', payload: { platforms: [], hostingEnvironments: [], automations: [] } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'saveWebsiteDelivery', payload: { platforms: [], hostingEnvironments: [], automations: [], pages: [] } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'saveWebsiteDelivery', payload: { platforms: 'x', hostingEnvironments: [], automations: [] } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'saveWebsiteDelivery', payload: { platforms: [], hostingEnvironments: [{}, {}, {}, {}], automations: [] } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'selectWebsiteFramework', payload: { frameworkId: 'astro' } })).toBe(true);
    expect(isProjectDashboardMessage({ type: 'selectWebsiteFramework', payload: { frameworkId: 'jekyll' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'selectWebsiteFramework', payload: { frameworkId: 'npm install evil' } })).toBe(false);
    expect(isProjectDashboardMessage({ type: 'planWebsiteStackSetup' })).toBe(true);
  });

  it('posts a catalog id and the three arrays from the cards, and nothing that names a file or a command', () => {
    const wiring = dashboardScript.slice(dashboardScript.indexOf("if (action === 'website-framework')"), dashboardScript.indexOf("if (action === 'documents-seed')"));
    expect(wiring).toContain("vscode.postMessage({ type: 'selectWebsiteFramework', payload: { frameworkId: payload } })");
    expect(wiring).toContain("vscode.postMessage({ type: 'planWebsiteStackSetup' })");
    expect(wiring).toContain("vscode.postMessage({ type: 'saveWebsiteDelivery', payload: collectWebsiteDelivery() })");
    const collector = dashboardScript.slice(dashboardScript.indexOf('function collectWebsiteDelivery()'), dashboardScript.indexOf("// Develop's hosting mode changes its access policy"));
    expect(collector).toContain("querySelectorAll('[data-wd-platform]')");
    expect(collector).toContain("querySelectorAll('[data-wd-environment]')");
    expect(collector).toContain("querySelectorAll('[data-wd-automation]')");
    expect(collector).toMatch(/return \{ platforms, hostingEnvironments, automations \};/);
    expect(collector).not.toMatch(/command|frameworkId|stack/);
  });

  it('renders the delivery half inside the Delivery page, after the pipeline', () => {
    const delivery = dashboardScript.slice(dashboardScript.indexOf('function renderDelivery(snapshot)'), dashboardScript.indexOf('// ── Project Director page'));
    expect(delivery.indexOf('${renderStagePipeline(snapshot)}')).toBeLessThan(delivery.indexOf('${renderWebsiteDelivery(snapshot)}'));
    const render = dashboardScript.slice(dashboardScript.indexOf('function renderWebsiteDelivery(snapshot)'), dashboardScript.indexOf('function collectWebsiteDelivery()'));
    expect(render).toMatch(/if \(!web\) \{\s*return '';\s*\}/);
    expect(render).toContain('Three deliberate hosting stages');
    expect(render).toContain('SecretStorage:website.staging.password');
    expect(render).toContain('data-action="website-delivery-save"');
    expect(render).toContain('Automatic setup is off');
  });
});

describe('one file, two writers, neither undoes the other', () => {
  it('the Dashboard re-reads the plan from disk and saves only its three arrays', () => {
    const save = dashboardPanel.slice(dashboardPanel.indexOf('private async handleSaveWebsiteDelivery('), dashboardPanel.indexOf('private async handleSelectWebsiteFramework('));
    expect(save).toContain('const current = manager.read();');
    expect(save).toContain('if (current.preserveExisting) {');
    expect(save).toMatch(/\.\.\.current\.config,\s*platforms: payload\.platforms,\s*hostingEnvironments: payload\.hostingEnvironments,\s*automations: payload\.automations,/);
    expect(save).not.toContain('this.snapshot');
  });

  it('the Studio re-reads delivery from disk on save, so its form cannot carry or clear it', () => {
    const start = studioPanel.indexOf("case 'saveConfig': {");
    const save = studioPanel.slice(start, studioPanel.indexOf("case 'savePageContent':", start));
    expect(save).toContain('const onDisk = this.manager.read().config;');
    expect(save).toContain('payload.platforms = structuredClone(onDisk.platforms);');
    expect(save).toContain('payload.hostingEnvironments = structuredClone(onDisk.hostingEnvironments);');
    expect(save).toContain('payload.automations = structuredClone(onDisk.automations);');
    expect(save).toContain('payload.stack = { ...onDisk.stack };');
    const collect = studioScript.slice(studioScript.indexOf('function collectConfig()'), studioScript.indexOf('// ── Static wiring'));
    expect(collect).not.toContain('data-platform-id');
    expect(collect).not.toContain('data-environment-id');
    expect(collect).not.toContain('data-automation-id');
  });

  it('the Studio opens the Dashboard by a constant target and names no page from the webview', () => {
    expect(studioPanel).toMatch(/case 'openDeliveryPage':\s*(?:\/\/[^\n]*\s*)*await vscode\.commands\.executeCommand\('atlasmind\.openProjectDashboard', 'delivery'\)/);
    expect(studioScript).toContain("vscode.postMessage({ type: 'openDeliveryPage' })");
    expect(studioScript).not.toContain("type: 'selectFramework'");
    expect(studioScript).not.toContain("type: 'compareDelivery'");
  });
});
