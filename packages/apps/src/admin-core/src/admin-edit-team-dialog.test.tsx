import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditTeamDialog, type EditTeamDraft } from "@/admin-core/src/admin-edit-team-dialog";
import { FORM_AUTOSAVE_DELAY_MS } from "@/hooks/use-form-autosave";
import { TooltipProvider } from "@/ui/tooltip";

const users = [
  { id: "u-ada", displayName: "Ada Lovelace", username: "ada", groups: ["g-team"] },
  { id: "u-alan", displayName: "Alan Turing", username: "alan", groups: [] },
];
const team = { id: "g-team", displayName: "Team", teamAdmins: [] as string[] };

function renderDialog(onSave = vi.fn(async (_draft: EditTeamDraft) => true)) {
  const onOpenChange = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <EditTeamDialog open team={team} users={users} onOpenChange={onOpenChange} onSave={onSave} />
    </TooltipProvider>,
  );
  return { onSave, onOpenChange };
}

async function settle() {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("EditTeamDialog", () => {
  it("has Done and no Save", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("saves a removed member at once", async () => {
    const { onSave } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Remove Ada Lovelace" }));
    await settle();
    expect(onSave).toHaveBeenCalledWith({
      name: "Team",
      memberUserIds: [],
      teamAdminUserIds: [],
    });
  });

  it("saves the name after a pause, once", async () => {
    const { onSave } = renderDialog();
    const input = screen.getByLabelText("Team name");
    fireEvent.change(input, { target: { value: "Team A" } });
    fireEvent.change(input, { target: { value: "Team AB" } });
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FORM_AUTOSAVE_DELAY_MS);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0].name).toBe("Team AB");
  });

  it("Done stores a name typed just before and closes", async () => {
    const { onSave, onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0].name).toBe("Renamed");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not save an empty name", async () => {
    const { onSave } = renderDialog();
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "  " } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FORM_AUTOSAVE_DELAY_MS);
    });
    expect(onSave).not.toHaveBeenCalled();
  });
});
