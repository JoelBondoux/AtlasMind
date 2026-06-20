#!/usr/bin/env node
/**
 * Create and push the git release tag for the current package version.
 *
 * Runs automatically after `npm run publish:release` (chained), so every
 * Marketplace release gets a matching `v<version>` tag without anyone having to
 * remember. Cross-platform (pure Node) and idempotent: if the tag already
 * exists it is left alone. Tags HEAD, which at publish time is the committed
 * release state.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
const tag = `v${version}`;

function capture(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

try {
  if (capture(`git tag --list ${tag}`)) {
    console.log(`[tag-release] ${tag} already exists; nothing to do.`);
    process.exit(0);
  }
  execSync(`git tag -a ${tag} -m "Release ${tag}"`, { stdio: 'inherit' });
  execSync(`git push origin ${tag}`, { stdio: 'inherit' });
  console.log(`[tag-release] Created and pushed ${tag}.`);
} catch (err) {
  // The publish itself already succeeded (this step is chained after it); surface
  // the tag failure so it can be re-run with `npm run tag:release`.
  console.error(`[tag-release] Could not create/push ${tag}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
