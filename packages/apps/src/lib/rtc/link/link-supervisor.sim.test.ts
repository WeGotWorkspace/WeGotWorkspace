import { describe, expect, it } from "vitest";
import { LinkSupervisor } from "@/lib/rtc/link/link-supervisor-runtime";
import type { LinkObservation } from "@/lib/rtc/link/link-supervisor";

/** Standard 32-bit mulberry32 PRNG. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type PcState = "connecting" | "open" | "failed";
type Pc = { session: number; state: PcState };

type SideId = "L" | "H";

type Queued = { at: number; seq: number; fn: () => void; handle: number };

function runSeed(seed: number): {
  ok: boolean;
  reason?: string;
  dialTimes: number[];
  eventLog: string[];
} {
  const rand = mulberry32(seed);
  const eventLog: string[] = [];
  const dialTimes: number[] = [];
  let now = 0;
  let seq = 0;
  let nextHandle = 1;
  const queue: Queued[] = [];
  const handleIndex = new Map<number, Queued>();

  const schedule = (delayMs: number, fn: () => void): number => {
    const handle = nextHandle++;
    const item: Queued = { at: now + delayMs, seq: seq++, fn, handle };
    queue.push(item);
    handleIndex.set(handle, item);
    return handle;
  };
  const clear = (handle: unknown): void => {
    const item = handleIndex.get(handle as number);
    if (!item) return;
    handleIndex.delete(handle as number);
    const index = queue.indexOf(item);
    if (index >= 0) queue.splice(index, 1);
  };

  let p2p = true;
  const online = { L: true, H: true };
  let sessionCounter = 0;

  type Side = {
    id: SideId;
    peerId: string;
    pc: Pc | null;
    supervisor: LinkSupervisor;
    dialCount: number;
    hintCount: number;
  };

  const sides: Record<SideId, Side> = {
    L: {
      id: "L",
      peerId: "aaaa1111",
      pc: null,
      dialCount: 0,
      hintCount: 0,
      supervisor: null as unknown as LinkSupervisor,
    },
    H: {
      id: "H",
      peerId: "bbbb2222",
      pc: null,
      dialCount: 0,
      hintCount: 0,
      supervisor: null as unknown as LinkSupervisor,
    },
  };

  const otherOf = (side: Side): Side => (side.id === "L" ? sides.H : sides.L);

  const observe = (side: Side): void => {
    const obs: LinkObservation =
      side.pc === null
        ? "absent"
        : side.pc.state === "connecting"
          ? "connecting"
          : side.pc.state === "open"
            ? "open"
            : "failed";
    side.supervisor.observe(otherOf(side).peerId, obs);
  };

  const httpSend = (from: Side, to: Side, fn: () => void): void => {
    if (!online[from.id] || !online[to.id]) return;
    schedule(400 + rand() * 4600, fn);
  };

  const deliverAnswer = (session: number, atX: Side): void => {
    if (atX.pc?.session !== session || atX.pc.state !== "connecting") return;
    schedule(300 + rand() * 1700, () => {
      const y = otherOf(atX);
      if (
        p2p &&
        atX.pc?.session === session &&
        atX.pc.state === "connecting" &&
        y.pc?.session === session &&
        y.pc.state === "connecting"
      ) {
        atX.pc.state = "open";
        y.pc.state = "open";
        observe(atX);
        observe(y);
        eventLog.push(`${now}:open:${session}`);
        return;
      }
      if (!p2p) {
        schedule(15_000, () => {
          if (atX.pc?.session !== session || atX.pc.state !== "connecting") return;
          if (y.pc?.session !== session || y.pc.state !== "connecting") return;
          if (p2p) {
            atX.pc.state = "open";
            y.pc.state = "open";
            observe(atX);
            observe(y);
            eventLog.push(`${now}:open-late:${session}`);
          } else {
            atX.pc.state = "failed";
            y.pc.state = "failed";
            observe(atX);
            observe(y);
            eventLog.push(`${now}:failed:${session}`);
          }
        });
      }
    });
  };

  const deliverOffer = (session: number, atY: Side): void => {
    if (atY.pc) {
      atY.pc = null;
      observe(atY);
    }
    atY.pc = { session, state: "connecting" };
    observe(atY);
    httpSend(atY, otherOf(atY), () => deliverAnswer(session, otherOf(atY)));
  };

  const dialPort = (side: Side, _peerId: string): void => {
    if (side.id !== "L") {
      throw new Error(`H dialed ${_peerId}`);
    }
    side.dialCount += 1;
    dialTimes.push(now);
    eventLog.push(`${now}:dial`);
    sessionCounter += 1;
    const session = sessionCounter;
    side.pc = { session, state: "connecting" };
    observe(side);
    httpSend(side, otherOf(side), () => deliverOffer(session, otherOf(side)));
  };

  const makeSupervisor = (side: Side): LinkSupervisor =>
    new LinkSupervisor({
      now: () => now,
      setTimeout: (fn, ms) => schedule(ms, fn),
      clearTimeout: clear,
      isInitiator: (remote) => side.peerId < remote,
      dial: (peerId) => dialPort(side, peerId),
      sendHint: (peerId, hint) => {
        if (side.id !== "H") {
          throw new Error(`L sent hint to ${peerId}`);
        }
        side.hintCount += 1;
        eventLog.push(`${now}:hint:${hint.since}`);
        httpSend(side, otherOf(side), () => otherOf(side).supervisor.hint(side.peerId));
      },
      log: () => undefined,
    });

  sides.L.supervisor = makeSupervisor(sides.L);
  sides.H.supervisor = makeSupervisor(sides.H);

  sides.L.supervisor.roster([sides.H.peerId]);
  sides.H.supervisor.roster([sides.L.peerId]);
  // Model the mesh's own first dial at t=0.
  dialPort(sides.L, sides.H.peerId);

  let lastFaultEnd = 0;
  const faultCount = Math.floor(rand() * 6);
  for (let i = 0; i < faultCount; i += 1) {
    const t = rand() * 20 * 60_000;
    const kind = Math.floor(rand() * 4);
    if (kind === 0) {
      // F1 p2p outage
      const duration = 5_000 + rand() * 115_000;
      schedule(t, () => {
        p2p = false;
        eventLog.push(`${now}:F1-start`);
        for (const side of [sides.L, sides.H]) {
          if (side.pc?.state === "open") {
            const captured = side.pc.session;
            schedule(1_000 + rand() * 29_000, () => {
              if (side.pc?.session === captured) {
                side.pc.state = "failed";
                observe(side);
              }
            });
          }
        }
        schedule(duration, () => {
          p2p = true;
          eventLog.push(`${now}:F1-end`);
        });
      });
      lastFaultEnd = Math.max(lastFaultEnd, t + duration);
    } else if (kind === 1) {
      // F2 HTTP outage
      const which: SideId = rand() < 0.5 ? "L" : "H";
      const duration = 5_000 + rand() * 55_000;
      schedule(t, () => {
        online[which] = false;
        eventLog.push(`${now}:F2-start:${which}`);
        schedule(duration, () => {
          online[which] = true;
          eventLog.push(`${now}:F2-end:${which}`);
        });
      });
      lastFaultEnd = Math.max(lastFaultEnd, t + duration);
    } else if (kind === 2) {
      // F3 silent close
      schedule(t, () => {
        const candidates = [sides.L, sides.H].filter((side) => side.pc?.state === "open");
        if (candidates.length === 0) return;
        const side = candidates[Math.floor(rand() * candidates.length)]!;
        const other = otherOf(side);
        side.pc = null;
        observe(side);
        eventLog.push(`${now}:F3:${side.id}`);
        if (other.pc) {
          const captured = other.pc.session;
          schedule(1_000 + rand() * 29_000, () => {
            if (other.pc?.session === captured) {
              other.pc.state = "failed";
              observe(other);
            }
          });
        }
      });
      lastFaultEnd = Math.max(lastFaultEnd, t + 30_000);
    } else {
      // F4 network change
      schedule(t, () => {
        const side = rand() < 0.5 ? sides.L : sides.H;
        side.supervisor.networkChange();
        eventLog.push(`${now}:F4:${side.id}`);
      });
      lastFaultEnd = Math.max(lastFaultEnd, t);
    }
  }

  const endAt = Math.max(lastFaultEnd + 180_000, 200_000);
  while (queue.length > 0) {
    queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const next = queue.shift()!;
    if (next.at > endAt) break;
    handleIndex.delete(next.handle);
    now = next.at;
    try {
      next.fn();
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
        dialTimes,
        eventLog,
      };
    }
  }

  // P3 roles
  if (sides.H.dialCount > 0) {
    return { ok: false, reason: "H dialed", dialTimes, eventLog };
  }
  if (sides.L.hintCount > 0) {
    return { ok: false, reason: "L sent hint", dialTimes, eventLog };
  }

  // P1 liveness
  const lPc = sides.L.pc;
  const hPc = sides.H.pc;
  if (
    !lPc ||
    !hPc ||
    lPc.state !== "open" ||
    hPc.state !== "open" ||
    lPc.session !== hPc.session ||
    sides.L.supervisor.phase(sides.H.peerId) !== "up" ||
    sides.H.supervisor.phase(sides.L.peerId) !== "up"
  ) {
    return {
      ok: false,
      reason: `liveness fail L=${JSON.stringify(lPc)} H=${JSON.stringify(hPc)} phases=${sides.L.supervisor.phase(sides.H.peerId)}/${sides.H.supervisor.phase(sides.L.peerId)}`,
      dialTimes,
      eventLog,
    };
  }

  // P2 dial rate: at most 10 dials in any 60 s window on L
  const times = dialTimes.slice().sort((a, b) => a - b);
  for (let i = 0; i < times.length; i += 1) {
    let count = 0;
    for (let j = i; j < times.length && times[j]! - times[i]! <= 60_000; j += 1) count += 1;
    if (count > 10) {
      return { ok: false, reason: `dial rate ${count} in 60s at ${times[i]}`, dialTimes, eventLog };
    }
  }

  return { ok: true, dialTimes, eventLog };
}

describe("link supervisor two-browser simulation", () => {
  it.each(Array.from({ length: 200 }, (_, i) => i + 1))("seed %s recovers with P1–P3", (seed) => {
    const result = runSeed(seed);
    if (!result.ok) {
      console.error(`seed ${seed} failed: ${result.reason}\n${result.eventLog.join("\n")}`);
    }
    expect(result.ok, `seed ${seed}: ${result.reason}`).toBe(true);
  });
});
