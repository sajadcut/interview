import { createHmac, randomUUID } from "node:crypto";

export interface LiveKitJoinTokenInput {
  apiKey: string;
  apiSecret: string;
  room: string;
  participantIdentity: string;
  validForSeconds: number;
  nowSeconds?: number;
}

export interface LiveKitJoinTokenResult {
  token: string;
  expiresAt: string;
  participantIdentity: string;
  permissions: {
    roomJoin: true;
    canPublish: true;
    canSubscribe: true;
    canPublishData: false;
    canPublishSources: ["camera", "microphone"];
  };
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function createLiveKitJoinToken(input: LiveKitJoinTokenInput): LiveKitJoinTokenResult {
  if (!input.apiKey.trim()) throw new Error("LiveKit API key is required");
  if (!input.apiSecret.trim()) throw new Error("LiveKit API secret is required");
  if (!input.room.trim()) throw new Error("LiveKit room is required");
  if (!input.participantIdentity.trim()) throw new Error("LiveKit participant identity is required");
  if (!Number.isInteger(input.validForSeconds) || input.validForSeconds < 60 || input.validForSeconds > 900) {
    throw new Error("LiveKit token validity must be between 60 and 900 seconds");
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const exp = now + input.validForSeconds;
  const permissions = {
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    canPublishSources: ["camera", "microphone"] as ["camera", "microphone"],
  };
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: input.apiKey,
    sub: input.participantIdentity,
    nbf: now - 5,
    exp,
    jti: randomUUID(),
    video: {
      room: input.room,
      ...permissions,
    },
  };
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = createHmac("sha256", input.apiSecret).update(signingInput).digest("base64url");

  return {
    token: `${signingInput}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
    participantIdentity: input.participantIdentity,
    permissions,
  };
}
