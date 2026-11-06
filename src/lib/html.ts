export function pageHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: ui-sans-serif, system-ui, sans-serif;
        max-width: 42rem;
        margin: 3rem auto;
        padding: 0 1.25rem;
        line-height: 1.5;
      }
      code, textarea {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      label { display: block; font-weight: 600; margin-bottom: 0.35rem; }
      select, input[type="text"] {
        width: 100%;
        padding: 0.6rem 0.7rem;
        border: 1px solid #8884;
        border-radius: 0.4rem;
      }
      button {
        margin-top: 1rem;
        padding: 0.55rem 0.9rem;
        border: 0;
        border-radius: 0.4rem;
        background: #111;
        color: #fff;
        cursor: pointer;
      }
      .note { color: #666; font-size: 0.95rem; }
      .error { color: #b42318; }
      ul.properties { padding-left: 1.2rem; }
    </style>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function htmlResponse(html: string, status = 200, headers?: HeadersInit): Response {
  const next = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (headers) {
    new Headers(headers).forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") {
        next.append(key, value);
      } else {
        next.set(key, value);
      }
    });
  }
  const safeStatus = Number.isInteger(status) && status >= 200 && status <= 599 ? status : 500;
  return new Response(html, {
    status: safeStatus,
    headers: next,
  });
}
