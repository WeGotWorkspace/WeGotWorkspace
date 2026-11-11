import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { FORM_AUTOSAVE_DELAY_MS } from "@/hooks/use-form-autosave";

/**
 * A user edit to a settings form field (the field's own change event). Autosave listens
 * for these only; `setValue` and `reset` do not save.
 */
export async function editSettingsField<T extends FieldValues>(
  form: UseFormReturn<T>,
  name: Path<T>,
  value: unknown,
): Promise<void> {
  await act(async () => {
    await form.register(name).onChange({ target: { name, value }, type: "change" });
  });
}

/** Lets the autosave pause pass (fake timers), so the pending save runs. */
export async function waitForSettingsAutosave(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FORM_AUTOSAVE_DELAY_MS);
  });
}
