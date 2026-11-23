// Packaged-VSIX smoke test: loads the extension exactly as the VSIX ships it
// (the unpacked `extension/` folder, its own node_modules, nothing from the
// source tree), activates it against a recording stand-in for the `vscode`
// API, and checks that activation finishes and every contributed command is
// registered. Then it runs the core commands that need no UI round trip.
//
// Why a stand-in host rather than a real VS Code window: the gate runs from a
// scheduled task on the maintainer's desktop, where a window must never open.
// `code --install-extension` (run by the gate before this) proves the VSIX
// installs; this proves the packaged code activates and wires its commands.
//
// Usage: node vsix-smoke.cjs <unpacked-extension-dir>
// Exit 0 = pass. Any other exit = fail (fail closed: a crash is a failure).
'use strict';

const path = require('node:path');
const Module = require('node:module');

const extensionDir = path.resolve(process.argv[2] ?? '');
const manifest = require(path.join(extensionDir, 'package.json'));
const ACTIVATION_TIMEOUT_MS = 60_000;
const COMMAND_TIMEOUT_MS = 15_000;

// Commands that read state and render a panel or tree: they must run without
// throwing once activation is done. Kept small and stable on purpose.
const CORE_COMMANDS = [
  'atlasmind.openGettingStarted',
  'atlasmind.openSettings',
  'atlasmind.openChatPanel',
  'atlasmind.collapseAllSidebarTrees',
];

const registered = new Map();
const errors = [];
const outputLines = [];

/** A value that absorbs any use: property reads, calls, `new`, iteration. */
function inert(name) {
  const fn = function () {};
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === 'then') return undefined; // never a thenable: `await` must not hang
      if (prop === Symbol.iterator) return function* () {};
      if (prop === Symbol.asyncIterator) return async function* () {};
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'toString' || prop === 'toJSON') return () => '';
      if (prop === 'length') return 0;
      if (prop === 'dispose') return () => undefined;
      return inert(`${name}.${String(prop)}`);
    },
    apply: () => inert(`${name}()`),
    construct: () => inert(`new ${name}`),
  });
}

/** An object whose listed members are real and whose others are inert. */
function partial(name, members) {
  return new Proxy(members, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return inert(`${name}.${String(prop)}`);
    },
  });
}

const memento = () => {
  const store = new Map();
  return partial('memento', {
    get: (k, d) => (store.has(k) ? store.get(k) : d),
    update: async (k, v) => { store.set(k, v); },
    keys: () => [...store.keys()],
    setKeysForSync: () => undefined,
  });
};

class EventEmitter {
  constructor() { this.listeners = new Set(); this.event = (fn) => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; }; }
  fire(value) { for (const fn of this.listeners) fn(value); }
  dispose() { this.listeners.clear(); }
}
class Disposable {
  constructor(fn) { this.fn = fn; }
  static from(...items) { return new Disposable(() => items.forEach((d) => d?.dispose?.())); }
  dispose() { this.fn?.(); }
}

// The browser bundle reaches `vscode` through esbuild's ESM interop, which
// copies own properties and so never sees the proxy's fallback: everything the
// web entry constructs or reads at activation has to be a real member here.
const vscode = partial('vscode', {
  version: '1.120.0',
  EventEmitter,
  Disposable,
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeIcon: class ThemeIcon { constructor(id) { this.id = id; } },
  ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  commands: partial('commands', {
    registerCommand: (id, fn) => { registered.set(id, fn); return { dispose() {} }; },
    registerTextEditorCommand: (id, fn) => { registered.set(id, fn); return { dispose() {} }; },
    executeCommand: async (id, ...args) => (registered.has(id) ? registered.get(id)(...args) : undefined),
    getCommands: async () => [...registered.keys()],
  }),
  Uri: partial('Uri', {
    file: (p) => partial('uri', { fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` }),
    parse: (s) => partial('uri', { fsPath: s, path: s, scheme: 'file', toString: () => s }),
    joinPath: (base, ...parts) => {
      const p = path.join(base.fsPath ?? '', ...parts);
      return partial('uri', { fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` });
    },
  }),
  window: partial('window', {
    createOutputChannel: (name) => partial('outputChannel', {
      name,
      appendLine: (line) => { outputLines.push(String(line)); },
      append: (text) => { outputLines.push(String(text)); },
      show: () => undefined,
      dispose: () => undefined,
    }),
    // A startup error toast is AtlasMind telling the user it did not start.
    showErrorMessage: async (message) => { errors.push(`showErrorMessage: ${message}`); return undefined; },
  }),
  workspace: partial('workspace', {
    workspaceFolders: undefined,
    getConfiguration: () => partial('config', {
      get: (_k, d) => d,
      has: () => false,
      inspect: () => undefined,
      update: async () => undefined,
    }),
  }),
});

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

