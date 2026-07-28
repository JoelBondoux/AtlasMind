import { describe, expect, it } from 'vitest';

import {
  BUZZ_SETUP_COMMANDS,
  buildBuzzSetupPlan,
  buzzStepChoices,
  buzzStepPosition,
  renderBuzzStepMarkdown,
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
  agentBindings: 0,
};

/** Everything required for reading Buzz. */
const READY: BuzzSetupState = {
  ...FRESH,
  hasAgentKey: true,
  enabled: true,
  inboundEnabled: true,
  // The relay how-to is branched, so the local path is what these assert.
  relayMode: 'local',
};

/** Reading Buzz works, a message has been seen, and someone is bound. */
const WALKTHROUGH_DONE: BuzzSetupState = {
  ...READY,
  observedIdentities: 2,
  agentBindings: 1,
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
    expect(nextBuzzSetupStep(buildBuzzSetupPlan(WALKTHROUGH_DONE))).toBeUndefined();
  });

  it('separates "inbound works" from "the walkthrough is finished"', () => {
    // Inbound genuinely works with nothing bound and nothing yet received, so
    // isBuzzInboundReady must not report a gap — but the walkthrough still has
    // something to say, which is exactly the case that used to be skipped.
    const plan = buildBuzzSetupPlan(READY);
    expect(isBuzzInboundReady(plan)).toBe(true);
    expect(nextBuzzSetupStep(plan)?.id).toBe('firstAgent');
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
    const allStates: BuzzSetupState[] = [FRESH, READY, WALKTHROUGH_DONE, { ...READY, cliOnPath: true, mcpServerRegistered: true }];
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
    const hostile = {
      ...FRESH,
      relayUrl: undefined as unknown as string,
      channelIds: undefined as unknown as string[],
      observedIdentities: undefined as unknown as number,
      agentBindings: Number.NaN,
    };
    expect(() => buildBuzzSetupPlan(hostile)).not.toThrow();
    // A missing count is "none", never a negative or a NaN leaking into prose.
    expect(buildBuzzSetupPlan(hostile).find(s => s.id === 'roster')?.detail).not.toMatch(/NaN|-\d/);
  });
});

describe('proving the first message arrives', () => {
  const guidance = (state: BuzzSetupState, id: string) =>
    (buildBuzzSetupPlan(state).find(s => s.id === id)?.guidance ?? []).map(l => l.text).join(' ');

  it('is not satisfied by being subscribed — only by something actually arriving', () => {
    // Every failure above has the same symptom: connects, then silently
    // receives nothing. A wrong channel id and a quiet day look identical.
    expect(step(READY, 'firstAgent')?.status).toBe('todo');
    expect(step({ ...READY, observedIdentities: 1 }, 'firstAgent')?.status).toBe('done');
  });

  it('waits for the subscription before asking for a test', () => {
    expect(step(FRESH, 'firstAgent')?.status).toBe('blocked');
    expect(step({ ...FRESH, enabled: true, hasAgentKey: true }, 'firstAgent')?.status).toBe('blocked');
  });

  it('says the stored key already is an agent, rather than sending someone to get one', () => {
    expect(guidance(READY, 'firstAgent')).toMatch(/already have an agent/i);
  });

  it('is the step that says how to get the Buzz desktop app', () => {
    // AtlasMind can read Buzz but cannot post, so the test message has to come
    // from the app — and the app was previously named only in an optional step
    // the walkthrough never shows, which read as though nothing needed it.
    const step = buildBuzzSetupPlan(READY).find(s => s.id === 'firstAgent');
    const lines = step?.guidance ?? [];
    expect(lines.map(l => l.text).join(' ')).toMatch(/Get the Buzz app/i);
    expect(lines.some(l => l.url?.includes('releases'))).toBe(true);
  });

  it('warns that the app and AtlasMind must share a relay', () => {
    expect(guidance(READY, 'firstAgent')).toMatch(/same relay/i);
  });

  it('names the two things that actually go wrong', () => {
    const text = guidance(READY, 'firstAgent');
    expect(text).toMatch(/channel id/i);
    expect(text).toMatch(/different relays|same URL/i);
  });

  it('does not put a chat command in a terminal', () => {
    // `/buzz read` in a bash fence would come with a "put this in a terminal"
    // button, which types it somewhere it means nothing.
    const step = buildBuzzSetupPlan(READY).find(s => s.id === 'firstAgent');
    expect((step?.guidance ?? []).every(line => !line.command)).toBe(true);
    expect(guidance(READY, 'firstAgent')).toMatch(/\/buzz read/);
  });
});

