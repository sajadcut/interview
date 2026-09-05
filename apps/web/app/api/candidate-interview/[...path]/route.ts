import { NextResponse } from "next/server";
import { loadRootEnvironment } from "../../../../lib/root-env";

loadRootEnvironment();

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "cookie",
  "origin",
  "user-agent",
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
  target.pathname = `${basePath}/v1/candidate-interview/${path.map(encodeURIComponent).join("/")}`;
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

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = buildTargetUrl(request, path);
  try {
    const method = request.method.toUpperCase();
    const hasBody = !["GET", "HEAD"].includes(method);
    const response = await fetch(target, {
      method,
      headers: forwardedHeaders(request),
      cache: "no-store",
      redirect: "manual",
      ...(hasBody ? { body: await request.arrayBuffer() } : {}),
    });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "cache-control", "content-disposition", "x-request-id"] as const) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
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
        message: `Candidate interview API could not be reached: ${reason}`,
      },
      { status: 502 },
    );
  }
}

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
export const OPTIONS = proxy;
