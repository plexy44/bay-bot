
'use server';

import type { BayBotItem } from '@/types';
import { curatedHomepageSearchTerms } from '@/lib/constants';

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
      if (errorBody.includes("invalid_client")) {
        throw new Error(`Critical eBay API Authentication Failure: The error 'invalid_client' indicates your EBAY_APP_ID or EBAY_CERT_ID in the .env file is incorrect or lacks production API access. Please verify these credentials and restart your application. Consult server logs for the exact eBay response. Original eBay error: ${errorBody}`);
      }
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
    if (error instanceof Error) {
        if (error.message.includes('eBay OAuth request failed') || error.message.includes('invalid_client') || error.message.includes('Critical eBay API Authentication Failure')) {
            throw error;
        }
        throw new Error(`Failed to authenticate with eBay API: ${error.message}. Please check server logs for more details and ensure eBay API credentials in .env are correct and have production access.`);
    }
    throw new Error('Failed to authenticate with eBay API due to an unknown error. Please check server logs for more details.');
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
  itemAffiliateWebUrl?: string;
  itemWebUrl?: string;
  shortDescription?: string;
  seller: {
    username: string;
    feedbackPercentage: string;
    feedbackScore: number;
  };
  buyingOptions: string[];
  itemEndDate?: string;
  bidCount?: number;
  marketingPrice?: {
    originalPrice?: { value: string; currency: string };
    discountPercentage?: string;
    discountAmount?: { value: string; currency: string };
  };
  condition?: string;
}

function getHighResolutionImageUrl(originalUrl?: string): string {
  const defaultPlaceholder = 'https://placehold.co/600x400.png';
  if (!originalUrl) return defaultPlaceholder;

  // Try to replace size specifier like s-l225, s-l500 with s-l1600 for higher resolution
  // This works for many eBay image URLs.
  const ebayImagePattern = /(.*\/s-l)\d+(\.(?:jpg|jpeg|png))/i;
  if (originalUrl.includes('ebayimg.com') && ebayImagePattern.test(originalUrl)) {
    return originalUrl.replace(ebayImagePattern, '$11600$2');
  }
  return originalUrl; // Return original if not an eBay pattern or no specifier found
}


function transformBrowseItem(browseItem: BrowseApiItemSummary, itemTypeFromFilter: 'deal' | 'auction'): BayBotItem | null {
  try {
    const id = browseItem.itemId;
    const title = browseItem.title;
    const imageUrl = getHighResolutionImageUrl(browseItem.image?.imageUrl);
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

    if (discountPercentageValue === undefined && originalPriceValue !== undefined && currentPriceValue < originalPriceValue) {
      discountPercentageValue = calculateDiscountPercentage(currentPriceValue, originalPriceValue);
    }
     discountPercentageValue = discountPercentageValue || 0;


    const sellerReputation = browseItem.seller?.feedbackPercentage
      ? parseFloat(browseItem.seller.feedbackPercentage)
      : 70; 

    let determinedItemType: 'deal' | 'auction' = itemTypeFromFilter;
    if (browseItem.buyingOptions?.includes('FIXED_PRICE') && !browseItem.buyingOptions?.includes('AUCTION')) {
        determinedItemType = 'deal';
    } else if (browseItem.buyingOptions?.includes('AUCTION')) {
        determinedItemType = 'auction';
    }
    // If it has both, and typeFromFilter was 'deal', keep 'deal'. If 'auction', keep 'auction'.
    // This handles items that might be listed as both (rare for item_summary).

    const description = browseItem.shortDescription ||
                        (browseItem.itemWebUrl ? `View this item on eBay: ${browseItem.itemWebUrl}` :
                        (browseItem.itemAffiliateWebUrl ? `View this item on eBay: ${browseItem.itemAffiliateWebUrl}` : title));

    const bayBotItem: BayBotItem = {
      id,
      type: determinedItemType,
      title,
      description,
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
  if (isCuratedHomepageDeals && !keywords) {
    keywords = await getRandomPopularSearchTerm(); 
    console.log(`[BayBot Curated Homepage] Using random search term: "${keywords}" for initial deals load.`);
  } else if (type === 'auction' && !keywords) {
    keywords = "collectible auction"; 
    console.log(`[BayBot Auctions] No query, using default: "${keywords}"`);
  }

  if (!keywords) {
    console.warn("[BayBot Fetch] No keywords determined, defaulting to 'popular items'. This may happen if curated/auction defaults are not met and no query is provided.");
    keywords = "popular items"; 
  }


  const browseApiUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search'); 
  browseApiUrl.searchParams.append('q', keywords);
  browseApiUrl.searchParams.append('limit', '100');

  let filterOptions = ['itemLocationCountry:GB'];
  if (type === 'deal') {
    filterOptions.push('buyingOptions:{FIXED_PRICE}');
    // Optionally, to try and get deals, we can add aspect_filter for deal programs if available
    // filterOptions.push('aspect_filter:{UPC,<ASIN_FOR_PRODUCT>,DealProgram:<PROGRAM_NAME>}');
    // However, 'buyingOptions:{FIXED_PRICE}' is the most direct way to get non-auction items.
  } else { 
    filterOptions.push('buyingOptions:{AUCTION}');
    browseApiUrl.searchParams.append('sort', '-itemEndDate'); 
  }
  browseApiUrl.searchParams.append('filter', filterOptions.join(','));


  try {
    const response = await fetch(browseApiUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`eBay Browse API request failed: ${response.status} for query "${keywords}", type "${type}". Body: ${errorBody}`);
      throw new Error(`Failed to fetch from eBay Browse API (status ${response.status}). Check server logs for more details. eBay's response: ${errorBody.substring(0, 500)}`);
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
    console.log(`[Cache SET] Cached ${transformedItems.length} items for key: ${cacheKey}`);

    return transformedItems;

  } catch (error) {
    console.error(`Error in fetchItems for query "${keywords}", type "${type}":`, error);
    if (error instanceof Error) {
        if (error.message.includes("eBay Browse API request failed") || error.message.includes("eBay OAuth request failed") || error.message.includes("Failed to authenticate with eBay API") || error.message.includes("Failed to fetch from eBay Browse API") || error.message.includes('Critical eBay API Authentication Failure')) {
             throw error; 
        }
        throw new Error(`Failed to fetch eBay items: ${error.message}.`);
    }
    throw new Error(`Failed to fetch eBay items due to an unknown error: ${String(error)}.`);
  }
};

export async function getRandomPopularSearchTerm(): Promise<string> {
  if (curatedHomepageSearchTerms.length === 0) {
    console.warn("[BayBot getRandomPopularSearchTerm] Curated homepage search terms list is empty. Defaulting to 'tech deals'.");
    return "tech deals"; 
  }
  const randomIndex = Math.floor(Math.random() * curatedHomepageSearchTerms.length);
  return curatedHomepageSearchTerms[randomIndex];
}
