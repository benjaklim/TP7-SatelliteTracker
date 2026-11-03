import type { RateLimiter } from './rateLimiter.ts';
import { fetchUpstream, UpstreamError } from './upstream.ts';

const BASE = 'https://www.space-track.org';
const SESSION_TTL_MS = 90 * 60_000;

/** Space-Track uses a cookie session: log in once, reuse the cookie for queries. */
export class SpaceTrackClient {
  private cookie?: string;
  private cookieAt = 0;
  private readonly identity?: string;
  private readonly password?: string;
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;

  constructor(identity: string | undefined, password: string | undefined, limiter: RateLimiter, fetchImpl: typeof fetch = fetch) {
    this.identity = identity;
    this.password = password;
    this.limiter = limiter;
    this.fetchImpl = fetchImpl;
  }

  get configured(): boolean {
    return Boolean(this.identity && this.password);
  }

  private async login(): Promise<string> {
    if (this.cookie && Date.now() - this.cookieAt < SESSION_TTL_MS) return this.cookie;
    if (!this.configured) throw new UpstreamError('Space-Track credentials not configured', 503);
    const body = new URLSearchParams({ identity: this.identity!, password: this.password! });
    const response = await fetchUpstream(`${BASE}/ajaxauth/login`, {
      limiter: this.limiter,
      fetchImpl: this.fetchImpl,
      retries: 1,
      init: { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } },
    });
    const setCookie = response.headers.get('set-cookie');
    const text = await response.text();
    if (!setCookie || /failed/i.test(text)) throw new UpstreamError('Space-Track login failed', 401);
    this.cookie = setCookie.split(';')[0];
    this.cookieAt = Date.now();
    return this.cookie;
  }

  async query(path: string): Promise<unknown> {
    const cookie = await this.login();
    const response = await fetchUpstream(`${BASE}/basicspacedata/query/${path}`, {
      limiter: this.limiter,
      fetchImpl: this.fetchImpl,
      init: { headers: { cookie } },
    });
    return response.json();
  }
}

/** GP query paths (OMM JSON, latest element set, non-decayed objects). */
export const spaceTrackQueries = {
  byNorad: (ids: number[]) => `class/gp/NORAD_CAT_ID/${ids.join(',')}/orderby/NORAD_CAT_ID/format/json`,
  byNamePrefix: (prefix: string, limit: number) =>
    `class/gp/OBJECT_NAME/${encodeURIComponent(prefix)}~~/decay_date/null-val/epoch/%3Enow-10/orderby/NORAD_CAT_ID/limit/${limit}/format/json`,
};
