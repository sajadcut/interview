import assert from "node:assert/strict";
import test from "node:test";
import { buildContainerRunArgs, parseRunnerPolicy, resolveLanguage } from "../src/sandbox.mjs";

test("resolves only allowlisted languages and images", () => {
  assert.equal(resolveLanguage("js", {}).key, "javascript");
  assert.equal(resolveLanguage("python3", {}).key, "python");
  assert.throws(() => resolveLanguage("bash", {}), /Unsupported assessment language/);
});

test("runner policy requires bounded hidden test cases", () => {
  const policy = parseRunnerPolicy({
    executionTimeoutMs: 9000,
    testCases: [{ name: "sum", stdin: "2 3\n", expectedStdout: "5\n" }],
  });
  assert.equal(policy.executionTimeoutMs, 9000);
  assert.equal(policy.testCases.length, 1);
  assert.throws(() => parseRunnerPolicy({ testCases: [] }), /at least one test case/);
});

test("container invocation fails closed on network and privilege boundaries", () => {
  const args = buildContainerRunArgs({
    containerName: "job-1",
    workspace: "/tmp/work",
    image: "node:24-alpine",
    command: ["node", "/workspace/main.mjs"],
    memoryLimitMb: 256,
    cpuLimit: 1,
    pidsLimit: 64,
  });
  const joined = args.join(" ");
  assert.match(joined, /--network none/);
  assert.match(joined, /--read-only/);
  assert.match(joined, /--cap-drop ALL/);
  assert.match(joined, /no-new-privileges/);
  assert.match(joined, /--pids-limit 64/);
  assert.match(joined, /--memory 256m/);
  assert.match(joined, /--memory-swap 256m/);
  assert.match(joined, /--user 65534:65534/);
  assert.match(joined, /readonly/);
  assert.match(joined, /--pull never/);
});
