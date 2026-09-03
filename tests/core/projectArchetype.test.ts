import { describe, expect, it } from 'vitest';
import {
  ARCHETYPE_LABEL,
  ARCHETYPE_TRAITS,
  PROJECT_ARCHETYPES,
  TRAIT_LABEL,
  describeArchetypeAgreement,
  detectProjectArchetype,
  fromBootstrapLabel,
  fromDeliveryArchetype,
  fromTestingArchetype,
  normalizeArchetype,
  normalizeTraits,
} from '../../src/core/projectArchetype.ts';

const detect = (corpus: string, language = 'node', files: string[] = []) =>
  detectProjectArchetype({ corpus, language, files });

describe('detection identifies the shapes that actually differ', () => {
  it('detects a game from an engine or rendering library', () => {
    // The clearest casualty of the old three-vocabulary split: detected, then
    // never acted on, and not selectable at bootstrap at all.
    for (const [corpus, lang] of [
      ['phaser', 'node'], ['three', 'node'], ['pixi.js', 'node'],
      ['bevy', 'rust'], ['pygame', 'python'], ['raylib', 'c'], ['ebiten', 'go'],
    ] as const) {
      expect(detect(corpus, lang).archetype, corpus).toBe('game');
    }
    expect(detectProjectArchetype({ corpus: '', files: ['project.godot'] }).archetype).toBe('game');
  });

  it('detects each remaining shape', () => {
    expect(detect('react-native').archetype).toBe('mobile');
    expect(detect('electron').archetype).toBe('desktop');
    expect(detect('astro').archetype).toBe('website');
    expect(detect('next react').archetype).toBe('web-app');
    expect(detect('"laravel/framework"', 'php').archetype).toBe('web-app');
    expect(detect('express').archetype).toBe('api');
    expect(detect('commander').archetype).toBe('cli');
    expect(detect('fastapi', 'python').archetype).toBe('api');
    expect(detect('clap', 'rust').archetype).toBe('cli');
  });

  it('prefers the more specific shape when signals overlap', () => {
    // React Native contains React. Reporting it as web-app would send every
    // downstream recommendation to the wrong place.
    expect(detect('react-native react').archetype).toBe('mobile');
    // A static site generator also pulls in a UI framework.
    expect(detect('astro react').archetype).toBe('website');
    // Electron apps are usually built with a UI framework too.
    expect(detect('electron react').archetype).toBe('desktop');
  });

  it('gates short Node package names to Node projects', () => {
    // `next` appears inside `cargo-nextest`; matching it in a Rust manifest
    // would classify a Rust CLI as a web application.
    expect(detect('cargo-nextest', 'rust').archetype).not.toBe('web-app');
    expect(detect('three', 'rust').archetype).not.toBe('game');
  });

  it('justifies what it found, because a suggestion has to argue for itself', () => {
    const detection = detect('phaser');
    expect(detection.reasons.length).toBeGreaterThan(0);
    expect(detection.reasons[0]).toContain('phaser');
  });
});

describe('detection distinguishes a finding from a fallback', () => {
  it('is confident when a signal matched', () => {
    expect(detect('express').confident).toBe(true);
  });

  it('is not confident when nothing matched', () => {
    // "This is a generic project" and "we could not tell" are different facts,
    // and only one of them should ever be presented as a finding.
    const detection = detect('');
    expect(detection.archetype).toBe('generic');
    expect(detection.confident).toBe(false);
  });

  it('does not invent `library` from an empty workspace', () => {
    expect(detect('').archetype).toBe('generic');
    // Only when a manifest actually says so — and even then, unconfidently.
    const withManifest = detect('"main": "index.js"');
    expect(withManifest.archetype).toBe('library');
    expect(withManifest.confident).toBe(false);
  });
});

