export class RetentionWorkerApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "RetentionWorkerApiError";
    this.status = status;
  }
}

export class RetentionWorkerApiClient {
  constructor({ baseUrl, sharedSecret, requestTimeoutMs = 10000 }) {
    if (!baseUrl) throw new Error("Retention worker API base URL is required");
    if (!sharedSecret) throw new Error("Retention worker shared secret is required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.sharedSecret = sharedSecret;
    this.requestTimeoutMs = Math.max(1000, Math.min(60000, Math.trunc(requestTimeoutMs)));
  }

  async request(path, body, timeoutMs = this.requestTimeoutMs) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-retention-worker-secret": this.sharedSecret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!response.ok) {
      const message =
        parsed && typeof parsed === "object" && "message" in parsed
          ? String(parsed.message)
          : `Retention worker API request failed with HTTP ${response.status}`;
      throw new RetentionWorkerApiError(response.status, message);
    }
    return parsed;
  }

  schedule(input) {
    return this.request("/internal/retention-worker/schedule", input);
  }

  claim(input) {
    return this.request("/internal/retention-worker/claim", input);
  }

  heartbeat({ jobId, ...body }) {
    return this.request(`/internal/retention-worker/jobs/${encodeURIComponent(jobId)}/heartbeat`, body);
  }

  execute({ jobId, ...body }, timeoutMs) {
    return this.request(
      `/internal/retention-worker/jobs/${encodeURIComponent(jobId)}/execute`,
      body,
      timeoutMs,
    );
  }

  fail({ jobId, ...body }) {
    return this.request(`/internal/retention-worker/jobs/${encodeURIComponent(jobId)}/fail`, body);
  }
}
