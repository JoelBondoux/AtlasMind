import { describe, expect, it } from 'vitest';
import { Planner, parsePlannerResponse, removeCycles } from '../../src/core/planner.ts';
import type { SubTask } from '../../src/types.ts';

describe('parsePlannerResponse', () => {
  it('parses valid JSON with subTasks', () => {
    const raw = JSON.stringify({
      subTasks: [
        {
          id: 'task-1',
          title: 'Task One',
          description: 'Do something',
          role: 'backend-engineer',
          skills: ['file-read'],
          dependsOn: [],
        },
      ],
    });
    const result = parsePlannerResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('task-1');
  });

  it('strips markdown fences', () => {
    const raw = '```json\n' + JSON.stringify({
      subTasks: [
        { id: 'x', title: 'X', description: 'x', role: 'general-assistant', skills: [], dependsOn: [] },
      ],
    }) + '\n```';
    expect(parsePlannerResponse(raw)).toHaveLength(1);
  });

  it('returns empty array for malformed JSON', () => {
    expect(parsePlannerResponse('not json at all')).toHaveLength(0);
  });

  it('returns empty array for missing subTasks key', () => {
    expect(parsePlannerResponse(JSON.stringify({ tasks: [] }))).toHaveLength(0);
  });

  it('enforces MAX_SUBTASKS limit of 20', () => {
    const tasks = Array.from({ length: 30 }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      description: `desc ${i}`,
      role: 'general-assistant',
      skills: [],
      dependsOn: [],
    }));
    const result = parsePlannerResponse(JSON.stringify({ subTasks: tasks }));
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it('rejects subtasks with invalid id pattern', () => {
    const raw = JSON.stringify({
      subTasks: [
        { id: 'INVALID ID!', title: 'x', description: 'x', role: 'x', skills: [], dependsOn: [] },
      ],
    });
    expect(parsePlannerResponse(raw)).toHaveLength(0);
  });

  it('rejects subtasks with overly long id', () => {
    const raw = JSON.stringify({
      subTasks: [
        { id: 'a'.repeat(81), title: 'x', description: 'x', role: 'x', skills: [], dependsOn: [] },
      ],
    });
    expect(parsePlannerResponse(raw)).toHaveLength(0);
  });

  it('rejects subtasks with overly long title', () => {
    const raw = JSON.stringify({
      subTasks: [
        { id: 'ok', title: 'x'.repeat(201), description: 'x', role: 'x', skills: [], dependsOn: [] },
      ],
    });
    expect(parsePlannerResponse(raw)).toHaveLength(0);
  });

  it('rejects subtasks with non-string skills array elements', () => {
    const raw = JSON.stringify({
      subTasks: [
        { id: 'ok', title: 'x', description: 'x', role: 'x', skills: [123], dependsOn: [] },
      ],
    });
    expect(parsePlannerResponse(raw)).toHaveLength(0);
  });

  it('rejects subtasks with non-string dependsOn elements', () => {
    const raw = JSON.stringify({
      subTasks: [
        { id: 'ok', title: 'x', description: 'x', role: 'x', skills: [], dependsOn: [null] },
      ],
    });
    expect(parsePlannerResponse(raw)).toHaveLength(0);
  });
});

describe('removeCycles', () => {
  it('preserves acyclic tasks', () => {
    const tasks: SubTask[] = [
      { id: 'a', title: 'A', description: '', role: 'x', skills: [], dependsOn: [] },
      { id: 'b', title: 'B', description: '', role: 'x', skills: [], dependsOn: ['a'] },
    ];
    expect(removeCycles(tasks)).toHaveLength(2);
  });

  it('removes tasks forming a cycle', () => {
    const tasks: SubTask[] = [
      { id: 'a', title: 'A', description: '', role: 'x', skills: [], dependsOn: ['b'] },
      { id: 'b', title: 'B', description: '', role: 'x', skills: [], dependsOn: ['a'] },
    ];
    expect(removeCycles(tasks)).toHaveLength(0);
  });
});

describe('Planner.plan', () => {
  it('prompts for tests-first decomposition on behavior changes', async () => {
    const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    const planner = new Planner(
      {
        selectModel: () => 'local/echo-1',
        getModelInfo: () => ({ provider: 'local' }),
      } as never,
      {
        get: () => ({
          complete: async (request: { messages: Array<{ role: string; content: string }> }) => {
            requests.push(request);
            return {
              content: JSON.stringify({
                subTasks: [
                  {
                    id: 'capture-regression',
                    title: 'Capture regression',
                    description: 'Add a failing regression test.',
                    role: 'tester',
                    skills: ['file-read'],
                    dependsOn: [],
                  },
                ],
              }),
            };
          },
        }),
      } as never,
      {
        profileTask: () => ({
          phase: 'planning',
          modality: 'code',
          reasoning: 'medium',
          requiresTools: false,
          requiredCapabilities: [],
          preferredCapabilities: [],
        }),
      } as never,
    );

    await planner.plan('Fix the auth redirect regression', { budget: 'balanced', speed: 'balanced' });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.messages[0]?.content).toContain('Use test-driven delivery for code or behavior changes');
    expect(requests[0]?.messages[0]?.content).toContain('plan test-first subtasks ahead of implementation subtasks');
  });
});
