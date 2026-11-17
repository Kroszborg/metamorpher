'use client';

import { Delete02Icon, Loading03Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useEffect, useState } from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Button } from '@/components/ui/button';
import { localAi, onModelsChanged, removeAllModels, removeModel, type StoredModel, storedModels } from '@/engines/ai';
import { formatBytes } from '@/lib/files';

/** Downloaded on-device models with sizes, licences and remove buttons. */
export function LocalModelsSection() {
  const [items, setItems] = useState<StoredModel[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    storedModels().then(setItems, () => setItems([]));
  }, []);

  useEffect(() => {
    refresh();
    return onModelsChanged(refresh);
  }, [refresh]);

  const total = (items ?? []).reduce((n, m) => n + m.bytes, 0);

  return (
    <SectionCard
      data-local-models
      title="Downloaded on-device models"
      description={
        items === null
          ? 'Checking this browser’s storage…'
          : items.length === 0
            ? 'None yet. On-device models are downloaded from huggingface.co only when you press a tool’s Download button.'
            : `${items.length} model${items.length === 1 ? '' : 's'}, about ${formatBytes(total)} in this browser’s storage.`
      }
      action={
        items && items.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={async () => {
              setBusy('*');
              localAi.terminateAll();
              await removeAllModels();
              setBusy(null);
              refresh();
            }}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            Remove downloaded models
          </Button>
        ) : null
      }
      contentClassName={items && items.length > 0 ? 'flex flex-col divide-y p-0' : 'hidden'}
    >
      {(items ?? []).map((m) => (
        <div key={m.repo} data-model-repo={m.repo} className="flex items-center gap-3 px-5 py-2.5 text-xs">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{m.spec?.label ?? m.repo}</p>
            <p className="truncate text-muted-foreground">
              {formatBytes(m.bytes)} · {m.files} file{m.files === 1 ? '' : 's'} · huggingface.co/{m.repo}
              {m.spec ? ` · ${m.spec.licence}` : ''}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(m.repo);
              localAi.terminateAll();
              await removeModel(m.repo);
              setBusy(null);
              refresh();
            }}
          >
            {busy === m.repo ? (
              <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" />
            ) : (
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            )}
            Remove
          </Button>
        </div>
      ))}
    </SectionCard>
  );
}
