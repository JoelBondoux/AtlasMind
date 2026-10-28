import * as path from 'node:path';

export interface BuzzAcpRuntimeSetup {
  schemaVersion: 1;
  purpose: string;
  /** Named as Buzz Desktop's agent editor labels them (verified against 0.5.28). */
  buzzFields: {
    provider: 'Custom command';
    agentCommand: string;
    agentArguments: string[];
    /** Advanced → "Agent runtime args", which Buzz stores comma-separated. */
    agentArgumentsField: string;
    /**
     * Advanced → "Parallelism". Buzz starts this many copies of the command;
     * AtlasMind schedules its own work, so one is enough and more only start
     * idle runtimes — each with its own subscription agents once asked.
     */
    parallelism: 1;
    llmProvider: 'Leave blank — AtlasMind routes models';
    model: 'Leave blank — AtlasMind routes models';
  };
  environment: {
    requiredForLauncher: Record<'ELECTRON_RUN_AS_NODE', '1'>;
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
}

function requireSafeAbsolutePath(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  if (/[\0\r\n,]/.test(trimmed)) {
    throw new Error(`${label} cannot contain a NUL, newline, or comma because Buzz stores agent arguments as a comma-separated field.`);
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
  const agentCommand = requireSafeAbsolutePath(options.runtimeExecutable, 'Runtime executable');
  const agentEntrypoint = requireSafeAbsolutePath(options.agentEntrypoint, 'Agent entrypoint');
  const agentArguments = [agentEntrypoint, '--workspace', workspaceRoot, '--buzz-auto-reply'];
  if (options.personaManifestPath !== undefined) {
    agentArguments.push('--buzz-persona-manifest', requireSafeAbsolutePath(options.personaManifestPath, 'Persona manifest'));
  }

  return {
    schemaVersion: 1,
    purpose: options.personaManifestPath === undefined
      ? 'Run AtlasMind as the ACP agent behind a Buzz managed agent.'
      : 'Run one AtlasMind persona as the ACP agent behind a Buzz managed agent.',
    buzzFields: {
      provider: 'Custom command',
      agentCommand,
      agentArguments,
      agentArgumentsField: agentArguments.join(','),
      parallelism: 1,
      llmProvider: 'Leave blank — AtlasMind routes models',
      model: 'Leave blank — AtlasMind routes models',
    },
    environment: {
      requiredForLauncher: {
        ELECTRON_RUN_AS_NODE: '1',
      },
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
