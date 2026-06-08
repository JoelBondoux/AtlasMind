/**
 * Pattern-based secret redactor for transient LLM context.
 *
 * Scans text for common secret shapes (API keys, tokens, connection strings,
 * private keys) and replaces matches with [REDACTED] before the text is
 * included in a model completion request.  The intent is to stop accidentally
 * stored credentials (e.g. a developer copied an API key into SSOT memory)
 * from being forwarded to a third-party model API.
 *
 * Limitations:
 *  - Pattern-based only: novel secret formats are not detected.
 *  - Does not scan the user's raw prompt (which they intentionally typed).
 *  - Does not scan the model response (redaction is input-side only).
 */

export interface RedactionResult {
  text: string;
  redactedCount: number;
  redactedTypes: string[];
}

interface SecretPattern {
  name: string;
  pattern: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // Anthropic
  { name: 'anthropic-key', pattern: /sk-ant-(?:api\d{2}-)?[A-Za-z0-9_\-]{20,}/g },
  // OpenAI
  { name: 'openai-key', pattern: /sk-(?:proj-)?[A-Za-z0-9]{20,}/g },
  // GitHub personal / fine-grained / OAuth tokens
  { name: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  // Generic bearer tokens in Authorization headers
  { name: 'bearer-token', pattern: /Bearer\s+[A-Za-z0-9._~+\-/]{20,}/g },
  // PEM private keys
  { name: 'pem-private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  // Database connection strings with embedded credentials
  { name: 'db-connection-string', pattern: /(?:mysql|postgresql|postgres|mongodb(?:\+srv)?|redis(?:s)?|amqp(?:s)?):\/\/[^@\s"']+@[^\s"',)}\]]{4,}/gi },
  // Generic key=value secret assignments
  { name: 'generic-secret-assignment', pattern: /(?:api[_\-]?key|secret[_\-]?key|access[_\-]?token|auth[_\-]?token|private[_\-]?key|client[_\-]?secret|app[_\-]?secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/\-]{16,}["']?/gi },
];

/**
 * Scan `text` for known secret patterns and replace matches with `[REDACTED]`.
 * Returns the sanitised text along with a count and list of pattern names matched.
 * Returns the original text unchanged if no secrets are found.
 */
export function redactSecrets(text: string): RedactionResult {
  if (!text) {
    return { text, redactedCount: 0, redactedTypes: [] };
  }

  let result = text;
  let redactedCount = 0;
  const redactedTypes: string[] = [];

  for (const { name, pattern } of SECRET_PATTERNS) {
    // Reset lastIndex before each use (patterns are /g flagged).
    pattern.lastIndex = 0;
    const before = result;
    result = result.replace(pattern, '[REDACTED]');
    if (result !== before) {
      redactedCount += 1;
      redactedTypes.push(name);
    }
    // Reset again after replace so the same pattern object is safe to reuse.
    pattern.lastIndex = 0;
  }

  return { text: result, redactedCount, redactedTypes };
}

/**
 * Convenience wrapper that logs a warning when secrets are detected.
 * `label` identifies which context field is being scanned (for the log message).
 */
export function redactSecretsWithWarning(text: string, label: string): string {
  const result = redactSecrets(text);
  if (result.redactedCount > 0) {
    console.warn(
      `[AtlasMind] Secret redactor: removed ${result.redactedCount} potential secret(s) ` +
      `(${result.redactedTypes.join(', ')}) from "${label}" before sending to LLM.`,
    );
  }
  return result.text;
}
