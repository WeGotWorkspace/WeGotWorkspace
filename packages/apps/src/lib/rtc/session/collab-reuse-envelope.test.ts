import { describe, expect, it } from "vitest";
import {
  parseCollabReuseEnvelope,
  serializeCollabReuseEnvelope,
} from "@/lib/rtc/session/collab-reuse-envelope";

describe("collab-reuse envelope", () => {
  it("round-trips open, ack, close, and data envelopes", () => {
    const open = {
      v: 1 as const,
      kind: "collab-reuse" as const,
      room: "/groups/administrators/team-notes.md",
      op: "open" as const,
      collabPeerId: "aaaaaaaaaaaaaaaa",
      name: "Admin",
    };
    const ack = {
      v: 1 as const,
      kind: "collab-reuse" as const,
      room: "/groups/administrators/team-notes.md",
      op: "ack" as const,
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    };
    const close = {
      v: 1 as const,
      kind: "collab-reuse" as const,
      room: "/groups/administrators/team-notes.md",
      op: "close" as const,
      collabPeerId: "aaaaaaaaaaaaaaaa",
    };
    const data = {
      v: 1 as const,
      kind: "collab-reuse" as const,
      room: "/groups/administrators/team-notes.md",
      op: "data" as const,
      collabPeerId: "aaaaaaaaaaaaaaaa",
      payload: { type: "sync", u: [1, 2, 3] },
    };

    expect(parseCollabReuseEnvelope(serializeCollabReuseEnvelope(open))).toEqual(open);
    expect(parseCollabReuseEnvelope(serializeCollabReuseEnvelope(ack))).toEqual(ack);
    expect(parseCollabReuseEnvelope(serializeCollabReuseEnvelope(close))).toEqual(close);
    expect(parseCollabReuseEnvelope(serializeCollabReuseEnvelope(data))).toEqual(data);
  });

  it("rejects malformed payloads and presence envelopes", () => {
    expect(parseCollabReuseEnvelope("not json")).toBeNull();
    expect(parseCollabReuseEnvelope("42")).toBeNull();
    expect(
      parseCollabReuseEnvelope(JSON.stringify({ v: 1, kind: "presence", status: "online" })),
    ).toBeNull();
    expect(
      parseCollabReuseEnvelope(
        JSON.stringify({ v: 2, kind: "collab-reuse", room: "x", op: "open" }),
      ),
    ).toBeNull();
    expect(
      parseCollabReuseEnvelope(
        JSON.stringify({ v: 1, kind: "collab-reuse", room: "", op: "open" }),
      ),
    ).toBeNull();
    expect(
      parseCollabReuseEnvelope(
        JSON.stringify({ v: 1, kind: "collab-reuse", room: "x", op: "nope" }),
      ),
    ).toBeNull();
    expect(
      parseCollabReuseEnvelope(
        JSON.stringify({ v: 1, kind: "collab-reuse", room: "x", op: "data" }),
      ),
    ).toBeNull();
  });
});
