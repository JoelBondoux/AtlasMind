// Bundles the browser (web extension host) entry point.
//
// The desktop extension (`out/extension.js`) and the Node CLI (`out/cli/main.js`)
// are still emitted by `tsc` — they run under Node and do not need bundling.
// Only the web build must be a single, dependency-free bundle because the web
// extension host runs inside a browser Web Worker with no module resolution and
// no Node built-ins.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const webOptions = {
  entryPoints: ['src/web/extension.ts'],
  outfile: 'out/web/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  // `vscode` is provided by the host at runtime and must stay external.
  external: ['vscode'],
  sourcemap: true,
  // Fail loudly if anything pulls a Node built-in into the browser bundle.
  define: { global: 'globalThis' },
  logLevel: 'info',
};

/**
 * The syntax highlighter the chat webview loads.
 *
 * Built rather than downloaded: `media/chatPanel.js` is hand-authored and
 * unbundled so it cannot import anything, and the panel's CSP forbids a CDN — so
 * the alternative was committing an opaque minified blob. Building it from the
 * pinned `highlight.js` devDependency keeps the input reviewable and the version
 * visible to `npm ls` and Dependabot.
 *
 * The output is committed, because `media/` ships verbatim in the VSIX and a
 * missing file here means code blocks silently lose their colours rather than
 * failing loudly.
 */
/** @type {import('esbuild').BuildOptions} */
const highlightOptions = {
  entryPoints: ['scripts/highlight-entry.mjs'],
  outfile: 'media/vendor/highlight.min.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  banner: {
    js: '/* highlight.js v11.12.0 (BSD-3-Clause) — built from the pinned devDependency by esbuild.mjs. Do not edit; see media/vendor/highlight.js.LICENSE. */',
  },
  logLevel: 'info',
};

async function run() {
  if (watch) {
    const ctx = await context(webOptions);
    await ctx.watch();
    console.log('[esbuild] watching web bundle…');
    return;
  }
  await build(webOptions);
  console.log('[esbuild] web bundle written to out/web/extension.js');
  await build(highlightOptions);
  console.log('[esbuild] highlighter bundle written to media/vendor/highlight.min.js');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
