/**
 * The places a check can actually run, declared rather than assumed.
 *
 * The Pipeline page had one route with a dashboard and several with brochure
 * cards. Everything in the guided flow — four steps, a queue, a container —
 * described the GitHub-connected local runner, so "check this change before I
 * push" routed a person through Docker, `gh`, a committed workflow and a queued
 * job to run commands they could have typed. Meanwhile the documentation's own
 * mode table opened by saying direct local execution is the simplest posture.
 *
 * This is the model that lets those be separate answers to the same question.
 * It is the CI analogue of `modelRouter`: a route is chosen from declared
 * capability rather than from whichever one the UI was built around, and the
 * choice publishes the rule behind it.
 *
 * Four rules carry the semantics.
 *
 * **A route declares what its evidence proves, and success never widens that.**
 * A green run in a Linux container is not evidence about Windows, however
 * green. `CiRouteEvidence` is a property of the *route*, fixed at declaration,
 * so no amount of passing can promote it — the same reason `localCiRunner`
 * carries an `evidenceLabel` rather than inferring one from an exit code.
 *
 * **An unknown capability is never a yes.** Three states, and `unknown` is
 * modelled explicitly, because a route silently treated as capable of holding
 * secrets is how a secret reaches a place nobody agreed to put it.
 *
 * **A route that is not implemented is declared, not hidden.** The Buildkite
 * and Woodpecker cards on the current page mark a real boundary — somebody
 * should be able to see that AtlasMind knows those exist and has not built
 * them — but a declared route can never be *selected*, and `status` is what
 * enforces that rather than a convention in the caller.
 *
 * **Availability is derived from the machine, never asserted.** A route with
 * unmet prerequisites is `blocked` and says which, so "why can I not run this
 * here" is answerable on the page instead of by reading source.
 *
 * Pure, `vscode`-free, filesystem-free, unit-tested. Phase 4's routing rules
 * consume this; nothing here decides *which* route to use.
 */

import {
  chainDeliveryCommands,
  classifyDeliveryCommandReach,
  classifyDeliveryShell,
  type DeliveryShellFamily,
} from './deliveryRunPlan.js';

export type CiRouteId =
  | 'direct-local'
  | 'local-runner'
  | 'github-hosted'
  | 'act'
  | 'buildkite'
  | 'woodpecker';

/**
 * What a passing run on this route actually establishes.
 *
 * Deliberately coarse. The point is not to describe an environment precisely
 * but to make one comparison possible: does this route's evidence satisfy what
 * a workload needs? A finer taxonomy would invite exactly the false equivalence
 * this exists to block.
 */
export type CiRouteEvidence =
  /** This developer's machine, OS, toolchain and working copy. */
  | 'this-machine'
  /** A Linux container. Says nothing about any host OS. */
  | 'linux-container'
  /** Whatever operating systems the workflow's own matrix declares. */
  | 'declared-matrix';

/**
 * How closely a route reproduces the thing it claims to be evidence *of*.
 *
 * Separate from `CiRouteEvidence` because the two are genuinely different
 * questions, and collapsing them was a real gap: `act` and the borrowed machine
 * both produce `linux-container` evidence, yet one runs GitHub's own runner
 * image and runner binary while the other runs deliberately incomplete images
 * with several GitHub services emulated. The evidence *class* could not tell
 * them apart, so a routing rule could substitute one for the other and the
 * model would raise no objection.
 *
 * Deliberately two values, not a score. A number would invite arithmetic
 * nobody can defend — is 0.7 fidelity enough for packaging? — where the real
 * question is binary: does this route run the declared thing, or something
 * close to it?
 */
export type CiRouteFidelity =
  /** Runs the declared thing in the declared environment. */
  | 'faithful'
  /** Runs something close. Some declared behaviour is emulated or absent. */
  | 'approximate';

export type CiCapability = 'yes' | 'no' | 'unknown';

