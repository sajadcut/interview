import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import type { NextConfig } from "next";

function loadRootEnvironment(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];

  for (const file of new Set(candidates)) {
    if (existsSync(file)) {
      loadEnvFile(file);
      return;
    }
  }
}

loadRootEnvironment();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@interview/api-client", "@interview/ui"],
};

export default nextConfig;
