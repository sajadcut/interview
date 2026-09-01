import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("apps/web");
const sourceRoots = ["app", "components", "hooks", "lib"].map((entry) => path.join(root, entry));
const extensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const ignored = new Set([
  path.normalize(path.join(root, "app/api/backend/[...path]/route.ts")),
]);

const violations = [];

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(absolute);
      continue;
    }
    if (!extensions.has(path.extname(entry.name)) || ignored.has(path.normalize(absolute))) continue;
    const source = await readFile(absolute, "utf8");
    const relative = path.relative(process.cwd(), absolute).replaceAll("\\", "/");

    const rules = [
      {
        name: "direct /api/backend fetch",
        pattern: /\bfetch\s*\(\s*["'`]\/api\/backend\//,
        message: "Use apps/web/lib/api.ts typed client instead of direct backend fetch.",
      },
      {
        name: "demo-data import/reference",
        pattern: /demo-data(?:\.ts)?/i,
        message: "Production web source must not depend on demo-data.ts.",
      },
      {
        name: "legacy fixture candidate slug",
        pattern: /ali-rahimi/i,
        message: "Legacy fixture candidate slug must not return to production routes.",
      },
      {
        name: "legacy fixture job slug",
        pattern: /senior-backend-engineer/i,
        message: "Legacy fixture job slug must not return to production routes.",
      },
    ];

    for (const rule of rules) {
      if (rule.pattern.test(source)) {
        violations.push(`${relative}: ${rule.name} — ${rule.message}`);
      }
    }
  }
}

for (const directory of sourceRoots) await visit(directory);

if (violations.length) {
  console.error("Frontend contract-usage verification failed:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("✓ frontend production source and helpers have no direct /api/backend fetches or legacy demo fixtures");
}
