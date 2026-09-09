/**
 * Emit a designed surface for the engine that will own it, and keep the words
 * editable from here afterwards.
 *
 * UI Studio draws a surface once, in one vocabulary — nodes, rects, layout
 * modes, tokens, copy — and the surface then has to exist somewhere real: as
 * HTML a browser renders, as UXML a Unity build compiles, as a Godot scene. The
 * tempting design is a renderer that regenerates the target from the graph on
 * every save. It is wrong for a reason that only shows up on the second day:
 * the moment an engine edit lands — a designer nudges a panel in Unity, a
 * developer wires a button in Godot — regeneration overwrites it, and the
 * alternative, never editing in the engine, makes the emit worthless. So the
 * rule is **divergence, not regeneration**. The layout is emitted once and
 * belongs to the engine from then on. The *words* stay editable here, because
 * they are emitted as data inside regions anchored by node id, and a region can
 * be patched by anchor without touching anything around it.
 *
 * Seven rules.
 *
 * 1. **Layout is emitted once and then owned by the engine.** A second emit to
 *    files that changed since the first is refused, naming the engine and the
 *    date. Discarding the engine's work is a separate, destructive act the host
 *    confirms by name; nothing here performs it.
 * 2. **Content is data with a stable anchor.** Every node's copy sits in a
 *    region keyed by the node id — an element name, a scene node name, a marker
 *    — and the manifest records the region as written, so a hand edit inside it
 *    is detectable.
 * 3. **Patch by anchor, never by position.** A content update finds its region
 *    by id in the *current* file. Where the anchor is gone it refuses and says
 *    so: the engine edit that removed it made a decision.
 * 4. **A hand-edited region is refused, and shown.** Overwriting words somebody
 *    changed in the engine is the regeneration failure at a smaller scale.
 * 5. **Content edits are additive or substitutive only.** A node removed in
 *    Studio is reported, never deleted from the engine file, and a node drawn
 *    after the emit is reported rather than inserted into a layout that is no
 *    longer ours. Removal and insertion are the engine's acts.
 * 6. **A target whose syntax was not verified gets a specification, not code.**
 *    Unreal UMG, SwiftUI and Compose emit a handoff document with anchored
 *    copy. A plausible wrong `.swift` file costs more than a document somebody
 *    reads, and the copy in it still updates from here.
 * 7. **Nothing here writes or runs.** Every function returns files, patches or
 *    a plan. The host writes create-only and launches through `execFile` with
 *    an argv that is a constant in this file.
 *
 * The anchors are *structural* where the engine re-serialises its own files.
 * Unity's UI Builder rewrites a UXML file when it saves and Godot's editor
 * rewrites a `.tscn`, and both drop comments — so a comment marker would
 * survive exactly until the first engine edit, which is the one moment it is
 * needed. An element name survives. Only the handoff documents, which nothing
 * re-serialises, use comment markers.
 */
import { createHash } from 'node:crypto';
import type {
  UiDesignGraph,
  UiDesignNode,
  UiDesignScreen,
  UiDesignToken,
  UiEmitAnchor,
  UiEmitManifest,
  UiEmitTargetId,
  WebsitePagePlan,
  WireframeElementKind,
  WireframeRect,
} from '../types.js';
import { resolveUiDesignToken, resolveUiNodeContent, resolveUiScreenLayout } from './uiDesignGraph.js';
import { WIREFRAME_CANVAS_WIDTH, wireframeKindSpec } from './websiteWireframe.js';

// ── Declarations ───────────────────────────────────────────────────

/** The date each target's syntax was read from the engine's own documentation. */
export const UI_EMIT_VERIFIED_AT = '2026-09-09';

export const UI_EMIT_MANIFEST_DIR = 'project_memory/domain/ui-emit';

export interface UiEmitRule {
  id: string;
  describes: string;
}

export const UI_EMIT_RULES: readonly UiEmitRule[] = [
  { id: 'layout-emitted-once', describes: 'A surface is emitted once. After that the engine owns its layout, and a second emit over changed files is refused rather than performed.' },
  { id: 'content-is-anchored-data', describes: 'Every node\'s words sit in a region keyed by the node id, recorded as written, so a later update can find it and can tell whether somebody edited it.' },
  { id: 'patch-by-anchor', describes: 'A content update finds its region by id in the current file, never by line number. A missing anchor is a refusal that names the node.' },
  { id: 'hand-edit-refused', describes: 'A region that changed in the engine since it was written is refused and shown, not overwritten.' },
  { id: 'additive-or-substitutive', describes: 'Words are replaced or added. A node removed in Studio is reported; deleting it from the engine file is the engine\'s act.' },
  { id: 'unverified-gets-a-spec', describes: 'A target whose syntax was not verified receives a handoff document with anchored copy, never generated source.' },
  { id: 'nothing-written', describes: 'Every function here returns files, patches or a plan. Writing and launching are the host\'s confirmed acts.' },
];

export type UiEmitTargetKind = 'source' | 'handoff';

export interface UiLaunchTemplate {
  kind: 'open-file' | 'command' | 'none';
  /** A constant. Placeholders `{workspaceRoot}` and `{scenePath}` are substituted, never interpolated from a message. */
  command?: string;
  args?: readonly string[];
  /** True when the executable is not on PATH by convention; the argv is shown for the person to run. */
  manualOnly?: boolean;
  reason: string;
}

export interface UiEmitTarget {
  id: UiEmitTargetId;
  label: string;
  engineLabel: string;
  kind: UiEmitTargetKind;
  verifiedAgainst: string;
  defaultOutputRoot: string;
  launch: UiLaunchTemplate;
}

export const UI_EMIT_TARGETS: readonly UiEmitTarget[] = [
  {
    id: 'web', label: 'Web (HTML + CSS)', engineLabel: 'the browser', kind: 'source',
    verifiedAgainst: 'HTML Living Standard and CSS custom properties',
    defaultOutputRoot: 'ui-studio/web',
    launch: { kind: 'open-file', reason: 'A static page opens directly in the default browser.' },
  },
  {
    id: 'unity-uitoolkit', label: 'Unity UI Toolkit (UXML + USS)', engineLabel: 'Unity', kind: 'source',
    verifiedAgainst: 'Unity 6 UI Toolkit manual: UXML elements, USS properties and variables',
    defaultOutputRoot: 'Assets/UI/AtlasMind',
    launch: {
      kind: 'command', command: 'Unity', args: ['-projectPath', '{workspaceRoot}'], manualOnly: true,
      reason: 'The Unity editor executable is installed per version and is not on PATH by convention, so the argv is shown rather than run.',
    },
  },
  {
    id: 'godot-control', label: 'Godot 4 (Control scene + Theme)', engineLabel: 'Godot', kind: 'source',
    verifiedAgainst: 'Godot 4 text scene format (.tscn format=3), Control anchors, and Theme resources (.tres)',
    defaultOutputRoot: 'ui/atlasmind',
    launch: {
      kind: 'command', command: 'godot', args: ['--path', '{workspaceRoot}', '{scenePath}'],
      reason: 'Runs the emitted scene with the project\'s Godot executable, if `godot` is on PATH.',
    },
  },
  {
    id: 'unreal-umg', label: 'Unreal UMG (handoff spec)', engineLabel: 'Unreal', kind: 'handoff',
    verifiedAgainst: 'Not verified: a UMG Widget Blueprint is a binary asset, so the emit is a specification for somebody to build in the editor',
    defaultOutputRoot: 'docs/ui-handoff',
    launch: { kind: 'none', reason: 'A specification has nothing to launch.' },
  },
  {
    id: 'swiftui', label: 'SwiftUI (handoff spec)', engineLabel: 'Xcode', kind: 'handoff',
    verifiedAgainst: 'Not verified: SwiftUI source was not checked against a compiler, so the emit is a specification',
    defaultOutputRoot: 'docs/ui-handoff',
    launch: { kind: 'none', reason: 'A specification has nothing to launch.' },
  },
  {
    id: 'compose', label: 'Jetpack Compose (handoff spec)', engineLabel: 'Android Studio', kind: 'handoff',
    verifiedAgainst: 'Not verified: Compose source was not checked against a compiler, so the emit is a specification',
    defaultOutputRoot: 'docs/ui-handoff',
    launch: { kind: 'none', reason: 'A specification has nothing to launch.' },
  },
];

