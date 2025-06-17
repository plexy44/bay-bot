
'use server';

import type { DealScopeItem } from '@/types';
import {
  curatedHomepageSearchTerms,
  STANDARD_CACHE_TTL_MS,
  GLOBAL_CURATED_CACHE_TTL_MS,
  EXCLUSION_KEYWORDS,
  MIN_SELLER_REPUTATION_THRESHOLD,
  MIN_DEAL_DISCOUNT_THRESHOLD,
  API_FETCH_LIMIT
} from '@/lib/constants';

interface EbayToken {
  access_token: string;
  expires_in: number;
  token_type: string;
  fetched_at: number;
}

let ebayToken: EbayToken | null = null;

interface CacheEntry {
  data: DealScopeItem[];
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
    console.error('[eBay Service Auth] eBay App ID or Cert ID is not configured in environment variables.');
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
      console.error(`[eBay Service Auth] OAuth request FAILED ${response.status}: ${errorBody}`);
      if (errorBody.includes("invalid_client")) {
        throw new Error(`Critical eBay API Authentication Failure: 'invalid_client' suggests EBAY_APP_ID or EBAY_CERT_ID in .env is incorrect or lacks production access. Verify credentials. eBay response: ${errorBody}`);
      }
      throw new Error(`eBay OAuth request failed with status ${response.status}. eBay's response: ${errorBody}`);
    }

    const tokenData = await response.json();
    if (!tokenData.access_token) {
        console.error('[eBay Service Auth] OAuth response missing access_token:', tokenData);
        throw new Error('Failed to retrieve access_token from eBay OAuth response.');
    }
    ebayToken = { ...tokenData, fetched_at: Date.now() };
    return ebayToken!.access_token;
  } catch (error) {
    console.error('[eBay Service Auth] Detailed error during OAuth token fetch:', error);
    if (error instanceof Error) {
        if (error.message.includes('eBay OAuth request failed') || error.message.includes('invalid_client') || error.message.includes('Critical eBay API Authentication Failure')) {
            throw error;
        }
        throw new Error(`Failed to authenticate with eBay API: ${error.message}. Check server logs and .env credentials.`);
    }
    throw new Error('Failed to authenticate with eBay API due to an unknown error. Check server logs.');
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
  price?: { value: string; currency: string }; // Made price optional
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
  keywordsUsedForApi: string,
  isGlobalCuratedRequestForTransform: boolean
): DealScopeItem | null {
  try {
    const id = browseItem.itemId;
    const title = browseItem.title.trim();
    const lowerTitle = title.toLowerCase();
    const lowerKeywords = typeof keywordsUsedForApi === 'string' ? keywordsUsedForApi.toLowerCase().trim() : "";


    for (const exclusionKeyword of EXCLUSION_KEYWORDS) {
      if (lowerTitle.includes(exclusionKeyword.toLowerCase())) {
        let isExclusionInQuery = false;
        if (lowerKeywords) {
            if (lowerKeywords.includes(exclusionKeyword.toLowerCase())) {
                isExclusionInQuery = true;
            }
        }
        if (!isExclusionInQuery) {
          return null;
        }
      }
    }

    const sellerReputation = browseItem.seller?.feedbackPercentage
      ? parseFloat(browseItem.seller.feedbackPercentage)
      : 0;

    if (sellerReputation < MIN_SELLER_REPUTATION_THRESHOLD) {
        return null;
    }


    let determinedItemType: 'deal' | 'auction' = itemTypeFromFilter;
    const hasAuction = browseItem.buyingOptions?.includes('AUCTION');
    const hasFixedPrice = browseItem.buyingOptions?.includes('FIXED_PRICE');

    if (itemTypeFromFilter === 'deal') {
      if (!hasFixedPrice) {
        return null;
      }
      determinedItemType = 'deal';
    } else if (itemTypeFromFilter === 'auction') {
      if (!hasAuction) {
        return null;
      }
      determinedItemType = 'auction';
    }

    if (!browseItem.price || typeof browseItem.price.value === 'undefined') {
      console.warn(`[eBay Transform] Item ${browseItem.itemId} ("${browseItem.title}") is missing price information. Skipping.`);
      return null;
    }
    const currentPriceValue = parseFloat(browseItem.price.value);


    const imageUrl = getHighResolutionImageUrl(browseItem.image?.imageUrl);


    let originalPriceValue: number | undefined = undefined;
    let discountPercentageValue: number | undefined = undefined;

    if (browseItem.marketingPrice) {
      if (browseItem.marketingPrice.originalPrice?.value) {
        originalPriceValue = parseFloat(browseItem.marketingPrice.originalPrice.value);
      }
      if (browseItem.marketingPrice.discountPercentage && parseFloat(browseItem.marketingPrice.discountPercentage) > 0) {
        discountPercentageValue = parseFloat(browseItem.marketingPrice.discountPercentage);
      }
    }

    if (discountPercentageValue === undefined && originalPriceValue !== undefined && currentPriceValue < originalPriceValue) {
      discountPercentageValue = calculateDiscountPercentage(currentPriceValue, originalPriceValue);
    }
    discountPercentageValue = discountPercentageValue || 0;

    if (determinedItemType === 'deal' && isGlobalCuratedRequestForTransform && discountPercentageValue < MIN_DEAL_DISCOUNT_THRESHOLD) {
       if (!originalPriceValue || originalPriceValue <= currentPriceValue) {
        return null;
       }
    }


    const description = browseItem.shortDescription || title;
    const itemLink = browseItem.itemAffiliateWebUrl || browseItem.itemWebUrl;

    const dealScopeItem: DealScopeItem = {
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
      conditionId: browseItem.conditionId,
      sellerFeedbackScore: browseItem.seller?.feedbackScore || 0,
    };

    if (dealScopeItem.type === 'auction') {
      dealScopeItem.endTime = browseItem.itemEndDate;
      dealScopeItem.timeLeft = formatTimeLeft(dealScopeItem.endTime);
      dealScopeItem.bidCount = browseItem.bidCount || 0;
    }

    return dealScopeItem;
  } catch (e) {
    console.error("[eBay Transform] Error transforming eBay Browse API item:", e, "Raw Item:", JSON.stringify(browseItem, null, 2));
    return null;
  }
}

