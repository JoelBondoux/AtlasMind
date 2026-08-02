import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const settings = readFileSync(path.join(root, 'src/views/settingsPanel.ts'), 'utf8');
const dashboard = readFileSync(path.join(root, 'src/views/projectDashboardPanel.ts'), 'utf8');
const dashboardWebview = readFileSync(path.join(root, 'media/projectDashboard.js'), 'utf8');

describe('Lens declaration discovery surfaces', () => {
  it('shows shared declaration status and setup in Settings', () => {
    expect(settings).toContain('inspectLensDeclarations');
    expect(settings).toContain('id="lensDeclarationsCard"');
    expect(settings).toContain('setupLensDeclarations');
  });

  it('shows a live Lens declaration status card in Project Dashboard', () => {
    expect(dashboard).toContain("id: 'lens'");
    expect(dashboard).toContain('lensDeclarations.readyCount');
    expect(dashboard).toContain("'atlasmind.lens.setupDeclarations'");
    expect(dashboardWebview).toContain("'atlasmind.lens.setupDeclarations': 'Lens declarations'");
  });
});
