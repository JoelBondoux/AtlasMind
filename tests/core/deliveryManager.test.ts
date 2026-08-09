import { describe, expect, it } from 'vitest';
import { buildProjectDeliveryGuide, seedDeliveryConfig, renderDeliveryMarkdown } from '../../src/core/deliveryManager.ts';

const PRODUCTION_STAGE = 'stage-production';
const STAGING_STAGE = 'stage-staging';

describe('seedDeliveryConfig — branch import', () => {
  it('uses the detected production branch verbatim (e.g. master, not main)', () => {
    const config = seedDeliveryConfig({
      currentBranch: 'develop',
      productionBranch: 'master',
      developBranch: 'develop',
      archetype: 'vscode-extension',
    });

    const production = config.stages.find(stage => stage.id === PRODUCTION_STAGE);
    const staging = config.stages.find(stage => stage.id === STAGING_STAGE);
    expect(production?.branchRef).toBe('master');
    expect(staging?.branchRef).toBe('develop');
  });

  it('does NOT fabricate "main" when no production branch is detected', () => {
    // Regression: a repo with only develop/master must never have a phantom
    // `main` invented for it. Detection failing → branchRef stays unset.
    const config = seedDeliveryConfig({
      currentBranch: 'develop',
      developBranch: 'develop',
      // productionBranch intentionally omitted (detection found none)
    });

    const production = config.stages.find(stage => stage.id === PRODUCTION_STAGE);
    expect(production?.branchRef).toBeUndefined();
  });

  it('falls back to the current branch for staging only when no develop branch exists', () => {
    const config = seedDeliveryConfig({
      currentBranch: 'trunk',
      productionBranch: 'master',
    });

    const staging = config.stages.find(stage => stage.id === STAGING_STAGE);
    expect(staging?.branchRef).toBe('trunk');
  });
});

describe('renderDeliveryMarkdown — branch label', () => {
  it('labels a branchless non-local stage "not detected", not "working tree"', () => {
    const config = seedDeliveryConfig({
      currentBranch: 'develop',
      developBranch: 'develop',
      // no productionBranch → production has no branchRef
    });

    const markdown = renderDeliveryMarkdown(config);
    expect(markdown).toContain('— (not detected)');
    // The local stage (genuinely branchless) keeps the working-tree label.
    expect(markdown).toContain('— (working tree)');
  });

  it('renders the detected production branch in a code span', () => {
    const config = seedDeliveryConfig({
      currentBranch: 'develop',
      productionBranch: 'master',
      developBranch: 'develop',
    });

    const markdown = renderDeliveryMarkdown(config);
    expect(markdown).toContain('`master`');
    expect(markdown).not.toContain('`main`');
  });
});

