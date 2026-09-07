import { describe, expect, it } from 'vitest';
import {
  classifyUiSurface,
  scanUiSurfaces,
  UI_SURFACE_RULES,
  UI_SURFACE_SCAN_MAX_SURFACES,
  UI_SURFACE_SCAN_SKIPPED_DIRECTORIES,
  type UiSurfaceScanProbe,
} from '../../src/core/uiSurfaceScan.ts';

/** An interface rather than a type alias: only the former may reference itself. */
interface Tree { [name: string]: string | Tree }

/** A fake workspace. Strings are file contents; objects are directories. */
function probeFor(tree: Tree): UiSurfaceScanProbe {
  const at = (relativePath: string): Tree | string | undefined => {
    if (relativePath === '') { return tree; }
    let node: Tree | string | undefined = tree;
    for (const segment of relativePath.split('/')) {
      if (typeof node !== 'object' || node === null) { return undefined; }
      node = node[segment];
    }
    return node;
  };
  return {
    readDirectory(relativePath) {
      const node = at(relativePath);
      if (typeof node !== 'object' || node === null) { return []; }
      return Object.entries(node).map(([name, value]) => ({
        name,
        isDirectory: typeof value === 'object',
        bytes: typeof value === 'string' ? value.length : 0,
      }));
    },
    readHead(relativePath) {
      const node = at(relativePath);
      return typeof node === 'string' ? node : undefined;
    },
  };
}

const pathsOf = (tree: Tree) => scanUiSurfaces(probeFor(tree)).surfaces.map(surface => surface.path);

describe('what counts as a UI surface', () => {
  it('claims components, pages and single-file components from the path alone', () => {
    expect(pathsOf({
      src: { 'Button.tsx': 'x', 'Card.jsx': 'x', 'App.vue': 'x', 'Nav.svelte': 'x' },
      'index.html': 'x',
    }).sort()).toEqual(['index.html', 'src/App.vue', 'src/Button.tsx', 'src/Card.jsx', 'src/Nav.svelte']);
  });

  it('every candidate names the rule that claimed it', () => {
    const report = scanUiSurfaces(probeFor({ src: { 'Button.tsx': 'x' } }));
    // The list a person picks from has to be arguable, which means each row can
    // say why it is there and the table travels with it.
    expect(report.surfaces[0]?.ruleId).toBe('react-component');
    expect(report.rules).toBe(UI_SURFACE_RULES);
    expect(report.rules.every(rule => rule.description.length > 0)).toBe(true);
  });

  it('takes a stylesheet only when it actually declares tokens', () => {
    // Every project has stylesheets. The ones worth offering as a *design*
    // surface are the ones holding custom properties, and the path cannot say.
    expect(pathsOf({ 'tokens.css': ':root { --brand: #123456; }' })).toEqual(['tokens.css']);
    expect(pathsOf({ 'reset.css': 'body { margin: 0; }' })).toEqual([]);
  });

  it('takes a media script only when it builds markup', () => {
    // Otherwise the rule claims every helper and polyfill in the same folder.
    expect(pathsOf({ media: { 'panel.js': 'root.innerHTML = draw();' } })).toEqual(['media/panel.js']);
    expect(pathsOf({ media: { 'util.js': 'export const clamp = n => n;' } })).toEqual([]);
  });

  it('refuses tests, declarations, stories and minified output', () => {
    expect(pathsOf({
      src: {
        'Button.test.tsx': 'x', 'Button.spec.jsx': 'x', 'Button.stories.tsx': 'x',
        'types.d.ts': 'x', 'bundle.min.css': ':root { --a: 1; }',
      },
    })).toEqual([]);
  });
});

describe('what the scan refuses to walk into', () => {
  it('never enters dependencies or build output', () => {
    // out/, dist/ and coverage/ hold derived copies of this project's own UI,
    // which is the worse case: they look right, and a mapping onto one records
    // a source the next build overwrites.
    const tree: Tree = { src: { 'Real.tsx': 'x' } };
    for (const directory of UI_SURFACE_SCAN_SKIPPED_DIRECTORIES) {
      tree[directory] = { 'Fake.tsx': 'x' };
    }
    expect(pathsOf(tree)).toEqual(['src/Real.tsx']);
  });

  it('counts what it excluded, so an empty list is explicable', () => {
    const report = scanUiSurfaces(probeFor({ src: { 'readme.md': 'x', 'notes.txt': 'x' } }));
    expect(report.surfaces).toEqual([]);
    // "Nothing found" and "nothing looked at" are different answers.
    expect(report.filesExamined).toBe(2);
    expect(report.filesExcluded).toBe(2);
  });

  it('skips dotted directories but keeps .vscode', () => {
    expect(pathsOf({
      '.husky': { 'x.tsx': 'x' },
      '.vscode': { 'panel.html': 'x' },
    })).toEqual(['.vscode/panel.html']);
  });
});

describe('the scan is bounded and says so', () => {
  it('caps the surfaces it returns and reports the truncation', () => {
    const files: Tree = {};
    for (let index = 0; index < UI_SURFACE_SCAN_MAX_SURFACES + 25; index += 1) {
      files[`Component${index}.tsx`] = 'x';
    }
    const report = scanUiSurfaces(probeFor({ src: files }));
    expect(report.surfaces).toHaveLength(UI_SURFACE_SCAN_MAX_SURFACES);
    // A picker showing the first 200 of 4,000 while claiming to be the list is
    // worse than one admitting it stopped.
    expect(report.truncated).toBe(true);
  });

  it('reports no truncation when everything fitted', () => {
    expect(scanUiSurfaces(probeFor({ src: { 'One.tsx': 'x' } })).truncated).toBe(false);
  });
});

describe('the scan never throws', () => {
  it('treats an unreadable directory as a miss rather than a failure', () => {
    const probe: UiSurfaceScanProbe = {
      readDirectory(relativePath) {
        if (relativePath === '') {
          return [{ name: 'locked', isDirectory: true, bytes: 0 }, { name: 'Ok.tsx', isDirectory: false, bytes: 1 }];
        }
        throw new Error('EACCES');
      },
      readHead: () => undefined,
    };
    // Half a list is more useful than an error where a list should be.
    expect(scanUiSurfaces(probe).surfaces.map(surface => surface.path)).toEqual(['Ok.tsx']);
  });

  it('treats an unreadable file head as a rule that did not match', () => {
    expect(classifyUiSurface('tokens.css', () => { throw new Error('EACCES'); })).toBeUndefined();
  });
});
