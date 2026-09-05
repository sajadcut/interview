export type VoiceActivityContentType = "audio/wav" | "audio/x-wav";

export interface VoiceActivityRequest {
  audio: Uint8Array;
  contentType: VoiceActivityContentType;
  requestId?: string;
}

export interface VoiceActivitySegment {
  startSeconds: number;
  endSeconds: number;
}

export interface VoiceActivityResult {
  contractVersion: string;
  provider: string;
  requestId: string;
  speechDetected: boolean;
  segments: VoiceActivitySegment[];
  sampleRate: 16000;
  durationSeconds: number;
  attempts: number;
}

export interface VoiceActivityReadiness {
  reachable: boolean;
  ready: boolean;
  reason?: string;
  contractVersion?: string;
}

export interface VoiceActivityDetectionAdapter {
  readonly providerKey: string;
  readonly enabled: boolean;
  readonly configured: boolean;
  readiness(): Promise<VoiceActivityReadiness>;
  analyze(request: VoiceActivityRequest): Promise<VoiceActivityResult>;
}

export const VOICE_ACTIVITY_DETECTION_ADAPTER = Symbol("VOICE_ACTIVITY_DETECTION_ADAPTER");
