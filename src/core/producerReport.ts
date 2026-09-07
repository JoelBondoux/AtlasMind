/**
 * The project's status, as a document somebody without VS Code can read.
 *
 * This is the fix for the project manager's structural problem: everything good
 * about it — the plan, the risks and their recorded decisions, delivery
 * readiness, what the work has cost — is invisible to a producer, a client or a
 * technical director, because they do not have the editor open. A panel is the
 * wrong container for an audience that is not in the panel.
 *
 * Three layers, separated on purpose: **gather** (the caller reads the managers)
 * → **model** (`ProducerReportData`, a plain object) → **render** (markdown, and
 * a self-contained HTML page). The model is emitted alongside the rendered
 * document so a GitHub Pages portal can consume it later without this being
 * rebuilt — the difference between a portal being a renderer and a portal being
 * a rewrite. It also gives an MCP roadmap server something to serve without a
 * second gatherer.
 *
 * Four rules.
 *
 * **No model output anywhere in this path.** The same project state produces a
 * byte-identical report. A generated status summary is a claim nobody checked,
 * written into a committed file, attributed to the project — and this document
 * is the one most likely to be forwarded to somebody who cannot check it. The
 * clock is injected for the same reason: `new Date()` inside would make the
 * output differ on every run and drown a real change in noise.
 *
 * **A section that could not be gathered says so.** Every input is optional and
 * absent means *not assessed*, never *nothing to report*. Omitting an
 * unavailable section would let a report about a project with eleven open risks
 * look identical to one about a project with none, which is the specific way a
 * status document becomes worse than no status document.
 *
 * **Nothing here decides what may be published.** The renderers take what they
 * are given. Which sections are safe to put at a public URL is the caller's
 * decision, made against repository visibility, and keeping that out of here
 * means a section cannot leak by being added to the model.
 *
 * **The HTML is one file with no network dependencies.** It has to open from
 * disk, from an email attachment, from a USB stick — anywhere the person who
 * needs it actually is.
 */

import { escapeHtml } from '../views/webviewUtils.js';

export interface ProducerReportGateProgress {
  gate: string;
  total: number;
  delivered: number;
}

export interface ProducerReportRisk {
  title: string;
  severity: string;
  status: string;
  /** The recorded human decision, when one has been made. */
  decision?: string;
}

export interface ProducerReportDeliveryStage {
  name: string;
  ready: boolean;
  /** Why it is not ready, when it is not. */
  blockedBy?: string;
}

export interface ProducerReportCostLine {
  label: string;
  costUsd: number;
  /** Absent when the item carries no estimate — never rendered as zero. */
  estimateUsd?: number;
  /** True when every attributed request was inferred from a session rather than stated. */
  inferred?: boolean;
  /**
   * Requests in this line whose model had no known price.
   *
   * Rendered beside the figure, because a total that silently includes
   * placeholder zeros is a understatement presented as a measurement.
   */
  unpricedRequestCount?: number;
}

/**
 * What the caller managed to gather.
 *
 * Every field optional, and the optionality is the contract: `undefined` means
 * "not assessed" and renders as a stated gap. A caller must not substitute an
 * empty array for data it failed to read — `[]` means *looked, found none*.
 */
export interface ProducerReportInput {
  projectName: string;
  generatedAt: Date;
  version?: string;
  gates?: readonly ProducerReportGateProgress[];
  risks?: readonly ProducerReportRisk[];
  delivery?: readonly ProducerReportDeliveryStage[];
  cost?: {
    lines: readonly ProducerReportCostLine[];
    unattributedCostUsd: number;
    totalCostUsd: number;
    /**
     * How old the prices behind these figures are.
     *
     * Carried on the data rather than left to the renderer, because a reader who
     * cannot tell whether a cost was priced last week or last year cannot judge
     * it — and a footnote a surface may forget is not the same as a value it has
     * to decide to hide.
     */
    pricingNote?: string;
  };
}

export type ProducerReportSectionState = 'reported' | 'empty' | 'not-assessed';

export interface ProducerReportSection<T> {
  state: ProducerReportSectionState;
  entries: readonly T[];
}

/**
 * The portal's contract. Deliberately a plain object with no rendering in it.
 */
export interface ProducerReportData {
  schemaVersion: 1;
  projectName: string;
  generatedAt: string;
  version?: string;
  gates: ProducerReportSection<ProducerReportGateProgress>;
  risks: ProducerReportSection<ProducerReportRisk>;
  delivery: ProducerReportSection<ProducerReportDeliveryStage>;
  cost: {
    state: ProducerReportSectionState;
    lines: readonly ProducerReportCostLine[];
    unattributedCostUsd?: number;
    totalCostUsd?: number;
    pricingNote?: string;
  };
}

function sectionFor<T>(entries: readonly T[] | undefined): ProducerReportSection<T> {
  if (entries === undefined) { return { state: 'not-assessed', entries: [] }; }
  return { state: entries.length === 0 ? 'empty' : 'reported', entries };
}

