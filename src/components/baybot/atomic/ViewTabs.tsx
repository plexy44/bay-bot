
'use client';

import type React from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, Gavel } from 'lucide-react'; // Added Gavel

interface ViewTabsProps {
  activePath: string;
}

export const ViewTabs: React.FC<ViewTabsProps> = ({ activePath }) => {
  const router = useRouter();

  const handleValueChange = (value: string) => {
    router.push(value);
  };

  return (
    <Tabs value={activePath} onValueChange={handleValueChange}>
      <TabsList className="bg-muted/50 backdrop-blur-sm">
        <TabsTrigger value="/curated-deals" className="baybot-tabs-trigger px-3 sm:px-4">
          <TrendingUp className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Curated Deals</span>
        </TabsTrigger>
        <TabsTrigger value="/" className="baybot-tabs-trigger px-3 sm:px-4">
          <Gavel className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Auctions</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
};
