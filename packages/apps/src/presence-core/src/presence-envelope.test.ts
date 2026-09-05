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

  it("round-trips channel-scoped typing envelopes", () => {
    const channelTyping = { v: 1, kind: "typing", channel: "channel-general" } as const;
    const channelStop = { v: 1, kind: "typing", channel: "channel-general", stop: true } as const;

    expect(parsePresenceEnvelope(serializePresenceEnvelope(channelTyping))).toEqual(channelTyping);
    expect(parsePresenceEnvelope(serializePresenceEnvelope(channelStop))).toEqual(channelStop);
  });

  it("rejects invalid channel typing payloads and drops non-true stop flags", () => {
    expect(parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "typing", channel: "" }))).toBeNull();
    expect(parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "typing", channel: 7 }))).toBeNull();
    expect(
      parsePresenceEnvelope(JSON.stringify({ v: 1, kind: "typing", channel: "c1", stop: "yes" })),
    ).toEqual({ v: 1, kind: "typing", channel: "c1" });
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
