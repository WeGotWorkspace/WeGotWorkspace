/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type { DocsLocatorDeps } from "@/docs-core/src/docs-document-locator";
import { forgetDocsLocationsForTest } from "@/docs-core/src/docs-document-locator";
import type { DocsRouteSearch } from "@/docs-core/src/docs-route-search";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

import { useDocsRouteDocument } from "@/docs-core/src/use-docs-route-document";

const ID = `fn-${"a".repeat(32)}`;
const PATH = "/users/alice/Roadmap.md";

function deps(overrides: Partial<DocsLocatorDeps> = {}): DocsLocatorDeps {
  return {
    fetchLocation: vi.fn(async () => ({ id: ID, path: PATH })),
    readCachedPath: vi.fn(async () => undefined),
    readCachedNodeId: vi.fn(async () => undefined),
    recordLocation: vi.fn(async () => undefined),
    isOnline: () => true,
    ...overrides,
  };
}

function render(search: DocsRouteSearch, locator: DocsLocatorDeps, canResolve = true) {
  return renderHook(
    ({ search: current, refreshKey }) =>
      useDocsRouteDocument({
        search: current,
        canResolve,
        username: "alice",
        refreshKey,
        deps: locator,
      }),
    { initialProps: { search, refreshKey: 0 } },
  );
}

