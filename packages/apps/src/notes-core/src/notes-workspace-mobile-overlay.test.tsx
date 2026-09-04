import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { COLLECTION_DETAIL_OVERLAY_MEDIA_QUERY } from "@/workspace-app/src/collection-detail-breakpoint";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirmDialog: null,
    requestConfirm: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-is-touch", () => ({
  useIsTouch: () => true,
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useRouterState: (opts?: {
      select?: (state: { location: { pathname: string } }) => unknown;
    }) => {
      const state = { location: { pathname: "/notes/all" } };
      return opts?.select ? opts.select(state) : state;
    },
    useNavigate: () => vi.fn(),
  };
});

function stubOverlayViewport() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches:
        query === COLLECTION_DETAIL_OVERLAY_MEDIA_QUERY ||
        query.includes("max-width") ||
        query.includes("pointer: coarse"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      addEventListener: vi.fn(),
      removeListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("notes mobile overlay selection", () => {
  beforeEach(() => {
    stubOverlayViewport();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (callback: () => void | Promise<void>) => {
        void callback();
        return { finished: Promise.resolve() };
      },
    });
  });

  it("opens the tapped note inside the view transition", async () => {
    let runPendingTransition: (() => void) | null = null;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (callback: () => void | Promise<void>) => {
        runPendingTransition = () => {
          void callback();
        };
        return { finished: Promise.resolve() };
      },
    });

    const onNoteChange = vi.fn();
    const bootstrap = createNotesAppBootstrap();
    render(<NotesWorkspace {...bootstrap} listLoading={false} onNoteChange={onNoteChange} />);

    const row = screen.getByRole("button", { name: /Endless scroll/i });
    fireEvent.click(row);

    const pane = screen.getByRole("main");
    expect(runPendingTransition).not.toBeNull();
    expect(pane.getAttribute("data-open")).toBe("false");
    expect(within(pane).queryByText("Select a note")).toBeTruthy();

    // Call after the null check; optional-call is typed as never under Vitest asserts.
    runPendingTransition!();

    expect(pane.getAttribute("data-open")).toBe("true");
    expect(within(pane).queryByText("Select a note")).toBeNull();
    await waitFor(() => {
      expect(onNoteChange).toHaveBeenCalledWith("1");
    });
    expect(within(pane).getByRole("button", { name: "All Items" })).toBeTruthy();
  });

  it("opens the tapped note and updates the path instead of the empty overlay", async () => {
    const onNoteChange = vi.fn();
    const bootstrap = createNotesAppBootstrap();
    render(<NotesWorkspace {...bootstrap} listLoading={false} onNoteChange={onNoteChange} />);

    const row = screen.getByRole("button", { name: /Endless scroll/i });
    expect(row.getAttribute("data-list-item-id")).toBe("1");
    fireEvent.click(row);

    const pane = screen.getByRole("main");
    expect(pane.getAttribute("data-open")).toBe("true");
    await waitFor(() => {
      expect(onNoteChange).toHaveBeenCalledWith("1");
    });
    expect(within(pane).queryByText("Select a note")).toBeNull();
    expect(within(pane).getByRole("button", { name: "All Items" })).toBeTruthy();
  });

  it("clears selection inside the close view transition, not before it", async () => {
    let runPendingTransition: (() => void) | null = null;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (callback: () => void | Promise<void>) => {
        runPendingTransition = () => {
          void callback();
        };
        return { finished: Promise.resolve() };
      },
    });

    const onNoteChange = vi.fn();
    const bootstrap = createNotesAppBootstrap();
    render(
      <NotesWorkspace
        {...bootstrap}
        listLoading={false}
        initialNoteId="1"
        onNoteChange={onNoteChange}
      />,
    );

    const pane = screen.getByRole("main");
    expect(pane.getAttribute("data-open")).toBe("true");
    expect(within(pane).queryByText("Select a note")).toBeNull();

    fireEvent.click(within(pane).getByRole("button", { name: "All Items" }));

    expect(runPendingTransition).not.toBeNull();
    expect(within(pane).queryByText("Select a note")).toBeNull();
    expect(pane.getAttribute("data-open")).toBe("true");

    // Call after the null check; optional-call is typed as never under Vitest asserts.
    runPendingTransition!();

    expect(pane.getAttribute("data-open")).toBe("false");
    expect(within(pane).getByText("Select a note")).toBeTruthy();
    await waitFor(() => {
      expect(onNoteChange).toHaveBeenCalledWith("");
    });
  });
});
