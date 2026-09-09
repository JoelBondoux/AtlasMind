import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  BRAND_PRESET_RULES,
  BRAND_ROLES,
  BRAND_ROLE_NAME_RULES,
  LEGACY_BRAND_PRESET_ID,
  MAX_BRAND_PRESETS,
  applyBrandPresets,
  brandPresetFromDesignSystem,
  brandTokenId,
  describeBrandApplication,
  extractBrandPresetFromStylesheet,
  resolveScreenBrand,
  sanitizeBrandPresets,
} from '../../src/core/brandPresets';
import { resolveUiDesignToken, sanitizeUiDesignTokens } from '../../src/core/uiDesignGraph';
import type { BrandPreset, UiDesignToken } from '../../src/types';

const SOURCE = readFileSync(
  path.join(process.cwd(), 'src', 'core', 'brandPresets.ts'),
  'utf8',
);
/** The source with its prose removed, for assertions about what it does. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const NOW = '2026-09-09T12:00:00.000Z';

function preset(overrides: Partial<BrandPreset> = {}): BrandPreset {
  return {
    id: 'acme',
    label: 'Acme',
    tokens: [
      { id: 'color-primary', label: 'Primary', kind: 'color', value: '#ff0000' },
      { id: 'font-heading', label: 'Heading font', kind: 'font-family', value: 'Inter' },
    ],
    ...overrides,
  };
}

describe('a preset is applied by alias, never by copy', () => {
  it('points the role tokens at the materialised brand tokens', () => {
    const tokens = applyBrandPresets([], [preset()], 'acme');
    const primary = tokens.find(token => token.id === 'color-primary');
    expect(primary).toMatchObject({ aliasOf: brandTokenId('acme', 'color-primary') });
    // And the existing resolver reads straight through it — nothing downstream
    // learns a new vocabulary.
    expect(resolveUiDesignToken(tokens, 'color-primary')?.value).toBe('#ff0000');
  });

  it('follows a change to the preset without touching any surface', () => {
    const before = applyBrandPresets([], [preset()], 'acme');
    const changed = preset({ tokens: [{ id: 'color-primary', label: 'Primary', kind: 'color', value: '#00ff00' }] });
    const after = applyBrandPresets(before, [changed], 'acme');
    expect(resolveUiDesignToken(after, 'color-primary')?.value).toBe('#00ff00');
    // The role token itself did not change; only what it points at did.
    expect(after.find(token => token.id === 'color-primary')).toEqual(before.find(token => token.id === 'color-primary'));
  });

  it('survives the graph sanitizer, so nothing is dropped as an unreachable alias', () => {
    const tokens = sanitizeUiDesignTokens(applyBrandPresets([], [preset()], 'acme'));
    expect(tokens.some(token => token.id === 'color-primary')).toBe(true);
    expect(resolveUiDesignToken(tokens, 'font-heading')?.value).toBe('Inter');
  });
});

describe('a local override is a value, and it is reported', () => {
  const overridden: UiDesignToken[] = [
    { id: 'color-primary', label: 'Primary', kind: 'color', value: '#123456' },
  ];

  it('leaves a role token that holds its own value alone', () => {
    const tokens = applyBrandPresets(overridden, [preset()], 'acme');
    expect(resolveUiDesignToken(tokens, 'color-primary')?.value).toBe('#123456');
  });

  it('names the override rather than letting the surface claim the brand', () => {
    const tokens = applyBrandPresets(overridden, [preset()], 'acme');
    const report = describeBrandApplication(tokens, preset());
    expect(report.roles.find(role => role.roleId === 'color-primary')?.application).toBe('overridden');
    expect(report.roles.find(role => role.roleId === 'font-heading')?.application).toBe('aliased');
    expect(report.summary).toContain('overridden locally (primary)');
    expect(report.rules).toBe(BRAND_PRESET_RULES);
  });

  it('reports a role the preset does not fill as missing, not as the brand', () => {
    const report = describeBrandApplication(applyBrandPresets([], [preset()], 'acme'), preset());
    expect(report.roles.find(role => role.roleId === 'radius-base')?.application).toBe('missing');
    expect(report.missing).toBe(BRAND_ROLES.length - 2);
  });
});

describe('materialised tokens are a projection', () => {
  it('rebuilds them from the presets and prunes the ones whose preset went', () => {
    const first = applyBrandPresets([], [preset(), preset({ id: 'other', label: 'Other' })], 'acme');
    expect(first.some(token => token.id === brandTokenId('other', 'color-primary'))).toBe(true);
    const second = applyBrandPresets(first, [preset()], 'acme');
    expect(second.some(token => token.id === brandTokenId('other', 'color-primary'))).toBe(false);
  });

  it('discards a hand edit to a materialised token on the next application', () => {
    const tokens: UiDesignToken[] = applyBrandPresets([], [preset()], 'acme').map(token =>
      token.id === brandTokenId('acme', 'color-primary') ? { ...token, value: '#000000' } as UiDesignToken : token);
    const rebuilt = applyBrandPresets(tokens, [preset()], 'acme');
    expect(resolveUiDesignToken(rebuilt, 'color-primary')?.value).toBe('#ff0000');
  });

  it('passes tokens that are neither roles nor materialised through untouched', () => {
    const custom: UiDesignToken = { id: 'shadow-card', label: 'Card shadow', kind: 'shadow', value: { x: 0, y: 2, blur: 8, spread: 0, color: '#000' } };
    const tokens = applyBrandPresets([custom], [preset()], 'acme');
    expect(tokens).toContainEqual(custom);
  });

  it('applies nothing when no default is chosen, but still materialises', () => {
    const tokens = applyBrandPresets([], [preset()], undefined);
    expect(tokens.some(token => token.id === 'color-primary')).toBe(false);
    expect(tokens.some(token => token.id === brandTokenId('acme', 'color-primary'))).toBe(true);
  });
});

describe('an extracted preset cites its source and invents nothing', () => {
  const css = [
    '/* --primary: #bad; commented out, must not count */',
    ':root {',
    '  --primary: #1a2b3c;',
    '  --color-secondary: rgb(10, 20, 30);',
    '  --accent: var(--primary);',
    '  --font-heading: "Inter", sans-serif;',
    '  --spacing: 12px;',
    '  --radius: 0.75rem;',
    '  --nav-height: 64px;',
    '}',
  ].join('\n');

  it('fills roles from declared name rules and records the line each came from', () => {
    const extraction = extractBrandPresetFromStylesheet({ css, path: 'src/styles/tokens.css', extractedAt: NOW });
    expect(extraction.preset?.source).toEqual({ ruleId: 'stylesheet-custom-properties', path: 'src/styles/tokens.css', extractedAt: NOW });
    expect(extraction.evidence).toContainEqual({ roleId: 'color-primary', property: 'primary', line: 3 });
    expect(extraction.evidence).toContainEqual({ roleId: 'spacing-base', property: 'spacing', line: 7 });
    expect(extraction.preset?.tokens.find(token => token.id === 'font-heading')?.value).toBe('Inter, sans-serif');
  });

  it('refuses a reference, a non-pixel unit and an unmatched name, each with the reason', () => {
    const extraction = extractBrandPresetFromStylesheet({ css, path: 'tokens.css', extractedAt: NOW });
    const reasons = Object.fromEntries(extraction.unassigned.map(entry => [entry.property, entry.reason]));
    expect(reasons['accent']).toContain('reference');
    expect(reasons['radius']).toContain('pixel');
    expect(reasons['nav-height']).toContain('no declared role');
    // Refused, never guessed: no accent and no radius made it in.
    expect(extraction.preset?.tokens.some(token => token.id === 'color-accent')).toBe(false);
    expect(extraction.preset?.tokens.some(token => token.id === 'radius-base')).toBe(false);
  });

  it('does not read a commented-out declaration', () => {
    const extraction = extractBrandPresetFromStylesheet({ css, path: 'tokens.css', extractedAt: NOW });
    expect(extraction.preset?.tokens.find(token => token.id === 'color-primary')?.value).toBe('#1a2b3c');
  });

  it('keeps the first of two declarations for one role and reports the second', () => {
    const twice = ':root { --primary: #111; --brand-primary: #222; }';
    const extraction = extractBrandPresetFromStylesheet({ css: twice, path: 'a.css', extractedAt: NOW });
    expect(extraction.preset?.tokens.find(token => token.id === 'color-primary')?.value).toBe('#111');
    expect(extraction.unassigned[0]?.reason).toContain('already filled');
  });

  it('states what it left unassigned in the summary', () => {
    const extraction = extractBrandPresetFromStylesheet({ css, path: 'tokens.css', extractedAt: NOW });
    expect(extraction.summary).toContain('left unassigned');
  });

  it('refuses a stylesheet with no :root block, and says so', () => {
    const extraction = extractBrandPresetFromStylesheet({ css: '.button { color: red; }', path: 'a.css', extractedAt: NOW });
    expect(extraction.preset).toBeUndefined();
    expect(extraction.refusal).toContain(':root');
  });

  it('never throws, whatever it is handed', () => {
    for (const css of ['', '{', ':root {', ':root { --x: }', 'x'.repeat(600 * 1024)]) {
      expect(() => extractBrandPresetFromStylesheet({ css, path: 'a.css', extractedAt: NOW })).not.toThrow();
    }
  });

  it('publishes the name rules so a miss can be argued with', () => {
    expect(BRAND_ROLE_NAME_RULES.length).toBe(BRAND_ROLES.length);
    for (const rule of BRAND_ROLE_NAME_RULES) {
      expect(BRAND_ROLES.some(role => role.id === rule.roleId), rule.roleId).toBe(true);
      expect(rule.describes.length).toBeGreaterThan(10);
    }
  });
});

