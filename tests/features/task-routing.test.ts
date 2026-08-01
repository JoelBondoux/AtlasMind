import { describe, it, expect } from 'vitest';

describe('Feature: Task Routing', () => {
  it('Scenario: A user provides a task, and AtlasMind routes it to the correct agent', () => {
    // Given: a user provides a task
    const task = {
      description: 'Create a new file named "report.md" in the root directory.',
      context: {
        fileSystemAccess: true,
        gitAccess: false,
        webAccess: false,
      },
    };

    // When: AtlasMind processes the task (mocking the routing logic for now)
    // In a real implementation, this would involve calling the actual task routing function.
    const routedAgent = determineAgent(task);

    // Then: the task is routed to the appropriate specialist agent
    expect(routedAgent).toBe('filesystem-agent');
  });
});

// Placeholder for the actual agent determination logic
function determineAgent(task: any): string {
  if (task.context.fileSystemAccess) {
    return 'filesystem-agent';
  }
  // More sophisticated logic would go here to determine other agents
  return 'unknown-agent';
}
