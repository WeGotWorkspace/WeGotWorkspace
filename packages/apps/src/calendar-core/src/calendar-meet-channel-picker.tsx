import { useState } from "react";
import { Hash, MessagesSquare, Video } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarMeetChannelOption } from "@/calendar-core/src/calendar-meet-link";

export type CalendarMeetChannelPickerProps = {
  labels: CalendarUILabels;
  listChannels: () => Promise<CalendarMeetChannelOption[]>;
  disabled?: boolean;
  onPick: (channel: CalendarMeetChannelOption) => void;
};

type ChannelLoadState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; channels: CalendarMeetChannelOption[] };

/**
 * "Pick a Meet channel" menu next to the ad-hoc generate button: lists the
 * user's chat channels (kind channel + meeting, dm rows already filtered by
 * the operations layer) and attaches the channel's call URL to the event.
 * Channels are fetched lazily when the menu opens.
 */
export function CalendarMeetChannelPicker({
  labels,
  listChannels,
  disabled = false,
  onPick,
}: CalendarMeetChannelPickerProps) {
  const [state, setState] = useState<ChannelLoadState>({ phase: "idle" });

  const loadChannels = (): void => {
    setState({ phase: "loading" });
    void listChannels()
      .then((channels) => setState({ phase: "ready", channels }))
      .catch(() => setState({ phase: "error" }));
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && state.phase !== "ready") loadChannels();
      }}
    >
      <DropdownMenuTrigger asChild>
        <IconButton
          className="calendar-event-dialog__meet-pick-channel"
          label={labels.eventMeetPickChannel}
          icon={<MessagesSquare className="size-3.5" aria-hidden />}
          size="sm"
          variant="outline"
          disabled={disabled}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="calendar-event-dialog__meet-channel-menu">
        <DropdownMenuLabel>{labels.eventMeetPickChannel}</DropdownMenuLabel>
        {state.phase === "loading" || state.phase === "idle" ? (
          <DropdownMenuItem disabled>
            <LoadingSpinner size="sm" />
            {labels.eventMeetChannelsLoading}
          </DropdownMenuItem>
        ) : null}
        {state.phase === "error" ? (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              loadChannels();
            }}
          >
            {labels.eventMeetChannelsError}
          </DropdownMenuItem>
        ) : null}
        {state.phase === "ready" && state.channels.length === 0 ? (
          <DropdownMenuItem disabled>{labels.eventMeetChannelsEmpty}</DropdownMenuItem>
        ) : null}
        {state.phase === "ready"
          ? state.channels.map((channel) => (
              <DropdownMenuItem key={channel.id} onSelect={() => onPick(channel)}>
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
