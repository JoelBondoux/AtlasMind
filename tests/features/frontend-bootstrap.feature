Feature: Current and reviewable frontend bootstrap prefabs
  AtlasMind should cover the maintained frontend paths without turning a
  framework choice into an unreviewed package, repository, or deployment action.

  Scenario: Hand off every frontend generator without executing it
    Given the Next.js, SvelteKit, Nuxt, React, and Vue frontend prefabs
    When AtlasMind builds their template plans
    Then each plan contains only reviewable documentation
    And every command uses literal placeholders instead of project-name shell text
    And privacy and compatibility evidence begins Not assessed

  Scenario: Use the current SvelteKit generator
    Given a new SvelteKit frontend
    When AtlasMind builds its handoff and framework catalog entry
    Then both paths name the sv create command
    And neither path names the retired create-svelte generator

  Scenario: Keep React's framework decision honest
    Given a client-focused React frontend
    When AtlasMind builds the React Vite handoff
    Then it records React's framework-first recommendation
    And it assigns routing, data, state, rendering, and deployment choices to the project

  Scenario: Keep interactive Vue choices with the operator
    Given a Vue frontend
    When AtlasMind builds the create-vue handoff
    Then Router, Pinia, unit, end-to-end, lint, formatting, and developer-tools choices remain explicit
    And dependency installation remains a separate review step
