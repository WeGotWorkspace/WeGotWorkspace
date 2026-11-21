import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetchPrincipal: vi.fn(),
  wgwSettingsStateRead: { read: vi.fn() },
}));

import { wgwSettingsStateRead } from "@/lib/api/wgw/http";
import { loadCalendarDirectoryGroups } from "@/lib/api/wgw/calendar";
import { viewerHasNoTeam } from "@/lib/sharing/collection-share";

describe("loadCalendarDirectoryGroups", () => {
  beforeEach(() => {
    vi.mocked(wgwSettingsStateRead.read).mockReset();
  });

  it("leaves the Teams unknown when the settings request is not ok", async () => {
    vi.mocked(wgwSettingsStateRead.read).mockResolvedValue({ ok: false, status: 500 });
    const groups = await loadCalendarDirectoryGroups();
    expect(groups).toBeUndefined();
    expect(viewerHasNoTeam(groups)).toBe(false);
  });

  it("leaves the Teams unknown when the request throws", async () => {
    vi.mocked(wgwSettingsStateRead.read).mockRejectedValue(new Error("offline"));
    expect(await loadCalendarDirectoryGroups()).toBeUndefined();
  });

  it("returns an empty list for a viewer who is in no Team", async () => {
    vi.mocked(wgwSettingsStateRead.read).mockResolvedValue({
      ok: true,
      status: 200,
      json: { groups: [] },
    });
    expect(viewerHasNoTeam(await loadCalendarDirectoryGroups())).toBe(true);
  });
});
