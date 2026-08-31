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

  return origins;
}
