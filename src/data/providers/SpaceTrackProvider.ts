import type { Observer, OrbitalRecord } from '../../core';
import { httpJson, PROXY_TIMEOUT_MS } from '../http/httpJson';
import { CLIENT_LIMITS, RateLimiter } from '../http/rateLimiter';
import {
  NotSupportedError,
  type CatalogGroup,
  type DataProvider,
  type ValidationSample,
} from '../types';

/** Space-Track returns every OMM field as a string; normalize the ones SGP4 and the UI rely on. */
function normalize(record: Record<string, unknown>): OrbitalRecord {
  return {
    ...(record as unknown as OrbitalRecord),
    NORAD_CAT_ID: Number(record.NORAD_CAT_ID),
    OBJECT_NAME: String(record.OBJECT_NAME),
    EPOCH: String(record.EPOCH),
  };
}

/**
 * Official 18th SDS catalog. Credentials never reach the app: every call goes
 * through the proxy, which owns the session cookie and the 30/min–300/h budget.
 */
export class SpaceTrackProvider implements DataProvider {
  readonly id = 'spacetrack' as const;
  readonly label = 'Space-Track (proxy)';
  private readonly limiter: RateLimiter;

  constructor(
    private readonly proxyUrl: string,
    private readonly fetchImpl?: typeof fetch,
    limiter?: RateLimiter,
  ) {
    this.limiter = limiter ?? new RateLimiter(CLIENT_LIMITS.spacetrack);
  }

  private get<T>(path: string) {
    return httpJson<T>(`${this.proxyUrl}/v1/spacetrack${path}`, {
      provider: this.id,
      limiter: this.limiter,
      fetchImpl: this.fetchImpl,
      retries: 1,
      timeoutMs: PROXY_TIMEOUT_MS,
    });
  }

  async getCatalog(group: CatalogGroup, limit: number): Promise<OrbitalRecord[]> {
    const records = await this.get<Record<string, unknown>[]>(`/group/${group}?limit=${limit}`);
    return records.map(normalize);
  }

  async getOrbitalData(noradId: number): Promise<OrbitalRecord | null> {
    const records = await this.get<Record<string, unknown>[]>(`/catnr/${noradId}`);
    return records[0] ? normalize(records[0]) : null;
  }

  search(): Promise<OrbitalRecord[]> {
    return Promise.reject(new NotSupportedError(this.id, 'search'));
  }

  getValidationPosition(_noradId: number, _observer: Observer): Promise<ValidationSample> {
    return Promise.reject(new NotSupportedError(this.id, 'validation positions'));
  }
}