describe('traits compose rather than multiplying the archetype set', () => {
  it('detects traits independently of the archetype', () => {
    const detection = detect('express electron');
    expect(detection.traits).toContain('has-server');
    expect(detection.traits).toContain('has-ui');
  });

  it('detects a platform host without making it an archetype', () => {
    // A Shopify theme is a website that happens to be platform-hosted; giving
    // it its own archetype would multiply the set per platform.
    expect(detect('@shopify/cli').traits).toContain('platform-hosted');
    expect(detectProjectArchetype({ corpus: 'astro', language: 'node', files: ['shopify.app.toml'] }).traits)
      .toContain('platform-hosted');
  });

  it('treats a WooCommerce extension as a library with commerce obligations', () => {
    const detection = detectProjectArchetype({
      corpus: '{"type": "wordpress-plugin", "description": "WooCommerce extension"}',
      language: 'php',
      files: ['composer.json'],
    });
    expect(detection.archetype).toBe('library');
    expect(detection.confident).toBe(true);
    expect(detection.traits).toContain('is-published-package');
    expect(detection.traits).toContain('handles-personal-data');
    expect(detection.traits).not.toContain('platform-hosted');
  });

  it('recognizes generated commerce project manifests conservatively', () => {
    const catalyst = detectProjectArchetype({
      corpus: '{"dependencies":{"@bigcommerce/catalyst-core":"1.0.0"}}',
      language: 'node',
      files: ['package.json'],
    });
    expect(catalyst.archetype).toBe('website');
    expect(catalyst.traits).toEqual(expect.arrayContaining(['platform-hosted', 'has-ui', 'has-server', 'handles-personal-data']));

    const magento = detectProjectArchetype({
      corpus: '{"type": "magento2-module"}',
      language: 'php',
      files: ['composer.json', 'registration.php', 'etc/module.xml'],
    });
    expect(magento.archetype).toBe('library');
    expect(magento.traits).toEqual(expect.arrayContaining(['is-published-package', 'handles-personal-data']));
    expect(magento.traits).not.toContain('platform-hosted');
  });

  it('does not duplicate a trait matched by several signals', () => {
    const detection = detect('electron tauri');
    expect(detection.traits.filter(t => t === 'ships-binaries').length).toBeLessThanOrEqual(1);
  });
});

describe('the vocabularies this module replaces map forward', () => {
  it('maps every old delivery archetype', () => {
    expect(fromDeliveryArchetype('library')).toEqual({ archetype: 'library', traits: ['is-published-package'] });
    expect(fromDeliveryArchetype('generic')).toEqual({ archetype: 'generic', traits: [] });
    // web-service named a *service*; reading it as a browser application would
    // send release and testing advice to the wrong place.
    expect(fromDeliveryArchetype('web-service')?.archetype).toBe('api');
    // A VS Code extension is a library that ships to a marketplace — the
    // clearest case for archetype-plus-trait.
    const ext = fromDeliveryArchetype('vscode-extension');
    expect(ext?.archetype).toBe('library');
    expect(ext?.traits).toContain('platform-hosted');
  });

  it('maps every old testing archetype', () => {
    for (const [old, expected] of [
      ['web', 'web-app'], ['api', 'api'], ['cli', 'cli'],
      ['game', 'game'], ['mobile', 'mobile'], ['library', 'library'], ['generic', 'generic'],
    ] as const) {
      expect(fromTestingArchetype(old), old).toBe(expected);
    }
  });

  it('returns undefined for an unknown value rather than guessing generic', () => {
    // A migration that silently coerced an unrecognised value would lose the
    // fact that it was unrecognised.
    expect(fromDeliveryArchetype('nonsense')).toBeUndefined();
    expect(fromTestingArchetype('nonsense')).toBeUndefined();
    expect(fromBootstrapLabel('something nobody wrote')).toBeUndefined();
    expect(fromBootstrapLabel(undefined)).toBeUndefined();
  });

  it('maps every bootstrap picker label, including the Shopify variants', () => {
    expect(fromBootstrapLabel('Website / Marketing Site')?.archetype).toBe('website');
    expect(fromBootstrapLabel('Web App')?.archetype).toBe('web-app');
    expect(fromBootstrapLabel('API Server')?.archetype).toBe('api');
    expect(fromBootstrapLabel('CLI Tool')?.archetype).toBe('cli');
    expect(fromBootstrapLabel('Library')?.archetype).toBe('library');
    expect(fromBootstrapLabel('Desktop App')?.archetype).toBe('desktop');
    expect(fromBootstrapLabel('Mobile App')?.archetype).toBe('mobile');
    expect(fromBootstrapLabel('Other')?.archetype).toBe('generic');
    expect(fromBootstrapLabel('VS Code Extension')?.archetype).toBe('library');
    expect(fromBootstrapLabel('Shopify Store / Theme')?.archetype).toBe('website');
    expect(fromBootstrapLabel('Shopify App')?.archetype).toBe('web-app');
    expect(fromBootstrapLabel('WooCommerce Extension')).toEqual({
      archetype: 'library',
      traits: ['is-published-package', 'handles-personal-data'],
    });
    expect(fromBootstrapLabel('BigCommerce Catalyst')).toEqual({
      archetype: 'website',
      traits: ['platform-hosted', 'has-ui', 'has-server', 'handles-personal-data'],
    });
    expect(fromBootstrapLabel('Magento 2 Module')).toEqual({
      archetype: 'library',
      traits: ['is-published-package', 'handles-personal-data'],
    });
    expect(fromBootstrapLabel('Wix Commerce')).toEqual({
      archetype: 'website',
      traits: ['platform-hosted', 'has-ui', 'has-server', 'handles-personal-data'],
    });
    for (const label of [
      'Next.js SaaS / Web App',
      'React Router SaaS / Web App',
      'Laravel SaaS / Web App',
      'Django SaaS / Web App',
    ]) {
      expect(fromBootstrapLabel(label), label).toEqual({
        archetype: 'web-app',
        traits: ['has-ui', 'has-server', 'handles-personal-data'],
      });
    }
    expect(fromBootstrapLabel('Static Website')).toEqual({
      archetype: 'website',
      traits: ['has-ui'],
    });
    expect(fromBootstrapLabel('Blog / CMS (Astro Content)')).toEqual({
      archetype: 'website',
      traits: ['has-ui'],
    });
  });

  it('maps a Game label, which the old picker could not express at all', () => {
    expect(fromBootstrapLabel('Game')?.archetype).toBe('game');
  });

  it('tolerates the codicon prefixes the picker uses', () => {
    expect(fromBootstrapLabel('$(store) Shopify New Store')?.archetype).toBe('website');
  });
});

