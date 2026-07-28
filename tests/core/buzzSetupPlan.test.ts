import { describe, expect, it } from 'vitest';

import {
  buildBuzzSetupPlan,
  isBuzzInboundReady,
  isInsecureRemoteRelay,
  isRemoteRelay,
  nextBuzzSetupStep,
  type BuzzSetupState,
} from '../../src/core/buzzSetupPlan.ts';

/** Nothing configured — the state a user starts from. */
const FRESH: BuzzSetupState = {
  cliOnPath: false,
  hasAgentKey: false,
  relayUrl: 'ws://localhost:3000',
  allowRemoteRelay: false,
  enabled: false,
  inboundEnabled: false,
  channelIds: [],
  autoCreateFollowUps: false,
  mcpServerRegistered: false,
  observedIdentities: 0,
};

/** Everything required for reading Buzz. */
const READY: BuzzSetupState = {
  ...FRESH,
  hasAgentKey: true,
  enabled: true,
  inboundEnabled: true,
};

const step = (state: BuzzSetupState, id: string) => buildBuzzSetupPlan(state).find(s => s.id === id);

describe('isRemoteRelay', () => {
  it('treats loopback as local', () => {
    for (const url of ['ws://localhost:3000', 'ws://127.0.0.1:3000', 'ws://[::1]:3000', 'http://dev.localhost']) {
      expect(isRemoteRelay(url)).toBe(false);
    }
  });

  it('treats anything else as remote', () => {
    expect(isRemoteRelay('wss://relay.example.com')).toBe(true);
    expect(isRemoteRelay('ws://192.168.1.10:3000')).toBe(true);
  });

  it('treats an unparseable URL as remote — absence of proof is not proof of local', () => {
    expect(isRemoteRelay('not a url')).toBe(true);
  });

  it('treats an empty URL as not-remote, since there is nothing to reach', () => {
    expect(isRemoteRelay('')).toBe(false);
  });
});

describe('isInsecureRemoteRelay', () => {
  it('flags plaintext to a remote host', () => {
    expect(isInsecureRemoteRelay('ws://relay.example.com')).toBe(true);
    expect(isInsecureRemoteRelay('http://relay.example.com')).toBe(true);
  });

  it('accepts encrypted remote and plaintext loopback', () => {
    expect(isInsecureRemoteRelay('wss://relay.example.com')).toBe(false);
    expect(isInsecureRemoteRelay('ws://localhost:3000')).toBe(false);
  });
});

