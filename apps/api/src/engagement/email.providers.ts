import { createHash, createHmac, randomUUID } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { Injectable } from "@nestjs/common";
import { getEnv, type AppEnv } from "../config/env";
import {
  type DeliveryResult,
  type EmailProvider,
  type OutboundEmailMessage,
} from "./engagement-provider.contracts";

const EMAIL_ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export class EmailDeliveryError extends Error {
  constructor(
    readonly provider: string,
    readonly code: string,
    readonly retryable: boolean,
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

export type CommonEmailProviderConfig = {
  fromAddress: string;
  fromName: string;
  replyTo: string | null;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
};

export type SmtpEmailProviderConfig = CommonEmailProviderConfig & {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  username: string | null;
  password: string | null;
  tlsServername: string | null;
};

export type SesEmailProviderConfig = CommonEmailProviderConfig & {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | null;
  endpoint: string | null;
};

export type SendGridEmailProviderConfig = CommonEmailProviderConfig & {
  apiKey: string;
  baseUrl: string;
};

type SmtpReply = { code: number; lines: string[]; text: string };

type ReplyWaiter = {
  resolve: (reply: SmtpReply) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function assertEmailAddress(address: string, field: string): string {
  const value = address.trim();
  if (!EMAIL_ADDRESS.test(value)) {
    throw new EmailDeliveryError("email", "INVALID_ADDRESS", false, `${field} is not a valid email address`);
  }
  return value;
}

function safeHeader(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    throw new EmailDeliveryError("email", "INVALID_HEADER", false, `${field} contains an invalid header value`);
  }
  return trimmed;
}

function quoteDisplayName(value: string): string {
  const clean = safeHeader(value, "fromName").replace(/["\\]/g, (match) => `\\${match}`);
  return `"${clean}"`;
}

function mailbox(fromName: string, fromAddress: string): string {
  return fromName.trim() ? `${quoteDisplayName(fromName)} <${fromAddress}>` : fromAddress;
}

function idempotencyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function emailDomain(address: string): string {
  return address.split("@")[1] || "localhost";
}

function commonConfig(env: AppEnv): CommonEmailProviderConfig {
  return {
    fromAddress: env.EMAIL_FROM_ADDRESS,
    fromName: env.EMAIL_FROM_NAME,
    replyTo: env.EMAIL_REPLY_TO || null,
    timeoutMs: env.EMAIL_TIMEOUT_MS,
    maxAttempts: env.EMAIL_MAX_ATTEMPTS,
    retryBaseMs: env.EMAIL_RETRY_BASE_MS,
  };
}

export function smtpConfigFromEnv(env: AppEnv = getEnv()): SmtpEmailProviderConfig {
  return {
    ...commonConfig(env),
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTls: env.SMTP_REQUIRE_TLS,
    username: env.SMTP_USERNAME || null,
    password: env.SMTP_PASSWORD || null,
    tlsServername: env.SMTP_TLS_SERVERNAME || null,
  };
}

export function sesConfigFromEnv(env: AppEnv = getEnv()): SesEmailProviderConfig {
  return {
    ...commonConfig(env),
    region: env.SES_REGION,
    accessKeyId: env.SES_ACCESS_KEY_ID,
    secretAccessKey: env.SES_SECRET_ACCESS_KEY,
    sessionToken: env.SES_SESSION_TOKEN || null,
    endpoint: env.SES_ENDPOINT?.toString() || null,
  };
}

export function sendGridConfigFromEnv(env: AppEnv = getEnv()): SendGridEmailProviderConfig {
  return {
    ...commonConfig(env),
    apiKey: env.SENDGRID_API_KEY,
    baseUrl: env.SENDGRID_BASE_URL?.toString() || "https://api.sendgrid.com/v3",
  };
}

function backoffMs(baseMs: number, attempt: number): number {
  const raw = baseMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(raw, 10_000);
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function asDeliveryError(provider: string, error: unknown): EmailDeliveryError {
  if (error instanceof EmailDeliveryError) return error;
  const message = error instanceof Error ? error.message : "Unknown email provider error";
  const code = error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "PROVIDER_ERROR";
  return new EmailDeliveryError(provider, code, true, message);
}

async function withRetry<T>(
  provider: string,
  config: CommonEmailProviderConfig,
  operation: () => Promise<T>,
): Promise<{ value: T; attempts: number; latencyMs: number }> {
  const startedAt = Date.now();
  let lastError: EmailDeliveryError | null = null;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      return { value: await operation(), attempts: attempt, latencyMs: Date.now() - startedAt };
    } catch (error) {
      lastError = asDeliveryError(provider, error);
      if (!lastError.retryable || attempt >= config.maxAttempts) break;
      await delay(backoffMs(config.retryBaseMs, attempt));
    }
  }
  throw lastError ?? new EmailDeliveryError(provider, "PROVIDER_ERROR", true, "Email delivery failed");
}

class SmtpReplyReader {
  private buffer = "";
  private responseLines: string[] = [];
  private responseCode: number | null = null;
  private replies: SmtpReply[] = [];
  private waiters: ReplyWaiter[] = [];
  private terminalError: Error | null = null;
  private readonly onData = (chunk: Buffer | string) => this.consume(String(chunk));
  private readonly onError = (error: Error) => this.fail(error);
  private readonly onClose = () => this.fail(new Error("SMTP connection closed"));

  constructor(private readonly socket: net.Socket | tls.TLSSocket) {
    socket.setEncoding("utf8");
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
  }

  detach(): void {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("SMTP response reader detached"));
    }
  }

  next(timeoutMs: number): Promise<SmtpReply> {
    if (this.replies.length > 0) return Promise.resolve(this.replies.shift() as SmtpReply);
    if (this.terminalError) return Promise.reject(this.terminalError);
    return new Promise<SmtpReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((item) => item.resolve === resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new EmailDeliveryError("smtp", "SMTP_TIMEOUT", true, "SMTP response timed out"));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const raw = this.buffer.slice(0, newline + 1);
      this.buffer = this.buffer.slice(newline + 1);
      this.consumeLine(raw.replace(/\r?\n$/, ""));
      newline = this.buffer.indexOf("\n");
    }
  }

  private consumeLine(line: string): void {
    const match = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!match) return;
    const code = Number(match[1]);
    if (this.responseCode === null) this.responseCode = code;
    this.responseLines.push(line);
    if (match[2] !== " " || code !== this.responseCode) return;
    const reply: SmtpReply = {
      code,
      lines: [...this.responseLines],
      text: this.responseLines.map((item) => item.slice(4)).join("\n"),
    };
    this.responseLines = [];
    this.responseCode = null;
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(reply);
    } else {
      this.replies.push(reply);
    }
  }

  private fail(error: Error): void {
    if (this.terminalError) return;
    this.terminalError = error;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

function smtpError(reply: SmtpReply, stage: string): EmailDeliveryError {
  return new EmailDeliveryError(
    "smtp",
    `SMTP_${reply.code}`,
    reply.code >= 400 && reply.code < 500,
    `SMTP ${stage} failed with ${reply.code}: ${reply.text.slice(0, 300)}`,
    reply.code,
  );
}

function requireSmtp(reply: SmtpReply, stage: string, accepted: number[]): void {
  if (!accepted.includes(reply.code)) throw smtpError(reply, stage);
}

async function connectSocket(config: SmtpEmailProviderConfig): Promise<net.Socket | tls.TLSSocket> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new EmailDeliveryError("smtp", "SMTP_CONNECT_TIMEOUT", true, "SMTP connection timed out")), config.timeoutMs);
    const options = { host: config.host, port: config.port };
    const socket = config.secure
      ? tls.connect({ ...options, servername: config.tlsServername || config.host })
      : net.createConnection(options);
    const connectedEvent = config.secure ? "secureConnect" : "connect";
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("error", onError);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(asDeliveryError("smtp", error));
    };
    socket.once("error", onError);
    socket.once(connectedEvent, () => {
      cleanup();
      socket.setTimeout(config.timeoutMs, () => socket.destroy(new Error("SMTP socket timeout")));
      resolve(socket);
    });
  });
}