export function uiEmitTarget(id: UiEmitTargetId): UiEmitTarget {
  const target = UI_EMIT_TARGETS.find(candidate => candidate.id === id);
  if (!target) {
    throw new Error(`Unknown emit target ${id}.`);
  }
  return target;
}

export function isUiEmitTargetId(value: unknown): value is UiEmitTargetId {
  return typeof value === 'string' && UI_EMIT_TARGETS.some(target => target.id === value);
}

/**
 * The target a workspace's declared technologies point at. Declared, never
 * inferred from source: a `.uxml` in the tree says somebody used Unity once,
 * not that this surface is for Unity.
 */
export function suggestUiEmitTarget(
  surfaceKind: string,
  targetTechnologies: readonly string[],
): UiEmitTargetId {
  const declared = targetTechnologies.join(' ').toLowerCase();
  if (/\bunity\b|ui toolkit|uxml/.test(declared)) { return 'unity-uitoolkit'; }
  if (/\bgodot\b/.test(declared)) { return 'godot-control'; }
  if (/\bunreal\b|\bumg\b/.test(declared)) { return 'unreal-umg'; }
  if (/swiftui|\bios\b|\bxcode\b/.test(declared)) { return 'swiftui'; }
  if (/compose|\bandroid\b|kotlin/.test(declared)) { return 'compose'; }
  return surfaceKind === 'website' || surfaceKind === 'web-app' || surfaceKind === 'editor-extension' ? 'web' : 'web';
}

// ── Copy: the words a surface carries ──────────────────────────────

export interface SurfaceCopyItem {
  id: string;
  label: string;
  href: string;
}

/** What a node says. Everything a content region is rendered from, and nothing about where it sits. */
export interface SurfaceNodeCopy {
  nodeId: string;
  kind: WireframeElementKind;
  title: string;
  body: string;
  action: string;
  items: SurfaceCopyItem[];
}

export interface SurfaceCopyInput {
  graph: UiDesignGraph;
  screen: UiDesignScreen;
  page: WebsitePagePlan;
  pages: readonly WebsitePagePlan[];
  /** The screen's Markdown body, section by section for the kinds that read it. */
  contentBody?: string;
}

/**
 * Collect every node's copy, from the same facts the preview reads: bound sample
 * content first, then the node's label and the Markdown section a content kind
 * consumes, and for a nav or footer the page's own links.
 */
export function collectSurfaceCopy(input: SurfaceCopyInput): SurfaceNodeCopy[] {
  const sections = splitContentSections(input.contentBody ?? '');
  let nextSection = 0;
  const ordered = orderedNodes(input.screen);
  return ordered.map(node => {
    const bound = resolveUiNodeContent(input.graph, node);
    const section = consumesContent(node.kind) ? sections[nextSection++] : undefined;
    const { heading, text } = splitHeading(section ?? '');
    const title = bound?.values.title ?? (heading || node.label);
    const body = bound?.values.body ?? text;
    const action = bound?.values.action ?? (node.kind === 'cta' || node.kind === 'hero' ? node.label : '');
    const items = wireframeKindSpec(node.kind).linkSource && (node.kind === 'nav' || node.kind === 'footer')
      ? navItems(input.page, input.pages)
      : [];
    return { nodeId: node.id, kind: node.kind, title: clean(title), body: clean(body), action: clean(action), items };
  });
}

function navItems(page: WebsitePagePlan, pages: readonly WebsitePagePlan[]): SurfaceCopyItem[] {
  const declared = page.links
    .map(link => {
      const target = link.targetPageId ? pages.find(candidate => candidate.id === link.targetPageId) : undefined;
      const href = target ? target.slug : link.externalUrl ?? '';
      return href ? { id: link.id, label: clean(link.label || target?.title || href), href } : undefined;
    })
    .filter((item): item is SurfaceCopyItem => item !== undefined);
  if (declared.length > 0) {
    return declared;
  }
  // Real page titles: a fact from the sitemap, not filler — the preview's rule.
  return pages
    .filter(candidate => candidate.id !== page.id)
    .slice(0, 6)
    .map(candidate => ({ id: `page-${candidate.id}`, label: clean(candidate.title), href: candidate.slug }));
}

function consumesContent(kind: WireframeElementKind): boolean {
  return kind === 'hero' || kind === 'text' || kind === 'section' || kind === 'custom';
}

function splitContentSections(body: string): string[] {
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^#{1,4}\s+/.test(line) && current.some(item => item.trim().length > 0)) {
      sections.push(current.join('\n').trim());
      current = [];
    }
    current.push(line);
  }
  if (current.some(item => item.trim().length > 0)) {
    sections.push(current.join('\n').trim());
  }
  return sections;
}

function splitHeading(section: string): { heading: string; text: string } {
  const lines = section.split('\n');
  const first = lines[0] ?? '';
  const match = /^#{1,4}\s+(.*)$/.exec(first);
  if (match) {
    return { heading: match[1]!.trim(), text: lines.slice(1).join('\n').trim() };
  }
  return { heading: '', text: section.trim() };
}

// Built at runtime so the source carries no literal control character.
const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, 'g');

function clean(value: string): string {
  return value.replace(CONTROL_CHARS, '').trim().slice(0, 4_000);
}

/** Parents before children, then canvas order — the order the engine file lists them in. */
function orderedNodes(screen: UiDesignScreen): UiDesignNode[] {
  const byParent = new Map<string | undefined, UiDesignNode[]>();
  for (const node of screen.nodes) {
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }
  const sortSiblings = (nodes: UiDesignNode[]): UiDesignNode[] => [...nodes].sort((left, right) =>
    left.layout.order - right.layout.order
    || left.layout.rect.y - right.layout.rect.y
    || left.layout.rect.x - right.layout.rect.x
    || left.id.localeCompare(right.id));
  const out: UiDesignNode[] = [];
  const visit = (parentId: string | undefined, depth: number): void => {
    if (depth > 32) { return; }
    for (const node of sortSiblings(byParent.get(parentId) ?? [])) {
      out.push(node);
      visit(node.id, depth + 1);
    }
  };
  visit(undefined, 0);
  // A node whose parent no longer exists is still a node; list it at the root
  // rather than losing it.
  for (const node of screen.nodes) {
    if (!out.includes(node)) { out.push(node); }
  }
  return out;
}

// ── Fingerprints ───────────────────────────────────────────────────

function fingerprintText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fingerprintSurfaceCopy(copy: SurfaceNodeCopy): string {
  return fingerprintText(canonicalJson(copy));
}

/** Whitespace-insensitive, so an engine that re-indents a file does not read as a hand edit. */
function fingerprintRegion(region: string): string {
  return fingerprintText(region.replace(/\s+/g, ' ').trim());
}

// ── Anchor grammars ────────────────────────────────────────────────

interface RegionSpan {
  start: number;
  end: number;
}

type LocateResult = RegionSpan | 'missing' | 'ambiguous';

interface RenderContext {
  parentPath: string;
  indent: string;
}

/**
 * How one target names a copy region, finds it again, and renders it. The
 * render produces the whole region — anchor included — so a patch is one slice
 * replacement and the anchor is written by the same code that finds it.
 */
interface AnchorGrammar {
  locate(text: string, nodeId: string): LocateResult;
  fingerprint(text: string, span: RegionSpan): string;
  render(copy: SurfaceNodeCopy, context: RenderContext): string;
}

function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}

function escapeMarkup(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttributeUrl(value: string): string {
  // Only a relative slug or an https URL ever reaches here, both of which the
  // workspace sanitizer already constrained; escaping is the second lock.
  return escapeMarkup(/^(https:\/\/|\/|[A-Za-z0-9])/.test(value) ? value : '#');
}

/**
 * Find the element opened by `openPattern` and its matching close, counting
 * nested opens of the same tag so an engine edit that nests another one inside
 * the region does not truncate it.
 */
function locateElement(
  text: string,
  openPattern: RegExp,
  tagName: string,
): LocateResult {
  const opens = [...text.matchAll(openPattern)];
  if (opens.length === 0) { return 'missing'; }
  if (opens.length > 1) { return 'ambiguous'; }
  const start = opens[0]!.index!;
  const scanner = new RegExp(`<${tagName}(?=[\\s>/])[^>]*?(/?)>|</${tagName}\\s*>`, 'g');
  scanner.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(text)) !== null) {
    const isClose = match[0].startsWith('</');
    const selfClosing = !isClose && match[1] === '/';
    if (isClose) {
      depth -= 1;
      if (depth === 0) {
        return { start, end: match.index + match[0].length };
      }
    } else if (!selfClosing) {
      depth += 1;
    } else if (depth === 0) {
      // The anchor element itself is self-closing: the region is that element.
      return { start, end: match.index + match[0].length };
    }
  }
  return 'missing';
}

