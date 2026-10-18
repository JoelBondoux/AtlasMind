import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Project memory is read and written through one home resolution, or not at all.
 *
 * `docs/project-composition.md` §2.6 says there is one SSOT and it lives in the
 * home component; §8.2 locates that home in a multi-root workspace with
 * `ssotHomeRoot()`. 0.498.0 moved *some* surfaces to it and left the rest on the
 * first folder, which is a split brain: the dashboard read the register from the
 * home while the register's manager wrote it to folder 0, so a status change
 * vanished on the next render and the change landed in a repository nobody was
 * looking at. Two answers to "where is project memory?" is worse than either
 * answer alone, because each half looks correct on its own.
 *
 * So this is a static guard, built on the TypeScript AST rather than a regex,
 * because the question is about *data flow* — does the root a project-memory
 * path is joined onto come from the first folder? — and a line-based scan cannot
 * follow `const root = defaultWorkspaceRootPath();` to the `readDebtRegister(root)`
 * forty lines further down.
 *
 * - A **first-folder source** is `defaultWorkspaceRootPath()`,
 *   `defaultWorkspaceFolder()`, `openWorkspaceFolders()[0]` or a direct
 *   `workspaceFolders[0]` read. A variable (or `this.x`) initialised from one is
 *   tainted, and so is anything initialised from a tainted value.
 * - An **SSOT sink** is a path join whose other part is the SSOT path — a
 *   `project_memory` literal, an `*_SSOT_PATH` constant, the `ssotPath` setting
 *   under whatever name it was read into, or what a `…Path()` function that
 *   touches project memory returned — or a call to, or construction of, any
 *   function, method or class that touches project memory and takes the root
 *   first. That list is *derived* from the source, not written here, so a new
 *   register is covered the day it lands.
 * - A tainted value reaching a sink fails, naming the file, line and sink.
 *
 * The allowlist is small and every entry says why. Things that are *not* project
 * memory — git, CI, a component's own files, website output outside
 * `project_memory/`, and the workspace identity that keys cost history — never
 * touch a sink, so they need no entry.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Sites that may join project memory onto the first folder, keyed
 * `file::sink`, each with the reason. Keep it short: an entry is a decision
 * that the first folder is right *for project memory*, and that is rare.
 */
const ALLOWED_FIRST_FOLDER_SSOT: Readonly<Record<string, string>> = {
  'src/chat/participant.ts::joinPath(<first folder>, <project memory>)':
    'writeProjectRunSummaryReport writes to a configurable folder: inside the SSOT path it resolves the home '
    + '(and logs a refusal), outside it the first folder. The scan cannot see that the branch decides, '
    + 'because one join serves both; tests/views/ssotHomeSurface.test.ts pins the branch.',
};

interface Violation {
  file: string;
  line: number;
  sink: string;
}

const FIRST_FOLDER_CALLS = new Set(['defaultWorkspaceRootPath', 'defaultWorkspaceFolder']);
const JOIN_CALLS = new Set(['join', 'resolve', 'joinPath', 'RelativePattern']);
const SSOT_IDENTIFIER = /^(?:DEFAULT_SSOT_PATH|ssotPath|ssotRelPath|ssotRelativePath|normalizedSsot|[A-Z0-9_]*SSOT_PATH|[A-Z0-9_]*SSOT_DIR|COMPLIANCE_DIR|COMPLIANCE_EVIDENCE_DIR|UI_EMIT_MANIFEST_DIR)$/;
const ROOT_PARAMETER = /root/i;

