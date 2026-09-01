export interface EmailDeliveryRequest {
  organizationId: string;
  notificationId: string;
  recipient: string;
  subject: string;
  body: string;
  idempotencyKey: string;
}

export interface EmailDeliveryResult {
  provider: string;
  providerReference: string;
  acceptedAt: string;
}

export interface EmailProvider {
  readonly providerKey: string;
  readonly configured: boolean;
  send(request: EmailDeliveryRequest): Promise<EmailDeliveryResult>;
}

export interface CalendarReservationRequest {
  organizationId: string;
  schedulingRequestId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  title: string;
  attendeeEmails: string[];
  idempotencyKey: string;
}

export interface CalendarReservationResult {
  provider: string;
  providerReference: string;
  startsAt: string;
  endsAt: string;
}

export interface CalendarProvider {
  readonly providerKey: string;
  readonly configured: boolean;
  reserve(request: CalendarReservationRequest): Promise<CalendarReservationResult>;
  cancel(providerReference: string, idempotencyKey: string): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");
export const CALENDAR_PROVIDER = Symbol("CALENDAR_PROVIDER");
