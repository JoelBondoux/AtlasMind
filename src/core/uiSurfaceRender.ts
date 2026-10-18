/**
 * What a discovered UI surface can honestly be rendered as, decided before
 * anything renders.
 *
 * The Studio could find a project's UI files and pick one up, and then showed
 * you its own draft of it. A draft is useful and it is not the surface: a
 * picked-up `Checkout.tsx` previewed as six grey boxes the Studio drew tells you
 * nothing about what the component looks like today. So this module answers the
 * question the preview never asked — *can the real thing be shown here, and
 * how?* — and most of it is about refusing to answer it more generously than the
 * facts allow.
 *
 * Six rules.
 *
 * **The mode comes from a declared rule, never from a guess.** Every scan rule
 * maps to exactly one render rule (asserted by test, so a scan rule added later
 * without a render rule fails the day it lands), and every decision names the
 * rule that made it. A static HTML file renders as itself; a framework component
 * renders only inside the application that mounts it; a webview script and a
 * token stylesheet do not render on their own at all; an engine file renders
 * only in its engine.
 *
 * **A static file is shown as itself, with nothing of it allowed to act.** The
 * document is the file's own bytes with two elements put in front of them — a
 * Content-Security-Policy and a `<base>` — and nothing else changed. They go
 * *first*, before the doctype's content and before any `<head>` the file has,
 * because a tag inserted after the file's own `<head>` can be swallowed by a
 * comment that opens before it; placed first, the parser files them into the
 * head it creates and nothing later can undo them. The policy allows styles,
 * images, fonts and media from the surface's own folder and nothing from
 * anywhere else, and no script at all — and the host renders it in a webview
 * with scripts disabled as well, so the policy is the second lock rather than
 * the only one.
 *
 * **What will be missing is said, not discovered.** A page whose stylesheet sits
 * one folder up renders unstyled, and somebody looking at it would reasonably
 * conclude the page is broken. `assessStaticSurfaceReferences` counts the scripts
 * that will not run and the references that will not load — remote, root-
 * absolute, or outside the folder — so the label can say so. It is a report,
 * never the enforcement: the policy and the resource roots enforce, and a
 * reference this misses still does not load.
 *
 * **A component is rendered by the project's own dev server or not at all.**
 * AtlasMind does not compile, bundle or mount somebody's component — a render it
 * assembled would be a different page wearing the component's name. The dev
 * command is chosen by `planDevServerRender` from a declared table (script name
 * in a fixed order, body recognised as a known dev server, package manager from
 * the lockfile), never composed and never model-generated; anything else is a
 * refusal that names what was looked for. The argv is constant apart from the
 * script name, which itself comes from the constant list.
 *
 * **A route is derived only where the framework makes it verifiable.** File-
 * system routing (Next.js pages and app routers, SvelteKit, Nuxt) turns a path
 * into a URL by a published convention, and only when the project declares that
 * framework in `package.json`. A dynamic segment has no value nobody declared,
 * and a component outside a routes folder renders wherever something mounts it —
 * both are `undetermined`, said in those words, and the server's root is shown
 * labelled as the root rather than as the component.
 *
 * **The address is the one the server printed, on the loopback only.** The
 * tool's default port is a guess; the line the server writes when it is ready is
 * a fact. `findDevServerUrl` strips terminal colour codes (Vite bolds the port)
 * and accepts `localhost`, `127.0.0.1` and `[::1]` and nothing else, so a server
 * that prints a network address does not get one opened.
 *
 * The statement of what is on screen — `describeUiSurfaceRender` — is composed
 * here so no surface can restate it more reassuringly. Pure; the host reads,
 * watches, spawns and shows.
 */

import { createHash } from 'node:crypto';
import { leadingDoctypeEnd } from './htmlSourceMap.js';
import { UI_SURFACE_RULES } from './uiSurfaceScan.js';

// ── The render rule table ─────────────────────────────────────────

export type UiSurfaceRenderMode = 'static-file' | 'dev-server' | 'engine-only' | 'not-renderable';

