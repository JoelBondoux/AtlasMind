import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { KNOWN_SLASH_COMMANDS } from '../../src/chat/participant.ts';

/**
 * A slash command falling through to the general agent is a silent failure with
 * a real cost, and it shipped: the Settings → Buzz "Guide me through setup"
 * button opens chat with a pre-filled `@atlas /buzz` query, and VS Code passes
 * that to the participant as prompt *text* rather than as `request.command`.
 * The chip renders either way, so nothing looks wrong — but the deterministic,
 * model-free Buzz checklist was instead handed to an agent holding every
 * connected tool, which promptly reached for an unrelated third-party one.
 */

const participantSource = readFileSync(path.join(process.cwd(), 'src', 'chat', 'participant.ts'), 'utf8');
const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
  contributes: { chatParticipants?: Array<{ commands?: Array<{ name: string }> }> };
};

const declared = (manifest.contributes.chatParticipants ?? [])
  .flatMap(participant => participant.commands ?? [])
  .map(command => command.name);

describe('slash command routing', () => {
  it('knows every command the manifest declares', () => {
    // A stale list means the missing command quietly behaves like a freeform
    // question instead of erroring.
    expect([...KNOWN_SLASH_COMMANDS].sort()).toEqual([...declared].sort());
  });

  it('declares no command it cannot route', () => {
    for (const name of declared) {
      expect(participantSource, `no case for /${name}`).toContain(`case '${name}':`);
    }
  });

  it('recovers a command that arrived as prompt text', () => {
    expect(participantSource).toContain('KNOWN_SLASH_COMMANDS.has(');
    expect(participantSource).toMatch(/if \(!command\) \{/);
  });

  it('uses the recovered prompt, not the raw one, for commands that take arguments', () => {
    // Otherwise `/buzz send hello` recovered from text would pass the whole
    // string — including the command itself — through as the message body.
    //
    // Anchored on the function's own boundaries rather than on a `case` label.
    // It used to end at `case 'voice':`, which moved *above* `handleChatRequest`
    // when the deterministic commands were factored into
    // `runDeterministicSlashCommand` — leaving the slice empty and the assertion
    // passing vacuously in the direction that matters least.
    const start = participantSource.indexOf('async function handleChatRequest(');
    const end = participantSource.indexOf('export async function prepareProjectRunContext(');
    expect(start, 'handleChatRequest not found').toBeGreaterThan(-1);
    expect(end, 'prepareProjectRunContext not found').toBeGreaterThan(start);
    const dispatch = participantSource.slice(start, end);
    expect(dispatch).toContain('let prompt = request.prompt;');
    // The declaration is the one legitimate mention; every other use inside the
    // dispatch must read the local, possibly-rewritten value.
    const uses = dispatch.split('request.prompt').length - 1;
    expect(uses, 'request.prompt used beyond its declaration').toBe(1);
  });
});

describe('slash commands opened from other surfaces', () => {
  const settingsSource = readFileSync(path.join(process.cwd(), 'src', 'views', 'settingsPanel.ts'), 'utf8');

  it('still recovers the pre-filled queries other buttons use', () => {
    // The Buzz guide no longer routes through VS Code chat, but this one still
    // does — and it has exactly the same latent bug, so the recovery path has
    // to keep covering it.
    const prefilled = [...settingsSource.matchAll(/'@atlas \/([a-z-]+)'/g)].map(m => m[1]!);
    expect(prefilled.length).toBeGreaterThan(0);
    for (const command of prefilled) {
      expect(KNOWN_SLASH_COMMANDS.has(command), `/${command} is pre-filled but unrecoverable`).toBe(true);
    }
  });
});
