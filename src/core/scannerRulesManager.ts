import * as vscode from 'vscode';
import type { ScannerRulesConfig, SerializedScanRule } from '../types.js';
import { BUILTIN_SCAN_RULES } from './skillScanner.js';

const STORAGE_KEY = 'atlasmind.scannerRulesConfig';

/**
 * Persists scanner rule overrides and custom rules in VS Code globalState.
 * Provides the effective rule list to the scanner and the configuration panel.
 */
export class ScannerRulesManager {
  private config: ScannerRulesConfig;

  constructor(private readonly globalState: vscode.Memento) {
    const stored = globalState.get<ScannerRulesConfig>(STORAGE_KEY);
    this.config = stored ?? { overrides: {}, customRules: [] };
  }

  getConfig(): ScannerRulesConfig {
    return this.config;
  }

  /** Returns the full effective rule list (built-ins merged with overrides, plus custom rules). */
  getEffectiveRules(): SerializedScanRule[] {
    const merged: SerializedScanRule[] = BUILTIN_SCAN_RULES.map(rule => {
      const override = this.config.overrides[rule.id];
      return override ? { ...rule, ...override } : rule;
    });
    return [...merged, ...this.config.customRules];
  }

  /** Apply a partial update to a built-in rule (severity, message, enabled). */
  updateBuiltInRule(
    id: string,
    patch: Partial<Pick<SerializedScanRule, 'severity' | 'message' | 'enabled'>>,
  ): void {
    this.config = {
      ...this.config,
      overrides: {
        ...this.config.overrides,
        [id]: { ...(this.config.overrides[id] ?? {}), ...patch },
      },
    };
    void this.persist();
  }

  /** Reset a built-in rule to its factory default by removing any override. */
  resetBuiltInRule(id: string): void {
    const overrides = { ...this.config.overrides };
    delete overrides[id];
    this.config = { ...this.config, overrides };
    void this.persist();
  }

  /** Add or replace a custom rule. Throws if the pattern is not a valid regex. */
  upsertCustomRule(rule: Omit<SerializedScanRule, 'builtIn'>): void {
    try {
      new RegExp(rule.pattern);
    } catch {
      throw new Error(`Invalid regex pattern for rule "${rule.id}": ${rule.pattern}`);
    }
    const existing = this.config.customRules.filter(r => r.id !== rule.id);
    this.config = {
      ...this.config,
      customRules: [...existing, { ...rule, builtIn: false }],
    };
    void this.persist();
  }

  /** Remove a custom rule by id. Has no effect on built-in rules. */
  deleteCustomRule(id: string): void {
    this.config = {
      ...this.config,
      customRules: this.config.customRules.filter(r => r.id !== id),
    };
    void this.persist();
  }

  /** Replace the entire config (used when the webview saves wholesale). */
  replaceConfig(config: ScannerRulesConfig): void {
    // Validate all custom rule patterns before accepting
    for (const rule of config.customRules) {
      try {
        new RegExp(rule.pattern);
      } catch {
        throw new Error(`Invalid regex pattern for rule "${rule.id}": ${rule.pattern}`);
      }
    }
    this.config = config;
    void this.persist();
  }

  private async persist(): Promise<void> {
    await this.globalState.update(STORAGE_KEY, this.config);
  }
}
