import * as path from 'node:path';

export interface BuzzAcpRuntimeSetup {
  schemaVersion: 1;
  purpose: string;
  buzzFields: {
    provider: 'Custom command';
    agentCommand: string;
    agentArguments: string[];
    agentArgumentsField: string;
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

  return {
    schemaVersion: 1,
    purpose: 'Run AtlasMind as the ACP agent behind a Buzz managed agent.',
    buzzFields: {
      provider: 'Custom command',
      agentCommand,
      agentArguments,
      agentArgumentsField: agentArguments.join(','),
      llmProvider: 'Leave blank — AtlasMind routes models',
      model: 'Leave blank — AtlasMind routes models',
    },
    environment: {
      requiredForLauncher: {
        ELECTRON_RUN_AS_NODE: '1',
      },
      requiredForModels: [
        'ATLASMIND_PROVIDER_OPENAI_APIKEY (OpenAI-compatible provider)',
        'ATLASMIND_PROVIDER_ANTHROPIC_APIKEY (Anthropic provider)',
        'ATLASMIND_LOCAL_OPENAI_BASE_URL (local OpenAI-compatible endpoint)',
      ],
      requiredForRemoteRelay: 'ATLASMIND_BUZZ_ALLOW_REMOTE_RELAY=true (only after reviewing the remote WSS/HTTPS relay)',
      neverCopyFromAtlasMind: 'VS Code SecretStorage values are never exported; enter only the provider variable you intend Buzz to pass.',
    },
  };
}
