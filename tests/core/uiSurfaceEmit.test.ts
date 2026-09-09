import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  UI_EMIT_RULES,
  UI_EMIT_TARGETS,
  assessSurfaceOwnership,
  collectSurfaceCopy,
  isUiEmitTargetId,
  planContentPatch,
  planSurfaceEmit,
  planSurfaceLaunch,
  sanitizeUiEmitManifest,
  suggestUiEmitTarget,
  uiEmitManifestPath,
  validateOutputRoot,
  type SurfaceEmitInput,
  type SurfaceEmitPlan,
  type SurfaceNodeCopy,
} from '../../src/core/uiSurfaceEmit.ts';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';
import type {
  UiDesignGraph,
  UiDesignNode,
  UiDesignScreen,
  UiEmitTargetId,
  WebsitePagePlan,
  WireframeElementKind,
  WireframeRect,
} from '../../src/types.ts';

const SOURCE_TARGETS: UiEmitTargetId[] = ['web', 'unity-uitoolkit', 'godot-control'];
const ALL_TARGETS: UiEmitTargetId[] = [...SOURCE_TARGETS, 'unreal-umg', 'swiftui', 'compose'];
const NOW = '2026-09-09T10:00:00.000Z';

function node(
  id: string,
  kind: WireframeElementKind,
  rect: WireframeRect,
  overrides: Partial<UiDesignNode> = {},
): UiDesignNode {
  return {
    id, kind, label: overrides.label ?? id, locked: false,
    layout: {
      mode: 'free', rect, widthMode: 'fixed', heightMode: 'fixed', hidden: false, direction: 'vertical',
      gap: 0, padding: 0, columns: 1, align: 'start', distribute: 'start',
      minWidth: null, maxWidth: null, minHeight: null, maxHeight: null, wrap: 'nowrap', order: 0,
    },
    viewportOverrides: {}, designPrompt: '', notes: '',
    ...overrides,
  };
}

interface Fixture {
  graph: UiDesignGraph;
  screen: UiDesignScreen;
  page: WebsitePagePlan;
  pages: WebsitePagePlan[];
}

function fixture(): Fixture {
  const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
  const page = config.pages[0]!;
  const nodes = [
    node('nav-1', 'nav', { x: 0, y: 0, width: 1000, height: 72 }, { label: 'Main nav' }),
    node('hero-1', 'hero', { x: 0, y: 72, width: 1000, height: 400 }, { label: 'Welcome' }),
    node('cta-1', 'cta', { x: 100, y: 300, width: 300, height: 80 }, { label: 'Book now', parentId: 'hero-1' }),
  ];
  const screen: UiDesignScreen = { id: page.id, pageId: page.id, initialized: true, baseBreakpoint: 'desktop', nodes };
  const graph: UiDesignGraph = {
    ...config.designGraph,
    tokens: [
      { id: 'color-primary', label: 'Primary', kind: 'color', value: '#2563eb' },
      { id: 'color-text', label: 'Text', kind: 'color', value: '#111111' },
      { id: 'font-body', label: 'Body', kind: 'font-family', value: 'Inter' },
      { id: 'spacing-base', label: 'Spacing', kind: 'spacing', value: 16 },
    ],
    screens: [screen],
  };
  return { graph, screen, page, pages: config.pages };
}

function emitInput(target: UiEmitTargetId, fx = fixture(), extra: Partial<SurfaceEmitInput> = {}): SurfaceEmitInput {
  return {
    ...fx, targetId: target, siteName: 'Northstar', emittedAt: NOW,
    contentBody: '# Welcome to Northstar\n\nWe fix boats.\n\nFast.',
    ...extra,
  };
}

function emit(target: UiEmitTargetId, fx = fixture(), extra: Partial<SurfaceEmitInput> = {}): SurfaceEmitPlan {
  const result = planSurfaceEmit(emitInput(target, fx, extra));
  if (!result.ok) { throw new Error(result.reason); }
  return result.plan;
}

function filesOf(plan: SurfaceEmitPlan): Map<string, string | undefined> {
  return new Map(plan.files.map(file => [file.path, file.contents]));
}

