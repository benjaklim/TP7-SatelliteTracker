import type { Observer, OrbitalRecord } from '../core';

export type ProviderId = 'celestrak' | 'spacetrack' | 'n2yo' | 'wtia';

export type CatalogGroup = 'stations' | 'starlink' | 'gps' | 'weather' | 'geo' | 'visual';

export const CATALOG_GROUPS: { id: CatalogGroup; label: string }[] = [
  { id: 'stations', label: 'Space stations' },
  { id: 'visual', label: 'Brightest' },
  { id: 'starlink', label: 'Starlink' },
  { id: 'gps', label: 'GPS' },
  { id: 'weather', label: 'Weather' },
  { id: 'geo', label: 'GEO' },
];

/** Position reported by an independent source, used to validate our SGP4 output. */
export interface ValidationSample {
  provider: ProviderId;
  noradId: number;
  timestamp: number;
  latitude: number;
  longitude: number;
  altitudeKm: number;
}

/**
 * Common port for every orbital data source. Providers that cannot serve an
 * operation throw `NotSupportedError` so the orchestrator moves to the next one.
 */
export interface DataProvider {
  readonly id: ProviderId;
  /** Human-readable name, also used as the key for provider health. */
  readonly label: string;
  getCatalog(group: CatalogGroup, limit: number): Promise<OrbitalRecord[]>;
  getOrbitalData(noradId: number): Promise<OrbitalRecord | null>;
  search(query: string): Promise<OrbitalRecord[]>;
  getValidationPosition(noradId: number, observer: Observer): Promise<ValidationSample>;
}

export class NotSupportedError extends Error {
  constructor(provider: ProviderId, operation: string) {
    super(`${provider} does not support ${operation}`);
  }
}

export class ProviderHttpError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly status: number,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface FetchResult<T> {
  data: T;
  source: ProviderId | 'cache';
  fetchedAt: number;
  /** True when every provider failed and expired cached data was served. */
  stale: boolean;
}
