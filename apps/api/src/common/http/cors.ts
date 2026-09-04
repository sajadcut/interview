export type CorsOriginConfig = "*" | string[];

export function buildCorsOrigin(configuredOrigins: string): CorsOriginConfig {
  const origins = [...new Set(
    configuredOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  )];

  if (origins.includes("*")) return "*";
  if (origins.length === 0) {
    throw new Error("CORS_ORIGIN must contain at least one origin or *");
  }

  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`CORS origin must use http:// or https://: ${origin}`);
    }
    if (!parsed.origin || parsed.origin === "null" || parsed.href !== `${parsed.origin}/`) {
      throw new Error(`CORS origin must be an origin only (scheme + host + optional port): ${origin}`);
    }
  }

  return origins;
}

export function assertProductionCorsPolicy(
  nodeEnv: "development" | "test" | "production",
  origins: CorsOriginConfig,
): void {
  if (nodeEnv !== "production") return;
  if (origins === "*") {
    throw new Error("CORS_ORIGIN='*' is not allowed in production");
  }
  if (origins.some((origin: string) => origin.startsWith("http://"))) {
    throw new Error("Production CORS origins must use https://");
  }
}
