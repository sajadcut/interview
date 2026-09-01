import { ServiceUnavailableException } from "@nestjs/common";
import type {
  CalendarProvider,
  CalendarReservationRequest,
  CalendarReservationResult,
  EmailDeliveryRequest,
  EmailDeliveryResult,
  EmailProvider,
} from "./engagement-provider.contracts";

export class DisabledEmailProvider implements EmailProvider {
  readonly providerKey = "disabled";
  readonly configured = false;

  async send(request: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
    void request;
    throw new ServiceUnavailableException("Email provider is not configured");
  }
}

export class DisabledCalendarProvider implements CalendarProvider {
  readonly providerKey = "disabled";
  readonly configured = false;

  async reserve(request: CalendarReservationRequest): Promise<CalendarReservationResult> {
    void request;
    throw new ServiceUnavailableException("Calendar provider is not configured");
  }

  async cancel(providerReference: string, idempotencyKey: string): Promise<void> {
    void providerReference;
    void idempotencyKey;
    throw new ServiceUnavailableException("Calendar provider is not configured");
  }
}
