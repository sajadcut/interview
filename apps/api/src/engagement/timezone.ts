import { BadRequestException } from "@nestjs/common";

export function requireIanaTimezone(value: string): string {
  const timezone = value.trim();
  if (!timezone) throw new BadRequestException("timezone is required");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new BadRequestException("timezone must be a valid IANA timezone");
  }
  return timezone;
}