describe('emit targets and rules', () => {
  it('publishes its rules and declares every target with a verification statement', () => {
    expect(UI_EMIT_RULES.map(rule => rule.id)).toEqual([
      'layout-emitted-once', 'content-is-anchored-data', 'patch-by-anchor', 'hand-edit-refused',
      'additive-or-substitutive', 'unverified-gets-a-spec', 'nothing-written',
    ]);
    for (const target of UI_EMIT_TARGETS) {
      expect(target.verifiedAgainst.length).toBeGreaterThan(10);
      if (target.kind === 'handoff') {
        expect(target.verifiedAgainst).toMatch(/^Not verified/);
      }
    }
    expect(isUiEmitTargetId('web')).toBe(true);
    expect(isUiEmitTargetId('flutter')).toBe(false);
  });

  it('keeps every launch argv a constant with no shell metacharacter', () => {
    for (const target of UI_EMIT_TARGETS) {
      for (const argument of target.launch.args ?? []) {
        // The two placeholders are the only braces allowed; they are filled by
        // the host from its own workspace root, never from a message.
        expect(argument.replace('{workspaceRoot}', '').replace('{scenePath}', '')).not.toMatch(/[;&|`$<>(){}\n]/);
      }
      if (target.launch.command) {
        expect(target.launch.command).toMatch(/^[A-Za-z]+$/);
      }
    }
  });

  it('imports nothing that could write a file or start a process', () => {
    const source = readFileSync(path.join(process.cwd(), 'src', 'core', 'uiSurfaceEmit.ts'), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(match => match[1]!);
    expect(imports).not.toContain('node:fs');
    expect(imports).not.toContain('node:child_process');
    expect(imports.some(entry => entry === 'vscode')).toBe(false);
  });

  it('suggests a target from declared technologies, never from the surface kind alone', () => {
    expect(suggestUiEmitTarget('other', ['Unity 6 UI Toolkit'])).toBe('unity-uitoolkit');
    expect(suggestUiEmitTarget('other', ['Godot 4'])).toBe('godot-control');
    expect(suggestUiEmitTarget('mobile-app', ['SwiftUI'])).toBe('swiftui');
    expect(suggestUiEmitTarget('mobile-app', [])).toBe('web');
  });
});

describe('collectSurfaceCopy', () => {
  it('reads the heading and body a content kind consumes, and the nav from the page links', () => {
    const fx = fixture();
    const copy = collectSurfaceCopy({ ...fx, contentBody: '# Welcome to Northstar\n\nWe fix boats.' });
    const hero = copy.find(entry => entry.nodeId === 'hero-1')!;
    expect(hero.title).toBe('Welcome to Northstar');
    expect(hero.body).toBe('We fix boats.');
    expect(hero.action).toBe('Welcome');
    const nav = copy.find(entry => entry.nodeId === 'nav-1')!;
    // No declared links: the other pages' real titles, the preview's rule.
    expect(nav.items.length).toBeGreaterThan(0);
    expect(nav.items.every(item => item.href.startsWith('/'))).toBe(true);
    expect(nav.items.some(item => item.href === fx.page.slug)).toBe(false);
  });

  it('prefers a declared link and bound sample content over derived facts', () => {
    const fx = fixture();
    fx.page.links = [{ id: 'link-docs', label: 'Docs', externalUrl: 'https://docs.example.com', origin: 'declared' }];
    fx.graph.contentCollections = [{
      id: 'promos', label: 'Promos', description: '',
      fields: [{ id: 'headline', label: 'Headline', kind: 'text', required: true }],
      samples: [{ id: 'spring', label: 'Spring', values: { headline: 'Spring sale' } }],
    }];
    fx.screen.nodes[1]!.dataBinding = { collectionId: 'promos', sampleRecordId: 'spring', fieldMappings: { title: 'headline' } };
    const copy = collectSurfaceCopy({ ...fx, contentBody: '# Ignored heading' });
    expect(copy.find(entry => entry.nodeId === 'nav-1')!.items).toEqual([{ id: 'link-docs', label: 'Docs', href: 'https://docs.example.com' }]);
    expect(copy.find(entry => entry.nodeId === 'hero-1')!.title).toBe('Spring sale');
  });
});

describe('planSurfaceEmit', () => {
  it('refuses a surface nobody drew, a bad folder, and a folder inside project_memory', () => {
    const fx = fixture();
    fx.screen.nodes = [];
    const empty = planSurfaceEmit(emitInput('web', fx));
    expect(empty.ok).toBe(false);
    expect(!empty.ok && empty.refusal).toBe('screen-not-drawn');
    for (const bad of ['../out', '/abs', 'C:/x', 'project_memory/ui', 'a//b', 'with space']) {
      expect(validateOutputRoot(bad)).toBeDefined();
      const result = planSurfaceEmit(emitInput('web', fixture(), { outputRoot: bad }));
      expect(!result.ok && result.refusal).toBe('output-root-invalid');
    }
    expect(validateOutputRoot('ui-studio/web')).toBeUndefined();
  });

  it('emits web as one html, one css and a shared token file, with every node anchored and nested as drawn', () => {
    const plan = emit('web');
    expect(plan.files.map(file => file.path)).toEqual(['ui-studio/web/index.html', 'ui-studio/web/index.css', 'ui-studio/web/atlas-tokens.css']);
    expect(plan.files.find(file => file.shared)!.path).toBe('ui-studio/web/atlas-tokens.css');
    const html = plan.files[0]!.contents;
    expect(html).toContain('data-atlas-copy="nav-1"');
    expect(html).toContain('data-atlas-copy="hero-1"');
    expect(html).toContain('data-atlas-copy="cta-1"');
    // The CTA is inside the hero, so its element is inside the hero's.
    const heroOpen = html.indexOf('data-atlas-node="hero-1"');
    const ctaOpen = html.indexOf('data-atlas-node="cta-1"');
    const heroClose = html.indexOf('</section>', ctaOpen);
    expect(ctaOpen).toBeGreaterThan(heroOpen);
    expect(heroClose).toBeGreaterThan(ctaOpen);
    expect(html).toContain('<h2 class="atlas-title">Welcome to Northstar</h2>');
    expect(html).toContain('<p class="atlas-body">We fix boats.</p>');
    expect(plan.files[2]!.contents).toContain('--color-primary: #2563eb;');
    expect(plan.files[2]!.contents).toContain('--spacing-base: 16px;');
    expect(plan.manifest.anchors.map(anchor => anchor.nodeId).sort()).toEqual(['cta-1', 'hero-1', 'nav-1']);
    expect(plan.manifestPath).toBe(uiEmitManifestPath(plan.screenId, 'web'));
    expect(plan.disclosure).toContain('Nothing outside those paths is touched, and nothing is run.');
  });

  it('emits Unity UXML with element-name anchors and a USS token file', () => {
    const plan = emit('unity-uitoolkit');
    expect(plan.files.map(file => file.path)).toEqual(['Assets/UI/AtlasMind/Home.uxml', 'Assets/UI/AtlasMind/Home.uss', 'Assets/UI/AtlasMind/AtlasTokens.uss']);
    const uxml = plan.files[0]!.contents;
    expect(uxml).toMatch(/^<ui:UXML xmlns:ui="UnityEngine.UIElements"/);
    expect(uxml).toContain('<ui:VisualElement name="atlas_copy_hero-1" class="atlas-copy">');
    expect(uxml).toContain('<ui:Label class="atlas-title" text="Welcome to Northstar" />');
    expect(uxml).toContain('<ui:Button name="atlas_item_');
    expect(plan.files[2]!.contents).toContain('--color-primary: #2563eb;');
  });

  it('emits a Godot scene with anchored copy nodes and a theme with Color literals', () => {
    const plan = emit('godot-control');
    expect(plan.files.map(file => file.path)).toEqual(['ui/atlasmind/index.tscn', 'ui/atlasmind/atlas_theme.tres']);
    const scene = plan.files[0]!.contents;
    expect(scene).toMatch(/^\[gd_scene format=3\]/);
    expect(scene).toContain('[node name="atlas_node_hero-1" type="Control" parent="."]');
    expect(scene).toContain('[node name="atlas_copy_hero-1" type="VBoxContainer" parent="atlas_node_hero-1"]');
    expect(scene).toContain('[node name="atlas_copy_hero-1_title" type="Label" parent="atlas_node_hero-1/atlas_copy_hero-1"]');
    expect(scene).toContain('text = "Welcome to Northstar"');
    expect(scene).toContain('[node name="atlas_node_cta-1" type="Control" parent="atlas_node_hero-1"]');
    expect(plan.files[1]!.contents).toContain('Label/colors/font_color = Color(0.067, 0.067, 0.067, 1)');
  });

  it('emits a handoff specification, not source, for the unverified targets', () => {
    for (const target of ['unreal-umg', 'swiftui', 'compose'] as const) {
      const plan = emit(target);
      expect(plan.files).toHaveLength(1);
      expect(plan.files[0]!.path).toBe(`docs/ui-handoff/index.${target}.md`);
      expect(plan.files[0]!.contents).toContain('<!-- atlas:copy:hero-1 -->');
      expect(plan.files[0]!.contents).toContain('- **Title:** Welcome to Northstar');
      expect(plan.files[0]!.contents).not.toMatch(/\bstruct\b|@Composable|UCLASS/);
      expect(plan.caveats[0]).toContain('specification');
    }
  });

  it('refuses to write over files it did not write, and over a layout the engine now owns', () => {
    const first = emit('web');
    const occupied = planSurfaceEmit(emitInput('web', fixture(), {
      existing: { files: new Map([['ui-studio/web/index.html', '<p>somebody else</p>']]) },
    }));
    expect(!occupied.ok && occupied.refusal).toBe('files-exist');

    const files = filesOf(first);
    // Unchanged files: an emit again is idempotent and allowed.
    const same = planSurfaceEmit(emitInput('web', fixture(), { existing: { manifest: first.manifest, files } }));
    expect(same.ok).toBe(true);

    files.set('ui-studio/web/index.css', `${files.get('ui-studio/web/index.css')}\n.atlas-hero { padding: 40px; }\n`);
    const owned = planSurfaceEmit(emitInput('web', fixture(), { existing: { manifest: first.manifest, files } }));
    expect(!owned.ok && owned.refusal).toBe('layout-owned-by-engine');
    expect(!owned.ok && owned.reason).toContain('Layout: owned by the browser since the emit on 2026-09-09');
    expect(!owned.ok && owned.ownership?.layout.status).toBe('engine-owned');
  });
});

describe('ownership and content patches', () => {
  function changedCopy(fx: Fixture, title: string): SurfaceNodeCopy[] {
    return collectSurfaceCopy({ ...fx, contentBody: `# ${title}\n\nWe fix boats.\n\nFast.` });
  }

  it.each(ALL_TARGETS)('%s: a copy change patches only its region, and the file is then as written again', target => {
    const fx = fixture();
    const plan = emit(target, fx);
    const files = filesOf(plan);
    const before = assessSurfaceOwnership(plan.manifest, files);
    expect(before.layout.status).toBe('as-emitted');
    expect(before.content.blocked).toBe(0);
    expect(before.statement).toBe('Layout: as emitted on 2026-09-09 · Content: editable here (3 regions)');

    const unchanged = planContentPatch({ manifest: plan.manifest, files, copy: collectSurfaceCopy({ ...fx, contentBody: emitInput(target).contentBody! }), now: NOW });
    expect(unchanged.patches).toHaveLength(0);
    expect(unchanged.unchanged).toBe(3);

    const patched = planContentPatch({ manifest: plan.manifest, files, copy: changedCopy(fx, 'Now with lifts'), now: '2026-09-10T00:00:00.000Z' });
    expect(patched.patches.map(patch => patch.nodeId)).toEqual(['hero-1']);
    expect(patched.refusals).toEqual([]);
    expect(patched.files).toHaveLength(1);
    const primary = plan.files.find(file => !file.shared)!;
    const original = primary.contents;
    const updated = patched.files[0]!.contents;
    expect(updated).toContain('Now with lifts');
    expect(updated).not.toContain('Welcome to Northstar');
    // Everything outside the region is byte-identical.
    const cut = (text: string) => text.replace(patched.patches[0]!.before, '').replace(patched.patches[0]!.after, '');
    expect(cut(updated)).toBe(cut(original));
    expect(patched.manifest.contentUpdatedAt).toBe('2026-09-10T00:00:00.000Z');

    // After the patch, the file is as written: the layout is still ours to
    // re-emit and the region is editable again.
    const after = new Map(files);
    after.set(primary.path, updated);
    const ownership = assessSurfaceOwnership(patched.manifest, after);
    expect(ownership.layout.status).toBe('as-emitted');
    expect(ownership.content.blocked).toBe(0);
    const again = planContentPatch({ manifest: patched.manifest, files: after, copy: changedCopy(fx, 'Now with lifts'), now: NOW });
    expect(again.patches).toHaveLength(0);
    expect(again.unchanged).toBe(3);
  });

  it.each(SOURCE_TARGETS)('%s: a layout edit outside every region leaves the words editable, and a hand edit inside one is refused and shown', target => {
    const fx = fixture();
    const plan = emit(target, fx);
    const primary = plan.files.find(file => !file.shared)!;
    const files = filesOf(plan);
    files.set(primary.path, `${primary.contents}\n`);
    const layoutOnly = assessSurfaceOwnership(plan.manifest, files);
    expect(layoutOnly.layout.status).toBe('engine-owned');
    expect(layoutOnly.content.editable).toBe(3);
    expect(layoutOnly.statement).toContain('Content: editable here (3 regions)');

    const edited = primary.contents.replace('Welcome to Northstar', 'Welcome to Northstar, edited in the engine');
    files.set(primary.path, edited);
    const ownership = assessSurfaceOwnership(plan.manifest, files);
    expect(ownership.content.blocked).toBe(1);
    expect(ownership.content.reasons[0]).toMatchObject({ nodeId: 'hero-1' });
    expect(ownership.statement).toContain('2 of 3 regions; 1 blocked');

    const patched = planContentPatch({ manifest: plan.manifest, files, copy: changedCopy(fx, 'Studio says otherwise'), now: NOW });
    expect(patched.patches).toHaveLength(0);
    expect(patched.refusals).toHaveLength(1);
    expect(patched.refusals[0]).toMatchObject({ nodeId: 'hero-1', code: 'region-edited' });
    expect(patched.refusals[0]!.current).toContain('edited in the engine');
    expect(patched.files).toHaveLength(0);
  });

  it('refuses a node whose anchor the engine removed, and reports one removed in Studio or drawn after the emit', () => {
    const fx = fixture();
    const plan = emit('web', fx);
    const files = filesOf(plan);
    const html = files.get('ui-studio/web/index.html')!;
    const start = html.indexOf('<div class="atlas-copy" data-atlas-copy="hero-1">');
    const end = html.indexOf('</div>', start) + '</div>'.length;
    files.set('ui-studio/web/index.html', html.slice(0, start) + html.slice(end));
    const gone = planContentPatch({ manifest: plan.manifest, files, copy: changedCopy(fx, 'Changed'), now: NOW });
    expect(gone.refusals).toEqual([expect.objectContaining({ nodeId: 'hero-1', code: 'anchor-missing' })]);

    const copy = changedCopy(fx, 'Changed').filter(entry => entry.nodeId !== 'cta-1');
    copy.push({ nodeId: 'new-1', kind: 'text', title: 'Drawn later', body: '', action: '', items: [] });
    const later = planContentPatch({ manifest: plan.manifest, files: filesOf(plan), copy, now: NOW });
    expect(later.refusals).toEqual([expect.objectContaining({ nodeId: 'cta-1', code: 'node-removed' })]);
    expect(later.unanchored).toEqual(['new-1']);
    expect(later.summary).toContain('1 drawn after the emit and not inserted');
    // The removed node's region is still in the file: nothing was deleted.
    expect(later.files[0]!.contents).toContain('data-atlas-copy="cta-1"');
  });

  it('survives an engine re-serialising its own file: Godot reorders properties, Unity re-indents', () => {
    const fx = fixture();
    const godot = emit('godot-control', fx);
    const scene = godot.files[0]!.contents
      .replace('layout_mode = 2\ntheme_type_variation = &"HeaderMedium"\ntext = "Welcome to Northstar"', 'text = "Welcome to Northstar"\ntheme_type_variation = &"HeaderMedium"\nlayout_mode = 2\nsize_flags_horizontal = 3');
    expect(scene).not.toBe(godot.files[0]!.contents);
    const godotFiles = filesOf(godot);
    godotFiles.set(godot.files[0]!.path, scene);
    expect(assessSurfaceOwnership(godot.manifest, godotFiles).content.blocked).toBe(0);

    const unity = emit('unity-uitoolkit', fx);
    const uxml = unity.files[0]!.contents.replace(/\n\s+/g, '\n');
    const unityFiles = filesOf(unity);
    unityFiles.set(unity.files[0]!.path, uxml);
    expect(assessSurfaceOwnership(unity.manifest, unityFiles).content.blocked).toBe(0);
  });

  it('adds a nav item as a new line in the region without touching anything else', () => {
    const fx = fixture();
    const plan = emit('web', fx);
    fx.page.links = [
      { id: 'l1', label: 'About', externalUrl: 'https://example.com/about', origin: 'declared' },
      { id: 'l2', label: 'Pricing', externalUrl: 'https://example.com/pricing', origin: 'declared' },
    ];
    const patched = planContentPatch({ manifest: plan.manifest, files: filesOf(plan), copy: collectSurfaceCopy({ ...fx, contentBody: emitInput('web').contentBody! }), now: NOW });
    expect(patched.patches.map(patch => patch.nodeId)).toEqual(['nav-1']);
    expect(patched.patches[0]!.after).toContain('<li data-atlas-item="l2"><a href="https://example.com/pricing">Pricing</a></li>');
  });

  it('round-trips arbitrary copy through every source grammar', () => {
    const text = fc.string({ minLength: 1, maxLength: 60 }).map(value => value.replace(/[\s]+/g, ' ').trim()).filter(value => value.length > 0);
    fc.assert(fc.property(fc.constantFrom(...SOURCE_TARGETS), text, text, (target, first, second) => {
      const fx = fixture();
      const plan = emit(target, fx, { contentBody: `# ${first}\n\nbody` });
      const files = filesOf(plan);
      expect(assessSurfaceOwnership(plan.manifest, files).content.blocked).toBe(0);
      const patched = planContentPatch({ manifest: plan.manifest, files, copy: collectSurfaceCopy({ ...fx, contentBody: `# ${second}\n\nbody` }), now: NOW });
      expect(patched.refusals).toEqual([]);
      const after = new Map(files);
      for (const file of patched.files) { after.set(file.path, file.contents); }
      expect(assessSurfaceOwnership(patched.manifest, after).content.blocked).toBe(0);
    }), { numRuns: 60 });
  });
});

describe('launch plans and manifests', () => {
  it('fills the constant argv with the workspace and scene, and marks Unity as yours to run', () => {
    const godot = planSurfaceLaunch(emit('godot-control').manifest, 'D:/game');
    expect(godot).toMatchObject({ kind: 'command', command: 'godot', args: ['--path', 'D:/game', 'ui/atlasmind/index.tscn'], manualOnly: false });
    const unity = planSurfaceLaunch(emit('unity-uitoolkit').manifest, 'D:/game');
    expect(unity).toMatchObject({ kind: 'command', command: 'Unity', args: ['-projectPath', 'D:/game'], manualOnly: true });
    expect(planSurfaceLaunch(emit('web').manifest, 'D:/site')).toMatchObject({ kind: 'open-file', filePath: 'ui-studio/web/index.html' });
    expect(planSurfaceLaunch(emit('swiftui').manifest, 'D:/app').kind).toBe('none');
  });

  it('reads a committed manifest as untrusted: round-trips its own, refuses traversal and a foreign version', () => {
    const plan = emit('web');
    const roundTrip = sanitizeUiEmitManifest(JSON.parse(JSON.stringify(plan.manifest)));
    expect(roundTrip).toEqual(plan.manifest);
    expect(sanitizeUiEmitManifest({ ...plan.manifest, version: 2 })).toBeUndefined();
    const traversal = sanitizeUiEmitManifest({ ...plan.manifest, files: [{ path: '../etc/passwd', fingerprint: plan.manifest.files[0]!.fingerprint, shared: false }] });
    expect(traversal).toBeUndefined();
    const dangling = sanitizeUiEmitManifest({ ...plan.manifest, anchors: [{ ...plan.manifest.anchors[0], filePath: 'elsewhere.html' }] });
    expect(dangling?.anchors).toEqual([]);
  });
});
