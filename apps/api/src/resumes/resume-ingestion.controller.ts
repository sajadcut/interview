import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { MAX_RESUME_BYTES } from "./resume-text-extractor";
import { ResumeDto, ResumeReadReferenceDto, UploadResumeFormDto } from "./resume-ingestion.dto";
import { ResumeIngestionService } from "./resume-ingestion.service";

interface UploadedResumeFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags("resumes")
@ApiStandardErrorResponses()
@Controller("v1/candidates/:candidateId/resumes")
@RequireTenant()
export class ResumeIngestionController {
  constructor(private readonly resumes: ResumeIngestionService) {}

  @Post()
  @RequirePermissions(Permissions.CandidateResumeManage)
  @AuditedAction("resume.ingest", "candidate")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_RESUME_BYTES, files: 1 } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
        applicationId: { type: "string", format: "uuid" },
      },
    },
  })
  @ApiCreatedResponse({ type: ResumeDto })
  ingest(
    @Param("candidateId") candidateId: string,
    @UploadedFile() file: UploadedResumeFile | undefined,
    @Body() body: UploadResumeFormDto,
  ) {
    if (!file?.buffer) throw new BadRequestException("Resume file is required");
    return this.resumes.ingest(
      candidateId,
      { originalName: file.originalname, mimeType: file.mimetype, data: file.buffer },
      body.applicationId,
    );
  }

  @Get()
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: ResumeDto, isArray: true })
  list(@Param("candidateId") candidateId: string) {
    return this.resumes.listResumes(candidateId);
  }

  @Get(":resumeId")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: ResumeDto })
  get(@Param("candidateId") candidateId: string, @Param("resumeId") resumeId: string) {
    return this.resumes.getResume(candidateId, resumeId);
  }

  @Get(":resumeId/read-reference")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: ResumeReadReferenceDto })
  async readReference(@Param("candidateId") candidateId: string, @Param("resumeId") resumeId: string) {
    return { url: await this.resumes.createReadReference(candidateId, resumeId) };
  }
}
