/**
 * Shared helper for AtlasMind-managed delimited blocks inside files AtlasMind
 * does not own (external AI agent instruction files, etc.).
 *
 * A managed block is a region bracketed by an HTML-comment start/end marker.
 * AtlasMind only ever rewrites the content between its own markers; everything
 * outside the markers is preserved verbatim. This keeps all outbound writes
 * non-destructive and reversible (delete the block to fully revert).
 */

export interface ManagedBlockMarkers {
  start: string;
  end: string;
}

/**
 * Insert or replace the managed block delimited by `markers` inside `existing`.
 *
 * - If both markers are already present (and well-ordered), the region between
 *   them is replaced with `blockBody` and the surrounding text is preserved.
 * - Otherwise the block is appended to the end, preserving any prior content.
 *
 * The returned string always contains exactly one well-formed managed block.
 */
export function upsertManagedBlock(
  existing: string,
  blockBody: string,
  markers: ManagedBlockMarkers,
): string {
  const block = `${markers.start}\n${blockBody}\n${markers.end}`;
  const startIdx = existing.indexOf(markers.start);
  const endIdx = existing.indexOf(markers.end);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx).replace(/\s*$/, '');
    const after = existing.slice(endIdx + markers.end.length).replace(/^\s*/, '');
    const head = before.length > 0 ? `${before}\n\n` : '';
    const tail = after.length > 0 ? `\n\n${after}` : '\n';
    return `${head}${block}${tail}`;
  }

  // No existing block — append, preserving prior content.
  const trimmed = existing.replace(/\s*$/, '');
  return trimmed.length > 0 ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

/**
 * Remove the managed block delimited by `markers` from `content`, preserving the
 * surrounding text. Returns `content` unchanged when the block is absent. Used to
 * avoid re-ingesting AtlasMind's own injected mirror when reading a file back.
 */
export function stripManagedBlock(content: string, markers: ManagedBlockMarkers): string {
  const startIdx = content.indexOf(markers.start);
  const endIdx = content.indexOf(markers.end);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return content;
  }
  const before = content.slice(0, startIdx).replace(/\s*$/, '');
  const after = content.slice(endIdx + markers.end.length).replace(/^\s*/, '');
  return [before, after].filter(segment => segment.length > 0).join('\n\n');
}
