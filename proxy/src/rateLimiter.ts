export interface RateWindow {
  limit: number;
  windowMs: number;
}

/**
 * Sliding-window limiter supporting several simultaneous windows
 * (e.g. Space-Track: 30/min AND 300/h). Requests are only recorded when admitted.
 */
export class RateLimiter {
  private readonly timestamps: number[] = [];
  private readonly windows: RateWindow[];
  private readonly now: () => number;

  constructor(windows: RateWindow[], now: () => number = Date.now) {
    this.windows = windows;
    this.now = now;
  }

  private prune(t: number): void {
    const longest = Math.max(...this.windows.map((w) => w.windowMs));
    while (this.timestamps.length && this.timestamps[0] <= t - longest) this.timestamps.shift();
  }

  /** Milliseconds until a new request would be admitted (0 = now). */
  retryAfterMs(): number {
    const t = this.now();
    this.prune(t);
    let wait = 0;
    for (const w of this.windows) {
      const inWindow = this.timestamps.filter((ts) => ts > t - w.windowMs);
      if (inWindow.length >= w.limit) {
        const oldest = inWindow[inWindow.length - w.limit];
        wait = Math.max(wait, oldest + w.windowMs - t);
      }
    }
    return wait;
  }

  tryAcquire(): boolean {
    if (this.retryAfterMs() > 0) return false;
    this.timestamps.push(this.now());
    return true;
  }

  usage(): { limit: number; windowMs: number; used: number }[] {
    const t = this.now();
    this.prune(t);
    return this.windows.map((w) => ({
      ...w,
      used: this.timestamps.filter((ts) => ts > t - w.windowMs).length,
    }));
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Limits published by each provider (CelesTrak has no hard number: we stay conservative). */
export const PROVIDER_LIMITS = {
  celestrak: [{ limit: 20, windowMs: MINUTE }],
  spacetrack: [
    { limit: 25, windowMs: MINUTE },
    { limit: 280, windowMs: HOUR },
  ],
  n2yo: [{ limit: 950, windowMs: HOUR }],
  n2yoPasses: [{ limit: 95, windowMs: HOUR }],
  wtia: [{ limit: 1, windowMs: 1000 }],
} satisfies Record<string, RateWindow[]>;

export type ProviderName = keyof typeof PROVIDER_LIMITS;
