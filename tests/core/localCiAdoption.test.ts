import { describe, expect, it } from 'vitest';
import {
  describeAdoptedRunner,
  parseOwnedLocalCiContainers,
  reconcileLocalCiContainers,
} from '../../src/core/localCiAdoption.ts';

const owned = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  Names: 'atlasmind-ci-abc123def456-1a2b3c4d',
  Labels: 'com.atlasmind.local-ci=true,com.atlasmind.local-ci.run=4242',
  State: 'running',
  Status: 'Up 12 minutes',
  ...overrides,
});

describe('owned container parsing', () => {
  it('reads an AtlasMind runner with its run id', () => {
    const containers = parseOwnedLocalCiContainers(owned());
    expect(containers).toHaveLength(1);
    expect(containers[0]).toMatchObject({
      name: 'atlasmind-ci-abc123def456-1a2b3c4d',
      runId: 4242,
      running: true,
    });
  });

  it('ignores a container carrying the label but not the name shape', () => {
    // A label is a string anybody can set on their own container.
    expect(parseOwnedLocalCiContainers(owned({ Names: 'somebody-elses-build' }))).toEqual([]);
  });

  it('ignores a container with the name shape but not the label', () => {
    expect(parseOwnedLocalCiContainers(owned({ Labels: 'com.example.thing=true' }))).toEqual([]);
  });

  it('does not read the run id out of a lookalike label', () => {
    const containers = parseOwnedLocalCiContainers(owned({
      Labels: 'com.atlasmind.local-ci=true,not-com.atlasmind.local-ci.run=99',
    }));
    expect(containers[0]?.runId).toBeUndefined();
  });

  it('skips an unreadable row rather than guessing at it', () => {
    const raw = ['not json at all', owned(), '{"Names":'].join('\n');
    expect(parseOwnedLocalCiContainers(raw)).toHaveLength(1);
  });

  it('falls back to the Status text when State is absent', () => {
    expect(parseOwnedLocalCiContainers(owned({ State: '', Status: 'Up 3 seconds' }))[0]?.running).toBe(true);
    expect(parseOwnedLocalCiContainers(owned({ State: '', Status: 'Exited (0) 2 minutes ago' }))[0]?.running).toBe(false);
  });

  it('never throws on rubbish', () => {
    expect(parseOwnedLocalCiContainers('')).toEqual([]);
    expect(parseOwnedLocalCiContainers('\n\n  \n')).toEqual([]);
    expect(parseOwnedLocalCiContainers('[]')).toEqual([]);
  });
});

describe('container reconciliation', () => {
  it('adopts a live runner and lists finished ones as strays', () => {
    const containers = parseOwnedLocalCiContainers([
      owned(),
      owned({ Names: 'atlasmind-ci-999888777666-9f8e7d6c', State: 'exited', Status: 'Exited (137) 1 hour ago' }),
    ].join('\n'));
    const result = reconcileLocalCiContainers(containers);
    expect(result.adoptable?.runId).toBe(4242);
    expect(result.strays).toHaveLength(1);
    expect(result.strays[0]?.status).toContain('Exited');
    expect(result.ambiguous).toBe(false);
  });

  it('reports more than one live runner rather than picking between them', () => {
    const containers = parseOwnedLocalCiContainers([
      owned(),
      owned({ Names: 'atlasmind-ci-111222333444-5e6f7a8b' }),
    ].join('\n'));
    expect(reconcileLocalCiContainers(containers).ambiguous).toBe(true);
  });

  it('finds nothing to adopt on a clean machine', () => {
    const result = reconcileLocalCiContainers([]);
    expect(result.adoptable).toBeUndefined();
    expect(result.strays).toEqual([]);
    expect(result.ambiguous).toBe(false);
  });
});

describe('adopted runner description', () => {
  it('names the run when the label carried one', () => {
    const [container] = parseOwnedLocalCiContainers(owned());
    expect(describeAdoptedRunner(container!)).toContain('#4242');
  });

  it('stays truthful when no run id is known', () => {
    const [container] = parseOwnedLocalCiContainers(owned({ Labels: 'com.atlasmind.local-ci=true' }));
    expect(describeAdoptedRunner(container!)).toContain('a job');
  });
});