/** The model. Pure, and the only place the shape is decided. */
export function buildProducerReportData(input: ProducerReportInput): ProducerReportData {
  return {
    schemaVersion: 1,
    projectName: input.projectName,
    generatedAt: input.generatedAt.toISOString(),
    ...(input.version ? { version: input.version } : {}),
    gates: sectionFor(input.gates),
    risks: sectionFor(input.risks),
    delivery: sectionFor(input.delivery),
    cost: input.cost === undefined
      ? { state: 'not-assessed', lines: [] }
      : {
          state: input.cost.lines.length === 0 ? 'empty' : 'reported',
          lines: input.cost.lines,
          unattributedCostUsd: input.cost.unattributedCostUsd,
          totalCostUsd: input.cost.totalCostUsd,
          ...(input.cost.pricingNote ? { pricingNote: input.cost.pricingNote } : {}),
        },
  };
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * The sentence an unavailable section gets.
 *
 * One wording, used everywhere, because a reader has to be able to tell "we
 * looked and there is nothing" from "nobody looked" at a glance — and two
 * different phrasings for the same state would blur exactly that.
 */
const NOT_ASSESSED = '_Not assessed — this section could not be read when the report was generated._';
const NONE_FOUND = '_None recorded._';

function sectionNote(state: ProducerReportSectionState): string | undefined {
  if (state === 'not-assessed') { return NOT_ASSESSED; }
  if (state === 'empty') { return NONE_FOUND; }
  return undefined;
}

/** Markdown. Byte-identical for the same data. */
export function renderProducerReportMarkdown(data: ProducerReportData): string {
  const lines: string[] = [];
  lines.push(`# ${data.projectName} — project status`);
  lines.push('');
  lines.push(`Generated ${data.generatedAt}${data.version ? ` · version ${data.version}` : ''}.`);
  lines.push('');

  lines.push('## Roadmap progress by gate');
  lines.push('');
  const gateNote = sectionNote(data.gates.state);
  if (gateNote) {
    lines.push(gateNote);
  } else {
    lines.push('| Gate | Delivered | Total |');
    lines.push('|---|---|---|');
    for (const gate of data.gates.entries) {
      lines.push(`| ${gate.gate} | ${gate.delivered} | ${gate.total} |`);
    }
  }
  lines.push('');

  lines.push('## Open risks');
  lines.push('');
  const riskNote = sectionNote(data.risks.state);
  if (riskNote) {
    lines.push(riskNote);
  } else {
    for (const risk of data.risks.entries) {
      lines.push(`- **${risk.title}** — ${risk.severity}, ${risk.status}.`
        + (risk.decision ? ` Decision: ${risk.decision}` : ' No decision recorded.'));
    }
  }
  lines.push('');

  lines.push('## Delivery readiness');
  lines.push('');
  const deliveryNote = sectionNote(data.delivery.state);
  if (deliveryNote) {
    lines.push(deliveryNote);
  } else {
    for (const stage of data.delivery.entries) {
      lines.push(`- **${stage.name}** — ${stage.ready ? 'ready' : `not ready${stage.blockedBy ? `: ${stage.blockedBy}` : ''}`}`);
    }
  }
  lines.push('');

  lines.push('## Cost against estimate');
  lines.push('');
  const costNote = sectionNote(data.cost.state);
  if (costNote) {
    lines.push(costNote);
  } else {
    lines.push('| Item | Spent | Estimate |');
    lines.push('|---|---|---|');
    for (const line of data.cost.lines) {
      // An absent estimate is a dash, never `$0.00` — a zero would report every
      // unestimated item as catastrophically over budget.
      const notes = [
        line.inferred ? '*(inferred)*' : '',
        line.unpricedRequestCount ? `*(${line.unpricedRequestCount} unpriced)*` : '',
      ].filter(Boolean).join(' ');
      lines.push(`| ${line.label}${notes ? ` ${notes}` : ''} | ${money(line.costUsd)} | ${line.estimateUsd === undefined ? '—' : money(line.estimateUsd)} |`);
    }
    if (data.cost.unattributedCostUsd !== undefined && data.cost.unattributedCostUsd > 0) {
      lines.push('');
      lines.push(`Unattributed spend: **${money(data.cost.unattributedCostUsd)}** of ${money(data.cost.totalCostUsd ?? 0)} total. `
        + 'Reported separately rather than divided across items, because a distributed figure cannot be told from a measured one.');
    }
    if (data.cost.pricingNote) {
      lines.push('');
      lines.push(`_${data.cost.pricingNote}_`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * A single self-contained HTML file.
 *
 * No stylesheet link, no script, no font, no image — it has to render from a
 * local file, an email attachment or a memory stick, which is precisely where
 * the person who needs it will open it. Everything interpolated is escaped:
 * risk titles and roadmap item text are user- and import-authored, and this
 * document is the one most likely to be sent to somebody else.
 */
export function renderProducerReportHtml(data: ProducerReportData): string {
  const parts: string[] = [];
  const esc = escapeHtml;

  parts.push('<!doctype html>');
  parts.push('<html lang="en"><head><meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push(`<title>${esc(data.projectName)} — project status</title>`);
  parts.push('<style>'
    + ':root{color-scheme:light dark}'
    + 'body{margin:0;padding:2rem;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;max-width:60rem}'
    + 'h1{font-size:1.6rem;margin:0 0 .25rem}h2{font-size:1.15rem;margin:2rem 0 .5rem}'
    + '.meta{opacity:.7;font-size:.9rem}'
    + 'table{border-collapse:collapse;width:100%;margin:.5rem 0}'
    + 'th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid rgba(128,128,128,.35)}'
    + '.gap{opacity:.75;font-style:italic}'
    + 'ul{padding-left:1.2rem}'
    + '.wrap{overflow-x:auto}'
    + '</style></head><body>');

  parts.push(`<h1>${esc(data.projectName)} — project status</h1>`);
  parts.push(`<p class="meta">Generated ${esc(data.generatedAt)}${data.version ? ` · version ${esc(data.version)}` : ''}.</p>`);

  parts.push('<h2>Roadmap progress by gate</h2>');
  if (data.gates.state !== 'reported') {
    parts.push(`<p class="gap">${esc(data.gates.state === 'not-assessed' ? 'Not assessed — this section could not be read when the report was generated.' : 'None recorded.')}</p>`);
  } else {
    parts.push('<div class="wrap"><table><thead><tr><th>Gate</th><th>Delivered</th><th>Total</th></tr></thead><tbody>');
    for (const gate of data.gates.entries) {
      parts.push(`<tr><td>${esc(gate.gate)}</td><td>${gate.delivered}</td><td>${gate.total}</td></tr>`);
    }
    parts.push('</tbody></table></div>');
  }

  parts.push('<h2>Open risks</h2>');
  if (data.risks.state !== 'reported') {
    parts.push(`<p class="gap">${esc(data.risks.state === 'not-assessed' ? 'Not assessed — this section could not be read when the report was generated.' : 'None recorded.')}</p>`);
  } else {
    parts.push('<ul>');
    for (const risk of data.risks.entries) {
      parts.push(`<li><strong>${esc(risk.title)}</strong> — ${esc(risk.severity)}, ${esc(risk.status)}. `
        + `${risk.decision ? `Decision: ${esc(risk.decision)}` : 'No decision recorded.'}</li>`);
    }
    parts.push('</ul>');
  }

  parts.push('<h2>Delivery readiness</h2>');
  if (data.delivery.state !== 'reported') {
    parts.push(`<p class="gap">${esc(data.delivery.state === 'not-assessed' ? 'Not assessed — this section could not be read when the report was generated.' : 'None recorded.')}</p>`);
  } else {
    parts.push('<ul>');
    for (const stage of data.delivery.entries) {
      parts.push(`<li><strong>${esc(stage.name)}</strong> — `
        + `${stage.ready ? 'ready' : `not ready${stage.blockedBy ? `: ${esc(stage.blockedBy)}` : ''}`}</li>`);
    }
    parts.push('</ul>');
  }

  parts.push('<h2>Cost against estimate</h2>');
  if (data.cost.state !== 'reported') {
    parts.push(`<p class="gap">${esc(data.cost.state === 'not-assessed' ? 'Not assessed — this section could not be read when the report was generated.' : 'None recorded.')}</p>`);
  } else {
    parts.push('<div class="wrap"><table><thead><tr><th>Item</th><th>Spent</th><th>Estimate</th></tr></thead><tbody>');
    for (const line of data.cost.lines) {
      parts.push(`<tr><td>${esc(line.label)}${line.inferred ? ' <em>(inferred)</em>' : ''}</td>`
        + `<td>${esc(money(line.costUsd))}</td>`
        + `<td>${line.estimateUsd === undefined ? '—' : esc(money(line.estimateUsd))}</td></tr>`);
    }
    parts.push('</tbody></table></div>');
    if (data.cost.unattributedCostUsd !== undefined && data.cost.unattributedCostUsd > 0) {
      parts.push(`<p>Unattributed spend: <strong>${esc(money(data.cost.unattributedCostUsd))}</strong> of `
        + `${esc(money(data.cost.totalCostUsd ?? 0))} total. Reported separately rather than divided across items, `
        + 'because a distributed figure cannot be told from a measured one.</p>');
    }
    if (data.cost.pricingNote) {
      parts.push(`<p class="gap">${esc(data.cost.pricingNote)}</p>`);
    }
  }

  parts.push('</body></html>');
  return parts.join('\n');
}

export interface ProducerReportArtifacts {
  data: ProducerReportData;
  markdown: string;
  html: string;
  json: string;
}

/** Everything at once, which is how the caller writes it out. */
export function buildProducerReport(input: ProducerReportInput): ProducerReportArtifacts {
  const data = buildProducerReportData(input);
  return {
    data,
    markdown: renderProducerReportMarkdown(data),
    html: renderProducerReportHtml(data),
    json: `${JSON.stringify(data, null, 2)}\n`,
  };
}
