/**
 * DataPrivacyManager — classifies context against the project's Data Privacy
 * policy and enforces that classified (confidential / proprietary / regulated)
 * content may only reach user-selected "trusted" models.
 *
 * The manager is intentionally free of the `vscode` API so it can be unit
 * tested in isolation. Persistence helpers use node `fs` only, matching the
 * `readProjectTestingConfig` pattern. The orchestrator drives enforcement:
 *  - {@link classifyText} / {@link classifyPath} mark context as classified;
 *  - {@link isModelTrusted} gates routing (RoutingConstraints.requireTrustedModel);
 *  - {@link redactForModel} is the fail-safe applied at the redaction boundary
 *    when an un-trusted model is selected anyway (pins, parallel overflow, or a
 *    confidential file surfaced mid-task via a tool result).
 *
 * Safety-first defaults: an empty `trustedModelIds` list means *nothing* is
 * trusted — classified content is redacted for every model until the user
 * explicitly opts a model in.
 */

import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import type {
  DataPrivacyActivityEvent,
  DataPrivacyConfig,
  DataPrivacyMatch,
  DataPrivacyRule,
  DataPrivacySensitivity,
} from '../types.js';
import { resolveCompliancePacks, type ComplianceDetector } from './compliancePacks.js';

export const DATA_PRIVACY_SSOT_PATH = 'project_memory/operations/data-privacy.json';

export const REDACTION_PLACEHOLDER = '[CONFIDENTIAL]';

/** Upper bound on a custom regex source length, to avoid pathological patterns. */
const MAX_REGEX_SOURCE = 512;

/** Cap on retained activity events (most recent kept). */
const MAX_ACTIVITY_EVENTS = 1000;

export interface ClassificationResult {
  hasClassified: boolean;
  matches: DataPrivacyMatch[];
}

interface CompiledMatcher {
  source: string;          // `rule:<id>` or `pack:<packId>:<detectorId>`
  label: string;
  sensitivity: DataPrivacySensitivity;
  pattern: RegExp;
  validate?: (match: string) => boolean;
}

export function defaultDataPrivacyConfig(): DataPrivacyConfig {
  return {
    version: 1,
    enabled: false,
    rules: [],
    compliancePacks: [],
    trustedModelIds: [],
  };
}

export class DataPrivacyManager {
  private config: DataPrivacyConfig;
  private textMatchers: CompiledMatcher[] = [];
  private pathRules: DataPrivacyRule[] = [];
  private activity: DataPrivacyActivityEvent[] = [];
  private onActivityRecorded?: (activity: readonly DataPrivacyActivityEvent[]) => void;

  constructor(config: DataPrivacyConfig = defaultDataPrivacyConfig()) {
    this.config = config;
    this.recompile();
  }

  /** Register a callback invoked whenever activity is recorded (for persistence). */
  setActivityListener(listener: (activity: readonly DataPrivacyActivityEvent[]) => void): void {
    this.onActivityRecorded = listener;
  }

  /** Restore previously persisted activity (e.g. from globalState on startup). */
  setActivity(events: readonly DataPrivacyActivityEvent[]): void {
    this.activity = events.slice(-MAX_ACTIVITY_EVENTS);
  }

  getActivity(): readonly DataPrivacyActivityEvent[] {
    return this.activity;
  }

  /**
   * Record that one or more detectors fired for a real task. `trusted` reflects
   * whether the selected model could receive the content (false = redacted).
   * No matched values are stored. Called by the orchestrator enforcement path,
   * never by the dashboard test box.
   */
  recordCatch(matches: readonly DataPrivacyMatch[], trusted: boolean): void {
    if (matches.length === 0) {
      return;
    }
    const ts = Date.now();
    for (const match of matches) {
      this.activity.push({ ts, source: match.source, label: match.label, sensitivity: match.sensitivity, trusted });
    }
    if (this.activity.length > MAX_ACTIVITY_EVENTS) {
      this.activity = this.activity.slice(-MAX_ACTIVITY_EVENTS);
    }
    this.onActivityRecorded?.(this.activity);
  }

  /** Replace the active policy and recompile matchers. */
  setConfig(config: DataPrivacyConfig): void {
    this.config = config;
    this.recompile();
  }

