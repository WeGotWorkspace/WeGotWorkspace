import {
  DOCS_PAPER_CHOICES,
  docsPageSetupLabels as labels,
  docsPaperLabel,
} from "@/lib/docs-page-setup-labels";
import { isTextEditorPageOrientation, isTextEditorPaperChoice } from "@/lib/page-format";
import { useSettingsDocsForm } from "@/settings-core/src/use-settings-docs-form";
import { SettingsPrefsFormPane } from "@/settings-core/src/settings-prefs-form-pane";
import { FieldLabelRow } from "@/ui/field-label-row";
import { FormField } from "@/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

/**
 * Docs default page setup: the paper and orientation new documents start with. Stored on
 * this browser, not on the account; a document's own Page setup overrides it.
 */
export function SettingsDocsPane() {
  const controller = useSettingsDocsForm();
  const { form } = controller;
  const format = form.watch("format");
  return (
    <SettingsPrefsFormPane controller={controller}>
      <FormField
        control={form.control}
        name="format"
        render={({ field }) => (
          <FieldLabelRow label={labels.settingsPaper}>
            <Select
              value={field.value}
              onValueChange={(value) => {
                if (isTextEditorPaperChoice(value)) field.onChange(value);
              }}
            >
              <SelectTrigger aria-label={labels.settingsPaper}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCS_PAPER_CHOICES.map((choice) => (
                  <SelectItem key={choice} value={choice}>
                    {docsPaperLabel(choice)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldLabelRow>
        )}
      />
      <FormField
        control={form.control}
        name="orientation"
        render={({ field }) => (
          <FieldLabelRow label={labels.settingsOrientation}>
            <Select
              value={field.value}
              disabled={format === "none"}
              onValueChange={(value) => {
                if (isTextEditorPageOrientation(value)) field.onChange(value);
              }}
            >
              <SelectTrigger aria-label={labels.settingsOrientation}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="portrait">{labels.pageOrientationPortrait}</SelectItem>
                <SelectItem value="landscape">{labels.pageOrientationLandscape}</SelectItem>
              </SelectContent>
            </Select>
          </FieldLabelRow>
        )}
      />
    </SettingsPrefsFormPane>
  );
}
