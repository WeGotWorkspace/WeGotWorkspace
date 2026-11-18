import { describe, expect, it } from "vitest";
import type { SettingsMcpGrant } from "@/lib/models/settings-types";
import {
  connectionsShareScopes,
  formatActiveAgo,
  groupMcpGrants,
  mcpAppAccess,
  mcpGrantSource,
  userAgentLabel,
} from "@/settings-core/src/mcp-grant-display";

function grant(overrides: Partial<SettingsMcpGrant> = {}): SettingsMcpGrant {
  return {
    clientId: "abc",
    clientName: "Claude",
    clientOrigin: "https://claude.ai",
    clientRegistration: "cimd",
    connectedAt: "2026-11-12T10:00:00Z",
    approvedAt: null,
    approvedUserAgent: null,
    scopes: ["drive.read"],
    lastUsedAt: null,
    shareCalls: [],
    ...overrides,
  };
}

describe("userAgentLabel", () => {
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      "Safari on Mac",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Chrome on Windows",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
      "Edge on Windows",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox on Linux"],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      "Safari on iPhone",
    ],
    [
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      "Chrome on Android",
    ],
  ])("names %s", (ua, label) => {
    expect(userAgentLabel(ua)).toBe(label);
  });

  it("returns null when there is nothing to recognise", () => {
    expect(userAgentLabel(null)).toBeNull();
    expect(userAgentLabel("")).toBeNull();
    expect(userAgentLabel("curl/8.7.1")).toBeNull();
  });
});

describe("mcpGrantSource", () => {
  it("shows loopback redirects as a local app and other origins as their host", () => {
    expect(mcpGrantSource(grant({ clientOrigin: "http://localhost:33418" }))).toBe("Local app");
    expect(mcpGrantSource(grant({ clientOrigin: "http://127.0.0.1:5000" }))).toBe("Local app");
    expect(mcpGrantSource(grant({ clientOrigin: "https://claude.ai" }))).toBe("claude.ai");
    expect(mcpGrantSource(grant({ clientOrigin: "" }))).toBe("");
  });
});

describe("groupMcpGrants", () => {
  it("groups by name and source, most recently active first", () => {
    const groups = groupMcpGrants([
      grant({ clientId: "c1", lastUsedAt: "2026-11-10T10:00:00Z" }),
      grant({
        clientId: "cc1",
        clientName: "Claude Code",
        clientOrigin: "http://localhost:1",
        lastUsedAt: "2026-11-17T10:00:00Z",
      }),
      grant({
        clientId: "cc2",
        clientName: "claude code",
        clientOrigin: "http://localhost:2",
        lastUsedAt: "2026-11-01T10:00:00Z",
      }),
    ]);
    expect(
      groups.map((group) => [group.name, group.source, group.connections.map((c) => c.clientId)]),
    ).toEqual([
      ["Claude Code", "Local app", ["cc1", "cc2"]],
      ["Claude", "claude.ai", ["c1"]],
    ]);
  });
});

describe("mcpAppAccess", () => {
  it("lists the actions per app, legacy and retired ids included", () => {
    expect(
      mcpAppAccess([
        "calendar.read",
        "calendar.write",
        "drive",
        "drive.share",
        "docs.read",
        "mail.read",
      ]),
    ).toEqual([
      { app: "Calendar", actions: ["Read", "Write"] },
      { app: "Docs", actions: ["Read"] },
      { app: "Drive", actions: ["Read", "Write", "Share"] },
      { app: "Other", actions: ["mail.read"] },
    ]);
  });

  it("sorts apps alphabetically", () => {
    expect(
      mcpAppAccess(["tasks.read", "notes.read", "contacts.read", "calendar.read"]).map(
        (row) => row.app,
      ),
    ).toEqual(["Calendar", "Contacts", "Notes", "Tasks"]);
  });

  it("knows when connections share their scopes", () => {
    expect(
      connectionsShareScopes([grant({ scopes: ["a", "b"] }), grant({ scopes: ["b", "a"] })]),
    ).toBe(true);
    expect(connectionsShareScopes([grant({ scopes: ["a"] }), grant({ scopes: ["b"] })])).toBe(
      false,
    );
  });
});

describe("formatActiveAgo", () => {
  const now = new Date("2026-11-18T12:00:00");

  it("uses minutes and hours today, days before that", () => {
    expect(formatActiveAgo(new Date("2026-11-18T11:59:40").toISOString(), now)).toBe("just now");
    expect(formatActiveAgo(new Date("2026-11-18T11:48:00").toISOString(), now)).toMatch(/12/);
    expect(formatActiveAgo(new Date("2026-11-18T09:00:00").toISOString(), now)).toMatch(/3/);
    expect(formatActiveAgo(new Date("2026-11-17T09:00:00").toISOString(), now)).toBe("yesterday");
  });
});
