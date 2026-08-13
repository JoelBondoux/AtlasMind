/**
 * What this project's *code* says its testing policy should be.
 *
 * Auto-assess used to match `autoDetectSignals` as bare substrings against one
 * flat corpus that included three kilobytes of README. Two things followed, and
 * both got worse when the registry grew from 23 methodologies to 69.
 *
 * **Prose decided.** Measured on this repository, twelve policies fired on
 * README text alone — among them PCI-DSS, bias & fairness, and model-output
 * risk classification, on a VS Code extension that touches no card data and
 * makes no automated decision about any person. A README describes what a
 * project is *for*; the question here is what it is *built from*, and those are
 * different questions that had been sharing one answer.
 *
 * **Substrings matched anything.** `api` matched `rapid`, so a sentence of
 * ordinary marketing copy switched on integration testing. With 69 policies the
 * signal vocabulary now includes words like `audit`, `risk`, `agent`, `bias`
 * and `retention`, which appear in the prose of projects that have nothing to
 * do with them.
 *
 * So this module draws one distinction and hangs everything on it:
 *
 * - A signal **observed in the code** — a dependency, a script, a config file,
 *   a directory that exists — is a fact about the project, and it recommends.
 * - A signal **stated in prose** is somebody's description, and it *offers*:
 *   the policy is raised for consideration and arrives unticked, saying which
 *   words prompted it.
 *
 * That is the same rule `researchRegister` applies to an uncited claim, and for
 * the same reason: something that reads exactly like evidence, but is not, must
 * not be stored as though it were. Nothing is hidden — a prose match is still
 * shown, still one keystroke away — because the goal is to stop auto-assess
 * making decisions on the user's behalf, not to stop it making suggestions.
 *
 * Pure: the caller gathers the evidence, this decides. That keeps the whole
 * judgement unit-testable, which for a heuristic is the only way to know it did
 * not quietly get worse.
 */

import {
  TESTING_METHODOLOGY_DEFINITIONS,
  type TestingMethodologyId,
} from '../types.js';
import { resolveArchetypePack } from './archetypePacks.js';
import type { ProjectArchetype, ArchetypeTrait } from './projectArchetype.js';

/** Where a signal was found, which is the whole point of this module. */
export type SignalOrigin = 'code' | 'prose';

/**
 * Everything the assessment is allowed to look at.
 *
 * Split by origin at the *input* boundary rather than sorted out later: a
 * single merged corpus is what made the old heuristic unable to tell a
 * dependency from a sentence, and merging first and separating afterwards
 * cannot recover the difference.
 */
export interface ProjectTestingEvidence {
  /** Dependency names from every manifest that could be read. */
  dependencies: readonly string[];
  /** Script names and their command bodies. */
  scripts: readonly string[];
  /** Workspace-relative paths that exist — files and directories. */
  paths: readonly string[];
  /** Prose: README, project summary, intake answers. Suggests, never decides. */
  prose?: string;
  /**
   * Manifests or scans that could not be read.
   *
   * Carried so the result can say "not assessed" rather than "nothing found".
   * A Python project whose `pyproject.toml` failed to parse has no dependency
   * signals at all, and reporting that as "no testing policy applies" is the
   * one wrong answer that looks like a right one.
   */
  unreadable?: readonly string[];
  /** Policies the repository can already show evidence for, from the coverage derivation. */
  alreadyEvidenced?: readonly TestingMethodologyId[];
  /** Detected shape, used to suppress policies this shape can never evidence. */
  archetype?: ProjectArchetype;
  traits?: readonly ArchetypeTrait[];
}

export interface AssessedPolicy {
  id: TestingMethodologyId;
  label: string;
  /**
   * Whether this arrives ticked.
   *
   * Only `evidenced`, `observed` and `universal` do. A `stated` policy is a
   * proposal — enabling it would declare an intention the project has not
   * acted on, and thirteen such declarations in one click is how a matrix ends
   * up with eight permanent gaps nobody reads as gaps.
   */
  recommended: boolean;
  basis: 'evidenced' | 'observed' | 'universal' | 'ambiguous' | 'stated' | 'discouraged';
  /** One line, shown next to the tick box. */
  reason: string;
  /** The signals that matched, for the reason line and for tests. */
  matched: readonly string[];
}

