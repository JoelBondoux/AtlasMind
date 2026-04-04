/**
 * Planner – uses the LLM to decompose a high-level goal into a ProjectPlan.
 *
 * The model is prompted to return a JSON object describing the subtasks and
 * their dependency relationships. The planner validates and sanitises the
 * response then returns a guaranteed-acyclic ProjectPlan.
 *
 * Security: LLM output is treated as untrusted — JSON is parsed and each
 * field is validated individually before being accepted.
 */

import type { ProjectPlan, RoutingConstraints, SubTask } from '../types.js';
import type { ModelRouter } from './modelRouter.js';
import type { ProviderRegistry } from '../providers/index.js';
import type { TaskProfiler } from './taskProfiler.js';

const MAX_SUBTASKS = 20;

const PLANNER_SYSTEM_PROMPT = `You are a project planning assistant. When given a high-level goal, decompose it into concrete subtasks that can be executed by specialised AI agents working in parallel wherever possible.

Return ONLY valid JSON (no markdown fences, no prose) matching this exact schema:
{
  "subTasks": [
    {
      "id": "short-slug",
      "title": "Short title",
      "description": "What this agent should produce or do — be concrete.",
      "role": "one of: architect, backend-engineer, frontend-engineer, tester, documentation-writer, devops, data-engineer, security-reviewer, general-assistant",
      "skills": ["skill IDs from: file-read, file-write, file-search, memory-query, memory-write"],
      "dependsOn": ["ids of subtasks that must complete first"]
    }
  ]
}

Rules:
- Maximum ${MAX_SUBTASKS} subtasks.
- Maximise parallelism: only add a dependency when the subtask genuinely needs the output of another.
- Be concrete: descriptions should state what deliverable the agent should produce.
- No circular dependencies.
- Respond with JSON only — nothing else.`;

export class Planner {
  constructor(
    private readonly modelRouter: ModelRouter,
    private readonly providers: ProviderRegistry,
    private readonly taskProfiler: TaskProfiler,
  ) {}

  async plan(goal: string, constraints: RoutingConstraints): Promise<ProjectPlan> {
    const taskProfile = this.taskProfiler.profileTask({
      userMessage: goal,
      phase: 'planning',
      requiresTools: false,
    });
    const model = this.modelRouter.selectModel(constraints, undefined, taskProfile);
    const providerId = model.split('/')[0] ?? 'copilot';
    const provider = this.providers.get(providerId);

    if (!provider) {
      return this.fallbackPlan(goal);
    }

    let rawResponse: string;
    try {
      const response = await provider.complete({
        model,
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: `Goal: ${goal}` },
        ],
        temperature: 0.3,
      });
      rawResponse = response.content;
    } catch {
      return this.fallbackPlan(goal);
    }

    const subTasks = parsePlannerResponse(rawResponse);
    if (subTasks.length === 0) {
      return this.fallbackPlan(goal);
    }

    // Remove any dependency references to IDs that don't exist in the plan
    const validIds = new Set(subTasks.map(t => t.id));
    for (const task of subTasks) {
      task.dependsOn = task.dependsOn.filter(dep => validIds.has(dep) && dep !== task.id);
    }

    return {
      id: `plan-${Date.now()}`,
      goal,
      subTasks: removeCycles(subTasks),
    };
  }

  private fallbackPlan(goal: string): ProjectPlan {
    return {
      id: `plan-${Date.now()}`,
      goal,
      subTasks: [
        {
          id: 'execute',
          title: goal.slice(0, 80),
          description: goal,
          role: 'general-assistant',
          skills: ['file-read', 'file-write', 'file-search', 'memory-query'],
          dependsOn: [],
        },
      ],
    };
  }
}

// ── Parsing helpers ───────────────────────────────────────────────

export function parsePlannerResponse(raw: string): SubTask[] {
  // Strip markdown fences if model ignored the instruction
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenceMatch ? fenceMatch[1] : raw;

  // Extract the first {...} block
  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!objMatch) { return []; }

  try {
    const parsed: unknown = JSON.parse(objMatch[0]);
    if (
      typeof parsed === 'object' && parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>)['subTasks'])
    ) {
      const tasks = (parsed as Record<string, unknown[]>)['subTasks'];
      return tasks.filter(isValidSubTask).slice(0, MAX_SUBTASKS);
    }
  } catch {
    // Parse failed — caller falls back to single-task plan
  }

  return [];
}

function isValidSubTask(v: unknown): v is SubTask {
  if (typeof v !== 'object' || v === null) { return false; }
  const t = v as Record<string, unknown>;
  return (
    typeof t['id'] === 'string' && /^[a-z0-9-]+$/.test(t['id']) && t['id'].length <= 80 &&
    typeof t['title'] === 'string' && t['title'].length <= 200 &&
    typeof t['description'] === 'string' && t['description'].length <= 2000 &&
    typeof t['role'] === 'string' && t['role'].length <= 80 &&
    Array.isArray(t['skills']) && (t['skills'] as unknown[]).every(s => typeof s === 'string') &&
    Array.isArray(t['dependsOn']) && (t['dependsOn'] as unknown[]).every(d => typeof d === 'string')
  );
}

/**
 * Remove cycles using Kahn's algorithm.
 * Tasks that are part of a cycle are excluded from the returned set.
 */
export function removeCycles(tasks: SubTask[]): SubTask[] {
  const idSet = new Set(tasks.map(t => t.id));

  // Build in-degree map and adjacency list (parent → children)
  const inDegree = new Map<string, number>(tasks.map(t => [t.id, 0]));
  const children = new Map<string, string[]>();

  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (idSet.has(dep)) {
        inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
        if (!children.has(dep)) { children.set(dep, []); }
        children.get(dep)!.push(t.id);
      }
    }
  }

  const queue = tasks.filter(t => (inDegree.get(t.id) ?? 0) === 0).map(t => t.id);
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const child of children.get(id) ?? []) {
      const deg = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, deg);
      if (deg === 0) { queue.push(child); }
    }
  }

  const safe = new Set(order);
  return tasks.filter(t => safe.has(t.id));
}
