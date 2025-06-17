
'use client';

import type React from 'react';
import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, Gavel } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ViewTabsProps {
  activePath: string; // This is the pathname, e.g., "/" or "/auctions"
}

export const ViewTabs: React.FC<ViewTabsProps> = ({ activePath }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleValueChange = (value: string) => {
    // If the "Deals" tab is clicked and we are already on the Deals page, scroll to top.
    if (value === "/" && activePath === "/") {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // No navigation needed, just scroll. The tab will remain visually active.
    } else {
      // Navigate to the selected tab, preserving query parameters.
      const currentQuery = searchParams.toString();
      let newPath = value;
      if (currentQuery) {
        newPath = `${value}?${currentQuery}`;
      }
      startTransition(() => {
        router.push(newPath);
      });
    }
  };

  // Determine the active tab based on the current path
  let tabValue = "/";
  if (activePath === "/auctions") {
    tabValue = "/auctions";
  } else if (activePath === "/") {
    tabValue = "/";
  }

  return (
    <Tabs value={tabValue} onValueChange={handleValueChange}>
      <TabsList
        className={cn(
          "dealscope-tabs-list",
          "inline-flex h-auto items-center justify-center p-0.5 shadow-sm",
          isPending && "opacity-70 cursor-default"
        )}
      >
        <TabsTrigger
          value="/"
          className={cn(
            "dealscope-tabs-trigger px-3 sm:px-4"
          )}
          disabled={isPending}
        >
          <TrendingUp className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Deals</span>
        </TabsTrigger>
        <TabsTrigger
          value="/auctions"
          className={cn(
            "dealscope-tabs-trigger px-3 sm:px-4"
          )}
          disabled={isPending}
        >
          <Gavel className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Auctions</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
};
