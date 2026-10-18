import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CLI_PASS_ENVIRONMENT_VARIABLE,
  CREDENTIAL_ENV_NAMES,
  HOST_COMMAND_ENV_COVERED_PATHS,
  HOST_COMMAND_ENV_ESSENTIALS,
  HOST_COMMAND_ENV_RULES,
  HOST_COMMAND_ENV_UNCHANGED_PATHS,
  PASS_ENVIRONMENT_SETTING,
  classifyEnvironmentName,
  classifyEnvironmentValue,
  describeWithheldEnvironment,
  parsePassEnvironmentList,
  planHostCommandEnvironment,
  readCliPassEnvironment,
  readPassEnvironmentSetting,
} from '../../src/core/hostCommandEnvironment.ts';
import { SANDBOX_ENV_ALLOWLIST } from '../../src/core/sandboxPlan.ts';
import { redactSecrets } from '../../src/utils/secretRedactor.ts';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Shaped like real credentials so the value detectors fire; none is real.
const FAKE_ANTHROPIC = `sk-ant-api03-${'A'.repeat(40)}`;
const FAKE_GITHUB = `ghp_${'b'.repeat(36)}`;
const FAKE_OPENAI = `sk-proj-${'c'.repeat(40)}`;

describe('the rule table', () => {
  it('declares each rule once, in evaluation order, name rules before value rules', () => {
    const ids = HOST_COMMAND_ENV_RULES.map(rule => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    const firstValue = HOST_COMMAND_ENV_RULES.findIndex(rule => rule.kind === 'value');
    expect(HOST_COMMAND_ENV_RULES.slice(firstValue).every(rule => rule.kind === 'value')).toBe(true);
    expect(HOST_COMMAND_ENV_RULES.filter(rule => rule.effect === 'rewritten').map(rule => rule.id)).toEqual(['proxy-userinfo']);
  });

  it('names every credential variable in the brief by a rule', () => {
    for (const name of [
      ...CREDENTIAL_ENV_NAMES,
      'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'HF_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN',
      'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AZURE_CLIENT_SECRET', 'AZURE_STORAGE_SECRET',
      'GOOGLE_APPLICATION_CREDENTIALS',
    ]) {
      expect(classifyEnvironmentName(name), name).toBeDefined();
    }
  });

  it('lists the variables AtlasMind\'s own adapters read from the environment', () => {
    for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'BUZZ_PRIVATE_KEY']) {
      expect(CREDENTIAL_ENV_NAMES).toContain(name);
      expect(classifyEnvironmentName(name)).toBe(classifyEnvironmentName(name) === 'atlasmind-secret-store' ? 'atlasmind-secret-store' : 'named-credential');
    }
    for (const file of ['src/providers/bedrock.ts', 'src/core/buzzInboundService.ts']) {
      const source = readFileSync(path.join(ROOT_DIR, file), 'utf8');
      for (const [, name] of source.matchAll(/process\.env\['([A-Z0-9_]+)'\]/g)) {
        if (/KEY|TOKEN|SECRET/.test(name!)) {
          expect(CREDENTIAL_ENV_NAMES, `${file} reads ${name}`).toContain(name);
        }
      }
    }
  });
});

