import { createSatellite, distance3dKm, stateAt } from '../core';
import { ISS, T0 } from '../core/orbital/__fixtures__/omm';
import { MemoryCacheStore } from './cache/OrbitalCacheStore';
import { tleToOmm } from './formats/tle';
import { httpJson } from './http/httpJson';
import { RateLimiter } from './http/rateLimiter';
import { ProviderOrchestrator, AllProvidersFailedError } from './orchestrator/ProviderOrchestrator';
import { CelesTrakProvider } from './providers/CelesTrakProvider';
import { WhereTheIssProvider } from './providers/WhereTheIssProvider';
import { NotSupportedError, type DataProvider } from './types';

const ISS_TLE = [
  'ISS (ZARYA)',
  '1 25544U 98067A   26306.75682168  .00005437  00000+0  10620-3 0  9990',
  '2 25544  51.6331 334.3796 0007124 340.7366  19.3352 15.49154261593232',
] as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeProvider(label: string, impl: Partial<DataProvider>): DataProvider {
  const unsupported = () => Promise.reject(new NotSupportedError('celestrak', 'op'));
  return {
    id: 'celestrak',
    label,
    getCatalog: unsupported,
    getOrbitalData: unsupported,
    search: unsupported,
    getValidationPosition: unsupported,
    ...impl,
  };
}

describe('tleToOmm', () => {
  it('converts a TLE into an OMM record equivalent to CelesTrak JSON', () => {
    const omm = tleToOmm(...ISS_TLE);
    expect(omm.NORAD_CAT_ID).toBe(25544);
    expect(omm.OBJECT_ID).toBe('1998-067A');
    expect(omm.EPOCH.startsWith('2026-11-02T18:09:49')).toBe(true);
    expect(omm.BSTAR).toBeCloseTo(0.0001062, 10);
    expect(omm.ECCENTRICITY).toBeCloseTo(0.0007124, 10);
  });

  it('propagates to the same place as the OMM version (< 0.1 km)', () => {
    const fromTle = stateAt(createSatellite(tleToOmm(...ISS_TLE)), T0)!;
    const fromOmm = stateAt(createSatellite(ISS), T0)!;
    expect(distance3dKm(fromTle, fromOmm)).toBeLessThan(0.1);
  });
});

