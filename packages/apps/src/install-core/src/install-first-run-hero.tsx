import type { ReactElement } from "react";

export type InstallFirstRunHeroProps = {
  italic: string;
  noun: string;
};

/** Italic display word + lowercase sans-serif noun. Same classes on every first-run step. */
export function InstallFirstRunHero({ italic, noun }: InstallFirstRunHeroProps): ReactElement {
  return (
    <>
      <span className="install-first-run__hero-your">{italic}</span>{" "}
      <span className="install-first-run__hero-noun">{noun}</span>
    </>
  );
}