describe('classifyEnvironmentName', () => {
  it.each([
    ['ATLASMIND_PROVIDER_ANTHROPIC_APIKEY', 'atlasmind-secret-store'],
    ['ATLASMIND_PROVIDER_BEDROCK_SECRETACCESSKEY', 'atlasmind-secret-store'],
    ['ATLASMIND_INTEGRATION_ELEVENLABS_APIKEY', 'atlasmind-secret-store'],
    ['ATLASMIND_SPECIALIST_RESEARCH_APIKEY', 'atlasmind-secret-store'],
    ['GITHUB_TOKEN', 'named-credential'],
    ['github_token', 'named-credential'],
    ['VSCE_PAT', 'named-credential'],
    ['STRIPE_API_KEY', 'credential-name-suffix'],
    ['MY_APIKEY', 'credential-name-suffix'],
    ['SLACK_BOT_TOKEN', 'credential-name-suffix'],
    ['JWT_SECRET', 'credential-name-suffix'],
    ['APP_SECRET_KEY', 'credential-name-suffix'],
    ['DB_PASSWORD', 'credential-name-suffix'],
    ['FTP_PASSWD', 'credential-name-suffix'],
    ['GPG_PASSPHRASE', 'credential-name-suffix'],
    ['SERVICE_CREDENTIALS', 'credential-name-suffix'],
    ['DEPLOY_PRIVATE_KEY', 'credential-name-suffix'],
    ['AZURE_DEVOPS_PAT', 'credential-name-suffix'],
    ['SENTRY_DSN', 'credential-name-suffix'],
    ['AZURE_STORAGE_CONNECTION_STRING', 'credential-name-suffix'],
    ['AZURE_STORAGE_ACCOUNT_KEY', 'credential-name-suffix'],
    ['npm_config__auth', 'credential-name-suffix'],
    ['npm_config__authToken', 'credential-name-suffix'],
    ['TOKEN', 'credential-name-suffix'],
    ['PASSWORD', 'credential-name-suffix'],
    ['OPENAI_API_KEY_BACKUP', 'credential-name-word'],
    ['GITHUB_TOKEN_FOR_CI', 'credential-name-word'],
    ['OAUTH_CLIENT_SECRET_PROD', 'credential-name-word'],
    ['PASSWORD_FILE', 'credential-name-word'],
  ])('%s → %s', (name, rule) => {
    expect(classifyEnvironmentName(name)).toBe(rule);
  });

  it.each([
    'PATH', 'NODE_OPTIONS', 'HOME', 'GIT_ASKPASS', 'TOKENIZERS_PARALLELISM', 'SECRETS_DIR', 'KEYBOARD_LAYOUT',
    'PATHEXT', 'HOMEPATH', 'ATLASMIND_LOCAL_OPENAI_BASE_URL', 'ATLASMIND_AZURE_OPENAI_ENDPOINT', 'ANTHROPIC_API_VERSION',
    CLI_PASS_ENVIRONMENT_VARIABLE,
  ])('keeps %s', name => {
    expect(classifyEnvironmentName(name)).toBeUndefined();
  });

  it('never withholds an essential by name', () => {
    for (const name of HOST_COMMAND_ENV_ESSENTIALS) {
      expect(classifyEnvironmentName(name), name).toBeUndefined();
    }
  });

  it('agrees with the sandbox: nothing the container allowlist lets cross is credential-shaped', () => {
    for (const name of Object.keys(SANDBOX_ENV_ALLOWLIST)) {
      expect(classifyEnvironmentName(name), name).toBeUndefined();
    }
  });
});

describe('classifyEnvironmentValue', () => {
  it('withholds a secret-shaped value under any name, naming the detector', () => {
    expect(classifyEnvironmentValue('SOME_SETTING', FAKE_ANTHROPIC)).toEqual({
      outcome: 'withhold', rule: 'secret-shaped-value', detectors: ['anthropic-key'],
    });
    expect(classifyEnvironmentValue('DATABASE_URL', 'postgres://admin:hunter2@db.internal:5432/app')).toMatchObject({
      outcome: 'withhold', rule: 'secret-shaped-value',
    });
    expect(classifyEnvironmentValue('LIB_PATH', '/usr/lib')).toEqual({ outcome: 'keep' });
  });

  it('removes proxy credentials and keeps the proxy', () => {
    expect(classifyEnvironmentValue('HTTPS_PROXY', 'http://alice:s3cret@proxy.corp:8080')).toEqual({
      outcome: 'rewrite', rule: 'proxy-userinfo', value: 'http://proxy.corp:8080',
    });
    expect(classifyEnvironmentValue('npm_config_https_proxy', 'http://alice@proxy.corp:3128/')).toEqual({
      outcome: 'rewrite', rule: 'proxy-userinfo', value: 'http://proxy.corp:3128/',
    });
    expect(classifyEnvironmentValue('HTTP_PROXY', 'http://proxy.corp:8080')).toEqual({ outcome: 'keep' });
    expect(classifyEnvironmentValue('NO_PROXY', 'localhost,127.0.0.1,.corp')).toEqual({ outcome: 'keep' });
  });

  it('withholds a proxy value with @ that is not a URL rather than guessing', () => {
    expect(classifyEnvironmentValue('HTTP_PROXY', 'alice:pw@proxy:8080')).toMatchObject({ outcome: 'withhold', rule: 'proxy-unreadable' });
  });
});

