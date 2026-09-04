import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { PrivacyDeletionLegalHoldService } from "./privacy-deletion-legal-hold.service";
import { PrivacyDeletionQueueService } from "./privacy-deletion-queue.service";
import { PrivacyWorkerAuthGuard } from "./privacy-worker-auth.guard";
import {
  ClaimPrivacyDeletionJobDto,
  ExecutePrivacyDeletionJobDto,
  FailPrivacyDeletionJobDto,
  HeartbeatPrivacyDeletionJobDto,
} from "./privacy-worker.dto";

@ApiExcludeController()
@Controller("internal/privacy-worker")
@UseGuards(PrivacyWorkerAuthGuard)
export class PrivacyWorkerController {
  constructor(
    private readonly queue: PrivacyDeletionQueueService,
    private readonly legalHoldGate: PrivacyDeletionLegalHoldService,
  ) {}

  @Post("claim")
  claim(@Body() body: ClaimPrivacyDeletionJobDto) {
    return this.queue.claim(body.workerId, body.leaseDurationMs);
  }

  @Post("jobs/:jobId/heartbeat")
  heartbeat(
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Body() body: HeartbeatPrivacyDeletionJobDto,
  ) {
    return this.queue.heartbeat(jobId, body.leaseToken, body.workerId, body.leaseDurationMs);
  }

  @Post("jobs/:jobId/execute")
  async execute(
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Body() body: ExecutePrivacyDeletionJobDto,
  ) {
    const blocked = await this.legalHoldGate.blockIfHeld({
      jobId,
      leaseToken: body.leaseToken,
      workerId: body.workerId,
    });
    if (blocked) return blocked;
    return this.queue.execute(jobId, body.leaseToken, body.workerId);
  }

  @Post("jobs/:jobId/fail")
  fail(
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Body() body: FailPrivacyDeletionJobDto,
  ) {
    return this.queue.fail({
      jobId,
      leaseToken: body.leaseToken,
      workerId: body.workerId,
      retryable: body.retryable,
      errorCode: body.errorCode,
      errorMessage: body.errorMessage,
    });
  }
}
