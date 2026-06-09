import type { SkillDefinition } from '../types.js';
import { optionalString } from './validation.js';

export const npmScriptsSkill: SkillDefinition = {
  id: 'npm-scripts',
  name: 'NPM Scripts',
  builtIn: true,
  description:
    'Execute npm scripts or list the scripts defined in package.json. ' +
    'Use action "list" to enumerate script names and their shell commands. ' +
    'Use action "run" with a script name to execute it via npm run. ' +
    'This skill runs commands — use it when the user asks to start, build, test, or run something, NOT to answer questions about project policy, conventions, or documentation.',
  routingHints: [
    'run npm script',
    'start dev server',
    'run build',
    'run tests via npm',
    'execute npm run',
    'list package.json scripts',
  ],
  timeoutMs: 120_000,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'run'],
        description: '"list" shows all scripts in package.json; "run" executes the named script.',
      },
      script: {
        type: 'string',
        description: 'Script name to run (required when action is "run").',
      },
      cwd: {
        type: 'string',
        description: 'Optional absolute path to the package directory. Defaults to workspace root.',
      },
    },
  },
  async execute(params, context) {
    const action = typeof params['action'] === 'string' ? params['action'] : 'list';
    const cwdErr = optionalString(params, 'cwd');
    if (cwdErr) { return cwdErr; }

    const root = context.workspaceRootPath;
    if (!root) { return 'Error: No workspace is open.'; }

    const targetDir = typeof params['cwd'] === 'string' ? params['cwd'].trim() : root;

    // Find and parse package.json
    const pkgPath = `${targetDir}/package.json`.replace(/\\/g, '/');
    let pkg: Record<string, unknown>;
    try {
      const content = await context.readFile(pkgPath);
      pkg = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return `Error: Could not read package.json at ${pkgPath}.`;
    }

    const scripts = (pkg['scripts'] ?? {}) as Record<string, string>;
    const scriptNames = Object.keys(scripts);

    if (action === 'list') {
      if (scriptNames.length === 0) {
        return 'No scripts defined in package.json.';
      }
      const lines = scriptNames.map(name => `  ${name}: ${scripts[name]}`);
      return `Scripts in package.json:\n${lines.join('\n')}`;
    }

    // action === 'run'
    const scriptErr = optionalString(params, 'script');
    if (scriptErr) { return scriptErr; }
    const scriptName = typeof params['script'] === 'string' ? params['script'].trim() : '';
    if (!scriptName) {
      return 'Error: "script" is required when action is "run".';
    }
    if (!Object.prototype.hasOwnProperty.call(scripts, scriptName)) {
      const available = scriptNames.join(', ');
      return `Error: Script "${scriptName}" not found in package.json. Available: ${available || '(none)'}.`;
    }

    const result = await context.runCommand('npm', ['run', scriptName], { cwd: targetDir, timeoutMs: 120000 });
    return [
      `Script: ${scriptName}`,
      `ok: ${result.ok}`,
      `exitCode: ${result.exitCode}`,
      result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
      result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
    ].join('\n');
  },
};
