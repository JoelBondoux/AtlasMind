/**
 * Conservative source recognizers for UI Studio repository mappings.
 *
 * The output is bounded evidence with an explicit loss report. It is never a
 * graph patch, never executable, and never a claim of lossless parsing.
 */

import * as path from 'node:path';
import type {
  UiDesignGraph,
  UiRepositoryImportFact,
  UiRepositoryImportFinding,
  UiRepositoryImportFindingCode,
  UiRepositoryImportReport,
  UiRepositoryMapping,
} from '../types.js';

export const UI_REPOSITORY_IMPORT_MAX_FACTS = 200;
export const UI_REPOSITORY_IMPORT_MAX_FINDINGS = 40;

export interface UiRepositoryImportInput {
  mapping: UiRepositoryMapping;
  graph: UiDesignGraph;
  sourceText: string;
  designFingerprint: string;
  sourceFingerprint: string;
  importedAt: string;
}

export function analyzeUiRepositoryImport(input: UiRepositoryImportInput): UiRepositoryImportReport {
  const analysis = input.mapping.adapterId === 'react'
    ? analyzeReact(input)
    : input.mapping.adapterId === 'static-html-css'
      ? analyzeStaticHtmlCss(input)
      : input.mapping.adapterId === 'vscode-webview'
        ? analyzeVsCodeWebview(input)
        : analyzeCustom();
  const facts = uniqueFacts(analysis.facts).slice(0, UI_REPOSITORY_IMPORT_MAX_FACTS);
  const suggestions = suggestRelations(input, facts);
  const findings = [...analysis.findings];
  if (facts.length === 0 && analysis.capability !== 'unsupported') {
    findings.push(finding('no-structural-facts', 'loss', 'The adapter found no supported structural facts in this file.'));
  }
  if (Object.keys(suggestions.properties).length > 0 || Object.keys(suggestions.slots).length > 0) {
    findings.push(finding(
      'exact-relations-suggested',
      'info',
      'Exact graph/source names produced reviewable property or slot suggestions; none were applied.',
    ));
  }
  return {
    adapterId: input.mapping.adapterId,
    capability: analysis.capability,
    graphRevision: input.graph.revision,
    designFingerprint: input.designFingerprint,
    sourceFingerprint: input.sourceFingerprint,
    importedAt: input.importedAt,
    facts,
    suggestedPropertyMappings: suggestions.properties,
    suggestedSlotMappings: suggestions.slots,
    findings: uniqueFindings(findings).slice(0, UI_REPOSITORY_IMPORT_MAX_FINDINGS),
  };
}

interface AdapterAnalysis {
  capability: UiRepositoryImportReport['capability'];
  facts: UiRepositoryImportFact[];
  findings: UiRepositoryImportFinding[];
}

function analyzeReact(input: UiRepositoryImportInput): AdapterAnalysis {
  const extension = path.extname(input.mapping.sourcePath).toLowerCase();
  if (!['.js', '.jsx', '.ts', '.tsx'].includes(extension)) {
    return unsupported(
      'react-source-extension-unsupported',
      'The React adapter supports only .js, .jsx, .ts, and .tsx source snapshots.',
    );
  }
  const code = maskCommentsAndStrings(input.sourceText);
  const exports = extractExports(code);
  const symbol = input.mapping.sourceSymbol;
  const facts: UiRepositoryImportFact[] = exports.map(name => ({ kind: 'export', name }));
  const findings: UiRepositoryImportFinding[] = [finding(
    'react-static-only',
    'loss',
    'Static recognition does not resolve imports, spreads, computed keys, conditional types, JSX behavior, hooks, styling systems, or composition.',
  )];
  if (symbol && !exports.includes(symbol) && !containsIdentifier(code, symbol)) {
    findings.push(finding('source-symbol-not-found', 'loss', `The declared source symbol "${symbol}" was not recognized.`));
  }
  const props = symbol ? extractReactProperties(code, symbol) : [];
  const targetComponent = input.mapping.target.kind === 'component'
    ? input.graph.components.find(component => component.id === input.mapping.target.id)
    : undefined;
  const declaredSlots = new Set(targetComponent?.slots.map(slot => slot.id) ?? []);
  for (const property of props) {
    facts.push({ kind: property === 'children' || declaredSlots.has(property) ? 'slot' : 'property', name: property });
  }
  if (symbol && props.length === 0) {
    findings.push(finding(
      'react-props-not-found',
      'loss',
      `No simple ${symbol}Props object or destructured ${symbol} parameter was recognized.`,
    ));
  }
  return { capability: 'partial', facts, findings };
}

