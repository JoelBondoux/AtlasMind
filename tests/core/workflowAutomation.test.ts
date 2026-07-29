import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_LEVELS,
  FIRST_WRITING_LEVEL,
  HARD_CEILING_REASONS,
  effectiveAutomationLevel,
  explainAutomationLevel,
  normalizeAutomationLevel,
  permits,
  resolveRestrictiveFlag,
  resolveRestrictiveLevel,
  permitsProtectedRefWrite,
  type AutomationInputs,
  type AutomationLevel,
} from '../../src/core/workflowAutomation.ts';

/** Everything open. Each test closes exactly one gate, so the cause is unambiguous. */
const OPEN: AutomationInputs = {
  masterEnabled: true,
  userCeiling: 'auto',
  capabilityEnabled: true,
  stageLevel: 'auto',
};

describe('the shipped default denies', () => {
  it('is off when the master switch is off, whatever else says', () => {
    // The single control a user needs in order to be certain.
    expect(effectiveAutomationLevel({ ...OPEN, masterEnabled: false })).toBe('off');
  });

  it('names the master switch first, because flipping it explains every other refusal', () => {
    const decision = explainAutomationLevel({
      masterEnabled: false, userCeiling: 'off', capabilityEnabled: false, stageLevel: 'off',
    });
    expect(decision.limitedBy).toBe('master');
    expect(decision.detail).toContain('atlasmind.workflow.enabled');
  });
});

describe('effective level is the minimum of four independent gates', () => {
  it('is capped by the user ceiling', () => {
    expect(effectiveAutomationLevel({ ...OPEN, userCeiling: 'draft' })).toBe('draft');
  });

  it('is capped by the stage level', () => {
    expect(effectiveAutomationLevel({ ...OPEN, stageLevel: 'observe' })).toBe('observe');
  });

  it('is capped by the capability switch', () => {
    expect(effectiveAutomationLevel({ ...OPEN, capabilityEnabled: false })).toBe('draft');
  });

  it('takes the lowest when several gates bind', () => {
    expect(effectiveAutomationLevel({
      ...OPEN, userCeiling: 'propose', stageLevel: 'observe', capabilityEnabled: false,
    })).toBe('observe');
  });

  it('lets personal settings lower but never raise', () => {
    // A repository cannot force unattended action onto somebody's machine, and a
    // developer cannot grant themselves more than the repository allows.
    expect(effectiveAutomationLevel({ ...OPEN, stageLevel: 'observe', userCeiling: 'auto' })).toBe('observe');
    expect(effectiveAutomationLevel({ ...OPEN, stageLevel: 'auto', userCeiling: 'observe' })).toBe('observe');
  });

  it('reaches auto only when every gate permits it', () => {
    expect(effectiveAutomationLevel(OPEN)).toBe('auto');
    for (const closed of [
      { masterEnabled: false },
      { userCeiling: 'propose' as AutomationLevel },
      { capabilityEnabled: false },
      { stageLevel: 'propose' as AutomationLevel },
    ]) {
      expect(effectiveAutomationLevel({ ...OPEN, ...closed })).not.toBe('auto');
    }
  });
});

describe('a disabled capability caps at draft rather than silencing the stage', () => {
  it('still permits preparing an artifact', () => {
    // Turning off "may write" should stop the writing, not stop AtlasMind
    // explaining and preparing.
    const level = effectiveAutomationLevel({ ...OPEN, capabilityEnabled: false });
    expect(permits(level, 'draft')).toBe(true);
    expect(permits(level, 'propose')).toBe(false);
  });

  it('lands exactly at the rung where writing begins', () => {
    expect(FIRST_WRITING_LEVEL).toBe('propose');
    expect(effectiveAutomationLevel({ ...OPEN, capabilityEnabled: false })).toBe('draft');
  });

  it('names the capability switch so the user knows which one to change', () => {
    const decision = explainAutomationLevel({ ...OPEN, capabilityEnabled: false });
    expect(decision.limitedBy).toBe('capability');
    expect(decision.detail).toContain('allow*Writes');
  });
});

