import { afterEach, describe, expect, it } from "vitest";
import { registerMeshCheckNowPort } from "@/lib/jmap-client/push/mesh-check-now";
import { notifiedUsernames, nudgeNotifiedUsers, WGW_NOTIFIED_HEADER } from "./notified-header";

const response = (status: number, header?: string) =>
  new Response(null, {
    status,
    headers: header === undefined ? {} : { [WGW_NOTIFIED_HEADER]: header },
  });

let unregister: (() => void) | null = null;
afterEach(() => {
  unregister?.();
  unregister = null;
});

describe("X-Wgw-Notified", () => {
  it("reads the notified usernames of a successful write", () => {
    expect(notifiedUsernames(response(200, "alice, carol,,alice"))).toEqual(["alice", "carol"]);
    expect(notifiedUsernames(response(200))).toEqual([]);
    expect(notifiedUsernames(response(403, "alice"))).toEqual([]);
  });

  it("caps what one response can make the tab send", () => {
    const names = Array.from({ length: 100 }, (_, i) => `user${i}`).join(",");
    expect(notifiedUsernames(response(200, names))).toHaveLength(64);
  });

  it("nudges exactly the notified users and passes the response on", () => {
    const sent: string[][] = [];
    unregister = registerMeshCheckNowPort({
      sendCheckNow: (usernames) => sent.push([...usernames]),
      subscribeCheckNow: () => () => undefined,
      meshLinked: () => false,
      subscribeMeshLinked: () => () => undefined,
    });
    const res = response(201, "alice");
    expect(nudgeNotifiedUsers(res)).toBe(res);
    nudgeNotifiedUsers(response(200));
    expect(sent).toEqual([["alice"]]);
  });
});
