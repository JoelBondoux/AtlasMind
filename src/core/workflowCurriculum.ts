/**
 * The guided GitHub workflow, as teachable data.
 *
 * `docs/guided-github-workflow.md` is the normative specification; this module
 * is the machine-readable form of it, and the source of every word the Workflow
 * dashboard shows. Three properties are deliberate:
 *
 * 1. **Derived, never model-generated.** A hallucinated workflow step is worse
 *    than no step at all — somebody would follow it. Status comes from observed
 *    repository state; the prose is written here and reviewed like code.
 *
 * 2. **Teaching content is a first-class field, not a tooltip afterthought.**
 *    `why` and `how` are required on every step, and `commonMistakes` exists
 *    because knowing the happy path is not the same as recognising the failure.
 *    The audience includes someone learning professional practice for the first
 *    time, so a step that says only *what* to do has not done its job.
 *
 * 3. **Built on {@link SetupStep}, not beside it.** The setup-walkthrough model
 *    already has status, progress counting and next-step selection, all pure and
 *    tested. Forking a second step model is how the chat guidance and the
 *    dashboard guidance would drift apart — which is the exact failure the
 *    specification exists to fix.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type { SetupGuidanceLine, SetupStatus, SetupStep } from './setupWalkthrough.js';

// ── Stage identity ───────────────────────────────────────────────────────────

/**
 * The eight stages, frozen.
 *
 * These ids appear in the specification, in `workflow.json`, in the audit
 * record, and in the dashboard. Renaming one is a breaking change to a
 * persisted document, so they are enumerated rather than derived.
 */
export type WorkflowStageId =
  | 'planning'
  | 'branching'
  | 'development'
  | 'pull-request'
  | 'ci'
  | 'release'
  | 'maintenance'
  | 'automation';

export const WORKFLOW_STAGE_IDS: readonly WorkflowStageId[] = [
  'planning',
  'branching',
  'development',
  'pull-request',
  'ci',
  'release',
  'maintenance',
  'automation',
] as const;

/**
 * Who a step is for.
 *
 * `core` is everyone. `team` only applies once more than one person is
 * involved — showing it to a solo developer is noise that teaches them to skim.
 * `advanced` is real but not needed to work the workflow correctly.
 */
export type WorkflowProficiency = 'core' | 'team' | 'advanced';

// ── The teachable step ───────────────────────────────────────────────────────

export interface WorkflowStep extends SetupStep {
  /** Why this step exists at all. Answers "could I skip this?" honestly. */
  why: string;
  /** The concrete how-to, ordered. Reuses the guidance-line shape. */
  how: SetupGuidanceLine[];
  /** What people actually get wrong here. Optional only where nothing does. */
  commonMistakes?: string[];
  /** Glossary keys explained on demand — see {@link WORKFLOW_GLOSSARY}. */
  glossary?: readonly string[];
  proficiency: WorkflowProficiency;
}

export interface WorkflowStageDefinition {
  id: WorkflowStageId;
  /** 1-based, matching the specification's numbering. */
  ordinal: number;
  name: string;
  /** One line, for the flow strip. */
  blurb: string;
  /** Why the stage exists — the `?` on the stage header. */
  why: string;
  ownerAgentId: string;
  supportingAgentIds: readonly string[];
  /** The `gh` surface this stage uses, for the "what will this run?" answer. */
  githubSurface: readonly string[];
  /** What is reproducible here, stated plainly — including where it is not. */
  determinism: string;
  status: SetupStatus;
  steps: WorkflowStep[];
}

export interface GlossaryEntry {
  term: string;
  definition: string;
}

// ── Observed state ───────────────────────────────────────────────────────────

/**
 * Everything the curriculum needs, gathered by the caller.
 *
 * Every field is *observed* rather than self-reported: whether a file exists,
 * whether a command answered, what a count actually is. A field the caller
 * could not determine is `undefined`, and a step whose evidence is `undefined`
 * reports `todo` rather than guessing — "not known" and "not done" are
 * different, and only one of them is the user's problem.
 */
export interface WorkflowObservedState {
  // Stage 1 — planning
  /** `gh repo view` resolved a slug. Everything GitHub-shaped depends on it. */
  repoSlug?: string;
  ghInstalled?: boolean;
  ghAuthenticated?: boolean;
  openIssueCount?: number;
  staleIssueCount?: number;
  hasIssueTemplates?: boolean;
  declaredLabelCount?: number;

  // Stage 2 — branching
  currentBranch?: string;
  integrationBranch?: string;
  protectedBranches?: readonly string[];
  workingTreeClean?: boolean;
  /** Branches that do not match the declared naming convention. */
  nonConformingBranchCount?: number;

  // Stage 3 — development
  enabledTestingMethodologyIds?: readonly string[];

  // Stage 4 — pull request
  hasPullRequestTemplate?: boolean;
  hasCodeOwners?: boolean;
  requiredApprovers?: number;

  // Stage 5 — CI
  ciWorkflowCount?: number;
  /** Worst-state-wins across the head commit's check runs. */
  ciStatus?: 'pass' | 'fail' | 'pending' | 'none';
  hasTestReport?: boolean;

  // Stage 6 — release
  currentVersion?: string;
  hasChangelog?: boolean;
  changelogHasCurrentVersion?: boolean;
  commitsSinceLastTag?: number;

  // Stage 7 — maintenance
  hasDebtRegister?: boolean;
  staleDocumentCount?: number;
  openDependencyPrCount?: number;

  // Stage 8 — automation
  workflowConfigPresent?: boolean;
  workflowEnabled?: boolean;
  /** The profile declared in `workflow.json`. */
  profile?: 'solo' | 'studio' | 'custom';
}

// ── Glossary ─────────────────────────────────────────────────────────────────

/**
 * Terms a first-time reader will hit.
 *
 * Written to be read cold. Each definition says what the thing *is* before it
 * says what to do with it, because a definition that assumes the surrounding
 * vocabulary only helps people who did not need it.
 */