const WEB_GRAMMAR: AnchorGrammar = {
  locate: (text, nodeId) => locateElement(
    text,
    new RegExp(`<div(?=[\\s>])[^>]*\\sdata-atlas-copy="${escapeRegExp(safeName(nodeId))}"[^>]*>`, 'g'),
    'div',
  ),
  fingerprint: (text, span) => fingerprintRegion(text.slice(span.start, span.end)),
  render: (copy, context) => {
    const indent = context.indent;
    const lines = [`${indent}<div class="atlas-copy" data-atlas-copy="${safeName(copy.nodeId)}">`];
    if (copy.items.length > 0) {
      lines.push(`${indent}  <ul class="atlas-items">`);
      for (const item of copy.items) {
        lines.push(`${indent}    <li data-atlas-item="${safeName(item.id)}"><a href="${escapeAttributeUrl(item.href)}">${escapeMarkup(item.label)}</a></li>`);
      }
      lines.push(`${indent}  </ul>`);
    }
    if (copy.title) { lines.push(`${indent}  <h2 class="atlas-title">${escapeMarkup(copy.title)}</h2>`); }
    for (const paragraph of paragraphs(copy.body)) {
      lines.push(`${indent}  <p class="atlas-body">${escapeMarkup(paragraph)}</p>`);
    }
    if (copy.action) { lines.push(`${indent}  <a class="atlas-action" href="#">${escapeMarkup(copy.action)}</a>`); }
    lines.push(`${indent}</div>`);
    return lines.join('\n');
  },
};

const UNITY_GRAMMAR: AnchorGrammar = {
  locate: (text, nodeId) => locateElement(
    text,
    new RegExp(`<ui:VisualElement(?=[\\s>])[^>]*\\sname="atlas_copy_${escapeRegExp(safeName(nodeId))}"[^>]*>`, 'g'),
    'ui:VisualElement',
  ),
  fingerprint: (text, span) => fingerprintRegion(text.slice(span.start, span.end)),
  render: (copy, context) => {
    const indent = context.indent;
    const lines = [`${indent}<ui:VisualElement name="atlas_copy_${safeName(copy.nodeId)}" class="atlas-copy">`];
    for (const item of copy.items) {
      lines.push(`${indent}  <ui:Button name="atlas_item_${safeName(item.id)}" class="atlas-item" text="${escapeMarkup(item.label)}" />`);
    }
    if (copy.title) { lines.push(`${indent}  <ui:Label class="atlas-title" text="${escapeMarkup(copy.title)}" />`); }
    for (const paragraph of paragraphs(copy.body)) {
      lines.push(`${indent}  <ui:Label class="atlas-body" text="${escapeMarkup(paragraph)}" />`);
    }
    if (copy.action) { lines.push(`${indent}  <ui:Button class="atlas-action" text="${escapeMarkup(copy.action)}" />`); }
    lines.push(`${indent}</ui:VisualElement>`);
    return lines.join('\n');
  },
};

/**
 * Godot: the region is every `[node name="atlas_copy_<id>…"]` block, contiguous
 * because the editor serialises children directly after their parent. The
 * fingerprint covers only the `text = ` lines, since the editor adds and
 * reorders layout properties on save and those are its to change.
 */
