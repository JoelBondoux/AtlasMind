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
});