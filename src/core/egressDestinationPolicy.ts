/**
 * Where a model-initiated request may go, decided before a socket is opened.
 *
 * `web-fetch`, `http-request`, a model-drafted skill calling `fetchUrl`, and a
 * referral URL inside a discovery response all have the same shape: a
 * destination somebody other than the user chose, fetched from this machine.
 * This machine can reach things the internet cannot — the loopback, the office
 * network, a router's admin page, and on a cloud VM the instance metadata
 * service at `169.254.169.254`, which hands out credentials to anyone who asks.
 * Server-side request forgery is getting a model to ask.
 *
 * The screen this replaces compared the *host-name string* against a short
 * list, so it failed in four ways at once: a public name that *resolves* to a
 * private address passed (and the answer could change between the check and
 * the connection — DNS rebinding); `169.254.0.0/16` was not on the list; plain
 * `http` was allowed; and the request followed redirects, so a public URL could
 * `302` anywhere. Three copies of it had already drifted (only the discovery
 * one blocked link-local). This module is the one copy.
 *
 * Six rules.
 *
 * **An address is judged by its numeric value, never its spelling.** The WHATWG
 * URL parser already folds `2130706433`, `0x7f.1`, `0177.0.0.1` and `127.1`
 * into `127.0.0.1`; this module parses the result into bits and matches
 * declared CIDR ranges, so an encoding nobody thought of is still a number in a
 * range. IPv6 forms that carry an IPv4 address inside them (`::ffff:0:0/96`,
 * NAT64 `64:ff9b::/96`, 6to4 `2002::/16`) are judged by the address they carry.
 *
 * **Every resolved address must pass, not one.** A name that resolves to a
 * public and a private address is refused: the connection may pick either.
 *
 * **Unknown is not public.** A name that does not resolve, or a resolver answer
 * that is not an address, is refused — never allowed through on the assumption
 * that the connection will fail anyway.
 *
 * **`https` only.** Plain `http` is the scheme local services answer on and the
 * one a redirect downgrades to; a model-initiated fetch has no reason to need
 * it and no setting enables it. Credentials in the URL are refused rather than
 * stripped — a silently cleaned URL is not the request somebody approved.
 *
 * **The name that names this machine is refused before anything is resolved**
 * (`localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`), because
 * those names are local by definition and resolving them is itself a lookup on
 * the local network.
 *
 * **Every refusal names its rule** from {@link EGRESS_DESTINATION_RULES}, and an
 * address refusal names the range, so "refused" is arguable rather than opaque.
 *
 * Deliberately **not** used for Lens endpoints: `lensEndpoints` allows
 * private-range `https` because those destinations come from a committed,
 * reviewed file rather than from a model. That distinction is the point of both
 * modules and they must not be merged.
 *
 * Pure: DNS is injected ({@link EgressResolver}). The connection that honours a
 * decision — pinned to the vetted addresses, redirects re-screened hop by hop —
 * is `egressFetch.ts`.
 */

export type EgressRuleId =
  | 'egress.malformed-url'
  | 'egress.credentials'
  | 'egress.local-name'
  | 'egress.blocked-address'
  | 'egress.scheme'
  | 'egress.unresolved'
  | 'egress.unparseable-address'
  | 'egress.redirect-limit'
  | 'egress.redirect-target';

export interface EgressDestinationRule {
  readonly id: EgressRuleId;
  readonly summary: string;
}

/** Redirect hops followed after the first request. Each one is screened in full. */
export const MAX_EGRESS_REDIRECTS = 5;

/** Evaluated in this order; the first rule a destination breaks is the one named. */
export const EGRESS_DESTINATION_RULES: readonly EgressDestinationRule[] = [
  { id: 'egress.malformed-url', summary: 'The URL does not parse, or has no host.' },
  { id: 'egress.credentials', summary: 'A URL carrying a user name or password is refused, not cleaned: a stripped URL is not the request that was approved.' },
  { id: 'egress.local-name', summary: 'localhost, *.localhost, *.local, *.internal and *.home.arpa name this machine or a private network by definition (RFC 6761, 6762, 8375; ICANN .internal).' },
  { id: 'egress.blocked-address', summary: 'A literal or resolved address in a blocked range — loopback, private, link-local (cloud instance metadata), carrier-grade NAT, multicast, reserved — or an IPv6 form carrying one.' },
  { id: 'egress.scheme', summary: 'Only https is fetched for a model-initiated request; plain http is the scheme local services answer on and the one a redirect downgrades to.' },
  { id: 'egress.unresolved', summary: 'The name did not resolve to any address. Unknown is not public.' },
  { id: 'egress.unparseable-address', summary: 'The resolver answered with something that is not an IP address, so it cannot be judged.' },
  { id: 'egress.redirect-limit', summary: `More than ${MAX_EGRESS_REDIRECTS} redirects. Each hop is screened like the first; a chain longer than this is a loop or an attempt to outlast the check.` },
  { id: 'egress.redirect-target', summary: 'A redirect whose Location cannot be read as a URL.' },
];

