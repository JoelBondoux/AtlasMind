import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/** Settings a test sets; anything absent reads as its default. */
const configValues = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({ get: (k: string, d: unknown) => (k in configValues ? configValues[k] : d) }),
    workspaceFolders: [],
  },
}));

const {
  BuzzInboundService,
  MAX_INBOUND_FOLLOWUPS_PER_BATCH,
  buildInboundFilters,
  mergeDerivedFollowUps,
} = await import('../../src/core/buzzInboundService.ts');
const { BUZZ_INBOUND_KINDS, BUZZ_KIND } = await import('../../src/core/buzzProtocol.ts');
const { buildSubscriptionFrame } = await import('../../src/core/buzzProtocol.ts');
import type { DerivedWorkItem } from '../../src/core/buzzInboundDerivation.ts';
import type { FollowUp } from '../../src/types.ts';

function followUp(id: string): FollowUp {
  return {
    id,
    title: `Buzz message: ${id}`,
    dueDate: '2026-07-29',
    cadence: 'once',
    status: 'open',
    linked: { kind: 'none' },
    channelHint: 'buzz',
    createdAt: '2026-07-28T12:00:00.000Z',
    updatedAt: '2026-07-28T12:00:00.000Z',
  };
}

function derived(id: string): DerivedWorkItem {
  return {
    followUp: followUp(id),
    pointer: { eventId: `${id}-event`, authorPubkey: 'b'.repeat(64) },
  };
}

describe('buildInboundFilters', () => {
  it('always sets kinds, so the filter can never trip the relay 403 gate', () => {
    const filters = buildInboundFilters([]);
    expect(filters[0]?.kinds).toEqual(BUZZ_INBOUND_KINDS);
    // The protocol guard must accept what we build.
    expect(buildSubscriptionFrame('sub', filters).ok).toBe(true);
  });

  it('includes both channel-message kinds, so neither deployment goes silent', () => {
    const kinds = buildInboundFilters([])[0]?.kinds ?? [];
    expect(kinds).toContain(BUZZ_KIND.channelMessage);
    expect(kinds).toContain(BUZZ_KIND.channelMessageV2);
  });

  it('scopes to the configured channels via the h tag', () => {
    const filters = buildInboundFilters(['chan-1', 'chan-2']);
    expect(filters[0]?.['#h']).toEqual(['chan-1', 'chan-2']);
  });

  it('omits the tag filter entirely when no channels are configured', () => {
    expect(buildInboundFilters([])[0]?.['#h']).toBeUndefined();
  });

  it('does not alias the caller\'s array', () => {
    const channels = ['chan-1'];
    const filters = buildInboundFilters(channels);
    channels.push('chan-2');
    expect(filters[0]?.['#h']).toEqual(['chan-1']);
  });
});

describe('mergeDerivedFollowUps', () => {
  it('appends genuinely new follow-ups', () => {
    const merged = mergeDerivedFollowUps([followUp('existing')], [derived('buzz-a')]);
    expect(merged.map(entry => entry.id)).toEqual(['existing', 'buzz-a']);
  });

  it('skips ids already present — the reconnect replay must not duplicate', () => {
    const existing = [followUp('buzz-a')];
    const merged = mergeDerivedFollowUps(existing, [derived('buzz-a')]);
    // Returns the very same array so the caller can skip a pointless write.
    expect(merged).toBe(existing);
  });

  it('de-duplicates within a single batch', () => {
    const merged = mergeDerivedFollowUps([], [derived('buzz-a'), derived('buzz-a')]);
    expect(merged).toHaveLength(1);
  });

  it('caps how many a single batch may add', () => {
    const batch = Array.from({ length: MAX_INBOUND_FOLLOWUPS_PER_BATCH + 25 }, (_, i) => derived(`buzz-${i}`));
    expect(mergeDerivedFollowUps([], batch)).toHaveLength(MAX_INBOUND_FOLLOWUPS_PER_BATCH);
  });

  it('never mutates the existing list', () => {
    const existing = [followUp('existing')];
    mergeDerivedFollowUps(existing, [derived('buzz-a')]);
    expect(existing).toHaveLength(1);
  });

  it('returns the original list for an empty batch', () => {
    const existing = [followUp('existing')];
    expect(mergeDerivedFollowUps(existing, [])).toBe(existing);
  });
});

