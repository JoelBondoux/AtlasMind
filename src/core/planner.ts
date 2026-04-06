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
import { MAX_SUBTASKS } from '../constants.js';
import { buildExecutionBatches } from './taskScheduler.js';

const PLANNER_SYSTEM_PROMPT = `You are a project planning assistant. When given a high-level goal, decompose it into concrete subtasks that can be executed by specialised AI agents working in parallel wherever possible.

Return ONLY valid JSON (no markdown fences, no prose) matching this exact schema:
{
  "subTasks": [
    {
      "id": "short-slug",
      "title": "Short title",
      "description": "What this agent should produce or do — be concrete.",
      "role": "one of: architect, backend-engineer, frontend-engineer, tester, documentation-writer, devops, data-engineer, security-reviewer, general-assistant",
      "skills": ["skill IDs from: file-read, file-write, file-edit, file-search, memory-query, memory-write, test-run, terminal-run, workspace-observability"],
      "dependsOn": ["ids of subtasks that must complete first"]
    }
  ]
}

Rules:
- Maximum ${MAX_SUBTASKS} subtasks.
- Maximise parallelism: only add a dependency when the subtask genuinely needs the output of another.
- Use test-driven delivery for code or behavior changes: plan test-first subtasks ahead of implementation subtasks whenever the goal adds, fixes, or changes behavior.
- When TDD applies, make implementation subtasks depend on the relevant regression-capture or test-authoring subtask so execution can follow a red-to-green flow.
- Prefer the tester role for explicit regression and coverage subtasks, and engineer roles for implementation or refactor subtasks.
- Be concrete: descriptions should state what deliverable the agent should produce.
- No circular dependencies.
- Respond with JSON only — nothing else.`;

export interface ProjectExecutionJob {
  jobIndex: number;
  totalJobs: number;
  plan: ProjectPlan;
}

export interface ProjectExecutionJobOptions {
  maxEstimatedFilesPerJob: number;
  estimatedFilesPerSubtask: number;
  maxSubtasksPerJob?: number;
}

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
    const providerId = resolveProviderIdForModel(model, this.modelRouter, 'copilot');
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
          skills: ['file-read', 'file-write', 'file-edit', 'file-search', 'memory-query', 'test-run', 'terminal-run', 'workspace-observability'],
          dependsOn: [],
        },
      ],
    };
  }
}

function resolveProviderIdForModel(
  modelId: string,
  router: Pick<ModelRouter, 'getModelInfo'>,
  fallback: string,
): string {
  const metadataProvider = router.getModelInfo(modelId)?.provider;
  if (metadataProvider) {
    return metadataProvider;
  }

  const prefix = modelId.split('/')[0]?.trim();
  return prefix && prefix.length > 0 ? prefix : fallback;
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
  if (typeof v !== 'object' || v === null) {
    return false;
  }

  const candidate = v as Record<string, unknown>;
  return (
    isBoundedString(candidate['id'], 80) &&
    /^[a-z0-9-]+$/.test(candidate['id']) &&
    isBoundedString(candidate['title'], 200) &&
    isBoundedString(candidate['description'], 2000) &&
    isBoundedString(candidate['role'], 80) &&
    isStringArray(candidate['skills']) &&
    isStringArray(candidate['dependsOn'])
  );
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
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

export function splitPlanIntoExecutionJobs(
  plan: ProjectPlan,
  options: ProjectExecutionJobOptions,
): ProjectExecutionJob[] {
  if (plan.subTasks.length <= 1) {
    return [{
      jobIndex: 1,
      totalJobs: 1,
      plan: clonePlan(plan, `${plan.id}-job-1`, plan.subTasks),
    }];
  }

  const estimatedFilesPerSubtask = Math.max(1, options.estimatedFilesPerSubtask);
  const maxEstimatedFilesPerJob = Math.max(1, options.maxEstimatedFilesPerJob);
  const derivedMaxSubtasks = Math.max(1, Math.floor(maxEstimatedFilesPerJob / estimatedFilesPerSubtask));
  const maxSubtasksPerJob = Math.max(1, options.maxSubtasksPerJob ?? derivedMaxSubtasks);
  const batches = buildExecutionBatches(plan.subTasks);
  const groupedTasks: SubTask[][] = [];
  let currentJobTasks: SubTask[] = [];

  for (const batch of batches) {
    const proposedTaskCount = currentJobTasks.length + batch.length;
    const proposedEstimatedFiles = proposedTaskCount * estimatedFilesPerSubtask;
    const shouldStartNewJob = currentJobTasks.length > 0
      && (proposedTaskCount > maxSubtasksPerJob || proposedEstimatedFiles > maxEstimatedFilesPerJob);

    if (shouldStartNewJob) {
      groupedTasks.push(currentJobTasks);
      currentJobTasks = [];
    }

    currentJobTasks.push(...batch.map(task => cloneTask(task)));
  }

  if (currentJobTasks.length > 0) {
    groupedTasks.push(currentJobTasks);
  }

  if (groupedTasks.length === 0) {
    groupedTasks.push(plan.subTasks.map(task => cloneTask(task)));
  }

  return groupedTasks.map((tasks, index, allJobs) => ({
    jobIndex: index + 1,
    totalJobs: allJobs.length,
    plan: clonePlan(plan, `${plan.id}-job-${index + 1}`, tasks),
  }));
}

function clonePlan(plan: ProjectPlan, id: string, subTasks: SubTask[]): ProjectPlan {
  return {
    id,
    goal: plan.goal,
    subTasks: subTasks.map(task => cloneTask(task)),
  };
}

function cloneTask(task: SubTask): SubTask {
  return {
    ...task,
    skills: [...task.skills],
    dependsOn: [...task.dependsOn],
  };
}
