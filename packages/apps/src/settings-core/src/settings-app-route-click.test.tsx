import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(() => "toast-1"),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
}));

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
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Element.prototype.scrollIntoView = vi.fn();
}

async function renderSettingsApp(initialPath: string) {
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createWeGotWorkspaceRouter({ mode: "mock", history });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "Profile" });
  return { history, router };
}

describe("SettingsApp sidebar click → URL", { timeout: 15_000 }, () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
  });

  it("writes the section into the URL and restores it from a deep link", async () => {
    const { history } = await renderSettingsApp("/settings");
    expect(history.location.pathname).toBe("/settings");
    expect(screen.getByRole("heading", { name: "Profile" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mail" }));
    await waitFor(() => {
      expect(history.location.pathname).toBe("/settings/mail");
    });
    expect(screen.getByRole("heading", { name: "Mail" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Offline" }));
    await waitFor(() => {
      expect(history.location.pathname).toBe("/settings/offline");
    });
    expect(screen.getByRole("heading", { name: "Offline" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    await waitFor(() => {
      expect(history.location.pathname).toBe("/settings");
    });
    expect(screen.getByRole("heading", { name: "Profile" })).toBeTruthy();

    cleanup();
    await renderSettingsApp("/settings/memberships");
    expect(screen.getByRole("heading", { name: "Memberships" })).toBeTruthy();
  });

  it("moves between sections with browser back and forward", async () => {
    const { history } = await renderSettingsApp("/settings");

    fireEvent.click(screen.getByRole("button", { name: "Mail" }));
    await waitFor(() => {
      expect(history.location.pathname).toBe("/settings/mail");
    });

    fireEvent.click(screen.getByRole("button", { name: "Offline" }));
    await waitFor(() => {
      expect(history.location.pathname).toBe("/settings/offline");
    });

    history.back();
    await waitFor(() => {
      expect(history.location.pathname).toBe("/settings/mail");
    });
    expect(screen.getByRole("heading", { name: "Mail" })).toBeTruthy();

    history.forward();
    await waitFor(() => {
      expect(history.location.pathname).toBe("/settings/offline");
    });
    expect(screen.getByRole("heading", { name: "Offline" })).toBeTruthy();
  });

  it("does not snap back to Settings after navigating to another app", async () => {
    const { history, router } = await renderSettingsApp("/settings/mail");

    await router.navigate({ to: "/contacts" });

    await waitFor(() => {
      expect(history.location.pathname.startsWith("/contacts")).toBe(true);
      expect(history.location.pathname.startsWith("/settings")).toBe(false);
    });
  });
});
