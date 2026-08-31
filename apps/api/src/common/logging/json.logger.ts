import { type LoggerService } from "@nestjs/common";

export class JsonLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write("info", message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write("error", message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write("warn", message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write("debug", message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write("trace", message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write("fatal", message, optionalParams);
  }

  private write(level: string, message: unknown, optionalParams: unknown[]): void {
    const payload = JSON.stringify({
      level,
      time: new Date().toISOString(),
      message,
      ...(optionalParams.length ? { params: optionalParams } : {}),
    });
    if (level === "error" || level === "fatal") console.error(payload);
    else if (level === "warn") console.warn(payload);
    else console.log(payload);
  }
}
