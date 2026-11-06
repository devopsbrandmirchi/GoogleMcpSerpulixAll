import { describe, expect, it } from "vitest";
import { DV360_SCOPE, GA4_READONLY_SCOPE, GOOGLE_ADS_SCOPE, GOOGLE_OPENID_SCOPES } from "@/lib/config";
import { parseGrantedScopes } from "@/providers/google/auth";

describe("Google granted scopes", () => {
  it("keeps GA4 and Ads scopes when adding DV360", () => {
    expect(GOOGLE_OPENID_SCOPES).toContain(GA4_READONLY_SCOPE);
    expect(GOOGLE_OPENID_SCOPES).toContain(GOOGLE_ADS_SCOPE);
    expect(GOOGLE_OPENID_SCOPES).toContain(DV360_SCOPE);
  });

  it("persists granted scopes from the token response", () => {
    expect(
      parseGrantedScopes(`${GA4_READONLY_SCOPE} ${GOOGLE_ADS_SCOPE} ${DV360_SCOPE}`),
    ).toEqual([GA4_READONLY_SCOPE, GOOGLE_ADS_SCOPE, DV360_SCOPE]);
  });

  it("falls back to the requested connection scopes when Google omits tokens.scope", () => {
    expect(parseGrantedScopes(undefined)).toEqual([...GOOGLE_OPENID_SCOPES]);
    expect(parseGrantedScopes("")).toEqual([...GOOGLE_OPENID_SCOPES]);
  });
});
