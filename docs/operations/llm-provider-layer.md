# LLM Provider Layer v1

## Purpose

The LLM Provider Layer is the provider-neutral inference boundary for AI Worker capabilities. It exists so Interview Brain and Evaluator processors can depend on deterministic execution semantics before any production LLM is selected, installed, or credentialed.

Source of truth: `contracts/llm-provider.v1.json`

Implementation: `services/ai-worker/src/llm-provider.mjs`

## Invariants

A request always names an explicit prompt ID and version. Published prompt versions are immutable; prompt changes require a new version. The registry rejects missing, extra, or undeclared variables.

Every request requires a structured-output schema. Provider output may be an already-parsed JSON value or a JSON string, but the layer validates the complete shape and fails closed on malformed JSON, missing required properties, disallowed additional properties, type mismatches, enum violations, or configured bounds.

Provider adapters are ordered. Each provider receives a bounded number of attempts. Retryable provider failures and invalid structured output can be retried within the provider; after that provider is exhausted the layer proceeds to the next configured provider. Invalid requests, budget failures, invalid usage accounting, and caller cancellation never trigger fallback.

Each provider attempt receives its own `AbortSignal` and a bounded timeout. Timeout aborts the provider signal and is classified separately from caller cancellation.

Budget accounting is request-scoped across every attempt and every fallback. The layer performs a deterministic prompt-size preflight estimate before calling a provider, passes a remaining output-token cap to the adapter, requires actual non-negative integer `inputTokens`, `outputTokens`, and `costMicros`, and charges usage attached to failed provider attempts. Missing or invalid usage fails closed.

Successful results expose only structured data, prompt ID/version, selected provider/model identifier, bounded attempt metadata, and aggregate usage. Rendered prompt bodies are not returned as execution metadata.

## What is deliberately not implemented

This layer does not install or invoke a real model, does not contain vendor API keys, does not estimate vendor-specific prices, and does not select a production model. A future OpenAI/Anthropic/Gemini/local adapter only implements the provider `generate(...)` interface and must honor the supplied abort signal and output cap.

Queue-level retries remain separate. The provider layer first exhausts its local retry/fallback policy. Only then should a capability processor decide whether the durable AI job itself is retryable.

## Validation without a model

`services/ai-worker/test/llm-provider.test.mjs` uses scripted in-memory adapters to prove:

- immutable explicit prompt versions;
- exact variable contracts;
- structured JSON validation;
- retry after malformed output;
- provider failure retry and ordered fallback;
- timeout abort and fallback;
- preflight budget rejection before provider execution;
- failed-attempt usage charging;
- budget exhaustion preventing additional provider calls;
- caller cancellation stopping retries/fallback;
- fail-closed invalid usage accounting.

Run:

```bash
npm run llm-provider:contract:check
npm run ai-worker:test
```

No model, API key, network request, or paid inference is required for these checks.
