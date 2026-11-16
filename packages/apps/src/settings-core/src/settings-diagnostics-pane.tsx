import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/button/src/button";
import { useAppToast } from "@/hooks/use-app-toast";
import { wgwBuildVersion } from "@/lib/diagnostics/build-version";
import {
  ERROR_DIAGNOSTICS_LIMIT,
  readErrorDiagnostics,
  type ErrorDiagnosticEntry,
} from "@/lib/diagnostics/error-diagnostics-store";
import { formatErrorDiagnosticsText } from "@/lib/diagnostics/error-diagnostics-text";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { copyShareText } from "@/share-ui/share-path-utils";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Textarea } from "@/ui/textarea";
import "./settings-diagnostics-pane.css";

export const settingsDiagnosticsLabels = {
  panel: "Diagnostics",
  panelDescription: "Recent errors on this device, for a bug report",
  intro: `When something goes wrong in this browser, the last ${ERROR_DIAGNOSTICS_LIMIT} errors are kept on this device. Nothing is sent anywhere. Copy them and paste them into your bug report. Signing out clears them.`,
  row: "Recent errors",
  copy: "Copy diagnostics",
  copied: "Diagnostics copied",
  checking: "Checking this device…",
  empty: "No errors recorded on this device.",
  unreadable: "Could not read the errors kept on this device.",
  previewLabel: "Diagnostics text",
  copyBlocked:
    "This browser blocked copying. The text below is selected: press Ctrl+C (⌘C on a Mac) to copy it.",
} as const;

type Props = {
  load?: () => Promise<ErrorDiagnosticEntry[]>;
  copyText?: (text: string) => Promise<boolean>;
  now?: () => Date;
};

const currentTime = () => new Date();

function diagnosticsText(rows: readonly ErrorDiagnosticEntry[], copiedAt: Date): string {
  return formatErrorDiagnosticsText(rows, {
    build: wgwBuildVersion(),
    userAgent: navigator.userAgent,
    copiedAt,
  });
}

function summary(entries: ErrorDiagnosticEntry[] | null, unreadable: boolean): string {
  if (unreadable) return settingsDiagnosticsLabels.unreadable;
  if (entries === null) return settingsDiagnosticsLabels.checking;
  if (entries.length === 0) return settingsDiagnosticsLabels.empty;
  const newest = new Date(entries[0]?.time ?? "").toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const noun = entries.length === 1 ? "error" : "errors";
  return `${entries.length} ${noun} kept on this device. Newest: ${newest}.`;
}

/** Settings → Diagnostics (#2204): copy the on-device error buffer into a bug report. */
export function SettingsDiagnosticsPane({
  load = readErrorDiagnostics,
  copyText = copyShareText,
  now = currentTime,
}: Props) {
  const { showSuccess } = useAppToast();
  // Read once, when the pane opens.
  const loadOnOpen = useRef(load);
  const [openedAt] = useState(now);
  const [entries, setEntries] = useState<ErrorDiagnosticEntry[] | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [copyBlocked, setCopyBlocked] = useState(false);
  const previewRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadOnOpen.current().then(
      (rows) => {
        if (!cancelled) setEntries(rows);
      },
      () => {
        if (cancelled) return;
        setEntries([]);
        setUnreadable(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = async () => {
    if (!entries?.length) return;
    const next = diagnosticsText(entries, now());
    setCopiedText(next);
    if (await copyText(next)) {
      setCopyBlocked(false);
      showSuccess(settingsDiagnosticsLabels.copied);
      return;
    }
    setCopyBlocked(true);
    previewRef.current?.focus();
    previewRef.current?.select();
  };

  const hasEntries = Boolean(entries?.length);
  /** Exactly what Copy puts on the clipboard: what was copied last, else the text as of opening. */
  const text = copiedText ?? (entries ? diagnosticsText(entries, openedAt) : "");

  return (
    <SettingsPaneCard>
      <div className="settings-diagnostics-pane">
        <p className="settings-diagnostics-pane__intro">{settingsDiagnosticsLabels.intro}</p>
        <FieldLabelRow
          layout="inline"
          label={settingsDiagnosticsLabels.row}
          description={summary(entries, unreadable)}
          below={
            hasEntries ? (
              <div className="settings-diagnostics-pane__preview">
                {copyBlocked ? (
                  <p role="alert" className="settings-diagnostics-pane__blocked">
                    {settingsDiagnosticsLabels.copyBlocked}
                  </p>
                ) : null}
                <Textarea
                  ref={previewRef}
                  readOnly
                  rows={10}
                  spellCheck={false}
                  aria-label={settingsDiagnosticsLabels.previewLabel}
                  className="settings-diagnostics-pane__text"
                  value={text}
                />
              </div>
            ) : undefined
          }
        >
          <Button
            type="button"
            variant="outline"
            icon={<Copy aria-hidden />}
            label={settingsDiagnosticsLabels.copy}
            disabled={!hasEntries}
            onClick={() => {
              void handleCopy();
            }}
          />
        </FieldLabelRow>
      </div>
    </SettingsPaneCard>
  );
}
