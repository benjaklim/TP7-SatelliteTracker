import Storage from 'expo-sqlite/kv-store';

/** Synchronous JSON key-value persistence (SQLite-backed). Failures never break the UI. */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = Storage.getItemSync(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    Storage.setItemSync(key, JSON.stringify(value));
  } catch {
    // Persistence is a convenience; the in-memory state stays authoritative.
  }
}
