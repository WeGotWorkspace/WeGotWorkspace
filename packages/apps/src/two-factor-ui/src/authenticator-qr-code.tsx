import { useMemo } from "react";
import { encode } from "uqr";
import { twoFactorLabels } from "@/two-factor-ui/src/two-factor-labels";
import "./two-factor-ui.css";

/**
 * The `otpauth://` URI as a QR code, drawn here as an SVG: the secret never goes to another
 * service. Dark modules on white in both themes, with a quiet zone, so phone cameras read it.
 */
export function AuthenticatorQrCode({ uri }: { uri: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(uri, { ecc: "M", border: 2 });
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size: qr.size, path: d };
  }, [uri]);
  return (
    <svg
      className="two-factor-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={twoFactorLabels.qrLabel}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
