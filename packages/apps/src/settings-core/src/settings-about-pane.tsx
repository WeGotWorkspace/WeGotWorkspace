import { PROJECT_LICENSE, sourceCodeUrl } from "@/lib/source-code";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import "./settings-about-pane.css";

export function SettingsAboutPane({ sourceUrl = sourceCodeUrl() }: { sourceUrl?: string }) {
  return (
    <SettingsPaneCard>
      <div className="settings-about-pane">
        <p className="settings-about-pane__license">
          WeGotWorkspace is free and open source software, licensed under {PROJECT_LICENSE}. You can
          get the source code of the version running here.
        </p>
        <p className="settings-about-pane__source">
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            Source code
          </a>
        </p>
      </div>
    </SettingsPaneCard>
  );
}