function analyzeStaticHtmlCss(input: UiRepositoryImportInput): AdapterAnalysis {
  const extension = path.extname(input.mapping.sourcePath).toLowerCase();
  if (!['.html', '.htm', '.css'].includes(extension)) {
    return unsupported(
      'html-css-source-extension-unsupported',
      'The static HTML/CSS adapter supports only .html, .htm, and .css source snapshots.',
    );
  }
  const facts = extractLiteralWebFacts(input.sourceText);
  const findings = [finding(
    'html-css-static-only',
    'loss',
    'Literal ids, classes, selectors, and custom properties are recognized; templates, scripts, preprocessors, imports, cascade, and runtime DOM changes are not evaluated.',
  )];
  if (input.mapping.sourceSymbol && !facts.some(fact => fact.name === input.mapping.sourceSymbol)) {
    findings.push(finding(
      'source-symbol-not-found',
      'loss',
      `The declared selector or symbol "${input.mapping.sourceSymbol}" was not recognized.`,
    ));
  }
  return { capability: 'partial', facts, findings };
}

function analyzeVsCodeWebview(input: UiRepositoryImportInput): AdapterAnalysis {
  const extension = path.extname(input.mapping.sourcePath).toLowerCase();
  if (!['.js', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css'].includes(extension)) {
    return unsupported(
      'vscode-source-extension-unsupported',
      'The VS Code webview adapter supports JavaScript, TypeScript, HTML, and CSS source snapshots.',
    );
  }
  const code = maskCommentsAndStrings(input.sourceText);
  const facts: UiRepositoryImportFact[] = [
    ...extractExports(code).map(name => ({ kind: 'export' as const, name })),
    ...extractLiteralWebFacts(input.sourceText),
  ];
  const findings = [finding(
    'vscode-static-only',
    'loss',
    'Static recognition does not interpret template construction, the message protocol, CSP, extension-host behavior, contributed commands, or runtime state.',
  )];
  if (input.mapping.sourceSymbol
      && !facts.some(fact => fact.name === input.mapping.sourceSymbol)
      && !containsIdentifier(code, input.mapping.sourceSymbol)) {
    findings.push(finding(
      'source-symbol-not-found',
      'loss',
      `The declared webview symbol "${input.mapping.sourceSymbol}" was not recognized.`,
    ));
  }
  return { capability: 'partial', facts, findings };
}

function analyzeCustom(): AdapterAnalysis {
  return unsupported(
    'custom-adapter-unsupported',
    'Custom mappings retain provenance, but AtlasMind has no declared parser for their source semantics.',
  );
}

function suggestRelations(
  input: UiRepositoryImportInput,
  facts: readonly UiRepositoryImportFact[],
): { properties: Record<string, string>; slots: Record<string, string> } {
  if (input.mapping.target.kind !== 'component') { return { properties: {}, slots: {} }; }
  const component = input.graph.components.find(candidate => candidate.id === input.mapping.target.id);
  if (!component) { return { properties: {}, slots: {} }; }
  const sourceProperties = new Set(facts.filter(fact => fact.kind === 'property').map(fact => fact.name));
  const sourceSlots = new Set(facts.filter(fact => fact.kind === 'slot').map(fact => fact.name));
  const properties: Record<string, string> = {};
  const slots: Record<string, string> = {};
  for (const property of component.properties) {
    if (sourceProperties.has(property.id)) { properties[property.id] = property.id; }
  }
  for (const slot of component.slots) {
    if (sourceSlots.has(slot.id)) { slots[slot.id] = slot.id; }
  }
  return { properties, slots };
}

function extractExports(code: string): string[] {
  const names: string[] = [];
  const declaration = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of code.matchAll(declaration)) { names.push(match[1]!); }
  const list = /\bexport\s*{([^}]*)}/g;
  for (const match of code.matchAll(list)) {
    for (const item of (match[1] ?? '').split(',')) {
      const name = item.trim().split(/\s+as\s+/)[0];
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) { names.push(name); }
    }
  }
  return uniqueStrings(names);
}

function extractReactProperties(code: string, symbol: string): string[] {
  const names: string[] = [];
  const typeName = `${escapeRegExp(symbol)}Props`;
  const declaration = new RegExp(`\\b(?:interface\\s+${typeName}(?:\\s+extends\\s+[^\\{]+)?|type\\s+${typeName}\\s*=)\\s*\\{`, 'g');
  const match = declaration.exec(code);
  if (match) {
    const opening = code.indexOf('{', match.index);
    const body = balancedBody(code, opening);
    if (body !== undefined) {
      const member = /(?:^|[;{\n])\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/g;
      for (const candidate of body.matchAll(member)) { names.push(candidate[1]!); }
    }
  }
  const destructured = new RegExp(`\\b(?:function\\s+${escapeRegExp(symbol)}|(?:const|let|var)\\s+${escapeRegExp(symbol)}\\s*=\\s*(?:async\\s*)?)\\s*\\(\\s*\\{([^}]*)}`, 'g');
  const parameter = destructured.exec(code)?.[1];
  if (parameter) {
    for (const item of parameter.split(',')) {
      const name = item.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1];
      if (name) { names.push(name); }
    }
  }
  return uniqueStrings(names);
}

