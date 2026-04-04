import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../../src/views/webviewUtils.ts';

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
