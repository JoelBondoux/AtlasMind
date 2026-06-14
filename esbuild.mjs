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

async function run() {
  if (watch) {
    const ctx = await context(webOptions);
    await ctx.watch();
    console.log('[esbuild] watching web bundle…');
    return;
  }
  await build(webOptions);
  console.log('[esbuild] web bundle written to out/web/extension.js');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
