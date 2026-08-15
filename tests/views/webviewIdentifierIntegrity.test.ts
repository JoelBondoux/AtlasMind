import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as acorn from 'acorn';

/**
 * A webview script is never type-checked and never imported by a test — it is a
 * string handed to a browser. So a renamed function leaves its old call site
 * behind, `tsc` says nothing, every unit test passes, and the failure arrives as
 * a `ReferenceError` at render time that takes down the **entire** panel: the
 * user sees "Dashboard refresh failed" and no dashboard at all.
 *
 * That shipped. `directorBoundAgentIds` was pluralised when a Buzz identity
 * became bindable to several agents, and one call to `directorBoundAgentId`
 * survived in the contact-card renderer — a code path that only runs when a
 * contact has a Buzz link, which is why it got through review and testing.
 *
 * This walks the real AST of each webview script and asserts every identifier it
 * *reads* is actually bound somewhere: declared in the file, a function
 * parameter, or a known browser/host global. Parsing rather than pattern
 * matching is the point — prose like "3 subtask(s) recorded" inside a template
 * literal is indistinguishable from a call to `subtask()` under a regex.
 */

const WEBVIEW_SCRIPTS = ['media/projectDashboard.js', 'media/projectIdeation.js', 'media/chatPanel.js'];

/** Globals a VS Code webview genuinely has. */
const HOST_GLOBALS = new Set([
  // Standard library
  'Array', 'BigInt', 'Boolean', 'Date', 'Error', 'Function', 'Infinity', 'Intl', 'JSON', 'Map', 'Math',
  'NaN', 'Number', 'Object', 'Promise', 'Proxy', 'Reflect', 'RegExp', 'Set', 'String', 'Symbol',
  'TypeError', 'URL', 'URLSearchParams', 'WeakMap', 'WeakSet', 'undefined', 'globalThis',
  'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'isFinite', 'isNaN',
  'parseFloat', 'parseInt', 'structuredClone', 'queueMicrotask',
  // Binary data, for the composer's dictation capture: raw PCM is merged,
  // downsampled and written into a WAV header before it leaves the webview.
  'ArrayBuffer', 'DataView', 'Float32Array', 'Uint8Array', 'Int16Array',
  // Browser / DOM
  'document', 'window', 'console', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'fetch', 'alert', 'confirm', 'prompt', 'getComputedStyle', 'matchMedia', 'ResizeObserver', 'MutationObserver',
  'IntersectionObserver', 'Event', 'CustomEvent', 'DataTransfer', 'FileReader', 'Blob', 'FormData', 'Image',
  'SpeechSynthesisUtterance', 'speechSynthesis', 'AbortController', 'TextEncoder', 'TextDecoder', 'atob', 'btoa',
  'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLSelectElement',
  'HTMLAnchorElement', 'HTMLUListElement', 'HTMLFormElement', 'HTMLImageElement', 'HTMLCanvasElement',
  'Element', 'Node', 'NodeList', 'NodeFilter', 'SVGElement', 'DOMParser', 'CSS', 'performance', 'crypto',
  // Supplied by the webview host
  'acquireVsCodeApi',
]);

