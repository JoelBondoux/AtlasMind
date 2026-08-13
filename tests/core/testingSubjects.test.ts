import { describe, expect, it } from 'vitest';
import {
  SUBJECT_EXTRACTABLE_POLICIES,
  assessTestingSubjects,
  extractTestingSubjects,
  type DeclaredArtifact,
} from '../../src/core/testingSubjects.ts';
import type { TestingMethodologyId } from '../../src/types.ts';

/**
 * Coverage used to be a methodology-level question — does *anything* here test
 * contracts — so a project with one contract test from March reported `covered`
 * in December having added forty endpoints in between. The obligation check had
 * the same hole: any changed test file satisfied any policy.
 *
 * These tests pin the property that closes it: a new declared artifact produces
 * a new uncovered subject, immediately, without anybody remembering to add a
 * rule.
 */
function artifact(path: string, text: string): DeclaredArtifact {
  return { path, text };
}

const OPENAPI = `
openapi: 3.0.0
info:
  title: Orders
paths:
  /v1/orders:
    get:
      summary: List orders
    post:
      summary: Create an order
  /v1/orders/{id}:
    delete:
      summary: Cancel
components:
  schemas:
    Order:
      type: object
    OrderLine:
      type: object
`;

describe('a new declared artifact becomes a new rule', () => {
  it('extracts one contract subject per path and method', () => {
    const subjects = extractTestingSubjects([artifact('openapi.yaml', OPENAPI)])
      .filter(subject => subject.policyId === 'contract');
    expect(subjects.map(subject => subject.label).sort()).toEqual([
      'DELETE /v1/orders/{id}',
      'GET /v1/orders',
      'POST /v1/orders',
    ]);
  });

  it('adds a subject the moment a new path lands, with no rule to write', () => {
    // This is the whole feature: the rule appears because the artifact did.
    const before = extractTestingSubjects([artifact('openapi.yaml', OPENAPI)]).length;
    const withRefunds = OPENAPI.replace(
      '  /v1/orders/{id}:',
      '  /v1/refunds:\n    post:\n      summary: Refund\n  /v1/orders/{id}:',
    );
    const after = extractTestingSubjects([artifact('openapi.yaml', withRefunds)]).length;
    expect(after).toBe(before + 1);
  });

  it('extracts component schemas as boundary subjects', () => {
    const subjects = extractTestingSubjects([artifact('openapi.yaml', OPENAPI)]);
    const drift = subjects.filter(subject => subject.policyId === 'type-drift').map(subject => subject.label);
    expect(drift).toContain('Order');
    expect(drift).toContain('OrderLine');
  });

  it('extracts GraphQL operations', () => {
    const subjects = extractTestingSubjects([artifact('schema.graphql', `
      type Query {
        orders(first: Int): [Order!]!
        order(id: ID!): Order
      }
      type Mutation {
        createOrder(input: OrderInput!): Order!
      }
    `)]);
    expect(subjects.map(subject => subject.label).sort())
      .toEqual(['Mutation.createOrder', 'Query.order', 'Query.orders']);
  });

  it('extracts gRPC methods', () => {
    const subjects = extractTestingSubjects([artifact('orders.proto', `
      service OrderService {
        rpc ListOrders (ListRequest) returns (ListReply);
        rpc CancelOrder (CancelRequest) returns (CancelReply);
      }
    `)]);
    expect(subjects.map(subject => subject.label).sort())
      .toEqual(['OrderService.CancelOrder', 'OrderService.ListOrders']);
  });

  it('treats each migration as its own subject', () => {
    const subjects = extractTestingSubjects([
      artifact('prisma/migrations/20260101_add_orders/migration.sql', 'CREATE TABLE orders();'),
      artifact('db/migrate/20260202_add_refunds.sql', 'ALTER TABLE orders ADD COLUMN refunded boolean;'),
    ]);
    expect(subjects.every(subject => subject.policyId === 'schema-migration')).toBe(true);
    expect(subjects).toHaveLength(2);
  });

  it('reads a file-system route as a declaration, not an inference', () => {
    const subjects = extractTestingSubjects([
      artifact('src/app/checkout/page.tsx', 'export default function Page() {}'),
      artifact('src/app/page.tsx', 'export default function Home() {}'),
      artifact('src/pages/about.tsx', 'export default function About() {}'),
    ]).filter(subject => subject.policyId === 'e2e');
    expect(subjects.map(subject => subject.label).sort()).toEqual(['/', '/about', '/checkout']);
  });

  it('strips route groups, which never appear in a URL', () => {
    const subjects = extractTestingSubjects([
      artifact('app/(marketing)/pricing/page.tsx', 'export default function P() {}'),
    ]);
    expect(subjects[0].label).toBe('/pricing');
  });

  it('ignores framework-private page files', () => {
    const subjects = extractTestingSubjects([
      artifact('pages/_app.tsx', 'export default function App() {}'),
      artifact('pages/api/orders.ts', 'export default function handler() {}'),
    ]);
    expect(subjects).toEqual([]);
  });

  it('extracts declared roles', () => {
    const subjects = extractTestingSubjects([
      artifact('policies/roles.yaml', 'roles:\n  - name: viewer\n  - name: editor\n  - name: admin\n'),
    ]);
    expect(subjects.map(subject => subject.label).sort()).toEqual(['admin', 'editor', 'viewer']);
  });

  it('extracts prompts kept as files', () => {
    const subjects = extractTestingSubjects([
      artifact('prompts/triage.md', 'Classify the message.'),
      artifact('src/summarise.prompt.md', 'Summarise.'),
    ]);
    expect(subjects.map(subject => subject.label).sort()).toEqual(['summarise', 'triage']);
  });

  it('never invents a subject from ordinary source code', () => {
    // The line between this and guessing: an extractor that read source shape
    // would manufacture obligations nobody agreed to.
    expect(extractTestingSubjects([
      artifact('src/core/orders.ts', 'export function createOrder() {}\nexport class OrderService {}'),
      artifact('README.md', '## /v1/orders\nWe expose GET /v1/orders.'),
    ])).toEqual([]);
  });

  it('never emits duplicate ids', () => {
    const subjects = extractTestingSubjects([
      artifact('openapi.yaml', OPENAPI),
      artifact('docs/openapi.yaml', OPENAPI),
    ]);
    expect(new Set(subjects.map(subject => subject.id)).size).toBe(subjects.length);
  });

  it('survives a malformed spec without throwing', () => {
    expect(() => extractTestingSubjects([
      artifact('openapi.yaml', 'paths:\n  {{{ broken'),
      artifact('schema.graphql', 'type Query {'),
      artifact('x.proto', 'service {'),
    ])).not.toThrow();
  });
});

