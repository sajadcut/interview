const PROMPT_ID_PATTERN = /^[a-z][a-z0-9_.-]{2,63}$/;
const PROMPT_VERSION_PATTERN = /^v[1-9]\d*$/;
const PLACEHOLDER_PATTERN = /{{([a-zA-Z][a-zA-Z0-9_]*)}}/g;

export const CONTRACT_VERSION = "llm-provider.v1";
export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_MAX_ATTEMPTS_PER_PROVIDER = 2;
export const DEFAULT_RETRY_INITIAL_DELAY_MS = 100;
export const DEFAULT_RETRY_MAX_DELAY_MS = 2000;
export const DEFAULT_RETRY_MULTIPLIER = 2;
export const DEFAULT_BUDGET = Object.freeze({
  maxInputTokens: 12000,
  maxOutputTokens: 4000,
  maxTotalTokens: 16000,
  maxCostMicros: 1000000,
});

const SAFE_MESSAGES = Object.freeze({
  INVALID_REQUEST: "LLM request is invalid",
  UNKNOWN_PROMPT: "Prompt version is not registered",
  PROMPT_VARIABLE_MISMATCH: "Prompt variables do not match the registered prompt",
  PROVIDER_UNAVAILABLE: "LLM provider is unavailable",
  PROVIDER_TIMEOUT: "LLM provider request timed out",
  PROVIDER_FAILURE: "LLM provider request failed",
  STRUCTURED_OUTPUT_INVALID: "LLM provider returned invalid structured output",
  USAGE_INVALID: "LLM provider returned invalid usage accounting",
  BUDGET_EXCEEDED: "LLM request budget was exceeded",
  REQUEST_ABORTED: "LLM request was aborted",
});

const RETRYABLE_CODES = new Set([
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_FAILURE",
  "STRUCTURED_OUTPUT_INVALID",
]);

const FALLBACKABLE_CODES = new Set([
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_FAILURE",
  "STRUCTURED_OUTPUT_INVALID",
]);

function fail(code, options = {}) {
  return new LLMProviderError(code, options);
}

export class LLMProviderError extends Error {
  constructor(code, { provider = null, usage = null } = {}) {
    if (!Object.hasOwn(SAFE_MESSAGES, code)) throw new TypeError(`Unknown LLM provider error code: ${code}`);
    super(SAFE_MESSAGES[code]);
    this.name = "LLMProviderError";
    this.code = code;
    this.provider = provider;
    this.retryable = RETRYABLE_CODES.has(code);
    this.usage = usage;
  }
}

function asBoundedInteger(value, _name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw fail("INVALID_REQUEST");
  }
  return value;
}

function freezeDefinition(definition) {
  return Object.freeze({
    id: definition.id,
    version: definition.version,
    system: definition.system,
    user: definition.user,
    variables: Object.freeze([...definition.variables]),
  });
}

function placeholders(template) {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
}

function validatePromptDefinition(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw fail("INVALID_REQUEST");
  if (!PROMPT_ID_PATTERN.test(definition.id ?? "")) throw fail("INVALID_REQUEST");
  if (!PROMPT_VERSION_PATTERN.test(definition.version ?? "")) throw fail("INVALID_REQUEST");
  if (typeof definition.system !== "string" || typeof definition.user !== "string") throw fail("INVALID_REQUEST");
  if (!Array.isArray(definition.variables) || definition.variables.some((item) => typeof item !== "string")) {
    throw fail("INVALID_REQUEST");
  }
  const unique = new Set(definition.variables);
  if (unique.size !== definition.variables.length) throw fail("INVALID_REQUEST");
  const referenced = new Set([...placeholders(definition.system), ...placeholders(definition.user)]);
  for (const name of referenced) {
    if (!unique.has(name)) throw fail("INVALID_REQUEST");
  }
}

function renderTemplate(template, variables) {
  return template.replace(PLACEHOLDER_PATTERN, (_, name) => String(variables[name]));
}

export class PromptRegistry {
  constructor(definitions = []) {
    this._definitions = new Map();
    for (const definition of definitions) this.register(definition);
  }

  register(definition) {
    validatePromptDefinition(definition);
    const key = `${definition.id}@${definition.version}`;
    if (this._definitions.has(key)) throw fail("INVALID_REQUEST");
    this._definitions.set(key, freezeDefinition(definition));
    return this;
  }

  resolve(id, version) {
    const definition = this._definitions.get(`${id}@${version}`);
    if (!definition) throw fail("UNKNOWN_PROMPT");
    return definition;
  }

