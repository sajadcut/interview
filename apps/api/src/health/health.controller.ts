import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import {
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { DatabaseService } from "../database/database.service";
import { LiveKitTransportAdapter } from "../interviews/livekit-transport.adapter";
import { WhisperHttpClient } from "../interviews/whisper-http.client";

@ApiTags("system")
@Controller("health")
export class HealthController {
  constructor(
    private readonly database: DatabaseService,
    private readonly liveKitTransport: LiveKitTransportAdapter,
    private readonly whisper: WhisperHttpClient,
  ) {}

  @Get()
  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["status", "service", "timestamp"],
      properties: {
        status: { type: "string", enum: ["ok"] },
        service: { type: "string", example: "interview-api" },
        timestamp: { type: "string", format: "date-time", example: "2026-08-31T00:00:00.000Z" },
      },
    },
  })
  health(): { status: "ok"; service: string; timestamp: string } {
    return {
      status: "ok",
      service: "interview-api",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["status", "database", "migrationCount", "timestamp"],
      properties: {
        status: { type: "string", enum: ["ready"] },
        database: { type: "string", enum: ["ready"] },
        migrationCount: { type: "integer", minimum: 0 },
        latestMigration: { type: "string", nullable: true },
        timestamp: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiServiceUnavailableResponse({ description: "Database is unavailable or migration ledger cannot be read." })
  async readiness() {
    try {
      const ping = await this.database.sql`SELECT 1 AS ok`;
      if (Number(ping[0]?.ok ?? 0) !== 1) throw new Error("database ping failed");
      const migrations = await this.database.sql`
        SELECT count(*)::int AS count, max(name) AS latest
        FROM _interview_schema_migrations
      `;
      return {
        status: "ready" as const,
        database: "ready" as const,
        migrationCount: Number(migrations[0]?.count ?? 0),
        latestMigration: migrations[0]?.latest ? String(migrations[0].latest) : null,
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException("Database readiness check failed");
    }
  }

  @Get("livekit")
  @ApiExcludeEndpoint()
  async liveKitReadiness() {
    const deployment = this.liveKitTransport.deploymentStatus();
    if (!deployment.enabled) {
      return {
        status: "disabled" as const,
        ...deployment,
        reachable: false,
        ready: false,
        reason: "transport_disabled",
        timestamp: new Date().toISOString(),
      };
    }

    const readiness = await this.liveKitTransport.readiness();
    if (!readiness.ready) {
      throw new ServiceUnavailableException({
        status: "unavailable",
        ...deployment,
        reachable: readiness.reachable,
        ready: false,
        reason: readiness.reason ?? "unavailable",
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: "ready" as const,
      ...deployment,
      reachable: true,
      ready: true,
      timestamp: new Date().toISOString(),
    };
  }

  @Get("whisper")
  @ApiExcludeEndpoint()
  async whisperReadiness() {
    const deployment = this.whisper.deploymentStatus();
    if (!deployment.enabled) {
      return {
        status: "disabled" as const,
        ...deployment,
        reachable: false,
        ready: false,
        reason: "stt_disabled",
        timestamp: new Date().toISOString(),
      };
    }

    const readiness = await this.whisper.readiness();
    if (!readiness.ready) {
      throw new ServiceUnavailableException({
        status: "unavailable",
        ...deployment,
        reachable: readiness.reachable,
        ready: false,
        reason: readiness.reason ?? "unavailable",
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: "ready" as const,
      ...deployment,
      reachable: true,
      ready: true,
      contractVersion: readiness.contractVersion,
      timestamp: new Date().toISOString(),
    };
  }
}
