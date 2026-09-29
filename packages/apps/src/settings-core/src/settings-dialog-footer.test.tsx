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
import { createMailAppBootstrap } from "@/lib/api/mock/mail-bootstrap";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import { MailWorkspace } from "@/mail-core/src/mail-workspace";
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
import { WorkspaceAppSettingsFooter } from "@/settings-core/src/workspace-app-settings-footer";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
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

async function renderHosted(ui: ReactNode, initialPath = "/mail") {
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
  const mailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/mail",
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
    routeTree: rootRoute.addChildren([mailRoute, notesRoute, settingsRoute, settingsSectionRoute]),
    history,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return { history, router };
}

function footerSettingsButton() {
  const footer = document.querySelector(".workspace-sidebar-account-footer");
  if (!(footer instanceof HTMLElement)) return null;
  return within(footer).queryByRole("button", { name: "Settings" });
}

function dialogFooterCancelButton() {
  const footer = document.querySelector(".ui-modal-footer");
  if (!(footer instanceof HTMLElement)) {
    throw new Error("dialog footer not found");
  }
  return within(footer).getByRole("button", { name: "Cancel" });
}

describe("settings dialog and in-app footer", () => {
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

  it("shows Settings above the avatar for Mail and opens the Mail pane", async () => {
    const bootstrap = createMailAppBootstrap();
    await renderHosted(
      <MailWorkspace
        messages={bootstrap.data.mail}
        mailboxes={bootstrap.data.mailboxes}
        session={bootstrap.session}
        listLoading={false}
        onLogout={() => undefined}
      />,
    );

    const settingsButton = footerSettingsButton();
    expect(settingsButton).toBeTruthy();
    settingsButton!.focus();
    fireEvent.click(settingsButton!);

    expect(await screen.findByRole("heading", { name: "Mail" })).toBeTruthy();
    expect(screen.getByText(/does not read a mailbox/i)).toBeTruthy();
    const footer = document.querySelector(".ui-modal-footer");
    expect(footer).toBeInstanceOf(HTMLElement);
    expect(
      within(footer as HTMLElement).getByRole("button", { name: "Open in Settings" }),
    ).toBeTruthy();
    expect(within(footer as HTMLElement).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(footer as HTMLElement).queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("opens Calendar in the dialog from the footer", async () => {
    await renderHosted(
      <WorkspaceAppSettingsFooter appId="calendar" session={mockWorkspaceSession} />,
    );
    const settingsButton = footerSettingsButton();
    expect(settingsButton).toBeTruthy();
    settingsButton!.focus();
    fireEvent.click(settingsButton!);

    expect(await screen.findByRole("heading", { name: "Calendar" })).toBeTruthy();
    expect(await screen.findByRole("combobox", { name: "Timezone" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Day starts on" })).toBeTruthy();
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

  it("shows the Settings row for Notes", async () => {
    const bootstrap = createNotesAppBootstrap();
    await renderHosted(
      <NotesWorkspace {...bootstrap} listLoading={false} onLogout={() => undefined} />,
      "/notes",
    );
    expect(footerSettingsButton()).toBeTruthy();
  });

  it("hides the Settings row for Drive", async () => {
    await renderHosted(<WorkspaceAppSettingsFooter appId="drive" session={mockWorkspaceSession} />);
    expect(footerSettingsButton()).toBeNull();
  });

  it("restores focus to the footer Settings control on dismiss", async () => {
    await renderHosted(<WorkspaceAppSettingsFooter appId="mail" session={mockWorkspaceSession} />);
    const settingsButton = footerSettingsButton();
    expect(settingsButton).toBeTruthy();
    settingsButton!.focus();
    fireEvent.click(settingsButton!);
    expect(await screen.findByRole("button", { name: "Open in Settings" })).toBeTruthy();

    fireEvent.click(dialogFooterCancelButton());
    await waitFor(() => {
      expect(footerSettingsButton()).toBe(document.activeElement);
    });
  });

  it("does not restore focus to an unmounted opener after Open in Settings", async () => {
    await renderHosted(<WorkspaceAppSettingsFooter appId="mail" session={mockWorkspaceSession} />);
    const settingsButton = footerSettingsButton();
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
      expect(heading?.textContent).toContain("Mail");
      expect(document.activeElement).toBe(heading);
    });
    expect(footerSettingsButton()).toBeNull();
  });
});

describe("openPanel typing", () => {
  it("accepts BuiltinPanelId and rejects a typo at the type level", () => {
    type OpenPanelId = Parameters<SettingsDialogApi["openPanel"]>[0];
    const mail: OpenPanelId = "mail";
    expect(mail).toBe("mail");
    // @ts-expect-error "mial" is not a BuiltinPanelId
    const typo: OpenPanelId = "mial";
    void typo;
    const _assert: OpenPanelId extends BuiltinPanelId ? true : false = true;
    expect(_assert).toBe(true);
  });
});