describe('httpJson', () => {
  it('retries 5xx with backoff and then succeeds', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json({ error: 'x' }, 503))
      .mockResolvedValueOnce(json([1, 2]));
    const limiter = new RateLimiter([{ limit: 10, windowMs: 1000 }]);
    await expect(
      httpJson('http://x', { provider: 'celestrak', limiter, fetchImpl, baseDelayMs: 1 }),
    ).resolves.toEqual([1, 2]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry 4xx', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({}, 404));
    const limiter = new RateLimiter([{ limit: 10, windowMs: 1000 }]);
    await expect(httpJson('http://x', { provider: 'celestrak', limiter, fetchImpl })).rejects.toMatchObject({
      status: 404,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails fast when the local rate limit is exhausted', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => json([]));
    const limiter = new RateLimiter([{ limit: 1, windowMs: 60_000 }]);
    await httpJson('http://x', { provider: 'wtia', limiter, fetchImpl });
    await expect(httpJson('http://x', { provider: 'wtia', limiter, fetchImpl })).rejects.toMatchObject({
      status: 429,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('providers', () => {
  it('CelesTrak uses the SupGP Starlink set and the proxy when configured', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => json([ISS]));
    const direct = new CelesTrakProvider({ fetchImpl });
    const viaProxy = new CelesTrakProvider({ fetchImpl, proxyUrl: 'http://proxy' });
    await direct.getCatalog('starlink', 10);
    await viaProxy.getCatalog('stations', 10);
    expect(fetchImpl.mock.calls[0][0]).toContain('sup-gp.php?FILE=starlink');
    expect(fetchImpl.mock.calls[1][0]).toBe('http://proxy/v1/celestrak/group/stations?limit=10');
  });

  it('CelesTrak falls back to the GP Starlink group when SupGP answers 403', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementationOnce(async () => new Response('Please limit requests to once every 2 hours', { status: 403 }))
      .mockImplementationOnce(async () => json([ISS]));
    const records = await new CelesTrakProvider({ fetchImpl }).getCatalog('starlink', 5);
    expect(records).toEqual([{ ...ISS, TP7_DATASET: 'GP' }]);
    expect(fetchImpl.mock.calls[1][0]).toContain('GROUP=starlink');
  });

  it('Where the ISS at? only serves the ISS', async () => {
    const wtia = new WhereTheIssProvider();
    await expect(wtia.getOrbitalData(41866)).rejects.toBeInstanceOf(NotSupportedError);
  });
});

describe('ProviderOrchestrator', () => {
  let now = T0;
  const clock = () => now;

  beforeEach(() => {
    now = T0;
  });

  it('falls back to the next provider and caches the result', async () => {
    const failing = fakeProvider('A', { getCatalog: () => Promise.reject(new Error('down')) });
    const working = fakeProvider('B', { getCatalog: async () => [ISS] });
    const cache = new MemoryCacheStore();
    const orchestrator = new ProviderOrchestrator(
      { catalog: [failing, working], orbital: [], search: [], validation: [] },
      cache,
      { now: clock },
    );
    const result = await orchestrator.getCatalog('stations');
    expect(result.data).toEqual([ISS]);
    expect(orchestrator.getHealth().map((h) => [h.label, h.ok])).toEqual([
      ['A', false],
      ['B', true],
    ]);
    const again = await orchestrator.getCatalog('stations');
    expect(again.source).toBe('cache');
    expect((await cache.getRecord(25544))?.record).toEqual(ISS);
  });

  it('refreshes after the TTL and serves stale data when every provider fails', async () => {
    let up = true;
    const provider = fakeProvider('A', {
      getOrbitalData: async () => {
        if (!up) throw new Error('offline');
        return ISS;
      },
    });
    const orchestrator = new ProviderOrchestrator(
      { catalog: [], orbital: [provider], search: [], validation: [] },
      new MemoryCacheStore(),
      { now: clock, ttlMs: 1000 },
    );
    expect((await orchestrator.getOrbitalData(25544)).source).toBe('celestrak');
    now += 500;
    expect((await orchestrator.getOrbitalData(25544)).source).toBe('cache');
    now += 1000;
    up = false;
    const stale = await orchestrator.getOrbitalData(25544);
    expect(stale.stale).toBe(true);
    expect(stale.fetchedAt).toBe(T0);
  });

  it('throws when nothing is cached and every provider fails', async () => {
    const provider = fakeProvider('A', { getOrbitalData: () => Promise.reject(new Error('x')) });
    const orchestrator = new ProviderOrchestrator(
      { catalog: [], orbital: [provider], search: [], validation: [] },
      new MemoryCacheStore(),
    );
    await expect(orchestrator.getOrbitalData(1)).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it('searches by NORAD id through orbital data and by name offline', async () => {
    const provider = fakeProvider('A', {
      getOrbitalData: async () => ISS,
      search: () => Promise.reject(new Error('offline')),
    });
    const orchestrator = new ProviderOrchestrator(
      { catalog: [], orbital: [provider], search: [provider], validation: [] },
      new MemoryCacheStore(),
    );
    expect((await orchestrator.search('25544')).data[0].OBJECT_NAME).toBe('ISS (ZARYA)');
    const offline = await orchestrator.search('zarya');
    expect(offline.stale).toBe(true);
    expect(offline.data).toHaveLength(1);
  });

  it('collects validation samples skipping unsupported providers', async () => {
    const sample = { provider: 'wtia' as const, noradId: 25544, timestamp: T0, latitude: 1, longitude: 2, altitudeKm: 420 };
    const orchestrator = new ProviderOrchestrator(
      {
        catalog: [],
        orbital: [],
        search: [],
        validation: [
          fakeProvider('unsupported', {}),
          fakeProvider('ok', { getValidationPosition: async () => sample }),
          fakeProvider('broken', { getValidationPosition: () => Promise.reject(new Error('503')) }),
        ],
      },
      new MemoryCacheStore(),
    );
    const outcomes = await orchestrator.getValidationPositions(25544, { latitude: 0, longitude: 0, altitudeKm: 0 });
    expect(outcomes).toEqual([
      { provider: 'ok', sample },
      { provider: 'broken', error: '503' },
    ]);
  });
});