  getConfig(): DataPrivacyConfig {
    return this.config;
  }

  isEnabled(): boolean {
    return this.config.enabled === true;
  }

  getTrustedModelIds(): string[] {
    return [...this.config.trustedModelIds];
  }

  /** A model is trusted only if the policy is enabled and lists it explicitly. */
  isModelTrusted(modelId: string | undefined): boolean {
    if (!modelId) {
      return false;
    }
    return this.config.trustedModelIds.includes(modelId);
  }

  /**
   * Scan text for classified content. Returns every distinct matcher that
   * fired (deduped by source) so the boundary can report what was caught
   * without echoing the matched value.
   */
  classifyText(text: string): ClassificationResult {
    if (!this.isEnabled() || !text || this.textMatchers.length === 0) {
      return { hasClassified: false, matches: [] };
    }
    const seen = new Set<string>();
    const matches: DataPrivacyMatch[] = [];
    for (const matcher of this.textMatchers) {
      if (seen.has(matcher.source)) {
        continue;
      }
      if (this.matcherFires(matcher, text)) {
        seen.add(matcher.source);
        matches.push({ source: matcher.source, label: matcher.label, sensitivity: matcher.sensitivity });
      }
    }
    return { hasClassified: matches.length > 0, matches };
  }

  /**
   * Classify a workspace-relative or absolute file path against `path` rules.
   * Returns the first matching rule, or undefined. Paths are normalized and
   * traversal segments are collapsed before matching.
   */
  classifyPath(filePath: string, workspaceRoot?: string): DataPrivacyRule | undefined {
    if (!this.isEnabled() || !filePath || this.pathRules.length === 0) {
      return undefined;
    }
    const rel = this.toWorkspaceRelative(filePath, workspaceRoot);
    if (rel === undefined) {
      return undefined;
    }
    for (const rule of this.pathRules) {
      if (globToRegExp(rule.value).test(rel)) {
        return rule;
      }
    }
    return undefined;
  }

  /**
   * Fail-safe redaction. When `modelId` is trusted (or the policy is disabled)
   * the text is returned unchanged; otherwise every classified span is replaced
   * with {@link REDACTION_PLACEHOLDER}.
   */
  redactForModel(text: string, modelId: string | undefined): { text: string; redactedCount: number; matches: DataPrivacyMatch[] } {
    if (!this.isEnabled() || !text || this.isModelTrusted(modelId) || this.textMatchers.length === 0) {
      return { text, redactedCount: 0, matches: [] };
    }
    let result = text;
    let redactedCount = 0;
    const seen = new Set<string>();
    const matches: DataPrivacyMatch[] = [];
    for (const matcher of this.textMatchers) {
      matcher.pattern.lastIndex = 0;
      const before = result;
      result = result.replace(matcher.pattern, (m) => {
        if (matcher.validate && !matcher.validate(m)) {
          return m;
        }
        redactedCount += 1;
        if (!seen.has(matcher.source)) {
          seen.add(matcher.source);
          matches.push({ source: matcher.source, label: matcher.label, sensitivity: matcher.sensitivity });
        }
        return REDACTION_PLACEHOLDER;
      });
      matcher.pattern.lastIndex = 0;
      void before;
    }
    return { text: result, redactedCount, matches };
  }

  // ── internal ───────────────────────────────────────────────────

  private matcherFires(matcher: CompiledMatcher, text: string): boolean {
    matcher.pattern.lastIndex = 0;
    if (!matcher.validate) {
      const hit = matcher.pattern.test(text);
      matcher.pattern.lastIndex = 0;
      return hit;
    }
    let m: RegExpExecArray | null;
    let fired = false;
    while ((m = matcher.pattern.exec(text)) !== null) {
      if (matcher.validate(m[0])) {
        fired = true;
        break;
      }
      if (m.index === matcher.pattern.lastIndex) {
        matcher.pattern.lastIndex += 1; // avoid zero-width loop
      }
    }
    matcher.pattern.lastIndex = 0;
    return fired;
  }

