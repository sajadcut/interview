import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createLiveKitJoinToken } from "./livekit-access-token";

function decodePart<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

test("LiveKit token is short-lived, room scoped and contains no PII metadata", () => {
  const result = createLiveKitJoinToken({
    apiKey: "local-key",
    apiSecret: "local-secret",
    room: "interview-session-opaque",
    participantIdentity: "candidate-media-opaque",
    validForSeconds: 300,
    nowSeconds: 1_800_000_000,
  });
  const [headerPart, payloadPart, signature] = result.token.split(".");
  assert.ok(headerPart && payloadPart && signature);
  const header = decodePart<{ alg: string }>(headerPart);
  const payload = decodePart<{
    iss: string;
    sub: string;
    nbf: number;
    exp: number;
    video: Record<string, unknown>;
  }>(payloadPart);

  assert.equal(header.alg, "HS256");
  assert.equal(payload.iss, "local-key");
  assert.equal(payload.sub, "candidate-media-opaque");
  assert.equal(payload.exp - 1_800_000_000, 300);
  assert.equal(payload.video.room, "interview-session-opaque");
  assert.equal(payload.video.roomJoin, true);
  assert.equal(payload.video.canPublish, true);
  assert.equal(payload.video.canSubscribe, true);
  assert.equal(payload.video.canPublishData, false);
  assert.deepEqual(payload.video.canPublishSources, ["camera", "microphone"]);
  assert.equal(JSON.stringify(payload).includes("email"), false);
  assert.equal(JSON.stringify(payload).includes("name"), false);

  const expected = createHmac("sha256", "local-secret")
    .update(`${headerPart}.${payloadPart}`)
    .digest("base64url");
  assert.equal(signature, expected);
});

test("LiveKit token validity is deliberately bounded", () => {
  assert.throws(
    () => createLiveKitJoinToken({ apiKey: "k", apiSecret: "s", room: "r", participantIdentity: "p", validForSeconds: 30 }),
    /between 60 and 900/,
  );
  assert.throws(
    () => createLiveKitJoinToken({ apiKey: "k", apiSecret: "s", room: "r", participantIdentity: "p", validForSeconds: 3600 }),
    /between 60 and 900/,
  );
});
