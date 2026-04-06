#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SHIELDS_MARKETPLACE_URL = 'https://img.shields.io/visual-studio-marketplace/v';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const manifestPath = path.join(repoRoot, '.github', 'integration-monitor.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const checkedAt = new Date().toISOString();

  const packageResults = await Promise.all((manifest.npmPackages ?? []).map(async entry => {
    const latestVersion = await fetchLatestNpmVersion(entry.name);
    return {
      ...entry,
      latestVersion,
      hasDrift: Boolean(entry.baselineVersion) && latestVersion !== entry.baselineVersion,
    };
  }));

  const extensionResults = await Promise.all((manifest.marketplaceExtensions ?? []).map(async entry => {
    const latestVersion = await fetchLatestMarketplaceVersion(entry.id);
    return {
      ...entry,
      latestVersion,
      hasDrift: Boolean(entry.baselineVersion) && latestVersion !== entry.baselineVersion,
      missingBaseline: !entry.baselineVersion,
    };
  }));

  if (options.write) {
    manifest.npmPackages = packageResults.map(({ latestVersion, hasDrift, ...entry }) => ({
      ...entry,
      baselineVersion: latestVersion,
    }));
    manifest.marketplaceExtensions = extensionResults.map(({ latestVersion, hasDrift, missingBaseline, ...entry }) => ({
      ...entry,
      baselineVersion: latestVersion,
    }));
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  const summary = {
    checkedAt,
    packageDrifts: packageResults.filter(result => result.hasDrift),
    extensionDrifts: extensionResults.filter(result => result.hasDrift || result.missingBaseline),
    providerContracts: manifest.providerContracts ?? [],
    packageResults,
    extensionResults,
  };

  const reportMarkdown = renderMarkdown(summary);
  process.stdout.write(`${reportMarkdown}\n`);

  if (options.reportFile) {
    await mkdir(path.dirname(options.reportFile), { recursive: true });
    await writeFile(options.reportFile, `${reportMarkdown}\n`, 'utf8');
  }

  if (options.jsonFile) {
    await mkdir(path.dirname(options.jsonFile), { recursive: true });
    await writeFile(options.jsonFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }

  const driftCount = summary.packageDrifts.length + summary.extensionDrifts.length;
  await writeGithubOutput('has_drift', driftCount > 0 ? 'true' : 'false');
  await writeGithubOutput('drift_count', String(driftCount));
  await writeGithubOutput('report_title', 'chore: review external integration drift');
}

function parseArgs(args) {
  const options = {
    write: false,
    reportFile: undefined,
    jsonFile: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--write') {
      options.write = true;
      continue;
    }

    if (arg === '--report-file') {
      options.reportFile = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--json-file') {
      options.jsonFile = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--help') {
      process.stdout.write('Usage: node .github/scripts/check-integration-drift.mjs [--write] [--report-file <path>] [--json-file <path>]\n');
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function fetchLatestNpmVersion(packageName) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName).replace(/%2F/g, '%2f')}/latest`;
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch npm metadata for ${packageName}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (typeof payload.version !== 'string' || payload.version.length === 0) {
    throw new Error(`npm registry response for ${packageName} did not include a version`);
  }

  return payload.version;
}

async function fetchLatestMarketplaceVersion(extensionId) {
  const response = await fetch(`${SHIELDS_MARKETPLACE_URL}/${encodeURIComponent(extensionId)}.json`, {
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to query Shields Marketplace version for ${extensionId}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const rawVersion = typeof payload.value === 'string' ? payload.value : payload.message;
  if (typeof rawVersion !== 'string' || rawVersion.length === 0) {
    throw new Error(`Shields Marketplace response for ${extensionId} did not include a version`);
  }

  if (!/^v?\d/.test(rawVersion)) {
    throw new Error(`Shields Marketplace response for ${extensionId} was not a usable version: ${rawVersion}`);
  }

  return rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;
}

function renderMarkdown(summary) {
  const lines = [
    '# External Integration Drift Report',
    '',
    `Checked at: ${summary.checkedAt}`,
    '',
    '## Summary',
    '',
    `- npm package drifts: ${summary.packageDrifts.length}`,
    `- VS Code Marketplace extension drifts or uninitialized baselines: ${summary.extensionDrifts.length}`,
    `- manual provider contract review items: ${summary.providerContracts.length}`,
    '',
  ];

  lines.push('## Curated npm packages');
  lines.push('');
  if (summary.packageResults.length === 0) {
    lines.push('- No curated npm packages configured.');
  } else {
    lines.push('| Package | Baseline | Latest | Drift | Managed By | Notes |');
    lines.push('|---|---:|---:|---|---|---|');
    for (const entry of summary.packageResults) {
      lines.push(`| \`${entry.name}\` | ${entry.baselineVersion || 'unset'} | ${entry.latestVersion} | ${entry.hasDrift ? 'yes' : 'no'} | ${entry.managedBy || 'manual'} | ${entry.complianceNotes} |`);
    }
  }
  lines.push('');

  lines.push('## VS Code Marketplace extensions');
  lines.push('');
  if (summary.extensionResults.length === 0) {
    lines.push('- No marketplace extensions configured.');
  } else {
    lines.push('| Extension | Baseline | Latest | Drift | Notes |');
    lines.push('|---|---:|---:|---|---|');
    for (const entry of summary.extensionResults) {
      const driftState = entry.missingBaseline ? 'baseline missing' : entry.hasDrift ? 'yes' : 'no';
      lines.push(`| \`${entry.id}\` | ${entry.baselineVersion || 'unset'} | ${entry.latestVersion} | ${driftState} | ${entry.complianceNotes} |`);
    }
  }
  lines.push('');

  lines.push('## Provider compliance checklist');
  lines.push('');
  for (const provider of summary.providerContracts) {
    lines.push(`- **${provider.displayName}**: ${provider.reviewTrigger}`);
    if (Array.isArray(provider.touchpoints) && provider.touchpoints.length > 0) {
      lines.push(`  Touchpoints: ${provider.touchpoints.join(', ')}`);
    }
  }

  if (summary.packageDrifts.length === 0 && summary.extensionDrifts.length === 0) {
    lines.push('');
    lines.push('No automated drift was detected. Use this report as a manual provider-contract review checklist when upstream vendors announce changes.');
  }

  return lines.join('\n');
}

async function writeGithubOutput(key, value) {
  const outputPath = process.env['GITHUB_OUTPUT'];
  if (!outputPath) {
    return;
  }

  await writeFile(outputPath, `${key}=${value}\n`, { encoding: 'utf8', flag: 'a' });
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});