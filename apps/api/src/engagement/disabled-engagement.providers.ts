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

  async send(_request: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
    throw new ServiceUnavailableException("Email provider is not configured");
  }
}

export class DisabledCalendarProvider implements CalendarProvider {
  readonly providerKey = "disabled";
  readonly configured = false;

  async reserve(_request: CalendarReservationRequest): Promise<CalendarReservationResult> {
    throw new ServiceUnavailableException("Calendar provider is not configured");
  }

  async cancel(_providerReference: string, _idempotencyKey: string): Promise<void> {
    throw new ServiceUnavailableException("Calendar provider is not configured");
  }
}
