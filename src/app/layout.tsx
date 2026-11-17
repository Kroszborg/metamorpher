import type { Metadata, Viewport } from 'next';
import { Red_Hat_Display, Red_Hat_Mono, Red_Hat_Text } from 'next/font/google';
import './globals.css';
import { BackgroundServices } from '@/components/background-services';
import { AppShell } from '@/components/layout/shell';
import { Providers } from '@/components/providers';
import { ServiceWorker } from '@/components/service-worker';
import { Toaster } from '@/components/ui/sonner';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';
import { themeColorBootScript } from '@/lib/theme-color';
import { cn } from '@/lib/utils';

const display = Red_Hat_Display({ subsets: ['latin'], variable: '--font-redhat-display' });
const text = Red_Hat_Text({ subsets: ['latin'], variable: '--font-redhat-text' });
const mono = Red_Hat_Mono({ subsets: ['latin'], variable: '--font-redhat-mono' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME}: private file tools in your browser`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: SITE_NAME },
  openGraph: { type: 'website', siteName: SITE_NAME, title: SITE_NAME, description: SITE_DESCRIPTION },
  twitter: { card: 'summary', title: SITE_NAME, description: SITE_DESCRIPTION },
};

// theme-color is set by the script below so it follows light/dark.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn('h-full antialiased font-sans', display.variable, text.variable, mono.variable)}
    >
      <head>
        {/* Sets theme-color before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: themeColorBootScript() }} />
      </head>
      <body className="flex min-h-full flex-col">
        <Providers>
          <AppShell>{children}</AppShell>
          <Toaster />
        </Providers>
        <ServiceWorker />
        <BackgroundServices />
      </body>
    </html>
  );
}
