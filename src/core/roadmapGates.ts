/**
 * RoadmapGates — the release milestones a roadmap item can be tagged for.
 *
 * The Roadmap dashboard only ever knew one gate: `#mvp`. That is the right first
 * gate and the wrong only gate — a project that has shipped its MVP still needs
 * to say "this belongs to the public beta" or "this is v2", and had nowhere to
 * record it. This module generalises the single hard-coded tag into a small,
 * user-defined set while keeping `#mvp` built in, so every existing roadmap file
 * keeps working unchanged and the MVP path keeps its special place.
 *
 * Two design choices worth stating:
 *
 * 1. **A tag is a gate only when it has been declared.** Gates live in their own
 *    managed block in `improvement-plan.md`, and only a declared id (plus the
 *    built-in `mvp`) is read as a gate — so an item reading `fix the #2 case`
 *    does not silently invent a gate called "2". Creating a gate is an explicit
 *    act, which also means removing one cannot lose an item.
 * 2. **Everything stays in the roadmap file.** Gates are markdown in the same
 *    SSOT document as the backlog they describe: readable, diffable, and
 *    reviewable in a pull request, with no second source of truth to drift.
 *
 * Pure and `vscode`-free so the parse/serialise round trip is unit-tested.
 */

export interface RoadmapGate {
  /** Tag id as it appears after `#`, e.g. `mvp`, `beta`, `v1.0`. */
  id: string;
  /** Human label shown in the UI, e.g. `Public beta`. */
  label: string;
  /** File order; lower comes first. */
  order: number;
  /** True only for `mvp`, which is always present and cannot be removed. */
  builtIn: boolean;
}

export const MVP_GATE_ID = 'mvp';
export const ROADMAP_GATES_START = '<!-- atlasmind:roadmap-gates:start -->';
export const ROADMAP_GATES_END = '<!-- atlasmind:roadmap-gates:end -->';
export const ROADMAP_GATES_HEADING = '### Release gates';

/** Enough for any real release plan; a bound the UI and the file can both hold. */
export const MAX_ROADMAP_GATES = 12;
const MAX_GATE_ID = 24;
const MAX_GATE_LABEL = 48;

/** The gate that always exists, so an untagged project still has an MVP path. */
export function builtInMvpGate(): RoadmapGate {
  return { id: MVP_GATE_ID, label: 'MVP', order: 0, builtIn: true };
}

/**
 * Coerce user input into a safe gate id.
 *
 * Gates become `#tags` inside a markdown document and object keys in the
 * dashboard snapshot, so the character set is deliberately narrow: lowercase
 * alphanumerics, dots and dashes, starting with an alphanumeric. Anything else
 * returns `''` and the caller refuses the gate rather than writing a tag that
 * would not parse back.
 */
export function slugifyGateId(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')
    .slice(0, MAX_GATE_ID);
  return /^[a-z0-9][a-z0-9.-]*$/.test(slug) ? slug : '';
}

function cleanLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const cleaned = value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_GATE_LABEL);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Read the declared gates from a roadmap document.
 *
 * `mvp` is always present and always first, whether or not the block names it —
 * an editing accident must not be able to delete the MVP path. Unparseable lines
 * are ignored rather than guessed at.
 */
export function parseRoadmapGates(content: string): RoadmapGate[] {
  const gates: RoadmapGate[] = [builtInMvpGate()];
  const seen = new Set<string>([MVP_GATE_ID]);

  const start = typeof content === 'string' ? content.indexOf(ROADMAP_GATES_START) : -1;
  const end = typeof content === 'string' ? content.indexOf(ROADMAP_GATES_END) : -1;
  if (start >= 0 && end > start) {
    const region = content.slice(start + ROADMAP_GATES_START.length, end);
    for (const line of region.split(/\r?\n/)) {
      const match = /^\s*[-*]\s*`?#([A-Za-z0-9.\-_]+)`?\s*(?:[—–:-]\s*(.*))?$/.exec(line);
      if (!match) {
        continue;
      }
      const id = slugifyGateId(match[1]);
      if (!id || seen.has(id)) {
        continue;
      }
      if (gates.length >= MAX_ROADMAP_GATES) {
        break;
      }
      seen.add(id);
      gates.push({
        id,
        label: cleanLabel(match[2], id === MVP_GATE_ID ? 'MVP' : id),
        order: gates.length,
        builtIn: id === MVP_GATE_ID,
      });
    }
    // A label given for the built-in gate is honoured; its position is not.
    const declaredMvp = /^\s*[-*]\s*`?#mvp`?\s*(?:[—–:-]\s*(.*))?$/im.exec(region);
    if (declaredMvp?.[1]) {
      gates[0] = { ...gates[0]!, label: cleanLabel(declaredMvp[1], 'MVP') };
    }
  }

  return gates.map((gate, index) => ({ ...gate, order: index }));
}

