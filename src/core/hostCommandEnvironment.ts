/**
 * The environment a model-requested command is started with on the host —
 * decided before anything is spawned, by declared rules a test can walk.
 *
 * `runCommand` used to hand every agent command the extension host's **whole**
 * `process.env`. That environment is the one the editor was started with, so it
 * carries whatever the user's shell exported: `ANTHROPIC_API_KEY`,
 * `OPENAI_API_KEY`, `GITHUB_TOKEN`, `AWS_*`, npm tokens. A model — possibly one
 * steered by text it was asked to read — could run `env`, `printenv` or
 * `node -e "console.log(process.env)"` and read them back. Output redaction
 * catches the shapes it knows and is a second line, not the boundary: the
 * boundary is that the value never reaches the child at all.
 *
 * The sandbox already answered this for the container (`SANDBOX_ENV_ALLOWLIST`
 * in `sandboxPlan.ts`): only named variables cross. The host cannot use an
 * allowlist — a host command needs `PATH`, the Windows system variables, the
 * toolchain homes, and whatever the user's own setup relies on — so the host
 * answer is the inverse, and this module is the **one** home of "which
 * environment names are credentials". Six rules:
 *
 * 1. **A credential-shaped name is withheld.** Declared patterns
 *    (`*_API_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_PRIVATE_KEY`, …),
 *    the variables AtlasMind's own provider adapters and CLI secret store read,
 *    and a short list of well-known names. Matched case-insensitively on every
 *    platform, because `anthropic_api_key` holds the same thing.
 * 2. **A secret-shaped value is withheld under any name.** The detectors are
 *    `secretRedactor.ts`'s, reused rather than restated, so the output
 *    redactor and this boundary cannot disagree about what a key looks like.
 * 3. **A proxy keeps its address and loses its credentials.** `*_PROXY` with
 *    `user:pass@` has the userinfo removed rather than the variable dropped —
 *    a proxy the command cannot reach is a broken build, a password in it is a
 *    leak. A proxy value carrying `@` that does not parse as a URL is withheld,
 *    because stripping text out of something that is not a URL is guessing.
 * 4. **Every withheld variable names the rule that withheld it**, and the
 *    names (never the values) can be shown to the person whose command failed.
 * 5. **Pass-through is explicit, exact and the user's.** A name listed in
 *    `atlasmind.terminal.passEnvironment` is passed unchanged. The setting is
 *    machine-scoped and only the user value is read, so a repository cannot add
 *    a name to it; an entry that is not a plain variable name is reported,
 *    never cleaned into one.
 * 6. **Only model-requested executions are covered.** What a person starts
 *    themselves — their own terminal, a routine they were shown and ran, a
 *    Delivery run plan, a promotion — keeps their environment, because they
 *    chose the command and may legitimately need their own token for it.
 *    `HOST_COMMAND_ENV_COVERED_PATHS` and `HOST_COMMAND_ENV_UNCHANGED_PATHS`
 *    state the line.
 *
 * Pure: no `vscode`, no `child_process`, no I/O.
 */

import { redactSecrets } from '../utils/secretRedactor.js';

// ── Rules ────────────────────────────────────────────────────────

export type HostCommandEnvRuleId =
  | 'atlasmind-secret-store'
  | 'named-credential'
  | 'credential-name-suffix'
  | 'credential-name-word'
  | 'proxy-userinfo'
  | 'proxy-unreadable'
  | 'secret-shaped-value';

export interface HostCommandEnvRule {
  id: HostCommandEnvRuleId;
  /** What the rule looks at. */
  kind: 'name' | 'value';
  /** `withheld`: the variable is not passed. `rewritten`: it is passed with credentials removed. */
  effect: 'withheld' | 'rewritten';
  description: string;
}

