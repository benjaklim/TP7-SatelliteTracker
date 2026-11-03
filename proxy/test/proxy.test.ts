import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildApp } from '../src/app.ts';
import { TtlCache } from '../src/cache.ts';
import { RateLimiter } from '../src/rateLimiter.ts';

const ISS = [{ OBJECT_NAME: 'ISS (ZARYA)', NORAD_CAT_ID: 25544, EPOCH: '2026-11-02T18:09:49.393152' }];

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  return { impl, calls };
}

describe('RateLimiter', () => {
  it('enforces every window independently', () => {
    let now = 0;
    const limiter = new RateLimiter(
      [
        { limit: 2, windowMs: 1000 },
        { limit: 3, windowMs: 10_000 },
      ],
      () => now,
    );
    assert.equal(limiter.tryAcquire(), true);
    assert.equal(limiter.tryAcquire(), true);
    assert.equal(limiter.tryAcquire(), false);
    assert.equal(limiter.retryAfterMs(), 1000);
    now = 1001;
    assert.equal(limiter.tryAcquire(), true);
    now = 2500;
    assert.equal(limiter.tryAcquire(), false, 'hourly-like window still full');
    assert.ok(limiter.retryAfterMs() > 0);
  });
});

describe('TtlCache', () => {
  it('deduplicates concurrent loads and expires entries', async () => {
    let now = 0;
    const cache = new TtlCache<number>({ now: () => now });
    let loads = 0;
    const load = async () => ++loads;
    const [a, b] = await Promise.all([cache.getOrLoad('k', 100, load), cache.getOrLoad('k', 100, load)]);
    assert.equal(loads, 1);
    assert.equal(a.value, b.value);
    assert.equal((await cache.getOrLoad('k', 100, load)).hit, true);
    now = 200;
    assert.equal(cache.get('k'), undefined);
    assert.equal(cache.getStale('k')?.value, 1);
  });
});

describe('proxy routes', () => {
  it('serves CelesTrak groups and caches them', async () => {
    const { impl, calls } = mockFetch(() => Response.json(ISS));
    const app = buildApp({ fetchImpl: impl });
    const first = await app.inject('/v1/celestrak/group/stations');
    const second = await app.inject('/v1/celestrak/group/stations');
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers['x-cache'], 'MISS');
    assert.equal(second.headers['x-cache'], 'HIT');
    assert.deepEqual(second.json(), ISS);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /GROUP=stations&FORMAT=json/);
  });

  it('rejects unknown groups and invalid ids without calling upstream', async () => {
    const { impl, calls } = mockFetch(() => Response.json([]));
    const app = buildApp({ fetchImpl: impl });
    assert.equal((await app.inject('/v1/celestrak/group/everything')).statusCode, 400);
    assert.equal((await app.inject('/v1/celestrak/catnr/abc')).statusCode, 400);
    assert.equal(calls.length, 0);
  });

  it('returns 503 for providers without credentials', async () => {
    const { impl } = mockFetch(() => Response.json({}));
    const app = buildApp({ fetchImpl: impl });
    assert.equal((await app.inject('/v1/n2yo/positions/25544?lat=0&lon=0&alt=0')).statusCode, 503);
    assert.equal((await app.inject('/v1/spacetrack/catnr/25544')).statusCode, 503);
  });

  it('keeps the N2YO key server-side', async () => {
    const { impl, calls } = mockFetch(() => Response.json({ positions: [] }));
    const app = buildApp({ fetchImpl: impl, n2yoApiKey: 'secret-key' });
    const res = await app.inject('/v1/n2yo/positions/25544?lat=-34.6&lon=-58.4&alt=0');
    assert.equal(res.statusCode, 200);
    assert.match(calls[0], /apiKey=secret-key/);
    assert.doesNotMatch(res.body, /secret-key/);
  });

  it('logs into Space-Track once and reuses the session cookie', async () => {
    const { impl, calls } = mockFetch((url) =>
      url.includes('ajaxauth/login')
        ? new Response('""', { headers: { 'set-cookie': 'chocolatechip=abc; path=/' } })
        : Response.json(ISS),
    );
    const app = buildApp({ fetchImpl: impl, spaceTrackIdentity: 'u', spaceTrackPassword: 'p' });
    assert.equal((await app.inject('/v1/spacetrack/catnr/25544')).statusCode, 200);
    assert.equal((await app.inject('/v1/spacetrack/group/starlink?limit=10')).statusCode, 200);
    assert.equal(calls.filter((c) => c.includes('login')).length, 1);
  });

  it('serves stale data when the upstream fails after expiry', async () => {
    let fail = false;
    const { impl } = mockFetch(() => (fail ? new Response('down', { status: 404 }) : Response.json(ISS)));
    const app = buildApp({ fetchImpl: impl });
    await app.inject('/v1/wtia/iss');
    fail = true;
    await new Promise((r) => setTimeout(r, 1100));
    const res = await app.inject('/v1/wtia/iss');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-cache'], 'STALE');
  });
});