process.on('unhandledRejection', (reason) => { errors.push(`unhandled rejection: ${reason?.stack ?? reason}`); });

function withTimeout(promise, ms, label) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_r, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms).unref()),
  ]);
}

async function main() {
  const entry = path.join(extensionDir, manifest.main);
  const ext = require(entry);
  if (typeof ext.activate !== 'function') throw new Error(`${manifest.main} exports no activate()`);

  const storage = path.join(require('node:os').tmpdir(), `atlasmind-smoke-${process.pid}`);
  const context = partial('context', {
    subscriptions: [],
    extensionPath: extensionDir,
    extensionUri: vscode.Uri.file(extensionDir),
    globalState: memento(),
    workspaceState: memento(),
    globalStorageUri: vscode.Uri.file(storage),
    storageUri: undefined,
    logUri: vscode.Uri.file(storage),
    extensionMode: 1,
    asAbsolutePath: (p) => path.join(extensionDir, p),
    secrets: partial('secrets', { get: async () => undefined, store: async () => undefined, delete: async () => undefined, onDidChange: () => ({ dispose() {} }) }),
  });

  await withTimeout(ext.activate(context), ACTIVATION_TIMEOUT_MS, 'activate()');
  // activate() returns at once and boots in the background; it clears this
  // flag when bootstrap settles, on success and on failure alike.
  await withTimeout(new Promise((resolve) => {
    const tick = setInterval(() => {
      if (globalThis.atlasmindActivating === false) { clearInterval(tick); resolve(); }
    }, 100);
  }), ACTIVATION_TIMEOUT_MS, 'bootstrap');
  const failedSteps = outputLines.filter((l) => /(failed|threw|did not)/i.test(l));
  if (failedSteps.length) errors.push(`activation log reports failures:\n  ${failedSteps.join('\n  ')}`);

  // The browser entry (vscode.dev) registers the commands only it offers, such
  // as the remote-connection ones. Activate it too, against the same registry.
  if (manifest.browser) {
    const web = require(path.join(extensionDir, manifest.browser));
    if (typeof web.activate !== 'function') throw new Error(`${manifest.browser} exports no activate()`);
    await withTimeout(web.activate(context), ACTIVATION_TIMEOUT_MS, 'browser activate()');
  }

  const contributed = (manifest.contributes?.commands ?? []).map((c) => c.command);
  const missing = contributed.filter((id) => !registered.has(id));
  if (missing.length) errors.push(`contributed but not registered after activate(): ${missing.join(', ')}`);

  for (const id of CORE_COMMANDS) {
    if (!registered.has(id)) { errors.push(`core command missing: ${id}`); continue; }
    try {
      await withTimeout(registered.get(id)(), COMMAND_TIMEOUT_MS, id);
    } catch (err) {
      errors.push(`core command ${id} threw: ${err?.stack ?? err}`);
    }
  }

  console.log(`smoke: ${manifest.name}@${manifest.version} activated; ${registered.size} commands registered, ${contributed.length} contributed, ${CORE_COMMANDS.length} core commands run`);
}

main()
  .catch((err) => { errors.push(`activation failed: ${err?.stack ?? err}`); })
  .finally(() => {
    if (errors.length) {
      console.error(`smoke: FAIL\n- ${errors.join('\n- ')}`);
      process.exit(1);
    }
    console.log('smoke: PASS');
    process.exit(0);
  });
