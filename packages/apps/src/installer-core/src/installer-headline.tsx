import type { ReactElement } from "react";

export type InstallerHeadlineProps = {
  italic: string;
  noun: string;
};

/** Italic display word + lowercase sans-serif noun. Same classes on every installer step. */
export function InstallerHeadline({ italic, noun }: InstallerHeadlineProps): ReactElement {
  return (
    <>
      <span className="installer__hero-your">{italic}</span>{" "}
      <span className="installer__hero-noun">{noun}</span>
    </>
  );
}
