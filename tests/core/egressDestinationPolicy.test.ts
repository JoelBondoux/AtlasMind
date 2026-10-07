import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BLOCKED_IPV4_RANGES,
  BLOCKED_IPV6_RANGES,
  EGRESS_DESTINATION_RULES,
  MAX_EGRESS_REDIRECTS,
  classifyAddress,
  describeEgressRefusal,
  screenEgressUrl,
  vetEgressDestination,
  vetResolvedAddresses,
  type EgressResolver,
  type ResolvedAddress,
} from '../../src/core/egressDestinationPolicy.ts';

const PUBLIC_V4: ResolvedAddress = { address: '93.184.216.34', family: 4 };
const resolvesTo = (...addresses: ResolvedAddress[]): EgressResolver => async () => addresses;

function ruleOf(raw: string): string | undefined {
  const screen = screenEgressUrl(raw);
  return screen.allowed ? undefined : screen.rule;
}

describe('egress destination policy — the URL alone', () => {
  it.each([
    // [url, expected rule]
    ['not a url', 'egress.malformed-url'],
    ['ftp://example.com/file', 'egress.scheme'],
    ['file:///etc/passwd', 'egress.scheme'],
    ['http://example.com/', 'egress.scheme'],
    ['https://user:secret@example.com/', 'egress.credentials'],
    ['https://user@example.com/', 'egress.credentials'],
    ['https://localhost/', 'egress.local-name'],
    ['https://LOCALHOST./', 'egress.local-name'],
    ['https://app.localhost/', 'egress.local-name'],
    ['https://printer.local/', 'egress.local-name'],
    ['https://metadata.google.internal/computeMetadata/v1/', 'egress.local-name'],
    ['https://nas.home.arpa/', 'egress.local-name'],
  ])('%s → %s', (url, rule) => {
    expect(ruleOf(url)).toBe(rule);
  });

  it.each([
    // Every blocked IPv4 range, by a literal inside it.
    ['https://0.0.0.0/', '0.0.0.0/8'],
    ['https://10.1.2.3/', '10.0.0.0/8'],
    ['https://100.64.0.1/', '100.64.0.0/10'],
    ['https://100.127.255.254/', '100.64.0.0/10'],
    ['https://127.0.0.1/', '127.0.0.0/8'],
    ['https://127.255.255.254/', '127.0.0.0/8'],
    ['https://169.254.169.254/latest/meta-data/', '169.254.0.0/16'],
    ['https://172.16.0.1/', '172.16.0.0/12'],
    ['https://172.31.255.255/', '172.16.0.0/12'],
    ['https://192.0.0.8/', '192.0.0.0/24'],
    ['https://192.168.1.1/', '192.168.0.0/16'],
    ['https://198.18.0.1/', '198.18.0.0/15'],
    ['https://198.19.255.1/', '198.18.0.0/15'],
    ['https://224.0.0.1/', '224.0.0.0/4'],
    ['https://239.255.255.250/', '224.0.0.0/4'],
    ['https://255.255.255.255/', '255.255.255.255/32'],
    ['https://240.0.0.1/', '240.0.0.0/4'],
    // Every blocked IPv6 range.
    ['https://[::]/', '::/128'],
    ['https://[::1]/', '::1/128'],
    ['https://[fc00::1]/', 'fc00::/7'],
    ['https://[fd12:3456::1]/', 'fc00::/7'],
    ['https://[fe80::1]/', 'fe80::/10'],
    ['https://[febf::1]/', 'fe80::/10'],
    ['https://[fec0::1]/', 'fec0::/10'],
    ['https://[ff02::1]/', 'ff00::/8'],
    ['https://[64:ff9b:1::1]/', '64:ff9b:1::/48'],
  ])('refuses a literal in a blocked range: %s', (url, cidr) => {
    const screen = screenEgressUrl(url);
    expect(screen.allowed).toBe(false);
    if (!screen.allowed) {
      expect(screen.rule).toBe('egress.blocked-address');
      expect(screen.range?.startsWith(cidr)).toBe(true);
    }
  });

  it.each([
    // Odd IPv4 spellings — the WHATWG parser folds them to a dotted quad, and
    // the policy judges the number, not the text.
    ['https://2130706433/', '127.0.0.0/8'],
    ['https://0x7f.1/', '127.0.0.0/8'],
    ['https://0177.0.0.1/', '127.0.0.0/8'],
    ['https://127.1/', '127.0.0.0/8'],
    ['https://0x7f000001/', '127.0.0.0/8'],
    ['https://%31%32%37.0.0.1/', '127.0.0.0/8'],
    ['https://2852039166/', '169.254.0.0/16'],
    ['https://0/', '0.0.0.0/8'],
    // IPv6 forms that carry an IPv4 address are judged by it.
    ['https://[::ffff:127.0.0.1]/', '::ffff:0:0/96'],
    ['https://[::ffff:a9fe:a9fe]/', '::ffff:0:0/96'],
    ['https://[0:0:0:0:0:ffff:10.0.0.1]/', '::ffff:0:0/96'],
    ['https://[64:ff9b::7f00:1]/', '64:ff9b::/96'],
    ['https://[64:ff9b::169.254.169.254]/', '64:ff9b::/96'],
    ['https://[2002:7f00:1::1]/', '2002::/16'],
    ['https://[::127.0.0.1]/', '::/96'],
  ])('refuses an encoded internal address: %s', (url, cidr) => {
    const screen = screenEgressUrl(url);
    expect(screen.allowed).toBe(false);
    if (!screen.allowed) {
      expect(screen.rule).toBe('egress.blocked-address');
      expect(screen.range?.startsWith(cidr)).toBe(true);
    }
  });

  it('names what a literal reaches before how it is spelled', () => {
    // `http://127.0.0.1` breaks two rules; the address is the one that matters.
    expect(ruleOf('http://127.0.0.1/admin')).toBe('egress.blocked-address');
    expect(ruleOf('http://localhost:3000/')).toBe('egress.local-name');
  });

  it('allows ordinary public https, by name and by public literal', () => {
    expect(screenEgressUrl('https://example.com/docs?q=1').allowed).toBe(true);
    expect(screenEgressUrl('https://8.8.8.8/').allowed).toBe(true);
    expect(screenEgressUrl('https://[2606:4700:4700::1111]/').allowed).toBe(true);
    expect(screenEgressUrl('https://[::ffff:8.8.8.8]/').allowed).toBe(true);
    // Names that merely contain a local-looking word are not local names.
    expect(screenEgressUrl('https://localhost.example.com/').allowed).toBe(true);
    expect(screenEgressUrl('https://internal-docs.example.com/').allowed).toBe(true);
  });

  it('every refusal names a declared rule and says it in the message', () => {
    const declared = new Set(EGRESS_DESTINATION_RULES.map(rule => rule.id));
    for (const url of ['nope', 'http://example.com', 'https://a:b@example.com', 'https://localhost', 'https://10.0.0.1']) {
      const screen = screenEgressUrl(url);
      expect(screen.allowed).toBe(false);
      if (!screen.allowed) {
        expect(declared.has(screen.rule)).toBe(true);
        expect(describeEgressRefusal(screen)).toContain(screen.rule);
      }
    }
    expect(describeEgressRefusal({ allowed: false, rule: 'egress.scheme', reason: 'x' }, 2)).toContain('redirect hop 2');
  });

  it('declares each range once and parses every one it declares', () => {
    for (const range of [...BLOCKED_IPV4_RANGES, ...BLOCKED_IPV6_RANGES]) {
      const base = range.cidr.split('/')[0] ?? '';
      // The base address of a blocked range is itself blocked — a CIDR that
      // did not parse would silently match nothing.
      expect(classifyAddress(base).blocked, range.cidr).toBe(true);
    }
    expect(MAX_EGRESS_REDIRECTS).toBeGreaterThan(0);
  });
});

