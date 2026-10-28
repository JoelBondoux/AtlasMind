import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUZZ_PERSONA_FILE,
  readBuzzPersonaDocument,
  sanitizeBuzzPersonaDocument,
  validateBuzzPersonaProfiles,
  writeBuzzPersonaDocument,
  type BuzzPersonaDocument,
} from '../../src/core/buzzPersonaProfiles.ts';

const ENGINEER = {
  id: 'am-engineer',
  displayName: 'AM Engineer',
  purpose: 'Engineering delivery',
  agentIds: ['backend-engineer', 'frontend-engineer', 'code-reviewer'],
  preferredAgentId: 'backend-engineer',
  routingMode: 'scoped-orchestration',
  independenceClass: 'execution',
  skillCeiling: { mode: 'member' },
};

const OVERSIGHT = {
  ...ENGINEER,
  id: 'am-oversight',
  displayName: 'AM Oversight',
  agentIds: ['ethics-oversight', 'code-reviewer'],
  preferredAgentId: 'ethics-oversight',
  independenceClass: 'oversight',
  skillCeiling: { mode: 'read-only' },
};

describe('sanitizeBuzzPersonaDocument', () => {
  it('keeps a valid document, and one agent may serve two personas', () => {
    const { document, findings } = sanitizeBuzzPersonaDocument({ version: 1, profiles: [ENGINEER, OVERSIGHT] });
    expect(findings).toEqual([]);
    expect(document!.profiles.map(profile => profile.id)).toEqual(['am-engineer', 'am-oversight']);
    expect(document!.profiles.every(profile => profile.agentIds.includes('code-reviewer'))).toBe(true);
  });

  it('reports an invalid profile and leaves it out, rather than repairing it', () => {
    const { document, findings } = sanitizeBuzzPersonaDocument({
      version: 1,
      profiles: [
        { ...ENGINEER, id: 'AM Engineer' },
        { ...ENGINEER, id: 'am-two', preferredAgentId: 'security-reviewer' },
        { ...ENGINEER, id: 'am-three', skillCeiling: { mode: 'allowlist', skillIds: [] } },
        { ...ENGINEER, id: 'am-four', routingMode: 'global' },
        ENGINEER,
        ENGINEER,
      ],
    });
    expect(document!.profiles.map(profile => profile.id)).toEqual(['am-engineer']);
    expect(findings.map(finding => finding.message)).toEqual([
      expect.stringMatching(/slug/),
      expect.stringMatching(/preferredAgentId must be one of/),
      expect.stringMatching(/allowlist/),
      expect.stringMatching(/scoped-orchestration/),
      expect.stringMatching(/already has this id/),
    ]);
  });

  it('keeps fields this build does not know, where they were written', () => {
    const { document } = sanitizeBuzzPersonaDocument({ version: 1, note: 'top', profiles: [{ ...ENGINEER, colour: 'teal' }] });
    expect(document!['note']).toBe('top');
    expect(document!.profiles[0]!['colour']).toBe('teal');
  });

  it('refuses the whole document for a secret-shaped key or value, or a local path', () => {
    for (const poisoned of [
      { version: 1, profiles: [{ ...ENGINEER, buzzPrivateKey: 'x' }] },
      { version: 1, profiles: [{ ...ENGINEER, purpose: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' }] },
      { version: 1, profiles: [{ ...ENGINEER, purpose: 'C:\\Users\\me\\project' }] },
      { version: 1, apiKey: 'sk-1234', profiles: [ENGINEER] },
    ]) {
      const result = sanitizeBuzzPersonaDocument(poisoned);
      expect(result.document).toBeUndefined();
      expect(result.findings[0]!.message).toMatch(/^refused:/);
    }
  });

  it('refuses a list longer than its bound whole, rather than truncating it', () => {
    const profiles = Array.from({ length: 13 }, (_, index) => ({ ...ENGINEER, id: `am-${index}` }));
    expect(sanitizeBuzzPersonaDocument({ version: 1, profiles }).document).toBeUndefined();
  });
});

describe('validateBuzzPersonaProfiles', () => {
  const document = sanitizeBuzzPersonaDocument({ version: 1, profiles: [ENGINEER, OVERSIGHT] }).document!;

  it('names a missing or disabled member and an unrunnable lead, deleting nothing', () => {
    const findings = validateBuzzPersonaProfiles(document, [
      { id: 'backend-engineer', enabled: false, oversight: false },
      { id: 'frontend-engineer', enabled: true, oversight: false },
      { id: 'ethics-oversight', enabled: true, oversight: true },
    ]);
    const messages = findings.filter(finding => finding.profileId === 'am-engineer').map(finding => finding.message);
    expect(messages).toEqual(expect.arrayContaining([
      'member backend-engineer is disabled',
      'member code-reviewer is not an agent this workspace has',
      expect.stringMatching(/preferred member backend-engineer cannot run/),
    ]));
    expect(document.profiles[0]!.agentIds).toHaveLength(3);
  });

  it('calls a persona with no runnable member unusable', () => {
    expect(validateBuzzPersonaProfiles(document, [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ profileId: 'am-engineer', severity: 'invalid' }),
    ]));
  });

  it('says an executing persona that includes an oversight agent has given up its independence', () => {
    const mixed = sanitizeBuzzPersonaDocument({ version: 1, profiles: [{ ...ENGINEER, agentIds: ['backend-engineer', 'ethics-oversight'] }] }).document!;
    const findings = validateBuzzPersonaProfiles(mixed, [
      { id: 'backend-engineer', enabled: true, oversight: false },
      { id: 'ethics-oversight', enabled: true, oversight: true },
    ]);
    expect(findings.map(finding => finding.message)).toEqual([expect.stringMatching(/ethics-oversight is an oversight agent inside an executing persona/)]);
  });
});

describe('reading and writing the file', () => {
  const roots: string[] = [];
  const root = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atlas-personas-'));
    roots.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of roots.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads absent as absent and never creates the file', () => {
    const dir = root();
    expect(readBuzzPersonaDocument(dir)).toEqual({ findings: [], preserveExisting: false, exists: false });
    expect(existsSync(path.join(dir, BUZZ_PERSONA_FILE))).toBe(false);
  });

  it('writes and reads back the same profiles', async () => {
    const dir = root();
    const document = sanitizeBuzzPersonaDocument({ version: 1, profiles: [ENGINEER] }).document!;
    expect(await writeBuzzPersonaDocument(dir, document)).toEqual({ ok: true });
    expect(readBuzzPersonaDocument(dir).document).toEqual(document);
  });

  it('refuses to read or overwrite a file written by a newer AtlasMind', async () => {
    const dir = root();
    mkdirSync(path.join(dir, '.atlasmind'));
    const newer = JSON.stringify({ version: 9, profiles: [] });
    writeFileSync(path.join(dir, BUZZ_PERSONA_FILE), newer);
    const read = readBuzzPersonaDocument(dir);
    expect(read).toMatchObject({ exists: true, preserveExisting: true });
    expect(read.document).toBeUndefined();
    const written = await writeBuzzPersonaDocument(dir, { version: 1, profiles: [] } as BuzzPersonaDocument);
    expect(written.ok).toBe(false);
    expect(readFileSync(path.join(dir, BUZZ_PERSONA_FILE), 'utf8')).toBe(newer);
  });

  it('refuses to write a document with an invalid profile, leaving the choice to the caller', async () => {
    const dir = root();
    const written = await writeBuzzPersonaDocument(dir, { version: 1, profiles: [{ ...ENGINEER, preferredAgentId: 'nobody' }] } as unknown as BuzzPersonaDocument);
    expect(written).toEqual({ ok: false, reason: expect.stringMatching(/preferredAgentId/) });
    expect(existsSync(path.join(dir, BUZZ_PERSONA_FILE))).toBe(false);
  });
});
