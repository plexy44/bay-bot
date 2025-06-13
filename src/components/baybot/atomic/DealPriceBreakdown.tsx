
'use client';

import type React from 'react';
import { Badge } from "@/components/ui/badge";
import { Tag, Percent } from "lucide-react";
import type { BayBotItem } from '@/types';

interface DealPriceBreakdownProps {
  item: BayBotItem;
}

export const DealPriceBreakdown: React.FC<DealPriceBreakdownProps> = ({ item }) => {
  if (item.type !== 'deal' || (!item.originalPrice && (!item.discountPercentage || item.discountPercentage <= 0))) {
    return null;
  }

  return (
    <div className="space-y-3 p-4 bg-muted/20 rounded-lg border border-border/30 backdrop-blur-sm mb-4">
      <h4 className="text-md font-semibold text-foreground flex items-center">
        <Tag className="w-5 h-5 mr-2 text-primary/80" />
        Deal Breakdown
      </h4>
      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground">Current Price:</span>
        <span className="text-lg font-bold text-primary">£{item.price.toFixed(2)}</span>
      </div>
      {item.originalPrice && item.originalPrice > item.price && (
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Original Price:</span>
          <span className="text-sm text-muted-foreground line-through">£{item.originalPrice.toFixed(2)}</span>
        </div>
      )}
      {item.discountPercentage && item.discountPercentage > 0 && (
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">You Save:</span>
          <Badge variant="destructive" className="text-sm">
            <Percent className="h-4 w-4 mr-1" />
            {item.discountPercentage}%
          </Badge>
        </div>
      )}
    </div>
  );
};
