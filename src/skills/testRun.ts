import type { SkillDefinition } from '../types.js';

export const testRunSkill: SkillDefinition = {
  id: 'test-run',
  name: 'Run Tests',
  builtIn: true,
  description:
    'Run tests via the project test framework (vitest, jest, mocha, pytest, cargo test). ' +
    'Returns structured pass/fail output. Supports filtering by file or test name.',
  timeoutMs: 120_000,
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Optional path to a specific test file or directory (relative or absolute).',
      },
      testName: {
        type: 'string',
        description: 'Optional test name or pattern to filter which tests run.',
      },
      framework: {
        type: 'string',
        enum: ['vitest', 'jest', 'mocha', 'pytest', 'cargo'],
        description:
          'Test framework to use. Auto-detected from package.json or project files when omitted.',
      },
    },
  },
  async execute(params, context) {
    const rawFile = params['file'];
    const rawName = params['testName'];
    const rawFramework = params['framework'];

    const file = typeof rawFile === 'string' ? rawFile.trim() : undefined;
    const testName = typeof rawName === 'string' ? rawName.trim() : undefined;
    const framework = typeof rawFramework === 'string' ? rawFramework.trim() : undefined;

    // Detect framework when not specified
    let detected = framework;
    if (!detected) {
      detected = await detectFramework(context);
    }
    if (!detected) {
      return 'Error: Could not auto-detect a test framework. Specify the "framework" parameter.';
    }

    const { command, args } = buildTestCommand(detected, file, testName);

    const result = await context.runCommand(command, args, { timeoutMs: 90_000 });

    const header = result.ok ? '✓ Tests passed' : '✗ Tests failed';
    return [
      header,
      `exitCode: ${result.exitCode}`,
      result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
      result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
    ].join('\n');
  },
};

async function detectFramework(context: Parameters<typeof testRunSkill.execute>[1]): Promise<string | undefined> {
  try {
    const content = await context.readFile(
      (context.workspaceRootPath ?? '.') + '/package.json',
    );
    const pkg = JSON.parse(content) as Record<string, unknown>;
    const deps = { ...(pkg['devDependencies'] as Record<string, unknown> ?? {}), ...(pkg['dependencies'] as Record<string, unknown> ?? {}) };
    if ('vitest' in deps) { return 'vitest'; }
    if ('jest' in deps) { return 'jest'; }
    if ('mocha' in deps) { return 'mocha'; }
  } catch { /* not a Node project */ }

  try {
    const files = await context.findFiles('**/Cargo.toml');
    if (files.length > 0) { return 'cargo'; }
  } catch { /* ignore */ }

  try {
    const files = await context.findFiles('**/pytest.ini');
    if (files.length > 0) { return 'pytest'; }
    const files2 = await context.findFiles('**/pyproject.toml');
    if (files2.length > 0) { return 'pytest'; }
  } catch { /* ignore */ }

  return undefined;
}

function buildTestCommand(
  framework: string,
  file?: string,
  testName?: string,
): { command: string; args: string[] } {
  switch (framework) {
    case 'vitest': {
      const args = ['vitest', 'run'];
      if (file) { args.push(file); }
      if (testName) { args.push('-t', testName); }
      return { command: 'npx', args };
    }
    case 'jest': {
      const args = ['jest', '--no-coverage'];
      if (file) { args.push(file); }
      if (testName) { args.push('-t', testName); }
      return { command: 'npx', args };
    }
    case 'mocha': {
      const args = ['mocha'];
      if (file) { args.push(file); }
      if (testName) { args.push('--grep', testName); }
      return { command: 'npx', args };
    }
    case 'pytest': {
      const args = ['-m', 'pytest'];
      if (file) { args.push(file); }
      if (testName) { args.push('-k', testName); }
      return { command: 'python', args };
    }
    case 'cargo': {
      const args = ['test'];
      if (testName) { args.push(testName); }
      if (file) { args.push('--', '--test-threads=1'); }
      return { command: 'cargo', args };
    }
    default:
      return { command: 'npx', args: ['vitest', 'run'] };
  }
}
