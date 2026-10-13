/**
 * Representative VS Code theme colours, as a webview receives them.
 *
 * A webview never sees a theme file. VS Code resolves every registered colour
 * for the active theme and injects the result as a `--vscode-*` custom property
 * on the document, so what a panel's CSS actually resolves against is *the
 * theme file layered over the colour registry's defaults*. Both halves are
 * transcribed here, and only from source:
 *
 * - **Theme files** — `extensions/theme-defaults/themes/{dark_modern,light_modern,
 *   hc_black,hc_light}.json` in microsoft/vscode (`main`, read on
 *   {@link VSCODE_THEME_TOKENS_VERIFIED_AT}). Dark Modern and Light Modern set
 *   most of what is below; `hc_black.json` sets only the editor background and
 *   foreground, and `hc_light.json` sets no colours at all.
 * - **Registry defaults** — everything a theme does not set comes from
 *   `registerColor(id, { dark, light, hcDark, hcLight })` in
 *   `src/vs/platform/theme/common/colors/{baseColors,inputColors,editorColors,
 *   listColors,chartsColors}.ts`, `src/vs/workbench/common/theme.ts` and
 *   `src/vs/workbench/contrib/testing/browser/theme.ts`.
 *
 * Two rules keep this honest rather than plausible:
 *
 * - **A colour the registry resolves to `null` is absent, never guessed.** VS
 *   Code emits no variable for it, so the panel's own `var(--x, fallback)` is
 *   what renders — `contrastBorder` outside high contrast, `testing.iconFailed`
 *   inside it. Writing a value in would test a page nobody sees.
 * - **A translucent default keeps its alpha** (`#ffffffb3`, `#ffffff1a`). The
 *   registry's `transparent(foreground, 0.7)` is emitted as a translucent colour
 *   and composited by the browser; the resolver composites it over the page
 *   rather than this file pre-baking a result.
 *
 * Nothing here is approximated. A token not listed is one no rule under test
 * needed, not one somebody estimated.
 */

export const VSCODE_THEME_TOKENS_VERIFIED_AT = '2026-10-07';

/** The body classes VS Code sets for a theme kind (HC light sets both). */
export type ThemeBodyClass = 'vscode-dark' | 'vscode-light' | 'vscode-high-contrast' | 'vscode-high-contrast-light';

export interface VscodeThemeFixture {
  readonly id: 'dark-modern' | 'light-modern' | 'hc-dark' | 'hc-light';
  readonly label: string;
  /** Classes on `<body>`. HC light carries `vscode-high-contrast` as well. */
  readonly bodyClasses: readonly ThemeBodyClass[];
  readonly tokens: Readonly<Record<string, string>>;
  /**
   * Registered colours this theme resolves to `null`, so VS Code emits no
   * variable and the panel's own fallback is what renders. Every other
   * `--vscode-*` name missing from `tokens` is *unknown*, not absent.
   */
  readonly absent: readonly string[];
}

/** Dark Modern — `dark_modern.json`, then registry `dark` defaults. */
const DARK_MODERN: Record<string, string> = {
  '--vscode-foreground': '#cccccc',
  '--vscode-editor-background': '#1f1f1f',
  '--vscode-editor-foreground': '#cccccc',
  '--vscode-sideBar-background': '#181818',
  '--vscode-editorWidget-background': '#202020',
  '--vscode-widget-border': '#313131',
  '--vscode-panel-border': '#2b2b2b',
  '--vscode-focusBorder': '#0078d4',
  '--vscode-button-background': '#0078d4',
  '--vscode-button-foreground': '#ffffff',
  '--vscode-button-border': '#ffffff1a',
  '--vscode-button-hoverBackground': '#026ec1',
  '--vscode-button-secondaryBackground': '#00000000',
  '--vscode-button-secondaryForeground': '#cccccc',
  '--vscode-descriptionForeground': '#9d9d9d',
  '--vscode-badge-background': '#616161',
  '--vscode-badge-foreground': '#f8f8f8',
  '--vscode-textLink-foreground': '#4daafc',
  '--vscode-textCodeBlock-background': '#2b2b2b',
  '--vscode-textBlockQuote-background': '#2b2b2b',
  '--vscode-errorForeground': '#f85149',
  '--vscode-input-background': '#313131',
  '--vscode-input-foreground': '#cccccc',
  '--vscode-input-border': '#3c3c3c',
  '--vscode-dropdown-border': '#3c3c3c',
  '--vscode-list-hoverBackground': '#2a2d2e',
  // Registry `dark` defaults.
  '--vscode-inputValidation-errorBackground': '#5a1d1d',
  '--vscode-inputValidation-errorBorder': '#be1100',
  '--vscode-inputValidation-warningBackground': '#352a05',
  '--vscode-inputValidation-warningBorder': '#b89500',
  '--vscode-editorWarning-foreground': '#cca700',
  '--vscode-editorError-foreground': '#f14c4c',
  '--vscode-editorInfo-foreground': '#59a4f9',
  '--vscode-charts-blue': '#59a4f9',
  '--vscode-charts-green': '#89d185',
  '--vscode-charts-yellow': '#cca700',
  '--vscode-charts-purple': '#b180d7',
  '--vscode-charts-red': '#f14c4c',
  '--vscode-testing-iconPassed': '#73c991',
  '--vscode-testing-iconFailed': '#f88070',
  '--vscode-testing-iconQueued': '#cca700',
};

