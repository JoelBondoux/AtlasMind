import * as path from 'node:path';

/**
 * The Buzz Desktop build whose agent editor these field names were read from —
 * its own source (`desktop/src/features/settings/ui/CustomHarnessForm.tsx` and
 * `agents/ui/AgentDefinitionDialog.tsx` at tag `desktop-v0.5.28`), not its docs.
 * 0.4.x called the same thing "Provider → Custom command" with one
 * comma-separated arguments field; recipes written for that layout sent people
 * looking for fields 0.5 does not have.
 */
export const BUZZ_DESKTOP_RECIPE_VERIFIED_VERSION = '0.5.28';

export interface BuzzAcpRuntimeSetup {
  schemaVersion: 2;
  purpose: string;
  /** Buzz Desktop 0.5: a custom command is a *harness*, registered from the agent editor. */
  buzzHarness: {
    where: string;
    name: string;
    command: string;
    /** One per "Add argument" row. Buzz refuses an argument containing a comma. */
    arguments: string[];
    envVars: Record<string, string>;
  };
  /** The rest of the agent editor, once the harness is selected. */
  buzzAgent: {
    /**
     * Required by Buzz for a customised agent. buzz-acp switches models only
     * when the agent's `session/new` advertises model options, and AtlasMind
     * advertises none, so this value is never sent to it.
     */
    model: string;
    /**
     * Advanced → Parallelism. Buzz starts this many copies of the command;
     * AtlasMind schedules its own work, so one is enough and more only start
     * idle runtimes — each with its own subscription agents once asked.
     */
    parallelism: 1;
  };
  environment: {
    requiredForModels: string[];
    requiredForRemoteRelay: string;
    neverCopyFromAtlasMind: string;
  };
}

export interface BuzzAcpRuntimeSetupOptions {
  workspaceRoot: string;
  runtimeExecutable: string;
  agentEntrypoint: string;
  /**
   * A persona manifest AtlasMind wrote to its own storage. When given, the
   * Buzz identity answers as that persona's team instead of the default agent.
   */
  personaManifestPath?: string;
  /** The ACP agents that manifest names for models, so the recipe can say none of the variables are needed. */
  manifestAcpAgentIds?: readonly string[];
  /**
   * The harness's name in Buzz. A harness is shared by every agent that picks
   * it, and a persona's manifest is in its arguments, so each persona needs a
   * harness of its own.
   */
  harnessName?: string;
}

function requireSafeAbsolutePath(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  if (/[\0\r\n,]/.test(trimmed)) {
    throw new Error(`${label} cannot contain a NUL, newline, or comma because Buzz passes harness arguments through a comma-separated field.`);
  }
  return path.resolve(trimmed);
}

/**
 * Build the exact fields Buzz Desktop needs for a custom ACP-speaking agent.
 *
 * This is data for a human-reviewed setup step, not an installer: AtlasMind
 * does not edit Buzz's database, create an identity, or copy any credential.
 */
export function buildBuzzAcpRuntimeSetup(
  options: BuzzAcpRuntimeSetupOptions,
): BuzzAcpRuntimeSetup {
  const workspaceRoot = requireSafeAbsolutePath(options.workspaceRoot, 'Workspace root');
  const command = requireSafeAbsolutePath(options.runtimeExecutable, 'Runtime executable');
  const agentEntrypoint = requireSafeAbsolutePath(options.agentEntrypoint, 'Agent entrypoint');
  const harnessArguments = [agentEntrypoint, '--workspace', workspaceRoot, '--buzz-auto-reply'];
  if (options.personaManifestPath !== undefined) {
    harnessArguments.push('--buzz-persona-manifest', requireSafeAbsolutePath(options.personaManifestPath, 'Persona manifest'));
  }
  const name = (options.harnessName ?? 'AtlasMind').replace(/[\0\r\n]/g, ' ').trim().slice(0, 60) || 'AtlasMind';

  return {
    schemaVersion: 2,
    purpose: options.personaManifestPath === undefined
      ? 'Run AtlasMind as the ACP agent behind a Buzz managed agent.'
      : 'Run one AtlasMind persona as the ACP agent behind a Buzz managed agent.',
    buzzHarness: {
      where: 'Edit agent → AI configuration: Customize for this agent → Agent harness → Add custom harness…',
      name,
      command,
      arguments: harnessArguments,
      // The editor's own runtime is an Electron binary; this makes it run the
      // entrypoint as Node. Harmless when the command is Node itself.
      envVars: { ELECTRON_RUN_AS_NODE: '1' },
    },
    buzzAgent: {
      model: 'Any value, such as atlasmind. Buzz requires one; AtlasMind routes models itself and is never sent it.',
      parallelism: 1,
    },
    environment: {
      requiredForModels: options.manifestAcpAgentIds && options.manifestAcpAgentIds.length > 0
        ? [`None — the persona manifest names your ACP agents (${options.manifestAcpAgentIds.join(', ')}); each must already be signed in on this machine.`]
        : [
          'ATLASMIND_PROVIDER_OPENAI_APIKEY (OpenAI-compatible provider)',
          'ATLASMIND_PROVIDER_ANTHROPIC_APIKEY (Anthropic provider)',
          'ATLASMIND_LOCAL_OPENAI_BASE_URL (local OpenAI-compatible endpoint)',
        ],
      requiredForRemoteRelay: 'ATLASMIND_BUZZ_ALLOW_REMOTE_RELAY=true (only after reviewing the remote WSS/HTTPS relay)',
      neverCopyFromAtlasMind: 'VS Code SecretStorage values are never exported; enter only the provider variable you intend Buzz to pass.',
    },
  };
}

