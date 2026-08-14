import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The three places the framework decision reaches a person: the Scaffold
 * button's question, the two surfaces that name what is installed, and the
 * filter over the methodology matrix.
 *
 * Source-level, for the reason the sibling suites give — the webview script and
 * the host are different files in different languages, and there is no single
 * runtime that exercises both. What these catch is the mistake that actually
 * happens: a decision computed correctly and then not asked, not shown, or
 * silently defaulted at the call site.
 */
const ROOT = path.resolve(__dirname, '../..');
const SETTINGS = readFileSync(path.join(ROOT, 'src/views/settingsPanel.ts'), 'utf8');
const WEBVIEW = readFileSync(path.join(ROOT, 'media/projectDashboard.js'), 'utf8');
const SCAFFOLDER = readFileSync(path.join(ROOT, 'src/core/testingScaffolder.ts'), 'utf8');

describe('the framework question is asked before anything is written', () => {
  it('reads the plan before the confirmation dialog', () => {
    const planAt = SETTINGS.indexOf('detectScaffoldFrameworks(workspaceRoot)');
    const confirmAt = SETTINGS.indexOf("'Scaffold the testing framework for the enabled methodologies?");
    expect(planAt, 'the scaffold handler never reads the framework plan').toBeGreaterThan(-1);
    expect(confirmAt).toBeGreaterThan(-1);
    expect(planAt, 'the plan is read after the confirmation, which is too late').toBeLessThan(confirmAt);
  });

  it('asks only when the plan says to', () => {
    // A question on every scaffold would be noise; the plan already answers
    // itself whenever the project uses a runner or its shape implies one.
    expect(SETTINGS).toContain("if (choice.status !== 'ask'");
  });

  it('cancels the scaffold when the question is dismissed', () => {
    // Falling through to a default here is exactly the behaviour the question
    // exists to remove.
    expect(SETTINGS).toMatch(/if \(!picked\) \{[\s\S]{0,400}?return;/);
  });

  it('passes the answer through to the scaffolder', () => {
    expect(SETTINGS).toContain('scaffoldTestingFramework(workspaceRoot, config, override)');
    expect(SCAFFOLDER).toContain('override?.unit ?? frameworks.unit.framework');
  });

  it('tells the user which runner it is about to use, and why', () => {
    // "Vitest because the project already uses it" and "Vitest because this is
    // a Vite project" are different claims; only the second is a suggestion
    // worth arguing with, so the dialog carries the rule.
    expect(SETTINGS).toContain('describeFrameworkDecision(frameworkPlan, override)');
    expect(SETTINGS).toContain('plan.unit.rule');
  });

  it('states what it will not install', () => {
    expect(SETTINGS).toMatch(/two runners/);
  });
});

describe('both surfaces name every framework, not just one', () => {
  it('carries the full list on the snapshot', () => {
    expect(SETTINGS).toContain('detectedFrameworks({');
    expect(SETTINGS).toMatch(/frameworks\?: \{ id: string; label: string; role: 'unit' \| 'e2e' \}\[\];/);
  });

  it('pluralises the settings card when there is more than one', () => {
    expect(SETTINGS).toContain("(snapshot.frameworks ?? []).length > 1 ? 'Frameworks' : 'Framework'");
  });

  it('pluralises the dashboard card when there is more than one', () => {
    expect(WEBVIEW).toContain("frameworks.length > 1 ? 'Frameworks' : 'Framework'");
  });

  it('falls back to the single label rather than rendering nothing', () => {
    // A project whose manifest could not be read still has a label. An empty
    // card would read as "no framework" rather than "we could not tell".
    expect(SETTINGS).toContain(': snapshot.frameworkLabel,');
    expect(WEBVIEW).toContain(': testing.frameworkLabel,');
  });
});

describe('the methodology matrix can be filtered', () => {
  it('renders a search box above the table', () => {
    const searchAt = SETTINGS.indexOf('id="methodologySearch"');
    const tableAt = SETTINGS.indexOf('class="methodology-table-wrapper"');
    expect(searchAt).toBeGreaterThan(-1);
    expect(searchAt, 'the search box renders below the table it filters').toBeLessThan(tableAt);
  });

  it('derives the count in the placeholder rather than hardcoding it', () => {
    // A literal here goes stale the moment a methodology is added, and there is
    // a standing check in `testingMethodologyCopy.test.ts` for exactly that.
    expect(SETTINGS).toContain('Filter ${TESTING_METHODOLOGY_DEFINITIONS.length} methodologies');
  });

  it('gives every row a searchable haystack', () => {
    expect(SETTINGS).toContain('data-search=');
    // Name, id, category and description — filtering on the label alone makes
    // the box useless for "which of these covers contracts?".
    expect(SETTINGS).toMatch(/\$\{def\.label\} \$\{def\.id\} \$\{def\.category\} \$\{def\.description\}/);
  });

  it('hides rows rather than re-rendering the table', () => {
    // The matrix is a form. Rebuilding it would discard a half-typed note or a
    // dropdown the user had open.
    expect(SETTINGS).toContain("row.classList.toggle('is-filtered-out', !match)");
    expect(SETTINGS).toContain('.methodology-row.is-filtered-out { display: none; }');
  });

  it('hides a category heading whose rows are all filtered out', () => {
    // A heading with nothing under it reads as an empty section rather than a
    // filtered one.
    expect(SETTINGS).toContain("group.classList.toggle('is-filtered-out', !visible)");
    expect(SETTINGS).toContain('.methodology-category-group.is-filtered-out { display: none; }');
  });

  it('reports how many matched', () => {
    expect(SETTINGS).toMatch(/of ' \+ rows\.length \+ ' shown/);
  });

  it('clears on Escape without closing the panel', () => {
    // Escape in a filter box clears it; letting it bubble would close the
    // surrounding surface instead, which is not what the key means here.
    expect(SETTINGS).toContain('event.stopPropagation()');
  });
});

describe('the scaffolder generates for the resolved runner', () => {
  it('no longer hardcodes a Vitest import in its templates', () => {
    // 40 templates opened `import … from 'vitest'` regardless of the project.
    expect(SCAFFOLDER).not.toContain("import { describe, it, expect } from 'vitest';");
  });

  it('renders the header from the resolved framework', () => {
    expect(SCAFFOLDER).toContain('function testHeaderLine(stack: DetectedStack)');
    expect(SCAFFOLDER).toContain('frameworkHeader(framework)');
  });

  it('takes its install command from the framework, not a two-way guess', () => {
    expect(SCAFFOLDER).toContain('installCommandFor(stack.recommendedRunner)');
    expect(SCAFFOLDER).not.toContain("? 'npm install -D vitest' : 'npm install -D jest'");
  });
});
