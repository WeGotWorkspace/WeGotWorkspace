import type { IconButtonProps } from "@/button/src/button";
import { IconButton } from "@/button/src/button";

/** Drive list/grid row icon button — matches {@link DriveFileItemActionsMenu} trigger sizing. */
export function DriveItemIconButton({
  size = "sm",
  variant = "outline",
  onClick,
  ...props
}: IconButtonProps) {
  return (
    <IconButton
      size={size}
      variant={variant}
      {...props}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    />
  );
}