describe('putting the Buzz people in the Director roster', () => {
  const guidance = (state: BuzzSetupState, id: string) =>
    (buildBuzzSetupPlan(state).find(s => s.id === id)?.guidance ?? []).map(l => l.text).join(' ');

  it('is part of the walkthrough, because a feed routed to nobody is not finished', () => {
    // Reported: the guide never mentioned the roster at all, so Settings sat on
    // "No bindings yet" with nothing ever telling anyone to fix it.
    expect(step({ ...READY, observedIdentities: 1 }, 'roster')?.status).toBe('todo');
    expect(nextBuzzSetupStep(buildBuzzSetupPlan({ ...READY, observedIdentities: 1 }))?.id).toBe('roster');
  });

  it('is satisfied by a single binding', () => {
    expect(step({ ...READY, observedIdentities: 1, agentBindings: 1 }, 'roster')?.status).toBe('done');
  });

  it('waits for the subscription, since there is nothing arriving to route', () => {
    expect(step(FRESH, 'roster')?.status).toBe('blocked');
  });

  it('opens the Director rather than binding anyone itself', () => {
    expect(step(READY, 'roster')?.action?.command).toBe('atlasmind.openProjectDirector');
  });

  it('walks the actual form: channel, key, agent', () => {
    const text = guidance({ ...READY, observedIdentities: 2 }, 'roster');
    expect(text).toMatch(/Add person/i);
    expect(text).toMatch(/Channel.*Buzz/i);
    expect(text).toMatch(/AtlasMind agent/i);
  });

  it('offers observed identities when there are any, and an npub when there are not', () => {
    // A key is never derived from a name: a constructed key belongs to a
    // different real person.
    expect(guidance({ ...READY, observedIdentities: 2 }, 'roster')).toMatch(/never derives a key from a name/i);
    expect(guidance(READY, 'roster')).toMatch(/npub/);
  });

  it('says what happens if you skip it, rather than implying breakage', () => {
    expect(step(READY, 'roster')?.detail).toMatch(/unassigned/i);
  });

  it('counts bound identities without inventing a total', () => {
    expect(step({ ...READY, observedIdentities: 3, agentBindings: 1 }, 'roster')?.detail)
      .toMatch(/1 Buzz identity is bound .* out of 3 seen/i);
  });
});

describe('nextBuzzSetupStep scoping', () => {
  it('does not nominate a step blocked only by something optional', () => {
    // The MCP bridge is blocked until the Buzz CLI is installed, but the CLI is
    // optional — sending someone off to install a binary they never need is
    // worse than saying nothing.
    const plan = buildBuzzSetupPlan(WALKTHROUGH_DONE);
    expect(plan.find(s => s.id === 'mcp')?.status).toBe('blocked');
    expect(nextBuzzSetupStep(plan)).toBeUndefined();
  });

  it('nominates a required blocked step when one exists', () => {
    // relayMode 'local' settles step 2, so the key is the next required gap.
    const plan = buildBuzzSetupPlan({ ...FRESH, enabled: true, hasAgentKey: false, relayMode: 'local' });
    expect(nextBuzzSetupStep(plan)?.id).toBe('agentKey');
  });
});

