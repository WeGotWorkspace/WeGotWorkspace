import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORY_MCP_ENDPOINT_URL } from "@/settings-core/src/mcp-endpoint";
import { McpEndpointUrlRow } from "@/settings-core/src/mcp-endpoint-url-row";
import { shareLabels } from "@/share-ui/share-labels";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(() => {
  cleanup();
});

function renderRow() {
  return render(
    <TooltipProvider>
      <McpEndpointUrlRow url={STORY_MCP_ENDPOINT_URL} inputId="test-mcp-endpoint" />
    </TooltipProvider>,
  );
}

describe("McpEndpointUrlRow", () => {
  it("renders a readonly connection URL and copy button", () => {
    renderRow();
    const url = screen.getByRole("textbox", { name: "Connection URL" });
    expect((url as HTMLInputElement).value).toBe(STORY_MCP_ENDPOINT_URL);
    expect((url as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByRole("button", { name: shareLabels.copyLink })).toBeTruthy();
  });

  it("copies the connection URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderRow();
    fireEvent.click(screen.getByRole("button", { name: shareLabels.copyLink }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(STORY_MCP_ENDPOINT_URL);
    });
  });
});