export async function getRandomPopularSearchTerm(): Promise<string> {
  if (curatedHomepageSearchTerms.length === 0) {
    return "tech deals";
  }
  const randomIndex = Math.floor(Math.random() * curatedHomepageSearchTerms.length);
  return curatedHomepageSearchTerms[randomIndex];
}


export const fetchItems = async (
  type: 'deal' | 'auction',
  query: string,
  isGlobalCuratedRequest: boolean = false,
  offset: number = 0, // New parameter for pagination offset
  limit: number = API_FETCH_LIMIT // New parameter for pagination limit
): Promise<DealScopeItem[]> => {
  const keywordsForApi = query;
  const cacheKeySuffix = keywordsForApi;
  // Update cache key to include offset and limit for uniqueness
  const cacheKey = `browse:${type}:${cacheKeySuffix}:offset-${offset}:limit-${limit}`;
  const cacheTTL = isGlobalCuratedRequest ? GLOBAL_CURATED_CACHE_TTL_MS : STANDARD_CACHE_TTL_MS;

  if (fetchItemsCache.has(cacheKey)) {
    const cachedEntry = fetchItemsCache.get(cacheKey)!;
    if (Date.now() - cachedEntry.timestamp < cacheTTL) {
      return cachedEntry.data;
    } else {
      fetchItemsCache.delete(cacheKey);
    }
  }

  if (typeof keywordsForApi !== 'string' || keywordsForApi.trim() === '') {
    // For global curated requests with an empty query string (after initial load),
    // we might rely on the calling function (useItemPageLogic) to provide specific keywords.
    // This function itself won't try to paginate an "empty" query indefinitely.
    if (!isGlobalCuratedRequest) return [];
    // If it's a global curated request but the query is empty here, it implies the caller should handle keyword generation.
    // This scenario should be less common if useItemPageLogic feeds specific keywords for "load more" curated.
  }

  const authToken = await getEbayAuthToken();
  const browseApiUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  if (keywordsForApi.trim() !== '') { // Only append 'q' if keywords are provided
    browseApiUrl.searchParams.append('q', keywordsForApi);
  }


  browseApiUrl.searchParams.append('limit', limit.toString());
  browseApiUrl.searchParams.append('offset', offset.toString());

  let filterOptions: string[] = ['itemLocationCountry:GB'];
  let sortOption: string | null = null;

  if (type === 'auction') {
    filterOptions.push('buyingOptions:{AUCTION}');
    sortOption = 'endingSoonest'; // Auctions are typically sorted by ending soonest
  } else { // 'deal'
    filterOptions.push('buyingOptions:{FIXED_PRICE}');
    filterOptions.push('priceCurrency:GBP');
    filterOptions.push('conditionIds:{1000|2000|2500|3000}'); // New, Like New, Refurbished, Good
    if (isGlobalCuratedRequest || keywordsForApi.trim() === '') { // Broader price for general curated
      filterOptions.push('price:[20..]');
    } else { // Specific search might have lower priced items
      filterOptions.push('price:[1..]');
    }
    // For deals, explicit sort might not be needed if AI re-ranks, or could be 'priceAsc' for cheapest first.
    // Keeping it null for now to let eBay's relevance work, or AI handle final sort.
    sortOption = null;
  }

  if (sortOption) {
    browseApiUrl.searchParams.append('sort', sortOption);
  }
  const finalFilterString = filterOptions.join(',');
  browseApiUrl.searchParams.append('filter', finalFilterString);


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
        console.error(`[eBay Service] Response not valid JSON. Query: "${keywordsForApi}", Type: "${type}", Offset: ${offset}. URL: ${browseApiUrl.toString()}. Response (start): ${responseDataText.substring(0, 500)}`);
        throw new Error(`Failed to parse eBay API response. Start of response: ${responseDataText.substring(0, 200)}...`);
    }

    if (!response.ok) {
      if (data && data.itemSummaries === undefined && data.warnings && data.warnings.length > 0) {
         fetchItemsCache.set(cacheKey, { data: [], timestamp: Date.now() });
         return [];
      }
      throw new Error(`Failed to fetch from eBay Browse API (${response.status}). Query: "${keywordsForApi}", Offset: ${offset}. Response: ${JSON.stringify(data, null, 2).substring(0, 500)}`);
    }


    if (!data.itemSummaries || data.itemSummaries.length === 0) {
      fetchItemsCache.set(cacheKey, { data: [], timestamp: Date.now() });
      return [];
    }

    const browseItems: BrowseApiItemSummary[] = data.itemSummaries || [];
    let transformedItems = browseItems
      .map(browseItem => transformBrowseItem(browseItem, type, keywordsForApi, isGlobalCuratedRequest))
      .filter((item): item is DealScopeItem => item !== null);

    const finalItems = transformedItems.filter(item => item.type === type);
    fetchItemsCache.set(cacheKey, { data: finalItems, timestamp: Date.now() });
    return finalItems;

  } catch (error) {
    console.error(`[eBay Service] Error in fetchItems. Query: "${keywordsForApi}", Type: "${type}", Offset: ${offset}. URL: ${browseApiUrl.toString()}:`, error);
    if (error instanceof Error) {
        if (error.message.includes("eBay Browse API request failed") || error.message.includes("eBay OAuth request failed") || error.message.includes("Failed to authenticate with eBay API") || error.message.includes("Failed to fetch from eBay Browse API") || error.message.includes('Critical eBay API Authentication Failure')) {
             throw error;
        }
        throw new Error(`Failed to fetch eBay items: ${error.message}. Original error: ${error.constructor.name}`);
    }
    throw new Error(`Failed to fetch eBay items (unknown error): ${String(error)}.`);
  }
};
