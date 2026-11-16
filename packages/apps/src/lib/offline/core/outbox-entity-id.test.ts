import { describe, expect, it } from "vitest";
import { createLocalEntityId, outboxEntityIdReader } from "@/lib/offline/core/outbox-entity-id";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";

function row(payload: string, domain = "demo"): OfflineOutboxRow {
  return { id: "r", domain, op: "update", payload, createdAt: 1 } as OfflineOutboxRow;
}

describe("outboxEntityIdReader", () => {
  const readId = outboxEntityIdReader("demo", ["itemId", "tempItemId", "creationId"]);

  it("answers the first key the payload carries", () => {
    expect(readId(row('{"itemId":"a","tempItemId":"t"}'))).toBe("a");
    expect(readId(row('{"tempItemId":"t","creationId":"c"}'))).toBe("t");
    expect(readId(row('{"creationId":"c"}'))).toBe("c");
  });

  it("keeps an empty id, like the `??` chains it replaces", () => {
    expect(readId(row('{"itemId":"","tempItemId":"t"}'))).toBe("");
  });

  it("answers null for another domain, no key, or a payload it cannot read", () => {
    expect(readId(row('{"itemId":"a"}', "other"))).toBeNull();
    expect(readId(row('{"name":"x"}'))).toBeNull();
    expect(readId(row("{not json"))).toBeNull();
  });
});

describe("createLocalEntityId", () => {
  it("is the prefix plus a UUID without dashes", () => {
    expect(createLocalEntityId()).toMatch(/^local-[0-9a-f]{32}$/);
    expect(createLocalEntityId("local-cal-")).toMatch(/^local-cal-[0-9a-f]{32}$/);
  });
});