describe('pass-through settings', () => {
  it('validates names exactly and reports the rest, never cleaning one into shape', () => {
    expect(parsePassEnvironmentList(['NPM_TOKEN', ' GH_TOKEN', 'A-B', '1ABC', 42, 'NPM_TOKEN', 'HF_TOKEN'])).toEqual({
      names: ['NPM_TOKEN', 'HF_TOKEN'],
      invalid: ['" GH_TOKEN"', '"A-B"', '"1ABC"', 'a number value'],
    });
    expect(parsePassEnvironmentList('NPM_TOKEN')).toEqual({ names: [], invalid: ['"NPM_TOKEN"'] });
    expect(parsePassEnvironmentList(undefined)).toEqual({ names: [], invalid: [] });
  });

  it('reads only the user value; a repository cannot add a name', () => {
    const reading = readPassEnvironmentSetting({
      globalValue: ['NPM_TOKEN'],
      workspaceValue: ['ANTHROPIC_API_KEY'],
      workspaceFolderValue: ['GITHUB_TOKEN'],
    });
    expect(reading.names).toEqual(['NPM_TOKEN']);
    expect(reading.ignored).toHaveLength(1);
    expect(reading.ignored[0]).toContain(PASS_ENVIRONMENT_SETTING);
    expect(readPassEnvironmentSetting({ workspaceValue: ['ANTHROPIC_API_KEY'] }).names).toEqual([]);
    expect(readPassEnvironmentSetting(undefined)).toEqual({ names: [], invalid: [], ignored: [] });
  });

  it('reads the CLI list from its own variable', () => {
    expect(readCliPassEnvironment({ [CLI_PASS_ENVIRONMENT_VARIABLE]: 'NPM_TOKEN,,GH_TOKEN,bad name' })).toEqual({
      names: ['NPM_TOKEN', 'GH_TOKEN'], invalid: ['"bad name"'], ignored: [],
    });
    expect(readCliPassEnvironment({}).names).toEqual([]);
  });
});

