import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch: vi.fn(),
  wgwReadJson: vi.fn(),
  wgwFetchPrincipal: vi.fn(),
}));

import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import { loadCalendarDirectoryGroups } from "@/lib/api/wgw/calendar";
import { viewerHasNoTeam } from "@/lib/sharing/collection-share";

describe("loadCalendarDirectoryGroups", () => {
  beforeEach(() => {
    vi.mocked(wgwFetch).mockReset();
    vi.mocked(wgwReadJson).mockReset();
  });

  it("leaves the Teams unknown when the settings request is not ok", async () => {
    vi.mocked(wgwFetch).mockResolvedValue(new Response(null, { status: 500 }));
    const groups = await loadCalendarDirectoryGroups();
    expect(groups).toBeUndefined();
    expect(viewerHasNoTeam(groups)).toBe(false);
  });

  it("leaves the Teams unknown when the request throws", async () => {
    vi.mocked(wgwFetch).mockRejectedValue(new Error("offline"));
    expect(await loadCalendarDirectoryGroups()).toBeUndefined();
  });

  it("returns an empty list for a viewer who is in no Team", async () => {
    vi.mocked(wgwFetch).mockResolvedValue(new Response(null, { status: 200 }));
    vi.mocked(wgwReadJson).mockResolvedValue({ groups: [] });
    expect(viewerHasNoTeam(await loadCalendarDirectoryGroups())).toBe(true);
  });
});
