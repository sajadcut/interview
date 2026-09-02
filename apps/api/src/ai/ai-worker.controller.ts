import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { AiJobQueueService } from "./ai-job-queue.service";
import { AiWorkerAuthGuard } from "./ai-worker-auth.guard";
import {
  ClaimAiJobDto,
  CompleteAiJobDto,
  FailAiJobDto,
  HeartbeatAiJobDto,
} from "./ai-worker.dto";

@ApiExcludeController()
@Controller("internal/ai-worker")
@UseGuards(AiWorkerAuthGuard)
export class AiWorkerController {
  constructor(private readonly queue: AiJobQueueService) {}

  @Post("claim")
  claim(@Body() body: ClaimAiJobDto) {
    return this.queue.claim(body.workerId, body.leaseDurationMs);
  }

  @Post("jobs/:jobId/heartbeat")
  heartbeat(
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Body() body: HeartbeatAiJobDto,
  ) {
    return this.queue.heartbeat(jobId, body.leaseToken, body.workerId, body.leaseDurationMs);
  }

  @Post("jobs/:jobId/succeed")
  complete(
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Body() body: CompleteAiJobDto,
  ) {
    return this.queue.complete(jobId, body.leaseToken, body.workerId, body.result);
  }

  @Post("jobs/:jobId/fail")
  fail(
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Body() body: FailAiJobDto,
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
