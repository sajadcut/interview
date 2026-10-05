export type InterviewClockStage = "not_started" | "normal" | "ending_soon" | "final_minute" | "expired";

export interface InterviewClockInput {
  status: string;
  timeBudgetMinutes: number;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  now?: string | Date;
}

export interface InterviewClockSnapshot {
  mode: "server_wall_clock";
  durationSeconds: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  startedAt: string | null;
  serverNow: string;
  completedAt: string | null;
  running: boolean;
  stage: InterviewClockStage;
  disconnectPolicy: "clock_continues";
}

function validDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function computeInterviewClock(input: InterviewClockInput): InterviewClockSnapshot {
  const durationSeconds = Math.max(60, Math.trunc(Number(input.timeBudgetMinutes || 0) * 60));
  const now = validDate(input.now) ?? new Date();
  const startedAt = validDate(input.startedAt);
  const completedAt = validDate(input.completedAt);
  const reference = completedAt ?? now;
  const elapsedSeconds = startedAt
    ? Math.max(0, Math.min(durationSeconds, Math.floor((reference.getTime() - startedAt.getTime()) / 1000)))
    : 0;
  const remainingSeconds = Math.max(0, durationSeconds - elapsedSeconds);
  const stage: InterviewClockStage = !startedAt
    ? "not_started"
    : remainingSeconds <= 0
      ? "expired"
      : remainingSeconds <= 60
        ? "final_minute"
        : remainingSeconds <= 300
          ? "ending_soon"
          : "normal";

  return {
    mode: "server_wall_clock",
    durationSeconds,
    elapsedSeconds,
    remainingSeconds,
    startedAt: startedAt?.toISOString() ?? null,
    serverNow: now.toISOString(),
    completedAt: completedAt?.toISOString() ?? null,
    running: input.status === "in_progress" && remainingSeconds > 0,
    stage,
    disconnectPolicy: "clock_continues",
  };
}
