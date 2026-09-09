import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  MCP_CONSENT_PERMISSIONS_HINT,
  MCP_CONSENT_PERMISSIONS_TITLE,
  McpConsentPermissionsCard,
} from "@/settings-core/src/mcp-consent-permissions-card";
import {
  MCP_ASSISTANT_DATA_WARNING_CONSENT_MESSAGE,
  MCP_ASSISTANT_DATA_WARNING_TITLE,
} from "@/settings-core/src/mcp-assistant-data-warning";
import {
  mcpConsentCatalogScopeIds,
  mcpConsentGroupsFor,
} from "@/settings-core/src/mcp-scope-labels";

const catalog = mcpConsentGroupsFor(mcpConsentCatalogScopeIds());

describe("McpConsentPermissionsCard", () => {
  it("defaults to consent title, hint, and warning", () => {
    render(<McpConsentPermissionsCard groups={catalog} />);

    expect(screen.getByText(MCP_CONSENT_PERMISSIONS_TITLE)).toBeTruthy();
    expect(screen.getByText(MCP_CONSENT_PERMISSIONS_HINT)).toBeTruthy();
    expect(screen.getByText(MCP_ASSISTANT_DATA_WARNING_TITLE)).toBeTruthy();
    expect(screen.getByText(MCP_ASSISTANT_DATA_WARNING_CONSENT_MESSAGE)).toBeTruthy();
  });

  it("uses custom title and hint and can hide the warning", () => {
    render(
      <McpConsentPermissionsCard
        groups={catalog}
        title="Granted Permissions"
        hint="The assistant is allowed to do the following things"
        showWarning={false}
      />,
    );

    expect(screen.getByText("Granted Permissions")).toBeTruthy();
    expect(screen.getByText("The assistant is allowed to do the following things")).toBeTruthy();
    expect(screen.queryByText(MCP_CONSENT_PERMISSIONS_TITLE)).toBeNull();
    expect(screen.queryByText(MCP_CONSENT_PERMISSIONS_HINT)).toBeNull();
    expect(screen.queryByText(MCP_ASSISTANT_DATA_WARNING_TITLE)).toBeNull();
  });

  it("filters to granted scopes in readOnly and disables switches", () => {
    const onCheckedChange = vi.fn();
    render(
      <McpConsentPermissionsCard
        readOnly
        groups={catalog}
        grantedScopeIds={["drive.read"]}
        onCheckedChange={onCheckedChange}
      />,
    );

    expect(screen.getByText("Drive")).toBeTruthy();
    expect(screen.queryByText("Calendar")).toBeNull();
    expect(
      screen.queryByText("Create, update, move, delete, and share Drive files and folders"),
    ).toBeNull();

    const toggle = screen.getByRole("switch", {
      name: "Read and search Drive files and folders",
    });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("wraps in Card chrome by default", () => {
    const { container } = render(<McpConsentPermissionsCard groups={catalog} />);
    expect(container.querySelector(".card.mcp-consent-permissions-card")).toBeTruthy();
    expect(container.querySelector(".mcp-consent-permissions-card--plain")).toBeNull();
  });

  it("omits Card chrome when framed is false", () => {
    const { container } = render(
      <McpConsentPermissionsCard
        readOnly
        framed={false}
        groups={catalog}
        grantedScopeIds={["drive.read"]}
      />,
    );
    expect(container.querySelector(".card")).toBeNull();
    expect(container.querySelector(".mcp-consent-permissions-card--plain")).toBeTruthy();
    expect(screen.getByText("Drive")).toBeTruthy();
  });

  it("shows the full catalog with interactive switches when not readOnly", () => {
    render(
      <McpConsentPermissionsCard
        groups={catalog}
        checked={{ "drive.read": true, "drive.write": false }}
      />,
    );

    expect(screen.getByText("Calendar")).toBeTruthy();
    expect(
      screen
        .getByRole("switch", { name: "Read and search Drive files and folders" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("switch", {
          name: "Create, update, move, delete, and share Drive files and folders",
        })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });
});
