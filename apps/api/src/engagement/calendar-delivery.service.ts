import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { CalendarProviderError } from "./calendar.providers";
import { CALENDAR_PROVIDER, type CalendarProvider } from "./engagement-provider.contracts";

interface SchedulingRow extends Record<string, unknown> {
  id: string;
  application_id: string;
  status: string;
  interview_type: string;
  timezone: string;
  selected_start: Date | string | null;
  selected_end: Date | string | null;
  calendar_provider: string | null;
  calendar_reference: string | null;
  reminder_policy: unknown;
  proposed_slots: unknown;
  candidate_email?: string | null;
  candidate_name?: string | null;
  job_title?: string | null;
  created_at: Date | string;
}

interface CalendarFailure {
  ok: false;
  message: string;
  code: string;
  retryable: boolean;
}

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== "string") throw new BadRequestException(`${field} must be an ISO date`);
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new BadRequestException(`${field} must be an ISO date`);
  return date;
}

function errorDetails(error: unknown): { message: string; code: string; retryable: boolean } {
  if (error instanceof CalendarProviderError) {
    return { message: error.message.slice(0, 1_000), code: error.code, retryable: error.retryable };
  }
  return {
    message: error instanceof Error ? error.message.slice(0, 1_000) : "Unknown calendar provider failure",
    code: "CALENDAR_PROVIDER_FAILURE",
    retryable: true,
  };
}

