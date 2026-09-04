import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const paths = {
  contract: resolve(root, "contracts/llm-provider.v1.json"),
  layer: resolve(root, "services/ai-worker/src/llm-provider.mjs"),
  tests: resolve(root, "services/ai-worker/test/llm-provider.test.mjs"),
  readme: resolve(root, "services/ai-worker/README.md"),
  package: resolve(root, "package.json"),
};

function invariant(condition, message) {
  if (!condition) throw new Error(`LLM provider contract check failed: ${message}`);
}

const [contractText, layerSource, testSource, readmeSource, packageText] = await Promise.all([
  readFile(paths.contract, "utf8"),
  readFile(paths.layer, "utf8"),
  readFile(paths.tests, "utf8"),
  readFile(paths.readme, "utf8"),
  readFile(paths.package, "utf8"),
]);

const contract = JSON.parse(contractText);
const pkg = JSON.parse(packageText);

invariant(contract.version === "llm-provider.v1", "version drift");
invariant(contract.runtimeModelRequired === false, "contract tests must not require a model");
invariant(contract.promptVersioning?.explicitIdAndVersion === true, "prompt version must be explicit");
invariant(contract.promptVersioning?.mutablePublishedVersion === false, "published prompt versions must be immutable");
invariant(contract.promptVersioning?.exactVariables === true, "prompt variables must be exact");
invariant(contract.structuredOutput?.schemaRequired === true, "structured output schema must be required");
invariant(contract.structuredOutput?.failClosed === true, "structured output must fail closed");
invariant(contract.retry?.maxAttemptsPerProvider?.default === 2, "retry default drift");
invariant(contract.retry?.maxAttemptsPerProvider?.max === 5, "retry maximum drift");
invariant(contract.timeout?.perAttemptMs?.default === 30000, "timeout default drift");
invariant(contract.timeout?.timeoutAbortsProviderSignal === true, "timeout must abort provider signal");
invariant(contract.budget?.failedAttemptUsageIsCharged === true, "failed usage must be charged");
invariant(contract.budget?.failClosedOnMissingUsage === true, "missing usage must fail closed");
invariant(contract.budget?.outputCapPassedToProvider === true, "provider output cap must be enforced");
invariant(contract.fallback?.orderedProviders === true, "provider order must be deterministic");
invariant(contract.fallback?.afterProviderRetriesExhausted === true, "fallback sequencing drift");
invariant(contract.result?.doesNotIncludeRenderedPrompt === true, "result must not echo rendered prompts");
invariant(contract.testEvidence?.realProviderRequired === false, "tests must remain provider-free");
invariant(contract.testEvidence?.apiKeyRequired === false, "tests must remain credential-free");

const expectedFallbackCodes = [
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_FAILURE",
  "STRUCTURED_OUTPUT_INVALID",
];
invariant(
  JSON.stringify(contract.fallback?.fallbackCodes) === JSON.stringify(expectedFallbackCodes),
  "fallback error allowlist drift",
);

const expectedErrors = [
  ["INVALID_REQUEST", false],
  ["UNKNOWN_PROMPT", false],
  ["PROMPT_VARIABLE_MISMATCH", false],
  ["PROVIDER_UNAVAILABLE", true],
  ["PROVIDER_TIMEOUT", true],
  ["PROVIDER_FAILURE", true],
  ["STRUCTURED_OUTPUT_INVALID", true],
  ["USAGE_INVALID", false],
  ["BUDGET_EXCEEDED", false],
  ["REQUEST_ABORTED", false],
];
invariant(
  JSON.stringify((contract.errors ?? []).map((entry) => [entry.code, entry.retryable])) ===
    JSON.stringify(expectedErrors),
  "error taxonomy drift",
);

for (const marker of [
  'export const CONTRACT_VERSION = "llm-provider.v1"',
  "export class PromptRegistry",
  "export class LLMProviderLayer",
  "export class LLMProviderError",
  "export function parseStructuredOutput",
  "export function estimatePromptTokens",
  "maxAttemptsPerProvider",
  "PROVIDER_TIMEOUT",
  "BUDGET_EXCEEDED",
  "STRUCTURED_OUTPUT_INVALID",
  "costMicros",
  "AbortController",
  "Promise.race",
]) {
  invariant(layerSource.includes(marker), `implementation marker missing: ${marker}`);
}

for (const marker of [
  "prompt registry keeps immutable explicit versions",
  "structured output parser accepts only the declared JSON shape",
  "retries malformed structured output",
  "exhaust the primary then fall back",
  "provider timeout aborts the attempt",
  "budget preflight rejects oversized prompts",
  "failed attempts is charged",
  "external abort stops execution",
  "invalid provider usage is a fail-closed",
]) {
  invariant(testSource.includes(marker), `dependency-free test marker missing: ${marker}`);
}

invariant(
  readmeSource.includes("LLM Provider Layer v1"),
  "AI worker README must document the LLM provider layer",
);
invariant(
  pkg.scripts?.["llm-provider:contract:check"] === "node scripts/check-llm-provider-contract.mjs",
  "package contract script missing",
);
invariant(pkg.scripts?.["ai-worker:test"]?.includes("llm-provider.mjs"), "AI worker syntax check must include LLM layer");
invariant(pkg.scripts?.test?.includes("llm-provider:contract:check"), "root test must enforce LLM provider contract");
invariant(pkg.scripts?.check?.includes("llm-provider:contract:check"), "root check must enforce LLM provider contract");

console.log("LLM Provider Contract v1 is internally consistent without requiring a model or API key.");
