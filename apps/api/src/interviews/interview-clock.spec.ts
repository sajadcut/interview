import assert from "node:assert/strict";
import test from "node:test";
import { computeInterviewClock } from "./interview-clock";

test("interview clock uses wall time instead of answer duration", () => {
  const clock = computeInterviewClock({
    status: "in_progress",
    timeBudgetMinutes: 45,
    startedAt: "2026-10-06T10:00:00.000Z",
    now: "2026-10-06T10:12:34.000Z",
  });
  assert.equal(clock.durationSeconds, 2700);
  assert.equal(clock.elapsedSeconds, 754);
  assert.equal(clock.remainingSeconds, 1946);
  assert.equal(clock.stage, "normal");
});

test("interview clock enters warning and final-minute stages", () => {
  assert.equal(computeInterviewClock({
    status: "in_progress",
    timeBudgetMinutes: 10,
    startedAt: "2026-10-06T10:00:00.000Z",
    now: "2026-10-06T10:05:01.000Z",
  }).stage, "ending_soon");
  assert.equal(computeInterviewClock({
    status: "in_progress",
    timeBudgetMinutes: 10,
    startedAt: "2026-10-06T10:00:00.000Z",
    now: "2026-10-06T10:09:10.000Z",
  }).stage, "final_minute");
});

test("completed interview clock freezes at completedAt", () => {
  const clock = computeInterviewClock({
    status: "completed",
    timeBudgetMinutes: 30,
    startedAt: "2026-10-06T10:00:00.000Z",
    completedAt: "2026-10-06T10:20:00.000Z",
    now: "2026-10-06T12:00:00.000Z",
  });
  assert.equal(clock.elapsedSeconds, 1200);
  assert.equal(clock.remainingSeconds, 600);
  assert.equal(clock.running, false);
});


test("disconnect and reconnect do not reset the authoritative wall clock", () => {
  const disconnected = computeInterviewClock({
    status: "disconnected",
    timeBudgetMinutes: 20,
    startedAt: "2026-10-06T10:00:00.000Z",
    now: "2026-10-06T10:07:30.000Z",
  });
  const reconnected = computeInterviewClock({
    status: "in_progress",
    timeBudgetMinutes: 20,
    startedAt: "2026-10-06T10:00:00.000Z",
    now: "2026-10-06T10:08:00.000Z",
  });

  assert.equal(disconnected.remainingSeconds, 750);
  assert.equal(reconnected.remainingSeconds, 720);
  assert.equal(disconnected.disconnectPolicy, "clock_continues");
  assert.ok(reconnected.remainingSeconds < disconnected.remainingSeconds);
});
