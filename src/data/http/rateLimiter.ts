export interface RateWindow {
  limit: number;
  windowMs: number;
}

/** Client-side sliding-window limiter (several windows at once, e.g. 30/min and 300/h). */
export class RateLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly windows: RateWindow[],
    private readonly now: () => number = Date.now,
  ) {}

  retryAfterMs(): number {
    const t = this.now();
    let wait = 0;
    for (const w of this.windows) {
      const inWindow = this.timestamps.filter((ts) => ts > t - w.windowMs);
      if (inWindow.length >= w.limit) {
        wait = Math.max(wait, inWindow[inWindow.length - w.limit] + w.windowMs - t);
      }
    }
    return wait;
  }

  tryAcquire(): boolean {
    if (this.retryAfterMs() > 0) return false;
    const t = this.now();
    this.timestamps.push(t);
    const longest = Math.max(...this.windows.map((w) => w.windowMs));
    while (this.timestamps.length && this.timestamps[0] <= t - longest) this.timestamps.shift();
    return true;
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Published provider limits (CelesTrak: conservative, data changes a few times a day). */
export const CLIENT_LIMITS = {
  celestrak: [{ limit: 20, windowMs: MINUTE }],
  spacetrack: [
    { limit: 25, windowMs: MINUTE },
    { limit: 280, windowMs: HOUR },
  ],
  n2yo: [{ limit: 950, windowMs: HOUR }],
  wtia: [{ limit: 1, windowMs: 1000 }],
} satisfies Record<string, RateWindow[]>;
