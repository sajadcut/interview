import assert from "node:assert/strict";
import test from "node:test";
import { JsonLogger } from "./json.logger";

test("json logger redacts structured and inline secrets", () => {
  const logger = new JsonLogger();
  const lines: string[] = [];
  const original = console.log;
  console.log = (value?: unknown) => {
    lines.push(String(value));
  };
  try {
    logger.log(
      {
        authorization: "Bearer abcdefghijklmnop",
        refreshToken: "refresh-value",
        promptTokens: 42,
      },
      "https://example.invalid/callback?token=query-secret&ok=1",
    );
  } finally {
    console.log = original;
  }

  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0] ?? "", /abcdefghijklmnop|refresh-value|query-secret/);
  assert.match(lines[0] ?? "", /\[REDACTED\]/);
  assert.match(lines[0] ?? "", /promptTokens/);
  assert.match(lines[0] ?? "", /ok=1/);
});
