import type { ComponentProps } from "react";
import { Input } from "@/ui/input";
import { cn } from "@/lib/utils";

export function ShareDialogInput({
  className,
  size = "sm",
  ...props
}: ComponentProps<typeof Input>) {
  return <Input className={cn("share-dialog__input", className)} size={size} {...props} />;
}
