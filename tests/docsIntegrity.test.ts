import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Documentation drift, guarded.
 *
 * It is the most-repeated defect class in this project's history and the only one
 * that had no test. Two broken `[[Delivery]]` wikilinks survived nine documents.
 * Six files asserted `project_memory/` was excluded from `main` while ninety
 * tracked files on `main` disproved it. Two documents cited CI workflows that did
 * not exist. A README version banner and a `package.json` version have gone out
 * of step more than once, and a wiki page has referenced a dashboard tab under a
 * name the panel does not have.
 *
 * Every check here is a *resolution* check: does the thing this text points at
 * exist? None of them judge prose, because prose is not what goes stale first —
 * the pointers are.
 */

const ROOT = process.cwd();

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

function listMarkdown(dir: string): string[] {
  const base = path.join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return [];
  }
  return entries
    .filter(name => name.endsWith('.md'))
    .filter(name => statSync(path.join(base, name)).isFile())
    .map(name => `${dir}/${name}`);
}

const WIKI_FILES = listMarkdown('wiki');
const DOC_FILES = listMarkdown('docs');
const ROOT_DOCS = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'CLAUDE.md', 'AGENTS.md'];

/** Strip fenced and inline code, where a `[[…]]` is a code sample rather than a link. */
function withoutCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

describe('the corpus is actually being read', () => {
  it('found the wiki and docs trees', () => {
    // A file list that silently emptied would make every check below vacuous.
    expect(WIKI_FILES.length).toBeGreaterThan(10);
    expect(DOC_FILES.length).toBeGreaterThan(4);
  });
});

describe('every wikilink resolves to a page', () => {
  const pageNames = new Set(WIKI_FILES.map(file => path.basename(file, '.md')));

  it('has the pages the sidebar is built from', () => {
    expect(pageNames.has('Home')).toBe(true);
    expect(pageNames.has('Architecture')).toBe(true);
  });

  it('resolves every [[target]] across the wiki', () => {
    const broken: string[] = [];
    for (const file of WIKI_FILES) {
      const body = withoutCode(read(file));
      for (const match of body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
        const target = match[1]!.trim();
        // Two shapes that look broken and are not, both of which were nearly
        // "fixed" as false positives once already:
        //
        // - An anchor. A target carrying one resolves on the part before it.
        // - A trailing backslash, which is an *escaped pipe* in the source
        //   (`[[Page\|Label]]`) that the target group swallows.
        const page = target.split('#')[0]!.replace(/\\+$/, '').trim();
        if (page === '') {
          continue;
        }
        // GitHub's wiki maps spaces to hyphens, so both spellings resolve.
        if (!pageNames.has(page) && !pageNames.has(page.replace(/ /g, '-'))) {
          broken.push(`${file} → [[${target}]]`);
        }
      }
    }
    expect(broken, 'these wikilinks point at pages that do not exist').toEqual([]);
  });
});

describe('every relative link in the docs resolves to a file', () => {
  it('resolves markdown links across docs/, the wiki and the root documents', () => {
    const broken: string[] = [];
    for (const file of [...DOC_FILES, ...WIKI_FILES, ...ROOT_DOCS]) {
      const body = withoutCode(read(file));
      const from = path.dirname(path.join(ROOT, file));
      for (const match of body.matchAll(/\]\(([^)\s]+)\)/g)) {
        const href = match[1]!;
        // Only repository-relative paths are checkable here. External URLs are a
        // different problem with a different failure mode, and this test does not
        // reach the network.
        if (/^([a-z]+:|#|\/\/)/i.test(href)) {
          continue;
        }
        const target = href.split('#')[0]!;
        if (target === '') {
          continue;
        }
        const resolved = path.resolve(from, decodeURIComponent(target));
        // Inside the wiki, an extensionless relative link is a *page* reference —
        // GitHub resolves `](Security)` to `Security.md`. Checking only the
        // literal path would report every correct wiki cross-link as broken.
        const candidates = /\.[a-z]+$/i.test(target) ? [resolved] : [resolved, `${resolved}.md`];
        if (!candidates.some(candidate => { try { statSync(candidate); return true; } catch { return false; } })) {
          broken.push(`${file} → ${href}`);
        }
      }
    }
    expect(broken, 'these links point at files that do not exist').toEqual([]);
  });
});