describe('the legacy design system folds once, and only if it was changed', () => {
  it('yields nothing for untouched defaults', () => {
    expect(brandPresetFromDesignSystem({
      primaryColor: '#2563eb', secondaryColor: '#0f172a', accentColor: '#14b8a6',
      headingFont: 'System sans-serif', bodyFont: 'System sans-serif',
    }, NOW)).toBeUndefined();
    expect(brandPresetFromDesignSystem(undefined, NOW)).toBeUndefined();
  });

  it('folds a changed system into a cited preset, carrying prose as notes rather than guessing numbers', () => {
    const folded = brandPresetFromDesignSystem({
      primaryColor: '#c0ffee', secondaryColor: '#0f172a', accentColor: '#14b8a6',
      headingFont: 'Fraunces', bodyFont: 'System sans-serif',
      spacingScale: '4 / 8 / 16', cornerStyle: 'pill', brandDirection: 'Warm and editorial',
    }, NOW);
    expect(folded?.id).toBe(LEGACY_BRAND_PRESET_ID);
    expect(folded?.source).toEqual({ ruleId: 'legacy-design-system', extractedAt: NOW });
    expect(folded?.tokens.find(token => token.id === 'color-primary')?.value).toBe('#c0ffee');
    expect(folded?.tokens.some(token => token.id === 'radius-base')).toBe(false);
    expect(folded?.notes).toContain('Corner style: pill');
    expect(folded?.notes).toContain('Spacing scale: 4 / 8 / 16');
  });

  it('reads a pixel corner style as the base radius', () => {
    const folded = brandPresetFromDesignSystem({ primaryColor: '#c0ffee', cornerStyle: '12px' }, NOW);
    expect(folded?.tokens.find(token => token.id === 'radius-base')?.value).toBe(12);
  });
});

