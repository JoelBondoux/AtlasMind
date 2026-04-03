import { readFileSync } from 'fs';
import type { ScannerRulesConfig, SerializedScanRule, SkillScanIssue, SkillScanResult } from '../types.js';

// â”€â”€ Built-in rules â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * The set of security rules shipped with the extension.
 * Each entry is serialisable; the `pattern` field is a regex source string.
 */
export const BUILTIN_SCAN_RULES: SerializedScanRule[] = [
  {
    id: 'no-eval',
    severity: 'error',
    pattern: '\\beval\\s*\\(',
    message: 'Dynamic code execution via eval() is forbidden â€” critical code-injection risk.',
    enabled: true,
    builtIn: true,
  },
  {
    id: 'no-function-constructor',
    severity: 'error',
    pattern: 'new\\s+Function\\s*\\(',
    message: 'Dynamic code execution via new Function() is forbidden â€” critical code-injection risk.',
    enabled: true,
    builtIn: true,
  },
  {
    id: 'no-child-process-require',
    severity: 'error',
    pattern: "require\\s*\\(\\s*['\"`]child_process['\"`]",
    message: 'The child_process module is not permitted in skills â€” shell command execution risk.',
    enabled: true,
    builtIn: true,
  },
  {
    id: 'no-child-process-import',
    severity: 'error',
    pattern: "from\\s*['\"`]child_process['\"`]",
    message: 'The child_process module is not permitted in skills â€” shell command execution risk.',
    enabled: true,
    builtIn: true,
  },
  {
    id: 'no-shell-exec',
    severity: 'error',
    pattern: '\\b(?:exec|execSync|spawn|spawnSync|execFile|execFileSync)\\s*\\(',
    message: 'Shell execution functions are not permitted in skills.',
    enabled: true,
    builtIn: true,
  },
  {
    id: 'no-process-env',
    severity: 'warning',
    pattern: '\\bprocess\\.env\\b',
    message:
      'Accessing process.env may expose sensitive configuration. Use SkillExecutionContext instead.',
    enabled: true,
    builtIn: true,
  },
  {
    id: 'no-direct-fetch',
    severity: 'warning',
    pattern: '\\b(?:fetch|axios|got)\\s*\\(',
    message:
      'Outbound network calls may exfiltrate data. Use a dedicated web-fetch skill instead.',
    enabled: true,
    builtIn: true,
  },
  {
    id: 'no-http-require',
    severity: 'warning',
    pattern: "require\\s*\\(\\s*['\"`]https?['\"`]",
    message:
      'Direct HTTP module usage may exfiltrate data. Use a dedicated web-fetch skill instead.',
    enabled: true,
    builtIn: true,
  },
  {
    id: 'no-http-import',
    severity: 'warning',
    pattern: "from\\s*['\"`]https?['\"`]",
    message:
      'Direct HTTP module usage may exfiltrate data. Use a dedicated web-fetch skill instead.',
    enabled: true,
    builtIn: true,
  },
  {
    id: 'no-path-traversal',
    severity: 'error',
    pattern: '\\.\\.[/\\\\]',
    message:
      'Potential path traversal detected. Use SkillExecutionContext for safe file access.',
    enabled: true,
    builtIn: true,
  },
  {
    id: 'no-fs-direct',
    severity: 'warning',
    pattern: "require\\s*\\(\\s*['\"`]fs(?:\\/promises)?['\"`]",
    message:
      'Direct filesystem access bypasses workspace safety boundaries. Use SkillExecutionContext.readFile/writeFile.',
    enabled: true,
    builtIn: true,
  },
  {
    id: 'no-hardcoded-secret',
    severity: 'error',
    pattern: "(?:api[_\\-]?key|secret|password|passwd|token|bearer)\\s*[:=]\\s*['\"`][^'\"`\\s]{8,}",
    message:
      'Possible hardcoded secret or credential. Store credentials in VS Code SecretStorage, not in skill source.',
    enabled: true,
    builtIn: true,
  },
];

// â”€â”€ Rule resolution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Merge user overrides and custom rules into the final effective rule list.
 * Throws if any pattern string is not a valid regular expression.
 */
export function resolveRules(config: ScannerRulesConfig): SerializedScanRule[] {
  // Merge built-in rules with per-rule overrides
  const resolved: SerializedScanRule[] = BUILTIN_SCAN_RULES.map(rule => {
    const override = config.overrides[rule.id];
    if (!override) {
      return rule;
    }
    return { ...rule, ...override };
  });

  // Append custom rules
  for (const custom of config.customRules) {
    validateRulePattern(custom.id, custom.pattern);
    resolved.push(custom);
  }

  return resolved;
}

function validateRulePattern(id: string, pattern: string): void {
  try {
    new RegExp(pattern);
  } catch {
    throw new Error(`Scanner rule "${id}" has an invalid regex pattern: ${pattern}`);
  }
}

// â”€â”€ Scanning â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Scan skill source text for security issues using the provided rule config.
 */
export function scanSkillSource(
  skillId: string,
  source: string,
  config: ScannerRulesConfig = { overrides: {}, customRules: [] },
): SkillScanResult {
  const rules = resolveRules(config);
  const enabledRules = rules.filter(r => r.enabled);
  const lines = source.split(/\r?\n/);
  const issues: SkillScanIssue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip single-line comments to reduce false positives in commented-out code
    const uncommented = raw.replace(/\/\/.*$/, '');
    const lineNumber = i + 1;

    for (const rule of enabledRules) {
      if (new RegExp(rule.pattern).test(uncommented)) {
        issues.push({
          rule: rule.id,
          severity: rule.severity,
          line: lineNumber,
          snippet: raw.trim().slice(0, 120),
          message: rule.message,
        });
        break; // One issue per rule per line
      }
    }
  }

  const hasErrors = issues.some(i => i.severity === 'error');

  return {
    skillId,
    status: hasErrors ? 'failed' : 'passed',
    scannedAt: new Date().toISOString(),
    issues,
  };
}

/**
 * Read a skill source file from disk and scan it.
 */
export function scanSkillFile(
  skillId: string,
  filePath: string,
  config: ScannerRulesConfig = { overrides: {}, customRules: [] },
): SkillScanResult {
  let source: string;
  try {
    source = readFileSync(filePath, 'utf-8');
  } catch {
    return {
      skillId,
      status: 'failed',
      scannedAt: new Date().toISOString(),
      issues: [
        {
          rule: 'file-unreadable',
          severity: 'error',
          line: 0,
          snippet: filePath,
          message: `Skill source file could not be read: ${filePath}`,
        },
      ],
    };
  }
  return scanSkillSource(skillId, source, config);
}