/** Evaluated in this order; the first rule that matches names the outcome. */
export const HOST_COMMAND_ENV_RULES: readonly HostCommandEnvRule[] = [
  {
    id: 'atlasmind-secret-store',
    kind: 'name',
    effect: 'withheld',
    description: 'A variable the AtlasMind CLI reads a stored secret from (ATLASMIND_PROVIDER_*, ATLASMIND_INTEGRATION_*, ATLASMIND_SPECIALIST_*).',
  },
  {
    id: 'named-credential',
    kind: 'name',
    effect: 'withheld',
    description: 'A well-known credential variable, or one AtlasMind\'s own provider adapters read (see CREDENTIAL_ENV_NAMES).',
  },
  {
    id: 'credential-name-suffix',
    kind: 'name',
    effect: 'withheld',
    description: 'A name ending in a credential word: _API_KEY, _APIKEY, _TOKEN, _SECRET, _SECRET_KEY, _ACCESS_KEY(_ID), _PRIVATE_KEY, _PASSWORD, _PASSWD, _PASSPHRASE, _CREDENTIALS, _PAT, _DSN, _CONNECTION_STRING, _AUTH, or an account/storage/signing key.',
  },
  {
    id: 'credential-name-word',
    kind: 'name',
    effect: 'withheld',
    description: 'A name containing a credential word elsewhere: AUTH_TOKEN, API_KEY, SECRET_KEY, PRIVATE_KEY, CLIENT_SECRET, PASSWORD, or a TOKEN_ / SECRET_ segment.',
  },
  {
    id: 'proxy-userinfo',
    kind: 'value',
    effect: 'rewritten',
    description: 'A *_PROXY URL carrying user:password@ — passed with the userinfo removed, so the proxy still works and the password does not travel.',
  },
  {
    id: 'proxy-unreadable',
    kind: 'value',
    effect: 'withheld',
    description: 'A *_PROXY value carrying @ that does not parse as a URL. Removing credentials from something that is not a URL would be guessing.',
  },
  {
    id: 'secret-shaped-value',
    kind: 'value',
    effect: 'withheld',
    description: 'A value the secret redactor recognises (a provider key, a GitHub token, a bearer token, a PEM private key, a connection string with a password), under any name.',
  },
];

/**
 * Named credential variables. Most also match a pattern rule; they are listed
 * so the commonest cases are checked by name in a test, and so the variables
 * AtlasMind's own adapters read are stated rather than inferred.
 */
export const CREDENTIAL_ENV_NAMES: readonly string[] = [
  // Read by AtlasMind's own adapters (src/providers/bedrock.ts, src/core/buzzInboundService.ts).
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'BUZZ_PRIVATE_KEY',
  // The vendors AtlasMind routes to, by the names their own SDKs read.
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'AZURE_OPENAI_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CODEX_API_KEY',
  'COHERE_API_KEY',
  'DEEPSEEK_API_KEY',
  'ELEVENLABS_API_KEY',
  'EXA_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'HUGGING_FACE_HUB_TOKEN',
  'MISTRAL_API_KEY',
  'NVIDIA_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'PERPLEXITY_API_KEY',
  'XAI_API_KEY',
  'ZAI_API_KEY',
  // Registries, forges and clouds.
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'HF_TOKEN',
  'NODE_AUTH_TOKEN',
  'NPM_TOKEN',
  'OVSX_PAT',
  'VSCE_PAT',
];

/**
 * What ordinary development commands need, and what no rule here may withhold
 * by name. A value that is itself secret-shaped is still withheld — a key
 * pasted into `NODE_OPTIONS` is still a key — which is why this list is
 * asserted against the name rules only.
 */
export const HOST_COMMAND_ENV_ESSENTIALS: readonly string[] = [
  'PATH', 'Path', 'PATHEXT',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'SystemRoot', 'SystemDrive', 'windir', 'ComSpec',
  'TEMP', 'TMP', 'TMPDIR',
  'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
  'USER', 'USERNAME', 'LOGNAME', 'SHELL', 'TERM',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR',
  'CI', 'NODE_ENV', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'FORCE_COLOR', 'NO_COLOR',
  'npm_config_cache', 'npm_config_registry', 'npm_config_prefix',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  'JAVA_HOME', 'GOPATH', 'GOROOT', 'CARGO_HOME', 'RUSTUP_HOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'DOTNET_ROOT',
  // A socket grants use, not disclosure: git over ssh and the docker skill need these.
  'SSH_AUTH_SOCK', 'DOCKER_HOST',
];

/** The setting that lists names to pass through. Machine-scoped; only the user value is read. */
export const PASS_ENVIRONMENT_SETTING = 'atlasmind.terminal.passEnvironment';
/** The CLI has no settings store; its pass-through list is this variable, comma-separated. */
export const CLI_PASS_ENVIRONMENT_VARIABLE = 'ATLASMIND_PASS_ENVIRONMENT';

/** A plain variable name. Validated exactly — never trimmed or cleaned into shape. */
const PASS_THROUGH_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_PASS_THROUGH = 64;

