export interface AssessmentExecutionRequest {
  submissionId: string;
  language: string;
  sourceText: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  networkAccess: false;
}

export interface AssessmentExecutionResult {
  status: "passed" | "failed" | "runtime_error" | "timeout" | "runner_error";
  passedTests: number;
  totalTests: number;
  rawScore: number;
  normalizedScore: number;
  runnerType: string;
  runnerVersion: string;
  details: Record<string, unknown>;
}

export interface AssessmentRunner {
  readonly runnerType: string;
  run(request: AssessmentExecutionRequest): Promise<AssessmentExecutionResult>;
}

export class DisabledCoreProcessAssessmentRunner implements AssessmentRunner {
  readonly runnerType = "disabled-core-process";

  async run(): Promise<AssessmentExecutionResult> {
    throw new Error(
      "Candidate code execution is disabled in the core API. Configure an isolated AssessmentRunner worker.",
    );
  }
}

export function normalizeAssessmentScore(passedTests: number, totalTests: number): number {
  if (!Number.isInteger(passedTests) || !Number.isInteger(totalTests)) {
    throw new Error("Assessment test counts must be integers");
  }
  if (totalTests <= 0 || passedTests < 0 || passedTests > totalTests) {
    throw new Error("Assessment test counts are invalid");
  }
  return Math.round((passedTests / totalTests) * 10000) / 100;
}