describe('the version is one number, wherever it appears', () => {
  const version = (JSON.parse(read('package.json')) as { version: string }).version;

  it('matches the README banner', () => {
    expect(read('README.md')).toContain(`Current source version: ${version}`);
  });

  it('has a changelog entry, at the top', () => {
    const changelog = read('CHANGELOG.md');
    expect(changelog).toContain(`## [${version}]`);
    // Below an older entry means the release notes read as history rather than as
    // the current release — and `extractChangelogSection` takes the first match.
    const entries = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(match => match[1]!);
    expect(entries[0], 'the newest changelog entry is not this version').toBe(version);
  });

  it('has a wiki changelog entry', () => {
    expect(read('wiki/Changelog.md')).toContain(`## v${version}`);
  });

  it('keeps the Keep a Changelog preamble', () => {
    // Removing it has been an explicit prohibition since the project's first
    // release rules; a test costs less than remembering.
    const changelog = read('CHANGELOG.md');
    expect(changelog.startsWith('# Changelog')).toBe(true);
    expect(changelog).toMatch(/Keep a Changelog/);
  });
});

describe('CLAUDE.md and AGENTS.md stay byte-identical', () => {
  it('are the same file in two places', () => {
    // They are read by different tools and diverging turns one instruction set
    // into two contradicting ones.
    expect(read('AGENTS.md')).toBe(read('CLAUDE.md'));
  });
});

describe('a document naming a source file names one that exists', () => {
  it('resolves every src/ path mentioned in backticks', () => {
    const broken: string[] = [];
    for (const file of [...DOC_FILES, ...WIKI_FILES, 'README.md', 'CONTRIBUTING.md', 'CLAUDE.md']) {
      const body = read(file);
      // Only `src/…` with a real extension: prose about a directory is not a
      // claim about a file, and the tables in these documents cite exact paths.
      for (const match of body.matchAll(/`(src\/[A-Za-z0-9_\-/.]+\.(?:ts|js))`/g)) {
        const target = path.join(ROOT, match[1]!);
        try {
          statSync(target);
        } catch {
          broken.push(`${file} → ${match[1]}`);
        }
      }
    }
    expect(broken, 'these documents cite source files that do not exist').toEqual([]);
  });

  it('resolves every workflow file cited from .github/workflows', () => {
    // Two documents cited CI workflows that had never been written. A citation of
    // a workflow that does not exist reads as a capability the project has.
    const broken: string[] = [];
    for (const file of [...DOC_FILES, ...WIKI_FILES, 'README.md', 'CONTRIBUTING.md', 'CLAUDE.md']) {
      for (const match of read(file).matchAll(/`(\.github\/workflows\/[A-Za-z0-9_\-.]+\.ya?ml)`/g)) {
        try {
          statSync(path.join(ROOT, match[1]!));
        } catch {
          broken.push(`${file} → ${match[1]}`);
        }
      }
    }
    expect(broken, 'these documents cite CI workflows that do not exist').toEqual([]);
  });
});

