
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

// Cache for fetchItems
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
      cache: 'no-store', // Ensure fresh token requests
    });

    if (!response.ok) {
      const errorBody = await response.text();
      // Log the specific error from eBay to the server console
      console.error(`eBay OAuth request failed with status ${response.status}: ${errorBody}`);
      // Throw a specific error that includes eBay's response
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
    // Log the detailed error to the server console
    console.error('Detailed error during eBay OAuth token fetch:', error);

    // If the error is already specific (e.g., from the !response.ok block), re-throw it.
    // Otherwise, throw a more general message encouraging checking logs and credentials.
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

const EBAY_SITE_ID = 'EBAY-GB'; // ebay.co.uk Site ID for UK is 3

interface EbayApiItem {
  itemId: string[];
  title: string[];
  galleryURL?: string[];
  pictureURLLarge?: string[]; // For higher definition images
  sellingStatus: {
    currentPrice: { _currencyId: string; __value__: string }[];
    bidCount?: string[];
  }[];
  listingInfo: {
    listingType: string[]; // "FixedPrice", "Auction", "AuctionWithBIN"
    buyItNowAvailable?: string[]; // "true" or "false"
    bestOfferEnabled?: string[];
    startTime?: string[];
    endTime?: string[];
    buyItNowPrice?: { _currencyId: string; __value__: string }[]; // For AuctionWithBIN
  }[];
  sellerInfo?: {
    sellerUserName?: string[];
    feedbackScore?: string[];
    positiveFeedbackPercent?: string[];
  }[];
  condition?: {
    conditionDisplayName?: string[];
  }[];
  primaryCategory?: {
    categoryName?: string[];
  }[];
  paymentMethod?: string[];
  viewItemURL?: string[];
  description?: string[]; // Full description
  discountPriceInfo?: {
    originalRetailPrice?: { _currencyId: string; __value__: string }[];
    pricingTreatment?: string[]; // e.g., "STP" (Strike-Through Price)
    soldOnEbay?: string; // Indicates if the item was sold on eBay as part of a promotion
    soldOffEbay?: string; // Indicates if the item was sold off eBay as part of a promotion
  }[];
}


function transformEbayItem(ebayItem: EbayApiItem, itemType: 'deal' | 'auction'): BayBotItem | null {
  try {
    const id = ebayItem.itemId[0];
    const title = ebayItem.title[0];
    // Prioritize pictureURLLarge for higher definition images
    const imageUrl = ebayItem.pictureURLLarge?.[0] || ebayItem.galleryURL?.[0] || 'https://placehold.co/600x400.png';
    
    const currentPriceValue = parseFloat(ebayItem.sellingStatus[0].currentPrice[0].__value__);
    
    let originalPriceValue: number | undefined = undefined;
    // Check discountPriceInfo for original retail price
    if (ebayItem.discountPriceInfo?.[0]?.originalRetailPrice?.[0]?.__value__) {
      originalPriceValue = parseFloat(ebayItem.discountPriceInfo[0].originalRetailPrice[0].__value__);
    } else if (itemType === 'deal' && ebayItem.listingInfo[0].listingType[0] === 'FixedPrice' && !ebayItem.discountPriceInfo) {
      // For fixed price items without explicit discount info, assume current price is original if no better info
      // This might not always be accurate but is a fallback.
      // originalPriceValue = currentPriceValue; // Commented out to avoid misrepresenting discounts
    }


    const discountPercentage = calculateDiscountPercentage(currentPriceValue, originalPriceValue);
    
    const sellerReputation = ebayItem.sellerInfo?.[0]?.positiveFeedbackPercent?.[0]
      ? parseFloat(ebayItem.sellerInfo[0].positiveFeedbackPercent[0])
      : 70; // Default reputation if not available

    const bayBotItem: BayBotItem = {
      id,
      type: itemType,
      title,
      // Use the actual item description if available, otherwise a generic one.
      description: ebayItem.description?.[0] || `View this item on eBay: ${ebayItem.viewItemURL?.[0] || title}`,
      imageUrl,
      price: currentPriceValue,
      originalPrice: originalPriceValue,
      discountPercentage,
      sellerReputation,
      'data-ai-hint': title.toLowerCase().split(' ').slice(0, 2).join(' '), // For placeholder image search
    };

    if (itemType === 'auction') {
      bayBotItem.endTime = ebayItem.listingInfo[0].endTime?.[0];
      bayBotItem.timeLeft = formatTimeLeft(bayBotItem.endTime);
      bayBotItem.bidCount = ebayItem.sellingStatus[0].bidCount?.[0] ? parseInt(ebayItem.sellingStatus[0].bidCount[0]) : 0;
    }

    return bayBotItem;
  } catch (e) {
    console.error("Error transforming eBay item:", e, "Raw eBay item:", JSON.stringify(ebayItem, null, 2));
    return null;
  }
}


export const fetchItems = async (
  type: 'deal' | 'auction',
  query?: string,
  isCuratedHomepageDeals: boolean = false // Parameter to indicate curated homepage request
): Promise<BayBotItem[]> => {
  const cacheKey = `${type}:${query || ''}:${isCuratedHomepageDeals}`;

  // Check cache first
  if (fetchItemsCache.has(cacheKey)) {
    const cachedEntry = fetchItemsCache.get(cacheKey)!;
    if (Date.now() - cachedEntry.timestamp < FETCH_ITEMS_CACHE_TTL_MS) {
      console.log(`[Cache HIT] Returning cached items for key: ${cacheKey}`);
      return cachedEntry.data;
    } else {
      // Cache expired
      fetchItemsCache.delete(cacheKey);
      console.log(`[Cache EXPIRED] Deleted cache for key: ${cacheKey}`);
    }
  }
  console.log(`[Cache MISS] Fetching items from API for key: ${cacheKey}`);

  const authToken = await getEbayAuthToken();
  const appId = process.env.EBAY_APP_ID; // Already checked in getEbayAuthToken

  if (!appId) {
    // This case should ideally be caught by getEbayAuthToken, but as a safeguard:
    throw new Error('eBay App ID not configured.');
  }

  let keywords = query || '';
  if (isCuratedHomepageDeals && !query) {
    keywords = "top deals"; // Generic term for curated deals if no specific query
  } else if (type === 'auction' && !query) {
    keywords = "collectible auction"; // Default for auctions if no query
  }
  // If query is provided, it's used directly.


  const findingApiUrl = new URL('https://svcs.ebay.com/services/search/FindingService/v1');
  findingApiUrl.searchParams.append('SERVICE-VERSION', '1.0.0');
  findingApiUrl.searchParams.append('SECURITY-APPNAME', appId); // eBay App ID (Client ID)
  findingApiUrl.searchParams.append('RESPONSE-DATA-FORMAT', 'JSON');
  findingApiUrl.searchParams.append('REST-PAYLOAD', '');
  findingApiUrl.searchParams.append('GLOBAL-ID', EBAY_SITE_ID); // For ebay.co.uk
  findingApiUrl.searchParams.append('siteid', '3'); // Numerical site ID for UK
  findingApiUrl.searchParams.append('keywords', keywords);
  
  // Requesting specific output selectors for more data
  findingApiUrl.searchParams.append('outputSelector(0)', 'PictureURLLarge'); // High-def images
  findingApiUrl.searchParams.append('outputSelector(1)', 'SellerInfo');
  findingApiUrl.searchParams.append('outputSelector(2)', 'Description'); // Full item description
  findingApiUrl.searchParams.append('outputSelector(3)', 'ItemSpecifics');
  findingApiUrl.searchParams.append('outputSelector(4)', 'GalleryInfo');
  findingApiUrl.searchParams.append('outputSelector(5)', 'DiscountPriceInfo'); // For original price and discounts


  if (type === 'deal') {
    findingApiUrl.searchParams.append('OPERATION-NAME', 'findItemsAdvanced');
    findingApiUrl.searchParams.append('itemFilter(0).name', 'ListingType');
    findingApiUrl.searchParams.append('itemFilter(0).value(0)', 'FixedPrice'); // "Buy It Now" deals
    // findingApiUrl.searchParams.append('itemFilter(0).value(1)', 'StoreInventory'); // Can also include store items
    findingApiUrl.searchParams.append('itemFilter(1).name', 'MinPrice');
    findingApiUrl.searchParams.append('itemFilter(1).value', '0.01'); // Ensure items have a price
    findingApiUrl.searchParams.append('itemFilter(2).name', 'HideDuplicateItems');
    findingApiUrl.searchParams.append('itemFilter(2).value', 'true');
    // For deals, especially curated, could sort by discount or popularity if API supports directly.
    // PricePlusShippingLowest is a common default for deals.
    // Let AI ranker handle smart sorting, but API sort can be a pre-filter.
    findingApiUrl.searchParams.append('sortOrder', 'PricePlusShippingLowest'); 
  } else { // auction
    findingApiUrl.searchParams.append('OPERATION-NAME', 'findItemsAdvanced'); // Can use findItemsAdvanced for auctions too
    findingApiUrl.searchParams.append('itemFilter(0).name', 'ListingType');
    findingApiUrl.searchParams.append('itemFilter(0).value(0)', 'Auction'); // Only auctions
    // findingApiUrl.searchParams.append('itemFilter(0).value(1)', 'AuctionWithBIN'); // Optionally include auctions with Buy It Now
    findingApiUrl.searchParams.append('itemFilter(1).name', 'MinPrice');
    findingApiUrl.searchParams.append('itemFilter(1).value', '0.01');
    findingApiUrl.searchParams.append('itemFilter(2).name', 'HideDuplicateItems');
    findingApiUrl.searchParams.append('itemFilter(2).value', 'true');
    findingApiUrl.searchParams.append('sortOrder', 'EndTimeSoonest');
  }
  findingApiUrl.searchParams.append('paginationInput.entriesPerPage', '20'); // Fetch a decent number of items for AI ranking / display

  try {
    const response = await fetch(findingApiUrl.toString(), { cache: 'no-store' }); // No caching for dynamic search results
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`eBay Finding API request failed: ${response.status} for query "${keywords}", type "${type}". Body: ${errorBody}`);
      // Attempt to cache the error as an empty array to prevent immediate retries for this specific query
      // Note: This means a temporary API issue might lead to empty results being cached for TTL.
      fetchItemsCache.set(cacheKey, { data: [], timestamp: Date.now() });
      console.log(`[Cache SET] Cached empty error response for key: ${cacheKey}`);
      throw new Error(`eBay API request failed: ${response.status}. Check server logs for details.`);
    }

    const data = await response.json();
    
    // Determine the correct response key (e.g., findItemsAdvancedResponse or findItemsByKeywordsResponse)
    const operationResponseKey = Object.keys(data)[0]; 
    if (!data[operationResponseKey] || 
        !data[operationResponseKey][0] || 
        !data[operationResponseKey][0].searchResult || 
        !data[operationResponseKey][0].searchResult[0] || 
        !data[operationResponseKey][0].searchResult[0].item) {
      console.warn('No items found or unexpected API response structure from eBay for query:', keywords, 'type:', type, 'Data:', JSON.stringify(data, null, 2));
      fetchItemsCache.set(cacheKey, { data: [], timestamp: Date.now() }); // Cache empty result
      console.log(`[Cache SET] Cached empty result (no items) for key: ${cacheKey}`);
      return [];
    }
    
    const ebayItems: EbayApiItem[] = data[operationResponseKey][0].searchResult[0].item || [];
    
    const transformedItems = ebayItems
      .map(ebayItem => transformEbayItem(ebayItem, type))
      .filter((item): item is BayBotItem => item !== null); // Filter out any nulls from transformation errors

    // Cache the successful result
    fetchItemsCache.set(cacheKey, { data: transformedItems, timestamp: Date.now() });
    console.log(`[Cache SET] Cached items for key: ${cacheKey}`);
    
    // Initial sort for deals by highest discount percentage if it's a 'deal' type,
    // AI ranking will further refine this.
    if (type === 'deal') {
        return transformedItems.sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
    }
    
    return transformedItems; // Auctions are already sorted by EndTimeSoonest from API

  } catch (error) {
    console.error('Error fetching or processing eBay items for query:', keywords, 'type:', type, error);
    // In case of error, return an empty array to prevent app crash
    // The cache might already be set to an empty array if the error was response.ok=false
    if (!fetchItemsCache.has(cacheKey)) {
      fetchItemsCache.set(cacheKey, { data: [], timestamp: Date.now() });
      console.log(`[Cache SET] Cached empty result (exception) for key: ${cacheKey}`);
    }
    return []; 
  }
};

// This function is still used by the clickable logo in AppHeader
export async function getRandomPopularSearchTerm(): Promise<string> {
  if (popularSearchTermsForLogoClick.length === 0) return "tech deals"; // Fallback
  return popularSearchTermsForLogoClick[Math.floor(Math.random() * popularSearchTermsForLogoClick.length)];
}