describe('where inbound follow-ups are recorded', () => {
  /** `handleWorkItems` is private; this reaches it the way the subscription does. */
  type RecordingHarness = {
    handleWorkItems(items: DerivedWorkItem[], settings: { autoCreateFollowUps: boolean }): Promise<void>;
  };

  it('asks the injected resolver at the moment there is something to record, never the host directly', async () => {
    const asked: string[] = [];
    const log: string[] = [];
    let root: string | undefined;
    const service = new BuzzInboundService({
      secrets: { get: async () => undefined },
      workspaceRoot: () => {
        asked.push(root ?? '(none)');
        return root;
      },
      log: message => log.push(message),
    });
    // Constructing it asks nothing: folders open and close while it runs.
    expect(asked).toEqual([]);

    const harness = service as unknown as RecordingHarness;
    await harness.handleWorkItems([derived('a')], { autoCreateFollowUps: true });
    expect(asked).toEqual(['(none)']);
    expect(log).toEqual([]);

    root = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-buzz-root-'));
    try {
      await harness.handleWorkItems([derived('b')], { autoCreateFollowUps: true });
      expect(asked).toEqual(['(none)', root]);
      expect(log.join(' ')).toMatch(/no Project Director config/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records nothing when no resolver was injected, rather than guessing a folder', async () => {
    const log: string[] = [];
    const service = new BuzzInboundService({ secrets: { get: async () => undefined }, log: message => log.push(message) });
    await (service as unknown as RecordingHarness).handleWorkItems([derived('c')], { autoCreateFollowUps: true });
    expect(log).toEqual([]);
  });
});

describe('revoked Buzz identities never become work', () => {
  type Harness = {
    handleWorkItems(items: DerivedWorkItem[], settings: { autoCreateFollowUps: boolean }): Promise<void>;
    observe(event: import('../../src/core/buzzProtocol.ts').NostrEvent, channelIds: string[]): void;
  };
  // The signed example from NIP-OA: an agent key attested by its owner.
  const OWNER = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const AGENT = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
  const ATTESTED_EVENT = {
    id: 'd892a65e7677e0554ebb70ee16deeb6a0727dba46450fb4bc001291d7bff971b',
    pubkey: AGENT,
    created_at: 1713956400,
    kind: 1,
    tags: [['auth', OWNER, 'kind=1&created_at<1713957000', '8b7df2575caf0a108374f8471722b233c53f9ff827a8b0f91861966c3b9dd5cb2e189eae9f49d72187674c2f5bd244145e10ff86c9f257ffe65a1ee5f108b369']],
    content: 'owner-attested agent event',
    sig: '7fd38992b70b5e9e113644e51b4c8ee2227f3bdd402b1855f8786c0600394ab3ec2621742a7bad0b0000b93d4d1ae6e39525f286a3c1029f43f46c3359a6c76f',
  };

  it('drops a revoked author\'s item and keeps everyone else\'s', async () => {
    configValues['buzz.revokedIdentities'] = [{ pubkey: 'b'.repeat(64), reason: 'compromised' }];
    try {
      const log: string[] = [];
      const service = new BuzzInboundService({ secrets: { get: async () => undefined }, log: message => log.push(message) });
      const kept = { ...derived('ok'), pointer: { eventId: 'ok-event', authorPubkey: 'c'.repeat(64) } };
      await (service as unknown as Harness).handleWorkItems([derived('bad'), kept], { autoCreateFollowUps: false });
      expect(log.join('\n')).toMatch(/ignored a message from bbbbbbbbbbbb… — it is revoked in AtlasMind \(compromised\)/);
      expect(log.join('\n')).toMatch(/Buzz: 1 new item\(s\)/);
    } finally {
      delete configValues['buzz.revokedIdentities'];
    }
  });

  it('drops an agent\'s item when the owner who authorised it is revoked — even on its first message', async () => {
    configValues['buzz.revokedIdentities'] = [{ pubkey: OWNER, reason: 'left-organization' }];
    try {
      const log: string[] = [];
      const service = new BuzzInboundService({ secrets: { get: async () => undefined }, log: message => log.push(message) });
      const harness = service as unknown as Harness;
      // The work item arrives straight after the event; the attestation check
      // is still in flight, and the revocation check must wait for it.
      harness.observe(ATTESTED_EVENT, []);
      await harness.handleWorkItems([{ ...derived('agent'), pointer: { eventId: ATTESTED_EVENT.id, authorPubkey: AGENT } }], { autoCreateFollowUps: false });
      expect(log.join('\n')).toMatch(/the owner who authorised it is revoked in AtlasMind \(left-organization\)/);
      expect(log.join('\n')).not.toMatch(/new item/);
      expect(service.attestedOwnerOfIdentity(AGENT)).toBe(OWNER);
    } finally {
      delete configValues['buzz.revokedIdentities'];
    }
  });
});
