/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

import {
  forgetDocsLocationsForTest,
  justLocatedDocsPath,
  type DocsLocatorDeps,
} from "@/docs-core/src/docs-document-locator";
import { useDocsRouteDocument } from "@/docs-core/src/use-docs-route-document";
import { useOpenDocsFile } from "@/docs-core/src/use-open-docs-file";

const ID = `fn-${"a".repeat(32)}`;
const PATH = "/users/alice/Roadmap.md";

function locator(overrides: Partial<DocsLocatorDeps> = {}): DocsLocatorDeps {
  return {
    fetchLocation: vi.fn(async () => ({ id: ID, path: PATH })),
    readCachedPath: vi.fn(async () => undefined),
    readCachedNodeId: vi.fn(async () => undefined),
    recordLocation: vi.fn(async () => undefined),
    isOnline: () => true,
    ownedByQueuedWrite: vi.fn(async () => false),
    ...overrides,
  };
}

describe("useOpenDocsFile", () => {
  beforeEach(() => {
    navigate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("navigates to the docs editor in the same tab (no window.open)", () => {
    const open = vi.spyOn(window, "open");
    const { result } = renderHook(() => useOpenDocsFile());

    result.current("/users/alice/Roadmap.md");

    expect(navigate).toHaveBeenCalledWith({
      to: "/docs",
      search: { file: "users/alice/Roadmap.md" },
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("normalizes api paths without a leading slash", () => {
    const { result } = renderHook(() => useOpenDocsFile());

    result.current("users/alice/Roadmap.md");

    expect(navigate).toHaveBeenCalledWith({
      to: "/docs",
      search: { file: "users/alice/Roadmap.md" },
    });
  });

  describe("a row that names its FileNode id (#1976)", () => {
    beforeEach(() => forgetDocsLocationsForTest());

    it("opens ?id= straight away and records where the id lives", async () => {
      const deps = locator();
      const { result } = renderHook(() =>
        useOpenDocsFile({ canOpenById: true, username: "alice", deps }),
      );

      result.current(PATH, ID);

      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({ to: "/docs", search: { id: ID } }),
      );
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(deps.ownedByQueuedWrite).toHaveBeenCalledWith(PATH);
      expect(deps.recordLocation).toHaveBeenCalledWith(ID, PATH);
      expect(justLocatedDocsPath(ID)).toBe(PATH);
    });

    it("hands the route a ready Doc on its first render, without a lookup", async () => {
      const deps = locator();
      const { result: open } = renderHook(() =>
        useOpenDocsFile({ canOpenById: true, username: "alice", deps }),
      );
      open.current(PATH, ID);
      await waitFor(() => expect(navigate).toHaveBeenCalled());

      const { result: route } = renderHook(() =>
        useDocsRouteDocument({
          search: { id: ID },
          canResolve: true,
          username: "alice",
          refreshKey: 0,
          deps,
        }),
      );

      expect(route.current.document).toEqual({ status: "ready", path: PATH, nodeId: ID });
      expect(deps.fetchLocation).not.toHaveBeenCalled();
    });

    it("opens by path when a queued offline write owns the path", async () => {
      const deps = locator({ ownedByQueuedWrite: vi.fn(async () => true) });
      const { result } = renderHook(() =>
        useOpenDocsFile({ canOpenById: true, username: "alice", deps }),
      );

      result.current(PATH, ID);

      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({
          to: "/docs",
          search: { file: "users/alice/Roadmap.md" },
        }),
      );
      expect(deps.recordLocation).not.toHaveBeenCalled();
      expect(justLocatedDocsPath(ID)).toBeUndefined();
    });

    it("opens by path when the queue cannot be read", async () => {
      const deps = locator({ ownedByQueuedWrite: vi.fn(async () => Promise.reject(new Error())) });
      const { result } = renderHook(() =>
        useOpenDocsFile({ canOpenById: true, username: "alice", deps }),
      );

      result.current(PATH, ID);

      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({
          to: "/docs",
          search: { file: "users/alice/Roadmap.md" },
        }),
      );
    });

    it.each([
      ["a guest or mock session", { canOpenById: false }],
      ["the route holds its path lookup", { canOpenById: true, holdPathLookup: true }],
    ])("opens by path for %s", (_label, options) => {
      const deps = locator();
      const { result } = renderHook(() => useOpenDocsFile({ ...options, username: "alice", deps }));

      result.current(PATH, ID);

      expect(navigate).toHaveBeenCalledWith({
        to: "/docs",
        search: { file: "users/alice/Roadmap.md" },
      });
      expect(deps.ownedByQueuedWrite).not.toHaveBeenCalled();
    });
  });
});