function mapSchedulingRow(row: SchedulingRow) {
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    interviewType: String(row.interview_type),
    status: String(row.status),
    timezone: String(row.timezone),
    proposedSlots: Array.isArray(row.proposed_slots) ? row.proposed_slots : [],
    ...(row.selected_start ? { selectedStart: new Date(String(row.selected_start)).toISOString() } : {}),
    ...(row.selected_end ? { selectedEnd: new Date(String(row.selected_end)).toISOString() } : {}),
    ...(row.calendar_provider ? { calendarProvider: String(row.calendar_provider) } : {}),
    ...(row.calendar_reference ? { calendarReference: String(row.calendar_reference) } : {}),
    reminderPolicy:
      row.reminder_policy && typeof row.reminder_policy === "object"
        ? (row.reminder_policy as Record<string, unknown>)
        : {},
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

@Injectable()
export class CalendarDeliveryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    @Inject(CALENDAR_PROVIDER) private readonly provider: CalendarProvider,
  ) {}

  readiness() {
    return { provider: this.provider.providerKey, configured: this.provider.configured };
  }

  async confirmSchedulingRequest(requestId: string, body: unknown) {
    if (!body || typeof body !== "object") throw new BadRequestException("Scheduling confirmation is required");
    const value = body as Record<string, unknown>;
    const selectedStart = parseDate(value.selectedStart, "selectedStart");
    const selectedEnd = parseDate(value.selectedEnd, "selectedEnd");
    if (selectedEnd <= selectedStart) throw new BadRequestException("selectedEnd must be after selectedStart");

    const organizationId = this.tenantContext.require().organizationId;
    const startIso = selectedStart.toISOString();
    const endIso = selectedEnd.toISOString();
    const idempotencyKey = `calendar:reserve:${organizationId}:${requestId}:${startIso}:${endIso}`;
    const idempotencyHash = await this.hashKey(idempotencyKey);

    const outcome = await this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT
          sr.id::text,
          sr.application_id::text,
          sr.status,
          sr.interview_type,
          sr.timezone,
          sr.proposed_slots,
          sr.selected_start,
          sr.selected_end,
          sr.calendar_provider,
          sr.calendar_reference,
          sr.reminder_policy,
          sr.created_at,
          c.primary_email AS candidate_email,
          c.display_name AS candidate_name,
          j.title AS job_title
        FROM scheduling_requests sr
        JOIN applications a
          ON a.organization_id = sr.organization_id AND a.id = sr.application_id
        JOIN candidates c
          ON c.organization_id = a.organization_id AND c.id = a.candidate_id
        JOIN jobs j
          ON j.organization_id = a.organization_id AND j.id = a.job_id
        WHERE sr.organization_id = ${organizationId}::uuid AND sr.id = ${requestId}::uuid
        LIMIT 1
        FOR UPDATE OF sr
      `;
      const row = rows[0] as SchedulingRow | undefined;
      if (!row) throw new NotFoundException("Scheduling request not found");
      if (row.status === "cancelled") throw new BadRequestException("Cancelled scheduling request cannot be confirmed");

      if (row.status === "confirmed" && row.selected_start && row.selected_end) {
        const existingStart = new Date(String(row.selected_start)).toISOString();
        const existingEnd = new Date(String(row.selected_end)).toISOString();
        if (existingStart !== startIso || existingEnd !== endIso) {
          throw new BadRequestException("Confirmed scheduling request must be cancelled before choosing a different slot");
        }
        return { ok: true as const, row: mapSchedulingRow(row), delivery: row.calendar_reference ? "existing" : "local" };
      }

      if (!this.provider.configured) {
        const updated = await tx`
          UPDATE scheduling_requests
          SET status = 'confirmed',
              selected_start = ${selectedStart},
              selected_end = ${selectedEnd},
              calendar_provider = NULL,
              calendar_reference = NULL,
              updated_at = now()
          WHERE organization_id = ${organizationId}::uuid AND id = ${requestId}::uuid
          RETURNING id::text, application_id::text, status, interview_type, timezone, proposed_slots,
                    selected_start, selected_end, calendar_provider, calendar_reference, reminder_policy, created_at
        `;
        return { ok: true as const, row: mapSchedulingRow(updated[0] as SchedulingRow), delivery: "local" };
      }

      const email = typeof row.candidate_email === "string" ? row.candidate_email.trim() : "";
      if (!email) throw new BadRequestException("Candidate must have a primary email before creating a calendar invitation");
      const title = `${String(row.interview_type)}: ${String(row.job_title)} — ${String(row.candidate_name)}`.slice(0, 240);

      try {
        const reserved = await this.provider.reserve({
          organizationId,
          schedulingRequestId: requestId,
          startsAt: startIso,
          endsAt: endIso,
          timezone: String(row.timezone),
          title,
          attendeeEmails: [email],
          idempotencyKey,
        });
        await tx`
          INSERT INTO calendar_operation_attempts (
            organization_id, scheduling_request_id, provider, operation, state,
            provider_reference, idempotency_key_hash, retryable
          ) VALUES (
            ${organizationId}::uuid,
            ${requestId}::uuid,
            ${reserved.provider},
            'reserve',
            'succeeded',
            ${reserved.providerReference},
            ${idempotencyHash},
            false
          )
        `;
        const updated = await tx`
          UPDATE scheduling_requests
          SET status = 'confirmed',
              selected_start = ${selectedStart},
              selected_end = ${selectedEnd},
              calendar_provider = ${reserved.provider},
              calendar_reference = ${reserved.providerReference},
              updated_at = now()
          WHERE organization_id = ${organizationId}::uuid AND id = ${requestId}::uuid
          RETURNING id::text, application_id::text, status, interview_type, timezone, proposed_slots,
                    selected_start, selected_end, calendar_provider, calendar_reference, reminder_policy, created_at
        `;
        return { ok: true as const, row: mapSchedulingRow(updated[0] as SchedulingRow), delivery: "reserved" };
      } catch (error) {
        const details = errorDetails(error);
        await tx`
          INSERT INTO calendar_operation_attempts (
            organization_id, scheduling_request_id, provider, operation, state,
            error_code, error_message, idempotency_key_hash, retryable
          ) VALUES (
            ${organizationId}::uuid,
            ${requestId}::uuid,
            ${this.provider.providerKey},
            'reserve',
            'failed',
            ${details.code},
            ${details.message},
            ${idempotencyHash},
            ${details.retryable}
          )
        `;
        return { ok: false as const, ...details } satisfies CalendarFailure;
      }
    });

    if (!outcome.ok) {
      throw outcome.retryable
        ? new ServiceUnavailableException(`${outcome.code}: ${outcome.message}`)
        : new BadRequestException(`${outcome.code}: ${outcome.message}`);
    }
    return { ...outcome.row, calendarDelivery: outcome.delivery };
  }

  async cancelScheduling(requestId: string, reason: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new BadRequestException("Cancellation reason is required");
    const idempotencyKey = `calendar:cancel:${organizationId}:${requestId}`;
    const idempotencyHash = await this.hashKey(idempotencyKey);

    const outcome = await this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT id::text, application_id::text, status, calendar_provider, calendar_reference,
               cancellation_reason, cancelled_at
        FROM scheduling_requests
        WHERE organization_id = ${organizationId}::uuid AND id = ${requestId}::uuid
        LIMIT 1
        FOR UPDATE
      `;
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new NotFoundException("Scheduling request not found");
      if (row.status === "cancelled") return { ok: true as const, row };

      const storedProvider = row.calendar_provider ? String(row.calendar_provider) : null;
      const reference = row.calendar_reference ? String(row.calendar_reference) : null;
      if (reference) {
        if (!this.provider.configured) {
          return {
            ok: false as const,
            message: "Calendar provider must be configured before cancelling an existing remote event",
            code: "CALENDAR_PROVIDER_DISABLED",
            retryable: false,
          } satisfies CalendarFailure;
        }
        if (storedProvider && storedProvider !== this.provider.providerKey) {
          return {
            ok: false as const,
            message: `Stored event belongs to ${storedProvider}, but ${this.provider.providerKey} is configured`,
            code: "CALENDAR_PROVIDER_MISMATCH",
            retryable: false,
          } satisfies CalendarFailure;
        }
        try {
          await this.provider.cancel(reference, idempotencyKey);
          await tx`
            INSERT INTO calendar_operation_attempts (
              organization_id, scheduling_request_id, provider, operation, state,
              provider_reference, idempotency_key_hash, retryable
            ) VALUES (
              ${organizationId}::uuid,
              ${requestId}::uuid,
              ${this.provider.providerKey},
              'cancel',
              'succeeded',
              ${reference},
              ${idempotencyHash},
              false
            )
          `;
        } catch (error) {
          const details = errorDetails(error);
          await tx`
            INSERT INTO calendar_operation_attempts (
              organization_id, scheduling_request_id, provider, operation, state,
              provider_reference, error_code, error_message, idempotency_key_hash, retryable
            ) VALUES (
              ${organizationId}::uuid,
              ${requestId}::uuid,
              ${this.provider.providerKey},
              'cancel',
              'failed',
              ${reference},
              ${details.code},
              ${details.message},
              ${idempotencyHash},
              ${details.retryable}
            )
          `;
          return { ok: false as const, ...details } satisfies CalendarFailure;
        }
      }

      const updated = await tx`
        UPDATE scheduling_requests
        SET status = 'cancelled',
            cancelled_at = now(),
            cancellation_reason = ${normalizedReason},
            updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${requestId}::uuid
        RETURNING id::text, application_id::text, status, calendar_provider, calendar_reference,
                  cancellation_reason, cancelled_at
      `;
      return { ok: true as const, row: updated[0] };
    });

    if (!outcome.ok) {
      throw outcome.retryable
        ? new ServiceUnavailableException(`${outcome.code}: ${outcome.message}`)
        : new BadRequestException(`${outcome.code}: ${outcome.message}`);
    }
    return outcome.row;
  }

  private async hashKey(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Buffer.from(digest).toString("hex");
  }
}