function isProjectMemoryLiteral(text: string): boolean {
  return text === 'project_memory' || text.startsWith('project_memory/') || text.startsWith('/project_memory');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface ParsedFile {
  path: string;
  source: ts.SourceFile;
}

function parse(files: ReadonlyArray<{ path: string; text: string }>): ParsedFile[] {
  return files.map(file => ({
    path: file.path,
    source: ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  }));
}

/** Does this node, anywhere inside it, name project memory directly? */
function mentionsProjectMemory(node: ts.Node, holdsSsotPath: (name: string) => boolean = () => false): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) {
      return;
    }
    // The setting's own key: `getConfiguration('atlasmind').get('ssotPath')`
    // is the SSOT path under whatever name the caller gives it.
    if (ts.isStringLiteral(child) && child.text === 'ssotPath') {
      found = true;
      return;
    }
    if ((ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) && isProjectMemoryLiteral(child.text)) {
      found = true;
      return;
    }
    if (ts.isTemplateExpression(child) && isProjectMemoryLiteral(child.head.text.replace(/^\//, ''))) {
      found = true;
      return;
    }
    if (ts.isTemplateSpan(child) && /(?:^|\/)project_memory(?:\/|$)/.test(child.literal.text)) {
      found = true;
      return;
    }
    if (ts.isIdentifier(child) && !isPropertyName(child) && (SSOT_IDENTIFIER.test(child.text) || holdsSsotPath(child.text))) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/**
 * Is this expression a project-memory *path* — as opposed to something read
 * from one? A name holding the SSOT path keeps it through a join, a
 * normalisation, a string method or a conditional; it does not survive being
 * read (`readEmitManifest(uiEmitManifestPath(…))` is a manifest, not a path),
 * which is where following every mention would start flagging a file's
 * contents as a place.
 */
function isSsotPathExpression(
  node: ts.Expression,
  holdsSsotPath: (name: string) => boolean,
  pathMakers: ReadonlySet<string>,
): boolean {
  if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)) {
    return isSsotPathExpression(node.expression, holdsSsotPath, pathMakers);
  }
  if (ts.isConditionalExpression(node)) {
    return isSsotPathExpression(node.whenTrue, holdsSsotPath, pathMakers) || isSsotPathExpression(node.whenFalse, holdsSsotPath, pathMakers);
  }
  if (ts.isBinaryExpression(node)) {
    return isSsotPathExpression(node.left, holdsSsotPath, pathMakers) || isSsotPathExpression(node.right, holdsSsotPath, pathMakers);
  }
  if (ts.isCallExpression(node)) {
    const name = calleeName(node.expression);
    const pathLike = name !== undefined && (JOIN_CALLS.has(name) || pathMakers.has(name)
      || /path|ssot|normali[sz]e|relative|trim|replace|slice|split|join|toLowerCase/i.test(name));
    if (!pathLike) {
      return false;
    }
    const receiver = ts.isPropertyAccessExpression(node.expression) ? [node.expression.expression] : [];
    return (name !== undefined && pathMakers.has(name))
      || [...receiver, ...node.arguments].some(arg => mentionsProjectMemory(arg, holdsSsotPath));
  }
  if (ts.isPropertyAccessExpression(node)) {
    // `config.get('ssotPath')` goes through the call branch; a bare property is a value.
    return false;
  }
  return mentionsProjectMemory(node, holdsSsotPath);
}

/** `x` in `a.x` or `{ x: 1 }` names a property, not a variable. */
function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return Boolean(parent && ((ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)));
}

/** Exported constants whose value is a project-memory path, by name, across `src/`. */
function deriveSsotConstants(files: readonly ParsedFile[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    for (const statement of file.source.statements) {
      if (!ts.isVariableStatement(statement)) {
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name)
          && initializer
          && (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer))
          && isProjectMemoryLiteral(initializer.text)
        ) {
          names.add(declaration.name.text);
        }
      }
    }
  }
  return names;
}

interface DeclaredFunction {
  /** `name` for a function or class, `Class.method` for a method. */
  key: string;
  /** Whether it takes the workspace root as its first argument. */
  rootFirst: boolean;
  body: ts.Node;
  /** The class a method belongs to, so `this.other()` inside it resolves. */
  className?: string;
}

/**
 * Every named function, class and method in a file. Exported or not: a private
 * helper that joins project memory onto whatever root it is handed is exactly
 * where a first-folder root does its damage, one call away from the read.
 */
function declaredFunctions(file: ParsedFile): DeclaredFunction[] {
  const out: DeclaredFunction[] = [];
  const takesRoot = (parameters: ts.NodeArray<ts.ParameterDeclaration> | undefined): boolean => {
    const first = parameters?.[0];
    return Boolean(first && ts.isIdentifier(first.name) && ROOT_PARAMETER.test(first.name.text));
  };
  const visit = (node: ts.Node, className: string | undefined): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      out.push({ key: node.name.text, rootFirst: takesRoot(node.parameters), body: node.body });
    }
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body && className) {
      out.push({ key: `${className}.${node.name.text}`, rootFirst: takesRoot(node.parameters), body: node.body, className });
    }
    if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text;
      const constructor = node.members.find(ts.isConstructorDeclaration);
      // A class touches project memory when its constructor or any method does;
      // constructing it is how a root reaches those methods.
      out.push({ key: name, rootFirst: takesRoot(constructor?.parameters), body: node, className: name });
      ts.forEachChild(node, child => visit(child, name));
      return;
    }
    ts.forEachChild(node, child => visit(child, className));
  };
  visit(file.source, undefined);
  return out;
}