export const WORKFLOW_GLOSSARY: Readonly<Record<string, GlossaryEntry>> = {
  'integration-branch': {
    term: 'Integration branch',
    definition:
      'The branch where day-to-day work is collected before it is released — commonly `develop`. It is expected to move constantly and occasionally break. It is not the branch users install from.',
  },
  'protected-branch': {
    term: 'Protected branch',
    definition:
      'A branch GitHub refuses to let you push to directly. Changes reach it only through a pull request that passed its required checks. This is what stops a bad afternoon from becoming a bad release.',
  },
  'conventional-commits': {
    term: 'Conventional commits',
    definition:
      'A commit-message convention — `feat:`, `fix:`, `docs:`, `chore:`, and `!` or a `BREAKING CHANGE:` footer for incompatible changes. Its value is that a machine can read your history: the version bump and the changelog are derived from it rather than remembered.',
  },
  semver: {
    term: 'Semantic versioning (SemVer)',
    definition:
      'A three-part version, `MAJOR.MINOR.PATCH`. Patch for fixes, minor for new backwards-compatible capability, major for anything that breaks an existing user. The promise is to the people depending on you, which is why the rule is about *their* experience rather than the size of your diff.',
  },
  'pull-request': {
    term: 'Pull request',
    definition:
      'A proposal to merge one branch into another, with a place to discuss it and a place for automated checks to report. Even alone, it is worth opening: it is where CI runs and where the reasoning is recorded for the version of you that returns in six months.',
  },
  'check-run': {
    term: 'Check run',
    definition:
      'One automated job reporting a result against a commit — a build, a test suite, a linter. A "required" check is one branch protection will not let you merge without.',
  },
  'branch-protection': {
    term: 'Branch protection',
    definition:
      'GitHub settings on a branch: require a pull request, require named checks to pass, restrict force-pushes and deletion. It is where a workflow stops being a habit and becomes a rule.',
  },
  tag: {
    term: 'Tag',
    definition:
      'A permanent name for one commit, conventionally `v1.4.0`. Unlike a branch it does not move, which is what makes it a reliable answer to "what exactly did we ship?"',
  },
  changelog: {
    term: 'Changelog',
    definition:
      'A human-written record of what changed in each version. Distinct from the commit log: the commit log is what you did, the changelog is what it means for someone using your software.',
  },
  dora: {
    term: 'DORA metrics',
    definition:
      'Four measures of delivery health from the DevOps Research and Assessment programme: how often you deploy, how long a change takes to reach production, how often a change causes a failure, and how quickly you recover. Useful because they are about flow and stability together — optimising either alone goes wrong.',
  },
  'lead-time': {
    term: 'Lead time for change',
    definition:
      'How long from starting a change to it being live. Long lead times usually mean work is queued somewhere — waiting for review, waiting for a release window — rather than that people are slow.',
  },
  flake: {
    term: 'Flaky test',
    definition:
      'A test that passes and fails on the same code. Corrosive out of proportion to its frequency: once a red build might mean nothing, people stop reading red builds. Track them; do not re-run until green.',
  },
  'tech-debt': {
    term: 'Technical debt',
    definition:
      'Work deliberately deferred to ship sooner. The debt metaphor is exact — taking some is often correct, and the danger is the interest you pay by forgetting it exists. Recording it is the whole discipline.',
  },
  triage: {
    term: 'Triage',
    definition:
      'Deciding what an incoming issue is and what happens next — labelling it, prioritising it, or closing it. Unfashionable and load-bearing: an untriaged backlog is indistinguishable from no backlog.',
  },
  'code-owners': {
    term: 'Code owners',
    definition:
      'A file mapping paths to people or teams who are automatically asked to review changes there. Best declared before a team grows past about five, while it is still administrative rather than political.',
  },
  'draft-pr': {
    term: 'Draft pull request',
    definition:
      'A pull request explicitly marked not-ready. It runs CI and shows your direction without asking anyone to review yet — the honest way to open early.',
  },
  'squash-merge': {
    term: 'Squash merge',
    definition:
      'Combining every commit on a branch into one commit on the target. Keeps the main history readable at the cost of the branch\'s intermediate steps — usually the right trade for a shared branch.',
  },
  'working-tree': {
    term: 'Working tree',
    definition:
      'The files as they currently are on disk, including edits not yet committed. "Clean" means nothing is uncommitted — the state you want before switching branches or releasing.',
  },
  'force-push': {
    term: 'Force push',
    definition:
      'Overwriting the remote branch history with yours. It can destroy a colleague\'s commits without warning. AtlasMind never force-pushes; where a force is unavoidable it uses a lease, and to a protected branch it refuses.',
  },
  'automation-level': {
    term: 'Automation level',
    definition:
      'How much AtlasMind may do on your behalf at a given stage: observe, draft, propose, or auto. Everything ships at observe, and four independent switches must agree before anything higher takes effect.',
  },
};

