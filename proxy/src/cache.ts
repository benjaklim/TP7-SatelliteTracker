interface Entry<T> {
  value: T;
  storedAt: number;
  expiresAt: number;
}

/** In-memory TTL cache with in-flight de-duplication and stale fallback. */
export class TtlCache<T = unknown> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
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
  }

  async getOrLoad(key: string, ttlMs: number, load: () => Promise<T>): Promise<{ value: T; hit: boolean; storedAt: number }> {
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
