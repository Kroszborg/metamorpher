import type * as React from 'react';

/** A light checkerboard that shows transparent pixels, in both themes. */
export const CHECKERBOARD: React.CSSProperties = {
  backgroundColor: 'var(--card)',
  backgroundImage:
    'conic-gradient(rgb(128 128 128 / 0.16) 25%, transparent 0 50%, rgb(128 128 128 / 0.16) 0 75%, transparent 0)',
  backgroundSize: '16px 16px',
};
