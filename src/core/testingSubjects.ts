/**
 * The individual things a testing policy has to cover, and whether each one is.
 *
 * Coverage was a **methodology-level** question: does anything in this tree test
 * contracts? So a project with one contract test written in March reported
 * `covered` for contract testing in December, having added forty endpoints in
 * between. The obligation check had the same shape — `evidenceSatisfies`
 * accepted *any* changed test file for every policy except BDD, property and
 * TDD, and said so in its own comment: "a finer reading would need to understand
 * what the test asserts, which is not something a path can tell us."
 *
 * A path cannot. A **subject** can. When the repository gains a declared unit of
 * work — an OpenAPI path, a migration, a role, a prompt — that is a new thing
 * the policy must cover, and it should show as uncovered from the moment it
 * lands rather than being absorbed into an old green tick.
 *
 * Three rules keep that honest.
 *
 * **A subject comes from a declared artifact, never from inferred code shape.**
 * Every extractor here reads something somebody wrote on purpose: a spec file, a
 * migration, a policy document, a routed page. Inferring subjects from source
 * shape — every exported function is a unit-test subject — would manufacture
 * hundreds of obligations nobody agreed to, and a methodology that cannot be
 * evidenced becomes a permanent gap, which is the failure the archetype packs
 * already exist to prevent.
 *
 * **Matching is by reference, and biased toward false negatives.** A test covers
 * a subject when its source mentions the subject's key — the path string, the
 * migration name, the role. A test that never names the endpoint it supposedly
 * tests is not evidence that it does. The bias is deliberate: an uncovered
 * subject that is actually covered costs a glance, while a covered subject that
 * is not costs the thing the policy exists to prevent.
 *
 * **Not-extractable is stated, never implied.** Sixty-two of the sixty-nine
 * methodologies have no discoverable subject — exploratory testing has nothing
 * to enumerate — and they report that rather than reporting zero, because zero
 * uncovered subjects reads as complete.
 */

import type { TestingMethodologyId } from '../types.js';

/** One thing a policy has to cover. */
export interface TestingSubject {
  /** Stable across renders: policy + key, so a subject keeps its identity. */
  id: string;
  policyId: TestingMethodologyId;
  /** What kind of declared artifact this came from, for the UI grouping. */
  kind: 'api-path' | 'graphql-operation' | 'grpc-service' | 'migration' | 'schema' | 'route' | 'role' | 'prompt';
  /** Human label, e.g. `GET /v1/orders`. */
  label: string;
  /** Workspace-relative file the subject was declared in. */
  source: string;
  /**
   * Any one of these appearing in a test counts as naming the subject.
   *
   * More than one where a subject is legitimately referred to in several ways.
   * Requiring all of them would fail on ordinary test style.
   */
  matchTokens: string[];
  /**
   * Tokens that must *also* all appear.
   *
   * The HTTP method is the case this exists for. Under any-of matching a test
   * naming `/v1/orders` covered the GET and the POST equally, which is wrong: a
   * contract test for one method says nothing about the other, and accepting it
   * would rebuild the exact looseness this module replaces, one level down.
   * Matched leniently enough for real test style — `.post('/v1/orders')` names
   * the method as surely as the literal string `POST` does.
   */
  requiredTokens?: string[];
}

/** A subject paired with what was found for it. */
export interface TestingSubjectCoverage {
  subject: TestingSubject;
  covered: boolean;
  /** Test files that mention it. Empty when uncovered. */
  evidence: string[];
}

export interface TestingSubjectReport {
  /** Every subject found, covered or not. */
  coverage: TestingSubjectCoverage[];
  /** Policies an extractor exists for — the rest are `not-extractable`. */
  extractablePolicies: TestingMethodologyId[];
  /** Per policy: how many subjects, and how many lack evidence. */
  byPolicy: Map<TestingMethodologyId, { total: number; uncovered: number }>;
}

/** The policies a subject can be extracted for. Everything else reports honestly. */
export const SUBJECT_EXTRACTABLE_POLICIES: readonly TestingMethodologyId[] = [
  'contract',
  'schema-migration',
  'type-drift',
  'output-schema-drift',
  'e2e',
  'rbac-compliance',
  'prompt-regression',
];

