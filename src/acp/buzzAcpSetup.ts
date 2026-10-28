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

/** The one sentence every surface uses to say where the recipe goes. */
export function describeBuzzHarnessSteps(setup: BuzzAcpRuntimeSetup): string {
  return `In Buzz, edit the agent: ${setup.buzzHarness.where}. Name it "${setup.buzzHarness.name}", paste the Command, add each Argument as its own row `
    + `and the ELECTRON_RUN_AS_NODE env var, then save. Type any Model (AtlasMind routes models) and set Advanced → Parallelism to 1.`;
}
