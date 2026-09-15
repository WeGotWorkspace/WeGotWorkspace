import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { cn } from "@/lib/utils";

import "./card.css";

export type CardProps = {
  title?: string;
  titleIcon?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  iconActions?: CardIconAction[];
};

export type CardIconAction = {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

function CardIconActionButton({ icon, label, onClick, disabled }: CardIconAction) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className="card__icon-action"
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Card({
  title,
  titleIcon,
  description,
  children,
  className,
  action,
  iconActions,
}: CardProps) {
  const hasHeader =
    title || titleIcon || description || action || (iconActions && iconActions.length > 0);

  const titleBlock =
    title || titleIcon || description ? (
      <div className="card__title-block">
        {title || titleIcon ? (
          <div className="card__title-group">
            {titleIcon ? (
              <span className="card__title-icon" aria-hidden>
                {titleIcon}
              </span>
            ) : null}
            {title ? <h2 className="card__title">{title}</h2> : null}
          </div>
        ) : null}
        {description ? <p className="card__description">{description}</p> : null}
      </div>
    ) : null;

  const headerActions =
    iconActions && iconActions.length > 0 ? (
      <div className="card__icon-actions">
        {iconActions.map((iconAction) => (
          <CardIconActionButton key={iconAction.label} {...iconAction} />
        ))}
      </div>
    ) : (
      action
    );

  return (
    <section className={cn("card", className)}>
      {hasHeader ? (
        <div className="card__header">
          {titleBlock && headerActions ? (
            <div className="card__header-row">
              {titleBlock}
              {headerActions}
            </div>
          ) : (
            (titleBlock ?? headerActions)
          )}
        </div>
      ) : null}
      {children}
    </section>
  );
}