/** A file the caller read, so extraction stays pure. */
export interface DeclaredArtifact {
  /** Workspace-relative, forward-slashed. */
  path: string;
  text: string;
}

// ── Extraction ────────────────────────────────────────────────────

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];

/**
 * OpenAPI / AsyncAPI paths.
 *
 * Read line-wise rather than with a YAML parser: the file is untrusted input on
 * a render path, a parser is a dependency and an attack surface, and the only
 * question asked is which path keys exist. A malformed spec yields fewer
 * subjects rather than an exception.
 */
function extractApiPaths(artifact: DeclaredArtifact): TestingSubject[] {
  const subjects: TestingSubject[] = [];
  const lines = artifact.text.split(/\r?\n/).slice(0, 5000);
  let inPaths = false;
  let pathsIndent = 0;
  let currentPath: string | undefined;

  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (/^["']?paths["']?\s*:/.test(trimmed)) {
      inPaths = true;
      pathsIndent = indent;
      continue;
    }
    if (!inPaths) { continue; }
    if (trimmed !== '' && indent <= pathsIndent && !/^["']?\//.test(trimmed)) {
      inPaths = false;
      continue;
    }
    const pathMatch = /^["']?(\/[^"':\s]*)["']?\s*:/.exec(trimmed);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = /^["']?([a-z]+)["']?\s*:/.exec(trimmed);
    if (currentPath && methodMatch && HTTP_METHODS.includes(methodMatch[1])) {
      const method = methodMatch[1].toUpperCase();
      subjects.push({
        id: `contract:${method} ${currentPath}`,
        policyId: 'contract',
        kind: 'api-path',
        label: `${method} ${currentPath}`,
        source: artifact.path,
        matchTokens: [currentPath, `${method} ${currentPath}`],
        requiredTokens: [method],
      });
    }
  }
  return subjects;
}

/** GraphQL operations declared in an SDL schema. */
function extractGraphqlOperations(artifact: DeclaredArtifact): TestingSubject[] {
  const subjects: TestingSubject[] = [];
  const blocks = /type\s+(Query|Mutation|Subscription)\s*\{([^}]*)\}/g;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(artifact.text)) !== null && subjects.length < 400) {
    const kind = block[1];
    for (const line of block[2].split(/\r?\n/)) {
      const field = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[(:]/.exec(line);
      if (!field) { continue; }
      subjects.push({
        id: `contract:${kind}.${field[1]}`,
        policyId: 'contract',
        kind: 'graphql-operation',
        label: `${kind}.${field[1]}`,
        source: artifact.path,
        matchTokens: [field[1]],
      });
    }
  }
  return subjects;
}

/** gRPC services and their methods. */
function extractGrpcServices(artifact: DeclaredArtifact): TestingSubject[] {
  const subjects: TestingSubject[] = [];
  const services = /service\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]*)\}/g;
  let service: RegExpExecArray | null;
  while ((service = services.exec(artifact.text)) !== null && subjects.length < 400) {
    const name = service[1];
    for (const rpc of service[2].matchAll(/rpc\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
      subjects.push({
        id: `contract:${name}.${rpc[1]}`,
        policyId: 'contract',
        kind: 'grpc-service',
        label: `${name}.${rpc[1]}`,
        source: artifact.path,
        matchTokens: [rpc[1], `${name}.${rpc[1]}`],
      });
    }
  }
  return subjects;
}

/**
 * A migration is its own subject — one file, one irreversible change.
 *
 * The whole file is the unit: unlike an endpoint there is nothing finer to
 * enumerate, and the thing a test has to name is the migration itself.
 */
function migrationSubject(artifact: DeclaredArtifact): TestingSubject | undefined {
  const base = artifact.path.split('/').pop();
  if (!base) { return undefined; }
  const name = base.replace(/\.[^.]+$/, '');
  return {
    id: `schema-migration:${name}`,
    policyId: 'schema-migration',
    kind: 'migration',
    label: name,
    source: artifact.path,
    matchTokens: [name],
  };
}

