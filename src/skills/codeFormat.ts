import type { SkillDefinition } from '../types.js';

type FormatterId = 'prettier' | 'eslint' | 'rustfmt' | 'black' | 'gofmt' | 'dotnet-format';

interface FormatterEntry {
  id: FormatterId;
  /** Config file names whose presence indicates this formatter is configured. */
  configFiles: string[];
  /** package.json script names that suggest this formatter. */
  scriptNames: string[];
  /** File extensions this formatter handles. */
  extensions: string[];
}

const FORMATTERS: FormatterEntry[] = [
  {
    id: 'prettier',
    configFiles: ['.prettierrc', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs'],
    scriptNames: ['format', 'fmt', 'prettier'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.html', '.md', '.yaml', '.yml'],
  },
  {
    id: 'eslint',
    configFiles: ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs'],
    scriptNames: ['lint:fix', 'eslint:fix'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  },
  {
    id: 'rustfmt',
    configFiles: ['rustfmt.toml', '.rustfmt.toml'],
    scriptNames: [],
    extensions: ['.rs'],
  },
  {
    id: 'black',
    configFiles: ['pyproject.toml', '.black', 'black.toml'],
    scriptNames: ['format', 'fmt'],
    extensions: ['.py'],
  },
  {
    id: 'gofmt',
    configFiles: ['go.mod'],
    scriptNames: [],
    extensions: ['.go'],
  },
  {
    id: 'dotnet-format',
    configFiles: ['.editorconfig'],
    scriptNames: ['format'],
    extensions: ['.cs', '.vb', '.fs'],
  },
];

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : '';
}

async function autoDetectFormatter(
  targetPath: string,
  context: Parameters<SkillDefinition['execute']>[1],
): Promise<FormatterId | undefined> {
  const ext = getExtension(targetPath);

  // 1. Check which formatters have a config file present in the workspace.
  const candidates: FormatterEntry[] = [];
  for (const formatter of FORMATTERS) {
    if (ext && !formatter.extensions.includes(ext)) continue;
    for (const configFile of formatter.configFiles) {
      try {
        const matches = await context.findFiles(configFile);
        if (matches.length > 0) {
          candidates.push(formatter);
          break;
        }
      } catch {
        // findFiles may throw on invalid patterns; skip safely
      }
    }
  }

  if (candidates.length === 1) return candidates[0]!.id;
  if (candidates.length > 1) {
    // Prefer prettier over eslint for shared extensions
    const prettier = candidates.find(c => c.id === 'prettier');
    if (prettier) return 'prettier';
    return candidates[0]!.id;
  }

  // 2. Fall back to extension-only match
  if (ext === '.rs') return 'rustfmt';
  if (ext === '.go') return 'gofmt';
  if (ext === '.py') return 'black';
  if (['.cs', '.vb', '.fs'].includes(ext)) return 'dotnet-format';
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.html', '.md'].includes(ext)) return 'prettier';

  return undefined;
}

async function runFormatter(
  formatter: FormatterId,
  targetPath: string,
  context: Parameters<SkillDefinition['execute']>[1],
): Promise<string> {
  let result: { ok: boolean; exitCode: number; stdout: string; stderr: string };

  switch (formatter) {
    case 'prettier':
      result = await context.runCommand('npx', ['prettier', '--write', targetPath]);
      break;
    case 'eslint':
      result = await context.runCommand('npx', ['eslint', '--fix', targetPath]);
      break;
    case 'rustfmt':
      result = await context.runCommand('rustfmt', [targetPath]);
      break;
    case 'black':
      result = await context.runCommand('python', ['-m', 'black', targetPath]);
      break;
    case 'gofmt':
      result = await context.runCommand('gofmt', ['-w', targetPath]);
      break;
    case 'dotnet-format':
      result = await context.runCommand('dotnet', ['format', '--include', targetPath]);
      break;
  }

  return [
    `formatter: ${formatter}`,
    `ok: ${result.ok}`,
    `exitCode: ${result.exitCode}`,
    result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
    result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
  ].join('\n');
}

export const codeFormatSkill: SkillDefinition = {
  id: 'code-format',
  name: 'Format Code',
  builtIn: true,
  description:
    'Format a source file or directory using the project\'s configured formatter. ' +
    'Auto-detects prettier, eslint (--fix), rustfmt, black, gofmt, or dotnet-format from workspace config files. ' +
    'A specific formatter can be forced via the "formatter" parameter.',
  routingHints: [
    'format file', 'format code', 'run prettier', 'run eslint fix', 'fix formatting',
    'auto format', 'format directory', 'lint fix',
  ],
  parameters: {
    type: 'object',
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the file or directory to format.',
      },
      formatter: {
        type: 'string',
        enum: ['auto', 'prettier', 'eslint', 'rustfmt', 'black', 'gofmt', 'dotnet-format'],
        description: 'Formatter to use. Defaults to "auto" (auto-detected from workspace config and file extension).',
      },
    },
  },
  async execute(params, context) {
    const rawPath = params['path'];
    if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
      return 'Error: "path" parameter is required and must be a non-empty string.';
    }
    const targetPath = rawPath.trim();

    // Reject path traversal
    if (targetPath.includes('..')) {
      return 'Error: Path traversal ("..") is not allowed.';
    }

    const rawFormatter = params['formatter'];
    const formatterArg = typeof rawFormatter === 'string' ? rawFormatter : 'auto';

    let formatterId: FormatterId | undefined;
    if (formatterArg === 'auto') {
      formatterId = await autoDetectFormatter(targetPath, context);
      if (!formatterId) {
        return (
          `Error: Could not auto-detect a formatter for "${targetPath}". ` +
          'Specify one explicitly via the "formatter" parameter: prettier | eslint | rustfmt | black | gofmt | dotnet-format.'
        );
      }
    } else {
      formatterId = formatterArg as FormatterId;
    }

    return runFormatter(formatterId, targetPath, context);
  },
};
