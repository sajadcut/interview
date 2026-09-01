import { NextResponse } from "next/server";
import { loadRootEnvironment } from "../../../../lib/root-env";

loadRootEnvironment();

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "authorization",
  "cookie",
  "user-agent",
  "x-organization-id",
  "x-user-id",
  "x-request-id",
] as const;

function getApiTarget(): URL {
  const host = process.env.API_HOST?.trim() || "127.0.0.1";
  const port = process.env.API_PORT?.trim() || "4000";
  const configured =
    process.env.API_INTERNAL_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    `http://${host}:${port}`;
  const target = new URL(configured);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("API_INTERNAL_URL must use http or https");
  }
  return target;
}

function buildTargetUrl(request: Request, path: string[]): URL {
  const target = getApiTarget();
  const basePath = target.pathname.replace(/\/$/, "");
  target.pathname = `${basePath}/${path.map(encodeURIComponent).join("/")}`;
  target.search = new URL(request.url).search;
  return target;
}

function forwardedHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function forwardResponseCookies(source: Headers, target: Headers): void {
  const headers = source as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [];
  if (values.length > 0) {
    for (const value of values) target.append("set-cookie", value);
    return;
  }

  const fallback = source.get("set-cookie");
  if (fallback) target.append("set-cookie", fallback);
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = buildTargetUrl(request, path);

  try {
    const method = request.method.toUpperCase();
    const hasBody = !["GET", "HEAD"].includes(method);
    const init: RequestInit = {
      method,
      headers: forwardedHeaders(request),
      cache: "no-store",
      redirect: "manual",
      ...(hasBody ? { body: await request.arrayBuffer() } : {}),
    };
    const response = await fetch(target, init);

    const responseHeaders = new Headers();
    for (const name of [
      "content-type",
      "cache-control",
      "location",
      "www-authenticate",
      "x-request-id",
    ] as const) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    forwardResponseCookies(response.headers, responseHeaders);
    responseHeaders.set("x-interview-api-target", target.origin);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "Unknown backend connection error";
    return NextResponse.json(
      {
        statusCode: 502,
        error: "Bad Gateway",
        message: `Internal API proxy could not reach ${target.origin}: ${reason}`,
        target: target.origin,
      },
      {
        status: 502,
        headers: { "x-interview-api-target": target.origin },
      },
    );
  }
}

export const dynamic = "force-dynamic";

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
