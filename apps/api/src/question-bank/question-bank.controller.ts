import {
  BadRequestException, Body, Controller, Get, Param, Post, Put, UploadedFile, UseInterceptors, ParseUUIDPipe,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { Permissions } from "../auth/permissions";
import { AuditedAction } from "../audit/audited-action.decorator";
import { MAX_RESUME_BYTES } from "../resumes/resume-text-extractor";
import {
  QuestionBankJobDto, QuestionBankDocumentDto, ApplicationQuestionDocumentsDto, SaveQuestionDocumentsDto, QuestionSelectionSnapshotDto,
} from "./question-bank.dto";
import { QuestionBankService } from "./question-bank.service";

@ApiTags("question-bank")
@Controller("v1/question-bank")
@RequireTenant()
export class QuestionBankController {
  constructor(private readonly bank: QuestionBankService) {}

  @Get("jobs")
  @RequirePermissions(Permissions.JobRead)
  @ApiOkResponse({ type: QuestionBankJobDto, isArray: true })
  jobs() { return this.bank.jobs(); }

  @Get("jobs/:jobId/documents")
  @RequirePermissions(Permissions.JobRead)
  @ApiOkResponse({ type: QuestionBankDocumentDto, isArray: true })
  list(@Param("jobId", ParseUUIDPipe) jobId: string) { return this.bank.list(jobId); }

  @Post("jobs/:jobId/documents")
  @RequirePermissions(Permissions.JobEdit)
  @AuditedAction("question_bank.document.upload", "job")
  @UseInterceptors(FileInterceptor("file", { limits: { files: 1, fileSize: MAX_RESUME_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } })
  @ApiCreatedResponse({ type: QuestionBankDocumentDto })
  upload(@Param("jobId", ParseUUIDPipe) jobId: string,
         @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined) {
    if (!file?.buffer) throw new BadRequestException("Document file is required");
    return this.bank.upload(jobId, file);
  }

  @Get("applications/:applicationId/documents")
  @RequirePermissions(Permissions.InterviewAssign)
  @ApiOkResponse({ type: ApplicationQuestionDocumentsDto })
  selection(@Param("applicationId", ParseUUIDPipe) applicationId: string) {
    return this.bank.selection(applicationId);
  }

  @Get("applications/:applicationId/document-snapshots")
  @RequirePermissions(Permissions.InterviewAssign)
  @ApiOkResponse({ type: QuestionSelectionSnapshotDto, isArray: true })
  snapshots(@Param("applicationId", ParseUUIDPipe) applicationId: string) {
    return this.bank.selectionSnapshots(applicationId);
  }

  @Put("applications/:applicationId/documents")
  @RequirePermissions(Permissions.InterviewAssign)
  @AuditedAction("question_bank.selection.save", "application")
  @ApiOkResponse({ type: ApplicationQuestionDocumentsDto })
  save(@Param("applicationId", ParseUUIDPipe) applicationId: string, @Body() input: SaveQuestionDocumentsDto) {
    return this.bank.saveSelection(applicationId, input.documentIds);
  }
}