export interface CiRouteCapabilities {
  /** Executes GitHub Actions workflow YAML as written. */
  githubWorkflowSyntax: CiCapability;
  /** Can produce evidence on operating systems other than this one. */
  crossPlatform: CiCapability;
  /** Can be given repository or environment secrets. */
  secrets: CiCapability;
  /** Uploads artifacts a later job or a person can retrieve. */
  artifacts: CiCapability;
  /** Each job gets a fresh worker that is destroyed afterwards. */
  ephemeralWorkers: CiCapability;
  /** Runs untrusted contributed code without endangering this machine. */
  safeForUntrustedCode: CiCapability;
}

/** Who pays, and in what. */
export type CiRouteCost =
  /** Only this machine's time and electricity. */
  | 'local-only'
  /** Metered against a hosted allowance that can run out. */
  | 'hosted-allowance'
  /** A third-party account AtlasMind does not model. */
  | 'external-account';

export interface CiRouteDefinition {
  id: CiRouteId;
  label: string;
  /** One line, in the words somebody choosing would use. */
  blurb: string;
  /** What a pass on this route proves — and, by omission, what it does not. */
  evidence: CiRouteEvidence;
  /** Stated in full on the card, because this is the sentence people skip. */
  evidenceCaveat: string;
  /** Whether this route runs the declared thing, or an approximation of it. */
  fidelity: CiRouteFidelity;
  /** Required for an approximate route: what is approximated, and how. */
  fidelityNote?: string;
  capabilities: CiRouteCapabilities;
  cost: CiRouteCost;
  /**
   * Whether AtlasMind can actually drive this route today.
   *
   * `implemented` routes may become available; `declared` ones mark the adapter
   * boundary and can never be selected however the machine is configured.
   */
  implementation: 'implemented' | 'declared';
  /** For a declared route, what adopting it would mean. */
  adapterNote?: string;
}

/**
 * Every route, in the order somebody should consider them.
 *
 * Cheapest and most immediate first. That ordering is itself a correction: the
 * page used to present the GitHub-connected runner as the route, and it is the
 * third thing most people need.
 */
