export interface BayBotItem {
  id: string;
  type: 'deal' | 'auction';
  title: string;
  description: string;
  imageUrl: string;
  price: number; // current price for deal, current bid for auction
  originalPrice?: number; // RRP or original price for deals
  discountPercentage?: number; // Calculated or provided for deals
  sellerReputation: number; // Score from 0-100
  // Auction specific
  endTime?: string; // ISO date string, for auctions
  timeLeft?: string; // Human-readable time left, for auctions
  bidCount?: number; // For auctions
}

// For AI analysis modal
export interface AnalysisResult {
  riskScore: number;
  rarityScore: number;
  summary: string;
}