export interface TestingAssessment {
  policies: readonly AssessedPolicy[];
  /** How many arrive ticked. */
  recommendedCount: number;
  /**
   * What could not be looked at.
   *
   * Never folded into the reasons: "we did not read your manifest" and "your
   * manifest says nothing relevant" are different facts, and the second is a
   * conclusion the first does not support.
   */
  unassessed: readonly string[];
  /** A sentence for the picker, so the surface cannot restate this more optimistically. */
  summary: string;
}

/**
 * Signal matching with real boundaries.
 *
 * `\b` is not used directly because the signal vocabulary is full of hyphens
 * and slashes (`fast-check`, `ci/cd`, `do-178`, `mc/dc`, `800-53`) where its
 * behaviour is surprising. Treating only letters and digits as word characters
 * gives the two properties actually wanted: `api` matches in `rest api` and in
 * `api-first`, and does not match inside `rapid` or `openapi`.
 */
function signalPattern(signal: string): RegExp {
  const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
}

const PATTERN_CACHE = new Map<string, RegExp>();

function matches(corpus: string, signal: string): boolean {
  let pattern = PATTERN_CACHE.get(signal);
  if (!pattern) {
    pattern = signalPattern(signal);
    PATTERN_CACHE.set(signal, pattern);
  }
  return pattern.test(corpus);
}

/**
 * Codebase facts that imply a signal vocabulary the raw name does not carry.
 *
 * A dependency on `@anthropic-ai/sdk` tells you this project sends prompts to a
 * model; nothing in that string matches the word `prompt`. Rather than widening
 * every policy's `autoDetectSignals` with vendor package names — which would
 * make the catalogue a dependency list that goes stale with every release — the
 * observed facts are translated into the vocabulary the catalogue already
 * speaks.
 *
 * Each entry earns its place by being something a project cannot have by
 * accident. `stripe` really does put a project in scope for cardholder-data
 * questions; `react` really does mean there is something to look at.
 */
interface DerivedSignal {
  /** Matched against dependency names and paths, with the same boundary rule. */
  when: readonly string[];
  /** Vocabulary added to the code corpus when any `when` entry is present. */
  emit: string;
  /**
   * Policies this fact is *direct* evidence of, which tick even though the
   * emitted words are ambiguous elsewhere.
   *
   * Ambiguity is really a property of a (word, policy) pair: a
   * `.github/workflows` directory is unambiguous evidence of continuous testing
   * and no evidence at all of SLSA provenance, yet both policies list `github
   * actions` among their signals. Declaring 69 policies' worth of pairs would be
   * unmaintainable, so only the handful of facts that *are* their own proof for
   * one specific policy say so here. Everything else rides the general rule.
   */
  decisiveFor?: readonly TestingMethodologyId[];
}

