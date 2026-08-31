import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
let server = null;
let shuttingDown = false;
let stdoutBuffer = "";

function startServer() {
  if (server) {
    server.kill();
    server = null;
  }

  server = spawn(process.execPath, ["dist/main.js"], {
    stdio: "inherit",
    env: process.env,
  });

  server.on("exit", (code, signal) => {
    if (!shuttingDown && code && code !== 0) {
      console.error(`[api-dev] server exited with code ${code}${signal ? ` (${signal})` : ""}`);
    }
  });
}

const compiler = spawn(
  isWindows ? "npm.cmd" : "npm",
  ["exec", "--", "tsc", "-p", "tsconfig.build.json", "--watch", "--preserveWatchOutput"],
  {
    cwd: process.cwd(),
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  },
);

compiler.stdout.setEncoding("utf8");
compiler.stderr.setEncoding("utf8");

compiler.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  stdoutBuffer += chunk;

  const lines = stdoutBuffer.split(/\r?\n/);
  stdoutBuffer = lines.pop() ?? "";

  for (const line of lines) {
    if (/Found 0 errors?\. Watching for file changes\./i.test(line)) {
      startServer();
    }
  }
});

compiler.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (server) server.kill(signal);
  compiler.kill(signal);

  setTimeout(() => process.exit(0), 50).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

compiler.on("exit", (code) => {
  if (!shuttingDown) {
    if (server) server.kill();
    process.exitCode = code ?? 1;
  }
});