export interface UiSurfaceRenderRule {
  id: string;
  mode: UiSurfaceRenderMode;
  /** What the rule matches, in words. */
  description: string;
  /** Why this mode, for the person looking at the card. */
  reason: string;
  /** Scan rule ids this rule claims. */
  scanRuleIds: readonly string[];
  /** File extensions this rule claims, lower-case with the dot. */
  extensions: readonly string[];
}

/**
 * Evaluated in order; the first rule that claims a surface decides it.
 *
 * `engine-native` claims by extension rather than by scan rule because the scan
 * deliberately does not look for engine files — they arrive as emitted surfaces,
 * whose launch plans already exist — and an engine file is no less engine-only
 * for having been reached another way.
 */
export const UI_SURFACE_RENDER_RULES: readonly UiSurfaceRenderRule[] = [
  {
    id: 'static-html',
    mode: 'static-file',
    description: 'A .html or .htm page.',
    reason: 'Rendered as the file itself, in a panel with scripts disabled, loading only what sits in the file\'s own folder.',
    scanRuleIds: ['html-page'],
    extensions: ['.html', '.htm'],
  },
  {
    id: 'framework-component',
    mode: 'dev-server',
    description: 'A React (.tsx/.jsx), Vue or Svelte component.',
    reason: 'A component renders only inside the application that mounts it, so it needs the project\'s own dev server. AtlasMind does not compile or mount it itself — a render it assembled would be a different page.',
    scanRuleIds: ['react-component', 'single-file-component'],
    extensions: ['.tsx', '.jsx', '.vue', '.svelte'],
  },
  {
    id: 'token-stylesheet',
    mode: 'not-renderable',
    description: 'A stylesheet holding design tokens.',
    reason: 'A stylesheet has no markup of its own to show. Read it into a brand on the Brands view instead.',
    scanRuleIds: ['stylesheet-tokens'],
    extensions: ['.css'],
  },
  {
    id: 'vscode-webview',
    mode: 'not-renderable',
    description: 'A VS Code webview script under media/.',
    reason: 'A webview script builds its page inside the extension that owns it, through acquireVsCodeApi, with data only that extension supplies. Run the extension (F5) to see it; a page rendered without its host would be a different page.',
    scanRuleIds: ['vscode-webview-script'],
    extensions: [],
  },
  {
    id: 'engine-native',
    mode: 'engine-only',
    description: 'A Unity UXML/USS, Godot scene or Unreal asset.',
    reason: 'Cannot render in the editor: it is drawn only by its engine. Use Launch on the Handoff view, which opens it there.',
    scanRuleIds: [],
    extensions: ['.uxml', '.uss', '.tscn', '.tres', '.uasset', '.umap'],
  },
];

/** What a surface no rule claims gets. Unknown is not renderable, never "probably HTML". */
export const UI_SURFACE_RENDER_FALLBACK: UiSurfaceRenderRule = {
  id: 'no-render-rule',
  mode: 'not-renderable',
  description: 'Anything no rule above claims.',
  reason: 'No declared render rule covers this file, so nothing is shown rather than something that might not be it.',
  scanRuleIds: [],
  extensions: [],
};

export interface UiSurfaceRenderDecision {
  mode: UiSurfaceRenderMode;
  ruleId: string;
  reason: string;
}

/** Which render rule claims a surface. Total: every input gets a decision with a reason. */
export function classifyUiSurfaceRender(input: { ruleId?: string; path: string }): UiSurfaceRenderDecision {
  const name = input.path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : '';
  const rule = UI_SURFACE_RENDER_RULES.find(candidate => input.ruleId !== undefined && candidate.scanRuleIds.includes(input.ruleId))
    ?? UI_SURFACE_RENDER_RULES.find(candidate => input.ruleId === undefined && extension !== '' && candidate.extensions.includes(extension))
    ?? UI_SURFACE_RENDER_FALLBACK;
  return { mode: rule.mode, ruleId: rule.id, reason: rule.reason };
}

