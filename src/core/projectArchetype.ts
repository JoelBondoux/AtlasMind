/**
 * What kind of software this project is — asked and answered once.
 *
 * Before this module there were **three** answers in the codebase and they
 * disagreed: a twelve-option bootstrap picker whose value was consumed by a
 * single regex, `testingScaffolder`'s seven-value `Archetype`, and
 * `deliveryManager`'s four-value `DeliveryArchetype`. Games were the clearest
 * casualty — detected from `phaser`/`bevy`/`pygame`, never acted on, not
 * selectable at bootstrap, and shipped as `generic`.
 *
 * That is the same failure the guided workflow specification was written to fix
 * (one fact, several disagreeing homes) appearing in a different dimension, so
 * it gets the same treatment: one vocabulary, and everything else points at it.
 *
 * Two design decisions carry the weight:
 *
 * 1. **Archetype plus traits, not archetype alone.** A Shopify theme is a
 *    `website` that happens to be platform-hosted; a VS Code extension is a
 *    `library` that ships a packaged artifact. Modelling those as their own
 *    archetypes multiplies the set every time a new platform appears, and each
 *    archetype is a promise that something specialises for it. Traits compose
 *    instead.
 *
 * 2. **Detection suggests; declaration decides.** Inference from manifests is a
 *    *suggestion*, always — the declared value in the workflow configuration is
 *    the truth. This mirrors "profiles seed, they do not govern", and it is what
 *    makes the archetype editable rather than something AtlasMind insists on.
 *
 * The honesty rule from the testing protocols applies here too: **a wrong
 * archetype is worse than `generic`**, because it asks for evidence the project
 * will never produce and creates a permanent, unfixable gap — which teaches
 * people to ignore gaps. `generic` is a legitimate answer, not a failure.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

/** The archetypes. Small on purpose — see the module note on traits. */
export const PROJECT_ARCHETYPES = [
  'game',
  'website',
  'web-app',
  'api',
  'cli',
  'library',
  'desktop',
  'mobile',
  'generic',
] as const;

export type ProjectArchetype = typeof PROJECT_ARCHETYPES[number];

/**
 * Composable facts about a project that cut across archetypes.
 *
 * These exist so the archetype set does not have to grow a new member every
 * time a project ships differently. A `library` that is published to a registry
 * and a `library` that is vendored into one consumer need different release
 * advice; that is a trait, not a second archetype.
 */
export const ARCHETYPE_TRAITS = [
  /** Produces a runnable binary or installer for end users. */
  'ships-binaries',
  /** Has a compiled or native build step beyond transpilation. */
  'has-native-build',
  /** Published to a package registry. */
  'is-published-package',
  /** Has a user interface a human looks at. */
  'has-ui',
  /** Runs a long-lived server process. */
  'has-server',
  /** Deployed onto somebody else's platform (Shopify, Marketplace, app store). */
  'platform-hosted',
  /** Holds or processes personal data. */
  'handles-personal-data',
] as const;

export type ArchetypeTrait = typeof ARCHETYPE_TRAITS[number];

export interface ArchetypeIdentity {
  archetype: ProjectArchetype;
  traits: ArchetypeTrait[];
}

/** Human labels, for a picker and for prose. */
export const ARCHETYPE_LABEL: Readonly<Record<ProjectArchetype, string>> = {
  game: 'Game',
  website: 'Website or marketing site',
  'web-app': 'Web application',
  api: 'API or service',
  cli: 'Command-line tool',
  library: 'Library or package',
  desktop: 'Desktop application',
  mobile: 'Mobile application',
  generic: 'Something else',
};

export const TRAIT_LABEL: Readonly<Record<ArchetypeTrait, string>> = {
  'ships-binaries': 'Ships binaries or installers',
  'has-native-build': 'Has a native or compiled build',
  'is-published-package': 'Published to a package registry',
  'has-ui': 'Has a user interface',
  'has-server': 'Runs a server process',
  'platform-hosted': 'Deployed on a third-party platform',
  'handles-personal-data': 'Handles personal data',
};

// ── Detection ────────────────────────────────────────────────────────────────

export interface ArchetypeEvidence {
  /** Lowercased manifest text — dependency names, config keys. */
  corpus: string;
  /** Files present in the workspace root, lowercased. */
  files: readonly string[];
  /** Language, where the caller already determined it. */
  language?: string;
}

export interface ArchetypeDetection {
  archetype: ProjectArchetype;
  traits: ArchetypeTrait[];
  /** The signals that decided it. Shown to the user — a suggestion must justify itself. */
  reasons: string[];
  /** False when nothing matched and `generic` is a fallback rather than a finding. */
  confident: boolean;
}

