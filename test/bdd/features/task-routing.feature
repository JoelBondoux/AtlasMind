Feature: Task Routing
  As an AtlasMind user
  I want tasks to be routed to the correct agent
  So that I get the right expertise for my request

  Scenario: User provides a simple task
    Given a user provides a task "Create a README file"
    When AtlasMind routes the task
    Then it should identify the "Documentation Writer" agent as the most appropriate
    And the agent should receive the task

  Scenario: User provides a performance optimization task
    Given a user provides a task "Optimize memory usage in the core module"
    When AtlasMind routes the task
    Then it should identify the "Performance Analyst" agent as the most appropriate
    And the agent should receive the task

  Scenario: User provides a complex multi-agent task
    Given a user provides a task "Build a new feature with UI and backend"
    When AtlasMind routes the task
    Then it should identify both "Documentation Writer" and "Performance Analyst" agents
    And distribute subtasks appropriately