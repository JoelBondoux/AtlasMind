# Testing Strategy Playbook

> Managed by AtlasMind. Regenerated from `project_memory/index/testing-config.json` on each
> scaffold run. Hand edits to this file are overwritten — change the Settings → Testing matrix instead.

**Detected stack:** TypeScript · runner: vitest · archetype: generic
**Active methodologies:** 28 / 69

## For a generic project

Unit testing applies everywhere. Declaring an archetype is what unlocks a recommendation worth acting on.

- **Suits this shape:** unit

## TDD

Test-Driven Development — red-green-refactor loop

- **When to apply:** Any project where correctness matters and requirements can be expressed as assertions before the code is written. Especially valuable for greenfield features and critical business logic.
- **Key tools:** Jest, Vitest, Mocha, pytest, JUnit, RSpec, Go testing
- **Trade-offs:** Requires discipline to write the test first; initial velocity feels slower before the refactor payoff. Poorly scoped tests can become brittle.
- **Set up (Node (JS/TS)):** npm install -D vitest
- **Starter file:** `tests/example.test.ts`

## BDD

Behavior-Driven Development — Gherkin / Given-When-Then specs

- **When to apply:** Projects with a non-technical product owner or QA team who needs to co-author acceptance criteria. Works best when requirements arrive as user stories.
- **Key tools:** Cucumber, SpecFlow, Behave, Gherkin, Codecept, Playwright BDD plugin
- **Trade-offs:** Scenario maintenance overhead grows quickly if stakeholders do not actively contribute. Can drift into redundant unit + scenario coverage.
- **Starter file:** _none for Node (JS/TS) — follow the set-up and key tools above._

## Unit Testing

Isolated function and class-level tests

- **When to apply:** All projects. Start here. Fast, cheap, and gives precise regression signals. Should be the largest layer of your test pyramid.
- **Key tools:** Jest, Vitest, Mocha, pytest, JUnit, NUnit, xUnit, Go testing, Minitest
- **Trade-offs:** Tests of implementation details (not behaviour) become expensive to maintain. Mocking boundaries can give false confidence at integration points.
- **Set up (Node (JS/TS)):** npm install -D vitest
- **Starter file:** `tests/example.test.ts`

## Mutation Testing

Fault injection to measure suite kill-rate (Stryker, Pitest)

