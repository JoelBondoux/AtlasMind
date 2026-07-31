# Testing Strategy Playbook

> Managed by AtlasMind. Regenerated from `project_memory/index/testing-config.json` on each
> scaffold run. Hand edits to this file are overwritten — change the Settings → Testing matrix instead.

**Detected stack:** TypeScript · runner: vitest · archetype: generic
**Active methodologies:** 13 / 23

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

## ATDD

Acceptance Test-Driven Development — customer-facing criteria first

- **When to apply:** When the delivery team works directly from customer acceptance criteria. Bridges the gap between BDD storytelling and executable acceptance tests.
- **Key tools:** Robot Framework, FitNesse, Cucumber, SpecFlow, Gauge
- **Trade-offs:** Requires close collaboration with customers to define criteria up-front; misaligned criteria produce tests that pass but miss intent.

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

## White-Box

Structure-aware testing — code paths, branches, and conditions guided by internal knowledge

- **When to apply:** Security-sensitive modules, complex algorithms, and codebases where path or branch coverage is a compliance requirement (DO-178C, IEC 61508). Augments unit tests with precise coverage metrics to identify dead code and untested logic.
- **Key tools:** Istanbul / nyc (JS/TS), coverage.py, JaCoCo (Java/Kotlin), gcov / lcov (C/C++), LLVM coverage, SonarQube, Codecov, Coveralls
- **Trade-offs:** High coverage percentages do not guarantee correctness — every line can be executed while semantic bugs remain. Tests tightly coupled to implementation details become expensive to maintain during refactors.
- **Set up (Node (JS/TS)):** npm install -D vitest
- **Starter file:** `tests/example.test.ts`

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

## Model-Based (MBT)

Derive test cases from formal system models — state machines, UML diagrams, decision tables

- **When to apply:** Complex systems with many state transitions: embedded software, protocol implementations, workflow engines, and telecom or automotive stacks. MBT generates optimised test suites that cover the model more completely than hand-authored cases.
- **Key tools:** GraphWalker, TestOptimal, Conformiq, MBTsuite, Selenium + custom state model wrappers
- **Trade-offs:** Requires expertise in formal modelling. Model creation and maintenance adds overhead. Overkill for simple CRUD applications where a direct test is faster to write than a model.

## Performance

Load, stress, and latency benchmarks (k6, Artillery, JMeter)

- **When to apply:** APIs, real-time systems, or any application with SLA targets. Run before a major release or infrastructure change to validate throughput and latency under load.
- **Key tools:** k6, Artillery, Apache JMeter, Gatling, Locust, autocannon, wrk
- **Trade-offs:** Requires a representative test environment; results on localhost are misleading. Defining realistic load scenarios takes time and domain knowledge.
- **Set up (Node (JS/TS)):** Install k6 (https://k6.io/docs/get-started/installation/) — run: k6 run performance/load.k6.js
- **Starter file:** `performance/load.k6.js`

## Security

SAST / DAST and dependency vulnerability scanning

- **When to apply:** Any application handling authentication, payments, PII, or sensitive data. Should be part of CI for all production software.
- **Key tools:** Snyk, OWASP ZAP, Semgrep, Trivy, CodeQL, Dependabot, npm audit, OWASP Dependency-Check
- **Trade-offs:** SAST tools produce false positives that need triage. DAST requires a running environment. Both add CI time and require a process for managing findings.
- **Set up (Node (JS/TS)):** npx audit-ci  •  consider Snyk / Semgrep / Trivy in CI
