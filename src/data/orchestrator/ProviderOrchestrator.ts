import type { Observer, OrbitalRecord } from '../../core';
import type { OrbitalCacheStore } from '../cache/OrbitalCacheStore';
import {
  NotSupportedError,
  type CatalogGroup,
  type DataProvider,
  type FetchResult,
  type ValidationSample,
} from '../types';

export const DEFAULT_TTL_MS = 12 * 3_600_000;

export interface ProviderHealth {
  label: string;
  ok: boolean;
  lastError?: string;
  at: number;
}

export interface ProviderChains {
  catalog: DataProvider[];
  orbital: DataProvider[];
  search: DataProvider[];
  validation: DataProvider[];
}

export interface OrchestratorOptions {
  ttlMs?: number;
  now?: () => number;
}

export class AllProvidersFailedError extends Error {
  constructor(
    operation: string,
    readonly errors: { provider: string; message: string }[],
  ) {
    super(`All providers failed for ${operation}: ${errors.map((e) => `${e.provider}: ${e.message}`).join(' | ')}`);
  }
}

export interface ValidationOutcome {
  provider: string;
  sample?: ValidationSample;
  error?: string;
}

/**
 * Application service over the provider port: cache-first with TTL, ordered
 * fallback between providers, and stale-cache fallback when everything fails.
 */
export class ProviderOrchestrator {
  private readonly health = new Map<string, ProviderHealth>();
  private readonly listeners = new Set<() => void>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly chains: ProviderChains,
    private readonly cache: OrbitalCacheStore,
    options: OrchestratorOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  get ttl() {
    return this.ttlMs;
  }

  /** Stable snapshot (same reference until something changes), safe for useSyncExternalStore. */
  getHealth = (): ProviderHealth[] => this.healthSnapshot;

  private healthSnapshot: ProviderHealth[] = [];

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private record(provider: DataProvider, error?: unknown) {
    this.health.set(provider.label, {
      label: provider.label,
      ok: !error,
      lastError: error ? (error instanceof Error ? error.message : String(error)) : undefined,
      at: this.now(),
    });
    this.healthSnapshot = [...this.health.values()];
    this.listeners.forEach((l) => l());
  }

  isFresh(fetchedAt: number): boolean {
    return this.now() - fetchedAt < this.ttlMs;
  }

  /** Tries each provider in order; NotSupported errors are skipped silently. */
  private async firstSuccessful<T>(
    operation: string,
    providers: DataProvider[],
    call: (p: DataProvider) => Promise<T>,
    accept: (value: T) => boolean = () => true,
  ): Promise<{ value: T; provider: DataProvider }> {
    const errors: { provider: string; message: string }[] = [];
    for (const provider of providers) {
      try {
        const value = await call(provider);
        if (!accept(value)) throw new Error('Empty response');
        this.record(provider);
        return { value, provider };
      } catch (error) {
        if (error instanceof NotSupportedError) continue;
        this.record(provider, error);
        errors.push({ provider: provider.label, message: error instanceof Error ? error.message : String(error) });
      }
    }
    throw new AllProvidersFailedError(operation, errors);
  }

  async getCatalog(
    group: CatalogGroup,
    { limit = 500, force = false }: { limit?: number; force?: boolean } = {},
  ): Promise<FetchResult<OrbitalRecord[]>> {
    const cached = await this.cache.getGroup(group);
    if (cached && !force && this.isFresh(cached.fetchedAt) && cached.records.length > 0) {
      return { data: cached.records.slice(0, limit), source: 'cache', fetchedAt: cached.fetchedAt, stale: false };
    }
    try {
      const { value, provider } = await this.firstSuccessful(
        `catalog ${group}`,
        this.chains.catalog,
        (p) => p.getCatalog(group, limit),
        (records) => records.length > 0,
      );
      const fetchedAt = this.now();
      await this.cache.putGroup(group, { records: value, source: provider.id, fetchedAt });
      return { data: value, source: provider.id, fetchedAt, stale: false };
    } catch (error) {
      if (cached && cached.records.length > 0) {
        return { data: cached.records.slice(0, limit), source: 'cache', fetchedAt: cached.fetchedAt, stale: true };
      }
      throw error;
    }
  }

  async getOrbitalData(noradId: number, { force = false } = {}): Promise<FetchResult<OrbitalRecord>> {
    const cached = await this.cache.getRecord(noradId);
    if (cached && !force && this.isFresh(cached.fetchedAt)) {
      return { data: cached.record, source: 'cache', fetchedAt: cached.fetchedAt, stale: false };
    }
    try {
      const { value, provider } = await this.firstSuccessful(
        `NORAD ${noradId}`,
        this.chains.orbital,
        (p) => p.getOrbitalData(noradId),
        (record) => record !== null,
      );
      const fetchedAt = this.now();
      await this.cache.putRecords([value!], provider.id, fetchedAt);
      return { data: value!, source: provider.id, fetchedAt, stale: false };
    } catch (error) {
      if (cached) return { data: cached.record, source: 'cache', fetchedAt: cached.fetchedAt, stale: true };
      throw error;
    }
  }

  /** Name or NORAD ID search; falls back to the local cache when offline. */
  async search(query: string, limit = 50): Promise<FetchResult<OrbitalRecord[]>> {
    const q = query.trim();
    if (/^\d{1,9}$/.test(q)) {
      const result = await this.getOrbitalData(Number(q));
      return { ...result, data: [result.data] };
    }
    try {
      const { value, provider } = await this.firstSuccessful(`search ${q}`, this.chains.search, (p) =>
        p.search(q),
      );
      const fetchedAt = this.now();
      await this.cache.putRecords(value, provider.id, fetchedAt);
      return { data: value.slice(0, limit), source: provider.id, fetchedAt, stale: false };
    } catch (error) {
      const local = await this.cache.searchRecords(q, limit);
      if (local.length > 0) return { data: local, source: 'cache', fetchedAt: this.now(), stale: true };
      throw error;
    }
  }

  /** Queries every validation source that supports the satellite. Never throws. */
  async getValidationPositions(noradId: number, observer: Observer): Promise<ValidationOutcome[]> {
    const outcomes = await Promise.all(
      this.chains.validation.map(async (provider): Promise<ValidationOutcome | null> => {
        try {
          const sample = await provider.getValidationPosition(noradId, observer);
          this.record(provider);
          return { provider: provider.label, sample };
        } catch (error) {
          if (error instanceof NotSupportedError) return null;
          this.record(provider, error);
          return { provider: provider.label, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
    return outcomes.filter((o): o is ValidationOutcome => o !== null);
  }
}
