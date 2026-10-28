import assert from "node:assert/strict";
import test from "node:test";
import { resetEnvCacheForTests } from "../config/env";
import { QuestionProposalProvider } from "./question-proposal-provider";

test("remote question drafting requires an explicit approved endpoint and fails closed", async () => {
  const keys = ["LLM_PROVIDER", "LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"];
  const saved = keys.map(key => [key, process.env[key]] as const);
  const originalFetch = globalThis.fetch;
  const provider = new QuestionProposalProvider();
  let calls = 0;
  try {
    process.env.LLM_PROVIDER = "disabled";
    resetEnvCacheForTests();
    globalThis.fetch = async () => { calls++; throw new Error("No network allowed"); };
    assert.equal((await provider.propose({ sourceText: "private uploaded reference", skillKeys: ["dotnet"] })).status, "disabled");
    assert.equal(calls, 0);

    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.LLM_MODEL = "local-mock";
    process.env.LLM_API_KEY = "test-key";
    delete process.env.LLM_BASE_URL;
    resetEnvCacheForTests();
    assert.equal((await provider.propose({ sourceText: "private uploaded reference", skillKeys: ["dotnet"] })).status, "unavailable");
    assert.equal(calls, 0);

    process.env.LLM_BASE_URL = "https://example.invalid/v1";
    resetEnvCacheForTests();
    const sourceText = "How can we ensure idempotency in .NET services?".repeat(250);
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(String(url), "https://example.invalid/v1/chat/completions");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
      assert.equal(init?.redirect, "manual");
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      assert.equal(body.messages[0]?.role, "system");
      const user = JSON.parse(body.messages[1]!.content) as {sourceText:string;allowedSkillKeys:string[]};
      assert.equal(user.sourceText.length, 6000);
      assert.deepEqual(user.allowedSkillKeys, ["dotnet"]);
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({
        schemaVersion:"question-proposals.v1",proposals:[],
      })}}]}), {status:200});
    };
    assert.equal((await provider.propose({ sourceText, skillKeys: ["dotnet","dotnet"] })).status, "ok");
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response("bad", {status:500});
    assert.equal((await provider.propose({ sourceText:"sample", skillKeys:["dotnet"] })).status, "unavailable");
    globalThis.fetch = async () => new Response('{"choices":[{"message":{"content":"bad JSON"}}]}', {status:200});
    assert.equal((await provider.propose({ sourceText:"sample", skillKeys:["dotnet"] })).status, "unavailable");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvCacheForTests();
  }
});
