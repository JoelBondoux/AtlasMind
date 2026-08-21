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
    WEBVIEW_SCRIPT.indexOf('function applyStateSnapshot'),
    WEBVIEW_SCRIPT.indexOf('function applyStateSnapshot') + 3600,
  );

  it('holds a snapshot that arrives mid-drag instead of swapping the DOM under the pointer', () => {
    // Applying it would remove the element holding the pointer capture, which
    // ends the drag — so a background refresh could eat a gesture in flight.
    // The drag's own end applies the last snapshot held.
    const listener = WEBVIEW_SCRIPT.slice(
      WEBVIEW_SCRIPT.indexOf("if (message.type === 'state')"),
      WEBVIEW_SCRIPT.indexOf("if (message.type === 'state')") + 900,
    );
    expect(listener).toContain('pendingStateMessage = message;');
    expect(WEBVIEW_SCRIPT).toContain("applyStateSnapshot(deferred, movedNode ? finished.nodeId : '');");
  });

  it('clears local drag offsets on every snapshot, except a node whose drop is still in flight', () => {
    // They exist only to cover a round trip, so keeping them would leave a
    // position that failed to save looking saved. The one exception is a node
    // that was just dropped when the snapshot being applied was deferred
    // during its drag: the snapshot predates the drop, and the host's answer
    // to the drop is still on its way — clearing that one yanked a
    // just-dropped node back to where it was.
    expect(stateHandler).toContain(
      'state.roadmapDragOffsets = preserveOffsetNodeId && state.roadmapDragOffsets[preserveOffsetNodeId]',
    );
    expect(stateHandler).toContain(': {};');
  });

  it('clears a filter, a half-drawn link and an open editor pointing at a gone node', () => {
    expect(stateHandler).toContain('state.roadmapFocusNodeId = ');
    expect(stateHandler).toContain('state.roadmapLinkFrom = ');
    expect(stateHandler).toContain('state.roadmapEditingNodeId = ');
  });
});

describe('a drag always ends, wherever the button comes up', () => {
  // The canvas became permanently unresponsive after a while, and the cause was
  // a drag that never ended: `pointerup` and `pointercancel` were bound to
  // `root`, so a release over the editor tab strip, past the edge of the
  // webview, or after a host re-render removed the element holding the pointer
  // capture, left `rmDrag` set for ever. Every later pointer move then panned or
  // dragged, and nothing could be clicked.

  it('listens for the release on the window, not only on the canvas root', () => {
    expect(WEBVIEW_SCRIPT).toContain("window.addEventListener('pointerup', rmEndDrag);");
    expect(WEBVIEW_SCRIPT).toContain("window.addEventListener('pointercancel', rmEndDrag);");
    expect(WEBVIEW_SCRIPT).not.toContain("root?.addEventListener('pointerup', rmEndDrag);");
  });

  it('ends the drag when the DOM is swapped out from under it', () => {
    // The innerHTML re-render on every host refresh removes the capturing
    // element, which releases capture implicitly and leaves no pointerup that
    // could be attributed to the drag.
    expect(WEBVIEW_SCRIPT).toContain("root?.addEventListener('lostpointercapture', rmEndDrag);");
  });

  it('ends the drag when the window loses focus mid-drag', () => {
    // An alt-tab away never delivers the release at all.
    expect(WEBVIEW_SCRIPT).toContain("window.addEventListener('blur', rmEndDrag);");
  });

  it('never re-fits the canvas while a drag is in flight', () => {
    // Fitting rewrites pan and zoom, which would move the world out from under
    // the pointer halfway through a drag.
    expect(WEBVIEW_SCRIPT).toContain('state.roadmapFitAfterRender && !rmDrag');
  });
});

