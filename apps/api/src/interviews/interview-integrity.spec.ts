import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeInterviewIntegrity,
  classifyIntegrityEvent,
  type IntegrityEvent,
} from "./interview-integrity";

function event(
  id: string,
  eventType: IntegrityEvent["eventType"],
  options: Partial<IntegrityEvent> = {},
): IntegrityEvent {
  return {
    id,
    sequence: (options.sequence ?? Number(id.replace(/\D/g, ""))) || 0,
    eventType,
    serverOccurredAt: options.serverOccurredAt ?? "2026-10-06T08:00:00.000Z",
    ...(options.clientOccurredAt !== undefined ? { clientOccurredAt: options.clientOccurredAt } : {}),
    ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
}

test("short blur and focus do not create a concern", () => {
  const result = analyzeInterviewIntegrity([
    event("e1", "window_blur"),
    event("e2", "window_focus", { durationMs: 4_000 }),
  ]);
  assert.equal(result.integrityConcernScore, 0);
  assert.equal(result.riskLevel, "none");
  assert.equal(result.requiresHumanReview, false);
});

test("visibility hidden longer than 30 seconds creates a low signal", () => {
  const result = analyzeInterviewIntegrity([
    event("e1", "visibility_visible", { durationMs: 48_000 }),
  ]);
  assert.equal(result.integrityConcernScore, 10);
  assert.equal(result.signals[0]?.code, "long_visibility_absence");
});

test("visibility hidden longer than 90 seconds creates a stronger signal", () => {
  const result = analyzeInterviewIntegrity([
    event("e1", "visibility_visible", { durationMs: 91_000 }),
  ]);
  assert.equal(result.integrityConcernScore, 20);
  assert.equal(result.riskLevel, "low");
});

test("more than five long absences escalate the pattern", () => {
  const events = Array.from({ length: 6 }, (_, index) =>
    event(`e${index + 1}`, "visibility_visible", {
      sequence: index,
      durationMs: 31_000,
      serverOccurredAt: `2026-10-06T08:0${index}:00.000Z`,
    }),
  );
  const result = analyzeInterviewIntegrity(events);
  assert.ok(result.signals.some((signal) => signal.code === "repeated_long_visibility_absence"));
  assert.ok(result.integrityConcernScore >= 40);
  assert.equal(result.requiresHumanReview, true);
});

test("small paste remains informational and produces no score", () => {
  const classification = classifyIntegrityEvent({
    eventType: "large_paste",
    metadata: { characterCount: 120 },
  });
  const result = analyzeInterviewIntegrity([
    event("e1", "large_paste", { metadata: { characterCount: 120 } }),
  ]);
  assert.equal(classification.severity, "informational");
  assert.equal(result.integrityConcernScore, 0);
});

test("large paste above 300 characters produces a bounded concern", () => {
  const result = analyzeInterviewIntegrity([
    event("e1", "large_paste", { metadata: { characterCount: 684 } }),
  ]);
  assert.equal(result.integrityConcernScore, 10);
  assert.equal(result.signals[0]?.code, "large_paste");
});

test("very large paste above 800 characters produces a stronger concern", () => {
  const result = analyzeInterviewIntegrity([
    event("e1", "large_paste", { metadata: { characterCount: 1200 } }),
  ]);
  assert.equal(result.integrityConcernScore, 20);
  assert.equal(result.signals[0]?.code, "very_large_paste");
});

test("repeated large paste adds a pattern signal", () => {
  const result = analyzeInterviewIntegrity([
    event("e1", "large_paste", { sequence: 1, metadata: { characterCount: 500 } }),
    event("e2", "large_paste", { sequence: 2, metadata: { characterCount: 600 } }),
  ]);
  assert.ok(result.signals.some((signal) => signal.code === "repeated_large_paste"));
  assert.equal(result.integrityConcernScore, 35);
});

test("ordinary reconnect and network failure carry no automatic penalty", () => {
  const result = analyzeInterviewIntegrity([
    event("e1", "network_disconnect", { durationMs: 30_000 }),
    event("e2", "network_reconnect", { durationMs: 30_000 }),
    event("e3", "reconnect"),
  ]);
  assert.equal(result.integrityConcernScore, 0);
  assert.equal(result.requiresHumanReview, false);
});

test("many reconnects create only a low contextual signal", () => {
  const events = Array.from({ length: 7 }, (_, index) =>
    event(`e${index + 1}`, "reconnect", { sequence: index }),
  );
  const result = analyzeInterviewIntegrity(events);
  assert.equal(result.integrityConcernScore, 10);
  assert.equal(result.riskLevel, "none");
  assert.match(result.signals[0]?.description ?? "", /not considered|non-conclusive/i);
});

test("camera and microphone toggles alone never create a concern", () => {
  const result = analyzeInterviewIntegrity([
    event("e1", "camera_disabled"),
    event("e2", "camera_enabled"),
    event("e3", "microphone_disabled"),
    event("e4", "microphone_enabled"),
  ]);
  assert.equal(result.integrityConcernScore, 0);
  assert.equal(result.signals.length, 0);
});

test("unexpected room participant is a high observable signal", () => {
  const result = analyzeInterviewIntegrity([event("e1", "unexpected_room_participant")]);
  assert.equal(result.integrityConcernScore, 35);
  assert.ok(result.signals.some((signal) => signal.code === "unexpected_room_participant"));
  assert.equal(result.confidence, "high");
});

test("concurrent candidate session is a strong signal but not an automatic verdict", () => {
  const result = analyzeInterviewIntegrity([event("e1", "concurrent_session_detected")]);
  assert.equal(result.integrityConcernScore, 30);
  assert.equal(result.riskLevel, "low");
  assert.equal(result.requiresHumanReview, false);
  assert.doesNotMatch(result.summary, /تقلب کرده|cheated/i);
});

test("hidden then large paste correlation creates a medium review signal", () => {
  const result = analyzeInterviewIntegrity([
    event("e1", "visibility_visible", {
      sequence: 1,
      durationMs: 45_000,
      serverOccurredAt: "2026-10-06T08:00:00.000Z",
    }),
    event("e2", "large_paste", {
      sequence: 2,
      serverOccurredAt: "2026-10-06T08:00:07.000Z",
      metadata: { characterCount: 784 },
    }),
  ]);
  assert.ok(result.signals.some((signal) => signal.code === "hidden_then_large_paste"));
  assert.equal(result.integrityConcernScore, 35);
});

test("combined strong signals cap score at 100 and require human review", () => {
  const result = analyzeInterviewIntegrity([
    event("e1", "unexpected_room_participant"),
    event("e2", "concurrent_session_detected"),
    event("e3", "candidate_session_replaced"),
    event("e4", "large_paste", { metadata: { characterCount: 1600 } }),
    event("e5", "answer_submission_spike"),
  ]);
  assert.equal(result.integrityConcernScore, 100);
  assert.equal(result.riskLevel, "high");
  assert.equal(result.requiresHumanReview, true);
});

test("medium risk automatically requires human review", () => {
  const result = analyzeInterviewIntegrity([
    event("e1", "unexpected_room_participant"),
    event("e2", "large_paste", { metadata: { characterCount: 400 } }),
  ]);
  assert.equal(result.riskLevel, "medium");
  assert.equal(result.requiresHumanReview, true);
});

test("event severity is computed by server rules rather than supplied by callers", () => {
  const classification = classifyIntegrityEvent({
    eventType: "camera_disabled",
    durationMs: 999_999,
    metadata: { severity: "high" },
  });
  assert.equal(classification.severity, "informational");
});

test("risk output has no technical score or hiring recommendation fields", () => {
  const result = analyzeInterviewIntegrity([event("e1", "unexpected_room_participant")]);
  assert.equal("technicalScore" in result, false);
  assert.equal("recommendation" in result, false);
  assert.equal("automaticReject" in result, false);
});
