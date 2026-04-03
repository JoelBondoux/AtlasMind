import type { MemoryScanIssue, MemoryScanResult } from '../types.js';

/** Maximum byte size for a single SSOT document included in model context. */
const MAX_ENTRY_BYTES = 32_000;

interface MemoryScanRule {
  id: string;
  severity: 'error' | 'warning';
  /** Applied to each line of document text. */
  pattern: RegExp;
  message: string;
}

/**
 * Rules that detect prompt-injection patterns and credential leakage
 * in SSOT documents before they reach model context.
 *
 * Error-level rules block the entry entirely.
 * Warning-level rules annotate but do not suppress the entry.
 */
const MEMORY_SCAN_RULES: MemoryScanRule[] = [
  // ── Prompt injection — instruction override attempts ────────────
  {
    id: 'pi-ignore-instructions',
    severity: 'error',
    pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
    message:
      'Possible prompt injection: instruction-override phrase detected. ' +
      'This entry will not be sent to the model.',
  },
  {
    id: 'pi-disregard-instructions',
    severity: 'error',
    pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
    message:
      'Possible prompt injection: instruction-override phrase detected. ' +
      'This entry will not be sent to the model.',
  },
  {
    id: 'pi-forget-instructions',
    severity: 'error',
    pattern: /forget\s+(everything|all|prior|previous)\s+(you|instructions?)/i,
    message:
      'Possible prompt injection: forget-instructions phrase detected. ' +
      'This entry will not be sent to the model.',
  },
  {
    id: 'pi-new-instructions',
    severity: 'error',
    pattern: /your\s+(new|real|true|actual)\s+(instructions?|prompt|system\s+prompt|directive)/i,
    message:
      'Possible prompt injection: new-instructions directive detected. ' +
      'This entry will not be sent to the model.',
  },
  // ── Role-play / persona override ────────────────────────────────
  {
    id: 'pi-act-as',
    severity: 'warning',
    pattern: /act\s+as\s+(?:if\s+you\s+are\s+)?an?\s+(?:unrestricted|jailbroken|DAN|evil|unfiltered)/i,
    message:
      'Possible prompt injection: persona-override phrase detected. ' +
      'Review this document before including it in model context.',
  },
  {
    id: 'pi-jailbreak',
    severity: 'error',
    pattern: /\b(?:DAN|jailbreak|do\s+anything\s+now|developer\s+mode)\b/i,
    message:
      'Possible prompt injection: known jailbreak keyword detected. ' +
      'This entry will not be sent to the model.',
  },
  {
    id: 'pi-system-prompt-override',
    severity: 'error',
    pattern: /\[?system\s*\]?\s*:?\s*(prompt|instruction|message)\s*[:=]/i,
    message:
      'Possible prompt injection: system-prompt override pattern detected. ' +
      'This entry will not be sent to the model.',
  },
  // ── Hidden / obfuscated injections ─────────────────────────────
  {
    id: 'pi-zero-width',
    severity: 'warning',
    pattern: /[\u200B-\u200F\u202A-\u202E\uFEFF]/,
    message:
      'Zero-width or bidirectional Unicode characters detected. ' +
      'These can be used to hide injected instructions.',
  },
  {
    id: 'pi-html-comment',
    severity: 'warning',
    pattern: /<!--.*?(?:ignore|forget|override|instruction).*?-->/i,
    message:
      'HTML comment with possible hidden instruction detected. ' +
      'Review this document before including it in model context.',
  },
  // ── Credential leakage ──────────────────────────────────────────
  {
    id: 'secret-api-key',
    severity: 'error',
    pattern: /(?:api[_\-]?key|apikey)\s*[:=]\s*['"`]?[A-Za-z0-9\-_]{20,}/i,
    message:
      'Possible API key in document. ' +
      'Store credentials in VS Code SecretStorage, not in SSOT documents.',
  },
  {
    id: 'secret-token',
    severity: 'error',
    pattern: /(?:token|bearer|auth[_\-]?token)\s*[:=]\s*['"`]?[A-Za-z0-9\-_.]{20,}/i,
    message:
      'Possible auth token in document. ' +
      'Store credentials in VS Code SecretStorage, not in SSOT documents.',
  },
  {
    id: 'secret-password',
    severity: 'warning',
    pattern: /\bpassword\s*[:=]\s*['"`]?\S{8,}/i,
    message:
      'Possible plaintext password in document. ' +
      'Review before including in model context.',
  },
];

/**
 * Scan a single SSOT document for prompt injection and credential leakage.
 *
 * @param path     The relative SSOT path, used as the result identifier.
 * @param content  The full text content of the document.
 */
export function scanMemoryEntry(path: string, content: string): MemoryScanResult {
  const issues: MemoryScanIssue[] = [];

  // Size check — a single oversized document could flood token budget or hide injections
  if (Buffer.byteLength(content, 'utf-8') > MAX_ENTRY_BYTES) {
    issues.push({
      rule: 'size-limit',
      severity: 'warning',
      line: 0,
      snippet: `(document size: ${Buffer.byteLength(content, 'utf-8').toLocaleString()} bytes)`,
      message:
        `Document exceeds ${(MAX_ENTRY_BYTES / 1000).toFixed(0)} KB. ` +
        'Context will be truncated; consider splitting this document.',
    });
  }

  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    for (const rule of MEMORY_SCAN_RULES) {
      if (rule.pattern.test(line)) {
        issues.push({
          rule: rule.id,
          severity: rule.severity,
          line: lineNumber,
          snippet: line.trim().slice(0, 120),
          message: rule.message,
        });
        // One issue per rule per line
        break;
      }
    }
  }

  const hasErrors = issues.some(i => i.severity === 'error');
  const hasWarnings = issues.some(i => i.severity === 'warning');

  return {
    path,
    status: hasErrors ? 'blocked' : hasWarnings ? 'warned' : 'clean',
    scannedAt: new Date().toISOString(),
    issues,
  };
}
