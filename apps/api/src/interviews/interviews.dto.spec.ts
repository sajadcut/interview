import assert from "node:assert/strict";
import test from "node:test";
import { validate } from "class-validator";
import {
  CreateInterviewSessionDto,
  InterviewBrainNextTurnInputDto,
  InterviewEvidenceInputDto,
  TranscriptSegmentInputDto,
} from "./interviews.dto";

const validationOptions = { whitelist: true, forbidNonWhitelisted: true } as const;

test("interview session payload is accepted by the global whitelist policy", async () => {
  const dto = Object.assign(new CreateInterviewSessionDto(), {
    applicationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    interviewPlanId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    consentRecordId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    candidateIsRealCustomerCandidate: false,
    synchronousHumanSupervisorPresent: false,
  });

  assert.deepEqual(await validate(dto, validationOptions), []);
});

test("interview session payload rejects unknown properties", async () => {
  const dto = Object.assign(new CreateInterviewSessionDto(), {
    applicationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    interviewPlanId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    consentRecordId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    candidateIsRealCustomerCandidate: false,
    synchronousHumanSupervisorPresent: false,
    unexpected: true,
  });

  const errors = await validate(dto, validationOptions);
  assert.ok(errors.some((error) => error.property === "unexpected"));
});

test("brain, transcript and evidence harness payloads survive whitelist validation", async () => {
  const brain = Object.assign(new InterviewBrainNextTurnInputDto(), {
    latestCandidateText: "A concrete example",
    candidateIntent: "ANSWER",
    elapsedSeconds: 12,
  });
  const transcript = Object.assign(new TranscriptSegmentInputDto(), {
    speaker: "candidate",
    startMs: 0,
    endMs: 1200,
    text: "A concrete example",
    isFinal: true,
  });
  const evidence = Object.assign(new InterviewEvidenceInputDto(), {
    criterionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    turnId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    transcriptSegmentIds: ["ffffffff-ffff-4fff-8fff-ffffffffffff"],
    summary: "Manual harness evidence",
  });

  assert.deepEqual(await validate(brain, validationOptions), []);
  assert.deepEqual(await validate(transcript, validationOptions), []);
  assert.deepEqual(await validate(evidence, validationOptions), []);
});
