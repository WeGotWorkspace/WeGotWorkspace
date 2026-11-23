import { Send } from "lucide-react";
import { IconButton, type IconButtonProps } from "@/button/src/icon-button";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";

export type ComposerSendButtonProps = Omit<
  IconButtonProps,
  "label" | "icon" | "variant" | "size"
> & {
  label?: string;
};

/** The suite send button: Meet, Tasks and Docs composers all submit with this one. */
export function ComposerSendButton({
  label = chatUiLabels.send,
  ...rest
}: ComposerSendButtonProps) {
  return <IconButton label={label} icon={<Send />} size="md" variant="ghost" {...rest} />;
}
