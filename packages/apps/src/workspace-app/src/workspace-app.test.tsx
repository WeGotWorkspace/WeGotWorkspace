import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";

import { WorkspaceApp, type WorkspaceAppHandle } from "./workspace-app";
import { COLLECTION_DETAIL_OVERLAY_MEDIA_QUERY } from "./collection-detail-breakpoint";

function OverlayHarness() {
  const ref = useRef<WorkspaceAppHandle>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.openMobileDetail()}>
        Open detail
      </button>
      <WorkspaceApp
        ref={ref}
        workspaceRoot={{ className: "notes-workspace" }}
        sidebar={() => <aside>Sidebar</aside>}
        list={() => ({
          header: <div>Header</div>,
          listContent: <div>List</div>,
          hasItems: true,
          emptyLabel: "Empty",
        })}
        detail={() => <div>Detail</div>}
      />
    </>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WorkspaceApp mobile detail", () => {
  it("opens the overlay through startViewTransition on a narrow viewport", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === COLLECTION_DETAIL_OVERLAY_MEDIA_QUERY,
      })),
    );
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    render(<OverlayHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open detail" }));

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(screen.getByRole("main").getAttribute("data-open")).toBe("true");
  });

  it("runs the during callback inside startViewTransition", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === COLLECTION_DETAIL_OVERLAY_MEDIA_QUERY,
      })),
    );
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    const during = vi.fn();
    function DuringHarness() {
      const ref = useRef<WorkspaceAppHandle>(null);
      return (
        <>
          <button type="button" onClick={() => ref.current?.openMobileDetail(during)}>
            Open with navigate
          </button>
          <WorkspaceApp
            ref={ref}
            workspaceRoot={{ className: "notes-workspace" }}
            sidebar={() => <aside>Sidebar</aside>}
            list={() => ({
              header: <div>Header</div>,
              listContent: <div>List</div>,
              hasItems: true,
              emptyLabel: "Empty",
            })}
            detail={() => <div>Detail</div>}
          />
        </>
      );
    }

    render(<DuringHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open with navigate" }));

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(during).toHaveBeenCalledOnce();
    expect(screen.getByRole("main").getAttribute("data-open")).toBe("true");
  });

  it("starts the overlay open from a deep-link note path", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    render(
      <WorkspaceApp
        initialDetailOpenMobile
        workspaceRoot={{ className: "notes-workspace" }}
        sidebar={() => <aside>Sidebar</aside>}
        list={() => ({
          header: <div>Header</div>,
          listContent: <div>List</div>,
          hasItems: true,
          emptyLabel: "Empty",
        })}
        detail={() => <div>Detail</div>}
      />,
    );

    expect(screen.getByRole("main").getAttribute("data-open")).toBe("true");
  });

  it("opens immediately on desktop without startViewTransition", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    render(<OverlayHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open detail" }));

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(screen.getByRole("main").getAttribute("data-open")).toBe("true");
  });
});
