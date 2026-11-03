import Fastify, { type FastifyReply } from 'fastify';

import { TtlCache } from './cache.ts';
import { PROVIDER_LIMITS, RateLimiter, type ProviderName } from './rateLimiter.ts';
import { SpaceTrackClient, spaceTrackQueries } from './spaceTrack.ts';
import { fetchUpstream, UpstreamError } from './upstream.ts';

export interface AppConfig {
  spaceTrackIdentity?: string;
  spaceTrackPassword?: string;
  n2yoApiKey?: string;
  fetchImpl?: typeof fetch;
  logger?: boolean;
}

const HOUR = 3_600_000;
const TTL = {
  orbital: 2 * HOUR, // CelesTrak refreshes GP data a few times a day; the app keeps 12 h on device.
  n2yo: 5_000,
  wtia: 1_000,
} as const;

/** Groups the app may request. Keeps the proxy from becoming an open relay. */
export const GROUPS: Record<string, { celestrak: string; spaceTrack: { prefix?: string; ids?: number[] } }> = {
  stations: { celestrak: 'stations', spaceTrack: { ids: [25544, 48274, 49044] } },
  starlink: { celestrak: 'starlink', spaceTrack: { prefix: 'STARLINK' } },
  gps: { celestrak: 'gps-ops', spaceTrack: { prefix: 'NAVSTAR' } },
  weather: { celestrak: 'weather', spaceTrack: { prefix: 'NOAA' } },
  geo: { celestrak: 'geo', spaceTrack: { prefix: 'GOES' } },
  visual: { celestrak: 'visual', spaceTrack: { ids: [25544, 20580, 25338, 28654, 33591] } },
};

const MAX_LIMIT = 2000;

function parseLimit(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_LIMIT) : fallback;
}

function parseNorad(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || id > 999_999_999) {
    throw new UpstreamError('Invalid NORAD catalog number', 400);
  }
  return id;
}

