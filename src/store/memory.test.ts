import { beforeEach, describe, expect, it } from "vitest";
import { encryptRefreshToken } from "@/lib/crypto";
import { createMemoryAppStore } from "@/store/memory";
import { setRequiredEnv } from "@/test/env";

describe("memory store isolation", () => {
  beforeEach(() => {
    setRequiredEnv();
  });

  it("upserts the same Google identity per operator without duplicates", async () => {
    const store = createMemoryAppStore();
    const operator = await store.createOperator("a@example.com");
    const first = await store.upsertConnection({
      operatorId: operator.operatorId,
      googleSubjectId: "g1",
      encryptedRefreshToken: encryptRefreshToken("1//old"),
    });
    const second = await store.upsertConnection({
      operatorId: operator.operatorId,
      googleSubjectId: "g1",
      encryptedRefreshToken: encryptRefreshToken("1//new"),
    });
    expect(first.connectionId).toBe(second.connectionId);
    expect((await store.listConnections(operator.operatorId)).length).toBe(1);
  });

  it("keeps DV360 partners and advertisers scoped to operator and connection", async () => {
    const store = createMemoryAppStore();
    const operatorA = await store.createOperator("a@example.com");
    const operatorB = await store.createOperator("b@example.com");
    const connectionA = await store.upsertConnection({
      operatorId: operatorA.operatorId,
      googleSubjectId: "g-shared",
      encryptedRefreshToken: encryptRefreshToken("1//a"),
    });
    const connectionB = await store.upsertConnection({
      operatorId: operatorB.operatorId,
      googleSubjectId: "g-shared",
      encryptedRefreshToken: encryptRefreshToken("1//b"),
    });

    await store.replaceDv360Resources(
      operatorA.operatorId,
      connectionA.connectionId,
      [
        {
          partnerId: "11",
          displayName: "A partner",
          entityStatus: "ENTITY_STATUS_ACTIVE",
          currencyCode: "USD",
          timeZone: "UTC",
        },
      ],
      [
        {
          partnerId: "11",
          advertiserId: "101",
          displayName: "A advertiser",
          entityStatus: "ENTITY_STATUS_ACTIVE",
          currencyCode: "USD",
          timeZone: "UTC",
        },
      ],
    );
    await store.replaceDv360Resources(
      operatorB.operatorId,
      connectionB.connectionId,
      [
        {
          partnerId: "11",
          displayName: "B partner",
          entityStatus: "ENTITY_STATUS_ACTIVE",
          currencyCode: "USD",
          timeZone: "UTC",
        },
      ],
      [
        {
          partnerId: "11",
          advertiserId: "101",
          displayName: "B advertiser",
          entityStatus: "ENTITY_STATUS_ACTIVE",
          currencyCode: "USD",
          timeZone: "UTC",
        },
      ],
    );

    const aOnly = await store.findDv360AdvertisersByAdvertiserId(operatorA.operatorId, "101");
    const bOnly = await store.findDv360AdvertisersByAdvertiserId(operatorB.operatorId, "101");
    expect(aOnly).toHaveLength(1);
    expect(bOnly).toHaveLength(1);
    expect(aOnly[0]?.connectionId).toBe(connectionA.connectionId);
    expect(bOnly[0]?.connectionId).toBe(connectionB.connectionId);
    expect(aOnly[0]?.connectionId).not.toBe(bOnly[0]?.connectionId);
  });
});
