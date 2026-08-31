import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@interview/api-client", "@interview/ui"],
};

export default nextConfig;