/** JSON Schema documents and OpenAPI component schemas — the typed boundaries. */
function extractSchemas(artifact: DeclaredArtifact, policyId: TestingMethodologyId): TestingSubject[] {
  const subjects: TestingSubject[] = [];
  const componentBlock = /components\s*:\s*[\s\S]{0,200}?schemas\s*:/.exec(artifact.text);
  if (componentBlock) {
    const after = artifact.text.slice(componentBlock.index + componentBlock[0].length);
    for (const line of after.split(/\r?\n/).slice(0, 600)) {
      const named = /^\s{2,}([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
      if (!named) { continue; }
      if (/^\s{6,}/.test(line)) { continue; }
      subjects.push({
        id: `${policyId}:${named[1]}`,
        policyId,
        kind: 'schema',
        label: named[1],
        source: artifact.path,
        matchTokens: [named[1]],
      });
      if (subjects.length >= 300) { break; }
    }
    return subjects;
  }
  // A standalone JSON Schema file is one subject named by its `title` or file.
  if (/"\$schema"\s*:/.test(artifact.text)) {
    const title = /"title"\s*:\s*"([^"]{1,80})"/.exec(artifact.text);
    const name = title ? title[1] : (artifact.path.split('/').pop() ?? artifact.path).replace(/\.[^.]+$/, '');
    subjects.push({
      id: `${policyId}:${name}`,
      policyId,
      kind: 'schema',
      label: name,
      source: artifact.path,
      matchTokens: [name],
    });
  }
  return subjects;
}

/**
 * A file-system route is a declaration, not an inference.
 *
 * Next.js `app/**\/page.tsx` and `pages/**\/*.tsx`, SvelteKit `+page.svelte`,
 * Nuxt `pages/`: the framework treats the file's location as the route, so the
 * path *is* the declaration. That is the line between this and guessing.
 */
function routeSubject(artifact: DeclaredArtifact): TestingSubject | undefined {
  const path = artifact.path;
  let route: string | undefined;

  const appPage = /(?:^|\/)app\/(.*)\/page\.[jt]sx?$/.exec(path);
  if (appPage) { route = `/${appPage[1]}`; }
  const appRoot = /(?:^|\/)app\/page\.[jt]sx?$/.exec(path);
  if (appRoot) { route = '/'; }
  const sveltePage = /(?:^|\/)routes\/(.*)\/\+page\.svelte$/.exec(path);
  if (sveltePage) { route = `/${sveltePage[1]}`; }
  const pagesFile = /(?:^|\/)pages\/(.+)\.[jt]sx?$/.exec(path);
  if (!route && pagesFile && !/^_/.test(pagesFile[1].split('/').pop() ?? '') && !/^api\//.test(pagesFile[1])) {
    route = `/${pagesFile[1].replace(/\/index$/, '').replace(/^index$/, '')}`;
  }
  if (route === undefined) { return undefined; }
  // Route groups are an organisational device and never appear in a URL.
  const normalized = (route.replace(/\/\([^/]*\)/g, '').replace(/\/+/g, '/') || '/');
  return {
    id: `e2e:${normalized}`,
    policyId: 'e2e',
    kind: 'route',
    label: normalized,
    source: path,
    matchTokens: [normalized],
  };
}

