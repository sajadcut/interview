import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException, type ArgumentsHost } from "@nestjs/common";
import { HttpExceptionFilter } from "./http-exception.filter";

function captureErrorBody(exception: unknown): { status: number; body: unknown } {
  let status = 0;
  let body: unknown;
  const response = {
    status(nextStatus: number) {
      status = nextStatus;
      return this;
    },
    json(nextBody: unknown) {
      body = nextBody;
      return this;
    },
  };
  const host = {
    switchToHttp() {
      return {
        getResponse: () => response,
      };
    },
  } as unknown as ArgumentsHost;

  new HttpExceptionFilter().catch(exception, host);
  return { status, body };
}

test("HTTP exception filter matches the public typed ApiError contract", () => {
  const result = captureErrorBody(new UnauthorizedException("Candidate OTP is invalid"));

  assert.equal(result.status, 401);
  assert.deepEqual(result.body, {
    message: "Candidate OTP is invalid",
    statusCode: 401,
    error: "UNAUTHORIZED",
  });
});

test("HTTP exception filter flattens validation message arrays into actionable text", () => {
  const result = captureErrorBody(
    new UnauthorizedException({ message: ["first validation error", "second validation error"] }),
  );

  assert.equal(result.status, 401);
  assert.deepEqual(result.body, {
    message: "first validation error; second validation error",
    statusCode: 401,
    error: "UNAUTHORIZED",
  });
});
