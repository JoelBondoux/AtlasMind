/**
 * ATDD — Feature: /project slash command
 *
 * Acceptance criteria, stated from the user's perspective:
 *
 *   AS A developer using the AtlasMind chat panel
 *   I WANT to type `/project <goal>` and have AtlasMind start planning
 *   SO THAT I can kick off an autonomous run without leaving the panel
 *
 * These tests sit above the unit layer. They do not test the internals of
 * `routePanelPrompt`; they test the *user-visible contract* — the sequence of
 * decisions the panel must make when a user submits a `/project` prompt.
 *
 * The unit tests in tests/views/chatSlashRouting.test.ts already verify the
 * parser's branches in isolation. What they do not verify is the end-to-end
 * acceptance story: that the route the parser returns is the one the panel
 * actually acts on, and that the user never sees a model reply where a planner
 * run should have started.
 *
 * Methodology: ATDD (Acceptance Test-Driven Development)
 * Framework:   Vitest
 * Style:       Given / When / Then (inline comments)
 */

import { describe, it, expect } from 'vitest';
import {
  routePanelPrompt,
  routeBypassesFreeformModel,
} from '../../src/views/chatSlashRouting.ts';

// ---------------------------------------------------------------------------
// Acceptance scenario 1 — happy path
// ---------------------------------------------------------------------------

describe(
  'Feature: /project slash command\n' +
  '  As a developer using the AtlasMind chat panel\n' +
  '  I want to type `/project <goal>` and have AtlasMind start planning\n' +
  '  So that I can kick off an autonomous run without leaving the panel',
  () => {

    it('Scenario: User submits a /project command with a goal — the panel starts a planner run, not a model call', () => {
      // Given: the user has typed a /project command with a concrete goal
      const userInput = '/project add pagination to the search results page';

      // When: the panel classifies the prompt
      const route = routePanelPrompt(userInput);

      // Then: the route kind is "project" — the panel hands off to the planner
      expect(route.kind).toBe('project');

      // And: the goal is extracted verbatim so the planner receives the full intent
      if (route.kind === 'project') {
        expect(route.goal).toBe('add pagination to the search results page');
      }

      // And: the route bypasses the freeform model entirely — no LLM call for a command
      expect(routeBypassesFreeformModel(route)).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Acceptance scenario 2 — goal with leading/trailing whitespace
    // -------------------------------------------------------------------------

    it('Scenario: User submits a /project command with extra whitespace — the goal is trimmed before reaching the planner', () => {
      // Given: the user typed extra spaces around the goal (common in quick typing)
      const userInput = '/project   refactor the auth module  ';

      // When: the panel classifies the prompt
      const route = routePanelPrompt(userInput);

      // Then: the route is still "project" — whitespace does not break dispatch
      expect(route.kind).toBe('project');

      // And: the goal is trimmed so the planner does not receive leading/trailing spaces
      if (route.kind === 'project') {
        expect(route.goal).toBe('refactor the auth module');
      }
    });

    // -------------------------------------------------------------------------
    // Acceptance scenario 3 — missing goal (the silent-failure guard)
    // -------------------------------------------------------------------------

    it('Scenario: User submits /project with no goal — the panel asks for one instead of starting an empty run', () => {
      // Given: the user typed the command but forgot the goal
      const userInput = '/project';

      // When: the panel classifies the prompt
      const route = routePanelPrompt(userInput);

      // Then: the route is "needs-argument" — the panel surfaces a helpful prompt
      expect(route.kind).toBe('needs-argument');

      // And: the message tells the user exactly what to type, with an example
      if (route.kind === 'needs-argument') {
        expect(route.message).toContain('/project');
        expect(route.message).toMatch(/for example/i);
      }

      // And: the route still bypasses the freeform model — no model call for a
      // malformed command either; the user gets a correction, not a hallucination
      expect(routeBypassesFreeformModel(route)).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Acceptance scenario 4 — the model must never answer a /project prompt
    // -------------------------------------------------------------------------

    it('Scenario: Any /project input — with or without a goal — never reaches a freeform model', () => {
      // Given: a range of /project inputs a real user might type
      const inputs = [
        '/project',
        '/project ',
        '/project build a thing',
        '/project   multi word goal with spaces   ',
      ];

      for (const input of inputs) {
        // When: the panel classifies each prompt
        const route = routePanelPrompt(input);

        // Then: none of them are classified as prose (which would reach the model)
        expect(route.kind, `input: "${input}"`).not.toBe('prose');

        // And: every one bypasses the freeform model
        expect(routeBypassesFreeformModel(route), `input: "${input}"`).toBe(true);
      }
    });

    // -------------------------------------------------------------------------
    // Acceptance scenario 5 — a path that starts with /project is not a command
    // -------------------------------------------------------------------------

    it('Scenario: A file path that begins with /project is treated as prose, not a planner trigger', () => {
      // Given: the user is asking about a file whose path starts with /project
      const userInput = '/project/src/index.ts is throwing a type error';

      // When: the panel classifies the prompt
      const route = routePanelPrompt(userInput);

      // Then: the route is "prose" — the panel forwards it to the model as a question
      // (A path with a second slash cannot be a command; the router is intentionally narrow.)
      expect(route.kind).toBe('prose');

      // And: prose is NOT bypassed — it goes to the model as intended
      expect(routeBypassesFreeformModel(route)).toBe(false);
    });
  }
);
