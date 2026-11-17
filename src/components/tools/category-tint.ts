/**
 * Per-category icon tint, so a long list of tools can be scanned by kind.
 * Tints are used on icons only (never on text or surfaces) and come from the
 * Citrus palette's own tokens: lime for PDF, blue for images, orange for audio
 * and video, amber for AI. Anything else (including categories added later)
 * stays neutral.
 */
export type Tint = { icon: string; tile: string };

const PDF: Tint = { icon: 'text-primary', tile: 'bg-primary/10' };
const IMAGE: Tint = { icon: 'text-viz-2', tile: 'bg-viz-2/10' };
const MEDIA: Tint = { icon: 'text-viz-3', tile: 'bg-viz-3/10' };
const AI: Tint = { icon: 'text-warning', tile: 'bg-warning/10' };
const NEUTRAL: Tint = { icon: 'text-muted-foreground', tile: 'bg-muted' };

const TINTS: Record<string, Tint> = {
  'page-management': PDF,
  'edit-annotate': PDF,
  'convert-to-pdf': PDF,
  'convert-from-pdf': PDF,
  security: PDF,
  image: IMAGE,
  media: MEDIA,
  ai: AI,
};

export function categoryTint(categoryId: string): Tint {
  return TINTS[categoryId] ?? NEUTRAL;
}
