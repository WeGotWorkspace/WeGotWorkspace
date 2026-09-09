import { useMemo } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORY_MCP_ENDPOINT_URL } from "@/settings-core/src/mcp-endpoint";
import { AdminMcpPane } from "@/admin-core/src/admin-mcp-pane";
import { createMockAdminOperations } from "@/admin-core/src/admin-mock-operations";
import { useAdminController } from "@/admin-core/src/use-admin-controller";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";
import type { AdminAPIOperations } from "@/admin-core/src/admin-types";
import { shareLabels } from "@/share-ui/share-labels";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(() => {
  cleanup();
});

function Harness({
  enabled = false,
  saveSpy,
}: {
  enabled?: boolean;
  saveSpy: ReturnType<typeof vi.fn<AdminAPIOperations["saveSettings"]>>;
}) {
  const bootstrap = useMemo(
    () =>
      createAdminAppBootstrap({
        data: {
          ...createAdminAppBootstrap().data,
          mcp: { enabled },
        },
      }),
    [enabled],
  );
  const operations = useMemo(() => {
    const mock = createMockAdminOperations(bootstrap.data);
    return {
      ...mock,
      saveSettings: async (
        values: Parameters<AdminAPIOperations["saveSettings"]>[0],
        opts?: Parameters<AdminAPIOperations["saveSettings"]>[1],
      ) => {
        saveSpy(values, opts);
        return mock.saveSettings(values, opts);
      },
    };
  }, [bootstrap.data, saveSpy]);
  const controller = useAdminController({ data: bootstrap.data, operations });
  return (
    <TooltipProvider>
      <AdminStoryScope>
        <AdminMcpPane controller={controller} mcpEndpointUrl={STORY_MCP_ENDPOINT_URL} />
      </AdminStoryScope>
    </TooltipProvider>
  );
}

function connectionUrlField() {
  return screen.queryByRole("textbox", { name: "Connection URL" });
}

function assistantsSwitch() {
  return screen.getByRole("switch", {
    name: "Allow connected assistants enabled",
    hidden: true,
  });
}

describe("AdminMcpPane", () => {
  it("renders the kill-switch row off by default", () => {
    const saveSpy = vi.fn<AdminAPIOperations["saveSettings"]>();
    render(<Harness saveSpy={saveSpy} />);
    expect(screen.getByText("Connected assistants")).toBeTruthy();
    expect(
      screen.getByText(
        "People can connect Claude, ChatGPT, or Mistral. Turning this off disconnects them for everyone.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Allow connected assistants")).toBeTruthy();
    expect(screen.queryByText(/MCP access|consent page|outstanding/i)).toBeNull();
    expect(assistantsSwitch().getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(connectionUrlField()).toBeNull();
    expect(screen.queryByRole("button", { name: shareLabels.copyLink })).toBeNull();
  });

  it("shows a readonly connection URL and copy button when enabled", () => {
    const saveSpy = vi.fn<AdminAPIOperations["saveSettings"]>();
    render(<Harness enabled saveSpy={saveSpy} />);
    const url = connectionUrlField();
    expect(url).toBeTruthy();
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
    const saveSpy = vi.fn<AdminAPIOperations["saveSettings"]>();
    render(<Harness enabled saveSpy={saveSpy} />);
    fireEvent.click(screen.getByRole("button", { name: shareLabels.copyLink }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(STORY_MCP_ENDPOINT_URL);
    });
  });

  it("auto-saves when turning the switch on without a confirm dialog", async () => {
    const saveSpy = vi.fn<AdminAPIOperations["saveSettings"]>();
    render(<Harness saveSpy={saveSpy} />);
    fireEvent.click(assistantsSwitch());

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    expect(saveSpy.mock.calls[0]?.[0]?.mcp_enabled).toBe(true);
    expect(assistantsSwitch().getAttribute("aria-checked")).toBe("true");
    expect(connectionUrlField()).toBeTruthy();
  });

  it("keeps the switch on and does not save when disable is cancelled", async () => {
    const saveSpy = vi.fn<AdminAPIOperations["saveSettings"]>();
    render(<Harness enabled saveSpy={saveSpy} />);
    fireEvent.click(assistantsSwitch());

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Turn off connected assistants?");
    expect(dialog.textContent).toContain(
      "Turning this off disconnects all assistants. People will need to connect again.",
    );
    expect(assistantsSwitch().getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(assistantsSwitch().getAttribute("aria-checked")).toBe("true");
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("saves disabled after confirm", async () => {
    const saveSpy = vi.fn<AdminAPIOperations["saveSettings"]>();
    render(<Harness enabled saveSpy={saveSpy} />);
    fireEvent.click(assistantsSwitch());

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(assistantsSwitch().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    expect(saveSpy.mock.calls[0]?.[0]?.mcp_enabled).toBe(false);
    expect(assistantsSwitch().getAttribute("aria-checked")).toBe("false");
    expect(connectionUrlField()).toBeNull();
  });
});
