/**
 * What each project shape changes about the workflow.
 *
 * A game, a website, a library and a CLI do not share a CI pipeline, a release
 * mechanism, a testing strategy, a documentation set, or the same idea of what
 * counts as technical debt. Until this module the guided workflow treated them
 * identically, which meant it was tuned for none of them.
 *
 * A pack declares defaults across the six axes that actually differ. Three
 * properties are deliberate:
 *
 * 1. **Packs are data in source, not code branches.** They are reviewable in a
 *    diff and testable without a workspace, and a project can override any
 *    single item without abandoning the rest — which a branching implementation
 *    would not allow.
 *
 * 2. **A pack recommends; it never requires.** Everything here seeds a
 *    project's workflow configuration and is then owned by the project. The
 *    same rule as profiles: seeds, does not govern.
 *
 * 3. **Nothing is recommended that the archetype cannot produce evidence for.**
 *    A pack that asked a static site for load tests would create a permanent,
 *    unfixable gap — and a dashboard with a permanent false gap teaches people
 *    to ignore gaps. Where an axis genuinely does not apply, the pack says so
 *    rather than inventing an expectation.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type { TestingMethodologyId } from '../types.js';
import { ARCHETYPE_LABEL, type ArchetypeTrait, type ProjectArchetype } from './projectArchetype.js';

/** One CI step a pack recommends. Quoted for the user, never executed from here. */
export interface ArchetypeCiStep {
  id: string;
  label: string;
  /** What it does and why this shape needs it. */
  rationale: string;
  /** A representative command. The project supplies its real one. */
  exampleCommand?: string;
  /** True when a project of this shape should treat it as a required check. */
  required: boolean;
}

/** How this shape reaches its users. */
export interface ArchetypeReleaseModel {
  /** Where a release goes. */
  channel: string;
  /** What a release consists of. */
  artifacts: string[];
  /** What makes versioning here different, if anything. */
  versioningNote: string;
  /** Steps beyond bump-changelog-tag that this shape needs. */
  extraSteps: string[];
}

export interface ArchetypeTestingModel {
  /** Methodologies worth enabling for this shape. */
  recommended: TestingMethodologyId[];
  /** Why these and not others — the part that makes the recommendation usable. */
  rationale: string;
  /** Methodologies that would produce permanent false gaps here. */
  discouraged: TestingMethodologyId[];
  discouragedReason?: string;
}

export interface ArchetypeDocExpectation {
  path: string;
  why: string;
}

export interface ArchetypeRefactorHeuristic {
  id: string;
  label: string;
  /** What to look for, and why it matters more in this shape than elsewhere. */
  detail: string;
}

export interface ArchetypeIntelligence {
  /** Paths worth watching for this shape. */
  watchPaths: string[];
  /** What constitutes a hotspot here. */
  hotspotNote: string;
}

export interface ArchetypePack {
  archetype: ProjectArchetype;
  label: string;
  /** One line on what makes this shape's workflow different. */
  blurb: string;
  ci: ArchetypeCiStep[];
  release: ArchetypeReleaseModel;
  testing: ArchetypeTestingModel;
  documentation: ArchetypeDocExpectation[];
  refactor: ArchetypeRefactorHeuristic[];
  intelligence: ArchetypeIntelligence;
}

// ── Steps common to nearly everything ────────────────────────────────────────

const INSTALL: ArchetypeCiStep = {
  id: 'install',
  label: 'Install dependencies',
  rationale: 'Everything downstream depends on it, which is why a failure here is classified separately — nothing after it had a chance to run.',
  exampleCommand: 'npm ci',
  required: true,
};

const LINT: ArchetypeCiStep = {
  id: 'lint',
  label: 'Lint',
  rationale: 'Cheap to run and cheap to fix. Catches the class of problem that is tedious to raise in review.',
  exampleCommand: 'npm run lint',
  required: true,
};