export function glossaryEntry(key: string): GlossaryEntry | undefined {
  return WORKFLOW_GLOSSARY[key];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Status from evidence.
 *
 * `undefined` evidence means "could not determine", which reports `todo` — the
 * actionable state — rather than `done`. Claiming a step is finished on absent
 * evidence is the one error this whole surface exists to avoid.
 */
function statusFrom(evidence: boolean | undefined, blockedBy?: boolean): SetupStatus {
  if (blockedBy === true) {
    return 'blocked';
  }
  return evidence === true ? 'done' : 'todo';
}

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

// ── The curriculum ───────────────────────────────────────────────────────────

/**
 * Build the eight stages against observed state.
 *
 * Ordered as the specification orders them, which is the order things actually
 * fail in: you cannot name a branch for an issue that does not exist, and you
 * cannot analyse a check run before there is a pull request to attach it to.
 */
export function buildWorkflowCurriculum(state: WorkflowObservedState): WorkflowStageDefinition[] {
  return [
    buildPlanningStage(state),
    buildBranchingStage(state),
    buildDevelopmentStage(state),
    buildPullRequestStage(state),
    buildCiStage(state),
    buildReleaseStage(state),
    buildMaintenanceStage(state),
    buildAutomationStage(state),
  ];
}

// ── Stage 1 — planning ───────────────────────────────────────────────────────

function buildPlanningStage(state: WorkflowObservedState): WorkflowStageDefinition {
  const hasRepo = Boolean(state.repoSlug);
  const openIssues = count(state.openIssueCount);
  const stale = count(state.staleIssueCount);
  const labels = count(state.declaredLabelCount);

  const steps: WorkflowStep[] = [
    {
      id: 'planning.connect',
      title: 'Connect the repository',
      status: statusFrom(hasRepo),
      detail: hasRepo
        ? `Connected to \`${state.repoSlug}\`.`
        : state.ghInstalled === false
          ? 'The GitHub CLI is not installed, so AtlasMind cannot see your repository.'
          : state.ghAuthenticated === false
            ? 'The GitHub CLI is installed but not signed in.'
            : 'No GitHub repository resolved for this workspace.',
      why: 'Every later stage needs to know which repository it is talking about. AtlasMind resolves it once, from the GitHub CLI, and never stores a token of its own — your GitHub authorisation stays managed by GitHub\'s tooling, where you can revoke it.',
      how: [
        { text: 'Install the GitHub CLI if you have not already.', command: 'gh --version', authored: true },
        { text: 'Sign in. This opens a browser and stores the credential in your OS keychain, not in AtlasMind.', command: 'gh auth login', authored: true },
        { text: 'Confirm AtlasMind can see the repository.', command: 'gh repo view --json nameWithOwner', authored: true },
      ],
      commonMistakes: [
        'Signing in to the wrong account when you have both a personal and a work login — `gh auth status` shows which is active.',
        'Opening a folder that is inside a repository but has no remote configured. A local-only repository has no issues to read.',
      ],
      glossary: [],
      proficiency: 'core',
    },
    {
      id: 'planning.templates',
      title: 'Add issue templates',
      status: statusFrom(state.hasIssueTemplates, !hasRepo),
      detail: state.hasIssueTemplates
        ? 'Issue templates are present in `.github/ISSUE_TEMPLATE/`.'
        : hasRepo
          ? 'No issue templates found. Issues will arrive in whatever shape the reporter chose.'
          : 'Connect the repository first.',
      why: 'A template is the cheapest quality gate you will ever add. Without one, a bug report arrives as "it broke" and the next twenty minutes are spent asking what "it" was. The template asks those questions once, in writing, before the issue reaches you.',
      how: [
        { text: 'AtlasMind can scaffold templates alongside the rest of your GitHub governance files, without overwriting anything that exists.' },
        { text: 'Run the bootstrap command from chat:', command: '/bootstrap', authored: true },
        { text: 'Or create `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md` by hand.' },
      ],
      commonMistakes: [
        'Writing a template so long that people abandon it. Three required questions beats twelve optional ones.',
        'Asking for information the reporter cannot have, such as an internal build number.',
      ],
      glossary: ['triage'],
      proficiency: 'core',
    },
    {
      id: 'planning.labels',
      title: 'Declare a label taxonomy',
      status: statusFrom(labels > 0, !hasRepo),
      detail: labels > 0
        ? `${labels} ${plural(labels, 'label', 'labels')} declared in the workflow configuration.`
        : hasRepo
          ? 'No label taxonomy declared. AtlasMind will not invent labels, so drafts will arrive unlabelled.'
          : 'Connect the repository first.',
      why: 'Labels are how a backlog stays searchable past about thirty issues. Declaring them in the workflow configuration — rather than letting them accumulate — means AtlasMind can label a draft automatically and, importantly, will *drop* a label that is not in your taxonomy rather than inventing one. Invented labels fragment the filters that make the taxonomy useful.',
      how: [
        { text: 'Four axes cover most projects: type, priority, status, and area.' },
        { text: 'Type: `type:bug`, `type:feature`, `type:chore`, `type:docs`.' },
        { text: 'Priority: `priority:p0` through `priority:p2`. Resist adding p3 — an unused priority is a lie about your capacity.' },
        { text: 'Area: one per part of your codebase somebody might specialise in.' },
      ],
      commonMistakes: [
        'Creating labels ad hoc during triage. Within a month you have `bug`, `Bug`, and `type:bug`.',
        'Using labels for state a pull request already tracks, such as "in review".',
      ],
      glossary: ['triage'],
      proficiency: 'core',
    },
    {
      id: 'planning.acceptance',
      title: 'Write acceptance criteria before implementing',
      status: openIssues > 0 ? 'done' : 'todo',
      detail: openIssues > 0
        ? `${openIssues} open ${plural(openIssues, 'issue', 'issues')}${stale > 0 ? `, ${stale} untouched for over 30 days` : ''}.`
        : 'No open issues yet. The first one is the cheapest place to start this habit.',
      why: 'An issue without acceptance criteria cannot be finished, only abandoned — there is no agreed answer to "is it done?". Writing them first is also the cheapest design review available: about a third of the time, writing down what "done" means reveals that the work is not what you thought.',
      how: [
        { text: 'State the outcome, not the implementation. "A user can recover a deleted note within 30 days", not "add a `deletedAt` column".' },
        { text: 'Make each criterion something you could demonstrate. If you cannot show it, you cannot verify it.' },
        { text: 'List what is explicitly out of scope. This is what stops an issue growing while you work on it.' },
      ],
      commonMistakes: [
        'Criteria that restate the title. "The bug is fixed" is not a criterion.',
        'Leaving scope open. Without an out-of-scope list, every review comment is arguably in scope.',
      ],
      glossary: [],
      proficiency: 'core',
    },
  ];

  return {
    id: 'planning',
    ordinal: 1,
    name: 'Planning & Issue Intake',
    blurb: 'Turn an intention into a tracked, labelled issue.',
    why: 'Work that is not tracked cannot be prioritised, handed over, or remembered. This stage is where an intention becomes something with a number, so every later stage has one thing to point at.',
    ownerAgentId: 'github-operator',
    supportingAgentIds: [],
    githubSurface: ['gh repo view', 'gh issue list', 'gh issue create', 'gh issue comment'],
    determinism: 'A draft issue is a pure derivation of its source. Labels come only from the declared taxonomy — an unmatched label is dropped, never invented — so the same item produces a byte-identical draft every time.',
    status: deriveStageStatus(steps),
    steps,
  };
}

// ── Stage 2 — branching ──────────────────────────────────────────────────────

function buildBranchingStage(state: WorkflowObservedState): WorkflowStageDefinition {
  const integration = state.integrationBranch;
  const onProtected = Boolean(
    state.currentBranch && (state.protectedBranches ?? []).includes(state.currentBranch),
  );
  const nonConforming = count(state.nonConformingBranchCount);

  const steps: WorkflowStep[] = [
    {
      id: 'branching.integration',
      title: 'Name your integration branch',
      status: statusFrom(Boolean(integration)),
      detail: integration
        ? `Integration branch is \`${integration}\`.`
        : 'No integration branch declared. AtlasMind will not guess which branch is safe to build on.',
      why: 'You need one branch that is always safe to branch from and always safe to break — and it must not be the branch your users install from. Separating those two roles is the single decision the rest of the workflow rests on.',
      how: [
        { text: 'Most projects use `develop` for integration and `main` for release.' },
        { text: 'A smaller project may use `main` for both. That is a legitimate choice, but it means every merge is a release decision.' },
        { text: 'Declare the choice in the workflow configuration so AtlasMind branches from the right place.' },
      ],
      commonMistakes: [
        'Treating `main` as both. It works until the first time you need to ship a fix while something half-finished is already merged.',
      ],
      glossary: ['integration-branch', 'protected-branch'],
      proficiency: 'core',
    },
    {
      id: 'branching.protect',
      title: 'Protect the release branch',
      status: statusFrom((state.protectedBranches ?? []).length > 0),
      detail: (state.protectedBranches ?? []).length > 0
        ? `Protected: ${(state.protectedBranches ?? []).map(b => `\`${b}\``).join(', ')}.`
        : 'No protected branches configured. Anything can be pushed anywhere.',
      why: 'Protection is where a workflow stops being a habit you maintain by willpower and becomes a rule the platform enforces. It matters most when you are tired, in a hurry, or alone — which is exactly when a habit fails.',
      how: [
        { text: 'In GitHub: Settings → Branches → Add branch protection rule.' },
        { text: 'Require a pull request before merging.' },
        { text: 'Require your CI checks to pass by name.' },
        { text: 'Restrict force-pushes and branch deletion.' },
        { text: 'Keep admin enforcement on. Exempting yourself removes the protection at precisely the moment it would have helped.' },
      ],
      commonMistakes: [
        'Requiring reviews on a solo project, then routinely dismissing the requirement — which teaches you to route around the gate.',
        'Protecting the branch but leaving admin enforcement off.',
      ],
      glossary: ['protected-branch', 'branch-protection', 'force-push'],
      proficiency: 'core',
    },
    {
      id: 'branching.convention',
      title: 'Adopt a branch naming convention',
      status: nonConforming === 0 ? 'done' : 'todo',
      detail: nonConforming === 0
        ? 'All branches match the declared convention.'
        : `${nonConforming} ${plural(nonConforming, 'branch does', 'branches do')} not match the convention.`,
      why: 'A branch name is the only piece of context a colleague — or you, next week — gets before opening anything. `feat/142-derive-branch-names` says what and why; `fix2` says neither. Deriving the name from the issue also means the link back is never forgotten, because it was never typed.',
      how: [
        { text: 'Use `<type>/<issue>-<slug>`, for example `feat/142-derive-branch-names`.' },
        { text: 'Types match your commit types: `feat`, `fix`, `chore`, `docs`.' },
        { text: 'Let AtlasMind derive it from the issue rather than typing it — the derivation is pure, so the same issue always yields the same name.' },
      ],
      commonMistakes: [
        'Personal prefixes like `joel/thing`. They say who, which git already records, instead of what.',
        'Dates in branch names. The branch already knows when it was created.',
      ],
      glossary: ['conventional-commits'],
      proficiency: 'core',
    },
    {
      id: 'branching.clean',
      title: 'Branch from a clean tree',
      status: state.workingTreeClean === undefined
        ? 'todo'
        : state.workingTreeClean
          ? 'done'
          : 'blocked',
      detail: state.workingTreeClean === false
        ? 'The working tree has uncommitted changes.'
        : state.workingTreeClean
          ? `Working tree clean${onProtected ? ` — but you are on protected \`${state.currentBranch}\`.` : '.'}`
          : 'Working-tree state not determined.',
      why: 'Uncommitted changes follow you across a branch switch. That is occasionally useful and reliably confusing: work started for one issue silently lands in another branch, and the commit that eventually captures it attributes it to the wrong thing.',
      how: [
        { text: 'Check what is outstanding.', command: 'git status --short', authored: true },
        { text: 'Either commit it, or stash it deliberately.', command: 'git stash push -m "wip: before switching"', authored: true },
        { text: 'Then create the branch from the integration branch.' },
      ],
      commonMistakes: [
        'Stashing without a message, then finding four anonymous stashes a fortnight later.',
      ],
      glossary: ['working-tree'],
      proficiency: 'core',
    },
  ];

  return {
    id: 'branching',
    ordinal: 2,
    name: 'Branch Creation & Naming',
    blurb: 'Derive a conventional branch name and create it.',
    why: 'A branch is an isolated place to be wrong in. Naming it after the issue it serves means the isolation stays legible — you can tell what a branch is for without reading its diff.',
    ownerAgentId: 'github-operator',
    supportingAgentIds: [],
    githubSurface: ['gh api repos/{slug}/branches/{base}/protection'],
    determinism: 'Branch-name derivation is pure and idempotent: ASCII-slugged, length-capped at a word boundary, collisions resolved by an ordinal suffix rather than a hash or timestamp — so the same issue always yields a name you could have predicted.',
    status: deriveStageStatus(steps),
    steps,
  };
}

// ── Stage 3 — development ────────────────────────────────────────────────────

function buildDevelopmentStage(state: WorkflowObservedState): WorkflowStageDefinition {
  const methodologies = state.enabledTestingMethodologyIds ?? [];
  const hasMethodologies = methodologies.length > 0;

  const steps: WorkflowStep[] = [
    {
      id: 'development.testing',
      title: 'Choose your testing protocols',
      status: statusFrom(hasMethodologies),
      detail: hasMethodologies
        ? `${methodologies.length} ${plural(methodologies.length, 'protocol', 'protocols')} enabled: ${methodologies.slice(0, 6).join(', ')}${methodologies.length > 6 ? '…' : ''}.`
        : 'No testing protocols enabled. The workflow will not ask for test evidence it was never told to expect.',
      why: 'The workflow adapts to the protocols you actually practise. This is deliberate: a workflow that demanded behaviour-driven scenarios from a project that does not write them would be ignored, and a workflow that is ignored enforces nothing. What you enable here changes which checks appear on a pull request and which evidence CI is expected to produce.',
      how: [
        { text: 'Open the Testing page of the Project Dashboard and enable the protocols your project genuinely uses.' },
        { text: 'Start with `unit`. Add `tdd` only if you actually write the test first — enabling it as an aspiration produces a permanent false gap.' },
        { text: 'Practices such as `v-model` and `test-design` are ways of working rather than files, and are never counted as gaps.' },
      ],
      commonMistakes: [
        'Enabling everything. A dashboard full of gaps you have decided not to close teaches you to ignore gaps.',
        'Enabling a protocol without assigning an agent, so the work has no owner.',
      ],
      glossary: [],
      proficiency: 'core',
    },
    {
      id: 'development.smallcommits',
      title: 'Commit in reviewable steps',
      status: 'todo',
      detail: 'A practice rather than a setting — there is nothing for AtlasMind to detect here.',
      why: 'Review quality falls off a cliff with size. A reviewer reads a 40-line diff properly and skims a 400-line one, so a large pull request often buys agreement without buying scrutiny. Committing in steps also means the commit that broke something is findable.',
      how: [
        { text: 'One logical change per commit. If the message needs an "and", it is two commits.' },
        { text: 'Use conventional prefixes so the version bump and changelog can be derived rather than remembered.', command: 'git commit -m "feat: derive branch names from the linked issue"', authored: true },
        { text: 'Commit the test and the behaviour it covers together, so neither can land alone.' },
      ],
      commonMistakes: [
        'A single "wip" commit at the end of the day covering four unrelated changes.',
        'Mixing a refactor with a behaviour change. The reviewer can no longer tell which lines matter.',
      ],
      glossary: ['conventional-commits'],
      proficiency: 'core',
    },
    {
      id: 'development.orchestrate',
      title: 'Let agents decompose the work',
      status: 'optional',
      detail: 'Optional. The workflow is complete without it — this is the part AtlasMind adds.',
      why: 'Decomposition into a dependency graph lets independent work run in parallel and forces the ordering question early: what has to be true before this can start? Note the honest limit — the *scheduling* is reproducible, but the *decomposition* is produced by a language model and is not. Two runs of the same goal can produce different plans.',
      how: [
        { text: 'Start a run from chat with a goal rather than a task list.', command: '/project add a recovery window for deleted notes', authored: true },
        { text: 'Review the proposed plan before approving it. This is the checkpoint that matters most.' },
        { text: 'For bounded autonomous work with cost and iteration caps, use the mission loop.', command: '/loop', authored: true },
      ],
      commonMistakes: [
        'Approving a plan without reading it, then being surprised by what it touched.',
        'Treating a generated plan as reproducible. It is not, and the surface says so.',
      ],
      glossary: [],
      proficiency: 'advanced',
    },
  ];

  return {
    id: 'development',
    ordinal: 3,
    name: 'Local Development & Multi-Agent Orchestration',
    blurb: 'Do the work, against the protocols you chose.',
    why: 'This is where the change actually gets made. It is deliberately the only stage that never touches GitHub — so you can work offline, and so nothing here can accidentally become public.',
    ownerAgentId: 'orchestrator',
    supportingAgentIds: ['backend-engineer', 'frontend-engineer', 'test-developer', 'docs-writer'],
    githubSurface: [],
    determinism: 'Scheduling, testing-methodology assignment and run recording are reproducible. The plan itself is not — a language model produces it, and two runs of the same goal can differ. This stage claims determinism only over the parts that have it.',
    status: deriveStageStatus(steps),
    steps,
  };
}

// ── Stage 4 — pull request ───────────────────────────────────────────────────

function buildPullRequestStage(state: WorkflowObservedState): WorkflowStageDefinition {
  const approvers = count(state.requiredApprovers);
  const isStudio = state.profile === 'studio';

  const steps: WorkflowStep[] = [
    {
      id: 'pull-request.template',
      title: 'Add a pull request template',
      status: statusFrom(state.hasPullRequestTemplate),
      detail: state.hasPullRequestTemplate
        ? 'A pull request template is present.'
        : 'No pull request template found. Each pull request will describe itself in whatever way you remember at the time.',
      why: 'The template is what makes a pull request description consistent enough to be skimmed. It also carries the checklist — version bumped, changelog updated, docs touched — which is where most of the "we forgot" class of mistake gets caught.',
      how: [
        { text: 'Create `.github/pull_request_template.md`, or let AtlasMind scaffold it.', command: '/bootstrap', authored: true },
        { text: 'Include: a summary, the linked issue (`Closes #123`), a checklist, and a risk-and-rollback note.' },
        { text: 'Keep the checklist to things that are genuinely checkable.' },
      ],
      commonMistakes: [
        'A checklist so long everyone ticks it without reading. Five real items beat fifteen ceremonial ones.',
      ],
      glossary: ['pull-request'],
      proficiency: 'core',
    },
    {
      id: 'pull-request.link',
      title: 'Link every pull request to its issue',
      status: 'todo',
      detail: 'Use a closing keyword so the issue closes on merge.',
      why: 'The link is what turns two separate records into one history. Without it, the issue explaining *why* and the pull request showing *what* drift apart, and in a year the diff survives while the reasoning does not. Using a closing keyword also means the issue closes itself, which is the only reliable way issues get closed.',
      how: [
        { text: 'Put `Closes #142` in the pull request body — not just the title.' },
        { text: 'GitHub recognises `Closes`, `Fixes`, and `Resolves`. All behave identically.' },
        { text: 'For work that relates without completing, write `Refs #142` so it links without closing.' },
      ],
      commonMistakes: [
        'Writing the issue number without a keyword. It links, but the issue stays open forever.',
        'Referencing several issues with one keyword each, and closing work that is not finished.',
      ],
      glossary: ['pull-request'],
      proficiency: 'core',
    },
    {
      id: 'pull-request.review',
      title: isStudio ? 'Require a distinct approver' : 'Decide your review policy',
      status: isStudio ? statusFrom(approvers >= 1) : 'done',
      detail: isStudio
        ? approvers >= 1
          ? `${approvers} distinct ${plural(approvers, 'approver', 'approvers')} required.`
          : 'Studio profile with no required approvers. Review is optional in practice.'
        : 'Solo profile — zero required approvals. CI is the reviewer.',
      why: isStudio
        ? 'Requiring an approver distinct from the author is the one place where the studio profile differs from the solo profile in kind rather than degree. It is not about distrust; it is that the author is the person least able to see what they assumed.'
        : 'Working alone, requiring your own approval is theatre — and worse, it trains you to dismiss a gate. The honest solo answer is zero required approvals and genuinely enforced CI checks. CI becomes the reviewer, which is why its checks stop being optional.',
      how: isStudio
        ? [
            { text: 'In branch protection, require at least one approving review.' },
            { text: state.hasCodeOwners
              ? 'Your `CODEOWNERS` file already routes reviews — keep it current as ownership moves, because GitHub silently ignores an owner it cannot resolve.'
              : 'Add a `CODEOWNERS` file so the right person is asked automatically.' },
            { text: 'Rotate reviewers within the owning area, so review load follows a schedule rather than who is most agreeable.' },
          ]
        : [
            { text: 'Do not require approving reviews in branch protection.' },
            { text: 'Do require your CI checks by name — this is the gate that replaces the reviewer.' },
            { text: 'Still open the pull request. It is where CI reports and where the reasoning is recorded.' },
          ],
      commonMistakes: isStudio
        ? [
            'Approving your own pull request with a second account.',
            'Requiring two approvers on a team of three, so everything waits.',
          ]
        : [
            'Skipping the pull request entirely because nobody will read it. CI reads it.',
          ],
      glossary: ['pull-request', 'code-owners', 'draft-pr'],
      proficiency: isStudio ? 'team' : 'core',
    },
    {
      id: 'pull-request.untrusted',
      title: 'Treat review comments as untrusted input',
      status: 'done',
      detail: 'Enforced by AtlasMind — review text is sanitized and fenced before any agent reads it.',
      why: 'Anyone who can comment on a pull request can write text designed to be read as an instruction by an AI assistant. This is the workflow\'s primary prompt-injection surface. AtlasMind fences review bodies as reported content before they reach a prompt — the mitigation lives in how the prompt is built, not in a reviewer noticing.',
      how: [
        { text: 'Nothing to configure. Review bodies are control-stripped, secret-redacted, length-capped, and fenced automatically.' },
        { text: 'When you ask an agent to address feedback, it receives the comment as quoted evidence rather than as direction.' },
      ],
      commonMistakes: [
        'Pasting a review comment directly into a chat prompt yourself, which bypasses the fence.',
      ],
      glossary: [],
      proficiency: 'advanced',
    },
  ];

  return {
    id: 'pull-request',
    ordinal: 4,
    name: 'Pull Requests & Reviews',
    blurb: 'Open a pull request that links its issue and collects review.',
    why: 'A pull request is where a change stops being private. It is the point CI runs, the point a second pair of eyes can see it, and the durable record of why this change looked right at the time.',
    ownerAgentId: 'github-operator',
    supportingAgentIds: ['code-reviewer', 'security-reviewer'],
    githubSurface: ['gh pr create', 'gh pr list', 'gh pr view', 'gh pr diff', 'gh pr review', 'gh pr checks'],
    determinism: 'The draft title derives from the conventional-commit classification of the commit range, and the body is a fixed-order template fill — so the same range and template produce a byte-identical draft. No model authors the title.',
    status: deriveStageStatus(steps),
    steps,
  };
}

