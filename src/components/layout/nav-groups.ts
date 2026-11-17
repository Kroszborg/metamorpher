import type { Category, CategoryId } from '@/tools/types';
import { activeCategories, toolsInCategory } from '@/tools/registry';

/** A top-bar menu: one or more categories under a short label. */
export type NavGroup = {
  id: string;
  label: string;
  categories: Category[];
  toolCount: number;
};

/** Fixed groups, in top-bar order. Categories not listed here are placed by `buildNavGroups`. */
const FIXED: { id: string; label: string; categories: CategoryId[] }[] = [
  {
    id: 'pdf',
    label: 'PDF',
    categories: ['page-management', 'edit-annotate', 'convert-to-pdf', 'convert-from-pdf', 'security'],
  },
  { id: 'image', label: 'Image', categories: ['image'] },
  { id: 'media', label: 'Audio & video', categories: ['media'] },
  { id: 'ai', label: 'AI', categories: ['ai'] },
];

/** Shorter top-bar labels for categories that get a menu of their own. */
const SHORT_LABEL: Partial<Record<CategoryId, string>> = {
  business: 'Business',
  workflow: 'Workflow',
  share: 'Share',
};

/** A category outside the fixed groups gets its own menu once it has this many tools. */
const OWN_MENU_AT = 4;

/**
 * The top-bar menus, derived from the registry: only categories with a shipped
 * tool appear. Categories outside the fixed groups get their own menu when
 * they are big enough, and otherwise share a "More" menu, so new categories
 * show up without touching this file.
 */
export function buildNavGroups(): NavGroup[] {
  const active = activeCategories();
  const byId = new Map(active.map((c) => [c.id, c]));
  const count = (cats: Category[]) => cats.reduce((n, c) => n + toolsInCategory(c.id).length, 0);
  const placed = new Set<CategoryId>();

  const groups: NavGroup[] = [];
  for (const def of FIXED) {
    const categories = def.categories.flatMap((id) => {
      const c = byId.get(id);
      return c ? [c] : [];
    });
    categories.forEach((c) => placed.add(c.id));
    if (categories.length) groups.push({ id: def.id, label: def.label, categories, toolCount: count(categories) });
  }

  const rest = active.filter((c) => !placed.has(c.id));
  const more: Category[] = [];
  for (const c of rest) {
    if (toolsInCategory(c.id).length >= OWN_MENU_AT) {
      groups.push({ id: c.id, label: SHORT_LABEL[c.id] ?? c.title, categories: [c], toolCount: count([c]) });
    } else {
      more.push(c);
    }
  }
  if (more.length) groups.push({ id: 'more', label: 'More', categories: more, toolCount: count(more) });
  return groups;
}

/** The group a route belongs to: a category page or a tool page inside one of its categories. */
export function activeGroupId(
  groups: NavGroup[],
  pathname: string,
  categoryOfTool: (slug: string) => string | undefined,
): string | undefined {
  const [, seg, slug] = pathname.split('/');
  const categoryId = seg === 'category' ? slug : seg === 'tools' && slug ? categoryOfTool(slug) : undefined;
  if (!categoryId) return undefined;
  return groups.find((g) => g.categories.some((c) => c.id === categoryId))?.id;
}
