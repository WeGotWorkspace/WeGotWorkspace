import { useCallback, useState } from "react";

export function useDocsCommentsSelectionVersion(): {
  selectionVersion: number;
  bumpSelectionVersion: () => void;
} {
  const [selectionVersion, setSelectionVersion] = useState(0);
  const bumpSelectionVersion = useCallback(() => {
    setSelectionVersion((version) => version + 1);
  }, []);
  return { selectionVersion, bumpSelectionVersion };
}