async function writeCommand(
  socket: net.Socket | tls.TLSSocket,
  reader: SmtpReplyReader,
  command: string,
  timeoutMs: number,
): Promise<SmtpReply> {
  await new Promise<void>((resolve, reject) => {
    socket.write(`${command}\r\n`, (error) => error ? reject(error) : resolve());
  });
  return reader.next(timeoutMs);
}

function capabilities(reply: SmtpReply): Set<string> {
  return new Set(reply.lines.map((line) => line.slice(4).trim().split(/\s+/)[0]?.toUpperCase()).filter(Boolean));
}

function buildSmtpMessage(config: SmtpEmailProviderConfig, input: OutboundEmailMessage): string {
  const recipient = assertEmailAddress(input.recipient, "recipient");
  const from = assertEmailAddress(config.fromAddress, "EMAIL_FROM_ADDRESS");
  const subject = safeHeader(input.subject, "subject");
  const hash = idempotencyHash(input.idempotencyKey);
  const messageId = `<${hash}.${randomUUID()}@${emailDomain(from)}>`;
  const headers = [
    `From: ${mailbox(config.fromName, from)}`,
    `To: ${recipient}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    `X-Interview-Idempotency-Key: ${hash}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  if (config.replyTo) headers.push(`Reply-To: ${assertEmailAddress(config.replyTo, "EMAIL_REPLY_TO")}`);
  const body = input.body.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
  return `${headers.join("\r\n")}\r\n\r\n${body}\r\n.`;
}

export async function sendSmtpEmail(
  config: SmtpEmailProviderConfig,
  input: OutboundEmailMessage,
): Promise<DeliveryResult> {
  assertEmailAddress(config.fromAddress, "EMAIL_FROM_ADDRESS");
  const recipient = assertEmailAddress(input.recipient, "recipient");
  let socket = await connectSocket(config);
  let reader = new SmtpReplyReader(socket);
  try {
    requireSmtp(await reader.next(config.timeoutMs), "banner", [220]);
    let ehlo = await writeCommand(socket, reader, `EHLO interview-platform`, config.timeoutMs);
    requireSmtp(ehlo, "EHLO", [250]);
    let caps = capabilities(ehlo);

    if (!config.secure && config.requireTls) {
      if (!caps.has("STARTTLS")) {
        throw new EmailDeliveryError("smtp", "SMTP_TLS_REQUIRED", false, "SMTP server does not advertise STARTTLS");
      }
      requireSmtp(await writeCommand(socket, reader, "STARTTLS", config.timeoutMs), "STARTTLS", [220]);
      reader.detach();
      socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const upgraded = tls.connect({ socket, servername: config.tlsServername || config.host });
        const timer = setTimeout(() => reject(new EmailDeliveryError("smtp", "SMTP_TLS_TIMEOUT", true, "SMTP TLS negotiation timed out")), config.timeoutMs);
        upgraded.once("secureConnect", () => {
          clearTimeout(timer);
          resolve(upgraded);
        });
        upgraded.once("error", (error) => {
          clearTimeout(timer);
          reject(asDeliveryError("smtp", error));
        });
      });
      reader = new SmtpReplyReader(socket);
      ehlo = await writeCommand(socket, reader, "EHLO interview-platform", config.timeoutMs);
      requireSmtp(ehlo, "EHLO after STARTTLS", [250]);
      caps = capabilities(ehlo);
    }

    if (config.username) {
      if (!config.password) throw new EmailDeliveryError("smtp", "SMTP_AUTH_CONFIG", false, "SMTP password is required when username is configured");
      const authLine = ehlo.lines.find((line) => line.slice(4).toUpperCase().startsWith("AUTH "))?.slice(4).toUpperCase() || "";
      if (authLine.includes("PLAIN")) {
        const payload = Buffer.from(`\0${config.username}\0${config.password}`).toString("base64");
        requireSmtp(await writeCommand(socket, reader, `AUTH PLAIN ${payload}`, config.timeoutMs), "AUTH PLAIN", [235]);
      } else if (authLine.includes("LOGIN") || caps.has("AUTH")) {
        requireSmtp(await writeCommand(socket, reader, "AUTH LOGIN", config.timeoutMs), "AUTH LOGIN", [334]);
        requireSmtp(await writeCommand(socket, reader, Buffer.from(config.username).toString("base64"), config.timeoutMs), "AUTH username", [334]);
        requireSmtp(await writeCommand(socket, reader, Buffer.from(config.password).toString("base64"), config.timeoutMs), "AUTH password", [235]);
      } else {
        throw new EmailDeliveryError("smtp", "SMTP_AUTH_UNSUPPORTED", false, "SMTP server does not advertise a supported AUTH mechanism");
      }
    }

    requireSmtp(await writeCommand(socket, reader, `MAIL FROM:<${config.fromAddress}>`, config.timeoutMs), "MAIL FROM", [250]);
    requireSmtp(await writeCommand(socket, reader, `RCPT TO:<${recipient}>`, config.timeoutMs), "RCPT TO", [250, 251]);
    requireSmtp(await writeCommand(socket, reader, "DATA", config.timeoutMs), "DATA", [354]);
    const dataReply = await writeCommand(socket, reader, buildSmtpMessage(config, input), config.timeoutMs);
    requireSmtp(dataReply, "message body", [250]);
    try {
      await writeCommand(socket, reader, "QUIT", Math.min(config.timeoutMs, 2_000));
    } catch {
      // Delivery has already been accepted; QUIT failures do not change delivery state.
    }
    return {
      provider: "smtp",
      providerReference: dataReply.text.slice(0, 512) || `smtp:${idempotencyHash(input.idempotencyKey)}`,
    };
  } finally {
    reader.detach();
    socket.destroy();
  }
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function awsTimestamp(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function canonicalHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

async function responseMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const candidate = parsed.message ?? parsed.Message ?? parsed.error;
    if (typeof candidate === "string") return candidate.slice(0, 400);
  } catch {
    // fall through to bounded text
  }
  return text.replace(/\s+/g, " ").slice(0, 400);
}

