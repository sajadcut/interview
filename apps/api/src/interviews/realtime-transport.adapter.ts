export interface RealtimeTransportParticipant {
  participantKey: string;
  participantType: "candidate" | "agent" | "supervisor" | "worker";
}

export interface RealtimeTransportRoomRequest {
  organizationId: string;
  interviewSessionId: string;
  mediaSessionId: string;
  roomReference: string;
}

export interface RealtimeTransportCredential {
  provider: string;
  serverUrl: string;
  roomReference: string;
  participantKey: string;
  accessToken: string;
  expiresAt: string;
}

export interface RealtimeTransportAdapter {
  readonly providerKey: string;
  readonly configured: boolean;
  readiness(): Promise<{ reachable: boolean; ready: boolean; reason?: string }>;
  issueCredential(
    room: RealtimeTransportRoomRequest,
    participant: RealtimeTransportParticipant,
  ): Promise<RealtimeTransportCredential>;
}

export const REALTIME_TRANSPORT_ADAPTER = Symbol("REALTIME_TRANSPORT_ADAPTER");
