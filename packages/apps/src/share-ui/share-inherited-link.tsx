import { CornerDownRight } from "lucide-react";
import { formatSharePathLabel, shareLabels } from "@/share-ui/share-labels";

type ShareInheritedLinkProps = {
  sharePath: string;
  onOpenAccess?: (path: string) => void;
};

export function ShareInheritedLink({ sharePath, onOpenAccess }: ShareInheritedLinkProps) {
  const label = formatSharePathLabel(sharePath);
  const title = `${shareLabels.inheritedFrom(label)} — open Access manager`;

  if (!onOpenAccess) {
    return (
      <span className="share-dialog__inherited-link" title={title}>
        <CornerDownRight className="share-dialog__inherited-link-icon" aria-hidden />
        {shareLabels.inheritedFrom(label)}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="share-dialog__inherited-link"
      title={title}
      onClick={() => onOpenAccess(sharePath)}
    >
      <CornerDownRight className="share-dialog__inherited-link-icon" aria-hidden />
      {shareLabels.inheritedFrom(label)}
    </button>
  );
}
