'use client';

import type React from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, Gavel } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ViewTabsProps {
  activePath: string;
}

export const ViewTabs: React.FC<ViewTabsProps> = ({ activePath }) => {
  const router = useRouter();

  const handleValueChange = (value: string) => {
    router.push(value);
  };

  // Determine the value for Tabs based on activePath for correct highlighting
  let tabValue = "/"; // Default to homepage (Curated Deals)
  if (activePath === "/auctions") {
    tabValue = "/auctions";
  } else if (activePath === "/") {
     tabValue = "/"; // Explicitly for Curated Deals at root
  }


  return (
    <Tabs value={tabValue} onValueChange={handleValueChange}>
      <TabsList className="inline-flex h-auto items-center justify-center rounded-md border border-border/40 bg-muted/30 p-0.5 shadow-sm">
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
