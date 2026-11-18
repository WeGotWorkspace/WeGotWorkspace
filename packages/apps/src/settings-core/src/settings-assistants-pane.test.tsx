const previousTimeZone = process.env.TZ;
process.env.TZ = "Europe/Amsterdam";

import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import {
  SETTINGS_AUTHORIZED_ASSISTANTS_TITLE,
  SettingsAssistantsPane,
} from "@/settings-core/src/settings-assistants-pane";
import {
  MCP_ASSISTANT_DATA_WARNING_CONSENT_MESSAGE,
  MCP_ASSISTANT_DATA_WARNING_TITLE,
} from "@/settings-core/src/mcp-assistant-data-warning";
import { STORY_MCP_ENDPOINT_URL } from "@/lib/mcp-endpoint";
import type { SettingsMcpGrant } from "@/lib/models/settings-types";
import type { SettingsMcpGrantsState } from "@/settings-core/src/use-settings-mcp-grants";
import { shareLabels } from "@/share-ui/share-labels";

afterAll(() => {
  if (previousTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = previousTimeZone;
  }
});

const NOW = new Date("2026-11-18T12:00:00+01:00");
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0";

function grant(overrides: Partial<SettingsMcpGrant> = {}): SettingsMcpGrant {
  return {
    clientId: "abc",
    clientName: "Claude",
    clientOrigin: "https://claude.ai",
    clientRegistration: "cimd",
    connectedAt: "2026-11-12T10:00:00Z",
    approvedAt: "2026-11-12T10:00:00Z",
    approvedUserAgent: SAFARI_MAC,
    scopes: ["drive.read"],
    lastUsedAt: "2026-11-18T10:48:00Z",
    shareCalls: [],
    ...overrides,
  };
}

function assistantsState(overrides: Partial<SettingsMcpGrantsState> = {}): SettingsMcpGrantsState {
  return {
    grants: [],
    loading: false,
    revokingId: null,
    error: null,
    refresh: async () => {},
    revoke: async () => {},
    revokeAll: async () => {},
    ...overrides,
  };
}

/** Each app tag by its accessible name, "App: Read & write", in order. */
function appRows(): string[] {
  return [...document.querySelectorAll(".settings-assistant__app")].map(
    (tag) => tag.getAttribute("aria-label") ?? "",
  );
}

/** Section titles of the assistants (the product names). */
function assistantNames(): string[] {
  return [...document.querySelectorAll(".settings-assistant .card__title")].map(
    (title) => title.textContent ?? "",
  );
}

/** Each connection row as "Browser: description". */
function connectionRows(): string[] {
  return [...document.querySelectorAll(".settings-assistant__connection")].map((row) => {
    const label = row.querySelector(".field-label-row__label")?.textContent ?? "";
    const description = row.querySelector(".field-label-row__description")?.textContent ?? "";
    return `${label}: ${description}`;
  });
}

