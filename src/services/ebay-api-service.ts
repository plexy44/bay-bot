
'use server';

import type { BayBotItem } from '@/types';
import { popularSearchTermsForLogoClick } from '@/lib/constants';

interface EbayToken {
  access_token: string;
  expires_in: number;
  token_type: string;
  fetched_at: number;
}

let ebayToken: EbayToken | null = null;

interface CacheEntry {
  data: BayBotItem[];
  timestamp: number;
}
const fetchItemsCache = new Map<string, CacheEntry>();
const FETCH_ITEMS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getEbayAuthToken(): Promise<string> {
  if (ebayToken && Date.now() < ebayToken.fetched_at + (ebayToken.expires_in - 300) * 1000) {
    return ebayToken.access_token;
  }

  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;

  if (!appId || !certId) {
    console.error('eBay App ID or Cert ID is not configured in environment variables. Please check your .env file.');
    throw new Error('eBay App ID or Cert ID is not configured in environment variables.');
  }

  const credentials = Buffer.from(`${appId}:${certId}`).toString('base64');

  try {
    const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`eBay OAuth request failed with status ${response.status}: ${errorBody}`);
      throw new Error(`eBay OAuth request failed with status ${response.status}. eBay's response: ${errorBody}`);
    }

    const tokenData = await response.json();
    if (!tokenData.access_token) {
        console.error('eBay OAuth response did not include access_token:', tokenData);
        throw new Error('Failed to retrieve access_token from eBay OAuth response.');
    }
    ebayToken = { ...tokenData, fetched_at: Date.now() };
    return ebayToken!.access_token;
  } catch (error) {
    console.error('Detailed error during eBay OAuth token fetch:', error);
    if (error instanceof Error && error.message.includes('eBay OAuth request failed')) {
      throw error;
    }
    throw new Error('Failed to authenticate with eBay API. Please check server logs for more details and ensure eBay API credentials in .env are correct and have production access.');
  }
}


function calculateDiscountPercentage(currentPrice?: number, originalPrice?: number): number {
  if (originalPrice && currentPrice && originalPrice > currentPrice && originalPrice > 0) {
    return Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
  }
  return 0;
}

function formatTimeLeft(endTimeStr?: string): string | undefined {
  if (!endTimeStr) return undefined;
  const endTime = new Date(endTimeStr);
  const now = new Date();
  const diffMs = endTime.getTime() - now.getTime();

  if (diffMs <= 0) return 'Ended';

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  if (minutes > 0) return `${minutes}m left`;
  return 'Ending soon';
}

interface BrowseApiItemSummary {
  itemId: string;
  title: string;
  image?: { imageUrl: string };
  price: { value: string; currency: string };
  itemAffiliateWebUrl?: string; // For linking to the item
  itemWebUrl?: string; // Alternative link
  shortDescription?: string; // Browse API provides short description
  seller: {
    username: string;
    feedbackPercentage: string;
    feedbackScore: number;
  };
  buyingOptions: string[]; // Contains "FIXED_PRICE" or "AUCTION"
  itemEndDate?: string; // For auctions
  bidCount?: number; // For auctions
  marketingPrice?: { // For deals
    originalPrice?: { value: string; currency: string };
    discountPercentage?: string;
    discountAmount?: { value: string; currency: string };
  };
  condition?: string;
  // Add other fields you might need from Browse API response
}


function transformBrowseItem(browseItem: BrowseApiItemSummary, itemTypeFromFilter: 'deal' | 'auction'): BayBotItem | null {
  try {
    const id = browseItem.itemId;
    const title = browseItem.title;
    const imageUrl = browseItem.image?.imageUrl || 'https://placehold.co/600x400.png';
    const currentPriceValue = parseFloat(browseItem.price.value);

    let originalPriceValue: number | undefined = undefined;
    let discountPercentageValue: number | undefined = undefined;

    if (browseItem.marketingPrice) {
      if (browseItem.marketingPrice.originalPrice?.value) {
        originalPriceValue = parseFloat(browseItem.marketingPrice.originalPrice.value);
      }
      if (browseItem.marketingPrice.discountPercentage) {
        discountPercentageValue = parseFloat(browseItem.marketingPrice.discountPercentage);
      }
    }

    // If discountPercentage wasn't directly provided but we have originalPrice, calculate it.
    if (discountPercentageValue === undefined && originalPriceValue !== undefined) {
      discountPercentageValue = calculateDiscountPercentage(currentPriceValue, originalPriceValue);
    }
    // Ensure discount is 0 if not applicable
     discountPercentageValue = discountPercentageValue || 0;


    const sellerReputation = browseItem.seller?.feedbackPercentage
      ? parseFloat(browseItem.seller.feedbackPercentage)
      : 70; // Default reputation if not available

    // Determine item type based on buyingOptions, fall back to what was requested if ambiguous
    let determinedItemType: 'deal' | 'auction' = itemTypeFromFilter;
    if (browseItem.buyingOptions?.includes('FIXED_PRICE')) {
        determinedItemType = 'deal';
    } else if (browseItem.buyingOptions?.includes('AUCTION')) {
        determinedItemType = 'auction';
    }


    const bayBotItem: BayBotItem = {
      id,
      type: determinedItemType,
      title,
      description: browseItem.shortDescription || `View this item on eBay: ${browseItem.itemWebUrl || browseItem.itemAffiliateWebUrl || title}`,
      imageUrl,
      price: currentPriceValue,
      originalPrice: originalPriceValue,
      discountPercentage: discountPercentageValue,
      sellerReputation,
      'data-ai-hint': title.toLowerCase().split(' ').slice(0, 2).join(' '),
    };

    if (bayBotItem.type === 'auction') {
      bayBotItem.endTime = browseItem.itemEndDate;
      bayBotItem.timeLeft = formatTimeLeft(bayBotItem.endTime);
      bayBotItem.bidCount = browseItem.bidCount || 0;
    }

    return bayBotItem;
  } catch (e) {
    console.error("Error transforming eBay Browse API item:", e, "Raw Browse API item:", JSON.stringify(browseItem, null, 2));
    return null;
  }
}


