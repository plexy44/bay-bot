
'use client';

import type React from 'react';
import { useState, useEffect, useCallback }
  from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { DealScopeItem } from '@/types';
import { fetchItems, getRandomPopularSearchTerm } from '@/services/ebay-api-service';
import { rankDeals as rankDealsAI } from '@/ai/flows/rank-deals';
import { qualifyAuctions as qualifyAuctionsAI } from '@/ai/flows/qualify-auctions';
import { useToast } from "@/hooks/use-toast";

import {
  MIN_DESIRED_CURATED_ITEMS,
  MAX_CURATED_FETCH_ATTEMPTS,
  MIN_AI_QUALIFIED_ITEMS_THRESHOLD,
  CURATED_DEALS_CACHE_KEY,
  CURATED_AUCTIONS_CACHE_KEY,
  MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS,
  KEYWORDS_PER_BATCH_INITIAL_DEALS,
  TARGET_RAW_ITEMS_FACTOR_FOR_AI,
  GLOBAL_CURATED_CACHE_TTL_MS,
  STANDARD_CACHE_TTL_MS,
  KEYWORDS_FOR_PROACTIVE_BACKGROUND_CACHE,
  SEARCHED_DEALS_CACHE_KEY_PREFIX,
  SEARCHED_AUCTIONS_CACHE_KEY_PREFIX,
  curatedHomepageSearchTerms,
  API_FETCH_LIMIT, // Used for number of items to fetch per backend call
} from '@/lib/constants';


type ItemType = 'deal' | 'auction';