describe('a stored preset is untrusted', () => {
  it('never throws and keeps only declared roles as direct values', () => {
    for (const value of [undefined, null, 'x', {}, [null, 'x', { id: 1 }]]) {
      expect(() => sanitizeBrandPresets(value)).not.toThrow();
    }
    const presets = sanitizeBrandPresets([{
      id: 'acme',
      label: 'Acme',
      tokens: [
        { id: 'color-primary', kind: 'color', value: '#abc' },
        { id: 'color-primary', kind: 'color', value: '#def' },
        { id: 'font-heading', kind: 'font-family', aliasOf: 'somewhere' },
        { id: 'nav-height', kind: 'spacing', value: 64 },
        { id: 'color-accent', kind: 'color', value: 'javascript:alert(1)' },
      ],
    }]);
    expect(presets).toHaveLength(1);
    expect(presets[0].tokens).toEqual([{ id: 'color-primary', label: 'Primary', kind: 'color', value: '#abc' }]);
  });

  it('refuses the reserved materialised prefix as a preset id', () => {
    expect(sanitizeBrandPresets([{ id: 'brand-x', label: 'X', tokens: [] }])).toEqual([]);
  });

  it('caps the list and drops a citation that points outside the workspace', () => {
    const many = Array.from({ length: 40 }, (_unused, index) => ({ id: `p${index}`, label: `P${index}`, tokens: [] }));
    expect(sanitizeBrandPresets(many).length).toBeLessThanOrEqual(MAX_BRAND_PRESETS);
    const traversal = sanitizeBrandPresets([{
      id: 'a', label: 'A', tokens: [],
      source: { ruleId: 'stylesheet-custom-properties', path: '../../etc/passwd', extractedAt: NOW },
    }]);
    expect(traversal[0]?.source).toBeUndefined();
  });
});

describe('which preset a screen wears', () => {
  const brands = [preset(), preset({ id: 'dark', label: 'Dark' })];

  it('prefers the screen’s own reference, then the default, and says which', () => {
    expect(resolveScreenBrand({ brands, defaultBrandId: 'acme', brandRef: 'dark' })).toMatchObject({ preset: { id: 'dark' }, source: 'screen' });
    expect(resolveScreenBrand({ brands, defaultBrandId: 'acme' })).toMatchObject({ preset: { id: 'acme' }, source: 'default' });
    expect(resolveScreenBrand({ brands, defaultBrandId: 'gone', brandRef: 'also-gone' })).toEqual({ source: 'none' });
  });
});

describe('nothing here writes anything', () => {
  it('imports only the types', () => {
    expect(CODE).not.toMatch(/from 'node:fs'|from 'vscode'|writeFile/);
    expect(CODE).not.toMatch(/from '\.\/uiDesignGraph\.js'/);
  });
});
