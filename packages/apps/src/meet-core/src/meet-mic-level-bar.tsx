import { Mic } from "lucide-react";
import { meetLabels } from "@/meet-core/src/meet-labels";

export function MeetMicLevelBar({ level }: { level: number }) {
  const width = `${Math.round(Math.min(1, Math.max(0, level)) * 100)}%`;
  return (
    <div className="meet-guest-lobby__mic-level">
      <Mic className="meet-guest-lobby__mic-level-icon" aria-hidden />
      <div
        className="meet-guest-lobby__mic-level-track"
        role="meter"
        aria-label={meetLabels.speakToTest}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(1, Math.max(0, level)) * 100)}
      >
        <span className="meet-guest-lobby__mic-level-fill" style={{ width }} />
      </div>
      <span className="meet-guest-lobby__mic-level-hint">{meetLabels.speakToTest}</span>
    </div>
  );
}