const DERIVED_SIGNALS: readonly DerivedSignal[] = [
  // Model-backed behaviour. None of these package names contains the words the
  // AI-specific policies look for.
  {
    when: ['openai', '@anthropic-ai/sdk', 'anthropic', 'langchain', 'llamaindex', 'ollama',
      '@google/generative-ai', 'cohere-ai', 'mistralai', 'ai', 'vercel-ai', 'litellm', 'openrouter'],
    emit: 'llm prompt agent gpt claude model selection',
  },
  {
    when: ['pinecone', 'chromadb', 'chroma', 'weaviate', 'qdrant', 'pgvector', 'faiss', 'llamaindex'],
    emit: 'rag retrieval embedding vector',
  },
  {
    when: ['crewai', 'langgraph', 'autogen', '@modelcontextprotocol/sdk', 'mcp'],
    emit: 'multi-agent agent handoff delegation orchestrator tool use mcp',
  },

  // Persistence. A migration directory is the fact; the tool is secondary.
  {
    when: ['prisma', 'knex', 'typeorm', 'sequelize', 'alembic', 'flyway', 'liquibase',
      'db-migrate', 'migrations', 'alembic.ini', 'db/migrate'],
    emit: 'migration database',
  },
  {
    when: ['pg', 'postgres', 'postgresql', 'mysql', 'mysql2', 'sqlite3', 'better-sqlite3',
      'mongodb', 'mongoose', 'redis', 'ioredis'],
    emit: 'database postgres mysql mongodb redis persisted',
  },
  {
    when: ['dbt-core', 'great-expectations', 'soda-core', 'pandera', 'airflow', 'dagster',
      'prefect', 'snowflake', 'bigquery', 'pandas', 'polars'],
    emit: 'etl warehouse pipeline data quality',
  },

  // Authorization and identity — the RBAC policy's real-world footprint.
  {
    when: ['casbin', 'oso', 'cerbos', '@cerbos/http', '@openfga/sdk', 'keycloak', 'auth0',
      'next-auth', '@auth/core', 'passport', 'lucia', 'clerk', '@clerk/nextjs'],
    emit: 'rbac authorization permissions roles auth authentication multi-tenant',
  },

  // Payments put a project in scope for cardholder-data questions whatever its
  // README says about itself.
  {
    when: ['stripe', 'braintree', 'adyen', '@paypal/checkout-server-sdk', 'square', 'razorpay'],
    emit: 'payment cardholder pan merchant ecommerce',
  },

  // Health data.
  { when: ['fhir', '@types/fhir', 'hl7', 'smart-on-fhir'], emit: 'phi protected health ehr patient medical healthcare' },

  // Observability.
  {
    when: ['@opentelemetry/api', '@opentelemetry/sdk-node', '@opentelemetry/sdk-trace-base',
      'opentelemetry', 'prom-client', 'pino', 'winston', 'structlog', '@sentry/node',
      'dd-trace', 'datadog'],
    emit: 'opentelemetry observability tracing prometheus sentry',
  },

  // Distributed shape — the precondition for chaos and resilience testing being
  // able to produce evidence at all.
  {
    when: ['kubernetes', 'k8s', 'helm', 'charts', 'istio', 'dockerfile', 'docker-compose.yml',
      'docker-compose.yaml', 'terraform', 'main.tf', '@grpc/grpc-js', 'kafkajs', 'amqplib', 'bullmq'],
    emit: 'kubernetes distributed microservice grpc kafka rabbitmq resilience circuit breaker',
  },

  // Schema and wire contracts.
  {
    when: ['protobufjs', '@bufbuild/protobuf', 'buf.yaml', 'avsc', 'avro-js', '@confluentinc/schemaregistry'],
    emit: 'protobuf avro buf schema registry grpc event',
  },
  { when: ['zod', 'valibot', 'io-ts', 'arktype', 'typia', 'runtypes', 'pydantic'], emit: 'zod json schema api' },
  { when: ['ajv', 'openapi.yaml', 'openapi.json', 'openapi.yml', 'swagger.json', 'asyncapi.yaml'],
    emit: 'openapi swagger asyncapi api-first json schema api contract' },

  // Rendered surface — accessibility and visual regression need one to exist.
  { when: ['react', 'react-dom', 'vue', 'svelte', '@angular/core', 'next', 'nuxt', 'remix', 'astro'],
    emit: 'react frontend web app component library' },
  { when: ['axe-core', '@axe-core/playwright', '@axe-core/react', 'jest-axe', 'pa11y', 'cypress-axe', 'eslint-plugin-jsx-a11y'],
    emit: 'a11y accessibility wcag axe', decisiveFor: ['accessibility'] },

  // Supply chain and licence posture.
  { when: ['@cyclonedx/cyclonedx-npm', 'cyclonedx-bom', 'syft', 'cdxgen', 'sbom.cdx.json', 'sbom.json'],
    emit: 'sbom cyclonedx spdx supply chain' },
  { when: ['license-checker', 'license-checker-rseidelsohn', 'licensee', 'pip-licenses', 'deny.toml', 'fossa-cli'],
    emit: 'licence license distribution oss' },
  { when: ['sigstore', '@sigstore/sign', 'cosign', 'slsa-verifier', 'in-toto'],
    emit: 'slsa sigstore cosign provenance attestation signing supply chain' },

  // Process facts readable from the repository itself.
  { when: ['.github/codeowners', 'codeowners'], emit: 'codeowners branch protection approval change management', decisiveFor: ['change-management'] },
  { when: ['.github/workflows'], emit: 'github actions continuous integration pipeline ci/cd', decisiveFor: ['continuous'] },
  { when: ['.gitlab-ci.yml'], emit: 'gitlab ci continuous integration pipeline ci/cd', decisiveFor: ['continuous'] },
  { when: ['jenkinsfile'], emit: 'jenkins continuous integration pipeline ci/cd', decisiveFor: ['continuous'] },
  { when: ['.circleci'], emit: 'circleci continuous integration pipeline ci/cd', decisiveFor: ['continuous'] },
  { when: ['azure-pipelines.yml'], emit: 'azure devops continuous integration pipeline ci/cd', decisiveFor: ['continuous'] },
  { when: ['husky', 'pre-commit', 'lint-staged'], emit: 'husky pre-commit shift-left' },
];