/** Roles and permissions, from a declared policy document. */
function extractRoles(artifact: DeclaredArtifact): TestingSubject[] {
  const subjects: TestingSubject[] = [];
  const seen = new Set<string>();
  const push = (name: string): void => {
    const clean = name.trim();
    if (!clean || clean.length > 60 || seen.has(clean) || subjects.length >= 200) { return; }
    seen.add(clean);
    subjects.push({
      id: `rbac-compliance:${clean}`,
      policyId: 'rbac-compliance',
      kind: 'role',
      label: clean,
      source: artifact.path,
      matchTokens: [clean],
    });
  };
  // Cerbos / OPA / Casbin / a declared roles document all spell a role the same
  // way: a `roles:` or `role:` key, or a `"roles": [...]` array.
  // `[ \t]*` rather than `\s*`, which swallowed the newline after `roles:` and
  // captured the first list item as though it were a role name.
  for (const match of artifact.text.matchAll(/(?:^|\n)[ \t]*roles?[ \t]*:[ \t]*\[?([^\n\]]{0,200})/gi)) {
    for (const part of match[1].split(/[,"'[\]]+/)) { push(part); }
  }
  for (const match of artifact.text.matchAll(/(?:^|\n)\s*-\s*(?:name|role)\s*:\s*["']?([A-Za-z0-9_.-]{1,60})/g)) {
    push(match[1]);
  }
  return subjects;
}

/** A prompt kept as a file is a prompt somebody can regress. */
function promptSubject(artifact: DeclaredArtifact): TestingSubject | undefined {
  const base = artifact.path.split('/').pop();
  if (!base) { return undefined; }
  // `summarise.prompt.md` is named for what it is; strip both suffixes.
  const name = base.replace(/\.[^.]+$/, '').replace(/\.prompt$/i, '');
  return {
    id: `prompt-regression:${name}`,
    policyId: 'prompt-regression',
    kind: 'prompt',
    label: name,
    source: artifact.path,
    matchTokens: [name],
  };
}

/**
 * The artifact patterns each extractor reads.
 *
 * Exported so the host can scan for exactly these and nothing else — a walk of
 * the whole workspace on a render path is a cost nobody asked for, and a list
 * here that the scanner does not know about would be an extractor that silently
 * never runs.
 */
/**
 * Whether a path is a declared artifact any extractor reads.
 *
 * A predicate rather than a glob list: the collector is synchronous and this
 * project has no glob dependency, so the host does a bounded directory walk and
 * asks this. Ownership stays here either way — a host-side pattern list would
 * be an extractor that silently never runs once the two drifted.
 */
export function isSubjectArtifactPath(relativePath: string): boolean {
  const path = relativePath.toLowerCase();
  if (/(^|\/)(node_modules|dist|out|coverage|\.git)\//.test(path)) { return false; }
  return (
    /(openapi|swagger|asyncapi|api-spec)[^/]*\.(ya?ml|json)$/.test(path)
    || /\.graphqls?$/.test(path)
    || /\.proto$/.test(path)
    || (/(^|\/)(migrations?|migrate)\//.test(path) && /\.(sql|ts|js|py|rb)$/.test(path))
    || /\.schema\.json$/.test(path)
    || /(^|\/)app\/([^/]+\/)*page\.[jt]sx?$/.test(path)
    || (/(^|\/)pages\/.+\.[jt]sx?$/.test(path) && !/(^|\/)pages\/api\//.test(path))
    || /(^|\/)routes\/([^/]+\/)*\+page\.svelte$/.test(path)
    || /(^|\/)(roles|permissions|policy|policies)[^/]*\.(ya?ml|json)$/.test(path)
    || /(^|\/)prompts\/[^/]+\.(md|txt|ya?ml)$/.test(path)
    || /\.prompt\.(md|txt)$/.test(path)
  );
}

/** Extracts every subject a set of declared artifacts contains. */
export function extractTestingSubjects(artifacts: readonly DeclaredArtifact[]): TestingSubject[] {
  const subjects: TestingSubject[] = [];
  const seen = new Set<string>();
  const add = (candidate: TestingSubject | undefined): void => {
    if (!candidate || seen.has(candidate.id) || subjects.length >= 2000) { return; }
    seen.add(candidate.id);
    subjects.push(candidate);
  };

  for (const artifact of artifacts) {
    const path = artifact.path.toLowerCase();

    if (/(openapi|swagger|asyncapi|api-spec)[^/]*\.(ya?ml|json)$/.test(path)) {
      extractApiPaths(artifact).forEach(add);
      extractSchemas(artifact, 'type-drift').forEach(add);
      extractSchemas(artifact, 'output-schema-drift').forEach(add);
      continue;
    }
    if (/\.graphqls?$/.test(path)) { extractGraphqlOperations(artifact).forEach(add); continue; }
    if (/\.proto$/.test(path)) { extractGrpcServices(artifact).forEach(add); continue; }
    if (/(^|\/)(migrations?|migrate)\//.test(path)) { add(migrationSubject(artifact)); continue; }
    if (/\.schema\.json$/.test(path)) {
      extractSchemas(artifact, 'type-drift').forEach(add);
      continue;
    }
    if (/(^|\/)(roles|permissions|policy|policies)[^/]*\.(ya?ml|json)$/.test(path)) {
      extractRoles(artifact).forEach(add);
      continue;
    }
    if (/(^|\/)prompts\//.test(path) || /\.prompt\.(md|txt)$/.test(path)) {
      add(promptSubject(artifact));
      continue;
    }
    add(routeSubject(artifact));
  }
  return subjects;
}

// ── Coverage ──────────────────────────────────────────────────────

/** Word-boundary-ish match: a token must not merely be a substring of a longer identifier. */
function mentions(source: string, token: string, caseInsensitive = false): boolean {
  if (token.length < 2) { return false; }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Case sensitivity differs by token kind, deliberately. A role, schema name or
  // path is written as declared — `Admin` and `admin` may be different roles,
  // and folding them would report a subject covered by a test for another one.
  // An HTTP method is not: real tests spell it `.get(`, `.post(`, `GET`, and
  // demanding the declared casing would fail every ordinary supertest-style call.
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, caseInsensitive ? 'i' : '').test(source);
}

/**
 * Pairs each subject with the test files that reference it.
 *
 * Only tests belonging to the subject's own policy count. A snapshot test that
 * happens to mention `/v1/orders` is not contract coverage of it, and letting
 * any test file satisfy any subject would rebuild the exact looseness this
 * module exists to replace.
 */
export function assessTestingSubjects(input: {
  subjects: readonly TestingSubject[];
  /** Test sources keyed by workspace-relative path. */
  testSources: ReadonlyMap<string, string>;
  /** Which test files evidence which policy, from the coverage derivation. */
  policyTestFiles: ReadonlyMap<TestingMethodologyId, readonly string[]>;
}): TestingSubjectReport {
  const coverage: TestingSubjectCoverage[] = [];
  const byPolicy = new Map<TestingMethodologyId, { total: number; uncovered: number }>();

  for (const subject of input.subjects) {
    const candidates = input.policyTestFiles.get(subject.policyId) ?? [];
    const evidence: string[] = [];
    for (const file of candidates) {
      const source = input.testSources.get(file);
      if (!source) { continue; }
      const named = subject.matchTokens.some(token => mentions(source, token));
      const qualified = (subject.requiredTokens ?? []).every(token => mentions(source, token, true));
      if (named && qualified) {
        evidence.push(file);
        if (evidence.length >= 5) { break; }
      }
    }
    coverage.push({ subject, covered: evidence.length > 0, evidence });

    const tally = byPolicy.get(subject.policyId) ?? { total: 0, uncovered: 0 };
    tally.total += 1;
    if (evidence.length === 0) { tally.uncovered += 1; }
    byPolicy.set(subject.policyId, tally);
  }

  return {
    coverage,
    extractablePolicies: [...SUBJECT_EXTRACTABLE_POLICIES],
    byPolicy,
  };
}

/**
 * The webview-safe projection of a report.
 *
 * `byPolicy` is a `Map`, and the dashboard payload crosses the webview boundary
 * as JSON — where a Map becomes `{}`, silently, with every tally lost and no
 * error anywhere. The per-policy counts already travel on each
 * `TestingPolicyDetail.subjects`, so the view carries only what the card cannot
 * get from there.
 */
export interface TestingSubjectView {
  coverage: TestingSubjectCoverage[];
  extractablePolicies: TestingMethodologyId[];
}

export function toTestingSubjectView(report: TestingSubjectReport): TestingSubjectView {
  return {
    // Bounded: this is rendered, and a spec with two thousand paths would put
    // two thousand rows into a payload nobody reads past the first screen of.
    coverage: report.coverage.slice(0, 500),
    extractablePolicies: report.extractablePolicies,
  };
}

/** An empty report, for the callers that could not gather anything. */
export function emptyTestingSubjectReport(): TestingSubjectReport {
  return { coverage: [], extractablePolicies: [...SUBJECT_EXTRACTABLE_POLICIES], byPolicy: new Map() };
}
