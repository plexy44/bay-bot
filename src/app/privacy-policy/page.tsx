'use client';

import type React from 'react';
import { AppHeader } from '@/components/dealscope/AppHeader';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useRouter } from 'next/navigation';
import { useState, useCallback } from 'react';

export default function PrivacyPolicyPage() {
  const router = useRouter();
  const [inputValue, setInputValue] = useState('');

  const handleSearchSubmit = (query: string) => {
    router.push(`/?q=${encodeURIComponent(query)}`);
  };

  const handleLogoClick = useCallback(() => {
    sessionStorage.removeItem('cachedCuratedDeals');
    sessionStorage.removeItem('cachedCuratedAuctions');
    router.push('/');
  }, [router]);

  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader
        searchInputValue={inputValue}
        onSearchInputChange={setInputValue}
        onSearchSubmit={handleSearchSubmit}
        onLogoClick={handleLogoClick}
        isLoading={false}
      />
      <main className="flex-grow container mx-auto px-4 py-8">
        <section className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>
          <p className="mb-4">
            Your privacy is important to us. It is DealScope's policy to respect your privacy regarding any information we may collect from you across our website, and other sites we own and operate.
          </p>

          <h2 className="text-2xl font-semibold mt-6 mb-2">1. Information We Collect</h2>
          <p className="mb-4">
            We only ask for personal information when we truly need it to provide a service to you. We collect it by fair and lawful means, with your knowledge and consent. We also let you know why we’re collecting it and how it will be used.
          </p>

          <h2 className="text-2xl font-semibold mt-6 mb-2">2. How We Use Your Information</h2>
          <p className="mb-4">
            We use the information we collect in various ways, including to: provide, operate, and maintain our website; improve, personalize, and expand our website; understand and analyze how you use our website; and develop new products, services, features, and functionality.
          </p>

          <h2 className="text-2xl font-semibold mt-6 mb-2">3. Log Files</h2>
          <p className="mb-4">
            DealScope follows a standard procedure of using log files. These files log visitors when they visit websites. The information collected by log files include internet protocol (IP) addresses, browser type, Internet Service Provider (ISP), date and time stamp, referring/exit pages, and possibly the number of clicks.
          </p>

          <h2 className="text-2xl font-semibold mt-6 mb-2">4. Cookies and Web Beacons</h2>
          <p className="mb-4">
            Like any other website, DealScope uses 'cookies'. These cookies are used to store information including visitors' preferences, and the pages on the website that the visitor accessed or visited. The information is used to optimize the users' experience by customizing our web page content based on visitors' browser type and/or other information.
          </p>
        </section>
      </main>
      <footer className="sticky bottom-0 z-10 h-16 flex items-center text-center border-t border-border/40 bg-background/60 backdrop-blur-lg text-sm text-muted-foreground">
        <div className="container mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 sm:gap-0">
          <p>&copy; {new Date().getFullYear()} DealScope. All rights reserved.</p>
          <ThemeToggle />
        </div>
      </footer>
    </div>
  );
}