/** Names a program binds: declarations, params, imports, catch clauses, labels. */
function collectBindings(program: acorn.Node): Set<string> {
  const bound = new Set<string>();
  const addPattern = (node: unknown): void => {
    const pattern = node as { type?: string; name?: string; properties?: unknown[]; elements?: unknown[]; argument?: unknown; left?: unknown; value?: unknown };
    if (!pattern || typeof pattern.type !== 'string') {
      return;
    }
    switch (pattern.type) {
      case 'Identifier':
        if (pattern.name) { bound.add(pattern.name); }
        return;
      case 'ObjectPattern':
        for (const property of pattern.properties ?? []) {
          const prop = property as { type?: string; value?: unknown; argument?: unknown };
          addPattern(prop.type === 'RestElement' ? prop.argument : prop.value);
        }
        return;
      case 'ArrayPattern':
        for (const element of pattern.elements ?? []) { addPattern(element); }
        return;
      case 'RestElement':
        addPattern(pattern.argument);
        return;
      case 'AssignmentPattern':
        addPattern(pattern.left);
        return;
      default:
        return;
    }
  };

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) { walk(child); }
      return;
    }
    const current = node as Record<string, unknown> & { type?: string };
    switch (current.type) {
      case 'VariableDeclarator':
        addPattern(current['id']);
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (current['id']) { addPattern(current['id']); }
        for (const param of (current['params'] as unknown[]) ?? []) { addPattern(param); }
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (current['id']) { addPattern(current['id']); }
        break;
      case 'CatchClause':
        if (current['param']) { addPattern(current['param']); }
        break;
      case 'LabeledStatement':
        addPattern(current['label']);
        break;
      default:
        break;
    }
    for (const key of Object.keys(current)) {
      if (key === 'type' || key === 'start' || key === 'end') { continue; }
      walk(current[key]);
    }
  };

  walk(program);
  return bound;
}

/** Identifiers actually *read* — property keys and member accesses excluded. */
function collectReferences(program: acorn.Node): Map<string, number> {
  const references = new Map<string, number>();
  const walk = (node: unknown, parent: Record<string, unknown> | undefined, key: string | undefined): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) { walk(child, parent, key); }
      return;
    }
    const current = node as Record<string, unknown> & { type?: string; name?: string; computed?: boolean };
    if (current.type === 'Identifier' && typeof current.name === 'string') {
      const parentType = parent?.['type'];
      // `a.b` — `b` is a property, not a reference.
      const isMemberProperty = parentType === 'MemberExpression' && key === 'property' && parent?.['computed'] !== true;
      // `{ b: 1 }` — `b` is a key, not a reference.
      const isObjectKey = parentType === 'Property' && key === 'key' && parent?.['computed'] !== true;
      const isMethodName = parentType === 'MethodDefinition' && key === 'key';
      const isLabel = parentType === 'LabeledStatement' || parentType === 'BreakStatement' || parentType === 'ContinueStatement';
      if (!isMemberProperty && !isObjectKey && !isMethodName && !isLabel) {
        references.set(current.name, (references.get(current.name) ?? 0) + 1);
      }
    }
    for (const childKey of Object.keys(current)) {
      if (childKey === 'type' || childKey === 'start' || childKey === 'end') { continue; }
      walk(current[childKey], current, childKey);
    }
  };
  walk(program, undefined, undefined);
  return references;
}

describe('webview scripts reference only identifiers that exist', () => {
  for (const relativePath of WEBVIEW_SCRIPTS) {
    it(`${relativePath} has no unbound identifier`, () => {
      const source = readFileSync(path.join(process.cwd(), relativePath), 'utf8');
      const program = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'script' });
      const bound = collectBindings(program);
      const unbound = [...collectReferences(program).keys()]
        .filter(name => !bound.has(name) && !HOST_GLOBALS.has(name))
        .sort();

      expect(unbound, `unbound identifiers in ${relativePath}: ${unbound.join(', ')}`).toEqual([]);
    });
  }

  it('catches exactly the class of bug that shipped', () => {
    // The regression this file exists for: a call left behind by a rename.
    const program = acorn.parse('function directorBoundAgentIds() { return []; } directorBoundAgentId("buzz");', { ecmaVersion: 2022 });
    const bound = collectBindings(program);
    const unbound = [...collectReferences(program).keys()].filter(name => !bound.has(name) && !HOST_GLOBALS.has(name));
    expect(unbound).toEqual(['directorBoundAgentId']);
  });

  it('does not mistake prose in a template literal for a call', () => {
    // "3 subtask(s) recorded" is indistinguishable from `subtask()` to a regex.
    const program = acorn.parse('const n = 3; const s = `${n} subtask(s) recorded`;', { ecmaVersion: 2022 });
    const bound = collectBindings(program);
    const unbound = [...collectReferences(program).keys()].filter(name => !bound.has(name) && !HOST_GLOBALS.has(name));
    expect(unbound).toEqual([]);
  });
});
