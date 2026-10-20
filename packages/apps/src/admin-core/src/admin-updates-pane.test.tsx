import { useMemo } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminUpdatesPane } from "@/admin-core/src/admin-updates-pane";
import { createMockAdminOperations } from "@/admin-core/src/admin-mock-operations";
import type { AdminAPIOperations, AdminUpdateState } from "@/admin-core/src/admin-types";
import { useAdminController } from "@/admin-core/src/use-admin-controller";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(() => {
  cleanup();
});

function Harness({
  updates,
  channelSpy,
}: {
  updates?: Partial<AdminUpdateState>;
  channelSpy?: ReturnType<typeof vi.fn<AdminAPIOperations["setUpdateChannel"]>>;
}) {
  const bootstrap = useMemo(() => {
    const base = createAdminAppBootstrap().data;
    return createAdminAppBootstrap({ data: { ...base, updates: { ...base.updates, ...updates } } });
  }, [updates]);
  const operations = useMemo(() => {
    const mock = createMockAdminOperations(bootstrap.data);
    return {
      ...mock,
      setUpdateChannel: async (
        channel: Parameters<AdminAPIOperations["setUpdateChannel"]>[0],
        opts?: Parameters<AdminAPIOperations["setUpdateChannel"]>[1],
      ) => {
        channelSpy?.(channel, opts);
        return mock.setUpdateChannel(channel, opts);
      },
    };
  }, [bootstrap.data, channelSpy]);
  const controller = useAdminController({ data: bootstrap.data, operations });
  return (
    <TooltipProvider>
      <AdminStoryScope>
        <AdminUpdatesPane
          controller={controller}
          setConfirmClearLogsOpen={() => {}}
          setConfirmUpdateOpen={() => {}}
          updatingNow={false}
        />
      </AdminStoryScope>
    </TooltipProvider>
  );
}

describe("AdminUpdatesPane update channel", () => {
  it("switches a ZIP install to the beta channel", async () => {
    const channelSpy = vi.fn<AdminAPIOperations["setUpdateChannel"]>();
    render(<Harness channelSpy={channelSpy} />);

    expect(screen.getByRole("button", { name: "Stable" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByText("Running the latest stable release.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Beta" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Beta" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
    });
    expect(channelSpy).toHaveBeenCalledWith("beta", undefined);
    expect(screen.getByText("Beta channel")).toBeTruthy();
    expect(screen.getByText("Running the latest beta release.")).toBeTruthy();
  });

  it("says stable is not 1.0 yet on a 0.x install", () => {
    render(<Harness updates={{ installedVersion: "0.1.122" }} />);

    expect(screen.getByText("Stable, before 1.0")).toBeTruthy();
  });

  it("drops the pre-1.0 note from 1.0 on", () => {
    render(<Harness updates={{ installedVersion: "1.0.0" }} />);

    expect(screen.queryByText("Stable, before 1.0")).toBeNull();
  });

  it("asks before switching to edge and stays put on cancel", async () => {
    const channelSpy = vi.fn<AdminAPIOperations["setUpdateChannel"]>();
    render(<Harness channelSpy={channelSpy} />);

    fireEvent.click(screen.getByRole("button", { name: "Edge" }));

    expect(
      await screen.findByRole("alertdialog", { name: "Switch to the edge channel?" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(channelSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stable" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("switches to edge after confirming", async () => {
    const channelSpy = vi.fn<AdminAPIOperations["setUpdateChannel"]>();
    render(<Harness channelSpy={channelSpy} />);

    fireEvent.click(screen.getByRole("button", { name: "Edge" }));
    fireEvent.click(await screen.findByRole("button", { name: "Switch to edge" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edge" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
    });
    expect(channelSpy).toHaveBeenCalledWith("edge", undefined);
  });

  it("warns that edge is not for production data", () => {
    render(<Harness updates={{ updateChannel: "edge" }} />);

    expect(screen.getByText("Edge channel: not for production data")).toBeTruthy();
  });

  it("locks the channel while an update runs", () => {
    render(<Harness updates={{ inProgress: true, phase: "downloading" }} />);

    expect((screen.getByRole("button", { name: "Edge" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the channel read-only on Docker installs", () => {
    render(<Harness updates={{ installChannel: "docker", updateChannel: "beta" }} />);

    expect(screen.queryByRole("group", { name: "Update channel" })).toBeNull();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getByText("bash setup.sh upgrade --channel beta")).toBeTruthy();
  });
});
