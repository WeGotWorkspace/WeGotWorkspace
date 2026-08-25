import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarShareDialog } from "@/calendar-core/src/calendar-share-dialog";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import { shareLabels } from "@/share-ui/share-labels";
import { TooltipProvider } from "@/ui/tooltip";

const personal: CalendarInfo = {
  id: "default",
  name: "Personal",
  color: "#6366f1",
  mayShare: true,
  mayWrite: true,
  shareWith: {
    alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
  },
};

const knownPrincipals = [
  { id: "alice", displayName: "Alice", principalType: "user" as const },
  { id: "bob", displayName: "Bob", principalType: "user" as const },
  { id: "groups/editorial", displayName: "Editorial Team", principalType: "group" as const },
];

function renderDialog(overrides: Partial<ComponentProps<typeof CalendarShareDialog>> = {}): {
  onPatchShareWith: ReturnType<typeof vi.fn>;
  onSearchPrincipals: ReturnType<typeof vi.fn>;
} {
  const onPatchShareWith = vi.fn(async () => {});
  const onSearchPrincipals = vi.fn(async (query: string) =>
    knownPrincipals.filter(
      (row) =>
        row.displayName.toLowerCase().includes(query.toLowerCase()) ||
        row.id.toLowerCase().includes(query.toLowerCase()),
    ),
  );
  render(
    <TooltipProvider delayDuration={0}>
      <CalendarShareDialog
        open
        calendar={personal}
        labels={defaultCalendarLabels}
        knownPrincipals={knownPrincipals}
        onOpenChange={vi.fn()}
        onSearchPrincipals={onSearchPrincipals}
        onPatchShareWith={onPatchShareWith}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onPatchShareWith, onSearchPrincipals };
}

describe("CalendarShareDialog", () => {
  beforeEach(() => {
    cleanup();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("lists existing grants and adds a teammate at read access", async () => {
    const { onPatchShareWith, onSearchPrincipals } = renderDialog();

    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("alice")).toBeTruthy();

    fireEvent.change(
      screen.getByPlaceholderText(defaultCalendarLabels.shareCalendarAddPlaceholder),
      {
        target: { value: "bob" },
      },
    );
    await waitFor(() => expect(onSearchPrincipals).toHaveBeenCalledWith("bob"));
    fireEvent.mouseDown(screen.getByRole("option", { name: /Bob/ }));

    await waitFor(() => {
      expect(onPatchShareWith).toHaveBeenCalledWith("default", {
        bob: expect.objectContaining({ mayWrite: false, mayWriteAll: false }),
      });
    });
  });

  it("changes a grant to read and write and revokes it", async () => {
    const { onPatchShareWith } = renderDialog();

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Can edit" }));
    await waitFor(() => {
      expect(onPatchShareWith).toHaveBeenCalledWith("default", {
        alice: expect.objectContaining({ mayWrite: true, mayWriteAll: true }),
      });
    });

    fireEvent.click(screen.getByRole("button", { name: shareLabels.removeGrant }));
    fireEvent.click(screen.getByRole("button", { name: shareLabels.confirmContinue }));
    await waitFor(() => {
      expect(onPatchShareWith).toHaveBeenCalledWith("default", { alice: null });
    });
  });

  it("blocks mutations while offline", () => {
    const { onPatchShareWith } = renderDialog({ online: false });

    expect(screen.getByText(defaultCalendarLabels.shareCalendarOffline)).toBeTruthy();
    expect(
      (
        screen.getByPlaceholderText(
          defaultCalendarLabels.shareCalendarAddPlaceholder,
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: shareLabels.removeGrant }));
    expect(screen.queryByRole("button", { name: shareLabels.confirmContinue })).toBeNull();
    expect(onPatchShareWith).not.toHaveBeenCalled();
  });
});