// ── Stage 5 — CI ─────────────────────────────────────────────────────────────

function buildCiStage(state: WorkflowObservedState): WorkflowStageDefinition {
  const workflows = count(state.ciWorkflowCount);

  const steps: WorkflowStep[] = [
    {
      id: 'ci.workflow',
      title: 'Add a CI workflow',
      status: statusFrom(workflows > 0),
      detail: workflows > 0
        ? `${workflows} ${plural(workflows, 'workflow', 'workflows')} in \`.github/workflows/\`.`
        : 'No CI workflows found. Nothing verifies a change before it merges.',
      why: 'CI is the only reviewer that never gets tired, never assumes, and never approves something because it is Friday. On a solo project it is not a supplement to review — it is the review.',
      how: [
        { text: 'Create `.github/workflows/ci.yml`, or let AtlasMind scaffold one.', command: '/bootstrap', authored: true },
        { text: 'Run it on pushes and pull requests to both your integration and release branches.' },
        { text: 'At minimum: install, build, lint, test.' },
        { text: 'Add `workflow_dispatch` so you can run it by hand on a branch with no pull request.' },
      ],
      commonMistakes: [
        'Running CI only on the release branch, so problems are found after merge.',
        'A workflow that passes when the test command is missing. Verify it can actually fail.',
      ],
      glossary: ['check-run'],
      proficiency: 'core',
    },
    {
      id: 'ci.required',
      title: 'Make the checks required',
      status: statusFrom((state.protectedBranches ?? []).length > 0 && workflows > 0, workflows === 0),
      detail: workflows === 0
        ? 'Add a CI workflow first — there are no checks to require.'
        : (state.protectedBranches ?? []).length > 0
          ? 'Branch protection is configured; confirm the check names are listed as required.'
          : 'Checks run but are not required, so a red build can still merge.',
      why: 'A check that runs but is not required is advisory, and advice gets overridden at exactly the moment it mattered. Making it required moves the decision from your judgement in the moment to a rule you set when you were thinking clearly.',
      how: [
        { text: 'In branch protection, tick "Require status checks to pass before merging".' },
        { text: 'Select each check by its exact job name — including the matrix suffix, such as `quality (ubuntu-latest)`.' },
        { text: 'A renamed job silently stops being required. Re-check this after editing a workflow.' },
      ],
      commonMistakes: [
        'Requiring a check name that no longer exists, which blocks every merge with no way forward.',
        'Renaming a CI job and not noticing the requirement quietly detached.',
      ],
      glossary: ['check-run', 'branch-protection'],
      proficiency: 'core',
    },
    {
      id: 'ci.failure',
      title: 'Read failures, do not re-run them',
      status: state.ciStatus === 'fail' ? 'todo' : 'done',
      detail: state.ciStatus === 'fail'
        ? 'Checks are currently failing on the head commit.'
        : state.ciStatus === 'pending'
          ? 'Checks are running.'
          : state.ciStatus === 'none'
            ? 'No check runs found for the head commit.'
            : 'Checks are green.',
      why: 'Re-running a failing job until it passes converts a flaky test into policy, and a flake is corrosive out of proportion to its frequency: once a red build might mean nothing, people stop reading red builds at all. AtlasMind classifies a failure from the log using a fixed rule table — no model involved — so the same log always yields the same classification and the taxonomy can be charted over time.',
      how: [
        { text: 'Open the failing run and read the failed step, not the summary.' },
        { text: 'Classify it honestly: dependency, compile, lint, test, timeout, flake, or infrastructure.' },
        { text: 'If it is genuinely a flake, record it as such rather than re-running. A tracked flake gets fixed; a re-run one does not.' },
        { text: 'AtlasMind never re-runs a job automatically, at any automation level.' },
      ],
      commonMistakes: [
        'Re-running until green and merging. The bug is still there and now nobody is looking for it.',
        'Assuming a red build is infrastructure because it was last time.',
      ],
      glossary: ['flake', 'check-run'],
      proficiency: 'core',
    },
    {
      id: 'ci.evidence',
      title: 'Produce a machine-readable test report',
      status: statusFrom(state.hasTestReport, workflows === 0),
      detail: workflows === 0
        ? 'Add a CI workflow first.'
        : state.hasTestReport
          ? 'A test report was found and can be read for failure detail.'
          : 'No test report found. AtlasMind will report "no verdict" rather than implying zero failures.',
      why: 'Without a report, a dashboard can only say whether a job exited non-zero. With one, it can name the failing test. The rule AtlasMind follows here is worth internalising: no report means *no verdict*, never "0 failing". A test suite that did not run is not a test suite that passed, and conflating the two is how a green dashboard hides a broken pipeline.',
      how: [
        { text: 'Emit a JUnit-format XML report from your test runner — nearly every runner supports it.' },
        { text: 'Vitest and Jest: add a JUnit reporter. Pytest: `--junitxml=report.xml`. Go: `gotestsum --junitfile`.' },
        { text: 'Write it to a stable path so the dashboard can find it.' },
      ],
      commonMistakes: [
        'Generating the report only on success, so it is absent exactly when it would be useful.',
      ],
      glossary: [],
      proficiency: 'advanced',
    },
  ];

  return {
    id: 'ci',
    ordinal: 5,
    name: 'CI/CD Integration & Failure Analysis',
    blurb: 'Watch the checks, and classify why they failed.',
    why: 'This stage is the difference between knowing a build failed and knowing why. Reading check states is cheap; reading the log and classifying the cause is what makes a failure actionable.',
    ownerAgentId: 'ci-analyst',
    supportingAgentIds: ['devops-engineer', 'test-developer'],
    githubSurface: ['gh api commits/{ref}/check-runs', 'gh run list', 'gh run view --log-failed'],
    determinism: 'Failure classification is an ordered, first-match-wins rule table over the log text with no model in the path — the same log bytes always yield the same classification, which is what makes a failure-taxonomy chart meaningful. An unmatched log is reported as `unknown` and escalated, never guessed.',
    status: deriveStageStatus(steps),
    steps,
  };
}

