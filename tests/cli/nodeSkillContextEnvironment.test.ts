import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeSkillExecutionContext } from '../../src/cli/nodeSkillContext.ts';
import { NodeMemoryManager } from '../../src/cli/nodeMemoryManager.ts';
import { CLI_PASS_ENVIRONMENT_VARIABLE } from '../../src/core/hostCommandEnvironment.ts';

/**
 * A real child process, not a mock: the property is about what a spawned
 * command can read, so the test spawns one and asks it.
 */
const FAKE_KEY = `sk-ant-api03-${'F'.repeat(40)}`;
const PRINT_ENV = [
  '-e',
  'process.stdout.write(JSON.stringify(process.env))',
];
const EXIT_WITH_FAILURE = ['-e', 'process.exit(3)'];

const touched = ['ANTHROPIC_API_KEY', 'ATLASMIND_PROVIDER_OPENAI_APIKEY', 'NPM_TOKEN', 'HARMLESS_SETTING', CLI_PASS_ENVIRONMENT_VARIABLE];

describe('CLI runCommand environment', () => {
  let workspace: string;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'atlasmind-env-'));
    for (const name of touched) {
      saved.set(name, process.env[name]);
    }
    process.env['ANTHROPIC_API_KEY'] = FAKE_KEY;
    process.env['ATLASMIND_PROVIDER_OPENAI_APIKEY'] = 'not-shaped-but-named';
    process.env['NPM_TOKEN'] = 'npm_passed_on_purpose';
    process.env['HARMLESS_SETTING'] = 'kept';
    process.env[CLI_PASS_ENVIRONMENT_VARIABLE] = 'NPM_TOKEN';
  });

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    rmSync(workspace, { recursive: true, force: true });
  });

  it('a model-requested command cannot read the provider keys the CLI was started with', async () => {
    const context = createNodeSkillExecutionContext(workspace, new NodeMemoryManager());
    const result = await context.runCommand(process.execPath, PRINT_ENV, { timeoutMs: 20_000 });
    expect(result.ok).toBe(true);
    const seen = JSON.parse(result.stdout) as Record<string, string>;
    expect(seen['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(seen['ATLASMIND_PROVIDER_OPENAI_APIKEY']).toBeUndefined();
    expect(result.stdout).not.toContain(FAKE_KEY);
    // What a command needs, and what the user passed on purpose, still arrive.
    expect(seen['HARMLESS_SETTING']).toBe('kept');
    expect(seen['NPM_TOKEN']).toBe('npm_passed_on_purpose');
    const pathName = Object.keys(process.env).find(name => name.toUpperCase() === 'PATH');
    expect(pathName && seen[pathName]).toBe(process.env[pathName!]);
  }, 30_000);

  it('a failed command is told which names were withheld, never their values', async () => {
    const context = createNodeSkillExecutionContext(workspace, new NodeMemoryManager());
    const result = await context.runCommand(process.execPath, EXIT_WITH_FAILURE, { timeoutMs: 20_000 });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('ANTHROPIC_API_KEY');
    expect(result.stderr).toContain(CLI_PASS_ENVIRONMENT_VARIABLE);
    expect(result.stderr).not.toContain(FAKE_KEY);
  }, 30_000);
});
