import { act, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";
import {
  buildAdminSettingsFormState,
  type AdminSettingsFormState,
} from "@/admin-core/src/admin-settings-form-utils";
import {
  AdminSettingsAutosave,
  useAdminSettingsEditor,
  type AdminSettingsEditor,
} from "@/admin-core/src/use-admin-settings-autosave";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";
import { FORM_AUTOSAVE_DELAY_MS } from "@/hooks/use-form-autosave";

function setup() {
  const autosaveSettings = vi.fn(async (_form: AdminSettingsFormState) => true);
  const hook = { result: { current: {} as { form: AdminSettingsFormState } } };
  const editor = { result: { current: {} as AdminSettingsEditor } };
  function Probe() {
    editor.result.current = useAdminSettingsEditor();
    return null;
  }
  function Harness() {
    const [settingsForm, setSettingsForm] = useState(() =>
      buildAdminSettingsFormState(createAdminAppBootstrap().data),
    );
    hook.result.current = { form: settingsForm };
    const controller = {
      settingsForm,
      setSettingsForm,
      actions: { autosaveSettings },
    } as unknown as AdminControllerState;
    return (
      <AdminSettingsAutosave controller={controller}>
        <Probe />
      </AdminSettingsAutosave>
    );
  }
  render(<Harness />);
  return { hook, editor, autosaveSettings };
}

describe("admin settings autosave", () => {
  it("saves a held secret only when the field is left", async () => {
    vi.useFakeTimers();
    const { hook, editor, autosaveSettings } = setup();
    act(() => editor.result.current.hold({ mailDeliverySmtpPassword: "abc" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FORM_AUTOSAVE_DELAY_MS * 3);
    });
    expect(autosaveSettings).not.toHaveBeenCalled();
    expect(hook.result.current.form.mailDeliverySmtpPassword).toBe("abc");
    act(() => editor.result.current.hold({ mailDeliverySmtpPassword: "abcdef" }));
    act(() => editor.result.current.commit());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FORM_AUTOSAVE_DELAY_MS);
    });
    expect(autosaveSettings).toHaveBeenCalledTimes(1);
    expect(autosaveSettings.mock.calls[0][0].mailDeliverySmtpPassword).toBe("abcdef");
    vi.useRealTimers();
  });

  it("keeps a secret still being typed out of another field's save", async () => {
    vi.useFakeTimers();
    const { editor, autosaveSettings } = setup();
    act(() => editor.result.current.hold({ turnSecret: "part" }));
    act(() => editor.result.current.type({ mailDeliveryFrom: "new-from@b.test" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FORM_AUTOSAVE_DELAY_MS);
    });
    expect(autosaveSettings).toHaveBeenCalledTimes(1);
    expect(autosaveSettings.mock.calls[0][0].turnSecret).toBe("");
    expect(autosaveSettings.mock.calls[0][0].mailDeliveryFrom).toBe("new-from@b.test");
    vi.useRealTimers();
  });

  it("does not save a half-typed limit before the field is left", async () => {
    vi.useFakeTimers();
    const { hook, editor, autosaveSettings } = setup();
    act(() => editor.result.current.hold({ imipDailyLimit: "1" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FORM_AUTOSAVE_DELAY_MS * 3);
    });
    expect(autosaveSettings).not.toHaveBeenCalled();
    expect(hook.result.current.form.imipDailyLimit).toBe("1");
    vi.useRealTimers();
  });

  it("runs a clear after the saves already started and drops the waiting one", async () => {
    vi.useFakeTimers();
    const { editor, autosaveSettings } = setup();
    const order: string[] = [];
    autosaveSettings.mockImplementation(async () => {
      order.push("save");
      return true;
    });
    act(() => editor.result.current.type({ mailDeliveryFrom: "x@y.test" }));
    await act(async () => {
      await editor.result.current.afterSaves(async () => {
        order.push("clear");
      });
      await vi.advanceTimersByTimeAsync(FORM_AUTOSAVE_DELAY_MS * 2);
    });
    expect(order).toEqual(["clear"]);
    vi.useRealTimers();
  });
});
