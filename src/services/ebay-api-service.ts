
'use server';

import type { BayBotItem } from '@/types';
import {
  curatedHomepageSearchTerms,
  GLOBAL_CURATED_DEALS_REQUEST_MARKER,
  GLOBAL_CURATED_AUCTIONS_REQUEST_MARKER,
  STANDARD_CACHE_TTL_MS,
  GLOBAL_CURATED_CACHE_TTL_MS,
  EXCLUSION_KEYWORDS,
  MIN_SELLER_REPUTATION_THRESHOLD,
  MIN_DEAL_DISCOUNT_THRESHOLD
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
    console.error('[eBay Service Auth] eBay App ID or Cert ID is not configured in environment variables. Please check your .env file.');
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
      console.error(`[eBay Service Auth] eBay OAuth request failed with status ${response.status}: ${errorBody}`);
      if (errorBody.includes("invalid_client")) {
        throw new Error(`Critical eBay API Authentication Failure: The error 'invalid_client' indicates your EBAY_APP_ID or EBAY_CERT_ID in the .env file is incorrect or lacks production API access. Please verify these credentials and restart your application. Consult server logs for the exact eBay response. Original eBay error: ${errorBody}`);
      }
      throw new Error(`eBay OAuth request failed with status ${response.status}. eBay's response: ${errorBody}`);
    }

    const tokenData = await response.json();
    if (!tokenData.access_token) {
        console.error('[eBay Service Auth] eBay OAuth response did not include access_token:', tokenData);
        throw new Error('Failed to retrieve access_token from eBay OAuth response.');
    }
    ebayToken = { ...tokenData, fetched_at: Date.now() };
    console.log('[eBay Service Auth] Successfully fetched new eBay OAuth token.');
    return ebayToken!.access_token;
  } catch (error) {
    console.error('[eBay Service Auth] Detailed error during eBay OAuth token fetch:', error);
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
  itemLocation?: { country?: string };
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


function transformBrowseItem(
  browseItem: BrowseApiItemSummary,
  itemTypeFromFilter: 'deal' | 'auction',
  keywordsForApi: string
): BayBotItem | null {
  try {
    const id = browseItem.itemId;
    const title = browseItem.title.trim();
    const lowerTitle = title.toLowerCase();
    const lowerKeywords = keywordsForApi.toLowerCase();

    // Exclusion keyword check
    for (const exclusionKeyword of EXCLUSION_KEYWORDS) {
      if (lowerTitle.includes(exclusionKeyword)) {
        // If exclusion keyword is part of the search query, it's allowed.
        // Example: user searches for "iphone box only"
        let isExclusionInQuery = false;
        const queryWords = lowerKeywords.split(' ');
        const exclusionWords = exclusionKeyword.split(' ');
        if (exclusionWords.every(exWord => queryWords.includes(exWord))) {
             isExclusionInQuery = true;
        }

        if (!isExclusionInQuery) {
          console.log(`[eBay Service Transform] Excluding item "${title}" due to keyword "${exclusionKeyword}" not being part of search query "${keywordsForApi}".`);
          return null;
        }
      }
    }

    const sellerReputation = browseItem.seller?.feedbackPercentage
      ? parseFloat(browseItem.seller.feedbackPercentage)
      : 0; // Default to 0 if not available, to be filtered

    if (sellerReputation < MIN_SELLER_REPUTATION_THRESHOLD) {
        console.log(`[eBay Service Transform] Excluding item "${title}" due to low seller reputation: ${sellerReputation}% (threshold: ${MIN_SELLER_REPUTATION_THRESHOLD}%)`);
        return null;
    }


    let determinedItemType: 'deal' | 'auction' = itemTypeFromFilter;
    const hasAuction = browseItem.buyingOptions?.includes('AUCTION');
    const hasFixedPrice = browseItem.buyingOptions?.includes('FIXED_PRICE');

    if (itemTypeFromFilter === 'deal') {
      if (!hasFixedPrice) {
        console.log(`[eBay Service Transform] Discarding item "${title}" for 'deal' request: No FIXED_PRICE option.`);
        return null;
      }
      determinedItemType = 'deal';
    } else if (itemTypeFromFilter === 'auction') {
      if (!hasAuction) {
        console.log(`[eBay Service Transform] Discarding item "${title}" for 'auction' request: No AUCTION option.`);
        return null;
      }
      determinedItemType = 'auction';
    }


    const imageUrl = getHighResolutionImageUrl(browseItem.image?.imageUrl);
    const currentPriceValue = parseFloat(browseItem.price.value);

    let originalPriceValue: number | undefined = undefined;
    let discountPercentageValue: number | undefined = undefined;

    if (browseItem.marketingPrice) {
      if (browseItem.marketingPrice.originalPrice?.value) {
        originalPriceValue = parseFloat(browseItem.marketingPrice.originalPrice.value);
      }
      // Use marketingPrice.discountPercentage only if it's a positive value, otherwise calculate.
      if (browseItem.marketingPrice.discountPercentage && parseFloat(browseItem.marketingPrice.discountPercentage) > 0) {
        discountPercentageValue = parseFloat(browseItem.marketingPrice.discountPercentage);
      }
    }
    
    // Ensure discount is calculated if possible and not already set
    if (discountPercentageValue === undefined && originalPriceValue !== undefined && currentPriceValue < originalPriceValue) {
      discountPercentageValue = calculateDiscountPercentage(currentPriceValue, originalPriceValue);
    }
    discountPercentageValue = discountPercentageValue || 0;

    // For deals, ensure there's a meaningful discount
    if (determinedItemType === 'deal' && discountPercentageValue < MIN_DEAL_DISCOUNT_THRESHOLD) {
       if (!originalPriceValue || originalPriceValue <= currentPriceValue) { // Also check if original price is actually higher
        console.log(`[eBay Service Transform] Excluding deal "${title}" due to discount (${discountPercentageValue}%) below threshold (${MIN_DEAL_DISCOUNT_THRESHOLD}%) or no valid original price.`);
        return null;
       }
    }


    const description = browseItem.shortDescription || title;
    const itemLink = browseItem.itemAffiliateWebUrl || browseItem.itemWebUrl;

    const bayBotItem: BayBotItem = {
      id,
      type: determinedItemType, // Strictly use the type determined by filter and validation
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
      conditionId: browseItem.conditionId,
      sellerFeedbackScore: browseItem.seller?.feedbackScore || 0,
    };

    if (bayBotItem.type === 'auction') {
      bayBotItem.endTime = browseItem.itemEndDate;
      bayBotItem.timeLeft = formatTimeLeft(bayBotItem.endTime);
      bayBotItem.bidCount = browseItem.bidCount || 0;
    }

    return bayBotItem;
  } catch (e) {
    console.error("[eBay Service Transform] Error transforming eBay Browse API item:", e, "Raw Browse API item:", JSON.stringify(browseItem, null, 2));
    return null;
  }
}

export async function getRandomPopularSearchTerm(): Promise<string> {
  if (curatedHomepageSearchTerms.length === 0) {
    console.warn("[eBay Service Util] Curated homepage search terms list is empty. Defaulting to 'tech deals'.");
    return "tech deals";
  }
  const randomIndex = Math.floor(Math.random() * curatedHomepageSearchTerms.length);
  const term = curatedHomepageSearchTerms[randomIndex];
  console.log(`[eBay Service Util] Selected random popular search term: "${term}"`);
  return term;
}


export const fetchItems = async (
  type: 'deal' | 'auction', 
  queryIdentifier: string  
): Promise<BayBotItem[]> => {
  const isGlobalCuratedRequest = queryIdentifier === GLOBAL_CURATED_DEALS_REQUEST_MARKER || queryIdentifier === GLOBAL_CURATED_AUCTIONS_REQUEST_MARKER;
  
  let keywordsForApi: string;
  let cacheKeySuffix: string;

  if (isGlobalCuratedRequest) {
    keywordsForApi = await getRandomPopularSearchTerm(); 
    cacheKeySuffix = `${queryIdentifier}_${keywordsForApi}`; 
    console.log(`[BayBot Fetch] Global curated request for type '${type}'. Using random term: "${keywordsForApi}" (derived from marker "${queryIdentifier}")`);
  } else {
    keywordsForApi = queryIdentifier;
    cacheKeySuffix = queryIdentifier; 
    console.log(`[BayBot Fetch] User search for type '${type}'. API query (q): "${keywordsForApi}"`);
  }
  
  const cacheKey = `browse:${type}:${cacheKeySuffix}`;
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
  console.log(`[Cache MISS] Fetching items. Type: "${type}", API Query: "${keywordsForApi}", Global Curated: ${isGlobalCuratedRequest}`);

  if (!keywordsForApi || keywordsForApi.trim() === '') {
      console.warn(`[BayBot Fetch] 'keywordsForApi' resolved to an empty string for type "${type}", queryIdentifier "${queryIdentifier}". Returning empty array.`);
      return [];
  }

  const authToken = await getEbayAuthToken();
  const browseApiUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  browseApiUrl.searchParams.append('q', keywordsForApi);
  browseApiUrl.searchParams.append('limit', '50'); 
  browseApiUrl.searchParams.append('offset', '0');

  let filterOptions: string[] = ['itemLocationCountry:GB'];
  let sortOption: string | null = null;

  console.log(`[BayBot Fetch Logic] Constructing API params. Query(q): "${keywordsForApi}". Type for params: "${type}".`);

  if (type === 'auction') {
    console.log(`[BayBot Fetch Logic] Applying AUCTION specific parameters.`);
    filterOptions.push('buyingOptions:{AUCTION}');
    sortOption = 'endingSoonest';
  } else { 
    console.log(`[BayBot Fetch Logic] Applying DEAL specific parameters.`);
    filterOptions.push('buyingOptions:{FIXED_PRICE}');
    filterOptions.push('priceCurrency:GBP');
    filterOptions.push('conditionIds:{1000|2000|2500|3000}'); 
    
    if (isGlobalCuratedRequest) {
      filterOptions.push('price:[20..]'); 
      sortOption = null; 
      console.log(`[BayBot Fetch Logic] Global Curated Deal: Price filter [20..], No server sort by API (will sort post-fetch).`);
    } else { 
      filterOptions.push('price:[1..]'); // For user search, allow lower prices but AI will help qualify
      sortOption = 'price'; // Default API sort for user search deals, will be re-sorted post-fetch
      console.log(`[BayBot Fetch Logic] User Searched Deal: Price filter [1..], API Sort by 'price'.`);
    }
  }

  if (sortOption) {
    browseApiUrl.searchParams.append('sort', sortOption);
  }
  const finalFilterString = filterOptions.join(',');
  browseApiUrl.searchParams.append('filter', finalFilterString);

  console.log(`[BayBot Fetch] Final API call details -- Sort: "${sortOption || 'eBay Default'}", Filter: "${finalFilterString}"`);
  console.log(`[BayBot Fetch] Full constructed eBay API URL: ${browseApiUrl.toString()}`);

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
        console.error(`[eBay Service Response] eBay Browse API response was not valid JSON for query "${keywordsForApi}", type "${type}". URL: ${browseApiUrl.toString()}. Response text (first 500 chars): ${responseDataText.substring(0, 500)}`);
        throw new Error(`Failed to parse eBay API response as JSON. Response text (first 200 chars): ${responseDataText.substring(0, 200)}...`);
    }

    if (!response.ok) {
      console.warn(`[eBay Service Response] eBay API request FAILED with status: ${response.status} for query "${keywordsForApi}", type "${type}". URL: ${browseApiUrl.toString()}.`);
      console.warn(`[eBay Service Response] Full eBay error response: ${JSON.stringify(data, null, 2)}`);
      if (data && data.warnings && data.warnings.length > 0) {
        console.warn(`[eBay Service Response] eBay API returned warnings: ${JSON.stringify(data.warnings, null, 2)}. These might explain the failure or no items.`);
      }
      if (data && data.itemSummaries === undefined && data.warnings && data.warnings.length > 0) {
         console.log(`[eBay Service Response] Due to API warnings and no items, returning empty list for query "${keywordsForApi}".`);
         fetchItemsCache.set(cacheKey, { data: [], timestamp: Date.now() });
         return [];
      }
      throw new Error(`Failed to fetch from eBay Browse API (status ${response.status}). Query: "${keywordsForApi}". eBay response: ${JSON.stringify(data, null, 2).substring(0, 500)}`);
    }

    if (!data.itemSummaries || data.itemSummaries.length === 0) {
      const warningMessage = `[eBay Service Response] No items found (itemSummaries is null or empty) from eBay for query: "${keywordsForApi}", type: "${type}". URL: ${browseApiUrl.toString()}.`;
      console.warn(warningMessage);
      if (data.warnings && data.warnings.length > 0) {
          console.warn(`[eBay Service Response] eBay API Warnings (potentially leading to no items):`, JSON.stringify(data.warnings, null, 2));
      } else {
          console.log(`[eBay Service Response] eBay API response contained no warnings, but also no items. Response Data: ${JSON.stringify(data, null, 2)}`);
      }
      fetchItemsCache.set(cacheKey, { data: [], timestamp: Date.now() });
      return [];
    }

    const browseItems: BrowseApiItemSummary[] = data.itemSummaries || [];
    let transformedItems = browseItems
      .map(browseItem => transformBrowseItem(browseItem, type, keywordsForApi))
      .filter((item): item is BayBotItem => item !== null);

    console.log(`[eBay Service Response] Transformed ${transformedItems.length} items after initial filtering for query "${keywordsForApi}".`);

    // Server-side sorting for deals AFTER initial fetch and transformation
    if (type === 'deal') {
        if (isGlobalCuratedRequest) {
            // For global curated deals, sort primarily by discount percentage
            transformedItems.sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
            console.log(`[eBay Service Sort] Sorted ${transformedItems.length} global curated deals by discount percentage.`);
        } else {
            // For user-searched deals, sort by discount, then seller reputation, then price
            transformedItems.sort((a, b) => {
                // Primary: Discount Percentage (descending)
                const discountDiff = (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0);
                if (discountDiff !== 0) return discountDiff;
                // Secondary: Seller Reputation (descending)
                const reputationDiff = (b.sellerReputation ?? 0) - (a.sellerReputation ?? 0);
                if (reputationDiff !== 0) return reputationDiff;
                // Tertiary: Price (ascending)
                return (a.price ?? Infinity) - (b.price ?? Infinity);
            });
            console.log(`[eBay Service Sort] Sorted ${transformedItems.length} user-searched deals by discount -> reputation -> price.`);
        }
    }
    // Auctions are already sorted by endingSoonest from the API, additional server sort not typically needed beyond filtering.


    // Final type check (redundant due to transformBrowseItem, but good for safety)
    const finalItems = transformedItems.filter(item => item.type === type);
    if (finalItems.length !== transformedItems.length) {
      console.warn(`[eBay Service Type Filter] Final type filter removed ${transformedItems.length - finalItems.length} items that did not match requested type '${type}'. This should ideally not happen if transformBrowseItem is correct.`);
    }
    
    console.log(`[eBay Service Response] Returning ${finalItems.length} items after all server-side processing for query "${keywordsForApi}".`);
    fetchItemsCache.set(cacheKey, { data: finalItems, timestamp: Date.now() });
    console.log(`[Cache SET] Cached ${finalItems.length} items for key: ${cacheKey} (TTL: ${cacheTTL / 1000}s)`);
    return finalItems;

  } catch (error) {
    console.error(`[eBay Service Fetch Error] Error in fetchItems for query "${keywordsForApi}", type "${type}", URL: ${browseApiUrl.toString()}:`, error);
    if (error instanceof Error) {
        if (error.message.includes("eBay Browse API request failed") || error.message.includes("eBay OAuth request failed") || error.message.includes("Failed to authenticate with eBay API") || error.message.includes("Failed to fetch from eBay Browse API") || error.message.includes('Critical eBay API Authentication Failure')) {
             throw error; 
        }
        throw new Error(`Failed to fetch eBay items: ${error.message}. Original error type: ${error.constructor.name}`);
    }
    throw new Error(`Failed to fetch eBay items due to an unknown error: ${String(error)}.`);
  }
};