describe('who is doing it', () => {
  it('offers the roster in the node editor, and nothing else', () => {
    // The list comes from the Director roster shipped on the snapshot. A free
    // text field would let somebody assign work to a name no other surface
    // knows about, which the by-person view could only render as a lane nobody
    // could resolve.
    expect(WEBVIEW_SCRIPT).toContain('data-rm-field="assigneeId"');
    expect(WEBVIEW_SCRIPT).toContain('(graph.people || []).map(person =>');
    expect(WEBVIEW_SCRIPT).toContain('No people are on the Project Director roster yet');
  });

  it('keeps an assignment to somebody no longer on the roster selectable', () => {
    // Otherwise opening the editor on that node would silently reassign it to
    // "Unassigned" the moment somebody pressed Save.
    expect(WEBVIEW_SCRIPT).toContain('Not in the roster');
  });

  it('sends null to unassign, and never omits the field to mean it', () => {
    // Omitting means "leave it alone", so clearing has to be its own value.
    const save = WEBVIEW_SCRIPT.slice(WEBVIEW_SCRIPT.indexOf('function saveRoadmapNodeEdits'));
    expect(save.slice(0, 2400)).toContain("payload.assigneeId = assigneeEl.value === '' ? null : assigneeEl.value;");
  });

  it('validates the contact id against the roster in the host, never trusts the page', () => {
    expect(HOST_PANEL).toContain('knownContactIds.has(candidate)');
    expect(HOST_PANEL).toContain('readProjectDirectorConfig(context.workspaceRoot)?.contacts');
  });

  it('separates who is doing it from who raised or finished it', () => {
    // Three different facts, and only one of them can be wrong about the future.
    expect(WEBVIEW_SCRIPT).toContain('rm-chip-assignee');
    expect(WEBVIEW_SCRIPT).toContain('node.completedBy ? ');
    expect(WEBVIEW_SCRIPT).toContain('rm-chip-unassigned');
  });

  it('does not nag about assigning work that is already delivered', () => {
    expect(WEBVIEW_SCRIPT).toContain("(node.completed ? '' : '<span class=\"rm-chip rm-chip-unassigned\"");
  });
});

describe('the by-person view', () => {
  it('is a fourth view, counted by people rather than by items', () => {
    // The number that makes this view worth opening is how many people the plan
    // is spread across, which an item count hides.
    expect(WEBVIEW_SCRIPT).toContain("['people', 'By person'");
    expect(WEBVIEW_SCRIPT).toContain('people: (graph.lanes || []).length,');
  });

  it('draws the lanes the host laid out, not lanes measured from the nodes on screen', () => {
    // A band inferred from where nodes happen to sit collapses to nothing for a
    // person with no work — and "nobody is doing this" is exactly what somebody
    // opens this view to find out.
    const bands = namedFunction('renderRoadmapLaneBands');
    expect(bands).toContain('graph.lanes || []');
    expect(bands).toContain("state.roadmapView !== 'people'");
    expect(bands).toContain('lane.offset');
    expect(bands).toContain('lane.extent');
  });

  it('shows an unresolved lane as its own thing, never folded into unassigned', () => {
    const bands = namedFunction('renderRoadmapLaneBands');
    expect(bands).toContain('is-unresolved');
    expect(bands).toContain('is-unassigned');
    expect(HOST_PANEL).toContain('.rm-chip-assignee.is-unresolved');
  });

  it('fits the canvas when the view changes, because every node moves', () => {
    expect(WEBVIEW_SCRIPT).toContain("state.roadmapFitAfterRender = state.roadmapView !== 'list';");
  });

  it('is laid out host-side and shipped, so switching to it is offline', () => {
    expect(HOST_PANEL).toContain('layoutRoadmapByAssignee(partition.active, people, graph.orientation)');
    expect(HOST_PANEL).toContain('byPerson: byPerson.nodes,');
    expect(HOST_PANEL).toContain('lanes: byPerson.lanes,');
  });

  it('falls back to the plain plan on a snapshot with no lanes', () => {
    expect(WEBVIEW_SCRIPT).toContain('return graph.byPerson || graph.active;');
  });
});