/**
 * Signals per archetype, checked in order, first match wins.
 *
 * Ordered most-specific first: a React Native project contains React, and
 * reporting it as `web-app` would send every piece of downstream advice to the
 * wrong place. Node-only tokens are gated because short package names
 * (`next`, `three`) match substrings in other languages' manifests — `next`
 * appears inside `cargo-nextest`.
 */
interface ArchetypeRule {
  archetype: ProjectArchetype;
  /** Tokens matched anywhere in the corpus. */
  any?: readonly string[];
  /** Tokens matched only when the language is Node. */
  nodeOnly?: readonly string[];
  /** Files whose presence is decisive. */
  files?: readonly string[];
  reason: string;
}

const RULES: readonly ArchetypeRule[] = [
  {
    archetype: 'mobile',
    any: ['react-native', 'expo', 'kivy', 'beeware', 'capacitor'],
    files: ['pubspec.yaml'],
    reason: 'a mobile framework',
  },
  {
    archetype: 'game',
    nodeOnly: ['phaser', 'three', '@babylonjs/core', 'pixi.js', 'excalibur'],
    any: ['bevy', 'ggez', 'macroquad', 'pygame', 'ebiten', 'raylib', 'godot', 'monogame'],
    files: ['project.godot'],
    reason: 'a game engine or rendering library',
  },
  {
    archetype: 'desktop',
    any: ['electron', 'tauri', 'wails', 'avalonia'],
    nodeOnly: ['nw.js'],
    reason: 'a desktop shell framework',
  },
  {
    archetype: 'website',
    // Static-site generators produce a *site*, which releases and tests very
    // differently from an application that happens to run in a browser.
    nodeOnly: ['astro', '@11ty/eleventy', 'gatsby', 'hugo', 'jekyll'],
    files: ['_config.yml', 'config.toml'],
    reason: 'a static site generator',
  },
  {
    archetype: 'web-app',
    nodeOnly: ['next', 'nuxt', 'remix', '@sveltejs/kit', 'react', 'vue', '@angular/core', 'svelte'],
    reason: 'a browser UI framework',
  },
  {
    archetype: 'api',
    any: ['fastapi', 'flask', 'django', 'gin-gonic', 'actix-web', 'axum', 'spring-boot'],
    nodeOnly: ['express', 'fastify', 'koa', '@nestjs/core', 'hapi'],
    reason: 'a server framework',
  },
  {
    archetype: 'cli',
    any: ['clap', 'cobra', 'argparse', 'typer'],
    nodeOnly: ['commander', 'yargs', 'oclif'],
    reason: 'a command-line argument parser',
  },
];

/** Trait signals, all checked — traits compose rather than exclude. */
const TRAIT_RULES: readonly { trait: ArchetypeTrait; any?: readonly string[]; files?: readonly string[]; reason: string }[] = [
  { trait: 'has-native-build', any: ['cargo.toml', 'cmake', 'go.mod', 'makefile'], files: ['cargo.toml', 'cmakelists.txt', 'makefile', 'go.mod'], reason: 'a native build manifest' },
  { trait: 'has-server', any: ['express', 'fastify', 'fastapi', 'flask', 'django', 'axum', 'gin-gonic'], reason: 'a server framework' },
  { trait: 'has-ui', any: ['react', 'vue', 'svelte', '@angular/core', 'electron', 'tauri'], reason: 'a UI framework' },
  { trait: 'platform-hosted', any: ['@shopify/', 'shopify.app.toml', 'vsce', '@vscode/vsce'], files: ['shopify.app.toml'], reason: 'a third-party platform manifest' },
  { trait: 'ships-binaries', any: ['pkg', 'nexe', 'pyinstaller', 'electron-builder', 'tauri'], reason: 'a binary packaging tool' },
];

function tokenHit(corpus: string, tokens: readonly string[] | undefined): string | undefined {
  return tokens?.find(token => corpus.includes(token));
}

/**
 * Infer an archetype from workspace evidence.
 *
 * Returns `confident: false` when nothing matched, so a caller can distinguish
 * "this is a generic project" from "we could not tell" — and never presents the
 * second as the first. That distinction is the whole reason detection is
 * separate from declaration.
 */