/**
 * Signal words that mean different things in different projects.
 *
 * Found by running the assessment over this repository and reading what it
 * ticked. `npm audit` in a script switched on SOC 2, change-management and
 * audit-trail testing; a `.github/workflows` directory emitted `pipeline`,
 * which switched on data-quality testing for a project with no data pipeline;
 * and `github actions` switched on SLSA provenance verification, which it is
 * no evidence of whatsoever.
 *
 * None of those words is wrong in the catalogue — `audit` really does belong to
 * the audit-trail vocabulary, and `pipeline` really does belong to both CI and
 * data engineering. The word is simply not, on its own, evidence of which
 * meaning applies here.
 *
 * So the rule is about *how many*: an ambiguous word alone raises a policy for
 * consideration; an unambiguous one, or two ambiguous ones together, ticks it.
 * One generic word is a hint and two is a pattern — `stryker` alone is proof,
 * while `api` + `database` + `postgres` together are a shape.
 */
const AMBIGUOUS_SIGNALS: ReadonlySet<string> = new Set([
  // Architecture words that describe half of all software.
  'api', 'service', 'backend', 'frontend', 'web app', 'database', 'protocol',
  'postgres', 'mysql', 'mongodb', 'redis', 'microservice', 'distributed',
  // Distribution shape.
  'sdk', 'package', 'library', 'utility', 'enterprise', 'saas', 'container', 'docker',
  // CI presence — real evidence of continuous testing, and no evidence at all
  // of the supply-chain and change-management policies that share the words.
  'pipeline', 'ci/cd', 'continuous integration', 'github actions', 'gitlab ci',
  'jenkins', 'circleci', 'azure devops', 'buildkite',
  // `npm audit` is dependency scanning; an audit trail is a different thing.
  'audit',
  // Words the AI-specific and governance policies share with ordinary software.
  'agent', 'model', 'memory', 'risk', 'coverage', 'embedded', 'ai', 'prompt',
  // A UI framework proves there is something to look at, not that anyone is
  // comparing screenshots or running an accessibility scan.
  'react', 'vue', 'angular', 'svelte', 'next',
]);

/**
 * Whether these matches are strong enough to arrive ticked.
 *
 * The two-word rule counts **literal** matches only. A derived rule expands one
 * dependency into a whole vocabulary — `redis` emits `database postgres mysql
 * mongodb` — so counting the expansion would let a single ambiguous dependency
 * manufacture its own corroboration and tick a policy on one fact while
 * appearing to rest on five. Derived matches can still be decisive, but only by
 * being *unambiguous*: `kafka` means one thing, `database` does not.
 */
function isDecisive(literal: readonly string[], derived: readonly string[]): boolean {
  const unambiguous = [...literal, ...derived]
    .filter(signal => !AMBIGUOUS_SIGNALS.has(signal.toLowerCase()));
  return unambiguous.length > 0 || literal.length >= 2;
}

/**
 * The two halves are kept apart so `isDecisive` can tell a fact from its
 * expansion. Merging them would be the same mistake, one level down, that
 * merging code and prose was one level up.
 */
function buildCodeCorpus(
  evidence: ProjectTestingEvidence,
): { literal: string; derived: string; decisiveFor: ReadonlySet<TestingMethodologyId> } {
  const literal = [
    ...evidence.dependencies,
    ...evidence.scripts,
    ...evidence.paths,
  ].join(' ').toLowerCase();

  const fired = DERIVED_SIGNALS.filter(rule => rule.when.some(token => matches(literal, token)));
  const decisiveFor = new Set<TestingMethodologyId>();
  for (const rule of fired) {
    for (const id of rule.decisiveFor ?? []) { decisiveFor.add(id); }
  }

  return { literal, derived: fired.map(rule => rule.emit).join(' '), decisiveFor };
}

/** A short, readable list of what actually matched. */
function describeMatches(matched: readonly string[]): string {
  return matched.slice(0, 3).join(', ');
}

