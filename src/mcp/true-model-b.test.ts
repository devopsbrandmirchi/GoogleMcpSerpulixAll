import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptRefreshToken } from "@/lib/crypto";
import { runWithOperator } from "@/lib/request-context";
import { DV360_SCOPE } from "@/lib/config";
import { resolveAuthorizedProperty } from "@/products/ga4/routing";
import { resolveAdsAccessContext } from "@/products/google-ads/routing";
import {
  resolveDv360AdvertiserAccess,
  resolveDv360PartnerAccess,
} from "@/products/dv360/routing";
import { assertConnectionOwned, publicConnectionView } from "@/providers/google/auth";
import { createMemoryAppStore } from "@/store/memory";
import { setAppStore } from "@/store/app-store";
import { setRequiredEnv } from "@/test/env";
import type {
  AppStore,
  DiscoveredAdsCustomer,
  DiscoveredDv360Advertiser,
  DiscoveredDv360Partner,
} from "@/store/types";

const clientsSeen: string[] = [];

vi.mock("@/providers/google/auth", async () => {
  const actual = await vi.importActual<typeof import("@/providers/google/auth")>(
    "@/providers/google/auth",
  );
  return {
    ...actual,
    getAuthorizedClientForConnection: async (operatorId: string, connectionId: string) => {
      const { getAppStore } = await import("@/store/app-store");
      const { decryptRefreshToken } = await import("@/lib/crypto");
      const connection = await getAppStore().getConnection(connectionId);
      if (!connection || connection.operatorId !== operatorId) {
        throw new Error("forbidden");
      }
      if (!connection.refreshTokenEncrypted) {
        throw new Error("missing token");
      }
      if (connection.status === "reauthorization_required" || connection.status === "revoked") {
        const { AppError } = await import("@/lib/errors");
        throw new AppError(
          `The Google connection for ${connection.googleEmail} requires reauthorization.`,
          "reauthorization_required",
          401,
        );
      }
      const token = decryptRefreshToken(connection.refreshTokenEncrypted);
      clientsSeen.push(`${connection.googleSubjectId}:${token}`);
      return { credentials: { refresh_token: token }, getAccessToken: async () => ({ token }) };
    },
  };
});

async function seedOperator(
  store: AppStore,
  email: string,
  connections: Array<{
    subject: string;
    token: string;
    scopes?: string[];
    properties?: Array<{ account: string; propertyId: string; name: string }>;
    ads?: DiscoveredAdsCustomer[];
    dv360?: {
      partners: DiscoveredDv360Partner[];
      advertisers: DiscoveredDv360Advertiser[];
    };
  }>,
) {
  const operator = await store.createOperator(email);
  const created = [];
  for (const item of connections) {
    const connection = await store.upsertConnection({
      operatorId: operator.operatorId,
      googleSubjectId: item.subject,
      googleEmail: `${item.subject}@example.com`,
      encryptedRefreshToken: encryptRefreshToken(item.token),
      scopes: item.scopes,
    });
    if (item.properties) {
      await store.replaceConnectionResources(
        operator.operatorId,
        connection.connectionId,
        item.properties.map((property) => ({
          ga4AccountId: property.account,
          displayName: `Account ${property.account}`,
        })),
        item.properties.map((property) => ({
          ga4AccountId: property.account,
          propertyId: property.propertyId,
          displayName: property.name,
          propertyType: "PROPERTY_TYPE_ORDINARY",
        })),
      );
    }
    if (item.ads) {
      await store.replaceAdsResources(operator.operatorId, connection.connectionId, item.ads, []);
    }
    if (item.dv360) {
      await store.replaceDv360Resources(
        operator.operatorId,
        connection.connectionId,
        item.dv360.partners,
        item.dv360.advertisers,
      );
    }
    created.push(connection);
  }
  return { operator, connections: created };
}

