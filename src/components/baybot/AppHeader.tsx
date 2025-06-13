
'use client';

import type React from 'react';
import { SearchForm } from './atomic/SearchForm';
import { ViewTabs } from './atomic/ViewTabs';

interface AppHeaderProps {
  currentView: 'deals' | 'auctions';
  onViewChange: (view: 'deals' | 'auctions') => void;
  onSearch: (query: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ currentView, onViewChange, onSearch, searchQuery, setSearchQuery }) => {

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchQuery);
  };

  const handleLogoClick = () => {
    if (currentView !== 'deals') {
      onViewChange('deals'); 
    } else if (searchQuery !== '') {
      setSearchQuery(''); 
      // onSearch(''); // Implicitly handled by useEffect in page.tsx watching searchQuery
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/60 backdrop-blur-lg supports-[backdrop-filter]:bg-background/40">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        {/* Left Group: Logo and Tabs */}
        <div className="flex items-center gap-x-3 sm:gap-x-4">
          <button
            onClick={handleLogoClick}
            className="text-xl font-headline font-bold text-foreground hover:text-primary transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            aria-label="BayBot - View Curated Homepage Deals"
          >
            BayBot
          </button>
          <ViewTabs currentView={currentView} onViewChange={onViewChange} />
        </div>

        {/* Right Group: Search Form */}
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
