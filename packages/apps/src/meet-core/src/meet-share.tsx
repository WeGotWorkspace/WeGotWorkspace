import { Copy, Link as LinkIcon } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { meetLabels } from "@/meet-core/src/meet-labels";

type MeetShareButtonProps = {
  link: string;
  onCopy: () => void;
};

export function MeetShareButton({ link, onCopy }: MeetShareButtonProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton icon={<LinkIcon />} label={meetLabels.shareLink} variant="subtle" />
      </PopoverTrigger>
      <PopoverContent align="end" className="meet-popover-surface w-96 p-3">
        <div className="space-y-2">
          <div className="text-xs" style={{ color: "var(--meet-muted)" }}>
            {meetLabels.shareLinkHint}
          </div>
          <div className="meet-share-field">
            <span className="min-w-0 flex-1 truncate text-sm">
              {link || meetLabels.shareLinkPlaceholder}
            </span>
            <IconButton
              className="size-7 shrink-0"
              disabled={!link}
              onClick={onCopy}
              label={meetLabels.copyLink}
              icon={<Copy />}
              variant="subtle"
              showTooltip={false}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type MeetShareInlineProps = {
  link: string;
  onCopy: () => void;
};

export function MeetShareInline({ link, onCopy }: MeetShareInlineProps) {
  return (
    <div className="meet-share-inline">
      <div className="flex min-w-0 items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm">
          {link || meetLabels.shareLinkWaiting}
        </span>
        <IconButton
          className="size-8 shrink-0"
          disabled={!link}
          onClick={onCopy}
          label={meetLabels.copyLink}
          icon={<Copy />}
          variant="subtle"
          showTooltip={false}
        />
      </div>
    </div>
  );
}
