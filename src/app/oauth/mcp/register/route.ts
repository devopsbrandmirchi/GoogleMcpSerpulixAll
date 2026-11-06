import { createDcrClientId } from "@/mcp/oauth/clients";
import { corsJson, corsOptions } from "@/mcp/oauth/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsOptions();
}

export async function POST(req: Request) {
  let body: {
    redirect_uris?: unknown;
    token_endpoint_auth_method?: unknown;
    client_name?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return corsJson(
      { error: "invalid_client_metadata", error_description: "Expected a JSON body." },
      400,
    );
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((value): value is string => typeof value === "string")
    : [];
  if (redirectUris.length === 0) {
    return corsJson(
      {
        error: "invalid_redirect_uri",
        error_description: "redirect_uris must contain at least one URI.",
      },
      400,
    );
  }

  const tokenEndpointAuthMethod =
    typeof body.token_endpoint_auth_method === "string"
      ? body.token_endpoint_auth_method
      : "none";

  const clientId = createDcrClientId({
    redirectUris,
    tokenEndpointAuthMethod,
  });

  return corsJson(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: typeof body.client_name === "string" ? body.client_name : "Claude",
    },
    201,
  );
}
