import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";
import {
  buildAdminSettingsFormState,
  mergeStoredSettings,
  type AdminSettingsFormState,
} from "@/admin-core/src/admin-settings-form-utils";
import {
  AdminSettingsAutosave,
  useAdminSettingsEditor,
} from "@/admin-core/src/use-admin-settings-autosave";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";
import { FORM_AUTOSAVE_DELAY_MS } from "@/hooks/use-form-autosave";

const reported = vi.hoisted(() => ({ last: "saved" as string }));
vi.mock("@/ui/autosave-status", () => ({
  useReportAutosaveStatus: (status: string) => {
    reported.last = status;
  },
}));

const INITIAL = buildAdminSettingsFormState(createAdminAppBootstrap().data);

type Save = (sent: AdminSettingsFormState) => Promise<boolean>;

function Fields({
  form,
  onClear,
}: {
  form: AdminSettingsFormState;
  onClear?: () => void | Promise<void>;
}) {
  const { type, choose, clear } = useAdminSettingsEditor();
  return (
    <>
      <input
        aria-label="TURN secret"
        value={form.turnSecret}
        onChange={(event) => type({ turnSecret: event.target.value })}
      />
      <button type="button" onClick={() => clear("turnSecret", async () => onClear?.())}>
        Clear
      </button>
      <input
        aria-label="STUN"
        value={form.stunUrls}
        onChange={(event) => type({ stunUrls: event.target.value })}
      />
      <button type="button" onClick={() => choose({ stunUrls: "stun:b" })}>
        Remove
      </button>
      <input
        aria-label="Per day"
        value={form.imipDailyLimit}
        onChange={(event) => type({ imipDailyLimit: event.target.value })}
      />
      <input
        aria-label="Realm"
        value={form.authRealm}
        onChange={(event) => type({ authRealm: event.target.value })}
      />
    </>
  );
}

/** The server: stores what it gets, never echoes the secret (like the API). */
function Harness({ save, onClear }: { save: Save; onClear?: () => void | Promise<void> }) {
  const [form, setForm] = useState(INITIAL);
  const controller = {
    settingsForm: form,
    setSettingsForm: setForm,
    actions: {
      autosaveSettings: async (sent: AdminSettingsFormState) => {
        const ok = await save(sent);
        setForm((current) => mergeStoredSettings(current, sent, { ...sent, turnSecret: "" }));
        return ok;
      },
    },
  } as unknown as AdminControllerState;
  return (
    <AdminSettingsAutosave controller={controller}>
      <Fields form={form} onClear={onClear} />
    </AdminSettingsAutosave>
  );
}

async function pause(ms = FORM_AUTOSAVE_DELAY_MS + 100) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AdminSettingsAutosave", () => {
  it("never sends a half-typed secret: it saves once, whole, when the field is left", async () => {
    const save = vi.fn<Save>().mockResolvedValue(true);
    render(<Harness save={save} />);
    const secret = screen.getByLabelText("TURN secret");

    fireEvent.change(secret, { target: { value: "abc" } });
    await pause();
    expect(save).not.toHaveBeenCalled();
    expect((secret as HTMLInputElement).value).toBe("abc");

    fireEvent.change(secret, { target: { value: "abcdef" } });
    fireEvent.blur(secret);
    await pause(10);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].turnSecret).toBe("abcdef");
  });

  it("does not send a half-typed daily limit (it would cap the hourly one)", async () => {
    const save = vi.fn<Save>().mockResolvedValue(true);
    render(<Harness save={save} />);

    fireEvent.change(screen.getByLabelText("Per day"), { target: { value: "1" } });
    await pause();
    expect(save).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Per day") as HTMLInputElement).value).toBe("1");
  });

  it("saves other fields on a pause, with the saved value of a field still being typed", async () => {
    const save = vi.fn<Save>().mockResolvedValue(true);
    render(<Harness save={save} />);

    fireEvent.change(screen.getByLabelText("TURN secret"), { target: { value: "half" } });
    fireEvent.change(screen.getByLabelText("Realm"), { target: { value: "Office" } });
    await pause();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({ authRealm: "Office", turnSecret: "" });
    // The draft stays under the cursor.
    expect((screen.getByLabelText("TURN secret") as HTMLInputElement).value).toBe("half");
  });

  it("runs Clear after the save started by leaving the field", async () => {
    const order: string[] = [];
    const save = vi.fn<Save>(async (sent) => {
      order.push(`save:${sent.turnSecret}`);
      return true;
    });
    render(<Harness save={save} onClear={() => order.push("clear")} />);
    const secret = screen.getByLabelText("TURN secret");

    fireEvent.change(secret, { target: { value: "typed" } });
    fireEvent.blur(secret);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await pause(10);

    expect(order).toEqual(["save:typed", "clear"]);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves the list without a removed URL, and keeps it out of later saves", async () => {
    const save = vi.fn<Save>().mockResolvedValue(true);
    render(<Harness save={save} />);
    const stun = screen.getByLabelText("STUN");

    fireEvent.change(stun, { target: { value: "stun:a,stun:b" } });
    fireEvent.blur(stun);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await pause();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].stunUrls).toBe("stun:b");

    fireEvent.change(screen.getByLabelText("Realm"), { target: { value: "Office" } });
    await pause();
    expect(save.mock.calls[1]?.[0].stunUrls).toBe("stun:b");
  });

  it("shows Unsaved when a Clear fails", async () => {
    const save = vi.fn<Save>().mockResolvedValue(true);
    render(
      <Harness
        save={save}
        onClear={async () => {
          throw new Error("no");
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await pause(10);

    expect(reported.last).toBe("unsaved");
  });
});
