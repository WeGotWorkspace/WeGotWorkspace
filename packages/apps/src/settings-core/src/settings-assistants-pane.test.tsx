import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import {
  SETTINGS_GRANTED_PERMISSIONS_HINT,
  SETTINGS_GRANTED_PERMISSIONS_TITLE,
  SettingsAssistantsPane,
} from "@/settings-core/src/settings-assistants-pane";
import {
  MCP_ASSISTANT_DATA_WARNING_CONSENT_MESSAGE,
  MCP_ASSISTANT_DATA_WARNING_TITLE,
} from "@/settings-core/src/mcp-assistant-data-warning";
import {
  MCP_CONSENT_PERMISSIONS_HINT,
  MCP_CONSENT_PERMISSIONS_TITLE,
} from "@/settings-core/src/mcp-consent-permissions-card";
import { STORY_MCP_ENDPOINT_URL } from "@/settings-core/src/mcp-endpoint";
import type { SettingsMcpGrantsState } from "@/settings-core/src/use-settings-mcp-grants";
import { shareLabels } from "@/share-ui/share-labels";

function renderPane(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function assistantsState(overrides: Partial<SettingsMcpGrantsState> = {}): SettingsMcpGrantsState {
  return {
    grants: [],
    loading: false,
    revokingId: null,
    error: null,
    refresh: async () => {},
    revoke: async () => {},
    ...overrides,
  };
}

function renderAssistantsPane(overrides: Partial<SettingsMcpGrantsState> = {}) {
  return renderPane(
    <SettingsAssistantsPane
      assistants={assistantsState(overrides)}
      mcpEndpointUrl={STORY_MCP_ENDPOINT_URL}
    />,
  );
}

describe("SettingsAssistantsPane", () => {
  it("shows an empty state with a connect guide link", () => {
    const { container } = renderAssistantsPane();
    expect(screen.getByText("No assistants connected")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /connect guide/i }).length).toBeGreaterThan(0);
    expect(container.querySelector(".settings-connected-assistants-pane--empty")).toBeTruthy();
    expect(container.querySelector(".settings-connected-assistants-pane--connected")).toBeNull();
  });

  it("shows the MCP URL instead of a lead paragraph or warning callout", () => {
    renderAssistantsPane();
    expect(screen.queryByText(MCP_ASSISTANT_DATA_WARNING_TITLE)).toBeNull();
    expect(screen.queryByText(MCP_ASSISTANT_DATA_WARNING_CONSENT_MESSAGE)).toBeNull();
    expect(screen.queryByText(/Assistants you connect can act as you/)).toBeNull();
    const url = screen.getByRole("textbox", { name: "Connection URL" });
    expect((url as HTMLInputElement).value).toBe(STORY_MCP_ENDPOINT_URL);
    expect((url as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByRole("button", { name: shareLabels.copyLink })).toBeTruthy();
  });

  it("lists a connected assistant with a read-only permissions card", () => {
    const { container } = renderAssistantsPane({
      grants: [
        {
          clientId: "abc",
          clientName: "Claude",
          clientOrigin: "https://claude.ai",
          connectedAt: "2026-09-08T10:00:00Z",
          scopes: ["drive.read"],
          lastUsedAt: null,
        },
      ],
    });
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("claude.ai")).toBeTruthy();
    expect(screen.queryByText("https://claude.ai")).toBeNull();
    expect(screen.queryByText(/Connected /)).toBeNull();
    expect(screen.queryByText("Last used")).toBeNull();
    expect(screen.queryByText("Never used")).toBeNull();
    expect(container.querySelector(".settings-assistants-pane__grant-meta")).toBeNull();
    expect(screen.getByText(SETTINGS_GRANTED_PERMISSIONS_TITLE)).toBeTruthy();
    expect(screen.getByText(SETTINGS_GRANTED_PERMISSIONS_HINT)).toBeTruthy();
    expect(screen.queryByText(MCP_CONSENT_PERMISSIONS_TITLE)).toBeNull();
    expect(screen.queryByText(MCP_CONSENT_PERMISSIONS_HINT)).toBeNull();
    expect(screen.queryByText(MCP_ASSISTANT_DATA_WARNING_TITLE)).toBeNull();
    expect(screen.queryByText(MCP_ASSISTANT_DATA_WARNING_CONSENT_MESSAGE)).toBeNull();
    expect(container.querySelector(".settings-connected-assistants-pane--connected")).toBeTruthy();
    expect(container.querySelector(".settings-connected-assistants-pane--empty")).toBeNull();
    expect(screen.getByText("Drive")).toBeTruthy();
    expect(screen.getByText("Read and search Drive files and folders")).toBeTruthy();
    expect(screen.queryByText("Calendar")).toBeNull();
    expect(screen.queryByText("drive.read")).toBeNull();
    const revoke = screen.getByRole("button", { name: "Revoke Claude" });
    expect(revoke).toBeTruthy();
    expect(revoke.classList.contains("button--variant-destructive-outline")).toBe(true);
    expect(revoke.classList.contains("button--variant-destructive")).toBe(false);
    expect(revoke.classList.contains("button--variant-subtle")).toBe(false);
    expect(screen.queryByRole("button", { name: "Revoke access" })).toBeNull();
    expect(container.querySelector(".card__title")).toBeNull();
    expect(container.querySelectorAll(".tag").length).toBe(0);
    expect(screen.getByRole("heading", { name: "Claude" }).closest(".card")).toBeNull();
    expect(screen.getByRole("button", { name: "Revoke Claude" }).closest(".card")).toBeNull();
    expect(container.querySelector(".card.mcp-consent-permissions-card")).toBeTruthy();
    expect(container.querySelector(".mcp-consent-permissions-card--plain")).toBeNull();
    expect(container.querySelectorAll(".card .card").length).toBe(0);

    const toggle = screen.getByRole("switch", {
      name: "Read and search Drive files and folders",
    });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("does not list offline_access on grant cards", () => {
    renderAssistantsPane({
      grants: [
        {
          clientId: "abc",
          clientName: "Claude",
          clientOrigin: "https://claude.ai",
          connectedAt: "2026-09-08T10:00:00Z",
          scopes: ["drive.read", "offline_access", "settings"],
          lastUsedAt: null,
        },
      ],
    });
    expect(screen.getByText("Drive")).toBeTruthy();
    expect(screen.getByText("Profile")).toBeTruthy();
    expect(screen.queryByText("offline_access")).toBeNull();
    expect(screen.queryByText("Stay connected")).toBeNull();
    expect(screen.queryByText("Connection")).toBeNull();
  });

  it("uses a generic revoke label when the grant has no client name", () => {
    renderAssistantsPane({
      grants: [
        {
          clientId: "abc",
          clientName: "",
          clientOrigin: "https://claude.ai",
          connectedAt: "2026-09-08T10:00:00Z",
          scopes: ["drive.read"],
          lastUsedAt: null,
        },
      ],
    });
    expect(screen.getByRole("button", { name: "Revoke assistant" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "claude.ai" })).toBeTruthy();
    expect(screen.queryByText("https://claude.ai")).toBeNull();
  });
});
