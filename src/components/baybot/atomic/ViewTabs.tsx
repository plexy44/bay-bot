
'use client';

import type React from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ViewTabsProps {
  currentView: 'deals' | 'auctions';
  onViewChange: (view: 'deals' | 'auctions') => void;
}

export const ViewTabs: React.FC<ViewTabsProps> = ({ currentView, onViewChange }) => {
  return (
    <Tabs value={currentView} onValueChange={(value) => onViewChange(value as 'deals' | 'auctions')}>
      <TabsList className="bg-muted/50 backdrop-blur-sm">
        <TabsTrigger value="deals" className="baybot-tabs-trigger">Deals</TabsTrigger>
        <TabsTrigger value="auctions" className="baybot-tabs-trigger">Auctions</TabsTrigger>
      </TabsList>
    </Tabs>
  );
};
