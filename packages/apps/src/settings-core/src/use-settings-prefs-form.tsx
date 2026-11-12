import { useEffect, useRef, useState } from "react";
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
} from "react-hook-form";
import { useAppToast } from "@/hooks/use-app-toast";
import { useFormAutosave } from "@/hooks/use-form-autosave";
import {
  notifySettingsSliceSaved,
  type SettingsSliceSavedEvent,
} from "@/settings-core/src/settings-slice-saved";

/**
 * One place for a settings pane of preferences: the form, autosave, the error toast and
 * the saved event. Preferences save as the user changes them (suite norm), in the
 * Settings app and in the app settings dialog alike, so neither shows a Save button.
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
  /** Toast when storage rejects the values. */
  saveError: string;
};

export type SettingsPrefsForm<T extends FieldValues> = {
  form: UseFormReturn<T>;
};

export function useSettingsPrefsForm<T extends FieldValues>(
  options: SettingsPrefsFormOptions<T>,
): SettingsPrefsForm<T> {
  const { showError } = useAppToast();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [defaultValues] = useState(options.read);
  const form = useForm<T>({
    resolver: options.resolver,
    defaultValues: defaultValues as DefaultValues<T>,
    mode: "onChange",
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

  const save = form.handleSubmit((values) => {
    const { write, read, saved, saveError } = optionsRef.current;
    if (!write(values)) {
      showError(saveError);
      return;
    }
    form.reset(read());
    notifySettingsSliceSaved(saved);
  });

  useFormAutosave(form, save);

  return { form };
}
