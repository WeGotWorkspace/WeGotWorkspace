import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import { notifySettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";
import { useSettingsMailForm } from "@/settings-core/src/use-settings-mail-form";

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
}));

vi.mock("@/settings-core/src/settings-slice-saved", async () => {
  const actual = await vi.importActual<typeof import("@/settings-core/src/settings-slice-saved")>(
    "@/settings-core/src/settings-slice-saved",
  );
  return {
    ...actual,
    notifySettingsSliceSaved: vi.fn(actual.notifySettingsSliceSaved),
  };
});

describe("useSettingsMailForm onSaved", () => {
  beforeEach(() => {
    vi.mocked(notifySettingsSliceSaved).mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("emits notifySettingsSliceSaved after a successful mail save", async () => {
    const bootstrap = createSettingsAppBootstrap();
    const saveMail = vi.fn(async () => bootstrap.data);
    const { result } = renderHook(() =>
      useSettingsMailForm({
        profileEmail: bootstrap.data.user.email,
        mail: bootstrap.data.mail,
        mailServer: bootstrap.data.mailServer,
        operations: { saveProfile: vi.fn(), saveMail },
      }),
    );

    await act(async () => {
      await result.current.form.setValue("imapUsername", "saved@example.test", {
        shouldDirty: true,
      });
      await result.current.saveMail();
    });

    expect(saveMail).toHaveBeenCalled();
    expect(notifySettingsSliceSaved).toHaveBeenCalledWith({
      panelId: "mail",
      sliceId: "mail-accounts",
    });
  });
});
