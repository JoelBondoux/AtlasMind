/**
 * Brand presets: one named set of design decisions, applied to many surfaces.
 *
 * UI Studio held its visual decisions in two places that could not agree — a
 * flat `WebsiteDesignSystem` (three colours, two fonts) labelled *legacy* on its
 * own page, and the typed token graph directly beneath it. Two sources of truth
 * for "what colour is primary" is a parity bug in waiting, and it is why a brand
 * had nowhere to live: there was no object that *was* the brand, only two
 * partial descriptions of one.
 *
 * A preset is that object. It is a small set of **value** tokens keyed by a
 * declared role — `color-primary`, `font-heading`, `radius-base` — the same ids
 * the preview already looks up, so nothing downstream learns a new vocabulary.
 *
 * Six rules.
 *
 * **A preset is applied by alias, never by copy.** Applying one materialises its
 * tokens into the graph under `brand-<preset>-<role>` and points the role token
 * (`color-primary`) at them with `aliasOf`. Change the preset and every surface
 * aliasing it follows; copying values into each surface would leave twelve
 * screens each holding a stale primary the day the brand changed.
 *
 * **A local override is a value, and it is reported.** A role token holding a
 * direct value instead of an alias is an override; `describeBrandApplication`
 * says so per role, because a surface that quietly kept its own primary while
 * claiming the brand is the failure a preset exists to prevent.
 *
 * **Materialised tokens are a projection.** They are rebuilt from the presets
 * on every sanitize and pruned when their preset goes — the graph's own idiom,
 * where the wireframe is derived from the screen rather than asked to agree
 * with it. Editing a materialised token by hand does not survive, by design.
 *
 * **An extracted preset cites its source and invents nothing.** Reading a
 * stylesheet's custom properties yields a preset naming the file, the rule and
 * the line for every role it filled; a property it could not read — `var(…)`,
 * a `rem` value, a name matching no declared rule — is listed as unassigned
 * with the reason, never guessed at. A brand nobody chose, attributed to a
 * file that does not say it, is worse than an empty one.
 *
 * **The legacy design system folds into a preset once, at migration, and only
 * if somebody changed it.** Defaults that were never touched are not a brand
 * decision, and folding them would attribute one to the author.
 *
 * **Nothing here writes anything.** Every function returns a value; the
 * workspace manager decides what is persisted.
 *
 * Pure + unit-tested.
 */

import type {
  BrandPreset,
  BrandPresetSource,
  UiDesignToken,
  UiDesignTokenKind,
  UiDesignTokenValue,
  WebsiteDesignSystem,
} from '../types.js';

/**
 * How many presets one workspace may hold.
 *
 * Every preset materialises up to `BRAND_ROLES.length` tokens into a graph
 * capped at 200, and a brand list longer than this is a picker nobody can use.
 */
export const MAX_BRAND_PRESETS = 12;
/** A stylesheet larger than this is not a token file. */
const MAX_STYLESHEET_BYTES = 512 * 1024;

const MAX_LABEL = 80;
const MAX_NOTES = 1_000;
const MAX_UNASSIGNED = 40;

export interface BrandRole {
  /** The token id the role occupies in the graph — the id the preview reads. */
  id: string;
  kind: UiDesignTokenKind;
  label: string;
}

/**
 * The roles a preset may fill.
 *
 * Deliberately the ids `websiteWireframePreview` already resolves, plus the
 * three a real palette cannot do without. A role nobody's stylesheet names
 * costs nothing; a role table that grows without a consumer is a vocabulary
 * nobody speaks.
 */
export const BRAND_ROLES: readonly BrandRole[] = [
  { id: 'color-primary', kind: 'color', label: 'Primary' },
  { id: 'color-secondary', kind: 'color', label: 'Secondary' },
  { id: 'color-accent', kind: 'color', label: 'Accent' },
  { id: 'color-background', kind: 'color', label: 'Background' },
  { id: 'color-surface', kind: 'color', label: 'Surface' },
  { id: 'color-text', kind: 'color', label: 'Text' },
  { id: 'font-heading', kind: 'font-family', label: 'Heading font' },
  { id: 'font-body', kind: 'font-family', label: 'Body font' },
  { id: 'spacing-base', kind: 'spacing', label: 'Base spacing' },
  { id: 'radius-base', kind: 'radius', label: 'Base radius' },
];

