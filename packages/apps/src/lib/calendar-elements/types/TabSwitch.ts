import type { TemplateResult } from "lit";

export type TabSwitchOption = {
  label: string | TemplateResult;
  value: string;
  hotkey?: string;
  ariaLabel?: string;
};