describe('buildBuzzSetupPlan', () => {
  it('starts with the master switch, because everything else is inert without it', () => {
    expect(buildBuzzSetupPlan(FRESH)[0]?.id).toBe('enabled');
  });

  it('points at the first actionable step from a fresh state', () => {
    expect(nextBuzzSetupStep(buildBuzzSetupPlan(FRESH))?.id).toBe('enabled');
  });

  it('blocks subscribing until the switch and key are in place', () => {
    expect(step(FRESH, 'inbound')?.status).toBe('blocked');
    expect(step({ ...FRESH, enabled: true }, 'inbound')?.status).toBe('blocked');
    expect(step({ ...FRESH, enabled: true, hasAgentKey: true }, 'inbound')?.status).toBe('todo');
  });

  it('refuses a plaintext remote relay with the reason, not just a cross', () => {
    const relay = step({ ...READY, relayUrl: 'ws://relay.example.com' }, 'relay');
    expect(relay?.status).toBe('todo');
    expect(relay?.detail).toMatch(/plaintext/i);
  });

  it('asks for remote consent before an encrypted remote relay counts as done', () => {
    const withoutConsent = step({ ...READY, relayUrl: 'wss://relay.example.com' }, 'relay');
    expect(withoutConsent?.status).toBe('todo');
    expect(withoutConsent?.detail).toMatch(/leave your machine/i);

    const withConsent = step({ ...READY, relayUrl: 'wss://relay.example.com', allowRemoteRelay: true }, 'relay');
    expect(withConsent?.status).toBe('done');
  });

  it('says what an empty channel list actually does', () => {
    // It scopes by kind alone — it does not mean "no channels".
    expect(step(READY, 'inbound')?.detail).toMatch(/every channel your key can read/i);
  });

  it('treats persistence as a choice, never a missing requirement', () => {
    expect(step(READY, 'persistence')?.status).toBe('optional');
    expect(step({ ...READY, autoCreateFollowUps: true }, 'persistence')?.status).toBe('done');
  });

  it('treats the CLI as optional, because reading Buzz does not need it', () => {
    expect(step(READY, 'cli')?.status).toBe('optional');
    expect(step(READY, 'cli')?.detail).toMatch(/only sending does/i);
  });

  it('blocks the MCP bridge on the CLI it shells out to', () => {
    expect(step(READY, 'mcp')?.status).toBe('blocked');
    expect(step({ ...READY, cliOnPath: true }, 'mcp')?.status).toBe('optional');
    expect(step({ ...READY, cliOnPath: true, mcpServerRegistered: true }, 'mcp')?.status).toBe('done');
  });

  it('reports inbound ready without demanding the optional steps', () => {
    // Nagging about a choice someone made is not help.
    expect(isBuzzInboundReady(buildBuzzSetupPlan(READY))).toBe(true);
    expect(isBuzzInboundReady(buildBuzzSetupPlan(FRESH))).toBe(false);
    expect(nextBuzzSetupStep(buildBuzzSetupPlan(READY))).toBeUndefined();
  });

  it('still warns that outbound sends need confirmation once the bridge is connected', () => {
    const mcp = step({ ...READY, cliOnPath: true, mcpServerRegistered: true }, 'mcp');
    expect(mcp?.detail).toMatch(/confirmation/i);
  });
});

describe('the plan is a plan, not an installer', () => {
  it('never offers an action that changes state on its own', () => {
    // Buzz is deny-by-default in three places so that switching it on stays a
    // human decision. A setup assistant that flipped those switches to be
    // helpful would remove the property they exist to provide. Every action
    // here opens a surface; the human does the enabling.
    const allStates: BuzzSetupState[] = [FRESH, READY, { ...READY, cliOnPath: true, mcpServerRegistered: true }];
    const allowed = new Set([
      'atlasmind.openSettings',
      'atlasmind.openMcpServers',
      'atlasmind.openProjectDirector',
      // Prompts for a key and stores what the user types — it cannot act alone.
      'atlasmind.setBuzzAgentKey',
      'vscode.open',
    ]);
    for (const state of allStates) {
      for (const s of buildBuzzSetupPlan(state)) {
        if (!s.action) {
          continue;
        }
        // An allowlist, not a name heuristic: `openSettings` contains "set".
        expect(allowed, `unexpected command ${s.action.command}`).toContain(s.action.command);
      }
    }
  });

  it('produces the same plan for the same state — nothing is generated', () => {
    expect(buildBuzzSetupPlan(READY)).toEqual(buildBuzzSetupPlan(READY));
  });

  it('never throws on hostile or missing state', () => {
    const hostile = { ...FRESH, relayUrl: undefined as unknown as string, channelIds: undefined as unknown as string[] };
    expect(() => buildBuzzSetupPlan(hostile)).not.toThrow();
  });
});

describe('nextBuzzSetupStep scoping', () => {
  it('does not nominate a step blocked only by something optional', () => {
    // The MCP bridge is blocked until the Buzz CLI is installed, but the CLI is
    // optional — sending someone off to install a binary they never need is
    // worse than saying nothing.
    const plan = buildBuzzSetupPlan(READY);
    expect(plan.find(s => s.id === 'mcp')?.status).toBe('blocked');
    expect(nextBuzzSetupStep(plan)).toBeUndefined();
  });

  it('nominates a required blocked step when one exists', () => {
    const plan = buildBuzzSetupPlan({ ...FRESH, enabled: true, hasAgentKey: false });
    expect(nextBuzzSetupStep(plan)?.id).toBe('agentKey');
  });
});