function extractLiteralWebFacts(source: string): UiRepositoryImportFact[] {
  const facts: UiRepositoryImportFact[] = [];
  const withoutComments = source
    .replace(/<!--[\s\S]*?-->/g, match => match.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
  for (const match of withoutComments.matchAll(/\bid\s*=\s*["']([A-Za-z_][\w-]*)["']/g)) {
    facts.push({ kind: 'selector', name: `#${match[1]!}` });
  }
  for (const match of withoutComments.matchAll(/\bclass(?:Name)?\s*=\s*["']([^"']+)["']/g)) {
    for (const name of (match[1] ?? '').split(/\s+/).filter(Boolean)) {
      if (/^[A-Za-z_][\w-]*$/.test(name)) { facts.push({ kind: 'selector', name: `.${name}` }); }
    }
  }
  for (const match of withoutComments.matchAll(/(?:^|[},]\s*)([.#][A-Za-z_][\w-]*)\s*(?:[,{:#.\[])/gm)) {
    facts.push({ kind: 'selector', name: match[1]! });
  }
  for (const match of withoutComments.matchAll(/(--[A-Za-z_][\w-]*)\s*:/g)) {
    facts.push({ kind: 'token', name: match[1]! });
  }
  return uniqueFacts(facts);
}

function maskCommentsAndStrings(source: string): string {
  let result = '';
  let mode: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]!;
    const next = source[index + 1];
    if (mode === 'code') {
      if (current === '/' && next === '/') { result += '  '; mode = 'line'; index += 1; continue; }
      if (current === '/' && next === '*') { result += '  '; mode = 'block'; index += 1; continue; }
      if (current === "'") { result += ' '; mode = 'single'; escaped = false; continue; }
      if (current === '"') { result += ' '; mode = 'double'; escaped = false; continue; }
      if (current === '`') { result += ' '; mode = 'template'; escaped = false; continue; }
      result += current;
      continue;
    }
    if (current === '\n') { result += '\n'; if (mode === 'line') { mode = 'code'; } continue; }
    if (mode === 'block' && current === '*' && next === '/') {
      result += '  '; mode = 'code'; index += 1; continue;
    }
    const delimiter = mode === 'single' ? "'" : mode === 'double' ? '"' : mode === 'template' ? '`' : '';
    if (delimiter && current === delimiter && !escaped) { result += ' '; mode = 'code'; continue; }
    escaped = delimiter.length > 0 && current === '\\' && !escaped;
    if (current !== '\\') { escaped = false; }
    result += ' ';
  }
  return result;
}

function balancedBody(source: string, opening: number): string | undefined {
  if (opening < 0 || source[opening] !== '{') { return undefined; }
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === '{') { depth += 1; }
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) { return source.slice(opening + 1, index); }
    }
  }
  return undefined;
}

function containsIdentifier(source: string, identifier: string): boolean {
  return new RegExp(`\\b${escapeRegExp(identifier)}\\b`).test(source);
}

function unsupported(code: UiRepositoryImportFindingCode, message: string): AdapterAnalysis {
  return { capability: 'unsupported', facts: [], findings: [finding(code, 'unsupported', message)] };
}

function finding(
  code: UiRepositoryImportFindingCode,
  severity: UiRepositoryImportFinding['severity'],
  message: string,
): UiRepositoryImportFinding {
  return { code, severity, message };
}

function uniqueFacts(facts: readonly UiRepositoryImportFact[]): UiRepositoryImportFact[] {
  const byKey = new Map<string, UiRepositoryImportFact>();
  for (const fact of facts) {
    if (fact.name.length > 0 && fact.name.length <= 160) { byKey.set(`${fact.kind}:${fact.name}`, fact); }
  }
  return [...byKey.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
}

function uniqueFindings(findings: readonly UiRepositoryImportFinding[]): UiRepositoryImportFinding[] {
  const byCode = new Map<string, UiRepositoryImportFinding>();
  for (const candidate of findings) { if (!byCode.has(candidate.code)) { byCode.set(candidate.code, candidate); } }
  return [...byCode.values()];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