export const CI_ROUTES: readonly CiRouteDefinition[] = [
  {
    id: 'direct-local',
    label: 'Run here',
    blurb: 'Run this project\'s own checks on this computer, now. No GitHub, no container, no setup.',
    evidence: 'this-machine',
    evidenceCaveat: 'Proves the commands passed on your operating system, your toolchain and your working copy — including any uncommitted changes. It says nothing about other platforms, and nothing about what a clean checkout would do.',
    capabilities: {
      githubWorkflowSyntax: 'no',
      crossPlatform: 'no',
      secrets: 'no',
      artifacts: 'no',
      ephemeralWorkers: 'no',
      safeForUntrustedCode: 'no',
    },
    cost: 'local-only',
    // Faithful to what it claims: this *is* your machine, so nothing about it
    // is approximated. The narrow evidence class is what limits it, not fidelity.
    fidelity: 'faithful',
    implementation: 'implemented',
  },
  {
    id: 'local-runner',
    label: 'Lend this computer to GitHub',
    blurb: 'Serve one queued GitHub job in a one-job container on this machine.',
    evidence: 'linux-container',
    evidenceCaveat: 'Proves Linux container behaviour only. A Linux container running on Windows or macOS is not evidence about Windows or macOS, and AtlasMind never counts it as platform coverage.',
    capabilities: {
      githubWorkflowSyntax: 'yes',
      crossPlatform: 'no',
      // Deliberately `no` rather than `unknown`: the trusted workflow policy
      // refuses any secret reference outright, so this is a property AtlasMind
      // enforces, not one it failed to determine.
      secrets: 'no',
      artifacts: 'yes',
      ephemeralWorkers: 'yes',
      safeForUntrustedCode: 'no',
    },
    cost: 'local-only',
    // GitHub's own official runner image and runner binary, executing the real
    // workflow. The container is local; what runs inside it is not an emulation.
    fidelity: 'faithful',
    implementation: 'implemented',
  },
  {
    id: 'github-hosted',
    label: 'GitHub-hosted runners',
    blurb: 'GitHub runs the workflow on its own machines, across whatever platforms it declares.',
    evidence: 'declared-matrix',
    evidenceCaveat: 'Proves what the workflow\'s own matrix declares, on clean machines, from the pushed commit. This is the only route here that can produce evidence for an operating system you are not sitting at.',
    capabilities: {
      githubWorkflowSyntax: 'yes',
      crossPlatform: 'yes',
      secrets: 'yes',
      artifacts: 'yes',
      ephemeralWorkers: 'yes',
      safeForUntrustedCode: 'yes',
    },
    cost: 'hosted-allowance',
    fidelity: 'faithful',
    implementation: 'implemented',
  },
  {
    id: 'act',
    label: 'act',
    blurb: 'Execute GitHub Actions workflows locally in containers, without GitHub.',
    evidence: 'linux-container',
    evidenceCaveat: 'Proves Linux container behaviour only, and less of it than the borrowed-machine route: act\'s images are deliberately incomplete and several GitHub services are partially emulated, so a pass is weaker evidence than the same workflow on a hosted runner. AtlasMind reads the workflow first and states exactly which parts will not run faithfully.',
    capabilities: {
      githubWorkflowSyntax: 'yes',
      crossPlatform: 'no',
      secrets: 'unknown',
      artifacts: 'unknown',
      ephemeralWorkers: 'yes',
      safeForUntrustedCode: 'no',
    },
    cost: 'local-only',
    fidelity: 'approximate',
    fidelityNote: 'Runs the real workflow file, but its images are deliberately incomplete and artifacts, caches, service containers, secrets and the event payload are emulated or absent. AtlasMind reads each workflow before offering a run and reports exactly which of those apply.',
    implementation: 'implemented',
  },
  {
    id: 'buildkite',
    label: 'Buildkite',
    blurb: 'A hosted control plane driving agents you run yourself.',
    evidence: 'declared-matrix',
    evidenceCaveat: 'Would prove whatever the agents you operate actually are — which AtlasMind cannot know without reading that configuration.',
    capabilities: {
      githubWorkflowSyntax: 'no',
      crossPlatform: 'unknown',
      secrets: 'yes',
      artifacts: 'yes',
      ephemeralWorkers: 'unknown',
      safeForUntrustedCode: 'unknown',
    },
    cost: 'external-account',
    // Not the same definition at all: these use their own pipeline format, so
    // what runs is a translation of the workflow rather than the workflow.
    fidelity: 'approximate',
    fidelityNote: 'Uses its own pipeline format, so what runs is a second definition of the checks rather than the one GitHub would run.',
    implementation: 'declared',
    adapterNote: 'Adapter not built. Uses its own pipeline format, so adopting it means maintaining a second definition of the checks.',
  },
  {
    id: 'woodpecker',
    label: 'Woodpecker CI',
    blurb: 'A lightweight self-hosted control plane with its own agents.',
    evidence: 'linux-container',
    evidenceCaveat: 'Would prove container behaviour on the backend you configure. Its local backend has no isolation at all, so only the container or Kubernetes backends are worth considering.',
    capabilities: {
      githubWorkflowSyntax: 'no',
      crossPlatform: 'unknown',
      secrets: 'yes',
      artifacts: 'yes',
      ephemeralWorkers: 'unknown',
      safeForUntrustedCode: 'unknown',
    },
    cost: 'external-account',
    // Not the same definition at all: these use their own pipeline format, so
    // what runs is a translation of the workflow rather than the workflow.
    fidelity: 'approximate',
    fidelityNote: 'Uses its own pipeline format, so what runs is a second definition of the checks rather than the one GitHub would run.',
    implementation: 'declared',
    adapterNote: 'Adapter not built. Uses its own pipeline format and expects an always-on server.',
  },
];

export function findCiRoute(id: string): CiRouteDefinition | undefined {
  return CI_ROUTES.find(route => route.id === id);
}

/** What the machine can currently offer, gathered by the caller. */
export interface CiRouteMachineFacts {
  /** A recognised package manager and at least one check script were found. */
  hasLocalChecks: boolean;
  dockerEngineAvailable: boolean;
  githubCliAuthenticated: boolean;
  /** The machine-scoped local-runner permission. */
  localRunnerPermitted: boolean;
  /** The trusted workflow passes the runner's policy. */
  trustedWorkflowReady: boolean;
  /** At least one quality workflow exists that GitHub could run. */
  hostedWorkflowPresent: boolean;
  /**
   * `act` resolves on PATH.
   *
   * Defaulted false by every caller that has not probed, so an unchecked
   * machine reports the route as blocked rather than as usable — the same
   * direction every other unprobed prerequisite takes.
   */
  actInstalled: boolean;
}

