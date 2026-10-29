import { describe, expect, it } from "vitest";
import { encodePushEventId, parsePushEventId } from "./push-event-id";

const H1 = "0123456789abcdef0123456789abcdef";
const H2 = "fedcba9876543210fedcba9876543210";

describe("parsePushEventId", () => {
  it("reads the per-type hashes of a v1 id", () => {
    expect(parsePushEventId(`v1;Note=${H1};FileNode=${H2}`)).toEqual({ Note: H1, FileNode: H2 });
  });

  it("reads an id with no types", () => {
    expect(parsePushEventId("v1")).toEqual({});
  });

  it.each([
    null,
    "",
    "v2;Note=" + H1,
    `v1;Note=${H1.slice(1)}`,
    `v1;Note=${H1.toUpperCase()}`,
    `v1;No-te=${H1}`,
    `v1;Note=${H1};Note=${H2}`,
    `v1;Note`,
  ])("rejects a malformed id %s", (id) => {
    expect(parsePushEventId(id)).toBeNull();
  });
});

describe("encodePushEventId", () => {
  it("writes types in a stable order", () => {
    expect(encodePushEventId({ Note: H1, FileNode: H2 })).toBe(`v1;FileNode=${H2};Note=${H1}`);
  });

  it("returns null when no type is confirmed", () => {
    expect(encodePushEventId({})).toBeNull();
  });

  it("round-trips", () => {
    const hashes = { Calendar: H1, Notification: H2 };
    expect(parsePushEventId(encodePushEventId(hashes))).toEqual(hashes);
  });
});