describe('coverage is by reference, and biased toward false negatives', () => {
  const subjects = extractTestingSubjects([artifact('openapi.yaml', OPENAPI)])
    .filter(subject => subject.policyId === 'contract');

  function assess(testSources: Record<string, string>) {
    return assessTestingSubjects({
      subjects,
      testSources: new Map(Object.entries(testSources)),
      policyTestFiles: new Map<TestingMethodologyId, readonly string[]>([
        ['contract', Object.keys(testSources)],
      ]),
    });
  }

  it('counts a test that names the path as covering it', () => {
    const report = assess({ 'tests/contract.test.ts': "it('lists', () => request(app).get('/v1/orders'))" });
    const covered = report.coverage.filter(entry => entry.covered).map(entry => entry.subject.label);
    expect(covered).toContain('GET /v1/orders');
  });

  it('does not count a test that never names it', () => {
    // A test that does not mention the endpoint it supposedly tests is not
    // evidence that it does.
    const report = assess({ 'tests/contract.test.ts': "it('works', () => expect(true).toBe(true))" });
    expect(report.coverage.every(entry => !entry.covered)).toBe(true);
  });

  it('does not let one endpoint cover another', () => {
    const report = assess({ 'tests/contract.test.ts': "request(app).get('/v1/orders')" });
    const byLabel = new Map(report.coverage.map(entry => [entry.subject.label, entry.covered]));
    expect(byLabel.get('GET /v1/orders')).toBe(true);
    expect(byLabel.get('DELETE /v1/orders/{id}')).toBe(false);
    // The method matters: a GET contract test says nothing about the POST.
    expect(byLabel.get('POST /v1/orders')).toBe(false);
  });

  it('does not let another policy’s test satisfy the subject', () => {
    // A snapshot test that happens to mention the path is not contract
    // coverage of it — allowing that would rebuild the looseness this replaces.
    const report = assessTestingSubjects({
      subjects,
      testSources: new Map([['tests/snap.test.ts', "request(app).get('/v1/orders')"]]),
      policyTestFiles: new Map<TestingMethodologyId, readonly string[]>([
        ['snapshot', ['tests/snap.test.ts']],
      ]),
    });
    expect(report.coverage.every(entry => !entry.covered)).toBe(true);
  });

  it('matches on a boundary, not a substring', () => {
    const roleSubjects = extractTestingSubjects([
      artifact('roles.yaml', 'roles:\n  - name: admin\n'),
    ]);
    const report = assessTestingSubjects({
      subjects: roleSubjects,
      testSources: new Map([['tests/rbac.test.ts', "const superadmins = ['x'];"]]),
      policyTestFiles: new Map<TestingMethodologyId, readonly string[]>([['rbac-compliance', ['tests/rbac.test.ts']]]),
    });
    expect(report.coverage[0].covered, '"superadmins" must not cover the "admin" role').toBe(false);
  });

  it('tallies uncovered subjects per policy', () => {
    const report = assess({ 'tests/contract.test.ts': "request(app).get('/v1/orders')" });
    expect(report.byPolicy.get('contract')).toEqual({ total: 3, uncovered: 2 });
  });

  it('records which test files provide the evidence', () => {
    const report = assess({
      'tests/a.test.ts': "request(app).get('/v1/orders')",
      'tests/b.test.ts': "request(app).get('/v1/orders')",
    });
    const entry = report.coverage.find(candidate => candidate.subject.label === 'GET /v1/orders');
    expect(entry?.evidence).toEqual(['tests/a.test.ts', 'tests/b.test.ts']);
  });
});

describe('what cannot be extracted says so', () => {
  it('declares exactly the policies an extractor exists for', () => {
    const report = assessTestingSubjects({
      subjects: [], testSources: new Map(), policyTestFiles: new Map(),
    });
    expect(report.extractablePolicies).toEqual([...SUBJECT_EXTRACTABLE_POLICIES]);
  });

  it('has no subjects for a policy with nothing to enumerate', () => {
    // Exploratory testing has no discoverable unit. Reporting zero uncovered
    // subjects for it would read as complete rather than as inapplicable, which
    // is why the extractable list is published alongside.
    expect(SUBJECT_EXTRACTABLE_POLICIES).not.toContain('exploratory');
    expect(SUBJECT_EXTRACTABLE_POLICIES).not.toContain('v-model');
  });
});