const ROLE_BY_ID = new Map(BRAND_ROLES.map(role => [role.id, role]));

export interface BrandPresetRule {
  id: string;
  describes: string;
}

/** Published with every application, so the reading can be argued with. */
export const BRAND_PRESET_RULES: readonly BrandPresetRule[] = [
  { id: 'applied-by-alias', describes: 'Applying a preset points the role tokens at it. Change the preset and every surface using it follows; nothing is copied.' },
  { id: 'override-is-reported', describes: 'A role token holding its own value instead of an alias is a local override, and it is named as one.' },
  { id: 'materialised-is-derived', describes: 'The brand-* tokens in the graph are rebuilt from the presets on every save. Editing them by hand does not survive.' },
  { id: 'extraction-cites', describes: 'A preset read from a stylesheet names the file and line for every role, and lists what it could not read rather than guessing.' },
  { id: 'legacy-folds-once', describes: 'The old design-system fields fold into a preset at migration, only if somebody had changed them from the defaults.' },
  { id: 'nothing-written', describes: 'Every function here returns a value. What is persisted is the workspace manager’s decision.' },
];

// ── Sanitizing ───────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripControl(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    out += (code < 32 && code !== 9 && code !== 10) || code === 127 ? ' ' : ch;
  }
  return out;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? stripControl(value).replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Same charset `uiDesignGraph` accepts for a token id, so ids round-trip. */
export function cleanBrandIdentifier(value: unknown, maxLength = 80): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const cleaned = value.trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, maxLength);
  return cleaned || undefined;
}

/** A colour literal the preview can use verbatim. `var()` and names are refused. */
function isColourLiteral(value: string): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
    || /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.%\s,/deg-]+\)$/i.test(value);
}

/** A pixel length, as a number. Other units are refused rather than converted. */
function pixelLength(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 500 ? parsed : undefined;
}