function renderPane(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function renderAssistantsPane(overrides: Partial<SettingsMcpGrantsState> = {}) {
  return renderPane(
    <SettingsAssistantsPane
      assistants={assistantsState(overrides)}
      mcpEndpointUrl={STORY_MCP_ENDPOINT_URL}
      now={NOW}
    />,
  );
}

describe("SettingsAssistantsPane", () => {
  it("shows the connection URL and an empty state without a warning callout", () => {
    renderAssistantsPane();
    const url = screen.getByRole("textbox", { name: "Connection URL" });
    expect((url as HTMLInputElement).value).toBe(STORY_MCP_ENDPOINT_URL);
    expect((url as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByRole("button", { name: shareLabels.copyLink })).toBeTruthy();
    expect(screen.getByText(SETTINGS_AUTHORIZED_ASSISTANTS_TITLE)).toBeTruthy();
    expect(screen.getByText(/No assistants yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connect guide" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect assistant" })).toBeNull();
    expect(screen.queryByText(MCP_ASSISTANT_DATA_WARNING_TITLE)).toBeNull();
    expect(screen.queryByText(MCP_ASSISTANT_DATA_WARNING_CONSENT_MESSAGE)).toBeNull();
  });

  it("shows one assistant with where and when it was approved, and access per app", () => {
    renderAssistantsPane({
      grants: [grant({ scopes: ["drive.read", "calendar.read", "calendar.write"] })],
    });
    expect(assistantNames()).toEqual(["Claude"]);
    expect(screen.getByText("claude.ai")).toBeTruthy();
    expect(connectionRows()).toEqual([
      expect.stringMatching(/^Safari on Mac: Approved (12 Nov|Nov 12) · Active /),
    ]);
    expect(screen.getByRole("button", { name: "Revoke all Claude connections" })).toBeTruthy();
    expect(appRows()).toEqual(["Calendar: Read & write", "Drive: Read"]);
    expect(screen.getByRole("button", { name: "Revoke Claude" })).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("groups DCR duplicates of one product and lets each connection be revoked", async () => {
    const revokeAll = vi.fn(async () => {});
    renderAssistantsPane({
      revokeAll,
      grants: [
        grant({
          clientId: "cc-1",
          clientName: "Claude Code",
          clientOrigin: "http://localhost:33418",
          clientRegistration: "dcr",
        }),
        grant({
          clientId: "cc-2",
          clientName: "Claude Code",
          clientOrigin: "http://127.0.0.1:41011",
          clientRegistration: "dcr",
          approvedUserAgent: FIREFOX_LINUX,
          lastUsedAt: null,
        }),
      ],
    });
    expect(assistantNames()).toEqual(["Claude Code"]);
    expect(screen.getByText("Local app")).toBeTruthy();
    expect(connectionRows()).toEqual([
      expect.stringMatching(/^Safari on Mac: Approved (12 Nov|Nov 12) · Active /),
      expect.stringMatching(/^Firefox on Linux: Approved (12 Nov|Nov 12) · Not used yet$/),
    ]);
    expect(appRows()).toEqual(["Drive: Read"]);

    fireEvent.click(
      screen.getByRole("button", { name: /^Revoke Claude Code, Firefox on Linux, Approved / }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Revoke access" }));
    await waitFor(() => expect(revokeAll).toHaveBeenCalledWith(["cc-2"]));

    fireEvent.click(screen.getByRole("button", { name: "Revoke all Claude Code connections" }));
    expect(await screen.findByText("Revoke all Claude Code connections?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
    await waitFor(() => expect(revokeAll).toHaveBeenLastCalledWith(["cc-1", "cc-2"]));
  });

  it("keeps a same-named client from another host apart from the real one", () => {
    renderAssistantsPane({
      grants: [
        grant({ clientId: "real" }),
        grant({
          clientId: "fake",
          clientOrigin: "https://claude.example",
          clientRegistration: "dcr",
        }),
      ],
    });
    expect(assistantNames()).toEqual(["Claude", "Claude"]);
    expect(screen.getByText("claude.example")).toBeTruthy();
  });

  it("says Connected instead of Approved for grants from before approvals were recorded", () => {
    renderAssistantsPane({
      grants: [
        grant({ approvedAt: null, approvedUserAgent: null, connectedAt: "2026-10-01T09:00:00Z" }),
      ],
    });
    expect(connectionRows()).toEqual([
      expect.stringMatching(/^Unknown browser: Connected (1 Oct|Oct 1) · Active /),
    ]);
  });

  it("shows a grant holding only retired mail scopes so it can be revoked", () => {
    renderAssistantsPane({
      grants: [grant({ clientName: "Old mail assistant", scopes: ["mail.read", "mail.send"] })],
    });
    expect(appRows()).toEqual(["Other: mail.read, mail.send"]);
    expect(screen.getByRole("button", { name: "Revoke Old mail assistant" })).toBeTruthy();
  });

  it("does not list offline_access", () => {
    renderAssistantsPane({
      grants: [grant({ scopes: ["drive.read", "offline_access", "settings"] })],
    });
    expect(appRows()).toEqual(["Drive: Read", "Profile: Read"]);
    expect(screen.queryByText(/offline_access|Stay connected/)).toBeNull();
  });

  it("lists share tool calls of all connections, newest first", () => {
    renderAssistantsPane({
      grants: [
        grant({
          scopes: ["drive.write"],
          shareCalls: [
            {
              tool: "drive_share",
              outcome: "denied",
              createdAt: "2026-10-02T12:00:00+00:00",
              target: '{"action":"set","path":"/users/bob/shared.txt"}',
            },
            {
              tool: "docs_share",
              outcome: "error",
              createdAt: "2026-10-04T13:00:00+00:00",
              target: "/users/bob/notes.md",
            },
          ],
        }),
      ],
    });
    expect(screen.getByRole("heading", { name: "Share activity" })).toBeTruthy();
    expect(screen.getByText("/users/bob/shared.txt")).toBeTruthy();
    expect(screen.getByText("Denied — external share")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    const times = document.querySelectorAll("time");
    expect(times[0]?.textContent).toBe("2026-10-04 15:00");
    expect(times[1]?.textContent).toBe("2026-10-02 14:00");
  });

  it("names a grant without a client name after its host", () => {
    renderAssistantsPane({ grants: [grant({ clientName: "" })] });
    expect(assistantNames()).toEqual(["claude.ai"]);
    expect(screen.getByRole("button", { name: "Revoke claude.ai" })).toBeTruthy();
  });
});
