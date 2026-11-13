import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { useOnReconnect } from "@/hooks/use-connectivity";
import { useAppToast } from "@/hooks/use-app-toast";
import { useFormAutosave } from "@/hooks/use-form-autosave";
import type { CalendarAvailabilitySettingsOperations } from "@/lib/api/wgw/calendar-availability";
import { getConnectivitySnapshot, isFetchNetworkError } from "@/lib/offline/core/browser-online";
import {
  calendarAvailabilityToForm,
  calendarAvailabilityUpdateFromForm,
  type CalendarAvailabilityFormValues,
} from "@/settings-core/src/settings-calendar-availability-form";
import { calendarAvailabilityLabels as labels } from "@/settings-core/src/settings-calendar-availability-labels";
import {
  calendarAvailabilitySavedTopic,
  defaultCalendarAvailabilitySettingsOperations,
} from "@/settings-core/src/settings-calendar-availability-source";
import { notifySettingsSliceSaved } from "@/lib/settings-slice-saved";
import type { CalendarAvailabilitySettings } from "@wgw/openapi-types/calendars-types";

export const CALENDAR_AVAILABILITY_SLICE = {
  panelId: "calendar",
  sliceId: "calendar-availability",
} as const;

export type CalendarAvailabilityPhase = "loading" | "offline" | "error" | "ready";

export type SettingsCalendarAvailabilityController = {
  phase: CalendarAvailabilityPhase;
  /** The settings as the server last returned them (names, colors, Teams). Set while ready. */
  settings: CalendarAvailabilitySettings | null;
  form: UseFormReturn<CalendarAvailabilityFormValues>;
  retry: () => void;
};

class AvailabilitySettingsOfflineError extends Error {}

function isOffline(error: unknown): boolean {
  return error instanceof AvailabilitySettingsOfflineError || isFetchNetworkError(error);
}

function sameFormValues(
  a: CalendarAvailabilityFormValues,
  b: CalendarAvailabilityFormValues,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Server-side Team availability settings (#1912): read fresh when the pane opens, saved with
 * PUT as the user changes them. No local copy: offline the pane says it needs a connection, and a
 * change shows an error toast.
 * A clean pane re-reads when another tab saved, when the window comes back to front, and when
 * the connection returns, so a second tab or device shows the current choices without a reload.
 */
export function useSettingsCalendarAvailability(
  operations: CalendarAvailabilitySettingsOperations = defaultCalendarAvailabilitySettingsOperations(),
): SettingsCalendarAvailabilityController {
  const { showError, showSuccess } = useAppToast();
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const [phase, setPhase] = useState<CalendarAvailabilityPhase>("loading");
  const [settings, setSettings] = useState<CalendarAvailabilitySettings | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const form = useForm<CalendarAvailabilityFormValues>({
    defaultValues: { enabled: false, calendars: [] },
  });
  const { isDirty } = form.formState;
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const requestRef = useRef(0);

  /** `submitted`: the values a save sent. An edit made since then stays, for the next save. */
  const apply = useCallback(
    (next: CalendarAvailabilitySettings, submitted?: CalendarAvailabilityFormValues) => {
      settingsRef.current = next;
      setSettings(next);
      if (!submitted || sameFormValues(form.getValues(), submitted)) {
        form.reset(calendarAvailabilityToForm(next));
      }
      setPhase("ready");
    },
    [form],
  );

  /** `quiet`: refresh a ready pane in place; never shows loading or errors, never drops edits. */
  const load = useCallback(
    async (quiet: boolean) => {
      const request = ++requestRef.current;
      if (!getConnectivitySnapshot()) {
        if (!quiet) setPhase("offline");
        return;
      }
      if (!quiet) setPhase("loading");
      try {
        const next = await operationsRef.current.load();
        if (request !== requestRef.current || (quiet && dirtyRef.current)) return;
        apply(next);
      } catch (error) {
        if (request !== requestRef.current || quiet) return;
        setPhase(isOffline(error) ? "offline" : "error");
      }
    },
    [apply],
  );

  useEffect(() => {
    void load(false);
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const refresh = useCallback(() => {
    if (phaseRef.current === "ready") {
      if (!dirtyRef.current) void load(true);
    } else if (phaseRef.current !== "loading") {
      void load(false);
    }
  }, [load]);

  useOnReconnect(refresh);

  // Settings have no push: re-read when another tab saved, or when this one comes back to front.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const unsubscribe = calendarAvailabilitySavedTopic.subscribe(refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      unsubscribe();
    };
  }, [refresh]);

  const save = form.handleSubmit(async (values) => {
    const base = settingsRef.current;
    if (!base) return;
    try {
      if (!getConnectivitySnapshot()) throw new AvailabilitySettingsOfflineError();
      const update = calendarAvailabilityUpdateFromForm(base, values);
      requestRef.current += 1;
      const saved = await operationsRef.current.save(update);
      apply(saved, values);
      // Sharing on or off is the one change people want confirmed; calendar choices stay quiet.
      if (saved.enabled !== base.enabled) {
        showSuccess(saved.enabled ? labels.sharingOn : labels.sharingOff);
      }
      notifySettingsSliceSaved(CALENDAR_AVAILABILITY_SLICE);
      calendarAvailabilitySavedTopic.publish(
        { type: "calendar-availability-saved" },
        { otherTabsOnly: true },
      );
    } catch (error) {
      showError(isOffline(error) ? labels.saveOffline : labels.saveError);
    }
  });

  useFormAutosave(form, save);

  return { phase, settings, form, retry: () => void load(false) };
}
