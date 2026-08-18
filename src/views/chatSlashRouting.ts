/**
 * Deciding what a leading `/` in the AtlasMind chat panel means.
 *
 * The panel had no answer to that question at all. `runPrompt` passed whatever
 * was typed straight to the orchestrator, so every one of the twenty
 * deterministic slash commands **silently reached a model** — and on a machine
 * with no provider configured that meant the built-in echo adapter replying
 * "Answered from context." to `/acp`. The command was declared, documented,
 * autocompleted by the composer, and inert.
 *
 * Silent is the part that matters. A command that visibly does nothing gets
 * reported; a command that produces a plausible-looking answer from a model
 * teaches the user that the feature works and they are using it wrong. Worse,
 * the fall-through handed a *setup* question — asked precisely because nothing is
 * set up yet — to an agent holding every connected tool, which is both wrong and
 * a far wider surface than `/acp` was ever meant to have. `participant.ts`
 * closed exactly this hole for the VS Code chat surface and says so in a comment;
 * the panel never got the same treatment.
 *
 * So the rule this module exists to enforce: **a recognised slash command never
 * reaches a model by accident.** It is dispatched, or it is refused out loud.
 *
 * Pure and `vscode`-free, so every branch is unit-tested without a webview.
 */

/**
 * Every slash command the chat surfaces accept.
 *
 * The canonical list lives **here**, not in `participant.ts`, because this is
 * the module both surfaces can import — the participant pulls it back in and
 * re-exports it under its old name. A second copy would drift, and the failure
 * mode of drift here is the silent fall-through above: a command the manifest
 * declares and one surface has never heard of.
 *
 * A test pins this against `package.json`'s declared chat commands, so adding a
 * command to the manifest without teaching the panel about it fails the build
 * rather than shipping as a command that works in one place.
 */
export const ATLAS_SLASH_COMMANDS = [
  'acp', 'agents', 'bootstrap', 'buzz', 'cost', 'director', 'discover', 'followups',
  'ideate', 'import', 'lens', 'localci', 'loop', 'memory', 'project', 'research', 'runs', 'setup', 'ship', 'skills',
  'sync-instructions', 'vision', 'voice',
] as const;

export type AtlasSlashCommand = (typeof ATLAS_SLASH_COMMANDS)[number];

const KNOWN = new Set<string>(ATLAS_SLASH_COMMANDS);

/**
 * Commands the panel runs by **replaying the participant's own handler** through
 * a collecting stream, rather than by mapping each one to a VS Code command.
 *
 * One dispatch, two surfaces. The alternative — a table pairing every slash
 * command with an equivalent command id — is twenty chances for the panel to
 * answer a question differently from `@atlas`, and it would have to be kept
 * correct by hand forever. These handlers are already deterministic and already
 * produce markdown; the panel's only real gap was having nowhere to put it.
 */
const REPLAYED: ReadonlySet<string> = new Set([
  'acp', 'agents', 'bootstrap', 'buzz', 'cost', 'director', 'discover',
  'followups', 'ideate', 'import', 'lens', 'localci', 'memory', 'research', 'runs', 'setup', 'ship', 'skills',
  'sync-instructions', 'vision', 'voice',
]);

export type PanelSlashRoute =
  /** Not a slash command. Ordinary prose — hand it to the model as before. */
  | { kind: 'prose' }
  /**
   * A recognised command with a deterministic handler. The panel runs it through
   * {@link ../views/chatStreamCollector.ts} and renders what it produced.
   */
  | { kind: 'replay'; command: AtlasSlashCommand; argument: string; raw: string }
  /**
   * `/project <goal>` — the panel already owns autonomous runs, including the
   * proposal card and the run-center wiring, so this is routed onto that path
   * rather than through a handler that would start a *second* execution inside
   * the one already running.
   */
  | { kind: 'project'; goal: string }
  /** `/loop <goal>` — likewise: the composer's "New Loop" mode is this, natively. */
  | { kind: 'loop'; goal: string }
  /**
   * A recognised command that needs an argument it was not given.
   *
   * Reported rather than run: `/project` with no goal would otherwise become an
   * autonomous run of the empty string.
   */
  | { kind: 'needs-argument'; command: AtlasSlashCommand; message: string; raw: string }
  /**
   * Something that looks like a command and is not one.
   *
   * Distinguished from prose deliberately. A typo'd `/agent` silently answered
   * by a model is the bug this module exists to remove, so a leading token that
   * *looks* like a command name and is not recognised is corrected rather than
   * quietly forwarded.
   */
  | { kind: 'unknown'; typed: string; message: string; raw: string };