describe('importing somebody else‘s roadmap', () => {
  it('asks for the flow with no payload, so the page can never name a file to read', () => {
    // The source, the glob, the file and the column mapping are all gathered by
    // the host through the editor's own pickers.
    expect(WEBVIEW_SCRIPT).toContain('data-action="roadmap-import"');
    expect(WEBVIEW_SCRIPT).toContain("vscode.postMessage({ type: 'importRoadmap' });");
    expect(WEBVIEW_SCRIPT).not.toMatch(/type: 'importRoadmap', payload/);
    expect(HOST_PANEL).toContain("| { type: 'importRoadmap' }");
  });

  it('shows what would change before writing anything', () => {
    expect(HOST_PANEL).toContain('describeRoadmapImportDetail(plan)');
    expect(HOST_PANEL).toContain("'Import them',");
    // And returns early when there is nothing to write, rather than asking to
    // confirm a no-op.
    expect(HOST_PANEL).toContain('if (plan.counts.add === 0 && plan.counts.update === 0)');
  });

  it('names what it would leave alone, not just what it would add', () => {
    // "42 to add" is true and useless: what it would leave alone and what it
    // could not read are exactly what a count of additions omits.
    expect(HOST_PANEL).toContain('Changed on both sides — left alone');
    expect(HOST_PANEL).toContain('No longer in the source — left on the roadmap');
    expect(HOST_PANEL).toContain('Nothing on this roadmap is deleted by an import.');
  });

  it('writes the backlog before the overlay, and only for add and update', () => {
    // The overlay is meaningless without the line it points at, and a conflict
    // or a missing entry produces no write of any kind.
    const apply = HOST_PANEL.slice(HOST_PANEL.indexOf('private async applyRoadmapImport'));
    expect(apply.slice(0, 3000)).toContain('serializeDashboardRoadmapDocument');
    expect(apply.slice(0, 3000)).toContain("entry.outcome !== 'add' && entry.outcome !== 'update'");
    expect(apply.slice(0, 3000)).toContain('importRecordFor(read, item, stamped)');
  });

  it('reuses the issue list already read rather than fetching a second copy', () => {
    expect(HOST_PANEL).toContain('No issues have been read yet');
    expect(HOST_PANEL).toContain('parseGithubIssueRoadmapItems(');
  });

  it('asks which project columns mean finished rather than assuming "Done"', () => {
    expect(HOST_PANEL).toContain('Which columns mean the work is finished?');
    expect(HOST_PANEL).toContain('collectProjectStatuses(parsed)');
  });

  it('asks which spreadsheet column holds the item rather than taking the first', () => {
    expect(HOST_PANEL).toContain('Which column holds the item?');
    expect(HOST_PANEL).toContain('suggestSpreadsheetMapping(headers)');
  });

  it('validates a GitHub owner and project number before spending a call', () => {
    expect(HOST_PANEL).toContain('That is not a valid GitHub owner name');
    expect(HOST_PANEL).toContain('A project number is a positive whole number');
  });
});

describe('the Calculate tree control can be found by the name the canvas gives it', () => {
  it('shows its label, which the shared icon-only rule clips away', () => {
    // The flat-plan notice tells you to press "Calculate tree". The shared Atlas
    // action styling hides the label in a screen-reader-only rectangle, so the
    // button rendered as a mark and a glyph with no text — naming a control
    // whose name is invisible is worse than naming none.
    expect(HOST_PANEL).toContain('.rm-derive-action.icon-only .atlas-discuss-label {');
    expect(WEBVIEW_SCRIPT).toContain('<span class="atlas-discuss-label">Calculate tree</span>');
  });
});

