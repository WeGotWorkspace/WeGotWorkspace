/**
 * Text fields match `:focus-visible` on mouse click. Buttons do not.
 * Track the last input so the shared ring stays keyboard-only.
 */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

let installed = false;

export function installKeyboardFocusModality(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  const root = document.documentElement;
  const setModality = (modality: "keyboard" | "pointer") => {
    if (root.dataset.modality === modality) return;
    root.dataset.modality = modality;
  };

  document.addEventListener(
    "pointerdown",
    () => {
      setModality("pointer");
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (MODIFIER_KEYS.has(event.key)) return;
      setModality("keyboard");
    },
    true,
  );
}