const UNIT: ArchetypeCiStep = {
  id: 'test',
  label: 'Run tests',
  rationale: 'The gate that replaces a reviewer on a solo project, which is why it is required rather than advisory.',
  exampleCommand: 'npm test',
  required: true,
};

const BUILD: ArchetypeCiStep = {
  id: 'build',
  label: 'Build',
  rationale: 'A project that tests green but does not build is broken for everyone except its test runner.',
  exampleCommand: 'npm run build',
  required: true,
};

const KEEP_A_CHANGELOG: ArchetypeDocExpectation = {
  path: 'CHANGELOG.md',
  why: 'Records what changed for the people using this, which the commit log does not. Also used verbatim as release notes.',
};

const README: ArchetypeDocExpectation = {
  path: 'README.md',
  why: 'The first and often only thing anybody reads.',
};

// ── The packs ────────────────────────────────────────────────────────────────

const PACKS: Readonly<Record<ProjectArchetype, ArchetypePack>> = {
  game: {
    archetype: 'game',
    label: ARCHETYPE_LABEL.game,
    blurb: 'Frame budget and asset pipeline dominate. Correctness matters, but a game that is correct and stutters has failed.',
    ci: [
      INSTALL,
      { ...BUILD, rationale: 'Games usually have an asset pipeline as well as a code build, and an asset that fails to import breaks a level rather than a function.' },
      UNIT,
      {
        id: 'asset-validate',
        label: 'Validate assets',
        rationale: 'A missing or malformed asset is the most common way a game build passes CI and fails on a player\'s machine. Code tests will not catch it.',
        required: true,
      },
      {
        id: 'perf-budget',
        label: 'Check the frame budget',
        rationale: 'Performance is a correctness property here, not an optimisation. A regression that costs 4ms a frame is a bug even though every test passes.',
        required: false,
      },
    ],
    release: {
      channel: 'Platform store or direct build distribution',
      artifacts: ['Platform builds per target', 'Asset bundles'],
      versioningNote: 'Player-facing builds usually carry a build number alongside the semantic version, because players report problems by what they see on the title screen rather than by tag.',
      extraSteps: ['Produce a build per target platform', 'Verify assets load in a packaged build, not just in the editor'],
    },
    testing: {
      recommended: ['unit', 'property', 'performance', 'snapshot', 'determinism-boundary'],
      rationale: 'Unit tests for simulation and rules logic, property tests for state machines where the interesting bugs are combinatorial, performance as a first-class gate, and snapshots for deterministic rendering output.',
      discouraged: ['bdd', 'atdd', 'contract'],
      discouragedReason: 'Scenario-style specifications describe user journeys well and describe a physics step or a render loop badly, and a game publishes no contract for a consumer to verify. Enabling them here produces gaps nobody will ever close.',
    },
    documentation: [
      README,
      KEEP_A_CHANGELOG,
      { path: 'docs/controls.md', why: 'What the player can do, which is the thing testers and reviewers need first.' },
      { path: 'docs/asset-pipeline.md', why: 'How an asset gets from source to build — the part a new contributor cannot infer from the code.' },
    ],
    refactor: [
      { id: 'hot-loop-allocation', label: 'Allocation in the update loop', detail: 'Allocating per frame causes collection pauses that read as stutter. Harmless in a request handler; a visible defect here.' },
      { id: 'update-coupling', label: 'Simulation coupled to rendering', detail: 'Logic that reads render state cannot be tested headlessly and cannot run at a fixed timestep.' },
      { id: 'magic-tuning-values', label: 'Tuning values buried in code', detail: 'Balance numbers inline mean designers cannot change them without a build.' },
    ],
    intelligence: {
      watchPaths: ['assets/', 'src/systems/', 'src/entities/', 'scenes/'],
      hotspotNote: 'A hotspot here is code on the per-frame path, not code changed most often.',
    },
  },

  website: {
    archetype: 'website',
    label: ARCHETYPE_LABEL.website,
    blurb: 'Content and delivery dominate. The build is usually simple; what breaks is a link, an image budget, or a deploy.',
    ci: [
      INSTALL,
      BUILD,
      LINT,
      {
        id: 'link-check',
        label: 'Check links',
        rationale: 'A broken link is the most common defect on a site and the one least likely to be noticed by whoever introduced it.',
        required: true,
      },
      {
        id: 'lighthouse',
        label: 'Check performance and accessibility budgets',
        rationale: 'Both degrade gradually and invisibly. A budget in CI is the only thing that notices before a user does.',
        required: false,
      },
    ],
    release: {
      channel: 'Hosting platform, usually on merge',
      artifacts: ['Static build output'],
      versioningNote: 'Sites often deploy continuously and have no meaningful version. Where that is true, say so rather than maintaining a version nobody reads.',
      extraSteps: ['Preview deploy per pull request', 'Verify the built site, not the dev server'],
    },
    testing: {
      recommended: ['e2e', 'visual', 'unit', 'accessibility'],
      rationale: 'End-to-end for the handful of journeys that matter, visual regression because a site failing is usually a site looking wrong rather than throwing, and unit tests for whatever logic exists.',
      discouraged: ['mutation', 'property', 'chaos'],
      discouragedReason: 'Mutation and property testing target dense logic, and a content site has little — they measure almost nothing while reporting a gap. Chaos testing needs a distributed system to perturb; a static site has no failure to inject.',
    },
    documentation: [
      README,
      { path: 'docs/content-guide.md', why: 'How to add or edit a page without reading the templates.' },
      { path: 'docs/deployment.md', why: 'Where it deploys and what to do when it does not.' },
    ],
    refactor: [
      { id: 'unoptimised-media', label: 'Unoptimised images', detail: 'The single largest cause of a slow site, and invisible on a developer machine with a fast connection.' },
      { id: 'duplicated-layout', label: 'Duplicated layout markup', detail: 'Copy-pasted templates drift, and the drift shows up as pages that look subtly different.' },
      { id: 'hardcoded-copy', label: 'Copy hardcoded in templates', detail: 'Puts text changes behind a developer and a deploy.' },
    ],
    intelligence: {
      watchPaths: ['content/', 'src/pages/', 'public/', 'static/'],
      hotspotNote: 'A hotspot here is a page with heavy assets or many inbound links, not a frequently edited component.',
    },
  },

  'web-app': {
    archetype: 'web-app',
    label: ARCHETYPE_LABEL['web-app'],
    blurb: 'State and user journeys dominate. Most defects live in the gap between components rather than inside one.',
    ci: [INSTALL, LINT, UNIT, BUILD, {
      id: 'e2e',
      label: 'Run end-to-end tests',
      rationale: 'The only tests that exercise the journey a user actually takes. Unit tests can all pass while the app is unusable.',
      exampleCommand: 'npx playwright test',
      required: true,
    }],
    release: {
      channel: 'Hosting platform',
      artifacts: ['Application bundle'],
      versioningNote: 'Continuously deployed applications often version by commit rather than by tag; keep a changelog regardless, because users still need to know what changed.',
      extraSteps: ['Preview deploy per pull request', 'Run migrations before the new build serves traffic'],
    },
    testing: {
      recommended: ['unit', 'integration', 'e2e', 'visual', 'accessibility', 'type-drift'],
      rationale: 'Integration tests matter most here: the defects live between components, which is exactly what unit tests are blind to.',
      discouraged: [],
    },
    documentation: [README, KEEP_A_CHANGELOG, { path: 'docs/architecture.md', why: 'How state flows, which is the thing a new contributor most needs and can least infer.' }],
    refactor: [
      { id: 'prop-drilling', label: 'State threaded through many layers', detail: 'Makes every intermediate component depend on data it does not use.' },
      { id: 'unbounded-fetch', label: 'Requests without a cancellation path', detail: 'Produces state updates after unmount and races that only appear on slow connections.' },
      { id: 'duplicated-validation', label: 'Validation duplicated across client and server', detail: 'The two drift, and the client wins until somebody bypasses it.' },
    ],
    intelligence: {
      watchPaths: ['src/components/', 'src/pages/', 'src/state/', 'src/api/'],
      hotspotNote: 'A hotspot here is a module many others import, since a change there propagates.',
    },
  },

  api: {
    archetype: 'api',
    label: ARCHETYPE_LABEL.api,
    blurb: 'The contract dominates. Breaking a consumer you cannot see is the failure mode that matters.',
    ci: [INSTALL, LINT, UNIT, {
      id: 'contract',
      label: 'Verify the API contract',
      rationale: 'Consumers you cannot test against depend on this shape. A contract check is the only thing standing between a rename and somebody else\'s outage.',
      required: true,
    }, {
      id: 'migration-check',
      label: 'Check migrations apply cleanly',
      rationale: 'A migration that fails in production fails after the deploy has already started.',
      required: false,
    }],
    release: {
      channel: 'Deployment environment',
      artifacts: ['Container image or deployment bundle'],
      versioningNote: 'A breaking change to a request or response shape is a major bump even when the diff is one line — the promise is to consumers, not about effort.',
      extraSteps: ['Apply migrations before serving traffic', 'Verify a health endpoint after deploy'],
    },
    testing: {
      recommended: ['unit', 'integration', 'contract', 'security-testing', 'performance', 'output-schema-drift', 'type-drift', 'schema-migration', 'rbac-compliance'],
      rationale: 'Contract tests protect consumers; security testing matters because this surface is reachable by anyone; performance because latency is part of the contract in practice.',
      discouraged: ['visual', 'accessibility'],
      discouragedReason: 'There is nothing to look at, so neither could ever produce evidence — the gap would never be closable.',
    },
    documentation: [README, KEEP_A_CHANGELOG, { path: 'docs/api.md', why: 'The contract, written for somebody who cannot read the source.' }, { path: 'docs/runbook.md', why: 'What to do at 3am, written while it is not 3am.' }],
    refactor: [
      { id: 'unversioned-breaking-change', label: 'Response shape changed without a version', detail: 'The most expensive mistake available here, because it fails in somebody else\'s system.' },
      { id: 'n-plus-one', label: 'Query in a loop', detail: 'Invisible at development scale and dominant at production scale.' },
      { id: 'missing-timeout', label: 'Outbound call with no timeout', detail: 'One slow dependency becomes total unavailability.' },
    ],
    intelligence: {
      watchPaths: ['src/routes/', 'src/handlers/', 'migrations/', 'src/models/'],
      hotspotNote: 'A hotspot here is an endpoint with high traffic or a shared data access path.',
    },
  },

  cli: {
    archetype: 'cli',
    label: ARCHETYPE_LABEL.cli,
    blurb: 'The interface is the argument surface, and it runs on machines you have never seen.',
    ci: [INSTALL, LINT, UNIT, {
      id: 'cross-platform',
      label: 'Test on every supported platform',
      rationale: 'Path separators, line endings and shell quoting differ, and each one produces a bug that is invisible on the author\'s machine.',
      required: true,
    }],
    release: {
      channel: 'Package registry, and often a binary release',
      artifacts: ['Package', 'Platform binaries where applicable'],
      versioningNote: 'A removed or renamed flag is a breaking change. People script against a CLI, and a script is a consumer.',
      extraSteps: ['Verify the published package installs and runs from a clean environment'],
    },
    testing: {
      recommended: ['unit', 'integration', 'snapshot', 'cross-version-parity'],
      rationale: 'Snapshot tests suit a CLI unusually well: the output *is* the interface, so a diff in output is a diff in contract.',
      discouraged: ['visual', 'accessibility'],
      discouragedReason: 'There is no rendered surface to compare. Snapshot testing already covers the equivalent concern here, since terminal output is the interface — and an automated accessibility scan has no DOM to walk.',
    },
    documentation: [README, KEEP_A_CHANGELOG, { path: 'docs/usage.md', why: 'Every command and flag — the reference `--help` is too terse to be.' }],
    refactor: [
      { id: 'unhandled-exit-code', label: 'Failure paths that exit zero', detail: 'A script cannot detect a failure that reports success, so the error propagates silently.' },
      { id: 'stdout-pollution', label: 'Diagnostics written to stdout', detail: 'Breaks piping. Diagnostics belong on stderr.' },
      { id: 'assumed-cwd', label: 'Paths assumed relative to the working directory', detail: 'Works when run from the project root and nowhere else.' },
    ],
    intelligence: {
      watchPaths: ['src/commands/', 'src/cli/', 'bin/'],
      hotspotNote: 'A hotspot here is argument parsing and any path handling, where platform differences concentrate.',
    },
  },

  library: {
    archetype: 'library',
    label: ARCHETYPE_LABEL.library,
    blurb: 'The public surface is the product. Everything else is an implementation detail you can change freely.',
    ci: [INSTALL, LINT, UNIT, BUILD, {
      id: 'api-surface',
      label: 'Check the public API surface',
      rationale: 'The one check that catches an accidental breaking change before a consumer does. Everything else is internal.',
      required: true,
    }],
    release: {
      channel: 'Package registry',
      artifacts: ['Package', 'Type definitions where applicable'],
      versioningNote: 'Semantic versioning matters more here than anywhere else, because consumers automate against it. A one-line rename of an exported symbol is a major bump.',
      extraSteps: ['Verify the published package imports cleanly from a fresh install'],
    },
    testing: {
      recommended: ['unit', 'property', 'mutation', 'contract', 'cross-version-parity', 'cross-representation', 'dead-field'],
      rationale: 'Mutation testing earns its cost here: a library\'s tests are its specification, and a mutant that survives is a promise nothing enforces.',
      discouraged: ['e2e', 'visual', 'accessibility', 'chaos'],
      discouragedReason: 'A library has no application to drive, nothing to look at, and no infrastructure to perturb, so each would report a gap that can never close.',
    },
    documentation: [README, KEEP_A_CHANGELOG, { path: 'docs/api.md', why: 'Every exported symbol. For a library this is the product, not supporting material.' }, { path: 'MIGRATION.md', why: 'What to change on a major bump. Without it, consumers stay on the old version.' }],
    refactor: [
      { id: 'accidental-export', label: 'Internals exported', detail: 'Anything exported is a promise. An accidental export becomes a breaking change to remove.' },
      { id: 'peer-dependency-drift', label: 'Dependency that should be a peer', detail: 'Bundling what the consumer already has causes duplicate instances and subtle identity bugs.' },
      { id: 'undocumented-throw', label: 'Undocumented throwing path', detail: 'A consumer cannot handle an error they were never told about.' },
    ],
    intelligence: {
      watchPaths: ['src/index.*', 'src/public/', 'types/'],
      hotspotNote: 'A hotspot here is anything reachable from the public entry point.',
    },
  },

  desktop: {
    archetype: 'desktop',
    label: ARCHETYPE_LABEL.desktop,
    blurb: 'Ships to machines you cannot reach. Updating is something the user must accept, not something you deploy.',
    ci: [INSTALL, LINT, UNIT, BUILD, {
      id: 'package-platforms',
      label: 'Package for every target platform',
      rationale: 'Packaging breaks per platform and only per platform, so a build that succeeds on one says nothing about the others.',
      required: true,
    }],
    release: {
      channel: 'Direct download, or a platform store',
      artifacts: ['Installer per platform', 'Signed binaries'],
      versioningNote: 'Users may run any past version indefinitely, so a change must consider what happens to somebody three versions behind.',
      extraSteps: ['Sign and notarise where the platform requires it', 'Verify the auto-update path from the previous version'],
    },
    testing: {
      recommended: ['unit', 'integration', 'e2e', 'accessibility', 'state-drift'],
      rationale: 'End-to-end against a packaged build rather than a dev server — packaging is where desktop applications break.',
      discouraged: [],
    },
    documentation: [README, KEEP_A_CHANGELOG, { path: 'docs/install.md', why: 'Per platform, including what to do about the security warning the OS will show.' }],
    refactor: [
      { id: 'unsigned-artifact', label: 'Unsigned build artifact', detail: 'Users are shown a warning that makes the application look malicious.' },
      { id: 'no-migration-path', label: 'Local data format changed without migration', detail: 'A user upgrading from an old version loses their data.' },
      { id: 'blocking-main-thread', label: 'Work on the UI thread', detail: 'Freezes the window, which users read as a crash.' },
    ],
    intelligence: {
      watchPaths: ['src/main/', 'src/renderer/', 'build/'],
      hotspotNote: 'A hotspot here is anything touching local data or the update path — both are hard to fix remotely.',
    },
  },

  mobile: {
    archetype: 'mobile',
    label: ARCHETYPE_LABEL.mobile,
    blurb: 'Store review sits between you and your users, and an old version can persist for months.',
    ci: [INSTALL, LINT, UNIT, BUILD, {
      id: 'device-matrix',
      label: 'Test across a device matrix',
      rationale: 'Screen sizes and OS versions produce defects that a single simulator will never show.',
      required: true,
    }],
    release: {
      channel: 'App store',
      artifacts: ['Signed application bundle per platform'],
      versioningNote: 'Store review adds days between deciding to ship and shipping, so a fix cannot be assumed to reach users quickly. Plan releases accordingly.',
      extraSteps: ['Submit for store review', 'Stage the rollout rather than releasing to everyone at once'],
    },
    testing: {
      recommended: ['unit', 'integration', 'e2e', 'visual', 'accessibility', 'compatibility'],
      rationale: 'Visual regression matters here because layout breaks per device, and no unit test will notice.',
      discouraged: [],
    },
    documentation: [README, KEEP_A_CHANGELOG, { path: 'docs/release-process.md', why: 'Store submission has steps and waiting periods that nobody remembers between releases.' }],
    refactor: [
      { id: 'main-thread-io', label: 'I/O on the main thread', detail: 'Produces frame drops the platform will flag and reviewers may reject.' },
      { id: 'unbounded-memory', label: 'Images or lists loaded without bounds', detail: 'The most common cause of termination on older devices.' },
      { id: 'no-offline-path', label: 'No behaviour defined for offline', detail: 'Mobile networks fail routinely; unhandled means broken.' },
    ],
    intelligence: {
      watchPaths: ['src/screens/', 'src/navigation/', 'ios/', 'android/'],
      hotspotNote: 'A hotspot here is a screen on the primary journey, where a defect reaches the most users.',
    },
  },

  generic: {
    archetype: 'generic',
    label: ARCHETYPE_LABEL.generic,
    blurb: 'No shape declared, so the workflow stays general rather than guessing at specialisations that may not apply.',
    ci: [INSTALL, LINT, UNIT],
    release: {
      channel: 'Not declared',
      artifacts: [],
      versioningNote: 'Semantic versioning and a changelog apply to every project shape, so both are expected regardless.',
      extraSteps: [],
    },
    testing: {
      recommended: ['unit'],
      rationale: 'Unit testing applies everywhere. Declaring an archetype is what unlocks a recommendation worth acting on.',
      discouraged: [],
    },
    documentation: [README, KEEP_A_CHANGELOG],
    refactor: [],
    intelligence: {
      watchPaths: ['src/'],
      hotspotNote: 'Without a declared shape, a hotspot is simply a frequently changed file.',
    },
  },
};