const GODOT_GRAMMAR: AnchorGrammar = {
  locate: (text, nodeId) => {
    const prefix = `atlas_copy_${safeName(nodeId)}`;
    const headers = [...text.matchAll(/^\[node name="([^"]+)"[^\n]*\]\s*$/gm)];
    const owned = headers.filter(header => header[1] === prefix || header[1]!.startsWith(`${prefix}_`));
    if (owned.length === 0) { return 'missing'; }
    const first = owned[0]!;
    const last = owned[owned.length - 1]!;
    const between = headers.filter(header => header.index! > first.index! && header.index! < last.index!);
    if (between.some(header => !owned.includes(header))) { return 'ambiguous'; }
    const after = headers.find(header => header.index! > last.index!);
    const end = after ? after.index! : text.length;
    return { start: first.index!, end };
  },
  fingerprint: (text, span) => {
    const region = text.slice(span.start, span.end);
    const texts = [...region.matchAll(/^text = (".*")\s*$/gm)].map(match => match[1]!);
    const names = [...region.matchAll(/^\[node name="([^"]+)"/gm)].map(match => match[1]!);
    return fingerprintText(canonicalJson({ names, texts }));
  },
  render: (copy, context) => {
    const name = `atlas_copy_${safeName(copy.nodeId)}`;
    const blocks = [
      [
        `[node name="${name}" type="VBoxContainer" parent="${context.parentPath}"]`,
        'layout_mode = 1',
        'anchors_preset = 15',
        'anchor_right = 1.0',
        'anchor_bottom = 1.0',
        'grow_horizontal = 2',
        'grow_vertical = 2',
      ].join('\n'),
    ];
    const childPath = context.parentPath === '.' ? name : `${context.parentPath}/${name}`;
    for (const item of copy.items) {
      blocks.push(`[node name="${name}_item_${safeName(item.id)}" type="Button" parent="${childPath}"]\nlayout_mode = 2\ntext = ${godotString(item.label)}`);
    }
    if (copy.title) {
      blocks.push(`[node name="${name}_title" type="Label" parent="${childPath}"]\nlayout_mode = 2\ntheme_type_variation = &"HeaderMedium"\ntext = ${godotString(copy.title)}`);
    }
    paragraphs(copy.body).forEach((paragraph, index) => {
      blocks.push(`[node name="${name}_body_${index + 1}" type="Label" parent="${childPath}"]\nlayout_mode = 2\nautowrap_mode = 3\ntext = ${godotString(paragraph)}`);
    });
    if (copy.action) {
      blocks.push(`[node name="${name}_action" type="Button" parent="${childPath}"]\nlayout_mode = 2\ntext = ${godotString(copy.action)}`);
    }
    return `${blocks.join('\n\n')}\n`;
  },
};

const HANDOFF_GRAMMAR: AnchorGrammar = {
  locate: (text, nodeId) => {
    const id = safeName(nodeId);
    const opens = [...text.matchAll(new RegExp(`<!-- atlas:copy:${escapeRegExp(id)} -->`, 'g'))];
    if (opens.length === 0) { return 'missing'; }
    if (opens.length > 1) { return 'ambiguous'; }
    const start = opens[0]!.index!;
    const closeMarker = `<!-- /atlas:copy:${id} -->`;
    const closeAt = text.indexOf(closeMarker, start);
    return closeAt < 0 ? 'missing' : { start, end: closeAt + closeMarker.length };
  },
  fingerprint: (text, span) => fingerprintRegion(text.slice(span.start, span.end)),
  render: copy => {
    const id = safeName(copy.nodeId);
    const lines = [`<!-- atlas:copy:${id} -->`];
    if (copy.title) { lines.push(`- **Title:** ${markdownCell(copy.title)}`); }
    for (const paragraph of paragraphs(copy.body)) { lines.push(`- **Body:** ${markdownCell(paragraph)}`); }
    if (copy.action) { lines.push(`- **Action:** ${markdownCell(copy.action)}`); }
    for (const item of copy.items) { lines.push(`- **Item ${markdownCell(item.id)}:** ${markdownCell(item.label)} → ${markdownCell(item.href)}`); }
    if (lines.length === 1) { lines.push('- _No copy._'); }
    lines.push(`<!-- /atlas:copy:${id} -->`);
    return lines.join('\n');
  },
};

function grammarFor(targetId: UiEmitTargetId): AnchorGrammar {
  switch (targetId) {
    case 'web': return WEB_GRAMMAR;
    case 'unity-uitoolkit': return UNITY_GRAMMAR;
    case 'godot-control': return GODOT_GRAMMAR;
    default: return HANDOFF_GRAMMAR;
  }
}

function paragraphs(body: string): string[] {
  return body.split(/\n\s*\n/).map(part => part.replace(/\s*\n\s*/g, ' ').trim()).filter(part => part.length > 0);
}

function godotString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function markdownCell(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Tokens ─────────────────────────────────────────────────────────

const ROLE_TOKEN_IDS = [
  'color-primary', 'color-secondary', 'color-accent', 'color-background', 'color-surface', 'color-text',
  'font-heading', 'font-body', 'spacing-base', 'radius-base',
] as const;

interface ResolvedRoles {
  colours: Record<string, string>;
  fonts: Record<string, string>;
  numbers: Record<string, number>;
}

function resolveRoles(tokens: readonly UiDesignToken[]): ResolvedRoles {
  const roles: ResolvedRoles = { colours: {}, fonts: {}, numbers: {} };
  for (const id of ROLE_TOKEN_IDS) {
    const resolved = resolveUiDesignToken(tokens, id);
    if (!resolved) { continue; }
    if (resolved.kind === 'color' && typeof resolved.value === 'string' && /^#[0-9a-f]{3,8}$/i.test(resolved.value)) {
      roles.colours[id] = resolved.value;
    } else if (resolved.kind === 'font-family' && typeof resolved.value === 'string') {
      roles.fonts[id] = resolved.value.replace(/[^A-Za-z0-9 ,'"-]/g, '').slice(0, 120);
    } else if ((resolved.kind === 'spacing' || resolved.kind === 'radius') && typeof resolved.value === 'number' && Number.isFinite(resolved.value)) {
      roles.numbers[id] = Math.max(0, Math.min(512, Math.round(resolved.value)));
    }
  }
  return roles;
}

function hexToGodotColor(hex: string): string {
  const raw = hex.slice(1);
  const expanded = raw.length === 3 || raw.length === 4 ? raw.split('').map(char => char + char).join('') : raw;
  const parts = [0, 2, 4, 6].map(offset => expanded.length > offset ? parseInt(expanded.slice(offset, offset + 2), 16) / 255 : undefined);
  const [r, g, b, a] = parts;
  const component = (value: number | undefined, fallback: number): string => (value === undefined ? fallback : Math.round(value * 1000) / 1000).toString();
  return `Color(${component(r, 0)}, ${component(g, 0)}, ${component(b, 0)}, ${component(a, 1)})`;
}

// ── Emitting ───────────────────────────────────────────────────────

export interface EmittedFile {
  path: string;
  contents: string;
  /** Written once and left alone afterwards — the token file every screen of a target shares. */
  shared: boolean;
}

export interface SurfaceEmitInput extends SurfaceCopyInput {
  targetId: UiEmitTargetId;
  siteName: string;
  emittedAt: string;
  /** Workspace-relative, forward-slashed. Defaults to the target's own root. */
  outputRoot?: string;
  /** What is on disk now: the prior manifest and the current text of each file it names (or of the files this emit would write). */
  existing?: {
    manifest?: UiEmitManifest;
    files: ReadonlyMap<string, string | undefined>;
  };
}

export interface SurfaceEmitPlan {
  targetId: UiEmitTargetId;
  target: UiEmitTarget;
  screenId: string;
  outputRoot: string;
  files: EmittedFile[];
  manifest: UiEmitManifest;
  manifestPath: string;
  /** What this emit does not do, stated with the plan rather than discovered after it. */
  caveats: string[];
  /** One sentence the confirmation shows verbatim. */
  disclosure: string;
}

export type SurfaceEmitRefusal =
  | 'screen-not-drawn'
  | 'output-root-invalid'
  | 'layout-owned-by-engine'
  | 'files-exist';

export type SurfaceEmitResult =
  | { ok: true; plan: SurfaceEmitPlan }
  | { ok: false; refusal: SurfaceEmitRefusal; reason: string; ownership?: SurfaceOwnership };

export function uiEmitManifestPath(screenId: string, targetId: UiEmitTargetId): string {
  return `${UI_EMIT_MANIFEST_DIR}/${safeName(screenId)}--${targetId}.json`;
}

export function validateOutputRoot(value: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0) { return 'the output folder is empty'; }
  if (value.length > 160) { return 'the output folder path is too long'; }
  if (value.includes('\\')) { return 'use forward slashes'; }
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) { return 'the output folder must be inside the workspace'; }
  if (value.split('/').some(segment => segment === '..' || segment === '.' || segment === '')) { return 'the output folder must not leave the workspace'; }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)) { return 'the output folder may only use letters, digits, dot, dash, underscore and slash'; }
  if (value.startsWith('project_memory/') || value.startsWith('.git/')) { return 'the output folder cannot be inside project_memory or .git'; }
  return undefined;
}

/**
 * Plan an emit. Returns the files, the manifest and the disclosure, or a
 * refusal: a surface nobody drew, a bad folder, a layout the engine now owns,
 * or files at the target paths that AtlasMind did not write.
 */
export function planSurfaceEmit(input: SurfaceEmitInput): SurfaceEmitResult {
  const target = uiEmitTarget(input.targetId);
  const outputRoot = (input.outputRoot ?? target.defaultOutputRoot).replace(/\/+$/, '');
  const rootProblem = validateOutputRoot(outputRoot);
  if (rootProblem) {
    return { ok: false, refusal: 'output-root-invalid', reason: `Cannot emit: ${rootProblem}.` };
  }
  if (input.screen.nodes.length === 0) {
    return { ok: false, refusal: 'screen-not-drawn', reason: `${input.page.title} has not been drawn, so there is nothing to emit.` };
  }
  const copy = collectSurfaceCopy(input);
  const rendered = renderTarget(input, target, outputRoot, copy);

  if (input.existing?.manifest) {
    const ownership = assessSurfaceOwnership(input.existing.manifest, input.existing.files);
    if (ownership.layout.status === 'engine-owned') {
      return {
        ok: false,
        refusal: 'layout-owned-by-engine',
        reason: `${ownership.statement}. Emitting again would overwrite ${target.engineLabel}'s work; push content instead, or discard the engine's layout deliberately.`,
        ownership,
      };
    }
  } else if (input.existing) {
    const occupied = rendered.files.filter(file => !file.shared && input.existing!.files.get(file.path) !== undefined);
    if (occupied.length > 0) {
      return {
        ok: false,
        refusal: 'files-exist',
        reason: `${occupied.map(file => file.path).join(', ')} already exist${occupied.length === 1 ? 's' : ''} and AtlasMind did not write ${occupied.length === 1 ? 'it' : 'them'}. Choose another output folder, or move the file${occupied.length === 1 ? '' : 's'}.`,
      };
    }
  }

  const manifest: UiEmitManifest = {
    version: 1,
    targetId: target.id,
    screenId: input.screen.id,
    pageId: input.page.id,
    emittedAt: input.emittedAt,
    graphRevision: input.graph.revision,
    files: rendered.files.map(file => ({ path: file.path, fingerprint: fingerprintText(file.contents), shared: file.shared })),
    anchors: rendered.anchors,
  };
  const caveats = [
    target.kind === 'handoff'
      ? `${target.label} is a specification: nothing here was checked against a compiler, so the copy regions update from Studio and the layout is described for somebody to build.`
      : `After this emit, ${target.engineLabel} owns the layout. Studio can still change the words in ${rendered.anchors.length} region${rendered.anchors.length === 1 ? '' : 's'}; it will not move a box.`,
    'Shared token files are written once and then left alone.',
    ...rendered.caveats,
  ];
  return {
    ok: true,
    plan: {
      targetId: target.id,
      target,
      screenId: input.screen.id,
      outputRoot,
      files: rendered.files,
      manifest,
      manifestPath: uiEmitManifestPath(input.screen.id, target.id),
      caveats,
      disclosure: `Write ${rendered.files.length} file${rendered.files.length === 1 ? '' : 's'} under ${outputRoot}/ for ${target.label}, and record the emit in ${uiEmitManifestPath(input.screen.id, target.id)}. Nothing outside those paths is touched, and nothing is run.`,
    },
  };
}

interface RenderedTarget {
  files: EmittedFile[];
  anchors: UiEmitAnchor[];
  caveats: string[];
}

function fileStem(page: WebsitePagePlan): string {
  const stem = page.slug.replace(/^\/+|\/+$/g, '').replace(/^screen\//, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return stem || 'index';
}

function pascalCase(value: string): string {
  return value.split(/[^A-Za-z0-9]+/).filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join('') || 'Screen';
}

interface LaidOutNode {
  node: UiDesignNode;
  rect: WireframeRect;
  hidden: boolean;
  children: LaidOutNode[];
}

/** The node tree with the rects the preview projects, so what is emitted is what was drawn. */
function layoutTree(screen: UiDesignScreen): { roots: LaidOutNode[]; height: number } {
  const resolved = new Map(resolveUiScreenLayout(screen, screen.baseBreakpoint).map(node => [node.id, node.layout]));
  const ordered = orderedNodes(screen);
  const ids = new Set(ordered.map(node => node.id));
  const items = new Map<string, LaidOutNode>();
  for (const node of ordered) {
    const layout = resolved.get(node.id);
    items.set(node.id, { node, rect: layout?.rect ?? node.layout.rect, hidden: layout?.hidden ?? node.layout.hidden, children: [] });
  }
  const roots: LaidOutNode[] = [];
  for (const node of ordered) {
    const item = items.get(node.id)!;
    const parent = node.parentId && ids.has(node.parentId) && wireframeKindSpec(items.get(node.parentId)!.node.kind).container
      ? items.get(node.parentId)
      : undefined;
    (parent ? parent.children : roots).push(item);
  }
  const height = Math.max(600, ...ordered.map(node => {
    const item = items.get(node.id)!;
    return item.hidden ? 0 : item.rect.y + item.rect.height;
  })) + 40;
  return { roots, height };
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 10_000) / 100}%`;
}

function renderTarget(
  input: SurfaceEmitInput,
  target: UiEmitTarget,
  outputRoot: string,
  copy: SurfaceNodeCopy[],
): RenderedTarget {
  switch (target.id) {
    case 'web': return renderWeb(input, outputRoot, copy);
    case 'unity-uitoolkit': return renderUnity(input, outputRoot, copy);
    case 'godot-control': return renderGodot(input, outputRoot, copy);
    default: return renderHandoff(input, target, outputRoot, copy);
  }
}

function copyFor(copy: readonly SurfaceNodeCopy[], nodeId: string): SurfaceNodeCopy {
  return copy.find(entry => entry.nodeId === nodeId) ?? { nodeId, kind: 'custom', title: '', body: '', action: '', items: [] };
}

function anchorFor(
  grammar: AnchorGrammar,
  filePath: string,
  entry: SurfaceNodeCopy,
  region: string,
  context: RenderContext,
): UiEmitAnchor {
  return {
    nodeId: entry.nodeId,
    filePath,
    regionFingerprint: grammar.fingerprint(region, { start: 0, end: region.length }),
    copyFingerprint: fingerprintSurfaceCopy(entry),
    context: { parentPath: context.parentPath, indent: context.indent },
  };
}

// ── Web ──

function renderWeb(input: SurfaceEmitInput, outputRoot: string, copy: SurfaceNodeCopy[]): RenderedTarget {
  const stem = fileStem(input.page);
  const htmlPath = `${outputRoot}/${stem}.html`;
  const cssPath = `${outputRoot}/${stem}.css`;
  const tokensPath = `${outputRoot}/atlas-tokens.css`;
  const { roots, height } = layoutTree(input.screen);
  const anchors: UiEmitAnchor[] = [];

  const renderNode = (item: LaidOutNode, parentRect: WireframeRect, indent: string): string => {
    const { node, rect } = item;
    const spec = wireframeKindSpec(node.kind);
    const style = [
      `left:${percent((rect.x - parentRect.x) / parentRect.width)}`,
      `top:${percent((rect.y - parentRect.y) / parentRect.height)}`,
      `width:${percent(rect.width / parentRect.width)}`,
      `height:${percent(rect.height / parentRect.height)}`,
      ...(item.hidden ? ['display:none'] : []),
    ].join(';');
    const tag = node.kind === 'nav' ? 'nav' : node.kind === 'footer' ? 'footer' : node.kind === 'form' ? 'form' : 'section';
    const entry = copyFor(copy, node.id);
    const context = { parentPath: '', indent: `${indent}  ` };
    const region = WEB_GRAMMAR.render(entry, context);
    anchors.push(anchorFor(WEB_GRAMMAR, htmlPath, entry, region, context));
    const children = item.children.map(child => renderNode(child, rect, `${indent}  `)).join('\n');
    return [
      `${indent}<${tag} class="atlas-node atlas-${node.kind}" data-atlas-node="${safeName(node.id)}" data-atlas-mode="${node.layout.mode}" aria-label="${escapeMarkup(node.label || spec.label)}" style="${style}">`,
      region,
      ...(children ? [children] : []),
      `${indent}</${tag}>`,
    ].join('\n');
  };

  const stage: WireframeRect = { x: 0, y: 0, width: WIREFRAME_CANVAS_WIDTH, height };
  const body = roots.map(item => renderNode(item, stage, '    ')).join('\n');
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeMarkup(input.page.title)} — ${escapeMarkup(input.siteName)}</title>`,
    '  <link rel="stylesheet" href="atlas-tokens.css" />',
    `  <link rel="stylesheet" href="${stem}.css" />`,
    '</head>',
    '<body>',
    `  <main class="atlas-screen" data-atlas-screen="${safeName(input.screen.id)}" style="aspect-ratio:${WIREFRAME_CANVAS_WIDTH} / ${height}">`,
    body,
    '  </main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  const css = [
    `/* ${input.page.title} — emitted by AtlasMind UI Studio on ${input.emittedAt.slice(0, 10)}. Yours to edit from here. */`,
    '.atlas-screen { position: relative; width: 100%; max-width: 1000px; margin: 0 auto; background: var(--color-background, #fff); color: var(--color-text, #111); font-family: var(--font-body, system-ui, sans-serif); }',
    '.atlas-node { position: absolute; box-sizing: border-box; padding: var(--spacing-base, 16px); border-radius: var(--radius-base, 0); }',
    '.atlas-nav, .atlas-footer { background: var(--color-surface, #f4f4f5); }',
    '.atlas-hero { background: var(--color-primary, #2563eb); color: #fff; }',
    '.atlas-card { background: var(--color-surface, #f4f4f5); }',
    '.atlas-copy { display: flex; flex-direction: column; gap: 8px; }',
    '.atlas-title { margin: 0; font-family: var(--font-heading, inherit); }',
    '.atlas-body { margin: 0; }',
    '.atlas-action { display: inline-block; padding: 8px 16px; background: var(--color-accent, #f59e0b); color: #111; text-decoration: none; border-radius: var(--radius-base, 4px); }',
    '.atlas-items { display: flex; gap: 16px; list-style: none; margin: 0; padding: 0; }',
    '',
  ].join('\n');

  const roles = resolveRoles(input.graph.tokens);
  const tokens = [
    '/* Brand tokens — projected from UI Studio\'s presets. Written once; edit the presets in Studio and re-emit a new screen to see changes here. */',
    ':root {',
    ...Object.entries(roles.colours).map(([id, value]) => `  --${id}: ${value};`),
    ...Object.entries(roles.fonts).map(([id, value]) => `  --${id}: ${value};`),
    ...Object.entries(roles.numbers).map(([id, value]) => `  --${id}: ${value}px;`),
    '}',
    '',
  ].join('\n');

  return {
    files: [
      { path: htmlPath, contents: html, shared: false },
      { path: cssPath, contents: css, shared: false },
      { path: tokensPath, contents: tokens, shared: true },
    ],
    anchors,
    caveats: ['Boxes are absolutely positioned as drawn: a first pass to be made responsive in the stylesheet, not a finished layout.'],
  };
}

