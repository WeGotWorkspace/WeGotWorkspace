import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";
import { useAdminShell } from "@/admin-core/src/use-admin-shell";

function mockMatchMedia(matches = false) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe("useAdminShell section routing", () => {
  beforeEach(() => {
    mockMatchMedia();
  });

  it("defaults to users when the section is uncontrolled", () => {
    const { data } = createAdminAppBootstrap();
    const { result } = renderHook(() => useAdminShell({ data }));
    expect(result.current.section).toBe("users");
    expect(result.current.currentSection.id).toBe("users");
  });

  it("honors initialSection when uncontrolled", () => {
    const { data } = createAdminAppBootstrap();
    const { result } = renderHook(() => useAdminShell({ data, initialSection: "plugins" }));
    expect(result.current.section).toBe("plugins");
  });

  it("follows a controlled section and reports sidebar picks", () => {
    const { data } = createAdminAppBootstrap();
    const onSectionChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ section }: { section: "users" | "mail" }) =>
        useAdminShell({ data, section, onSectionChange }),
      { initialProps: { section: "users" as const } },
    );

    expect(result.current.section).toBe("users");

    act(() => {
      result.current.selectSection("mail");
    });

    expect(onSectionChange).toHaveBeenCalledWith("mail");
    expect(result.current.section).toBe("users");

    rerender({ section: "mail" });
    expect(result.current.section).toBe("mail");
    expect(result.current.currentSection.id).toBe("mail");
  });
});
