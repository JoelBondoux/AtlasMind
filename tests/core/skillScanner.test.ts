import { describe, expect, it } from 'vitest';
import { BUILTIN_SCAN_RULES, resolveRules, scanSkillSource } from '../../src/core/skillScanner.ts';
import type { ScannerRulesConfig } from '../../src/types.ts';

const CLEAN_CONFIG: ScannerRulesConfig = { overrides: {}, customRules: [] };

describe('scanSkillSource', () => {
  it('returns passed for clean skill source', () => {
    const result = scanSkillSource('clean-skill', 'const x = 1;\nreturn x + 2;\n', CLEAN_CONFIG);
    expect(result.status).toBe('passed');
    expect(result.issues).toHaveLength(0);
  });

  it('detects eval() as an error', () => {
    const result = scanSkillSource('bad-eval', 'const x = eval("code");\n', CLEAN_CONFIG);
    expect(result.status).toBe('failed');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.rule).toBe('no-eval');
    expect(result.issues[0]?.severity).toBe('error');
    expect(result.issues[0]?.line).toBe(1);
  });

  it('detects new Function() as an error', () => {
    const result = scanSkillSource('bad-func', 'const fn = new Function("return 1");\n', CLEAN_CONFIG);
    expect(result.status).toBe('failed');
    expect(result.issues.some(i => i.rule === 'no-function-constructor')).toBe(true);
  });

  it('detects child_process require as an error', () => {
    const source = "const cp = require('child_process');\n";
    const result = scanSkillSource('bad-cp', source, CLEAN_CONFIG);
    expect(result.status).toBe('failed');
    expect(result.issues.some(i => i.rule === 'no-child-process-require')).toBe(true);
  });

  it('detects child_process import as an error', () => {
    const source = "import { exec } from 'child_process';\n";
    const result = scanSkillSource('bad-cp-import', source, CLEAN_CONFIG);
    expect(result.status).toBe('failed');
    expect(result.issues.some(i => i.rule === 'no-child-process-import')).toBe(true);
  });

  it('detects shell execution functions as an error', () => {
    const source = 'exec("ls -la");\n';
    const result = scanSkillSource('bad-exec', source, CLEAN_CONFIG);
    expect(result.status).toBe('failed');
    expect(result.issues.some(i => i.rule === 'no-shell-exec')).toBe(true);
  });

  it('detects process.env access as a warning', () => {
    const source = 'const key = process.env.SECRET;\n';
    const result = scanSkillSource('env-access', source, CLEAN_CONFIG);
    expect(result.status).toBe('passed');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.rule).toBe('no-process-env');
    expect(result.issues[0]?.severity).toBe('warning');
  });

  it('detects fetch calls as a warning', () => {
    const source = 'const res = await fetch("https://example.com");\n';
    const result = scanSkillSource('has-fetch', source, CLEAN_CONFIG);
    expect(result.status).toBe('passed');
    expect(result.issues.some(i => i.rule === 'no-direct-fetch')).toBe(true);
  });

  it('detects path traversal as an error', () => {
    const source = 'readFile("../../etc/passwd");\n';
    const result = scanSkillSource('traversal', source, CLEAN_CONFIG);
    expect(result.status).toBe('failed');
    expect(result.issues.some(i => i.rule === 'no-path-traversal')).toBe(true);
  });

  it('detects hardcoded secrets as an error', () => {
    const source = 'const api_key = "sk-AbCdEfGhIjKlMnOpQrStUvWxYz12";\n';
    const result = scanSkillSource('hardcoded', source, CLEAN_CONFIG);
    expect(result.status).toBe('failed');
    expect(result.issues.some(i => i.rule === 'no-hardcoded-secret')).toBe(true);
  });

  it('ignores matches inside single-line comments', () => {
    const source = '// eval("this is fine")\nconst x = 1;\n';
    const result = scanSkillSource('commented', source, CLEAN_CONFIG);
    expect(result.status).toBe('passed');
    expect(result.issues).toHaveLength(0);
  });

  it('reports multiple issues across different lines', () => {
    const source = 'eval("bad");\nconst x = process.env.KEY;\n';
    const result = scanSkillSource('multi', source, CLEAN_CONFIG);
    expect(result.status).toBe('failed');
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });
});

describe('resolveRules', () => {
  it('returns all built-in rules unmodified when config is empty', () => {
    const resolved = resolveRules(CLEAN_CONFIG);
    expect(resolved).toHaveLength(BUILTIN_SCAN_RULES.length);
    expect(resolved.every(r => r.enabled)).toBe(true);
  });

  it('applies overrides to built-in rules', () => {
    const config: ScannerRulesConfig = {
      overrides: { 'no-eval': { enabled: false } },
      customRules: [],
    };
    const resolved = resolveRules(config);
    const evalRule = resolved.find(r => r.id === 'no-eval');
    expect(evalRule?.enabled).toBe(false);
  });

  it('appends custom rules after built-in rules', () => {
    const config: ScannerRulesConfig = {
      overrides: {},
      customRules: [
        {
          id: 'custom-no-console',
          severity: 'warning',
          pattern: '\\bconsole\\.',
          message: 'Avoid console usage.',
          enabled: true,
          builtIn: false,
        },
      ],
    };
    const resolved = resolveRules(config);
    expect(resolved).toHaveLength(BUILTIN_SCAN_RULES.length + 1);
    expect(resolved[resolved.length - 1]?.id).toBe('custom-no-console');
  });

  it('throws on invalid regex in custom rules', () => {
    const config: ScannerRulesConfig = {
      overrides: {},
      customRules: [
        {
          id: 'bad-regex',
          severity: 'error',
          pattern: '[invalid',
          message: 'nope',
          enabled: true,
          builtIn: false,
        },
      ],
    };
    expect(() => resolveRules(config)).toThrow(/invalid regex/i);
  });

  it('respects disabled override preventing rule from firing', () => {
    const config: ScannerRulesConfig = {
      overrides: { 'no-eval': { enabled: false } },
      customRules: [],
    };
    const result = scanSkillSource('eval-allowed', 'eval("code");\n', config);
    expect(result.issues.some(i => i.rule === 'no-eval')).toBe(false);
  });
});

describe('BUILTIN_SCAN_RULES', () => {
  it('has valid regex patterns for every built-in rule', () => {
    for (const rule of BUILTIN_SCAN_RULES) {
      expect(() => new RegExp(rule.pattern)).not.toThrow();
    }
  });

  it('has no duplicate rule IDs', () => {
    const ids = BUILTIN_SCAN_RULES.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
