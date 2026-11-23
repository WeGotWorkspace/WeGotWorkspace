import { Send } from "lucide-react";
import { IconButton, type IconButtonProps } from "@/button/src/icon-button";

export type ComposerSendButtonProps = Omit<
  IconButtonProps,
  "label" | "icon" | "variant" | "size"
> & {
  label?: string;
};

/** The suite send button: Meet, Tasks and Docs composers all submit with this one. */
export function ComposerSendButton({ label = "Send", ...rest }: ComposerSendButtonProps) {
  return <IconButton label={label} icon={<Send />} size="md" variant="ghost" {...rest} />;
}
