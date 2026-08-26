import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Escape-to-close, initial focus, and a Tab focus trap for a modal dialog. Attach the
 * returned ref (plus `tabIndex={-1}`) to the dialog's outer element so focus has
 * somewhere to land that isn't the page behind the overlay.
 */
export function useModalDismiss<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  // A caller that passes an inline onClose (a new function identity every render, e.g.
  // OnlineGameScreen's polling causing frequent re-renders) must not re-run the effects
  // below -- always reading the latest onClose through this ref instead of putting it in
  // a dependency array keeps both mount-only, so focus is only ever moved once.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      const dialog = ref.current;
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return ref;
}