export function detectProjectArchetype(evidence: ArchetypeEvidence): ArchetypeDetection {
  const corpus = (evidence.corpus ?? '').toLowerCase();
  const files = (evidence.files ?? []).map(file => file.toLowerCase());
  const isNode = evidence.language === 'node';
  const reasons: string[] = [];

  const traits: ArchetypeTrait[] = [];
  for (const rule of TRAIT_RULES) {
    const hit = tokenHit(corpus, rule.any) ?? rule.files?.find(file => files.includes(file));
    if (hit && !traits.includes(rule.trait)) {
      traits.push(rule.trait);
    }
  }

  for (const rule of RULES) {
    const hit = tokenHit(corpus, rule.any)
      ?? (isNode ? tokenHit(corpus, rule.nodeOnly) : undefined)
      ?? rule.files?.find(file => files.includes(file));
    if (hit) {
      reasons.push(`Found ${rule.reason} (\`${hit}\`).`);
      return { archetype: rule.archetype, traits, reasons, confident: true };
    }
  }

  // A package with no application signal is a library — but only when something
  // actually says so. Guessing `library` for an empty workspace would be a
  // finding invented from an absence.
  if (corpus.includes('"main"') || corpus.includes('"exports"') || files.includes('cargo.toml')) {
    return {
      archetype: 'library',
      traits,
      reasons: ['No application entry point found, but a package manifest is present.'],
      confident: false,
    };
  }

  return {
    archetype: 'generic',
    traits,
    reasons: ['Nothing in the manifests identified a project shape.'],
    confident: false,
  };
}

// ── Reconciling the vocabularies this module replaces ────────────────────────

/**
 * The old delivery vocabulary, mapped forward.
 *
 * `delivery.json` persists an archetype, so existing documents carry these
 * values and must keep working. Note that `web-service` maps to `api` rather
 * than `web-app`: it named a *service*, and reading it as a browser application
 * would send release and testing advice to the wrong place.
 */
export function fromDeliveryArchetype(value: string | undefined): ArchetypeIdentity | undefined {
  switch (value) {
    case 'vscode-extension':
      // A VS Code extension is a library that ships to a marketplace — the
      // clearest case for archetype-plus-trait rather than a bespoke archetype.
      return { archetype: 'library', traits: ['platform-hosted', 'is-published-package'] };
    case 'library':
      return { archetype: 'library', traits: ['is-published-package'] };
    case 'web-service':
      return { archetype: 'api', traits: ['has-server'] };
    case 'generic':
      return { archetype: 'generic', traits: [] };
    default:
      return undefined;
  }
}

/** The old testing-scaffolder vocabulary, mapped forward. */
export function fromTestingArchetype(value: string | undefined): ProjectArchetype | undefined {
  switch (value) {
    case 'web': return 'web-app';
    case 'api': return 'api';
    case 'cli': return 'cli';
    case 'game': return 'game';
    case 'mobile': return 'mobile';
    case 'library': return 'library';
    case 'generic': return 'generic';
    default: return undefined;
  }
}

/**
 * A bootstrap picker label, mapped to an identity.
 *
 * The picker's labels are prose and have changed before, so matching is on
 * distinctive substrings rather than equality. An unrecognised label yields
 * `undefined` rather than `generic`, so the caller can ask instead of assuming.
 */
export function fromBootstrapLabel(label: string | undefined): ArchetypeIdentity | undefined {
  const text = (label ?? '').toLowerCase();
  if (!text) {
    return undefined;
  }
  const identity = (archetype: ProjectArchetype, ...traits: ArchetypeTrait[]): ArchetypeIdentity =>
    ({ archetype, traits });

  if (/shopify (new store|store|theme)/.test(text)) {
    return identity('website', 'platform-hosted');
  }
  if (/shopify app/.test(text)) {
    return identity('web-app', 'platform-hosted', 'has-server');
  }
  if (/vs ?code extension/.test(text)) {
    return identity('library', 'platform-hosted', 'is-published-package');
  }
  if (/website|marketing site/.test(text)) {
    return identity('website');
  }
  if (/web app/.test(text)) {
    return identity('web-app', 'has-ui');
  }
  if (/api server|api\b/.test(text)) {
    return identity('api', 'has-server');
  }
  if (/cli tool|command.?line/.test(text)) {
    return identity('cli');
  }
  if (/library|package/.test(text)) {
    return identity('library', 'is-published-package');
  }
  if (/desktop app/.test(text)) {
    return identity('desktop', 'has-ui', 'ships-binaries');
  }
  if (/mobile app/.test(text)) {
    return identity('mobile', 'has-ui');
  }
  if (/\bgame\b/.test(text)) {
    return identity('game', 'has-ui');
  }
  if (/^other$/.test(text.trim())) {
    return identity('generic');
  }
  return undefined;
}

/**
 * Whether this shape promotes into a hosted environment.
 *
 * The one decision the old `DeliveryArchetype` existed to make: a library and a
 * VS Code extension have no staging server to promote into, so seeding them a
 * three-stage pipeline invents an environment that does not exist. Expressed
 * over the new vocabulary so the old one can retire.
 *
 * A `has-server` trait wins over the archetype, because a game or a desktop app
 * with a backend genuinely does have somewhere to deploy.
 */
