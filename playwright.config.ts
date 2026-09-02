import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const apiURL = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
const databaseURL =
  process.env.DATABASE_URL ?? "postgresql://interview:interview@127.0.0.1:5432/interview";
const fakeMediaArgs = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI
    ? [
        ["line"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL,
    locale: "en-US",
    timezoneId: "Asia/Tehran",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium-critical",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["camera", "microphone"],
        launchOptions: { args: fakeMediaArgs },
      },
    },
    {
      name: "chromium-mobile-candidate",
      testMatch: /candidate-critical\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        permissions: ["camera", "microphone"],
        launchOptions: { args: fakeMediaArgs },
      },
    },
  ],
  webServer: [
    {
      command: "npm run start --workspace=@interview/api",
      url: `${apiURL}/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: databaseURL,
        CORS_ORIGIN: baseURL,
        API_HOST: "127.0.0.1",
        API_PORT: "4000",
        STORAGE_PROVIDER: process.env.STORAGE_PROVIDER ?? "local",
        LOCAL_STORAGE_ROOT: process.env.LOCAL_STORAGE_ROOT ?? ".local-data/e2e-storage",
      },
    },
    {
      command: "npm run start --workspace=@interview/web -- -H 127.0.0.1 -p 3000",
      url: `${baseURL}/login`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        NODE_ENV: "test",
        API_INTERNAL_URL: apiURL,
        NEXT_PUBLIC_API_URL: apiURL,
        NEXT_PUBLIC_DEFAULT_LOCALE: "en",
      },
    },
  ],
});