/** Render the managed gates block, including its heading. */
export function renderRoadmapGatesBlock(gates: RoadmapGate[]): string {
  const normalized = normalizeGates(gates);
  return [
    ROADMAP_GATES_HEADING,
    ROADMAP_GATES_START,
    ...normalized.map(gate => `- \`#${gate.id}\` — ${gate.label}`),
    ROADMAP_GATES_END,
  ].join('\n');
}

/**
 * De-duplicate, bound, and re-order a gate list, keeping `mvp` first.
 * Gates whose id cannot be made safe are dropped rather than repaired.
 */
export function normalizeGates(gates: RoadmapGate[] | undefined): RoadmapGate[] {
  const out: RoadmapGate[] = [builtInMvpGate()];
  const seen = new Set<string>([MVP_GATE_ID]);
  for (const gate of gates ?? []) {
    const id = slugifyGateId(gate?.id);
    if (!id) {
      continue;
    }
    if (id === MVP_GATE_ID) {
      out[0] = { ...out[0]!, label: cleanLabel(gate?.label, 'MVP') };
      continue;
    }
    if (seen.has(id) || out.length >= MAX_ROADMAP_GATES) {
      continue;
    }
    seen.add(id);
    out.push({ id, label: cleanLabel(gate?.label, id), order: out.length, builtIn: false });
  }
  return out.map((gate, index) => ({ ...gate, order: index }));
}

/**
 * Replace (or insert) the managed gates block in a roadmap document.
 *
 * Insertion goes immediately after the backlog block so the gates read as a
 * property of the list they tag; documents without that marker get the block
 * appended. Only the managed block is ever rewritten.
 */
export function upsertRoadmapGatesBlock(existing: string, gates: RoadmapGate[], itemsEndMarker: string): string {
  const block = renderRoadmapGatesBlock(gates);
  const source = typeof existing === 'string' ? existing : '';

  const start = source.indexOf(ROADMAP_GATES_START);
  const end = source.indexOf(ROADMAP_GATES_END);
  if (start >= 0 && end > start) {
    const headingStart = source.lastIndexOf(ROADMAP_GATES_HEADING, start);
    const replaceFrom = headingStart >= 0 && headingStart < start ? headingStart : start;
    return `${source.slice(0, replaceFrom)}${block}${source.slice(end + ROADMAP_GATES_END.length)}`;
  }

  const markerIndex = source.indexOf(itemsEndMarker);
  if (markerIndex >= 0) {
    const insertAt = markerIndex + itemsEndMarker.length;
    return `${source.slice(0, insertAt)}\n\n${block}\n${source.slice(insertAt)}`;
  }
  return `${source.trimEnd()}\n\n${block}\n`;
}

/** Remove the managed gates block so item parsing can never read it as backlog. */
export function stripRoadmapGatesBlock(content: string): string {
  if (typeof content !== 'string') {
    return '';
  }
  const start = content.indexOf(ROADMAP_GATES_START);
  const end = content.indexOf(ROADMAP_GATES_END);
  if (start < 0 || end <= start) {
    return content;
  }
  return `${content.slice(0, start)}${content.slice(end + ROADMAP_GATES_END.length)}`;
}

/**
 * Split an item's text from the gate tags it carries.
 *
 * Only *declared* gates are recognised, so `fix the #2 case` keeps its text
 * intact instead of inventing a gate. Tag matching is case-insensitive; the
 * returned ids are canonical.
 */
export function extractItemGates(text: string, gates: RoadmapGate[]): { text: string; gates: string[] } {
  const raw = typeof text === 'string' ? text : '';
  const known = new Map(normalizeGates(gates).map(gate => [gate.id, gate.id] as const));
  const found: string[] = [];
  let stripped = raw;

  for (const id of known.keys()) {
    // Escape the id (dots are legal in a gate id) and require a tag boundary so
    // `#v1` never matches inside `#v10`.
    const pattern = new RegExp(`(^|\\s)#${id.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?![\\w.-])`, 'ig');
    if (pattern.test(stripped)) {
      found.push(id);
      stripped = stripped.replace(pattern, '$1').trim();
    }
  }

  return { text: stripped.replace(/\s{2,}/g, ' ').trim(), gates: found };
}

/** Render an item's gate tags for persistence, in declared order. */
export function formatItemGateTags(itemGates: string[] | undefined, gates: RoadmapGate[]): string {
  const declared = normalizeGates(gates);
  const selected = new Set((itemGates ?? []).map(id => slugifyGateId(id)).filter(Boolean));
  const tags = declared.filter(gate => selected.has(gate.id)).map(gate => `#${gate.id}`);
  return tags.length > 0 ? ` ${tags.join(' ')}` : '';
}

/**
 * Keep only gate ids that are actually declared.
 *
 * The webview supplies these, so an unknown id is dropped rather than written as
 * a tag nobody can see or remove in the UI.
 */
export function sanitizeGateSelection(value: unknown, gates: RoadmapGate[]): string[] {
  const declared = new Set(normalizeGates(gates).map(gate => gate.id));
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of value.slice(0, MAX_ROADMAP_GATES)) {
    const id = slugifyGateId(entry);
    if (id && declared.has(id) && !out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}
