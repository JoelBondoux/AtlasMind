import { describe, expect, it } from 'vitest';
import {
  collectDashboardChatDestinations,
  isDashboardChatDestinationId,
  planDashboardChatDispatch,
} from '../../src/views/webviewUtils.js';

const extensions = [
  {
    id: 'openai.chatgpt',
    packageJSON: {
      displayName: 'Codex',
      contributes: {
        chatSessions: {
          type: 'openai-codex',
          name: 'Codex',
          displayName: 'OpenAI Codex',
          description: 'OpenAI Codex integration for VS Code',
        },
      },
    },
  },
  {
    id: 'sample.chat',
    packageJSON: {
      displayName: 'Sample Chat',
      contributes: {
        chatParticipants: [
          { id: 'sample.reviewer', name: 'reviewer', fullName: 'Code Reviewer' },
          { id: 'atlasmind.orchestrator', name: 'atlas', fullName: 'AtlasMind' },
          { id: 'sample.unsafe', name: 'bad mention', fullName: 'Unsafe' },
        ],
        chatSessions: [
          { type: 'sample-session', displayName: 'Sample Session' },
          { type: 'bad;command', displayName: 'Unsafe Session' },
        ],
      },
    },
  },
];

describe('Project Dashboard chat destinations', () => {
  it('discovers only installed destinations with a declared prompt contract', () => {
    const destinations = collectDashboardChatDestinations(extensions);

    expect(destinations.map(destination => destination.id)).toEqual([
      'atlasmind',
      'vscode',
      'participant:sample.reviewer',
      'session:openai-codex',
      'session:sample-session',
    ]);
    expect(destinations.find(destination => destination.id === 'session:openai-codex'))
      .toMatchObject({ kind: 'session', label: 'OpenAI Codex', sessionType: 'openai-codex' });
    expect(destinations.find(destination => destination.id === 'participant:sample.reviewer'))
      .toMatchObject({ kind: 'participant', label: 'Code Reviewer', mention: 'reviewer' });
  });

  it('turns an Atlas icon click into an immediate AtlasMind submission', () => {
    const destinations = collectDashboardChatDestinations([]);
    const dispatch = planDashboardChatDispatch({
      draftPrompt: '  Fix the failing check.  ',
      sendMode: 'new-session',
      contextPatch: { source: 'dashboard' },
    }, 'atlasmind', destinations);

    expect(dispatch).toEqual({
      command: 'atlasmind.openChat',
      arguments: [{
        draftPrompt: 'Fix the failing check.',
        sendMode: 'new-session',
        contextPatch: { source: 'dashboard' },
        autoSubmit: true,
      }],
      destination: destinations[0],
    });
  });

  it('submits to the current VS Code Chat target when selected', () => {
    const destinations = collectDashboardChatDestinations([]);
    expect(planDashboardChatDispatch({ draftPrompt: 'Review this risk.' }, 'vscode', destinations))
      .toMatchObject({
        command: 'workbench.action.chat.open',
        arguments: [{ query: 'Review this risk.', isPartialQuery: false }],
      });
  });

  it('routes participants by mention and chat sessions by their installed type', () => {
    const destinations = collectDashboardChatDestinations(extensions);

    expect(planDashboardChatDispatch(
      { draftPrompt: 'Review this risk.' },
      'participant:sample.reviewer',
      destinations,
    )).toMatchObject({
      command: 'workbench.action.chat.open',
      arguments: [{ query: '@reviewer Review this risk.', isPartialQuery: false }],
    });

    expect(planDashboardChatDispatch(
      { draftPrompt: 'Resolve this gap.' },
      'session:openai-codex',
      destinations,
    )).toMatchObject({
      command: 'workbench.action.chat.openNewSessionSidebar.openai-codex',
      arguments: [{ prompt: 'Resolve this gap.' }],
    });
  });

  it('refuses a removed destination or a command-shaped configured value', () => {
    const destinations = collectDashboardChatDestinations([]);
    expect(planDashboardChatDispatch(
      { draftPrompt: 'Do not misroute me.' },
      'session:removed-agent',
      destinations,
    )).toBeUndefined();
    expect(isDashboardChatDestinationId('session:openai-codex')).toBe(true);
    expect(isDashboardChatDestinationId('participant:sample.reviewer')).toBe(true);
    expect(isDashboardChatDestinationId('session:bad;command')).toBe(false);
    expect(isDashboardChatDestinationId('workbench.action.files.delete')).toBe(false);
  });
});