describe('egress destination policy — what the name resolves to', () => {
  it('refuses a public name that resolves to a private address', async () => {
    const decision = await vetEgressDestination('https://innocent.example/', resolvesTo({ address: '10.0.0.5', family: 4 }));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.rule).toBe('egress.blocked-address');
      expect(decision.reason).toContain('10.0.0.5');
    }
  });

  it('refuses when any one of several addresses is blocked', async () => {
    const decision = await vetEgressDestination(
      'https://mixed.example/',
      resolvesTo(PUBLIC_V4, { address: '169.254.169.254', family: 4 }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.range).toMatch(/^169\.254\.0\.0\/16/);
    }
  });

  it('refuses IPv6 resolver answers in blocked ranges, including mapped IPv4', async () => {
    for (const address of ['::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
      const decision = await vetEgressDestination('https://v6.example/', resolvesTo({ address, family: 6 }));
      expect(decision.allowed, address).toBe(false);
    }
  });

  it('treats unknown as refused, never as public', async () => {
    const failed = await vetEgressDestination('https://nx.example/', async () => { throw new Error('ENOTFOUND'); });
    expect(failed.allowed).toBe(false);
    if (!failed.allowed) {
      expect(failed.rule).toBe('egress.unresolved');
    }
    const empty = await vetEgressDestination('https://empty.example/', resolvesTo());
    expect(empty.allowed).toBe(false);
    if (!empty.allowed) {
      expect(empty.rule).toBe('egress.unresolved');
    }
    const garbage = vetResolvedAddresses('odd.example', [{ address: 'not-an-ip', family: 4 }]);
    expect(garbage?.rule).toBe('egress.unparseable-address');
    expect(classifyAddress('fe80::1%eth0').blocked).toBe(true);
  });

  it('returns the vetted addresses for a public name, and does not resolve a literal', async () => {
    const decision = await vetEgressDestination('https://example.com/', resolvesTo(PUBLIC_V4));
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.addresses).toEqual([PUBLIC_V4]);
      expect(decision.hostname).toBe('example.com');
    }
    let asked = false;
    const literal = await vetEgressDestination('https://8.8.8.8/', async () => { asked = true; return []; });
    expect(literal.allowed).toBe(true);
    expect(asked).toBe(false);
  });

  it('does not resolve a URL that the screen already refused', async () => {
    let asked = false;
    const decision = await vetEgressDestination('http://example.com/', async () => { asked = true; return [PUBLIC_V4]; });
    expect(decision.allowed).toBe(false);
    expect(asked).toBe(false);
  });
});

