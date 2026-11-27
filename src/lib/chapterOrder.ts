import { useCallback, useEffect, useState } from "react";

/**
 * Which way chapter lists run: first chapter at the top, or the newest.
 *
 * One setting for every chapter list in the app — reading mode, the volume
 * panel, the reader's picker, the discover sheets. Someone following a
 * series as it comes out wants the newest first everywhere, and flipping it
 * screen by screen would be a chore that never stays done.
 *
 * Display only. "Next chapter" is the next one in the story whichever way a
 * list is drawn, and a volume is built in reading order, so nothing that
 * steps through chapters or writes them looks at this.
 *
 * Kept in localStorage like the reader's own preferences: it is how lists
 * look on this machine, not something the library needs to know.
 */
export type ChapterOrder = "asc" | "desc";

const KEY = "leaf:chapter-order";
/** Lets every list on screen follow a flip made in any one of them. */
const EVENT = "leaf:chapter-order";

function read(): ChapterOrder {
  try {
    return localStorage.getItem(KEY) === "desc" ? "desc" : "asc";
  } catch {
    return "asc";
  }
}

export function useChapterOrder(): [ChapterOrder, () => void] {
  const [order, setOrder] = useState<ChapterOrder>(read);

  useEffect(() => {
    const sync = () => setOrder(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const toggle = useCallback(() => {
    const next: ChapterOrder = read() === "asc" ? "desc" : "asc";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private storage off: the flip lasts as long as this page does.
    }
    setOrder(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [order, toggle];
}

/** A list in reading order, drawn the way the user asked. */
export function inOrder<T>(list: readonly T[], order: ChapterOrder): T[] {
  return order === "desc" ? [...list].reverse() : [...list];
}
