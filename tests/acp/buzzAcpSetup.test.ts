import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ATLASMIND_HARNESS_HINT,
  BUZZ_DESKTOP_RECIPE_VERIFIED_VERSION,
  buildBuzzAcpRuntimeSetup,
  buildBuzzHarnessDefinition,
  buzzCustomHarnessDirectory,
  buzzHarnessIdFor,
  describeBuzzHarnessSteps,
  planBuzzHarnessWrite,
} from '../../src/acp/buzzAcpSetup.ts';

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

  it('describes the steps in Buzz 0.5\'s own words, registered or not', () => {
    const setup = buildBuzzAcpRuntimeSetup({ ...base, harnessName: 'AtlasMind AM Engineer' });
    const registered = describeBuzzHarnessSteps(setup, true);
    expect(registered).toMatch(/Agent harness → "AtlasMind AM Engineer"/);
    expect(registered).toMatch(/Parallelism to 1/);
    expect(registered).not.toMatch(/Add custom harness/);
    const byHand = describeBuzzHarnessSteps(setup);
    expect(byHand).toMatch(/where your Buzz build offers it/);
    expect(byHand).toMatch(/Prepare Buzz Persona Deployment" can register it/);
    for (const text of [registered, byHand]) {
      expect(text).not.toMatch(/Provider → Custom command|Agent runtime args/);
    }
  });
});

describe('registering the harness with Buzz', () => {
  const setup = buildBuzzAcpRuntimeSetup({ ...base, personaManifestPath: path.resolve('storage', 'am-engineer.json'), harnessName: 'AtlasMind AM Engineer' });

  it('writes the file Buzz deserialises, marked as AtlasMind\'s', () => {
    const definition = buildBuzzHarnessDefinition(setup, buzzHarnessIdFor('am-engineer'));
    expect(definition).toEqual({
      id: 'atlasmind-am-engineer',
      label: 'AtlasMind AM Engineer',
      command: setup.buzzHarness.command,
      args: setup.buzzHarness.arguments,
      env: { ELECTRON_RUN_AS_NODE: '1' },
      installInstructionsUrl: '',
      installHint: ATLASMIND_HARNESS_HINT,
    });
  });

  it('refuses what Buzz would skip: a bad id, a comma in an argument, a reserved env var', () => {
    expect(() => buildBuzzHarnessDefinition(setup, 'AtlasMind AM')).toThrow(/not one Buzz accepts/);
    expect(() => buildBuzzHarnessDefinition({ ...setup, buzzHarness: { ...setup.buzzHarness, arguments: ['a,b'] } }, 'atlasmind-x')).toThrow(/comma/);
    expect(() => buildBuzzHarnessDefinition({ ...setup, buzzHarness: { ...setup.buzzHarness, envVars: { BUZZ_PRIVATE_KEY: 'x' } } }, 'atlasmind-x')).toThrow(/reserved/);
    expect(() => buzzHarnessIdFor('AM Engineer')).toThrow();
  });

  it('creates a new file, leaves an identical one, replaces only its own, and never a foreign or unreadable one', () => {
    const definition = buildBuzzHarnessDefinition(setup, 'atlasmind-am-engineer');
    expect(planBuzzHarnessWrite(undefined, definition)).toEqual({ kind: 'create' });
    expect(planBuzzHarnessWrite(JSON.stringify(definition, null, 2), definition)).toEqual({ kind: 'unchanged' });
    expect(planBuzzHarnessWrite(JSON.stringify({ ...definition, args: ['old'] }), definition)).toEqual({ kind: 'replace' });
    expect(planBuzzHarnessWrite(JSON.stringify({ ...definition, installHint: 'mine' }), definition)).toMatchObject({ kind: 'refuse' });
    expect(planBuzzHarnessWrite('{', definition)).toMatchObject({ kind: 'refuse', reason: expect.stringMatching(/cannot read/) });
  });

  it('finds Buzz\'s folder under each platform\'s app-data directory', () => {
    expect(buzzCustomHarnessDirectory('win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'C:\\Users\\me'))
      .toBe(path.join('C:\\Users\\me\\AppData\\Roaming', 'xyz.block.buzz.app', 'custom_harnesses'));
    expect(buzzCustomHarnessDirectory('linux', {}, '/home/me')).toBe(path.join('/home/me', '.local', 'share', 'xyz.block.buzz.app', 'custom_harnesses'));
    expect(buzzCustomHarnessDirectory('win32', {}, '')).toBeUndefined();
  });

  it('refuses paths Buzz would split at a comma', () => {
    expect(() => buildBuzzAcpRuntimeSetup({ ...base, workspaceRoot: path.resolve('workspace,other') })).toThrow(/comma/i);
  });
});
