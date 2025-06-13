
export interface BayBotItem {
  id: string;
  type: 'deal' | 'auction'; // Explicitly 'deal' or 'auction'
  title: string;
  description: string; // Primarily from shortDescription from Browse API, or fallback
  imageUrl: string;
  price: number; // current price for deal, current bid for auction
  originalPrice?: number; // RRP or original price for deals
  discountPercentage?: number; // Calculated or provided for deals
  sellerReputation: number; // Score from 0-100 (feedbackPercentage)
  condition?: string; // Item condition string
  itemLink?: string; // URL to view the item on eBay
  // Auction specific
  endTime?: string; // ISO date string, for auctions
  timeLeft?: string; // Human-readable time left, for auctions
  bidCount?: number; // For auctions
  // UI specific
  'data-ai-hint'?: string; // For placeholder image search hint
}

// For AI analysis modal
export interface AnalysisResult {
  riskScore: number;
  rarityScore: number;
  summary: string;
}

