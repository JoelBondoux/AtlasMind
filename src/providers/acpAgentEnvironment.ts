/**
 * Environment variables in an ACP agent's launch settings that name a *file*,
 * and what happens to them on the way to the agent.
 *
 * Found by running AtlasMind against real agents, not by reading their docs.
 * codex-acp chooses which Codex binary to drive from `CODEX_PATH`, and two
 * things go wrong with it that look like something else entirely:
 *
 * - **The path goes stale.** Codex Desktop installs its binary under a
 *   hash-named folder (`…\OpenAI\Codex\bin\<hash>\codex.exe`) and moves to a new
 *   folder when it updates. A path copied in once stops existing the next time
 *   Codex updates, and codex-acp then reports only "The system cannot find the
 *   path specified" — which the probe surfaced as *not signed in*, sending the
 *   user to a login that cannot help.
 * - **Backslashes are dropped.** codex-acp 1.1.7 hands `CODEX_PATH` through a
 *   parser that treats `\` as an escape, so `C:\Users\…\codex.exe` arrives as
 *   `C:Users…codex.exe` and cmd.exe reports it "is not recognized". Windows
 *   accepts `/` as a separator, so the same path spelled with forward slashes
 *   names the same file and survives. Verified by launching codex-acp with both
 *   spellings of one existing path: the backslash form failed, the forward-slash
 *   form started a session.
 *
 * Two rules, both deliberately narrow:
 *
 * 1. **Only declared variables of declared agents.** Nothing here inspects an
 *    arbitrary environment variable for things that look like paths: a guess
 *    about what a third-party program does with its environment is exactly the
 *    unverified contract this provider refuses everywhere else.
 * 2. **A missing file refuses the launch with the reason; it is never
 *    repaired.** AtlasMind does not go looking for "the" Codex binary to put in
 *    its place — choosing which executable runs is the user's decision, and a
 *    plausible substitute is worse than a clear error.
 *
 * Pure apart from the injected file check.
 */

/** When the per-agent rules below were last confirmed against a live agent. */
export const ACP_AGENT_ENVIRONMENT_VERIFIED_AT = '2026-10-27';

export interface AcpAgentPathVariable {
  /** The agent command, matched on its file name without directory or extension. */
  command: string;
  variable: string;
  /** Whether the agent keeps `\` in this value on Windows. */
  backslashesSurvive: boolean;
  /** What the agent was checked against, so a reader knows when to re-check. */
  verifiedWith: string;
  /** Said when the named file does not exist. */
  missingHint: string;
}

export const ACP_AGENT_PATH_VARIABLES: readonly AcpAgentPathVariable[] = [
  {
    command: 'codex-acp',
    variable: 'CODEX_PATH',
    backslashesSurvive: false,
    verifiedWith: 'codex-acp 1.1.7',
    missingHint: 'Codex Desktop moves its binary into a new folder each time it updates, so a copied path goes stale. '
      + 'Remove CODEX_PATH to let codex-acp use its own Codex, or point it at a path that does not change.',
  },
];

export interface AcpAgentEnvironmentProbe {
  platform: string;
  fileExists: (path: string) => boolean;
}

export type AcpAgentEnvironmentAssessment =
  | {
    ok: true;
    /** The environment to launch with; identical to the configured one unless `adjusted` names a variable. */
    env: Record<string, string> | undefined;
    /** Variables whose spelling was changed, by name only — never the value. */
    adjusted: string[];
  }
  | {
    ok: false;
    variable: string;
    message: string;
  };

/** `codex-acp`, `C:\…\codex-acp.cmd` and `/usr/bin/codex-acp` all name one agent. */
export function acpCommandName(command: string): string {
  const base = command.trim().split(/[\\/]/).pop() ?? '';
  return base.replace(/\.(cmd|exe|ps1|bat)$/i, '').toLowerCase();
}

function isAbsolutePath(value: string, platform: string): boolean {
  if (platform === 'win32') {
    return /^[a-zA-Z]:[\\/]/.test(value) || /^[\\/]{2}[^\\/]/.test(value);
  }
  return value.startsWith('/');
}

export function assessAcpAgentEnvironment(
  agent: { id: string; command: string; env?: Record<string, string> },
  probe: AcpAgentEnvironmentProbe,
): AcpAgentEnvironmentAssessment {
  const env = agent.env;
  if (!env) {
    return { ok: true, env, adjusted: [] };
  }
  const name = acpCommandName(agent.command);
  const rules = ACP_AGENT_PATH_VARIABLES.filter(rule => rule.command === name && typeof env[rule.variable] === 'string');
  if (rules.length === 0) {
    return { ok: true, env, adjusted: [] };
  }

  const launchEnv: Record<string, string> = { ...env };
  const adjusted: string[] = [];
  for (const rule of rules) {
    const value = env[rule.variable].trim();
    // A bare name ("codex") is resolved by the agent on its own PATH, which is
    // its business; only a path that claims a location can be checked here.
    if (!isAbsolutePath(value, probe.platform)) {
      continue;
    }
    if (!probe.fileExists(value)) {
      return {
        ok: false,
        variable: rule.variable,
        message: `${rule.variable} in the launch settings for the "${agent.id}" agent names a file that does not exist (${value}). ${rule.missingHint}`,
      };
    }
    if (probe.platform === 'win32' && !rule.backslashesSurvive && value.includes('\\')) {
      launchEnv[rule.variable] = value.replace(/\\/g, '/');
      adjusted.push(rule.variable);
    }
  }
  return { ok: true, env: launchEnv, adjusted };
}
