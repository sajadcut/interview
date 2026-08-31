import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import type { NextConfig } from "next";

const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
for (const file of new Set(candidates)) {
  if (existsSync(file)) {
    loadEnvFile(file);
    break;
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@interview/api-client", "@interview/ui"],
};

export default nextConfig;