export async function sendSesEmail(
  config: SesEmailProviderConfig,
  input: OutboundEmailMessage,
): Promise<DeliveryResult> {
  const recipient = assertEmailAddress(input.recipient, "recipient");
  const from = assertEmailAddress(config.fromAddress, "EMAIL_FROM_ADDRESS");
  const subject = safeHeader(input.subject, "subject");
  const endpoint = config.endpoint || `https://email.${config.region}.amazonaws.com`;
  const url = new URL("/v2/email/outbound-emails", endpoint);
  const body = JSON.stringify({
    FromEmailAddress: mailbox(config.fromName, from),
    Destination: { ToAddresses: [recipient] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Text: { Data: input.body, Charset: "UTF-8" } },
      },
    },
    EmailTags: [{ Name: "interview-idempotency", Value: idempotencyHash(input.idempotencyKey).slice(0, 64) }],
    ...(config.replyTo ? { ReplyToAddresses: [assertEmailAddress(config.replyTo, "EMAIL_REPLY_TO")] } : {}),
  });
  const now = new Date();
  const { amzDate, dateStamp } = awsTimestamp(now);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (config.sessionToken) headers["x-amz-security-token"] = config.sessionToken;
  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames.map((key) => `${key}:${canonicalHeaderValue(headers[key] ?? "")}\n`).join("");
  const signedHeaders = headerNames.join(";");
  const canonicalRequest = [
    "POST",
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${config.region}/ses/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
  const kDate = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, "ses");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { ...headers, authorization },
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw asDeliveryError("ses", error);
  }
  if (!response.ok) {
    const message = await responseMessage(response);
    throw new EmailDeliveryError(
      "ses",
      `SES_HTTP_${response.status}`,
      response.status === 408 || response.status === 429 || response.status >= 500,
      `Amazon SES rejected the email: ${message}`,
      response.status,
    );
  }
  const parsed = await response.json() as Record<string, unknown>;
  const reference = typeof parsed.MessageId === "string" ? parsed.MessageId : null;
  if (!reference) throw new EmailDeliveryError("ses", "SES_INVALID_RESPONSE", true, "Amazon SES response did not include MessageId");
  return { provider: "ses", providerReference: reference };
}

