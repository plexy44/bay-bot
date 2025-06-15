
import Image from 'next/image';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Info, ExternalLink, ShieldCheck, TrendingUp } from "lucide-react";
import type { BayBotItem } from '@/types';
import { cn } from "@/lib/utils";

interface ItemCardProps {
  item: BayBotItem;
  onAnalyze: (item: BayBotItem) => void;
  onAuctionEnd?: (itemId: string) => void; // New prop
}

const ItemCardComponent: React.FC<ItemCardProps> = ({ item, onAnalyze, onAuctionEnd }) => {
  const canViewItem = !!item.itemLink;
  const buttonText = item.type === 'deal' ? "View Deal" : "View Auction";

  const [displayTimeLeft, setDisplayTimeLeft] = useState<string | undefined>(item.timeLeft);
  const [isLastHour, setIsLastHour] = useState(false);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | undefined;

    if (item.type === 'auction' && item.endTime) {
      const updateTimer = () => {
        const endTimeMs = new Date(item.endTime!).getTime();
        const nowMs = new Date().getTime();
        const diffMs = endTimeMs - nowMs;

        if (diffMs <= 0) {
          if (intervalId) {
            clearInterval(intervalId);
          }
          onAuctionEnd?.(item.id); // Call the callback when auction ends
          // No longer setting displayTimeLeft to "Ended" here, component will be removed
          return;
        }

        const totalSeconds = Math.floor(diffMs / 1000);
        const days = Math.floor(totalSeconds / (60 * 60 * 24));
        const hours = Math.floor((totalSeconds % (60 * 60 * 24)) / (60 * 60));
        const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
        const seconds = totalSeconds % 60;

        let timeLeftString = "";
        if (days > 0) {
          timeLeftString += `${days}d ${hours}h ${minutes}m ${seconds}s`;
        } else if (hours > 0) {
          timeLeftString += `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
          timeLeftString += `${minutes}m ${seconds}s`;
        } else {
          timeLeftString += `${seconds}s`;
        }
        setDisplayTimeLeft(timeLeftString);
        setIsLastHour(diffMs > 0 && diffMs <= 60 * 60 * 1000);
      };

      updateTimer();
      intervalId = setInterval(updateTimer, 1000);

      return () => {
        if (intervalId) {
          clearInterval(intervalId);
        }
      };
    } else {
      setDisplayTimeLeft(item.timeLeft);
      setIsLastHour(false);
    }
  }, [item.id, item.endTime, item.type, item.timeLeft, onAuctionEnd]);


  return (
    <div className="flex flex-col overflow-hidden h-full glass-card transition-all duration-300 ease-out hover:shadow-[0_0_35px_3px_hsla(var(--primary-hsl),0.25)] hover:-translate-y-1.5">
      <CardHeader className="p-0 relative">
        <div className="aspect-video relative">
          <Image
            src={item.imageUrl || 'https://placehold.co/600x400.png'}
            alt={item.title}
            fill
            className="object-cover rounded-t-lg"
            data-ai-hint={item['data-ai-hint'] || item.title.toLowerCase().split(' ').slice(0,2).join(' ')}
            unoptimized={item.imageUrl?.includes('ebayimg.com')}
            priority={false}
          />
          {item.type === 'deal' && item.discountPercentage && item.discountPercentage > 0 && (
            <Badge
              className="absolute top-3 right-3 rainbow-badge-animated px-2 py-0.5 text-xs flex items-center gap-1"
              onClick={() => onAnalyze(item)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onAnalyze(item); }}
              aria-label={`Analyze deal with ${item.discountPercentage}% off`}
            >
              <Info className="h-3 w-3 text-white text-shadow-strong" />
              <span className="text-white text-shadow-strong">{item.discountPercentage}% OFF</span>
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 flex-grow">
        <CardTitle className="text-lg font-headline mb-2 leading-tight line-clamp-2 text-foreground">{item.title}</CardTitle>
        <div className="flex items-baseline space-x-2 mb-2">
          <p className="text-2xl font-semibold text-primary">£{item.price.toFixed(2)}</p>
          {item.originalPrice && item.price < item.originalPrice && (
            <p className="text-sm text-muted-foreground line-through">£{item.originalPrice.toFixed(2)}</p>
          )}
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          {item.type === 'auction' && displayTimeLeft && (
            <div className="flex items-center">
              <Clock className="h-3.5 w-3.5 mr-1.5" />
              <span className={cn({ "text-red-600 dark:text-red-400 font-semibold": isLastHour })}>
                Time left: {displayTimeLeft}
              </span>
            </div>
          )}
          {item.type === 'auction' && typeof item.bidCount === 'number' && (
             <div className="flex items-center">
              <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
              <span>Bids: {item.bidCount}</span>
            </div>
          )}
          <div className="flex items-center">
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
            <span>Seller Score: {item.sellerReputation.toFixed(0)}%</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0">
        {canViewItem ? (
          <Button className="w-full mt-3 interactive-glow" variant="outline" asChild>
            <a href={item.itemLink} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              {buttonText}
            </a>
          </Button>
        ) : (
          <Button className="w-full mt-3 interactive-glow" variant="outline" disabled>
            <ExternalLink className="h-4 w-4 mr-2" />
            {buttonText} N/A
          </Button>
        )}
      </CardFooter>
    </div>
  );
};

export const ItemCard = React.memo(ItemCardComponent);
ItemCard.displayName = 'ItemCard';
