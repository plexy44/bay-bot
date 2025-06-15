
'use client';

import type React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, Gavel } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ViewTabsProps {
  activePath: string;
}

export const ViewTabs: React.FC<ViewTabsProps> = ({ activePath }) => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleValueChange = (value: string) => {
    const currentQuery = searchParams.toString();
    let newPath = value;
    if (currentQuery) {
      newPath = `${value}?${currentQuery}`;
    }
    router.push(newPath);
  };

  let tabValue = "/";
  const currentPathname = activePath.split('?')[0];

  if (currentPathname === "/auctions") {
    tabValue = "/auctions";
  } else if (currentPathname === "/") {
     tabValue = "/";
  }


  return (
    <Tabs value={tabValue} onValueChange={handleValueChange}>
      <TabsList 
        className={cn(
          "dealscope-tabs-list",
          "inline-flex h-auto items-center justify-center p-0.5 shadow-sm"
        )}
      >
        <TabsTrigger
          value="/"
          className={cn(
            "dealscope-tabs-trigger px-3 sm:px-4"
          )}
        >
          <TrendingUp className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Curated Deals</span>
        </TabsTrigger>
        <TabsTrigger
          value="/auctions"
          className={cn(
            "dealscope-tabs-trigger px-3 sm:px-4"
          )}
        >
          <Gavel className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Auctions</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
};
