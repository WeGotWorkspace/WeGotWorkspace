import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
import { SettingsDialogProvider } from "@/settings-core/src/settings-dialog-provider";
import {
  reachabilityFromShell,
  SettingsReachabilityProvider,
} from "@/settings-core/src/settings-reachability";
import { resetSettingsRegistryForTests } from "@/settings-core/src/settings-registry";
import { settingsSectionFromLocation } from "@/settings-core/src/settings-section";
import type { BuiltinPanelId } from "@/settings-core/src/settings-types";
import type { SettingsDialogApi } from "@/settings-core/src/settings-dialog-provider";
import { SettingsWorkspace } from "@/settings-core/src/settings-workspace";
import { WorkspaceAppSettingsSidebarSection } from "@/settings-core/src/workspace-app-settings-sidebar";
import { TooltipProvider } from "@/ui/tooltip";

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

function SettingsFromLocation() {
  const location = useLocation();
  const section = settingsSectionFromLocation(location.pathname);
  return <SettingsWorkspace {...createSettingsAppBootstrap()} section={section} />;
}

async function renderHosted(ui: ReactNode, initialPath = "/host") {
  registerBuiltinSettings();
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const rootRoute = createRootRoute({
    component: () => (
      <TooltipProvider delayDuration={0}>
        <SettingsReachabilityProvider value={reachabilityFromShell({})}>
          <SettingsDialogProvider>
            <Outlet />
          </SettingsDialogProvider>
        </SettingsReachabilityProvider>
      </TooltipProvider>
    ),
  });
  const hostRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/host",
    component: () => <>{ui}</>,
  });
  const notesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/notes",
    component: () => <>{ui}</>,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: SettingsFromLocation,
  });
  const settingsSectionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: SettingsFromLocation,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([hostRoute, notesRoute, settingsRoute, settingsSectionRoute]),
    history,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return { history, router };
}

function sidebarSettingsButton() {
  return screen.queryByRole("button", { name: "Settings" });
}

function dialogFooterCancelButton() {
  const footer = document.querySelector(".ui-modal-footer");
  if (!(footer instanceof HTMLElement)) {
    throw new Error("dialog footer not found");
  }
  return within(footer).getByRole("button", { name: "Cancel" });
}

describe("settings dialog and the in-app sidebar row", () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
    resetSettingsRegistryForTests();
    registerBuiltinSettings();
  });

  afterEach(() => {
    cleanup();
    resetSettingsRegistryForTests();
  });

  it("opens Calendar in the dialog from the sidebar row", async () => {
    await renderHosted(<WorkspaceAppSettingsSidebarSection appId="calendar" />);
    const settingsButton = sidebarSettingsButton();
    expect(settingsButton).toBeTruthy();
    settingsButton!.focus();
    fireEvent.click(settingsButton!);

    expect(await screen.findByRole("heading", { name: "Calendar" })).toBeTruthy();
    expect(await screen.findByRole("combobox", { name: "Timezone" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Week starts on" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Visible hours" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Day starts on" })).toBeNull();
    expect(screen.queryByText("Display")).toBeNull();
    expect(
      document.querySelector(".ui-modal-surface.settings-workspace .settings-pane-card"),
    ).toBeTruthy();
    const footer = document.querySelector(".ui-modal-footer");
    expect(footer).toBeInstanceOf(HTMLElement);
    expect(
      within(footer as HTMLElement).getByRole("button", { name: "Open in Settings" }),
    ).toBeTruthy();
    expect(within(footer as HTMLElement).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(await within(footer as HTMLElement).findByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /working hours/i })).toBeNull();
  });

  it("puts Settings last in the first Notes sidebar section, not in the footer", async () => {
    const bootstrap = createNotesAppBootstrap();
    await renderHosted(
      <NotesWorkspace {...bootstrap} listLoading={false} onLogout={() => undefined} />,
      "/notes",
    );
    const settings = sidebarSettingsButton();
    expect(settings).toBeTruthy();
    const firstSection = document.querySelector(".app-sidebar .sidebar-section");
    const rows = Array.from(firstSection?.querySelectorAll("button, a") ?? []);
    expect(rows.at(-1)).toBe(settings);
    expect(settings!.closest(".workspace-sidebar-account-footer")).toBeNull();
  });

  it("hides the Settings row for Drive", async () => {
    await renderHosted(<WorkspaceAppSettingsSidebarSection appId="drive" />);
    expect(sidebarSettingsButton()).toBeNull();
  });

  it("restores focus to the sidebar Settings row on dismiss", async () => {
    await renderHosted(<WorkspaceAppSettingsSidebarSection appId="calendar" />);
    const settingsButton = sidebarSettingsButton();
    expect(settingsButton).toBeTruthy();
    settingsButton!.focus();
    fireEvent.click(settingsButton!);
    expect(await screen.findByRole("button", { name: "Open in Settings" })).toBeTruthy();

    fireEvent.click(dialogFooterCancelButton());
    await waitFor(() => {
      expect(sidebarSettingsButton()).toBe(document.activeElement);
    });
  });

  it("does not restore focus to an unmounted opener after Open in Settings", async () => {
    await renderHosted(<WorkspaceAppSettingsSidebarSection appId="calendar" />);
    const settingsButton = sidebarSettingsButton();
    expect(settingsButton).toBeTruthy();
    settingsButton!.focus();
    fireEvent.click(settingsButton!);
    fireEvent.click(await screen.findByRole("button", { name: "Open in Settings" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Open in Settings" })).toBeNull();
      const heading = document.querySelector(
        ".workspace-app-layout__main-header .view-header__title",
      );
      expect(heading).toBeInstanceOf(HTMLElement);
      expect(heading?.textContent).toContain("Calendar");
      expect(document.activeElement).toBe(heading);
    });
    expect(sidebarSettingsButton()).toBeNull();
  });
});

describe("openPanel typing", () => {
  it("accepts BuiltinPanelId and rejects a typo at the type level", () => {
    type OpenPanelId = Parameters<SettingsDialogApi["openPanel"]>[0];
    const calendar: OpenPanelId = "calendar";
    expect(calendar).toBe("calendar");
    // @ts-expect-error "calender" is not a BuiltinPanelId
    const typo: OpenPanelId = "calender";
    void typo;
    const _assert: OpenPanelId extends BuiltinPanelId ? true : false = true;
    expect(_assert).toBe(true);
  });
});
