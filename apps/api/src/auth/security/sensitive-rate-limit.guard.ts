import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { TenantContextService } from "../../tenant/tenant-context.service";
import { readCookie } from "../cookie";
import { SESSION_POLICY } from "../session-policy";
import {
  AUTH_RATE_LIMIT_POLICIES,
  AuthRateLimitService,
} from "./auth-rate-limit.service";
import {
  SENSITIVE_RATE_LIMIT_METADATA,
  type SensitiveRateLimitRule,
} from "./sensitive-rate-limit.decorator";

function requestBody(request: Request): Record<string, unknown> {
  const value: unknown = request.body;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function rateLimitClientIp(request: Request): string {
  const expressIp = request.ip?.trim();
  if (expressIp) return expressIp;
  const socketIp = request.socket.remoteAddress?.trim();
  return socketIp || "unknown";
}

@Injectable()
export class SensitiveRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimits: AuthRateLimitService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.getAllAndOverride<readonly SensitiveRateLimitRule[]>(
      SENSITIVE_RATE_LIMIT_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!rules?.length) return true;

    const request = context.switchToHttp().getRequest<Request>();
    for (const rule of rules) {
      const rawKey = this.resolveKey(rule, request);
      await this.rateLimits.consume(
        rule.scope,
        rawKey,
        AUTH_RATE_LIMIT_POLICIES[rule.policy],
      );
    }
    return true;
  }

  private resolveKey(rule: SensitiveRateLimitRule, request: Request): string {
    const ip = rateLimitClientIp(request);
    if (rule.source === "ip") return `ip:${ip}`;

    if (rule.source === "body-token") {
      const token = requestBody(request).token;
      return typeof token === "string" && token.trim()
        ? `token:${token.trim()}`
        : `missing-token:ip:${ip}`;
    }

    if (rule.source === "refresh-token") {
      const token = readCookie(
        request.header("cookie"),
        SESSION_POLICY.REFRESH_COOKIE_NAME,
      );
      return token?.trim() ? `refresh:${token.trim()}` : `missing-refresh:ip:${ip}`;
    }

    const tenant = this.tenantContext.getOptional()?.organizationId;
    if (!tenant) {
      // The invitation route also carries RequireTenant; fail closed if middleware/guard
      // ordering is ever changed and tenant context is unexpectedly unavailable.
      return `missing-tenant:ip:${ip}`;
    }

    if (rule.source === "tenant-ip") return `org:${tenant}:ip:${ip}`;

    const applicationId = requestBody(request).applicationId;
    return typeof applicationId === "string" && applicationId.trim()
      ? `org:${tenant}:application:${applicationId.trim()}`
      : `org:${tenant}:missing-application:ip:${ip}`;
  }
}
