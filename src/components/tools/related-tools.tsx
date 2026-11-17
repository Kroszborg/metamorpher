import { buildNavGroups } from '@/components/layout/nav-groups';
import { getCategory } from '@/tools/categories';
import { toInfo, toolsInCategory } from '@/tools/registry';
import type { AvailableTool } from '@/tools/types';
import { CategoryHeading } from './tool-grid';
import { ToolCard, ToolCardGrid } from './tool-card';

const MAX = 8;

/**
 * "More in <category>" under a tool: other tools from the same category, or,
 * for a category of one, from the same top-bar group.
 */
export function RelatedTools({ tool }: { tool: AvailableTool }) {
  const category = getCategory(tool.category);
  if (!category) return null;
  const siblings = toolsInCategory(category.id);
  let related = siblings.filter((t) => t.slug !== tool.slug);
  let mixed = false;
  if (related.length === 0) {
    const group = buildNavGroups().find((g) => g.categories.some((c) => c.id === category.id));
    related = (group?.categories ?? []).flatMap((c) => toolsInCategory(c.id)).filter((t) => t.slug !== tool.slug);
    mixed = true;
  }
  if (related.length === 0) return null;

  return (
    <section aria-labelledby={`cat-${category.id}`} className="flex flex-col gap-3 border-t pt-8">
      <CategoryHeading
        category={category}
        count={siblings.length}
        label={mixed ? 'Related tools' : `More in ${category.title}`}
      />
      <ToolCardGrid>
        {related.slice(0, MAX).map((t, i) => (
          <ToolCard key={t.slug} tool={toInfo(t)} showCategory={mixed} className={i >= 4 ? 'max-sm:hidden' : undefined} />
        ))}
      </ToolCardGrid>
    </section>
  );
}
