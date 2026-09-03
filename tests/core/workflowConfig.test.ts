import { describe, it, expect } from 'vitest';
import {
  seedWorkflowConfig,
  sanitizeWorkflowConfig,
  applyWorkflowConfigEdit,
  renderWorkflowMarkdown,
  validateWorkflowConfig,
  DEFAULT_BRANCH_TYPES,
  type WorkflowConfig,
} from '../../src/core/workflowConfig';
import { WORKFLOW_STAGE_IDS } from '../../src/core/workflowCurriculum';
import { recommendedVersioningPolicy } from '../../src/core/versioningPolicy';
import { sanitizeProjectComposition, type ProjectComposition } from '../../src/core/projectComposition';

const seeded = (): WorkflowConfig => seedWorkflowConfig({ profile: 'solo' });
const composition = (): ProjectComposition => sanitizeProjectComposition({
  components: [
    {
      id: 'home', label: 'Application', location: '.', role: 'application',
      archetype: { archetype: 'web-app', traits: ['has-ui', 'has-server'] },
      vcs: 'git', home: true,
    },
    {
      id: 'content', label: 'Content', location: 'content', role: 'content',
      archetype: { archetype: 'generic', traits: [] }, vcs: 'perforce',
    },
  ],
})!;

describe('seedWorkflowConfig — a seed grants nothing', () => {
  it('ships every stage disabled and at observe, whatever the profile', () => {
    // A profile changes what a team is asked to attest, never how much
    // AtlasMind may do unattended. Otherwise the deny-by-default guarantee
    // would be in the hands of a dropdown.
    for (const profile of ['solo', 'studio', 'custom'] as const) {
      const config = seedWorkflowConfig({ profile });
      for (const stage of config.stages) {
        expect(stage.enabled, `${profile}/${stage.id}`).toBe(false);
        expect(stage.automationLevel, `${profile}/${stage.id}`).toBe('observe');
      }
    }
  });

  it('covers every stage the curriculum teaches', () => {
    // A stage in the guide with no entry here would be untunable, and a stage
    // here with no guide entry would be undocumented.
    expect(seeded().stages.map(stage => stage.id)).toEqual([...WORKFLOW_STAGE_IDS]);
  });

  it('marks every shipped stage managed, so none can be deleted', () => {
    expect(seeded().stages.every(stage => stage.managed)).toBe(true);
  });

  it('protects the release branch without being asked', () => {
    const config = seedWorkflowConfig({ profile: 'solo', releaseBranch: 'production' });
    expect(config.branches.protected).toContain('production');
  });

  it('asks a studio for a second reviewer and a solo developer for a self-review', () => {
    const studio = seedWorkflowConfig({ profile: 'studio' }).stages.find(s => s.id === 'pull-request');
    const solo = seedWorkflowConfig({ profile: 'solo' }).stages.find(s => s.id === 'pull-request');
    expect(studio?.requiredChecks.some(check => /someone other than the author/i.test(check))).toBe(true);
    expect(solo?.requiredChecks.some(check => /self-reviewed/i.test(check))).toBe(true);
  });

  it('prefers the repository\'s own labels over the generic set', () => {
    const config = seedWorkflowConfig({ profile: 'solo', observedLabels: ['bug', 'area/ui'] });
    expect(config.labels.type).toEqual(['bug', 'area/ui']);
  });

  it('puts observed labels in `type` rather than guessing at their category', () => {
    // Sorting a repository's labels into priority, status and area would be
    // guessing at what they mean, and a taxonomy that guessed wrong is worse
    // than one that stayed honest about not knowing.
    const config = seedWorkflowConfig({ profile: 'solo', observedLabels: ['P1', 'blocked', 'area/ui'] });
    expect(config.labels.priority).toEqual([]);
    expect(config.labels.status).toEqual([]);
    expect(config.labels.area).toEqual([]);
  });

  it('seeds no priority or status scheme of its own', () => {
    // Plenty of projects run without either, and inventing one teaches a
    // vocabulary nobody picked.
    expect(seeded().labels.priority).toEqual([]);
    expect(seeded().labels.status).toEqual([]);
  });

  it('declares that testing requirements are inherited, not duplicated', () => {
    expect(seeded().testing).toEqual({ inherit: true });
  });

  it('refuses a branch name git would reject rather than mangling it', () => {
    const config = seedWorkflowConfig({ profile: 'solo', integrationBranch: 'feat branch~1' });
    expect(config.branches.integration).toBe('develop');
  });
});

