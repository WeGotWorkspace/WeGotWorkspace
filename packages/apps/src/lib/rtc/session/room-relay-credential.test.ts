import { describe, expect, it, vi } from "vitest";
import { RoomRelayCredential, type IssuedTurn } from "@/lib/rtc/session/room-relay-credential";
import type { TurnCredentials } from "@/lib/rtc/types";

function turn(credential: string, ttl = 3600): TurnCredentials {
  return { urls: ["turn:turn.example:3478"], username: "user", credential, ttl };
}

describe("RoomRelayCredential", () => {
  it("shares one POST between asks that arrive while it is in flight", async () => {
    const room = new RoomRelayCredential({ now: () => 0 });
    let resolve: (value: { turn: TurnCredentials }) => void = () => undefined;
    const post = vi.fn(() => new Promise<{ turn: TurnCredentials }>((done) => (resolve = done)));
    const first = room.request(post);
    const second = room.request(post);
    resolve({ turn: turn("cred-1") });
    await expect(first).resolves.toEqual({ turn: turn("cred-1") });
    await expect(second).resolves.toEqual({ turn: turn("cred-1") });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("reuses a live credential with the ttl that is left", async () => {
    let now = 0;
    const room = new RoomRelayCredential({ now: () => now });
    const post = vi.fn(async () => ({ turn: turn("cred-1") }));
    await room.request(post);
    now = 600_000;
    await expect(room.request(post)).resolves.toEqual({ turn: turn("cred-1", 3000) });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("mints again once the credential is inside its refresh window", async () => {
    let now = 0;
    const room = new RoomRelayCredential({ now: () => now });
    const post = vi
      .fn()
      .mockResolvedValueOnce({ turn: turn("cred-1") })
      .mockResolvedValueOnce({ turn: turn("cred-2") });
    await room.request(post);
    now = 3_540_000;
    await expect(room.request(post)).resolves.toEqual({ turn: turn("cred-2") });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("reuses the credential the mesh precheck already holds", async () => {
    const shared: IssuedTurn = { turn: turn("precheck"), issuedAtMs: 0 };
    const room = new RoomRelayCredential({ shared: () => shared, now: () => 1_000 });
    const post = vi.fn(async () => ({ turn: turn("cred-1") }));
    await expect(room.request(post)).resolves.toEqual({ turn: turn("precheck", 3599) });
    expect(post).not.toHaveBeenCalled();
  });

  it("does not keep a failure, so the next ask posts again", async () => {
    const room = new RoomRelayCredential({ now: () => 0 });
    const post = vi
      .fn()
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValueOnce({ turn: turn("cred-1") });
    const first = room.request(post);
    const second = room.request(post);
    await expect(first).rejects.toThrow("429");
    await expect(second).rejects.toThrow("429");
    await expect(room.request(post)).resolves.toEqual({ turn: turn("cred-1") });
    expect(post).toHaveBeenCalledTimes(2);
  });
});
