import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseService } from "../database/database.service";
import { CandidateInterviewService } from "./candidate-interview.service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const candidateId = "22222222-2222-4222-8222-222222222222";
const identityId = "33333333-3333-4333-8333-333333333333";
const applicationId = "44444444-4444-4444-8444-444444444444";
const candidateSessionId = "55555555-5555-4555-8555-555555555555";
const interviewSessionId = "66666666-6666-4666-8666-666666666666";
const mediaSessionId = "77777777-7777-4777-8777-777777777777";

function harness(options: { realCandidate?: boolean; transcriptText?: string } = {}) {
  const appended: Array<Record<string, unknown>> = [];
  const brainCalls: Array<{ sessionId: string; body: Record<string, unknown> }> = [];
  const mediaEvents: Array<Record<string, unknown>> = [];
  const speechCalls: string[] = [];

  const sql = Object.assign(
    async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("FROM interview_sessions s") && query.includes("JOIN interview_media_sessions")) {
        return [{
          status: "in_progress",
          remaining_seconds: 1200,
          checkpoint: {
            candidateIsRealCustomerCandidate: options.realCandidate === true,
            releaseMode: "development",
          },
          media_session_id: mediaSessionId,
        }];
      }
      if (query.includes("COALESCE(max(end_ms), 0)")) return [{ elapsed_ms: 1000 }];
      throw new Error(`Unexpected candidate interview SQL in unit test: ${query.replace(/\s+/g, " ").trim()}`);
    },
    { json: (value: unknown) => value },
  );
  const database = { sql } as unknown as DatabaseService;

  const candidateSessions = {
    resolve: async () => ({
      sessionId: candidateSessionId,
      expiresAt: new Date(Date.now() + 60_000),
      organizationId,
      candidateId,
      candidateIdentityId: identityId,
      applicationId,
    }),
  };
  const candidateConsent = {
    status: async () => ({
      readyForInterview: true,
      missingRequiredConsents: [],
      latest: [],
    }),
  };
  const tenantContext = {
    require: () => ({ organizationId }),
    run: async (_organizationId: string, callback: () => unknown) => callback(),
  };
  const interviews = {
    appendTranscriptSegment: async (_sessionId: string, segment: Record<string, unknown>) => {
      appended.push(segment);
      return segment;
    },
  };
  const brain = {
    nextTurn: async (sessionId: string, body: Record<string, unknown>) => {
      brainCalls.push({ sessionId, body });
      return {
        id: "88888888-8888-4888-8888-888888888888",
        action: "probe",
        criterion: "backend_depth",
        objective: "validate production backend depth",
        spokenText: "چرا Redis را انتخاب کردید و قبلش چه گزینه‌ای را بررسی کردید؟",
        expectedEvidence: ["trade-offs"],
        remainingSeconds: 1180,
        finalized: true,
      };
    },
  };
  const media = {
    appendEvent: async (_sessionId: string, _mediaSessionId: string, event: Record<string, unknown>) => {
      mediaEvents.push(event);
      return event;
    },
  };
  const speech = {
    transcribeCandidateAudio: async () => {
      speechCalls.push("synthetic");
      return {
        speechDetected: true,
        durationSeconds: 4,
        transcript: {
          text: options.transcriptText ?? "Latency پایین نیومد، Redis اضافه کردیم",
          language: "fa",
          provider: "whisper-http",
        },
      };
    },
    transcribeAuthenticatedCandidateAudio: async () => {
      speechCalls.push("authenticated");
      return {
        speechDetected: true,
        durationSeconds: 4,
        transcript: {
          text: options.transcriptText ?? "Latency پایین نیومد، Redis اضافه کردیم",
          language: "fa",
          provider: "whisper-http",
        },
      };
    },
  };

  const service = new CandidateInterviewService(
    database,
    candidateSessions as never,
    candidateConsent as never,
    tenantContext as never,
    interviews as never,
    {} as never,
    brain as never,
    media as never,
    speech as never,
  );

  return { service, appended, brainCalls, mediaEvents, speechCalls };
}

test("candidate text answers use the shared conversational brain path", async () => {
  const { service, appended, brainCalls, mediaEvents } = harness();
  const result = await service.answerText("candidate-token", {
    sessionId: interviewSessionId,
    mediaSessionId,
    text: "نتیجه هیچی نشد",
  });

  assert.equal(brainCalls.length, 1);
  assert.equal(brainCalls[0]?.sessionId, interviewSessionId);
  assert.equal(brainCalls[0]?.body.latestCandidateText, "نتیجه هیچی نشد");
  assert.equal(brainCalls[0]?.body.candidateIntent, "ANSWER");
  assert.equal(appended.length, 2);
  assert.equal(appended[0]?.speaker, "candidate");
  assert.equal(appended[1]?.speaker, "interviewer");
  assert.equal(result.turn.spokenText, "چرا Redis را انتخاب کردید و قبلش چه گزینه‌ای را بررسی کردید؟");
  assert.equal(mediaEvents.length, 1);
});

test("candidate audio uses Whisper transcript then the exact same conversational brain path", async () => {
  const { service, brainCalls, speechCalls, appended } = harness({
    transcriptText: "Latency پایین نیومد، Redis اضافه کردیم",
  });
  const result = await service.answerAudio(
    "candidate-token",
    interviewSessionId,
    mediaSessionId,
    new Uint8Array([82, 73, 70, 70]),
    "audio/wav",
  );

  assert.deepEqual(speechCalls, ["synthetic"]);
  assert.equal(result.speechDetected, true);
  assert.equal(result.transcript?.provider, "whisper-http");
  assert.equal(brainCalls.length, 1);
  assert.equal(brainCalls[0]?.body.latestCandidateText, "Latency پایین نیومد، Redis اضافه کردیم");
  assert.equal(brainCalls[0]?.body.candidateIntent, "ANSWER");
  assert.equal(appended[0]?.text, "Latency پایین نیومد، Redis اضافه کردیم");
});

test("real-candidate audio keeps authenticated Whisper before entering conversational brain", async () => {
  const { service, brainCalls, speechCalls } = harness({ realCandidate: true });
  await service.answerAudio(
    "candidate-token",
    interviewSessionId,
    mediaSessionId,
    new Uint8Array([82, 73, 70, 70]),
    "audio/wav",
  );

  assert.deepEqual(speechCalls, ["authenticated"]);
  assert.equal(brainCalls.length, 1);
});
