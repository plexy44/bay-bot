
'use client';

import type React from 'react';
import { useRouter, useSearchParams } from 'next/navigation'; // Added useSearchParams
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, Gavel } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ViewTabsProps {
  activePath: string;
}

export const ViewTabs: React.FC<ViewTabsProps> = ({ activePath }) => {
  const router = useRouter();
  const searchParams = useSearchParams(); // Get current search params

  const handleValueChange = (value: string) => {
    const currentQuery = searchParams.toString();
    let newPath = value;
    if (currentQuery) {
      newPath = `${value}?${currentQuery}`;
    }
    router.push(newPath);
  };

  // Determine the value for Tabs based on activePath for correct highlighting
  let tabValue = "/"; // Default to homepage (Curated Deals)
  // activePath from usePathname() does not include query params.
  // We need to compare only the pathname part.
  const currentPathname = activePath.split('?')[0];

  if (currentPathname === "/auctions") {
    tabValue = "/auctions";
  } else if (currentPathname === "/") {
     tabValue = "/"; // Explicitly for Curated Deals at root
  }


  return (
    <Tabs value={tabValue} onValueChange={handleValueChange}>
      <TabsList 
        className={cn(
          "baybot-tabs-list", // Added class for specific styling
          "inline-flex h-auto items-center justify-center p-0.5 shadow-sm" // Removed default border and bg, will be handled in CSS
        )}
      >
        <TabsTrigger
          value="/"
          className={cn(
            "baybot-tabs-trigger px-3 sm:px-4"
          )}
        >
          <TrendingUp className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Curated Deals</span>
        </TabsTrigger>
        <TabsTrigger
          value="/auctions"
          className={cn(
            "baybot-tabs-trigger px-3 sm:px-4"
          )}
        >
          <Gavel className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Auctions</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
};