describe('a document naming a setting names one the manifest declares', () => {
  const manifest = JSON.parse(read('package.json')) as {
    contributes?: { configuration?: { properties?: Record<string, unknown> } | Array<{ properties?: Record<string, unknown> }> };
  };

  function declaredSettings(): Set<string> {
    const configuration = manifest.contributes?.configuration;
    const blocks = Array.isArray(configuration) ? configuration : configuration ? [configuration] : [];
    return new Set(blocks.flatMap(block => Object.keys(block.properties ?? {})));
  }

  const commandIds = new Set(
    ((JSON.parse(read('package.json')) as { contributes?: { commands?: Array<{ command: string }> } })
      .contributes?.commands ?? []).map(entry => entry.command),
  );

  it('found the settings', () => {
    expect(declaredSettings().size).toBeGreaterThan(50);
  });

  it('resolves every atlasmind.* setting cited in the configuration docs', () => {
    const settings = declaredSettings();
    const broken: string[] = [];
    // Scoped to the documents whose job is to enumerate settings. Prose elsewhere
    // legitimately refers to a family (`atlasmind.buzz.*`) or to a key by prefix.
    for (const file of ['docs/configuration.md', 'wiki/Configuration.md']) {
      let body: string;
      try {
        body = read(file);
      } catch {
        continue;
      }
      for (const match of body.matchAll(/`(atlasmind\.[A-Za-z0-9_.]+)`/g)) {
        const key = match[1]!;
        if (key.endsWith('.') || settings.has(key)) {
          continue;
        }
        // A command legitimately appears in these documents ("toggled with
        // `atlasmind.togglePresence`"), and it is declared elsewhere in the
        // manifest.
        if (commandIds.has(key)) {
          continue;
        }
        // Provider API keys are documented here and deliberately *not* settings:
        // they live in SecretStorage, which is the project's oldest security
        // rule. Requiring them in the manifest would demand the opposite.
        if (/^atlasmind\.provider\..+\.(apiKey|accessKeyId|secretAccessKey|sessionToken)$/.test(key)) {
          continue;
        }
        // A document may say a setting was removed. That is the fix, not the bug.
        if (new RegExp(`\`${key.replace(/\./g, '\.')}\`[^.]{0,120}(removed|no longer|does not exist)`).test(body)) {
          continue;
        }
        // A section heading may name a group that is a prefix of real keys.
        if ([...settings].some(declared => declared.startsWith(`${key}.`))) {
          continue;
        }
        broken.push(`${file} → ${key}`);
      }
    }
    expect(broken, 'these documents cite settings the manifest does not declare').toEqual([]);
  });

  /**
   * The other direction, which was missing and had let fourteen settings ship
   * undocumented.
   *
   * Checking only docs → manifest catches a document describing something that
   * does not exist, and nothing else. It cannot catch a *shipped* setting that
   * appears in the Settings UI and is described nowhere — which is how the whole
   * `atlasmind.workflow.*` family, an entire feature's worth of switches
   * including four capability gates, reached 0.208.3 absent from
   * `docs/configuration.md`. Undiscoverable and functioning is the state this
   * repository already calls the worst of the three; a one-way check licensed it.
   */
  it('documents every atlasmind.* setting the manifest declares', () => {
    const undocumented: string[] = [];
    for (const file of ['docs/configuration.md', 'wiki/Configuration.md']) {
      let body: string;
      try {
        body = read(file);
      } catch {
        continue;
      }
      for (const key of declaredSettings()) {
        if (!body.includes(key)) {
          undocumented.push(`${file} ← ${key}`);
        }
      }
    }
    expect(undocumented, 'the manifest declares these settings and no document describes them').toEqual([]);
  });
});

/**
 * A counted claim has to match the count.
 *
 * The wiki's competitor matrix said "31 built-in skills" while the navigation
 * table on the *same page* said 43. Nothing was wrong with either sentence when
 * it was written; the number simply moved and one copy did not. Every check
 * above resolves a *name* — a file, a link, a setting — and a name that goes
 * stale usually breaks loudly. A number goes stale silently and stays plausible,
 * which is why it outlived every other kind of drift here.
 */