// ── Unity UI Toolkit ──

function renderUnity(input: SurfaceEmitInput, outputRoot: string, copy: SurfaceNodeCopy[]): RenderedTarget {
  const name = pascalCase(input.page.title);
  const uxmlPath = `${outputRoot}/${name}.uxml`;
  const ussPath = `${outputRoot}/${name}.uss`;
  const tokensPath = `${outputRoot}/AtlasTokens.uss`;
  const { roots, height } = layoutTree(input.screen);
  const anchors: UiEmitAnchor[] = [];

  const renderNode = (item: LaidOutNode, parentRect: WireframeRect, indent: string): string => {
    const { node, rect } = item;
    const style = [
      `left: ${percent((rect.x - parentRect.x) / parentRect.width)}`,
      `top: ${Math.round(rect.y - parentRect.y)}px`,
      `width: ${percent(rect.width / parentRect.width)}`,
      `height: ${Math.round(rect.height)}px`,
      ...(item.hidden ? ['display: none'] : []),
    ].join('; ');
    const entry = copyFor(copy, node.id);
    const context = { parentPath: '', indent: `${indent}  ` };
    const region = UNITY_GRAMMAR.render(entry, context);
    anchors.push(anchorFor(UNITY_GRAMMAR, uxmlPath, entry, region, context));
    const children = item.children.map(child => renderNode(child, rect, `${indent}  `)).join('\n');
    return [
      `${indent}<ui:VisualElement name="atlas_node_${safeName(node.id)}" class="atlas-node atlas-${node.kind}" style="${style};">`,
      region,
      ...(children ? [children] : []),
      `${indent}</ui:VisualElement>`,
    ].join('\n');
  };

  const stage: WireframeRect = { x: 0, y: 0, width: WIREFRAME_CANVAS_WIDTH, height };
  const uxml = [
    '<ui:UXML xmlns:ui="UnityEngine.UIElements" xmlns:uie="UnityEditor.UIElements" editor-extension-mode="False">',
    '  <Style src="AtlasTokens.uss" />',
    `  <Style src="${name}.uss" />`,
    `  <ui:VisualElement name="atlas_screen_${safeName(input.screen.id)}" class="atlas-screen" style="height: ${height}px;">`,
    roots.map(item => renderNode(item, stage, '    ')).join('\n'),
    '  </ui:VisualElement>',
    '</ui:UXML>',
    '',
  ].join('\n');

  const uss = [
    `/* ${input.page.title} — emitted by AtlasMind UI Studio on ${input.emittedAt.slice(0, 10)}. Yours to edit from here. */`,
    '.atlas-screen { position: relative; width: 100%; background-color: var(--color-background); color: var(--color-text); }',
    '.atlas-node { position: absolute; padding: var(--spacing-base); }',
    '.atlas-nav, .atlas-footer, .atlas-card { background-color: var(--color-surface); }',
    '.atlas-hero { background-color: var(--color-primary); }',
    '.atlas-copy { flex-direction: column; }',
    '.atlas-title { -unity-font-style: bold; font-size: 20px; }',
    '.atlas-items { flex-direction: row; }',
    '.atlas-action, .atlas-item { background-color: var(--color-accent); border-radius: var(--radius-base); }',
    '',
  ].join('\n');

  const roles = resolveRoles(input.graph.tokens);
  const tokens = [
    '/* Brand tokens — projected from UI Studio\'s presets. Written once. */',
    ':root {',
    ...Object.entries(roles.colours).map(([id, value]) => `  --${id}: ${value};`),
    ...Object.entries(roles.numbers).map(([id, value]) => `  --${id}: ${value}px;`),
    '}',
    '',
  ].join('\n');

  return {
    files: [
      { path: uxmlPath, contents: uxml, shared: false },
      { path: ussPath, contents: uss, shared: false },
      { path: tokensPath, contents: tokens, shared: true },
    ],
    anchors,
    caveats: [
      'Font families are not emitted: a USS font is a project asset reference, which this emit cannot know.',
      'Opening the UXML in UI Builder and saving re-serialises it; the copy anchors are element names, so they survive that.',
    ],
  };
}

