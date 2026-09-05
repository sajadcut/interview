import { Global, Module } from "@nestjs/common";
import { AiGatewayService } from "./ai-gateway.service";
import { AiJobQueueService } from "./ai-job-queue.service";
import { AiWorkerAuthGuard } from "./ai-worker-auth.guard";
import { AiWorkerController } from "./ai-worker.controller";

@Global()
@Module({
  controllers: [AiWorkerController],
  providers: [AiGatewayService, AiJobQueueService, AiWorkerAuthGuard],
  exports: [AiGatewayService, AiJobQueueService],
})
export class AiModule {}
