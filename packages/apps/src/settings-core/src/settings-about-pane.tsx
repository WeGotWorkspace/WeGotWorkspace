import { PROJECT_LICENSE, sourceCodeUrl } from "@/lib/source-code";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";

export function SettingsAboutPane({ sourceUrl = sourceCodeUrl() }: { sourceUrl?: string }) {
  return (
    <SettingsPaneCard>
      <div className="settings-about-pane space-y-4 max-w-lg">
        <p className="text-sm text-muted-foreground">
          WeGotWorkspace is free and open source software, licensed under {PROJECT_LICENSE}. You can
          get the source code of the version running here.
        </p>
        <p className="text-sm">
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            Source code
          </a>
        </p>
      </div>
    </SettingsPaneCard>
  );
}