/** The pack for an archetype. Always defined — `generic` is a real answer. */
export function archetypePack(archetype: ProjectArchetype): ArchetypePack {
  return PACKS[archetype];
}

export function allArchetypePacks(): ArchetypePack[] {
  return Object.values(PACKS);
}

/**
 * Extra expectations a trait adds, on top of the archetype's pack.
 *
 * Traits compose, so these are additive and must never contradict a pack. A
 * trait that needed to *remove* an expectation would be a sign the thing should
 * have been its own archetype.
 */
export function traitAdditions(trait: ArchetypeTrait): {
  ci: ArchetypeCiStep[];
  documentation: ArchetypeDocExpectation[];
  refactor: ArchetypeRefactorHeuristic[];
} {
  switch (trait) {
    case 'ships-binaries':
      return {
        ci: [{ id: 'artifact-verify', label: 'Verify the produced artifact runs', rationale: 'A binary that builds but does not start fails only on a user machine.', required: true }],
        documentation: [{ path: 'docs/install.md', why: 'How to install the artifact, including platform security prompts.' }],
        refactor: [{ id: 'unsigned-artifact', label: 'Unsigned artifact', detail: 'Users see a security warning that makes the software look malicious.' }],
      };
    case 'has-native-build':
      return {
        ci: [{ id: 'toolchain-pin', label: 'Pin the build toolchain', rationale: 'Native builds are sensitive to compiler version in a way transpiled ones are not; an unpinned toolchain makes failures unreproducible.', required: true }],
        documentation: [{ path: 'docs/building.md', why: 'The toolchain and system dependencies needed to build — the part that cannot be inferred.' }],
        refactor: [],
      };
    case 'is-published-package':
      return {
        ci: [{ id: 'publish-dry-run', label: 'Dry-run the publish', rationale: 'Catches a missing file or a bad manifest before the version number is spent — a published version cannot be replaced.', required: true }],
        documentation: [],
        refactor: [{ id: 'missing-files-entry', label: 'Published package contents not constrained', detail: 'Ships source, tests and secrets that were never meant to leave the repository.' }],
      };
    case 'platform-hosted':
      return {
        ci: [{ id: 'platform-validate', label: 'Validate the platform manifest', rationale: 'The host rejects a malformed manifest at submission, which is the slowest possible moment to find out.', required: true }],
        documentation: [{ path: 'docs/platform.md', why: 'Submission requirements and review expectations, which change without notice.' }],
        refactor: [],
      };
    case 'handles-personal-data':
      return {
        ci: [{ id: 'secret-scan', label: 'Scan for committed secrets and personal data', rationale: 'Anything committed is effectively permanent, and personal data in history is a disclosure rather than a bug.', required: true }],
        documentation: [{ path: 'docs/privacy.md', why: 'What is collected, why, and how long it is kept — needed before somebody asks, not after.' }],
        refactor: [{ id: 'unredacted-logging', label: 'Personal data reaching logs', detail: 'Logs are copied, shipped and retained far more widely than the database they came from.' }],
      };
    case 'has-ui':
    case 'has-server':
      // Signals for intelligence and testing rather than sources of extra
      // required steps; adding a gate here would duplicate the archetype's own.
      return { ci: [], documentation: [], refactor: [] };
  }
}

/**
 * The pack for an identity, with trait additions merged in.
 *
 * De-duplicated by id, archetype entries first, so a trait cannot silently
 * replace an archetype's own expectation with a weaker one.
 */
export function resolveArchetypePack(
  archetype: ProjectArchetype,
  traits: readonly ArchetypeTrait[],
): ArchetypePack {
  const base = archetypePack(archetype);
  const ci = [...base.ci];
  const documentation = [...base.documentation];
  const refactor = [...base.refactor];

  for (const trait of traits) {
    const additions = traitAdditions(trait);
    for (const step of additions.ci) {
      if (!ci.some(existing => existing.id === step.id)) {
        ci.push(step);
      }
    }
    for (const doc of additions.documentation) {
      if (!documentation.some(existing => existing.path === doc.path)) {
        documentation.push(doc);
      }
    }
    for (const item of additions.refactor) {
      if (!refactor.some(existing => existing.id === item.id)) {
        refactor.push(item);
      }
    }
  }

  return { ...base, ci, documentation, refactor };
}