export interface BlockedAddressRange {
  readonly cidr: string;
  readonly label: string;
}

/**
 * IPv4 ranges a model-initiated request may never reach. First match names the
 * refusal, so the more specific entry comes first where two overlap.
 */
export const BLOCKED_IPV4_RANGES: readonly BlockedAddressRange[] = [
  { cidr: '0.0.0.0/8', label: '"this network" (0.0.0.0 reaches the local host on most systems)' },
  { cidr: '10.0.0.0/8', label: 'private network (RFC 1918)' },
  { cidr: '100.64.0.0/10', label: 'carrier-grade NAT shared space (RFC 6598)' },
  { cidr: '127.0.0.0/8', label: 'loopback' },
  { cidr: '169.254.0.0/16', label: 'link-local — where cloud instance metadata lives' },
  { cidr: '172.16.0.0/12', label: 'private network (RFC 1918)' },
  { cidr: '192.0.0.0/24', label: 'IETF protocol assignments' },
  { cidr: '192.168.0.0/16', label: 'private network (RFC 1918)' },
  { cidr: '198.18.0.0/15', label: 'benchmarking (RFC 2544)' },
  { cidr: '224.0.0.0/4', label: 'multicast' },
  { cidr: '255.255.255.255/32', label: 'limited broadcast' },
  { cidr: '240.0.0.0/4', label: 'reserved' },
];

/**
 * IPv6 ranges refused outright. The three forms that carry an IPv4 address
 * (mapped, NAT64, 6to4) are not here: they are judged by the address inside,
 * in {@link classifyAddress}.
 */
export const BLOCKED_IPV6_RANGES: readonly BlockedAddressRange[] = [
  { cidr: '::/128', label: 'unspecified address' },
  { cidr: '::1/128', label: 'loopback' },
  { cidr: '::/96', label: 'IPv4-compatible (deprecated; reaches whatever the trailing IPv4 names)' },
  { cidr: '64:ff9b:1::/48', label: 'local-use NAT64 (RFC 8215)' },
  { cidr: 'fc00::/7', label: 'unique local (private network)' },
  { cidr: 'fe80::/10', label: 'link-local' },
  { cidr: 'fec0::/10', label: 'site-local (deprecated private network)' },
  { cidr: 'ff00::/8', label: 'multicast' },
];

/** Names that are local by definition, matched on the name and every subdomain of it. */
const LOCAL_NAME_SUFFIXES: readonly string[] = ['localhost', 'local', 'internal', 'home.arpa'];

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Resolve a host name to every address it has. Injected so the policy stays pure. */
export type EgressResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export interface EgressRefusal {
  readonly allowed: false;
  readonly rule: EgressRuleId;
  readonly reason: string;
  /** The blocked range, when an address decided it. */
  readonly range?: string;
}

export type EgressScreen =
  | { readonly allowed: true; readonly url: URL; readonly hostname: string; readonly literal?: ResolvedAddress }
  | EgressRefusal;

export type EgressDecision =
  | { readonly allowed: true; readonly url: URL; readonly hostname: string; readonly addresses: readonly ResolvedAddress[] }
  | EgressRefusal;

export type AddressVerdict =
  | { readonly blocked: false; readonly family: 4 | 6 }
  | { readonly blocked: true; readonly range: string; readonly unparseable?: false }
  | { readonly blocked: true; readonly unparseable: true };

// ── Address arithmetic ─────────────────────────────────────────────

/** Strict dotted-quad decimal. Anything looser has already been normalised by the URL parser, or is not an address. */
function parseIpv4(text: string): number | undefined {
  const parts = text.split('.');
  if (parts.length !== 4) {
    return undefined;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) {
      return undefined;
    }
    const octet = Number(part);
    if (octet > 255) {
      return undefined;
    }
    value = value * 256 + octet;
  }
  return value;
}