/**
 * The declaration a call or construction refers to, as far as names can tell.
 *
 * `f()` and `ns.f()` resolve to a top-level `f`; `this.m()` to the enclosing
 * class's `m`; `new X()` and `new ns.X()` to the class `X`. A method called on
 * any other object is not resolved — its type is not known here, and guessing
 * by method name alone (`save`, `read`, `load`) would make every caller of
 * every `read()` look like a project-memory reader.
 */
function resolveCallee(
  node: ts.CallExpression | ts.NewExpression,
  className: string | undefined,
  topLevel: ReadonlySet<string>,
): string | undefined {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (!ts.isPropertyAccessExpression(expression)) {
    return undefined;
  }
  const name = expression.name.text;
  if (ts.isNewExpression(node)) {
    return name;
  }
  if (expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
    return className ? `${className}.${name}` : undefined;
  }
  return topLevel.has(name) ? name : undefined;
}

interface SsotSinks {
  /** Sinks: `name`, or `Class.method`. */
  keys: Set<string>;
  /** Every top-level function and class name, for resolving `ns.f()`. */
  topLevel: Set<string>;
  /** Exported constants whose value is a project-memory path. */
  constants: Set<string>;
  /**
   * Top-level functions that touch project memory, take no root and are
   * named for a path — the ones that *return* a project-memory path
   * (`complianceRegimeNotesPath(id)`), whose result is the SSOT half of a join.
   */
  pathMakers: Set<string>;
}

/**
 * The functions, classes and methods that read or write project memory and
 * take the workspace root as their first argument.
 *
 * Derived, transitively: a declaration *touches* project memory when its body
 * names a project-memory path (a literal, an `*_SSOT_PATH`-style identifier, or
 * an exported constant whose value is one) or calls something that does. A
 * sink is one that takes the root first. Top-level names match across `src/`,
 * which over-approximates on a clash — the safe direction for a guard, fixed by
 * naming the function for what it does.
 */
