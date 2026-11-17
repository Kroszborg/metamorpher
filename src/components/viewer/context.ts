'use client';

import { createContext, useContext, useEffect } from 'react';
import type { Sniffed, ViewKind } from './sniff';

/** What every viewer receives. Viewers only read files; they never change them. */
export type ViewerProps = {
  file: File;
  sniff: Sniffed;
  /** Every file opened in the frame (galleries and playlists use them all). */
  files: File[];
  index: number;
  onIndex: (i: number) => void;
};

export type Shortcut = { keys: string; label: string };

type ViewerApi = {
  fullscreen: boolean;
  setShortcuts: (list: Shortcut[]) => void;
  /** Show the file with another viewer (null = the detected one). */
  viewAs: (kind: ViewKind | null) => void;
};

export const ViewerContext = createContext<ViewerApi>({
  fullscreen: false,
  setShortcuts: () => undefined,
  viewAs: () => undefined,
});

export function useViewer(): ViewerApi {
  return useContext(ViewerContext);
}

/** Lists a viewer's keyboard shortcuts in the frame's help (pass a module-level constant). */
export function useShortcuts(list: Shortcut[]): void {
  const { setShortcuts } = useViewer();
  useEffect(() => {
    setShortcuts(list);
    return () => setShortcuts([]);
  }, [list, setShortcuts]);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || !!target.closest('.cm-editor');
}

/**
 * Document-level shortcuts that stay quiet while someone types in a field or a
 * dialog is open. `handler` returns true when it handled the key.
 */
export function useKeys(handler: (e: KeyboardEvent) => boolean | void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]:not([data-viewer-panel]), [role="menu"], [role="listbox"]')) return;
      if (handler(e) === true) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handler, enabled]);
}
