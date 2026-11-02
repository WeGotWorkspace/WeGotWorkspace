import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useRouterState: (opts?: {
      select?: (state: { location: { pathname: string } }) => unknown;
    }) => {
      const state = { location: { pathname: "/notes" } };
      return opts?.select ? opts.select(state) : state;
    },
    useNavigate: () => vi.fn(),
  };
});

function renderWorkspace(initialView: string) {
  return render(
    <NotesWorkspace {...createNotesAppBootstrap()} listLoading={false} initialView={initialView} />,
  );
}

function sidebarTags(container: HTMLElement): HTMLElement {
  const section = container.querySelector<HTMLElement>(".notes-sidebar-tags");
  if (!section) throw new Error("Tags section not rendered");
  return section;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      addEventListener: vi.fn(),
      removeListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("editing a tag from the Notes list header (#1744)", () => {
  it("sidebar tags are plain chips with no edit button", () => {
    const { container } = renderWorkspace("tag:essay");
    const tags = sidebarTags(container);
    const buttons = within(tags).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(1);
    for (const button of buttons) {
      expect(button.classList.contains("notes-sidebar-tags__item")).toBe(true);
    }
    expect(within(tags).queryByRole("button", { name: /rename|edit/i })).toBeNull();
  });

  it("opens the rename dialog for the selected tag", () => {
    renderWorkspace("tag:essay");
    fireEvent.click(screen.getByRole("button", { name: defaultNotesLabels.editTag }));
    const dialog = screen.getByRole("dialog", { name: defaultNotesLabels.renameTagTitle });
    expect(
      (within(dialog).getByLabelText(defaultNotesLabels.renameTagNameLabel) as HTMLInputElement)
        .value,
    ).toBe("essay");
  });

  it.each(["all", "starred", "archive", "tag:no-such-tag"])(
    "has no Edit tag button on %s",
    (view) => {
      renderWorkspace(view);
      expect(screen.getByPlaceholderText(defaultNotesLabels.searchPlaceholder)).toBeTruthy();
      expect(screen.queryByRole("button", { name: defaultNotesLabels.editTag })).toBeNull();
    },
  );
});
