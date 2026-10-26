import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsUUID } from "class-validator";

export class QuestionBankJobDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() title!: string;
}

export class QuestionBankDocumentDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) jobId!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty() sha256!: string;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional() preview?: string;
}

export class ApplicationQuestionDocumentsDto {
  @ApiProperty({ format: "uuid" }) applicationId!: string;
  @ApiProperty({ format: "uuid" }) jobId!: string;
  @ApiProperty({ type: [QuestionBankDocumentDto] }) availableDocuments!: QuestionBankDocumentDto[];
  @ApiProperty({ type: [String], format: "uuid" }) selectedDocumentIds!: string[];
  @ApiProperty() locked!: boolean;
}

export class SaveQuestionDocumentsDto {
  @ApiProperty({ type: [String], format: "uuid", maxItems: 8 })
  @IsArray()
  @ArrayMaxSize(8)
  @IsUUID("4", { each: true })
  documentIds!: string[];
}

export class QuestionSelectionSnapshotDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) applicationId!: string;
  @ApiProperty({ minimum: 1 }) snapshotVersion!: number;
  @ApiProperty({ type: [String] }) documentIds!: string[];
  @ApiProperty({ type: "array", items: { type: "object" } }) approvedQuestionVersions!: Record<string, unknown>[];
  @ApiProperty() contentSha256!: string;
  @ApiProperty() createdAt!: string;
}
