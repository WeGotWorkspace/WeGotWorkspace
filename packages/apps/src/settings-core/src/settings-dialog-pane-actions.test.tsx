import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SettingsDialogPaneActionsProvider,
  useRegisterSettingsDialogSave,
  type SettingsDialogPaneSave,
} from "@/settings-core/src/settings-dialog-pane-actions";

function Slice({ save, disabled }: { save: () => void; disabled: boolean }) {
  useRegisterSettingsDialogSave(save, disabled);
  return null;
}

afterEach(cleanup);

describe("settings dialog footer Save with several slices", () => {
  function renderSlices(first: { disabled: boolean }, second: { disabled: boolean }) {
    const saves = { first: vi.fn(), second: vi.fn() };
    let paneSave: SettingsDialogPaneSave | null = null;
    const ui = (a: boolean, b: boolean) => (
      <SettingsDialogPaneActionsProvider onSaveChange={(next) => (paneSave = next)}>
        <Slice save={saves.first} disabled={a} />
        <Slice save={saves.second} disabled={b} />
      </SettingsDialogPaneActionsProvider>
    );
    const view = render(ui(first.disabled, second.disabled));
    return {
      saves,
      current: () => paneSave,
      rerender: (a: boolean, b: boolean) => view.rerender(ui(a, b)),
      unmount: view.unmount,
    };
  }

  it("is disabled only while no slice has changes", () => {
    const view = renderSlices({ disabled: true }, { disabled: true });
    expect(view.current()?.disabled).toBe(true);
    view.rerender(true, false);
    expect(view.current()?.disabled).toBe(false);
  });

  it("saves every slice that has changes, and only those", async () => {
    const view = renderSlices({ disabled: true }, { disabled: false });
    await act(async () => {
      await view.current()?.save();
    });
    expect(view.saves.first).not.toHaveBeenCalled();
    expect(view.saves.second).toHaveBeenCalledTimes(1);

    view.rerender(false, false);
    await act(async () => {
      await view.current()?.save();
    });
    expect(view.saves.first).toHaveBeenCalledTimes(1);
    expect(view.saves.second).toHaveBeenCalledTimes(2);
  });

  it("drops the footer Save when every slice is gone", () => {
    const view = renderSlices({ disabled: true }, { disabled: true });
    view.unmount();
    expect(view.current()).toBeNull();
  });
});
