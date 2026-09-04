export type SpeechToTextContentType = "audio/wav" | "audio/x-wav";

export interface SpeechToTextRequest {
  audio: Uint8Array;
  contentType: SpeechToTextContentType;
  requestId?: string;
}

export interface SpeechToTextResult {
  contractVersion: string;
  provider: string;
  requestId: string;
  text: string;
  isFinal: true;
  language: string;
  attempts: number;
}

export interface SpeechToTextReadiness {
  reachable: boolean;
  ready: boolean;
  reason?: string;
  contractVersion?: string;
}

export interface SpeechToTextAdapter {
  readonly providerKey: string;
  readonly enabled: boolean;
  readonly configured: boolean;
  readiness(): Promise<SpeechToTextReadiness>;
  transcribe(request: SpeechToTextRequest): Promise<SpeechToTextResult>;
}

export const SPEECH_TO_TEXT_ADAPTER = Symbol("SPEECH_TO_TEXT_ADAPTER");
