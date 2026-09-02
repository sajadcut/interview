export class RetryableJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RetryableJobError";
    this.code = code;
    this.retryable = true;
  }
}

export class PermanentJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PermanentJobError";
    this.code = code;
    this.retryable = false;
  }
}

function normalizedError(error) {
  if (error instanceof RetryableJobError || error instanceof PermanentJobError) {
    return {
      retryable: error.retryable,
      errorCode: error.code,
      errorMessage: error.message,
    };
  }
  if (error instanceof Error) {
    return {
      retryable: true,
      errorCode: "UNEXPECTED_WORKER_ERROR",
      errorMessage: error.message || error.name,
    };
  }
  return {
    retryable: true,
    errorCode: "UNEXPECTED_WORKER_ERROR",
    errorMessage: "Unknown AI worker error",
  };
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Aborted"));
      },
      { once: true },
    );
  });
}

export class AiWorkerRuntime {
  constructor({
    client,
    processors,
    workerId,
    concurrency = 1,
    pollIntervalMs = 1000,
    leaseDurationMs = 120000,
    heartbeatIntervalMs = 15000,
    logger = console,
  }) {
    if (!client) throw new Error("AI worker API client is required");
    if (!workerId?.trim()) throw new Error("AI workerId is required");
    this.client = client;
    this.processors = processors instanceof Map ? processors : new Map(Object.entries(processors ?? {}));
    this.workerId = workerId.trim();
    this.concurrency = Math.max(1, Math.min(32, Math.trunc(concurrency)));
    this.pollIntervalMs = Math.max(100, Math.trunc(pollIntervalMs));
    this.leaseDurationMs = Math.max(5000, Math.min(300000, Math.trunc(leaseDurationMs)));
    this.heartbeatIntervalMs = Math.max(1000, Math.trunc(heartbeatIntervalMs));
    this.logger = logger;
  }

  async runOnce() {
    const job = await this.client.claim({
      workerId: this.workerId,
      leaseDurationMs: this.leaseDurationMs,
    });
    if (!job) return false;
    await this.processJob(job);
    return true;
  }

  async processJob(job) {
    const leaseToken = job.leaseToken;
    if (!leaseToken) throw new Error(`Claimed AI job ${job.id} does not include a lease token`);

    const controller = new AbortController();
    let heartbeatFailure = null;
    let heartbeatBusy = false;
    const heartbeat = setInterval(async () => {
      if (heartbeatBusy || controller.signal.aborted) return;
      heartbeatBusy = true;
      try {
        await this.client.heartbeat({
          jobId: job.id,
          leaseToken,
          workerId: this.workerId,
          leaseDurationMs: this.leaseDurationMs,
        });
      } catch (error) {
        heartbeatFailure = error instanceof Error ? error : new Error("AI job heartbeat failed");
        controller.abort(heartbeatFailure);
      } finally {
        heartbeatBusy = false;
      }
    }, Math.min(this.heartbeatIntervalMs, Math.max(1000, Math.floor(this.leaseDurationMs / 3))));
    heartbeat.unref?.();

    const timeoutMs = Math.max(250, Math.min(300000, Math.trunc(job.timeoutMs ?? 30000)));
    let timeout;
    try {
      const processor = this.processors.get(job.capability);
      if (!processor) {
        throw new PermanentJobError(
          "UNSUPPORTED_CAPABILITY",
          `No AI worker processor is registered for capability ${job.capability}`,
        );
      }

      const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = new RetryableJobError(
            "JOB_TIMEOUT",
            `AI job exceeded its ${timeoutMs}ms execution timeout`,
          );
          controller.abort(error);
          reject(error);
        }, timeoutMs);
        timeout.unref?.();
      });

      const processorPromise = Promise.resolve().then(() =>
        processor({
          job,
          payload: job.payload ?? {},
          signal: controller.signal,
          workerId: this.workerId,
        }),
      );
      const result = await Promise.race([processorPromise, timeoutPromise]);
      if (heartbeatFailure) throw heartbeatFailure;
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new PermanentJobError(
          "INVALID_PROCESSOR_RESULT",
          "AI worker processors must return a JSON object",
        );
      }

      await this.client.succeed({
        jobId: job.id,
        leaseToken,
        workerId: this.workerId,
        result,
      });
    } catch (error) {
      const failure = normalizedError(heartbeatFailure ?? error);
      try {
        await this.client.fail({
          jobId: job.id,
          leaseToken,
          workerId: this.workerId,
          ...failure,
        });
      } catch (reportError) {
        this.logger.error?.("AI worker could not report job failure", {
          jobId: job.id,
          error: reportError instanceof Error ? reportError.message : String(reportError),
        });
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      clearInterval(heartbeat);
    }
  }

  async runForever(signal) {
    const lanes = Array.from({ length: this.concurrency }, (_, lane) => this.runLane(lane, signal));
    await Promise.all(lanes);
  }

  async runLane(lane, signal) {
    while (!signal?.aborted) {
      try {
        const worked = await this.runOnce();
        if (!worked) await abortableDelay(this.pollIntervalMs, signal);
      } catch (error) {
        if (signal?.aborted) return;
        this.logger.error?.("AI worker polling cycle failed", {
          lane,
          error: error instanceof Error ? error.message : String(error),
        });
        try {
          await abortableDelay(this.pollIntervalMs, signal);
        } catch {
          return;
        }
      }
    }
  }
}
