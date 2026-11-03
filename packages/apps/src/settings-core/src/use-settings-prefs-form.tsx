import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
} from "react-hook-form";
import { useRunWithAppToast } from "@/hooks/use-run-with-app-toast";
import { useRegisterSettingsDialogSave } from "@/settings-core/src/settings-dialog-pane-actions";
import {
  notifySettingsSliceSaved,
  type SettingsSliceSavedEvent,
} from "@/settings-core/src/settings-slice-saved";

/**
 * One place for a settings pane whose choices wait for Save: the form, the toast, the
 * saved event, and the Save in both the Settings app (pane button) and the app settings
 * dialog (footer, next to Cancel). A pane built on this cannot miss either Save.
 */

export type SettingsPrefsFormOptions<T extends FieldValues> = {
  resolver: Resolver<T>;
  /** Current stored values, as form values. */
  read: () => T;
  /** Store the values; false when storage rejects them. */
  write: (values: T) => boolean;
  /** Stored values changed elsewhere (another tab, another editor). Followed while clean. */
  subscribe?: (listener: () => void) => () => void;
  saved: SettingsSliceSavedEvent;
  messages: { success: string; error: string };
};

export type SettingsPrefsForm<T extends FieldValues> = {
  form: UseFormReturn<T>;
  save: () => Promise<void>;
};

export function useSettingsPrefsForm<T extends FieldValues>(
  options: SettingsPrefsFormOptions<T>,
): SettingsPrefsForm<T> {
  const runWithAppToast = useRunWithAppToast();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [defaultValues] = useState(options.read);
  const form = useForm<T>({
    resolver: options.resolver,
    defaultValues: defaultValues as DefaultValues<T>,
    mode: "onSubmit",
  });

  const { isDirty } = form.formState;
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const { subscribe } = options;
  useEffect(() => {
    if (!subscribe) return;
    return subscribe(() => {
      if (!dirtyRef.current) form.reset(optionsRef.current.read());
    });
  }, [form, subscribe]);

  const save = form.handleSubmit(async (values) => {
    const { write, read, saved, messages } = optionsRef.current;
    await runWithAppToast(
      async () => {
        if (!write(values)) throw new Error(messages.error);
        form.reset(read());
        notifySettingsSliceSaved(saved);
      },
      {
        success: messages.success,
        successOptions: { icon: <Check className="size-4" /> },
        mapError: (error) => (error instanceof Error ? error.message : messages.error),
      },
    );
  });

  useRegisterSettingsDialogSave(save, !isDirty);

  return { form, save };
}
