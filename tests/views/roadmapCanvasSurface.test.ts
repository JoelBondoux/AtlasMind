import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The Roadmap canvas, asserted against the real webview source.
 *
 * The canvas draws third-party-ish text (roadmap items are hand-written, but so
 * is anything a colleague raised from the ideation board or an issue) into
 * markup, positions, SVG paths and tooltips. It also holds three pieces of state
 * that the host cannot see and therefore cannot be type-checked: which view is
 * showing, what the plan is filtered to, and whether a link is half-drawn.
 *
 * Everything here is a property that would still compile if it were broken.
 */

const WEBVIEW_SCRIPT = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
);

const HOST_PANEL = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
);

/** The canvas block: everything from its banner comment to the end of the file. */
function canvasSource(): string {
  const start = WEBVIEW_SCRIPT.indexOf('// ── Roadmap canvas ─');
  expect(start, 'the roadmap canvas block is missing from the webview script').toBeGreaterThan(-1);
  const end = WEBVIEW_SCRIPT.indexOf('// ── Documents (.md management)', start);
  return WEBVIEW_SCRIPT.slice(start, end === -1 ? undefined : end);
}

function namedFunction(name: string): string {
  const source = canvasSource();
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${name} is missing from the canvas block`).toBeGreaterThan(-1);
  const next = source.indexOf('\n  function ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe('everything drawn on the canvas is escaped', () => {
  const ESCAPED_FIELDS = [
    'node.text',
    'node.id',
    'node.branch',
    'node.itemId',
    'edge.from',
    'edge.to',
    'rule.label',
    'rule.detail',
    'column.label',
    'note',
  ];

  it('never interpolates an item field into markup raw', () => {
    const source = canvasSource();
    for (const field of ESCAPED_FIELDS) {
      const raw = new RegExp(`\\$\\{\\s*${field.replace('.', '\\.')}\\s*\\}`);
      expect(raw.test(source), `${field} is interpolated without escaping`).toBe(false);
    }
  });

  it('escapes the node title, which is hand-written text that reaches markup', () => {
    expect(namedFunction('renderRoadmapNode')).toContain('escapeHtml(node.text)');
  });

  it('escapes the SVG path and its tooltip', () => {
    const edge = namedFunction('renderRoadmapEdge');
    expect(edge).toContain('escapeAttr(path)');
    expect(edge).toContain('escapeHtml(title)');
  });

  it('escapes an edited node’s current values back into the form', () => {
    const editor = namedFunction('renderRoadmapNodeEditor');
    expect(editor).toContain('escapeHtml(node.text)');
    expect(editor).toContain("escapeAttr(node.branch || '')");
    expect(editor).toContain("escapeAttr(node.deadline || '')");
  });
});

describe('the canvas addresses nodes by id and never by content', () => {
  it('sends only an opaque node id with a move', () => {
    // The webview may name a node the host already published. It may not supply
    // the node's text, its position rules, or anything else the host would then
    // write to a tracked file on its word.
    const move = WEBVIEW_SCRIPT.slice(WEBVIEW_SCRIPT.indexOf("type: 'roadmapNodeMove'"));
    expect(move.slice(0, 200)).toContain('nodeId: finished.nodeId');
  });

  it('sends both ends of a link as ids parsed from a delimited payload', () => {
    const source = canvasSource();
    expect(WEBVIEW_SCRIPT).toContain("type: 'roadmapLinkCreate'");
    expect(source).not.toContain('innerHTML =');
  });
});

describe('the route filter is a way of looking, not a change', () => {
  it('is resolved from the snapshot the host already sent, with no message', () => {
    const filter = namedFunction('roadmapRouteFilter');
    expect(filter).not.toContain('postMessage');
    expect(filter).toContain('roadmapGraph().routes');
  });

  it('returns null for “show everything” so callers have one obvious branch', () => {
    expect(namedFunction('roadmapRouteFilter')).toContain('return null;');
  });

  it('never filters the delivered view — a record of what shipped is not a route', () => {
    expect(namedFunction('roadmapRouteFilter')).toContain("state.roadmapView === 'completed'");
  });
});

describe('a suggestion is visibly not part of the plan', () => {
  it('is drawn with its own dash pattern, weight and colour', () => {
    // One visual difference is easy to miss on a dense board, so the stylesheet
    // carries three.
    const rule = HOST_PANEL.slice(HOST_PANEL.indexOf('.rm-edge-suggested {'));
    const block = rule.slice(0, rule.indexOf('}'));
    expect(block).toContain('stroke-dasharray');
    expect(block).toContain('stroke-width');
    expect(block).toContain('stroke:');
  });

  it('offers accept and dismiss as separate acts', () => {
    const links = namedFunction('renderRoadmapNodeLinks');
    expect(links).toContain('roadmap-link-accept');
    expect(links).toContain('roadmap-link-dismiss');
  });

  it('says out loud that nothing about it is saved yet', () => {
    expect(canvasSource()).toContain('Nothing about them is saved until you accept one');
  });
});

describe('unmeasured values are never rendered as confident ones', () => {
  it('renders a missing deadline as “no deadline”, never as zero days', () => {
    const chip = namedFunction('renderRoadmapScheduleChip');
    expect(chip).toContain("'no deadline'");
  });

  it('says when a branch name could not be derived rather than showing an empty slot', () => {
    expect(namedFunction('renderRoadmapNode')).toContain('no branch name');
  });

  it('says an item predates the canvas rather than inventing a date it was added', () => {
    expect(namedFunction('describeRoadmapProvenance'))
      .toContain('no date on record');
  });

  it('shows the derived estimate as a placeholder, so the field reads as unset', () => {
    expect(namedFunction('renderRoadmapNodeEditor')).toContain("' (derived)'");
  });
});

describe('the editor distinguishes clearing a field from leaving it alone', () => {
  const save = (): string => namedFunction('saveRoadmapNodeEdits');

  it('sends null for a cleared deadline and a cleared estimate', () => {
    expect(save()).toContain("payload.deadline = deadlineEl.value.trim() === '' ? null");
    expect(save()).toContain('payload.estimateDays =');
    expect(save()).toContain('? null :');
  });

  it('does not promote an untouched derived branch into a declared one', () => {
    expect(save()).toContain('delete payload.branch;');
  });
});

describe('canvas state is dropped when it stops referring to anything', () => {
  const stateHandler = WEBVIEW_SCRIPT.slice(
    WEBVIEW_SCRIPT.indexOf("if (message.type === 'state')"),
    WEBVIEW_SCRIPT.indexOf("if (message.type === 'state')") + 2400,
  );

  it('clears local drag offsets on every snapshot', () => {
    // They exist only to cover a round trip. Keeping them would leave a position
    // that failed to save looking saved.
    expect(stateHandler).toContain('state.roadmapDragOffsets = {};');
  });

  it('clears a filter, a half-drawn link and an open editor pointing at a gone node', () => {
    expect(stateHandler).toContain('state.roadmapFocusNodeId = ');
    expect(stateHandler).toContain('state.roadmapLinkFrom = ');
    expect(stateHandler).toContain('state.roadmapEditingNodeId = ');
  });
});

describe('the host side', () => {
  it('refuses a link that would make the plan circular before saving it', () => {
    expect(HOST_PANEL).toContain('roadmapEdgeWouldCycle');
    expect(HOST_PANEL).toContain('would make the plan circular');
  });

  it('re-validates a node anchor rather than trusting the one the webview echoed', () => {
    expect(HOST_PANEL).toContain('/^[a-z0-9][a-z0-9-]{0,39}$/i.test(item.nodeId.trim())');
  });

  it('refuses an unusable branch name rather than correcting it into one', () => {
    expect(HOST_PANEL).toContain('is not a usable branch name');
  });

  it('will not overwrite a graph file written by a newer AtlasMind', () => {
    const open = HOST_PANEL.slice(HOST_PANEL.indexOf('private async openRoadmapGraphForWrite'));
    expect(open.slice(0, 2000)).toContain('read.preserveExisting');
  });

  it('takes an accepted suggestion’s rule from its own derivation, not from the message', () => {
    const accept = HOST_PANEL.slice(HOST_PANEL.indexOf('private async handleRoadmapLinkChange'));
    expect(accept.slice(0, 4000)).toContain('lastSuggestedRoadmapEdge');
  });
});
