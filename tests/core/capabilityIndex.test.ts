import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildCapabilityIndex,
  CAPABILITY_PAGES,
  DEFAULT_CAPABILITY_INDEX_CHARS,
  findCapabilityPages,
  selectIndexedSettings,
  buildSettingsNamespaceSummary,
} from '../../src/core/capabilityIndex.ts';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

/** The id arrays the panels actually navigate by, read out of their own sources. */
const declaredIds = (source: string, name: string): string[] => {
  const match = new RegExp(`${name} = \\[([^\\]]+)\\]`).exec(source);
  return (match?.[1]?.match(/'([^']+)'/g) ?? []).map(quoted => quoted.slice(1, -1));
};

describe('the capability index is pinned to the panels that own the ids', () => {
  // The catalogue is declared in `src/core` rather than imported, because core
  // must not depend on views. A second copy is exactly how the slash-command
  // list once came to describe commands the panel had never heard of, and the
  // failure mode here is worse: the model confidently names a page nothing can
  // open. These assertions are what make the copy safe.
  it('matches SETTINGS_PAGE_IDS in both directions', () => {
    const declared = declaredIds(readSource('../../src/views/settingsPanel.ts'), 'SETTINGS_PAGE_IDS');
    const indexed = CAPABILITY_PAGES.filter(page => page.surface === 'settings').map(page => page.id);

    expect(declared.length).toBeGreaterThan(0);
    expect([...indexed].sort()).toEqual([...declared].sort());
  });

  it('matches DASHBOARD_PAGE_IDS in both directions', () => {
    const declared = declaredIds(readSource('../../src/views/projectDashboardPanel.ts'), 'DASHBOARD_PAGE_IDS');
    const indexed = CAPABILITY_PAGES.filter(page => page.surface === 'dashboard').map(page => page.id);

    expect(declared.length).toBeGreaterThan(0);
    expect([...indexed].sort()).toEqual([...declared].sort());
  });

  it('says what each page answers, in the words somebody would ask', () => {
    // "Where do I turn off automatic research scans?" has to match on the
    // question. A list of widget names would be larger and match nothing.
    for (const page of CAPABILITY_PAGES) {
      expect(page.answers.length, page.id).toBeGreaterThan(10);
      expect(page.title, page.id).not.toBe('');
    }
  });
});

describe('buildCapabilityIndex', () => {
  const manifest = JSON.parse(readSource('../../package.json'));
  const settings = manifest.contributes.configuration.properties;
  const commands = manifest.contributes.commands;

  it('names every page with the id the panel navigates by', () => {
    const { text } = buildCapabilityIndex({ maxChars: 100_000 });
    for (const page of CAPABILITY_PAGES) {
      expect(text).toContain(`${page.surface}:${page.id}`);
    }
  });

  it('never lets the model report a missing setting as non-existent', () => {
    // The rule that matters most. A model handed a page list treats the list as
    // the whole product and answers "there is no such setting" about the ones it
    // was not shown — which is worse than the recall it replaced, because it
    // sounds checked.
    const { text } = buildCapabilityIndex({ settings, commands });
    expect(text).toMatch(/never tell the operator a setting or page does not exist/i);
    expect(text).toMatch(/abbreviated/i);
  });

  it('states the real total beside the abbreviated list', () => {
    const { text, omitted } = buildCapabilityIndex({ settings, maxChars: 100_000 });
    expect(text).toContain(`${Object.keys(settings).length} exist in total`);
    expect(omitted.settings).toBeGreaterThan(0);
  });

  it('stays inside its budget and reports what it dropped', () => {
    const { text, omitted } = buildCapabilityIndex({ settings, commands, maxChars: 2500 });
    expect(text.length).toBeLessThanOrEqual(2500);
    expect(omitted.commands).toBeGreaterThan(0);
  });

  it('drops commands before pages when the budget bites', () => {
    // A page id the operator can be sent to is worth more than a command name
    // they would have to find anyway. Checked at the real default with the real
    // manifest, which is the budget that actually bites: the page list alone is
    // most of it.
    const { text, omitted } = buildCapabilityIndex({ settings, commands });
    expect(omitted.commands).toBeGreaterThan(0);
    expect(text).toContain('dashboard:debt');
    expect(text).toContain('settings:overview');
  });

  it('fits the default budget with the real manifest', () => {
    const { text } = buildCapabilityIndex({ settings, commands });
    expect(text.length).toBeLessThanOrEqual(DEFAULT_CAPABILITY_INDEX_CHARS);
    expect(text).toContain('settings:safety');
  });

  it('works with no manifest at all', () => {
    const { text } = buildCapabilityIndex();
    expect(text).toContain('dashboard:overview');
  });
});

