import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Where a hand-off puts the chat.
 *
 * A dashboard button, a register finding, a roadmap pill all mean "put this in
 * front of me", not "open a detached editor tab". They every one called
 * `openChatPanel`, which always creates the tab — so a prompt sent from a panel
 * landed in the viewport while the user's chat sat in the sidebar.
 */
const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

const HAND_OFF_SURFACES = [
  'src/views/projectDashboardPanel.ts',
  'src/views/projectRunCenterPanel.ts',
  'src/views/settingsPanel.ts',
  'src/views/costDashboardPanel.ts',
  'src/views/mcpPanel.ts',
  'src/views/websiteStudioPanel.ts',
];

describe('a hand-off opens chat where the user keeps it', () => {
  it('no surface executes the detached-panel command', () => {
    for (const file of HAND_OFF_SURFACES) {
      expect(read(file), `${file} should hand off to atlasmind.openChat`)
        .not.toContain("executeCommand('atlasmind.openChatPanel'");
    }
  });

  it('the shared command defers to the preferred surface', () => {
    const commands = read('src/commands.ts');
    expect(commands).toContain("registerCommand('atlasmind.openChat'");
    expect(commands).toContain('revealPreferredChatSurface(target)');
  });

  it('keeps the two surface-specific commands, which are the deliberate way to ask', () => {
    const commands = read('src/commands.ts');
    expect(commands).toContain("registerCommand('atlasmind.openChatPanel'");
    expect(commands).toContain("registerCommand('atlasmind.openChatView'");
  });

  it('defaults the session drawer closed, remembering an explicit choice either way', () => {
    // `!== false` opened it for anybody who had never touched the control, which
    // is everybody on a first run — and in the sidebar it sits above the
    // transcript you opened chat to read.
    const webview = read('media/chatPanel.js');
    expect(webview).toContain('persistedUiState.narrowSessionDrawerOpen === true');
    expect(webview).not.toContain('persistedUiState.narrowSessionDrawerOpen !== false');
  });
});
