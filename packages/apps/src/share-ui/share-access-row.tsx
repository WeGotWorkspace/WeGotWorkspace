import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { CardRow } from "@/card/src/card-row";
import { shareLabels } from "@/share-ui/share-labels";

export type ShareAccessRowProps = {
  mark: ReactNode;
  title: string;
  subtitle?: string;
  titleExtra?: ReactNode;
  titleEnd?: ReactNode;
  /** Trailing control (permission or meeting-role select). */
  trailing?: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  removeDisabled?: boolean;
  removeTitle?: string;
  /** Show a disabled remove control (inherited Drive rows). */
  showRemove?: boolean;
};

export function ShareAccessRow({
  mark,
  title,
  subtitle,
  titleExtra,
  titleEnd,
  trailing,
  onRemove,
  removeLabel = shareLabels.removeGrant,
  removeDisabled = false,
  removeTitle,
  showRemove,
}: ShareAccessRowProps) {
  const canRemove = Boolean(onRemove) && !removeDisabled;
  const renderRemove = showRemove ?? Boolean(onRemove);

  return (
    <CardRow
      leading={mark}
      title={title}
      subtitle={subtitle}
      titleExtra={titleExtra}
      titleEnd={titleEnd}
    >
      {trailing}
      {renderRemove ? (
        <IconButton
          label={removeLabel}
          icon={<Trash2 className="size-3.5" aria-hidden />}
          size="sm"
          variant="outline"
          disabled={!canRemove}
          title={removeTitle}
          onClick={canRemove ? onRemove : undefined}
        />
      ) : null}
    </CardRow>
  );
}
