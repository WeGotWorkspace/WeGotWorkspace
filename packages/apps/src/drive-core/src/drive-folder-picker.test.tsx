import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveFolderPicker } from "@/drive-core/src/drive-folder-picker";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/lib/files/drive-models";
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

  it("applies Docs rootLabels and drive icons on the Drives root listing", () => {
    render(
      <DriveFolderPicker
        labels={driveLabels}
        files={[]}
        groupPaths={["Groups/administrators"]}
        moveIds={[]}
        initialBrowsePath={DRIVE_FOLDER_PICKER_ROOT}
        currentUsername="alice"
        groupRootNames={new Set(["administrators"])}
        rootLabels={{
          "My Drive": driveLabels.sidebarMyDrive,
          "Groups/administrators": "Administrators",
        }}
        onDestinationChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Personal")).toBeTruthy();
    expect(screen.getByText("Administrators")).toBeTruthy();
    expect(screen.queryByText("My Drive")).toBeNull();
    expect(screen.queryByText("administrators")).toBeNull();
    // Drive roots wear the drive icon on the Drive list (not a plain folder).
    const personalRow = screen.getByText("Personal").closest("tr");
    expect(personalRow?.querySelector(".lucide-hard-drive")).toBeTruthy();
    expect(personalRow?.querySelector(".lucide-folder")).toBeNull();
  });

  it("keeps a chosen drive when moveIds is a new array and nothing is preselected", () => {
    const onDestinationChange = vi.fn();
    const props = {
      labels: driveLabels,
      files: [] as DriveFile[],
      groupPaths: ["Groups/engineering"],
      initialBrowsePath: DRIVE_FOLDER_PICKER_ROOT,
      currentUsername: "alice",
      groupRootNames: new Set(["engineering"]),
      rootLabels: {
        "My Drive": driveLabels.sidebarMyDrive,
        "Groups/engineering": "engineering",
      },
      onDestinationChange,
    };

    const view = render(<DriveFolderPicker {...props} moveIds={[]} />);
    const personal = screen.getByText("Personal").closest("tr");
    expect(personal).toBeTruthy();
    fireEvent.click(personal!);
    expect(onDestinationChange).toHaveBeenCalledWith("My Drive");

    view.rerender(<DriveFolderPicker {...props} moveIds={[]} />);

    expect(screen.getByText("Personal").closest("tr")?.className).toContain(
      "drive-list-row--selected",
    );
    expect(onDestinationChange).toHaveBeenLastCalledWith("My Drive");
  });

  it("preselects initialSelectedPath on the Drives root for create (empty moveIds)", () => {
    const onDestinationChange = vi.fn();
    render(
      <DriveFolderPicker
        labels={driveLabels}
        files={[]}
        groupPaths={["Groups/engineering"]}
        moveIds={[]}
        initialBrowsePath={DRIVE_FOLDER_PICKER_ROOT}
        initialSelectedPath="Groups/engineering"
        currentUsername="alice"
        groupRootNames={new Set(["engineering"])}
        rootLabels={{
          "My Drive": driveLabels.sidebarMyDrive,
          "Groups/engineering": "engineering",
        }}
        onDestinationChange={onDestinationChange}
      />,
    );

    expect(onDestinationChange).toHaveBeenCalledWith("Groups/engineering");
    const row = screen.getByText("engineering").closest("tr");
    expect(row?.className).toContain("drive-list-row--selected");
  });

  it("sets Docs listing theme only when requested", () => {
    const view = render(
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
          onSelectedFileChange={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(document.querySelector("[data-drive-listing-theme]")).toBeNull();

    view.rerender(
      <TooltipProvider delayDuration={0}>
        <DriveFolderPicker
          mode="file-select"
          listingTheme="docs"
          labels={driveLabels}
          files={[]}
          groupPaths={[]}
          moveIds={[]}
          initialBrowsePath="My Drive"
          currentUsername="alice"
          groupRootNames={new Set()}
          onSelectedFileChange={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(document.querySelector('[data-drive-listing-theme="docs"]')).toBeTruthy();
  });

  it("uses the same Drive list as the folder picker in file-select mode and omits non-images", () => {
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

    expect(document.querySelector(".drive-list-table")).toBeTruthy();
    expect(document.querySelector(".drive-grid")).toBeNull();
    expect(screen.getByText("Studio Assets")).toBeTruthy();
    expect(screen.getByText("Cover-Photo-Granite.jpg")).toBeTruthy();
    expect(screen.queryByText("Autumn Issue — Final Proofs.pdf")).toBeNull();
    expect(screen.queryByText("interview-ada-pereira.m4a")).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.queryByRole("group", { name: "View mode" })).toBeNull();
  });

  it("uses drive icons for file-select drive roots and folder icons for nested folders", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <DriveFolderPicker
          mode="file-select"
          labels={driveLabels}
          files={[]}
          groupPaths={[]}
          moveIds={[]}
          initialBrowsePath={DRIVE_FOLDER_PICKER_ROOT}
          currentUsername="alice"
          groupRootNames={new Set()}
          rootLabels={{ "My Drive": driveLabels.sidebarMyDrive }}
          onSelectedFileChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    const personalRow = screen.getByText("Personal").closest("tr");
    expect(personalRow?.querySelector(".lucide-hard-drive")).toBeTruthy();
    expect(personalRow?.querySelector(".lucide-folder")).toBeNull();

    fireEvent.doubleClick(screen.getByText("Personal"));
    const nestedRow = screen.getByText("Studio Assets").closest("tr");
    expect(nestedRow?.querySelector(".lucide-folder")).toBeTruthy();
    expect(nestedRow?.querySelector(".lucide-hard-drive")).toBeNull();
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

    fireEvent.doubleClick(screen.getByText("Studio Assets"));
    expect(screen.getByText("studio-mark-final.svg")).toBeTruthy();
    expect(screen.queryByText("Brand-Guidelines.pdf")).toBeNull();
    expect(screen.queryByText("Cover-Photo-Granite.jpg")).toBeNull();

    fireEvent.click(screen.getByText("studio-mark-final.svg"));
    expect(onSelectedFileChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "f-logo",
        title: "studio-mark-final.svg",
        apiPath: "/users/alice/Studio Assets/studio-mark-final.svg",
      }),
    );
  });
});
