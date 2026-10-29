import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notesMockAdapter } from "@/lib/adapters/mock/notes-mock-adapter";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(() => "toast-1"),
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

async function renderNotesApp(initialPath: string) {
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createWeGotWorkspaceRouter({ mode: "mock", history });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "New note" });
  return { history };
}

function firstSeedTag(): string {
  const tag = notesMockAdapter
    .getSeedData()
    .notes.flatMap((note) => (note.archived ? [] : note.tags))
    .sort((a, b) => a.localeCompare(b))[0];
  if (!tag) throw new Error("mock seed has no tags");
  return tag;
}

async function clickSidebarTag(tag: string) {
  const tagsSection = document.querySelector(".notes-sidebar-tags");
  if (!(tagsSection instanceof HTMLElement)) throw new Error("no Tags section");
  const chip = within(tagsSection)
    .getAllByRole("button")
    .find(
      (button) =>
        button.classList.contains("notes-sidebar-tags__item") && button.textContent === tag,
    );
  if (!chip) throw new Error(`no sidebar chip for ${tag}`);
  fireEvent.click(chip);
}

// #1752: a sidebar tag click from Starred, Archived or a notebook landed on /notes/all.
describe("Notes sidebar tag click → URL", { timeout: 15_000 }, () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
  });

  it.each([
    ["All Items", "/notes/all"],
    ["Starred", "/notes/starred"],
    ["Archived", "/notes/archive"],
    ["a notebook", "/notes/notebooks/Drafts"],
  ])("opens the tag view from %s", async (_label, startPath) => {
    const tag = firstSeedTag();
    const { history } = await renderNotesApp(startPath);

    await clickSidebarTag(tag);

    await waitFor(() => {
      expect(history.location.pathname).toBe(`/notes/tags/${encodeURIComponent(tag)}`);
    });
  });

  it("opens the tag view after switching to Starred in the sidebar", async () => {
    const tag = firstSeedTag();
    const { history } = await renderNotesApp("/notes/all");

    fireEvent.click(screen.getByRole("button", { name: "Starred" }));
    await waitFor(() => expect(history.location.pathname).toBe("/notes/starred"));

    await clickSidebarTag(tag);

    await waitFor(() => {
      expect(history.location.pathname).toBe(`/notes/tags/${encodeURIComponent(tag)}`);
    });
  });
});
