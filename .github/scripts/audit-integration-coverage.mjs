#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const repoRoot = process.cwd();
  const manifestPath = path.join(repoRoot, '.github', 'integration-monitor.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const extensionsJson = JSON.parse(await readFile(path.join(repoRoot, '.vscode', 'extensions.json'), 'utf8'));
  const typesContent = await readFile(path.join(repoRoot, 'src', 'types.ts'), 'utf8');
  const specialistPanelContent = await readFile(path.join(repoRoot, 'src', 'views', 'specialistIntegrationsPanel.ts'), 'utf8');
  const dependabotContent = await readFile(path.join(repoRoot, '.github', 'dependabot.yml'), 'utf8');

  const providerIds = parseStringUnion(typesContent, 'ProviderId');
  const specialistProviderIds = parseSpecialistProviderIds(specialistPanelContent);
  const recommendedExtensionIds = Array.isArray(extensionsJson.recommendations)
    ? extensionsJson.recommendations.filter(value => typeof value === 'string')
    : [];

  const monitoredExtensionIds = new Set((manifest.marketplaceExtensions ?? []).map(entry => entry.id));
  const coveredProviderIds = new Set((manifest.providerContracts ?? []).flatMap(entry => Array.isArray(entry.providerIds) ? entry.providerIds : []));
  const coveredSpecialistProviderIds = new Set((manifest.providerContracts ?? []).flatMap(entry => Array.isArray(entry.specialistProviderIds) ? entry.specialistProviderIds : []));
  const ignoredProviderIds = new Set(Array.isArray(manifest.ignoredProviderIds) ? manifest.ignoredProviderIds : []);
  const ignoredSpecialistProviderIds = new Set(Array.isArray(manifest.ignoredSpecialistProviderIds) ? manifest.ignoredSpecialistProviderIds : []);

  const missingMarketplaceExtensions = recommendedExtensionIds.filter(id => !monitoredExtensionIds.has(id));
  const missingProviders = providerIds.filter(id => !coveredProviderIds.has(id) && !ignoredProviderIds.has(id));
  const missingSpecialists = specialistProviderIds.filter(id => !coveredSpecialistProviderIds.has(id) && !ignoredSpecialistProviderIds.has(id));
  const untrackedMarketplaceEntries = [...monitoredExtensionIds].filter(id => !recommendedExtensionIds.includes(id));
  const managedProviderIds = providerIds.filter(id => !ignoredProviderIds.has(id));
  const managedSpecialistProviderIds = specialistProviderIds.filter(id => !ignoredSpecialistProviderIds.has(id));

  const dependabotChecks = {
    npm: /package-ecosystem:\s*npm/.test(dependabotContent),
    githubActions: /package-ecosystem:\s*github-actions/.test(dependabotContent),
  };

  const issues = [];
  if (!dependabotChecks.npm) {
    issues.push('Dependabot is not configured for the npm ecosystem in .github/dependabot.yml.');
  }
  if (!dependabotChecks.githubActions) {
    issues.push('Dependabot is not configured for GitHub Actions in .github/dependabot.yml.');
  }
  if (missingMarketplaceExtensions.length > 0) {
    issues.push(`Recommended VS Code extensions missing marketplace monitoring entries: ${missingMarketplaceExtensions.join(', ')}`);
  }
  if (missingProviders.length > 0) {
    issues.push(`Provider IDs missing provider-contract coverage: ${missingProviders.join(', ')}`);
  }
  if (missingSpecialists.length > 0) {
    issues.push(`Specialist integrations missing monitoring coverage: ${missingSpecialists.join(', ')}`);
  }

  const summary = {
    scripts: {
      monitorIntegrations: packageJson.scripts?.['monitor:integrations'],
      monitorIntegrationsAudit: packageJson.scripts?.['monitor:integrations:audit'],
    },
    recommendedExtensionIds,
    monitoredExtensionIds: [...monitoredExtensionIds],
    providerIds,
    managedProviderIds,
    coveredProviderIds: [...coveredProviderIds],
    specialistProviderIds,
    managedSpecialistProviderIds,
    coveredSpecialistProviderIds: [...coveredSpecialistProviderIds],
    ignoredProviderIds: [...ignoredProviderIds],
    ignoredSpecialistProviderIds: [...ignoredSpecialistProviderIds],
    untrackedMarketplaceEntries,
    issues,
  };

  process.stdout.write(`${renderSummary(summary)}\n`);

  if (issues.length > 0) {
    process.exit(1);
  }
}

function parseStringUnion(fileContent, typeName) {
  const typeMatch = fileContent.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
  if (!typeMatch) {
    throw new Error(`Could not locate union type ${typeName}`);
  }

  return [...typeMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
}

function parseSpecialistProviderIds(fileContent) {
  return [...fileContent.matchAll(/id:\s*'([^']+)'/g)].map(match => match[1]);
}

function renderSummary(summary) {
  const lines = [
    '# Integration Coverage Audit',
    '',
    `- monitor:integrations script: ${summary.scripts.monitorIntegrations ? 'present' : 'missing'}`,
    `- monitor:integrations:audit script: ${summary.scripts.monitorIntegrationsAudit ? 'present' : 'missing'}`,
    `- recommended marketplace extensions tracked: ${summary.recommendedExtensionIds.length - summary.issues.filter(issue => issue.includes('Recommended VS Code extensions')).length}/${summary.recommendedExtensionIds.length}`,
    `- provider IDs covered: ${summary.managedProviderIds.length - summary.issues.filter(issue => issue.includes('Provider IDs')).length}/${summary.managedProviderIds.length}`,
    `- specialist integrations covered: ${summary.managedSpecialistProviderIds.length - summary.issues.filter(issue => issue.includes('Specialist integrations')).length}/${summary.managedSpecialistProviderIds.length}`,
  ];

  if (summary.untrackedMarketplaceEntries.length > 0) {
    lines.push(`- curated marketplace entries not currently recommended: ${summary.untrackedMarketplaceEntries.join(', ')}`);
  }
  if (summary.ignoredProviderIds.length > 0) {
    lines.push(`- ignored provider IDs: ${summary.ignoredProviderIds.join(', ')}`);
  }
  if (summary.ignoredSpecialistProviderIds.length > 0) {
    lines.push(`- ignored specialist integrations: ${summary.ignoredSpecialistProviderIds.join(', ')}`);
  }

  if (summary.issues.length > 0) {
    lines.push('');
    lines.push('## Issues');
    for (const issue of summary.issues) {
      lines.push(`- ${issue}`);
    }
  } else {
    lines.push('');
    lines.push('All current third-party dependency and integration surfaces are covered by automatic monitoring or explicit review configuration.');
  }

  return lines.join('\n');
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});