export function useItemPageLogic(itemType: ItemType) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentQueryFromUrl = searchParams.get('q') || '';

  const [inputValue, setInputValue] = useState(currentQueryFromUrl);
  const [allItems, setAllItems] = useState<DealScopeItem[]>([]);
  const [displayedItems, setDisplayedItems] = useState<DealScopeItem[]>([]); // Will be allItems directly

  const [isLoading, setIsLoading] = useState(true); // For initial page load or new search
  const [isRanking, setIsRanking] = useState(false); // For AI processing phase
  const [isLoadingMore, setIsLoadingMore] = useState(false); // For "Load More" button clicks
  const [hasMoreBackendItems, setHasMoreBackendItems] = useState(true); // If backend might have more items
  const [currentApiOffset, setCurrentApiOffset] = useState(0); // Tracks offset for current query

  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);

  const [selectedItemForAnalysis, setSelectedItemForAnalysis] = useState<DealScopeItem | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

  const { toast } = useToast();

  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  // const [topUpAttempted, setTopUpAttempted] = useState(false); // Top-up effect disabled for now
  const [backgroundCacheAttempted, setBackgroundCacheAttempted] = useState(false);
  const [proactiveSearchCacheAttempted, setProactiveSearchCacheAttempted] = useState(false);
  // const [loadedFromCacheTimestamp, setLoadedFromCacheTimestamp] = useState<number | null>(null); // May not be needed with new load more

  const CURATED_CACHE_KEY = itemType === 'deal' ? CURATED_DEALS_CACHE_KEY : CURATED_AUCTIONS_CACHE_KEY;
  const OTHER_ITEM_TYPE_CURATED_CACHE_KEY = itemType === 'deal' ? CURATED_AUCTIONS_CACHE_KEY : CURATED_DEALS_CACHE_KEY;
  const SEARCHED_CACHE_KEY_PREFIX = itemType === 'deal' ? SEARCHED_DEALS_CACHE_KEY_PREFIX : SEARCHED_AUCTIONS_CACHE_KEY_PREFIX;
  const OTHER_ITEM_TYPE_SEARCHED_CACHE_KEY_PREFIX = itemType === 'deal' ? SEARCHED_AUCTIONS_CACHE_KEY_PREFIX : SEARCHED_DEALS_CACHE_KEY_PREFIX;
  const otherItemType = itemType === 'deal' ? 'auction' : 'deal';
  const pagePath = itemType === 'deal' ? '/' : '/auctions';

  const aiRankOrQualifyItems = itemType === 'deal' ? rankDealsAI : qualifyAuctionsAI;
  const aiOtherTypeBackgroundCacheQuery = itemType === 'deal'
    ? "general curated auctions background cache from deals"
    : "general curated deals background cache from auctions";


  const loadItems = useCallback(async (queryToLoad: string, isNewQueryLoad: boolean) => {
    const isGlobalCuratedRequest = queryToLoad === '';
    let overallToastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;
    
    if (isNewQueryLoad) {
      setAllItems([]);
      setCurrentApiOffset(0);
      setHasMoreBackendItems(true);
      setIsLoading(true);
      setError(null);
      setIsAuthError(false);
      setInitialLoadComplete(false); // Reset for new queries
    } else { // Load More
      if (isLoading || isLoadingMore || !hasMoreBackendItems) return;
      setIsLoadingMore(true);
    }
    setIsRanking(false); // Reset ranking state for new fetch operation

    const currentCacheKey = isGlobalCuratedRequest ? CURATED_CACHE_KEY : SEARCHED_CACHE_KEY_PREFIX + queryToLoad;
    const effectiveOffset = isNewQueryLoad ? 0 : currentApiOffset;

    let fetchedItemsFromServer: DealScopeItem[] = [];
    let processedBatchForState: DealScopeItem[] = [];

    try {
      // Cache check for initial load only
      if (isNewQueryLoad) {
        const cachedDataString = sessionStorage.getItem(currentCacheKey);
        if (cachedDataString) {
          const cachedData = JSON.parse(cachedDataString);
          const cacheTTL = isGlobalCuratedRequest ? GLOBAL_CURATED_CACHE_TTL_MS : STANDARD_CACHE_TTL_MS;
          if (cachedData && cachedData.items && Array.isArray(cachedData.items) && (Date.now() - (cachedData.timestamp || 0) < cacheTTL)) {
            let itemsFromCache = (cachedData.items as DealScopeItem[]);
            if (itemType === 'auction') {
              itemsFromCache = itemsFromCache.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
            }
            if (itemsFromCache.length > 0) {
              setAllItems(itemsFromCache);
              setCurrentApiOffset(itemsFromCache.length); // Assume cache represents a full "page" or more
              setHasMoreBackendItems(itemsFromCache.length >= API_FETCH_LIMIT); // Heuristic
              setIsLoading(false);
              setInitialLoadComplete(true);
              setTimeout(() => toast({ title: `Loaded Cached ${isGlobalCuratedRequest ? "Curated" : "Searched"} ${itemType === 'deal' ? 'Deals' : 'Auctions'}`, description: `Displaying previously fetched ${itemType === 'auction' ? 'active ' : ''}${itemType === 'deal' ? 'deals' : 'auctions'}${isGlobalCuratedRequest ? "" : ` for "${queryToLoad}"`}.` }),0);
              return; // Loaded from cache, skip API call
            } else {
              sessionStorage.removeItem(currentCacheKey);
            }
          } else {
            sessionStorage.removeItem(currentCacheKey);
          }
        }
      }

      // API Fetching logic
      if (isGlobalCuratedRequest) {
        // Initial Curated Load (isNewQueryLoad = true) OR Load More Curated (isNewQueryLoad = false)
        setIsRanking(true);
        let accumulatedRawEbayItems: DealScopeItem[] = [];
        const attemptedKeywords = new Set<string>();
        const numKeywordsToFetch = isNewQueryLoad ? MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS : MAX_CURATED_FETCH_ATTEMPTS;
        const itemsToAimFor = isNewQueryLoad ? (MIN_DESIRED_CURATED_ITEMS * TARGET_RAW_ITEMS_FACTOR_FOR_AI) : API_FETCH_LIMIT;

        let currentBatchNumber = 0;
        while (accumulatedRawEbayItems.length < itemsToAimFor && attemptedKeywords.size < numKeywordsToFetch * KEYWORDS_PER_BATCH_INITIAL_DEALS ) {
            currentBatchNumber++;
            const keywordsForThisBatch: string[] = [];
            let uniqueKeywordSafety = 0;
            const keywordsPerBatch = isNewQueryLoad ? KEYWORDS_PER_BATCH_INITIAL_DEALS : 1; // Fewer keywords for "load more" curated to be quicker
            while (keywordsForThisBatch.length < keywordsPerBatch && uniqueKeywordSafety < (curatedHomepageSearchTerms.length + 10) && (attemptedKeywords.size < numKeywordsToFetch * KEYWORDS_PER_BATCH_INITIAL_DEALS)) {
                const randomKw = await getRandomPopularSearchTerm();
                if (randomKw && randomKw.trim() !== '' && !attemptedKeywords.has(randomKw) && !keywordsForThisBatch.includes(randomKw)) {
                    keywordsForThisBatch.push(randomKw);
                }
                uniqueKeywordSafety++;
            }
            if (keywordsForThisBatch.length === 0) break;
            keywordsForThisBatch.forEach(kw => attemptedKeywords.add(kw));

            const fetchedBatchesPromises = keywordsForThisBatch.map(kw => fetchItems(itemType, kw, true, 0, API_FETCH_LIMIT)); // offset 0 for each new keyword
            const fetchedBatchesResults = await Promise.allSettled(fetchedBatchesPromises);
            const newlyFetchedItemsInBatch = fetchedBatchesResults
                .filter(result => result.status === 'fulfilled')
                .flatMap(result => (result as PromiseFulfilledResult<DealScopeItem[]>).value);
            
            const currentAccumulatedIds = new Set(accumulatedRawEbayItems.map(item => item.id));
            const uniqueNewItemsForAccumulation = newlyFetchedItemsInBatch.filter(item => !currentAccumulatedIds.has(item.id));
            accumulatedRawEbayItems.push(...uniqueNewItemsForAccumulation);
            fetchedItemsFromServer.push(...uniqueNewItemsForAccumulation); // Store raw items for hasMoreBackendItems check

            if (attemptedKeywords.size >= numKeywordsToFetch * KEYWORDS_PER_BATCH_INITIAL_DEALS && !isNewQueryLoad) break; // For load more, one batch of keywords is enough
            if (isNewQueryLoad && attemptedKeywords.size >= MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS) break;
        }
        
        if (accumulatedRawEbayItems.length > 0) {
            const aiQualifiedAndRankedItems: DealScopeItem[] = await aiRankOrQualifyItems(accumulatedRawEbayItems, `general curated ${itemType} ${isNewQueryLoad ? 'initial' : 'more'}`);
            processedBatchForState = aiQualifiedAndRankedItems;
            if (isNewQueryLoad) {
                overallToastMessage = { title: `Curated ${itemType === 'deal' ? 'Deals' : 'Auctions'}: AI Qualified`, description: `Displaying ${aiQualifiedAndRankedItems.length} AI-qualified ${itemType}.` };
            } else {
                overallToastMessage = { title: `More Curated ${itemType === 'deal' ? 'Deals' : 'Auctions'}`, description: `Added ${aiQualifiedAndRankedItems.length} more AI-qualified ${itemType}.` };
            }
        } else {
             overallToastMessage = { title: `No More Curated ${itemType === 'deal' ? 'Deals' : 'Auctions'}`, description: `Could not find more ${itemType} matching criteria.` };
        }
        setIsRanking(false);

      } else { // Searched request (not global curated)
        fetchedItemsFromServer = await fetchItems(itemType, queryToLoad, false, effectiveOffset, API_FETCH_LIMIT);
        let activeFetchedItems = fetchedItemsFromServer;
        if (itemType === 'auction') {
          activeFetchedItems = fetchedItemsFromServer.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
        }

        if (activeFetchedItems.length > 0) {
          setIsRanking(true);
          const aiProcessedItems = await aiRankOrQualifyItems(activeFetchedItems, queryToLoad);
          setIsRanking(false);
          processedBatchForState = aiProcessedItems;
          // Toast messages for searched items
          if (isNewQueryLoad) {
            overallToastMessage = { title: `${itemType === 'deal' ? 'Deals' : 'Auctions'} for "${queryToLoad}"`, description: `Found ${aiProcessedItems.length} AI-qualified ${itemType}.` };
          } else {
            overallToastMessage = { title: `More ${itemType === 'deal' ? 'Deals' : 'Auctions'} for "${queryToLoad}"`, description: `Loaded ${aiProcessedItems.length} more AI-qualified ${itemType}.` };
          }
        } else {
            if (isNewQueryLoad) {
                 overallToastMessage = { title: `No ${itemType === 'deal' ? 'Deals' : 'Auctions'} Found`, description: `No ${itemType === 'auction' ? 'active ' : ''}${itemType} found for "${queryToLoad}".` };
            } else {
                 overallToastMessage = { title: `No More ${itemType === 'deal' ? 'Deals' : 'Auctions'}`, description: `No more ${itemType} found for "${queryToLoad}".` };
            }
        }
      }
    } catch (e: any) {
      let displayMessage = `Failed to load ${itemType}. Please try again.`;
      if (typeof e.message === 'string') {
        if (e.message.includes("invalid_client") || e.message.includes("Critical eBay API Authentication Failure")) {
          displayMessage = "Critical eBay API Authentication Failure. Check .env and server logs."; setIsAuthError(true);
        } else if (e.message.includes("OAuth") || e.message.includes("authenticate with eBay API")) {
          displayMessage = "eBay API Authentication Failed. Check credentials and server logs."; setIsAuthError(true);
        } else if (e.message.includes("Failed to fetch from eBay Browse API") || e.message.includes("Failed to fetch eBay items")) {
          displayMessage = `Error fetching from eBay. Check query or eBay status. Server logs may have details.`;
        } else { displayMessage = e.message; }
      }
      setError(displayMessage);
      processedBatchForState = [];
      fetchedItemsFromServer = []; // Ensure this is also empty on error for hasMoreBackendItems logic
    }

    setAllItems(prev => isNewQueryLoad ? [...processedBatchForState] : [...prev, ...processedBatchForState]);
    // For global curated "load more", fetchedItemsFromServer is the sum of new keyword fetches.
    // For specific query "load more", it's the direct result of a paginated fetch.
    setHasMoreBackendItems(fetchedItemsFromServer.length >= API_FETCH_LIMIT);
    setCurrentApiOffset(prevOffset => isNewQueryLoad ? processedBatchForState.length : prevOffset + processedBatchForState.length);
    
    if (isNewQueryLoad) {
        setIsLoading(false);
        setInitialLoadComplete(true);
        if (!error && processedBatchForState.length > 0) {
            try {
                sessionStorage.setItem(currentCacheKey, JSON.stringify({ items: processedBatchForState, timestamp: Date.now() }));
            } catch (e) {
                console.warn(`[useItemPageLogic loadItems] Error saving to sessionStorage for key "${currentCacheKey}":`, e);
            }
        }
    } else {
        setIsLoadingMore(false);
        // Update cache with appended list if items were added
        if (!error && processedBatchForState.length > 0) {
             try {
                const updatedAllItemsForCache = isNewQueryLoad ? processedBatchForState : [...allItems, ...processedBatchForState];
                sessionStorage.setItem(currentCacheKey, JSON.stringify({ items: updatedAllItemsForCache, timestamp: Date.now() }));
            } catch (e) {
                console.warn(`[useItemPageLogic loadItems] Error updating sessionStorage for key "${currentCacheKey}" after load more:`, e);
            }
        }
    }
    
    if (overallToastMessage && !error) {
        setTimeout(() => toast(overallToastMessage), 0);
    } else if (error && !isAuthError && (isNewQueryLoad || isLoadingMore)) { // Only show error toast if it was a user-initiated action
        setTimeout(() => toast({ title: `Error Loading ${itemType === 'deal' ? 'Deals' : 'Auctions'}`, description: error || "An unexpected error occurred.", variant: "destructive" }), 0);
    }

  }, [
    itemType,
    isLoading, // to prevent re-triggering load more while initial load is happening
    isLoadingMore, // to prevent multiple load more calls
    hasMoreBackendItems, // to prevent load more if no more items
    currentApiOffset, // to fetch next page
    aiRankOrQualifyItems,
    CURATED_CACHE_KEY,
    SEARCHED_CACHE_KEY_PREFIX,
    GLOBAL_CURATED_CACHE_TTL_MS,
    STANDARD_CACHE_TTL_MS,
    toast, // Stable from useToast
    allItems, // For appending in "load more" and updating cache
    // Note: fetchItems, getRandomPopularSearchTerm are stable imports
    // State setters are stable
  ]);


  useEffect(() => {
    setInputValue(currentQueryFromUrl);
    // setInitialLoadComplete(false); // Moved to loadItems
    // setTopUpAttempted(false); // Top-up disabled
    setBackgroundCacheAttempted(false);
    setProactiveSearchCacheAttempted(false);
    // setLoadedFromCacheTimestamp(null); // Not used in this way anymore
    loadItems(currentQueryFromUrl, true); // true for new query load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQueryFromUrl, itemType]); // loadItems is memoized, add it if ESLint insists but carefully check its own deps

  // Fallback Background cache for OTHER item type (can largely remain as is)
  useEffect(() => {
    let isMounted = true;
    const performBackgroundCache = async () => {
      const isGlobalCuratedView = !currentQueryFromUrl;
      if (!(isGlobalCuratedView && initialLoadComplete && !backgroundCacheAttempted && !isLoading && !isRanking && !error && !isAuthError)) {
        return;
      }

      if (!isMounted) return;
      setBackgroundCacheAttempted(true);

      try {
          const cachedOtherType = sessionStorage.getItem(OTHER_ITEM_TYPE_CURATED_CACHE_KEY);
          if (cachedOtherType) {
              const parsed = JSON.parse(cachedOtherType);
               if (parsed.items && parsed.timestamp && (Date.now() - parsed.timestamp < GLOBAL_CURATED_CACHE_TTL_MS)) {
                  return;
              }
          }
          const keywordsForBgCache: string[] = [];
          let uniqueKwSafety = 0; const attemptedKwsBg = new Set<string>();
          while(keywordsForBgCache.length < KEYWORDS_FOR_PROACTIVE_BACKGROUND_CACHE && uniqueKwSafety < (curatedHomepageSearchTerms.length + 5)) {
               const rKw = await getRandomPopularSearchTerm();
               if(rKw && rKw.trim() !== '' && !attemptedKwsBg.has(rKw)) { keywordsForBgCache.push(rKw); attemptedKwsBg.add(rKw); }
               uniqueKwSafety++;
          }
          if (keywordsForBgCache.length === 0) return;

          const batchesPromises = keywordsForBgCache.map(kw => fetchItems(otherItemType, kw, true, 0, API_FETCH_LIMIT));
          const batchesResults = await Promise.allSettled(batchesPromises);
          const successfulFetches = batchesResults.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<DealScopeItem[]>).value);
          const consolidatedItems = successfulFetches.flat();
          const uniqueItemsMap = new Map(consolidatedItems.map(i => [i.id, i]));
          let uniqueItems = Array.from(uniqueItemsMap.values());
          if (otherItemType === 'auction') {
              uniqueItems = uniqueItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
          }

          if (uniqueItems.length > 0) {
              const aiProcessedItems = await (otherItemType === 'deal' ? rankDealsAI(uniqueItems, aiOtherTypeBackgroundCacheQuery) : qualifyAuctionsAI(uniqueItems, aiOtherTypeBackgroundCacheQuery));
              if (isMounted) {
                sessionStorage.setItem(OTHER_ITEM_TYPE_CURATED_CACHE_KEY, JSON.stringify({ items: aiProcessedItems, timestamp: Date.now() }));
              }
          }
      } catch (e: any) {
          console.warn(`[useItemPageLogic BG Cache] Error during proactive GLOBAL CURATED ${otherItemType} caching:`, e.message);
      }
    };

    if(initialLoadComplete && !currentQueryFromUrl) { // Only run for global curated view after initial load
        performBackgroundCache();
    }
    return () => {
      isMounted = false;
    };
  }, [
    initialLoadComplete, backgroundCacheAttempted, isLoading, isRanking, error, currentQueryFromUrl, isAuthError, itemType,
    OTHER_ITEM_TYPE_CURATED_CACHE_KEY, otherItemType, aiOtherTypeBackgroundCacheQuery,
  ]);

  // Proactive search cache for OTHER item type (can largely remain as is)
  useEffect(() => {
    let isMounted = true;
    const performProactiveSearchCache = async () => {
      const query = currentQueryFromUrl;
      if (!(query && initialLoadComplete && !proactiveSearchCacheAttempted && !isLoading && !isRanking && !error && !isAuthError)) {
        return;
      }

      if(!isMounted) return;
      setProactiveSearchCacheAttempted(true);

      try {
        const searchedOtherTypeCacheKey = OTHER_ITEM_TYPE_SEARCHED_CACHE_KEY_PREFIX + query;
        const cachedDataString = sessionStorage.getItem(searchedOtherTypeCacheKey);
        if (cachedDataString) {
          const cachedData = JSON.parse(cachedDataString);
          if (cachedData && cachedData.items && (Date.now() - (cachedData.timestamp || 0) < STANDARD_CACHE_TTL_MS)) {
            return;
          }
        }

        const fetchedOtherTypeItems = await fetchItems(otherItemType, query, false, 0, API_FETCH_LIMIT);
        if (fetchedOtherTypeItems.length > 0) {
           let activeFetchedItems = fetchedOtherTypeItems;
           if (otherItemType === 'auction') {
              activeFetchedItems = fetchedOtherTypeItems.filter(i => i.type === 'auction' && i.endTime ? new Date(i.endTime).getTime() > Date.now() : false);
           }
           if (activeFetchedItems.length > 0) {
              const aiProcessedItems = await (otherItemType === 'deal' ? rankDealsAI(activeFetchedItems, query) : qualifyAuctionsAI(activeFetchedItems, query));
              if (isMounted) {
                sessionStorage.setItem(searchedOtherTypeCacheKey, JSON.stringify({ items: aiProcessedItems, timestamp: Date.now() }));
              }
           }
        }
      } catch (e: any) {
        console.warn(`[useItemPageLogic Proactive Search Cache] Error during proactive SEARCHED ${otherItemType} caching for query "${query}":`, e.message);
      }
    };
    if(initialLoadComplete && currentQueryFromUrl) { // Only run for searched view after initial load
        performProactiveSearchCache();
    }
    return () => {
      isMounted = false;
    };
  }, [
    currentQueryFromUrl, initialLoadComplete, proactiveSearchCacheAttempted, isLoading, isRanking, error, isAuthError, itemType,
    OTHER_ITEM_TYPE_SEARCHED_CACHE_KEY_PREFIX, otherItemType,
  ]);


  const handleSearchSubmit = useCallback((query: string) => {
    const newPath = query ? `${pagePath}?q=${encodeURIComponent(query)}` : pagePath;
    router.push(newPath);
  }, [router, pagePath]);

  const handleLogoClick = useCallback(async () => {
    setInputValue(''); // Reset input field
    // Navigating to base path will trigger the useEffect for loadItems with new query
    const basePagePath = itemType === 'deal' ? '/' : '/auctions';
    if (currentQueryFromUrl === '' && router.pathname === basePagePath) {
      // Already on curated view, force reload by resetting states and calling loadItems
      loadItems('', true);
    } else {
      router.push(basePagePath);
    }
  }, [router, itemType, currentQueryFromUrl, loadItems]); // Added loadItems

  const handleLoadMore = useCallback(() => {
    if (!isLoading && !isLoadingMore && hasMoreBackendItems) {
      loadItems(currentQueryFromUrl, false); // false for isNewQueryLoad (means append)
    }
  }, [isLoading, isLoadingMore, hasMoreBackendItems, currentQueryFromUrl, loadItems]);

  const handleAnalyzeItem = (itemToAnalyze: DealScopeItem) => {
    setSelectedItemForAnalysis(itemToAnalyze);
    setIsAnalysisModalOpen(true);
  };

  const handleKeywordSearchFromModal = (keyword: string) => {
    setIsAnalysisModalOpen(false);
    router.push(`${pagePath}?q=${encodeURIComponent(keyword)}`);
  };

  const handleAuctionEnd = useCallback((endedItemId: string) => {
    if (itemType !== 'auction') return;

    let endedItemTitleForToast = "An auction";
    setAllItems(prevItems => {
        const itemThatEnded = prevItems.find(item => item.id === endedItemId);
        if (itemThatEnded) {
            endedItemTitleForToast = itemThatEnded.title;
        }
        return prevItems.filter(item => item.id !== endedItemId);
    });

    const currentCacheKeyForEnd = (!currentQueryFromUrl) ? CURATED_AUCTIONS_CACHE_KEY : SEARCHED_AUCTIONS_CACHE_KEY_PREFIX + currentQueryFromUrl;
    try {
        const cachedDataString = sessionStorage.getItem(currentCacheKeyForEnd);
        if (cachedDataString) {
            const cachedData = JSON.parse(cachedDataString);
            if (cachedData && cachedData.items && Array.isArray(cachedData.items)) {
                const updatedCachedItems = cachedData.items.filter((i: DealScopeItem) => i.id !== endedItemId && (i.endTime ? new Date(i.endTime).getTime() > Date.now() : false));
                if (updatedCachedItems.length > 0 || cachedData.items.length !== updatedCachedItems.length ) {
                    sessionStorage.setItem(currentCacheKeyForEnd, JSON.stringify({ items: updatedCachedItems, timestamp: Date.now() }));
                } else if (updatedCachedItems.length === 0 && cachedData.items.length > 0) {
                     sessionStorage.removeItem(currentCacheKeyForEnd);
                }
            }
        }
    } catch (e) {
        console.warn(`[useItemPageLogic handleAuctionEnd] Error updating sessionStorage for ${endedItemId} in key ${currentCacheKeyForEnd}:`, e);
    }

    setTimeout(() => toast({
        title: "Auction Ended",
        description: `"${endedItemTitleForToast.substring(0,30)}..." has ended and been removed.`
    }), 0);
  }, [itemType, currentQueryFromUrl, SEARCHED_AUCTIONS_CACHE_KEY_PREFIX, CURATED_AUCTIONS_CACHE_KEY, toast]); // Added CURATED_AUCTIONS_CACHE_KEY


  // Update displayedItems whenever allItems changes
  useEffect(() => {
    let activeItems = allItems;
    if (itemType === 'auction') {
        activeItems = allItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
    }
    setDisplayedItems(activeItems);
  }, [allItems, itemType]);

  let noItemsTitle = `No ${itemType === 'deal' ? 'Deals' : 'Auctions'} Found`;
  let noItemsDescription = currentQueryFromUrl
    ? `No ${itemType === 'deal' ? 'deals' : 'auctions'} found for "${currentQueryFromUrl}". Try adjusting your search.`
    : `We're fetching curated ${itemType === 'deal' ? 'deals' : 'auctions'}. If nothing appears, try a specific search!`;

  const activeItemsForNoMessage = itemType === 'auction'
    ? allItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false)
    : allItems;

  if (activeItemsForNoMessage.length === 0 && !isLoading && !isRanking && !error && currentQueryFromUrl === '') {
      noItemsDescription = `We couldn't find any active curated ${itemType === 'deal' ? 'deals' : 'auctions'}. Try a specific search or check back!`;
  }
  
  return {
    inputValue,
    setInputValue,
    displayedItems, // This is now directly allItems (filtered for active auctions)
    // allItems, // Not directly exposed if displayedItems is the source of truth for UI
    isLoading,
    isRanking,
    isLoadingMore,
    hasMoreBackendItems,
    error,
    isAuthError,
    selectedItemForAnalysis,
    isAnalysisModalOpen,
    setIsAnalysisModalOpen,
    handleSearchSubmit,
    handleLogoClick,
    handleLoadMore,
    handleAnalyzeItem,
    handleKeywordSearchFromModal,
    handleAuctionEnd: itemType === 'auction' ? handleAuctionEnd : undefined,
    noItemsTitle,
    noItemsDescription,
    activeItemsForNoMessageCount: activeItemsForNoMessage.length,
    // ITEMS_PER_PAGE, // No longer used for client-side pagination display
  };
}