export async function sendSendGridEmail(
  config: SendGridEmailProviderConfig,
  input: OutboundEmailMessage,
): Promise<DeliveryResult> {
  const recipient = assertEmailAddress(input.recipient, "recipient");
  const from = assertEmailAddress(config.fromAddress, "EMAIL_FROM_ADDRESS");
  const subject = safeHeader(input.subject, "subject");
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/mail/send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: recipient }],
          custom_args: { interview_idempotency: idempotencyHash(input.idempotencyKey).slice(0, 64) },
        }],
        from: { email: from, ...(config.fromName.trim() ? { name: config.fromName.trim() } : {}) },
        ...(config.replyTo ? { reply_to: { email: assertEmailAddress(config.replyTo, "EMAIL_REPLY_TO") } } : {}),
        subject,
        content: [{ type: "text/plain", value: input.body }],
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw asDeliveryError("sendgrid", error);
  }
  if (!response.ok) {
    const message = await responseMessage(response);
    throw new EmailDeliveryError(
      "sendgrid",
      `SENDGRID_HTTP_${response.status}`,
      response.status === 408 || response.status === 429 || response.status >= 500,
      `SendGrid rejected the email: ${message}`,
      response.status,
    );
  }
  const reference = response.headers.get("x-message-id")?.trim()
    || `sendgrid:${idempotencyHash(input.idempotencyKey)}`;
  return { provider: "sendgrid", providerReference: reference.slice(0, 512) };
}