describe('selectIndexedSettings', () => {
  it('takes the first line of a description, clamped', () => {
    const selected = selectIndexedSettings({
      'atlasmind.example': { description: `${'x'.repeat(400)}\nsecond line` },
    });
    expect(selected[0]!.description.length).toBeLessThanOrEqual(140);
    expect(selected[0]!.description).not.toContain('second line');
  });

  it('returns nothing when there is nothing to read', () => {
    expect(selectIndexedSettings(undefined)).toEqual([]);
  });
});

describe('findCapabilityPages', () => {
  it('prefers an exact id over a keyword hit', () => {
    // An exact id is a statement; a keyword hit is a guess.
    expect(findCapabilityPages('debt').map(page => page.id)).toEqual(['debt']);
    expect(findCapabilityPages('dashboard:testing')).toEqual([
      expect.objectContaining({ surface: 'dashboard', id: 'testing' }),
    ]);
  });

  it('finds a page from the question somebody would ask', () => {
    expect(findCapabilityPages('approval mode').map(page => page.id)).toContain('safety');
    expect(findCapabilityPages('deferred work').map(page => page.id)).toContain('debt');
  });

  it('returns every candidate rather than choosing between them', () => {
    // Two pages share the id `testing` across the two surfaces. Offering both is
    // honest; silently picking one is not.
    expect(findCapabilityPages('testing').length).toBeGreaterThan(1);
  });

  it('returns nothing rather than guessing from one letter', () => {
    expect(findCapabilityPages('a')).toEqual([]);
    expect(findCapabilityPages('   ')).toEqual([]);
  });
});

describe('the settings vocabulary survives the budget', () => {
  const manifest = JSON.parse(readSource('../../package.json'));
  const settings = manifest.contributes.configuration.properties;
  const commands = manifest.contributes.commands;

  // Measured before this existed: `omitted.settings: 134` — every key dropped,
  // because 35 pages consumed the whole 4000-character budget. A model asked
  // where a setting lived therefore had a page list, no key vocabulary at all,
  // and an instruction that only forbade saying a setting did not exist. It
  // invented a file path, a flag, and an environment variable.
  it('names the settings areas at the real default budget', () => {
    const { text } = buildCapabilityIndex({ settings, commands });
    expect(text).toMatch(/Settings: \d+ keys/);
    expect(text).toContain('research');
    expect(text).toContain('buzz');
  });

  it('survives a budget far too small for anything else', () => {
    // Reserved, like the closing instruction: it is the half that was being
    // silently lost, so it must not be the first thing a cap removes.
    const { text } = buildCapabilityIndex({ settings, commands, maxChars: 1200 });
    expect(text).toMatch(/Settings: \d+ keys/);
    expect(text).toMatch(/atlasmind-settings/);
  });

  it('does not name a key, because a key named from memory is the guess that caused this', () => {
    const { text } = buildCapabilityIndex({ settings, commands });
    expect(text).toMatch(/exact key is NOT listed/i);
  });

  it('forbids inventing a location, not merely denying existence', () => {
    const { text } = buildCapabilityIndex({ settings, commands });
    expect(text).toMatch(/never invent where one lives/i);
    expect(text).toMatch(/file path or an environment variable/i);
  });

  it('says nothing about settings when there are none to describe', () => {
    expect(buildSettingsNamespaceSummary(undefined)).toBeUndefined();
    expect(buildSettingsNamespaceSummary({})).toBeUndefined();
  });

  it('groups a top-level key without inventing an area for it', () => {
    const summary = buildSettingsNamespaceSummary({
      'atlasmind.budgetMode': {}, 'atlasmind.research.enabled': {},
    });
    expect(summary).toContain('general');
    expect(summary).toContain('research');
  });
});
