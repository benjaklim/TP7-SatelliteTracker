import type { Observer, OrbitalRecord } from '../../core';
import { tleToOmm } from '../formats/tle';
import { httpJson } from '../http/httpJson';
import { CLIENT_LIMITS, RateLimiter } from '../http/rateLimiter';
import { NotSupportedError, type DataProvider, type ValidationSample } from '../types';

export const ISS_NORAD_ID = 25544;
const DIRECT = 'https://api.wheretheiss.at/v1/satellites/25544';

interface WtiaPosition {
  latitude: number;
  longitude: number;
  altitude: number;
  timestamp: number;
}

interface WtiaTle {
  name: string;
  line1: string;
  line2: string;
}

/** ISS-only source (~1 req/s, no key). Works through the proxy or directly. */
export class WhereTheIssProvider implements DataProvider {
  readonly id = 'wtia' as const;
  readonly label: string;
  private readonly limiter: RateLimiter;

  constructor(
    private readonly proxyUrl?: string,
    private readonly fetchImpl?: typeof fetch,
    limiter?: RateLimiter,
  ) {
    this.label = proxyUrl ? 'Where the ISS at? (proxy)' : 'Where the ISS at? (direct)';
    this.limiter = limiter ?? new RateLimiter(CLIENT_LIMITS.wtia);
  }

  private get<T>(proxyPath: string, directPath: string) {
    const url = this.proxyUrl ? `${this.proxyUrl}/v1/wtia/iss${proxyPath}` : `${DIRECT}${directPath}`;
    return httpJson<T>(url, { provider: this.id, limiter: this.limiter, fetchImpl: this.fetchImpl, retries: 1 });
  }

  getCatalog(): Promise<OrbitalRecord[]> {
    return Promise.reject(new NotSupportedError(this.id, 'catalogs'));
  }

  async getOrbitalData(noradId: number): Promise<OrbitalRecord | null> {
    if (noradId !== ISS_NORAD_ID) throw new NotSupportedError(this.id, `NORAD ${noradId}`);
    const tle = await this.get<WtiaTle>('/tle', '/tles?format=json');
    return tleToOmm(tle.name === 'iss' ? 'ISS (ZARYA)' : tle.name, tle.line1, tle.line2);
  }

  search(): Promise<OrbitalRecord[]> {
    return Promise.reject(new NotSupportedError(this.id, 'search'));
  }

  async getValidationPosition(noradId: number, _observer: Observer): Promise<ValidationSample> {
    if (noradId !== ISS_NORAD_ID) throw new NotSupportedError(this.id, `NORAD ${noradId}`);
    const p = await this.get<WtiaPosition>('', '?units=kilometers');
    return {
      provider: this.id,
      noradId,
      timestamp: p.timestamp * 1000,
      latitude: p.latitude,
      longitude: p.longitude,
      altitudeKm: p.altitude,
    };
  }
}
