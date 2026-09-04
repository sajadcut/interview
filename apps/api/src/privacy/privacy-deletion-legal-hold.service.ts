import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

interface ClaimedPrivacyDeletionJob {
  id: string;
  organization_id: string;
  privacy_request_id: string;
  candidate_id: string | null;
}

@Injectable()
export class PrivacyDeletionLegalHoldService {
  constructor(private readonly database: DatabaseService) {}

  async blockIfHeld(input: { jobId: string; leaseToken: string; workerId: string }) {
    return this.database.sql.begin(async (tx) => {
      const jobs = await tx`
        SELECT id::text, organization_id::text, privacy_request_id::text, candidate_id::text
        FROM privacy_deletion_jobs
        WHERE id = ${input.jobId}::uuid
          AND state = 'claimed'
          AND lease_token = ${input.leaseToken}::uuid
          AND worker_id = ${input.workerId}
          AND lease_expires_at > now()
        LIMIT 1
        FOR UPDATE
      `;
      const job = jobs[0] as ClaimedPrivacyDeletionJob | undefined;
      if (!job?.candidate_id) return null;

      const holds = await tx`
        SELECT hold.id::text, hold.entity_type
        FROM legal_holds hold
        WHERE hold.organization_id = ${job.organization_id}::uuid
          AND hold.status = 'active'
          AND (
            hold.candidate_id = ${job.candidate_id}::uuid
            OR (hold.entity_type = 'candidate' AND hold.entity_id = ${job.candidate_id}::uuid)
            OR (
              hold.entity_type = 'application'
              AND hold.entity_id IN (
                SELECT application.id FROM applications application
                WHERE application.organization_id = ${job.organization_id}::uuid
                  AND application.candidate_id = ${job.candidate_id}::uuid
              )
            )
            OR (
              hold.entity_type = 'resume'
              AND hold.entity_id IN (
                SELECT resume.id FROM resumes resume
                WHERE resume.organization_id = ${job.organization_id}::uuid
                  AND resume.candidate_id = ${job.candidate_id}::uuid
              )
            )
            OR (
              hold.entity_type = 'interview_session'
              AND hold.entity_id IN (
                SELECT session.id
                FROM interview_sessions session
                JOIN applications application
                  ON application.organization_id = session.organization_id
                 AND application.id = session.application_id
                WHERE session.organization_id = ${job.organization_id}::uuid
                  AND application.candidate_id = ${job.candidate_id}::uuid
              )
            )
            OR (
              hold.entity_type = 'assessment_session'
              AND hold.entity_id IN (
                SELECT session.id
                FROM assessment_sessions session
                JOIN applications application
                  ON application.organization_id = session.organization_id
                 AND application.id = session.application_id
                WHERE session.organization_id = ${job.organization_id}::uuid
                  AND application.candidate_id = ${job.candidate_id}::uuid
              )
            )
          )
        ORDER BY hold.placed_at ASC
        LIMIT 1
      `;
      const hold = holds[0];
      if (!hold) return null;

      const blocked = await tx`
        UPDATE privacy_deletion_jobs
        SET state = 'blocked',
            worker_id = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error_code = 'LEGAL_HOLD',
            last_error = 'Active canonical legal hold prevents candidate privacy deletion',
            updated_at = now()
        WHERE organization_id = ${job.organization_id}::uuid
          AND id = ${job.id}::uuid
          AND state = 'claimed'
          AND lease_token = ${input.leaseToken}::uuid
          AND worker_id = ${input.workerId}
        RETURNING id::text
      `;
      if (!blocked[0]) return null;

      await tx`
        UPDATE privacy_requests
        SET status = 'deletion_blocked', updated_at = now()
        WHERE organization_id = ${job.organization_id}::uuid
          AND id = ${job.privacy_request_id}::uuid
      `;

      return {
        jobId: job.id,
        state: "blocked" as const,
        errorCode: "LEGAL_HOLD",
        message: "Active legal hold prevents privacy deletion",
        legalHoldId: String(hold.id),
      };
    });
  }
}
