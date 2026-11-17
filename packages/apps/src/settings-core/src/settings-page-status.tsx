import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The end of the Settings page title row, where the save tag sits. A pane with a state of its
 * own (Incoming email: connected, checking, paused) shows its tag there instead; the save tag
 * then steps aside (`settings-workspace.css`).
 */
export const SettingsPageStatusSlotContext = createContext<HTMLElement | null>(null);

/** Renders `children` in the page title row; `fallback` where there is no such row. */
export function SettingsPageStatus({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  const slot = useContext(SettingsPageStatusSlotContext);
  return slot ? createPortal(children, slot) : fallback;
}