// ── Godot ──

function renderGodot(input: SurfaceEmitInput, outputRoot: string, copy: SurfaceNodeCopy[]): RenderedTarget {
  const stem = fileStem(input.page).replace(/-/g, '_');
  const scenePath = `${outputRoot}/${stem}.tscn`;
  const themePath = `${outputRoot}/atlas_theme.tres`;
  const { roots, height } = layoutTree(input.screen);
  const anchors: UiEmitAnchor[] = [];
  const rootName = pascalCase(input.page.title);
  const blocks: string[] = [];

  const renderNode = (item: LaidOutNode, parentRect: WireframeRect, parentPath: string): void => {
    const { node, rect } = item;
    const name = `atlas_node_${safeName(node.id)}`;
    const anchor = (value: number): string => (Math.round(value * 10_000) / 10_000).toFixed(4);
    blocks.push([
      `[node name="${name}" type="${node.kind === 'nav' || node.kind === 'footer' ? 'PanelContainer' : 'Control'}" parent="${parentPath}"]`,
      ...(item.hidden ? ['visible = false'] : []),
      'layout_mode = 1',
      'anchors_preset = -1',
      `anchor_left = ${anchor((rect.x - parentRect.x) / parentRect.width)}`,
      `anchor_top = ${anchor((rect.y - parentRect.y) / parentRect.height)}`,
      `anchor_right = ${anchor((rect.x - parentRect.x + rect.width) / parentRect.width)}`,
      `anchor_bottom = ${anchor((rect.y - parentRect.y + rect.height) / parentRect.height)}`,
      'grow_horizontal = 2',
      'grow_vertical = 2',
    ].join('\n'));
    const ownPath = parentPath === '.' ? name : `${parentPath}/${name}`;
    const entry = copyFor(copy, node.id);
    const context = { parentPath: ownPath, indent: '' };
    const region = GODOT_GRAMMAR.render(entry, context);
    anchors.push(anchorFor(GODOT_GRAMMAR, scenePath, entry, region, context));
    blocks.push(region.trimEnd());
    for (const child of item.children) {
      renderNode(child, rect, ownPath);
    }
  };

  const stage: WireframeRect = { x: 0, y: 0, width: WIREFRAME_CANVAS_WIDTH, height };
  for (const item of roots) {
    renderNode(item, stage, '.');
  }

  const scene = [
    '[gd_scene format=3]',
    '',
    `[ext_resource type="Theme" path="res://${themePath}" id="1_atlas_theme"]`,
    '',
    `[node name="${rootName}" type="Control"]`,
    'layout_mode = 3',
    'anchors_preset = 15',
    'anchor_right = 1.0',
    'anchor_bottom = 1.0',
    'grow_horizontal = 2',
    'grow_vertical = 2',
    'theme = ExtResource("1_atlas_theme")',
    '',
    blocks.join('\n\n'),
    '',
  ].join('\n');

  const roles = resolveRoles(input.graph.tokens);
  const themeLines = ['[gd_resource type="Theme" format=3]', '', '[resource]'];
  if (roles.numbers['spacing-base'] !== undefined) {
    themeLines.push(`VBoxContainer/constants/separation = ${Math.round(roles.numbers['spacing-base'] / 2)}`);
  }
  if (roles.colours['color-text']) {
    themeLines.push(`Label/colors/font_color = ${hexToGodotColor(roles.colours['color-text'])}`);
    themeLines.push(`Button/colors/font_color = ${hexToGodotColor(roles.colours['color-text'])}`);
  }
  if (roles.colours['color-accent']) {
    themeLines.push(`Button/colors/font_hover_color = ${hexToGodotColor(roles.colours['color-accent'])}`);
  }
  const theme = `${themeLines.join('\n')}\n`;

  return {
    files: [
      { path: scenePath, contents: scene, shared: false },
      { path: themePath, contents: theme, shared: true },
    ],
    anchors,
    caveats: [
      `The scene references the theme as res://${themePath}, which assumes the workspace root is the Godot project root (where project.godot lives).`,
      'Saving the scene in the Godot editor re-serialises it; the copy anchors are node names, so they survive that.',
    ],
  };
}

// ── Handoff specifications ──

