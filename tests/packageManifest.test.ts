import { describe, expect, it } from 'vitest';
import manifest from '../package.json';

type WalkthroughStep = {
  id: string;
  description?: string;
  completionEvents?: string[];
};

type Walkthrough = {
  id: string;
  steps?: WalkthroughStep[];
};

type ContributedCommand = {
  command: string;
  title?: string;
};

describe('package manifest', () => {
  it('activates on startup so walkthrough command buttons are ready immediately', () => {
    expect(manifest.activationEvents).toContain('onStartupFinished');
  });

  it('wires the configure-provider walkthrough step to the provider command', () => {
    const walkthroughs = (manifest.contributes?.walkthroughs ?? []) as Walkthrough[];
    const getStarted = walkthroughs.find(entry => entry.id === 'atlasmind.getStarted');
    const configureProvider = getStarted?.steps?.find(step => step.id === 'configureProvider');

    expect(configureProvider?.description).toContain('(command:atlasmind.openModelProviders)');
    expect(configureProvider?.completionEvents).toContain('onCommand:atlasmind.openModelProviders');
  });

  it('wires the Skills and MCP empty-state links to registered commands', () => {
    const viewsWelcome = manifest.contributes?.viewsWelcome ?? [];
    const skillsWelcome = viewsWelcome.find(entry => entry.view === 'atlasmind.skillsView');
    const mcpWelcome = viewsWelcome.find(entry => entry.view === 'atlasmind.mcpServersView');

    expect(skillsWelcome?.contents).toContain('(command:atlasmind.skills.addSkill)');
    expect(mcpWelcome?.contents).toContain('(command:atlasmind.openMcpServers)');
  });

  it('contributes a Getting Started command for reopening the walkthrough', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const gettingStarted = commands.find(entry => entry.command === 'atlasmind.openGettingStarted');

    expect(gettingStarted?.title).toBe('AtlasMind: Getting Started');
  });

  it('relies on generated command and view activation events instead of duplicating them', () => {
    expect(manifest.activationEvents).toEqual([
      'onStartupFinished',
      'onChatParticipant:atlasmind.orchestrator',
    ]);
  });
});