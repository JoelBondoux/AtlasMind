import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildAssistantResponseMetadata } from '../../src/chat/participant.ts';
import { AUTO_REASONING_RULES, REASONING_PREFERENCES } from '../../src/core/reasoningBudget.ts';
import { isSettingsMessage } from '../../src/views/settingsPanel.ts';

/**
 * The reasoning axis has two surfaces: the Settings card that sets it, beside
 * budget and speed, and the routing summary on every answer that says what it
 * did. Both are pinned here rather than trusted.
 */

const PANEL = readFileSync(path.join(process.cwd(), 'src', 'views', 'settingsPanel.ts'), 'utf8').replace(/\r\n/g, '\n');
const CARD = PANEL.slice(PANEL.indexOf('<article class="settings-card" id="reasoningModeCard">'), PANEL.indexOf('</article>', PANEL.indexOf('id="reasoningModeCard"')));
const MANIFEST = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
  contributes: { configuration: { properties: Record<string, { default?: unknown; enum?: string[] }> } | Array<{ properties: Record<string, { default?: unknown; enum?: string[] }> }> };
};

function settingProperty(key: string): { default?: unknown; enum?: string[] } | undefined {
  const configuration = MANIFEST.contributes.configuration;
  const sections = Array.isArray(configuration) ? configuration : [configuration];
  return sections.map(section => section.properties[key]).find(Boolean);
}

describe('the Settings card sits beside budget and speed and offers exactly the declared modes', () => {
  it('renders one pill per declared preference, named for the reasoning group', () => {
    expect(CARD.length).toBeGreaterThan(200);
    for (const preference of REASONING_PREFERENCES) {
      expect(CARD).toContain(`renderRoutingChoicePill('reasoning', '${preference}'`);
    }
    expect(PANEL.indexOf("renderHeadingWithHelp('Speed mode'")).toBeLessThan(PANEL.indexOf("renderHeadingWithHelp('Reasoning mode'"));
  });

  it('declares the setting with the same enum and an auto default', () => {
    const property = settingProperty('atlasmind.reasoningMode');
    expect(property?.default).toBe('auto');
    expect(property?.enum).toEqual([...REASONING_PREFERENCES]);
  });

  it('publishes the rule table from the module rather than a copy of it', () => {
    expect(CARD).toContain('renderReasoningRulesTable()');
    const renderer = PANEL.slice(PANEL.indexOf('function renderReasoningRulesTable(): string {'), PANEL.indexOf('function renderRoutingChoicePill('));
    expect(renderer).toContain('AUTO_REASONING_RULES');
    expect(renderer).toContain('REASONING_CONTROLS');
    expect(renderer).toContain('escapeHtml(');
    expect(AUTO_REASONING_RULES.length).toBe(3);
  });
});

describe('the browser posts a mode and nothing else, and the host validates it', () => {
  it('wires the pills with addEventListener, never an inline handler', () => {
    expect(CARD).not.toMatch(/\son[a-z]+=/i);
    const wiring = PANEL.slice(PANEL.indexOf(`document.querySelectorAll('input[name="reasoning"]')`));
    expect(wiring).toContain(`vscode.postMessage({ type: 'setReasoningMode', payload: target.value })`);
  });

  it('accepts the four declared modes and refuses anything else', () => {
    for (const preference of REASONING_PREFERENCES) {
      expect(isSettingsMessage({ type: 'setReasoningMode', payload: preference })).toBe(true);
    }
    for (const payload of ['max', 'DEEP', '', null, 3, { level: 'deep' }]) {
      expect(isSettingsMessage({ type: 'setReasoningMode', payload })).toBe(false);
    }
  });

  it('writes only the reasoningMode key', () => {
    const handler = PANEL.slice(PANEL.indexOf("case 'setReasoningMode':"), PANEL.indexOf('return;', PANEL.indexOf("case 'setReasoningMode':")));
    expect(handler).toContain("configuration.update('reasoningMode', message.payload");
  });
});

describe('the routing summary on an answer names the level, its rule and what was sent', () => {
  const base = { agentId: 'default', modelUsed: 'anthropic/claude-opus-5-5', costUsd: 0.01, inputTokens: 10, outputTokens: 20, artifacts: undefined };

  it('includes the reasoning line when the result carries a decision', () => {
    const metadata = buildAssistantResponseMetadata('Plan the migration', {
      ...base,
      reasoning: { preference: 'auto', level: 'deep', levelRule: 'auto-high', model: 'anthropic/claude-opus-5-5', outcome: 'applied', parameter: 'output_config.effort=high' },
    });
    expect(metadata.thoughtSummary?.bullets).toContain(
      'Reasoning: auto → deep (rule: auto-high); sent output_config.effort=high to anthropic/claude-opus-5-5.',
    );
  });

  it('says nothing was sent when nothing was', () => {
    const metadata = buildAssistantResponseMetadata('Plan the migration', {
      ...base,
      modelUsed: 'copilot/gpt-4o',
      reasoning: { preference: 'deep', level: 'deep', levelRule: 'explicit-preference', model: 'copilot/gpt-4o', outcome: 'not-sent', notSentRule: 'no-declared-control' },
    });
    expect(metadata.thoughtSummary?.bullets).toContain(
      'Reasoning: deep (rule: explicit-preference); nothing sent to copilot/gpt-4o (no-declared-control).',
    );
  });

  it('adds no line for a result that carries no decision', () => {
    const metadata = buildAssistantResponseMetadata('hi', base);
    expect((metadata.thoughtSummary?.bullets ?? []).some(line => line.startsWith('Reasoning:'))).toBe(false);
  });
});
