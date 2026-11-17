'use client';

import { ArrowDown01Icon, BubbleChatIcon, Clock01Icon, Delete02Icon, UserCircleIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/kit/empty-state';
import { StatusBadge } from '@/components/kit/status-badge';
import { ToolIcon } from '@/components/tools/tool-card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/account/api';
import { forgetAccount } from '@/lib/account/session';
import type { SyncSettings } from '@/lib/account/sync';
import { formatBytes } from '@/lib/files';
import { cn } from '@/lib/utils';
import { getAvailableTool } from '@/tools/registry';
import { Notice } from './form-bits';

type Run = {
  id: string;
  tool: string;
  at: number;
  fileCount: number;
  totalBytes: number;
  durationMs: number;
  outcome: 'success' | 'failed' | 'cancelled';
  errorCode: string | null;
  fileNames: string[] | null;
};
type RunPage = { items: Run[]; more: boolean; tools: { tool: string; count: number }[]; settings: SyncSettings };
type ChatSummary = { docKey: string; title: string; turns: number; updatedAt: number };
type ChatTurn = {
  question: string;
  answer: string;
  sources: { n: number; docName: string; unit: 'page' | 'section'; page: number }[];
  at: number;
};

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const ALL = '__all';

const toolTitle = (slug: string) => getAvailableTool(slug)?.title ?? slug;

function duration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

function Confirm({
  open,
  onOpenChange,
  title,
  body,
  action,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  body: string;
  action: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-sm/relaxed">{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="lg" className="h-9" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="lg"
            className="h-9"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunRow({ run, onDelete }: { run: Run; onDelete: () => void }) {
  const tool = getAvailableTool(run.tool);
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
      {tool ? (
        <ToolIcon tool={tool} className="mt-0.5 size-8 [&_svg]:size-4" />
      ) : (
        <span className="mt-0.5 size-8 shrink-0 rounded-[0.6rem] bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {tool ? (
            <Link href={`/tools/${run.tool}`} className="text-sm font-semibold underline-offset-4 hover:underline">
              {tool.title}
            </Link>
          ) : (
            <span className="text-sm font-semibold">{run.tool}</span>
          )}
          {run.outcome === 'success' ? (
            <StatusBadge kind="success">Done</StatusBadge>
          ) : run.outcome === 'failed' ? (
            <StatusBadge kind="danger">Failed{run.errorCode ? ` (${run.errorCode.replace(/_/g, ' ')})` : ''}</StatusBadge>
          ) : (
            <StatusBadge kind="neutral">Cancelled</StatusBadge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {when.format(run.at)} · {run.fileCount} {run.fileCount === 1 ? 'file' : 'files'} · {formatBytes(run.totalBytes)} ·{' '}
          {duration(run.durationMs)}
        </p>
        {run.fileNames?.length ? (
          <p className="mt-1 truncate text-xs text-foreground/80" title={run.fileNames.join(', ')}>
            {run.fileNames.join(', ')}
          </p>
        ) : null}
      </div>
      <Button variant="ghost" size="icon-lg" aria-label={`Delete this ${toolTitle(run.tool)} entry`} onClick={onDelete}>
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
      </Button>
    </li>
  );
}

function Runs({ onSignedOut }: { onSignedOut: () => void }) {
  const [tool, setTool] = useState<string>(ALL);
  const [data, setData] = useState<RunPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(
    async (t: string, before?: number) => {
      const q = new URLSearchParams();
      if (t !== ALL) q.set('tool', t);
      if (before) q.set('before', String(before));
      const r = await api<RunPage>('GET', `/api/me/history?${q}`);
      if (!r.ok) {
        if (r.status === 401) onSignedOut();
        else toast.error(r.message);
        return null;
      }
      return r.data;
    },
    [onSignedOut],
  );

  useEffect(() => {
    let live = true;
    void load(tool).then((d) => live && d && setData(d));
    return () => {
      live = false;
    };
  }, [tool, load]);

  const more = async () => {
    if (!data) return;
    setLoadingMore(true);
    const d = await load(tool, data.items.at(-1)?.at);
    setLoadingMore(false);
    if (d) setData({ ...d, items: [...data.items, ...d.items] });
  };

  const remove = async (id: string) => {
    const r = await api('DELETE', `/api/me/history/${id}`);
    if (!r.ok) return toast.error(r.message);
    setData((d) =>
      d
        ? {
            ...d,
            items: d.items.filter((x) => x.id !== id),
            tools: d.tools
              .map((t) => (t.tool === d.items.find((x) => x.id === id)?.tool ? { ...t, count: t.count - 1 } : t))
              .filter((t) => t.count > 0),
          }
        : d,
    );
  };

  const clear = async () => {
    const r = await api<{ deleted: number }>('DELETE', `/api/me/history${tool !== ALL ? `?tool=${tool}` : ''}`);
    if (!r.ok) return toast.error(r.message);
    toast.success(`Deleted ${r.data.deleted} ${r.data.deleted === 1 ? 'entry' : 'entries'}.`);
    setTool(ALL);
    const d = await load(ALL);
    if (d) setData(d);
  };

  if (!data) return <Skeleton className="h-72 w-full rounded-xl" />;
  const total = data.tools.reduce((n, t) => n + t.count, 0);

  return (
    <div className="flex flex-col gap-4">
      {!data.settings.syncHistory ? (
        <Notice kind="info">
          Tool history is off, so new runs are not recorded.{' '}
          <Link href="/account" className="font-medium underline underline-offset-4">
            Turn it on in your account
          </Link>
          .
        </Notice>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Select value={tool} onValueChange={setTool}>
          <SelectTrigger className="h-9 w-full text-sm sm:w-72" aria-label="Filter by tool">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All tools ({total})</SelectItem>
            {data.tools.map((t) => (
              <SelectItem key={t.tool} value={t.tool}>
                {toolTitle(t.tool)} ({t.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="lg"
          className="h-9 px-3 text-sm"
          disabled={data.items.length === 0}
          onClick={() => setConfirm(true)}
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          {tool === ALL ? 'Clear all' : `Clear ${toolTitle(tool)}`}
        </Button>
      </div>
      {data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed">
          <EmptyState
            className="py-14"
            icon={<HugeiconsIcon icon={Clock01Icon} strokeWidth={1.8} />}
            title="No runs recorded"
            description={
              data.settings.syncHistory
                ? 'Runs appear here after you use a tool while signed in.'
                : 'Switch on tool history to keep a record of your runs.'
            }
          />
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {data.items.map((r) => (
            <RunRow key={r.id} run={r} onDelete={() => void remove(r.id)} />
          ))}
        </ul>
      )}
      {data.more ? (
        <div>
          <Button variant="outline" size="lg" className="h-9 px-3 text-sm" disabled={loadingMore} onClick={more}>
            {loadingMore ? 'Loading…' : 'Show older'}
          </Button>
        </div>
      ) : null}
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title={tool === ALL ? 'Clear all history?' : `Clear ${toolTitle(tool)} history?`}
        body="These entries are deleted from your account. This cannot be undone."
        action="Delete"
        onConfirm={() => void clear()}
      />
    </div>
  );
}

function ChatItem({ chat, onDelete }: { chat: ChatSummary; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[] | null>(null);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !turns) {
      const r = await api<{ chat: { turns: ChatTurn[] } }>('GET', `/api/me/chats/${chat.docKey}`);
      setTurns(r.ok ? r.data.chat.turns : []);
    }
  };
  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[0.6rem] bg-muted text-muted-foreground">
          <HugeiconsIcon icon={BubbleChatIcon} strokeWidth={1.8} className="size-4" />
        </span>
        <button type="button" onClick={toggle} aria-expanded={open} className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <span className="truncate">{chat.title}</span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            />
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {chat.turns} {chat.turns === 1 ? 'question' : 'questions'} · updated {when.format(chat.updatedAt)}
          </span>
        </button>
        <Button variant="ghost" size="icon-lg" aria-label={`Delete conversation ${chat.title}`} onClick={onDelete}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        </Button>
      </div>
      {open ? (
        <div className="mt-3 ml-11 flex flex-col gap-4 border-l pl-4">
          {turns === null ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            turns.map((t, i) => (
              <div key={i} className="flex flex-col gap-1 text-sm/relaxed">
                <p className="font-medium">{t.question}</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{t.answer}</p>
                {t.sources.length ? (
                  <p className="text-xs text-muted-foreground">
                    Sources:{' '}
                    {t.sources
                      .map((s) => `${s.docName}, ${s.unit === 'page' ? 'p.' : 'section'} ${s.page}`)
                      .join('; ')}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </li>
  );
}

function Chats({ onSignedOut }: { onSignedOut: () => void }) {
  const [data, setData] = useState<{ items: ChatSummary[]; settings: SyncSettings } | null>(null);
  const [confirm, setConfirm] = useState<ChatSummary | null>(null);

  useEffect(() => {
    let live = true;
    void api<{ items: ChatSummary[]; settings: SyncSettings }>('GET', '/api/me/chats').then((r) => {
      if (!live) return;
      if (r.ok) setData(r.data);
      else if (r.status === 401) onSignedOut();
      else toast.error(r.message);
    });
    return () => {
      live = false;
    };
  }, [onSignedOut]);

  const remove = async (c: ChatSummary) => {
    const r = await api('DELETE', `/api/me/chats/${c.docKey}`);
    if (!r.ok) return toast.error(r.message);
    setData((d) => (d ? { ...d, items: d.items.filter((x) => x.docKey !== c.docKey) } : d));
  };

  if (!data) return <Skeleton className="h-56 w-full rounded-xl" />;
  return (
    <div className="flex flex-col gap-4">
      {!data.settings.syncChats ? (
        <Notice kind="info">
          Chat sync is off, so conversations stay in each browser.{' '}
          <Link href="/account" className="font-medium underline underline-offset-4">
            Turn it on in your account
          </Link>
          .
        </Notice>
      ) : null}
      {data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed">
          <EmptyState
            className="py-14"
            icon={<HugeiconsIcon icon={BubbleChatIcon} strokeWidth={1.8} />}
            title="No synced conversations"
            description="Conversations from Chat with PDF appear here when chat sync is on. Documents are never uploaded."
          />
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {data.items.map((c) => (
            <ChatItem key={c.docKey} chat={c} onDelete={() => setConfirm(c)} />
          ))}
        </ul>
      )}
      <Confirm
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Delete this conversation?"
        body="It is removed from your account and from this browser's copy on the next visit to the chat. This cannot be undone."
        action="Delete"
        onConfirm={() => confirm && void remove(confirm)}
      />
    </div>
  );
}

export function HistoryPage() {
  const [signedOut, setSignedOut] = useState(false);
  const onSignedOut = useCallback(() => {
    setSignedOut(true);
    void forgetAccount();
  }, []);

  if (signedOut) {
    return (
      <div className="rounded-2xl border border-dashed">
        <EmptyState
          className="py-16"
          icon={<HugeiconsIcon icon={UserCircleIcon} strokeWidth={1.8} />}
          title="Sign in to see your history"
          description="History is kept on your account when you switch it on. Without an account, nothing about your runs is stored."
          action={
            <Button asChild size="lg">
              <Link href="/sign-in?next=/history">Sign in</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <Tabs defaultValue="runs" className="flex flex-col gap-5">
      <TabsList>
        <TabsTrigger value="runs">Tool runs</TabsTrigger>
        <TabsTrigger value="chats">Chats</TabsTrigger>
      </TabsList>
      <TabsContent value="runs">
        <Runs onSignedOut={onSignedOut} />
      </TabsContent>
      <TabsContent value="chats">
        <Chats onSignedOut={onSignedOut} />
      </TabsContent>
    </Tabs>
  );
}
