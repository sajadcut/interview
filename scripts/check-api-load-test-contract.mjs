import { readFile } from "node:fs/promises";

const [contractText, runner, seed, workflow, docs] = await Promise.all([
  readFile("contracts/api-load-test.v1.json", "utf8"),
  readFile("scripts/load-test.mjs", "utf8"),
  readFile("scripts/load-test-seed.sql", "utf8"),
  readFile(".github/workflows/api-load-test.yml", "utf8"),
  readFile("docs/operations/api-load-testing.md", "utf8"),
]);
const contract = JSON.parse(contractText);

function requireCondition(condition, message) {
  if (!condition) throw new Error(`API load-test contract check failed: ${message}`);
}

requireCondition(contract.version === "api-load-test.v1", "contract version must remain api-load-test.v1");
for (const dependency of ["livekit", "whisper", "ffmpeg", "tts", "llm"]) {
  requireCondition(contract.independentOf.includes(dependency), `independentOf must include ${dependency}`);
}
for (const scenario of [...contract.publicScenarios, ...contract.authenticatedScenarios]) {
  requireCondition(runner.includes(`\"${scenario}\"`), `runner must implement ${scenario}`);
}
requireCondition(!runner.includes("/health/livekit"), "API/DB runner must not probe LiveKit");
requireCondition(!runner.includes("/health/whisper"), "API/DB runner must not probe Whisper");
requireCondition(!runner.includes("/tts"), "API/DB runner must not invoke TTS");
requireCondition(!runner.includes("/v1/media"), "API/DB runner must not invoke realtime media endpoints");
requireCondition(seed.includes("generate_series"), "seed must create scalable deterministic DB fixtures");
requireCondition(seed.includes("Load Test Write Job"), "seed must isolate audited write fixtures");
requireCondition(workflow.includes("LOAD_TEST_PROFILE"), "workflow must select an explicit profile");
requireCondition(workflow.includes("pg_stat_database_before.txt"), "workflow must capture DB baseline evidence");
requireCondition(workflow.includes("pg_stat_database_after.txt"), "workflow must capture DB post-run evidence");
requireCondition(docs.includes("LiveKit"), "operations doc must explain the LiveKit boundary");
requireCondition(docs.includes("not a production capacity claim"), "operations doc must state interpretation limits");

console.log("API/DB Load Test Contract v1 is internally consistent and does not require the realtime media stack.");
