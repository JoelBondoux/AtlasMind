import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  UTILITY_CAPABILITIES,
  UTILITY_PACKS,
  UTILITY_PACKS_VERIFIED_AT,
  assessUtilityPack,
  assessUtilityPacks,
  buildUtilityDecisionPrompt,
  offerableUtilityPacks,
  utilityPack,
} from '../../src/core/utilityPacks';

const SOURCE = readFileSync(
  path.join(process.cwd(), 'src', 'core', 'utilityPacks.ts'),
  'utf8',
);

describe('the decision comes before the library', () => {
  it('gives every capability a question with at least two answers', () => {
    expect(UTILITY_PACKS).toHaveLength(UTILITY_CAPABILITIES.length);
    for (const pack of UTILITY_PACKS) {
      expect(pack.decision.question, pack.capability).toMatch(/\?$/);
      expect(pack.decision.why.length, pack.capability).toBeGreaterThan(80);
      expect(pack.decision.options.length, pack.capability).toBeGreaterThanOrEqual(2);
      for (const option of pack.decision.options) {
        expect(option.consequence.length, `${pack.capability}/${option.id}`).toBeGreaterThan(40);
      }
    }
  });

  it('makes every candidate an answer to one of its pack\'s options', () => {
    // A candidate that answers nothing is a package in a list, which is the
    // shape this module exists not to be.
    for (const pack of UTILITY_PACKS) {
      const optionIds = new Set(pack.decision.options.map(option => option.id));
      for (const candidate of pack.candidates) {
        expect(optionIds.has(candidate.answers), `${pack.capability}/${candidate.id}`).toBe(true);
      }
    }
  });

  it('offers at least one candidate per side of every decision it can', () => {
    // A decision whose options are not both represented is a decision the
    // catalogue has quietly made for the reader.
    for (const pack of UTILITY_PACKS) {
      const answered = new Set(pack.candidates.map(candidate => candidate.answers));
      expect(answered.size, pack.capability).toBeGreaterThanOrEqual(
        pack.capability === 'i18n' || pack.capability === 'accessibility' ? 1 : 2,
      );
    }
  });
});

describe('every command is a constant, and nothing runs one', () => {
  it('quotes only plain package installs, with no shell metacharacters', () => {
    for (const pack of UTILITY_PACKS) {
      for (const candidate of pack.candidates) {
        if (candidate.install === undefined) {
          continue;
        }
        expect(candidate.install, candidate.id).toMatch(/^npm (install|i) (--save-dev )?[@a-z0-9./_-]+( [@a-z0-9./_-]+)*$/);
        for (const character of ['&', '|', ';', '`', '$', '>', '<', '\n', '(', ')']) {
          expect(candidate.install.includes(character), `${candidate.id} contains ${character}`).toBe(false);
        }
      }
    }
  });

  it('never composes a command from anything', () => {
    // The rule `websiteFrameworks` and `acpInstaller` hold: a command built
    // from a setting, a fetched page or a model is remote code execution with
    // extra steps. Every one here is a literal in this file.
    const installLines = SOURCE.match(/install: .*/g) ?? [];
    expect(installLines.length).toBeGreaterThan(0);
    for (const line of installLines) {
      expect(line, line).not.toContain('${');
      expect(line, line).toMatch(/^install: '[^']+',$/);
    }
  });

  it('imports nothing that could execute one', () => {
    expect(SOURCE).not.toContain('child_process');
    expect(SOURCE).not.toContain('exec(');
    expect(SOURCE).not.toContain('spawn(');
  });
});

