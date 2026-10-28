import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { BUZZ_DESKTOP_RECIPE_VERIFIED_VERSION, buildBuzzAcpRuntimeSetup, describeBuzzHarnessSteps } from '../../src/acp/buzzAcpSetup.ts';

const base = {
  workspaceRoot: path.resolve('workspace'),
  runtimeExecutable: path.resolve('runtime', 'Code.exe'),
  agentEntrypoint: path.resolve('storage', 'bin', 'atlasmind-acp-runner.js'),
};

describe('buildBuzzAcpRuntimeSetup', () => {
  it('builds Buzz 0.5\'s custom-harness fields, one argument per row, without credentials', () => {
    const setup = buildBuzzAcpRuntimeSetup(base);

    expect(setup.schemaVersion).toBe(2);
    expect(setup.buzzHarness).toEqual({
      where: 'Edit agent → AI configuration: Customize for this agent → Agent harness → Add custom harness…',
      name: 'AtlasMind',
      command: path.resolve('runtime', 'Code.exe'),
      arguments: [
        path.resolve('storage', 'bin', 'atlasmind-acp-runner.js'),
        '--workspace',
        path.resolve('workspace'),
        '--buzz-auto-reply',
      ],
      envVars: { ELECTRON_RUN_AS_NODE: '1' },
    });
    expect(setup.buzzAgent.parallelism).toBe(1);
    expect(setup.buzzAgent.model).toMatch(/Any value.*never sent it/);
    expect(JSON.stringify(setup)).not.toMatch(/nsec1|private.?key|api.?key["']?\s*:/i);
    expect(BUZZ_DESKTOP_RECIPE_VERIFIED_VERSION).toBe('0.5.28');
  });

  it('names a persona manifest and a harness of its own, and validates the path the same way', () => {
    const manifest = path.resolve('storage', 'buzz-personas', 'am-engineer.json');
    const setup = buildBuzzAcpRuntimeSetup({ ...base, personaManifestPath: manifest, harnessName: 'AtlasMind AM Engineer' });
    expect(setup.buzzHarness.arguments.slice(-2)).toEqual(['--buzz-persona-manifest', manifest]);
    expect(setup.buzzHarness.name).toBe('AtlasMind AM Engineer');
    expect(setup.purpose).toMatch(/persona/);
    expect(() => buildBuzzAcpRuntimeSetup({ ...base, personaManifestPath: 'relative.json' })).toThrow(/absolute/);
  });

  it('says no model variable is needed when the manifest names ACP agents', () => {
    const personaManifestPath = path.resolve('storage', 'buzz-personas', 'am-engineer.json');
    const withAgents = buildBuzzAcpRuntimeSetup({ ...base, personaManifestPath, manifestAcpAgentIds: ['codex', 'claude'] });
    expect(withAgents.environment.requiredForModels).toEqual([expect.stringMatching(/^None — .*codex, claude.*signed in/)]);
    expect(buildBuzzAcpRuntimeSetup({ ...base, personaManifestPath }).environment.requiredForModels).toEqual(
      expect.arrayContaining([expect.stringMatching(/ATLASMIND_PROVIDER_ANTHROPIC_APIKEY/)]),
    );
  });

  it('describes the steps in Buzz 0.5\'s own words', () => {
    const steps = describeBuzzHarnessSteps(buildBuzzAcpRuntimeSetup({ ...base, harnessName: 'AtlasMind AM Engineer' }));
    expect(steps).toMatch(/Agent harness → Add custom harness…/);
    expect(steps).toMatch(/"AtlasMind AM Engineer"/);
    expect(steps).toMatch(/Parallelism to 1/);
    expect(steps).not.toMatch(/Provider → Custom command|Agent runtime args/);
  });

  it('refuses paths Buzz would split at a comma', () => {
    expect(() => buildBuzzAcpRuntimeSetup({ ...base, workspaceRoot: path.resolve('workspace,other') })).toThrow(/comma/i);
  });
});
