import { useCallback, useRef, useState } from "react";

const RESET_DELAY_MS = 1500;

/**
 * "Copy text to the clipboard, then show a confirmation for a bit" — the same pattern
 * OnlineGameScreen needed three times over (the game code, the game link, and a per-seat
 * invite link keyed by token), each previously with its own copy of this exact state +
 * try/catch + setTimeout dance. `copiedKey` is null once the confirmation has faded, or
 * whatever key was passed to `copy()` while it's still showing — for a single yes/no
 * confirmation just always pass the same key and compare `copiedKey === thatKey`; for a
 * list of copyable items (like one button per seat), pass each item's own id as the key
 * and compare against `copiedKey` to know which single item should show "¡Copiado!".
 */
export function useClipboardCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), RESET_DELAY_MS);
    } catch {
      // Clipboard permission denied/unavailable — the text is still visible on screen.
    }
  }, []);

  return { copiedKey, copy };
}
