import { describe, expect, it } from "vitest";
import {
  PEER_FAILURE_WARNING_DELAY_MS,
  collectCollabWarningPeers,
  isCollabWarningLink,
} from "@/text-editor-core/docs-collab/docs-collab-mesh-warnings";

describe("collectCollabWarningPeers", () => {
  it("does not warn for a reuse-to-ICE fallback that is still connecting", () => {
    const statuses = [{ id: "bbbbbbbbbbbbbbbb", name: "Wouter", link: "connecting" as const }];
    expect(isCollabWarningLink("connecting")).toBe(false);
    expect(collectCollabWarningPeers(statuses, new Map(), 10_000)).toEqual([]);
    expect(collectCollabWarningPeers(statuses, new Map([["bbbbbbbbbbbbbbbb", 0]]), 10_000)).toEqual(
      [],
    );
  });

  it("does not warn for a connected peer", () => {
    expect(
      collectCollabWarningPeers(
        [{ id: "bbbbbbbbbbbbbbbb", name: "Wouter", link: "connected" }],
        new Map(),
        10_000,
      ),
    ).toEqual([]);
  });

  it("warns only after a hard failure lasts the delay", () => {
    const statuses = [{ id: "bbbbbbbbbbbbbbbb", name: "Wouter", link: "failed" as const }];
    const failedSince = new Map([["bbbbbbbbbbbbbbbb", 1000]]);
    expect(isCollabWarningLink("failed")).toBe(true);
    expect(collectCollabWarningPeers(statuses, failedSince, 1000 + 1000)).toEqual([]);
    expect(
      collectCollabWarningPeers(statuses, failedSince, 1000 + PEER_FAILURE_WARNING_DELAY_MS),
    ).toEqual([{ id: "bbbbbbbbbbbbbbbb", name: "Wouter" }]);
  });
});
