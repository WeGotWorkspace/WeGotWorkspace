import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { REFRESH_SPIN_CLASSNAME } from "@/refresh-spin/src/refresh-spin";
import { useRefreshSpin } from "@/refresh-spin/src/use-refresh-spin";
import "@/refresh-spin/src/refresh-spin.css";

type RefreshSpinIconProps = {
  /** True while the underlying refresh request is in flight. */
  spinning: boolean;
  className?: string;
};

/**
 * Lucide RefreshCw that always completes ≥1 full 360° turn when spinning starts,
 * even if `spinning` clears mid-cycle.
 */
export function RefreshSpinIcon({ spinning, className }: RefreshSpinIconProps) {
  const showSpin = useRefreshSpin(spinning);
  return <RefreshCw className={cn(className, showSpin && REFRESH_SPIN_CLASSNAME)} aria-hidden />;
}