/** Light Modern — `light_modern.json`, then registry `light` defaults. */
const LIGHT_MODERN: Record<string, string> = {
  '--vscode-foreground': '#3b3b3b',
  '--vscode-editor-background': '#ffffff',
  '--vscode-editor-foreground': '#3b3b3b',
  '--vscode-sideBar-background': '#f8f8f8',
  '--vscode-editorWidget-background': '#f8f8f8',
  '--vscode-widget-border': '#e5e5e5',
  '--vscode-panel-border': '#e5e5e5',
  '--vscode-focusBorder': '#005fb8',
  '--vscode-button-background': '#005fb8',
  '--vscode-button-foreground': '#ffffff',
  '--vscode-button-border': '#0000001a',
  '--vscode-button-hoverBackground': '#0258a8',
  '--vscode-button-secondaryBackground': '#e5e5e5',
  '--vscode-button-secondaryForeground': '#3b3b3b',
  '--vscode-descriptionForeground': '#3b3b3b',
  '--vscode-badge-background': '#cccccc',
  '--vscode-badge-foreground': '#3b3b3b',
  '--vscode-textLink-foreground': '#005fb8',
  '--vscode-textCodeBlock-background': '#f8f8f8',
  '--vscode-textBlockQuote-background': '#f8f8f8',
  '--vscode-errorForeground': '#f85149',
  '--vscode-input-background': '#ffffff',
  '--vscode-input-foreground': '#3b3b3b',
  '--vscode-input-border': '#cecece',
  '--vscode-dropdown-border': '#cecece',
  '--vscode-list-hoverBackground': '#f2f2f2',
  // Registry `light` defaults.
  '--vscode-inputValidation-errorBackground': '#f2dede',
  '--vscode-inputValidation-errorBorder': '#be1100',
  '--vscode-inputValidation-warningBackground': '#f6f5d2',
  '--vscode-inputValidation-warningBorder': '#b89500',
  '--vscode-editorWarning-foreground': '#bf8803',
  '--vscode-editorError-foreground': '#e51400',
  '--vscode-editorInfo-foreground': '#0063d3',
  '--vscode-charts-blue': '#0063d3',
  '--vscode-charts-green': '#388a34',
  '--vscode-charts-yellow': '#bf8803',
  '--vscode-charts-purple': '#652d90',
  '--vscode-charts-red': '#e51400',
  '--vscode-testing-iconPassed': '#73c991',
  '--vscode-testing-iconFailed': '#b01011',
  '--vscode-testing-iconQueued': '#855f00',
};

/**
 * High Contrast (dark) — `hc_black.json` sets only the editor pair; the rest is
 * registry `hcDark`. `testing.iconFailed`/`iconQueued` resolve to `null` in
 * high contrast (via `list.errorForeground`/`list.warningForeground`) and are
 * absent, as are `button.secondaryBackground` and `textBlockQuote.background`.
 */
const HC_DARK: Record<string, string> = {
  '--vscode-editor-background': '#000000',
  '--vscode-editor-foreground': '#ffffff',
  '--vscode-foreground': '#ffffff',
  '--vscode-sideBar-background': '#000000',
  '--vscode-editorWidget-background': '#0c141f',
  '--vscode-contrastBorder': '#6fc3df',
  '--vscode-contrastActiveBorder': '#f38518',
  '--vscode-widget-border': '#6fc3df',
  '--vscode-panel-border': '#6fc3df',
  '--vscode-focusBorder': '#f38518',
  '--vscode-button-background': '#000000',
  '--vscode-button-foreground': '#ffffff',
  '--vscode-button-border': '#6fc3df',
  '--vscode-button-hoverBackground': '#000000',
  '--vscode-button-secondaryForeground': '#ffffff',
  '--vscode-descriptionForeground': '#ffffffb3',
  '--vscode-badge-background': '#000000',
  '--vscode-badge-foreground': '#ffffff',
  '--vscode-textLink-foreground': '#21a6ff',
  '--vscode-textCodeBlock-background': '#000000',
  '--vscode-errorForeground': '#f48771',
  '--vscode-input-background': '#000000',
  '--vscode-input-foreground': '#ffffff',
  '--vscode-input-border': '#6fc3df',
  '--vscode-list-hoverBackground': '#ffffff1a',
  '--vscode-inputValidation-errorBackground': '#000000',
  '--vscode-inputValidation-errorBorder': '#6fc3df',
  '--vscode-inputValidation-warningBackground': '#000000',
  '--vscode-inputValidation-warningBorder': '#6fc3df',
  '--vscode-editorWarning-foreground': '#ffd370',
  '--vscode-editorError-foreground': '#f48771',
  '--vscode-editorInfo-foreground': '#59a4f9',
  '--vscode-charts-blue': '#59a4f9',
  '--vscode-charts-green': '#89d185',
  '--vscode-charts-yellow': '#ffd370',
  '--vscode-charts-purple': '#b180d7',
  '--vscode-charts-red': '#f48771',
  '--vscode-testing-iconPassed': '#73c991',
};

