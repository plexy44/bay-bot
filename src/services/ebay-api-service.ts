
'use server';

import type { BayBotItem } from '@/types';
import {
  curatedHomepageSearchTerms,
  GLOBAL_CURATED_DEALS_REQUEST_MARKER,
  GLOBAL_CURATED_AUCTIONS_REQUEST_MARKER,
  STANDARD_CACHE_TTL_MS,
  GLOBAL_CURATED_CACHE_TTL_MS
} from '@/lib/constants';

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
      : 70; // Default to 70% if not available

    let determinedItemType: 'deal' | 'auction' = itemTypeFromFilter;
    const hasAuction = browseItem.buyingOptions?.includes('AUCTION');
    const hasFixedPrice = browseItem.buyingOptions?.includes('FIXED_PRICE');

    if (hasFixedPrice && !hasAuction) {
        determinedItemType = 'deal';
    } else if (hasAuction && !hasFixedPrice) {
        determinedItemType = 'auction';
    } else if (hasAuction && hasFixedPrice) {
        // If both, trust the filter that led to this item unless other logic dictates
        determinedItemType = itemTypeFromFilter;
    }


    const description = browseItem.shortDescription || title;
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

export async function getGlobalCuratedKeywordsApiQueryString(): Promise<string> {
  if (curatedHomepageSearchTerms.length === 0) {
    console.warn("[BayBot getGlobalCuratedKeywordsApiQueryString] Curated terms list is empty. Defaulting to 'popular electronics'.");
    return encodeURIComponent("popular electronics");
  }
  const queryString = curatedHomepageSearchTerms.map(term => `(${encodeURIComponent(term)})`).join(' OR ');
  console.log(`[BayBot getGlobalCuratedKeywordsApiQueryString] Generated query string: ${queryString}`);
  return queryString;
}