export type CiRouteStatus =
  /** Usable right now. */
  | 'available'
  /** Implemented, but something on this machine is missing. */
  | 'blocked'
  /** No adapter exists; it is listed to mark the boundary. */
  | 'unimplemented';

export interface CiRouteAvailability {
  route: CiRouteDefinition;
  status: CiRouteStatus;
  /** Why it is not available. Empty when it is. */
  blockers: string[];
  /** Which guide or page resolves the first blocker. */
  nextStep?: string;
}

/**
 * Whether each route can be used here, and what is stopping the ones that
 * cannot.
 *
 * A `declared` route is `unimplemented` regardless of the machine — checking
 * prerequisites for something with no adapter would produce an "available"
 * route nothing can run.
 */
export function describeCiRouteAvailability(
  facts: CiRouteMachineFacts,
  routes: readonly CiRouteDefinition[] = CI_ROUTES,
): CiRouteAvailability[] {
  return routes.map(route => {
    if (route.implementation === 'declared') {
      return {
        route,
        status: 'unimplemented' as const,
        blockers: [route.adapterNote ?? 'No adapter exists for this route yet.'],
      };
    }
    const blockers: string[] = [];
    let nextStep: string | undefined;

    if (route.id === 'direct-local' && !facts.hasLocalChecks) {
      blockers.push('No compile, build, lint or test script was found in this project.');
      nextStep = 'Add one to package.json.';
    }
    if (route.id === 'local-runner') {
      if (!facts.localRunnerPermitted) {
        blockers.push('Local CI is not permitted on this machine.');
        nextStep ??= 'Run /localci, or open the Runner view.';
      }
      if (!facts.trustedWorkflowReady) {
        blockers.push('The trusted workflow does not yet satisfy the runner policy.');
        nextStep ??= 'Check the trusted workflow on the Runner view.';
      }
      if (!facts.dockerEngineAvailable) {
        blockers.push('The Docker engine is not running.');
        nextStep ??= 'Run /localci, or open the Runner view.';
      }
      if (!facts.githubCliAuthenticated) {
        blockers.push('The GitHub CLI is not signed in, so the queue cannot be read.');
        nextStep ??= 'Run /localci, or open the Runner view.';
      }
    }
    if (route.id === 'act') {
      if (!facts.actInstalled) {
        blockers.push('`act` is not installed.');
        nextStep = 'Install it from nektosact.com, then refresh.';
      }
      if (!facts.dockerEngineAvailable) {
        blockers.push('The Docker engine is not running, and act needs it.');
        nextStep ??= 'Run /localci, or open the Runner view.';
      }
      if (!facts.hostedWorkflowPresent) {
        blockers.push('There is no workflow for act to run.');
        nextStep ??= 'Create one from the Workflow map.';
      }
    }
    if (route.id === 'github-hosted') {
      if (!facts.hostedWorkflowPresent) {
        blockers.push('No quality workflow was found for GitHub to run.');
        nextStep = 'Create one from the Workflow map.';
      }
    }

    return {
      route,
      status: blockers.length === 0 ? 'available' as const : 'blocked' as const,
      blockers,
      ...(nextStep ? { nextStep } : {}),
    };
  });
}

/**
 * Whether a route's evidence satisfies what a workload needs.
 *
 * The seed of Phase 4's routing rules, and the check that makes the nonsense
 * combinations unrepresentable: a Windows matrix leg cannot be satisfied by a
 * Linux container, however convenient that would be. `declared-matrix`
 * satisfies everything only because it is the one class that can include the
 * others — a hosted matrix may legitimately contain a Linux container job.
 */