  render(reference) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) throw fail("INVALID_REQUEST");
    const definition = this.resolve(reference.id, reference.version);
    const variables = reference.variables ?? {};
    if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
      throw fail("PROMPT_VARIABLE_MISMATCH");
    }
    const expected = [...definition.variables].sort();
    const actual = Object.keys(variables).sort();
    if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
      throw fail("PROMPT_VARIABLE_MISMATCH");
    }
    for (const value of Object.values(variables)) {
      if (!['string', 'number', 'boolean'].includes(typeof value) || (!Number.isFinite(value) && typeof value === "number")) {
        throw fail("PROMPT_VARIABLE_MISMATCH");
      }
    }
    return Object.freeze({
      id: definition.id,
      version: definition.version,
      system: renderTemplate(definition.system, variables),
      user: renderTemplate(definition.user, variables),
    });
  }
}

function schemaError() {
  throw fail("STRUCTURED_OUTPUT_INVALID");
}

function validateSchemaDefinition(schema, depth = 0) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || depth > 20) throw fail("INVALID_REQUEST");
  const allowedTypes = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
  if (!allowedTypes.has(schema.type)) throw fail("INVALID_REQUEST");
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) throw fail("INVALID_REQUEST");
  if (schema.type === "object") {
    if (schema.properties !== undefined && (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties))) {
      throw fail("INVALID_REQUEST");
    }
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== "string"))) {
      throw fail("INVALID_REQUEST");
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") throw fail("INVALID_REQUEST");
    for (const child of Object.values(schema.properties ?? {})) validateSchemaDefinition(child, depth + 1);
  }
  if (schema.type === "array") {
    if (!schema.items) throw fail("INVALID_REQUEST");
    validateSchemaDefinition(schema.items, depth + 1);
  }
}

function validateValue(value, schema, depth = 0) {
  if (depth > 40) schemaError();
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) schemaError();

  switch (schema.type) {
    case "null":
      if (value !== null) schemaError();
      return;
    case "boolean":
      if (typeof value !== "boolean") schemaError();
      return;
    case "string":
      if (typeof value !== "string") schemaError();
      if (schema.minLength !== undefined && value.length < schema.minLength) schemaError();
      if (schema.maxLength !== undefined && value.length > schema.maxLength) schemaError();
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) schemaError();
      if (schema.minimum !== undefined && value < schema.minimum) schemaError();
      if (schema.maximum !== undefined && value > schema.maximum) schemaError();
      return;
    case "integer":
      if (!Number.isSafeInteger(value)) schemaError();
      if (schema.minimum !== undefined && value < schema.minimum) schemaError();
      if (schema.maximum !== undefined && value > schema.maximum) schemaError();
      return;
    case "array":
      if (!Array.isArray(value)) schemaError();
      if (schema.minItems !== undefined && value.length < schema.minItems) schemaError();
      if (schema.maxItems !== undefined && value.length > schema.maxItems) schemaError();
      for (const item of value) validateValue(item, schema.items, depth + 1);
      return;
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) schemaError();
      const properties = schema.properties ?? {};
      for (const required of schema.required ?? []) {
        if (!Object.hasOwn(value, required)) schemaError();
      }
      for (const [key, child] of Object.entries(value)) {
        if (!Object.hasOwn(properties, key)) {
          if (schema.additionalProperties === false) schemaError();
          continue;
        }
        validateValue(child, properties[key], depth + 1);
      }
      return;
    }
    default:
      schemaError();
  }
}

export function parseStructuredOutput(output, schema) {
  validateSchemaDefinition(schema);
  let parsed = output;
  if (typeof output === "string") {
    try {
      parsed = JSON.parse(output);
    } catch {
      schemaError();
    }
  }
  validateValue(parsed, schema);
  return parsed;
}

function normalizedUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) throw fail("USAGE_INVALID");
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const costMicros = usage.costMicros;
  for (const value of [inputTokens, outputTokens, costMicros]) {
    if (!Number.isSafeInteger(value) || value < 0) throw fail("USAGE_INVALID");
  }
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costMicros };
}

function normalizeBudget(budget = {}) {
  const merged = { ...DEFAULT_BUDGET, ...budget };
  const maxInputTokens = asBoundedInteger(merged.maxInputTokens, "maxInputTokens", 1, 1000000);
  const maxOutputTokens = asBoundedInteger(merged.maxOutputTokens, "maxOutputTokens", 1, 1000000);
  const maxTotalTokens = asBoundedInteger(merged.maxTotalTokens, "maxTotalTokens", 1, 2000000);
  const maxCostMicros = asBoundedInteger(merged.maxCostMicros, "maxCostMicros", 0, 1000000000000);
  return { maxInputTokens, maxOutputTokens, maxTotalTokens, maxCostMicros };
}

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costMicros: 0 };
}

