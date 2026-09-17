import { BooleanSegmentedControl } from "@/segmented-control/src/segmented-control";
import { installWorkspacePaneClasses as c } from "@/install-core/src/install-workspace.styles";

export function InstallFeatureRow({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className={c.featureRow}>
      <div className="min-w-0">
        <div className={c.featureRowTitle}>{label}</div>
        <div className={c.featureRowDesc}>{desc}</div>
      </div>
      <BooleanSegmentedControl value={value} onChange={onChange} aria-label={`${label} enabled`} />
    </div>
  );
}
