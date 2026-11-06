import { AppError } from "@/lib/errors";

const MUTATION_PATTERN = /\b(insert|update|delete|mutate|remove|create)\b/i;

export function assertReadOnlyGaql(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new AppError("A Google Ads Query Language query is required.", "invalid_query", 400);
  }

  const withoutLineComments = trimmed
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--") && !line.trim().startsWith("#"))
    .join("\n")
    .trim();

  if (MUTATION_PATTERN.test(withoutLineComments)) {
    throw new AppError(
      "This server is read-only. Only SELECT Google Ads Query Language queries are allowed.",
      "invalid_query",
      400,
    );
  }

  if (!/^(with\b[\s\S]+)?select\b/i.test(withoutLineComments)) {
    throw new AppError(
      "Only SELECT Google Ads Query Language queries are allowed.",
      "invalid_query",
      400,
    );
  }

  return withoutLineComments;
}
