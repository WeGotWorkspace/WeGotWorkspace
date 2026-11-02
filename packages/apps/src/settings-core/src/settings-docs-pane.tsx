import {
  DOCS_PAPER_CHOICES,
  docsPageSetupLabels as labels,
  docsPaperLabel,
} from "@/lib/docs-page-setup-labels";
import { isTextEditorPageOrientation, isTextEditorPaperChoice } from "@/lib/page-format";
import { useDocsDefaultPageSetup } from "@/lib/use-docs-page-setup";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

/**
 * Docs default page setup: the paper and orientation new documents start with. Stored on
 * this browser, not on the account; a document's own Page setup overrides it.
 */
export function SettingsDocsPane() {
  const { pageSetup, setPageSetup } = useDocsDefaultPageSetup();
  return (
    <SettingsPaneCard>
      <div className="settings-docs-pane max-w-lg space-y-4">
        <p className="text-sm text-muted-foreground">{labels.settingsHint}</p>
        <FieldLabelRow label={labels.settingsPaper}>
          <Select
            value={pageSetup.format}
            onValueChange={(value) => {
              if (isTextEditorPaperChoice(value)) setPageSetup({ format: value });
            }}
          >
            <SelectTrigger aria-label={labels.settingsPaper}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCS_PAPER_CHOICES.map((format) => (
                <SelectItem key={format} value={format}>
                  {docsPaperLabel(format)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldLabelRow>
        <FieldLabelRow label={labels.settingsOrientation}>
          <Select
            value={pageSetup.orientation}
            disabled={pageSetup.format === "none"}
            onValueChange={(value) => {
              if (isTextEditorPageOrientation(value)) setPageSetup({ orientation: value });
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
      </div>
    </SettingsPaneCard>
  );
}
