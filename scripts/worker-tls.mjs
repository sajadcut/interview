import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

/** Configure Node outbound TLS before any worker issues network requests. */
export function configureWorkerTls(env = process.env) {
  if (env === process.env && env.NODE_ENV !== "production") {
    for (const path of new Set([resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")])) {
      if (existsSync(path)) { loadEnvFile(path); break; }
    }
  }
  const verify = env.HTTPS_TLS_VERIFY ?? "true";
  if (verify !== "true" && verify !== "false") throw new Error("HTTPS_TLS_VERIFY must be true or false");
  if (env.NODE_ENV === "production") {
    if (verify === "false" || env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
      throw new Error("Disabling outbound TLS verification is forbidden in production");
    }
  } else if (verify === "false") {
    env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    if (env === process.env) process.emitWarning("HTTPS_TLS_VERIFY=false disables outbound TLS verification for this Node.js worker. Development/test only.");
  }
}