describe("True Model B + Ads routing", () => {
  let store: AppStore;

  beforeEach(() => {
    setRequiredEnv();
    clientsSeen.length = 0;
    store = createMemoryAppStore();
    setAppStore(store);
  });

  it("Test 1 — Operator A / Google X / GA4 X1 succeeds", async () => {
    const { operator } = await seedOperator(store, "a@example.com", [
      { subject: "google-x", token: "1//x", properties: [{ account: "100", propertyId: "1001", name: "X1" }] },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      const resolved = await resolveAuthorizedProperty("1001");
      expect(resolved.connection.googleSubjectId).toBe("google-x");
    });
    expect(clientsSeen).toEqual(["google-x:1//x"]);
  });

  it("Test 2 — Operator A / Google Y / GA4 Y1 uses Y not X", async () => {
    const { operator } = await seedOperator(store, "a@example.com", [
      { subject: "google-x", token: "1//x", properties: [{ account: "100", propertyId: "1001", name: "X1" }] },
      { subject: "google-y", token: "1//y", properties: [{ account: "200", propertyId: "2001", name: "Y1" }] },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      expect((await resolveAuthorizedProperty("2001")).connection.googleSubjectId).toBe("google-y");
    });
    expect(clientsSeen).toEqual(["google-y:1//y"]);
  });

  it("Test 3 — Operator A / Google X / Ads MCC X / Client X1 succeeds", async () => {
    const { operator } = await seedOperator(store, "a@example.com", [
      {
        subject: "google-x",
        token: "1//x",
        ads: [
          {
            customerId: "1111111111",
            descriptiveName: "MCC X",
            currencyCode: "USD",
            timeZone: "America/New_York",
            status: "ENABLED",
            manager: true,
            directlyAccessible: true,
            loginCustomerId: null,
            accessibleManagerIds: [],
            level: 0,
            parentCustomerId: null,
          },
          {
            customerId: "2222222222",
            descriptiveName: "Client X1",
            currencyCode: "USD",
            timeZone: "America/New_York",
            status: "ENABLED",
            manager: false,
            directlyAccessible: false,
            loginCustomerId: "1111111111",
            accessibleManagerIds: ["1111111111"],
            level: 1,
            parentCustomerId: "1111111111",
          },
        ],
      },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      const resolved = await resolveAdsAccessContext("222-222-2222");
      expect(resolved.connection.googleSubjectId).toBe("google-x");
      expect(resolved.customerId).toBe("2222222222");
      expect(resolved.loginCustomerId).toBe("1111111111");
    });
  });

  it("Test 4 — Operator A / Google Y Ads client uses Y", async () => {
    const { operator } = await seedOperator(store, "a@example.com", [
      {
        subject: "google-x",
        token: "1//x",
        ads: [
          {
            customerId: "1111111111",
            descriptiveName: "MCC X",
            currencyCode: null,
            timeZone: null,
            status: "ENABLED",
            manager: true,
            directlyAccessible: true,
            loginCustomerId: null,
            accessibleManagerIds: [],
            level: 0,
            parentCustomerId: null,
          },
        ],
      },
      {
        subject: "google-y",
        token: "1//y",
        ads: [
          {
            customerId: "3333333333",
            descriptiveName: "MCC Y",
            currencyCode: null,
            timeZone: null,
            status: "ENABLED",
            manager: true,
            directlyAccessible: true,
            loginCustomerId: null,
            accessibleManagerIds: [],
            level: 0,
            parentCustomerId: null,
          },
          {
            customerId: "4444444444",
            descriptiveName: "Client Y1",
            currencyCode: null,
            timeZone: null,
            status: "ENABLED",
            manager: false,
            directlyAccessible: false,
            loginCustomerId: "3333333333",
            accessibleManagerIds: ["3333333333"],
            level: 1,
            parentCustomerId: "3333333333",
          },
        ],
      },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      const resolved = await resolveAdsAccessContext("4444444444");
      expect(resolved.connection.googleSubjectId).toBe("google-y");
      expect(resolved.loginCustomerId).toBe("3333333333");
    });
    expect(clientsSeen.every((item) => item.startsWith("google-y:"))).toBe(true);
  });

  it("Test 5 — same Google identity on two operators stays independent", async () => {
    const a = await seedOperator(store, "op-a@example.com", [
      { subject: "google-x", token: "1//ax", properties: [{ account: "100", propertyId: "1001", name: "Shared" }] },
    ]);
    const b = await seedOperator(store, "op-b@example.com", [
      { subject: "google-x", token: "1//bx", properties: [{ account: "100", propertyId: "1001", name: "Shared" }] },
    ]);
    expect(a.connections[0]?.connectionId).not.toBe(b.connections[0]?.connectionId);
    await runWithOperator({ requestId: "r1", operatorId: a.operator.operatorId, sessionId: "sa" }, async () => {
      await resolveAuthorizedProperty("1001");
    });
    await runWithOperator({ requestId: "r2", operatorId: b.operator.operatorId, sessionId: "sb" }, async () => {
      await resolveAuthorizedProperty("1001");
    });
    expect(clientsSeen).toEqual(["google-x:1//ax", "google-x:1//bx"]);
  });

  it("Test 6 — Operator A cannot access Operator B Ads customer", async () => {
    const a = await seedOperator(store, "op-a@example.com", [
      {
        subject: "google-a",
        token: "1//a",
        ads: [
          {
            customerId: "1111111111",
            descriptiveName: "A",
            currencyCode: null,
            timeZone: null,
            status: "ENABLED",
            manager: false,
            directlyAccessible: true,
            loginCustomerId: null,
            accessibleManagerIds: [],
            level: 0,
            parentCustomerId: null,
          },
        ],
      },
    ]);
    await seedOperator(store, "op-b@example.com", [
      {
        subject: "google-b",
        token: "1//b",
        ads: [
          {
            customerId: "9999999999",
            descriptiveName: "B only",
            currencyCode: null,
            timeZone: null,
            status: "ENABLED",
            manager: false,
            directlyAccessible: true,
            loginCustomerId: null,
            accessibleManagerIds: [],
            level: 0,
            parentCustomerId: null,
          },
        ],
      },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: a.operator.operatorId, sessionId: "sa" }, async () => {
      await expect(resolveAdsAccessContext("9999999999")).rejects.toThrow(/not accessible/i);
    });
  });

  it("Test 7 — MCC client selects login-customer-id", async () => {
    const { operator } = await seedOperator(store, "a@example.com", [
      {
        subject: "google-x",
        token: "1//x",
        ads: [
          {
            customerId: "5555555555",
            descriptiveName: "Client",
            currencyCode: null,
            timeZone: null,
            status: "ENABLED",
            manager: false,
            directlyAccessible: false,
            loginCustomerId: "1111111111",
            accessibleManagerIds: ["1111111111"],
            level: 1,
            parentCustomerId: "1111111111",
          },
        ],
      },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      const resolved = await resolveAdsAccessContext("5555555555");
      expect(resolved.loginCustomerId).toBe("1111111111");
      expect(resolved.directlyAccessible).toBe(false);
    });
  });

  it("Test 8 — direct access omits login-customer-id", async () => {
    const { operator } = await seedOperator(store, "a@example.com", [
      {
        subject: "google-x",
        token: "1//x",
        ads: [
          {
            customerId: "6666666666",
            descriptiveName: "Direct",
            currencyCode: null,
            timeZone: null,
            status: "ENABLED",
            manager: false,
            directlyAccessible: true,
            loginCustomerId: null,
            accessibleManagerIds: [],
            level: 0,
            parentCustomerId: null,
          },
        ],
      },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      const resolved = await resolveAdsAccessContext("6666666666");
      expect(resolved.loginCustomerId).toBeNull();
      expect(resolved.directlyAccessible).toBe(true);
    });
  });

  it("Test 9 — expired access token refreshes the owning connection", async () => {
    const { operator } = await seedOperator(store, "a@example.com", [
      { subject: "google-a", token: "1//a", properties: [{ account: "100", propertyId: "1001", name: "A1" }] },
      { subject: "google-b", token: "1//b", properties: [{ account: "200", propertyId: "2001", name: "B1" }] },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      await resolveAuthorizedProperty("2001");
      await resolveAuthorizedProperty("2001");
    });
    expect(clientsSeen.every((item) => item === "google-b:1//b")).toBe(true);
  });

  it("Test 10 — revoked connection fails cleanly", async () => {
    const { operator, connections } = await seedOperator(store, "a@example.com", [
      { subject: "google-a", token: "1//a", properties: [{ account: "100", propertyId: "1001", name: "A1" }] },
      { subject: "google-b", token: "1//b", properties: [{ account: "200", propertyId: "2001", name: "B1" }] },
    ]);
    await store.markConnectionStatus(connections[1]!.connectionId, "reauthorization_required");
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      expect((await resolveAuthorizedProperty("1001")).connection.googleSubjectId).toBe("google-a");
      await expect(resolveAuthorizedProperty("2001")).rejects.toThrow(/requires reauthorization/);
    });
  });

  it("Test 11 — same Ads customer in multiple hierarchies is deterministic", async () => {
    const { operator, connections } = await seedOperator(store, "a@example.com", [
      {
        subject: "google-x",
        token: "1//x",
        ads: [
          {
            customerId: "7777777777",
            descriptiveName: "Shared via MCC A",
            currencyCode: null,
            timeZone: null,
            status: "ENABLED",
            manager: false,
            directlyAccessible: false,
            loginCustomerId: "8888888888",
            accessibleManagerIds: ["8888888888"],
            level: 2,
            parentCustomerId: "8888888888",
          },
        ],
      },
      {
        subject: "google-y",
        token: "1//y",
        ads: [
          {
            customerId: "7777777777",
            descriptiveName: "Shared via MCC B",
            currencyCode: null,
            timeZone: null,
            status: "ENABLED",
            manager: false,
            directlyAccessible: false,
            loginCustomerId: "9999999999",
            accessibleManagerIds: ["9999999999"],
            level: 1,
            parentCustomerId: "9999999999",
          },
        ],
      },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      const first = await resolveAdsAccessContext("7777777777");
      const second = await resolveAdsAccessContext("7777777777");
      expect(first.connectionId).toBe(second.connectionId);
      expect(first.loginCustomerId).toBe("9999999999");
      expect(first.connectionId).toBe(connections[1]?.connectionId);
    });
  });

  it("Test 12 — hyphenated customer IDs are normalized", async () => {
    const { operator } = await seedOperator(store, "a@example.com", [
      {
        subject: "google-x",
        token: "1//x",
        ads: [
          {
            customerId: "1234567890",
            descriptiveName: "Direct",
            currencyCode: null,
            timeZone: null,
            status: "ENABLED",
            manager: false,
            directlyAccessible: true,
            loginCustomerId: null,
            accessibleManagerIds: [],
            level: 0,
            parentCustomerId: null,
          },
        ],
      },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      const resolved = await resolveAdsAccessContext("123-456-7890");
      expect(resolved.customerId).toBe("1234567890");
    });
  });

  it("disconnecting one connection does not leak tokens", async () => {
    const { operator, connections } = await seedOperator(store, "a@example.com", [
      { subject: "google-a", token: "1//a", properties: [{ account: "100", propertyId: "1001", name: "A1" }] },
    ]);
    const disconnected = await store.disconnectConnection(operator.operatorId, connections[0]!.connectionId);
    expect(disconnected.refreshTokenEncrypted).toBeNull();
    expect(publicConnectionView(disconnected)).not.toHaveProperty("refreshTokenEncrypted");
    await expect(assertConnectionOwned(operator.operatorId, connections[0]!.connectionId)).resolves.toBeTruthy();
  });
});