/**
 * The one sentence every surface uses to say where the recipe goes.
 *
 * `registered` means AtlasMind wrote the harness file itself, so the person
 * only picks it. Without that, the harness has to be added by hand — which
 * some 0.5 builds offer in the editor and some do not, so the sentence names
 * the AtlasMind command that registers it rather than promising a dialog.
 */
export function describeBuzzHarnessSteps(setup: BuzzAcpRuntimeSetup, registered = false): string {
  const finish = 'Type any Model (AtlasMind routes models and is never sent it) and set Advanced → Parallelism to 1.';
  return registered
    ? `In Buzz, edit the agent: AI configuration → Customize for this agent, then Agent harness → "${setup.buzzHarness.name}". ${finish}`
    : `In Buzz, register a custom harness named "${setup.buzzHarness.name}" with this Command, one Argument per row and the ELECTRON_RUN_AS_NODE env var `
      + `(Agent harness → Add custom harness… where your Buzz build offers it; "AtlasMind: Prepare Buzz Persona Deployment" can register it for you), `
      + `then pick it for the agent. ${finish}`;
}

// ── Registering the harness with Buzz ────────────────────────────────────────
//
// Buzz Desktop 0.5 loads custom harness definitions from JSON files in
// `<app-data>/custom_harnesses/` and re-reads the folder on every discovery
// (`managed_agents/custom_harnesses.rs` at desktop-v0.5.28: "Users drop JSON
// files into <app-data>/custom_harnesses/"). Not every 0.5 build exposes the
// editor that writes those files, so AtlasMind can write one — the documented
// drop-in, never Buzz's agent database — after the person confirms.

/** Tauri's app identifier for Buzz Desktop (`tauri.conf.json`). */
export const BUZZ_DESKTOP_APP_IDENTIFIER = 'xyz.block.buzz.app';
/** Marks a harness file as AtlasMind's, so a later prepare may replace it and nothing else. */
export const ATLASMIND_HARNESS_HINT = 'Registered by AtlasMind for a Buzz persona; prepare the persona again to update it.';
/** Ids Buzz reserves for its compiled-in harnesses; AtlasMind's are prefixed, so they never collide. */
const BUZZ_TIER_ONE_HARNESS_IDS = ['goose', 'claude', 'codex', 'buzz-agent'];

/** A harness file exactly as Buzz deserialises it (`HarnessDefinition`, camelCase). */
export interface BuzzHarnessDefinition {
  id: string;
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  installInstructionsUrl: string;
  installHint: string;
}

/** The harness id for a persona, in Buzz's id alphabet. */
export function buzzHarnessIdFor(personaId: string): string {
  const id = `atlasmind-${personaId}`;
  if (!/^[a-z0-9_][a-z0-9_-]*$/.test(id) || BUZZ_TIER_ONE_HARNESS_IDS.includes(id)) {
    throw new Error(`"${personaId}" cannot be made into a Buzz harness id.`);
  }
  return id;
}

/** The harness file for a recipe. Applies Buzz's own validation, so a file Buzz would skip is never written. */
export function buildBuzzHarnessDefinition(setup: BuzzAcpRuntimeSetup, id: string): BuzzHarnessDefinition {
  if (!/^[a-z0-9_][a-z0-9_-]*$/.test(id)) {
    throw new Error(`Harness id "${id}" is not one Buzz accepts.`);
  }
  if (setup.buzzHarness.arguments.some(arg => arg.includes(','))) {
    throw new Error('A harness argument contains a comma, which Buzz would split at launch.');
  }
  for (const key of Object.keys(setup.buzzHarness.envVars)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /^(BUZZ_|NOSTR_|GIT_CONFIG)/i.test(key)) {
      throw new Error(`Harness env var ${key} is malformed or reserved by Buzz.`);
    }
  }
  return {
    id,
    label: setup.buzzHarness.name,
    command: setup.buzzHarness.command,
    args: [...setup.buzzHarness.arguments],
    env: { ...setup.buzzHarness.envVars },
    installInstructionsUrl: '',
    installHint: ATLASMIND_HARNESS_HINT,
  };
}

/**
 * Buzz's `custom_harnesses` folder: Tauri's app-data directory for its
 * identifier. Read on disk for Windows; macOS and Linux follow Tauri's
 * documented `app_data_dir`. `undefined` when the base cannot be resolved.
 */
export function buzzCustomHarnessDirectory(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string | undefined {
  const base = platform === 'win32'
    ? env['APPDATA']
    : platform === 'darwin'
      ? (home ? path.join(home, 'Library', 'Application Support') : undefined)
      : (env['XDG_DATA_HOME'] || (home ? path.join(home, '.local', 'share') : undefined));
  return base && path.isAbsolute(base) ? path.join(base, BUZZ_DESKTOP_APP_IDENTIFIER, 'custom_harnesses') : undefined;
}

export type BuzzHarnessWritePlan =
  | { kind: 'create' }
  | { kind: 'unchanged' }
  | { kind: 'replace' }
  | { kind: 'refuse'; reason: string };

/**
 * What to do with the file already at the harness's path. AtlasMind replaces
 * only a file it registered itself, and never one Buzz cannot read.
 */
export function planBuzzHarnessWrite(existing: string | undefined, definition: BuzzHarnessDefinition): BuzzHarnessWritePlan {
  if (existing === undefined) {
    return { kind: 'create' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return { kind: 'refuse', reason: 'a file Buzz cannot read is already there, and AtlasMind will not overwrite it' };
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  if (!record || record['id'] !== definition.id || record['installHint'] !== ATLASMIND_HARNESS_HINT) {
    return { kind: 'refuse', reason: 'a harness AtlasMind did not register is already there under that name' };
  }
  return JSON.stringify(record) === JSON.stringify(definition) ? { kind: 'unchanged' } : { kind: 'replace' };
}
