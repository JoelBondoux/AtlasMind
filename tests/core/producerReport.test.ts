import { describe, expect, it } from 'vitest';
import {
  buildProducerReport,
  buildProducerReportData,
  renderProducerReportHtml,
  renderProducerReportMarkdown,
  type ProducerReportInput,
} from '../../src/core/producerReport.js';

const AT = new Date('2026-09-07T12:00:00.000Z');

function input(overrides: Partial<ProducerReportInput> = {}): ProducerReportInput {
  return { projectName: 'AtlasMind', generatedAt: AT, ...overrides };
}

describe('the same project state produces the same report', () => {
  it('is byte-identical across runs', () => {
    const first = buildProducerReport(input({ gates: [{ gate: 'mvp', total: 10, delivered: 4 }] }));
    const second = buildProducerReport(input({ gates: [{ gate: 'mvp', total: 10, delivered: 4 }] }));
    expect(first.markdown).toBe(second.markdown);
    expect(first.html).toBe(second.html);
    expect(first.json).toBe(second.json);
  });

  it('takes its timestamp from the caller rather than the clock', () => {
    const data = buildProducerReportData(input());
    expect(data.generatedAt).toBe('2026-09-07T12:00:00.000Z');
  });
});

/**
 * The rule that decides whether this document is worth forwarding. A report
 * about a project with eleven open risks must not look identical to one about a
 * project whose risk register could not be read.
 */
describe('a section that could not be gathered says so', () => {
  it('separates not-assessed from empty in the model', () => {
    expect(buildProducerReportData(input()).risks.state).toBe('not-assessed');
    expect(buildProducerReportData(input({ risks: [] })).risks.state).toBe('empty');
    expect(buildProducerReportData(input({ risks: [{ title: 'x', severity: 'high', status: 'open' }] })).risks.state)
      .toBe('reported');
  });

  it('renders both states visibly, and differently, in markdown', () => {
    const notAssessed = renderProducerReportMarkdown(buildProducerReportData(input()));
    const empty = renderProducerReportMarkdown(buildProducerReportData(input({
      gates: [], risks: [], delivery: [], cost: { lines: [], unattributedCostUsd: 0, totalCostUsd: 0 },
    })));
    expect(notAssessed).toMatch(/Not assessed/);
    expect(empty).toMatch(/None recorded/);
    expect(empty).not.toMatch(/Not assessed/);
  });

  it('never omits a section merely because it has no data', () => {
    const markdown = renderProducerReportMarkdown(buildProducerReportData(input()));
    for (const heading of ['Roadmap progress by gate', 'Open risks', 'Delivery readiness', 'Cost against estimate']) {
      expect(markdown).toContain(heading);
    }
  });
});

describe('cost is reported honestly', () => {
  it('shows a dash rather than zero for an item with no estimate', () => {
    const markdown = renderProducerReportMarkdown(buildProducerReportData(input({
      cost: { lines: [{ label: 'Item A', costUsd: 12.5 }], unattributedCostUsd: 0, totalCostUsd: 12.5 },
    })));
    expect(markdown).toContain('$12.50');
    expect(markdown).toMatch(/\|\s*—\s*\|/);
    expect(markdown).not.toContain('$0.00');
  });

  it('reports unattributed spend rather than folding it into items', () => {
    const markdown = renderProducerReportMarkdown(buildProducerReportData(input({
      cost: { lines: [{ label: 'Item A', costUsd: 4 }], unattributedCostUsd: 6, totalCostUsd: 10 },
    })));
    expect(markdown).toContain('Unattributed spend');
    expect(markdown).toContain('$6.00');
  });

  it('marks an inferred attribution as such', () => {
    const markdown = renderProducerReportMarkdown(buildProducerReportData(input({
      cost: { lines: [{ label: 'Item A', costUsd: 4, inferred: true }], unattributedCostUsd: 0, totalCostUsd: 4 },
    })));
    expect(markdown).toContain('inferred');
  });
});

describe('the HTML opens from disk and is safe to forward', () => {
  it('carries no external resource of any kind', () => {
    const html = renderProducerReportHtml(buildProducerReportData(input({
      gates: [{ gate: 'mvp', total: 3, delivered: 1 }],
    })));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<img/i);
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  /**
   * Risk titles and roadmap text can be imported from third-party trackers, and
   * this document is the one most likely to be sent to somebody else.
   */
  it('escapes text that came from outside the project', () => {
    const html = renderProducerReportHtml(buildProducerReportData(input({
      projectName: '<img src=x onerror=alert(1)>',
      risks: [{ title: '</td><script>alert(1)</script>', severity: 'high', status: 'open' }],
    })));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('states a missing decision rather than leaving the risk looking handled', () => {
    const html = renderProducerReportHtml(buildProducerReportData(input({
      risks: [{ title: 'Vendor lock-in', severity: 'medium', status: 'open' }],
    })));
    expect(html).toContain('No decision recorded');
  });
});

describe('the model is emitted for a portal to consume', () => {
  it('is versioned and parses back to the same object', () => {
    const artifacts = buildProducerReport(input({ gates: [{ gate: 'mvp', total: 2, delivered: 2 }] }));
    const parsed = JSON.parse(artifacts.json) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed).toEqual(artifacts.data);
  });
});
