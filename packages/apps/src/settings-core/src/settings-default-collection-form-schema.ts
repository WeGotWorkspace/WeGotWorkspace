import { z } from "zod";
import { type DefaultCollectionApp, readDefaultCollectionId } from "@/lib/default-collection-prefs";

export const settingsDefaultCollectionFormSchema = z.object({
  collectionId: z.string(),
});

export type SettingsDefaultCollectionFormValues = z.infer<
  typeof settingsDefaultCollectionFormSchema
>;

export function defaultCollectionPrefsToForm(
  app: DefaultCollectionApp,
): SettingsDefaultCollectionFormValues {
  return { collectionId: readDefaultCollectionId(app) ?? "" };
}

export function defaultCollectionFormToPrefs(values: SettingsDefaultCollectionFormValues): {
  collectionId?: string;
} {
  const collectionId = values.collectionId.trim();
  return collectionId ? { collectionId } : {};
}
