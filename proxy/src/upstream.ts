import type { RateLimiter } from './rateLimiter.ts';

export class UpstreamError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface FetchOptions {
  limiter: RateLimiter;
  init?: RequestInit;
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryable = (status: number) => status === 429 || status >= 500;

/**
 * Fetch guarded by the provider rate limiter, with exponential backoff + jitter
 * on network errors, 429 and 5xx. Never exceeds the limiter: if no slot is
 * available it fails fast with 429 instead of queueing forever.
 */
export async function fetchUpstream(url: string, options: FetchOptions): Promise<Response> {
  const { limiter, init, retries = 3, baseDelayMs = 500, timeoutMs = 15_000 } = options;
  const doFetch = options.fetchImpl ?? fetch;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (!limiter.tryAcquire()) {
      const wait = limiter.retryAfterMs();
      throw new UpstreamError('Local rate limit reached for provider', 429, wait);
    }
    try {
      const response = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response;
      if (!isRetryable(response.status) || attempt === retries) {
        throw new UpstreamError(`Upstream responded ${response.status}`, response.status);
      }
      lastError = new UpstreamError(`Upstream responded ${response.status}`, response.status);
    } catch (error) {
      if (error instanceof UpstreamError && !isRetryable(error.status)) throw error;
      lastError = error;
      if (attempt === retries) break;
    }
    const delay = baseDelayMs * 2 ** attempt * (0.5 + Math.random() / 2);
    await sleep(delay);
  }
  if (lastError instanceof UpstreamError) throw lastError;
  throw new UpstreamError(`Upstream unreachable: ${String(lastError)}`, 502);
}