function renderHandoff(
  input: SurfaceEmitInput,
  target: UiEmitTarget,
  outputRoot: string,
  copy: SurfaceNodeCopy[],
): RenderedTarget {
  const stem = fileStem(input.page);
  const specPath = `${outputRoot}/${stem}.${target.id}.md`;
  const { roots, height } = layoutTree(input.screen);
  const anchors: UiEmitAnchor[] = [];
  const roles = resolveRoles(input.graph.tokens);
  const lines: string[] = [
    `# ${input.page.title} — ${target.label}`,
    '',
    `Emitted by AtlasMind UI Studio on ${input.emittedAt.slice(0, 10)} for ${target.engineLabel}. ${target.verifiedAgainst}.`,
    '',
    'The layout below is a specification to build in the engine. The copy regions between the `atlas:copy` markers are owned by Studio and update from there; everything else is yours.',
    '',
    '## Tokens',
    '',
    ...Object.entries(roles.colours).map(([id, value]) => `- \`${id}\`: ${value}`),
    ...Object.entries(roles.fonts).map(([id, value]) => `- \`${id}\`: ${value}`),
    ...Object.entries(roles.numbers).map(([id, value]) => `- \`${id}\`: ${value}`),
    '',
    `## Layout (canvas ${WIREFRAME_CANVAS_WIDTH} × ${height} units)`,
    '',
  ];
  const walk = (item: LaidOutNode, depth: number): void => {
    const { node, rect } = item;
    const spec = wireframeKindSpec(node.kind);
    lines.push(`${'#'.repeat(Math.min(6, depth + 3))} ${node.label || spec.label} (${spec.label})`);
    lines.push('');
    lines.push(`- Node id: \`${node.id}\``);
    lines.push(`- Rect: x ${Math.round(rect.x)}, y ${Math.round(rect.y)}, w ${Math.round(rect.width)}, h ${Math.round(rect.height)}${item.hidden ? ' (hidden)' : ''}`);
    lines.push(`- Layout: ${node.layout.mode}${node.layout.mode !== 'free' ? ` · ${node.layout.direction} · gap ${node.layout.gap} · padding ${node.layout.padding}` : ''}`);
    if (node.designPrompt) { lines.push(`- Intent: ${markdownCell(node.designPrompt)}`); }
    lines.push('');
    const entry = copyFor(copy, node.id);
    const region = HANDOFF_GRAMMAR.render(entry, { parentPath: '', indent: '' });
    anchors.push(anchorFor(HANDOFF_GRAMMAR, specPath, entry, region, { parentPath: '', indent: '' }));
    lines.push(region);
    lines.push('');
    for (const child of item.children) { walk(child, depth + 1); }
  };
  for (const item of roots) { walk(item, 0); }
  return {
    files: [{ path: specPath, contents: `${lines.join('\n')}\n`, shared: false }],
    anchors,
    caveats: [],
  };
}

// ── Ownership ──────────────────────────────────────────────────────

export interface SurfaceOwnership {
  targetId: UiEmitTargetId;
  screenId: string;
  emittedAt: string;
  layout: {
    status: 'as-emitted' | 'engine-owned' | 'missing';
    detail: string;
  };
  content: {
    editable: number;
    blocked: number;
    reasons: Array<{ nodeId: string; reason: string }>;
  };
  /** "Layout: owned by Unity since the emit on 2026-09-09 · Content: editable here (4 of 5 regions)". */
  statement: string;
}

/**
 * Who owns what, from the manifest and the files as they are now. Layout is the
 * engine's the moment any emitted file differs from its recorded fingerprint;
 * content is editable region by region, wherever the anchor is found and the
 * region is as AtlasMind last wrote it.
 */
export function assessSurfaceOwnership(
  manifest: UiEmitManifest,
  files: ReadonlyMap<string, string | undefined>,
): SurfaceOwnership {
  const target = uiEmitTarget(manifest.targetId);
  const grammar = grammarFor(manifest.targetId);
  const owned = manifest.files.filter(file => !file.shared);
  const missing = owned.filter(file => files.get(file.path) === undefined);
  const changed = owned.filter(file => {
    const text = files.get(file.path);
    return text !== undefined && fingerprintText(text) !== file.fingerprint;
  });
  const date = manifest.emittedAt.slice(0, 10);
  const layout: SurfaceOwnership['layout'] = missing.length === owned.length && owned.length > 0
    ? { status: 'missing', detail: `The emitted file${owned.length === 1 ? ' is' : 's are'} gone: ${missing.map(file => file.path).join(', ')}.` }
    : changed.length > 0 || missing.length > 0
      ? { status: 'engine-owned', detail: `${[...changed, ...missing].map(file => file.path).join(', ')} changed since the emit on ${date}.` }
      : { status: 'as-emitted', detail: `Every emitted file is as written on ${date}.` };

  const reasons: SurfaceOwnership['content']['reasons'] = [];
  let editable = 0;
  for (const anchor of manifest.anchors) {
    const text = files.get(anchor.filePath);
    if (text === undefined) {
      reasons.push({ nodeId: anchor.nodeId, reason: `${anchor.filePath} is missing.` });
      continue;
    }
    const span = grammar.locate(text, anchor.nodeId);
    if (span === 'missing') {
      reasons.push({ nodeId: anchor.nodeId, reason: `its anchor is no longer in ${anchor.filePath}.` });
    } else if (span === 'ambiguous') {
      reasons.push({ nodeId: anchor.nodeId, reason: `its anchor appears more than once in ${anchor.filePath}.` });
    } else if (grammar.fingerprint(text, span) !== anchor.regionFingerprint) {
      reasons.push({ nodeId: anchor.nodeId, reason: `its region was edited in ${target.engineLabel}.` });
    } else {
      editable += 1;
    }
  }
  const total = manifest.anchors.length;
  const layoutStatement = layout.status === 'as-emitted'
    ? `Layout: as emitted on ${date}`
    : layout.status === 'missing'
      ? `Layout: emitted files missing`
      : `Layout: owned by ${target.engineLabel} since the emit on ${date}`;
  const contentStatement = total === 0
    ? 'Content: no regions'
    : editable === total
      ? `Content: editable here (${total} region${total === 1 ? '' : 's'})`
      : editable === 0
        ? `Content: not editable here (${total} region${total === 1 ? '' : 's'} blocked)`
        : `Content: editable here (${editable} of ${total} regions; ${total - editable} blocked)`;
  return {
    targetId: manifest.targetId,
    screenId: manifest.screenId,
    emittedAt: manifest.emittedAt,
    layout,
    content: { editable, blocked: total - editable, reasons },
    statement: `${layoutStatement} · ${contentStatement}`,
  };
}

// ── Content patches ────────────────────────────────────────────────

export type ContentPatchRefusalCode =
  | 'file-missing'
  | 'anchor-missing'
  | 'anchor-ambiguous'
  | 'region-edited'
  | 'node-removed';

export interface ContentPatch {
  filePath: string;
  nodeId: string;
  before: string;
  after: string;
}

export interface ContentPatchRefusal {
  nodeId: string;
  code: ContentPatchRefusalCode;
  reason: string;
  /** The region as it is now, for a hand-edit refusal, so the divergence is shown rather than described. */
  current?: string;
}

export interface ContentPatchPlan {
  patches: ContentPatch[];
  refusals: ContentPatchRefusal[];
  /** Anchored regions whose copy has not changed since they were written. */
  unchanged: number;
  /** Nodes drawn after the emit: they have no anchor and are not inserted. */
  unanchored: string[];
  /** Every file a patch touches, with its new text. */
  files: Array<{ path: string; contents: string }>;
  /** The manifest after these patches, to be written with them. */
  manifest: UiEmitManifest;
  summary: string;
}

export interface ContentPatchInput {
  manifest: UiEmitManifest;
  files: ReadonlyMap<string, string | undefined>;
  copy: readonly SurfaceNodeCopy[];
  now: string;
}

/**
 * Bring the engine file's words up to Studio's, region by region, and nothing
 * else. Every region is located by anchor in the file as it is now; a region
 * that cannot be found, or that somebody edited, is refused by name and the
 * others still go through.
 */
