// Resume-first candidate intake: upload -> profile/evidence -> job matches -> human-approved application.
// PDF uploads are normalized to plain Uint8Array before pdf.js/unpdf processing.
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  CandidateJobMatchAnalysisStatusDto,
  CandidateJobMatchDto,
  CandidateMatchApplicationDto,
  CandidateResumeIntakeDto,
} from "./candidate-resume-intake.dto";
import { CandidateResumeIntakeService } from "./candidate-resume-intake.service";
import { MAX_RESUME_BYTES } from "./resume-text-extractor";

interface UploadedResumeFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags("candidate-intake")
@ApiStandardErrorResponses()
@Controller("v1/candidate-intake")
@RequireTenant()
export class CandidateResumeIntakeController {
  constructor(private readonly intake: CandidateResumeIntakeService) {}

  @Post("resumes")
  @RequirePermissions(Permissions.CandidateResumeManage)
  @AuditedAction("candidate.resume.intake", "candidate")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_RESUME_BYTES, files: 1 } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
      },
    },
  })
  @ApiCreatedResponse({ type: CandidateResumeIntakeDto })
  ingest(@UploadedFile() file: UploadedResumeFile | undefined) {
    if (!file?.buffer) throw new BadRequestException("Resume file is required");
    return this.intake.ingest({
      originalName: file.originalname,
      mimeType: file.mimetype,
      data: file.buffer,
    });
  }

  @Get("candidates/:candidateId/job-matches")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: CandidateJobMatchDto, isArray: true })
  matches(@Param("candidateId") candidateId: string) {
    return this.intake.matchJobs(candidateId);
  }

  @Get("analyses/:analysisJobId")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: CandidateJobMatchAnalysisStatusDto })
  analysis(@Param("analysisJobId") analysisJobId: string) {
    return this.intake.getAnalysis(analysisJobId);
  }

  @Post("candidates/:candidateId/job-matches/:jobId/apply")
  @RequirePermissions(Permissions.CandidateMoveStage)
  @AuditedAction("application.create_from_resume_match", "application")
  @ApiOkResponse({ type: CandidateMatchApplicationDto })
  acceptMatch(
    @Param("candidateId") candidateId: string,
    @Param("jobId") jobId: string,
  ) {
    return this.intake.acceptMatch(candidateId, jobId);
  }
}
