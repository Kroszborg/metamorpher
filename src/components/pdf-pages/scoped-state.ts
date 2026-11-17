'use client';

import { type SetStateAction, useCallback, useState } from 'react';

/**
 * State that starts over whenever a scope changes (a new file, a document
 * that finished loading). Declare it before `useWorkbench` so the value can
 * go into the job options, then call `sync(scope, init)` once the scope is
 * known in the same render; React re-renders right away with the new value.
 *
 *   const [pages, setPages, syncPages] = useScopedState(new Set<number>());
 *   const wb = useWorkbench({ job, options: { pages }, … });
 *   const doc = usePdfPreview(wb.files[0]);
 *   syncPages(doc.status === 'ready' ? wb.files[0]?.id : null, () => new Set());
 */
export function useScopedState<T>(initial: T) {
  const [state, setState] = useState<{ scope: string | null; value: T }>({ scope: null, value: initial });

  const setValue = useCallback((action: SetStateAction<T>) => {
    setState((prev) => ({
      scope: prev.scope,
      value: typeof action === 'function' ? (action as (p: T) => T)(prev.value) : action,
    }));
  }, []);

  const sync = (scope: string | null | undefined, init: () => T) => {
    const key = scope ?? null;
    if (state.scope !== key) setState({ scope: key, value: init() });
  };

  return [state.value, setValue, sync] as const;
}
