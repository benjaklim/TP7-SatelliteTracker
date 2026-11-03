import * as SQLite from 'expo-sqlite';

import type { OrbitalRecord } from '../../core';
import type { CatalogGroup, ProviderId } from '../types';
import type { CachedRecord, CachedRecords, OrbitalCacheStore } from './OrbitalCacheStore';

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS orbital_records (
  norad_id INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  record TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orbital_records_name ON orbital_records(name);
CREATE TABLE IF NOT EXISTS catalog_groups (
  group_id TEXT PRIMARY KEY NOT NULL,
  norad_ids TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
`;

interface RecordRow {
  record: string;
  source: ProviderId;
  fetched_at: number;
}

/** Offline-first orbital cache: survives restarts so passes can be computed without network. */
export class SqliteCacheStore implements OrbitalCacheStore {
  private dbPromise?: Promise<SQLite.SQLiteDatabase>;

  constructor(private readonly name = 'orbital-cache.db') {}

  private db() {
    this.dbPromise ??= SQLite.openDatabaseAsync(this.name).then(async (db) => {
      await db.execAsync(SCHEMA);
      return db;
    });
    return this.dbPromise;
  }

  async getGroup(group: CatalogGroup): Promise<CachedRecords | null> {
    const db = await this.db();
    const row = await db.getFirstAsync<{ norad_ids: string; source: ProviderId; fetched_at: number }>(
      'SELECT norad_ids, source, fetched_at FROM catalog_groups WHERE group_id = ?',
      group,
    );
    if (!row) return null;
    const ids: number[] = JSON.parse(row.norad_ids);
    if (ids.length === 0) return { records: [], source: row.source, fetchedAt: row.fetched_at };
    const rows = await db.getAllAsync<RecordRow>(
      `SELECT record, source, fetched_at FROM orbital_records WHERE norad_id IN (${ids.map(() => '?').join(',')})`,
      ...ids,
    );
    return { records: rows.map((r) => JSON.parse(r.record)), source: row.source, fetchedAt: row.fetched_at };
  }

  async putGroup(group: CatalogGroup, data: CachedRecords): Promise<void> {
    const db = await this.db();
    await db.withTransactionAsync(async () => {
      await this.insertRecords(db, data.records, data.source, data.fetchedAt);
      await db.runAsync(
        'INSERT OR REPLACE INTO catalog_groups (group_id, norad_ids, source, fetched_at) VALUES (?, ?, ?, ?)',
        group,
        JSON.stringify(data.records.map((r) => Number(r.NORAD_CAT_ID))),
        data.source,
        data.fetchedAt,
      );
    });
  }

  async getRecord(noradId: number): Promise<CachedRecord | null> {
    const db = await this.db();
    const row = await db.getFirstAsync<RecordRow>(
      'SELECT record, source, fetched_at FROM orbital_records WHERE norad_id = ?',
      noradId,
    );
    return row ? { record: JSON.parse(row.record), source: row.source, fetchedAt: row.fetched_at } : null;
  }

  async putRecords(records: OrbitalRecord[], source: ProviderId, fetchedAt: number): Promise<void> {
    const db = await this.db();
    await db.withTransactionAsync(() => this.insertRecords(db, records, source, fetchedAt));
  }

  async searchRecords(query: string, limit: number): Promise<OrbitalRecord[]> {
    const db = await this.db();
    const q = query.trim().toUpperCase();
    const rows = await db.getAllAsync<{ record: string }>(
      'SELECT record FROM orbital_records WHERE upper(name) LIKE ? OR norad_id = ? LIMIT ?',
      `%${q}%`,
      Number(q) || -1,
      limit,
    );
    return rows.map((r) => JSON.parse(r.record));
  }

  private async insertRecords(
    db: SQLite.SQLiteDatabase,
    records: OrbitalRecord[],
    source: ProviderId,
    fetchedAt: number,
  ) {
    const statement = await db.prepareAsync(
      'INSERT OR REPLACE INTO orbital_records (norad_id, name, record, source, fetched_at) VALUES (?, ?, ?, ?, ?)',
    );
    try {
      for (const r of records) {
        await statement.executeAsync(Number(r.NORAD_CAT_ID), r.OBJECT_NAME, JSON.stringify(r), source, fetchedAt);
      }
    } finally {
      await statement.finalizeAsync();
    }
  }
}