function addUsage(total, delta) {
  total.inputTokens += delta.inputTokens;
  total.outputTokens += delta.outputTokens;
  total.totalTokens += delta.totalTokens;
  total.costMicros += delta.costMicros;
}

function ensureWithinBudget(usage, budget) {
  if (
    usage.inputTokens > budget.maxInputTokens ||
    usage.outputTokens > budget.maxOutputTokens ||
    usage.totalTokens > budget.maxTotalTokens ||
    usage.costMicros > budget.maxCostMicros
  ) {
    throw fail("BUDGET_EXCEEDED");
  }
}

export function estimatePromptTokens(prompt) {
  const bytes = Buffer.byteLength(`${prompt.system}\n${prompt.user}`, "utf8");
  return Math.max(1, Math.ceil(bytes / 4));
}

function providerName(provider) {
  if (!provider || typeof provider.generate !== "function") throw fail("INVALID_REQUEST");
  const name = provider.name?.trim();
  if (!name || name.length > 64) throw fail("INVALID_REQUEST");
  return name;
}

function normalizeProviderError(error, name) {
  if (error instanceof LLMProviderError) {
    if (error.provider) return error;
    return new LLMProviderError(error.code, {
      provider: name,
      usage: error.usage,
    });
  }
  return fail("PROVIDER_FAILURE", { provider: name });
}