/** Eight 16-bit groups. Accepts `::` compression and a dotted IPv4 tail; refuses a zone id. */
function parseIpv6(text: string): number[] | undefined {
  if (!text || text.includes('%')) {
    return undefined;
  }
  let head = text;
  const tail: number[] = [];
  const lastColon = head.lastIndexOf(':');
  if (lastColon >= 0 && head.slice(lastColon + 1).includes('.')) {
    const v4 = parseIpv4(head.slice(lastColon + 1));
    if (v4 === undefined) {
      return undefined;
    }
    tail.push(Math.floor(v4 / 65536), v4 % 65536);
    head = head.slice(0, lastColon + 1);
    // `::ffff:1.2.3.4` leaves `::ffff:`; a single trailing colon after a group is the separator.
    if (head.endsWith(':') && !head.endsWith('::')) {
      head = head.slice(0, -1);
    }
  }

  const doubleColon = head.indexOf('::');
  if (doubleColon !== head.lastIndexOf('::')) {
    return undefined;
  }
  const parseGroups = (segment: string): number[] | undefined => {
    if (segment === '') {
      return [];
    }
    const groups: number[] = [];
    for (const group of segment.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
        return undefined;
      }
      groups.push(parseInt(group, 16));
    }
    return groups;
  };

  let groups: number[];
  if (doubleColon >= 0) {
    const left = parseGroups(head.slice(0, doubleColon));
    const right = parseGroups(head.slice(doubleColon + 2));
    if (!left || !right) {
      return undefined;
    }
    const missing = 8 - left.length - right.length - tail.length;
    if (missing < 1) {
      return undefined;
    }
    groups = [...left, ...new Array<number>(missing).fill(0), ...right, ...tail];
  } else {
    const all = parseGroups(head);
    if (!all) {
      return undefined;
    }
    groups = [...all, ...tail];
  }
  return groups.length === 8 ? groups : undefined;
}

function ipv4InCidr(value: number, cidr: string): boolean {
  const [base, bitsText] = cidr.split('/');
  const baseValue = parseIpv4(base ?? '');
  const bits = Number(bitsText);
  if (baseValue === undefined || !Number.isInteger(bits)) {
    return false;
  }
  const size = 2 ** (32 - bits);
  return Math.floor(value / size) === Math.floor(baseValue / size);
}

function ipv6InCidr(groups: readonly number[], cidr: string): boolean {
  const [base, bitsText] = cidr.split('/');
  const baseGroups = parseIpv6(base ?? '');
  let bits = Number(bitsText);
  if (!baseGroups || !Number.isInteger(bits)) {
    return false;
  }
  for (let index = 0; index < 8 && bits > 0; index += 1) {
    const take = Math.min(16, bits);
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if (((groups[index] ?? 0) & mask) !== ((baseGroups[index] ?? 0) & mask)) {
      return false;
    }
    bits -= take;
  }
  return true;
}

function formatIpv4(value: number): string {
  return [24, 16, 8, 0].map(shift => Math.floor(value / 2 ** shift) % 256).join('.');
}

function classifyIpv4(value: number): AddressVerdict {
  const range = BLOCKED_IPV4_RANGES.find(candidate => ipv4InCidr(value, candidate.cidr));
  return range ? { blocked: true, range: `${range.cidr} ${range.label}` } : { blocked: false, family: 4 };
}

/** IPv6 prefixes whose trailing or embedded bits are an IPv4 address, judged by that address. */
const EMBEDDED_IPV4_FORMS: ReadonlyArray<{ cidr: string; label: string; extract: (groups: readonly number[]) => number }> = [
  { cidr: '::ffff:0:0/96', label: 'IPv4-mapped', extract: groups => (groups[6] ?? 0) * 65536 + (groups[7] ?? 0) },
  { cidr: '64:ff9b::/96', label: 'NAT64', extract: groups => (groups[6] ?? 0) * 65536 + (groups[7] ?? 0) },
  { cidr: '2002::/16', label: '6to4', extract: groups => (groups[1] ?? 0) * 65536 + (groups[2] ?? 0) },
];

/**
 * Judge one address by value. An IPv6 address carrying an IPv4 one is judged
 * by the IPv4 it carries; anything that is not an address is blocked as
 * unparseable rather than waved through.
 */
export function classifyAddress(address: string): AddressVerdict {
  const text = address.trim().replace(/^\[(.*)\]$/, '$1');
  const v4 = parseIpv4(text);
  if (v4 !== undefined) {
    return classifyIpv4(v4);
  }
  const v6 = parseIpv6(text);
  if (!v6) {
    return { blocked: true, unparseable: true };
  }
  for (const form of EMBEDDED_IPV4_FORMS) {
    if (ipv6InCidr(v6, form.cidr)) {
      const embedded = form.extract(v6);
      const verdict = classifyIpv4(embedded);
      return verdict.blocked && !verdict.unparseable
        ? { blocked: true, range: `${form.cidr} ${form.label} carrying ${formatIpv4(embedded)}, in ${verdict.range}` }
        : { blocked: false, family: 6 };
    }
  }
  const range = BLOCKED_IPV6_RANGES.find(candidate => ipv6InCidr(v6, candidate.cidr));
  return range ? { blocked: true, range: `${range.cidr} ${range.label}` } : { blocked: false, family: 6 };
}