const SECRET_STORE_NAME = /^ATLASMIND_(?:PROVIDER|INTEGRATION|SPECIALIST)_/;
const CREDENTIAL_SUFFIX = new RegExp(
  '(?:API_?KEY|SECRET(?:_?ACCESS)?_?KEY|ACCESS_?KEY(?:_?ID)?|PRIVATE_?KEY'
  + '|(?:ACCOUNT|STORAGE|MASTER|SIGNING|ENCRYPTION)_?KEY'
  + '|TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIALS?'
  + '|(?:^|_)PAT|(?:^|_)DSN|CONNECTION_?STRING|(?:^|_)AUTH)$',
);
const CREDENTIAL_WORD = /AUTH_?TOKEN|API_?KEY|SECRET_?KEY|PRIVATE_?KEY|CLIENT_?SECRET|PASSWORD|(?:^|_)TOKEN_|(?:^|_)SECRET_/;
const PROXY_NAME = /(?:^|_)PROXY$/;
const NAMED = new Set(CREDENTIAL_ENV_NAMES.map(name => name.toUpperCase()));

// ── Classification ───────────────────────────────────────────────

export type HostCommandEnvNameRuleId = Extract<
  HostCommandEnvRuleId,
  'atlasmind-secret-store' | 'named-credential' | 'credential-name-suffix' | 'credential-name-word'
>;

/**
 * Whether an environment variable *name* is a credential, and by which rule.
 * The single answer to that question in AtlasMind; `undefined` means no name
 * rule matched (the value may still be withheld).
 */
export function classifyEnvironmentName(name: string): HostCommandEnvNameRuleId | undefined {
  const upper = name.toUpperCase();
  if (SECRET_STORE_NAME.test(upper)) {
    return 'atlasmind-secret-store';
  }
  if (NAMED.has(upper)) {
    return 'named-credential';
  }
  if (CREDENTIAL_SUFFIX.test(upper)) {
    return 'credential-name-suffix';
  }
  if (CREDENTIAL_WORD.test(upper)) {
    return 'credential-name-word';
  }
  return undefined;
}

export type HostCommandEnvValueVerdict =
  | { outcome: 'keep' }
  | { outcome: 'rewrite'; rule: 'proxy-userinfo'; value: string }
  | { outcome: 'withhold'; rule: 'proxy-unreadable' | 'secret-shaped-value'; detectors?: string[] };

/** The value rules, for a variable whose name no name rule withheld. */
export function classifyEnvironmentValue(name: string, value: string): HostCommandEnvValueVerdict {
  let candidate = value;
  let rewritten = false;
  if (PROXY_NAME.test(name.toUpperCase()) && value.includes('@')) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(value);
    } catch {
      parsed = undefined;
    }
    if (!parsed || (parsed.username === '' && parsed.password === '')) {
      // `@` with no readable userinfo: an unparseable value, or one whose `@`
      // sits somewhere a URL parser did not put it. Either way, not ours to edit.
      return { outcome: 'withhold', rule: 'proxy-unreadable' };
    }
    parsed.username = '';
    parsed.password = '';
    candidate = parsed.toString();
    // `new URL('http://proxy:8080')` serialises with a trailing slash the user
    // did not write; keep their form when they did not write one.
    if (!value.endsWith('/') && candidate.endsWith('/') && parsed.pathname === '/') {
      candidate = candidate.slice(0, -1);
    }
    rewritten = true;
  }
  const detected = redactSecrets(candidate);
  if (detected.redactedCount > 0) {
    return { outcome: 'withhold', rule: 'secret-shaped-value', detectors: detected.redactedTypes };
  }
  return rewritten ? { outcome: 'rewrite', rule: 'proxy-userinfo', value: candidate } : { outcome: 'keep' };
}

// ── Pass-through ─────────────────────────────────────────────────

export interface PassThroughReading {
  /** Valid names, de-duplicated, in the order given. */
  names: string[];
  /** Entries that are not a plain variable name, as given. Reported, never cleaned. */
  invalid: string[];
  /** Values set in a scope that is not read, named so nobody wonders why they did nothing. */
  ignored: string[];
}

/** Parse a pass-through list. Anything that is not an array of plain names is reported. */
export function parsePassEnvironmentList(raw: unknown): { names: string[]; invalid: string[] } {
  if (raw === undefined || raw === null) {
    return { names: [], invalid: [] };
  }
  if (!Array.isArray(raw)) {
    return { names: [], invalid: [describeInvalid(raw)] };
  }
  const names: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string' || !PASS_THROUGH_NAME.test(entry)) {
      invalid.push(describeInvalid(entry));
      continue;
    }
    if (seen.has(entry)) {
      continue;
    }
    if (names.length >= MAX_PASS_THROUGH) {
      invalid.push(`${entry} (more than ${MAX_PASS_THROUGH} names)`);
      continue;
    }
    seen.add(entry);
    names.push(entry);
  }
  return { names, invalid };
}

