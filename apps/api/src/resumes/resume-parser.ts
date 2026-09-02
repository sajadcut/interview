import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";

export const RESUME_PARSER_VERSION = "resume-structure-v1";

export interface ParsedResumeSkill {
  key: string;
  label: string;
  confidence: number;
}

export interface ParsedResumeExperience {
  company: string;
  title: string;
  startedOn: string | null;
  endedOn: string | null;
  description: string | null;
  fingerprint: string;
  confidence: number;
}

export interface ParsedResumeProfile {
  email: string | null;
  phone: string | null;
  location: string | null;
  preferredLanguage: "fa" | "en" | null;
  currentRole: string | null;
  currentCompany: string | null;
  skills: ParsedResumeSkill[];
  experiences: ParsedResumeExperience[];
  parserVersion: string;
}

const SKILL_ALIASES: Array<[RegExp, string, string]> = [
  [/\btypescript\b/i, "typescript", "TypeScript"],
  [/\bjavascript\b/i, "javascript", "JavaScript"],
  [/\bnode(?:\.js|js)?\b/i, "node-js", "Node.js"],
  [/\breact(?:\.js|js)?\b/i, "react", "React"],
  [/\bnext(?:\.js|js)?\b/i, "next-js", "Next.js"],
  [/\bnest(?:\.js|js)?\b/i, "nest-js", "NestJS"],
  [/\bpostgres(?:ql)?\b/i, "postgresql", "PostgreSQL"],
  [/\bmysql\b/i, "mysql", "MySQL"],
  [/\bredis\b/i, "redis", "Redis"],
  [/\bdocker\b/i, "docker", "Docker"],
  [/\bkubernetes\b|\bk8s\b/i, "kubernetes", "Kubernetes"],
  [/\baws\b|amazon web services/i, "aws", "AWS"],
  [/\bpython\b/i, "python", "Python"],
  [/\bjava\b/i, "java", "Java"],
  [/\bgo(?:lang)?\b/i, "go", "Go"],
  [/\b\.net\b|\bdotnet\b/i, "dotnet", ".NET"],
  [/\bc#\b/i, "c-sharp", "C#"],
  [/\bgit\b/i, "git", "Git"],
  [/\bgraphql\b/i, "graphql", "GraphQL"],
  [/\brest(?:ful)?\b/i, "rest", "REST"],
  [/\bterraform\b/i, "terraform", "Terraform"],
  [/\bci\/?cd\b/i, "ci-cd", "CI/CD"],
];

const SKILL_HEADERS = /^(skills?|technical skills?|technologies|tech stack|مهارت(?:‌| )?ها|مهارت‌های فنی|تکنولوژی(?:‌| )?ها)\s*:?‌?$/i;
const EXPERIENCE_HEADERS = /^(experience|work experience|professional experience|employment|work history|سوابق کاری|تجربه کاری|تجربیات کاری)\s*:?‌?$/i;
const SECTION_HEADER = /^(education|certifications?|projects?|languages?|summary|profile|about|تحصیلات|گواهی|پروژه(?:‌| )?ها|زبان(?:‌| )?ها|خلاصه|درباره)\s*:?‌?$/i;
const DATE_RANGE = /((?:19|20)\d{2})(?:[-/.]\d{1,2})?\s*(?:-|–|—|to|تا)\s*((?:19|20)\d{2}(?:[-/.]\d{1,2})?|present|current|اکنون|حال)/i;

@Injectable()
export class ResumeParser {
  parse(text: string): ParsedResumeProfile {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? null;
    const phone = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.replace(/\s+/g, " ") ?? null;
    const location = findLabeledValue(lines, /^(?:location|city|محل سکونت|شهر)\s*[:：-]\s*(.+)$/i);
    const preferredLanguage = detectLanguage(text);
    const skills = this.parseSkills(lines, text);
    const experiences = this.parseExperiences(lines);
    const current = experiences[0] ?? null;

    return {
      email,
      phone,
      location,
      preferredLanguage,
      currentRole: current?.title ?? null,
      currentCompany: current?.company ?? null,
      skills,
      experiences,
      parserVersion: RESUME_PARSER_VERSION,
    };
  }

  private parseSkills(lines: string[], fullText: string): ParsedResumeSkill[] {
    const explicit: string[] = [];
    let inSkills = false;
    for (const line of lines) {
      if (SKILL_HEADERS.test(line)) {
        inSkills = true;
        continue;
      }
      if (inSkills && (EXPERIENCE_HEADERS.test(line) || SECTION_HEADER.test(line))) break;
      if (inSkills) explicit.push(line);
    }
    const explicitText = explicit.join(" ");
    const found = new Map<string, ParsedResumeSkill>();
    for (const [pattern, key, label] of SKILL_ALIASES) {
      if (pattern.test(explicitText)) found.set(key, { key, label, confidence: 0.95 });
      else if (pattern.test(fullText)) found.set(key, { key, label, confidence: 0.75 });
    }
    if (explicitText) {
      for (const token of explicitText.split(/[,،;|•·]/).map((v) => v.trim())) {
        if (!token || token.length < 2 || token.length > 60) continue;
        const key = slugSkill(token);
        if (key && !found.has(key)) found.set(key, { key, label: token, confidence: 0.85 });
      }
    }
    return [...found.values()].slice(0, 80);
  }

  private parseExperiences(lines: string[]): ParsedResumeExperience[] {
    const rows: ParsedResumeExperience[] = [];
    let inExperience = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (EXPERIENCE_HEADERS.test(line)) {
        inExperience = true;
        continue;
      }
      if (!inExperience) continue;
      if (SECTION_HEADER.test(line) || SKILL_HEADERS.test(line)) break;
      const date = line.match(DATE_RANGE);
      if (!date) continue;
      const heading = line.replace(date[0], "").replace(/[|,؛;]+$/g, "").trim();
      const parts = heading.split(/\s+(?:at|@|—|–|-|\|)\s+/i).map((part) => part.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const [title, company] = parts;
      if (!title || !company || title.length > 240 || company.length > 240) continue;
      const startedOn = `${date[1]}-01-01`;
      const endedRaw = date[2]!.toLowerCase();
      const endedOn = /present|current|اکنون|حال/.test(endedRaw) ? null : `${endedRaw.slice(0, 4)}-12-31`;
      const description = lines[index + 1] && !DATE_RANGE.test(lines[index + 1]!) && !SECTION_HEADER.test(lines[index + 1]!)
        ? lines[index + 1]!.slice(0, 2000)
        : null;
      const fingerprint = createHash("sha256")
        .update([title.toLowerCase(), company.toLowerCase(), startedOn, endedOn ?? "present"].join("|"))
        .digest("hex");
      rows.push({ company, title, startedOn, endedOn, description, fingerprint, confidence: 0.88 });
    }
    return rows.slice(0, 30);
  }
}

function findLabeledValue(lines: string[], pattern: RegExp): string | null {
  for (const line of lines.slice(0, 40)) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1].trim().slice(0, 240);
  }
  return null;
}

function detectLanguage(text: string): "fa" | "en" | null {
  const persian = (text.match(/[\u0600-\u06ff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (persian === 0 && latin === 0) return null;
  return persian > latin * 0.35 ? "fa" : "en";
}

function slugSkill(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}+#.]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}