describe('untrusted input defaults to the honest answer', () => {
  it('coerces an unrecognised archetype to generic', () => {
    for (const bad of ['GAME', 'webapp', '', null, undefined, 42, {}]) {
      expect(normalizeArchetype(bad), String(bad)).toBe('generic');
    }
  });

  it('accepts every declared archetype', () => {
    for (const archetype of PROJECT_ARCHETYPES) {
      expect(normalizeArchetype(archetype)).toBe(archetype);
    }
  });

  it('drops unrecognised traits and de-duplicates', () => {
    expect(normalizeTraits(['has-ui', 'nonsense', 'has-ui'])).toEqual(['has-ui']);
    expect(normalizeTraits('not an array')).toEqual([]);
    expect(normalizeTraits(undefined)).toEqual([]);
  });
});

describe('detected and declared are reconciled, not silently merged', () => {
  it('says so when they agree', () => {
    const result = describeArchetypeAgreement(detect('phaser'), 'game');
    expect(result.agrees).toBe(true);
    expect(result.detail).toContain('agree');
  });

  it('reports a disagreement and states that the declaration wins', () => {
    // A project deliberately declared `library` while its manifests look like
    // `web-app` is a decision, not a mistake.
    const result = describeArchetypeAgreement(detect('react next'), 'library');
    expect(result.agrees).toBe(false);
    expect(result.detail).toContain('declared value wins');
  });

  it('does not treat an unconfident detection as a disagreement', () => {
    const result = describeArchetypeAgreement(detect(''), 'library');
    expect(result.agrees).toBe(true);
    expect(result.detail).toContain('did not identify');
  });

  it('prompts for a declaration when there is none', () => {
    expect(describeArchetypeAgreement(detect('phaser'), undefined).agrees).toBe(false);
    expect(describeArchetypeAgreement(detect('phaser'), undefined).detail).toContain('nothing is declared');
  });
});

describe('every archetype and trait is fully described', () => {
  it('labels every archetype', () => {
    for (const archetype of PROJECT_ARCHETYPES) {
      expect(ARCHETYPE_LABEL[archetype]!.length, archetype).toBeGreaterThan(2);
    }
  });

  it('labels every trait', () => {
    for (const trait of ARCHETYPE_TRAITS) {
      expect(TRAIT_LABEL[trait]!.length, trait).toBeGreaterThan(2);
    }
  });

  it('keeps the archetype set small enough to stay maintainable', () => {
    // Each archetype is a promise that something specialises for it. Growth
    // here should be a deliberate decision, not a drift.
    expect(PROJECT_ARCHETYPES.length).toBeLessThanOrEqual(10);
  });
});