export function planContentPatch(input: ContentPatchInput): ContentPatchPlan {
  const { manifest } = input;
  const grammar = grammarFor(manifest.targetId);
  const target = uiEmitTarget(manifest.targetId);
  const patches: ContentPatch[] = [];
  const refusals: ContentPatchRefusal[] = [];
  let unchanged = 0;
  const nextAnchors: UiEmitAnchor[] = [];

  for (const anchor of manifest.anchors) {
    const entry = input.copy.find(candidate => candidate.nodeId === anchor.nodeId);
    if (!entry) {
      refusals.push({ nodeId: anchor.nodeId, code: 'node-removed', reason: `${anchor.nodeId} was removed in Studio. Its region stays in ${anchor.filePath}; removing it is ${target.engineLabel}'s act.` });
      nextAnchors.push(anchor);
      continue;
    }
    const copyFingerprint = fingerprintSurfaceCopy(entry);
    if (copyFingerprint === anchor.copyFingerprint) {
      unchanged += 1;
      nextAnchors.push(anchor);
      continue;
    }
    const text = input.files.get(anchor.filePath);
    if (text === undefined) {
      refusals.push({ nodeId: anchor.nodeId, code: 'file-missing', reason: `${anchor.filePath} is missing.` });
      nextAnchors.push(anchor);
      continue;
    }
    const span = grammar.locate(text, anchor.nodeId);
    if (span === 'missing') {
      refusals.push({ nodeId: anchor.nodeId, code: 'anchor-missing', reason: `The anchor for ${anchor.nodeId} is no longer in ${anchor.filePath}; the edit that removed it was ${target.engineLabel}'s.` });
      nextAnchors.push(anchor);
      continue;
    }
    if (span === 'ambiguous') {
      refusals.push({ nodeId: anchor.nodeId, code: 'anchor-ambiguous', reason: `The anchor for ${anchor.nodeId} appears more than once in ${anchor.filePath}, so no region can be chosen.` });
      nextAnchors.push(anchor);
      continue;
    }
    const before = text.slice(span.start, span.end);
    if (grammar.fingerprint(text, span) !== anchor.regionFingerprint) {
      refusals.push({
        nodeId: anchor.nodeId,
        code: 'region-edited',
        reason: `The region for ${anchor.nodeId} was edited in ${target.engineLabel} since it was written. Studio will not overwrite it.`,
        current: before.slice(0, 600),
      });
      nextAnchors.push(anchor);
      continue;
    }
    const context: RenderContext = { parentPath: anchor.context?.['parentPath'] ?? '.', indent: anchor.context?.['indent'] ?? '' };
    const after = manifest.targetId === 'godot-control' ? `${grammar.render(entry, context).trimEnd()}\n\n` : grammar.render(entry, context);
    patches.push({ filePath: anchor.filePath, nodeId: anchor.nodeId, before, after });
    nextAnchors.push({
      ...anchor,
      regionFingerprint: grammar.fingerprint(after, { start: 0, end: after.length }),
      copyFingerprint,
    });
  }

  const anchored = new Set(manifest.anchors.map(anchor => anchor.nodeId));
  const unanchored = input.copy.map(entry => entry.nodeId).filter(nodeId => !anchored.has(nodeId));

  // Apply per file, later regions first, so earlier offsets stay valid.
  const files: ContentPatchPlan['files'] = [];
  const byFile = new Map<string, ContentPatch[]>();
  for (const patch of patches) {
    byFile.set(patch.filePath, [...(byFile.get(patch.filePath) ?? []), patch]);
  }
  for (const [filePath, filePatches] of byFile) {
    let text = input.files.get(filePath) ?? '';
    const located = filePatches
      .map(patch => ({ patch, span: grammar.locate(text, patch.nodeId) }))
      .filter((item): item is { patch: ContentPatch; span: RegionSpan } => typeof item.span !== 'string')
      .sort((left, right) => right.span.start - left.span.start);
    for (const { patch, span } of located) {
      text = `${text.slice(0, span.start)}${patch.after}${text.slice(span.end)}`;
    }
    files.push({ path: filePath, contents: text });
  }

  const nextManifest: UiEmitManifest = {
    ...manifest,
    ...(patches.length > 0 ? { contentUpdatedAt: input.now } : {}),
    files: manifest.files.map(file => {
      const updated = files.find(candidate => candidate.path === file.path);
      return updated ? { ...file, fingerprint: fingerprintText(updated.contents) } : file;
    }),
    anchors: nextAnchors,
  };

  const parts = [
    `${patches.length} region${patches.length === 1 ? '' : 's'} to update`,
    `${unchanged} unchanged`,
    ...(refusals.length > 0 ? [`${refusals.length} refused`] : []),
    ...(unanchored.length > 0 ? [`${unanchored.length} drawn after the emit and not inserted`] : []),
  ];
  return { patches, refusals, unchanged, unanchored, files, manifest: nextManifest, summary: parts.join(' · ') };
}

// ── Launch ─────────────────────────────────────────────────────────

export interface UiLaunchPlan {
  targetId: UiEmitTargetId;
  kind: UiLaunchTemplate['kind'];
  command?: string;
  args?: string[];
  /** Workspace-relative file to open, for `open-file`. */
  filePath?: string;
  manualOnly: boolean;
  reason: string;
}

/**
 * How to see the emitted surface in its engine. The argv is the target's
 * constant with two placeholders filled; nothing from a message reaches it.
 */
export function planSurfaceLaunch(
  manifest: UiEmitManifest,
  workspaceRoot: string,
): UiLaunchPlan {
  const target = uiEmitTarget(manifest.targetId);
  const primary = manifest.files.find(file => !file.shared);
  const scenePath = primary?.path ?? '';
  const template = target.launch;
  if (template.kind === 'open-file') {
    return { targetId: target.id, kind: 'open-file', filePath: scenePath, manualOnly: false, reason: template.reason };
  }
  if (template.kind === 'command' && template.command) {
    return {
      targetId: target.id,
      kind: 'command',
      command: template.command,
      args: (template.args ?? []).map(argument => argument
        .replace('{workspaceRoot}', workspaceRoot)
        .replace('{scenePath}', scenePath)),
      manualOnly: template.manualOnly === true,
      reason: template.reason,
    };
  }
  return { targetId: target.id, kind: 'none', manualOnly: false, reason: template.reason };
}

// ── Manifests at the boundary ──────────────────────────────────────

/** A committed manifest is a workspace file, so it is read as untrusted. */
export function sanitizeUiEmitManifest(input: unknown): UiEmitManifest | undefined {
  if (!input || typeof input !== 'object') { return undefined; }
  const record = input as Record<string, unknown>;
  if (record['version'] !== 1 || !isUiEmitTargetId(record['targetId'])) { return undefined; }
  const screenId = identifier(record['screenId']);
  const pageId = identifier(record['pageId']);
  const emittedAt = isoDate(record['emittedAt']);
  const graphRevision = typeof record['graphRevision'] === 'number' && Number.isInteger(record['graphRevision']) && record['graphRevision'] >= 0
    ? record['graphRevision'] : undefined;
  if (!screenId || !pageId || !emittedAt || graphRevision === undefined) { return undefined; }
  const files = Array.isArray(record['files'])
    ? record['files'].flatMap(entry => {
      const file = entry as Record<string, unknown>;
      const path = typeof file?.['path'] === 'string' && !validateOutputRoot(file['path']) ? file['path'] : undefined;
      const fingerprint = typeof file?.['fingerprint'] === 'string' && /^[0-9a-f]{24}$/.test(file['fingerprint']) ? file['fingerprint'] : undefined;
      return path && fingerprint ? [{ path, fingerprint, shared: file['shared'] === true }] : [];
    }).slice(0, 20)
    : [];
  const anchors = Array.isArray(record['anchors'])
    ? record['anchors'].flatMap(entry => {
      const anchor = entry as Record<string, unknown>;
      const nodeId = identifier(anchor?.['nodeId']);
      const filePath = typeof anchor?.['filePath'] === 'string' && files.some(file => file.path === anchor['filePath']) ? anchor['filePath'] : undefined;
      const regionFingerprint = typeof anchor?.['regionFingerprint'] === 'string' && /^[0-9a-f]{24}$/.test(anchor['regionFingerprint']) ? anchor['regionFingerprint'] : undefined;
      const copyFingerprint = typeof anchor?.['copyFingerprint'] === 'string' && /^[0-9a-f]{24}$/.test(anchor['copyFingerprint']) ? anchor['copyFingerprint'] : undefined;
      if (!nodeId || !filePath || !regionFingerprint || !copyFingerprint) { return []; }
      const context = anchor['context'] && typeof anchor['context'] === 'object'
        ? Object.fromEntries(Object.entries(anchor['context'] as Record<string, unknown>)
          .filter(([key, value]) => (key === 'parentPath' || key === 'indent') && typeof value === 'string' && value.length <= 400)
          .map(([key, value]) => [key, (value as string).replace(CONTROL_CHARS, '')]))
        : undefined;
      return [{ nodeId, filePath, regionFingerprint, copyFingerprint, ...(context && Object.keys(context).length > 0 ? { context } : {}) }];
    }).slice(0, 500)
    : [];
  if (files.length === 0) { return undefined; }
  const contentUpdatedAt = isoDate(record['contentUpdatedAt']);
  return {
    version: 1,
    targetId: record['targetId'],
    screenId,
    pageId,
    emittedAt,
    ...(contentUpdatedAt ? { contentUpdatedAt } : {}),
    graphRevision,
    files,
    anchors,
  };
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value) ? value : undefined;
}

function isoDate(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) && !Number.isNaN(Date.parse(value))
    ? value : undefined;
}
