import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { DatabaseService } from "../database/database.service";

@ApiTags("system")
@Controller("health")
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

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
        SELECT count(*)::int AS count, max(filename) AS latest
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
}