describe('buildProjectDeliveryGuide', () => {
  it('uses exact Node scripts and a bound routine while keeping commands display-only', () => {
    const config = seedDeliveryConfig({
      currentBranch: 'develop',
      productionBranch: 'main',
      archetype: 'vscode-extension',
      publishTarget: 'VS Code Marketplace',
      productionRoutineId: 'ship-project',
    });
    const guide = buildProjectDeliveryGuide({
      files: ['package.json', 'package-lock.json', 'CHANGELOG.md', '.github/workflows/publish.yml'],
      packageJson: {
        version: '1.2.3',
        packageManager: 'npm@11.0.0',
        engines: { node: '>=22' },
        scripts: {
          compile: 'tsc -p .',
          lint: 'eslint .',
          test: 'vitest run',
          package: 'vsce package',
          'tag:release': 'node scripts/tag.mjs',
        },
      },
      deliveryConfig: config,
      workingTreeClean: true,
      routines: [{
        id: 'ship-project',
        name: 'Ship project',
        description: 'Release through the protected branch.',
        steps: [{ id: 'merge', label: 'Merge to main', run: 'gh pr create --base main', on_fail: 'abort' }],
      }],
      workflows: [{ name: 'Publish', path: '.github/workflows/publish.yml', triggers: ['push'] }],
    });

    expect(guide.ecosystem).toBe('Node.js');
    expect(guide.toolchain).toBe('npm');
    expect(guide.target).toBe('VS Code Marketplace');
    expect(guide.blockerCount).toBe(0);
    expect(guide.phases.find(phase => phase.id === 'prepare')?.steps)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ command: 'npm ci' }),
        expect.objectContaining({ label: 'Prepare release version', status: 'manual', path: 'package.json' }),
      ]));
    expect(guide.phases.find(phase => phase.id === 'validate')?.steps.map(step => step.command))
      .toEqual(expect.arrayContaining(['npm run compile', 'npm run lint', 'npm run test']));
    expect(guide.phases.find(phase => phase.id === 'package')?.steps)
      .toEqual(expect.arrayContaining([expect.objectContaining({ command: 'npm run package', status: 'configured' })]));
    expect(guide.phases.find(phase => phase.id === 'deploy')?.steps)
      .toEqual(expect.arrayContaining([expect.objectContaining({ command: 'gh pr create --base main' })]));
    expect(guide.phases.find(phase => phase.id === 'publish')?.steps.map(step => step.command))
      .toContain('npm run tag:release');
  });

  it('shows a declared release-preparation script in the detected runbook', () => {
    const config = seedDeliveryConfig({
      currentBranch: 'develop',
      productionBranch: 'main',
      archetype: 'vscode-extension',
      publishTarget: 'VS Code Marketplace',
    });
    const guide = buildProjectDeliveryGuide({
      files: ['package.json', 'CHANGELOG.md'],
      packageJson: {
        version: '1.2.3',
        scripts: { 'prepare:release': 'node scripts/prepare-release.mjs', test: 'vitest run', build: 'tsc' },
      },
      deliveryConfig: config,
      workingTreeClean: true,
    });

    expect(guide.phases.find(phase => phase.id === 'prepare')?.steps)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          label: 'Prepare release version',
          status: 'configured',
          command: 'npm run prepare:release',
        }),
      ]));
  });

  it('derives labelled Python conventions without claiming the project declared scripts', () => {
    const guide = buildProjectDeliveryGuide({
      files: ['pyproject.toml', 'uv.lock'],
      manifestContents: {
        'pyproject.toml': '[project]\nrequires-python = ">=3.12"\ndependencies = ["pytest", "ruff"]',
      },
      workingTreeClean: true,
    });

    expect(guide.ecosystem).toBe('Python');
    expect(guide.toolchain).toBe('Python + uv');
    expect(guide.phases.find(phase => phase.id === 'prepare')?.steps)
      .toEqual(expect.arrayContaining([expect.objectContaining({ command: 'uv sync --frozen', status: 'conventional' })]));
    expect(guide.phases.find(phase => phase.id === 'validate')?.steps)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ command: 'python -m pytest', status: 'conventional' }),
        expect.objectContaining({ command: 'ruff check .', status: 'conventional' }),
      ]));
    expect(guide.phases.find(phase => phase.id === 'package')?.steps)
      .toEqual(expect.arrayContaining([expect.objectContaining({ command: 'python -m build', status: 'conventional' })]));
  });

  it('preserves manifest line structure while detecting a Go runtime requirement', () => {
    const guide = buildProjectDeliveryGuide({
      files: ['go.mod'],
      manifestContents: { 'go.mod': 'module example.com/service\n\ngo 1.24.2\n' },
      workingTreeClean: true,
    });

    expect(guide.phases.find(phase => phase.id === 'prepare')?.steps)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'Runtime requirement', detail: expect.stringContaining('1.24.2') }),
      ]));
  });

  it('reports missing load-bearing facts instead of inventing a generic release path', () => {
    const guide = buildProjectDeliveryGuide({ files: [], workingTreeClean: undefined });

    expect(guide.ecosystem).toBe('Undeclared');
    expect(guide.target).toBe('Not configured');
    expect(guide.blockerCount).toBeGreaterThanOrEqual(3);
    expect(guide.phases.flatMap(phase => phase.steps))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'Project manifest', status: 'missing', blocking: true }),
        expect.objectContaining({ label: 'Project validation', status: 'missing', blocking: true }),
        expect.objectContaining({ label: 'Packaging command', status: 'missing', blocking: true }),
      ]));
  });

  it('drops unsafe evidence paths and strips control characters from workspace-authored text', () => {
    const config = seedDeliveryConfig({
      currentBranch: 'main',
      productionBranch: 'main',
      publishTarget: 'Example registry',
    });
    const production = config.stages.find(stage => stage.id === PRODUCTION_STAGE)!;
    production.promotionPolicy.dispatchWorkflow = '../outside.yml';
    const guide = buildProjectDeliveryGuide({
      files: ['package.json', '../secret.txt'],
      packageJson: { scripts: { test: 'vitest\u0000run', package: 'build\u001b[31m' } },
      deliveryConfig: config,
      workingTreeClean: true,
      workflows: [{ name: 'Publish\u0007now', path: '../publish.yml', triggers: ['workflow_dispatch'] }],
    });
    const steps = guide.phases.flatMap(phase => phase.steps);

    expect(steps.every(step => !step.path?.includes('..'))).toBe(true);
    expect(steps.every(step => !/[\u0000-\u001f\u007f]/.test(`${step.label}${step.detail}${step.command ?? ''}`))).toBe(true);
    expect(steps.some(step => step.command?.includes('../outside.yml'))).toBe(false);
  });
});
