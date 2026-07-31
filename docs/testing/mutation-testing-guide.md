# Mutation Testing Guide

## Overview

Mutation testing measures **test quality** by introducing small bugs (mutations) into your code and checking whether your tests catch them. A mutation that survives (tests still pass) indicates a gap in test coverage or assertion strength.

AtlasMind uses **Stryker Mutator** for mutation testing on critical business logic modules.

The runner deliberately executes the full Vitest suite for its coverage baseline.
Vitest's related-test shortcut cannot reliably trace every AtlasMind module through
the runtime composition layer, and a mutation run that silently finds no tests is
not useful evidence. Stryker excludes test files from mutation by default, but
does not exclude them from its sandbox — it still needs them there to run.

## Installation

The required Stryker packages are committed as development dependencies. Run
`npm install` once after pulling the repository.

## Running Mutation Tests

### Full mutation test suite (all configured modules)
```powershell
npm run test:mutation
```

### Single module
```powershell
npx stryker run --mutate "src/core/criticality.ts"
```

### View results
After running, open `mutation-report.html` in your browser for an interactive report showing:
- Which mutations were killed (✓ good — tests caught the bug)
- Which mutations survived (✗ test gap — tests didn't catch the bug)
- Mutation score (% of mutations killed)

## Current Coverage

### Priority 1: Critical Business Logic
- **`src/core/criticality.ts`** — Task criticality assessment
  - Why: Security/safety decisions depend on accurate criticality classification
  - Target: 80%+ mutation score

- **`src/core/toolPolicy.ts`** — Tool approval classification
  - Why: Security boundary — misclassification could allow unsafe operations
  - Target: 80%+ mutation score

- **`src/core/agentRegistry.ts`** — Agent performance tracking
  - Why: Success rate calculations drive agent selection
  - Target: 80%+ mutation score

### Adding New Modules

Edit `stryker.config.json` and add to the `mutate` array:

```json
{
  "mutate": [
    "src/core/criticality.ts",
    "src/core/toolPolicy.ts",
    "src/core/agentRegistry.ts",
    "src/core/yourNewModule.ts"  // Add here
  ]
}
```

## Interpreting Results

### Mutation Score Thresholds
- **≥80%** — Excellent test quality
- **60-79%** — Acceptable, but room for improvement
- **<60%** — Weak tests, significant gaps

### Common Surviving Mutations

1. **Boundary conditions** — `>` mutated to `>=`
   - Fix: Add explicit boundary tests

2. **Boolean operators** — `&&` mutated to `||`
   - Fix: Test both true/false paths

3. **Return values** — Early return removed
   - Fix: Assert the actual return value, not just "doesn't throw"

4. **Array/string methods** — `.some()` mutated to `.every()`
   - Fix: Test with multiple elements, not just single-item arrays

## Best Practices

1. **Run mutation tests on changed modules** before merging
2. **Don't aim for 100%** — some mutations are equivalent (same behavior)
3. **Focus on critical paths** — mutation testing is expensive, target high-value code
4. **Use mutation results to improve tests**, not just chase the score

## CI Integration

Mutation tests are **not** run in CI by default (too slow). Run locally before:
- Merging security-critical changes
- Releasing new versions
- Refactoring core business logic

## Troubleshooting

### Mutation tests timeout
Increase `timeoutMS` in `stryker.config.json`:
```json
{
  "timeoutMS": 120000  // 2 minutes
}
```

### Too many mutations
Reduce concurrency or target fewer files:
```json
{
  "concurrency": 2  // Lower = slower but less memory
}
```

### False positives (equivalent mutants)
Some mutations don't change behavior. Mark them as ignored in the HTML report or accept a score <100%.

## References

- [Stryker Mutator Documentation](https://stryker-mutator.io/)
- [Mutation Testing Best Practices](https://stryker-mutator.io/docs/mutation-testing-elements/supported-mutators/)