/** The fields of VS Code's `WorkspaceConfiguration.inspect()` this reads. */
export interface PassEnvironmentInspection {
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

/**
 * Read `atlasmind.terminal.passEnvironment` from its per-scope values. Only
 * the user value counts: a repository that could add `GITHUB_TOKEN` here would
 * be a repository that could read it.
 */
export function readPassEnvironmentSetting(inspection: PassEnvironmentInspection | undefined): PassThroughReading {
  const ignored: string[] = [];
  if (inspection?.workspaceValue !== undefined || inspection?.workspaceFolderValue !== undefined) {
    ignored.push(
      `A workspace or folder value for ${PASS_ENVIRONMENT_SETTING} was ignored: only your user setting is read, `
      + 'so a repository cannot choose which of your credentials an agent command receives.',
    );
  }
  const { names, invalid } = parsePassEnvironmentList(inspection?.globalValue);
  return { names, invalid, ignored };
}

/** The CLI's pass-through list, from `ATLASMIND_PASS_ENVIRONMENT` (comma-separated). */
export function readCliPassEnvironment(env: Readonly<Record<string, string | undefined>>): PassThroughReading {
  const raw = env[CLI_PASS_ENVIRONMENT_VARIABLE];
  if (typeof raw !== 'string' || raw.length === 0) {
    return { names: [], invalid: [], ignored: [] };
  }
  const { names, invalid } = parsePassEnvironmentList(raw.split(',').filter(part => part.length > 0));
  return { names, invalid, ignored: [] };
}

function describeInvalid(entry: unknown): string {
  if (typeof entry === 'string') {
    return JSON.stringify(entry.slice(0, 80));
  }
  return `a ${entry === null ? 'null' : Array.isArray(entry) ? 'list' : typeof entry} value`;
}

// ── The plan ─────────────────────────────────────────────────────

export interface HostCommandEnvOutcome {
  name: string;
  rule: HostCommandEnvRuleId;
  /** For `secret-shaped-value`: which detectors matched. Never the value. */
  detectors?: string[];
}

export interface HostCommandEnvironmentPlan {
  /** The environment to start the command with. A plain object, never `process.env` itself. */
  env: Record<string, string>;
  /** Variables not passed, each with its rule. Sorted by name. */
  withheld: HostCommandEnvOutcome[];
  /** Variables passed with credentials removed. Sorted by name. */
  rewritten: HostCommandEnvOutcome[];
  /** Present variables passed unchanged because the user listed them. Sorted. */
  passedThrough: string[];
}

export interface HostCommandEnvironmentOptions {
  /** Names the user asked to pass unchanged. Assumed already validated (`parsePassEnvironmentList`). */
  passThrough?: readonly string[];
  /** Windows names are case-insensitive, so a pass-through name matches any casing there. */
  platform?: NodeJS.Platform;
}

/**
 * The environment a model-requested command runs with. Every rule in
 * `HOST_COMMAND_ENV_RULES` is applied to every variable; nothing is added.
 */
export function planHostCommandEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  options: HostCommandEnvironmentOptions = {},
): HostCommandEnvironmentPlan {
  const caseInsensitive = (options.platform ?? process.platform) === 'win32';
  const fold = (name: string) => (caseInsensitive ? name.toUpperCase() : name);
  const passThrough = new Set((options.passThrough ?? []).filter(name => PASS_THROUGH_NAME.test(name)).map(fold));

  const env: Record<string, string> = {};
  const withheld: HostCommandEnvOutcome[] = [];
  const rewritten: HostCommandEnvOutcome[] = [];
  const passedThrough: string[] = [];

  for (const name of Object.keys(source ?? {})) {
    const value = source[name];
    if (typeof value !== 'string') {
      continue;
    }
    if (passThrough.has(fold(name))) {
      env[name] = value;
      passedThrough.push(name);
      continue;
    }
    const nameRule = classifyEnvironmentName(name);
    if (nameRule) {
      withheld.push({ name, rule: nameRule });
      continue;
    }
    const verdict = classifyEnvironmentValue(name, value);
    if (verdict.outcome === 'withhold') {
      withheld.push({ name, rule: verdict.rule, ...(verdict.detectors ? { detectors: verdict.detectors } : {}) });
      continue;
    }
    if (verdict.outcome === 'rewrite') {
      env[name] = verdict.value;
      rewritten.push({ name, rule: verdict.rule });
      continue;
    }
    env[name] = value;
  }

  const byName = (left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name);
  return {
    env,
    withheld: withheld.sort(byName),
    rewritten: rewritten.sort(byName),
    passedThrough: passedThrough.sort((left, right) => left.localeCompare(right)),
  };
}

const MAX_NAMES_SHOWN = 12;

