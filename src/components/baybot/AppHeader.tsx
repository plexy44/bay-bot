
'use client';

import type React from 'react';
import { usePathname } from 'next/navigation';
import { SearchForm } from './atomic/SearchForm';
import { ViewTabs } from './atomic/ViewTabs';
import { cn } from '@/lib/utils';

interface AppHeaderProps {
  searchInputValue: string;
  onSearchInputChange: (query: string) => void;
  onSearchSubmit: (query: string) => void;
  onLogoClick: () => void;
  isLoading: boolean; // Added isLoading prop
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  searchInputValue,
  onSearchInputChange,
  onSearchSubmit,
  onLogoClick,
  isLoading, // Destructure isLoading
}) => {
  const pathname = usePathname(); // Used for ViewTabs activePath

  // Internal handler for the form submission WITHIN AppHeader
  // It calls the onSearchSubmit prop passed from the parent page
  const handleSearchFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchSubmit(searchInputValue);
  };

  // Internal handler for the logo click.
  // It calls the onLogoClick prop passed from the parent page.
  // The parent page's onLogoClick handler contains the logic for navigation and clearing search.
  const handleLogoClickInternal = () => {
    onLogoClick();
  };
  
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/60 backdrop-blur-lg supports-[backdrop-filter]:bg-background/40">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-x-3 sm:gap-x-4">
          <button
            onClick={handleLogoClickInternal}
            className={cn(
              "text-xl font-headline font-bold text-foreground hover:text-primary transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
              isLoading && "logo-rainbow-text-glow-loading" // Conditionally apply animation class
            )}
            aria-label="BayBot - View Curated Deals Homepage"
          >
            BayBot
          </button>
          <ViewTabs activePath={pathname} />
        </div>

        <div className="flex items-center">
          <SearchForm
            searchQuery={searchInputValue}
            setSearchQuery={onSearchInputChange}
            onSubmit={handleSearchFormSubmit}
          />
        </div>
      </div>
    </header>
  );
};