describe('explanations point at the simplest available fix', () => {
  it('names the ceiling when the user is the one holding it back', () => {
    const decision = explainAutomationLevel({ ...OPEN, userCeiling: 'observe' });
    expect(decision.limitedBy).toBe('ceiling');
    expect(decision.detail).toContain('maxAutomationLevel');
  });

  it('reports no binding gate when the stage itself is the limit', () => {
    // Nothing is "wrong" — the project simply declared this level.
    const decision = explainAutomationLevel({ ...OPEN, stageLevel: 'draft' });
    expect(decision.limitedBy).toBe('none');
    expect(decision.detail).toContain("workflow configuration");
  });
});

describe('untrusted input defaults closed', () => {
  it('reads an unrecognised level as off, never as permission', () => {
    // A settings file with a typo must not be read as consent.
    for (const bad of ['AUTO', 'yes', '', 'full', null, undefined, 42, {}]) {
      expect(normalizeAutomationLevel(bad), String(bad)).toBe('off');
    }
  });

  it('accepts every declared level', () => {
    for (const level of AUTOMATION_LEVELS) {
      expect(normalizeAutomationLevel(level)).toBe(level);
    }
  });

  it('treats a malformed stage level as off rather than as the caller intended', () => {
    expect(effectiveAutomationLevel({ ...OPEN, stageLevel: 'ludicrous' as AutomationLevel })).toBe('off');
  });
});

describe('a person can always be more cautious than their team', () => {
  it('takes the lowest level defined in any scope, not the resolved one', () => {
    // VS Code resolves workspace above user, which is right for a preference
    // and wrong for a safety ceiling. Read that way, a repository committing
    // `auto` would raise the ceiling of everyone who opened it.
    expect(resolveRestrictiveLevel({ workspaceValue: 'auto', globalValue: 'observe' })).toBe('observe');
    expect(resolveRestrictiveLevel({ workspaceValue: 'observe', globalValue: 'auto' })).toBe('observe');
  });

  it('inherits the team value when the person expressed no preference', () => {
    // Unset is not the same as set-to-restrictive: somebody with no opinion
    // should get the team's, or a team setting would never do anything.
    expect(resolveRestrictiveLevel({ workspaceValue: 'propose' })).toBe('propose');
    expect(resolveRestrictiveLevel({ globalValue: 'draft' })).toBe('draft');
  });

  it('falls back to deny-by-default when no scope set anything', () => {
    expect(resolveRestrictiveLevel({})).toBe('observe');
    expect(resolveRestrictiveLevel({}, 'off')).toBe('off');
  });

  it('honours a folder override in a multi-root workspace', () => {
    expect(resolveRestrictiveLevel({
      workspaceValue: 'auto', globalValue: 'auto', workspaceFolderValue: 'draft',
    })).toBe('draft');
  });

  it('reads an unrecognised value as off rather than as permission', () => {
    expect(resolveRestrictiveLevel({ workspaceValue: 'ludicrous' })).toBe('off');
  });

  it('applies the same direction to capability switches', () => {
    // `false` is the cautious value, so any scope saying false wins — a team
    // can grant a capability and an individual can still decline it.
    expect(resolveRestrictiveFlag({ workspaceValue: true, globalValue: false })).toBe(false);
    expect(resolveRestrictiveFlag({ workspaceValue: false, globalValue: true })).toBe(false);
    expect(resolveRestrictiveFlag({ workspaceValue: true })).toBe(true);
    expect(resolveRestrictiveFlag({})).toBe(false);
    expect(resolveRestrictiveFlag({}, true)).toBe(true);
  });

  it('accepts a VS Code inspect() result directly', () => {
    // The field names match on purpose: an adapter would be one more place the
    // mapping could be got wrong.
    const inspectResult = {
      key: 'atlasmind.workflow.maxAutomationLevel',
      defaultValue: 'observe',
      globalValue: 'draft',
      workspaceValue: 'auto',
    };
    expect(resolveRestrictiveLevel(inspectResult)).toBe('draft');
  });

  it('ignores defaultValue, which is not a scope anybody chose', () => {
    // `defaultValue` is always present in an inspect result. Treating it as a
    // scope would clamp every setting to its default and make team values inert.
    expect(resolveRestrictiveLevel({ defaultValue: 'observe', workspaceValue: 'auto' } as never)).toBe('auto');
  });
});

