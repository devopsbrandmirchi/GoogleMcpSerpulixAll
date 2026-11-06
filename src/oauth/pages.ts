import { escapeHtml, pageHtml } from "@/lib/html";
import { connectionProducts } from "@/providers/google/auth";
import type { GoogleConnectionRecord, ResumeCandidate } from "@/store/types";

export function connectionsPageHtml(params: {
  connections: GoogleConnectionRecord[];
  email?: string | null;
  notice?: string;
  continueAction?: boolean;
}): string {
  const rows = params.connections
    .map((connection) => {
      const products = connectionProducts(connection).join(", ") || "none yet";
      return `<li><code>${escapeHtml(connection.googleEmail ?? connection.googleSubjectId)}</code> — ${escapeHtml(
        connection.status,
      )} — products: ${escapeHtml(products)}</li>`;
    })
    .join("");

  return pageHtml(
    "Google connections",
    `
      <h1>Google connections</h1>
      ${params.email ? `<p>Operator workspace started as <code>${escapeHtml(params.email)}</code>.</p>` : ""}
      ${params.notice ? `<p class="note">${escapeHtml(params.notice)}</p>` : ""}
      <p>Each Google Account is an independent OAuth connection. GA4 properties, Google Ads customers, and DV360 partners are routed to the connection that authorized them.</p>
      <ul>${rows || "<li>No Google Accounts connected yet.</li>"}</ul>
      <form method="post" action="/oauth/google/connect">
        <button type="submit">Connect another Google Account</button>
      </form>
      ${
        params.continueAction
          ? `<form method="post" action="/oauth/google/connections">
        <button type="submit">Continue to Claude</button>
      </form>`
          : ""
      }
    `,
  );
}

export function resumePageHtml(params: {
  googleEmail: string | null;
  candidates: ResumeCandidate[];
  error?: string;
}): string {
  const options = params.candidates
    .map(
      (candidate) =>
        `<option value="${escapeHtml(candidate.operatorId)}">${escapeHtml(
          candidate.primaryEmail ?? candidate.googleEmail ?? candidate.operatorId,
        )} — ${candidate.connectionCount} connection(s), created ${escapeHtml(
          candidate.createdAt,
        )}</option>`,
    )
    .join("");

  return pageHtml(
    "Resume or start new",
    `
      <h1>This Google Account is already connected</h1>
      <p>Signed in as <code>${escapeHtml(params.googleEmail ?? "unknown")}</code>.</p>
      <p>Resume an existing workspace, or start a new isolated operator. Existing Google connections are never merged.</p>
      ${params.error ? `<p class="error">${escapeHtml(params.error)}</p>` : ""}
      <form method="post" action="/oauth/google/resume">
        <label for="choice">What should happen?</label>
        <select id="choice" name="choice" required>
          <option value="resume">Resume an existing workspace</option>
          <option value="start_new">Start a new workspace</option>
        </select>
        <label for="operatorId">Existing workspace</label>
        <select id="operatorId" name="operatorId">
          ${options}
        </select>
        <button type="submit">Continue</button>
      </form>
    `,
  );
}

export function successPageHtml(title: string, message: string): string {
  return pageHtml(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
}
