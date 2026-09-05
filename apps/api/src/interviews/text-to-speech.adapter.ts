export type TextToSpeechContentType = "audio/wav";

export interface TextToSpeechRequest {
  spokenText: string;
  requestId?: string;
}

export interface TextToSpeechResult {
  contractVersion: string;
  provider: string;
  requestId: string;
  audio: Uint8Array;
  contentType: TextToSpeechContentType;
  attempts: number;
}

export interface TextToSpeechReadiness {
  reachable: boolean;
  ready: boolean;
  reason?: string;
  contractVersion?: string;
}

export interface TextToSpeechAdapter {
  readonly providerKey: string;
  readonly enabled: boolean;
  readonly configured: boolean;
  readiness(): Promise<TextToSpeechReadiness>;
  synthesize(request: TextToSpeechRequest): Promise<TextToSpeechResult>;
}

export const TEXT_TO_SPEECH_ADAPTER = Symbol("TEXT_TO_SPEECH_ADAPTER");
