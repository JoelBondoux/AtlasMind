import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { leadingDoctypeEnd } from '../../src/core/htmlSourceMap.ts';
import { UI_SURFACE_RULES } from '../../src/core/uiSurfaceScan.ts';
import {
  assessStaticSurfaceReferences,
  buildStaticSurfaceCsp,
  buildStaticSurfaceDocument,
  classifyUiSurfaceRender,
  describeDevServerConfirmation,
  describeUiSurfaceRender,
  deriveUiSurfaceRoute,
  devServerAddress,
  DEV_SERVER_SCRIPT_NAMES,
  findDevServerUrl,
  planDevServerRender,
  uiSurfaceRenderId,
  unclaimedScanRules,
  UI_SURFACE_RENDER_FALLBACK,
  UI_SURFACE_RENDER_RULES,
} from '../../src/core/uiSurfaceRender.ts';

/**
 * What a discovered surface can honestly be rendered as.
 *
 * The properties pinned here are the ones whose failure would show somebody
 * something that is not their surface while saying it is: a scan rule with no
 * render rule, a policy that lets a script run, a route invented for a
 * component, an address that is not on this machine.
 */

describe('render rule table', () => {
  it('claims every scan rule, so a surface the scan finds always has a decided mode', () => {
    expect(unclaimedScanRules()).toEqual([]);
    for (const rule of UI_SURFACE_RULES) {
      const decision = classifyUiSurfaceRender({ ruleId: rule.id, path: `x/file${rule.id === 'html-page' ? '.html' : '.tsx'}` });
      expect(decision.ruleId, rule.id).not.toBe(UI_SURFACE_RENDER_FALLBACK.id);
    }
  });

  it('maps each kind to the mode the facts allow', () => {
    expect(classifyUiSurfaceRender({ ruleId: 'html-page', path: 'site/index.html' }).mode).toBe('static-file');
    expect(classifyUiSurfaceRender({ ruleId: 'react-component', path: 'src/App.tsx' }).mode).toBe('dev-server');
    expect(classifyUiSurfaceRender({ ruleId: 'single-file-component', path: 'src/App.vue' }).mode).toBe('dev-server');
    expect(classifyUiSurfaceRender({ ruleId: 'stylesheet-tokens', path: 'src/theme.css' }).mode).toBe('not-renderable');
    expect(classifyUiSurfaceRender({ ruleId: 'vscode-webview-script', path: 'media/panel.js' }).mode).toBe('not-renderable');
    expect(classifyUiSurfaceRender({ path: 'Assets/UI/Hud.uxml' }).mode).toBe('engine-only');
    expect(classifyUiSurfaceRender({ path: 'ui/hud.tscn' }).mode).toBe('engine-only');
    expect(classifyUiSurfaceRender({ path: 'ui/hud.tscn' }).reason).toMatch(/Cannot render in the editor/);
  });

  it('is total: anything unrecognised is not renderable, with a reason, never guessed', () => {
    fc.assert(fc.property(fc.option(fc.string(), { nil: undefined }), fc.string(), (ruleId, path) => {
      const decision = classifyUiSurfaceRender(ruleId === undefined ? { path } : { ruleId, path });
      expect(decision.reason.length).toBeGreaterThan(20);
      const known = [...UI_SURFACE_RENDER_RULES, UI_SURFACE_RENDER_FALLBACK].map(rule => rule.id);
      expect(known).toContain(decision.ruleId);
    }));
    expect(classifyUiSurfaceRender({ ruleId: 'made-up', path: 'page.html' }).ruleId).toBe(UI_SURFACE_RENDER_FALLBACK.id);
  });

  it('gives every surface a stable, bounded, opaque id', () => {
    expect(uiSurfaceRenderId('src/App.tsx')).toBe(uiSurfaceRenderId('src/App.tsx'));
    expect(uiSurfaceRenderId('src/App.tsx')).not.toBe(uiSurfaceRenderId('src/app.tsx'));
    fc.assert(fc.property(fc.string(), path => {
      expect(uiSurfaceRenderId(path)).toMatch(/^uis-[0-9a-f]{16}$/);
    }));
  });
});