/** The scan rules no render rule claims. Empty by construction; exported so a test can say so. */
export function unclaimedScanRules(): string[] {
  return UI_SURFACE_RULES
    .map(rule => rule.id)
    .filter(id => !UI_SURFACE_RENDER_RULES.some(rule => rule.scanRuleIds.includes(id)));
}

/**
 * The id a webview uses for a surface. Derived from the path, so it is stable
 * across renders and carries nothing the host has to trust: the host recomputes
 * every id over a fresh scan and accepts only one that matches.
 */
export function uiSurfaceRenderId(relativePath: string): string {
  return `uis-${createHash('sha256').update(relativePath, 'utf8').digest('hex').slice(0, 16)}`;
}

// ── Static surfaces ───────────────────────────────────────────────

/** The largest page rendered. A bigger one is refused with the reason rather than cut. */
export const STATIC_SURFACE_MAX_BYTES = 2 * 1024 * 1024;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The policy a rendered static surface runs under.
 *
 * No script source at all, no connections, no frames, no form submission; the
 * page's own styles may be inline (a static page's `style=""` attributes are its
 * design), and every file it loads must come from the webview resource origin,
 * which the host limits to the surface's folder.
 */
export function buildStaticSurfaceCsp(cspSource: string): string {
  const source = cspSource.replace(/[;\s"]/g, '');
  return [
    "default-src 'none'",
    `img-src ${source} data:`,
    `style-src ${source} 'unsafe-inline'`,
    `font-src ${source} data:`,
    `media-src ${source}`,
    "script-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    `base-uri ${source}`,
  ].join('; ');
}

/**
 * The file's own markup with a policy and a base put in front of it.
 *
 * The file's own `<base>` and `<meta http-equiv="refresh">` are removed — the
 * first would point relative URLs somewhere other than the folder the resource
 * roots allow, the second would navigate away from the thing being shown — and
 * nothing else is touched. A policy the file declares itself is left in place:
 * two policies intersect, so it can only make the render stricter.
 */
export function buildStaticSurfaceDocument(input: { html: string; baseHref: string; cspSource: string }): string {
  const baseHref = input.baseHref.endsWith('/') ? input.baseHref : `${input.baseHref}/`;
  const head = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(buildStaticSurfaceCsp(input.cspSource))}"><base href="${escapeAttribute(baseHref)}">`;
  const body = input.html
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
  // After a doctype, never before it: content ahead of the doctype switches
  // the page into quirks mode and the render would no longer be the page.
  const doctypeEnd = leadingDoctypeEnd(body);
  return doctypeEnd !== undefined
    ? `${body.slice(0, doctypeEnd)}${head}${body.slice(doctypeEnd)}`
    : `${head}${body}`;
}

export interface StaticSurfaceReferenceReport {
  /** `<script>` elements, none of which run. */
  scripts: number;
  /** http(s), protocol-relative and other-scheme resources, which do not load. */
  remote: number;
  /** `/…` references, which resolve against the webview rather than the project. */
  rootAbsolute: number;
  /** `../…` references that climb out of the surface's folder. */
  outsideFolder: number;
  /** Frames, objects and embeds, which are blocked. */
  embedded: number;
}

const RESOURCE_TAG = /<(img|script|link|source|video|audio|track|iframe|embed|object|input)\b[^>]*>/gi;
const RESOURCE_ATTRIBUTE = /\s(src|href|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/**
 * Count what will not run and what will not load.
 *
 * A report for the label, never the enforcement. Anchors are not resources and
 * are not counted; a resource reference this pattern does not recognise still
 * fails to load, it is only not mentioned.
 */
export function assessStaticSurfaceReferences(html: string): StaticSurfaceReferenceReport {
  const report: StaticSurfaceReferenceReport = { scripts: 0, remote: 0, rootAbsolute: 0, outsideFolder: 0, embedded: 0 };
  for (const tag of html.matchAll(RESOURCE_TAG)) {
    const name = (tag[1] ?? '').toLowerCase();
    if (name === 'script') {
      report.scripts += 1;
    }
    if (name === 'iframe' || name === 'embed' || name === 'object') {
      report.embedded += 1;
      continue;
    }
    for (const attribute of tag[0].matchAll(RESOURCE_ATTRIBUTE)) {
      const reference = (attribute[2] ?? attribute[3] ?? attribute[4] ?? '').trim();
      const kind = classifyReference(reference);
      if (kind) {
        report[kind] += 1;
      }
    }
  }
  return report;
}

function classifyReference(reference: string): 'remote' | 'rootAbsolute' | 'outsideFolder' | undefined {
  if (reference === '' || reference.startsWith('#') || /^data:/i.test(reference)) {
    return undefined;
  }
  if (reference.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(reference)) {
    return 'remote';
  }
  if (reference.startsWith('/')) {
    return 'rootAbsolute';
  }
  let depth = 0;
  for (const segment of reference.split(/[?#]/)[0]!.split('/')) {
    if (segment === '..') {
      depth -= 1;
      if (depth < 0) {
        return 'outsideFolder';
      }
    } else if (segment !== '' && segment !== '.') {
      depth += 1;
    }
  }
  return undefined;
}

// ── Dev-server surfaces ───────────────────────────────────────────

export interface DevServerTool {
  id: string;
  label: string;
  /** The executable token in a script body. */
  binary: string;
  /** Subcommands that start a dev server. */
  subcommands: readonly string[];
  /** Whether the binary alone (or followed only by flags) starts one. */
  bare: boolean;
}

/**
 * Dev servers recognised in a script body. Deliberately short: a script the
 * table does not recognise is refused, because running a script on the strength
 * of its *name* would run whatever somebody called `dev`.
 */
export const DEV_SERVER_TOOLS: readonly DevServerTool[] = [
  { id: 'vite', label: 'Vite', binary: 'vite', subcommands: ['dev', 'serve'], bare: true },
  { id: 'next', label: 'Next.js', binary: 'next', subcommands: ['dev'], bare: false },
  { id: 'nuxt', label: 'Nuxt', binary: 'nuxt', subcommands: ['dev'], bare: false },
  { id: 'nuxi', label: 'Nuxt', binary: 'nuxi', subcommands: ['dev'], bare: false },
  { id: 'astro', label: 'Astro', binary: 'astro', subcommands: ['dev'], bare: false },
  { id: 'svelte-kit', label: 'SvelteKit', binary: 'svelte-kit', subcommands: ['dev'], bare: false },
  { id: 'react-scripts', label: 'Create React App', binary: 'react-scripts', subcommands: ['start'], bare: false },
  { id: 'vue-cli', label: 'Vue CLI', binary: 'vue-cli-service', subcommands: ['serve'], bare: false },
  { id: 'angular', label: 'Angular CLI', binary: 'ng', subcommands: ['serve'], bare: false },
  { id: 'webpack', label: 'webpack', binary: 'webpack', subcommands: ['serve'], bare: false },
  { id: 'webpack-dev-server', label: 'webpack-dev-server', binary: 'webpack-dev-server', subcommands: [], bare: true },
];

/** Script names looked at, in preference order. */
export const DEV_SERVER_SCRIPT_NAMES: readonly string[] = ['dev', 'start', 'serve', 'develop'];

export interface DevServerPackageManager {
  id: string;
  command: string;
  lockfile: string;
}

/** The first whose lockfile exists decides. No lockfile is npm, and the plan says so. */
export const DEV_SERVER_PACKAGE_MANAGERS: readonly DevServerPackageManager[] = [
  { id: 'pnpm', command: 'pnpm', lockfile: 'pnpm-lock.yaml' },
  { id: 'yarn', command: 'yarn', lockfile: 'yarn.lock' },
  { id: 'bun', command: 'bun', lockfile: 'bun.lockb' },
  { id: 'npm', command: 'npm', lockfile: 'package-lock.json' },
];

export interface UiSurfaceRouteRule {
  id: string;
  /** The dependency that makes the convention apply. */
  dependency: string;
  description: string;
}

/** File-system routing conventions, each applying only when the project declares the framework. */
export const UI_SURFACE_ROUTE_RULES: readonly UiSurfaceRouteRule[] = [
  { id: 'next-pages-router', dependency: 'next', description: 'pages/… (or src/pages/…) under Next.js: the file path is the route, index is "/", and _app, _document and api/ are not pages.' },
  { id: 'next-app-router', dependency: 'next', description: 'app/…/page.tsx under Next.js: the folder path is the route; (group) folders are dropped.' },
  { id: 'sveltekit-routes', dependency: '@sveltejs/kit', description: 'src/routes/…/+page.svelte under SvelteKit: the folder path is the route; (group) folders are dropped.' },
  { id: 'nuxt-pages', dependency: 'nuxt', description: 'pages/… (or app/pages/…) under Nuxt: the file path is the route, index is "/".' },
];

export type UiSurfaceRoute =
  | { status: 'derived'; route: string; ruleId: string }
  | { status: 'undetermined'; reason: string; ruleId?: string };

const ROUTE_PATTERNS: Readonly<Record<string, RegExp>> = {
  'next-pages-router': /^(?:src\/)?pages\/(.+)\.(?:tsx|jsx)$/i,
  'next-app-router': /^(?:src\/)?app\/(?:(.+)\/)?page\.(?:tsx|jsx)$/i,
  'sveltekit-routes': /^src\/routes\/(?:(.+)\/)?\+page\.svelte$/i,
  'nuxt-pages': /^(?:app\/)?pages\/(.+)\.vue$/i,
};

/**
 * The URL path a surface is served at, where a declared convention says so.
 *
 * Biased to `undetermined`: a wrong route opens a page that is not the
 * surface, labelled as though it were, and that is worse than opening the root
 * and saying the route could not be worked out.
 */
export function deriveUiSurfaceRoute(surfacePath: string, dependencies: ReadonlySet<string>): UiSurfaceRoute {
  for (const rule of UI_SURFACE_ROUTE_RULES) {
    const match = ROUTE_PATTERNS[rule.id]!.exec(surfacePath);
    if (!match) {
      continue;
    }
    if (!dependencies.has(rule.dependency)) {
      continue;
    }
    const raw = (match[1] ?? '').split('/').filter(Boolean);
    const groupsDropped = rule.id === 'next-app-router' || rule.id === 'sveltekit-routes';
    const segments: string[] = [];
    for (const [index, segment] of raw.entries()) {
      if (groupsDropped && /^\(.+\)$/.test(segment)) {
        continue;
      }
      if (segment.includes('[')) {
        return { status: 'undetermined', ruleId: rule.id, reason: `${surfacePath} sits under the dynamic segment "${segment}", and no value for it is declared anywhere.` };
      }
      if (segment.startsWith('@')) {
        return { status: 'undetermined', ruleId: rule.id, reason: `${surfacePath} is a parallel-route slot ("${segment}"), which is not addressable on its own.` };
      }
      if (rule.id === 'next-pages-router' && index === 0 && segment === 'api') {
        return { status: 'undetermined', ruleId: rule.id, reason: `${surfacePath} is an API route, not a page.` };
      }
      if (segment.startsWith('_')) {
        return { status: 'undetermined', ruleId: rule.id, reason: `${surfacePath} is a private or framework file ("${segment}"), not a page somebody visits.` };
      }
      segments.push(segment);
    }
    const isIndexFile = rule.id === 'next-pages-router' || rule.id === 'nuxt-pages';
    if (isIndexFile && segments.at(-1) === 'index') {
      segments.pop();
    }
    return { status: 'derived', ruleId: rule.id, route: `/${segments.map(segment => encodeURIComponent(segment)).join('/')}` };
  }
  return {
    status: 'undetermined',
    reason: `${surfacePath} is not a file-system route under a framework this project declares in package.json. A component renders wherever something mounts it, so the route to it cannot be worked out.`,
  };
}

export type DevServerPlan =
  | {
    status: 'ready';
    scriptName: string;
    /** The script as package.json declares it, control-stripped and clamped for display. */
    scriptBody: string;
    toolId: string;
    toolLabel: string;
    packageManager: string;
    packageManagerReason: string;
    command: string;
    args: string[];
    route: UiSurfaceRoute;
  }
  | { status: 'refused'; reason: string };

function displayText(value: string, limit: number): string {
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

function recognisedTool(body: string): DevServerTool | undefined {
  const tokens = body.split(/\s+|&&|\|\||;|\|/).filter(Boolean);
  for (const tool of DEV_SERVER_TOOLS) {
    for (const [index, token] of tokens.entries()) {
      if (token !== tool.binary) {
        continue;
      }
      const next = tokens[index + 1];
      if ((next === undefined || next.startsWith('-')) ? tool.bare : tool.subcommands.includes(next)) {
        return tool;
      }
    }
  }
  return undefined;
}

/**
 * How the project's own dev server would be started, or why it will not be.
 *
 * Reads `package.json` (untrusted: a workspace file) and the lockfiles present.
 * Nothing here runs anything, and the argv is constant apart from a script name
 * drawn from `DEV_SERVER_SCRIPT_NAMES`.
 */
export function planDevServerRender(input: {
  packageJson: unknown;
  lockfiles: ReadonlySet<string>;
  surfacePath: string;
}): DevServerPlan {
  if (typeof input.packageJson !== 'object' || input.packageJson === null || Array.isArray(input.packageJson)) {
    return { status: 'refused', reason: 'There is no readable package.json at the workspace root, so the project declares no dev command. AtlasMind will not guess one.' };
  }
  const manifest = input.packageJson as Record<string, unknown>;
  const scripts = typeof manifest['scripts'] === 'object' && manifest['scripts'] !== null && !Array.isArray(manifest['scripts'])
    ? manifest['scripts'] as Record<string, unknown>
    : {};
  let chosen: { name: string; body: string; tool: DevServerTool } | undefined;
  for (const name of DEV_SERVER_SCRIPT_NAMES) {
    const body = scripts[name];
    if (typeof body !== 'string') {
      continue;
    }
    const tool = recognisedTool(body);
    if (tool) {
      chosen = { name, body, tool };
      break;
    }
  }
  if (!chosen) {
    return {
      status: 'refused',
      reason: `No script named ${DEV_SERVER_SCRIPT_NAMES.join(', ')} in package.json starts a recognised dev server (${DEV_SERVER_TOOLS.map(tool => tool.label).filter((label, index, all) => all.indexOf(label) === index).join(', ')}). AtlasMind runs a script only when it can tell what it does, so start the server yourself and open it in the browser.`,
    };
  }
  const manager = DEV_SERVER_PACKAGE_MANAGERS.find(candidate => input.lockfiles.has(candidate.lockfile));
  const dependencies = new Set<string>();
  for (const field of ['dependencies', 'devDependencies']) {
    const block = manifest[field];
    if (typeof block === 'object' && block !== null && !Array.isArray(block)) {
      for (const key of Object.keys(block)) {
        dependencies.add(key);
      }
    }
  }
  return {
    status: 'ready',
    scriptName: chosen.name,
    scriptBody: displayText(chosen.body, 300),
    toolId: chosen.tool.id,
    toolLabel: chosen.tool.label,
    packageManager: manager?.id ?? 'npm',
    packageManagerReason: manager ? `${manager.lockfile} is present.` : 'No lockfile is present, so npm, the default.',
    command: manager?.command ?? 'npm',
    args: ['run', chosen.name],
    route: deriveUiSurfaceRoute(input.surfacePath, dependencies),
  };
}

/**
 * The confirmation shown before a dev server starts — the exact argv, where it
 * runs, what it will do, and that it keeps running. Composed here so the dialog
 * is what was planned, not a summary beside it.
 */
export function describeDevServerConfirmation(
  plan: Extract<DevServerPlan, { status: 'ready' }>,
  argv: readonly string[],
  workspaceRoot: string,
): string {
  return [
    argv.join(' '),
    '',
    `Runs directly, with no shell, from ${workspaceRoot}. ${plan.packageManagerReason}`,
    `${plan.packageManager} then runs the project's own "${plan.scriptName}" script, which package.json declares as:`,
    `    ${plan.scriptBody}`,
    `That script runs the way it does when you type it — it is the project's command, recognised as ${plan.toolLabel}.`,
    '',
    plan.route.status === 'derived'
      ? `The surface is served at ${plan.route.route} (rule ${plan.route.ruleId}).`
      : `Route not determined: ${plan.route.reason} The server's root will be shown, labelled as the root.`,
    'The server keeps running until you press Stop dev server or close UI Studio.',
  ].join('\n');
}

/** The local address a dev server printed, or nothing. Loopback only; colour codes ignored. */
export function findDevServerUrl(output: string): string | undefined {
  const plain = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  for (const match of plain.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?=[/\s]|$)/gi)) {
    try {
      const url = new URL(match[0]);
      const port = url.port === '' ? undefined : Number(url.port);
      if (port !== undefined && (port < 1 || port > 65_535)) {
        continue;
      }
      return `${url.protocol}//${url.host}`;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** The address to open: the printed origin, plus the derived route where there is one. */
export function devServerAddress(origin: string, route: UiSurfaceRoute): string {
  return route.status === 'derived' ? `${origin}${route.route}` : `${origin}/`;
}

// ── What is on screen ─────────────────────────────────────────────

export type UiSurfaceRenderState =
  | { kind: 'static-file'; path: string; modifiedAt: string; report: StaticSurfaceReferenceReport }
  | { kind: 'dev-server'; path: string; address: string; scriptName: string; route: UiSurfaceRoute }
  | { kind: 'not-renderable'; path: string; reason: string }
  | { kind: 'missing'; path: string }
  | { kind: 'draft' };

function folderOf(relativePath: string): string {
  const cut = relativePath.lastIndexOf('/');
  return cut > 0 ? `${relativePath.slice(0, cut)}/` : 'the workspace root';
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The one sentence that says what is rendered. Every surface showing a render
 * shows this, so none can call a draft the real thing or the app's root the
 * component.
 */
export function describeUiSurfaceRender(state: UiSurfaceRenderState): string {
  switch (state.kind) {
    case 'static-file': {
      const missing = [
        state.report.scripts > 0 ? `${plural(state.report.scripts, 'script')} did not run` : '',
        state.report.remote > 0 ? `${plural(state.report.remote, 'remote resource')} not loaded` : '',
        state.report.outsideFolder > 0 ? `${plural(state.report.outsideFolder, 'reference')} outside ${folderOf(state.path)} not loaded` : '',
        state.report.rootAbsolute > 0 ? `${plural(state.report.rootAbsolute, 'root-absolute reference')} not loaded` : '',
        state.report.embedded > 0 ? `${plural(state.report.embedded, 'embedded frame')} blocked` : '',
      ].filter(Boolean);
      return `Real file at ${state.path}, as of ${state.modifiedAt}. Scripts off; only files under ${folderOf(state.path)} load.${missing.length > 0 ? ` ${missing.join(' · ')}.` : ''}`;
    }
    case 'dev-server':
      return state.route.status === 'derived'
        ? `Dev server at ${state.address} (the project's "${state.scriptName}" script), showing ${state.path} by rule ${state.route.ruleId}.`
        : `Dev server at ${state.address} (the project's "${state.scriptName}" script) — the app's root, not ${state.path}: ${state.route.reason}`;
    case 'not-renderable':
      return `Not renderable here: ${state.reason}`;
    case 'missing':
      return `${state.path} is no longer in the project, so nothing is rendered.`;
    case 'draft':
      return 'Drawn here — there is no project file behind this surface. The full preview renders the Studio\'s draft, and says so.';
  }
}