export function routeSatisfiesEvidence(
  route: CiRouteDefinition,
  required: CiRouteEvidence,
): { satisfied: boolean; reason: string } {
  if (route.evidence === required) {
    return { satisfied: true, reason: `${route.label} produces ${required} evidence.` };
  }
  if (required === 'declared-matrix') {
    return {
      satisfied: false,
      reason: `${route.label} produces ${route.evidence} evidence, which cannot stand in for the platforms a matrix declares.`,
    };
  }
  if (route.evidence === 'declared-matrix') {
    return {
      satisfied: true,
      reason: `${route.label} runs whatever the workflow declares, which can include ${required} evidence.`,
    };
  }
  return {
    satisfied: false,
    reason: `${route.label} produces ${route.evidence} evidence, not ${required}.`,
  };
}

/** What a workload needs from a route. */
export interface CiRouteRequirement {
  evidence: CiRouteEvidence;
  /**
   * Whether an approximation will do.
   *
   * Optional, and absent means *approximate is acceptable* — the permissive
   * default is deliberate. Requiring fidelity is a statement about a specific
   * workload (packaging must build the artifact that ships), and making it the
   * default would silently refuse `act` for everything, which is not what the
   * evidence supports: under `act` your tests genuinely run in a Linux
   * container, and it is the workflow *orchestration* around them that is
   * emulated.
   */
  fidelity?: CiRouteFidelity;
}

/**
 * Whether a route satisfies a workload's requirement, on both axes.
 *
 * Supersedes checking evidence alone, which could not distinguish two routes in
 * the same evidence class — `act` and the borrowed machine both produce
 * `linux-container`, and one of them emulates half of what the workflow
 * declares. The reason is always returned, satisfied or not, because a
 * refusal nobody can read is indistinguishable from a bug.
 */
export function routeSatisfiesRequirement(
  route: CiRouteDefinition,
  requirement: CiRouteRequirement,
): { satisfied: boolean; reason: string } {
  const evidence = routeSatisfiesEvidence(route, requirement.evidence);
  if (!evidence.satisfied) {
    return evidence;
  }
  if (requirement.fidelity === 'faithful' && route.fidelity !== 'faithful') {
    return {
      satisfied: false,
      reason: `${route.label} approximates what it runs, and this needs the real thing. `
        + (route.fidelityNote ?? 'Some declared behaviour is emulated or absent.'),
    };
  }
  return {
    satisfied: true,
    reason: route.fidelity === 'faithful'
      ? evidence.reason
      : `${evidence.reason} It approximates some of what the workflow declares, which this workload tolerates.`,
  };
}

/** How the direct-local checks were chosen. Published, as the rule tables are. */
export type DirectLocalCheckRule = 'declared-aggregate' | 'validation-scripts';

/**
 * Aggregate scripts that mean "run the project's checks", in preference order.
 *
 * A project declaring one of these has already said what its checks are, and
 * running the parts separately would second-guess it — this repository's own
 * `ci:local` chains six steps in a deliberate fail-fast order that
 * `compile, lint, test` does not reproduce.
 */
const AGGREGATE_CHECK_SCRIPTS = ['ci', 'ci:local', 'verify', 'check'] as const;

/**
 * The same four-verb vocabulary both workflow starters use.
 *
 * Shared deliberately: three surfaces disagreeing about what "the checks" means
 * would be three answers to one question, and the one people would trust is
 * whichever they read last.
 */
const VALIDATION_SCRIPTS = ['compile', 'build', 'lint', 'test'] as const;

export interface DirectLocalChecks {
  rule: DirectLocalCheckRule;
  /** Why this rule fired, for the card. */
  ruleDetail: string;
  scripts: string[];
}

/**
 * Which of the project's scripts constitute "run the checks here".
 *
 * Returns `undefined` when the project declares none, rather than inventing a
 * command: a route offering to run nothing is worse than a route that says it
 * cannot.
 */
export function resolveDirectLocalChecks(scripts: readonly string[]): DirectLocalChecks | undefined {
  const available = new Set(scripts.map(script => String(script ?? '').trim()).filter(Boolean));
  const aggregate = AGGREGATE_CHECK_SCRIPTS.find(script => available.has(script));
  if (aggregate) {
    return {
      rule: 'declared-aggregate',
      ruleDetail: `This project declares a \`${aggregate}\` script, so AtlasMind runs that rather than guessing at its parts.`,
      scripts: [aggregate],
    };
  }
  const sequence = VALIDATION_SCRIPTS.filter(script => available.has(script));
  return sequence.length > 0
    ? {
      rule: 'validation-scripts',
      ruleDetail: 'No aggregate check script is declared, so AtlasMind runs the build, lint and test scripts it found, in that order.',
      scripts: [...sequence],
    }
    : undefined;
}

