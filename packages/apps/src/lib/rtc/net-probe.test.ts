import { afterEach, describe, expect, it } from "vitest";

import {
  classifyCandidates,
  getNetClass,
  peekNetClass,
  probeNetClass,
  resetNetClass,
} from "./net-probe";

const STUN_URLS = ["stun:stun.one.example:443", "stun:stun.two.example:3478"] as const;

interface ScriptedCandidate {
  candidate: string;
  url: string | null;
}

/**
 * Enough of RTCPeerConnection for the probe: it emits the scripted candidates
 * once a local description is set, then the end-of-gathering null.
 */
function fakeConnection(candidates: ScriptedCandidate[], { endGathering = true } = {}) {
  let closed = false;
  const connection = {
    onicecandidate: null as ((event: { candidate: ScriptedCandidate | null }) => void) | null,
    createDataChannel: () => undefined,
    createOffer: async () => ({ type: "offer", sdp: "" }),
    setLocalDescription: async () => {
      for (const candidate of candidates) {
        connection.onicecandidate?.({ candidate });
      }
      if (endGathering) connection.onicecandidate?.({ candidate: null });
    },
    close: () => {
      closed = true;
    },
    get closed() {
      return closed;
    },
  };
  return connection;
}

function srflx(address: string, port: number, url: string): ScriptedCandidate {
  return {
    candidate: `candidate:1 1 udp 1686052607 ${address} ${port} typ srflx raddr 10.0.0.2 rport 54321`,
    url,
  };
}

function hostCandidate(address: string): ScriptedCandidate {
  return {
    candidate: `candidate:2 1 udp 2130706431 ${address} 49152 typ host`,
    url: null,
  };
}

function probe(candidates: ScriptedCandidate[], options: { endGathering?: boolean } = {}) {
  return probeNetClass({
    stunUrls: STUN_URLS,
    timeoutMs: 20,
    createConnection: () => fakeConnection(candidates, options) as unknown as RTCPeerConnection,
  });
}

afterEach(() => {
  resetNetClass();
});

describe("classifyCandidates", () => {
  it("calls one mapped port across both hosts open", () => {
    expect(
      classifyCandidates(
        [
          { host: "a", port: 40000 },
          { host: "b", port: 40000 },
        ],
        false,
        2,
      ),
    ).toBe("open");
  });

  it("calls a per-destination mapping symmetric", () => {
    expect(
      classifyCandidates(
        [
          { host: "a", port: 40000 },
          { host: "b", port: 40001 },
        ],
        false,
        2,
      ),
    ).toBe("symmetric");
  });

  it("cannot classify a single host, because one host shows no difference", () => {
    expect(classifyCandidates([{ host: "a", port: 40000 }], false, 2)).toBe("unknown");
  });
});

describe("probeNetClass", () => {
  it("classifies an open NAT when both hosts report the same port", async () => {
    await expect(
      probe([
        srflx("203.0.113.5", 40000, "stun:stun.one.example:443"),
        srflx("203.0.113.5", 40000, "stun:stun.two.example:3478"),
      ]),
    ).resolves.toBe("open");
  });

  it("classifies a symmetric NAT when the mapped port differs per host", async () => {
    await expect(
      probe([
        srflx("203.0.113.5", 40000, "stun:stun.one.example:443"),
        srflx("203.0.113.5", 40001, "stun:stun.two.example:3478"),
      ]),
    ).resolves.toBe("symmetric");
  });

  it("reports udp-blocked when no server reflexive candidate comes back", async () => {
    await expect(probe([hostCandidate("192.168.1.10")])).resolves.toBe("udp-blocked");
  });

  it("treats a public IPv6 host candidate as open even without STUN answers", async () => {
    await expect(probe([hostCandidate("2001:db8::1")])).resolves.toBe("open");
  });

  it("ignores link-local and unique-local IPv6, which are not reachable", async () => {
    await expect(probe([hostCandidate("fe80::1"), hostCandidate("fd00::1")])).resolves.toBe(
      "udp-blocked",
    );
  });

  it("falls back to the evidence it has when gathering never ends", async () => {
    await expect(
      probe([srflx("203.0.113.5", 40000, "stun:stun.one.example:443")], { endGathering: false }),
    ).resolves.toBe("unknown");
  });

  it("is unknown when fewer than two STUN hosts are configured", async () => {
    await expect(
      probeNetClass({
        stunUrls: ["stun:stun.one.example:443"],
        timeoutMs: 20,
        createConnection: () => fakeConnection([]) as unknown as RTCPeerConnection,
      }),
    ).resolves.toBe("unknown");
  });

  it("closes the throwaway connection", async () => {
    const connection = fakeConnection([hostCandidate("192.168.1.10")]);
    await probeNetClass({
      stunUrls: STUN_URLS,
      timeoutMs: 20,
      createConnection: () => connection as unknown as RTCPeerConnection,
    });
    expect(connection.closed).toBe(true);
  });
});

describe("getNetClass", () => {
  it("probes once per session and serves the cache afterwards", async () => {
    let built = 0;
    const options = {
      stunUrls: STUN_URLS,
      timeoutMs: 20,
      createConnection: () => {
        built += 1;
        return fakeConnection([
          srflx("203.0.113.5", 40000, "stun:stun.one.example:443"),
          srflx("203.0.113.5", 40000, "stun:stun.two.example:3478"),
        ]) as unknown as RTCPeerConnection;
      },
    };

    await expect(getNetClass(options)).resolves.toBe("open");
    await expect(getNetClass(options)).resolves.toBe("open");
    expect(built).toBe(1);
    expect(peekNetClass()).toBe("open");
  });

  it("shares one in-flight probe between concurrent callers", async () => {
    let built = 0;
    const options = {
      stunUrls: STUN_URLS,
      timeoutMs: 20,
      createConnection: () => {
        built += 1;
        return fakeConnection([hostCandidate("192.168.1.10")]) as unknown as RTCPeerConnection;
      },
    };

    const [first, second] = await Promise.all([getNetClass(options), getNetClass(options)]);
    expect(first).toBe("udp-blocked");
    expect(second).toBe("udp-blocked");
    expect(built).toBe(1);
  });

  it("re-probes after a reset, which is what a network change triggers", async () => {
    let built = 0;
    const options = {
      stunUrls: STUN_URLS,
      timeoutMs: 20,
      createConnection: () => {
        built += 1;
        return fakeConnection([hostCandidate("192.168.1.10")]) as unknown as RTCPeerConnection;
      },
    };

    await getNetClass(options);
    resetNetClass();
    expect(peekNetClass()).toBeNull();
    await getNetClass(options);
    expect(built).toBe(2);
  });
});
