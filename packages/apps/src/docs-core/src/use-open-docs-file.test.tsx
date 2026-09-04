/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
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

import { useOpenDocsFile } from "@/docs-core/src/use-open-docs-file";

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
});
