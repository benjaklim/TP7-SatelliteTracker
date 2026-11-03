import type { Observer, OrbitalRecord } from '../../core';
import { tleToOmm } from '../formats/tle';
import { httpJson } from '../http/httpJson';
import { CLIENT_LIMITS, RateLimiter } from '../http/rateLimiter';
import { NotSupportedError, type DataProvider, type ValidationSample } from '../types';

interface N2yoPositions {
  info: { satid: number; satname: string };
  positions: { satlatitude: number; satlongitude: number; sataltitude: number; timestamp: number }[];
}

interface N2yoTle {
  info: { satid: number; satname: string };
  tle: string;
}

/** Independent cross-check source. The API key lives only in the proxy. */
export class N2yoProvider implements DataProvider {
  readonly id = 'n2yo' as const;
  readonly label = 'N2YO (proxy)';
  private readonly limiter: RateLimiter;

  constructor(
    private readonly proxyUrl: string,
    private readonly fetchImpl?: typeof fetch,
    limiter?: RateLimiter,
  ) {
    this.limiter = limiter ?? new RateLimiter(CLIENT_LIMITS.n2yo);
  }

  private get<T>(path: string) {
    return httpJson<T>(`${this.proxyUrl}/v1/n2yo${path}`, {
      provider: this.id,
      limiter: this.limiter,
      fetchImpl: this.fetchImpl,
      retries: 1,
    });
  }

  getCatalog(): Promise<OrbitalRecord[]> {
    return Promise.reject(new NotSupportedError(this.id, 'catalogs'));
  }

  async getOrbitalData(noradId: number): Promise<OrbitalRecord | null> {
    const data = await this.get<N2yoTle>(`/tle/${noradId}`);
    if (!data.tle) return null;
    const [line1, line2] = data.tle.split(/\r?\n/);
    return tleToOmm(data.info.satname, line1, line2);
  }

  search(): Promise<OrbitalRecord[]> {
    return Promise.reject(new NotSupportedError(this.id, 'search'));
  }

  async getValidationPosition(noradId: number, observer: Observer): Promise<ValidationSample> {
    const { latitude, longitude, altitudeKm } = observer;
    const data = await this.get<N2yoPositions>(
      `/positions/${noradId}?lat=${latitude}&lon=${longitude}&alt=${Math.round(altitudeKm * 1000)}`,
    );
    const p = data.positions?.[0];
    if (!p) throw new Error(`N2YO returned no position for ${noradId}`);
    return {
      provider: this.id,
      noradId,
      timestamp: p.timestamp * 1000,
      latitude: p.satlatitude,
      longitude: p.satlongitude,
      altitudeKm: p.sataltitude,
    };
  }
}