describe('the guide is thorough about what lives outside AtlasMind', () => {
  const text = (state: BuzzSetupState, id: string) =>
    (buildBuzzSetupPlan(state).find(s => s.id === id)?.guidance ?? []).map(l => l.text).join(' ');
  const commands = (state: BuzzSetupState, id: string) =>
    (buildBuzzSetupPlan(state).find(s => s.id === id)?.guidance ?? []).map(l => l.command).filter(Boolean);

  it('asks which way you run Buzz before explaining either', () => {
    // Presenting both paths at once left the reader to work out which half
    // applied to them. Asking once and showing one path is less to read and
    // less to get wrong.
    const undecided = text({ ...READY, relayMode: 'undecided' }, 'relay');
    expect(undecided).toMatch(/decide how you want to run Buzz/i);
    expect(undecided).toMatch(/hosted/i);
    expect(undecided).toMatch(/local/i);
  });

  it('spoon-feeds the local path with real commands', () => {
    // "Normally means Docker" is not something a first-timer can act on.
    const local = commands({ ...READY, relayMode: 'local' }, 'relay');
    expect(local).toContain('docker --version');
    expect(local).toContain('git clone https://github.com/block/buzz.git');
    expect(local).toContain('docker ps');
  });

  it('tells the hosted path there is nothing to install', () => {
    const hosted = text({ ...READY, relayMode: 'hosted' }, 'relay');
    expect(hosted).toMatch(/nothing to install/i);
    expect(hosted).toMatch(/wss:\/\//);
    expect(commands({ ...READY, relayMode: 'hosted' }, 'relay')).toHaveLength(0);
  });

  it('only offers a terminal button for commands AtlasMind wrote', () => {
    // Commands quoted from Buzz's docs are somebody else's text and must never
    // become a one-click action.
    for (const mode of ['local', 'hosted', 'undecided'] as const) {
      for (const step of buildBuzzSetupPlan({ ...READY, relayMode: mode })) {
        for (const line of step.guidance ?? []) {
          if (line.authored) {
            expect(BUZZ_SETUP_COMMANDS, `unlisted command ${line.command}`).toContain(line.command);
          }
        }
      }
    }
  });

  it('does not invent a Docker command it cannot verify', () => {
    // Naming an image or invocation that has drifted would fail in a way that
    // looks like AtlasMind's fault, so the build/run steps stay quoted.
    const local = commands({ ...READY, relayMode: 'local' }, 'relay').join(' ');
    expect(local).not.toMatch(/docker run\s+\S/i);
    expect(buildBuzzSetupPlan(READY).find(s => s.id === 'relay')?.docs?.url).toContain('github.com/block/buzz');
  });

  it('does not treat a valid localhost URL as proof a relay exists', () => {
    // ws://localhost:3000 reads as settled while nothing may be listening, and
    // the symptom is a subscription that never goes live.
    const unproven = buildBuzzSetupPlan(READY).find(s => s.id === 'relay');
    expect(unproven?.detail).toMatch(/has not connected yet/i);

    const proven = buildBuzzSetupPlan({ ...READY, inboundStatus: 'live' }).find(s => s.id === 'relay');
    expect(proven?.detail).not.toMatch(/has not connected yet/i);
    expect(proven?.guidance).toBeUndefined();
  });

  it('includes the desktop app, and says why it matters', () => {
    // Without it the guide described a workspace with no way in — and the
    // channel ids the next steps ask for come from the app.
    const app = buildBuzzSetupPlan(READY).find(s => s.id === 'app');
    expect(app?.status).toBe('optional');
    expect((app?.guidance ?? []).map(l => l.text).join(' ')).toMatch(/copy its id/i);
    expect((app?.guidance ?? []).some(l => l.url?.includes('releases'))).toBe(true);
  });

  it('names the MCP bridge as the thing needed to send', () => {
    const mcp = buildBuzzSetupPlan(READY).find(s => s.id === 'mcp');
    expect(mcp?.title).toMatch(/MCP/);
    expect(mcp?.title).toMatch(/only needed to send/i);
  });

  it('numbers steps against the required sequence only', () => {
    // Counting optional steps would make the finish line move as you progress.
    const steps = buildBuzzSetupPlan(FRESH);
    expect(buzzStepPosition(steps, 'enabled')).toMatchObject({ index: 1, total: 6 });
    expect(buzzStepPosition(steps, 'inbound').total).toBe(6);
    // The walkthrough runs past "subscribed": prove one message arrives, then
    // say who it belongs to.
    expect(buzzStepPosition(steps, 'firstAgent').index).toBe(5);
    expect(buzzStepPosition(steps, 'roster').index).toBe(6);
  });

  it('renders a step as markdown with its commands in fenced blocks', () => {
    const steps = buildBuzzSetupPlan({ ...FRESH, relayMode: 'local', enabled: true });
    const relay = steps.find(s => s.id === 'relay')!;
    const md = renderBuzzStepMarkdown(relay, buzzStepPosition(steps, 'relay'));
    // Leads with progress, not an arbitrary step number.
    expect(md).toContain('1 of 6 done. Next:');
    expect(md).toContain('```bash');
    expect(md).toContain('docker --version');
  });

  it('says what kind of key the agent-key prompt wants', () => {
    const guidance = (buildBuzzSetupPlan(FRESH).find(s => s.id === 'agentKey')?.guidance ?? []).map(l => l.text).join(' ');
    expect(guidance).toMatch(/nsec1/);
    expect(guidance).toMatch(/npub.*cannot sign|cannot sign/i);
    expect(guidance).toMatch(/secret store/i);
  });

  it('corrects the empty-channel-list misreading where someone will hit it', () => {
    const guidance = (buildBuzzSetupPlan({ ...FRESH, enabled: true, hasAgentKey: true })
      .find(s => s.id === 'inbound')?.guidance ?? []).map(l => l.text).join(' ');
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
    expect((unproven?.guidance ?? []).map(l => l.text).join(' ')).toMatch(/docker/i);

    const proven = buildBuzzSetupPlan({ ...READY, inboundStatus: 'live' }).find(s => s.id === 'relay');
    expect(proven?.detail).not.toMatch(/has not connected yet/i);
    expect(proven?.guidance).toBeUndefined();
  });

  it('tells you the CLI is skippable if you only want to read', () => {
    const guidance = (buildBuzzSetupPlan(READY).find(s => s.id === 'cli')?.guidance ?? []).map(l => l.text).join(' ');
    expect(guidance).toMatch(/skip this entirely/i);
  });
});

describe('landing mid-sequence', () => {
  it('does not skip the relay step just because a URL string looks valid', () => {
    // Reported: the guide opened on step 3. Steps 1 and 2 read as done because
    // Buzz was enabled and the default ws://localhost:3000 parses — but nothing
    // had ever connected, so whether a relay existed was unknown, and the guide
    // walked straight past the question.
    const plan = buildBuzzSetupPlan({ ...FRESH, enabled: true, hasAgentKey: true, relayMode: 'undecided' });
    expect(nextBuzzSetupStep(plan)?.id).toBe('relay');
  });

  it('accepts the relay once the user has said which way they run it', () => {
    const local = buildBuzzSetupPlan({ ...FRESH, enabled: true, hasAgentKey: true, relayMode: 'local' });
    expect(local.find(s => s.id === 'relay')?.status).toBe('done');
  });

  it('accepts the relay once a connection has actually succeeded', () => {
    // A live subscription is proof, whatever the user did or did not say.
    const proven = buildBuzzSetupPlan({ ...FRESH, enabled: true, hasAgentKey: true, inboundStatus: 'live' });
    expect(proven.find(s => s.id === 'relay')?.status).toBe('done');
  });

  it('shows what is already done, so landing on step 3 is not disorienting', () => {
    const plan = buildBuzzSetupPlan({ ...FRESH, enabled: true, relayMode: 'local' });
    const position = buzzStepPosition(plan, 'agentKey');
    expect(position.index).toBe(3);
    expect(position.trail).toContain('✅ 1.');
    expect(position.trail).toContain('▶ 3.');
    expect(renderBuzzStepMarkdown(plan.find(s => s.id === 'agentKey')!, position)).toContain('▶ 3.');
  });
});

describe('buzzStepChoices', () => {
  it('asks the one question the guide cannot answer for itself', () => {
    const plan = buildBuzzSetupPlan({ ...FRESH, enabled: true, relayMode: 'undecided' });
    const relay = plan.find(s => s.id === 'relay')!;
    expect(buzzStepChoices(relay, 'undecided').map(c => c.id)).toEqual(['local', 'hosted']);
  });

  it('stops asking once answered', () => {
    const plan = buildBuzzSetupPlan({ ...FRESH, enabled: true, relayMode: 'local' });
    expect(buzzStepChoices(plan.find(s => s.id === 'relay')!, 'local')).toEqual([]);
  });

  it('offers no chips on steps that are just instructions', () => {
    // A chip that only means "I have read this" is a button for its own sake.
    const plan = buildBuzzSetupPlan({ ...FRESH, relayMode: 'undecided' });
    for (const step of plan.filter(s => s.id !== 'relay')) {
      expect(buzzStepChoices(step, 'undecided'), step.id).toEqual([]);
    }
  });
});

describe('the opening line reads as progress', () => {
  it('says "step 1 of N" only when nothing is done yet', () => {
    const plan = buildBuzzSetupPlan(FRESH);
    expect(renderBuzzStepMarkdown(plan[0]!, buzzStepPosition(plan, 'enabled'))).toContain('step 1 of 6');
  });

  it('says what is already done when picking up mid-sequence', () => {
    // "Step 2 of 6" as an opening line reads as though the guide lost its
    // place, when in fact step 1 was already finished.
    const plan = buildBuzzSetupPlan({ ...FRESH, enabled: true });
    const md = renderBuzzStepMarkdown(plan.find(s => s.id === 'relay')!, buzzStepPosition(plan, 'relay'));
    expect(md).toContain('1 of 6 done. Next:');
    expect(md).not.toMatch(/step 2 of 6/i);
  });
});
