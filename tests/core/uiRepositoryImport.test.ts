import { describe, expect, it } from 'vitest';
import { analyzeUiRepositoryImport } from '../../src/core/uiRepositoryImport.ts';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';
import type { UiDesignGraph, UiRepositoryMapping } from '../../src/types.ts';

function graph(): UiDesignGraph {
  const base = createDefaultWebsiteWorkspace().designGraph;
  return {
    ...base,
    revision: 7,
    components: [{
      id: 'button', label: 'Button', description: '', rootKind: 'cta',
      properties: [
        { id: 'label', label: 'Label', kind: 'text', defaultValue: 'Continue' },
        { id: 'disabled', label: 'Disabled', kind: 'boolean', defaultValue: false },
      ],
      slots: [{ id: 'children', label: 'Children', required: false, allowedKinds: [], maxChildren: 4 }],
      variants: [{ id: 'primary', label: 'Primary', propertyValues: {} }],
      states: ['default'],
    }],
  };
}

function mapping(overrides: Partial<UiRepositoryMapping> = {}): UiRepositoryMapping {
  return {
    id: 'button-source', label: 'Button source', adapterId: 'react',
    target: { kind: 'component', id: 'button' }, sourcePath: 'src/Button.tsx', sourceSymbol: 'Button',
    propertyMappings: {}, slotMappings: {}, coverage: 'declared', limitations: [],
    lastVerified: null, lastImport: null,
    ...overrides,
  };
}

function analyze(sourceText: string, overrides: Partial<UiRepositoryMapping> = {}) {
  return analyzeUiRepositoryImport({
    mapping: mapping(overrides), graph: graph(), sourceText,
    designFingerprint: `sha256:${'a'.repeat(64)}`,
    sourceFingerprint: `sha256:${'b'.repeat(64)}`,
    importedAt: '2026-08-12T12:00:00.000Z',
  });
}

describe('UI Studio repository import adapters', () => {
  it('recognizes conservative React exports and simple props with exact-match suggestions', () => {
    const report = analyze(`
      // export const Fake = true;
      interface ButtonProps {
        label?: string;
        disabled: boolean;
        children?: React.ReactNode;
        'computed-name'?: string;
      }
      export function Button({ label, disabled, children }: ButtonProps) {
        return <button disabled={disabled}>{label}{children}</button>;
      }
    `);
    expect(report).toMatchObject({
      adapterId: 'react', capability: 'partial', graphRevision: 7,
      suggestedPropertyMappings: { disabled: 'disabled', label: 'label' },
      suggestedSlotMappings: { children: 'children' },
    });
    expect(report.facts).toEqual(expect.arrayContaining([
      { kind: 'export', name: 'Button' },
      { kind: 'property', name: 'label' },
      { kind: 'property', name: 'disabled' },
      { kind: 'slot', name: 'children' },
    ]));
    expect(report.facts).not.toContainEqual({ kind: 'export', name: 'Fake' });
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'react-static-only', severity: 'loss' }),
      expect.objectContaining({ code: 'exact-relations-suggested', severity: 'info' }),
    ]));
  });

  it('reports missing React structure and unsupported extensions rather than guessing', () => {
    const partial = analyze('export const Button = withTheme(runtimeFactory());');
    expect(partial).toMatchObject({ capability: 'partial' });
    expect(partial.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'react-props-not-found', severity: 'loss' }),
    ]));

    const unsupported = analyze('Button', { sourcePath: 'src/Button.swift' });
    expect(unsupported).toMatchObject({ capability: 'unsupported', facts: [] });
    expect(unsupported.findings[0]).toMatchObject({ code: 'react-source-extension-unsupported' });
  });

  it('recognizes literal HTML/CSS selectors and custom-property tokens with a loss report', () => {
    const report = analyze(`
      <section id="hero" class="hero featured"></section>
      <style>
        .hero { --color-primary: #2563eb; color: var(--color-primary); }
        #hero:hover { opacity: .9; }
      </style>
    `, {
      adapterId: 'static-html-css', sourcePath: 'public/index.html', sourceSymbol: '#hero',
    });
    expect(report).toMatchObject({ capability: 'partial' });
    expect(report.facts).toEqual(expect.arrayContaining([
      { kind: 'selector', name: '#hero' },
      { kind: 'selector', name: '.hero' },
      { kind: 'selector', name: '.featured' },
      { kind: 'token', name: '--color-primary' },
    ]));
    expect(report.findings).toEqual([
      expect.objectContaining({ code: 'html-css-static-only', severity: 'loss' }),
    ]);
  });

  it('keeps VS Code webview evidence structural and declares the host/runtime loss', () => {
    const source = `
      export function getPanelHtml() {
        return \`<main class="panel"><style>:root { --panel-gap: 12px; }</style></main>\`;
      }
      webview.postMessage({ type: 'ready', secret: runtimeValue });
    `;
    const report = analyze(source, {
      adapterId: 'vscode-webview', sourcePath: 'src/panel.ts', sourceSymbol: 'getPanelHtml',
    });
    expect(report.facts).toEqual(expect.arrayContaining([
      { kind: 'export', name: 'getPanelHtml' },
      { kind: 'selector', name: '.panel' },
      { kind: 'token', name: '--panel-gap' },
    ]));
    expect(report.findings[0]).toMatchObject({ code: 'vscode-static-only', severity: 'loss' });
    expect(JSON.stringify(report)).not.toContain('runtimeValue');
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('reports custom adapters as unsupported and never manufactures facts', () => {
    const report = analyze('class Button: NSButton {}', {
      adapterId: 'custom', sourcePath: 'Sources/Button.swift', coverage: 'partial',
      limitations: ['Swift semantics require a dedicated adapter.'],
    });
    expect(report).toMatchObject({ capability: 'unsupported', facts: [] });
    expect(report.findings).toEqual([
      expect.objectContaining({ code: 'custom-adapter-unsupported', severity: 'unsupported' }),
    ]);
  });

  it('bounds and deterministically orders imported facts', () => {
    const source = Array.from({ length: 250 }, (_, index) => `:root { --token-${String(249 - index).padStart(3, '0')}: ${index}; }`).join('\n');
    const report = analyze(source, {
      adapterId: 'static-html-css', sourcePath: 'tokens.css', sourceSymbol: '',
    });
    expect(report.facts).toHaveLength(200);
    expect(report.facts.map(fact => fact.name))
      .toEqual([...report.facts.map(fact => fact.name)].sort((left, right) => left.localeCompare(right)));
  });
});
