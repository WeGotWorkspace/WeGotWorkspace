import type { ComponentProps } from "react";
import { Input } from "@/ui/input";
import { cn } from "@/lib/utils";

/** A share field (link, password, add people): the dialog's field size. */
export function ShareDialogInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input className={cn("share-dialog__input", className)} {...props} />;
}
