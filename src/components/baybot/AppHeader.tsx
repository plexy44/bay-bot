
'use client';

import type React from 'react';
import { SearchForm } from './atomic/SearchForm'; // New Import
import { ViewTabs } from './atomic/ViewTabs'; // New Import
import { getRandomPopularSearchTerm } from '@/services/ebay-api-service'; // Re-added for logo click

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

  const handleLogoClick = async () => {
    if (currentView !== 'deals') {
      onViewChange('deals'); // This will also clear search query
    } else {
      // If already on deals, clear search query to trigger global curated
      setSearchQuery(''); 
      onSearch('');
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/60 backdrop-blur-lg supports-[backdrop-filter]:bg-background/40">
      <div className="container flex h-16 max-w-screen-2xl items-center">
        <div className="ml-4 mr-4 flex items-center md:ml-8">
          <button
            onClick={handleLogoClick}
            className="text-xl font-headline font-bold text-foreground hover:text-primary transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            aria-label="BayBot - View Curated Homepage"
          >
            BayBot
          </button>
        </div>

        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <div className="w-full flex-1 md:w-auto md:flex-none">
            <SearchForm
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onSubmit={handleSearchSubmit}
            />
          </div>
           {/* ViewTabs will handle its own responsive rendering */}
        </div>
      </div>
      {/* Moved ViewTabs outside the main flex container to span full width on mobile */}
      <ViewTabs currentView={currentView} onViewChange={onViewChange} />
    </header>
  );
};
