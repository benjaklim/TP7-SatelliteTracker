import { ProviderHttpError, type ProviderId } from '../types';
import type { RateLimiter } from './rateLimiter';

export interface HttpOptions {
  provider: ProviderId;
  limiter: RateLimiter;
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const retryable = (status: number) => status === 0 || status === 429 || status >= 500;

async function fetchWithTimeout(doFetch: typeof fetch, url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await doFetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET + JSON parse guarded by the provider's rate limiter and an exponential
 * backoff retry queue (network errors, 429 and 5xx). Fails fast if the local
 * limiter has no slot so the orchestrator can fall back immediately.
 */
export async function httpJson<T>(url: string, options: HttpOptions): Promise<T> {
  const { provider, limiter, retries = 2, baseDelayMs = 400, timeoutMs = 15_000 } = options;
  const doFetch = options.fetchImpl ?? fetch;
  let lastError: ProviderHttpError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (!limiter.tryAcquire()) {
      throw new ProviderHttpError(provider, 429, 'Client rate limit reached', limiter.retryAfterMs());
    }
    try {
      const response = await fetchWithTimeout(doFetch, url, timeoutMs);
      const text = await response.text();
      if (!response.ok) {
        lastError = new ProviderHttpError(provider, response.status, text.slice(0, 160) || response.statusText);
        if (!retryable(response.status)) throw lastError;
      } else {
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new ProviderHttpError(provider, 404, text.slice(0, 160) || 'Empty response');
        }
      }
    } catch (error) {
      if (error instanceof ProviderHttpError && !retryable(error.status)) throw error;
      lastError =
        error instanceof ProviderHttpError ? error : new ProviderHttpError(provider, 0, String(error));
    }
    if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt * (0.5 + Math.random() / 2));
  }
  throw lastError ?? new ProviderHttpError(provider, 0, 'Unknown network error');
}