describe('sanitizeWorkflowConfig — reads a file a human may have hand-edited', () => {
  it('is total: nothing usable in, undefined out, never a throw', () => {
    expect(sanitizeWorkflowConfig(undefined)).toBeUndefined();
    expect(sanitizeWorkflowConfig(null)).toBeUndefined();
    expect(sanitizeWorkflowConfig([])).toBeUndefined();
    expect(sanitizeWorkflowConfig('a string')).toBeUndefined();
    expect(() => sanitizeWorkflowConfig({ stages: 'not an array' })).not.toThrow();
  });

  it('restores a managed stage somebody deleted, disabled', () => {
    // Deleting a stage by hand is not an error — it just does not work, which
    // is the point. Restoring it disabled is the safe direction: the record is
    // complete and nothing starts happening.
    const config = sanitizeWorkflowConfig({ stages: [{ id: 'planning', enabled: true }] });
    expect(config?.stages.map(stage => stage.id)).toEqual([...WORKFLOW_STAGE_IDS]);
    expect(config?.stages.find(stage => stage.id === 'ci')?.enabled).toBe(false);
  });

  it('keeps the release branch protected even when the file says otherwise', () => {
    const config = sanitizeWorkflowConfig({
      branches: { integration: 'develop', release: 'main', protected: [] },
    });
    expect(config?.branches.protected).toContain('main');
  });

  it('preserves fields written by a newer AtlasMind through a round trip', () => {
    // Otherwise a newer build's settings vanish the first time an older one
    // saves — silently, since nothing would report the loss.
    const config = sanitizeWorkflowConfig({ version: 1, futureField: { a: 1 } });
    expect(config?.extra).toEqual({ futureField: { a: 1 } });
  });

  it('preserves an own __proto__ field as inert data', () => {
    const raw = JSON.parse('{"version":1,"extra":{"__proto__":{"polluted":true}}}') as unknown;
    const config = sanitizeWorkflowConfig(raw)!;
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(Object.prototype.hasOwnProperty.call(config.extra, '__proto__')).toBe(true);
    expect(config.extra?.['__proto__']).toEqual({ polluted: true });
  });

  it('drops an unrecognised stage id rather than inventing a stage', () => {
    const config = sanitizeWorkflowConfig({ stages: [{ id: 'not-a-stage', enabled: true }] });
    expect(config?.stages.some(stage => (stage.id as string) === 'not-a-stage')).toBe(false);
  });

  it('reads an unrecognised automation level as off, never as consent', () => {
    const config = sanitizeWorkflowConfig({ stages: [{ id: 'ci', automationLevel: 'AUTO!' }] });
    expect(config?.stages.find(stage => stage.id === 'ci')?.automationLevel).toBe('off');
  });

  it('strips control characters out of anything it will render', () => {
    const config = sanitizeWorkflowConfig({
      stages: [{ id: 'ci', requiredChecks: ['build\\u0000green\\u001b[31m'] }],
    });
    const check = config?.stages.find(stage => stage.id === 'ci')?.requiredChecks[0] ?? '';
    expect(/[\u0000-\u001f]/u.test(check)).toBe(false);
  });

  it('clamps the name length rather than refusing the config over it', () => {
    const config = sanitizeWorkflowConfig({ naming: { maxLength: 9999 } });
    expect(config?.naming.maxLength).toBe(120);
    expect(sanitizeWorkflowConfig({ naming: { maxLength: 1 } })?.naming.maxLength).toBe(20);
  });

  it('round-trips a seeded config unchanged', () => {
    const config = seeded();
    expect(sanitizeWorkflowConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
  });

  it('round-trips a valid composition in its declared workflow field', () => {
    const config = { ...seeded(), composition: composition() };
    const round = sanitizeWorkflowConfig(JSON.parse(JSON.stringify(config)));
    expect(round?.composition).toEqual(config.composition);
    expect(round?.extra?.['composition']).toBeUndefined();
  });

  it('restores a composition preserved by an older build under extra', () => {
    const round = sanitizeWorkflowConfig({ ...seeded(), extra: { composition: composition() } });
    expect(round?.composition).toEqual(composition());
    expect(round?.extra?.['composition']).toBeUndefined();
  });

  it('preserves an invalid composition opaquely instead of partially activating or losing it', () => {
    const invalid = { components: [{ id: 'half-a-component' }], futureShape: true };
    const round = sanitizeWorkflowConfig({ ...seeded(), composition: invalid });
    expect(round?.composition).toBeUndefined();
    expect(round?.extra?.['composition']).toEqual(invalid);
  });
});

describe('applyWorkflowConfigEdit', () => {
  it('reports every change, so the diff and the dialog agree', () => {
    const result = applyWorkflowConfigEdit(seeded(), {
      stages: [{ id: 'ci', enabled: true }],
    });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatch(/enabled/);
    expect(result.config.stages.find(stage => stage.id === 'ci')?.enabled).toBe(true);
  });

  it('says nothing changed when nothing changed', () => {
    const config = seeded();
    const result = applyWorkflowConfigEdit(config, { stages: [{ id: 'ci', enabled: false }] });
    expect(result.changes).toEqual([]);
  });

  it('reports a refusal rather than silently doing nothing', () => {
    const result = applyWorkflowConfigEdit(seeded(), { integrationBranch: 'bad~name' });
    expect(result.refused).toHaveLength(1);
    expect(result.changes).toEqual([]);
  });

  it('refuses to point the integration branch at a protected branch', () => {
    // Feature work merges into it constantly; aiming it at a protected branch
    // either breaks every merge or erodes the protection.
    const result = applyWorkflowConfigEdit(seeded(), { integrationBranch: 'main' });
    expect(result.refused[0]).toMatch(/protected/);
    expect(result.config.branches.integration).toBe('develop');
  });

  it('protects a new release branch automatically', () => {
    const result = applyWorkflowConfigEdit(seeded(), { releaseBranch: 'production' });
    expect(result.config.branches.protected).toContain('production');
  });

  it('never rewrites stages when the profile changes', () => {
    // Profiles seed, they do not govern. A team that customised its workflow
    // and then changed a dropdown must not lose that work.
    const customised = applyWorkflowConfigEdit(seeded(), {
      stages: [{ id: 'ci', enabled: true, requiredChecks: ['Read the log'] }],
    }).config;
    const switched = applyWorkflowConfigEdit(customised, { profile: 'studio' });
    expect(switched.config.stages).toEqual(customised.stages);
    expect(switched.changes[0]).toMatch(/left unchanged/);
  });

  it('says the ceiling still applies whenever a level is raised', () => {
    // The number people remember is the one they typed; the one that applies is
    // the minimum of four.
    const result = applyWorkflowConfigEdit(seeded(), {
      stages: [{ id: 'ci', automationLevel: 'auto' }],
    });
    expect(result.changes[0]).toMatch(/settings still cap/);
  });

  it('cannot delete a stage — there is no edit that does', () => {
    const result = applyWorkflowConfigEdit(seeded(), { stages: [{ id: 'ci', enabled: false }] });
    expect(result.config.stages).toHaveLength(WORKFLOW_STAGE_IDS.length);
  });

  it('refuses an empty branch-type list rather than accepting an unusable one', () => {
    const result = applyWorkflowConfigEdit(seeded(), { branchTypes: [] });
    expect(result.refused[0]).toMatch(/at least one type/);
    expect(result.config.naming.types).toEqual(DEFAULT_BRANCH_TYPES);
  });

  it('does not mutate the config it was given', () => {
    const config = seeded();
    const before = JSON.stringify(config);
    applyWorkflowConfigEdit(config, { stages: [{ id: 'ci', enabled: true, blockers: ['x'] }] });
    expect(JSON.stringify(config)).toBe(before);
  });
});

describe('renderWorkflowMarkdown', () => {
  it('is deterministic — the same config produces identical markdown', () => {
    const config = seeded();
    expect(renderWorkflowMarkdown(config)).toBe(renderWorkflowMarkdown(config));
  });

  it('lists every stage', () => {
    const markdown = renderWorkflowMarkdown(seeded());
    for (const stage of seeded().stages) {
      expect(markdown, stage.id).toContain(stage.name);
    }
  });

  it('says the file cannot raise a ceiling', () => {
    // The mirror is what someone reads in a pull request, so the limit belongs
    // in it rather than only on the dashboard the reviewer is not looking at.
    expect(renderWorkflowMarkdown(seeded())).toMatch(/cannot raise your automation ceiling/);
  });

  it('warns that it is generated', () => {
    expect(renderWorkflowMarkdown(seeded())).toMatch(/regenerated and hand edits are lost/);
  });

  it('publishes the declared component scope without inventing topology', () => {
    const markdown = renderWorkflowMarkdown({ ...seeded(), composition: composition() });
    expect(markdown).toContain('| Application | `application` | `.` | `web-app` | `git` | yes |');
    expect(markdown).toContain('| Content | `content` | `content` | `generic` | `perforce` | no |');
    expect(markdown).not.toMatch(/multi-root|hybrid topology/i);
  });

  it('states the legacy first-root boundary when composition is absent', () => {
    expect(renderWorkflowMarkdown(seeded())).toContain('existing first-workspace-root behaviour applies');
  });
});

describe('the seed never invents a value it cannot know', () => {
  it('seeds no required status checks', () => {
    // A required status check names a *specific* CI context. AtlasMind does not
    // know what a project calls its workflows, and a guessed name either blocks
    // forever (nothing reports it) or is decorative (nothing enforces it) —
    // indistinguishable to whoever inherits the file.
    for (const stage of seeded().stages) {
      expect(stage.requiredStatusChecks, stage.id).toEqual([]);
    }
  });

  it('seeds attestations, which are statements a person makes rather than names of things', () => {
    // The distinction that justifies the asymmetry: an attestation is true
    // whatever the repository is called.
    const planning = seeded().stages.find(stage => stage.id === 'planning');
    expect(planning?.requiredChecks.length).toBeGreaterThan(0);
  });
});

describe('the integration branch is never in the protected set', () => {
  it('excludes it from a seed, even when it is a well-known protected name', () => {
    // `develop` is both the commonest integration branch there is and a member
    // of PROTECTED_BRANCH_NAMES. Listing it produces a config that contradicts
    // itself: a seed whose own integration branch the editor then refuses.
    const config = seedWorkflowConfig({ profile: 'solo', integrationBranch: 'develop' });
    expect(config.branches.protected).not.toContain('develop');
    expect(config.branches.protected).toContain('main');
  });

  it('produces a seed the editor will accept unchanged', () => {
    // The property that failing this test would break: seed then re-set the
    // same integration branch, and it must not be refused.
    const config = seedWorkflowConfig({ profile: 'solo', integrationBranch: 'develop' });
    const result = applyWorkflowConfigEdit(config, { integrationBranch: 'develop' });
    expect(result.refused).toEqual([]);
  });

  it('drops it when a hand-edited file lists it', () => {
    const config = sanitizeWorkflowConfig({
      branches: { integration: 'trunk', release: 'main', protected: ['trunk', 'main'] },
    });
    expect(config?.branches.protected).toEqual(['main']);
  });

  it('does not re-add it when the release branch changes', () => {
    const config = seedWorkflowConfig({ profile: 'solo', integrationBranch: 'develop' });
    const result = applyWorkflowConfigEdit(config, { releaseBranch: 'production' });
    expect(result.config.branches.protected).toContain('production');
    expect(result.config.branches.protected).not.toContain('develop');
  });
});

describe('workflow config — versioning policy', () => {
  const declared = recommendedVersioningPolicy({ integrationBranch: 'develop', releaseBranch: 'main' });

  it('is not seeded, because a project must not acquire a scheme nobody chose', () => {
    // `versioningPolicy` rule 3, enforced at the one place it could be broken by
    // convenience: seeding a sensible default here would mean every project ever
    // opened is graded against SemVer whether or not anyone agreed to it.
    expect(seeded().versioning).toBeUndefined();
  });

  it('survives a round trip through the sanitizer', () => {
    const config = { ...seeded(), versioning: declared };
    const round = sanitizeWorkflowConfig(JSON.parse(JSON.stringify(config)));
    expect(round?.versioning).toEqual(declared);
  });

  it('leaves the field absent when the file does not carry one', () => {
    const round = sanitizeWorkflowConfig(JSON.parse(JSON.stringify(seeded())));
    expect(round).toBeDefined();
    expect('versioning' in round!).toBe(false);
  });

  it('drops an unusable policy rather than the whole document', () => {
    const round = sanitizeWorkflowConfig({ ...JSON.parse(JSON.stringify(seeded())), versioning: { scheme: 'lunar' } });
    expect(round).toBeDefined();
    expect(round?.versioning).toBeUndefined();
    expect(round?.stages.length).toBe(WORKFLOW_STAGE_IDS.length);
  });

  it('does not sweep a known key into `extra`', () => {
    // `versioning` must be in the known-key set, or an older build would file it
    // under `extra` and a newer one would then read two copies of it.
    const round = sanitizeWorkflowConfig({ ...JSON.parse(JSON.stringify(seeded())), versioning: declared });
    expect(round?.extra?.['versioning']).toBeUndefined();
  });

  it('publishes the policy in the markdown mirror', () => {
    const markdown = renderWorkflowMarkdown({ ...seeded(), versioning: declared });
    expect(markdown).toContain('**Versioning:**');
    expect(markdown).toContain('| Channel | Branch | Produces | Publishes to |');
    expect(markdown).toContain('Release candidate');
    expect(markdown).toContain('pre-releases');
  });

  it('says so in the mirror when no policy is declared', () => {
    // Rendering nothing would make an undeclared policy indistinguishable from
    // an empty one, and only one of those is a decision worth reading.
    expect(renderWorkflowMarkdown(seeded())).toContain('not declared');
  });

  it('reports a channel naming a branch this repository does not have', () => {
    const problems = validateWorkflowConfig({ ...seeded(), versioning: declared }, { knownBranches: ['main'] });
    expect(problems.some(problem => problem.detail.includes('develop'))).toBe(true);
  });

  it('says nothing about versioning when no policy is declared', () => {
    const problems = validateWorkflowConfig(seeded(), { knownBranches: ['main'] });
    expect(problems.some(problem => problem.detail.toLowerCase().includes('channel'))).toBe(false);
  });
});
