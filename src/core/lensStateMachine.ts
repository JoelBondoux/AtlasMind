import type { LensSourceRange, LensVisualTarget, LensWorkspaceIdentity } from '../types.js';
import { createSourceLensTarget, normalizeLensTarget } from './lensTarget.js';

export const LENS_STATE_FILE = '.atlasmind/lens-state.json';
export const LENS_STATE_MAX_MACHINES = 50;
export const LENS_STATE_MAX_STATES = 120;
export const LENS_STATE_MAX_TRANSITIONS = 300;

export interface LensStateSource {
  workspacePath: string;
  range?: LensSourceRange;
}

export interface LensStateDeclaration {
  id: string;
  label: string;
  description?: string;
  terminal: boolean;
  source?: LensStateSource;
}

export interface LensTransitionDeclaration {
  id: string;
  from: string;
  to: string;
  event?: string;
  guard?: string;
  effect?: string;
  source?: LensStateSource;
}

export interface LensStateMachineDeclaration {
  id: string;
  label: string;
  description?: string;
  initial: string;
  states: LensStateDeclaration[];
  transitions: LensTransitionDeclaration[];
}

export interface LensStateMachineFile {
  version: 1;
  machines: LensStateMachineDeclaration[];
}

export interface LensStateMapNode extends LensStateDeclaration {
  initial: boolean;
  reachable: boolean;
  deadEnd: boolean;
  depth: number;
  target?: LensVisualTarget;
}

export interface LensStateMapTransition extends LensTransitionDeclaration {
  target?: LensVisualTarget;
}

export interface LensStateMap {
  version: 1;
  id: string;
  machineId: string;
  label: string;
  description?: string;
  initialStateId: string;
  states: LensStateMapNode[];
  transitions: LensStateMapTransition[];
  notices: string[];
}

/** Strictly normalize a bounded, repository-authored state-machine declaration. */
export function normalizeLensStateMachineFile(value: unknown): LensStateMachineFile | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.machines) || value.machines.length > LENS_STATE_MAX_MACHINES) {
    return undefined;
  }
  const machines: LensStateMachineDeclaration[] = [];
  const machineIds = new Set<string>();
  for (const candidate of value.machines) {
    const machine = normalizeMachine(candidate);
    if (!machine || machineIds.has(machine.id)) {
      return undefined;
    }
    machineIds.add(machine.id);
    machines.push(machine);
  }
  return { version: 1, machines };
}

/** Derive reachability and dead ends from one explicit declaration without executing project code. */
export function buildLensStateMap(
  candidate: LensStateMachineDeclaration,
  workspace: LensWorkspaceIdentity,
): LensStateMap {
  const normalized = normalizeMachine(candidate);
  const normalizedWorkspace = normalizeWorkspace(workspace);
  if (!normalized || !normalizedWorkspace) {
    throw new Error('AtlasMind Lens refused an invalid state-machine input.');
  }
  const outgoing = new Map<string, LensTransitionDeclaration[]>();
  for (const transition of normalized.transitions) {
    const entries = outgoing.get(transition.from) ?? [];
    entries.push(transition);
    outgoing.set(transition.from, entries);
  }
  const depths = new Map<string, number>([[normalized.initial, 0]]);
  const queue = [normalized.initial];
  while (queue.length > 0) {
    const from = queue.shift()!;
    const nextDepth = (depths.get(from) ?? 0) + 1;
    for (const transition of outgoing.get(from) ?? []) {
      if (!depths.has(transition.to)) {
        depths.set(transition.to, nextDepth);
        queue.push(transition.to);
      }
    }
  }
  const states = normalized.states.map(state => ({
    ...state,
    initial: state.id === normalized.initial,
    reachable: depths.has(state.id),
    deadEnd: !state.terminal && (outgoing.get(state.id)?.length ?? 0) === 0,
    depth: depths.get(state.id) ?? -1,
    ...toTarget(state.source, normalizedWorkspace, `State: ${state.label}`),
  }));
  const transitions = normalized.transitions.map(transition => ({
    ...transition,
    ...toTarget(transition.source, normalizedWorkspace, transition.event ? `Transition: ${transition.event}` : `Transition: ${transition.id}`),
  }));
  const unreachable = states.filter(state => !state.reachable).length;
  const deadEnds = states.filter(state => state.deadEnd).length;
  return {
    version: 1,
    id: `lens-state:${stableHash(`${normalized.id}:${normalizedWorkspace.name}:${normalizedWorkspace.index}`)}`,
    machineId: normalized.id,
    label: normalized.label,
    ...(normalized.description ? { description: normalized.description } : {}),
    initialStateId: normalized.initial,
    states,
    transitions,
    notices: [
      `Lifecycle structure comes only from ${LENS_STATE_FILE}; AtlasMind does not execute project code or infer runtime transitions.`,
      'Guards and effects are repository-authored labels, not proof that those conditions or side effects occur at runtime.',
      ...(unreachable > 0 ? [`${unreachable} state(s) are unreachable from the declared initial state.`] : []),
      ...(deadEnds > 0 ? [`${deadEnds} non-terminal state(s) have no declared outgoing transition.`] : []),
    ],
  };
}

