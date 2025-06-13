
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

async function getEbayAuthToken(): Promise<string> {
  if (ebayToken && Date.now() < ebayToken.fetched_at + (ebayToken.expires_in - 300) * 1000) {
    return ebayToken.access_token;
  }

  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;

  if (!appId || !certId) {
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
      throw new Error(`eBay OAuth request failed with status ${response.status}: ${errorBody}`);
    }

    const tokenData = await response.json();
    ebayToken = { ...tokenData, fetched_at: Date.now() };
    return ebayToken!.access_token;
  } catch (error) {
    console.error('Error fetching eBay OAuth token:', error);
    throw new Error('Failed to authenticate with eBay API.');
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

const EBAY_SITE_ID = 'EBAY-GB'; // ebay.co.uk

interface EbayApiItem {
  itemId: string[];
  title: string[];
  galleryURL?: string[];
  pictureURLLarge?: string[];
  sellingStatus: {
    currentPrice: { _currencyId: string; __value__: string }[];
    bidCount?: string[];
  }[];
  listingInfo: {
    listingType: string[];
    buyItNowAvailable?: string[];
    bestOfferEnabled?: string[];
    startTime?: string[];
    endTime?: string[];
    buyItNowPrice?: { _currencyId: string; __value__: string }[];
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
  description?: string[];
  discountPriceInfo?: {
    originalRetailPrice?: { _currencyId: string; __value__: string }[];
    pricingTreatment?: string[];
  }[];
}


function transformEbayItem(ebayItem: EbayApiItem, itemType: 'deal' | 'auction'): BayBotItem | null {
  try {
    const id = ebayItem.itemId[0];
    const title = ebayItem.title[0];
    const imageUrl = ebayItem.pictureURLLarge?.[0] || ebayItem.galleryURL?.[0] || 'https://placehold.co/600x400.png';
    
    const currentPriceValue = parseFloat(ebayItem.sellingStatus[0].currentPrice[0].__value__);
    
    let originalPriceValue: number | undefined = undefined;
    if (ebayItem.discountPriceInfo?.[0]?.originalRetailPrice?.[0]?.__value__) {
      originalPriceValue = parseFloat(ebayItem.discountPriceInfo[0].originalRetailPrice[0].__value__);
    }


    const discountPercentage = calculateDiscountPercentage(currentPriceValue, originalPriceValue);
    
    const sellerReputation = ebayItem.sellerInfo?.[0]?.positiveFeedbackPercent?.[0]
      ? parseFloat(ebayItem.sellerInfo[0].positiveFeedbackPercent[0])
      : 70;

    const bayBotItem: BayBotItem = {
      id,
      type: itemType,
      title,
      description: `View this item on eBay: ${ebayItem.viewItemURL?.[0] || title}`, 
      imageUrl,
      price: currentPriceValue,
      originalPrice: originalPriceValue,
      discountPercentage,
      sellerReputation,
      'data-ai-hint': title.toLowerCase().split(' ').slice(0, 2).join(' '),
    };

    if (itemType === 'auction') {
      bayBotItem.endTime = ebayItem.listingInfo[0].endTime?.[0];
      bayBotItem.timeLeft = formatTimeLeft(bayBotItem.endTime);
      bayBotItem.bidCount = ebayItem.sellingStatus[0].bidCount?.[0] ? parseInt(ebayItem.sellingStatus[0].bidCount[0]) : 0;
    }

    return bayBotItem;
  } catch (e) {
    console.error("Error transforming eBay item:", e, ebayItem);
    return null;
  }
}


export const fetchItems = async (
  type: 'deal' | 'auction',
  query?: string,
  isCuratedHomepageDeals: boolean = false
): Promise<BayBotItem[]> => {
  const authToken = await getEbayAuthToken();
  const appId = process.env.EBAY_APP_ID;

  if (!appId) {
    throw new Error('eBay App ID not configured.');
  }

  let keywords = query || '';
  if (isCuratedHomepageDeals && !query) {
    keywords = "deals"; 
  } else if (type === 'auction' && !query) {
    keywords = "collectible auction"; 
  }


  const findingApiUrl = new URL('https://svcs.ebay.com/services/search/FindingService/v1');
  findingApiUrl.searchParams.append('SERVICE-VERSION', '1.0.0');
  findingApiUrl.searchParams.append('SECURITY-APPNAME', appId);
  findingApiUrl.searchParams.append('RESPONSE-DATA-FORMAT', 'JSON');
  findingApiUrl.searchParams.append('REST-PAYLOAD', '');
  findingApiUrl.searchParams.append('GLOBAL-ID', EBAY_SITE_ID);
  findingApiUrl.searchParams.append('siteid', '3'); 
  findingApiUrl.searchParams.append('keywords', keywords);
  findingApiUrl.searchParams.append('outputSelector(0)', 'PictureURLLarge');
  findingApiUrl.searchParams.append('outputSelector(1)', 'SellerInfo');
  findingApiUrl.searchParams.append('outputSelector(2)', 'Description'); // Requesting full description
  findingApiUrl.searchParams.append('outputSelector(3)', 'ItemSpecifics');
  findingApiUrl.searchParams.append('outputSelector(4)', 'GalleryInfo');
  findingApiUrl.searchParams.append('outputSelector(5)', 'DiscountPriceInfo'); // Ensure this is requested


  if (type === 'deal') {
    findingApiUrl.searchParams.append('OPERATION-NAME', 'findItemsAdvanced');
    findingApiUrl.searchParams.append('itemFilter(0).name', 'ListingType');
    findingApiUrl.searchParams.append('itemFilter(0).value(0)', 'FixedPrice'); 
    findingApiUrl.searchParams.append('itemFilter(1).name', 'MinPrice');
    findingApiUrl.searchParams.append('itemFilter(1).value', '0.01'); // Ensure items have a price
    findingApiUrl.searchParams.append('itemFilter(2).name', 'HideDuplicateItems');
    findingApiUrl.searchParams.append('itemFilter(2).value', 'true');
    findingApiUrl.searchParams.append('sortOrder', 'PricePlusShippingLowest'); // Start with a sensible sort for deals
  } else { // auction
    findingApiUrl.searchParams.append('OPERATION-NAME', 'findItemsAdvanced');
    findingApiUrl.searchParams.append('itemFilter(0).name', 'ListingType');
    findingApiUrl.searchParams.append('itemFilter(0).value(0)', 'Auction');
    findingApiUrl.searchParams.append('itemFilter(1).name', 'MinPrice');
    findingApiUrl.searchParams.append('itemFilter(1).value', '0.01');
    findingApiUrl.searchParams.append('itemFilter(2).name', 'HideDuplicateItems');
    findingApiUrl.searchParams.append('itemFilter(2).value', 'true');
    findingApiUrl.searchParams.append('sortOrder', 'EndTimeSoonest');
  }
  findingApiUrl.searchParams.append('paginationInput.entriesPerPage', '20');

  try {
    const response = await fetch(findingApiUrl.toString(), { cache: 'no-store' });
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`eBay Finding API request failed: ${response.status}`, errorBody);
      throw new Error(`eBay API request failed: ${response.status}`);
    }

    const data = await response.json();
    
    const operationResponseKey = Object.keys(data)[0]; // e.g., findItemsAdvancedResponse or findItemsByKeywordsResponse
    if (!data[operationResponseKey] || !data[operationResponseKey][0].searchResult || !data[operationResponseKey][0].searchResult[0].item) {
      console.warn('No items found or unexpected API response structure from eBay for query:', query, 'type:', type, 'data:', JSON.stringify(data, null, 2));
      return [];
    }
    
    const ebayItems: EbayApiItem[] = data[operationResponseKey][0].searchResult[0].item || [];
    
    const transformedItems = ebayItems
      .map(ebayItem => transformEbayItem(ebayItem, type))
      .filter((item): item is BayBotItem => item !== null);

    if (type === 'deal') {
        return transformedItems.sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
    }
    
    return transformedItems;

  } catch (error) {
    console.error('Error fetching or processing eBay items:', error);
    return []; 
  }
};

// This function is still used by the clickable logo in AppHeader
export async function getRandomPopularSearchTerm(): Promise<string> {
  if (popularSearchTermsForLogoClick.length === 0) return "tech deals"; // Fallback
  return popularSearchTermsForLogoClick[Math.floor(Math.random() * popularSearchTermsForLogoClick.length)];
}
