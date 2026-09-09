import { describe, expect, it } from "vitest";
import {
  filterMcpConsentGroupsToGranted,
  formatGrantDate,
  groupMcpScopeIds,
  MCP_CONSENT_GROUP_APP_ID,
  mcpConsentGroupsFor,
  mcpScopeActionLabel,
} from "@/settings-core/src/mcp-scope-labels";

describe("groupMcpScopeIds", () => {
  it("groups read and write under the app name", () => {
    const groups = groupMcpScopeIds(["calendar.read", "calendar.write", "drive.read"]);
    expect(groups.map((group) => group.label)).toEqual(["Calendar", "Drive"]);
    expect(groups[0]?.scopes.map((scope) => scope.actionLabel)).toEqual(["Read", "Write"]);
    expect(groups[1]?.scopes.map((scope) => scope.actionLabel)).toEqual(["Read"]);
  });

  it("attaches legacy aliases to the same app", () => {
    const groups = groupMcpScopeIds(["calendar"]);
    expect(groups).toEqual([
      { label: "Calendar", scopes: [{ id: "calendar", actionLabel: "Read and write" }] },
    ]);
  });

  it("hides offline_access from grant and consent groups", () => {
    const groups = groupMcpScopeIds(["drive.read", "offline_access", "settings"]);
    expect(groups.map((group) => group.label)).toEqual(["Drive", "Profile"]);
    expect(groups.flatMap((group) => group.scopes.map((scope) => scope.id))).not.toContain(
      "offline_access",
    );
  });
});

describe("filterMcpConsentGroupsToGranted", () => {
  it("keeps only granted rows and drops apps with nothing granted", () => {
    const filtered = filterMcpConsentGroupsToGranted(
      mcpConsentGroupsFor(["calendar.read", "calendar.write", "drive.read", "drive.write"]),
      ["drive.read"],
    );
    expect(filtered.map((group) => group.label)).toEqual(["Drive"]);
    expect(filtered[0]?.scopes.map((scope) => scope.id)).toEqual(["drive.read"]);
  });

  it("returns no groups when nothing was granted", () => {
    expect(
      filterMcpConsentGroupsToGranted(mcpConsentGroupsFor(["drive.read", "settings"]), []),
    ).toEqual([]);
  });
});

describe("mcpScopeActionLabel", () => {
  it("uses Send for mail.send", () => {
    expect(mcpScopeActionLabel("mail.send")).toBe("Send");
  });

  it("keeps a fallback label for offline_access", () => {
    expect(mcpScopeActionLabel("offline_access")).toBe("Stay connected");
  });
});

describe("MCP_CONSENT_GROUP_APP_ID", () => {
  it("maps consent groups to workspace app icons", () => {
    expect(MCP_CONSENT_GROUP_APP_ID.Calendar).toBe("calendar");
    expect(MCP_CONSENT_GROUP_APP_ID.Profile).toBe("settings");
    expect(MCP_CONSENT_GROUP_APP_ID.Connection).toBeUndefined();
  });
});

describe("formatGrantDate", () => {
  it("formats a date with medium date style and no time", () => {
    expect(formatGrantDate("2026-09-07T09:00:00Z")).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
        new Date("2026-09-07T09:00:00Z"),
      ),
    );
  });

  it("uses Never used when the instant is missing", () => {
    expect(formatGrantDate(null)).toBe("Never used");
  });
});
