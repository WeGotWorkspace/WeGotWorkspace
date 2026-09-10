import { IconButton } from "@/button/src/button";
import { cn } from "@/lib/utils";
import "@/floating-action-bar/src/floating-action-bar.css";

export type FloatingActionBarButton = {
  id?: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
};

type FloatingActionBarProps = {
  items: number;
  buttons: FloatingActionBarButton[];
  children?: React.ReactNode;
  className?: string;
};

export function FloatingActionBar({ items, buttons, children, className }: FloatingActionBarProps) {
  return (
    <div
      className={cn("floating-action-bar", className)}
      role="toolbar"
      aria-label="Selection actions"
    >
      <span className="floating-action-bar__count">{items} selected</span>
      <div className="floating-action-bar__actions">
        {buttons.map((button) => (
          <IconButton
            key={button.id ?? button.label}
            label={button.label}
            icon={button.icon}
            onClick={button.onClick}
            size="sm"
            variant="outline"
          />
        ))}
        {children}
      </div>
    </div>
  );
}
