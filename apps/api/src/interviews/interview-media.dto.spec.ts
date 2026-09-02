import assert from "node:assert/strict";
import test from "node:test";
import { validate } from "class-validator";
import { InterviewMediaEventInputDto, InterviewMediaModeDto } from "./interview-media.dto";

const options = { whitelist: true, forbidNonWhitelisted: true } as const;

test("media mode payload survives global whitelist validation", async () => {
  const dto = Object.assign(new InterviewMediaModeDto(), { mode: "audio" });
  assert.deepEqual(await validate(dto, options), []);
});

test("media event payload accepts operational metadata and rejects unknown top-level fields", async () => {
  const valid = Object.assign(new InterviewMediaEventInputDto(), {
    idempotencyKey: "heartbeat:transport:0001",
    eventType: "heartbeat",
    sourceComponent: "transport",
    payload: { latencyMs: 42 },
  });
  assert.deepEqual(await validate(valid, options), []);

  const invalid = Object.assign(new InterviewMediaEventInputDto(), {
    idempotencyKey: "heartbeat:transport:0002",
    eventType: "heartbeat",
    sourceComponent: "transport",
    payload: {},
    unexpected: true,
  });
  const errors = await validate(invalid, options);
  assert.ok(errors.some((error) => error.property === "unexpected"));
});
