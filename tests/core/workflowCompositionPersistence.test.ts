import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  readWorkflowConfig,
  renderWorkflowMarkdown,
  seedWorkflowConfig,
  writeWorkflowConfig,
} from '../../src/core/workflowConfig.ts';
import { sanitizeProjectComposition } from '../../src/core/projectComposition.ts';
import { removeTempDir } from '../helpers/tempDir';

describe('workflow composition persistence', () => {
  const roots: string[] = [];

  afterEach(() => {
    while (roots.length > 0) {
      removeTempDir(roots.pop()!);
    }
  });

  it('writes and reads composition in workflow.json and mirrors its declared scope', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'atlasmind-composition-'));
    roots.push(root);
    const config = seedWorkflowConfig({ profile: 'studio' });
    config.composition = sanitizeProjectComposition({
      components: [
        {
          id: 'gameplay', label: 'Gameplay | [Client] <script>', location: '.', role: 'application',
          archetype: { archetype: 'game', traits: ['has-ui', 'ships-binaries'] },
          vcs: 'git', home: true,
        },
        {
          id: 'content', label: 'Content', location: 'content', role: 'content',
          archetype: { archetype: 'generic', traits: [] }, vcs: 'perforce',
        },
      ],
    })!;

    await writeWorkflowConfig(root, config);

    const jsonPath = path.join(root, 'project_memory', 'operations', 'workflow.json');
    const markdownPath = path.join(root, 'project_memory', 'operations', 'workflow.md');
    const persisted = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
    const markdown = readFileSync(markdownPath, 'utf8');
    expect(persisted['composition']).toEqual(config.composition);
    expect(persisted).not.toHaveProperty('topology');
    expect(readWorkflowConfig(root)?.composition).toEqual(config.composition);
    expect(markdown).toContain('Gameplay \\| \\[Client\\] &lt;script&gt;');
    expect(markdown).not.toContain('<script>');
    expect(markdown).toContain('`perforce`');
  });

  it('renders the same composition deterministically', () => {
    const config = seedWorkflowConfig({ profile: 'solo' });
    config.composition = sanitizeProjectComposition({
      components: [{
        id: 'home', label: 'Home', location: '.', role: 'application',
        archetype: { archetype: 'generic', traits: [] }, vcs: 'unknown', home: true,
      }],
    })!;
    expect(renderWorkflowMarkdown(config)).toBe(renderWorkflowMarkdown(config));
  });
});