// ── Stage 6 — release ────────────────────────────────────────────────────────

function buildReleaseStage(state: WorkflowObservedState): WorkflowStageDefinition {
  const commits = count(state.commitsSinceLastTag);

  const steps: WorkflowStep[] = [
    {
      id: 'release.changelog',
      title: 'Keep a changelog',
      status: statusFrom(state.hasChangelog),
      detail: state.hasChangelog
        ? state.changelogHasCurrentVersion
          ? `\`CHANGELOG.md\` covers the current version${state.currentVersion ? ` (${state.currentVersion})` : ''}.`
          : `\`CHANGELOG.md\` exists but has no entry for the current version${state.currentVersion ? ` (${state.currentVersion})` : ''}.`
        : 'No `CHANGELOG.md` found.',
      why: 'The commit log records what you did; the changelog records what it means for someone using your software. They are not the same document and one cannot substitute for the other. The changelog is also what AtlasMind uses verbatim as release notes — which is deliberate, because generating a second, differently-worded description invites the two to disagree, and the one users read would be the unreviewed one.',
      how: [
        { text: 'Use Keep a Changelog format: a section per version, newest first, grouped by Added / Changed / Fixed / Removed.' },
        { text: 'Write entries for the reader, not the author. "Deleted notes can now be recovered for 30 days", not "added deletedAt column".' },
        { text: 'Update it in the same commit as the change, while you still remember why it mattered.' },
      ],
      commonMistakes: [
        'Generating the changelog from commit messages. It becomes a second commit log, which nobody reads twice.',
        'Batching changelog updates at release time, when the reasoning has evaporated.',
      ],
      glossary: ['changelog', 'semver'],
      proficiency: 'core',
    },
    {
      id: 'release.version',
      title: 'Bump the version from the commits',
      status: statusFrom(Boolean(state.currentVersion)),
      detail: state.currentVersion
        ? `Current version ${state.currentVersion}${commits > 0 ? `, ${commits} ${plural(commits, 'commit', 'commits')} since the last tag.` : '.'}`
        : 'No version found.',
      why: 'Semantic versioning is a promise to the people depending on you, which is why the rule is about *their* experience rather than the size of your diff. A one-line change that renames a configuration key is a major bump; a thousand-line internal refactor is a patch. Deriving the bump from conventional commits removes the judgement call at the moment you are least inclined to make it carefully.',
      how: [
        { text: 'Patch for fixes. Minor for new backwards-compatible capability. Major for anything that breaks an existing user.' },
        { text: 'With conventional commits, the bump is derivable: `fix:` → patch, `feat:` → minor, `!` or `BREAKING CHANGE:` → major.' },
        { text: 'AtlasMind classifies the range and applies the bump, preserving your file formatting.' },
      ],
      commonMistakes: [
        'Bumping by diff size rather than by compatibility.',
        'Staying on 0.x indefinitely to avoid the major-version conversation.',
      ],
      glossary: ['semver', 'conventional-commits'],
      proficiency: 'core',
    },
    {
      id: 'release.tag',
      title: 'Tag the release',
      status: statusFrom(Boolean(state.currentVersion) && commits === 0),
      detail: commits === 0 && state.currentVersion
        ? 'The current commit is tagged.'
        : `${commits} ${plural(commits, 'commit', 'commits')} since the last tag.`,
      why: 'A tag is the only thing that reliably answers "what exactly did we ship?". A branch moves; a tag does not. When a user reports a bug against version 1.4.0, the tag is what lets you check out precisely the code they are running.',
      how: [
        { text: 'Tag as `v<version>`, matching the version in your manifest exactly.' },
        { text: 'Let the pipeline create the tag after the release merges, rather than tagging by hand.' },
        { text: 'A tag and a publish should happen in exactly one place. Two paths that both publish will eventually both run.' },
      ],
      commonMistakes: [
        'Tagging before the release merges, so the tag points at a commit that never reached the release branch.',
        'A local publish script and a CI publish workflow that can both fire — the second fails on "version already exists", which looks like a broken pipeline.',
      ],
      glossary: ['tag', 'semver'],
      proficiency: 'core',
    },
    {
      id: 'release.gates',
      title: 'Pass the release gates',
      status: 'todo',
      detail: 'Five gates, evaluated in order against live state.',
      why: 'The gates are ordered so the first failure is the useful one. Reporting "you need approval" when the real problem is a failing check sends you to the wrong place. They are also evaluated against live state at the moment you act, not against whatever a screen last showed — a check that went red while you were reading still stops you.',
      how: [
        { text: '1. No blockers — nothing structurally prevents the release.' },
        { text: '2. No failing automatic check — CI, version bump, changelog entry.' },
        { text: '3. Every manual check attested — you confirm the things a machine cannot.' },
        { text: '4. Approval recorded, where the target requires it.' },
        { text: '5. Type-to-confirm on a protected target — you type the stage name.' },
      ],
      commonMistakes: [
        'Attesting a manual check without performing it. The record then says something untrue, which is worse than no record.',
      ],
      glossary: ['protected-branch'],
      proficiency: 'core',
    },
  ];

  return {
    id: 'release',
    ordinal: 6,
    name: 'Release Automation',
    blurb: 'Bump, changelog, tag, publish.',
    why: 'Releasing is the most consequential and least frequent thing you do, which is a bad combination — infrequent means unpractised. Automating the mechanical parts leaves your attention for the decision that actually needs it: whether to ship at all.',
    ownerAgentId: 'release-manager',
    supportingAgentIds: ['github-operator', 'devops-engineer', 'docs-writer'],
    githubSurface: ['gh release create', 'gh release view'],
    determinism: 'The bump is classified from conventional commits, applied by a pure function, and written back preserving file formatting. Release notes are the changelog section verbatim — never model-generated. Remediation may edit and commit, but never pushes, tags, or force-pushes.',
    status: deriveStageStatus(steps),
    steps,
  };
}

