import type { SkillDefinition } from '../types.js';

type VsCode = typeof import('vscode');

/**
 * Read AtlasMind's own settings freely; change one only after the operator says
 * so, in a dialog naming the key and both values.
 *
 * "Turn off automatic research scans" names a setting that exists, and chat
 * could describe all 134 of them and change none — nothing in the tool set could
 * read or write configuration, so the request could only be answered with prose
 * telling the operator where to click. The alternative that had to be avoided is
 * worse than the gap: this repository already had a path that wrote two chat
 * settings at workspace scope on a signal that fired on politeness, and named
 * neither in anything the operator read (removed in v0.310.4). A settings change
 * nobody is told about cannot be reviewed, reverted, or even attributed.
 *
 * So the write half rests on four rules.
 *
 * **Only declared keys.** The key must exist in the running extension's manifest
 * under `atlasmind.`. A model cannot invent a setting, cannot reach another
 * extension's configuration, and cannot write a key that no code reads.
 *
 * **The value must match the declared type**, and an enum value must be one of
 * the declared ones — checked here rather than left to VS Code, so the refusal
 * names the permitted values instead of failing silently at the write.
 *
 * **A modal names the key, the current value and the new one**, and it is the
 * gate: nothing is written until it returns. `{ modal: true }` is deliberate —
 * a toast can be missed, and this changes how the operator's tools behave from
 * then on.
 *
 * **Workspace scope, never global**, so the change is visible in the project's
 * own `.vscode/settings.json` where a reviewer will see it, rather than in a
 * user profile where it silently follows them to every other project.
 */

const SETTINGS_PREFIX = 'atlasmind.';
const ATLASMIND_EXTENSION_ID = 'JoelBondoux.atlasmind';

interface DeclaredSetting {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  markdownDescription?: string;
  default?: unknown;
}

function declaredSettings(vscode: VsCode): Record<string, DeclaredSetting> | undefined {
  const manifest = vscode.extensions.getExtension(ATLASMIND_EXTENSION_ID)?.packageJSON as
    | { contributes?: { configuration?: { properties?: Record<string, DeclaredSetting> } } }
    | undefined;
  return manifest?.contributes?.configuration?.properties;
}

function describeValue(value: unknown): string {
  return value === undefined ? '(not set)' : JSON.stringify(value);
}

/** Does the supplied value match what the manifest says this key accepts? */
export function validateSettingValue(
  declared: DeclaredSetting,
  value: unknown,
): string | undefined {
  if (Array.isArray(declared.enum) && declared.enum.length > 0) {
    return declared.enum.includes(value)
      ? undefined
      : `must be one of ${declared.enum.map(entry => JSON.stringify(entry)).join(', ')}`;
  }

  const types = Array.isArray(declared.type) ? declared.type : declared.type ? [declared.type] : [];
  if (types.length === 0) {
    return undefined;
  }

  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  const matches = types.some(type => (type === 'integer' ? Number.isInteger(value) : type === actual));
  return matches ? undefined : `must be ${types.join(' or ')}, not ${actual}`;
}

export const atlasmindSettingsSkill: SkillDefinition = {
  id: 'atlasmind-settings',
  name: 'Read or change an AtlasMind setting',
  builtIn: true,
  description:
    'Read AtlasMind\'s own settings, or change one after the operator confirms. '
    + 'Use this when asked what a setting is, or to turn an AtlasMind feature on or off. '
    + 'Reading is free; a change always asks the operator first and is never silent.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['get', 'set'],
        description: '"get" reads the current value; "set" proposes a change the operator must confirm.',
      },
      key: {
        type: 'string',
        description: 'Full setting key, e.g. "atlasmind.research.enabled". Must be a declared AtlasMind setting.',
      },
      value: {
        description: 'The new value, for "set". Must match the type the setting declares.',
      },
      reason: {
        type: 'string',
        description: 'One short sentence the operator will see, saying why this change is being proposed.',
      },
    },
    required: ['action', 'key'],
  },
  async execute(params) {
    // Lazily imported: a module-scope `from 'vscode'` here breaks the CLI, which
    // loads the whole skills index through `runtime/core`. See the note in
    // `atlasmindOpen.ts` and the guard in `tests/skills/hostImports.test.ts`.
    const vscode = await import('vscode');
    const action = params['action'];
    const key = params['key'];
    if (action !== 'get' && action !== 'set') {
      return 'Error: "action" must be "get" or "set".';
    }
    if (typeof key !== 'string' || !key.startsWith(SETTINGS_PREFIX)) {
      return `Error: "key" must be a declared AtlasMind setting beginning "${SETTINGS_PREFIX}".`;
    }

    const settings = declaredSettings(vscode);
    if (!settings) {
      return 'Error: AtlasMind\'s settings manifest is not available in this host.';
    }
    const declared = settings[key];
    if (!declared) {
      // Named, not guessed at. A model that has invented a key needs to be told
      // it does not exist rather than have a nearby one substituted for it.
      return `Error: "${key}" is not a declared AtlasMind setting. Do not guess a key — read the surface index, or tell the operator you are not certain of the exact name.`;
    }

    // `getConfiguration()` is called without a section so the fully-qualified key
    // can be read whole. Scoping it to the atlasmind section and then passing a
    // key that still carries that prefix silently resolves to a doubled
    // namespace and reads nothing — `settingsIntegrity.test.ts` fails the build
    // on that shape, and it is the reason this is written the long way round.
    const configuration = vscode.workspace.getConfiguration();
    const current = configuration.get(key);

    if (action === 'get') {
      const summary = String(declared.description ?? declared.markdownDescription ?? '').split('\n')[0] ?? '';
      return `${key} = ${describeValue(current)} (default ${describeValue(declared.default)}).\n${summary}`;
    }

    if (!('value' in params)) {
      return 'Error: "set" needs a "value".';
    }
    const value = params['value'];
    const invalid = validateSettingValue(declared, value);
    if (invalid) {
      return `Error: ${key} ${invalid}.`;
    }
    if (JSON.stringify(current) === JSON.stringify(value)) {
      return `${key} is already ${describeValue(value)}. Nothing to change.`;
    }

    const reason = typeof params['reason'] === 'string' && params['reason'].trim().length > 0
      ? params['reason'].trim()
      : undefined;

    const confirmation = await vscode.window.showWarningMessage(
      `Change AtlasMind setting "${key}"?`,
      {
        modal: true,
        detail:
          `Current: ${describeValue(current)}\nNew: ${describeValue(value)}\n\n`
          + `${reason ? `${reason}\n\n` : ''}`
          + 'This writes to the workspace settings for this project.',
      },
      'Change it',
    );
    if (confirmation !== 'Change it') {
      return `The operator declined. ${key} is unchanged at ${describeValue(current)}.`;
    }

    try {
      await configuration.update(key, value, vscode.ConfigurationTarget.Workspace);
    } catch (error) {
      return `Error: could not write ${key}. ${error instanceof Error ? error.message : String(error)}`;
    }

    return `${key} changed from ${describeValue(current)} to ${describeValue(value)} in this project's workspace settings.`;
  },
};
