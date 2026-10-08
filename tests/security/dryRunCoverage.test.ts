import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every place AtlasMind can act is either behind the dry run or says why not.
 *
 * `atlasmind.dryRun.enabled` promises that nothing executes. The tool loop keeps
 * that promise in `dryRun.ts`; everything outside it keeps it through
 * `dryRunHost.ts`. A surface added next month keeps it only if something fails
 * the day it is added without a guard — so this test scans `src/` for the call
 * shapes that act (a process, a request, an MCP tool call, a skill execution, a
 * file write, a terminal send, a call into the shared process and `gh`
 * helpers) and requires every file that has one to be classified:
 *
 * - **DRY_RUN_COVERED**: the file calls the guard functions it lists. `covers`
 *   says which of its effects they stop; `leaves` says, honestly, what in the
 *   file still runs in a dry run and under which published exemption.
 * - **DRY_RUN_EXEMPT**: the file acts in no way a dry run should stop, and the
 *   reason is written down where a reviewer can disagree with it.
 *
 * A new file with a shape fails until somebody decides which it is. A file
 * that loses its last shape fails too, so the lists cannot rot into a record
 * of files that no longer do what they say.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO_ROOT, 'src');

/** Side-effect call shapes. Matched against code lines, never comment lines. */
const SHAPES: Readonly<Record<string, RegExp>> = {
  'child-process': /['"](?:node:)?child_process['"]/,
  fetch: /(?:^|[^\w$.])fetch\s*\(|globalThis\.fetch\s*\(/,
  'http-request': /\bhttps?\.(?:request|get)\s*\(/,
  'call-tool': /\.callTool\s*\(/,
  execute: /\.execute\s*\(/,
  'fs-write': /\b(?:fs|fsp|fsPromises|promises|nodeFs|workspace\.fs)\.(?:writeFile|appendFile|rm|rmdir|unlink|rename|mkdir|copyFile|cp|delete|createDirectory|copy|symlink|truncate|createWriteStream)(?:Sync)?\s*\(|(?<![\w$.])(?:writeFile|appendFile|unlink|rename|mkdir|copyFile|rmdir|rm|createWriteStream)(?:Sync)?\s*\(/,
  'terminal-send': /\.sendText\s*\(|shellIntegration\.executeCommand\s*\(/,
  /** The shared `gh` boundary and the shared no-shell process helper. */
  'process-helper': /\b(?:runGhOrThrow|pipeGhStdoutOrThrow|nodeGhRunner)\b|new\s+GhClient\s*\(|import\s*\{[^}]*\bexecFileAsync\b[^}]*\}\s*from\s*'[^']*mcpRuntime\.js'/,
  socket: /new\s+WebSocket\s*\(|\b(?:net|tls)\.(?:connect|createConnection)\s*\(|\.createConnection\s*\(|new\s+Client\s*\(/,
};

/** The host guards in `src/core/dryRunHost.ts`, and the tool loop's in `src/core/dryRun.ts`. */
const HOST_GUARDS = ['interceptDryRun', 'guardDryRun', 'guardHostCommand', 'isDryRunActive', 'installDryRunHost'] as const;
const TOOL_LOOP_GUARDS = ['decideDryRun', 'createDryRunSkillContext'] as const;

/**
 * Shared boundaries that are themselves guarded. A file that reaches the world
 * only through one of these is covered by it — and the test checks the boundary
 * really does call a host guard, so naming one is not a way out.
 */
const GUARDED_BOUNDARIES: Readonly<Record<string, string>> = {
  runGhOrThrow: 'core/ghClient.ts',
  pipeGhStdoutOrThrow: 'core/ghClient.ts',
  GhClient: 'core/ghClient.ts',
  execFileAsync: 'mcp/mcpRuntime.ts',
};

interface Covered {
  guards: readonly string[];
  covers: string;
  leaves?: string;
}

const OPERATOR_SAVE = 'dry-run.exempt-operator-save';
const BOOKKEEPING = 'dry-run.exempt-own-bookkeeping';
const MODEL_CALL = 'dry-run.exempt-model-call';
const READS = 'dry-run.exempt-read';

const DRY_RUN_COVERED: Readonly<Record<string, Covered>> = {
  'ard/ardClient.ts': {
    guards: ['guardDryRun'],
    covers: 'Every Resource Discovery request, at createArdTransport, the one transport searches and catalog fetches share.',
  },
  'bootstrap/bootstrapper.ts': {
    guards: ['interceptDryRun', 'guardHostCommand', 'runGhOrThrow'],
    covers: '/bootstrap is refused at its entry (it writes a model-drafted scaffold, runs git, can install gh and create a repository); runGit, the gh installer and gh repo create are guarded again inside for a switch turned on mid-intake.',
    leaves: `importProject's project-memory writes at an explicit /import or Import command (${OPERATOR_SAVE}); the automatic re-import is guarded where extension.ts starts it.`,
  },
  'chat/participant.ts': {
    guards: ['interceptDryRun', 'runGhOrThrow'],
    covers: 'Buzz channel posts and DMs; the project run report written after a run; /ship reaches RoutineRunner, which refuses in a dry run and is rendered as such here.',
    leaves: `\`git remote get-url\` and gh repo-visibility reads (${READS}); a GET of Buzz's pinned public documentation for the setup guide, which carries nothing of the project (${READS}); saving the operator-feedback note when asked to (${OPERATOR_SAVE}).`,
  },
  'cli/main.ts': {
    guards: ['installDryRunHost', 'isDryRunActive'],
    covers: '--dry-run installs a host for the CLI process; `build` describes its command instead of spawning it.',
  },
  'commands.ts': {
    guards: ['runGhOrThrow'],
    covers: 'Its one gh call crosses the guarded gh boundary.',
    leaves: `That call reads repository visibility (${READS}); the producer report and portal page files, instruction-file sync and Import are each the file an operator ran the command to produce (${OPERATOR_SAVE}).`,
  },
  'core/ghClient.ts': {
    guards: ['guardHostCommand'],
    covers: 'Every gh invocation (GhClient.exec, which runGhOrThrow uses, and pipeGhStdoutOrThrow): a gh write is refused before a process starts.',
    leaves: `gh reads — list, view, status, checks, api GET, auth status (${READS}).`,
  },
  'core/localCiActorGuard.ts': {
    guards: ['runGhOrThrow'],
    covers: 'Its gh api calls cross the guarded gh boundary.',
    leaves: `They are GET reads of the repository owner and the signed-in user (${READS}).`,
  },
  'core/localCiInstaller.ts': {
    guards: ['execFileAsync'],
    covers: 'The GitHub CLI install plan runs every step through the guarded process helper.',
  },
  'core/localCiRunner.ts': {
    guards: ['guardHostCommand', 'guardDryRun', 'pipeGhStdoutOrThrow', 'runGhOrThrow'],
    covers: 'Every docker and git command through execCommand; the container start, which spawns docker directly; the registration-token POST through the gh boundary.',
    leaves: `Inspection (docker info, ps, image inspect; git and gh reads) and following the logs of a container already running (${READS}).`,
  },
  'core/sandboxProbe.ts': {
    guards: ['guardHostCommand'],
    covers: 'Every engine command, in the default runner, before it is resolved or started: the canary `run` and the cleanup `rm` of a timed-out canary are effects, so a dry run refuses them and the reading records the canary as not run — the attestation is unavailable, never confirmed by a canary that did not happen.',
    leaves: `\`docker\`/\`podman\` \`--version\`, \`info\` and \`image inspect\` — reading the engine's state (${READS}).`,
  },
  'core/orchestrator.ts': {
    guards: ['decideDryRun', 'createDryRunSkillContext'],
    covers: 'The tool loop (slice B1): every tool call is decided by decideDryRun, and a call allowed to run gets the backstopped skill context. The `.execute(` matches are skill.execute in that loop and the subtask scheduler; the `fetch(` match is inside a regular expression.',
    leaves: `Model completions (${MODEL_CALL}).`,
  },
  'core/promotionRunner.ts': {
    guards: ['interceptDryRun'],
    covers: 'runPromotion returns the plan as the record and runs no step; runRollback, applyPromotionRemediation and the health-check test run nothing.',
  },
  'core/routineScheduler.ts': {
    guards: ['interceptDryRun'],
    covers: 'A due scheduled routine is recorded, not run, before any worktree or branch exists: a timer’s write, so recorded without a notification. Its steps then go through RoutineRunner, which refuses again for a switch turned on mid-run.',
    leaves: `The per-developer schedule state in workspace state, written before each run so a crash cannot replay it (${BOOKKEEPING}).`,
  },
  'core/routineRunner.ts': {
    guards: ['interceptDryRun'],
    covers: 'RoutineRunner.run refuses before the first step, for /ship, the Run Center and any later caller.',
  },
  'core/toolWebhookDispatcher.ts': {
    guards: ['interceptDryRun'],
    covers: 'Every webhook delivery, including the test event.',
  },
  'extension.ts': {
    guards: ['installDryRunHost', 'interceptDryRun'],
    covers: 'Installs the host before any surface exists; holds the setup-terminal sends, the memory self-heal pass, the background snippet refresh and the automatic stale-memory re-import.',
    leaves: `The SkillExecutionContext members, reached only through the tool loop, where B1 decides and its context backstop refuses every effect; the worktree runGit hook, which B1 disables in a dry turn; the scheduled-routine git runner, reached only after RoutineScheduler has asked interceptDryRun; the research-digest and CLI-shim commands (${OPERATOR_SAVE}); git reads (${READS}).`,
  },
  'mcp/buzzCliBridge.ts': {
    guards: ['guardDryRun'],
    covers: 'Buzz posts and DM opens, in a process that installed a host (the ACP agent under --dry-run). In the editor the same sends are refused earlier, at the MCP registry.',
    leaves: `Contract probes, channel listing and thread reads (${READS}).`,
  },
  'mcp/mcpEnvironmentScanner.ts': {
    guards: ['interceptDryRun'],
    covers: 'The cached scan written into project memory when the panel opens or a config file changes.',
  },
  'mcp/mcpRuntime.ts': {
    guards: ['guardHostCommand', 'interceptDryRun'],
    covers: 'execFileAsync, the shared no-shell process helper (installers, portal deploy, website setup), refuses anything but a version probe; runRuntimeInstallPlan refuses once, cleanly.',
  },
  'mcp/mcpServerRegistry.ts': {
    guards: ['guardDryRun'],
    covers: 'Every MCP tool call, at the skill wrapper around callTool: the backstop under the tool loop and under every panel that calls a connector.',
    leaves: 'Starting and connecting the servers the operator configured. That is session setup: no tool runs until a call, and every call is guarded.',
  },
  'providers/acpInstaller.ts': {
    guards: ['execFileAsync'],
    covers: 'The ACP agent install chain runs every step through the guarded process helper.',
  },
  'utils/testingProtocolSync.ts': {
    guards: ['interceptDryRun'],
    covers: 'The roadmap rule written into agent instruction files when the Roadmap page opens.',
    leaves: `syncTestingProtocols, run when an operator saves the testing configuration (${OPERATOR_SAVE}).`,
  },
  'views/chatPanel.ts': {
    guards: ['interceptDryRun'],
    covers: 'Send-to-terminal; every managed-terminal command, including the follow-up a model chooses; the gap analysis saved after the turn.',
    leaves: `The session-context summary the operator pressed a button to write (${OPERATOR_SAVE}).`,
  },
  'views/lensDatabaseTransport.ts': {
    guards: ['interceptDryRun'],
    covers: 'Direct SQL connections (which a fetch scan cannot see) and SQL-over-HTTPS probes.',
  },
  'views/lensLiveTransport.ts': {
    guards: ['interceptDryRun'],
    covers: 'Every HTTP probe of a declared live service.',
  },
  'views/lensTreeView.ts': {
    guards: ['guardDryRun'],
    covers: 'Live probes through an MCP tool, before the registry backstop.',
  },
  'views/portalPublishCommand.ts': {
    guards: ['interceptDryRun', 'execFileAsync'],
    covers: 'The deploy command, held with its own message so a dry run is not reported as a failed publish.',
    leaves: `Preparing the page locally in project memory, the file the operator asked for (${OPERATOR_SAVE}).`,
  },
  'views/projectDashboardPanel.ts': {
    guards: ['guardHostCommand', 'interceptDryRun', 'runGhOrThrow'],
    covers: 'Every git command (runGit), every gh command (the gh boundary), the Director connector send, delivery and local-CI terminal sends, run-plan execution, the load-time roadmap anchoring; promotions, remediation and rollback through promotionRunner, rendered as dry runs and kept out of delivery history.',
    leaves: `git and gh reads (${READS}); register, roadmap, ideation and starter-workflow writes made when an operator presses the button for them (${OPERATOR_SAVE}).`,
  },
  'views/reviewedPrLocalCiCommands.ts': {
    guards: ['guardHostCommand', 'runGhOrThrow'],
    covers: 'Its git helper and every gh call (dispatch, status, cancel) through the gh boundary.',
    leaves: `The managed patch files written after the operator confirms "Write managed files" — nothing is committed (${OPERATOR_SAVE}).`,
  },
  'views/settingsPanel.ts': {
    guards: ['guardDryRun', 'interceptDryRun'],
    covers: 'Ollama pulls and deletes, LM Studio downloads.',
    leaves: `The Ollama version check and git shortlog (${READS}); settings, testing and instruction-file saves (${OPERATOR_SAVE}).`,
  },
  'views/uiSurfaceRenderHost.ts': {
    guards: ['interceptDryRun'],
    covers: "Starting the project's dev server to render a component, held after the confirmation that shows the exact argv.",
    leaves: `Rendering a static page as itself in a scripts-off webview (${READS}); stopping the dev server this panel itself started, which ends only what a confirmed start began.`,
  },
  'views/uiSurfaceEditHost.ts': {
    guards: ['interceptDryRun'],
    covers: 'Writing a UI Studio element edit into a project HTML file, held after the confirmation that shows the lines before and after.',
    leaves: `Rendering the page for selection and re-reading it to check it has not changed (${READS}).`,
  },
  'views/websiteStackSetupHost.ts': {
    guards: ['interceptDryRun', 'guardHostCommand', 'execFileAsync'],
    covers: 'The whole setup run, held after the confirmation; its scaffold commands are guarded again at execFileInDirectory.',
    leaves: `Version probes and the branch listing (${READS}).`,
  },
  'views/websiteStudioPanel.ts': {
    guards: ['interceptDryRun'],
    covers: 'Launching an engine (Godot) as a process.',
    leaves: `Emitting a surface and pushing copy into engine files after the operator confirms each (${OPERATOR_SAVE}).`,
  },
};


const REGISTER = `AtlasMind's own register or config file, written when an operator saves it from a panel (${OPERATOR_SAVE}). Automatic writers to it are guarded at the caller.`;
const MODEL_PROVIDER = `A model provider adapter: its requests are model completions (${MODEL_CALL}).`;
const PUBLIC_METADATA = `Reads public model or pricing metadata; sends nothing of the project and changes nothing (${READS}).`;
const SCRIPT_TEXT = 'The match is inside script text this module generates for another runtime (a preview page, a CI runner); the extension host never runs it.';

const DRY_RUN_EXEMPT: Readonly<Record<string, string>> = {
  'views/routineScheduleCommands.ts': `Writes the built-in dependency-check routine, create-only, when an operator runs the command for it (${OPERATOR_SAVE}). Approving a routine to run on its own writes only to workspace state; the run itself is held by RoutineScheduler.`,
  'bootstrap/projectBriefOnboarding.ts': `Writes the project brief the operator has just typed: create-only from /bootstrap, which a dry run refuses at its entry, and from the Describe the Project command, which asks before replacing an existing brief (${OPERATOR_SAVE}).`,
  'cli/nodeMemoryManager.ts': 'The CLI and ACP memory store. It persists only when upsert is called, which happens through the upsertMemory skill-context member: in a dry turn B1 simulates memory-write and its context backstop refuses that member.',
  'cli/nodeSkillContext.ts': "The CLI and ACP agent's SkillExecutionContext. It is reached only through the tool loop, where B1's decideDryRun decides each call and createDryRunSkillContext refuses every effect member of a call allowed to run.",
  'core/agentEvalHarness.ts': `Writes an eval baseline only when an operator confirms recording one (${OPERATOR_SAVE}).`,
  'core/buzzSocket.ts': 'The Buzz inbound subscription: read-only by construction, it sends only REQ, CLOSE, AUTH and pings, which its own tests assert.',
  'core/changeApprovals.ts': REGISTER,
  'core/checkpointManager.ts': "AtlasMind's own file snapshots, and restoring them. A model-initiated restore is the rollback-checkpoint tool, which B1 simulates; a restore from a command is the operator undoing.",
  'core/ciRoutingPolicy.ts': REGISTER,
  'core/codebaseIndexStore.ts': `The codebase index in extension storage, written by an index build the operator confirmed (${BOOKKEEPING}).`,
  'core/complianceEvidenceRegister.ts': REGISTER,
  'core/costHistoryFileStore.ts': `Cost records (${BOOKKEEPING}).`,
  'core/currencyFormatter.ts': `Fetches exchange rates for displaying costs; sends nothing of the project and changes nothing (${READS}).`,
  'core/dataPrivacyManager.ts': REGISTER,
  'core/debtRegister.ts': REGISTER,
  'core/defectRegister.ts': REGISTER,
  'core/deliveryManager.ts': REGISTER,
  'core/documentsManager.ts': `${REGISTER} Saving a shelf creates its folder, which is the save.`,
  'core/egressFetch.ts': "The HTTP transport with no caller of its own. Its callers are gated: the skill contexts' fetchUrl and httpRequest by B1's backstop, Resource Discovery by ardClient's guard.",
  'core/localCiRepositoryPatch.ts': SCRIPT_TEXT,
  'core/missionRegistry.ts': `The Mission Loop's audit trail of its iterations, which ran (${BOOKKEEPING}).`,
  'core/portalHosting.ts': REGISTER,
  'core/presenceManager.ts': 'Holds the OS awake with a platform helper process; changes nothing in the workspace and sends nothing off the machine.',
  'core/projectDirectorManager.ts': `${REGISTER} Its outbound history is appended only after a send, and every send is guarded.`,
  'core/projectRunHistory.ts': `Run records (${BOOKKEEPING}).`,
  'core/researchRegister.ts': `${REGISTER} Scan findings are recorded when the operator runs a scan.`,
  'core/riskOversightManager.ts': `${REGISTER} Advisor findings are recorded when the operator runs the advisors.`,
  'core/roadmapGraphStore.ts': `${REGISTER} The load-time anchoring that writes without being asked is guarded in projectDashboardPanel.`,
  'core/securityReviewManager.ts': REGISTER,
  'core/testCaseRegister.ts': REGISTER,
  'core/testingScaffolder.ts': `The process and network matches are inside the test files it writes; the writes are the starter files an operator pressed Scaffold for, never overwriting (${OPERATOR_SAVE}).`,
  'core/uiPreviewRuntime.ts': SCRIPT_TEXT,
  'core/websiteContentManager.ts': REGISTER,
  'core/websiteReviewBundle.ts': SCRIPT_TEXT,
  'core/websiteWorkspaceManager.ts': REGISTER,
  'core/workflowAuditRecord.ts': `The workflow audit ledger, which records that a step was attempted; in a dry run that is still true (${BOOKKEEPING}).`,
  'core/workflowConfig.ts': REGISTER,
  'mcp/mcpClient.ts': 'The MCP client implementation. Every tool call reaches callTool through mcpServerRegistry\'s skill wrapper, which is guarded; the connection itself is session setup.',
  'memory/memoryManager.ts': "The SSOT memory store. It persists when upsert is called: by the upsertMemory skill-context member (B1's backstop), by operator edits, and by the background snippet refresh, which extension.ts guards.",
  'memory/sessionContextManager.ts': `The chat session's transcript and context files (${BOOKKEEPING}).`,
  'migration.ts': "Migrates AtlasMind's own storage layout once, on upgrade.",
  'providers/acp.ts': `Starts the ACP agent as a model provider, in restricted mode with no filesystem and no terminal (${MODEL_CALL}); B1 turns ACP tool delegation off in a dry turn.`,
  'providers/anthropic.ts': MODEL_PROVIDER,
  'providers/bedrock.ts': MODEL_PROVIDER,
  'providers/copilotMultiplierSync.ts': PUBLIC_METADATA,
  'providers/gpuProbe.ts': `Runs a fixed GPU query (nvidia-smi and equivalents) to read memory (${READS}).`,
  'providers/localModelCatalogSync.ts': PUBLIC_METADATA,
  'providers/localModelSync.ts': `Lists the models a local runtime already has (${READS}).`,
  'providers/openai-compatible.ts': MODEL_PROVIDER,
  'providers/openrouter.ts': MODEL_PROVIDER,
  'providers/providerPricingSync.ts': PUBLIC_METADATA,
  'providers/registry.ts': MODEL_PROVIDER,
  'types.ts': 'Declarations only: the matches are interface member signatures, not calls.',
  'utils/aiInstructionMerge.ts': `Writes instruction files when an operator runs the merge or render command (${OPERATOR_SAVE}).`,
  'utils/aiInstructionSync.ts': `Writes instruction files when an operator presses Sync (${OPERATOR_SAVE}).`,
  'views/lensChangeStoryCommand.ts': `Fixed git argv, every one a read: rev-parse, cat-file, merge-base, log, diff, status, symbolic-ref --short (${READS}).`,
  'views/lensDashboardPanel.ts': `One fixed read, git rev-parse --abbrev-ref HEAD (${READS}).`,
  'views/lensDeclarationGuidePanel.ts': `Writes a starter declaration the operator asked for, create-only (${OPERATOR_SAVE}).`,
  'views/lensDeclarationSetup.ts': `Writes a starter declaration the operator asked for, create-only (${OPERATOR_SAVE}).`,
  'views/personalityProfilePanel.ts': REGISTER,
  'views/projectIdeationPanel.ts': `${REGISTER} The brief chain's roadmap lines, plan files and soul section are each written after a confirmation that shows them, by the operator pressing the step.`,
  'views/websitePreviewHost.ts': "Renders the preview the operator opened into AtlasMind's preview folder and serves it locally; nothing leaves the machine.",
  'voice/hostSpeechSynthesizer.ts': "Speaks text aloud with the operating system's own engine; changes nothing and sends nothing.",
  'voice/localTranscriber.ts': "Downloads AtlasMind's pinned, SHA-256-verified speech assets into extension storage and transcribes the operator's own audio locally; it acts on nothing in the workspace and sends nothing of the project.",
  'web/remoteClient.ts': 'The browser side of Remote Control: it runs in the remote web page, not in the extension host.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function relative(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
}

/** Code lines only: a commented example is not a call. */
function code(file: string): string {
  return readFileSync(path.join(SRC, file), 'utf8')
    .split(/\r?\n/)
    .filter(line => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');
}

function shapesOf(file: string): string[] {
  const source = code(file);
  return Object.entries(SHAPES).filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
}

function filesWithShapes(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of walk(SRC)) {
    const rel = relative(file);
    const shapes = shapesOf(rel);
    if (shapes.length > 0) {
      found.set(rel, shapes);
    }
  }
  return found;
}

/**
 * A host guard must be called. A boundary may also be handed on as a value —
 * an installer that takes `exec = execFileAsync` reaches the world through it
 * all the same — so for a boundary any use outside an import counts.
 */
function callsGuard(file: string, guard: string): boolean {
  const source = code(file);
  if (guard in GUARDED_BOUNDARIES) {
    const word = new RegExp(`\\b${guard}\\b`);
    return source
      .split('\n')
      .filter(line => !/^\s*import\b/.test(line) && !/^\s*\}?\s*from\s/.test(line) && !/^\s*\w+,\s*$/.test(line))
      .some(line => word.test(line));
  }
  return new RegExp(`\\b${guard}\\s*\\(`).test(source);
}

describe('dry-run coverage outside the tool loop', () => {
  it('matches real code, rather than passing because the scan is broken', () => {
    expect(shapesOf('core/routineRunner.ts')).toContain('child-process');
    expect(shapesOf('core/toolWebhookDispatcher.ts')).toContain('fetch');
    expect(shapesOf('mcp/mcpServerRegistry.ts')).toContain('call-tool');
    expect(shapesOf('views/projectDashboardPanel.ts')).toEqual(expect.arrayContaining(['terminal-send', 'execute', 'process-helper']));
    expect(shapesOf('views/lensDatabaseTransport.ts')).toContain('socket');
  });

  it('classifies every file in src/ that can act', () => {
    const unclassified = [...filesWithShapes().entries()]
      .filter(([file]) => !(file in DRY_RUN_COVERED) && !(file in DRY_RUN_EXEMPT))
      .map(([file, shapes]) => `${file} (${shapes.join(', ')})`);
    expect(
      unclassified,
      'These files have a side-effect call shape and are in neither DRY_RUN_COVERED nor DRY_RUN_EXEMPT. '
      + 'Guard the effect with src/core/dryRunHost.ts and list the guard, or exempt the file with a reason a reviewer can disagree with.',
    ).toEqual([]);
  });

  it('lists no file twice, and no file that no longer acts', () => {
    const both = Object.keys(DRY_RUN_COVERED).filter(file => file in DRY_RUN_EXEMPT);
    expect(both).toEqual([]);
    const shaped = filesWithShapes();
    const stale = [...Object.keys(DRY_RUN_COVERED), ...Object.keys(DRY_RUN_EXEMPT)]
      .filter(file => !existsSync(path.join(SRC, file)) || !shaped.has(file));
    expect(stale, 'Classified files that no longer exist or no longer have a side-effect shape; remove their entries.').toEqual([]);
  });

  it('holds every covered file to the guards it claims to call', () => {
    const allowed = new Set<string>([...HOST_GUARDS, ...TOOL_LOOP_GUARDS, ...Object.keys(GUARDED_BOUNDARIES)]);
    const problems: string[] = [];
    for (const [file, entry] of Object.entries(DRY_RUN_COVERED)) {
      expect(entry.guards.length, file).toBeGreaterThan(0);
      for (const guard of entry.guards) {
        if (!allowed.has(guard)) {
          problems.push(`${file}: "${guard}" is not a dry-run guard or a guarded boundary`);
        } else if (!callsGuard(file, guard)) {
          problems.push(`${file}: lists "${guard}" but does not call it`);
        }
      }
      // A file covered only by boundaries still has to reach one.
      const usesHostOrLoopGuard = entry.guards.some(guard => (HOST_GUARDS as readonly string[]).includes(guard) || (TOOL_LOOP_GUARDS as readonly string[]).includes(guard));
      const usesBoundary = entry.guards.some(guard => guard in GUARDED_BOUNDARIES);
      expect(usesHostOrLoopGuard || usesBoundary, file).toBe(true);
    }
    expect(problems).toEqual([]);
  });

  it('only counts a boundary as a guard when the boundary itself is guarded', () => {
    for (const [name, boundary] of Object.entries(GUARDED_BOUNDARIES)) {
      const entry = DRY_RUN_COVERED[boundary];
      expect(entry, `${name} names ${boundary}, which must itself be covered`).toBeDefined();
      expect(entry!.guards.some(guard => (HOST_GUARDS as readonly string[]).includes(guard)), boundary).toBe(true);
      expect(code(boundary)).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('writes down a reason for everything it lets run', () => {
    for (const [file, reason] of Object.entries(DRY_RUN_EXEMPT)) {
      expect(reason.trim().length, file).toBeGreaterThanOrEqual(40);
    }
    for (const [file, entry] of Object.entries(DRY_RUN_COVERED)) {
      expect(entry.covers.trim().length, file).toBeGreaterThanOrEqual(30);
      if (entry.leaves !== undefined) {
        expect(entry.leaves.trim().length, file).toBeGreaterThanOrEqual(30);
      }
    }
  });

  it('cites only exemptions the dry-run module publishes', async () => {
    const { DRY_RUN_HOST_EXEMPTIONS } = await import('../../src/core/dryRun.js');
    const published = new Set(DRY_RUN_HOST_EXEMPTIONS.map(entry => entry.id));
    const text = [
      ...Object.values(DRY_RUN_EXEMPT),
      ...Object.values(DRY_RUN_COVERED).flatMap(entry => [entry.covers, entry.leaves ?? '']),
    ].join('\n');
    const cited = [...text.matchAll(/dry-run\.exempt-[a-z-]+/g)].map(match => match[0]);
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.filter(id => !published.has(id))).toEqual([]);
  });

  it('installs the host in every process that has a dry-run switch', () => {
    expect(code('extension.ts')).toMatch(/installDryRunHost\(new DryRunHost\(/);
    expect(code('cli/main.ts')).toMatch(/installDryRunHost\(new DryRunHost\(/);
    expect(code('cli/acpAgent.ts')).toMatch(/installDryRunHost\(new DryRunHost\(/);
  });
});