// ── Stage 7 — maintenance ────────────────────────────────────────────────────

function buildMaintenanceStage(state: WorkflowObservedState): WorkflowStageDefinition {
  const staleDocs = count(state.staleDocumentCount);
  const depPrs = count(state.openDependencyPrCount);
  const staleIssues = count(state.staleIssueCount);

  const steps: WorkflowStep[] = [
    {
      id: 'maintenance.debt',
      title: 'Record what you deferred',
      status: statusFrom(state.hasDebtRegister),
      detail: state.hasDebtRegister
        ? 'A tech-debt register is present.'
        : 'No tech-debt register. Deferred work exists only in memory.',
      why: 'Taking on technical debt is often the right call — the debt metaphor is exact, and borrowing to ship sooner is legitimate. The danger is the interest you pay by forgetting it exists. Recording it is the entire discipline. A solo developer has no colleague who remembers the shortcut, and a studio has no shared memory of it either.',
      how: [
        { text: 'When you knowingly take a shortcut, record it at that moment — with the file and line, not a description.' },
        { text: 'Severity comes from a declared rule, not a feeling. A score you assigned last week is not comparable with one you assign today, and comparability is the register\'s whole value.' },
        { text: 'Entries transition — open, accepted, resolved. Never delete one; a resolved item is evidence, a vanished one is a gap in the record.' },
      ],
      commonMistakes: [
        'A `TODO` comment instead of a register entry. It is invisible the moment you close the file.',
        'Recording debt without evidence. "The auth code is messy" cannot be acted on or verified.',
      ],
      glossary: ['tech-debt'],
      proficiency: 'core',
    },
    {
      id: 'maintenance.stale',
      title: 'Sweep stale issues and documents',
      status: staleIssues === 0 && staleDocs === 0 ? 'done' : 'todo',
      detail: staleIssues === 0 && staleDocs === 0
        ? 'Nothing stale detected.'
        : `${staleIssues} stale ${plural(staleIssues, 'issue', 'issues')}, ${staleDocs} stale ${plural(staleDocs, 'document', 'documents')}.`,
      why: 'An untriaged backlog is indistinguishable from no backlog. Issues nobody has touched in a month are either still real — in which case they need prioritising — or they are not, in which case closing them is a kindness to everyone who searches the backlog afterwards. Documentation rots the same way, silently, and stale documentation is worse than none because it is trusted.',
      how: [
        { text: 'Sweep on a fixed cadence rather than when it becomes urgent.' },
        { text: 'For each stale issue: reprioritise, or close with a reason. "Not planned" is a legitimate and respectful outcome.' },
        { text: 'AtlasMind never auto-closes an issue. Closing someone\'s report is a social act, not a cleanup task.' },
      ],
      commonMistakes: [
        'Closing stale issues in bulk with no explanation, which teaches reporters not to bother.',
        'Letting the sweep slip until the backlog is too large to face.',
      ],
      glossary: ['triage'],
      proficiency: 'core',
    },
    {
      id: 'maintenance.dependencies',
      title: 'Keep dependencies current, deliberately',
      status: depPrs === 0 ? 'done' : 'todo',
      detail: depPrs === 0
        ? 'No open dependency update pull requests.'
        : `${depPrs} open dependency ${plural(depPrs, 'update', 'updates')}.`,
      why: 'Dependency updates are the most reliably deferred maintenance there is, and deferring them compounds: a year of skipped minor versions becomes a major migration. But each update is also a supply-chain event, which is why AtlasMind never merges one automatically no matter what automation level you set.',
      how: [
        { text: 'Enable automated update pull requests — Dependabot or Renovate — on a weekly cadence.' },
        { text: 'Note that these arrive as pull requests, not issues. They pass through the same CI gate as your own work.' },
        { text: 'Review what changed, not just that CI passed. CI cannot detect a malicious package that behaves.' },
      ],
      commonMistakes: [
        'Auto-merging dependency updates because CI is green. That is precisely the attack.',
        'Batching a year of updates into one pull request, so no single change can be reasoned about.',
      ],
      glossary: [],
      proficiency: 'core',
    },
  ];

  return {
    id: 'maintenance',
    ordinal: 7,
    name: 'Maintenance & Tech-Debt',
    blurb: 'Keep the register of what was deferred, and age it visibly.',
    why: 'Every project accumulates deferred work. The projects that stay workable are not the ones that avoid it — they are the ones where it is written down, aged in public, and occasionally paid off on purpose.',
    ownerAgentId: 'refactorer',
    supportingAgentIds: ['dependency-manager', 'docs-writer'],
    githubSurface: ['gh issue list --label', 'gh issue comment', 'gh pr list --author app/dependabot'],
    determinism: 'Debt severity comes from a declared rule table rather than a model score, and ranking is a stable sort on severity, detection date and id — so the register can be compared with itself over time.',
    status: deriveStageStatus(steps),
    steps,
  };
}

