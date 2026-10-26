/** Conservative, deterministic skill-to-taxonomy mapping for resume assertions.
 * Never infer a skill from a related technology; unmapped skills remain in candidate_skills for review.
 */
export interface CanonicalSkill {
  key: string;
  nameEn: string;
  nameFa: string;
  category: "technical" | "soft";
  taxonomyVersion: "v1";
}

export interface AnchoredResumeSkillClaim {
  skill: CanonicalSkill;
  claimText: string;
  startChar: number;
  endChar: number;
}

const DEFINITIONS: ReadonlyArray<CanonicalSkill & { aliases: readonly string[]; evidencePattern: RegExp }> = [
  { key: "c-sharp", nameEn: "C#", nameFa: "سی‌شارپ", category: "technical", taxonomyVersion: "v1",
    aliases: ["c-sharp", "c#", "c sharp"], evidencePattern: /(?:^|[^\p{L}\p{N}])c\s*#(?=$|[^\p{L}\p{N}])/iu },
  { key: "aspnet-core", nameEn: "ASP.NET Core", nameFa: "ای‌اس‌پی دات‌نت کور", category: "technical", taxonomyVersion: "v1",
    aliases: ["aspnet-core", "asp.net core", "asp net core"], evidencePattern: /\basp\s*\.?\s*net\s+core\b/i },
  { key: "dotnet", nameEn: ".NET", nameFa: "دات‌نت", category: "technical", taxonomyVersion: "v1",
    aliases: ["dotnet", ".net"], evidencePattern: /\bdotnet\b|(?<![\p{L}\p{N}])\.net\b/iu },
  { key: "sql-server", nameEn: "SQL Server", nameFa: "اس‌کیوال سرور", category: "technical", taxonomyVersion: "v1",
    aliases: ["sql-server", "sql server", "microsoft sql server"], evidencePattern: /\b(?:microsoft\s+)?sql\s+server\b/i },
  { key: "sql", nameEn: "SQL", nameFa: "اس‌کیوال", category: "technical", taxonomyVersion: "v1",
    aliases: ["sql"], evidencePattern: /\bsql\b(?!\s+server)/i },
  { key: "redis", nameEn: "Redis", nameFa: "ردیس", category: "technical", taxonomyVersion: "v1",
    aliases: ["redis"], evidencePattern: /\bredis\b/i },
  { key: "microservices", nameEn: "Microservices", nameFa: "میکروسرویس", category: "technical", taxonomyVersion: "v1",
    aliases: ["microservices", "microservice", "micro-services", "micro-services architecture"],
    evidencePattern: /\bmicro[\s-]?services?\b/i },
  { key: "distributed-systems", nameEn: "Distributed Systems", nameFa: "سامانه‌های توزیع‌شده", category: "technical", taxonomyVersion: "v1",
    aliases: ["distributed-systems", "distributed systems"],
    evidencePattern: /\bdistributed\s+systems?\b/i },
  { key: "postgresql", nameEn: "PostgreSQL", nameFa: "پستگرس", category: "technical", taxonomyVersion: "v1",
    aliases: ["postgresql", "postgres"], evidencePattern: /\bpostgres(?:ql)?\b/i },
  { key: "docker", nameEn: "Docker", nameFa: "داکر", category: "technical", taxonomyVersion: "v1",
    aliases: ["docker"], evidencePattern: /\bdocker\b/i },
  { key: "rabbitmq", nameEn: "RabbitMQ", nameFa: "ربیت‌ام‌کیو", category: "technical", taxonomyVersion: "v1",
    aliases: ["rabbitmq"], evidencePattern: /\brabbitmq\b/i },
  { key: "ef-core", nameEn: "Entity Framework Core", nameFa: "انتیتی فریم‌ورک کور", category: "technical", taxonomyVersion: "v1",
    aliases: ["ef-core", "ef core", "entity framework core"],
    evidencePattern: /\bef\s+core\b|\bentity\s+framework\s+core\b/i },
];

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
}

/** Returns null rather than guessing if the parser label is unknown or no literal resume span exists. */
export function anchorResumeSkillClaim(
  text: string,
  parsedSkill: { key: string; label: string },
): AnchoredResumeSkillClaim | null {
  const key = normalize(parsedSkill.key);
  const label = normalize(parsedSkill.label);
  const definition = DEFINITIONS.find((entry) =>
    entry.key === key || entry.aliases.some((alias) => normalize(alias) === label),
  );
  if (!definition) return null;
  const match = definition.evidencePattern.exec(text);
  if (!match || match.index === undefined) return null;
  const from = Math.max(0, text.lastIndexOf("\n", match.index) + 1);
  const nextNewline = text.indexOf("\n", match.index);
  const lineEnd = nextNewline < 0 ? text.length : nextNewline;
  const left = Math.max(from, match.index - 180);
  const right = Math.min(lineEnd, match.index + Math.max(match[0].length, 1) + 180);
  const excerpt = text.slice(left, right).trim();
  if (!excerpt) return null;
  const leading = text.slice(left, right).indexOf(excerpt);
  const startChar = left + leading;
  const endChar = startChar + excerpt.length;
  return {
    skill: { key: definition.key, nameEn: definition.nameEn, nameFa: definition.nameFa,
      category: definition.category, taxonomyVersion: definition.taxonomyVersion },
    claimText: excerpt,
    startChar,
    endChar,
  };
}
