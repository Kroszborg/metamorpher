import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminNav } from '@/components/admin/admin-nav';
import { requireAdmin } from '@/server/admin';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin' },
  robots: { index: false, follow: false, nocache: true },
};

/** Operations dashboard. Rendered per request; 404 for anyone not in ADMIN_EMAILS. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <div className="page-container flex flex-col gap-6 pt-6 pb-16 sm:pt-8">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Admin</p>
        <AdminNav />
      </div>
      {children}
    </div>
  );
}