/**
 * Decides the testing policy from the evidence.
 *
 * Order is the policy, and each rung is deliberately above the next:
 *
 * 1. **Already evidenced** — the repository is doing it. This outranks
 *    everything, including a shape that discourages it, because a real file on
 *    disk beats a heuristic about what this kind of project usually needs.
 * 2. **Discouraged by shape** — the archetype packs already know which policies
 *    a shape can never produce evidence for. Suppressing here is what stops
 *    auto-assess creating the permanent unclosable gap the packs exist to
 *    prevent, and it is checked *before* signals so a stray keyword cannot
 *    reintroduce one.
 * 3. **Observed in code** — a dependency, script, config or directory. Ticked.
 * 4. **Universal** — the `*` signals (TDD, unit). Ticked.
 * 5. **Stated in prose** — offered, unticked, with the words that prompted it.
 */
export function assessTestingMethodologies(
  evidence: ProjectTestingEvidence,
): TestingAssessment {
  const codeCorpus = buildCodeCorpus(evidence);
  const proseCorpus = (evidence.prose ?? '').toLowerCase();
  const evidenced = new Set(evidence.alreadyEvidenced ?? []);

  const discouraged = new Map<TestingMethodologyId, string>();
  if (evidence.archetype) {
    const pack = resolveArchetypePack(evidence.archetype, evidence.traits ?? []);
    for (const id of pack.testing.discouraged) {
      discouraged.set(
        id,
        pack.testing.discouragedReason
          ?? 'This project shape cannot produce the evidence it asks for.',
      );
    }
  }

  const policies: AssessedPolicy[] = [];

  for (const def of TESTING_METHODOLOGY_DEFINITIONS) {
    if (evidenced.has(def.id)) {
      policies.push({
        id: def.id,
        label: def.label,
        recommended: true,
        basis: 'evidenced',
        reason: 'Already practised here — evidence is in the repository',
        matched: [],
      });
      continue;
    }

    const suppression = discouraged.get(def.id);
    if (suppression) {
      policies.push({
        id: def.id,
        label: def.label,
        recommended: false,
        basis: 'discouraged',
        reason: `Not suited to this project's shape. ${suppression}`,
        matched: [],
      });
      continue;
    }

    const specific = def.autoDetectSignals.filter(s => s !== '*');
    const literalHits = specific.filter(signal => matches(codeCorpus.literal, signal));
    const derivedHits = specific.filter(signal =>
      !literalHits.includes(signal) && matches(codeCorpus.derived, signal));
    const inCode = [...literalHits, ...derivedHits];
    if (inCode.length > 0) {
      const decisive = codeCorpus.decisiveFor.has(def.id) || isDecisive(literalHits, derivedHits);
      policies.push({
        id: def.id,
        label: def.label,
        recommended: decisive,
        basis: decisive ? 'observed' : 'ambiguous',
        reason: decisive
          ? `Found in the code: ${describeMatches(inCode)}`
          : `Possible — the code mentions "${describeMatches(inCode)}", but that word means different things in different projects, so tick it only if it applies here`,
        matched: inCode,
      });
      continue;
    }

    if (def.autoDetectSignals.includes('*')) {
      policies.push({
        id: def.id,
        label: def.label,
        recommended: true,
        basis: 'universal',
        reason: 'Applies to every project',
        matched: [],
      });
      continue;
    }

    const inProse = specific.filter(signal => matches(proseCorpus, signal));
    if (inProse.length > 0) {
      policies.push({
        id: def.id,
        label: def.label,
        recommended: false,
        basis: 'stated',
        reason: `Mentioned in your project description (${describeMatches(inProse)}), but nothing in the code shows it — tick to declare it as an intention`,
        matched: inProse,
      });
    }
  }

  // Ticked first, then proposals, then the shape-suppressed ones — so the list
  // opens on what is about to be switched on rather than on what is not.
  const rank: Record<AssessedPolicy['basis'], number> = {
    evidenced: 0, observed: 1, universal: 2, ambiguous: 3, stated: 4, discouraged: 5,
  };
  policies.sort((a, b) => rank[a.basis] - rank[b.basis]);

  const recommendedCount = policies.filter(p => p.recommended).length;
  const unassessed = [...(evidence.unreadable ?? [])];

  const summary = unassessed.length > 0
    ? `${recommendedCount} recommended from the code. Could not read ${unassessed.join(', ')}, so this is a partial reading.`
    : `${recommendedCount} recommended from the code.`;

  return { policies, recommendedCount, unassessed, summary };
}