describe('the guide is thorough about what lives outside AtlasMind', () => {
  it('explains that a local relay is something you have to run', () => {
    // The default relay URL is localhost, which reads as "already working".
    // Nothing in AtlasMind starts a relay, and the symptom of an absent one is
    // a subscription that simply never goes live.
    const guidance = (buildBuzzSetupPlan(READY).find(s => s.id === 'relay')?.guidance ?? []).join(' ');
    expect(guidance).toMatch(/something has to actually be listening/i);
    expect(guidance).toMatch(/docker/i);
    expect(guidance).toMatch(/nothing in atlasmind starts it/i);
  });

  it('covers the hosted alternative too, since Buzz need not be local', () => {
    const guidance = (buildBuzzSetupPlan(READY).find(s => s.id === 'relay')?.guidance ?? []).join(' ');
    expect(guidance).toMatch(/hosted relay/i);
    expect(guidance).toMatch(/wss:\/\//);
  });

  it('does not invent a Docker command it cannot verify', () => {
    // Naming an image or a command that has drifted would be worse than the
    // link: it would fail in a way that looks like AtlasMind's fault.
    const guidance = (buildBuzzSetupPlan(READY).find(s => s.id === 'relay')?.guidance ?? []).join(' ');
    expect(guidance).not.toMatch(/docker run\s+\S/i);
    expect(buildBuzzSetupPlan(READY).find(s => s.id === 'relay')?.docs?.url).toContain('github.com/block/buzz');
  });

  it('says what kind of key the agent-key prompt wants', () => {
    const guidance = (buildBuzzSetupPlan(FRESH).find(s => s.id === 'agentKey')?.guidance ?? []).join(' ');
    expect(guidance).toMatch(/nsec1/);
    expect(guidance).toMatch(/npub.*cannot sign|cannot sign/i);
    expect(guidance).toMatch(/secret store/i);
  });

  it('corrects the empty-channel-list misreading where someone will hit it', () => {
    const guidance = (buildBuzzSetupPlan({ ...FRESH, enabled: true, hasAgentKey: true })
      .find(s => s.id === 'inbound')?.guidance ?? []).join(' ');
    expect(guidance).toMatch(/not.*no channels/i);
  });

  it('stays quiet on steps that are already done', () => {
    // Guidance on a finished step is noise, and noise is what makes people
    // stop reading the steps that matter. The relay step needs a live
    // connection to count as finished — see the next test for why.
    for (const s of buildBuzzSetupPlan({ ...READY, inboundStatus: 'live' })) {
      if (s.status === 'done') {
        expect(s.guidance, `${s.id} should not lecture once done`).toBeUndefined();
      }
    }
  });

  it('does not treat a valid localhost URL as proof a relay exists', () => {
    // This is the trap the default setting walks into: ws://localhost:3000
    // reads as settled while nothing may be listening on that port, and the
    // symptom is a subscription that never goes live. A string is not a relay.
    const unproven = buildBuzzSetupPlan(READY).find(s => s.id === 'relay');
    expect(unproven?.detail).toMatch(/has not connected yet/i);
    expect(unproven?.guidance?.join(' ')).toMatch(/docker/i);

    const proven = buildBuzzSetupPlan({ ...READY, inboundStatus: 'live' }).find(s => s.id === 'relay');
    expect(proven?.detail).not.toMatch(/has not connected yet/i);
    expect(proven?.guidance).toBeUndefined();
  });

  it('tells you the CLI is skippable if you only want to read', () => {
    const guidance = (buildBuzzSetupPlan(READY).find(s => s.id === 'cli')?.guidance ?? []).join(' ');
    expect(guidance).toMatch(/skip this entirely/i);
  });
});
