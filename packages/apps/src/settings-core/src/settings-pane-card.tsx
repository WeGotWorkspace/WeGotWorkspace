import type { ReactNode } from "react";
import { Card } from "@/card/src/card";

/** Catalog chrome for Settings-app panes. Dialog CSS strips the card. */
export function SettingsPaneCard({ children }: { children: ReactNode }) {
  return <Card className="settings-pane-card">{children}</Card>;
}
