import { type LoggerService } from "@nestjs/common";

export class JsonLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    this.write("info", message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write("error", message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.write("warn", message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write("debug", message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write("trace", message, context);
  }

  private write(level: string, message: unknown, context?: string, trace?: string): void {
    const payload = JSON.stringify({
      level,
      time: new Date().toISOString(),
      context: context ?? null,
      message: typeof message === "string" ? message : message,
      ...(trace ? { trace } : {}),
    });
    if (level === "error") console.error(payload);
    else if (level === "warn") console.warn(payload);
    else console.log(payload);
  }
}
