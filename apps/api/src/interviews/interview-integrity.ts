export const INTERVIEW_INTEGRITY_ANALYZER_VERSION = "integrity-rules-v1";

export const INTERVIEW_INTEGRITY_RULES = {
  shortBlurMs: 5_000,
  longHiddenMs: 30_000,
  veryLongHiddenMs: 90_000,
  repeatedLongHiddenCount: 5,
  pasteInformationalChars: 80,
  pasteConcernChars: 300,
  pasteElevatedChars: 800,
  repeatedLargePasteCount: 2,
  hiddenPasteCorrelationMs: 15_000,
  reconnectLowCount: 4,
  reconnectElevatedCount: 7,
} as const;

export type IntegrityEventType =
  | "visibility_hidden"
  | "visibility_visible"
  | "window_blur"
  | "window_focus"
  | "large_paste"
  | "reconnect"
  | "network_disconnect"
  | "network_reconnect"
  | "media_device_changed"
  | "microphone_disabled"
  | "microphone_enabled"
  | "camera_disabled"
  | "camera_enabled"
  | "concurrent_session_detected"
  | "unexpected_room_participant"
  | "candidate_session_replaced"
  | "answer_submission_spike"
  | "repeated_large_paste";

export type IntegritySeverity = "none" | "informational" | "low" | "medium" | "high";
export type IntegrityRiskLevel = "none" | "low" | "medium" | "high";
export type IntegrityConfidence = "low" | "medium" | "high";

export interface IntegrityEvent {
  id: string;
  sequence: number;
  eventType: IntegrityEventType;
  serverOccurredAt: string;
  clientOccurredAt?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
  source?: "candidate_browser" | "livekit_client" | "server" | "analyzer";
  severity?: IntegritySeverity;
  interpretation?: string;
}

export interface IntegritySignal {
  code: string;
  severity: Exclude<IntegritySeverity, "none" | "informational">;
  description: string;
  evidenceEventIds: string[];
  scoreContribution: number;
}

export interface IntegrityAssessment {
  integrityConcernScore: number;
  riskLevel: IntegrityRiskLevel;
  confidence: IntegrityConfidence;
  requiresHumanReview: boolean;
  signals: IntegritySignal[];
  summary: string;
  analyzerVersion: string;
}

