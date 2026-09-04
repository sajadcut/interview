import assert from "node:assert/strict";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer, type Socket } from "node:net";
import { afterEach, test } from "node:test";
import {
  EmailDeliveryError,
  sendSendGridEmail,
  sendSesEmail,
  sendSmtpEmail,
  type SendGridEmailProviderConfig,
  type SesEmailProviderConfig,
  type SmtpEmailProviderConfig,
} from "./email.providers";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

const request = {
  organizationId: "00000000-0000-0000-0000-000000000001",
  notificationId: "00000000-0000-0000-0000-000000000002",
  recipient: "candidate@example.com",
  subject: "Interview update",
  body: "Hello candidate.\n.Second line",
  idempotencyKey: "notification:test:1",
};

const common = {
  fromAddress: "recruiting@example.com",
  fromName: "Interview Platform",
  replyTo: "replies@example.com",
  timeoutMs: 2_000,
  maxAttempts: 1,
  retryBaseMs: 50,
};

async function listenHttp(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createHttpServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function bodyOf(incoming: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of incoming) body += String(chunk);
  return body;
}

test("SendGrid sends a real v3 mail request and returns provider message id", async () => {
  let receivedBody = "";
  let authorization = "";
  const baseUrl = await listenHttp(async (incoming, response) => {
    authorization = String(incoming.headers.authorization ?? "");
    receivedBody = await bodyOf(incoming);
    response.statusCode = 202;
    response.setHeader("x-message-id", "sg-message-123");
    response.end();
  });
  const config: SendGridEmailProviderConfig = { ...common, apiKey: "test-sendgrid-key", baseUrl };
  const result = await sendSendGridEmail(config, request);
  assert.equal(result.provider, "sendgrid");
  assert.equal(result.providerReference, "sg-message-123");
  assert.equal(authorization, "Bearer test-sendgrid-key");
  const parsed = JSON.parse(receivedBody) as Record<string, unknown>;
  assert.equal(parsed.subject, request.subject);
  assert.match(receivedBody, /candidate@example\.com/);
  assert.match(receivedBody, /interview_idempotency/);
});

test("SendGrid classifies throttling as retryable without exposing credentials", async () => {
  const baseUrl = await listenHttp((_incoming, response) => {
    response.statusCode = 429;
    response.end(JSON.stringify({ message: "rate limited" }));
  });
  const config: SendGridEmailProviderConfig = { ...common, apiKey: "super-secret-key", baseUrl };
  await assert.rejects(
    () => sendSendGridEmail(config, request),
    (error: unknown) => {
      assert(error instanceof EmailDeliveryError);
      assert.equal(error.provider, "sendgrid");
      assert.equal(error.retryable, true);
      assert.equal(error.statusCode, 429);
      assert.doesNotMatch(error.message, /super-secret-key/);
      return true;
    },
  );
});

test("SES v2 request is SigV4 signed and persists the AWS MessageId", async () => {
  let authorization = "";
  let amzDate = "";
  let receivedBody = "";
  const endpoint = await listenHttp(async (incoming, response) => {
    authorization = String(incoming.headers.authorization ?? "");
    amzDate = String(incoming.headers["x-amz-date"] ?? "");
    receivedBody = await bodyOf(incoming);
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ MessageId: "ses-message-123" }));
  });
  const config: SesEmailProviderConfig = {
    ...common,
    region: "eu-central-1",
    accessKeyId: "AKIATEST",
    secretAccessKey: "test-secret",
    sessionToken: "session-token",
    endpoint,
  };
  const result = await sendSesEmail(config, request);
  assert.equal(result.provider, "ses");
  assert.equal(result.providerReference, "ses-message-123");
  assert.match(authorization, /^AWS4-HMAC-SHA256 Credential=AKIATEST\//);
  assert.match(authorization, /\/eu-central-1\/ses\/aws4_request/);
  assert.match(amzDate, /^\d{8}T\d{6}Z$/);
  assert.match(receivedBody, /candidate@example\.com/);
  assert.match(receivedBody, /interview-idempotency/);
});

async function listenSmtp(options?: { rejectRecipient?: boolean }) {
  let transcript = "";
  const server = createNetServer((socket: Socket) => {
    socket.setEncoding("utf8");
    socket.write("220 local.test ESMTP ready\r\n");
    let buffer = "";
    let dataMode = false;
    socket.on("data", (chunk) => {
      buffer += String(chunk);
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline + 1).replace(/\r?\n$/, "");
        buffer = buffer.slice(newline + 1);
        transcript += `${line}\n`;
        if (dataMode) {
          if (line === ".") {
            dataMode = false;
            socket.write("250 2.0.0 queued as local-queue-123\r\n");
          }
        } else if (line.startsWith("EHLO")) {
          socket.write("250-local.test\r\n250 SIZE 1000000\r\n");
        } else if (line.startsWith("MAIL FROM")) {
          socket.write("250 2.1.0 sender ok\r\n");
        } else if (line.startsWith("RCPT TO")) {
          socket.write(options?.rejectRecipient
            ? "451 4.3.0 temporary recipient failure\r\n"
            : "250 2.1.5 recipient ok\r\n");
        } else if (line === "DATA") {
          dataMode = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (line === "QUIT") {
          socket.write("221 2.0.0 bye\r\n");
          socket.end();
        }
        newline = buffer.indexOf("\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert(address && typeof address === "object");
  return { port: address.port, transcript: () => transcript };
}

test("SMTP performs envelope + DATA delivery and dot-stuffs body lines", async () => {
  const local = await listenSmtp();
  const config: SmtpEmailProviderConfig = {
    ...common,
    host: "127.0.0.1",
    port: local.port,
    secure: false,
    requireTls: false,
    username: null,
    password: null,
    tlsServername: null,
  };
  const result = await sendSmtpEmail(config, request);
  assert.equal(result.provider, "smtp");
  assert.match(result.providerReference, /local-queue-123/);
  assert.match(local.transcript(), /MAIL FROM:<recruiting@example\.com>/);
  assert.match(local.transcript(), /RCPT TO:<candidate@example\.com>/);
  assert.match(local.transcript(), /X-Interview-Idempotency-Key:/);
  assert.match(local.transcript(), /\.\.Second line/);
});

test("SMTP 4xx response is classified retryable", async () => {
  const local = await listenSmtp({ rejectRecipient: true });
  const config: SmtpEmailProviderConfig = {
    ...common,
    host: "127.0.0.1",
    port: local.port,
    secure: false,
    requireTls: false,
    username: null,
    password: null,
    tlsServername: null,
  };
  await assert.rejects(
    () => sendSmtpEmail(config, request),
    (error: unknown) => {
      assert(error instanceof EmailDeliveryError);
      assert.equal(error.code, "SMTP_451");
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test("header injection is rejected before provider delivery", async () => {
  const config: SendGridEmailProviderConfig = {
    ...common,
    apiKey: "unused",
    baseUrl: "http://127.0.0.1:1",
  };
  await assert.rejects(
    () => sendSendGridEmail(config, { ...request, subject: "hello\r\nBcc: attacker@example.com" }),
    (error: unknown) => error instanceof EmailDeliveryError && error.code === "INVALID_HEADER",
  );
});
