import { corsOptions } from "@/mcp/oauth/metadata";

const STREAMABLE_ACCEPT = "application/json, text/event-stream";

export function extractMcpToken(req: Request): string | undefined {
  const authorization = req.headers.get("authorization");
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  const apiKey = req.headers.get("x-api-key")?.trim();
  if (apiKey) {
    return apiKey.replace(/^Bearer\s+/i, "");
  }

  const authToken = req.headers.get("x-auth-token")?.trim();
  if (authToken) {
    return authToken.replace(/^Bearer\s+/i, "");
  }

  return undefined;
}

export function withStreamableAccept(req: Request): Request {
  const accept = (req.headers.get("accept") ?? "").toLowerCase();
  if (accept.includes("application/json") && accept.includes("text/event-stream")) {
    return req;
  }

  const headers = new Headers(req.headers);
  headers.set("Accept", STREAMABLE_ACCEPT);
  return new Request(req, { headers });
}

export function parseSseJsonPayload(body: string): string | undefined {
  const data = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("");
  if (!data) {
    return undefined;
  }
  try {
    JSON.parse(data);
    return data;
  } catch {
    return undefined;
  }
}

export async function toJsonRpcResponse(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return withCors(response);
  }

  const text = await response.text();
  const payload = parseSseJsonPayload(text);
  if (!payload) {
    return withCors(
      new Response(text, {
        status: response.status,
        headers: response.headers,
      }),
    );
  }

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json");
  return withCors(
    new Response(payload, {
      status: response.status,
      headers,
    }),
  );
}

export function mcpProbeGetResponse(): Response {
  return new Response(": connected\n\n", {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function mcpOptionsResponse(): Response {
  return corsOptions();
}

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  if (!headers.has("Access-Control-Allow-Origin")) {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  if (!headers.has("Access-Control-Allow-Headers")) {
    headers.set("Access-Control-Allow-Headers", "*");
  }
  if (!headers.has("Access-Control-Expose-Headers")) {
    headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