export interface DirectLocalRunPlan {
  routeId: 'direct-local';
  checks: DirectLocalChecks;
  /** Full command strings, in order. */
  commands: string[];
  /** Exactly what will be written to the terminal. */
  lines: string[];
  failFast: boolean;
  shellFamily: DeliveryShellFamily;
}

/**
 * A plan, or a refusal naming the commands that would have left this machine.
 *
 * A union rather than a warning flag, so the refusal is structural: a caller
 * cannot reach a runnable plan without the outward check having passed, and a
 * refactor cannot demote it to an ignored field.
 */
export type DirectLocalRunOutcome =
  | { ok: true; plan: DirectLocalRunPlan }
  | { ok: false; reason: string; outward: string[] };

/**
 * Plan a direct-local run.
 *
 * Reuses `deliveryRunPlan`'s shell classification and chaining rather than
 * repeating them: whether a shell can stop on failure is one question, and
 * Windows PowerShell 5.1 having no `&&` must not be answered differently here
 * than on the Delivery page.
 *
 * **A check command that reaches outside this machine is refused, not warned
 * about.** The Delivery runbook may legitimately publish, so there reach is an
 * emphasis in a confirmation. This route exists to be the safe, immediate one —
 * "run the tests" — and a project whose `test` script deploys should not have
 * that happen because somebody pressed a button labelled Run here. The reach
 * classifier is shared, so the two surfaces agree about what outward means.
 */
export function buildDirectLocalRunPlan(
  checks: DirectLocalChecks,
  packageManager: 'npm' | 'pnpm' | 'yarn',
  shellPath: string | undefined,
): DirectLocalRunOutcome {
  const run = (script: string): string => packageManager === 'npm'
    ? `npm run ${script}`
    : `${packageManager} ${script}`;
  const commands = checks.scripts.map(run);
  const outward = commands.filter(command => classifyDeliveryCommandReach(command) === 'outward');
  if (outward.length > 0) {
    return {
      ok: false,
      outward,
      reason: `This project's check scripts include something that leaves this machine (${outward.join(', ')}). `
        + 'AtlasMind will not run that from a button labelled "run here" — use the Delivery runbook, where a command that publishes or deploys is expected and confirmed as such.',
    };
  }
  const shellFamily = classifyDeliveryShell(shellPath);
  const { lines, failFast } = chainDeliveryCommands(commands, shellFamily);
  return {
    ok: true,
    plan: {
      routeId: 'direct-local',
      checks,
      commands,
      lines,
      failFast,
      shellFamily,
    },
  };
}

export interface DirectLocalRunConfirmation {
  title: string;
  detail: string;
  confirmLabel: string;
}

/**
 * The sentence read before a direct-local run.
 *
 * States the three things this route must not leave implicit: the exact
 * commands, that a pass is evidence about *this* machine only, and whether a
 * failure stops the rest.
 */
export function buildDirectLocalRunConfirmation(plan: DirectLocalRunPlan): DirectLocalRunConfirmation {
  const count = plan.commands.length;
  const route = findCiRoute('direct-local')!;
  const lines = [
    `AtlasMind will run ${count} command${count === 1 ? '' : 's'} in a terminal, in this order:`,
    '',
    ...plan.commands.map((command, index) => `${index + 1}. ${command}`),
    '',
    plan.checks.ruleDetail,
    '',
    route.evidenceCaveat,
    '',
    plan.failFast
      ? 'A failing command stops the ones after it.'
      : 'This shell has no fail-fast chaining, so each command is sent separately: a failure will NOT stop the rest.',
    'AtlasMind does not read the terminal output; check the result yourself.',
  ];
  return {
    title: 'Run this project\'s checks here?',
    detail: lines.join('\n'),
    confirmLabel: `Run ${count} command${count === 1 ? '' : 's'}`,
  };
}
