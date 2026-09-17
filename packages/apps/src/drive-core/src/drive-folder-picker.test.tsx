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
    expect(row?.className).toContain("destination-list-row--selected");
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

    const personal = screen.getByRole("button", { name: "Personal" });
    expect(
      personal.closest(".drive-folder-tile")?.querySelector(".lucide-hard-drive"),
    ).toBeTruthy();
    expect(personal.closest(".drive-folder-tile")?.querySelector(".lucide-folder")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: driveLabels.listView }));
    const personalRow = screen.getByText("Personal").closest("tr");
    expect(personalRow?.querySelector(".lucide-hard-drive")).toBeTruthy();
    expect(personalRow?.querySelector(".lucide-folder")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: driveLabels.gridView }));
    fireEvent.click(screen.getByRole("button", { name: "Personal" }));
    const nested = screen.getByRole("button", { name: "Studio Assets" });
    expect(nested.closest(".drive-folder-tile")?.querySelector(".lucide-folder")).toBeTruthy();
    expect(nested.closest(".drive-folder-tile")?.querySelector(".lucide-hard-drive")).toBeNull();
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