export function buildApp(config: AppConfig = {}) {
  const app = Fastify({ logger: config.logger ?? false });
  const fetchImpl = config.fetchImpl ?? fetch;
  const limiters = Object.fromEntries(
    Object.entries(PROVIDER_LIMITS).map(([name, windows]) => [name, new RateLimiter(windows)]),
  ) as Record<ProviderName, RateLimiter>;
  const cache = new TtlCache<unknown>();
  const spaceTrack = new SpaceTrackClient(
    config.spaceTrackIdentity,
    config.spaceTrackPassword,
    limiters.spacetrack,
    fetchImpl,
  );

  async function getJson(provider: ProviderName, url: string): Promise<unknown> {
    const response = await fetchUpstream(url, { limiter: limiters[provider], fetchImpl });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new UpstreamError(text.slice(0, 120) || 'Empty upstream response', 404);
    }
  }

  /** Cache-aside with stale fallback; tags responses so the app can show data age. */
  async function cached(reply: FastifyReply, key: string, ttl: number, load: () => Promise<unknown>) {
    try {
      const { value, hit, storedAt } = await cache.getOrLoad(key, ttl, load);
      reply.header('x-cache', hit ? 'HIT' : 'MISS').header('x-fetched-at', new Date(storedAt).toISOString());
      return value;
    } catch (error) {
      const stale = cache.getStale(key);
      if (stale && !(error instanceof UpstreamError && error.status === 400)) {
        reply.header('x-cache', 'STALE').header('x-fetched-at', new Date(stale.storedAt).toISOString());
        return stale.value;
      }
      throw error;
    }
  }

  const limitList = (data: unknown, limit: number) => (Array.isArray(data) ? data.slice(0, limit) : data);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof UpstreamError) {
      if (error.retryAfterMs) reply.header('retry-after', Math.ceil(error.retryAfterMs / 1000));
      return reply.status(error.status).send({ error: error.message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: 'Internal proxy error' });
  });

  app.get('/health', async () => ({
    ok: true,
    providers: {
      celestrak: true,
      spacetrack: spaceTrack.configured,
      n2yo: Boolean(config.n2yoApiKey),
      wtia: true,
    },
    usage: Object.fromEntries(Object.entries(limiters).map(([k, l]) => [k, l.usage()])),
  }));

  // --- CelesTrak (no key) ---------------------------------------------------
  const CELESTRAK = 'https://celestrak.org';

  app.get<{ Params: { group: string }; Querystring: { limit?: string } }>(
    '/v1/celestrak/group/:group',
    async (request, reply) => {
      const group = GROUPS[request.params.group];
      if (!group) throw new UpstreamError('Unknown group', 400);
      const data = await cached(reply, `celestrak:group:${group.celestrak}`, TTL.orbital, () =>
        getJson('celestrak', `${CELESTRAK}/NORAD/elements/gp.php?GROUP=${group.celestrak}&FORMAT=json`),
      );
      return limitList(data, parseLimit(request.query.limit, MAX_LIMIT));
    },
  );

  app.get<{ Querystring: { limit?: string } }>('/v1/celestrak/supgp/starlink', async (request, reply) => {
    const data = await cached(reply, 'celestrak:supgp:starlink', TTL.orbital, () =>
      getJson('celestrak', `${CELESTRAK}/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=json`),
    );
    return limitList(data, parseLimit(request.query.limit, MAX_LIMIT));
  });

  app.get<{ Params: { id: string } }>('/v1/celestrak/catnr/:id', async (request, reply) => {
    const id = parseNorad(request.params.id);
    return cached(reply, `celestrak:catnr:${id}`, TTL.orbital, () =>
      getJson('celestrak', `${CELESTRAK}/NORAD/elements/gp.php?CATNR=${id}&FORMAT=json`),
    );
  });

  app.get<{ Querystring: { name?: string } }>('/v1/celestrak/search', async (request, reply) => {
    const name = (request.query.name ?? '').trim();
    if (name.length < 2 || name.length > 40) throw new UpstreamError('Search term must be 2-40 chars', 400);
    return cached(reply, `celestrak:name:${name.toUpperCase()}`, TTL.orbital, () =>
      getJson('celestrak', `${CELESTRAK}/NORAD/elements/gp.php?NAME=${encodeURIComponent(name)}&FORMAT=json`),
    );
  });

  // --- Space-Track (credentials stay here) -----------------------------------
  app.get<{ Params: { group: string }; Querystring: { limit?: string } }>(
    '/v1/spacetrack/group/:group',
    async (request, reply) => {
      const group = GROUPS[request.params.group];
      if (!group) throw new UpstreamError('Unknown group', 400);
      const limit = parseLimit(request.query.limit, 500);
      const { prefix, ids } = group.spaceTrack;
      const path = ids ? spaceTrackQueries.byNorad(ids) : spaceTrackQueries.byNamePrefix(prefix!, limit);
      const data = await cached(reply, `spacetrack:${path}`, TTL.orbital, () => spaceTrack.query(path));
      return limitList(data, limit);
    },
  );

  app.get<{ Params: { id: string } }>('/v1/spacetrack/catnr/:id', async (request, reply) => {
    const path = spaceTrackQueries.byNorad([parseNorad(request.params.id)]);
    return cached(reply, `spacetrack:${path}`, TTL.orbital, () => spaceTrack.query(path));
  });

  // --- N2YO (API key stays here) ---------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { lat?: string; lon?: string; alt?: string } }>(
    '/v1/n2yo/positions/:id',
    async (request, reply) => {
      if (!config.n2yoApiKey) throw new UpstreamError('N2YO API key not configured', 503);
      const id = parseNorad(request.params.id);
      const lat = Number(request.query.lat ?? 0);
      const lon = Number(request.query.lon ?? 0);
      const alt = Number(request.query.alt ?? 0);
      if (![lat, lon, alt].every(Number.isFinite)) throw new UpstreamError('Invalid observer', 400);
      const key = `n2yo:pos:${id}:${lat.toFixed(2)}:${lon.toFixed(2)}`;
      return cached(reply, key, TTL.n2yo, () =>
        getJson(
          'n2yo',
          `https://api.n2yo.com/rest/v1/satellite/positions/${id}/${lat}/${lon}/${alt}/1/&apiKey=${config.n2yoApiKey}`,
        ),
      );
    },
  );

  // --- Where the ISS at? (ISS only, ~1 req/s) ----------------------------------
  app.get('/v1/wtia/iss', async (_request, reply) =>
    cached(reply, 'wtia:iss', TTL.wtia, () =>
      getJson('wtia', 'https://api.wheretheiss.at/v1/satellites/25544?units=kilometers'),
    ),
  );

  return app;
}