describe("useDocsRouteDocument", () => {
  beforeEach(() => {
    navigate.mockReset();
    forgetDocsLocationsForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows Docs home without id or file", () => {
    const { result } = render({}, deps());
    expect(result.current.document).toEqual({ status: "home" });
  });

  it("waits for a file link's id before opening, then swaps in the id", async () => {
    const locator = deps();
    const { result } = render({ file: "users/alice/Roadmap.md" }, locator);

    // The editor's local copy is keyed by id: it must not open on the path first.
    expect(result.current.document).toEqual({ status: "resolving" });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/docs", search: { id: ID }, replace: true }),
    );
    expect(locator.fetchLocation).toHaveBeenCalledWith({ path: PATH }, expect.anything());
  });

  it("opens the swapped-in id without a loading state", async () => {
    const locator = deps();
    const { result, rerender } = render({ file: "users/alice/Roadmap.md" }, locator);
    await waitFor(() => expect(navigate).toHaveBeenCalled());

    rerender({ search: { id: ID }, refreshKey: 0 });
    expect(result.current.document).toEqual({ status: "ready", path: PATH, nodeId: ID });
  });

  it("does not look the swapped-in id up again", async () => {
    const locator = deps();
    const { result, rerender } = render({ file: "users/alice/Roadmap.md" }, locator);
    await waitFor(() => expect(navigate).toHaveBeenCalled());

    rerender({ search: { id: ID }, refreshKey: 0 });
    await act(async () => {});
    expect(result.current.document).toEqual({ status: "ready", path: PATH, nodeId: ID });
    expect(locator.fetchLocation).toHaveBeenCalledTimes(1);

    // A later refresh still asks the server.
    rerender({ search: { id: ID }, refreshKey: 1 });
    await waitFor(() => expect(locator.fetchLocation).toHaveBeenCalledTimes(2));
  });

  it("resolves an id to its current path", async () => {
    const { result } = render({ id: ID }, deps());

    expect(result.current.document).toEqual({ status: "resolving", nodeId: ID });
    await waitFor(() =>
      expect(result.current.document).toEqual({ status: "ready", path: PATH, nodeId: ID }),
    );
  });

  it("id wins over file", async () => {
    const locator = deps();
    const { result } = render({ id: ID, file: "users/alice/Other.md" }, locator);
    await waitFor(() => expect(result.current.document).toMatchObject({ path: PATH }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows not found when the server has no readable file", async () => {
    const locator = deps({
      fetchLocation: vi.fn(async () => {
        throw new WgwRequestError("GET /files/node failed (404)", 404);
      }),
      readCachedPath: vi.fn(async () => PATH),
    });
    const { result } = render({ id: ID }, locator);

    await waitFor(() =>
      expect(result.current.document).toEqual({
        status: "not-found",
        nodeId: ID,
        offline: false,
      }),
    );
    // A 403/404 is the answer: the cache must not reopen a deleted or unshared Doc.
    expect(locator.readCachedPath).not.toHaveBeenCalled();
  });

  it("falls back to the cached path when the network fails", async () => {
    const locator = deps({
      fetchLocation: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
      readCachedPath: vi.fn(async () => PATH),
    });
    const { result } = render({ id: ID }, locator);

    await waitFor(() =>
      expect(result.current.document).toEqual({ status: "ready", path: PATH, nodeId: ID }),
    );
  });

  it("opens an id from the cache offline without calling the server", async () => {
    const locator = deps({ isOnline: () => false, readCachedPath: vi.fn(async () => PATH) });
    const { result } = render({ id: ID }, locator);

    await waitFor(() => expect(result.current.document).toMatchObject({ status: "ready" }));
    expect(locator.fetchLocation).not.toHaveBeenCalled();
  });

  it("says offline when an id is unknown and the server is unreachable", async () => {
    const { result } = render({ id: ID }, deps({ isOnline: () => false }));

    await waitFor(() =>
      expect(result.current.document).toEqual({ status: "not-found", nodeId: ID, offline: true }),
    );
  });

  it("opens the file link by path when offline and the id is unknown", async () => {
    const locator = deps({ isOnline: () => false });
    const { result } = render({ file: "users/alice/Roadmap.md" }, locator);

    await waitFor(() => expect(result.current.document).toEqual({ status: "ready", path: PATH }));
    expect(locator.readCachedNodeId).toHaveBeenCalledWith(PATH);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens the file link by path when the server has no such file", async () => {
    const fetchLocation = vi.fn<DocsLocatorDeps["fetchLocation"]>(async () => {
      throw new WgwRequestError("not found", 404);
    });
    const { result } = render({ file: "users/alice/Roadmap.md" }, deps({ fetchLocation }));

    await waitFor(() => expect(result.current.document).toEqual({ status: "ready", path: PATH }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("swaps in the id after reconnecting when the file link opened offline", async () => {
    let online = false;
    const locator = deps({ isOnline: () => online });
    const { rerender } = render({ file: "users/alice/Roadmap.md" }, locator);
    await waitFor(() => expect(locator.readCachedNodeId).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();

    online = true;
    rerender({ search: { file: "users/alice/Roadmap.md" }, refreshKey: 1 });

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/docs", search: { id: ID }, replace: true }),
    );
  });

  it("does not resolve for guests", async () => {
    const locator = deps();
    const { result } = render({ file: "users/bob/Shared/report.md" }, locator, false);

    expect(result.current.document).toEqual({
      status: "ready",
      path: "/users/bob/Shared/report.md",
    });
    await act(async () => {});
    expect(locator.fetchLocation).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("follows a rename elsewhere on the next refresh", async () => {
    const fetchLocation = vi.fn(async () => ({ id: ID, path: PATH }));
    const { result, rerender } = render({ id: ID }, deps({ fetchLocation }));
    await waitFor(() => expect(result.current.document).toMatchObject({ path: PATH }));

    fetchLocation.mockResolvedValue({ id: ID, path: "/users/alice/Plans/Roadmap 2027.md" });
    rerender({ search: { id: ID }, refreshKey: 1 });

    await waitFor(() =>
      expect(result.current.document).toEqual({
        status: "ready",
        path: "/users/alice/Plans/Roadmap 2027.md",
        nodeId: ID,
      }),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("re-checks when the tab is shown again", async () => {
    const fetchLocation = vi.fn(async () => ({ id: ID, path: PATH }));
    const { result } = render({ id: ID }, deps({ fetchLocation }));
    await waitFor(() => expect(result.current.document).toMatchObject({ path: PATH }));

    fetchLocation.mockResolvedValue({ id: ID, path: "/users/alice/Moved.md" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() =>
      expect(result.current.document).toMatchObject({ path: "/users/alice/Moved.md" }),
    );
  });

  it("keeps an open Doc mounted when a re-check says it is gone", async () => {
    const fetchLocation = vi.fn(async () => ({ id: ID, path: PATH }));
    const { result, rerender } = render({ id: ID }, deps({ fetchLocation }));
    await waitFor(() => expect(result.current.document).toMatchObject({ path: PATH }));

    fetchLocation.mockRejectedValue(new WgwRequestError("gone", 404));
    rerender({ search: { id: ID }, refreshKey: 1 });
    await waitFor(() => expect(fetchLocation).toHaveBeenCalledTimes(2));
    await act(async () => {});

    expect(result.current.document).toEqual({ status: "ready", path: PATH, nodeId: ID });
  });

  it("followPath moves an id route to the renamed path without navigating", async () => {
    const { result } = render({ id: ID }, deps());
    await waitFor(() => expect(result.current.document).toMatchObject({ path: PATH }));

    act(() => result.current.followPath("/users/alice/Renamed.md"));

    expect(result.current.document).toEqual({
      status: "ready",
      path: "/users/alice/Renamed.md",
      nodeId: ID,
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("followPath on a file route navigates to the new path", () => {
    const { result } = render({ file: "users/alice/Roadmap.md" }, deps(), false);

    act(() => result.current.followPath("/users/alice/Renamed.md"));

    expect(navigate).toHaveBeenCalledWith({
      to: "/docs",
      search: { file: "users/alice/Renamed.md" },
    });
  });

  it("retry re-resolves after not found", async () => {
    const fetchLocation = vi.fn<DocsLocatorDeps["fetchLocation"]>(async () => {
      throw new WgwRequestError("not found", 404);
    });
    const { result } = render({ id: ID }, deps({ fetchLocation }));
    await waitFor(() => expect(result.current.document).toMatchObject({ status: "not-found" }));

    fetchLocation.mockResolvedValue({ id: ID, path: PATH });
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.document).toMatchObject({ status: "ready" }));
  });

  it("records every location the server answers, before the Doc opens", async () => {
    const locator = deps();
    const { result } = render({ id: ID }, locator);
    await waitFor(() => expect(result.current.document).toMatchObject({ status: "ready" }));
    expect(locator.recordLocation).toHaveBeenCalledWith(ID, PATH);
  });

  it("relocate moves an open Doc to where its id lives now", async () => {
    const fetchLocation = vi.fn(async () => ({ id: ID, path: PATH }));
    const { result } = render({ id: ID }, deps({ fetchLocation }));
    await waitFor(() => expect(result.current.document).toMatchObject({ path: PATH }));

    fetchLocation.mockResolvedValue({ id: ID, path: "/users/alice/Moved.md" });
    let moved: boolean | undefined;
    await act(async () => {
      moved = await result.current.relocate();
    });

    expect(moved).toBe(true);
    expect(result.current.document).toEqual({
      status: "ready",
      path: "/users/alice/Moved.md",
      nodeId: ID,
    });
  });

  it("relocate says not moved when the id is still here or gone", async () => {
    const fetchLocation = vi.fn<DocsLocatorDeps["fetchLocation"]>(async () => ({
      id: ID,
      path: PATH,
    }));
    const { result } = render({ id: ID }, deps({ fetchLocation }));
    await waitFor(() => expect(result.current.document).toMatchObject({ path: PATH }));

    await expect(result.current.relocate()).resolves.toBe(false);
    fetchLocation.mockRejectedValue(new WgwRequestError("gone", 404));
    await expect(result.current.relocate()).resolves.toBe(false);
    expect(result.current.document).toEqual({ status: "ready", path: PATH, nodeId: ID });
  });

  it("relocate does nothing on a file route", async () => {
    const locator = deps();
    const { result } = render({ file: "users/alice/Roadmap.md" }, locator, false);
    await expect(result.current.relocate()).resolves.toBe(false);
    expect(locator.fetchLocation).not.toHaveBeenCalled();
  });
});
