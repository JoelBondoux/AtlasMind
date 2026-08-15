import { describe, expect, it } from 'vitest';

import { validateSettingValue } from '../../src/skills/atlasmindSettings.ts';
import { classifyToolInvocation, requiresToolApproval } from '../../src/core/toolPolicy.ts';

describe('validateSettingValue', () => {
  // Checked here rather than left to VS Code, so the refusal can name the
  // permitted values instead of failing silently at the write.
  it('accepts a declared enum value and names the alternatives for anything else', () => {
    const declared = { type: 'string', enum: ['always-ask', 'ask-on-write', 'ask-on-external'] };
    expect(validateSettingValue(declared, 'ask-on-write')).toBeUndefined();
    expect(validateSettingValue(declared, 'ask-on-everything')).toContain('always-ask');
  });

  it('holds the declared type', () => {
    expect(validateSettingValue({ type: 'boolean' }, true)).toBeUndefined();
    expect(validateSettingValue({ type: 'boolean' }, 'true')).toContain('boolean');
    expect(validateSettingValue({ type: 'number' }, 4)).toBeUndefined();
    expect(validateSettingValue({ type: 'integer' }, 4.5)).toContain('integer');
    expect(validateSettingValue({ type: 'array' }, ['a'])).toBeUndefined();
    expect(validateSettingValue({ type: 'array' }, 'a')).toContain('array');
  });

  it('accepts anything when the manifest declares no type', () => {
    expect(validateSettingValue({}, 'whatever')).toBeUndefined();
  });
});

describe('the settings skill is gated as what it is', () => {
  // The modal in the skill is the consent; this is the approval gate. Both have
  // to hold — this repository already shipped a path that wrote two chat
  // settings at workspace scope on a signal that fired on politeness, naming
  // neither in anything the operator read.
  it('treats a read as a read and a write as a high-risk workspace write', () => {
    const read = classifyToolInvocation('atlasmind-settings', { action: 'get', key: 'atlasmind.research.enabled' });
    expect(read.category).toBe('read');

    const write = classifyToolInvocation('atlasmind-settings', { action: 'set', key: 'atlasmind.research.enabled' });
    expect(write.category).toBe('workspace-write');
    expect(write.risk).toBe('high');
  });

  it('names the key in the summary the operator is shown', () => {
    const write = classifyToolInvocation('atlasmind-settings', { action: 'set', key: 'atlasmind.research.enabled' });
    expect(write.summary).toContain('atlasmind.research.enabled');
    expect(write.summary).toMatch(/confirm/i);
  });

  it('prompts for a change under every mode that gates writes', () => {
    const write = classifyToolInvocation('atlasmind-settings', { action: 'set', key: 'atlasmind.research.enabled' });
    expect(requiresToolApproval('always-ask', write)).toBe(true);
    expect(requiresToolApproval('ask-on-write', write)).toBe(true);
    expect(requiresToolApproval('allow-safe-readonly', write)).toBe(true);
  });

  it('does not make reading a setting prompt under the default mode', () => {
    const read = classifyToolInvocation('atlasmind-settings', { action: 'get', key: 'atlasmind.research.enabled' });
    expect(requiresToolApproval('ask-on-write', read)).toBe(false);
  });
});
