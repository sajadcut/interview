export class AtsProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = "AtsProviderError";
  }
}

export interface AtsHttpOptions {
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
  const date = new Date(raw);
  if (Number.isNaN(date.valueOf())) return null;
  return Math.min(Math.max(date.valueOf() - Date.now(), 0), 30_000);
}

function requestId(response: Response): string {
  return response.headers.get("x-request-id")
    ?? response.headers.get("x-greenhouse-request-id")
    ?? response.headers.get("x-lever-request-id")
    ?? "unknown";
}

async function pause(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function atsFetch(
  provider: string,
  url: string,
  init: RequestInit,
  options: AtsHttpOptions,
  behavior: { idempotent: boolean } = { idempotent: true },
): Promise<Response> {
  const attempts = behavior.idempotent ? options.maxAttempts : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (
        response.ok
        || !behavior.idempotent
        || !retryableStatus(response.status)
        || attempt === attempts
      ) {
        return response;
      }
      await pause(
        retryAfterMs(response)
          ?? Math.min(options.retryBaseMs * 2 ** (attempt - 1), 5_000),
      );
    } catch (error) {
      lastError = error;
      if (!behavior.idempotent) {
        throw new AtsProviderError(
          `${provider} request ended before a definitive response was received`,
          `${provider.toUpperCase()}_OUTCOME_UNKNOWN`,
          false,
          undefined,
          true,
        );
      }
      if (attempt === attempts) break;
      await pause(Math.min(options.retryBaseMs * 2 ** (attempt - 1), 5_000));
    }
  }

  void lastError;
  throw new AtsProviderError(
    `${provider} request failed before a response was received`,
    `${provider.toUpperCase()}_NETWORK_ERROR`,
    true,
  );
}

export function assertAtsResponse(response: Response, provider: string): void {
  if (response.ok) return;
  throw new AtsProviderError(
    `${provider} request failed with HTTP ${response.status} (request ${requestId(response)})`,
    `${provider.toUpperCase()}_HTTP_${response.status}`,
    retryableStatus(response.status),
    response.status,
  );
}

export function atsHttpOptions(): AtsHttpOptions {
  const bounded = (raw: string | undefined, fallback: number, min: number, max: number) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
  };
  return {
    timeoutMs: bounded(process.env.ATS_TIMEOUT_MS, 10_000, 1_000, 60_000),
    maxAttempts: bounded(process.env.ATS_MAX_ATTEMPTS, 3, 1, 5),
    retryBaseMs: bounded(process.env.ATS_RETRY_BASE_MS, 250, 50, 5_000),
  };
}