describe('an unverified fact is absent, not guessed', () => {
  it('pins the date every vendor fact was read', () => {
    expect(UTILITY_PACKS_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('gives every candidate a documentation root rather than a rotting deep link', () => {
    for (const pack of UTILITY_PACKS) {
      for (const candidate of pack.candidates) {
        expect(candidate.docs, candidate.id).toMatch(/^https:\/\//);
        // At most one path segment beyond the host: a deep link into a
        // versioned guide is the first thing to 404.
        const segments = new URL(candidate.docs).pathname.split('/').filter(Boolean);
        expect(segments.length, candidate.id).toBeLessThanOrEqual(4);
      }
    }
  });

  it('carries the snapshot date into the prompt, so nothing reads as current', () => {
    const prompt = buildUtilityDecisionPrompt(utilityPack('payments')!);
    expect(prompt).toContain(UTILITY_PACKS_VERIFIED_AT);
    expect(prompt).toContain('needs checking');
  });
});

describe('what leaves the machine is always stated', () => {
  it('says so for every candidate, including the ones where it is nothing', () => {
    // "Add analytics" means "start sending your users' behaviour to a third
    // party", and a catalogue that omits that is selling.
    for (const pack of UTILITY_PACKS) {
      for (const candidate of pack.candidates) {
        expect(candidate.leavesTheMachine.length, candidate.id).toBeGreaterThan(6);
      }
    }
  });

  it('offers a self-hostable answer wherever one exists', () => {
    for (const capability of ['auth', 'analytics', 'i18n', 'accessibility'] as const) {
      const pack = utilityPack(capability)!;
      expect(pack.candidates.some(candidate => candidate.selfHostable), capability).toBe(true);
    }
  });
});

describe('accessibility is not a library', () => {
  it('is the one pack that cannot be installed', () => {
    expect(utilityPack('accessibility')!.installable).toBe(false);
    for (const pack of UTILITY_PACKS) {
      if (pack.capability !== 'accessibility') {
        expect(pack.installable, pack.capability).toBe(true);
      }
    }
  });

  it('states what automated tooling actually catches', () => {
    // The figure matters: a green automated score presented as compliance is
    // the failure this pack exists to prevent.
    const pack = utilityPack('accessibility')!;
    expect(pack.premise).toContain('30–40%');
    expect(pack.premise).toContain('necessary and not sufficient');
  });

  it('is never offered as something to add', () => {
    const assessments = assessUtilityPacks('');
    expect(assessments.find(entry => entry.capability === 'accessibility')!.status).toBe('absent');
    expect(offerableUtilityPacks(assessments)).not.toContain('accessibility');
  });

  it('makes the human half a gate with a name against it', () => {
    const gates = utilityPack('accessibility')!.gates;
    expect(gates.some(gate => gate.statement.includes('screen reader'))).toBe(true);
    expect(gates.some(gate => gate.statement.includes('named person'))).toBe(true);
  });
});

describe('a gate is a statement about the world', () => {
  it('never checks for a file or a directory', () => {
    for (const pack of UTILITY_PACKS) {
      expect(pack.gates.length, pack.capability).toBeGreaterThanOrEqual(3);
      for (const gate of pack.gates) {
        expect(gate.statement, gate.id).not.toMatch(/\bdirectory\b|\bfile exists\b|\.json\b|\.ts\b/);
        expect(gate.why.length, gate.id).toBeGreaterThan(30);
      }
    }
  });
});

describe('detection', () => {
  it('finds a capability the project already declares', () => {
    const assessment = assessUtilityPack(utilityPack('payments')!, '"stripe": "^17.0.0"');
    expect(assessment.status).toBe('present');
    expect(assessment.presentIds).toEqual(['stripe']);
  });

  it('does not match a longer package that merely starts the same way', () => {
    // `stripe` must not match `stripe-mock`, and `matomo` must not match a
    // third-party fork — the reason a bare substring is not good enough.
    expect(assessUtilityPack(utilityPack('payments')!, '"stripe-mock": "1.0.0"').status).toBe('absent');
    expect(assessUtilityPack(utilityPack('analytics')!, '"matomo-tracker-fork": "1.0.0"').status).toBe('absent');
  });

  it('matches a scope prefix as a prefix', () => {
    const assessment = assessUtilityPack(utilityPack('auth')!, '"@clerk/nextjs": "^6.0.0"');
    expect(assessment.presentIds).toEqual(['clerk']);
  });

  it('reports two answers to one question as ambiguous, and proposes nothing', () => {
    // Two auth libraries is a security problem rather than a redundancy: two
    // session models, two logout paths, and one of them forgotten.
    const assessment = assessUtilityPack(
      utilityPack('auth')!,
      '"better-auth": "^1.6.0", "@clerk/nextjs": "^6.0.0"',
    );
    expect(assessment.status).toBe('ambiguous');
    expect(assessment.answeredOptions.sort()).toEqual(['managed', 'self-hosted']);
    expect(assessment.note).toContain('worth resolving rather than adding to');
    expect(offerableUtilityPacks([assessment])).toEqual([]);
  });

  it('does not call two candidates on the same side ambiguous', () => {
    // Both are self-hosted answers. Odd, perhaps, but not the contradiction
    // the ambiguous state exists to report.
    const assessment = assessUtilityPack(
      utilityPack('i18n')!,
      '"i18next": "^25.0.0", "next-intl": "^4.0.0"',
    );
    expect(assessment.status).toBe('present');
  });

  it('reads an empty project as absent rather than as anything else', () => {
    for (const assessment of assessUtilityPacks('')) {
      expect(assessment.status, assessment.capability).toBe('absent');
      expect(assessment.note.length, assessment.capability).toBeGreaterThan(20);
    }
  });

  it('says an absence may be deliberate rather than calling it a gap', () => {
    // Plenty of projects need no payments and no translations. A catalogue
    // that read every absence as a shortfall would be noise within a week.
    const assessment = assessUtilityPack(utilityPack('payments')!, '');
    expect(assessment.note).toContain('may be deliberate');
  });

  it('offers only what is genuinely missing and installable', () => {
    const assessments = assessUtilityPacks('"stripe": "^17.0.0", "resend": "^4.0.0"');
    const offers = offerableUtilityPacks(assessments);
    expect(offers).not.toContain('payments');
    expect(offers).not.toContain('email');
    expect(offers).toContain('auth');
  });
});

describe('the decision prompt', () => {
  it('forbids installing anything', () => {
    const prompt = buildUtilityDecisionPrompt(utilityPack('auth')!);
    expect(prompt).toContain('Do not install anything');
    expect(prompt).toContain('not instructions to execute');
  });

  it('forbids inventing a vendor fact', () => {
    const prompt = buildUtilityDecisionPrompt(utilityPack('analytics')!);
    expect(prompt).toContain('Do not state a price, a package version or a feature you have not been given');
  });

  it('leads with the decision rather than the candidates', () => {
    const prompt = buildUtilityDecisionPrompt(utilityPack('payments')!);
    expect(prompt.indexOf('The decision:')).toBeLessThan(prompt.indexOf('Candidates'));
    expect(prompt).toContain('merchant of record');
  });

  it('states what leaves the machine for every candidate it lists', () => {
    const prompt = buildUtilityDecisionPrompt(utilityPack('analytics')!);
    const mentions = prompt.match(/Leaves the machine:/g) ?? [];
    expect(mentions).toHaveLength(utilityPack('analytics')!.candidates.length);
  });
});

describe('the verified vendor facts', () => {
  it('does not list Lucia, which was deprecated and is now a learning resource', () => {
    // Verified 2026-09-09. Listing it would send somebody to a package whose
    // maintainer has explicitly told them not to depend on it.
    const auth = utilityPack('auth')!;
    expect(auth.candidates.some(candidate => candidate.id.includes('lucia'))).toBe(false);
    expect(SOURCE.toLowerCase()).not.toContain('lucia');
  });

  it('records that Auth.js is now part of Better Auth without inventing a recommendation', () => {
    const authJs = utilityPack('auth')!.candidates.find(candidate => candidate.id === 'auth-js')!;
    expect(authJs.summary).toContain('part of Better Auth');
    // The vendor does not say which new projects should use which, so neither
    // does this.
    expect(authJs.summary).toContain('does not say');
  });

  it('states that transactional email counts toward the bulk-sender threshold', () => {
    const email = utilityPack('email')!;
    expect(email.decision.why).toContain('5,000');
    expect(email.decision.why).toContain('no exemption');
  });

  it('states that Plausible and Umami integrate as a script tag rather than a dependency', () => {
    const analytics = utilityPack('analytics')!;
    const plausible = analytics.candidates.find(candidate => candidate.id === 'plausible')!;
    expect(plausible.summary).toContain('script tag');
    expect(plausible.install).toBeUndefined();
  });

  it('names the EAA date and the standard conformance is presumed through', () => {
    const accessibility = utilityPack('accessibility')!;
    expect(accessibility.decision.why).toContain('28 June 2025');
    expect(accessibility.decision.why).toContain('EN 301 549');
    expect(accessibility.decision.why).toContain('WCAG 2.1 AA');
  });
});
