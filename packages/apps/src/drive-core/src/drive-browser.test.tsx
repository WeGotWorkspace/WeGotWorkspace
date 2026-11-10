import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveGridView, DriveListView } from "@/drive-core/src/drive-browser";
import { createDrivePickerRootFile } from "@/drive-core/src/drive-folder-picker-utils";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/lib/files/drive-models";
import "@/drive-core/src/drive-browser.css";

const noop = () => {};

afterEach(() => {
  cleanup();
});

const FILE: DriveFile = {
  id: "1",
  category: "document",
  date: "Now",
  title: "Notes.md",
  excerpt: "",
  body: [],
  notebook: "",
  tags: [],
  wordCount: 0,
  parent: "My Drive",
  kind: "doc",
  size: "2.0 KB",
  apiPath: "/users/alice/Notes.md",
};

function baseBrowserProps(overrides: Partial<Parameters<typeof DriveListView>[0]> = {}) {
  return {
    items: [FILE],
    activeId: null,
    selectedIds: [],
    starred: {},
    filePreviews: {},
    labels: driveLabels,
    inTrash: false,
    selectionMode: false,
    isTouch: false,
    isItemDragging: () => false,
    itemDragHandlers: () => ({ onDragStart: noop, onDragEnd: noop }),
    folderDropZoneProps: () => ({}),
    onSelect: noop,
    onOpen: noop,
    onStar: noop,
    onDownload: noop,
    onRename: noop,
    onMove: noop,
    onTrash: noop,
    onLongPress: noop,
    ...overrides,
  };
}

describe("DriveGridView tile interaction", () => {
  it("uses a full-tile hit target and selects on single click", () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    const { container } = render(
      <div className="drive-workspace">
        <DriveGridView {...baseBrowserProps({ onSelect, onOpen })} />
      </div>,
    );

    const hit = screen.getByRole("button", { name: FILE.title });
    expect(hit.className).toContain("drive-tile__hit");
    expect(container.querySelector(".drive-file-tile__avatar .drive-file-avatar")).toBeTruthy();

    fireEvent.click(hit);
    expect(onSelect).toHaveBeenCalledWith(FILE.id, expect.any(Object));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens on double click", () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(
      <div className="drive-workspace">
        <DriveGridView {...baseBrowserProps({ onSelect, onOpen })} />
      </div>,
    );

    const hit = screen.getByRole("button", { name: FILE.title });
    fireEvent.doubleClick(hit);
    expect(onOpen).toHaveBeenCalledWith(FILE);
  });

  it("does not open on double click while in selection mode", () => {
    const onOpen = vi.fn();
    render(
      <div className="drive-workspace">
        <DriveGridView
          {...baseBrowserProps({ onOpen, selectionMode: true, selectedIds: [FILE.id] })}
        />
      </div>,
    );

    fireEvent.doubleClick(screen.getByRole("button", { name: FILE.title }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("marks selected tiles without a checkbox in selection mode", () => {
    const { container } = render(
      <div className="drive-workspace">
        <DriveGridView {...baseBrowserProps({ selectionMode: true, selectedIds: [FILE.id] })} />
      </div>,
    );

    expect(container.querySelector(".drive-file-tile--selected")).toBeTruthy();
    expect(container.querySelector(".selection-mark")).toBeNull();
  });

  it("shows the selection bar only with multi-select intent", () => {
    const view = (props: { selectionMode: boolean; selectedIds: string[] }) =>
      render(
        <div className="drive-workspace">
          <DriveGridView {...baseBrowserProps(props)} />
        </div>,
      ).container.querySelector<HTMLElement>(".drive-grid-layout")!;

    // A plain click selects one item: no bar.
    expect(view({ selectionMode: false, selectedIds: [FILE.id] }).dataset.multiSelect).toBe(
      "false",
    );
    // Selection mode (long-press, right-click) or Cmd/Shift-click on a second item.
    expect(view({ selectionMode: true, selectedIds: [FILE.id] }).dataset.multiSelect).toBe("true");
    expect(
      view({ selectionMode: false, selectedIds: [FILE.id, "other"] }).dataset.multiSelect,
    ).toBe("true");
  });

  it("enters selection via context menu on desktop", () => {
    const onLongPress = vi.fn();
    render(
      <div className="drive-workspace">
        <DriveGridView {...baseBrowserProps({ onLongPress })} />
      </div>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: FILE.title }));
    expect(onLongPress).toHaveBeenCalledWith(FILE.id);
  });

  it("heads the tiles with the sticky Files bar", () => {
    render(
      <div className="drive-workspace">
        <DriveGridView {...baseBrowserProps()} />
      </div>,
    );
    expect(screen.getByRole("heading", { name: "Files" }).className).toContain("list-head-bar");
  });

  it("leaves the drive out of a tile's details line, even across drives", () => {
    render(
      <div className="drive-workspace">
        <DriveGridView
          {...baseBrowserProps({
            showLocationColumn: true,
            items: [{ ...FILE, location: "Personal" }],
          })}
        />
      </div>,
    );
    expect(screen.queryByText("Personal")).toBeNull();
    expect(screen.getByText(FILE.size)).toBeTruthy();
  });

  it("hides overflow actions and drag in picker chrome", () => {
    const { container } = render(
      <div className="drive-workspace">
        <DriveGridView {...baseBrowserProps({ itemChrome: "picker" })} />
      </div>,
    );

    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    const tile = container.querySelector(".drive-file-tile");
    expect(tile?.getAttribute("draggable")).toBe("false");
  });
});