  private recompile(): void {
    this.textMatchers = [];
    this.pathRules = [];
    if (!this.config.enabled) {
      return;
    }

    for (const rule of this.config.rules) {
      if (!rule.enabled) {
        continue;
      }
      if (rule.kind === 'path') {
        this.pathRules.push(rule);
        continue;
      }
      const pattern = this.compileRulePattern(rule);
      if (pattern) {
        this.textMatchers.push({
          source: `rule:${rule.id}`,
          label: rule.label || (rule.kind === 'regex' ? 'custom pattern' : rule.value),
          sensitivity: rule.sensitivity,
          pattern,
        });
      }
    }

    for (const pack of resolveCompliancePacks(this.config.compliancePacks)) {
      for (const detector of pack.detectors) {
        this.textMatchers.push(compilePackMatcher(pack.id, pack.sensitivity, pack.label, detector));
      }
    }
  }

  private compileRulePattern(rule: DataPrivacyRule): RegExp | undefined {
    try {
      if (rule.kind === 'term') {
        return new RegExp(`\\b${escapeRegExp(rule.value)}\\b`, 'gi');
      }
      // kind === 'regex'
      if (!rule.value || rule.value.length > MAX_REGEX_SOURCE) {
        return undefined;
      }
      return new RegExp(rule.value, 'gi');
    } catch {
      // Invalid user regex — skip rather than throw (defensive boundary).
      console.warn(`[AtlasMind] Data Privacy: skipping invalid rule "${rule.id}".`);
      return undefined;
    }
  }

  private toWorkspaceRelative(filePath: string, workspaceRoot?: string): string | undefined {
    const normalized = path.normalize(filePath).replace(/\\/g, '/');
    if (workspaceRoot) {
      const root = path.normalize(workspaceRoot).replace(/\\/g, '/');
      if (path.isAbsolute(filePath)) {
        const rel = path.relative(root, normalized).replace(/\\/g, '/');
        // Reject paths that escape the workspace root.
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          return undefined;
        }
        return rel;
      }
    }
    return normalized.replace(/^\.\//, '').replace(/^\/+/, '');
  }
}

function compilePackMatcher(
  packId: string,
  sensitivity: DataPrivacySensitivity,
  packLabel: string,
  detector: ComplianceDetector,
): CompiledMatcher {
  // Clone the detector regex so per-call lastIndex mutation is isolated.
  const flags = detector.pattern.flags.includes('g') ? detector.pattern.flags : `${detector.pattern.flags}g`;
  return {
    source: `pack:${packId}:${detector.id}`,
    label: `${packLabel} — ${detector.label}`,
    sensitivity,
    pattern: new RegExp(detector.pattern.source, flags),
    validate: detector.validate,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a simple glob (`*`, `**`, `?`) into an anchored RegExp matched against
 * a forward-slash workspace-relative path. `**` matches across directory
 * separators; `*` does not.
 */
export function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  let out = '';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        i++;
        if (normalized[i + 1] === '/') {
          // `**/` → zero or more leading directory segments.
          i++;
          out += '(?:.*/)?';
        } else {
          // trailing/standalone `**` → match across directories, files included.
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  // A trailing-folder rule like `secret/` or `secret` should match everything beneath it.
  return new RegExp(`^${out}(?:/.*)?$`, 'i');
}

// ── Persistence (node fs; vscode-free) ───────────────────────────

export function readDataPrivacyConfig(workspaceRoot: string): DataPrivacyConfig | undefined {
  const configPath = path.join(workspaceRoot, DATA_PRIVACY_SSOT_PATH);
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as DataPrivacyConfig;
    if (parsed.version === 1 && Array.isArray(parsed.rules) && Array.isArray(parsed.trustedModelIds)) {
      return {
        ...parsed,
        compliancePacks: Array.isArray(parsed.compliancePacks) ? parsed.compliancePacks : [],
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function writeDataPrivacyConfig(workspaceRoot: string, config: DataPrivacyConfig): Promise<void> {
  const configPath = path.join(workspaceRoot, DATA_PRIVACY_SSOT_PATH);
  await mkdir(path.dirname(configPath), { recursive: true });
  const updated: DataPrivacyConfig = { ...config, updatedAt: new Date().toISOString() };
  await writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8');
}
