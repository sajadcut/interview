export const REDACTED_VALUE = "[REDACTED]";

const MAX_STRING_LENGTH = 16_384;
const MAX_DEPTH = 10;

function canonicalKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveKey(key: string): boolean {
  const canonical = canonicalKey(key);
  if (!canonical) return false;
  return (
    canonical === "authorization" ||
    canonical === "cookie" ||
    canonical === "credential" ||
    canonical === "credentials" ||
    canonical === "password" ||
    canonical === "passphrase" ||
    canonical === "otp" ||
    canonical === "apikey" ||
    canonical === "privatekey" ||
    canonical === "secretaccesskey" ||
    canonical.endsWith("password") ||
    canonical.endsWith("passphrase") ||
    canonical.endsWith("secret") ||
    canonical.endsWith("token") ||
    canonical.endsWith("tokenhash") ||
    canonical.endsWith("otphash") ||
    canonical.endsWith("apikey") ||
    canonical.endsWith("privatekey") ||
    canonical.endsWith("accesskey") ||
    canonical.startsWith("authorization") ||
    canonical.startsWith("cookie") ||
    canonical.startsWith("credential")
  );
}

function truncate(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]`;
}

export function redactSensitiveString(input: string): string {
  let value = input;
  value = value.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [REDACTED]");
  value = value.replace(
    /([?&](?:access_token|refresh_token|token|password|passphrase|secret|api_key|apikey|otp)=)([^&#\s]+)/gi,
    "$1[REDACTED]",
  );
  value = value.replace(
    /\b((?:__Host-|__Secure-)?interview_(?:session|refresh|candidate_session))=([^;\s]+)/gi,
    "$1=[REDACTED]",
  );
  value = value.replace(
    /\b(password|passphrase|secret|token|authorization|cookie|credential|api[_-]?key|client[_-]?secret|private[_-]?key|otp)\s*[:=]\s*([^\s,;]+)/gi,
    "$1=[REDACTED]",
  );
  return truncate(value);
}

export function redactSensitiveValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSensitiveString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") return String(value);
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";

  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveString(value.message),
      ...(value.stack ? { stack: redactSensitiveString(value.stack) } : {}),
    };
  }

  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValue(entry, seen, depth + 1));
  }

  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => {
        const name = String(key);
        return [
          name,
          isSensitiveKey(name)
            ? REDACTED_VALUE
            : redactSensitiveValue(entry, seen, depth + 1),
        ];
      }),
    );
  }

  if (value instanceof Set) {
    return [...value].map((entry) => redactSensitiveValue(entry, seen, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      isSensitiveKey(key)
        ? REDACTED_VALUE
        : redactSensitiveValue(entry, seen, depth + 1),
    ]),
  );
}
