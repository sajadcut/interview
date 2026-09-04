import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { RetentionQueueService } from "./retention-queue.service";
import { RetentionWorkerAuthGuard } from "./retention-worker-auth.guard";
import {
  ClaimRetentionJobDto,
  FailRetentionJobDto,
  HeartbeatRetentionJobDto,
  RetentionJobLeaseDto,
  ScheduleRetentionJobsDto,
} from "./retention-worker.dto";

@ApiExcludeController()
@Controller("internal/retention-worker")
@UseGuards(RetentionWorkerAuthGuard)
export class RetentionWorkerController {
  constructor(private readonly queue: RetentionQueueService) {}

  @Post("schedule")
  schedule(@Body() body: ScheduleRetentionJobsDto) {
    return this.queue.schedule(body.cycleKey, body.dryRun !== false);
  }

  @Post("claim")
  claim(@Body() body: ClaimRetentionJobDto) {
    return this.queue.claim(body.workerId, body.leaseDurationMs);
  }

  @Post("jobs/:jobId/heartbeat")
  heartbeat(
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Body() body: HeartbeatRetentionJobDto,
  ) {
    return this.queue.heartbeat(jobId, body.leaseToken, body.workerId, body.leaseDurationMs);
  }

  @Post("jobs/:jobId/execute")
  execute(
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Body() body: RetentionJobLeaseDto,
  ) {
    return this.queue.execute(jobId, body.leaseToken, body.workerId);
  }

  @Post("jobs/:jobId/fail")
  fail(
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Body() body: FailRetentionJobDto,
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