// ── Stage 8 — automation ─────────────────────────────────────────────────────

function buildAutomationStage(state: WorkflowObservedState): WorkflowStageDefinition {
  const steps: WorkflowStep[] = [
    {
      id: 'automation.config',
      title: 'Declare your workflow',
      status: statusFrom(state.workflowConfigPresent),
      detail: state.workflowConfigPresent
        ? `Workflow configuration present${state.profile ? ` (${state.profile} profile).` : '.'}`
        : 'No workflow configuration. AtlasMind is using the built-in defaults.',
      why: 'Putting the workflow in a committed file is what stops it drifting. It also means a team that disagrees with a default disagrees in public, with a diff and a reviewer, rather than in a habit nobody wrote down. This is the difference between a workflow you have and a workflow you can point at.',
      how: [
        { text: 'Start from a profile — `solo` or `studio` — which seeds an initial configuration.' },
        { text: 'Once the file exists, the file wins. Changing the profile later never silently rewrites your stages.' },
        { text: 'Commit it. Changes to how a team works belong in review like any other change.' },
      ],
      commonMistakes: [
        'Keeping the workflow configuration out of version control, which recreates the drift problem it solves.',
      ],
      glossary: ['automation-level'],
      proficiency: 'core',
    },
    {
      id: 'automation.ladder',
      title: 'Understand the automation ladder',
      status: 'done',
      detail: state.workflowEnabled
        ? 'The workflow master switch is on. Per-stage levels still apply.'
        : 'The workflow master switch is off. Everything is observation only.',
      why: 'Five rungs — off, observe, draft, propose, auto — and four independent switches that must all agree before anything above observe takes effect. This is what makes "full automation is possible, never default" true by construction rather than by policy: the configuration file may request auto, and if any one of the four disagrees, auto does not happen.',
      how: [
        { text: '**observe** — read and display. Nothing is produced. This is the shipped default everywhere.' },
        { text: '**draft** — produce an artifact and show it. Nothing acts on it.' },
        { text: '**propose** — act, after an explicit confirmation naming the repository and the exact action.' },
        { text: '**auto** — act unattended, still inside the stage\'s gates and never past a hard ceiling.' },
        { text: 'Your personal settings can only *lower* the effective level, never raise it above what the repository declares.' },
      ],
      commonMistakes: [
        'Raising a stage to auto before the audit record has shown you what it would have done.',
      ],
      glossary: ['automation-level'],
      proficiency: 'core',
    },
    {
      id: 'automation.limits',
      title: 'Know what never automates',
      status: 'done',
      detail: 'Hard ceilings no file or setting can raise.',
      why: 'Some actions are excluded from automation at every level, not because they are difficult but because being wrong about them is expensive and irreversible. Knowing the list is part of trusting the rest.',
      how: [
        { text: 'AtlasMind never force-pushes, at any level, to anything.' },
        { text: 'It never deletes a tag or a release.' },
        { text: 'It never re-runs a CI job automatically — that turns a flake into policy.' },
        { text: 'It never edits a CI workflow file automatically — that file enforces the gates.' },
        { text: 'It never merges a dependency update automatically — that is a supply-chain event.' },
        { text: 'It never stores a GitHub token. Authorisation stays with the GitHub CLI, where you can revoke it.' },
      ],
      commonMistakes: [],
      glossary: ['force-push', 'flake'],
      proficiency: 'core',
    },
  ];

  return {
    id: 'automation',
    ordinal: 8,
    name: 'AI-Driven Automation Layer',
    blurb: 'The policy engine the other seven stages run inside.',
    why: 'This is not a step you perform. It is the layer that decides how much of the other seven AtlasMind may do on your behalf — and, just as importantly, records what it did so you can check.',
    ownerAgentId: 'orchestrator',
    supportingAgentIds: ['memory-agent'],
    githubSurface: [],
    determinism: 'Every stage transition is recorded with a fingerprint of its inputs and outputs. That record is what makes every other stage\'s determinism claim verifiable rather than aspirational: two runs with the same input fingerprint must produce the same output fingerprint.',
    status: deriveStageStatus(steps),
    steps,
  };
}