@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  isEnabled(): boolean {
    const env = getEnv();
    return env.EMAIL_PROVIDER === "smtp" && Boolean(env.EMAIL_FROM_ADDRESS && env.SMTP_HOST);
  }
  async send(input: OutboundEmailMessage): Promise<DeliveryResult> {
    const config = smtpConfigFromEnv();
    const result = await withRetry(this.name, config, () => sendSmtpEmail(config, input));
    return { ...result.value, attemptCount: result.attempts, latencyMs: result.latencyMs };
  }
}

@Injectable()
export class SesEmailProvider implements EmailProvider {
  readonly name = "ses";
  isEnabled(): boolean {
    const env = getEnv();
    return env.EMAIL_PROVIDER === "ses" && Boolean(env.EMAIL_FROM_ADDRESS && env.SES_ACCESS_KEY_ID && env.SES_SECRET_ACCESS_KEY);
  }
  async send(input: OutboundEmailMessage): Promise<DeliveryResult> {
    const config = sesConfigFromEnv();
    const result = await withRetry(this.name, config, () => sendSesEmail(config, input));
    return { ...result.value, attemptCount: result.attempts, latencyMs: result.latencyMs };
  }
}

@Injectable()
export class SendGridEmailProvider implements EmailProvider {
  readonly name = "sendgrid";
  isEnabled(): boolean {
    const env = getEnv();
    return env.EMAIL_PROVIDER === "sendgrid" && Boolean(env.EMAIL_FROM_ADDRESS && env.SENDGRID_API_KEY);
  }
  async send(input: OutboundEmailMessage): Promise<DeliveryResult> {
    const config = sendGridConfigFromEnv();
    const result = await withRetry(this.name, config, () => sendSendGridEmail(config, input));
    return { ...result.value, attemptCount: result.attempts, latencyMs: result.latencyMs };
  }
}
