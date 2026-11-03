import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface Entry<T> {
  value: T;
  storedAt: number;
  expiresAt: number;
}

export interface TtlCacheOptions {
  now?: () => number;
  /**
   * Optional JSON snapshot file. CelesTrak answers 403 to repeated downloads of
   * unchanged files (once every 2 h), so the cache must survive proxy restarts.
   */
  persistPath?: string;
}

/** In-memory TTL cache with in-flight de-duplication, stale fallback and optional disk snapshot. */
export class TtlCache<T = unknown> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly now: () => number;
  private readonly persistPath?: string;
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor(options: TtlCacheOptions = {}) {
    this.now = options.now ?? Date.now;
    this.persistPath = options.persistPath;
    if (this.persistPath) this.load();
  }

  private load() {
    try {
      const raw = JSON.parse(readFileSync(this.persistPath!, 'utf8')) as Record<string, Entry<T>>;
      for (const [key, entry] of Object.entries(raw)) this.entries.set(key, entry);
    } catch {
      // No snapshot yet.
    }
  }

  private scheduleSave() {
    if (!this.persistPath || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      mkdirSync(dirname(this.persistPath!), { recursive: true });
      writeFileSync(this.persistPath!, JSON.stringify(Object.fromEntries(this.entries)));
    }, 500);
    this.saveTimer.unref?.();
  }

  get(key: string): Entry<T> | undefined {
    const entry = this.entries.get(key);
    return entry && entry.expiresAt > this.now() ? entry : undefined;
  }

  /** Expired entries are kept so they can be served when every upstream fails. */
  getStale(key: string): Entry<T> | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: T, ttlMs: number): void {
    const t = this.now();
    this.entries.set(key, { value, storedAt: t, expiresAt: t + ttlMs });
    this.scheduleSave();
  }

  async getOrLoad(
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<{ value: T; hit: boolean; storedAt: number }> {
    const cached = this.get(key);
    if (cached) return { value: cached.value, hit: true, storedAt: cached.storedAt };
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = load().finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    const value = await pending;
    this.set(key, value, ttlMs);
    return { value, hit: false, storedAt: this.now() };
  }
}
