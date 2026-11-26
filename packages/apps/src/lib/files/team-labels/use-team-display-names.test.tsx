import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  meta: new Map<string, string>(),
  live: true,
  read: vi.fn(),
}));

vi.mock("@/lib/offline/core/meta-store", () => ({
  readMeta: async (user: string, key: string) => env.meta.get(`${user}:${key}`) ?? null,
  writeMeta: async (user: string, key: string, value: string) => {
    env.meta.set(`${user}:${key}`, value);
  },
}));
vi.mock("@/lib/api/wgw/http", () => ({
  wgwLiveApiEnabled: () => env.live,
  wgwSettingsStateRead: { read: (...args: unknown[]) => env.read(...args) },
}));

import {
  readCachedTeamDisplayNames,
  sanitizeTeamDisplayNames,
  TEAM_DISPLAY_NAMES_META_KEY,
  writeCachedTeamDisplayNames,
} from "@/lib/files/team-labels/team-label-store";
import { useTeamDisplayNames } from "@/lib/files/team-labels/use-team-display-names";

const NOTES = { id: "principals/groups/e2e-notes-team", displayName: "E2E Notes Team" };

describe("team label store", () => {
  beforeEach(() => env.meta.clear());

  it("round-trips the names per account", async () => {
    await writeCachedTeamDisplayNames("alice", [NOTES]);
    expect(await readCachedTeamDisplayNames("alice")).toEqual([NOTES]);
    expect(await readCachedTeamDisplayNames("bob")).toEqual([]);
  });

  it("drops malformed rows and survives bad JSON", async () => {
    expect(
      sanitizeTeamDisplayNames([NOTES, { id: "x" }, null, { id: "", displayName: "y" }]),
    ).toEqual([NOTES]);
    env.meta.set(`alice:${TEAM_DISPLAY_NAMES_META_KEY}`, "{not json");
    expect(await readCachedTeamDisplayNames("alice")).toEqual([]);
  });
});

describe("useTeamDisplayNames", () => {
  beforeEach(() => {
    env.meta.clear();
    env.live = true;
    env.read.mockReset();
  });

  it("caches the live names for the account", async () => {
    env.read.mockResolvedValue({ ok: true, json: { groups: [NOTES] } });
    const { result } = renderHook(() => useTeamDisplayNames("alice", true));
    await waitFor(() => expect(result.current).toEqual([NOTES]));
    await waitFor(async () => expect(await readCachedTeamDisplayNames("alice")).toEqual([NOTES]));
  });

  it("shows the cached names offline without a request", async () => {
    await writeCachedTeamDisplayNames("alice", [NOTES]);
    const { result } = renderHook(() => useTeamDisplayNames("alice", false));
    await waitFor(() => expect(result.current).toEqual([NOTES]));
    expect(env.read).not.toHaveBeenCalled();
  });

  it("keeps the cached names when the live read fails", async () => {
    await writeCachedTeamDisplayNames("alice", [NOTES]);
    env.read.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useTeamDisplayNames("alice", true));
    await waitFor(() => expect(result.current).toEqual([NOTES]));
  });

  it("lets a live answer win over a cache that arrives later", async () => {
    await writeCachedTeamDisplayNames("alice", [NOTES]);
    env.read.mockResolvedValue({ ok: true, json: { groups: [] } });
    const { result } = renderHook(() => useTeamDisplayNames("alice", true));
    await waitFor(() => expect(env.read).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Left the team: the stale cached name must not come back.
    expect(result.current).toEqual([]);
  });

  it("caches nothing without an account (guests, mocks)", async () => {
    env.read.mockResolvedValue({ ok: true, json: { groups: [NOTES] } });
    const { result } = renderHook(() => useTeamDisplayNames(null, true));
    await waitFor(() => expect(result.current).toEqual([NOTES]));
    expect(env.meta.size).toBe(0);
  });
});
