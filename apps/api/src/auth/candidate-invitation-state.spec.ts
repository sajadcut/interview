import assert from "node:assert/strict";
import test from "node:test";
import { candidateInvitationState } from "./candidate-auth.service";

const now = new Date("2026-09-02T00:00:00.000Z");

test("candidate invitation reports valid before expiry", () => {
  assert.equal(
    candidateInvitationState({ expiresAt: "2026-09-02T01:00:00.000Z" }, now),
    "valid",
  );
});

test("candidate invitation reports already-used before considering expiry", () => {
  assert.equal(
    candidateInvitationState(
      {
        consumedAt: "2026-09-01T23:00:00.000Z",
        expiresAt: "2026-09-03T00:00:00.000Z",
      },
      now,
    ),
    "used",
  );
});

test("candidate invitation reports expired at or before expiry timestamp", () => {
  assert.equal(
    candidateInvitationState({ expiresAt: "2026-09-02T00:00:00.000Z" }, now),
    "expired",
  );
  assert.equal(
    candidateInvitationState({ expiresAt: "2026-09-01T23:59:59.999Z" }, now),
    "expired",
  );
});

test("candidate invitation reports active temporary lock", () => {
  assert.equal(
    candidateInvitationState(
      {
        expiresAt: "2026-09-03T00:00:00.000Z",
        lockedUntil: "2026-09-02T00:15:00.000Z",
      },
      now,
    ),
    "locked",
  );
});
