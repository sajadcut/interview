import { Injectable } from "@nestjs/common";
import { getEnv } from "../config/env";
import { CalendarProviderError } from "./calendar.providers";
import { GoogleCalendarProvider, MicrosoftCalendarProvider } from "./calendar.providers";
import { DisabledCalendarProvider } from "./disabled-engagement.providers";
import type {
  CalendarProvider,
  CalendarReservationRequest,
  CalendarReservationResult,
} from "./engagement-provider.contracts";

@Injectable()
export class ConfiguredCalendarProvider implements CalendarProvider {
  private readonly selected: CalendarProvider;

  constructor(
    disabled: DisabledCalendarProvider,
    google: GoogleCalendarProvider,
    microsoft: MicrosoftCalendarProvider,
  ) {
    const provider = getEnv().CALENDAR_PROVIDER;
    this.selected = provider === "google" ? google : provider === "microsoft" ? microsoft : disabled;
    if (provider !== "disabled" && !this.selected.configured) {
      throw new CalendarProviderError(`Calendar provider ${provider} is not fully configured`, "CALENDAR_NOT_CONFIGURED", false);
    }
  }

  get providerKey(): string {
    return this.selected.providerKey;
  }

  get configured(): boolean {
    return this.selected.configured;
  }

  reserve(request: CalendarReservationRequest): Promise<CalendarReservationResult> {
    return this.selected.reserve(request);
  }

  cancel(providerReference: string, idempotencyKey: string): Promise<void> {
    return this.selected.cancel(providerReference, idempotencyKey);
  }
}
