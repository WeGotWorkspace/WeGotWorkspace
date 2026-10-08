import { describe, expect, it } from "vitest";
import {
  httpFallbackPeers,
  httpFallbackUsesStar,
  relayDuePeers,
  type HttpFallbackPeer,
} from "./docs-collab-http-fallback";

function peer(partial: Partial<HttpFallbackPeer> & Pick<HttpFallbackPeer, "id">): HttpFallbackPeer {
  return {
    name: partial.id,
    caps: ["yjs-http", "relay-jit"],
    connected: false,
    seenAt: 0,
    ...partial,
  };
}

describe("http fallback timing", () => {
  it("waits five seconds before sending, and eight before a relay request", () => {
    const peers = [peer({ id: "aa" })];
    expect(httpFallbackPeers(peers, 4_999, false)).toEqual([]);
    expect(httpFallbackPeers(peers, 5_000, false).map((item) => item.id)).toEqual(["aa"]);
    expect(relayDuePeers(peers, 7_999, false, new Set())).toEqual([]);
    expect(relayDuePeers(peers, 8_000, false, new Set()).map((item) => item.id)).toEqual(["aa"]);
  });

  it("starts both immediately when WebRTC is already unavailable", () => {
    const peers = [peer({ id: "aa" })];
    expect(httpFallbackPeers(peers, 0, true)).toHaveLength(1);
    expect(relayDuePeers(peers, 0, true, new Set())).toHaveLength(1);
  });

  it("skips peers that lack the capability or already have a channel", () => {
    const peers = [
      peer({ id: "open", connected: true }),
      peer({ id: "plain", caps: ["bin"] }),
      peer({ id: "http", caps: ["yjs-http"] }),
    ];
    expect(httpFallbackPeers(peers, 9_000, false).map((item) => item.id)).toEqual(["http"]);
    expect(relayDuePeers(peers, 9_000, false, new Set(["http"]))).toEqual([]);
  });

  it("uses a star target only when every offline peer can take it", () => {
    const ready = [peer({ id: "a" }), peer({ id: "b", connected: true })];
    const http = httpFallbackPeers(ready, 9_000, false);
    expect(httpFallbackUsesStar(ready, http)).toBe(true);

    const mixed = [peer({ id: "a" }), peer({ id: "b", caps: ["bin"] })];
    expect(httpFallbackUsesStar(mixed, httpFallbackPeers(mixed, 9_000, false))).toBe(false);
  });
});
