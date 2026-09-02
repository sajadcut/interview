import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";

export interface ResumeChunk {
  index: number;
  text: string;
  contentHash: string;
  startChar: number;
  endChar: number;
}

@Injectable()
export class ResumeChunker {
  chunk(text: string, targetChars = 1200, overlapChars = 150): ResumeChunk[] {
    const chunks: ResumeChunk[] = [];
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + targetChars);
      if (end < text.length) {
        const paragraph = text.lastIndexOf("\n\n", end);
        const newline = text.lastIndexOf("\n", end);
        const boundary = Math.max(paragraph, newline);
        if (boundary > start + Math.floor(targetChars * 0.55)) end = boundary;
      }
      const raw = text.slice(start, end).trim();
      if (raw) {
        const actualStart = text.indexOf(raw, start);
        const actualEnd = actualStart + raw.length;
        chunks.push({
          index: chunks.length,
          text: raw,
          contentHash: createHash("sha256").update(raw).digest("hex"),
          startChar: actualStart,
          endChar: actualEnd,
        });
      }
      if (end >= text.length) break;
      const next = Math.max(start + 1, end - overlapChars);
      start = next;
    }
    return chunks;
  }
}
