import { useEffect, type ReactNode } from "react";

/** Dark tokens live on `:root[data-theme="dark"]`, so the story flips <html>. */
export function DarkThemeRoot({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = "dark";
    return () => {
      if (previous === undefined) delete root.dataset.theme;
      else root.dataset.theme = previous;
    };
  }, []);
  return children;
}

/** Story decorator: render in the dark theme. */
export function withDarkTheme(Story: () => ReactNode) {
  return (
    <DarkThemeRoot>
      <Story />
    </DarkThemeRoot>
  );
}