describe('planHostCommandEnvironment', () => {
  const source = {
    PATH: '/usr/bin:/bin',
    HOME: '/home/dev',
    NODE_OPTIONS: '--max-old-space-size=4096',
    ANTHROPIC_API_KEY: FAKE_ANTHROPIC,
    GITHUB_TOKEN: FAKE_GITHUB,
    INNOCENT_LOOKING: FAKE_OPENAI,
    HTTPS_PROXY: 'http://alice:s3cret@proxy.corp:8080',
    NPM_TOKEN: 'npm_abc',
    UNDEFINED_ONE: undefined,
  };

  it('withholds credentials, rewrites proxies, keeps the rest, and names every rule', () => {
    const plan = planHostCommandEnvironment(source, { platform: 'linux' });
    expect(plan.env).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: '/home/dev',
      NODE_OPTIONS: '--max-old-space-size=4096',
      HTTPS_PROXY: 'http://proxy.corp:8080',
    });
    expect(plan.withheld).toEqual([
      { name: 'ANTHROPIC_API_KEY', rule: 'named-credential' },
      { name: 'GITHUB_TOKEN', rule: 'named-credential' },
      { name: 'INNOCENT_LOOKING', rule: 'secret-shaped-value', detectors: ['openai-key'] },
      { name: 'NPM_TOKEN', rule: 'named-credential' },
    ]);
    expect(plan.rewritten).toEqual([{ name: 'HTTPS_PROXY', rule: 'proxy-userinfo' }]);
    expect(plan.passedThrough).toEqual([]);
  });

  it('never returns process.env itself', () => {
    expect(planHostCommandEnvironment(process.env).env).not.toBe(process.env);
  });

  it('passes a listed name unchanged — exact on POSIX, any casing on Windows', () => {
    const linux = planHostCommandEnvironment(source, { passThrough: ['npm_token', 'GITHUB_TOKEN'], platform: 'linux' });
    expect(linux.env['GITHUB_TOKEN']).toBe(FAKE_GITHUB);
    expect(linux.env['NPM_TOKEN']).toBeUndefined();
    expect(linux.passedThrough).toEqual(['GITHUB_TOKEN']);

    const windows = planHostCommandEnvironment(source, { passThrough: ['npm_token'], platform: 'win32' });
    expect(windows.env['NPM_TOKEN']).toBe('npm_abc');
    expect(windows.passedThrough).toEqual(['NPM_TOKEN']);
  });

  it('ignores a pass-through entry that is not a plain name', () => {
    const plan = planHostCommandEnvironment({ 'A B': 'x', NPM_TOKEN: 'y' }, { passThrough: ['A B', 'NPM_TOKEN '], platform: 'linux' });
    expect(plan.passedThrough).toEqual([]);
    expect(plan.env['NPM_TOKEN']).toBeUndefined();
  });

  const nameArb = fc.oneof(
    fc.constantFrom(...CREDENTIAL_ENV_NAMES, ...HOST_COMMAND_ENV_ESSENTIALS, 'MY_API_KEY', 'db_password', 'SOME_TOKEN', 'FOO', 'HTTP_PROXY'),
    fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,20}$/),
  );
  const valueArb = fc.oneof(
    fc.string({ maxLength: 40 }),
    fc.constantFrom(FAKE_ANTHROPIC, FAKE_GITHUB, FAKE_OPENAI, 'http://u:p@proxy:1', 'Bearer abcdefghijklmnopqrstuvwxyz0123', '/usr/bin'),
  );
  const envArb = fc.dictionary(nameArb, valueArb, { maxKeys: 25 });
  const platformArb = fc.constantFrom<NodeJS.Platform>('linux', 'darwin', 'win32');

  it('property: no credential-shaped name survives unless explicitly passed', () => {
    fc.assert(fc.property(envArb, fc.subarray(['NPM_TOKEN', 'GITHUB_TOKEN', 'MY_API_KEY']), platformArb, (env, pass, platform) => {
      const plan = planHostCommandEnvironment(env, { passThrough: pass, platform });
      const passed = new Set(pass.map(name => (platform === 'win32' ? name.toUpperCase() : name)));
      for (const name of Object.keys(plan.env)) {
        const folded = platform === 'win32' ? name.toUpperCase() : name;
        if (!passed.has(folded)) {
          expect(classifyEnvironmentName(name)).toBeUndefined();
        }
      }
    }));
  });

  it('property: no value the secret detector flags survives unless explicitly passed', () => {
    fc.assert(fc.property(envArb, platformArb, (env, platform) => {
      const plan = planHostCommandEnvironment(env, { platform });
      for (const value of Object.values(plan.env)) {
        expect(redactSecrets(value).redactedCount).toBe(0);
      }
    }));
  });

  it('property: every variable is kept, rewritten or withheld — none disappears without a rule', () => {
    fc.assert(fc.property(envArb, platformArb, (env, platform) => {
      const plan = planHostCommandEnvironment(env, { platform });
      const accounted = new Set([...Object.keys(plan.env), ...plan.withheld.map(entry => entry.name)]);
      expect([...accounted].sort()).toEqual(Object.keys(env).sort());
      for (const entry of plan.withheld) {
        expect(HOST_COMMAND_ENV_RULES.map(rule => rule.id)).toContain(entry.rule);
        expect(plan.env[entry.name]).toBeUndefined();
      }
    }));
  });

  it('property: essentials with ordinary values are preserved exactly', () => {
    const essential = fc.constantFrom(...HOST_COMMAND_ENV_ESSENTIALS);
    const ordinary = fc.stringMatching(/^[A-Za-z0-9 :;/\\._-]{0,40}$/);
    fc.assert(fc.property(fc.dictionary(essential, ordinary), platformArb, (env, platform) => {
      const plan = planHostCommandEnvironment(env, { platform });
      expect(plan.env).toEqual(env);
    }));
  });
});

