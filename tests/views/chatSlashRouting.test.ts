import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATLAS_SLASH_COMMANDS,
  routeBypassesFreeformModel,
  routePanelPrompt,
} from '../../src/views/chatSlashRouting.ts';

describe('routePanelPrompt — a slash command never reaches a model by accident', () => {
  /**
   * The bug, stated as a test.
   *
   * The panel had no slash dispatch at all, so `/acp` went to the orchestrator as
   * prose and — with no provider configured — came back from the built-in echo
   * adapter as "Answered from context." Declared, documented, autocompleted, and
   * inert. Every recognised command must now be claimed by the router.
   */
  it('claims every command the manifest declares', () => {
    for (const command of ATLAS_SLASH_COMMANDS) {
      const route = routePanelPrompt(`/${command}`);
      expect(route.kind, `/${command}`).not.toBe('prose');
      expect(routeBypassesFreeformModel(route), `/${command}`).toBe(true);
    }
  });

  it('routes a deterministic command to a replay, with its argument', () => {
    expect(routePanelPrompt('/acp')).toEqual({ kind: 'replay', command: 'acp', argument: '', raw: '/acp' });
    expect(routePanelPrompt('/memory  what did we decide about auth  ')).toEqual({
      kind: 'replay',
      command: 'memory',
      argument: 'what did we decide about auth',
      // `raw` is what the user typed, so the transcript shows the command they
      // ran rather than the argument it was reduced to.
      raw: '/memory  what did we decide about auth',
    });
    expect(routePanelPrompt('/sync-instructions')).toMatchObject({ kind: 'replay', command: 'sync-instructions' });
  });

  it('hands the long-running two back as goals for the panel to run natively', () => {
    expect(routePanelPrompt('/project add pagination to the results list'))
      .toEqual({ kind: 'project', goal: 'add pagination to the results list' });
    expect(routePanelPrompt('/loop keep fixing failing tests until they pass'))
      .toEqual({ kind: 'loop', goal: 'keep fixing failing tests until they pass' });
  });

  it('refuses a goal-less run rather than running the empty string', () => {
    for (const command of ['project', 'loop'] as const) {
      const route = routePanelPrompt(`/${command}`);
      expect(route.kind, command).toBe('needs-argument');
      if (route.kind === 'needs-argument') {
        // Says what to type, because "missing argument" is not an instruction.
        expect(route.message).toContain(`/${command}`);
        expect(route.message).toMatch(/for example/i);
      }
    }
  });

  it('corrects a near-miss instead of letting a model answer it', () => {
    // `/agent` is the singular of a real command and the likeliest typo. Silently
    // forwarding it is exactly the failure this module removes.
    const route = routePanelPrompt('/agent');
    expect(route.kind).toBe('unknown');
    if (route.kind === 'unknown') {
      expect(route.message).toContain('/agent');
      expect(route.message).toContain('/agents');
    }
  });
});

describe('routePanelPrompt — a path is not a command', () => {
  /**
   * Narrower than "starts with a slash", deliberately.
   *
   * Asking about a file by absolute path is constant in a coding assistant, and
   * hijacking `/etc/hosts` into a command lookup would break it. Only a single
   * lowercase word can be a command.
   */
  it('leaves absolute paths and prose alone', () => {
    for (const prompt of [
      '/usr/local/bin/claude-agent-acp is missing',
      '/etc/hosts has the wrong entry',
      '/Users/joel/project/README.md',
      '/home/joel/.config',
      '/README.md',
      '/',
      '//',
      '/ acp',
      'what does /acp do?',
      '/Acp',
      '/acp2',
    ]) {
      expect(routePanelPrompt(prompt).kind, prompt).toBe('prose');
      expect(routeBypassesFreeformModel(routePanelPrompt(prompt)), prompt).toBe(false);
    }
  });

  it('treats a command name with a trailing slash as a path', () => {
    // `/memory/` is a directory, not the memory command.
    expect(routePanelPrompt('/memory/notes.md').kind).toBe('prose');
  });
});

describe('the command list is one list', () => {
  /**
   * The drift that produced the bug.
   *
   * `participant.ts` held its own `KNOWN_SLASH_COMMANDS`, the manifest declared
   * the chat participant's commands, and the panel knew about neither — so a
   * command could be declared, documented and autocompleted while one surface
   * had never heard of it. The list now lives in one module and is pinned here
   * against the manifest, so adding a command without teaching every surface
   * fails the build.
   */
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    contributes?: { chatParticipants?: Array<{ commands?: Array<{ name: string }> }> };
  };
  const declared = (manifest.contributes?.chatParticipants ?? [])
    .flatMap(participant => (participant.commands ?? []).map(command => command.name))
    .sort();

  it('found the manifest\'s chat commands', () => {
    expect(declared.length).toBeGreaterThan(10);
  });

  it('matches the manifest exactly, in both directions', () => {
    expect([...ATLAS_SLASH_COMMANDS].sort()).toEqual(declared);
  });

  it('has no duplicates', () => {
    expect(new Set(ATLAS_SLASH_COMMANDS).size).toBe(ATLAS_SLASH_COMMANDS.length);
  });

  it('classifies every command — none falls through to the refusal branch', () => {
    // The default branch exists so that adding a command and forgetting to
    // classify it is visible rather than silent. Nothing should reach it today.
    for (const command of ATLAS_SLASH_COMMANDS) {
      const route = routePanelPrompt(`/${command} some argument`);
      expect(['replay', 'project', 'loop'], `/${command}`).toContain(route.kind);
    }
  });
});
