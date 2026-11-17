/** Page backgrounds per theme; must match `--background` in src/app/colors.css. */
export const THEME_BACKGROUND = { light: '#f7f8f2', dark: '#080907' } as const;

/** Copies the active `--background` into <meta name="theme-color">. */
export function syncThemeColor(): void {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  if (!bg) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = bg;
}

/**
 * Inline script for <head>: sets theme-color before first paint so the browser
 * chrome does not flash the wrong colour. Mirrors next-themes' storage key.
 */
export function themeColorBootScript(): string {
  return `(function(){try{var b=${JSON.stringify(THEME_BACKGROUND)},t=null;try{t=localStorage.getItem('theme')}catch(e){}var dark=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var m=document.createElement('meta');m.name='theme-color';m.content=b[dark?'dark':'light'];document.head.appendChild(m)}catch(e){}})();`;
}
