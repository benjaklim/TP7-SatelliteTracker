import type { OrbitalRecord } from '../../core';
import type { CatalogGroup, ProviderId } from '../types';

export interface CachedRecords {
  records: OrbitalRecord[];
  source: ProviderId;
  fetchedAt: number;
}

export interface CachedRecord {
  record: OrbitalRecord;
  source: ProviderId;
  fetchedAt: number;
}

/** Persistence port for orbital data (SQLite on device, memory in tests). */
export interface OrbitalCacheStore {
  getGroup(group: CatalogGroup): Promise<CachedRecords | null>;
  putGroup(group: CatalogGroup, data: CachedRecords): Promise<void>;
  getRecord(noradId: number): Promise<CachedRecord | null>;
  putRecords(records: OrbitalRecord[], source: ProviderId, fetchedAt: number): Promise<void>;
  /** All cached records whose name or NORAD ID matches. Used for offline search. */
  searchRecords(query: string, limit: number): Promise<OrbitalRecord[]>;
}

export class MemoryCacheStore implements OrbitalCacheStore {
  private readonly groups = new Map<CatalogGroup, CachedRecords>();
  private readonly records = new Map<number, CachedRecord>();

  async getGroup(group: CatalogGroup) {
    return this.groups.get(group) ?? null;
  }

  async putGroup(group: CatalogGroup, data: CachedRecords) {
    this.groups.set(group, data);
    await this.putRecords(data.records, data.source, data.fetchedAt);
  }

  async getRecord(noradId: number) {
    return this.records.get(noradId) ?? null;
  }

  async putRecords(records: OrbitalRecord[], source: ProviderId, fetchedAt: number) {
    for (const record of records) {
      this.records.set(Number(record.NORAD_CAT_ID), { record, source, fetchedAt });
    }
  }

  async searchRecords(query: string, limit: number) {
    const q = query.trim().toUpperCase();
    return [...this.records.values()]
      .map((r) => r.record)
      .filter((r) => r.OBJECT_NAME.toUpperCase().includes(q) || String(r.NORAD_CAT_ID) === q)
      .slice(0, limit);
  }
}
