import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsAssistantsPane } from "@/settings-core/src/settings-assistants-pane";

describe("SettingsAssistantsPane", () => {
  it("shows an empty state with a connect guide link", () => {
    render(
      <SettingsAssistantsPane
        assistants={{
          grants: [],
          loading: false,
          revokingId: null,
          error: null,
          refresh: async () => {},
          revoke: async () => {},
        }}
      />,
    );
    expect(screen.getByText("No assistants connected")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /connect guide/i }).length).toBeGreaterThan(0);
  });

  it("lists a connected assistant origin", () => {
    render(
      <SettingsAssistantsPane
        assistants={{
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
          loading: false,
          revokingId: null,
          error: null,
          refresh: async () => {},
          revoke: async () => {},
        }}
      />,
    );
    expect(screen.getByText("https://claude.ai")).toBeTruthy();
    expect(screen.getByText("drive.read")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoke access" })).toBeTruthy();
  });
});