/**
 * One line for the person whose command failed: which variables were withheld,
 * by which rule, and how to pass one. Names only — never a value. `undefined`
 * when nothing was withheld or rewritten. `howToPass` lets the CLI, which has
 * no settings, name its own variable.
 */
export function describeWithheldEnvironment(
  plan: HostCommandEnvironmentPlan,
  howToPass = `add its exact name to ${PASS_ENVIRONMENT_SETTING} in your user settings`,
): string | undefined {
  if (plan.withheld.length === 0 && plan.rewritten.length === 0) {
    return undefined;
  }
  const parts: string[] = [];
  if (plan.withheld.length > 0) {
    const shown = plan.withheld.slice(0, MAX_NAMES_SHOWN).map(entry => `${entry.name} (${entry.rule})`);
    const more = plan.withheld.length - shown.length;
    parts.push(
      `AtlasMind withheld ${plan.withheld.length} credential-shaped environment variable${plan.withheld.length === 1 ? '' : 's'} `
      + `from this command: ${shown.join(', ')}${more > 0 ? `, and ${more} more` : ''}.`,
    );
  }
  if (plan.rewritten.length > 0) {
    parts.push(`Proxy credentials were removed from ${plan.rewritten.map(entry => entry.name).join(', ')}.`);
  }
  parts.push(`If the command needs one, ${howToPass}.`);
  return parts.join(' ');
}

// ── Where it applies ─────────────────────────────────────────────

export interface HostCommandEnvPathRow {
  id: string;
  where: string;
  /** What environment the process gets. */
  environment: string;
}

/**
 * Every host path that starts a model-requested command, and the file that
 * applies this policy there. `tests/core/hostCommandEnvironment.test.ts`
 * checks each file really calls `planHostCommandEnvironment`.
 */
export const HOST_COMMAND_ENV_COVERED_PATHS: ReadonlyArray<HostCommandEnvPathRow & { file: string }> = [
  {
    id: 'run-command',
    file: 'src/extension.ts',
    where: '`SkillExecutionContext.runCommand` under sandbox mode `off` — terminal-run, test-run, npm scripts, code formatting, the docker skill, the git skills that reach it, and the check after a write',
    environment: 'The editor\'s environment with every credential-shaped variable withheld, plus the names in atlasmind.terminal.passEnvironment.',
  },
  {
    id: 'cli-run-command',
    file: 'src/cli/nodeSkillContext.ts',
    where: 'The `atlasmind` CLI and the CLI\'s ACP agent mode: the same `runCommand`, outside VS Code',
    environment: 'The CLI\'s environment with every credential-shaped variable withheld — including the ATLASMIND_PROVIDER_* variables the CLI reads its own keys from — plus the names in ATLASMIND_PASS_ENVIRONMENT.',
  },
  {
    id: 'acp-agent-process',
    file: 'src/providers/acp.ts',
    where: 'The ACP agent process, which runs the commands its model asks for under atlasmind.acp.toolsEnabled',
    environment: 'The editor\'s environment with every credential-shaped variable withheld, plus atlasmind.terminal.passEnvironment, plus the agent\'s own declared `env` from atlasmind.acp.agents.',
  },
];

/** Paths that keep their environment, and why each is outside this policy. */
export const HOST_COMMAND_ENV_UNCHANGED_PATHS: readonly HostCommandEnvPathRow[] = [
  {
    id: 'sandbox',
    where: 'Any command under atlasmind.sandbox.mode = require',
    environment: 'Stricter already: only the names in SANDBOX_ENV_ALLOWLIST cross into the container.',
  },
  {
    id: 'operator-surfaces',
    where: 'What you start yourself: your own terminals and the managed terminal\'s own command, routines you were shown and ran (/ship, the Run Center, schedules you set up), the Delivery run plan, promotions, local CI, website setup',
    environment: 'Your environment, unchanged. You chose the command, and a publish or deploy step may legitimately need your own token.',
  },
  {
    id: 'mcp-servers',
    where: 'MCP servers you connected',
    environment: 'The MCP SDK\'s filtered default environment plus the variables the server declared — a separate rule in mcpClient.ts.',
  },
  {
    id: 'managed-terminal-follow-up',
    where: 'The one follow-up command a model chooses after a managed-terminal command',
    environment: 'Not covered: it runs in your own terminal, whose shell environment AtlasMind cannot rewrite. It is behind the managed-terminal approval, and refused under sandbox mode require.',
  },
  {
    id: 'debug-launch',
    where: 'A debug session the model starts',
    environment: 'Not covered: the debuggee\'s environment comes from the launch configuration and the debug adapter. Refused under sandbox mode require.',
  },
];
