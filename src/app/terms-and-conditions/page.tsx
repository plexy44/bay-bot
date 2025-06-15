
'use client';

import type React from 'react';
import { AppHeader } from '@/components/baybot/AppHeader';
import { AppFooter } from '@/components/dealscope/AppFooter';
import { useRouter } from 'next/navigation';
import { useState, useCallback } from 'react';

export default function TermsAndConditionsPage() {
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
          <h1 className="text-3xl font-bold mb-6 text-foreground">Terms and Conditions</h1>
          <p className="mb-4 text-card-foreground">
            Welcome to DealScope! These terms and conditions outline the rules and regulations for the use of our website.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-3 text-primary">1. Acceptance of Terms</h2>
          <p className="mb-4 text-card-foreground">
            By accessing this website, we assume you accept these terms and conditions. Do not continue to use DealScope if you do not agree to all of the terms and conditions stated on this page.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-3 text-primary">2. License</h2>
          <p className="mb-4 text-card-foreground">
            Unless otherwise stated, DealScope and/or its licensors own the intellectual property rights for all material on DealScope. All intellectual property rights are reserved. You may access this from DealScope for your own personal use subjected to restrictions set in these terms and conditions.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-3 text-primary">3. User Comments</h2>
          <p className="mb-4 text-card-foreground">
            This Agreement shall begin on the date hereof. Certain parts of this website offer an opportunity for users to post and exchange opinions and information. DealScope does not filter, edit, publish or review Comments prior to their presence on the website.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-3 text-primary">4. Disclaimer</h2>
          <p className="mb-4 text-card-foreground">
            To the maximum extent permitted by applicable law, we exclude all representations, warranties and conditions relating to our website and the use of this website. Nothing in this disclaimer will: limit or exclude our or your liability for death or personal injury; limit or exclude our or your liability for fraud or fraudulent misrepresentation.
          </p>
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
