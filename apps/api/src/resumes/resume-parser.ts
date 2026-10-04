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
  [/\bsql\s+server\b/i, "sql-server", "SQL Server"],
  [/\bsql\b/i, "sql", "SQL"],
  [/\bmysql\b/i, "mysql", "MySQL"],
  [/\bredis\b/i, "redis", "Redis"],
  [/\bdocker\b/i, "docker", "Docker"],
  [/\bkubernetes\b|\bk8s\b/i, "kubernetes", "Kubernetes"],
  [/\baws\b|amazon web services/i, "aws", "AWS"],
  [/\bpython\b/i, "python", "Python"],
  [/\bjava\b/i, "java", "Java"],
  [/\bgo(?:lang)?\b/i, "go", "Go"],
  [/\basp\.net\s+core\b/i, "aspnet-core", "ASP.NET Core"],
  [/\bentity\s+framework\s+core\b|\bef\s+core\b/i, "ef-core", "Entity Framework Core"],
  [/\b\.net\b|\bdotnet\b/i, "dotnet", ".NET"],
  [/(?:^|[^A-Za-z0-9_])c#(?=$|[^A-Za-z0-9_])/i, "c-sharp", "C#"],
  [/\bdapper\b/i, "dapper", "Dapper"],
  [/\bgrpc\b/i, "grpc", "gRPC"],
  [/\brabbitmq\b/i, "rabbitmq", "RabbitMQ"],
  [/\bopentelemetry\b/i, "opentelemetry", "OpenTelemetry"],
  [/\bgit\b/i, "git", "Git"],
  [/\bgraphql\b/i, "graphql", "GraphQL"],
  [/\brest(?:ful)?\b/i, "rest", "REST"],
  [/\bterraform\b/i, "terraform", "Terraform"],
  [/\bci\/?cd\b/i, "ci-cd", "CI/CD"],
];

const SKILL_HEADERS = /^(skills?|technical skills?|technologies|tech stack|مهارت(?:‌| )?ها|مهارت‌های فنی|تکنولوژی(?:‌| )?ها)\s*:?‌?$/i;
const EXPERIENCE_HEADERS = /^(experience|work experience|professional experience|employment|work history|سوابق کاری|تجربه کاری|تجربیات کاری)\s*:?‌?$/i;
const SECTION_HEADER = /^(education|certifications?|projects?|languages?|summary|profile|about|تحصیلات|گواهی|پروژه(?:‌| )?ها|زبان(?:‌| )?ها|خلاصه|درباره)\s*:?‌?$/i;
const MONTH_NAME = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_RANGE = new RegExp(
  `(?:${MONTH_NAME}\\s+)?((?:19|20)\\d{2})(?:[-/.]\\d{1,2})?\\s*(?:-|–|—|to|تا)\\s*(?:${MONTH_NAME}\\s+)?((?:19|20)\\d{2}(?:[-/.]\\d{1,2})?|present|current|اکنون|حال)`,
  "i",
);

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

      const sameLineHeading = cleanExperienceHeading(line.replace(date[0], ""));
      const previousLine = index > 0 ? lines[index - 1]! : "";
      const previousHeading = cleanExperienceHeading(previousLine);
      const sameLineParts = splitExperienceHeading(sameLineHeading);
      const heading = sameLineParts ?? splitExperienceHeading(previousHeading);
      if (!heading) continue;

      const startedOn = `${date[1]}-01-01`;
      const endedRaw = date[2]!.toLowerCase();
      const endedOn = /present|current|اکنون|حال/.test(endedRaw)
        ? null
        : `${endedRaw.slice(0, 4)}-12-31`;

      const descriptionLines: string[] = [];
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const candidate = lines[cursor]!;
        if (
          EXPERIENCE_HEADERS.test(candidate) ||
          SECTION_HEADER.test(candidate) ||
          SKILL_HEADERS.test(candidate) ||
          DATE_RANGE.test(candidate)
        ) {
          break;
        }
        if (descriptionLines.length >= 8) break;
        descriptionLines.push(candidate);
      }
      const description = descriptionLines.length
        ? descriptionLines.join(" ").slice(0, 4000)
        : null;

      const fingerprint = createHash("sha256")
        .update([
          heading.title.toLowerCase(),
          heading.company.toLowerCase(),
          startedOn,
          endedOn ?? "present",
        ].join("|"))
        .digest("hex");

      rows.push({
        company: heading.company,
        title: heading.title,
        startedOn,
        endedOn,
        description,
        fingerprint,
        confidence: sameLineParts ? 0.9 : 0.86,
      });
    }

    return rows.slice(0, 30);
  }
}

function cleanExperienceHeading(value: string): string {
  return value
    .replace(/^[-–—|,;:\s]+|[-–—|,;:\s]+$/g, "")
    .trim();
}

function splitExperienceHeading(value: string): { title: string; company: string } | null {
  if (!value || value.length > 500) return null;
  const parts = value
    .split(/\s+(?:at|@|—|–|-|\|)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const title = parts[0]!;
  const company = parts.slice(1).join(" - ");
  if (
    !title ||
    !company ||
    title.length > 240 ||
    company.length > 240 ||
    looksLikeLocation(title) ||
    looksLikeDateFragment(company)
  ) {
    return null;
  }
  return { title, company };
}

function looksLikeLocation(value: string): boolean {
  return /\b(iran|tehran|remote|hybrid|onsite|on-site)\b/i.test(value) ||
    /^(?:تهران|ایران|دورکار|ترکیبی)(?:\s|,|$)/.test(value);
}

function looksLikeDateFragment(value: string): boolean {
  const normalized = value.trim();
  return /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|(?:19|20)\d{2}|present|current|اکنون|حال)$/i.test(normalized);
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
