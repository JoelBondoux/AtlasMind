import type { SkillDefinition } from '../types.js';
import { optionalString } from './validation.js';

/**
 * Top 50 most popular VS Code extensions by install count (2024 snapshot).
 * Used to provide targeted guidance when the user asks about a specific tool.
 */
const TOP_EXTENSION_IDS = new Set([
  'ms-python.python',
  'ms-vscode.cpptools',
  'ms-toolsai.jupyter',
  'esbenp.prettier-vscode',
  'dbaeumer.vscode-eslint',
  'ms-vscode-remote.remote-ssh',
  'ms-vscode-remote.remote-wsl',
  'ms-vscode-remote.remote-containers',
  'ms-vscode.remote-explorer',
  'github.copilot',
  'github.copilot-chat',
  'eamodio.gitlens',
  'mhutchie.git-graph',
  'christian-kohler.path-intellisense',
  'formulahendry.auto-rename-tag',
  'streetsidesoftware.code-spell-checker',
  'ritwickdey.liveserver',
  'ms-azuretools.vscode-docker',
  'redhat.vscode-yaml',
  'ms-vscode.vscode-typescript-next',
  'bradlc.vscode-tailwindcss',
  'csstools.postcss',
  'ms-vscode.hexeditor',
  'hediet.vscode-drawio',
  'ms-vscode.live-share',
  'visualstudioexptteam.vscodeintellicode',
  'dotjoshjohnson.xml',
  'ms-azuretools.azure-dev',
  'ms-vscode.powershell',
  'golang.go',
  'rust-lang.rust-analyzer',
  'ms-dotnettools.csharp',
  'ms-dotnettools.vscode-dotnet-runtime',
  'ms-vscode.cmake-tools',
  'twxs.cmake',
  'ms-python.black-formatter',
  'ms-python.isort',
  'ms-python.pylint',
  'ms-python.mypy-type-checker',
  'ms-vscode.test-adapter-converter',
  'hbenl.vscode-test-explorer',
  'wayou.vscode-todo-highlight',
  'gruntfuggly.todo-tree',
  'pkief.material-icon-theme',
  'zhuangtongfa.material-theme',
  'dracula-theme.theme-dracula',
  'oderwat.indent-rainbow',
  'coenraads.bracket-pair-colorizer-2',
  'johnpapa.angular-essentials',
]);

export const vscodeExtensionsSkill: SkillDefinition = {
  id: 'vscode-extensions',
  name: 'VS Code Extensions',
  builtIn: true,
  description:
    'List the installed VS Code extensions and their enabled state, with optional filtering by name or id. ' +
    'Also reports any currently forwarded ports from the VS Code Remote/Ports panel. ' +
    'Use this to discover which tools or language servers are available in the workspace.',
  parameters: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        description:
          'Optional case-insensitive filter string. Only extensions whose id or display name contains this value are returned.',
      },
      topOnly: {
        type: 'boolean',
        description:
          'When true, only return extensions from the curated list of the top 50 most popular VS Code extensions.',
      },
      includePorts: {
        type: 'boolean',
        description: 'When true, also list forwarded ports from the Ports panel. Defaults to true.',
      },
    },
  },
  async execute(params, context) {
    const filterErr = optionalString(params, 'filter');
    if (filterErr) { return filterErr; }

    const filterRaw = typeof params['filter'] === 'string' ? params['filter'].trim().toLowerCase() : '';
    const topOnly = params['topOnly'] === true;
    const includePorts = params['includePorts'] !== false; // default true

    const [extensions, portForwards] = await Promise.all([
      context.getInstalledExtensions(),
      includePorts ? context.getPortForwards() : Promise.resolve([]),
    ]);

    // Apply filters
    let filtered = extensions;
    if (filterRaw) {
      filtered = filtered.filter(
        ext => ext.id.toLowerCase().includes(filterRaw) || ext.displayName.toLowerCase().includes(filterRaw),
      );
    }
    if (topOnly) {
      filtered = filtered.filter(ext => TOP_EXTENSION_IDS.has(ext.id));
    }

    const lines: string[] = ['=== VS Code Extensions ==='];

    if (filtered.length === 0) {
      lines.push('\n(no extensions match the filter)');
    } else {
      const active = filtered.filter(e => e.enabled);
      const inactive = filtered.filter(e => !e.enabled);

      lines.push(`\nActive (${active.length}):`);
      for (const ext of active.slice(0, 30)) {
        const top = TOP_EXTENSION_IDS.has(ext.id) ? ' ★' : '';
        lines.push(`  ${ext.displayName} (${ext.id}) v${ext.version}${top}`);
      }
      if (active.length > 30) {
        lines.push(`  ... and ${active.length - 30} more active extension(s)`);
      }

      if (inactive.length > 0) {
        lines.push(`\nInactive / not yet activated (${inactive.length}):`);
        for (const ext of inactive.slice(0, 10)) {
          lines.push(`  ${ext.displayName} (${ext.id}) v${ext.version}`);
        }
        if (inactive.length > 10) {
          lines.push(`  ... and ${inactive.length - 10} more inactive extension(s)`);
        }
      }
    }

    // Forwarded ports
    lines.push('\n=== Forwarded Ports ===');
    if (portForwards.length === 0) {
      lines.push('  No ports are currently forwarded.');
    } else {
      for (const port of portForwards) {
        const label = port.label ? ` (${port.label})` : '';
        const local = port.localAddress ? ` → ${port.localAddress}` : '';
        const priv = port.privacy ? ` [${port.privacy}]` : '';
        lines.push(`  :${port.portNumber}${label}${local}${priv}`);
      }
    }

    return lines.join('\n');
  },
};
