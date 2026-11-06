export const dynamic = "force-dynamic";

export default function HomePage() {
  const baseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
  const mcpUrl = baseUrl ? `${baseUrl}/mcp` : "/mcp";
  const googleCallback = baseUrl
    ? `${baseUrl}/oauth/google/callback`
    : "/oauth/google/callback";

  return (
    <main
      style={{
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        maxWidth: "42rem",
        margin: "3rem auto",
        padding: "0 1.25rem",
        lineHeight: 1.5,
      }}
    >
      <h1>google-mcp-serpulix-all</h1>
      <p>
        True Model B Google Marketing connector: one MCP operator can own multiple
        independent Google OAuth connections. GA4 properties and Google Ads
        customers are routed to the Google credential that authorized them.
      </p>
      <ul>
        <li>
          Claude.ai connector URL: <code>{mcpUrl}</code>
        </li>
        <li>
          Google OAuth callback: <code>{googleCallback}</code>
        </li>
      </ul>
      <p>
        <a href="/health">Health</a>
      </p>
      <p style={{ color: "#666" }}>
        Claude authenticates with MCP OAuth. The MCP token subject is the
        internal operator ID, never a Google account. This service uses the
        named Firestore database <code>google-mcp-serpulix-all</code> and must allow
        unauthenticated Cloud Run ingress so Anthropic can reach <code>/mcp</code>.
      </p>
    </main>
  );
}