- **When to apply:** Mature suites where you want to measure test quality, not just quantity. Excellent for libraries and shared utilities where coverage alone is misleading.
- **Key tools:** Stryker Mutator (JS/TS/C#), Pitest (Java/Kotlin), mutmut (Python), Infection (PHP)
- **Trade-offs:** Very slow on large codebases; often run nightly rather than on every push. Tuning timeout and survivor thresholds takes experimentation.
- **Set up (Node (JS/TS)):** npm install -D @stryker-mutator/core @stryker-mutator/vitest-runner
- **Starter file:** _none for Node (JS/TS) — follow the set-up and key tools above._

## Property-Based

Generative input testing (fast-check, Hypothesis)

- **When to apply:** Pure functions, parsers, data transformers, and algorithmic code. Generates hundreds of random inputs to find edge cases no human would enumerate.
- **Key tools:** fast-check (JS/TS), Hypothesis (Python), QuickCheck (Haskell/Erlang), jqwik (Java), gopter (Go)
- **Trade-offs:** Requires learning the property-definition mindset; not suitable for code with side effects or non-deterministic I/O.
- **Set up (Node (JS/TS)):** npm install -D fast-check
- **Starter file:** `tests/example.property.test.ts`

## Continuous / Shift-Left

Automated testing embedded throughout CI/CD — tests run on every commit, earliest possible feedback

- **When to apply:** Any project with a CI/CD pipeline. Essential for teams delivering frequent releases or practising trunk-based development. Shift-left means pushing tests earlier: linting, type checks, and unit tests on pre-commit; integration and E2E on PR; performance and security on merge.
- **Key tools:** GitHub Actions, GitLab CI, Jenkins, CircleCI, Azure DevOps, Buildkite, Husky / pre-commit hooks, Test Impact Analysis (Vitest, Jest)
- **Trade-offs:** Requires significant upfront investment in pipeline configuration and test suite speed. Slow suites become a bottleneck on developer velocity. Shallow-but-fast suites give false safety if coverage is insufficient.
- **Starter file:** _none for Node (JS/TS) — follow the set-up and key tools above._

## Dead-Field / Dead-Prop Detection

Finds declared fields, props and config keys that nothing ever reads

- **When to apply:** Codebases where types, props or configuration have accumulated over several refactors. A field that is written but never read is a bug wearing a feature's clothes — the code that was supposed to consume it was renamed, moved, or never written.
- **Key tools:** ts-prune, knip, ts-unused-exports, eslint no-unused-vars, Vulture (Python), deadcode (Go), cargo-udeps (Rust)
- **Trade-offs:** Reflection, dynamic key access, and serialization boundaries produce false positives — a field read only by `JSON.parse` consumers looks dead. Needs an allowlist for public API surfaces, or it reports every exported type as unused.
- **Set up (Node (JS/TS)):** npm install -D knip  •  run: npx knip
- **Starter file:** _none for Node (JS/TS) — follow the set-up and key tools above._

## Type Drift Detection

Checks that static types still describe what actually arrives at runtime

- **When to apply:** Any TypeScript or typed-Python project consuming external JSON — an API response, a config file, a database row. The compiler checks the *assertion*, not the data, so a backend that renamed a field keeps compiling and fails in production.
- **Key tools:** Zod, Valibot, io-ts, ArkType, typia, Pydantic, attrs + cattrs, quicktype (schema → type generation)
- **Trade-offs:** Runtime validation costs latency on hot paths and duplicates the type declaration unless the schema is the single source both derive from. Validating everything is over-correction; the boundary is where it pays.
- **Set up (Node (JS/TS)):** npm install zod  •  validate at the boundary, not everywhere
- **Starter file:** `tests/type-drift.schema.test.ts`

## End-to-End

Full user-flow simulation (Playwright, Cypress, etc.)

- **When to apply:** Web and mobile applications with critical user journeys (checkout, login, onboarding). High confidence at the cost of speed.
- **Key tools:** Playwright, Cypress, Puppeteer, WebdriverIO, Detox (mobile), Appium
- **Trade-offs:** Slowest tests in the suite; brittle to DOM changes. High maintenance burden if driven by selectors rather than accessible roles.
- **Set up (Node (JS/TS)):** npm install -D @playwright/test && npx playwright install
- **Starter file:** `e2e/example.spec.ts`

## Contract

Consumer-driven API contract verification (Pact)

- **When to apply:** Microservice architectures where multiple teams own their own services. Consumers write the contract; providers verify it — eliminating integration environment dependency.
- **Key tools:** Pact (JS, Java, Go, .NET, Ruby, Python), Spring Cloud Contract, Dredd
- **Trade-offs:** Requires buy-in from all service teams to publish and verify contracts. Initial setup cost is high; payoff grows with the number of services.
- **Set up (Node (JS/TS)):** npm install -D @pact-foundation/pact
- **Starter file:** _none for Node (JS/TS) — follow the set-up and key tools above._

## Cross-Surface Property Parity

Asserts the same rule produces the same answer on every surface that states it

- **When to apply:** Products where one fact is displayed in several places — a CLI and a web UI, a dashboard card and the detail page it links to, an API and the SDK wrapping it. The failure this catches is two surfaces disagreeing about the same number, which reads as a data bug and is really a duplicated rule.
- **Key tools:** Shared fixture suites, Vitest/Jest table-driven tests, golden files, contract-style shared assertions, Playwright + API cross-checks
- **Trade-offs:** Only pays where a rule is genuinely duplicated; forcing parity onto surfaces that legitimately differ produces tests that block valid divergence. Requires naming the canonical source, which is a design decision the test cannot make for you.
- **Starter file:** `tests/cross-surface.parity.test.ts`

## Cross-Representation Consistency

Asserts a value survives every round trip between its representations

- **When to apply:** Anywhere one value has several forms — JSON and a database row, a domain object and its DTO, markdown and its parsed AST, a display string and the number behind it. Serialization asymmetry is the classic silent corruption: it writes fine, reads back subtly different, and nothing fails until much later.
- **Key tools:** fast-check / Hypothesis round-trip properties, snapshot fixtures, JSON Schema validation, protobuf/Avro conformance suites
- **Trade-offs:** Round-trip properties are only as good as the generator; a naive generator never produces the edge case (empty string, unicode, null vs absent) where asymmetry actually lives. Lossy-by-design conversions need explicit exclusion or they read as failures.
- **Set up (Node (JS/TS)):** npm install -D fast-check
- **Starter file:** `tests/cross-representation.roundtrip.test.ts`

## Cross-Version Parity

Asserts a new version still answers old inputs the way the old version did

- **When to apply:** Libraries, APIs and file formats with existing consumers. Distinct from compatibility testing: this replays *real recorded behaviour* from the previous version rather than checking a declared contract, so it catches the change nobody documented.
- **Key tools:** Golden/approval files, recorded request-response fixtures, API diffing (oasdiff, openapi-diff), semantic-release + api-extractor, Pact provider verification against prior consumer versions
- **Trade-offs:** Golden files record whatever the old version did, bugs included — a fixed bug looks like a regression until the baseline is deliberately re-approved. Requires discipline about *why* a baseline changed.
- **Starter file:** _none for Node (JS/TS) — follow the set-up and key tools above._

## Semantic Constraint Testing

Asserts domain invariants that types allow but the domain forbids

- **When to apply:** Domains with rules the type system cannot express — an end date after its start, a total matching the sum of its parts, a state machine that never reaches a terminal state twice. The type says `Date`; the domain says "not before the other one".
- **Key tools:** Zod refinements, class-validator, Pydantic validators, database CHECK constraints, fast-check preconditions, invariant assertions in domain models
- **Trade-offs:** Constraints scattered across the code drift apart; they belong with the type they constrain. Over-constraining rejects legitimate historical data, which surfaces as a migration failure rather than a test one.
- **Starter file:** `tests/semantic-constraint.invariants.test.ts`

## Output Schema Drift Detection

Detects when produced output stops matching its own published schema

- **When to apply:** Any producer with consumers it cannot see — a public API, an event stream, a webhook, a structured LLM response, an exported report. The producer's tests pass because they were updated alongside it; the consumer breaks because it was not.
- **Key tools:** JSON Schema / Ajv, OpenAPI response validation, oasdiff, Avro/protobuf schema registry compatibility checks, Zod parse on output, Great Expectations for tabular output
- **Trade-offs:** Only as strong as the schema's strictness — a schema permitting additional properties never detects an added field, which is exactly the change that breaks strict consumers. Requires deciding whether additive change is breaking for *your* consumers.
- **Set up (Node (JS/TS)):** npm install zod  •  validate at the boundary, not everywhere
- **Starter file:** `tests/output-schema-drift.test.ts`

## Hallucination Detection

Checks that model-stated facts are grounded in the sources actually provided

- **When to apply:** Any feature where a model states facts a user will act on — RAG answers, summarisation, extraction, citations. A fluent, specific, entirely invented answer is indistinguishable from a correct one to every assertion except one that checks it against the source.
- **Key tools:** RAGAS (faithfulness/groundedness), DeepEval, TruLens, Promptfoo assertions, LLM-as-judge with a citation requirement, entity overlap against source, Anthropic/OpenAI evals
- **Trade-offs:** The grader is itself a model and can be wrong in the same direction as the thing it grades. Needs a human-labelled seed set to trust the grader, and a groundedness score is a signal, not a verdict.
- **Set up (Node (JS/TS)):** npm install -D promptfoo  •  record fixtures so the suite can run without spending tokens on every commit
- **Starter file:** `evals/hallucination.groundedness.eval.ts`

## Security

SAST / DAST and dependency vulnerability scanning

- **When to apply:** Any application handling authentication, payments, PII, or sensitive data. Should be part of CI for all production software.
- **Key tools:** Snyk, OWASP ZAP, Semgrep, Trivy, CodeQL, Dependabot, npm audit, OWASP Dependency-Check
- **Trade-offs:** SAST tools produce false positives that need triage. DAST requires a running environment. Both add CI time and require a process for managing findings.
- **Set up (Node (JS/TS)):** npx audit-ci  •  consider Snyk / Semgrep / Trivy in CI
- **Starter file:** _none for Node (JS/TS) — follow the set-up and key tools above._

## Accessibility (a11y)

Automated and manual checks against WCAG success criteria

- **When to apply:** Every product with a user interface, and a legal requirement for public sector, education, and increasingly commercial software (EAA, ADA, Section 508). Automated tooling reliably catches roughly a third of WCAG issues, which makes it necessary and not sufficient.
- **Key tools:** axe-core, @axe-core/playwright, jest-axe, Pa11y, Lighthouse, WAVE, eslint-plugin-jsx-a11y, screen readers (NVDA, VoiceOver, JAWS) for the manual half
- **Trade-offs:** A clean automated run is routinely mistaken for an accessible product. Keyboard traps, focus order, and meaningful alt text need a human. Colour-contrast checks flag decorative elements that need exclusion.
- **Set up (Node (JS/TS)):** npm install -D jest-axe @axe-core/playwright eslint-plugin-jsx-a11y  •  automated checks find roughly a third of issues — keep a keyboard and screen-reader pass alongside
- **Starter file:** `tests/accessibility.a11y.test.ts`

## Memory / State Drift Detection

Detects when persisted state stops matching what the code believes it holds

- **When to apply:** Long-lived stores written by successive versions — agent memory, user preferences, caches, session documents, event-sourced aggregates. The document on disk was written by a build that no longer exists, and the reader assumes a shape nobody re-checked.
- **Key tools:** Versioned document schemas with migration ladders, Zod/Pydantic parse-on-read, snapshot corpora of historical documents, replay tests over an event log
- **Trade-offs:** Requires keeping a corpus of genuinely old documents, which teams discard. Detecting drift is cheap; deciding whether an unrecognised document is corrupt or merely *newer* is the hard part, and getting it wrong overwrites good data.
- **Starter file:** `tests/state-drift.test.ts`

## Guardrail Enforcement

Tests that safety policies actually refuse, including under adversarial input

- **When to apply:** Any model-backed feature reachable by untrusted input. A guardrail is written once, believed permanently, and bypassed by the first prompt injection nobody tried — a policy without a test is a comment.
- **Key tools:** Promptfoo red-team plugins, Garak, PyRIT, NeMo Guardrails test suites, Llama Guard, Rebuff, adversarial case corpora, refusal assertions
- **Trade-offs:** The adversarial case set is never complete, so passing means "not broken by what we tried". Grading a refusal is subtler than it looks — an over-refusing model passes the safety test and fails the product.
- **Set up (Node (JS/TS)):** npm install -D promptfoo  •  npx promptfoo redteam init, and keep the adversarial corpus in version control
- **Starter files:** `tests/fixtures/adversarial-prompts.json`, `tests/guardrail.test.ts`

## Agent Collaboration Correctness

Tests hand-offs, delegation limits, and that agents share no authority they should not

- **When to apply:** Multi-agent systems with delegation, sub-tasks, or tool sharing. The failure mode is authority accumulating across a hand-off — a restricted agent obtaining a capability by asking a permissive one — which every individual agent test passes.
- **Key tools:** Deterministic fake agents, hand-off depth/cycle assertions, permission-intersection property tests, transcript replay, LangGraph/CrewAI test harnesses, trace assertions
- **Trade-offs:** Requires the collaboration rules to be explicit before they can be tested; most systems discover their rules by writing this suite. End-to-end multi-agent runs are slow and nondeterministic — test the policy layer as a pure function wherever it can be extracted.
- **Starter file:** `tests/agent-collaboration.test.ts`

## Exploratory

Session-based manual discovery and charter testing

- **When to apply:** New features, usability-sensitive workflows, and any area where automation has not yet caught up. Pairs well with a formal charter to keep sessions focused.
- **Key tools:** Session-based testing charters, TestRail, Zephyr, Xray, Notion test logs, PractiTest
- **Trade-offs:** Not repeatable and depends on tester skill. Should complement automation, not replace it. Results are only as good as the debrief and reporting discipline.
- **Starter file:** _none — this is a practice, not an artifact, so there is no file to create._

## Change-Management Compliance

Tests that changes reached production through the approvals the policy requires

- **When to apply:** Regulated environments and any organisation asserting a change process to an auditor. Almost entirely checkable from repository and CI metadata — protected branches, required reviews, linked tickets, deployment approvals — which makes it the cheapest compliance policy to automate.
- **Key tools:** Branch-protection API assertions, required-review checks, CODEOWNERS verification, deployment-approval gates, commit-to-ticket traceability, git history analysis
- **Trade-offs:** Emergency changes are legitimate and will break a naive assertion — the policy needs a documented break-glass path, or the test trains people to bypass it. Measuring process compliance is not measuring change quality.
- **Starter files:** `project_memory/operations/compliance/change-management.md`, `tests/change-management.test.ts`

## AI Safety & Guardrail Compliance

Evidences that declared AI safety commitments are implemented and enforced

- **When to apply:** Products making public safety claims, and anything in scope of the EU AI Act's obligations for high-risk or general-purpose systems. Distinct from guardrail *testing*: this asks whether the declared policy, the implementation, and the evidence agree.
- **Key tools:** EU AI Act conformity checklists, NIST AI RMF mapping, model cards, system cards, guardrail-policy registers, incident-reporting procedures, red-team evidence retention
- **Trade-offs:** Largely documentary and the regulatory picture is still moving, so a mapping built once goes stale. The executable half is already covered by guardrail enforcement testing — keep them distinct or you will duplicate evidence and still miss the policy gap.
- **Set up (Node (JS/TS)):** No tooling — the evidence is `project_memory/operations/compliance/ai-safety-compliance.md`. Decide the scope first: Whether this system is in scope as high-risk or general-purpose under the EU AI Act, and which public safety claims the product makes.
- **Starter file:** `project_memory/operations/compliance/ai-safety-compliance.md`

## Model-Output Risk Classification

Tests that outputs are classified by risk and that the classification drives handling

- **When to apply:** Products where some model outputs need different treatment — human review, a disclaimer, a refusal, or a log. A classifier that is never tested tends toward one class, which silently removes the review step it exists to trigger.
- **Key tools:** Labelled risk corpora, confusion-matrix assertions, threshold calibration tests, Llama Guard / moderation-endpoint evaluation, escalation-path tests, anti-uniformity checks on classifier output
- **Trade-offs:** Needs a labelled ground-truth set, which is real annotation work and the reason this is usually skipped. Accuracy alone is a misleading metric when risk classes are rare — measure recall on the rare class.
- **Starter files:** `project_memory/operations/compliance/model-output-risk.md`, `tests/model-output-risk.test.ts`

## Bias, Fairness & Non-Discrimination

Tests outcomes across protected groups for unjustified disparity

- **When to apply:** Any system whose output affects people's access to something — hiring, lending, housing, pricing, moderation, ranking. Legally required in several jurisdictions (NYC LL144, EU AI Act) and the disparity is invisible in aggregate accuracy, which is the metric everyone reports.
- **Key tools:** Fairlearn, AI Fairness 360, What-If Tool, counterfactual/perturbation test sets, demographic parity and equalised-odds metrics, disparate-impact ratio, slice-based evaluation
- **Trade-offs:** Fairness definitions are mathematically incompatible — satisfying demographic parity and equalised odds simultaneously is generally impossible, so the choice is a stated value judgement, not a technical default. Testing needs protected-attribute data, which privacy rules restrict collecting.
- **Set up (Node (JS/TS)):** Fairlearn or AI Fairness 360 (Python side) — and state which fairness definition you chose, because they conflict
- **Starter file:** `tests/bias-fairness.test.ts`

## Explainability & Transparency

Tests that a decision can be explained to the person it affects

- **When to apply:** Automated decisions with legal or significant effect — GDPR Article 22, the EU AI Act, and sector rules like ECOA adverse-action notices all require a meaningful explanation. The test is that the explanation is faithful to the decision, not merely that one is produced.
- **Key tools:** SHAP, LIME, captum, counterfactual explanation generators, faithfulness/consistency assertions, model cards, decision-log inspection, reason-code verification
- **Trade-offs:** A plausible explanation that does not reflect the actual decision is worse than none — post-hoc explainers can be unfaithful, and a fluent LLM rationale is not evidence of the reasoning that produced the answer. Testing faithfulness is harder than producing explanations.
- **Starter file:** _none for Node (JS/TS) — follow the set-up and key tools above._

## AI Memory & Data-Use Policy

Tests that what the system remembers and sends matches what was promised

- **When to apply:** Any AI product with memory, retrieval, or training feedback loops. Two commitments are routinely stated and rarely tested: that customer data does not train a model, and that a secret or another tenant's data never reaches a prompt.
- **Key tools:** Redaction-boundary tests, prompt-payload inspection, tenant-isolation tests over retrieval, training-opt-out verification, memory-retention window tests, provider zero-retention configuration checks
- **Trade-offs:** The boundary is only as good as its worst path — one un-redacted logging call or one retrieval query missing a tenant filter defeats the whole policy, so coverage matters more than depth here. Provider-side commitments cannot be tested locally, only configured and evidenced.
- **Starter files:** `project_memory/operations/compliance/ai-data-policy.md`, `tests/ai-data-policy.test.ts`
