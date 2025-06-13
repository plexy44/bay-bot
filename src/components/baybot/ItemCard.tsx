
import Image from 'next/image';
import React from 'react'; // Import React
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Percent, Tag, TrendingUp, ShieldCheck, Eye } from "lucide-react";
import type { BayBotItem } from '@/types';

interface ItemCardProps {
  item: BayBotItem;
  onAnalyze: (item: BayBotItem) => void;
}

const ItemCardComponent: React.FC<ItemCardProps> = ({ item, onAnalyze }) => {
  return (
    <div className="flex flex-col overflow-hidden h-full glass-card transition-all duration-300 ease-out hover:shadow-[0_0_35px_3px_hsla(var(--primary-hsl),0.25)] hover:-translate-y-1.5">
      <CardHeader className="p-0 relative">
        <div className="aspect-video relative">
          <Image
            src={item.imageUrl || 'https://placehold.co/600x400.png'} // Fallback if imageUrl is missing
            alt={item.title}
            fill
            className="object-cover rounded-t-lg" 
            data-ai-hint={item['data-ai-hint'] || item.title.toLowerCase().split(' ').slice(0,2).join(' ')}
            unoptimized={item.imageUrl?.includes('ebayimg.com')} // Avoid Next.js optimization for external dynamic eBay images
            priority={false} // Standard priority for cards in a grid
          />
          {item.type === 'deal' && item.discountPercentage && item.discountPercentage > 0 && (
            <Badge variant="destructive" className="absolute top-3 right-3 shadow-lg bg-destructive/80 backdrop-blur-sm text-destructive-foreground">
              <Percent className="h-3.5 w-3.5 mr-1" /> {item.discountPercentage}% OFF
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 flex-grow">
        <CardTitle className="text-lg font-headline mb-2 leading-tight line-clamp-2 text-foreground">{item.title}</CardTitle>
        <div className="flex items-center space-x-2 mb-2">
          <Tag className="h-5 w-5 text-primary" />
          <p className="text-2xl font-semibold text-primary">£{item.price.toFixed(2)}</p>
          {item.originalPrice && item.price < item.originalPrice && (
            <p className="text-sm text-muted-foreground line-through">£{item.originalPrice.toFixed(2)}</p>
          )}
        </div>
        
        <div className="text-xs text-muted-foreground space-y-1">
          {item.type === 'auction' && item.timeLeft && (
            <div className="flex items-center">
              <Clock className="h-3.5 w-3.5 mr-1.5" />
              <span>Time left: {item.timeLeft}</span>
            </div>
          )}
          {item.type === 'auction' && item.bidCount !== undefined && (
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
        <Button onClick={() => onAnalyze(item)} className="w-full interactive-glow" variant="outline" disabled={item.type === 'auction'}>
          <Eye className="h-4 w-4 mr-2" />
          {item.type === 'deal' ? 'Analyze Deal' : 'Analysis N/A'}
        </Button>
      </CardFooter>
    </div>
  );
};

export const ItemCard = React.memo(ItemCardComponent);
ItemCard.displayName = 'ItemCard';