describe('permits', () => {
  it('is inclusive at the required rung', () => {
    expect(permits('propose', 'propose')).toBe(true);
    expect(permits('auto', 'propose')).toBe(true);
    expect(permits('draft', 'propose')).toBe(false);
  });

  it('lets nothing through at off', () => {
    for (const required of AUTOMATION_LEVELS.filter(l => l !== 'off')) {
      expect(permits('off', required), required).toBe(false);
    }
  });
});

describe('protected references are a veto on the target, not a cap on the level', () => {
  it('allows an unprotected target regardless of the setting', () => {
    expect(permitsProtectedRefWrite({ targetIsProtected: false, allowProtectedRefWrites: false }).allowed).toBe(true);
  });

  it('refuses a protected target until explicitly allowed', () => {
    const refused = permitsProtectedRefWrite({ targetIsProtected: true, allowProtectedRefWrites: false });
    expect(refused.allowed).toBe(false);
    expect(refused.detail).toContain('allowProtectedRefWrites');
  });

  it('allows a protected target once explicitly allowed', () => {
    expect(permitsProtectedRefWrite({ targetIsProtected: true, allowProtectedRefWrites: true }).allowed).toBe(true);
  });

  it('explains rather than pointing at a level the user could raise in vain', () => {
    const refused = permitsProtectedRefWrite({ targetIsProtected: true, allowProtectedRefWrites: false });
    expect(refused.detail).toContain('reviewed pull request');
    expect(refused.detail).not.toContain('maxAutomationLevel');
  });
});

describe('hard ceilings', () => {
  it('gives every ceiling a reason a user can understand', () => {
    for (const [ceiling, reason] of Object.entries(HARD_CEILING_REASONS)) {
      expect(reason.length, ceiling).toBeGreaterThan(40);
      // These are not settings. The text must not imply one would help.
      expect(reason, ceiling).not.toContain('atlasmind.workflow.');
    }
  });

  it('covers every action the specification excludes at all levels', () => {
    expect(Object.keys(HARD_CEILING_REASONS).sort()).toEqual([
      'delete-release', 'delete-tag', 'edit-ci-workflow', 'edit-workflow-config',
      'force-push', 'merge-dependency-update', 'rerun-ci',
    ]);
  });
});

describe('the lattice is exhaustively closed', () => {
  it('never exceeds any single gate, across every combination', () => {
    // The property the whole module exists to guarantee, checked by enumeration
    // rather than by argument.
    for (const masterEnabled of [true, false]) {
      for (const userCeiling of AUTOMATION_LEVELS) {
        for (const capabilityEnabled of [true, false]) {
          for (const stageLevel of AUTOMATION_LEVELS) {
            const inputs = { masterEnabled, userCeiling, capabilityEnabled, stageLevel };
            const level = effectiveAutomationLevel(inputs);
            const idx = (l: AutomationLevel) => AUTOMATION_LEVELS.indexOf(l);

            if (!masterEnabled) {
              expect(level, JSON.stringify(inputs)).toBe('off');
              continue;
            }
            expect(idx(level), JSON.stringify(inputs)).toBeLessThanOrEqual(idx(userCeiling));
            expect(idx(level), JSON.stringify(inputs)).toBeLessThanOrEqual(idx(stageLevel));
            if (!capabilityEnabled) {
              expect(permits(level, 'propose'), JSON.stringify(inputs)).toBe(false);
            }
          }
        }
      }
    }
  });
});
