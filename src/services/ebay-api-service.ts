
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
const CURATED_BATCH_SIZE = 3;

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
  conditionId?: string;
}

function getHighResolutionImageUrl(originalUrl?: string): string {
  const defaultPlaceholder = 'https://placehold.co/600x400.png';
  if (!originalUrl) return defaultPlaceholder;

  const ebayImagePattern = /(.*\/s-l)\d+(\.(?:jpg|jpeg|png))/i;
  if (originalUrl.includes('ebayimg.com') && ebayImagePattern.test(originalUrl)) {
    return originalUrl.replace(ebayImagePattern, '$11600$2');
  }
  return originalUrl;
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
      : 70; // Default reputation if not available

    let determinedItemType: 'deal' | 'auction' = itemTypeFromFilter;
    const hasAuction = browseItem.buyingOptions?.includes('AUCTION');
    const hasFixedPrice = browseItem.buyingOptions?.includes('FIXED_PRICE');

    if (hasFixedPrice && !hasAuction) {
        determinedItemType = 'deal';
    } else if (hasAuction && !hasFixedPrice) {
        determinedItemType = 'auction';
    } else if (hasAuction && hasFixedPrice) {
        determinedItemType = itemTypeFromFilter; // Respect the filter if item has both options
    }


    const description = browseItem.shortDescription || title; // Fallback to title if no short description
    const itemLink = browseItem.itemAffiliateWebUrl || browseItem.itemWebUrl;


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
      itemLink,
      'data-ai-hint': title.toLowerCase().split(' ').slice(0, 2).join(' '),
      condition: browseItem.condition,
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
  query: string,
  isCuratedHomepage: boolean = false
): Promise<BayBotItem[]> => {
  const cacheKey = `browse:${type}:${query}:${isCuratedHomepage}`;

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
  console.log(`[BayBot Fetch Cache MISS] Fetching items for key: ${cacheKey}. Type: "${type}", Query: "${query}", Curated: ${isCuratedHomepage}`);

  const authToken = await getEbayAuthToken();
  const keywordsForApi = query;

  if (!keywordsForApi) {
      console.warn(`[BayBot Fetch] Query was empty for type "${type}". Returning empty array.`);
      return [];
  }

  const browseApiUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  browseApiUrl.searchParams.append('q', keywordsForApi);
  browseApiUrl.searchParams.append('limit', '100');

  let filterOptions = ['itemLocationCountry:GB'];
  let sortOption = ''; 

  console.log(`[BayBot Fetch Logic] Preparing API call. Type: "${type}", Query: "${keywordsForApi}", Curated: ${isCuratedHomepage}`);

  if (type === 'deal') {
    console.log(`[BayBot Fetch Logic] Applying 'deal' specific filters and sort.`);
    filterOptions.push('buyingOptions:{FIXED_PRICE}');
    if (isCuratedHomepage) {
      filterOptions.push('price:[20..]'); 
    } else {
      filterOptions.push('price:[100..]'); 
    }
    filterOptions.push('conditions:{NEW|USED|MANUFACTURER_REFURBISHED}');
    sortOption = 'bestMatch';
  } else if (type === 'auction') {
    console.log(`[BayBot Fetch Logic] Applying 'auction' specific filters and sort.`);
    filterOptions.push('buyingOptions:{AUCTION}');
    sortOption = 'itemEndDate'; 
  } else {
    console.warn(`[BayBot Fetch Logic] Unexpected type: "${type}". Defaulting to 'deal' logic.`);
    filterOptions.push('buyingOptions:{FIXED_PRICE}');
    filterOptions.push('price:[20..]'); 
    filterOptions.push('conditions:{NEW|USED|MANUFACTURER_REFURBISHED}');
    sortOption = 'bestMatch';
  }
  
  if (sortOption) {
    browseApiUrl.searchParams.append('sort', sortOption);
  }
  
  browseApiUrl.searchParams.append('filter', filterOptions.join(','));

  console.log(`[BayBot Fetch] Constructed eBay API URL: ${browseApiUrl.toString()}`);


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
      console.error(`eBay Browse API request failed: ${response.status} for query "${keywordsForApi}", type "${type}". URL: ${browseApiUrl.toString()}. Body: ${errorBody}`);
      throw new Error(`Failed to fetch from eBay Browse API (status ${response.status}). Check server logs for more details. eBay's response: ${errorBody.substring(0, 500)}`);
    }

    const data = await response.json();
    // console.log(`[BayBot Fetch] eBay API response for query "${keywordsForApi}": ${data.total ?? 0} items found initially.`);


    if (!data.itemSummaries || data.itemSummaries.length === 0) {
      const warningMessage = `[BayBot Fetch eBay Response] No items found or unexpected API response structure from eBay for query: "${keywordsForApi}", type: "${type}". URL: ${browseApiUrl.toString()}. eBay Data: ${JSON.stringify(data, null, 2)}`;
      console.warn(warningMessage);
       if (data.warnings && data.warnings.length > 0) {
        console.warn(`[BayBot Fetch eBay Response] eBay API Warnings:`, JSON.stringify(data.warnings, null, 2));
      }
      fetchItemsCache.set(cacheKey, { data: [], timestamp: Date.now() });
      return [];
    }

    const browseItems: BrowseApiItemSummary[] = data.itemSummaries || [];

    const transformedItems = browseItems
      .map(browseItem => transformBrowseItem(browseItem, type))
      .filter((item): item is BayBotItem => item !== null);
    
    console.log(`[BayBot Fetch] Transformed ${transformedItems.length} items for query "${keywordsForApi}".`);

    fetchItemsCache.set(cacheKey, { data: transformedItems, timestamp: Date.now() });
    console.log(`[Cache SET] Cached ${transformedItems.length} items for key: ${cacheKey}`);

    return transformedItems;

  } catch (error) {
    console.error(`Error in fetchItems for query "${keywordsForApi}", type "${type}", URL: ${browseApiUrl.toString()}:`, error);
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

export async function getBatchedCuratedKeywordsQuery(): Promise<string> {
  if (curatedHomepageSearchTerms.length === 0) {
    console.warn("[BayBot getBatchedCuratedKeywordsQuery] Curated homepage search terms list is empty. Defaulting to 'popular electronics'.");
    return "popular electronics";
  }

  const shuffled = [...curatedHomepageSearchTerms].sort(() => 0.5 - Math.random());
  // Ensure batchSize is at least 1 and not more than the number of available terms or CURATED_BATCH_SIZE
  const batchSize = Math.max(1, Math.min(CURATED_BATCH_SIZE, shuffled.length)); 
  const selectedTerms = shuffled.slice(0, batchSize);

  if (selectedTerms.length === 0) {
    console.warn("[BayBot getBatchedCuratedKeywordsQuery] No terms selected after shuffling. Defaulting to 'featured deals'.");
    return "featured deals"; 
  }
  // Format: (keyword1) OR (keyword2) OR (keyword3)
  return selectedTerms.map(term => `(${encodeURIComponent(term)})`).join(' OR ');
}
