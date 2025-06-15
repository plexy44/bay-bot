
export interface DealScopeItem {
  id: string;
  type: 'deal' | 'auction'; // Explicitly 'deal' or 'auction'
  title: string;
  description: string; // Primarily from shortDescription from Browse API, or fallback
  imageUrl: string;
  price: number; // current price for deal, current bid for auction
  originalPrice?: number; // RRP or original price for deals
  discountPercentage?: number; // Calculated or provided for deals
  sellerReputation: number; // Score from 0-100 (feedbackPercentage)
  sellerFeedbackScore?: number; // Raw feedback score (count) for seller
  condition?: string; // Item condition string
  conditionId?: string; // Item condition ID
  itemLink?: string; // URL to view the item on eBay
  // Auction specific
  endTime?: string; // ISO date string, for auctions
  timeLeft?: string; // Human-readable time left, for auctions
  bidCount?: number; // For auctions
  rarityScore?: number; // Optional Rarity score, can be for deals (via analysis) or auctions (via qualification)
  // UI specific
  'data-ai-hint'?: string; // For placeholder image search hint
}

// For AI analysis modal
export interface AnalysisResult {
  riskScore: number;
  rarityScore: number;
  keywords: string[];
}