/**
 * How AtlasMind reads a prompt the user submitted in the chat panel.
 *
 * The `looksLikeCommand` test is narrower than "starts with a slash" on purpose.
 * A prompt beginning `/usr/local/bin/foo is missing` or `/etc/hosts` is a **path**
 * and must stay prose — hijacking it would break asking about the filesystem,
 * which is a thing people do constantly in a coding assistant. So a candidate
 * must be a single lowercase word (optionally hyphenated) followed by whitespace
 * or nothing: `/agents`, `/sync-instructions`, `/project build a thing`. Anything
 * carrying a second slash, a dot, or an uppercase letter is a path or prose.
 */
export function routePanelPrompt(rawPrompt: string): PanelSlashRoute {
  const prompt = rawPrompt.trim();
  if (!prompt.startsWith('/')) {
    return { kind: 'prose' };
  }

  // Case-insensitive, and tolerant of trailing punctuation.
  //
  // The pattern was `[a-z][a-z-]*` with nothing after it, so `/Cost` — which is
  // what a touch keyboard's autocapitalisation produces, and several editors
  // after a newline — fell through to a model, and the operator paid for a model
  // call answering a question about billing. `/runs?` is how somebody asks what
  // a command does, and it went the same way. Neither is a path.
  //
  // The path guard is unchanged and load-bearing: a second slash or a dot
  // followed by more word characters still fails to match, so `/usr/bin/x`,
  // `/README.md`, `/Users/joel` and `/etc/hosts has the wrong entry` remain
  // prose. Asking about the filesystem is a thing people do constantly in a
  // coding assistant.
  const match = /^\/([A-Za-z][A-Za-z-]*)[?.!]*(?:[ \t]+([\s\S]*))?$/.exec(prompt);
  if (!match) {
    // `/usr/bin/x`, `/README.md`, `/Users/joel`, a bare `/`. All prose.
    return { kind: 'prose' };
  }

  const command = match[1]!.toLowerCase();
  const argument = (match[2] ?? '').trim();

  if (!KNOWN.has(command)) {
    return {
      kind: 'unknown',
      typed: command,
      raw: prompt,
      message: `\`/${command}\` is not an AtlasMind command. ${describeAvailableCommands()}`,
    };
  }

  if (command === 'project' || command === 'loop') {
    if (!argument) {
      return {
        kind: 'needs-argument',
        command,
        raw: prompt,
        message: command === 'project'
          ? 'Give `/project` a goal — for example `/project add pagination to the results list`. Without one there is nothing to plan.'
          : 'Give `/loop` a goal — for example `/loop keep fixing failing tests until they pass`. Without one there is nothing to pursue.',
      };
    }
    return command === 'project' ? { kind: 'project', goal: argument } : { kind: 'loop', goal: argument };
  }

  if (REPLAYED.has(command)) {
    return { kind: 'replay', command: command as AtlasSlashCommand, argument, raw: prompt };
  }

  // Unreachable while REPLAYED ∪ {project, loop} covers ATLAS_SLASH_COMMANDS,
  // which a test asserts. Kept as a refusal rather than a fall-through so that
  // adding a command to the list and forgetting to classify it produces a
  // visible "not available here" instead of the silent model call this module
  // was written to delete.
  return {
    kind: 'unknown',
    typed: command,
    raw: prompt,
    message: `\`/${command}\` is not available in this panel yet. Try it with \`@atlas /${command}\` in the VS Code chat view.`,
  };
}

/** The command list, for a correction message. Sorted, so it cannot shuffle. */
function describeAvailableCommands(): string {
  return `Available: ${[...ATLAS_SLASH_COMMANDS].sort().map(name => `\`/${name}\``).join(', ')}.`;
}

/**
 * Whether a route means "do not call a model".
 *
 * Exists so the panel asserts the property rather than restating the branch
 * list: everything except `prose` is handled by AtlasMind itself, and the
 * long-running two hand off to paths that are explicitly not a plain chat turn.
 */
export function routeBypassesFreeformModel(route: PanelSlashRoute): boolean {
  return route.kind !== 'prose';
}
