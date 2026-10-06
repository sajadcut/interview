import assert from "node:assert/strict";
import test from "node:test";
import { InterviewsService } from "./interviews.service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const segmentId = "33333333-3333-4333-8333-333333333333";

function harness(lifecycleRole: string) {
  let evidenceInserted = false;

  const transaction = async (strings: TemplateStringsArray) => {
    const query = strings.join(" ");
    if (query.includes("FROM interview_transcript_segments")) {
      return [{
        id: segmentId,
        speaker: "candidate",
        is_final: true,
        lifecycle_role: lifecycleRole,
      }];
    }
    if (query.includes("INSERT INTO interview_evidence")) {
      evidenceInserted = true;
      return [{
        id: "44444444-4444-4444-8444-444444444444",
        criterion_id: null,
        turn_id: null,
        transcript_segment_ids: [segmentId],
        summary: "should not be persisted",
        confidence: null,
        source_kind: "transcript",
        created_at: new Date().toISOString(),
      }];
    }
    throw new Error(`Unexpected SQL in evidence boundary test: ${query.replace(/\s+/g, " ").trim()}`);
  };

  const sql = Object.assign(transaction, {
    begin: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
  });

  const service = new InterviewsService(
    { sql } as never,
    { require: () => ({ organizationId }) } as never,
    {} as never,
  );

  return {
    service,
    evidenceInserted: () => evidenceInserted,
  };
}

for (const lifecycleRole of ["introduction", "wrap_up", "candidate_question", "closing"]) {
  test(`recordEvidence rejects ${lifecycleRole} transcript anchors`, async () => {
    const fixture = harness(lifecycleRole);

    await assert.rejects(
      fixture.service.recordEvidence(sessionId, {
        transcriptSegmentIds: [segmentId],
        summary: "lifecycle text must not become evaluation evidence",
      }),
      /Only active interview transcript segments may anchor evaluation evidence/,
    );

    assert.equal(fixture.evidenceInserted(), false);
  });
}

test("recordEvidence still accepts finalized active interview transcript anchors", async () => {
  const fixture = harness("interview");

  const result = await fixture.service.recordEvidence(sessionId, {
    transcriptSegmentIds: [segmentId],
    summary: "candidate described a concrete production decision",
  });

  assert.equal(fixture.evidenceInserted(), true);
  assert.deepEqual(result.transcriptSegmentIds, [segmentId]);
});
