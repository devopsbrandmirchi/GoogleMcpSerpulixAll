import { describe, expect, it } from "vitest";
import {
  idFromResourceName,
  mapDiscoveredAdvertiser,
  mapDiscoveredPartner,
} from "@/products/dv360/discovery";

describe("DV360 discovery mapping", () => {
  it("reads partner and advertiser IDs from resource names when fields are omitted", () => {
    expect(idFromResourceName("partners/123", "partners")).toBe("123");
    expect(
      mapDiscoveredPartner({
        name: "partners/123",
        displayName: "Acme Partner",
      }),
    ).toMatchObject({
      partnerId: "123",
      displayName: "Acme Partner",
    });
    expect(
      mapDiscoveredAdvertiser({
        name: "advertisers/456",
        partnerId: "123",
        displayName: "Acme Advertiser",
      }),
    ).toMatchObject({
      advertiserId: "456",
      partnerId: "123",
    });
  });
});
