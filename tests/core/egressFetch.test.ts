import { describe, expect, it, vi } from 'vitest';
import type { ResolvedAddress } from '../../src/core/egressDestinationPolicy.ts';
import {
  createPinnedLookup,
  egressFetch,
  toSkillHttpResult,
  type EgressHopRequest,
  type EgressHopResponse,
} from '../../src/core/egressFetch.ts';

const PUBLIC: ResolvedAddress = { address: '93.184.216.34', family: 4 };
const OTHER_PUBLIC: ResolvedAddress = { address: '151.101.1.69', family: 4 };
const OPTIONS = { maxBytes: 10_000, timeoutMs: 5_000 };

function ok(body = 'hello', headers: Record<string, string> = {}): EgressHopResponse {
  return { status: 200, statusText: 'OK', headers, body, truncated: false };
}

function redirect(location: string, status = 302): EgressHopResponse {
  return { status, statusText: 'Found', headers: { location }, body: '', truncated: false };
}

describe('egressFetch — ordinary requests', () => {
  it('fetches public https unchanged, connecting only to the vetted address', async () => {
    const send = vi.fn(async (_request: EgressHopRequest) => ok('<html>docs</html>'));
    const resolve = vi.fn(async () => [PUBLIC]);
    const result = await egressFetch('https://docs.example.com/page', OPTIONS, { resolve, send });

    expect(result.kind).toBe('response');
    if (result.kind === 'response') {
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.body).toBe('<html>docs</html>');
      expect(result.redirects).toBe(0);
      expect(result.finalUrl).toBe('https://docs.example.com/page');
    }
    expect(resolve).toHaveBeenCalledWith('docs.example.com');
    const request = send.mock.calls[0]?.[0] as EgressHopRequest;
    expect(request.addresses).toEqual([PUBLIC]);
    expect(request.method).toBe('GET');
    expect(toSkillHttpResult(result)).toEqual({ ok: true, status: 200, body: '<html>docs</html>' });
  });

  it('passes method, headers and body through to the hop', async () => {
    const send = vi.fn(async (_request: EgressHopRequest) => ok('{}'));
    await egressFetch('https://api.example.com/v1', {
      ...OPTIONS,
      method: 'post',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: '{"a":1}',
    }, { resolve: async () => [PUBLIC], send });
    const request = send.mock.calls[0]?.[0] as EgressHopRequest;
    expect(request.method).toBe('POST');
    expect(request.body).toBe('{"a":1}');
    expect(request.headers['authorization']).toBe('Bearer t');
  });

  it('never opens a connection for a refused destination, and says why', async () => {
    const send = vi.fn(async () => ok());
    const result = await egressFetch('https://169.254.169.254/latest/meta-data/', OPTIONS, { resolve: async () => [PUBLIC], send });
    expect(result.kind).toBe('refused');
    expect(send).not.toHaveBeenCalled();
    const skill = toSkillHttpResult(result);
    expect(skill.ok).toBe(false);
    expect(skill.status).toBe(0);
    expect(skill.body).toMatch(/egress\.blocked-address/);
    expect(skill.body).toMatch(/169\.254\.0\.0\/16/);
  });

  it('refuses a public name whose DNS answer is private, without connecting', async () => {
    const send = vi.fn(async () => ok());
    const result = await egressFetch('https://rebind.example/', OPTIONS, {
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
      send,
    });
    expect(result.kind).toBe('refused');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('egressFetch — DNS rebinding', () => {
  it('resolves once per hop and pins the connection to that answer, whatever the resolver says next', async () => {
    // A rebinding resolver: public on the first question, loopback on every one after.
    let calls = 0;
    const resolve = vi.fn(async () => (calls++ === 0 ? [PUBLIC] : [{ address: '127.0.0.1', family: 4 as const }]));
    const send = vi.fn(async (request: EgressHopRequest) => {
      // Whatever Node asks the pinned lookup at connect time, it gets the vetted address.
      const lookup = createPinnedLookup(request.addresses);
      const answered = await new Promise<string>(done => {
        lookup('rebind.example', {}, (_error: unknown, address: unknown) => done(String(address)));
      });
      return ok(answered);
    });

    const result = await egressFetch('https://rebind.example/', OPTIONS, { resolve, send });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('response');
    if (result.kind === 'response') {
      expect(result.body).toBe(PUBLIC.address);
    }
  });

  it('the pinned lookup ignores the host name and answers both call shapes', async () => {
    const lookup = createPinnedLookup([PUBLIC, { address: '2606:4700::1111', family: 6 }]);

    const single = await new Promise<[unknown, unknown, unknown]>(done => {
      lookup('anything.at.all', {}, (error: unknown, address: unknown, family: unknown) => done([error, address, family]));
    });
    expect(single).toEqual([null, PUBLIC.address, 4]);

    const all = await new Promise<unknown>(done => {
      lookup('localhost', { all: true }, (_error: unknown, addresses: unknown) => done(addresses));
    });
    expect(all).toEqual([{ address: PUBLIC.address, family: 4 }, { address: '2606:4700::1111', family: 6 }]);

    const v6only = await new Promise<unknown>(done => {
      lookup('x', { family: 6 }, (_error: unknown, address: unknown) => done(address));
    });
    expect(v6only).toBe('2606:4700::1111');

    const none = await new Promise<unknown>(done => {
      createPinnedLookup([PUBLIC])('x', { family: 6 }, (error: unknown) => done(error));
    });
    expect(none).toBeInstanceOf(Error);
  });
});

describe('egressFetch — redirects', () => {
  it('refuses a redirect to an internal address, having sent only the first request', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(redirect('https://169.254.169.254/latest/meta-data/iam/'))
      .mockResolvedValue(ok('secret credentials'));
    const result = await egressFetch('https://public.example/start', OPTIONS, { resolve: async () => [PUBLIC], send });

    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.hop).toBe(1);
      expect(result.refusal.rule).toBe('egress.blocked-address');
      expect(result.message).toContain('redirect hop 1');
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to a name that resolves internally', async () => {
    const send = vi.fn().mockResolvedValueOnce(redirect('https://sneaky.example/')).mockResolvedValue(ok());
    const resolve = vi.fn(async (host: string) => (host === 'sneaky.example' ? [{ address: '192.168.0.1', family: 4 as const }] : [PUBLIC]));
    const result = await egressFetch('https://public.example/', OPTIONS, { resolve, send });
    expect(result.kind).toBe('refused');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses a downgrade from https to http', async () => {
    const send = vi.fn().mockResolvedValueOnce(redirect('http://public.example/plain')).mockResolvedValue(ok());
    const result = await egressFetch('https://public.example/', OPTIONS, { resolve: async () => [PUBLIC], send });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.refusal.rule).toBe('egress.scheme');
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('follows a public redirect, re-resolving and re-pinning each hop', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(redirect('/moved'))
      .mockResolvedValueOnce(redirect('https://cdn.example/final', 301))
      .mockResolvedValue(ok('final'));
    const resolve = vi.fn(async (host: string) => (host === 'cdn.example' ? [OTHER_PUBLIC] : [PUBLIC]));
    const result = await egressFetch('https://public.example/start', OPTIONS, { resolve, send });

    expect(result.kind).toBe('response');
    if (result.kind === 'response') {
      expect(result.body).toBe('final');
      expect(result.redirects).toBe(2);
      expect(result.finalUrl).toBe('https://cdn.example/final');
    }
    expect(resolve).toHaveBeenCalledTimes(3);
    const third = send.mock.calls[2]?.[0] as EgressHopRequest;
    expect(third.addresses).toEqual([OTHER_PUBLIC]);
    expect((send.mock.calls[1]?.[0] as EgressHopRequest).url.href).toBe('https://public.example/moved');
  });

  it('caps the chain, refusing the hop past the limit', async () => {
    let n = 0;
    const send = vi.fn(async () => redirect(`https://public.example/${++n}`));
    const result = await egressFetch('https://public.example/0', OPTIONS, { resolve: async () => [PUBLIC], send });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.refusal.rule).toBe('egress.redirect-limit');
    }
    // The first request plus five followed redirects.
    expect(send).toHaveBeenCalledTimes(6);
  });

  it('refuses a Location that is not a URL', async () => {
    const send = vi.fn(async () => redirect('https://[bad'));
    const result = await egressFetch('https://public.example/', OPTIONS, { resolve: async () => [PUBLIC], send });
    expect(result.kind === 'refused' && result.refusal.rule).toBe('egress.redirect-target');
  });

  it('drops credentials when a redirect changes origin, and keeps them on the same origin', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(redirect('/same-origin'))
      .mockResolvedValueOnce(redirect('https://elsewhere.example/'))
      .mockResolvedValue(ok());
    await egressFetch('https://api.example/', {
      ...OPTIONS,
      headers: { Authorization: 'Bearer secret', Cookie: 'session=1', Accept: 'text/html' },
    }, { resolve: async () => [PUBLIC], send });

    const sameOrigin = (send.mock.calls[1]?.[0] as EgressHopRequest).headers;
    expect(sameOrigin['Authorization']).toBe('Bearer secret');
    const crossOrigin = (send.mock.calls[2]?.[0] as EgressHopRequest).headers;
    expect(crossOrigin['Authorization']).toBeUndefined();
    expect(crossOrigin['Cookie']).toBeUndefined();
    expect(crossOrigin['Accept']).toBe('text/html');
  });

  it('turns a 303 after a POST into a body-less GET, and keeps a 307 as sent', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(redirect('/see-other', 303))
      .mockResolvedValue(ok());
    await egressFetch('https://api.example/', { ...OPTIONS, method: 'POST', body: 'x', headers: { 'Content-Type': 'text/plain' } }, { resolve: async () => [PUBLIC], send });
    const after303 = send.mock.calls[1]?.[0] as EgressHopRequest;
    expect(after303.method).toBe('GET');
    expect(after303.body).toBeUndefined();
    expect(after303.headers['Content-Type']).toBeUndefined();

    const send307 = vi.fn()
      .mockResolvedValueOnce(redirect('/temp', 307))
      .mockResolvedValue(ok());
    await egressFetch('https://api.example/', { ...OPTIONS, method: 'POST', body: 'x' }, { resolve: async () => [PUBLIC], send: send307 });
    const after307 = send307.mock.calls[1]?.[0] as EgressHopRequest;
    expect(after307.method).toBe('POST');
    expect(after307.body).toBe('x');
  });

  it('returns a 3xx without a Location as the response it is', async () => {
    const send = vi.fn(async () => ({ status: 304, statusText: 'Not Modified', headers: {}, body: '', truncated: false }));
    const result = await egressFetch('https://public.example/', OPTIONS, { resolve: async () => [PUBLIC], send });
    expect(result.kind === 'response' && result.status).toBe(304);
  });
});
