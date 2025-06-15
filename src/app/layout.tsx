
import type {Metadata} from 'next';
import Script from 'next/script'; // Import next/script
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { Inter, Space_Grotesk } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-grotesk',
});

export const metadata: Metadata = {
  title: 'DealScope - Deals and Auctions',
  description: 'Find the best deals and auctions with AI-powered insights.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <head>
        {/* Theme switcher script */}
        <script
          id="theme-switcher-script"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function getInitialTheme() {
                  try {
                    const storedTheme = localStorage.getItem('theme');
                    if (storedTheme === 'light' || storedTheme === 'dark') {
                      return storedTheme;
                    }
                  } catch (e) {
                    // Silently ignore localStorage access errors
                  }
                  // Ensure window and matchMedia are available
                  if (typeof window !== 'undefined' && window.matchMedia) {
                     return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  }
                  return 'light'; // Fallback if window.matchMedia is not available
                }
                const theme = getInitialTheme();
                // Ensure document.documentElement is available
                if (typeof document !== 'undefined' && document.documentElement) {
                    if (theme === 'dark') {
                      document.documentElement.classList.add('dark');
                      document.documentElement.classList.remove('light');
                    } else {
                      document.documentElement.classList.remove('dark');
                      document.documentElement.classList.add('light');
                    }
                }
              })();
            `,
          }}
        />
        {/* EPN Campaign ID - must be inline before epn-smart-tools.js */}
        <script
          id="epn-campaign-id-script"
          dangerouslySetInnerHTML={{ __html: `window._epn = {campaign: 5339112633};` }}
        />
        {/* EPN Smart Tools */}
        <Script
          id="epn-smart-tools"
          src="https://epnt.ebay.com/static/epn-smart-tools.js"
          strategy="afterInteractive"
        />
        {/* Google AdSense */}
        <Script
          id="adsbygoogle-script"
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7132522800049597"
          crossOrigin="anonymous"
          strategy="lazyOnload"
          async
        />
      </head>
      <body className="font-body antialiased min-h-screen flex flex-col bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
