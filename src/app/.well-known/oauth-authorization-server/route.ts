import { authorizationServerMetadata, corsJson, corsOptions } from "@/mcp/oauth/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsOptions();
}

export function GET() {
  return corsJson(authorizationServerMetadata());
}
