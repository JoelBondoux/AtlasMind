export function toJsonPreview(value: Record<string, unknown> | undefined, maxLength = 600): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const serialized = redactSensitiveText(JSON.stringify(value));
    if (serialized.length <= maxLength) {
      return serialized;
    }
    return serialized.slice(0, maxLength) + '...';
  } catch {
    return '[unserializable arguments]';
  }
}

export function toTextPreview(value: string, maxLength = 600): string {
  const redacted = redactSensitiveText(value);
  if (redacted.length <= maxLength) {
    return redacted;
  }
  return redacted.slice(0, maxLength) + '...';
}

function redactSensitiveText(input: string): string {
  return input
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[REDACTED]')
    .replace(/("(?:api[_-]?key|token|password|secret)"\s*:\s*")[^"]+("\s*[},])/gi, '$1[REDACTED]$2')
    .replace(/("(?:api[_-]?key|token|password|secret)"\s*:\s*")[^"]+"$/gi, '$1[REDACTED]"')
    .replace(/(sk-[a-z0-9]{16,})/gi, '[REDACTED]')
    .replace(/(xox[baprs]-[a-z0-9-]{10,})/gi, '[REDACTED]');
}