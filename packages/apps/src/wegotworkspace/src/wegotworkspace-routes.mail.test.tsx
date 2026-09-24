import { cleanup, render, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

function mockDomApis() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      addEventListener: vi.fn(),
      removeListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("unshipped mail routes", () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
  });

  it.each(["/mail", "/mail/inbox"])(
    "redirects %s to home when the shell is served from cache",
    async (path) => {
      const history = createMemoryHistory({ initialEntries: [path] });
      const router = createWeGotWorkspaceRouter({ mode: "mock", history });
      render(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(history.location.pathname).toBe("/");
      });
    },
  );
});
