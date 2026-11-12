/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import { useDriveController } from "@/drive-core/src/use-drive-controller";
import { createDriveAppBootstrap } from "@/lib/api/mock/drive-bootstrap";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-is-touch", () => ({
  useIsTouch: () => false,
}));

vi.mock("@/hooks/use-selection-reset-on-key-change", () => ({
  useSelectionResetOnKeyChange: () => {},
}));

vi.mock("@/drive-core/src/use-persisted-drive-view-mode", () => ({
  usePersistedDriveViewMode: () => ["grid", vi.fn()] as const,
}));

vi.mock("@/drive-core/src/use-drive-grid-previews", () => ({
  useDriveGridPreviews: () => ({ filePreviews: {}, richPreviews: {} }),
}));

function dispatchKeydown(init: KeyboardEventInit, options?: { target?: EventTarget | null }) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  if (options?.target) {
    Object.defineProperty(event, "target", { value: options.target, configurable: true });
  }
  window.dispatchEvent(event);
}

/** Suite list keymap: F2 renames (Enter opens). */
function dispatchRenameKey(options?: { target?: EventTarget | null }) {
  dispatchKeydown({ key: "F2" }, options);
}

function dispatchDetailPanelToggle(options?: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  target?: EventTarget | null;
}) {
  dispatchKeydown(
    {
      key: "i",
      metaKey: options?.metaKey ?? true,
      ctrlKey: options?.ctrlKey ?? false,
    },
    options,
  );
}

describe("useDriveController F2 rename shortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens rename dialog for the active file on F2", () => {
    const bootstrap = createDriveAppBootstrap();
    const file = DRIVE_MOCK_FILES.find((entry) => entry.id === "f1")!;
    const { result } = renderHook(() =>
      useDriveController({
        data: bootstrap.data,
        session: bootstrap.session,
        operations: undefined,
      }),
    );

    act(() => {
      result.current.setFiles(DRIVE_MOCK_FILES);
      result.current.setActiveId(file.id);
      result.current.setSelectedIds([file.id]);
    });

    act(() => {
      dispatchRenameKey();
    });

    expect(result.current.renameDialog).toEqual({
      id: file.id,
      extension: ".pdf",
    });
    expect(result.current.renameName).toBe("Autumn Issue — Final Proofs");
  });

  it("opens rename dialog for a single selected folder on F2", () => {
    const bootstrap = createDriveAppBootstrap();
    const folder = DRIVE_MOCK_FILES.find((entry) => entry.kind === "folder")!;
    const { result } = renderHook(() =>
      useDriveController({
        data: bootstrap.data,
        session: bootstrap.session,
        operations: undefined,
      }),
    );

    act(() => {
      result.current.setFiles(DRIVE_MOCK_FILES);
      result.current.setActiveId(folder.id);
      result.current.setSelectedIds([folder.id]);
    });

    act(() => {
      dispatchRenameKey();
    });

    expect(result.current.renameDialog).toEqual({ id: folder.id, extension: "" });
    expect(result.current.renameName).toBe(folder.title);
  });

  it("does not open rename dialog when multiple files are selected", () => {
    const bootstrap = createDriveAppBootstrap();
    const [first, second] = DRIVE_MOCK_FILES.filter((entry) => entry.kind !== "folder");
    const { result } = renderHook(() =>
      useDriveController({
        data: bootstrap.data,
        session: bootstrap.session,
        operations: undefined,
      }),
    );

    act(() => {
      result.current.setFiles(DRIVE_MOCK_FILES);
      result.current.setActiveId(first!.id);
      result.current.setSelectedIds([first!.id, second!.id]);
      result.current.setSelectionMode(true);
    });

    act(() => {
      dispatchRenameKey();
    });

    expect(result.current.renameDialog).toBeNull();
  });

  it("does not open rename dialog while focus is in an input field", () => {
    const bootstrap = createDriveAppBootstrap();
    const file = DRIVE_MOCK_FILES.find((entry) => entry.id === "f1")!;
    const { result } = renderHook(() =>
      useDriveController({
        data: bootstrap.data,
        session: bootstrap.session,
        operations: undefined,
      }),
    );
    const input = document.createElement("input");
    document.body.appendChild(input);

    act(() => {
      result.current.setFiles(DRIVE_MOCK_FILES);
      result.current.setActiveId(file.id);
      result.current.setSelectedIds([file.id]);
    });

    act(() => {
      dispatchRenameKey({ target: input });
    });

    expect(result.current.renameDialog).toBeNull();
    input.remove();
  });
});

