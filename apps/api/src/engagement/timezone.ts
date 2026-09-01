import type { ValidationOptions } from "class-validator";
import { registerDecorator } from "class-validator";

export function isIanaTimezone(value: string): boolean {
  const timezone = value.trim();
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function IsIanaTimezone(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: "isIanaTimezone",
      target: object.constructor,
      propertyName,
      ...(validationOptions ? { options: validationOptions } : {}),
      validator: {
        validate(value: unknown) {
          return typeof value === "string" && isIanaTimezone(value);
        },
        defaultMessage() {
          return "timezone must be a valid IANA timezone";
        },
      },
    });
  };
}
