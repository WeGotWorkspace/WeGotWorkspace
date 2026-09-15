import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HardDrive } from "lucide-react";
import { DriveFolderPicker } from "@/drive-core/src/drive-folder-picker";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { DRIVE_FOLDER_PICKER_ROOT } from "@/drive-core/src/drive-breadcrumbs";
import { TooltipProvider } from "@/ui/tooltip";
import "@/drive-core/src/drive-folder-picker.css";

afterEach(() => {
  cleanup();
});

describe("DriveFolderPicker", () => {
  it("keeps browse path after double-click when the files prop gets a new reference", () => {
    const onDestinationChange = vi.fn();
    const files: DriveFile[] = [];
    const props = {
      labels: driveLabels,
      files,
      groupPaths: [] as string[],
      moveIds: [] as string[],
      initialBrowsePath: "My Drive",
      currentUsername: "alice",
      groupRootNames: new Set<string>(),
      onDestinationChange,
    };

    const view = render(<DriveFolderPicker {...props} />);

    fireEvent.doubleClick(screen.getByText("Studio Assets"));
    expect(screen.getByText("studio-mark-final.svg")).toBeTruthy();

    view.rerender(<DriveFolderPicker {...props} files={[...files]} />);

    expect(screen.getByText("studio-mark-final.svg")).toBeTruthy();
    expect(screen.queryByText("Archives")).toBeNull();
  });

  it("applies Docs rootLabels and rootIcon on the Drives root listing", () => {
    render(
      <DriveFolderPicker
        labels={{ ...driveLabels, sidebarMyDrive: "Personal" }}
        files={[]}
        groupPaths={["Groups/administrators"]}
        moveIds={[]}
        initialBrowsePath={DRIVE_FOLDER_PICKER_ROOT}
        currentUsername="alice"
        groupRootNames={new Set(["administrators"])}
        rootLabels={{
          "My Drive": "Personal",
          "Groups/administrators": "Administrators",
        }}
        rootIcon={<HardDrive data-testid="docs-drive-root-icon" />}
        onDestinationChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Personal")).toBeTruthy();
    expect(screen.getByText("Administrators")).toBeTruthy();
    expect(screen.queryByText("My Drive")).toBeNull();
    expect(screen.queryByText("administrators")).toBeNull();
    expect(screen.getAllByTestId("docs-drive-root-icon").length).toBeGreaterThan(0);
  });

  it("preselects initialSelectedPath on the Drives root for create (empty moveIds)", () => {
    const onDestinationChange = vi.fn();
    render(
      <DriveFolderPicker
        labels={{ ...driveLabels, sidebarMyDrive: "Personal" }}
        files={[]}
        groupPaths={["Groups/engineering"]}
        moveIds={[]}
        initialBrowsePath={DRIVE_FOLDER_PICKER_ROOT}
        initialSelectedPath="Groups/engineering"
        currentUsername="alice"
        groupRootNames={new Set(["engineering"])}
        rootLabels={{
          "My Drive": "Personal",
          "Groups/engineering": "engineering",
        }}
        onDestinationChange={onDestinationChange}
      />,
    );

    expect(onDestinationChange).toHaveBeenCalledWith("Groups/engineering");
    const row = screen.getByText("engineering").closest("tr");
    expect(row?.className).toContain("destination-list-row--selected");
  });

  it("uses Drive grid in file-select mode and omits non-images", () => {
    const onSelectedFileChange = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <DriveFolderPicker
          mode="file-select"
          labels={driveLabels}
          files={[]}
          groupPaths={[]}
          moveIds={[]}
          initialBrowsePath="My Drive"
          currentUsername="alice"
          groupRootNames={new Set()}
          onSelectedFileChange={onSelectedFileChange}
        />
      </TooltipProvider>,
    );

    expect(document.querySelector(".drive-grid")).toBeTruthy();
    expect(document.querySelector(".destination-list-row")).toBeNull();
    expect(screen.getByText("Studio Assets")).toBeTruthy();
    expect(screen.getByText("Cover-Photo-Granite.jpg")).toBeTruthy();
    expect(screen.queryByText("Autumn Issue — Final Proofs.pdf")).toBeNull();
    expect(screen.queryByText("interview-ada-pereira.m4a")).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.getByRole("group", { name: "View mode" })).toBeTruthy();
  });

  it("navigates folders and single-selects an image in file-select mode", () => {
    const onSelectedFileChange = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <DriveFolderPicker
          mode="file-select"
          labels={driveLabels}
          files={[]}
          groupPaths={[]}
          moveIds={[]}
          initialBrowsePath="My Drive"
          currentUsername="alice"
          groupRootNames={new Set()}
          onSelectedFileChange={onSelectedFileChange}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Studio Assets" }));
    expect(screen.getByText("studio-mark-final.svg")).toBeTruthy();
    expect(screen.queryByText("Brand-Guidelines.pdf")).toBeNull();
    expect(screen.queryByText("Cover-Photo-Granite.jpg")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "studio-mark-final.svg" }));
    expect(onSelectedFileChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "f-logo",
        title: "studio-mark-final.svg",
        apiPath: "/users/alice/Studio Assets/studio-mark-final.svg",
      }),
    );
  });
});
