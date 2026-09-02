export class AiWorkerApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AiWorkerApiError";
    this.status = status;
  }
}

export class AiWorkerApiClient {
  constructor({ baseUrl, sharedSecret, requestTimeoutMs = 10000 }) {
    if (!baseUrl) throw new Error("AI worker API base URL is required");
    if (!sharedSecret) throw new Error("AI worker shared secret is required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.sharedSecret = sharedSecret;
    this.requestTimeoutMs = Math.max(1000, Math.min(60000, Math.trunc(requestTimeoutMs)));
  }

  async request(path, body) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-worker-secret": this.sharedSecret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    if (response.status === 204) return null;
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
          : `AI worker API request failed with HTTP ${response.status}`;
      throw new AiWorkerApiError(response.status, message);
    }
    return parsed;
  }

  claim(input) {
    return this.request("/internal/ai-worker/claim", input);
  }

  heartbeat({ jobId, ...body }) {
    return this.request(`/internal/ai-worker/jobs/${encodeURIComponent(jobId)}/heartbeat`, body);
  }

  succeed({ jobId, ...body }) {
    return this.request(`/internal/ai-worker/jobs/${encodeURIComponent(jobId)}/succeed`, body);
  }

  fail({ jobId, ...body }) {
    return this.request(`/internal/ai-worker/jobs/${encodeURIComponent(jobId)}/fail`, body);
  }
}
