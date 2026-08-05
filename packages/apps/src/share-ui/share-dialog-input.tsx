import type { ComponentProps } from "react";
import { Input } from "@/ui/input";
import { cn } from "@/lib/utils";

type ShareDialogInputProps = ComponentProps<typeof Input> & {
  mono?: boolean;
};

export function ShareDialogInput({ className, mono = false, ...props }: ShareDialogInputProps) {
  return (
    <Input
      className={cn("share-dialog__input", mono && "share-dialog__input--mono", className)}
      {...props}
    />
  );
}