describe('describeWithheldEnvironment', () => {
  it('names the variables and rules, never a value, and says how to pass one', () => {
    const plan = planHostCommandEnvironment({
      ANTHROPIC_API_KEY: FAKE_ANTHROPIC,
      HTTPS_PROXY: 'http://alice:s3cret@proxy:8080',
      PATH: '/bin',
    }, { platform: 'linux' });
    const note = describeWithheldEnvironment(plan)!;
    expect(note).toContain('ANTHROPIC_API_KEY (named-credential)');
    expect(note).toContain('HTTPS_PROXY');
    expect(note).toContain(PASS_ENVIRONMENT_SETTING);
    expect(note).not.toContain(FAKE_ANTHROPIC);
    expect(note).not.toContain('s3cret');
    expect(describeWithheldEnvironment(plan, `add it to ${CLI_PASS_ENVIRONMENT_VARIABLE}`)).toContain(CLI_PASS_ENVIRONMENT_VARIABLE);
  });

  it('is silent when nothing was withheld, and caps a long list', () => {
    expect(describeWithheldEnvironment(planHostCommandEnvironment({ PATH: '/bin' }, { platform: 'linux' }))).toBeUndefined();
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`X${index}_TOKEN`, 'v']));
    expect(describeWithheldEnvironment(planHostCommandEnvironment(many, { platform: 'linux' }))).toContain('and 8 more');
  });
});

describe('where the policy applies', () => {
  it('states a covered row and an unchanged row for every path, with no id twice', () => {
    const ids = [...HOST_COMMAND_ENV_COVERED_PATHS, ...HOST_COMMAND_ENV_UNCHANGED_PATHS].map(row => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(HOST_COMMAND_ENV_UNCHANGED_PATHS.map(row => row.id)).toEqual(
      expect.arrayContaining(['operator-surfaces', 'managed-terminal-follow-up', 'debug-launch', 'sandbox']),
    );
  });

  it('every covered file really plans the environment', () => {
    for (const row of HOST_COMMAND_ENV_COVERED_PATHS) {
      expect(readFileSync(path.join(ROOT_DIR, row.file), 'utf8'), row.id).toContain('planHostCommandEnvironment(process.env');
    }
  });

  it('runCommand\'s host path reads process.env only through the plan', () => {
    const source = readFileSync(path.join(ROOT_DIR, 'src', 'extension.ts'), 'utf8');
    const start = source.indexOf('const resolution = resolveWorkspaceCommand(');
    const end = source.indexOf('testResourceBudget() {', start);
    const hostPath = source.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(hostPath.match(/process\.env/g)).toEqual(['process.env']);
    expect(hostPath).toContain('planHostCommandEnvironment(process.env');
    expect(hostPath).toContain('env: env as NodeJS.ProcessEnv');
  });

  it('the CLI runCommand reads process.env only through the plan', () => {
    const source = readFileSync(path.join(ROOT_DIR, 'src', 'cli', 'nodeSkillContext.ts'), 'utf8');
    const start = source.indexOf('async runCommand(');
    const end = source.indexOf('async getGitStatus()', start);
    const body = source.slice(start, end)
      .replace('planHostCommandEnvironment(process.env', '')
      .replace('readCliPassEnvironment(process.env)', '');
    expect(start).toBeGreaterThan(0);
    expect(body).not.toContain('process.env');
  });

  it('the ACP agent process is never started with the whole process.env', () => {
    const source = readFileSync(path.join(ROOT_DIR, 'src', 'providers', 'acp.ts'), 'utf8');
    expect(source).not.toContain('...process.env');
    expect(source).toContain('passThrough: options?.passEnvironment ?? []');
  });
});