// ── Derived views ────────────────────────────────────────────────────────────

/**
 * A stage's status, from its steps.
 *
 * `optional` steps are excluded from the calculation entirely — a stage is not
 * unfinished because somebody declined something they were told was a choice.
 */
export function deriveStageStatus(steps: readonly WorkflowStep[]): SetupStatus {
  const counted = steps.filter(step => step.status !== 'optional');
  if (counted.length === 0) {
    return 'optional';
  }
  if (counted.every(step => step.status === 'done')) {
    return 'done';
  }
  if (counted.some(step => step.status === 'todo')) {
    return 'todo';
  }
  return 'blocked';
}

export interface WorkflowProgress {
  done: number;
  total: number;
  /** True only when every counted step across every stage is done. */
  finished: boolean;
}

/**
 * Progress across the whole curriculum.
 *
 * An empty curriculum reports **unfinished**, never finished — the same rule
 * the setup walkthrough uses, and for the same reason: a guide whose state
 * could not be gathered has not been completed, it has failed to load.
 */
export function summarizeWorkflowProgress(stages: readonly WorkflowStageDefinition[]): WorkflowProgress {
  let done = 0;
  let total = 0;
  for (const stage of stages) {
    for (const step of stage.steps) {
      if (step.status === 'optional') {
        continue;
      }
      total += 1;
      if (step.status === 'done') {
        done += 1;
      }
    }
  }
  return { done, total, finished: total > 0 && done === total };
}

/**
 * The next thing worth doing.
 *
 * `todo` before `blocked`, because a step you can act on now beats one waiting
 * on another. `optional` is never nominated.
 */
export function nextWorkflowStep(
  stages: readonly WorkflowStageDefinition[],
): { stage: WorkflowStageDefinition; step: WorkflowStep } | undefined {
  for (const status of ['todo', 'blocked'] as const) {
    for (const stage of stages) {
      const step = stage.steps.find(candidate => candidate.status === status);
      if (step) {
        return { stage, step };
      }
    }
  }
  return undefined;
}

/** Every glossary key referenced by a curriculum, de-duplicated and ordered. */
export function referencedGlossaryKeys(stages: readonly WorkflowStageDefinition[]): string[] {
  const seen = new Set<string>();
  for (const stage of stages) {
    for (const step of stage.steps) {
      for (const key of step.glossary ?? []) {
        seen.add(key);
      }
    }
  }
  return [...seen].sort();
}
