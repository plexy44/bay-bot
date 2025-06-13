
'use client';

import type React from 'react';
import { usePathname, useRouter } from 'next/navigation'; // Import useRouter and usePathname
import { SearchForm } from './atomic/SearchForm';
import { ViewTabs } from './atomic/ViewTabs';

interface AppHeaderProps {
  onSearch: (query: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ onSearch, searchQuery, setSearchQuery }) => {
  const router = useRouter();
  const pathname = usePathname();

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchQuery); // The page (CuratedDealsPage or AuctionsPage) handles the search
  };

  const handleLogoClick = () => {
    // Navigate to curated deals page and clear search query if on that page
    if (pathname !== '/curated-deals') {
      router.push('/curated-deals');
    }
    // Clear search query to ensure curated content loads or reloads
    // The page's useEffect will pick up the empty searchQuery
    setSearchQuery(''); 
    // Call onSearch with empty string to ensure the page's loadItems is triggered with empty query
    onSearch(''); 
  };
  
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/60 backdrop-blur-lg supports-[backdrop-filter]:bg-background/40">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-x-3 sm:gap-x-4">
          <button
            onClick={handleLogoClick}
            className="text-xl font-headline font-bold text-foreground hover:text-primary transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            aria-label="BayBot - View Curated Deals"
          >
            BayBot
          </button>
          <ViewTabs activePath={pathname} />
        </div>

        <div className="flex items-center">
          <SearchForm
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onSubmit={handleSearchSubmit}
          />
        </div>
      </div>
    </header>
  );
};
