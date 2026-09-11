import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveGridView, DriveListView } from "@/drive-core/src/drive-browser";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/drive-core/src/drive-models";
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
    expect(container.querySelector(".drive-file-tile__preview")).toBeTruthy();

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

  it("shows a checkbox overlay in selection mode", () => {
    const { container } = render(
      <div className="drive-workspace">
        <DriveGridView {...baseBrowserProps({ selectionMode: true, selectedIds: [FILE.id] })} />
      </div>,
    );

    expect(container.querySelector(".drive-file-tile__checkbox")).toBeTruthy();
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

  it("does not render a Files section heading above tiles", () => {
    render(
      <div className="drive-workspace">
        <DriveGridView {...baseBrowserProps()} />
      </div>,
    );
    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
  });

  it("shows drive location under the tile title when enabled", () => {
    render(
      <div className="drive-workspace">
        <DriveGridView
          {...baseBrowserProps({
            showLocationColumn: true,
            items: [{ ...FILE, location: "My Drive" }],
          })}
        />
      </div>,
    );
    expect(screen.getByText("My Drive")).toBeTruthy();
    expect(document.querySelector(".drive-location-label")).toBeTruthy();
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
          items: [{ ...FILE, location: "My Drive" }],
        })}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Location" })).toBeTruthy();
    expect(screen.getByText("My Drive")).toBeTruthy();
  });

  it("shows a checkbox in selection mode", () => {
    const { container } = render(
      <div className="drive-workspace">
        <DriveListView {...baseBrowserProps({ selectionMode: true, selectedIds: [FILE.id] })} />
      </div>,
    );

    expect(container.querySelector(".drive-list-row__checkbox")).toBeTruthy();
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
});
