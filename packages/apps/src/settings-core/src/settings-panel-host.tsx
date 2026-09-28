import { Fragment } from "react";
import type { SettingsReachabilityContext } from "@/settings-core/src/settings-reachability";
import { slicesFor, type SettingsSliceRenderProps } from "@/settings-core/src/settings-registry";
import type { SettingsPanelId } from "@/settings-core/src/settings-types";

export function SettingsPanelHost({
  panelId,
  ctx,
  slices,
}: {
  panelId: SettingsPanelId;
  ctx: SettingsReachabilityContext;
  slices: SettingsSliceRenderProps;
}) {
  return (
    <>
      {slicesFor(panelId, ctx).map((slice) => (
        <Fragment key={slice.id}>{slice.render(slices)}</Fragment>
      ))}
    </>
  );
}