describe('arranging is separated from changing', () => {
  it('keeps fit and snap entirely in the webview — they change no plan', () => {
    expect(namedFunction('fitRoadmapCanvas')).not.toContain('postMessage');
    expect(namedFunction('rmSnap')).not.toContain('postMessage');
  });

  it('mirrors the host’s grid constant, and the layout is a multiple of it', () => {
    // The two have to agree, or turning snapping on and then auto-aligning would
    // leave every node a few pixels off the grid it claims to be on.
    const webviewGrid = Number(/const RM_GRID = (\d+)/.exec(WEBVIEW_SCRIPT)?.[1]);
    const hostGrid = Number(/ROADMAP_GRID_SIZE = (\d+)/.exec(
      readFileSync(path.join(process.cwd(), 'src', 'core', 'roadmapGraph.ts'), 'utf8'),
    )?.[1]);
    expect(webviewGrid).toBe(hostGrid);

    const source = readFileSync(path.join(process.cwd(), 'src', 'core', 'roadmapGraph.ts'), 'utf8');
    for (const name of ['ROADMAP_COLUMN_WIDTH', 'ROADMAP_ROW_HEIGHT', 'ROADMAP_CANVAS_MARGIN']) {
      const value = Number(new RegExp(`${name} = (\\d+)`).exec(source)?.[1]);
      expect(value % hostGrid, `${name} is not a multiple of the grid`).toBe(0);
    }
  });

  it('sends a direction to auto-align, never a set of positions', () => {
    // Auto-align works by discarding hand-placed positions and letting the
    // deterministic layout run. A webview that sent coordinates would be doing
    // the layout, and two layouts would eventually disagree.
    // The dispatch lives in the delegated click handler, above the canvas block.
    const align = WEBVIEW_SCRIPT.slice(WEBVIEW_SCRIPT.indexOf("action === 'roadmap-auto-align'"));
    expect(align.slice(0, 400)).toContain("type: 'roadmapAutoLayout'");
    expect(align.slice(0, 400)).not.toContain('position');
  });

  it('asks for the tree calculation and performs none of it', () => {
    const derive = WEBVIEW_SCRIPT.slice(WEBVIEW_SCRIPT.indexOf("action === 'roadmap-derive-links'"));
    expect(derive.slice(0, 500)).toContain("type: 'roadmapDeriveLinks'");
    // It may ask for a fit — a view change, computed from the rendered DOM —
    // but it still sends no edge, no position and no rule.
    expect(derive.slice(0, 500)).not.toContain('position');
    expect(derive.slice(0, 500)).not.toContain('edges');
  });

  it('shows the result of every arrangement, because a re-flow off-screen reads as nothing', () => {
    // Re-flowing moves every node while pan and zoom stay where they were, so
    // on any plan wider than the frame the whole result happened out of view —
    // which is why both arrange controls read as buttons that did nothing.
    const align = WEBVIEW_SCRIPT.slice(WEBVIEW_SCRIPT.indexOf("action === 'roadmap-auto-align'"));
    expect(align.slice(0, 800)).toContain('state.roadmapFitAfterRender = true;');
    const derive = WEBVIEW_SCRIPT.slice(WEBVIEW_SCRIPT.indexOf("action === 'roadmap-derive-links'"));
    expect(derive.slice(0, 500)).toContain('state.roadmapFitAfterRender = true;');

    // The fit runs after the render that produced the nodes it measures, and
    // clears its own flag first — fitting renders, so a flag cleared afterwards
    // would fit for ever.
    expect(WEBVIEW_SCRIPT).toMatch(/state\.roadmapFitAfterRender = false;\s*\n\s*fitRoadmapCanvas\(\);/);
  });

  it('re-fits when the plan gains an item, and not on every redraw', () => {
    // A new node is laid into the tree by the host and then sits outside a
    // viewport that never moved, which is indistinguishable from never having
    // been added. Only arrivals qualify: re-fitting on every snapshot would
    // fight the pan of anybody reading a large plan.
    expect(WEBVIEW_SCRIPT).toContain('state.roadmapSeenNodeIds');
    expect(WEBVIEW_SCRIPT).toContain('const arrivedIds = [...roadmapNodeIds].filter(id => !state.roadmapSeenNodeIds.has(id));');
    expect(WEBVIEW_SCRIPT).toContain('if (arrivedIds.length > 0 && hadNodes) {');
  });

  it('names the thing being done, not just the axis it runs along', () => {
    // Two equal buttons labelled "Align across" and "Align down" named the axis
    // and never named the feature, so the tree layout had no control that said
    // what it was for.
    expect(WEBVIEW_SCRIPT).toContain('Auto tree');
    expect(WEBVIEW_SCRIPT).not.toContain('Align across');
    expect(WEBVIEW_SCRIPT).not.toContain('Align down');
    // The bare action keeps whatever orientation the plan already declares,
    // rather than silently flipping it.
    const align = WEBVIEW_SCRIPT.slice(WEBVIEW_SCRIPT.indexOf("action === 'roadmap-auto-align'"));
    expect(align.slice(0, 800)).toContain("roadmapGraph().orientation === 'vertical' ? 'vertical' : 'horizontal'");
  });

  it('explains a one-column plan rather than leaving it looking broken', () => {
    // The most confusing state the canvas has: no accepted links means every
    // item is at depth zero, so the tree is one step and the dashed suggestions
    // criss-cross it. The rule that produces it — a suggestion moves no node —
    // is defensible and invisible, which is the worst combination.
    const notice = namedFunction('renderRoadmapFlatNotice');
    expect(notice).toContain('Nothing is linked yet');
    expect(notice).toContain('never move an item');
    expect(notice).toContain('Calculate tree');
    // Said only where somebody is looking at the consequence.
    expect(notice).toContain('visibleEdges.length > 0');
  });

  it('says what the suggestions toggle does, and what it cannot do', () => {
    // Read as a broken button because turning it on draws dashed arrows and
    // changes no layout, which is not what "suggestions on" sounds like.
    expect(WEBVIEW_SCRIPT).toContain('Showing suggestions');
    expect(WEBVIEW_SCRIPT).toContain('Suggestions hidden');
    expect(WEBVIEW_SCRIPT).toContain('a suggestion never moves an item and never blocks one');
  });
});