async function sleepWithSignal(ms, signal, sleep) {
  if (ms <= 0) return;
  if (!signal) {
    await sleep(ms);
    return;
  }
  if (signal.aborted) throw fail("REQUEST_ABORTED");
  let onAbort;
  const abortPromise = new Promise((_, reject) => {
    onAbort = () => reject(fail("REQUEST_ABORTED"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([sleep(ms), abortPromise]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function callWithTimeout(provider, input, timeoutMs, parentSignal) {
  if (parentSignal?.aborted) throw fail("REQUEST_ABORTED", { provider: provider.name });
  const controller = new AbortController();
  let timeout;
  let parentAbort;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = fail("PROVIDER_TIMEOUT", { provider: provider.name });
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const abortPromise = new Promise((_, reject) => {
    if (!parentSignal) return;
    parentAbort = () => {
      const error = fail("REQUEST_ABORTED", { provider: provider.name });
      controller.abort(error);
      reject(error);
    };
    parentSignal.addEventListener("abort", parentAbort, { once: true });
  });

  try {
    const providerPromise = Promise.resolve().then(() => provider.generate({ ...input, signal: controller.signal }));
    return await Promise.race([providerPromise, timeoutPromise, abortPromise]);
  } finally {
    clearTimeout(timeout);
    if (parentSignal && parentAbort) parentSignal.removeEventListener("abort", parentAbort);
  }
}

function attemptRecord(provider, attempt, outcome, startedAt, code = null) {
  return Object.freeze({
    provider,
    attempt,
    outcome,
    code,
    durationMs: Math.max(0, Date.now() - startedAt),
  });
}

export class LLMProviderLayer {
  constructor({
    providers,
    promptRegistry,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttemptsPerProvider = DEFAULT_MAX_ATTEMPTS_PER_PROVIDER,
    retryInitialDelayMs = DEFAULT_RETRY_INITIAL_DELAY_MS,
    retryMaxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
    retryMultiplier = DEFAULT_RETRY_MULTIPLIER,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) {
    if (!Array.isArray(providers) || providers.length === 0) throw fail("INVALID_REQUEST");
    this.providers = providers.map((provider) => {
      providerName(provider);
      return provider;
    });
    if (new Set(this.providers.map((provider) => provider.name)).size !== this.providers.length) {
      throw fail("INVALID_REQUEST");
    }
    if (!(promptRegistry instanceof PromptRegistry)) throw fail("INVALID_REQUEST");
    this.promptRegistry = promptRegistry;
    this.timeoutMs = asBoundedInteger(timeoutMs, "timeoutMs", 10, 300000);
    this.maxAttemptsPerProvider = asBoundedInteger(maxAttemptsPerProvider, "maxAttemptsPerProvider", 1, 5);
    this.retryInitialDelayMs = asBoundedInteger(retryInitialDelayMs, "retryInitialDelayMs", 0, 60000);
    this.retryMaxDelayMs = asBoundedInteger(retryMaxDelayMs, "retryMaxDelayMs", 0, 60000);
    if (!Number.isFinite(retryMultiplier) || retryMultiplier < 1 || retryMultiplier > 10) throw fail("INVALID_REQUEST");
    this.retryMultiplier = retryMultiplier;
    if (typeof sleep !== "function") throw fail("INVALID_REQUEST");
    this.sleep = sleep;
  }

  async generateStructured({
    prompt,
    schema,
    maxOutputTokens,
    budget,
    signal,
    metadata = {},
  }) {
    if (signal?.aborted) throw fail("REQUEST_ABORTED");
    const renderedPrompt = this.promptRegistry.render(prompt);
    validateSchemaDefinition(schema);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw fail("INVALID_REQUEST");

    const activeBudget = normalizeBudget(budget);
    const requestedMaxOutputTokens = asBoundedInteger(
      maxOutputTokens ?? activeBudget.maxOutputTokens,
      "maxOutputTokens",
      1,
      activeBudget.maxOutputTokens,
    );
    const estimatedInputTokens = estimatePromptTokens(renderedPrompt);
    if (estimatedInputTokens > activeBudget.maxInputTokens || estimatedInputTokens >= activeBudget.maxTotalTokens) {
      throw fail("BUDGET_EXCEEDED");
    }

    const totals = emptyUsage();
    const attempts = [];
    let lastError = null;

    for (const provider of this.providers) {
      const name = provider.name;
      for (let attempt = 1; attempt <= this.maxAttemptsPerProvider; attempt += 1) {
        if (signal?.aborted) throw fail("REQUEST_ABORTED", { provider: name });
        ensureWithinBudget(totals, activeBudget);
        const remainingOutput = Math.min(
          requestedMaxOutputTokens,
          activeBudget.maxOutputTokens - totals.outputTokens,
          activeBudget.maxTotalTokens - totals.totalTokens - estimatedInputTokens,
        );
        if (remainingOutput < 1 || totals.inputTokens + estimatedInputTokens > activeBudget.maxInputTokens) {
          throw fail("BUDGET_EXCEEDED");
        }

        const startedAt = Date.now();
        try {
          const response = await callWithTimeout(
            provider,
            {
              prompt: renderedPrompt,
              schema,
              maxOutputTokens: remainingOutput,
              metadata: { ...metadata, contractVersion: CONTRACT_VERSION },
            },
            this.timeoutMs,
            signal,
          );
          if (!response || typeof response !== "object" || Array.isArray(response)) {
            throw fail("PROVIDER_FAILURE", { provider: name });
          }
          const usage = normalizedUsage(response.usage);
          addUsage(totals, usage);
          ensureWithinBudget(totals, activeBudget);
          if (usage.outputTokens > remainingOutput) throw fail("BUDGET_EXCEEDED", { provider: name });
          const data = parseStructuredOutput(response.output, schema);
          attempts.push(attemptRecord(name, attempt, "success", startedAt));
          return Object.freeze({
            data,
            prompt: Object.freeze({ id: renderedPrompt.id, version: renderedPrompt.version }),
            provider: name,
            model: typeof response.model === "string" && response.model ? response.model : null,
            attempts: Object.freeze(attempts),
            usage: Object.freeze({ ...totals }),
          });
        } catch (rawError) {
          const error = normalizeProviderError(rawError, name);
          if (error.usage) {
            const failureUsage = normalizedUsage(error.usage);
            addUsage(totals, failureUsage);
            ensureWithinBudget(totals, activeBudget);
          }
          attempts.push(attemptRecord(name, attempt, "error", startedAt, error.code));
          lastError = error;

          if (error.code === "REQUEST_ABORTED" || error.code === "BUDGET_EXCEEDED" || error.code === "USAGE_INVALID") {
            throw error;
          }

          const mayRetrySameProvider =
            error.retryable &&
            FALLBACKABLE_CODES.has(error.code) &&
            attempt < this.maxAttemptsPerProvider;
          if (mayRetrySameProvider) {
            const delay = Math.min(
              this.retryMaxDelayMs,
              Math.round(this.retryInitialDelayMs * this.retryMultiplier ** (attempt - 1)),
            );
            await sleepWithSignal(delay, signal, this.sleep);
            continue;
          }
          break;
        }
      }

      if (lastError && !FALLBACKABLE_CODES.has(lastError.code)) throw lastError;
    }

    throw lastError ?? fail("PROVIDER_UNAVAILABLE");
  }
}
