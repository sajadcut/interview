import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { AssessmentWorkerAuthGuard } from "./assessment-worker-auth.guard";
import {
  ClaimAssessmentJobDto,
  CompleteAssessmentJobDto,
  FailAssessmentJobDto,
  HeartbeatAssessmentJobDto,
} from "./assessment-worker.dto";
import { AssessmentWorkerQueueService } from "./assessment-worker-queue.service";

@ApiExcludeController()
@Controller("internal/assessment-worker")
@UseGuards(AssessmentWorkerAuthGuard)
export class AssessmentWorkerController {
  constructor(private readonly queue: AssessmentWorkerQueueService) {}

  @Post("claim")
  claim(@Body() body: ClaimAssessmentJobDto) {
    return this.queue.claim(body.workerId, body.leaseDurationMs);
  }

  @Post("jobs/:jobId/heartbeat")
  heartbeat(
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Body() body: HeartbeatAssessmentJobDto,
  ) {
    return this.queue.heartbeat(jobId, body.leaseToken, body.workerId, body.leaseDurationMs);
  }

  @Post("jobs/:jobId/succeed")
  complete(
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Body() body: CompleteAssessmentJobDto,
  ) {
    return this.queue.complete(jobId, body.leaseToken, body.workerId, body.result);
  }

  @Post("jobs/:jobId/fail")
  fail(
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Body() body: FailAssessmentJobDto,
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