// ── Screening ──────────────────────────────────────────────────────

function refuse(rule: EgressRuleId, reason: string, range?: string): EgressRefusal {
  return range ? { allowed: false, rule, reason, range } : { allowed: false, rule, reason };
}

function isLocalName(hostname: string): boolean {
  return LOCAL_NAME_SUFFIXES.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

/**
 * Everything decidable from the URL alone: shape, credentials, a local name,
 * a literal address, the scheme. Host rules run before the scheme rule so that
 * `http://localhost` is refused for what it reaches, not for how it is spelled.
 */
export function screenEgressUrl(raw: string): EgressScreen {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return refuse('egress.malformed-url', 'not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return refuse('egress.scheme', `"${url.protocol.replace(/:$/, '')}" is not https`);
  }
  // A trailing dot is the same name (`localhost.`), so it is judged without one.
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) {
    return refuse('egress.malformed-url', 'the URL has no host');
  }
  if (url.username || url.password) {
    return refuse('egress.credentials', 'the URL carries a user name or password');
  }
  if (isLocalName(hostname)) {
    return refuse('egress.local-name', `"${hostname}" names this machine or a private network`);
  }

  let literal: ResolvedAddress | undefined;
  const bare = hostname.replace(/^\[(.*)\]$/, '$1');
  const isV6Literal = hostname.startsWith('[');
  if (isV6Literal || parseIpv4(bare) !== undefined) {
    const verdict = classifyAddress(bare);
    if (verdict.blocked) {
      return verdict.unparseable
        ? refuse('egress.unparseable-address', `"${bare}" is not an address that can be judged`)
        : refuse('egress.blocked-address', `${bare} is in a private or reserved range`, verdict.range);
    }
    literal = { address: bare, family: verdict.family };
  }

  if (url.protocol !== 'https:') {
    return refuse('egress.scheme', `"${url.protocol.replace(/:$/, '')}" is not https`);
  }
  return literal ? { allowed: true, url, hostname: bare, literal } : { allowed: true, url, hostname: bare };
}

/**
 * Judge every address a name resolved to. One blocked address refuses the
 * whole name: the connection may pick any of them.
 */
export function vetResolvedAddresses(hostname: string, addresses: readonly ResolvedAddress[]): EgressRefusal | undefined {
  if (addresses.length === 0) {
    return refuse('egress.unresolved', `"${hostname}" resolved to no address`);
  }
  for (const entry of addresses) {
    const verdict = classifyAddress(entry.address);
    if (verdict.blocked) {
      return verdict.unparseable
        ? refuse('egress.unparseable-address', `"${hostname}" resolved to "${entry.address}", which is not an address`)
        : refuse('egress.blocked-address', `"${hostname}" resolves to ${entry.address}, in a private or reserved range`, verdict.range);
    }
  }
  return undefined;
}

/**
 * The whole decision for one hop: the URL screen, then DNS, then every
 * address. The returned addresses are the only ones a connection may use —
 * resolving again at connect time is what DNS rebinding exploits.
 */
export async function vetEgressDestination(raw: string, resolve: EgressResolver): Promise<EgressDecision> {
  const screen = screenEgressUrl(raw);
  if (!screen.allowed) {
    return screen;
  }
  if (screen.literal) {
    return { allowed: true, url: screen.url, hostname: screen.hostname, addresses: [screen.literal] };
  }
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await resolve(screen.hostname);
  } catch (error) {
    return refuse('egress.unresolved', `"${screen.hostname}" did not resolve (${error instanceof Error ? error.message : String(error)})`);
  }
  const refusal = vetResolvedAddresses(screen.hostname, addresses);
  return refusal ?? { allowed: true, url: screen.url, hostname: screen.hostname, addresses: [...addresses] };
}

/** One line a person or a model can read, naming the rule and, for an address, the range. */
export function describeEgressRefusal(refusal: EgressRefusal, hop = 0): string {
  const where = hop > 0 ? ` (redirect hop ${hop})` : '';
  const range = refusal.range ? ` [${refusal.range}]` : '';
  return `Refused${where}: ${refusal.reason}${range}. Rule ${refusal.rule}.`;
}
