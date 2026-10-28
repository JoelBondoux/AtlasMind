import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildBuzzAcpRuntimeSetup } from '../../src/acp/buzzAcpSetup.ts';

describe('buildBuzzAcpRuntimeSetup', () => {
  it('builds the exact custom-provider fields without credentials', () => {
    const setup = buildBuzzAcpRuntimeSetup({
      workspaceRoot: path.resolve('workspace'),
      runtimeExecutable: path.resolve('runtime', 'Code.exe'),
      agentEntrypoint: path.resolve('storage', 'bin', 'atlasmind-acp-runner.js'),
    });

    expect(setup.buzzFields).toMatchObject({
      provider: 'Custom command',
      agentCommand: path.resolve('runtime', 'Code.exe'),
      agentArguments: [
        path.resolve('storage', 'bin', 'atlasmind-acp-runner.js'),
        '--workspace',
        path.resolve('workspace'),
        '--buzz-auto-reply',
      ],
      llmProvider: 'Leave blank — AtlasMind routes models',
      model: 'Leave blank — AtlasMind routes models',
    });
    expect(setup.buzzFields.agentArgumentsField).toBe(
      `${path.resolve('storage', 'bin', 'atlasmind-acp-runner.js')},--workspace,${path.resolve('workspace')},--buzz-auto-reply`,
    );
    expect(setup.environment.requiredForLauncher).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(JSON.stringify(setup)).not.toMatch(/nsec1|private.?key|api.?key["']?\s*:/i);
  });

  it('names a persona manifest when one is given, and validates its path the same way', () => {
    const base = {
      workspaceRoot: path.resolve('workspace'),
      runtimeExecutable: path.resolve('runtime', 'Code.exe'),
      agentEntrypoint: path.resolve('storage', 'bin', 'atlasmind-acp-runner.js'),
    };
    const setup = buildBuzzAcpRuntimeSetup({ ...base, personaManifestPath: path.resolve('storage', 'buzz-personas', 'am-engineer.json') });
    expect(setup.buzzFields.agentArguments.slice(-2)).toEqual(['--buzz-persona-manifest', path.resolve('storage', 'buzz-personas', 'am-engineer.json')]);
    expect(setup.purpose).toMatch(/persona/);
    expect(() => buildBuzzAcpRuntimeSetup({ ...base, personaManifestPath: 'relative.json' })).toThrow(/absolute/);
  });

  it('refuses paths Buzz cannot represent safely in its comma-separated field', () => {
    expect(() => buildBuzzAcpRuntimeSetup({
      workspaceRoot: path.resolve('workspace,other'),
      runtimeExecutable: path.resolve('runtime', 'Code.exe'),
      agentEntrypoint: path.resolve('storage', 'bin', 'atlasmind-acp-runner.js'),
    })).toThrow(/comma/i);
  });
});