function cleanFontFamily(value: string): string | undefined {
  const cleaned = cleanText(value.replace(/["']/g, ''), 160);
  return cleaned && !/^var\(/i.test(cleaned) ? cleaned : undefined;
}

/** Read one role's value, refusing anything the role's kind cannot hold. */
function sanitizeRoleValue(role: BrandRole, raw: unknown): UiDesignTokenValue | undefined {
  switch (role.kind) {
    case 'color': {
      const text = cleanText(raw, 64);
      return isColourLiteral(text) ? text : undefined;
    }
    case 'font-family': {
      return typeof raw === 'string' ? cleanFontFamily(raw) : undefined;
    }
    case 'spacing':
    case 'radius': {
      if (typeof raw === 'number') {
        return Number.isFinite(raw) && raw >= 0 && raw <= 500 ? raw : undefined;
      }
      return typeof raw === 'string' ? pixelLength(raw) : undefined;
    }
    default:
      return undefined;
  }
}

function sanitizeSource(value: unknown): BrandPresetSource | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const ruleId = value['ruleId'];
  if (ruleId !== 'stylesheet-custom-properties' && ruleId !== 'legacy-design-system') {
    return undefined;
  }
  const extractedAt = cleanText(value['extractedAt'], 40);
  if (!extractedAt || Number.isNaN(Date.parse(extractedAt))) {
    return undefined;
  }
  // A path is a workspace-relative hint that names where the brand came from.
  // Traversal is refused rather than cleaned: a citation pointing outside the
  // workspace is not a citation.
  const path = cleanText(value['path'], 300).replace(/\\/g, '/');
  if (ruleId === 'stylesheet-custom-properties' && (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').includes('..'))) {
    return undefined;
  }
  return {
    ruleId,
    extractedAt,
    ...(path ? { path } : {}),
  };
}

/**
 * Read stored presets.
 *
 * Only roles from `BRAND_ROLES` survive, and only as direct values: a preset
 * token that aliased another would make "what is primary" depend on a token
 * outside the preset, which is the two-sources problem back again.
 */
export function sanitizeBrandPresets(input: unknown): BrandPreset[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const presets: BrandPreset[] = [];
  const ids = new Set<string>();
  for (const candidate of input.slice(0, MAX_BRAND_PRESETS)) {
    if (!isRecord(candidate)) {
      continue;
    }
    const id = cleanBrandIdentifier(candidate['id']);
    const label = cleanText(candidate['label'], MAX_LABEL);
    if (!id || !label || ids.has(id) || id.startsWith('brand-')) {
      // `brand-` is reserved for materialised tokens; a preset with that prefix
      // would collide with its own projection.
      continue;
    }
    const tokens: UiDesignToken[] = [];
    const seenRoles = new Set<string>();
    for (const rawToken of Array.isArray(candidate['tokens']) ? candidate['tokens'] : []) {
      if (!isRecord(rawToken)) {
        continue;
      }
      const roleId = cleanBrandIdentifier(rawToken['id']);
      const role = roleId ? ROLE_BY_ID.get(roleId) : undefined;
      if (!role || seenRoles.has(role.id)) {
        continue;
      }
      const value = sanitizeRoleValue(role, rawToken['value']);
      if (value === undefined) {
        continue;
      }
      seenRoles.add(role.id);
      tokens.push({ id: role.id, label: role.label, kind: role.kind, value });
    }
    const notes = cleanText(candidate['notes'], MAX_NOTES);
    const source = sanitizeSource(candidate['source']);
    presets.push({
      id,
      label,
      tokens,
      ...(notes ? { notes } : {}),
      ...(source ? { source } : {}),
    });
    ids.add(id);
  }
  return presets;
}

// ── The legacy fold ──────────────────────────────────────────────

/** The values `defaultDesignSystem` seeds. A design system still holding them decided nothing. */
const LEGACY_DESIGN_SYSTEM_DEFAULTS = {
  primaryColor: '#2563eb',
  secondaryColor: '#0f172a',
  accentColor: '#14b8a6',
  headingFont: 'System sans-serif',
  bodyFont: 'System sans-serif',
} as const;

export const LEGACY_BRAND_PRESET_ID = 'project-brand';

/**
 * Fold the flat design system into a preset.
 *
 * Returns nothing when every foldable field still holds its seeded default: a
 * brand nobody chose must not be attributed to them at migration. Fields that
 * cannot be typed — `spacingScale` is prose, `cornerStyle` is free text —
 * travel as notes rather than being guessed into numbers.
 */
export function brandPresetFromDesignSystem(
  design: Partial<WebsiteDesignSystem> | undefined,
  extractedAt: string,
): BrandPreset | undefined {
  if (!design) {
    return undefined;
  }
  const candidates: Array<[string, unknown]> = [
    ['color-primary', design.primaryColor],
    ['color-secondary', design.secondaryColor],
    ['color-accent', design.accentColor],
    ['font-heading', design.headingFont],
    ['font-body', design.bodyFont],
  ];
  const defaults: Record<string, string> = {
    'color-primary': LEGACY_DESIGN_SYSTEM_DEFAULTS.primaryColor,
    'color-secondary': LEGACY_DESIGN_SYSTEM_DEFAULTS.secondaryColor,
    'color-accent': LEGACY_DESIGN_SYSTEM_DEFAULTS.accentColor,
    'font-heading': LEGACY_DESIGN_SYSTEM_DEFAULTS.headingFont,
    'font-body': LEGACY_DESIGN_SYSTEM_DEFAULTS.bodyFont,
  };
  const changed = candidates.some(([roleId, value]) =>
    typeof value === 'string' && value.trim() !== '' && value.trim().toLowerCase() !== defaults[roleId]?.toLowerCase());
  if (!changed) {
    return undefined;
  }
  const radius = typeof design.cornerStyle === 'string' ? pixelLength(design.cornerStyle) : undefined;
  const tokens: UiDesignToken[] = [];
  for (const [roleId, value] of candidates) {
    const role = ROLE_BY_ID.get(roleId);
    const clean = role ? sanitizeRoleValue(role, value) : undefined;
    if (role && clean !== undefined) {
      tokens.push({ id: role.id, label: role.label, kind: role.kind, value: clean });
    }
  }
  if (radius !== undefined) {
    tokens.push({ id: 'radius-base', label: 'Base radius', kind: 'radius', value: radius });
  }
  const noteParts: string[] = [];
  if (typeof design.spacingScale === 'string' && design.spacingScale.trim()) {
    noteParts.push(`Spacing scale: ${design.spacingScale.trim()}`);
  }
  if (radius === undefined && typeof design.cornerStyle === 'string' && design.cornerStyle.trim()) {
    noteParts.push(`Corner style: ${design.cornerStyle.trim()}`);
  }
  if (typeof design.brandDirection === 'string' && design.brandDirection.trim()) {
    noteParts.push(design.brandDirection.trim());
  }
  return {
    id: LEGACY_BRAND_PRESET_ID,
    label: 'Project brand',
    tokens,
    ...(noteParts.length > 0 ? { notes: noteParts.join(' · ').slice(0, MAX_NOTES) } : {}),
    source: { ruleId: 'legacy-design-system', extractedAt },
  };
}

// ── Extraction from a stylesheet ─────────────────────────────────

export interface BrandRoleNameRule {
  roleId: string;
  /** Matched against the custom property name without its `--`. */
  pattern: RegExp;
  describes: string;
}

/**
 * Which custom-property names fill which role.
 *
 * Small and literal, first match wins. A generous table would start claiming
 * `--primary-nav-height` as the primary colour; the value check would refuse
 * it, but the *reason* it was refused would be wrong.
 */
export const BRAND_ROLE_NAME_RULES: readonly BrandRoleNameRule[] = [
  { roleId: 'color-primary', pattern: /^(?:brand-|color-|colour-|clr-)?primary(?:-color|-colour)?$/i, describes: '`--primary`, `--color-primary`, `--brand-primary`' },
  { roleId: 'color-secondary', pattern: /^(?:brand-|color-|colour-|clr-)?secondary(?:-color|-colour)?$/i, describes: '`--secondary`, `--color-secondary`' },
  { roleId: 'color-accent', pattern: /^(?:brand-|color-|colour-|clr-)?accent(?:-color|-colour)?$/i, describes: '`--accent`, `--color-accent`' },
  { roleId: 'color-background', pattern: /^(?:color-|colour-|clr-)?(?:background|bg)(?:-color|-colour)?$/i, describes: '`--background`, `--bg`, `--color-background`' },
  { roleId: 'color-surface', pattern: /^(?:color-|colour-|clr-)?surface(?:-color|-colour)?$/i, describes: '`--surface`, `--color-surface`' },
  { roleId: 'color-text', pattern: /^(?:color-|colour-|clr-)?(?:text|foreground|fg)(?:-color|-colour)?$/i, describes: '`--text`, `--foreground`, `--color-text`' },
  { roleId: 'font-heading', pattern: /^(?:font-)?(?:heading|display|title)(?:-font|-family|-font-family)?$/i, describes: '`--font-heading`, `--heading-font`, `--display-font`' },
  { roleId: 'font-body', pattern: /^(?:font-)?(?:body|base|text)(?:-font|-family|-font-family)?$|^font-family$/i, describes: '`--font-body`, `--body-font`, `--font-family`' },
  { roleId: 'spacing-base', pattern: /^(?:spacing|space)(?:-base|-unit|-md)?$/i, describes: '`--spacing`, `--space-base`, `--spacing-unit`' },
  { roleId: 'radius-base', pattern: /^(?:border-)?radius(?:-base|-md)?$|^rounded$/i, describes: '`--radius`, `--border-radius`, `--radius-base`' },
];

export interface UnassignedProperty {
  property: string;
  line: number;
  reason: string;
}

export interface BrandExtraction {
  preset?: BrandPreset;
  /** Every role filled, with the property and line it came from. */
  evidence: Array<{ roleId: string; property: string; line: number }>;
  /** Properties read but not used, each with the reason. Never silently dropped. */
  unassigned: UnassignedProperty[];
  /** Set when nothing could be extracted, saying why. */
  refusal?: string;
  /** One sentence a surface cannot restate more confidently. */
  summary: string;
}

/**
 * Read a brand out of a stylesheet's `:root` custom properties.
 *
 * Untrusted text: bounded, never throws, and a property whose value cannot be
 * read as its role's kind is refused with the reason rather than coerced. A
 * `var(--x)` value is a reference, not a colour; a `1.25rem` spacing is a real
 * decision this cannot express in pixels without guessing the root size.
 */
export function extractBrandPresetFromStylesheet(input: {
  css: string;
  path: string;
  extractedAt: string;
  id?: string;
  label?: string;
}): BrandExtraction {
  const empty = (refusal: string): BrandExtraction => ({
    evidence: [],
    unassigned: [],
    refusal,
    summary: refusal,
  });
  if (typeof input.css !== 'string' || input.css.length === 0) {
    return empty('The stylesheet is empty.');
  }
  if (input.css.length > MAX_STYLESHEET_BYTES) {
    return empty(`The stylesheet is ${Math.round(input.css.length / 1024)} KB, past the ${MAX_STYLESHEET_BYTES / 1024} KB limit. Point this at the file that declares the tokens rather than a bundle.`);
  }

  const declarations = readRootCustomProperties(input.css);
  if (declarations.length === 0) {
    return empty('No custom properties were found in a `:root` block. Brand tokens are read from `:root { --name: value; }` only.');
  }

  const filled = new Map<string, { value: UiDesignTokenValue; property: string; line: number }>();
  const unassigned: UnassignedProperty[] = [];
  for (const declaration of declarations) {
    const rule = BRAND_ROLE_NAME_RULES.find(entry => entry.pattern.test(declaration.name));
    if (!rule) {
      pushUnassigned(unassigned, declaration.name, declaration.line, 'matches no declared role name');
      continue;
    }
    if (filled.has(rule.roleId)) {
      pushUnassigned(unassigned, declaration.name, declaration.line, `${rule.roleId} was already filled by --${filled.get(rule.roleId)?.property}`);
      continue;
    }
    if (/^var\(/i.test(declaration.value)) {
      pushUnassigned(unassigned, declaration.name, declaration.line, 'references another property, and a reference is not a value');
      continue;
    }
    const role = ROLE_BY_ID.get(rule.roleId);
    const value = role ? sanitizeRoleValue(role, declaration.value) : undefined;
    if (!role || value === undefined) {
      pushUnassigned(unassigned, declaration.name, declaration.line, role?.kind === 'color'
        ? 'is not a colour literal (hex, rgb or hsl)'
        : role?.kind === 'font-family'
          ? 'is not a usable font family'
          : 'is not a pixel length — other units would need the root size to convert, which is a guess');
      continue;
    }
    filled.set(rule.roleId, { value, property: declaration.name, line: declaration.line });
  }

  if (filled.size === 0) {
    return {
      evidence: [],
      unassigned,
      refusal: `${declarations.length} custom propert${declarations.length === 1 ? 'y was' : 'ies were'} read and none could fill a brand role. The names this reads are listed under the rules.`,
      summary: 'Nothing could be read into a brand.',
    };
  }

  const tokens: UiDesignToken[] = [];
  const evidence: BrandExtraction['evidence'] = [];
  for (const role of BRAND_ROLES) {
    const hit = filled.get(role.id);
    if (hit) {
      tokens.push({ id: role.id, label: role.label, kind: role.kind, value: hit.value });
      evidence.push({ roleId: role.id, property: hit.property, line: hit.line });
    }
  }
  const fileName = input.path.split('/').pop() ?? input.path;
  const preset: BrandPreset = {
    id: cleanBrandIdentifier(input.id) ?? cleanBrandIdentifier(`from-${fileName.replace(/\.[^.]+$/, '')}`) ?? 'from-stylesheet',
    label: cleanText(input.label, MAX_LABEL) || `From ${fileName}`,
    tokens,
    source: { ruleId: 'stylesheet-custom-properties', path: input.path.replace(/\\/g, '/'), extractedAt: input.extractedAt },
  };
  const parts = [`${tokens.length} role${tokens.length === 1 ? '' : 's'} read from ${fileName}`];
  if (unassigned.length > 0) {
    // Always stated. A preset that silently dropped half the file would look
    // like a file that only declared what it read.
    parts.push(`${unassigned.length} propert${unassigned.length === 1 ? 'y' : 'ies'} left unassigned`);
  }
  return { preset, evidence, unassigned, summary: `${parts.join('; ')}.` };
}

function pushUnassigned(list: UnassignedProperty[], property: string, line: number, reason: string): void {
  if (list.length < MAX_UNASSIGNED) {
    list.push({ property, line, reason });
  }
}

interface RootDeclaration {
  name: string;
  value: string;
  line: number;
}

/** The `--name: value` pairs inside every `:root { … }` block, with line numbers. */
function readRootCustomProperties(css: string): RootDeclaration[] {
  const declarations: RootDeclaration[] = [];
  const text = stripControl(css);
  // Comments removed first, so a commented-out token is not read as declared.
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
  const blockPattern = /:root\s*\{([^}]*)\}/g;
  let block: RegExpExecArray | null;
  while ((block = blockPattern.exec(withoutComments)) !== null) {
    const bodyStart = block.index + block[0].indexOf('{') + 1;
    const body = block[1] ?? '';
    const declarationPattern = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
    let declaration: RegExpExecArray | null;
    while ((declaration = declarationPattern.exec(body)) !== null) {
      const absolute = bodyStart + declaration.index;
      const line = withoutComments.slice(0, absolute).split('\n').length;
      declarations.push({
        name: declaration[1] ?? '',
        value: (declaration[2] ?? '').trim().slice(0, 200),
        line,
      });
      if (declarations.length >= 200) {
        return declarations;
      }
    }
  }
  return declarations;
}

// ── Application ──────────────────────────────────────────────────

/** The graph id a preset's role materialises under. */
export function brandTokenId(presetId: string, roleId: string): string {
  return `brand-${presetId}-${roleId}`;
}

const MATERIALISED_PREFIX = 'brand-';

/**
 * Rebuild the graph's token list around the presets.
 *
 * Materialised tokens are replaced wholesale — they are a projection — and the
 * role tokens are pointed at the default preset by alias. A role token that
 * already holds a direct value is left alone: that is a local override, and
 * overwriting it would discard a decision somebody made on this surface.
 * Tokens that are neither materialised nor roles pass through untouched.
 */
export function applyBrandPresets(
  tokens: readonly UiDesignToken[],
  presets: readonly BrandPreset[],
  defaultPresetId: string | undefined,
): UiDesignToken[] {
  const presetIds = new Set(presets.map(preset => preset.id));
  const kept = tokens.filter(token => !token.id.startsWith(MATERIALISED_PREFIX));
  const materialised: UiDesignToken[] = [];
  for (const preset of presets) {
    for (const token of preset.tokens) {
      // Preset tokens are direct values by construction (the sanitizer drops
      // aliases), and the narrowing here is what lets the type say so.
      const value = 'value' in token ? token.value : undefined;
      if (value === undefined) {
        continue;
      }
      materialised.push({
        id: brandTokenId(preset.id, token.id),
        label: `${preset.label} · ${token.label}`,
        kind: token.kind,
        value,
      });
    }
  }
  const defaultPreset = defaultPresetId && presetIds.has(defaultPresetId)
    ? presets.find(preset => preset.id === defaultPresetId)
    : undefined;

  const byId = new Map(kept.map(token => [token.id, token]));
  const result: UiDesignToken[] = [];
  for (const token of kept) {
    const role = ROLE_BY_ID.get(token.id);
    if (!role || !defaultPreset) {
      result.push(token);
      continue;
    }
    const brandToken = defaultPreset.tokens.find(entry => entry.id === role.id);
    if ('value' in token && token.value !== undefined) {
      // A local override. Kept, and reported by describeBrandApplication.
      result.push(token);
      continue;
    }
    if (brandToken) {
      result.push({ id: role.id, label: role.label, kind: role.kind, aliasOf: brandTokenId(defaultPreset.id, role.id) });
    } else {
      // The preset does not fill this role; whatever the alias pointed at
      // before is left as it was.
      result.push(token);
    }
  }
  if (defaultPreset) {
    for (const brandToken of defaultPreset.tokens) {
      const role = ROLE_BY_ID.get(brandToken.id);
      if (role && !byId.has(role.id)) {
        result.push({ id: role.id, label: role.label, kind: role.kind, aliasOf: brandTokenId(defaultPreset.id, role.id) });
      }
    }
  }
  return [...result, ...materialised];
}

export type BrandRoleApplication =
  /** The role token aliases this preset's value. */
  | 'aliased'
  /** The role token holds its own value; the preset is not in effect for it. */
  | 'overridden'
  /** The preset does not fill this role. */
  | 'missing'
  /** The role token aliases something other than this preset. */
  | 'other';

export interface BrandApplicationReport {
  presetId: string;
  roles: Array<{ roleId: string; label: string; application: BrandRoleApplication }>;
  aliased: number;
  overridden: number;
  missing: number;
  /** One sentence naming the overrides, so a surface cannot claim a brand it only partly wears. */
  summary: string;
  rules: readonly BrandPresetRule[];
}

/** How far a preset is actually in effect on a token set. */
export function describeBrandApplication(
  tokens: readonly UiDesignToken[],
  preset: BrandPreset,
): BrandApplicationReport {
  const byId = new Map(tokens.map(token => [token.id, token]));
  const roles = BRAND_ROLES.map(role => {
    const provided = preset.tokens.some(token => token.id === role.id);
    const token = byId.get(role.id);
    let application: BrandRoleApplication;
    if (!provided) {
      application = 'missing';
    } else if (!token) {
      application = 'other';
    } else if ('value' in token && token.value !== undefined) {
      application = 'overridden';
    } else if (token.aliasOf === brandTokenId(preset.id, role.id)) {
      application = 'aliased';
    } else {
      application = 'other';
    }
    return { roleId: role.id, label: role.label, application };
  });
  const aliased = roles.filter(role => role.application === 'aliased').length;
  const overridden = roles.filter(role => role.application === 'overridden');
  const missing = roles.filter(role => role.application === 'missing').length;
  const parts = [`${aliased} of ${BRAND_ROLES.length} roles follow "${preset.label}"`];
  if (overridden.length > 0) {
    parts.push(`${overridden.length} overridden locally (${overridden.map(role => role.label.toLowerCase()).join(', ')})`);
  }
  if (missing > 0) {
    parts.push(`${missing} not set by the preset`);
  }
  return {
    presetId: preset.id,
    roles,
    aliased,
    overridden: overridden.length,
    missing,
    summary: `${parts.join('; ')}.`,
    rules: BRAND_PRESET_RULES,
  };
}

/**
 * Project the default preset back onto the legacy flat fields.
 *
 * The old readers still consume `designSystem`; until they read the graph this
 * keeps them from disagreeing with it. Only roles the preset fills are written,
 * so a preset with no fonts leaves the fonts as they were.
 */
export function projectDesignSystemFromBrand(
  design: WebsiteDesignSystem,
  preset: BrandPreset | undefined,
): WebsiteDesignSystem {
  if (!preset) {
    return design;
  }
  const value = (roleId: string): string | undefined => {
    const token = preset.tokens.find(entry => entry.id === roleId);
    return token && 'value' in token && typeof token.value === 'string' ? token.value : undefined;
  };
  return {
    ...design,
    primaryColor: value('color-primary') ?? design.primaryColor,
    secondaryColor: value('color-secondary') ?? design.secondaryColor,
    accentColor: value('color-accent') ?? design.accentColor,
    headingFont: value('font-heading') ?? design.headingFont,
    bodyFont: value('font-body') ?? design.bodyFont,
  };
}

/** Which preset a screen wears, and why. */
export function resolveScreenBrand(input: {
  brands: readonly BrandPreset[];
  defaultBrandId?: string;
  brandRef?: string;
}): { preset?: BrandPreset; source: 'screen' | 'default' | 'none' } {
  const byId = new Map(input.brands.map(preset => [preset.id, preset]));
  const own = input.brandRef ? byId.get(input.brandRef) : undefined;
  if (own) {
    return { preset: own, source: 'screen' };
  }
  const fallback = input.defaultBrandId ? byId.get(input.defaultBrandId) : undefined;
  return fallback ? { preset: fallback, source: 'default' } : { source: 'none' };
}