/** Every address inside a CIDR, as an integer arbitrary. */
function ipv4Within(cidr: string): fc.Arbitrary<string> {
  const [base, bits] = cidr.split('/');
  const octets = (base ?? '').split('.').map(Number);
  const start = (((octets[0] ?? 0) * 256 + (octets[1] ?? 0)) * 256 + (octets[2] ?? 0)) * 256 + (octets[3] ?? 0);
  const size = 2 ** (32 - Number(bits));
  return fc.integer({ min: 0, max: size - 1 }).map(offset => {
    const value = start + offset;
    return [24, 16, 8, 0].map(shift => Math.floor(value / 2 ** shift) % 256).join('.');
  });
}

const anyBlockedIpv4 = fc.oneof(...BLOCKED_IPV4_RANGES.map(range => ipv4Within(range.cidr)));

describe('egress destination policy — properties', () => {
  it('refuses any IPv4 address in a blocked range, as a literal, as a DNS answer, and IPv4-mapped', async () => {
    await fc.assert(fc.asyncProperty(anyBlockedIpv4, async address => {
      expect(screenEgressUrl(`https://${address}/`).allowed).toBe(false);
      const resolved = await vetEgressDestination('https://name.example/', resolvesTo({ address, family: 4 }));
      expect(resolved.allowed).toBe(false);
      expect(classifyAddress(`::ffff:${address}`).blocked).toBe(true);
      // The decimal spelling the URL parser accepts reaches the same number.
      const decimal = address.split('.').reduce((total, octet) => total * 256 + Number(octet), 0);
      expect(screenEgressUrl(`https://${decimal}/`).allowed).toBe(false);
    }));
  });

  it('refuses a resolution containing a blocked address wherever it sits in the list', () => {
    fc.assert(fc.property(
      anyBlockedIpv4,
      fc.integer({ min: 0, max: 4 }),
      (blocked, position) => {
        const addresses: ResolvedAddress[] = new Array(4).fill(PUBLIC_V4);
        addresses.splice(position, 0, { address: blocked, family: 4 });
        expect(vetResolvedAddresses('name.example', addresses)).toBeDefined();
      },
    ));
  });

  it('never throws on arbitrary input', () => {
    fc.assert(fc.property(fc.string(), text => {
      expect(() => screenEgressUrl(text)).not.toThrow();
      expect(() => classifyAddress(text)).not.toThrow();
    }));
  });
});
