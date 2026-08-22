import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../../src/views/webviewUtils.ts';

const DASHBOARD = readFileSync(path.join(process.cwd(), 'media', 'projectDashboard.js'), 'utf8');

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than signs', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('value="x"')).toBe('value=&quot;x&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('escapes all dangerous characters in one pass', () => {
    expect(escapeHtml(`<img src="x" onerror='alert(1)' />&`)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39; /&gt;&amp;',
    );
  });

  it('passes through safe text unchanged', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });
});

describe('project dashboard DOM boundary', () => {
  it('hydrates user-authored Director text through textContent after the HTML swap', () => {
    expect(DASHBOARD).toContain('root.innerHTML = `');
    expect(DASHBOARD).toContain('hydrateDirectorUserText();');
    expect(DASHBOARD).toContain("element.textContent = String(assignment.title || '')");
    expect(DASHBOARD).toContain("element.textContent = String(followUp.title || '')");
    expect(DASHBOARD).not.toContain('${escapeHtml(a.title)}');
    expect(DASHBOARD).not.toContain('${escapeHtml(f.title)}');
  });

  it('updates delivery stages through an explicit field switch with no recursive property walk', () => {
    const editorStart = DASHBOARD.indexOf('function renderStageEditor');
    const editorEnd = DASHBOARD.indexOf('function renderPathEditor', editorStart);
    const editor = DASHBOARD.slice(editorStart, editorEnd);
    const start = DASHBOARD.indexOf('function setNestedField');
    const end = DASHBOARD.indexOf('// ── Delivery: promotion execution modal', start);
    const setter = DASHBOARD.slice(start, end);
    const declaredFields = [...editor.matchAll(/ed(?:Text|Num|Area|Check|Select)\('(?:[^'\\]|\\.)*',\s*'([^']+)'/g)]
      .map(match => match[1])
      .sort();
    const writableFields = [...setter.matchAll(/case '([^']+)':/g)]
      .map(match => match[1])
      .sort();
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(writableFields).toEqual(declaredFields);
    expect(setter).toContain("case 'promotionPolicy.requiredChecks':");
    expect(setter).toContain('default: return;');
    expect(setter).not.toContain('fieldPath.split');
    expect(setter).not.toMatch(/cur\s*\[/);
  });
});