function numericMetadata(metadata: Record<string, unknown> | undefined, key: string): number {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function eventTime(event: IntegrityEvent): number {
  const value = Date.parse(event.serverOccurredAt);
  return Number.isFinite(value) ? value : 0;
}

export function classifyIntegrityEvent(input: {
  eventType: IntegrityEventType;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
}): { severity: IntegritySeverity; interpretation: string } {
  const durationMs = Math.max(0, Number(input.durationMs ?? 0));
  const characterCount = Math.max(0, numericMetadata(input.metadata, "characterCount"));

  switch (input.eventType) {
    case "unexpected_room_participant":
    case "concurrent_session_detected":
      return {
        severity: "high",
        interpretation: "strong_observable_integrity_signal_requires_human_review",
      };
    case "candidate_session_replaced":
      return {
        severity: "medium",
        interpretation: "session_replacement_observed_requires_contextual_review",
      };
    case "repeated_large_paste":
    case "answer_submission_spike":
      return {
        severity: "medium",
        interpretation: "pattern_requires_contextual_review",
      };
    case "visibility_visible":
      if (durationMs >= INTERVIEW_INTEGRITY_RULES.veryLongHiddenMs) {
        return { severity: "medium", interpretation: "extended_page_absence_observed" };
      }
      if (durationMs >= INTERVIEW_INTEGRITY_RULES.longHiddenMs) {
        return { severity: "low", interpretation: "page_absence_observed" };
      }
      return { severity: "informational", interpretation: "page_visibility_change_observed" };
    case "large_paste":
      if (characterCount >= INTERVIEW_INTEGRITY_RULES.pasteElevatedChars) {
        return { severity: "medium", interpretation: "very_large_paste_observed_without_clipboard_content" };
      }
      if (characterCount >= INTERVIEW_INTEGRITY_RULES.pasteConcernChars) {
        return { severity: "low", interpretation: "large_paste_observed_without_clipboard_content" };
      }
      return { severity: "informational", interpretation: "paste_observed_without_clipboard_content" };
    case "window_focus":
      if (durationMs >= INTERVIEW_INTEGRITY_RULES.longHiddenMs) {
        return { severity: "low", interpretation: "extended_window_focus_loss_observed" };
      }
      return { severity: "informational", interpretation: "window_focus_change_observed" };
    case "reconnect":
    case "network_disconnect":
    case "network_reconnect":
      return { severity: "informational", interpretation: "connectivity_event_not_independently_suspicious" };
    case "microphone_disabled":
    case "microphone_enabled":
    case "camera_disabled":
    case "camera_enabled":
    case "media_device_changed":
      return { severity: "informational", interpretation: "device_state_change_not_independently_suspicious" };
    case "visibility_hidden":
    case "window_blur":
      return { severity: "informational", interpretation: "observable_browser_state_change" };
  }
}

function addSignal(
  signals: IntegritySignal[],
  signal: IntegritySignal,
): void {
  signals.push(signal);
}

export function analyzeInterviewIntegrity(events: IntegrityEvent[]): IntegrityAssessment {
  const ordered = [...events].sort((left, right) => {
    const timeDelta = eventTime(left) - eventTime(right);
    return timeDelta !== 0 ? timeDelta : left.sequence - right.sequence;
  });
  const signals: IntegritySignal[] = [];

  const longHidden = ordered.filter(
    (event) =>
      event.eventType === "visibility_visible" &&
      Number(event.durationMs ?? 0) >= INTERVIEW_INTEGRITY_RULES.longHiddenMs,
  );
  for (const event of longHidden) {
    const durationMs = Number(event.durationMs ?? 0);
    addSignal(signals, {
      code: durationMs >= INTERVIEW_INTEGRITY_RULES.veryLongHiddenMs
        ? "very_long_visibility_absence"
        : "long_visibility_absence",
      severity: durationMs >= INTERVIEW_INTEGRITY_RULES.veryLongHiddenMs ? "medium" : "low",
      description: durationMs >= INTERVIEW_INTEGRITY_RULES.veryLongHiddenMs
        ? "Candidate interview page was hidden for more than 90 seconds."
        : "Candidate interview page was hidden for more than 30 seconds.",
      evidenceEventIds: [event.id],
      scoreContribution: durationMs >= INTERVIEW_INTEGRITY_RULES.veryLongHiddenMs ? 20 : 10,
    });
  }
  if (longHidden.length > INTERVIEW_INTEGRITY_RULES.repeatedLongHiddenCount) {
    addSignal(signals, {
      code: "repeated_long_visibility_absence",
      severity: "medium",
      description: "More than five extended page-absence events were observed.",
      evidenceEventIds: longHidden.map((event) => event.id),
      scoreContribution: 15,
    });
  }

  const pasteEvents = ordered.filter((event) => event.eventType === "large_paste");
  const concerningPastes = pasteEvents.filter(
    (event) => numericMetadata(event.metadata, "characterCount") >= INTERVIEW_INTEGRITY_RULES.pasteConcernChars,
  );
  for (const event of concerningPastes) {
    const count = numericMetadata(event.metadata, "characterCount");
    addSignal(signals, {
      code: count >= INTERVIEW_INTEGRITY_RULES.pasteElevatedChars ? "very_large_paste" : "large_paste",
      severity: count >= INTERVIEW_INTEGRITY_RULES.pasteElevatedChars ? "medium" : "low",
      description: count >= INTERVIEW_INTEGRITY_RULES.pasteElevatedChars
        ? "A pasted answer fragment longer than 800 characters was observed."
        : "A pasted answer fragment longer than 300 characters was observed.",
      evidenceEventIds: [event.id],
      scoreContribution: count >= INTERVIEW_INTEGRITY_RULES.pasteElevatedChars ? 20 : 10,
    });
  }
  if (concerningPastes.length >= INTERVIEW_INTEGRITY_RULES.repeatedLargePasteCount) {
    addSignal(signals, {
      code: "repeated_large_paste",
      severity: "medium",
      description: "Multiple large paste events were observed during the interview.",
      evidenceEventIds: concerningPastes.map((event) => event.id),
      scoreContribution: 15,
    });
  }

  const unexpectedParticipants = ordered.filter((event) => event.eventType === "unexpected_room_participant");
  for (const event of unexpectedParticipants) {
    addSignal(signals, {
      code: "unexpected_room_participant",
      severity: "high",
      description: "An unexpected additional realtime-room participant was observed.",
      evidenceEventIds: [event.id],
      scoreContribution: 35,
    });
  }

  const concurrentSessions = ordered.filter((event) => event.eventType === "concurrent_session_detected");
  for (const event of concurrentSessions) {
    addSignal(signals, {
      code: "concurrent_candidate_session",
      severity: "high",
      description: "A second candidate browser session was observed while another session was active.",
      evidenceEventIds: [event.id],
      scoreContribution: 30,
    });
  }

  const replacements = ordered.filter((event) => event.eventType === "candidate_session_replaced");
  if (replacements.length > 0) {
    addSignal(signals, {
      code: "candidate_session_replaced",
      severity: "medium",
      description: "An active candidate browser session was replaced by another browser session.",
      evidenceEventIds: replacements.map((event) => event.id),
      scoreContribution: 15,
    });
  }

  const answerSpikes = ordered.filter((event) => event.eventType === "answer_submission_spike");
  if (answerSpikes.length > 0) {
    addSignal(signals, {
      code: "answer_submission_spike",
      severity: "medium",
      description: "A large answer was submitted immediately after a paste event.",
      evidenceEventIds: answerSpikes.map((event) => event.id),
      scoreContribution: 10,
    });
  }

  const reconnects = ordered.filter(
    (event) => event.eventType === "reconnect" || event.eventType === "network_reconnect",
  );
  if (reconnects.length >= INTERVIEW_INTEGRITY_RULES.reconnectElevatedCount) {
    addSignal(signals, {
      code: "many_reconnects",
      severity: "low",
      description: "A high number of reconnects was observed. Connectivity failures remain a non-conclusive signal.",
      evidenceEventIds: reconnects.map((event) => event.id),
      scoreContribution: 10,
    });
  } else if (reconnects.length >= INTERVIEW_INTEGRITY_RULES.reconnectLowCount) {
    addSignal(signals, {
      code: "repeated_reconnects",
      severity: "low",
      description: "Several reconnects were observed. Reconnects alone are not considered evidence of misconduct.",
      evidenceEventIds: reconnects.map((event) => event.id),
      scoreContribution: 5,
    });
  }

  for (const paste of concerningPastes) {
    const pasteTime = eventTime(paste);
    const priorReturn = [...ordered]
      .reverse()
      .find(
        (event) =>
          event.eventType === "visibility_visible" &&
          eventTime(event) <= pasteTime &&
          pasteTime - eventTime(event) <= INTERVIEW_INTEGRITY_RULES.hiddenPasteCorrelationMs &&
          Number(event.durationMs ?? 0) >= INTERVIEW_INTEGRITY_RULES.longHiddenMs,
      );
    if (priorReturn) {
      addSignal(signals, {
        code: "hidden_then_large_paste",
        severity: "medium",
        description: "Candidate returned after an extended page absence and shortly afterward pasted a large answer fragment.",
        evidenceEventIds: [priorReturn.id, paste.id],
        scoreContribution: 15,
      });
      break;
    }
  }

  const rawScore = signals.reduce((sum, signal) => sum + signal.scoreContribution, 0);
  const integrityConcernScore = Math.max(0, Math.min(100, rawScore));
  const riskLevel: IntegrityRiskLevel =
    integrityConcernScore >= 70
      ? "high"
      : integrityConcernScore >= 40
        ? "medium"
        : integrityConcernScore >= 20
          ? "low"
          : "none";
  const materialSignals = signals.filter((signal) => signal.scoreContribution > 0);
  const confidence: IntegrityConfidence =
    materialSignals.length >= 4 || materialSignals.some((signal) => signal.severity === "high")
      ? "high"
      : materialSignals.length >= 2
        ? "medium"
        : "low";
  const requiresHumanReview =
    riskLevel === "medium" ||
    riskLevel === "high" ||
    materialSignals.some((signal) => signal.severity === "high");

  const summary =
    riskLevel === "none"
      ? "نشانه قابل توجهی در رویدادهای قابل مشاهده مصاحبه ثبت نشد."
      : riskLevel === "low"
        ? "چند نشانه محدود ثبت شد که به‌تنهایی اثبات‌کننده تخلف نیستند."
        : riskLevel === "medium"
          ? "ترکیبی از سیگنال‌های قابل مشاهده نیازمند بررسی انسانی است."
          : "چند سیگنال قابل توجه ثبت شده است و بررسی انسانی توصیه می‌شود.";

  return {
    integrityConcernScore,
    riskLevel,
    confidence,
    requiresHumanReview,
    signals,
    summary,
    analyzerVersion: INTERVIEW_INTEGRITY_ANALYZER_VERSION,
  };
}
