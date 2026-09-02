import { describe, expect, it } from "vitest";
import {
  parsePresenceEnvelope,
  serializePresenceEnvelope,
} from "@/presence-core/src/presence-envelope";

describe("presence envelope", () => {
  it("round-trips presence, chat, and typing envelopes", () => {
    const presence = { v: 1, kind: "presence", status: "away" } as const;
    const chat = { v: 1, kind: "chat", id: "alice:1", body: "hi", ts: 123 } as const;
    const typing = { v: 1, kind: "typing" } as const;

    expect(parsePresenceEnvelope(serializePresenceEnvelope(presence))).toEqual(presence);
    expect(parsePresenceEnvelope(serializePresenceEnvelope(chat))).toEqual(chat);
    expect(parsePresenceEnvelope(serializePresenceEnvelope(typing))).toEqual(typing);
  });

  it("rejects malformed payloads", () => {
    expect(parsePresenceEnvelope("not json")).toBeNull();
    expect(parsePresenceEnvelope("42")).toBeNull();
    expect(parsePresenceEnvelope(JSON.stringify({ v: 2, kind: "typing" }))).toBeNull();
    expect(parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "unknown" }))).toBeNull();
    expect(
      parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "presence", status: "busy" })),
    ).toBeNull();
    expect(
      parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "chat", id: "", body: "hi", ts: 1 })),
    ).toBeNull();
    expect(
      parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "chat", id: "x", body: "  ", ts: 1 })),
    ).toBeNull();
    expect(
      parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "chat", id: "x", body: "hi", ts: "1" })),
    ).toBeNull();
  });

  it("caps oversized chat bodies", () => {
    const parsed = parsePresenceEnvelope(
      JSON.stringify({ v: 1, kind: "chat", id: "x", body: "a".repeat(5000), ts: 1 }),
    );
    expect(parsed).not.toBeNull();
    if (parsed?.kind === "chat") {
      expect(parsed.body).toHaveLength(4000);
    }
  });
});
