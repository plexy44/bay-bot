
'use client';

import type React from 'react';
import { AppHeader } from '@/components/baybot/AppHeader';
import { AppFooter } from '@/components/dealscope/AppFooter';
import { useRouter } from 'next/navigation';
import { useState, useCallback } from 'react';

export default function PrivacyPolicyPage() {
  const router = useRouter();
  const [inputValue, setInputValue] = useState('');

  const handleSearchSubmit = (query: string) => {
    router.push(`/?q=${encodeURIComponent(query)}`);
  };

  const handleLogoClick = useCallback(() => {
    sessionStorage.removeItem(CURATED_DEALS_CACHE_KEY);
    sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
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
        <section className="max-w-4xl mx-auto bg-card p-6 sm:p-8 rounded-lg shadow-md">
          <h1 className="text-3xl font-bold mb-6 text-foreground">Privacy Policy</h1>
          <p className="mb-4 text-card-foreground">
            Your privacy is important to us. It is DealScope's policy to respect your privacy regarding any information we may collect from you across our website, and other sites we own and operate.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-3 text-primary">1. Information We Collect</h2>
          <p className="mb-4 text-card-foreground">
            We only ask for personal information when we truly need it to provide a service to you. We collect it by fair and lawful means, with your knowledge and consent. We also let you know why we’re collecting it and how it will be used.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-3 text-primary">2. How We Use Your Information</h2>
          <p className="mb-4 text-card-foreground">
            We use the information we collect in various ways, including to: provide, operate, and maintain our website; improve, personalize, and expand our website; understand and analyze how you use our website; and develop new products, services, features, and functionality.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-3 text-primary">3. Log Files</h2>
          <p className="mb-4 text-card-foreground">
            DealScope follows a standard procedure of using log files. These files log visitors when they visit websites. The information collected by log files include internet protocol (IP) addresses, browser type, Internet Service Provider (ISP), date and time stamp, referring/exit pages, and possibly the number of clicks.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-3 text-primary">4. Cookies and Web Beacons</h2>
          <p className="mb-4 text-card-foreground">
            Like any other website, DealScope uses 'cookies'. These cookies are used to store information including visitors' preferences, and the pages on the website that the visitor accessed or visited. The information is used to optimize the users' experience by customizing our web page content based on visitors' browser type and/or other information.
          </p>
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
