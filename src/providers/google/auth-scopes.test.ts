import { afterEach, describe, expect, it, vi } from "vitest";
import { DV360_SCOPE, GA4_READONLY_SCOPE, GOOGLE_ADS_SCOPE, googleOAuthScopes } from "@/lib/config";
import { connectionProducts, parseGrantedScopes } from "@/providers/google/auth";
import type { GoogleConnectionRecord } from "@/store/types";

afterEach(() => { vi.unstubAllEnvs(); });

describe("Google granted scopes", () => {
  it("requests GA4 and Ads but not DV360 by default", () => {
    expect(googleOAuthScopes()).toContain(GA4_READONLY_SCOPE);
    expect(googleOAuthScopes()).toContain(GOOGLE_ADS_SCOPE);
    expect(googleOAuthScopes()).not.toContain(DV360_SCOPE);
  });

  it("requests DV360 only when DV360_ENABLED=true", () => {
    vi.stubEnv("DV360_ENABLED", "true");
    expect(googleOAuthScopes()).toEqual(expect.arrayContaining([GA4_READONLY_SCOPE, GOOGLE_ADS_SCOPE, DV360_SCOPE]));
  });

  it("persists granted scopes from the token response", () => {
    expect(
      parseGrantedScopes(`${GA4_READONLY_SCOPE} ${GOOGLE_ADS_SCOPE} ${DV360_SCOPE}`),
    ).toEqual([GA4_READONLY_SCOPE, GOOGLE_ADS_SCOPE, DV360_SCOPE]);
  });

  it("falls back to the requested connection scopes when Google omits tokens.scope", () => {
    expect(parseGrantedScopes(undefined)).toEqual(googleOAuthScopes());
    expect(parseGrantedScopes("")).not.toContain(DV360_SCOPE);
    vi.stubEnv("DV360_ENABLED", "true");
    expect(parseGrantedScopes("")).toContain(DV360_SCOPE);
  });

  it("hides DV360 from connection products while the flag is off", () => {
    const connection = { scopes: [GA4_READONLY_SCOPE, GOOGLE_ADS_SCOPE, DV360_SCOPE] } as GoogleConnectionRecord;
    expect(connectionProducts(connection)).toEqual(["GA4", "Google Ads"]);
    vi.stubEnv("DV360_ENABLED", "true");
    expect(connectionProducts(connection)).toEqual(["GA4", "Google Ads", "DV360"]);
  });
});