function deriveSsotSinks(files: readonly ParsedFile[]): SsotSinks {
  const constants = deriveSsotConstants(files);
  const declarations = files.flatMap(declaredFunctions);
  const topLevel = new Set(declarations.filter(declaration => !declaration.key.includes('.')).map(declaration => declaration.key));
  const callees = new Map<DeclaredFunction, Set<string>>();
  const touching = new Set<string>();
  for (const declaration of declarations) {
    const called = new Set<string>();
    let direct = false;
    // Names bound inside the declaration — parameters, locals, inner functions —
    // are not the top-level function of the same name: `resolve(value)` inside a
    // promise executor is not a call to some module's `resolve`.
    const locals = new Set<string>();
    // A local holding a dynamic `import()` is a module namespace, so `mod.f()`
    // on it is a call to that module's `f`; any other local is an object, and
    // `extension.activate()` is not a call to the extension's `activate`.
    const namespaces = new Set<string>();
    const containsImport = (node: ts.Node): boolean => node.kind === ts.SyntaxKind.ImportKeyword
      || ts.forEachChild(node, containsImport) === true;
    const bind = (node: ts.Node): void => {
      if ((ts.isParameter(node) || ts.isVariableDeclaration(node)) && ts.isIdentifier(node.name)) {
        locals.add(node.name.text);
      }
      if (ts.isVariableDeclaration(node) && node.initializer && containsImport(node.initializer)) {
        for (const name of bindingNames(node.name)) {
          namespaces.add(name);
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name && node !== declaration.body) {
        locals.add(node.name.text);
      }
      ts.forEachChild(node, bind);
    };
    bind(declaration.body);
    const visit = (node: ts.Node): void => {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && isProjectMemoryLiteral(node.text)) {
        direct = true;
      }
      if (ts.isIdentifier(node) && (SSOT_IDENTIFIER.test(node.text) || constants.has(node.text))) {
        direct = true;
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const key = resolveCallee(node, declaration.className, topLevel);
        const callee = node.expression;
        const shadowed = ts.isIdentifier(callee) && locals.has(callee.text);
        const onObject = ts.isPropertyAccessExpression(callee)
          && ts.isIdentifier(callee.expression)
          && locals.has(callee.expression.text)
          && !namespaces.has(callee.expression.text);
        if (key && !shadowed && !onObject) {
          called.add(key);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(declaration.body);
    callees.set(declaration, called);
    if (direct) {
      touching.add(declaration.key);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (touching.has(declaration.key)) {
        continue;
      }
      if ([...callees.get(declaration)!].some(key => touching.has(key))) {
        touching.add(declaration.key);
        changed = true;
      }
    }
  }
  return {
    keys: new Set(declarations.filter(declaration => declaration.rootFirst && touching.has(declaration.key)).map(declaration => declaration.key)),
    topLevel,
    constants,
    pathMakers: new Set(declarations
      // Named for a path: a function that merely touches project memory and
      // returns something else (a launch plan, a report) is not one.
      .filter(declaration => !declaration.rootFirst && !declaration.key.includes('.') && touching.has(declaration.key)
        && /(?:Path|Dir)$/.test(declaration.key))
      .map(declaration => declaration.key)),
  };
}

/** A first-folder read, written inline. */
function isFirstFolderSource(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && FIRST_FOLDER_CALLS.has(node.expression.text)) {
    return true;
  }
  if (ts.isElementAccessExpression(node) && ts.isNumericLiteral(node.argumentExpression) && node.argumentExpression.text === '0') {
    const target = node.expression;
    const text = target.getText();
    // The host's list, not a list somebody injected (`options.workspaceFolders`).
    return /\bworkspace\s*\??\.\s*workspaceFolders!?$/.test(text) || /\bopenWorkspaceFolders\(\)$/.test(text);
  }
  return false;
}

/** The name a tainted value can be referred to by: `root`, or `this.root`. */
function referenceName(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
    return `this.${node.name.text}`;
  }
  return undefined;
}

/** Lexical scopes, function by function: a name binds where it is declared. */
class TaintScope {
  private readonly bindings = new Map<string, boolean>();
  /**
   * Names holding the SSOT path, whatever they are called —
   * `const relativePath = normalizeSsotPath(config.get('ssotPath'))` — so the
   * project-memory half of a join is recognised by data flow, not by spelling.
   */
  private readonly ssotPaths = new Set<string>();

  constructor(private readonly parent: TaintScope | undefined, private readonly members: Set<string>) {}

  declare(name: string, tainted: boolean, holdsSsotPath = false): void {
    this.bindings.set(name, tainted);
    if (holdsSsotPath) {
      this.ssotPaths.add(name);
    } else {
      this.ssotPaths.delete(name);
    }
  }

  holdsSsotPath(name: string): boolean {
    return this.owner(name)?.ssotPaths.has(name) ?? false;
  }

  /** The scope that binds `name`, nearest first; undefined when nothing does. */
  private owner(name: string): TaintScope | undefined {
    return this.bindings.has(name) ? this : this.parent?.owner(name);
  }

  /** Reassignment escalates a binding; it never launders one. */
  assign(name: string, tainted: boolean, holdsSsotPath = false): void {
    if (name.startsWith('this.')) {
      if (tainted) {
        this.members.add(name);
      }
      return;
    }
    const owner = this.owner(name);
    if (tainted) {
      owner?.bindings.set(name, true);
    }
    if (holdsSsotPath) {
      owner?.ssotPaths.add(name);
    }
  }

  /** Whether a name is bound in some enclosing function scope (not the file's). */
  isLocal(name: string): boolean {
    const owner = this.owner(name);
    return owner !== undefined && owner.parent !== undefined;
  }

  isTainted(name: string): boolean {
    if (name.startsWith('this.')) {
      return this.members.has(name);
    }
    return this.owner(name)?.bindings.get(name) ?? false;
  }
}

function containsTaint(node: ts.Node, scope: TaintScope): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) {
      return;
    }
    if (isFirstFolderSource(child)) {
      found = true;
      return;
    }
    const name = referenceName(child);
    if (name && scope.isTainted(name)) {
      // A property name on the right of a dot is not a reference to the variable,
      // and neither is a key in an object literal.
      const parent = child.parent;
      const isPropertyName = parent
        && ((ts.isPropertyAccessExpression(parent) && parent.name === child)
          || (ts.isPropertyAssignment(parent) && parent.name === child));
      if (!isPropertyName) {
        found = true;
        return;
      }
    }
    // Do not look into nested functions: a value they compute is not this one.
    if (ts.isFunctionLike(child) && child !== node) {
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }
  return name.elements.flatMap(element => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)));
}

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return undefined;
}