export function deploysToHostedEnvironment(
  archetype: ProjectArchetype,
  traits: readonly ArchetypeTrait[] = [],
): boolean {
  if (traits.includes('has-server')) {
    return true;
  }
  switch (archetype) {
    case 'website':
    case 'web-app':
    case 'api':
      return true;
    case 'game':
    case 'cli':
    case 'library':
    case 'desktop':
    case 'mobile':
      return false;
    case 'generic':
      // Unknown shape: assume it deploys. A pipeline with a stage nobody uses is
      // a nuisance; a missing stage is a promotion path that cannot be modelled.
      return true;
  }
}

/**
 * The bootstrap picker's prose labels, mapped onto the vocabulary.
 *
 * The picker shows things like "Website / Marketing Site" because that is what
 * somebody choosing recognises; `normalizeArchetype` takes ids and would send
 * every one of those to `generic`. Without this the shape a user *chose at
 * bootstrap* reached nothing that acts on shape — which is the same
 * detected-but-never-acted-on failure the archetype work was written to fix,
 * one step earlier in the pipeline.
 *
 * Matched on distinctive substrings rather than exact labels, so an edit to the
 * picker's wording does not silently send every project to `generic`. Order
 * matters: "Web App" contains "app", and "Website" contains "web".
 */
export function archetypeFromProjectTypeLabel(label: unknown): ProjectArchetype | undefined {
  if (typeof label !== 'string') {
    return undefined;
  }
  // Codicon prefixes (`$(store) `) are stripped by the picker, but a label read
  // back from a persisted intake may still carry one.
  const text = label.replace(/^\$\([^)]+\)\s*/, '').trim().toLowerCase();
  if (!text) {
    return undefined;
  }

  const rules: Array<[RegExp, ProjectArchetype]> = [
    [/\bgame\b/, 'game'],
    [/\bwebsite\b|marketing site|static site/, 'website'],
    [/\bweb app\b|\bwebapp\b|\bspa\b/, 'web-app'],
    [/\bapi\b|\bserver\b|\bbackend\b|\bservice\b/, 'api'],
    [/\bcli\b|command.?line|\bterminal tool\b/, 'cli'],
    [/\blibrary\b|\bpackage\b|\bsdk\b/, 'library'],
    // A VS Code extension is a desktop application by every property that
    // matters here: it ships to a marketplace, runs on the user's machine, and
    // has no URL to load in a browser.
    [/\bdesktop\b|vs ?code extension|\belectron\b/, 'desktop'],
    [/\bmobile\b|\bios\b|\bandroid\b/, 'mobile'],
    // Shopify surfaces: a theme is a website, an app is a web app.
    [/shopify (new )?store|shopify.*theme/, 'website'],
    [/shopify app/, 'web-app'],
  ];

  for (const [pattern, archetype] of rules) {
    if (pattern.test(text)) {
      return archetype;
    }
  }
  return undefined;
}

/** Coerce untrusted input to an archetype, defaulting to the honest answer. */
export function normalizeArchetype(value: unknown): ProjectArchetype {
  return typeof value === 'string' && (PROJECT_ARCHETYPES as readonly string[]).includes(value)
    ? value as ProjectArchetype
    : 'generic';
}

/** Coerce untrusted input to a trait list, dropping anything unrecognised. */
export function normalizeTraits(value: unknown): ArchetypeTrait[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: ArchetypeTrait[] = [];
  for (const entry of value) {
    if (typeof entry === 'string'
      && (ARCHETYPE_TRAITS as readonly string[]).includes(entry)
      && !out.includes(entry as ArchetypeTrait)) {
      out.push(entry as ArchetypeTrait);
    }
  }
  return out;
}

/**
 * Compare what was detected against what was declared.
 *
 * The surface shows both. When they disagree it says so rather than silently
 * preferring one, because a project that was deliberately declared `library`
 * while its manifests look like `web-app` is a decision, not a mistake — and
 * overriding it would be AtlasMind insisting it knows better.
 */
export function describeArchetypeAgreement(
  detected: ArchetypeDetection | undefined,
  declared: ProjectArchetype | undefined,
): { agrees: boolean; detail: string } {
  if (declared === undefined) {
    return detected?.confident
      ? { agrees: false, detail: `Detected ${ARCHETYPE_LABEL[detected.archetype]}, but nothing is declared. Declaring it makes the workflow specialise.` }
      : { agrees: false, detail: 'No archetype declared, and the manifests did not identify one. Declaring it makes the workflow specialise.' };
  }
  if (!detected || !detected.confident) {
    return { agrees: true, detail: `Declared ${ARCHETYPE_LABEL[declared]}. The manifests did not identify a shape to compare it against.` };
  }
  if (detected.archetype === declared) {
    return { agrees: true, detail: `Declared ${ARCHETYPE_LABEL[declared]}, and the manifests agree.` };
  }
  return {
    agrees: false,
    detail: `Declared ${ARCHETYPE_LABEL[declared]}, but the manifests look like ${ARCHETYPE_LABEL[detected.archetype]}. The declared value wins — change it only if the declaration is wrong.`,
  };
}