export const fetchItems = async (
  type: 'deal' | 'auction',
  query?: string,
  isCuratedHomepageDeals: boolean = false
): Promise<BayBotItem[]> => {
  const cacheKey = `browse:${type}:${query || ''}:${isCuratedHomepageDeals}`;

  if (fetchItemsCache.has(cacheKey)) {
    const cachedEntry = fetchItemsCache.get(cacheKey)!;
    if (Date.now() - cachedEntry.timestamp < FETCH_ITEMS_CACHE_TTL_MS) {
      console.log(`[Cache HIT] Returning cached items for key: ${cacheKey}`);
      return cachedEntry.data;
    } else {
      fetchItemsCache.delete(cacheKey);
      console.log(`[Cache EXPIRED] Deleted cache for key: ${cacheKey}`);
    }
  }
  console.log(`[Cache MISS] Fetching items from Browse API for key: ${cacheKey}`);

  const authToken = await getEbayAuthToken();
  
  let keywords = query || '';
  if (isCuratedHomepageDeals && !query) {
    keywords = "top deals"; // Generic term for curated deals
  } else if (type === 'auction' && !query) {
    keywords = "collectible auction"; // Default for auctions
  }

  const browseApiUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  browseApiUrl.searchParams.append('q', keywords);
  browseApiUrl.searchParams.append('limit', '20'); // Request 20 items

  let filterOptions = ['itemLocationCountry:GB']; // Always filter for UK items
  if (type === 'deal') {
    filterOptions.push('buyingOptions:{FIXED_PRICE}');
    // For deals, sorting by discount might be tricky. Browse API may support sorting by price.
    // Example: browseApiUrl.searchParams.append('sort', 'price'); // Ascending price
    // Rely on AI Ranker for smart sorting by discount.
  } else { // auction
    filterOptions.push('buyingOptions:{AUCTION}');
    browseApiUrl.searchParams.append('sort', '-itemEndDate'); // Ending soonest
  }
  browseApiUrl.searchParams.append('filter', filterOptions.join(','));


  try {
    const response = await fetch(browseApiUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', // UK Marketplace
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`eBay Browse API request failed: ${response.status} for query "${keywords}", type "${type}". Body: ${errorBody}`);
      fetchItemsCache.set(cacheKey, { data: [], timestamp: Date.now() });
      throw new Error(`eBay Browse API request failed: ${response.status}. Check server logs. eBay response: ${errorBody}`);
    }

    const data = await response.json();
    
    if (!data.itemSummaries || data.itemSummaries.length === 0) {
      console.warn('No items found or unexpected API response structure from eBay Browse API for query:', keywords, 'type:', type, 'Data:', JSON.stringify(data, null, 2));
      fetchItemsCache.set(cacheKey, { data: [], timestamp: Date.now() });
      return [];
    }
    
    const browseItems: BrowseApiItemSummary[] = data.itemSummaries || [];
    
    const transformedItems = browseItems
      .map(browseItem => transformBrowseItem(browseItem, type))
      .filter((item): item is BayBotItem => item !== null);

    fetchItemsCache.set(cacheKey, { data: transformedItems, timestamp: Date.now() });
    console.log(`[Cache SET] Cached items for key: ${cacheKey}`);
    
    if (type === 'deal') {
        // Initial sort by discount for deals; AI ranker will further refine.
        return transformedItems.sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
    }
    
    return transformedItems; // Auctions are sorted by EndTimeSoonest from API via sort=-itemEndDate

  } catch (error) {
    console.error('Error fetching or processing eBay Browse API items for query:', keywords, 'type:', type, error);
    if (!fetchItemsCache.has(cacheKey)) {
      fetchItemsCache.set(cacheKey, { data: [], timestamp: Date.now() });
    }
    if (error instanceof Error && error.message.includes('eBay Browse API request failed')) {
      throw error; // Re-throw the specific error to be caught by page.tsx
    }
    throw new Error(`Failed to fetch items from eBay. Check server logs. Original error: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export async function getRandomPopularSearchTerm(): Promise<string> {
  if (popularSearchTermsForLogoClick.length === 0) return "tech deals"; // Fallback
  return popularSearchTermsForLogoClick[Math.floor(Math.random() * popularSearchTermsForLogoClick.length)];
}