describe('the host side', () => {
  it('confirms before writing a whole inferred tree, and says how many', () => {
    // Accepting forty inferences at once is exactly the moment a keyword
    // coincidence would get into somebody's plan unnoticed.
    const derive = HOST_PANEL.slice(HOST_PANEL.indexOf('private async handleRoadmapDeriveLinks'));
    expect(derive.slice(0, 4000)).toContain('modal: true');
    expect(derive.slice(0, 4000)).toContain('inferred dependenc');
  });

  it('re-checks each inferred link against the growing set rather than trusting the batch', () => {
    const derive = HOST_PANEL.slice(HOST_PANEL.indexOf('private async handleRoadmapDeriveLinks'));
    expect(derive.slice(0, 5000)).toContain('roadmapEdgeWouldCycle(edges,');
  });

  it('auto-aligns by releasing hand-placed positions, not by writing new ones', () => {
    const align = HOST_PANEL.slice(HOST_PANEL.indexOf('private async handleRoadmapAutoLayout'));
    expect(align.slice(0, 2000)).toContain('layoutOrientation: orientation');
    expect(align.slice(0, 2000)).toContain('position: _dropped');
  });

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

describe('the three Atlas hand-offs', () => {
  it('files the plan create-only, so a plan somebody wrote survives a second press', () => {
    const plan = HOST_PANEL.slice(HOST_PANEL.indexOf('private async handleRoadmapPlan'));
    expect(plan.slice(0, 2500)).toContain("flag: 'wx'");
    expect(plan.slice(0, 2500)).toContain('EEXIST');
  });

  it('resolves the pill payload host-side, against the roadmap, never trusting page text', () => {
    const resolve = HOST_PANEL.slice(HOST_PANEL.indexOf('private async resolveRoadmapPlanItem'));
    expect(resolve.slice(0, 2000)).toContain('context.nodeText.has(raw)');
    expect(resolve.slice(0, 2000)).toContain('nodeIdByItemId');
  });

  it('opens the filed plan from the record, never from a webview-supplied path', () => {
    const open = HOST_PANEL.slice(HOST_PANEL.indexOf('private async handleRoadmapOpenPlan'));
    expect(open.slice(0, 1200)).toContain('record?.planPath');
    expect(open.slice(0, 1200)).toContain('openWorkspaceRelativeFile(planPath)');
  });
});
