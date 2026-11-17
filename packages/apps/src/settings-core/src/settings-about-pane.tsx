import { ArrowUpRight } from "lucide-react";
import { buttonVariants } from "@/button/src/button";
import { PROJECT_LICENSE, sourceCodeUrl } from "@/lib/source-code";
import { FieldLabelRow } from "@/ui/field-label-row";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";

/** License and source, as one settings row: the text start, the source link end. */
export function SettingsAboutPane({ sourceUrl = sourceCodeUrl() }: { sourceUrl?: string }) {
  return (
    <SettingsPaneCard>
      <FieldLabelRow
        layout="inline"
        label="License"
        description={`WeGotWorkspace is free and open source software, licensed under ${PROJECT_LICENSE}. You can get the source code of the version running here.`}
      >
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Source code
          <ArrowUpRight aria-hidden />
        </a>
      </FieldLabelRow>
    </SettingsPaneCard>
  );
}
