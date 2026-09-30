import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

let loaded = false;

function applyTlsPolicy(): void {
  const verify = process.env.HTTPS_TLS_VERIFY ?? "true";
  if (verify !== "true" && verify !== "false") throw new Error("HTTPS_TLS_VERIFY must be true or false");
  if (process.env.NODE_ENV === "production") {
    if (verify === "false" || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
      throw new Error("Disabling HTTPS TLS verification is forbidden in production");
    }
  } else if (verify === "false") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    process.emitWarning("HTTPS_TLS_VERIFY=false disables outbound TLS verification for the Node.js web server only. Development/test only.");
  }
}

export function loadRootEnvironment(): void {
  if (loaded) return;

  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];

  for (const file of new Set(candidates)) {
    if (existsSync(file)) {
      loadEnvFile(file);
      loaded = true;
      applyTlsPolicy();
      return;
    }
  }
  loaded = true;
  applyTlsPolicy();
}
