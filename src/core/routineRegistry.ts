import * as fs from 'fs/promises';
import * as path from 'path';
import type { RoutineDefinition, RoutineStep } from '../types.js';

/**
 * Registry for project routine definitions.
 * Routines are stored as markdown files with YAML frontmatter in
 * project_memory/routines/. On reload() the folder is scanned and all
 * valid definitions are loaded into memory.
 */
export class RoutineRegistry {
  private routines = new Map<string, RoutineDefinition>();

  register(routine: RoutineDefinition): void {
    this.routines.set(routine.id, routine);
  }

  unregister(id: string): boolean {
    return this.routines.delete(id);
  }

  get(id: string): RoutineDefinition | undefined {
    return this.routines.get(id);
  }

  list(): RoutineDefinition[] {
    return [...this.routines.values()];
  }

  /** Returns the first routine with default:true, or the first routine overall, or undefined. */
  getDefault(): RoutineDefinition | undefined {
    const all = this.list();
    return all.find(r => r.default) ?? all[0];
  }

  /**
   * Scans project_memory/routines/ in the given workspace root and
   * (re-)populates the registry from the discovered markdown files.
   */
  async reload(workspaceRoot: string): Promise<void> {
    this.routines.clear();
    const routinesDir = path.join(workspaceRoot, 'project_memory', 'routines');

    let entries: string[];
    try {
      entries = await fs.readdir(routinesDir);
    } catch {
      // Folder doesn't exist yet — that's fine, no routines loaded.
      return;
    }

    for (const entry of entries) {
      if (entry === 'README.md' || !entry.endsWith('.md')) {
        continue;
      }
      const filePath = path.join(routinesDir, entry);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const routine = parseRoutineFile(raw, filePath);
        if (routine) {
          this.register(routine);
        }
      } catch {
        // Skip unreadable files silently.
      }
    }
  }
}

// ── Frontmatter parsing ──────────────────────────────────────────

/**
 * Parses a routine markdown file.
 * Expects YAML frontmatter between --- fences with the fields:
 *   id, name, description, default (optional), steps (array).
 * Each step has: id, label, run, on_fail.
 */
function parseRoutineFile(content: string, filePath: string): RoutineDefinition | null {
  const fenceMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fenceMatch) {
    return null;
  }

  const parsed = parseYamlSubset(fenceMatch[1]);

  const id = typeof parsed['id'] === 'string' ? parsed['id'].trim() : '';
  const name = typeof parsed['name'] === 'string' ? parsed['name'].trim() : '';
  const description = typeof parsed['description'] === 'string' ? parsed['description'].trim() : '';

  if (!id || !name) {
    return null;
  }

  const rawSteps = Array.isArray(parsed['steps']) ? parsed['steps'] : [];
  const steps: RoutineStep[] = [];
  for (const raw of rawSteps) {
    if (typeof raw !== 'object' || raw === null) { continue; }
    const s = raw as Record<string, string>;
    const stepId = s['id']?.trim();
    const label = s['label']?.trim();
    const run = s['run']?.trim();
    const rawOnFail = s['on_fail']?.trim();
    const on_fail: RoutineStep['on_fail'] =
      rawOnFail === 'prompt' ? 'prompt'
      : rawOnFail === 'continue' ? 'continue'
      : 'abort';

    if (!stepId || !label || !run) { continue; }
    steps.push({ id: stepId, label, run, on_fail });
  }

  if (steps.length === 0) {
    return null;
  }

  return {
    id,
    name,
    description,
    default: parsed['default'] === true,
    steps,
    source: filePath,
    builtIn: false,
  };
}

/**
 * Minimal YAML-subset parser sufficient for routine frontmatter.
 * Handles:
 *   - Root-level string and boolean scalars
 *   - A single array field (steps) whose items are flat string-keyed objects
 */
function parseYamlSubset(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Root-level key: value
    const rootMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)?$/);
    if (!rootMatch) { i++; continue; }

    const key = rootMatch[1];
    const rest = (rootMatch[2] ?? '').trim();

    if (rest === '') {
      // Could be an array — scan ahead for "  - ..." lines
      const items: Record<string, string>[] = [];
      i++;
      while (i < lines.length) {
        const itemLine = lines[i];
        // First field of a new list item: "  - id: foo"
        const firstField = itemLine.match(/^\s+-\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)/);
        if (!firstField) { break; }
        const item: Record<string, string> = { [firstField[1]]: firstField[2].trim() };
        i++;
        // Continuation fields with deeper indentation
        while (i < lines.length) {
          const contLine = lines[i];
          const contField = contLine.match(/^(\s{4,})([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)/);
          if (!contField) { break; }
          item[contField[2]] = contField[3].trim();
          i++;
        }
        items.push(item);
      }
      result[key] = items;
      continue;
    }

    // Scalar value
    if (rest === 'true') { result[key] = true; }
    else if (rest === 'false') { result[key] = false; }
    else { result[key] = rest; }
    i++;
  }

  return result;
}
