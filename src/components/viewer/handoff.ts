/**
 * Hands files from one page to another without uploading them: the files stay
 * in this module (in memory) across a client-side navigation, and the target
 * tool receives them as if they had been pasted. Viewer pages take them
 * directly with `takeHandoff`.
 */

let pending: { slug: string; files: File[]; at: number } | null = null;

const FRESH_MS = 20_000;

/** Viewer frames call this on mount: the files handed to `slug`, once. */
export function takeHandoff(slug: string): File[] | null {
  if (!pending || pending.slug !== slug || Date.now() - pending.at > FRESH_MS) return null;
  const files = pending.files;
  pending = null;
  return files;
}

/** True when a viewer frame for `slug` will pick the files up itself. */
function isViewerSlug(slug: string, viewerSlugs: readonly string[]): boolean {
  return viewerSlugs.includes(slug);
}

/**
 * Navigates to `/tools/<slug>` with `files`. Viewer tools take them on mount;
 * any other tool gets them through a paste event on its drop zone (the
 * workbench drop zones accept pasted files), sent once its file input exists.
 */
export function handOff(
  slug: string,
  files: File[],
  navigate: (href: string) => void,
  viewerSlugs: readonly string[],
): void {
  pending = { slug, files, at: Date.now() };
  navigate(`/tools/${slug}`);
  if (isViewerSlug(slug, viewerSlugs)) return;
  const target = `/tools/${slug}`;
  const started = Date.now();
  const timer = window.setInterval(() => {
    if (Date.now() - started > FRESH_MS || pending?.slug !== slug) {
      window.clearInterval(timer);
      return;
    }
    if (window.location.pathname !== target) return;
    const input = document.querySelector('main input[type="file"]');
    if (!input) return;
    window.clearInterval(timer);
    const handed = pending.files;
    pending = null;
    // Let the tool finish mounting its paste listener.
    window.setTimeout(() => {
      try {
        const data = new DataTransfer();
        for (const f of handed) data.items.add(f);
        // Dispatched on <body> so it bubbles to the window listener with an element target.
        document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
      } catch {
        // Browsers without constructible clipboard events: the person adds the file again.
      }
    }, 150);
  }, 120);
}
