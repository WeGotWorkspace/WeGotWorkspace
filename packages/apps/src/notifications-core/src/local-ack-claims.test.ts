import { describe, expect, it } from "vitest";
import { FakeWebLocks } from "@/lib/jmap-client/push/mock/fake-web-locks";
import { createLocalAckClaims } from "./local-ack-claims";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createLocalAckClaims", () => {
  it("gives one tab the claim on a row; the other skips while it is held", async () => {
    const locks = new FakeWebLocks();
    const a = createLocalAckClaims(locks.client("a"));
    const c = createLocalAckClaims(locks.client("c"));
    const [inA, inC] = await Promise.all([a.claim("n1"), c.claim("n1")]);
    expect([inA, inC]).toEqual([true, false]);
    // Claiming again in the holding tab stays true without a second lock.
    await expect(a.claim("n1")).resolves.toBe(true);
  });

  it("frees the row for another tab once released (ack failed, row read, tab gone)", async () => {
    const locks = new FakeWebLocks();
    const a = createLocalAckClaims(locks.client("a"));
    const c = createLocalAckClaims(locks.client("c"));
    await a.claim("n1");
    a.release("n1");
    await tick();
    await expect(c.claim("n1")).resolves.toBe(true);

    await c.claim("n2");
    c.releaseAll();
    await tick();
    await expect(a.claim("n2")).resolves.toBe(true);
  });

  it("a crashed tab's claims return to the others", async () => {
    const locks = new FakeWebLocks();
    const a = createLocalAckClaims(locks.client("a"));
    const c = createLocalAckClaims(locks.client("c"));
    await a.claim("n1");
    locks.crash("a");
    await expect(c.claim("n1")).resolves.toBe(true);
  });

  it("without Web Locks every claim succeeds (each tab acks, as before)", async () => {
    const claims = createLocalAckClaims(null);
    await expect(claims.claim("n1")).resolves.toBe(true);
    claims.release("n1");
    claims.releaseAll();
  });
});