describe('static render policy', () => {
  const cspSource = 'https://file+.vscode-resource.vscode-cdn.net';

  it('allows no script, no connection, no frame and no form, and loads only from the resource origin', () => {
    const csp = buildStaticSurfaceCsp(cspSource);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toMatch(/https?:\s|https?:;|\*/);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp.match(/'unsafe-inline'/g)?.length).toBe(1);
    expect(csp).toMatch(/style-src [^;]*'unsafe-inline'/);
  });

  it('cannot be widened by a hostile source string', () => {
    const csp = buildStaticSurfaceCsp("x; script-src *");
    expect(csp).not.toContain('script-src *');
    expect(csp).toContain("script-src 'none'");
  });

  it('puts the policy and base first, after the doctype, and leaves the rest of the file alone', () => {
    const html = '<!DOCTYPE html>\n<html lang="en"><head><title>Hi</title></head><body><p>x</p></body></html>';
    const document = buildStaticSurfaceDocument({ html, baseHref: `${cspSource}/site`, cspSource });
    expect(document.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(document).toContain(`<base href="${cspSource}/site/">`);
    expect(document.endsWith('\n<html lang="en"><head><title>Hi</title></head><body><p>x</p></body></html>')).toBe(true);
  });

  it('cannot be swallowed by a comment opened before the file\'s own head', () => {
    const html = '<!-- <head> --><html><head><script>alert(1)</script></head></html>';
    const document = buildStaticSurfaceDocument({ html, baseHref: 'https://r/', cspSource });
    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf('<!--'));
  });

  it('removes the file\'s own base and refresh, which would point elsewhere or navigate away', () => {
    const html = '<html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"></head></html>';
    const document = buildStaticSurfaceDocument({ html, baseHref: 'https://r/', cspSource });
    expect(document).not.toContain('evil.example');
    expect(document.match(/<base\b/g)?.length).toBe(1);
  });

  it('stays linear on a page that opens with the input that made the old doctype regex backtrack', () => {
    const html = `<!--${'--><!--'.repeat(50_000)}<p>x</p>`;
    const started = Date.now();
    const document = buildStaticSurfaceDocument({ html, baseHref: 'https://r/', cspSource });
    expect(Date.now() - started).toBeLessThan(500);
    expect(document.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
  });

  it('always leads with the policy, whatever the file holds', () => {
    fc.assert(fc.property(fc.string(), html => {
      const document = buildStaticSurfaceDocument({ html, baseHref: 'https://r/', cspSource });
      const withoutDoctype = document.slice(leadingDoctypeEnd(document) ?? 0);
      expect(withoutDoctype.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    }));
  });

  it('counts what will not run and will not load, and nothing that will', () => {
    const report = assessStaticSurfaceReferences(`
      <link rel="stylesheet" href="styles.css">
      <link rel="stylesheet" href="../shared/site.css">
      <img src="/logo.png"><img src="https://cdn.example/a.png"><img src="//cdn.example/b.png">
      <img src="img/ok.png"><img src="./img/../img/ok.png"><img src="data:image/png;base64,AA==">
      <script src="app.js"></script><script>inline()</script>
      <iframe src="https://x.example"></iframe>
      <a href="https://example.com">a link is not a resource</a>`);
    expect(report).toEqual({ scripts: 2, remote: 2, rootAbsolute: 1, outsideFolder: 1, embedded: 1 });
  });
});

describe('dev server plan', () => {
  const lockless = new Set<string>();

  it('refuses without a readable package.json, and never guesses a command', () => {
    expect(planDevServerRender({ packageJson: undefined, lockfiles: lockless, surfacePath: 'src/App.tsx' }).status).toBe('refused');
    expect(planDevServerRender({ packageJson: [], lockfiles: lockless, surfacePath: 'src/App.tsx' }).status).toBe('refused');
  });

  it('refuses a script it cannot recognise as a dev server, even one called dev', () => {
    const plan = planDevServerRender({ packageJson: { scripts: { dev: 'node scripts/deploy.js', start: 'vite build' } }, lockfiles: lockless, surfacePath: 'src/App.tsx' });
    expect(plan.status).toBe('refused');
    expect(plan.status === 'refused' && plan.reason).toMatch(/start the server yourself/);
  });

  it('picks the first recognised script in the declared order, with the package manager the lockfile names', () => {
    const plan = planDevServerRender({
      packageJson: { scripts: { start: 'next start', dev: 'next dev --turbo' }, dependencies: { next: '15' } },
      lockfiles: new Set(['pnpm-lock.yaml']),
      surfacePath: 'src/app/about/page.tsx',
    });
    expect(plan).toMatchObject({ status: 'ready', scriptName: 'dev', toolId: 'next', packageManager: 'pnpm', command: 'pnpm', args: ['run', 'dev'] });
    expect(plan.status === 'ready' && plan.route).toEqual({ status: 'derived', route: '/about', ruleId: 'next-app-router' });
  });

  it('defaults to npm with no lockfile, and says so', () => {
    const plan = planDevServerRender({ packageJson: { scripts: { dev: 'vite --port 3000' } }, lockfiles: lockless, surfacePath: 'src/App.tsx' });
    expect(plan).toMatchObject({ status: 'ready', command: 'npm', args: ['run', 'dev'], toolId: 'vite' });
    expect(plan.status === 'ready' && plan.packageManagerReason).toMatch(/No lockfile/);
  });

  it('builds an argv from constants only — whatever package.json says', () => {
    fc.assert(fc.property(fc.dictionary(fc.string(), fc.string()), fc.string(), (scripts, surfacePath) => {
      const plan = planDevServerRender({ packageJson: { scripts }, lockfiles: lockless, surfacePath });
      if (plan.status === 'ready') {
        expect(['npm', 'pnpm', 'yarn', 'bun']).toContain(plan.command);
        expect(plan.args[0]).toBe('run');
        expect(DEV_SERVER_SCRIPT_NAMES).toContain(plan.args[1]);
        expect(plan.args).toHaveLength(2);
      }
    }));
  });

  it('strips control characters from the script body it shows', () => {
    const plan = planDevServerRender({ packageJson: { scripts: { dev: 'vite --open\u0007\u001b[31m' } }, lockfiles: lockless, surfacePath: 'a.tsx' });
    expect(plan.status).toBe('ready');
    expect(plan.status === 'ready' ? plan.scriptBody : '').not.toMatch(/[\u0000-\u001f]/);
  });

  it('shows the exact argv and the script body in the confirmation', () => {
    const plan = planDevServerRender({ packageJson: { scripts: { dev: 'vite' } }, lockfiles: lockless, surfacePath: 'src/components/Button.tsx' });
    if (plan.status !== 'ready') { throw new Error('expected a plan'); }
    const text = describeDevServerConfirmation(plan, ['/usr/bin/node', '/npm-cli.js', 'run', 'dev'], '/work');
    expect(text.split('\n')[0]).toBe('/usr/bin/node /npm-cli.js run dev');
    expect(text).toContain('no shell');
    expect(text).toContain('    vite');
    expect(text).toContain('Route not determined');
    expect(text).toContain('keeps running');
  });
});

describe('routes', () => {
  const next = new Set(['next']);

  it('derives a route only under a framework the project declares', () => {
    expect(deriveUiSurfaceRoute('pages/about.tsx', next)).toEqual({ status: 'derived', route: '/about', ruleId: 'next-pages-router' });
    expect(deriveUiSurfaceRoute('pages/about.tsx', new Set())).toMatchObject({ status: 'undetermined' });
    expect(deriveUiSurfaceRoute('src/pages/index.tsx', next)).toMatchObject({ route: '/' });
    expect(deriveUiSurfaceRoute('app/(marketing)/pricing/page.tsx', next)).toMatchObject({ route: '/pricing' });
    expect(deriveUiSurfaceRoute('app/page.tsx', next)).toMatchObject({ route: '/' });
    expect(deriveUiSurfaceRoute('src/routes/blog/+page.svelte', new Set(['@sveltejs/kit']))).toMatchObject({ route: '/blog', ruleId: 'sveltekit-routes' });
    expect(deriveUiSurfaceRoute('pages/team/index.vue', new Set(['nuxt']))).toMatchObject({ route: '/team', ruleId: 'nuxt-pages' });
  });

  it('refuses to invent a value for a dynamic segment, a slot, an API route or a framework file', () => {
    expect(deriveUiSurfaceRoute('pages/blog/[slug].tsx', next)).toMatchObject({ status: 'undetermined', ruleId: 'next-pages-router' });
    expect(deriveUiSurfaceRoute('app/@modal/page.tsx', next)).toMatchObject({ status: 'undetermined' });
    expect(deriveUiSurfaceRoute('pages/api/hello.tsx', next)).toMatchObject({ status: 'undetermined' });
    expect(deriveUiSurfaceRoute('pages/_app.tsx', next)).toMatchObject({ status: 'undetermined' });
  });

  it('says a component outside a routes folder has no route, rather than guessing one', () => {
    const route = deriveUiSurfaceRoute('src/components/Button.tsx', next);
    expect(route.status).toBe('undetermined');
    expect(route.status === 'undetermined' && route.reason).toMatch(/cannot be worked out/);
    expect(devServerAddress('http://localhost:5173', route)).toBe('http://localhost:5173/');
  });
});

describe('dev server address', () => {
  it('reads the address the server printed, through colour codes', () => {
    expect(findDevServerUrl('  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m\n')).toBe('http://localhost:5173');
    expect(findDevServerUrl('ready - started server on 0.0.0.0:3000, url: http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
  });

  it('accepts the loopback only, and never a network address', () => {
    expect(findDevServerUrl('Network: http://192.168.1.4:5173/')).toBeUndefined();
    expect(findDevServerUrl('see http://localhost.evil.example:80/')).toBeUndefined();
    expect(findDevServerUrl('http://localhost:99999/')).toBeUndefined();
    fc.assert(fc.property(fc.string(), text => {
      const found = findDevServerUrl(text);
      if (found) {
        expect(found).toMatch(/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/);
      }
    }));
  });
});

describe('what is on screen', () => {
  it('names the real file, its time and what did not load', () => {
    const text = describeUiSurfaceRender({
      kind: 'static-file', path: 'site/index.html', modifiedAt: '2026-10-08T10:00:00.000Z',
      report: { scripts: 2, remote: 1, rootAbsolute: 0, outsideFolder: 1, embedded: 0 },
    });
    expect(text).toContain('Real file at site/index.html, as of 2026-10-08T10:00:00.000Z');
    expect(text).toContain('2 scripts did not run');
    expect(text).toContain('1 reference outside site/ not loaded');
  });

  it('never calls an app root the component', () => {
    const text = describeUiSurfaceRender({
      kind: 'dev-server', path: 'src/components/Button.tsx', address: 'http://localhost:5173/', scriptName: 'dev',
      route: { status: 'undetermined', reason: 'no route.' },
    });
    expect(text).toContain("the app's root, not src/components/Button.tsx");
  });

  it('calls a draft a draft', () => {
    expect(describeUiSurfaceRender({ kind: 'draft' })).toMatch(/no project file/);
    expect(describeUiSurfaceRender({ kind: 'missing', path: 'a.html' })).toMatch(/nothing is rendered/);
    expect(describeUiSurfaceRender({ kind: 'not-renderable', path: 'a.css', reason: 'why.' })).toBe('Not renderable here: why.');
  });
});
