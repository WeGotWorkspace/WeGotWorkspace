import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  MCP_ASSISTANT_DATA_WARNING_CONSENT_MESSAGE,
  MCP_ASSISTANT_DATA_WARNING_TITLE,
  McpAssistantDataWarning,
} from "@/settings-core/src/mcp-assistant-data-warning";

describe("McpAssistantDataWarning", () => {
  it("defaults to the consent title and revoke-later message", () => {
    render(<McpAssistantDataWarning />);
    expect(screen.getByText(MCP_ASSISTANT_DATA_WARNING_TITLE)).toBeTruthy();
    expect(screen.getByText(MCP_ASSISTANT_DATA_WARNING_CONSENT_MESSAGE)).toBeTruthy();
  });

  it("accepts a message override", () => {
    render(<McpAssistantDataWarning message="Custom warning body." />);
    expect(screen.getByText(MCP_ASSISTANT_DATA_WARNING_TITLE)).toBeTruthy();
    expect(screen.getByText("Custom warning body.")).toBeTruthy();
    expect(screen.queryByText(/revoke access later in Settings/i)).toBeNull();
  });
});
