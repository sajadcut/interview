import type { NextConfig } from "next";
import { loadRootEnvironment } from "./lib/root-env";

loadRootEnvironment();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@interview/api-client", "@interview/ui"],
};

export default nextConfig;
