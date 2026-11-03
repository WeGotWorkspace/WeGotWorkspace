import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  meetLowDataLabels,
  readMeetLowData,
  subscribeMeetLowData,
  writeMeetLowData,
} from "@/lib/meet-low-data";
import { useSettingsPrefsForm } from "@/settings-core/src/use-settings-prefs-form";

export const settingsMeetFormSchema = z.object({ lowData: z.boolean() });

export type SettingsMeetFormValues = z.infer<typeof settingsMeetFormSchema>;

const resolver = zodResolver(settingsMeetFormSchema);

const readMeetForm = (): SettingsMeetFormValues => ({ lowData: readMeetLowData() });

const writeMeetForm = (values: SettingsMeetFormValues) => writeMeetLowData(values.lowData);

/** Meet device setting: low data mode on this browser. */
export function useSettingsMeetForm() {
  return useSettingsPrefsForm<SettingsMeetFormValues>({
    resolver,
    read: readMeetForm,
    write: writeMeetForm,
    subscribe: subscribeMeetLowData,
    saved: { panelId: "meet", sliceId: "meet-device" },
    messages: {
      success: meetLowDataLabels.settingsSaved,
      error: meetLowDataLabels.settingsSaveError,
    },
  });
}
