/**
 * Shared parameter validation helpers for built-in skills.
 *
 * Every skill repeats the same typeof / trim / range-check patterns.
 * These helpers eliminate that duplication while keeping error messages
 * consistent and descriptive.
 */

/**
 * Validate that a parameter is a non-empty string.
 * Returns an error message on failure, or `undefined` on success.
 */
export function requireString(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return `Error: "${key}" parameter is required and must be a non-empty string.`;
  }
  return undefined;
}

/**
 * Validate that an optional parameter, if present, is a string.
 * Returns an error message on failure, or `undefined` on success / absent.
 */
export function optionalString(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key];
  if (value !== undefined && typeof value !== 'string') {
    return `Error: "${key}" must be a string when provided.`;
  }
  return undefined;
}

/**
 * Validate that an optional parameter, if present, is a boolean.
 * Returns an error message on failure, or `undefined` on success / absent.
 */
export function optionalBoolean(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key];
  if (value !== undefined && typeof value !== 'boolean') {
    return `Error: "${key}" must be a boolean when provided.`;
  }
  return undefined;
}

/**
 * Validate that an optional parameter, if present, is a positive integer.
 * Returns an error message on failure, or `undefined` on success / absent.
 */
export function optionalPositiveInt(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key];
  if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 1)) {
    return `Error: "${key}" must be a positive integer when provided.`;
  }
  return undefined;
}

/**
 * Validate that an optional parameter, if present, is an integer >= a minimum.
 * Returns an error message on failure, or `undefined` on success / absent.
 */
export function optionalIntMin(
  params: Record<string, unknown>,
  key: string,
  min: number,
): string | undefined {
  const value = params[key];
  if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < min)) {
    return `Error: "${key}" must be an integer >= ${min} when provided.`;
  }
  return undefined;
}

/**
 * Validate that an optional parameter, if present, is an array of strings.
 * Returns an error message on failure, or `undefined` on success / absent.
 */
export function optionalStringArray(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key];
  if (value !== undefined && (!Array.isArray(value) || value.some(v => typeof v !== 'string'))) {
    return `Error: "${key}" must be an array of strings when provided.`;
  }
  return undefined;
}
