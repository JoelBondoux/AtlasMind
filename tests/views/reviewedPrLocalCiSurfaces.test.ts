import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');
const dashboard = read('media/projectDashboard.js');
const dashboardHost = read('src/views/projectDashboardPanel.ts');
const settings = read('src/views/settingsPanel.ts');
const participant = read('src/chat/participant.ts');
const manifest = JSON.parse(read('package.json')) as {
  contributes?: {
    commands?: Array<{ command?: string }>;
    chatParticipants?: Array<{ commands?: Array<{ name?: string }> }>;
  };
};

describe('reviewed-PR local-CI surfaces', () => {
  it('surfaces patch and review on both Pipeline and Pull Requests', () => {
    expect(dashboard).toContain("data-action=\"pipeline-local-ci-patch\"");
    expect(dashboard).toContain("data-action=\"pipeline-local-ci-review\"");
    expect(dashboard).toContain('renderReviewedPrLocalCiCard(true)');
    expect(dashboard).toContain('renderReviewedPrLocalCiCard(false)');
    expect(dashboard).toContain('Codex, Claude, another proprietary agent interface');
  });

  it('surfaces the same host-owned actions on Settings → Testing', () => {
    expect(settings).toContain('id="reviewedPrLocalCiCard"');
    expect(settings).toContain("payload: 'patch'");
    expect(settings).toContain("payload: 'review'");
    expect(settings).toContain('findLocalCiSurfaceAction(message.payload)');
  });

  it('keeps arbitrary command ids out of both webview protocols', () => {
    expect(dashboardHost).toContain("type: 'runLocalCiSurfaceAction'; payload: LocalCiSurfaceActionId");
    expect(dashboardHost).toContain('findLocalCiSurfaceAction(candidate[\'payload\'])');
    expect(settings).toContain("type: 'runLocalCiSurfaceAction'; payload: LocalCiSurfaceActionId");
  });

  it('declares palette commands and deterministic slash aliases', () => {
    const palette = (manifest.contributes?.commands ?? []).map(item => item.command);
    const slash = (manifest.contributes?.chatParticipants ?? [])
      .flatMap(item => item.commands ?? [])
      .map(item => item.name);
    expect(palette).toContain('atlasmind.localCi.patchRepository');
    expect(palette).toContain('atlasmind.localCi.runReviewedPullRequest');
    expect(slash).toContain('localci-patch');
    expect(slash).toContain('localci-review');
    expect(participant).toContain("case 'localci-patch': await handleLocalCiCommand('patch'");
    expect(participant).toContain("case 'localci-review': await handleLocalCiCommand('review'");
  });
});
