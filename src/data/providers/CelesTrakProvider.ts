import type { Observer, OrbitalRecord } from '../../core';
import { httpJson } from '../http/httpJson';
import { CLIENT_LIMITS, RateLimiter } from '../http/rateLimiter';
import {
  NotSupportedError,
  ProviderHttpError,
  type CatalogGroup,
  type DataProvider,
  type ValidationSample,
} from '../types';

const DIRECT = 'https://celestrak.org/NORAD/elements';

const DIRECT_GROUP: Record<CatalogGroup, string> = {
  stations: 'stations',
  starlink: 'starlink',
  gps: 'gps-ops',
  weather: 'weather',
  geo: 'geo',
  visual: 'visual',
};

export interface CelesTrakOptions {
  /** When set, requests go through the TP7 proxy (shared cache); otherwise straight to CelesTrak. */
  proxyUrl?: string;
  fetchImpl?: typeof fetch;
  limiter?: RateLimiter;
}

/**
 * Primary source. Starlink uses the supplemental GP set (SupGP) derived from
 * SpaceX ephemerides, which is more accurate than the regular GP catalog.
 */
export class CelesTrakProvider implements DataProvider {
  readonly id = 'celestrak' as const;
  readonly label: string;
  private readonly limiter: RateLimiter;

  constructor(private readonly options: CelesTrakOptions = {}) {
    this.label = options.proxyUrl ? 'CelesTrak (proxy)' : 'CelesTrak (direct)';
    this.limiter = options.limiter ?? new RateLimiter(CLIENT_LIMITS.celestrak);
  }

  private get<T>(url: string) {
    return httpJson<T>(url, { provider: this.id, limiter: this.limiter, fetchImpl: this.options.fetchImpl });
  }

  private url(proxyPath: string, directPath: string) {
    return this.options.proxyUrl ? `${this.options.proxyUrl}/v1/celestrak${proxyPath}` : `${DIRECT}${directPath}`;
  }

  async getCatalog(group: CatalogGroup, limit: number): Promise<OrbitalRecord[]> {
    const gpUrl = this.url(`/group/${group}?limit=${limit}`, `/gp.php?GROUP=${DIRECT_GROUP[group]}&FORMAT=json`);
    if (group !== 'starlink') return (await this.get<OrbitalRecord[]>(gpUrl)).slice(0, limit);
    try {
      const supGp = this.url(`/supgp/starlink?limit=${limit}`, '/supplemental/sup-gp.php?FILE=starlink&FORMAT=json');
      return (await this.get<OrbitalRecord[]>(supGp)).slice(0, limit);
    } catch (error) {
      // CelesTrak answers 403 when the same file is re-downloaded within 2 h: use the regular GP set.
      if (error instanceof ProviderHttpError && error.status === 403) {
        return (await this.get<OrbitalRecord[]>(gpUrl)).slice(0, limit);
      }
      throw error;
    }
  }

  async getOrbitalData(noradId: number): Promise<OrbitalRecord | null> {
    const records = await this.get<OrbitalRecord[]>(
      this.url(`/catnr/${noradId}`, `/gp.php?CATNR=${noradId}&FORMAT=json`),
    );
    return records[0] ?? null;
  }

  async search(query: string): Promise<OrbitalRecord[]> {
    const q = encodeURIComponent(query.trim());
    return this.get<OrbitalRecord[]>(this.url(`/search?name=${q}`, `/gp.php?NAME=${q}&FORMAT=json`));
  }

  getValidationPosition(_noradId: number, _observer: Observer): Promise<ValidationSample> {
    return Promise.reject(new NotSupportedError(this.id, 'validation positions'));
  }
}
