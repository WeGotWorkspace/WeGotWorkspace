import { Mic, Video, type LucideIcon } from "lucide-react";

/** Sticky chrome and sidebar live overlay: Mic when audio-only, otherwise camera. */
export function meetCallLiveIcon(audioOnly: boolean): LucideIcon {
  return audioOnly ? Mic : Video;
}