describe("useDriveController detail panel toggle shortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the detail panel on Cmd+I when a file is active", () => {
    const bootstrap = createDriveAppBootstrap();
    const file = DRIVE_MOCK_FILES.find((entry) => entry.id === "f1")!;
    const { result } = renderHook(() =>
      useDriveController({
        data: bootstrap.data,
        session: bootstrap.session,
        operations: undefined,
      }),
    );

    act(() => {
      result.current.setFiles(DRIVE_MOCK_FILES);
      result.current.setActiveId(file.id);
      result.current.setSelectedIds([file.id]);
    });

    act(() => {
      dispatchDetailPanelToggle();
    });

    expect(result.current.detailOpen).toBe(true);
  });

  it("closes the detail panel on a second Cmd+I", () => {
    const bootstrap = createDriveAppBootstrap();
    const file = DRIVE_MOCK_FILES.find((entry) => entry.id === "f1")!;
    const { result } = renderHook(() =>
      useDriveController({
        data: bootstrap.data,
        session: bootstrap.session,
        operations: undefined,
      }),
    );

    act(() => {
      result.current.setFiles(DRIVE_MOCK_FILES);
      result.current.setActiveId(file.id);
      result.current.setSelectedIds([file.id]);
      result.current.setDetailOpen(true);
    });

    act(() => {
      dispatchDetailPanelToggle();
    });

    expect(result.current.detailOpen).toBe(false);
  });

  it("activates the selected file when opening the detail panel without an active file", () => {
    const bootstrap = createDriveAppBootstrap();
    const file = DRIVE_MOCK_FILES.find((entry) => entry.id === "f1")!;
    const { result } = renderHook(() =>
      useDriveController({
        data: bootstrap.data,
        session: bootstrap.session,
        operations: undefined,
      }),
    );

    act(() => {
      result.current.setFiles(DRIVE_MOCK_FILES);
      result.current.setSelectedIds([file.id]);
    });

    act(() => {
      dispatchDetailPanelToggle();
    });

    expect(result.current.activeId).toBe(file.id);
    expect(result.current.detailOpen).toBe(true);
  });

  it("supports Ctrl+I on non-mac platforms", () => {
    const bootstrap = createDriveAppBootstrap();
    const file = DRIVE_MOCK_FILES.find((entry) => entry.id === "f1")!;
    const { result } = renderHook(() =>
      useDriveController({
        data: bootstrap.data,
        session: bootstrap.session,
        operations: undefined,
      }),
    );

    act(() => {
      result.current.setFiles(DRIVE_MOCK_FILES);
      result.current.setActiveId(file.id);
      result.current.setSelectedIds([file.id]);
    });

    act(() => {
      dispatchDetailPanelToggle({ metaKey: false, ctrlKey: true });
    });

    expect(result.current.detailOpen).toBe(true);
  });

  it("does not toggle the detail panel while focus is in an input field", () => {
    const bootstrap = createDriveAppBootstrap();
    const file = DRIVE_MOCK_FILES.find((entry) => entry.id === "f1")!;
    const { result } = renderHook(() =>
      useDriveController({
        data: bootstrap.data,
        session: bootstrap.session,
        operations: undefined,
      }),
    );
    const input = document.createElement("input");
    document.body.appendChild(input);

    act(() => {
      result.current.setFiles(DRIVE_MOCK_FILES);
      result.current.setActiveId(file.id);
      result.current.setSelectedIds([file.id]);
    });

    act(() => {
      dispatchDetailPanelToggle({ target: input });
    });

    expect(result.current.detailOpen).toBe(false);
    input.remove();
  });
});