/** High Contrast Light — `hc_light.json` sets no colours; all registry `hcLight`. */
const HC_LIGHT: Record<string, string> = {
  '--vscode-editor-background': '#ffffff',
  '--vscode-editor-foreground': '#292929',
  '--vscode-foreground': '#292929',
  '--vscode-sideBar-background': '#ffffff',
  '--vscode-editorWidget-background': '#ffffff',
  '--vscode-contrastBorder': '#0f4a85',
  '--vscode-contrastActiveBorder': '#006bbd',
  '--vscode-widget-border': '#0f4a85',
  '--vscode-panel-border': '#0f4a85',
  '--vscode-focusBorder': '#006bbd',
  '--vscode-button-background': '#0f4a85',
  '--vscode-button-foreground': '#ffffff',
  '--vscode-button-border': '#0f4a85',
  '--vscode-button-hoverBackground': '#0f4a85',
  '--vscode-button-secondaryBackground': '#ffffff',
  '--vscode-button-secondaryForeground': '#292929',
  '--vscode-descriptionForeground': '#292929b3',
  '--vscode-badge-background': '#0f4a85',
  '--vscode-badge-foreground': '#ffffff',
  '--vscode-textLink-foreground': '#0f4a85',
  '--vscode-textCodeBlock-background': '#f2f2f2',
  '--vscode-textBlockQuote-background': '#f2f2f2',
  '--vscode-errorForeground': '#b5200d',
  '--vscode-input-background': '#ffffff',
  '--vscode-input-foreground': '#292929',
  '--vscode-input-border': '#0f4a85',
  '--vscode-list-hoverBackground': '#0f4a851a',
  '--vscode-inputValidation-errorBackground': '#ffffff',
  '--vscode-inputValidation-errorBorder': '#0f4a85',
  '--vscode-inputValidation-warningBackground': '#ffffff',
  '--vscode-inputValidation-warningBorder': '#0f4a85',
  '--vscode-inputValidation-errorForeground': '#292929',
  '--vscode-inputValidation-warningForeground': '#292929',
  '--vscode-editorWarning-foreground': '#895503',
  '--vscode-editorError-foreground': '#b5200d',
  '--vscode-editorInfo-foreground': '#0063d3',
  '--vscode-charts-blue': '#0063d3',
  '--vscode-charts-green': '#374e06',
  '--vscode-charts-yellow': '#895503',
  '--vscode-charts-purple': '#652d90',
  '--vscode-charts-red': '#b5200d',
  '--vscode-testing-iconPassed': '#007100',
};

/** `inputValidation.{error,warning}Foreground` are `null` except in HC light. */
const NO_VALIDATION_FOREGROUND = ['--vscode-inputValidation-errorForeground', '--vscode-inputValidation-warningForeground'];

export const VSCODE_THEMES: readonly VscodeThemeFixture[] = [
  {
    id: 'dark-modern', label: 'Dark Modern', bodyClasses: ['vscode-dark'], tokens: DARK_MODERN,
    // `contrastBorder` and `contrastActiveBorder` are `null` outside high contrast.
    absent: ['--vscode-contrastBorder', '--vscode-contrastActiveBorder', ...NO_VALIDATION_FOREGROUND],
  },
  {
    id: 'light-modern', label: 'Light Modern', bodyClasses: ['vscode-light'], tokens: LIGHT_MODERN,
    absent: ['--vscode-contrastBorder', '--vscode-contrastActiveBorder', ...NO_VALIDATION_FOREGROUND],
  },
  {
    id: 'hc-dark', label: 'Dark High Contrast', bodyClasses: ['vscode-high-contrast'], tokens: HC_DARK,
    // `list.errorForeground`/`list.warningForeground` are `null` in high
    // contrast, and the testing icons default to them.
    absent: ['--vscode-testing-iconFailed', '--vscode-testing-iconQueued',
      '--vscode-button-secondaryBackground', '--vscode-textBlockQuote-background', ...NO_VALIDATION_FOREGROUND],
  },
  {
    id: 'hc-light', label: 'Light High Contrast', bodyClasses: ['vscode-high-contrast', 'vscode-high-contrast-light'], tokens: HC_LIGHT,
    absent: ['--vscode-testing-iconFailed', '--vscode-testing-iconQueued'],
  },
];
