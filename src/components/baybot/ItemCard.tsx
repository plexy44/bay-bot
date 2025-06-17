
import Image from 'next/image';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Info, ExternalLink, ShieldCheck, TrendingUp, Gem } from "lucide-react";
import type { DealScopeItem } from '@/types';
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

interface ItemCardProps {
  item: DealScopeItem;
  onAnalyze: (item: DealScopeItem) => void;
  onAuctionEnd?: (itemId: string) => void;
}

const ItemCardComponent: React.FC<ItemCardProps> = ({ item, onAnalyze, onAuctionEnd }) => {
  const canViewItem = !!item.itemLink;
  const buttonText = item.type === 'deal' ? "View Deal" : "View Auction";

  const [displayTimeLeft, setDisplayTimeLeft] = useState<string | undefined>(item.timeLeft);
  const [isLastHour, setIsLastHour] = useState(false);
  const [animatedRarityScore, setAnimatedRarityScore] = useState(0);

  useEffect(() => {
    if (item.type === 'auction' && typeof item.rarityScore === 'number') {
      const timer = setTimeout(() => setAnimatedRarityScore(item.rarityScore!), 100);
      return () => clearTimeout(timer);
    } else {
      setAnimatedRarityScore(0);
    }
  }, [item.rarityScore, item.type]);

  const updateAuctionTimer = useCallback(() => {
    if (item.type !== 'auction' || !item.endTime) return false;

    const endTimeMs = new Date(item.endTime).getTime();
    const nowMs = Date.now();
    const diffMs = endTimeMs - nowMs;

    if (diffMs <= 0) {
      onAuctionEnd?.(item.id);
      return true;
    }

    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / (60 * 60 * 24));
    const hours = Math.floor((totalSeconds % (60 * 60 * 24)) / (60 * 60));
    const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
    const seconds = totalSeconds % 60;

    let timeLeftString = "";
    if (days > 0) timeLeftString += `${days}d ${hours}h ${minutes}m ${seconds}s`;
    else if (hours > 0) timeLeftString += `${hours}h ${minutes}m ${seconds}s`;
    else if (minutes > 0) timeLeftString += `${minutes}m ${seconds}s`;
    else timeLeftString += `${seconds}s`;

    setDisplayTimeLeft(timeLeftString);
    setIsLastHour(diffMs > 0 && diffMs <= 60 * 60 * 1000);
    return false;
  }, [item.id, item.endTime, item.type, onAuctionEnd]);

  useEffect(() => {
    if (item.type === 'auction' && item.endTime) {
      if (updateAuctionTimer()) return;

      const intervalId = setInterval(() => {
        if (updateAuctionTimer()) {
          clearInterval(intervalId);
        }
      }, 1000);
      return () => clearInterval(intervalId);
    } else {
      setDisplayTimeLeft(item.timeLeft);
      setIsLastHour(false);
    }
  }, [item.type, item.endTime, item.timeLeft, updateAuctionTimer]);


  const rarityProgressTrackClass = animatedRarityScore >= 50
    ? 'bg-green-200 dark:bg-green-800'
    : 'bg-orange-200 dark:bg-orange-800';
  const rarityProgressIndicatorClass = animatedRarityScore >= 50
    ? '[&>div]:bg-green-600'
    : '[&>div]:bg-orange-500';

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

          {/* AI Analysis Trigger: For Deals with Discount (Icon + Text) */}
          {item.type === 'deal' && item.discountPercentage && item.discountPercentage > 0 && (
            <Badge
              className="absolute top-3 right-3 rainbow-badge-animated px-2 py-0.5 text-xs flex items-center gap-1 cursor-pointer"
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

          {/* AI Analysis Trigger: For Auctions OR Deals WITHOUT Discount (Icon Only) */}
          {!(item.type === 'deal' && item.discountPercentage && item.discountPercentage > 0) && (
            <Badge
              className="absolute top-3 right-3 rainbow-badge-animated p-1.5 text-xs flex items-center justify-center cursor-pointer"
              onClick={() => onAnalyze(item)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onAnalyze(item); }}
              aria-label="Analyze item with AI"
            >
              <Info className="h-3.5 w-3.5 text-white text-shadow-strong" />
            </Badge>
          )}
          
           {/* Rarity Score for Auctions - Positioned top-left */}
           {item.type === 'auction' && typeof item.rarityScore === 'number' && (
             <Badge
              variant="secondary"
              className="absolute top-3 left-3 px-2.5 py-1 text-xs flex items-center gap-1.5 bg-black/60 text-white border-white/30 backdrop-blur-sm shadow-lg"
            >
              <Gem className="h-3.5 w-3.5" />
              Rarity: {item.rarityScore}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 flex-grow">
        <CardTitle className="text-lg font-headline mb-2 leading-tight line-clamp-2 text-foreground">{item.title}</CardTitle>
        <div className="flex items-baseline space-x-2 mb-2">
          <p className="text-2xl font-semibold text-primary">£{item.price.toFixed(2)}</p>
          {item.originalPrice && item.price < item.originalPrice && item.type === 'deal' && (
            <p className="text-sm text-muted-foreground line-through">£{item.originalPrice.toFixed(2)}</p>
          )}
        </div>

        <div className="text-xs text-muted-foreground space-y-1.5">
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

          {item.type === 'auction' && typeof item.rarityScore === 'number' && (
            <div className="pt-1">
              <div className="flex justify-between items-center mb-0.5">
                <div className="flex items-center">
                   <Gem className="h-3.5 w-3.5 mr-1.5 text-primary/80" />
                   <h3 className="text-xs font-medium text-muted-foreground">Rarity Score</h3>
                </div>
                <span className="text-xs font-semibold text-primary">{animatedRarityScore}/100</span>
              </div>
              <Progress
                value={animatedRarityScore}
                aria-label="Auction item rarity score"
                className={cn(
                  "h-2 backdrop-blur-sm",
                  rarityProgressTrackClass,
                  rarityProgressIndicatorClass
                )}
              />
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-2">
        {canViewItem ? (
          <Button className="w-full mt-2 interactive-glow" variant="outline" asChild>
            <a href={item.itemLink} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              {buttonText}
            </a>
          </Button>
        ) : (
          <Button className="w-full mt-2 interactive-glow" variant="outline" disabled>
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
