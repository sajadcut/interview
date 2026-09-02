import { BadRequestException, Injectable, UnsupportedMediaTypeException } from "@nestjs/common";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export const RESUME_EXTRACTOR_VERSION = "resume-text-v1";
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_CHARS = 500_000;

export interface ExtractedResumeText {
  text: string;
  pageCount: number | null;
  extractorVersion: string;
}

@Injectable()
export class ResumeTextExtractor {
  async extract(input: {
    data: Uint8Array;
    mimeType: string;
    originalName: string;
  }): Promise<ExtractedResumeText> {
    if (input.data.byteLength === 0) throw new BadRequestException("Resume file is empty");
    if (input.data.byteLength > MAX_RESUME_BYTES) throw new BadRequestException("Resume file exceeds 10 MB");

    let text: string;
    let pageCount: number | null = null;

    if (input.mimeType === "text/plain") {
      if (input.data.includes(0)) throw new BadRequestException("Resume text contains invalid binary data");
      text = new TextDecoder("utf-8", { fatal: true }).decode(input.data);
    } else if (input.mimeType === "application/pdf") {
      if (new TextDecoder().decode(input.data.slice(0, 5)) !== "%PDF-") {
        throw new BadRequestException("Uploaded file does not contain a valid PDF header");
      }
      const pdf = await getDocumentProxy(input.data);
      const result = await extractText(pdf, { mergePages: true });
      text = result.text;
      pageCount = result.totalPages;
    } else if (
      input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      if (input.data[0] !== 0x50 || input.data[1] !== 0x4b) {
        throw new BadRequestException("Uploaded file does not contain a valid DOCX container");
      }
      const result = await mammoth.extractRawText({ buffer: Buffer.from(input.data) });
      text = result.value;
    } else {
      throw new UnsupportedMediaTypeException(
        "Supported resume formats are PDF, DOCX and UTF-8 plain text",
      );
    }

    text = normalizeExtractedText(text).slice(0, MAX_EXTRACTED_CHARS);
    if (text.replace(/\s/g, "").length < 40) {
      throw new BadRequestException(
        "Resume contains no usable extractable text; image-only documents require a separate OCR pipeline",
      );
    }
    return { text, pageCount, extractorVersion: RESUME_EXTRACTOR_VERSION };
  }
}

function normalizeExtractedText(value: string): string {
  return value
    .split(String.fromCharCode(0))
    .join("")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/[ \u00a0]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