function normalizeMachine(value: unknown): LensStateMachineDeclaration | undefined {
  if (
    !isRecord(value) || !Array.isArray(value.states) || !Array.isArray(value.transitions) ||
    value.states.length === 0 || value.states.length > LENS_STATE_MAX_STATES ||
    value.transitions.length > LENS_STATE_MAX_TRANSITIONS
  ) {
    return undefined;
  }
  const id = boundedExactText(value.id, 200);
  const label = boundedText(value.label, 200);
  const description = value.description === undefined ? undefined : boundedText(value.description, 500);
  const initial = boundedExactText(value.initial, 200);
  if (!id || !label || !initial || (value.description !== undefined && !description)) {
    return undefined;
  }
  const states: LensStateDeclaration[] = [];
  const stateIds = new Set<string>();
  for (const candidate of value.states) {
    const state = normalizeState(candidate);
    if (!state || stateIds.has(state.id)) {
      return undefined;
    }
    stateIds.add(state.id);
    states.push(state);
  }
  if (!stateIds.has(initial)) {
    return undefined;
  }
  const transitions: LensTransitionDeclaration[] = [];
  const transitionIds = new Set<string>();
  for (const candidate of value.transitions) {
    const transition = normalizeTransition(candidate);
    if (
      !transition || transitionIds.has(transition.id) ||
      !stateIds.has(transition.from) || !stateIds.has(transition.to)
    ) {
      return undefined;
    }
    transitionIds.add(transition.id);
    transitions.push(transition);
  }
  return {
    id,
    label,
    ...(description ? { description } : {}),
    initial,
    states,
    transitions,
  };
}

function normalizeState(value: unknown): LensStateDeclaration | undefined {
  if (!isRecord(value) || (value.terminal !== undefined && typeof value.terminal !== 'boolean')) {
    return undefined;
  }
  const id = boundedExactText(value.id, 200);
  const label = boundedText(value.label, 200);
  const description = value.description === undefined ? undefined : boundedText(value.description, 500);
  const source = value.source === undefined ? undefined : normalizeSource(value.source);
  if (!id || !label || (value.description !== undefined && !description) || (value.source !== undefined && !source)) {
    return undefined;
  }
  return {
    id,
    label,
    ...(description ? { description } : {}),
    terminal: value.terminal === true,
    ...(source ? { source } : {}),
  };
}

function normalizeTransition(value: unknown): LensTransitionDeclaration | undefined {
  if (!isRecord(value)) return undefined;
  const id = boundedExactText(value.id, 200);
  const from = boundedExactText(value.from, 200);
  const to = boundedExactText(value.to, 200);
  const event = value.event === undefined ? undefined : boundedText(value.event, 200);
  const guard = value.guard === undefined ? undefined : boundedText(value.guard, 300);
  const effect = value.effect === undefined ? undefined : boundedText(value.effect, 300);
  const source = value.source === undefined ? undefined : normalizeSource(value.source);
  if (
    !id || !from || !to ||
    (value.event !== undefined && !event) || (value.guard !== undefined && !guard) ||
    (value.effect !== undefined && !effect) || (value.source !== undefined && !source)
  ) {
    return undefined;
  }
  return {
    id,
    from,
    to,
    ...(event ? { event } : {}),
    ...(guard ? { guard } : {}),
    ...(effect ? { effect } : {}),
    ...(source ? { source } : {}),
  };
}

function normalizeSource(value: unknown): LensStateSource | undefined {
  if (!isRecord(value)) return undefined;
  const workspacePath = normalizeRelativePath(value.workspacePath);
  const range = value.range === undefined ? undefined : normalizeRange(value.range);
  return workspacePath && (value.range === undefined || range)
    ? { workspacePath, ...(range ? { range } : {}) }
    : undefined;
}

function normalizeRange(value: unknown): LensSourceRange | undefined {
  if (!isRecord(value)) return undefined;
  const numbers = [value.startLine, value.startColumn, value.endLine, value.endColumn];
  if (!numbers.every(entry => Number.isInteger(entry) && Number(entry) > 0)) return undefined;
  const range = {
    startLine: Number(value.startLine),
    startColumn: Number(value.startColumn),
    endLine: Number(value.endLine),
    endColumn: Number(value.endColumn),
  };
  return range.endLine > range.startLine ||
    (range.endLine === range.startLine && range.endColumn >= range.startColumn)
    ? range
    : undefined;
}

function toTarget(
  source: LensStateSource | undefined,
  workspace: LensWorkspaceIdentity,
  label: string,
): { target?: LensVisualTarget } {
  if (!source) return {};
  const sourceTarget = createSourceLensTarget({
    kind: source.range ? 'symbol' : 'file',
    label,
    workspace,
    workspacePath: source.workspacePath,
    ...(source.range ? { range: source.range } : {}),
  });
  const target = normalizeLensTarget({
    ...sourceTarget,
    evidence: { kind: 'declared', source: LENS_STATE_FILE, confidence: 1 },
  });
  return target ? { target } : {};
}

function normalizeWorkspace(value: LensWorkspaceIdentity): LensWorkspaceIdentity | undefined {
  const name = boundedText(value?.name, 200);
  return name && Number.isInteger(value?.index) && value.index >= 0
    ? { name, index: value.index }
    : undefined;
}

function normalizeRelativePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.length > 500 || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return undefined;
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..') ? undefined : segments.join('/');
}

function boundedExactText(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : undefined;
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximum) : undefined;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