describe('a documented count matches the code', () => {
  const skillIndex = read('src/skills/index.ts');
  const builtinCount = (
    skillIndex.slice(skillIndex.indexOf('export function createBuiltinSkills'))
      .split('\n}')[0] ?? ''
  ).match(/withPanelPath\(/g)?.length ?? 0;

  it('found the built-in skills', () => {
    expect(builtinCount).toBeGreaterThan(20);
  });

  it('agrees with every "N built-in skills" claim in the docs', () => {
    const wrong: string[] = [];
    for (const file of [...DOC_FILES, ...WIKI_FILES, ...ROOT_DOCS]) {
      // The changelog is a record of what was true at each release, so a past
      // entry naming an old count is correct and must not be "fixed".
      if (/Changelog\.md$/i.test(file) || file === 'CHANGELOG.md') {
        continue;
      }
      let body: string;
      try {
        body = read(file);
      } catch {
        continue;
      }
      for (const match of body.matchAll(/(\d+)\s+built-in skills/gi)) {
        if (Number(match[1]) !== builtinCount) {
          wrong.push(`${file} → claims ${match[1]}, code has ${builtinCount}`);
        }
      }
    }
    expect(wrong, 'these documents state a built-in skill count the code contradicts').toEqual([]);
  });
});

/**
 * The README's "since the last Marketplace publication" baseline.
 *
 * It said **v0.145.3** while the Marketplace had **v0.208.0** — sixty-three
 * releases stale — so the "What's new" section listed eighty-one bullets of work
 * that was already in the published build. Every other version check here
 * compares two files that both live in this repository; this claim is about the
 * outside world, so nothing local contradicted it and it rotted quietly for
 * months.
 *
 * The newest tag is the offline stand-in for "what is published", because the
 * release routine's last step (`npm run tag:release`) is what triggers the
 * Marketplace publish — a tag and a publish are the same event.
 *
 * **Skipped where tags are absent, deliberately.** `ci.yml` checks out shallow
 * with no tags, so this cannot run there. It does run in the pre-commit hook on
 * a developer machine, which is precisely where the README gets edited and where
 * a stale baseline is introduced. A guard that fires at the moment of the mistake
 * is worth more than one that fires nowhere; do not "fix" the skip by demanding
 * `fetch-depth: 0` on every CI run for a documentation assertion.
 */
describe('the README\'s published-version baseline is not stale', () => {
  function newestTag(): string | undefined {
    try {
      const tags = execFileSync('git', ['tag', '--sort=-v:refname'], { encoding: 'utf8' })
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => /^v\d+\.\d+\.\d+$/.test(line));
      return tags[0]?.slice(1);
    } catch {
      return undefined;
    }
  }

  const stated = /last Marketplace publication, \*\*v([0-9]+\.[0-9]+\.[0-9]+)\*\*/
    .exec(read('README.md'))?.[1];

  it('states a baseline at all', () => {
    expect(stated, 'README no longer names the last published version').toBeTruthy();
  });

  it('names the most recently tagged release', () => {
    const tag = newestTag();
    if (!tag) {
      // Shallow checkout: nothing to compare against. See the note above.
      return;
    }
    expect(stated, `README says v${stated}; the newest tag is v${tag}`).toBe(tag);
  });

  it('never claims a baseline newer than the source version', () => {
    const manifest = JSON.parse(read('package.json')) as { version: string };
    const asNumbers = (value: string) => value.split('.').map(Number);
    const [statedMajor, statedMinor, statedPatch] = asNumbers(stated ?? '0.0.0');
    const [major, minor, patch] = asNumbers(manifest.version);
    const statedRank = statedMajor! * 1e6 + statedMinor! * 1e3 + statedPatch!;
    const sourceRank = major! * 1e6 + minor! * 1e3 + patch!;
    // A baseline ahead of the source would make "what's new" describe nothing,
    // or describe a rollback as a feature.
    expect(statedRank, `baseline v${stated} is ahead of source v${manifest.version}`)
      .toBeLessThanOrEqual(sourceRank);
  });
});

describe('a claim about what git tracks matches what git tracks', () => {
  it('does not say the SSOT is excluded from the repository', () => {
    // Six documents asserted this while ninety tracked files disproved it. The
    // true statement — excluded from the *VSIX* by `.vscodeignore` — is a
    // different claim about a different file.
    const offenders: string[] = [];
    for (const file of [...DOC_FILES, ...WIKI_FILES, 'README.md', 'CONTRIBUTING.md', 'CLAUDE.md']) {
      const body = read(file);
      for (const line of body.split(/\r?\n/)) {
        if (!/project_memory/.test(line)) {
          continue;
        }
        if (/\.vscodeignore|VSIX|package(d|ing)?\b/i.test(line)) {
          continue;
        }
        if (/excluded from (`?main`?|the repo|version control)|not (tracked|committed)|gitignored/i.test(line)) {
          offenders.push(`${file} → ${line.trim().slice(0, 120)}`);
        }
      }
    }
    expect(offenders, 'project_memory/ is tracked and present on main').toEqual([]);
  });

  it('keeps .gitignore in agreement', () => {
    const ignore = read('.gitignore');
    // A bare `project_memory` or `project_memory/` line would make every one of
    // those documents retroactively correct and silently drop the SSOT.
    const lines = ignore.split(/\r?\n/).map(line => line.trim());
    expect(lines).not.toContain('project_memory');
    expect(lines).not.toContain('project_memory/');
  });
});
