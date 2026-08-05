import { CornerDownRight } from "lucide-react";
import { formatSharePathLabel, shareLabels } from "@/share-ui/share-labels";

type ShareInheritedLabelProps = {
  sharePath: string;
};

export function ShareInheritedLabel({ sharePath }: ShareInheritedLabelProps) {
  const label = formatSharePathLabel(sharePath);

  return (
    <span className="share-dialog__inherited-label" title={shareLabels.inheritedFrom(label)}>
      <CornerDownRight className="share-dialog__inherited-label-icon" aria-hidden />
      {shareLabels.inheritedFrom(label)}
    </span>
  );
}
