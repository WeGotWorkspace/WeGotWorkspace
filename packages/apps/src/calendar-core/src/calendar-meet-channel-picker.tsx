import { useState } from "react";
import { Hash, Video } from "lucide-react";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarMeetChannelOption } from "@/calendar-core/src/calendar-meet-link";

export type CalendarMeetChannelPickerProps = {
  labels: CalendarUILabels;
  listChannels?: () => Promise<CalendarMeetChannelOption[]>;
  disabled?: boolean;
  reserving?: boolean;
  onNewLink?: () => void;
  onPick?: (channel: CalendarMeetChannelOption) => void;
};

type ChannelLoadState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; channels: CalendarMeetChannelOption[] };

/**
 * Meet actions menu on the event form: generate an ad-hoc link, then list
 * chat channels (kind channel + meeting; DMs already filtered upstream).
 * Channels are fetched lazily when the menu opens.
 */
export function CalendarMeetChannelPicker({
  labels,
  listChannels,
  disabled = false,
  reserving = false,
  onNewLink,
  onPick,
}: CalendarMeetChannelPickerProps) {
  const [state, setState] = useState<ChannelLoadState>({ phase: "idle" });

  if (!onNewLink && !listChannels) return null;

  const loadChannels = (): void => {
    if (!listChannels) return;
    setState({ phase: "loading" });
    void listChannels()
      .then((channels) => setState({ phase: "ready", channels }))
      .catch(() => setState({ phase: "error" }));
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && listChannels && state.phase !== "ready") loadChannels();
      }}
    >
      <DropdownMenuTrigger asChild>
        <ColorSwatchTrigger
          className="calendar-event-dialog__meet-menu-trigger"
          label={labels.eventMeetAdd}
          showSwatch={false}
          icon={reserving ? <LoadingSpinner size="sm" /> : <Video />}
          disabled={disabled || reserving}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="calendar-event-dialog__meet-menu">
        {onNewLink ? (
          <DropdownMenuItem onSelect={() => onNewLink()}>
            <Video className="size-3.5" aria-hidden />
            {labels.eventMeetNewLink}
          </DropdownMenuItem>
        ) : null}
        {onNewLink && listChannels ? <DropdownMenuSeparator /> : null}
        {listChannels && (state.phase === "loading" || state.phase === "idle") ? (
          <DropdownMenuItem disabled>
            <LoadingSpinner size="sm" />
            {labels.eventMeetChannelsLoading}
          </DropdownMenuItem>
        ) : null}
        {listChannels && state.phase === "error" ? (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              loadChannels();
            }}
          >
            {labels.eventMeetChannelsError}
          </DropdownMenuItem>
        ) : null}
        {listChannels && state.phase === "ready" && state.channels.length === 0 ? (
          <DropdownMenuItem disabled>{labels.eventMeetChannelsEmpty}</DropdownMenuItem>
        ) : null}
        {listChannels && state.phase === "ready"
          ? state.channels.map((channel) => (
              <DropdownMenuItem key={channel.id} onSelect={() => onPick?.(channel)}>
                {channel.kind === "meeting" ? (
                  <Video className="size-3.5" aria-hidden />
                ) : (
                  <Hash className="size-3.5" aria-hidden />
                )}
                {channel.name}
              </DropdownMenuItem>
            ))
          : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
