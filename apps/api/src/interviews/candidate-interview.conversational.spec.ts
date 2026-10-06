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

function harness(options: {
  realCandidate?: boolean;
  transcriptText?: string;
  questionAction?: string;
  questionTurnKind?: string;
  brainAction?: string;
  brainTurnKind?: string;
} = {}) {
  const appended: Array<Record<string, unknown>> = [];
  const recordedEvidence: Array<Record<string, unknown>> = [];
  const brainCalls: Array<{ sessionId: string; body: Record<string, unknown> }> = [];
  const mediaEvents: Array<Record<string, unknown>> = [];
  const speechCalls: string[] = [];

  const sql = Object.assign(
    async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("FROM interview_sessions s") && query.includes("JOIN interview_media_sessions")) {
        return [{
          status: "in_progress",
          started_at: new Date(Date.now() - 60_000).toISOString(),
          completed_at: null,
          time_budget_minutes: 20,
          checkpoint: {
            candidateIsRealCustomerCandidate: options.realCandidate === true,
            releaseMode: "development",
          },
          media_session_id: mediaSessionId,
        }];
      }
      if (query.includes("UPDATE interview_sessions") && query.includes("remaining_seconds")) return [];
      if (query.includes("interview_turn_id") && query.includes("FROM interview_transcript_segments")) return [];
      if (query.includes("AS last_end_ms")) return [{ last_end_ms: 1000 }];
      if (query.includes("COALESCE(max(end_ms), 0)")) return [{ elapsed_ms: 1000 }];
      if (query.includes("FROM interview_turns t") && query.includes("criterion_id")) {
        return [{
          turn_id: "99999999-9999-4999-8999-999999999999",
          action: options.questionAction ?? "probe",
          criterion_key: "backend_depth",
          criterion_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          objective: "validate production backend depth",
          turn_kind: options.questionTurnKind ?? "adaptive_follow_up",
          resume_claim_id: null,
        }];
      }
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
      const saved = { id: `segment-${appended.length + 1}`, ...segment };
      appended.push(saved);
      return saved;
    },
    recordEvidence: async (_sessionId: string, evidence: Record<string, unknown>) => {
      recordedEvidence.push(evidence);
      return { id: `evidence-${recordedEvidence.length}`, ...evidence };
    },
  };
  const brain = {
    nextTurn: async (sessionId: string, body: Record<string, unknown>) => {
      brainCalls.push({ sessionId, body });
      return {
        id: "88888888-8888-4888-8888-888888888888",
        action: options.brainAction ?? "probe",
        criterion: "backend_depth",
        objective: "validate production backend depth",
        spokenText: "چرا Redis را انتخاب کردید و قبلش چه گزینه‌ای را بررسی کردید؟",
        expectedEvidence: ["trade-offs"],
        remainingSeconds: 1180,
        finalized: true,
        turnKind: options.brainTurnKind ?? "adaptive_follow_up",
        questionSource: "adaptive_follow_up",
        resumeClaimId: null,
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
    { enqueue: async () => ({ id: "job-1", status: "queued" }) } as never,
    candidateSessions as never,
    candidateConsent as never,
    tenantContext as never,
    interviews as never,
    {} as never,
    brain as never,
    { buildInput: async () => ({}) } as never,
    media as never,
    speech as never,
  );

  return { service, appended, recordedEvidence, brainCalls, mediaEvents, speechCalls };
}

test("candidate text answers use the shared conversational brain path", async () => {
  const { service, appended, recordedEvidence, brainCalls, mediaEvents } = harness();
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
  assert.equal(recordedEvidence.length, 1);
  assert.equal(recordedEvidence[0]?.criterionId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(result.turn.spokenText, "چرا Redis را انتخاب کردید و قبلش چه گزینه‌ای را بررسی کردید؟");
  assert.equal(mediaEvents.length, 1);
});

test("non-substantive answers do not create positive interview evidence", async () => {
  const { service, recordedEvidence, brainCalls } = harness();
  await service.answerText("candidate-token", {
    sessionId: interviewSessionId,
    mediaSessionId,
    text: "نمی‌دانم",
  });

  assert.equal(recordedEvidence.length, 0);
  assert.equal(brainCalls[0]?.body.candidateIntent, "ANSWER");
});

test("candidate end request reaches the brain as an explicit lifecycle intent and creates no evidence", async () => {
  const { service, recordedEvidence, brainCalls } = harness();
  await service.answerText("candidate-token", {
    sessionId: interviewSessionId,
    mediaSessionId,
    text: "می‌خواهم مصاحبه را پایان بدهم",
  });

  assert.equal(recordedEvidence.length, 0);
  assert.equal(brainCalls[0]?.body.candidateIntent, "END_INTERVIEW_REQUEST");
});

test("candidate-question opportunity is not scored as interview evidence", async () => {
  const { service, recordedEvidence, brainCalls, appended } = harness({
    questionAction: "escalate",
    questionTurnKind: "candidate_question",
    brainAction: "close",
    brainTurnKind: "closing",
  });
  await service.answerText("candidate-token", {
    sessionId: interviewSessionId,
    mediaSessionId,
    text: "درباره فرایند استخدام سؤال دارم؟",
  });

  assert.equal(recordedEvidence.length, 0);
  assert.equal(brainCalls[0]?.body.candidateIntent, "CANDIDATE_QUESTION");
  assert.equal(appended[0]?.lifecycleRole, "candidate_question");
  assert.equal(appended[1]?.lifecycleRole, "closing");
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