/**
 * Walk one file in source order with lexical scopes, calling `onSink` for every
 * sink a first-folder value reaches. Run twice: the first pass only learns
 * which `this.x` members hold the first folder, so a member assigned in a
 * constructor is known when a method far below reads it.
 */
function walkFile(
  source: ts.SourceFile,
  sinks: SsotSinks,
  members: Set<string>,
  onSink: (node: ts.Node, sink: string) => void,
): void {
  let className: string | undefined;
  const ssotPathIn = (scope: TaintScope) => (name: string): boolean => scope.holdsSsotPath(name)
    || sinks.constants.has(name)
    || (sinks.pathMakers.has(name) && !scope.isLocal(name));
  const visit = (node: ts.Node, scope: TaintScope): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      const outer = className;
      className = node.name.text;
      ts.forEachChild(node, child => visit(child, scope));
      className = outer;
      return;
    }
    if (ts.isFunctionLike(node) && node !== (source as ts.Node)) {
      const inner = new TaintScope(scope, members);
      for (const parameter of node.parameters) {
        for (const name of bindingNames(parameter.name)) {
          inner.declare(name, false);
        }
      }
      ts.forEachChild(node, child => visit(child, inner));
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      const tainted = node.initializer ? containsTaint(node.initializer, scope) : false;
      const holdsSsot = node.initializer ? isSsotPathExpression(node.initializer, ssotPathIn(scope), sinks.pathMakers) : false;
      if (node.initializer) {
        visit(node.initializer, scope);
      }
      for (const name of bindingNames(node.name)) {
        scope.declare(name, tainted, holdsSsot);
      }
      return;
    }
    if (ts.isPropertyDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      if (containsTaint(node.initializer, scope)) {
        members.add(`this.${node.name.text}`);
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const name = referenceName(node.left);
      if (name) {
        scope.assign(name, containsTaint(node.right, scope), isSsotPathExpression(node.right, ssotPathIn(scope), sinks.pathMakers));
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = calleeName(node.expression);
      const shadowed = ts.isIdentifier(node.expression) && scope.isLocal(node.expression.text);
      const key = shadowed ? undefined : resolveCallee(node, className, sinks.topLevel);
      const args = node.arguments ?? ts.factory.createNodeArray<ts.Expression>();
      if (key && sinks.keys.has(key) && args[0] && containsTaint(args[0], scope)) {
        onSink(node, key);
      } else if (name && JOIN_CALLS.has(name) && args.length > 1) {
        const rest = args.slice(1);
        if (containsTaint(args[0]!, scope) && rest.some(arg => mentionsProjectMemory(arg, ssotPathIn(scope)))) {
          onSink(node, `${name}(<first folder>, <project memory>)`);
        }
      }
    }
    if (ts.isTemplateExpression(node) && node.templateSpans.length > 0) {
      const first = node.templateSpans[0]!;
      if (containsTaint(first.expression, scope) && /(?:^|\/)project_memory(?:\/|$)/.test(first.literal.text)) {
        onSink(node, '`${<first folder>}/project_memory`');
      }
    }
    ts.forEachChild(node, child => visit(child, scope));
  };
  visit(source, new TaintScope(undefined, members));
}

function auditSsotHomeResolution(files: readonly ParsedFile[], sinks: SsotSinks): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const members = new Set<string>();
    walkFile(file.source, sinks, members, () => undefined);
    walkFile(file.source, sinks, members, (node, sink) => {
      const { line } = file.source.getLineAndCharacterOfPosition(node.getStart(file.source));
      violations.push({ file: file.path, line: line + 1, sink });
    });
  }
  return violations;
}

const parsedSources = parse(walk(path.join(REPO_ROOT, 'src')).map(full => ({
  path: path.relative(REPO_ROOT, full).split(path.sep).join('/'),
  text: readFileSync(full, 'utf8'),
})));
const derivedSinks = deriveSsotSinks(parsedSources);

