export function buildCorsOrigins(configuredOrigins: string, nodeEnv: string): string[] {
  const origins = new Set(
    configuredOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  if (nodeEnv !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
    origins.add("http://[::1]:3000");
  }

  return [...origins];
}