export const fetchItems = async (
  type: 'deal' | 'auction',
  queryIdentifier: string
): Promise<BayBotItem[]> => {
  const isGlobalCuratedRequest = queryIdentifier === GLOBAL_CURATED_DEALS_REQUEST_MARKER || queryIdentifier === GLOBAL_CURATED_AUCTIONS_REQUEST_MARKER;
  const cacheKey = `browse:${type}:${queryIdentifier}`; // Simplified key, TTL manages freshness of "global"
  const cacheTTL = isGlobalCuratedRequest ? GLOBAL_CURATED_CACHE_TTL_MS : STANDARD_CACHE_TTL_MS;

  if (fetchItemsCache.has(cacheKey)) {
    const cachedEntry = fetchItemsCache.get(cacheKey)!;
    if (Date.now() - cachedEntry.timestamp < cacheTTL) {
      console.log(`[Cache HIT] Returning cached items for key: ${cacheKey} (TTL: ${cacheTTL / 1000}s)`);
      return cachedEntry.data;
    } else {
      fetchItemsCache.delete(cacheKey);
      console.log(`[Cache EXPIRED] Deleted cache for key: ${cacheKey}`);
    }
  }
  console.log(`[BayBot Fetch Cache MISS] Fetching items. Type: "${type}", Query Identifier: "${queryIdentifier}", Is Global Curated: ${isGlobalCuratedRequest}`);

  const authToken = await getEbayAuthToken();

  let keywordsForApi: string;
  if (isGlobalCuratedRequest) {
    keywordsForApi = await getGlobalCuratedKeywordsApiQueryString(); // Await the async function
    console.log(`[BayBot Fetch] Global curated request. Actual API query: "${keywordsForApi}" derived from marker "${queryIdentifier}"`);
  } else {
    keywordsForApi = queryIdentifier; // Already URL encoded by caller if necessary (e.g. AppHeader)
    console.log(`[BayBot Fetch] User search or non-marker query. Actual API query: "${keywordsForApi}"`);
  }

  if (!keywordsForApi) {
      console.warn(`[BayBot Fetch] keywordsForApi was empty for type "${type}", queryIdentifier "${queryIdentifier}". Returning empty array.`);
      return [];
  }

  const browseApiUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  browseApiUrl.searchParams.append('q', keywordsForApi);
  browseApiUrl.searchParams.append('limit', '100');
  browseApiUrl.searchParams.append('offset', '0');

  let filterOptions: string[] = ['itemLocationCountry:GB'];
  let sortOption: string | null = null;

  console.log(`[BayBot Fetch Logic] Preparing API call. Effective Type: "${type}", Query for API: "${keywordsForApi}", isGlobalCurated: ${isGlobalCuratedRequest}`);

  if (type === 'deal') {
    console.log(`[BayBot Fetch Logic] Applying DEAL specific filters and sort.`);
    filterOptions.push('buyingOptions:{FIXED_PRICE}');
    const minPrice = isGlobalCuratedRequest ? '20' : '100'; // Use less restrictive min price for global curated
    filterOptions.push(`price:[${minPrice}..]`);
    filterOptions.push('priceCurrency:GBP');
    filterOptions.push('conditions:{NEW|USED|MANUFACTURER_REFURBISHED}');
    sortOption = 'bestMatch';
  } else if (type === 'auction') {
    console.log(`[BayBot Fetch Logic] Applying AUCTION specific filters and sort.`);
    filterOptions.push('buyingOptions:{AUCTION}');
    sortOption = 'endingSoonest';
  } else {
    console.warn(`[BayBot Fetch Logic] Unexpected type: "${type}". Defaulting to 'deal' logic for safety.`);
    filterOptions.push('buyingOptions:{FIXED_PRICE}');
    filterOptions.push('price:[20..]');
    filterOptions.push('priceCurrency:GBP');
    filterOptions.push('conditions:{NEW|USED|MANUFACTURER_REFURBISHED}');
    sortOption = 'bestMatch';
  }

  if (sortOption) {
    browseApiUrl.searchParams.append('sort', sortOption);
  }
  const finalFilterString = filterOptions.join(',');
  browseApiUrl.searchParams.append('filter', finalFilterString);

  console.log(`[BayBot Fetch] Final API call details: Type: ${type}, Sort: ${sortOption || 'default'}, Filter: "${finalFilterString}"`);
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

    const responseDataText = await response.text();
    let data;
    try {
        data = JSON.parse(responseDataText);
    } catch (jsonParseError) {
        console.error(`eBay Browse API response was not valid JSON for query "${keywordsForApi}", type "${type}". URL: ${browseApiUrl.toString()}. Response text: ${responseDataText.substring(0, 500)}`);
        throw new Error(`Failed to parse eBay API response as JSON. Response text: ${responseDataText.substring(0, 200)}...`);
    }

    if (!response.ok) {
      console.error(`eBay Browse API request failed: ${response.status} for query "${keywordsForApi}", type "${type}". URL: ${browseApiUrl.toString()}. Full Response Body: ${JSON.stringify(data, null, 2)}`);
      if (data.warnings && data.warnings.length > 0) {
        console.warn(`[BayBot Fetch eBay Response] eBay API returned warnings for query: "${keywordsForApi}", type: "${type}". Warnings: ${JSON.stringify(data.warnings, null, 2)}. Returning empty list as API indicated issues.`);
        fetchItemsCache.set(cacheKey, { data: [], timestamp: Date.now() });
        return []; // Return empty for warnings that likely indicate no valid items due to filter/sort problems
      }
      throw new Error(`Failed to fetch from eBay Browse API (status ${response.status}). Query: "${keywordsForApi}". Check server logs for more details. eBay's response: ${JSON.stringify(data, null, 2).substring(0, 500)}`);
    }

    if (!data.itemSummaries || data.itemSummaries.length === 0) {
      const warningMessage = `[BayBot Fetch eBay Response] No items found from eBay for query: "${keywordsForApi}", type: "${type}". URL: ${browseApiUrl.toString()}.`;
      console.warn(warningMessage, `eBay Data: ${JSON.stringify(data, null, 2)}`);
      if (data.warnings && data.warnings.length > 0) {
          console.warn(`[BayBot Fetch eBay Response] eBay API Warnings that might have led to no items:`, JSON.stringify(data.warnings, null, 2));
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
    console.log(`[Cache SET] Cached ${transformedItems.length} items for key: ${cacheKey} (TTL: ${cacheTTL / 1000}s)`);
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

    