describe('project memory resolves through the SSOT home, never the first folder', () => {
  it('derived a sink list from the source, rather than passing because it found none', () => {
    // A scan with no sinks passes everything; the registers named here are the
    // ones the split brain was found in.
    for (const sink of ['DebtRegisterManager', 'DefectRegisterManager', 'WorkflowAuditLedger', 'PortalHostingManager', 'CiRoutingConfigManager', 'readDebtRegister']) {
      expect(derivedSinks.keys.has(sink), sink).toBe(true);
    }
    expect(derivedSinks.keys.size).toBeGreaterThan(40);
  });

  it('joins no project-memory path onto the first folder outside the allowlist', () => {
    const violations = auditSsotHomeResolution(parsedSources, derivedSinks)
      .filter(violation => !ALLOWED_FIRST_FOLDER_SSOT[`${violation.file}::${violation.sink}`]);
    const lines = violations.map(violation => `${violation.file}:${violation.line} — ${violation.sink}`);
    expect(lines, `Resolve these through ssotHomeRoot() (src/utils/workspaceRoots.ts):\n${lines.join('\n')}`).toEqual([]);
  });

  it('keeps every allowlist entry live and explained', () => {
    const violations = auditSsotHomeResolution(parsedSources, derivedSinks);
    for (const [key, reason] of Object.entries(ALLOWED_FIRST_FOLDER_SSOT)) {
      expect(reason.trim().length, key).toBeGreaterThan(20);
      expect(violations.some(violation => `${violation.file}::${violation.sink}` === key), `${key} no longer occurs — remove it`).toBe(true);
    }
  });
});

describe('the guard catches what it exists to catch', () => {
  const sinks: SsotSinks = {
    keys: new Set(['DebtRegisterManager', 'readDebtRegister']),
    topLevel: new Set(['readDebtRegister', 'notesPath']),
    constants: new Set(),
    pathMakers: new Set(['notesPath']),
  };
  const audit = (text: string): Violation[] => auditSsotHomeResolution(parse([{ path: 'src/views/x.ts', text }]), sinks);

  it('flags a register built on the first folder, inline or through a variable', () => {
    expect(audit('const m = new DebtRegisterManager(defaultWorkspaceRootPath());')).toHaveLength(1);
    expect(audit('const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;\nconst r = readDebtRegister(root);')).toHaveLength(1);
    expect(audit('const folder = defaultWorkspaceFolder();\nconst root = folder?.uri.fsPath;\nreadDebtRegister(root);')).toHaveLength(1);
  });

  it('flags a project-memory path joined onto the first folder', () => {
    expect(audit("const root = defaultWorkspaceRootPath();\nconst p = path.join(root, ssotPath, 'roadmap');")).toHaveLength(1);
    expect(audit("const root = defaultWorkspaceRootPath();\nconst p = path.join(root, 'project_memory', 'x');")).toHaveLength(1);
    expect(audit("const root = defaultWorkspaceRootPath();\nnew vscode.RelativePattern(root, 'project_memory/operations/x.json');")).toHaveLength(1);
    expect(audit('const root = defaultWorkspaceRootPath();\nconst p = `${root}/project_memory/x`;')).toHaveLength(1);
    expect(audit('this.root = defaultWorkspaceRootPath();\nreadDebtRegister(this.root);')).toHaveLength(1);
    // The SSOT path under another name, read from the setting.
    expect(audit("const folder = vscode.workspace.workspaceFolders?.[0];\nconst rel = normalize(config.get('ssotPath'));\nvscode.Uri.joinPath(folder.uri, rel);")).toHaveLength(1);
    // A path a project-memory function returned.
    expect(audit("const root = defaultWorkspaceRootPath();\nconst relative = notesPath('iso');\npath.join(root, relative);")).toHaveLength(1);
  });

  it('passes the home resolver, and the first folder used for something that is not project memory', () => {
    expect(audit('const root = ssotHomeRoot().fsPath;\nreadDebtRegister(root);\nnew DebtRegisterManager(root);')).toEqual([]);
    expect(audit("const root = defaultWorkspaceRootPath();\nconst p = path.join(root, '.git', 'HEAD');")).toEqual([]);
    expect(audit("const root = defaultWorkspaceRootPath();\nconst p = path.join(root, 'src');\nconst q = path.join(ssotHomeRoot().fsPath, ssotPath);")).toEqual([]);
  });
});