describe("DriveListView", () => {
  it("renders the Kind column by default", () => {
    render(<DriveListView {...baseBrowserProps()} />);
    expect(screen.getByRole("columnheader", { name: "Kind" })).toBeTruthy();
  });

  it("renders the Location column when enabled", () => {
    render(
      <DriveListView
        {...baseBrowserProps({
          showLocationColumn: true,
          locationColumnLabel: driveLabels.listColumnLocation,
          items: [{ ...FILE, location: "Personal" }],
        })}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Location" })).toBeTruthy();
    expect(screen.getByText("Personal")).toBeTruthy();
  });

  it("marks selected rows without a checkbox in selection mode", () => {
    const { container } = render(
      <div className="drive-workspace">
        <DriveListView {...baseBrowserProps({ selectionMode: true, selectedIds: [FILE.id] })} />
      </div>,
    );

    expect(container.querySelector(".drive-list-row--selected")).toBeTruthy();
    expect(container.querySelector(".selection-mark")).toBeNull();
  });

  it("does not open on double click while in selection mode", () => {
    const onOpen = vi.fn();
    render(
      <div className="drive-workspace">
        <DriveListView
          {...baseBrowserProps({ onOpen, selectionMode: true, selectedIds: [FILE.id] })}
        />
      </div>,
    );

    fireEvent.doubleClick(screen.getByText(FILE.title).closest("tr")!);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("enters selection via context menu on desktop", () => {
    const onLongPress = vi.fn();
    render(
      <div className="drive-workspace">
        <DriveListView {...baseBrowserProps({ onLongPress })} />
      </div>,
    );

    fireEvent.contextMenu(screen.getByText(FILE.title).closest("tr")!);
    expect(onLongPress).toHaveBeenCalledWith(FILE.id);
  });

  it("hides the actions column in picker chrome", () => {
    render(
      <div className="drive-workspace">
        <DriveListView {...baseBrowserProps({ itemChrome: "picker" })} />
      </div>,
    );

    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  it("uses a drive icon for picker drive roots and a folder icon for nested folders", () => {
    const root = createDrivePickerRootFile("My Drive", "Personal");
    const nested: DriveFile = { ...FILE, id: "folder-1", title: "Assets", kind: "folder" };
    const { container } = render(
      <div className="drive-workspace">
        <DriveListView {...baseBrowserProps({ items: [root, nested], itemChrome: "picker" })} />
      </div>,
    );

    const personalRow = screen.getByText("Personal").closest("tr");
    expect(personalRow?.querySelector(".lucide-hard-drive")).toBeTruthy();
    expect(personalRow?.querySelector(".lucide-folder")).toBeNull();
    const nestedRow = screen.getByText("Assets").closest("tr");
    expect(nestedRow?.querySelector(".lucide-folder")).toBeTruthy();
    expect(nestedRow?.querySelector(".lucide-hard-drive")).toBeNull();
    expect(container.querySelector(".drive-list-view")).toBeTruthy();
  });
});

describe("upload placeholders", () => {
  const FAILED: DriveFile = {
    ...FILE,
    id: "/users/alice/\u0000upload:u1",
    title: "huge.bin",
    kind: "file",
    upload: { id: "u1", status: "failed", reason: "too_large" },
  };
  const QUEUED: DriveFile = {
    ...FILE,
    id: "/users/alice/\u0000upload:u2",
    title: "waiting.txt",
    upload: { id: "u2", status: "queued" },
  };
  const remove = { id: "upload-remove", label: "Remove", icon: null, onClick: noop };

  it.each([
    ["grid", DriveGridView],
    ["list", DriveListView],
  ] as const)(
    "shows the ring in the offline slot, the status, and a menu in %s view",
    (_, View) => {
      render(
        <div className="drive-workspace">
          <View
            {...baseBrowserProps({
              items: [FAILED, QUEUED],
              offlineEnabled: true,
              canPinOffline: true,
              onMakeOfflineAvailable: noop,
              extraFileActions: () => [remove],
            })}
          />
        </div>,
      );

      expect(screen.getByText("Upload failed · Too large to upload")).toBeTruthy();
      expect(screen.getByText("Waiting to upload")).toBeTruthy();
      expect(screen.queryByRole("button", { name: driveLabels.offlineMakeAvailable })).toBeNull();
      const ring = screen.getByRole("progressbar", { name: "Upload of waiting.txt" });
      expect(ring.getAttribute("aria-valuetext")).toBe("Waiting to upload");
      expect(ring.hasAttribute("aria-valuenow")).toBe(false);
      expect(
        screen.getByRole("img", { name: "huge.bin: Upload failed · Too large to upload" }),
      ).toBeTruthy();
      // Both get a menu: Remove, plus the server-only actions shown disabled.
      expect(screen.getAllByRole("button", { name: "More actions" })).toHaveLength(2);
    },
  );

  it("adds the ring column to a list without the offline column", () => {
    render(
      <div className="drive-workspace">
        <DriveListView {...baseBrowserProps({ items: [FILE, QUEUED], offlineEnabled: false })} />
      </div>,
    );
    expect(screen.getByRole("progressbar", { name: "Upload of waiting.txt" })).toBeTruthy();
  });
});