function dv360Seed(partnerId: string, advertiserId: string, name: string) {
  return {
    partners: [
      {
        partnerId,
        displayName: `${name} partner`,
        entityStatus: "ENTITY_STATUS_ACTIVE",
        currencyCode: "USD",
        timeZone: "America/New_York",
      },
    ],
    advertisers: [
      {
        partnerId,
        advertiserId,
        displayName: `${name} advertiser`,
        entityStatus: "ENTITY_STATUS_ACTIVE",
        currencyCode: "USD",
        timeZone: "America/New_York",
      },
    ],
  };
}

describe("True Model B + DV360 routing", () => {
  let store: AppStore;

  beforeEach(() => {
    setRequiredEnv();
    clientsSeen.length = 0;
    store = createMemoryAppStore();
    setAppStore(store);
  });

  it("Operator A / Google X uses X credential for advertiser X", async () => {
    const { operator } = await seedOperator(store, "a@example.com", [
      {
        subject: "google-x",
        token: "1//x",
        scopes: [DV360_SCOPE],
        dv360: dv360Seed("11", "101", "X"),
      },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      const resolved = await resolveDv360AdvertiserAccess("101");
      expect(resolved.connection.googleSubjectId).toBe("google-x");
      expect(resolved.advertiserId).toBe("101");
      expect(resolved.partnerId).toBe("11");
    });
    expect(clientsSeen).toEqual(["google-x:1//x"]);
  });

  it("Operator A / Google Y uses Y not X", async () => {
    const { operator } = await seedOperator(store, "a@example.com", [
      {
        subject: "google-x",
        token: "1//x",
        scopes: [DV360_SCOPE],
        dv360: dv360Seed("11", "101", "X"),
      },
      {
        subject: "google-y",
        token: "1//y",
        scopes: [DV360_SCOPE],
        dv360: dv360Seed("22", "202", "Y"),
      },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      const resolved = await resolveDv360AdvertiserAccess("202");
      expect(resolved.connection.googleSubjectId).toBe("google-y");
    });
    expect(clientsSeen).toEqual(["google-y:1//y"]);
  });

  it("same Google identity on two operators stays independent", async () => {
    const a = await seedOperator(store, "op-a@example.com", [
      {
        subject: "google-x",
        token: "1//ax",
        scopes: [DV360_SCOPE],
        dv360: dv360Seed("11", "101", "Shared"),
      },
    ]);
    const b = await seedOperator(store, "op-b@example.com", [
      {
        subject: "google-x",
        token: "1//bx",
        scopes: [DV360_SCOPE],
        dv360: dv360Seed("11", "101", "Shared"),
      },
    ]);
    expect(a.connections[0]?.connectionId).not.toBe(b.connections[0]?.connectionId);
    await runWithOperator({ requestId: "r1", operatorId: a.operator.operatorId, sessionId: "sa" }, async () => {
      await resolveDv360AdvertiserAccess("101");
    });
    await runWithOperator({ requestId: "r2", operatorId: b.operator.operatorId, sessionId: "sb" }, async () => {
      await resolveDv360AdvertiserAccess("101");
    });
    expect(clientsSeen).toEqual(["google-x:1//ax", "google-x:1//bx"]);
  });

  it("Operator A cannot access Operator B advertiser", async () => {
    const a = await seedOperator(store, "op-a@example.com", [
      {
        subject: "google-a",
        token: "1//a",
        scopes: [DV360_SCOPE],
        dv360: dv360Seed("11", "101", "A"),
      },
    ]);
    await seedOperator(store, "op-b@example.com", [
      {
        subject: "google-b",
        token: "1//b",
        scopes: [DV360_SCOPE],
        dv360: dv360Seed("99", "909", "B"),
      },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: a.operator.operatorId, sessionId: "sa" }, async () => {
      await expect(resolveDv360AdvertiserAccess("909")).rejects.toThrow(/not accessible/i);
      await expect(resolveDv360PartnerAccess("99")).rejects.toThrow(/not accessible/i);
    });
  });

  it("missing DV360 scope requires reauthorization on that connection", async () => {
    const { operator } = await seedOperator(store, "a@example.com", [
      {
        subject: "google-x",
        token: "1//x",
        scopes: [],
        dv360: dv360Seed("11", "101", "X"),
      },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      await expect(resolveDv360AdvertiserAccess("101")).rejects.toThrow(/not authorized for DV360/i);
    });
  });

  it("present DV360 scope uses the owning connection token", async () => {
    const { operator } = await seedOperator(store, "a@example.com", [
      {
        subject: "google-x",
        token: "1//x",
        scopes: [DV360_SCOPE],
        dv360: dv360Seed("11", "101", "X"),
      },
    ]);
    await runWithOperator({ requestId: "r1", operatorId: operator.operatorId, sessionId: "s1" }, async () => {
      const resolved = await resolveDv360PartnerAccess("11");
      expect(resolved.connectionId).toBeTruthy();
      expect(resolved.partnerId).toBe("11");
    });
    expect(clientsSeen).toEqual(["google-x:1//x"]);
  });
});
