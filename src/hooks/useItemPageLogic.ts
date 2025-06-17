
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
  // MIN_AI_QUALIFIED_ITEMS_THRESHOLD, // Not directly used in this hook's logic flow for now
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
  API_FETCH_LIMIT,
} from '@/lib/constants';


type ItemType = 'deal' | 'auction';

export function useItemPageLogic(itemType: ItemType) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentQueryFromUrl = searchParams.get('q') || '';

  const [inputValue, setInputValue] = useState(currentQueryFromUrl);
  const [allItems, setAllItems] = useState<DealScopeItem[]>([]);
  const [displayedItems, setDisplayedItems] = useState<DealScopeItem[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isRanking, setIsRanking] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreBackendItems, setHasMoreBackendItems] = useState(true);
  const [currentApiOffset, setCurrentApiOffset] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);

  const [selectedItemForAnalysis, setSelectedItemForAnalysis] = useState<DealScopeItem | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

  const { toast } = useToast();

  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [backgroundCacheAttempted, setBackgroundCacheAttempted] = useState(false);
  const [proactiveSearchCacheAttempted, setProactiveSearchCacheAttempted] = useState(false);

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
    let isMounted = true;
    const isGlobalCuratedRequest = queryToLoad === '';
    let overallToastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;
    
    if (isNewQueryLoad) {
      setAllItems([]); // Handled by setAllItems(processedBatchForState) later if successful
      setCurrentApiOffset(0);
      setHasMoreBackendItems(true); // Optimistic, adjusted after fetch
      setIsLoading(true); // Main loading state for new query
      setError(null);
      setIsAuthError(false);
      setInitialLoadComplete(false);
    } else { // Load More
      if (isLoading || isLoadingMore || !hasMoreBackendItems) return; //isLoading check for main page load
      setIsLoadingMore(true); // Specific loading state for "load more" button
    }
    setIsRanking(false); // Reset ranking state for any new fetch operation

    const currentCacheKey = isGlobalCuratedRequest ? CURATED_CACHE_KEY : SEARCHED_CACHE_KEY_PREFIX + queryToLoad;
    // For specific queries, use currentApiOffset. For new curated queries, it's 0. For "load more" curated, offset is handled per-keyword.
    const effectiveOffsetForSpecificQuery = isNewQueryLoad ? 0 : currentApiOffset;

    let fetchedItemsFromServer: DealScopeItem[] = [];
    let processedBatchForState: DealScopeItem[] = [];

    try {
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
            if (itemsFromCache.length > 0 && isMounted) {
              setAllItems(itemsFromCache);
              setCurrentApiOffset(itemsFromCache.length); 
              setHasMoreBackendItems(itemsFromCache.length >= API_FETCH_LIMIT); // Can be refined if cache stores 'hasMore'
              setIsLoading(false);
              setInitialLoadComplete(true);
              setTimeout(() => toast({ title: `Loaded Cached ${isGlobalCuratedRequest ? "Curated" : "Searched"} ${itemType === 'deal' ? 'Deals' : 'Auctions'}`, description: `Displaying previously fetched ${itemType === 'auction' ? 'active ' : ''}${itemType === 'deal' ? 'deals' : 'auctions'}${isGlobalCuratedRequest ? "" : ` for "${queryToLoad}"`}.` }),0);
              return;
            } else {
              sessionStorage.removeItem(currentCacheKey);
            }
          } else {
            sessionStorage.removeItem(currentCacheKey);
          }
        }
      }

      if (isGlobalCuratedRequest) {
        setIsRanking(true);
        let accumulatedRawEbayItems: DealScopeItem[] = [];
        const attemptedKeywords = new Set<string>();
        const numKeywordsToFetch = isNewQueryLoad ? MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS : MAX_CURATED_FETCH_ATTEMPTS;
        const itemsToAimFor = isNewQueryLoad ? (MIN_DESIRED_CURATED_ITEMS * TARGET_RAW_ITEMS_FACTOR_FOR_AI) : API_FETCH_LIMIT;
        const currentAccumulatedIds = new Set<string>(); // For ensuring uniqueness in accumulatedRawEbayItems

        let currentBatchNumber = 0;
        while (accumulatedRawEbayItems.length < itemsToAimFor && attemptedKeywords.size < numKeywordsToFetch * KEYWORDS_PER_BATCH_INITIAL_DEALS ) {
            currentBatchNumber++;
            const keywordsForThisBatch: string[] = [];
            let uniqueKeywordSafety = 0;
            const keywordsPerBatch = isNewQueryLoad ? KEYWORDS_PER_BATCH_INITIAL_DEALS : 1;
            while (keywordsForThisBatch.length < keywordsPerBatch && uniqueKeywordSafety < (curatedHomepageSearchTerms.length + 10) && (attemptedKeywords.size < numKeywordsToFetch * KEYWORDS_PER_BATCH_INITIAL_DEALS)) {
                const randomKw = await getRandomPopularSearchTerm();
                if (randomKw && randomKw.trim() !== '' && !attemptedKeywords.has(randomKw) && !keywordsForThisBatch.includes(randomKw)) {
                    keywordsForThisBatch.push(randomKw);
                }
                uniqueKeywordSafety++;
            }
            if (keywordsForThisBatch.length === 0) break;
            keywordsForThisBatch.forEach(kw => attemptedKeywords.add(kw));

            const fetchedBatchesPromises = keywordsForThisBatch.map(kw => fetchItems(itemType, kw, true, 0, API_FETCH_LIMIT));
            const fetchedBatchesResults = await Promise.allSettled(fetchedBatchesPromises);
            
            fetchedBatchesResults.forEach(result => {
              if (result.status === 'fulfilled') {
                (result.value as DealScopeItem[]).forEach(item => {
                  if (!currentAccumulatedIds.has(item.id)) {
                    accumulatedRawEbayItems.push(item);
                    currentAccumulatedIds.add(item.id);
                  }
                });
              }
            });
            fetchedItemsFromServer = [...accumulatedRawEbayItems]; // Update for hasMore check for current batch

            if (attemptedKeywords.size >= numKeywordsToFetch * KEYWORDS_PER_BATCH_INITIAL_DEALS && !isNewQueryLoad) break;
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
        if (isMounted) setIsRanking(false);

      } else { // Searched request (not global curated)
        fetchedItemsFromServer = await fetchItems(itemType, queryToLoad, false, effectiveOffsetForSpecificQuery, API_FETCH_LIMIT);
        let activeFetchedItems = fetchedItemsFromServer;
        if (itemType === 'auction') {
          activeFetchedItems = fetchedItemsFromServer.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
        }

        if (activeFetchedItems.length > 0) {
          if (isMounted) setIsRanking(true);
          const aiProcessedItems = await aiRankOrQualifyItems(activeFetchedItems, queryToLoad);
          if (isMounted) setIsRanking(false);
          processedBatchForState = aiProcessedItems;
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
          displayMessage = "Critical eBay API Authentication Failure. Check .env and server logs."; if (isMounted) setIsAuthError(true);
        } else if (e.message.includes("OAuth") || e.message.includes("authenticate with eBay API")) {
          displayMessage = "eBay API Authentication Failed. Check credentials and server logs."; if (isMounted) setIsAuthError(true);
        } else if (e.message.includes("Failed to fetch from eBay Browse API") || e.message.includes("Failed to fetch eBay items")) {
          displayMessage = `Error fetching from eBay. Check query or eBay status. Server logs may have details.`;
        } else { displayMessage = e.message; }
      }
      if (isMounted) setError(displayMessage);
      processedBatchForState = [];
      fetchedItemsFromServer = [];
    }

    if (!isMounted) return;

    if (isNewQueryLoad) {
        setAllItems(processedBatchForState);
        setCurrentApiOffset(processedBatchForState.length); // For specific queries, this is the new base offset. For curated, it's total unique items.
        setHasMoreBackendItems(fetchedItemsFromServer.length >= API_FETCH_LIMIT);
        if (!error && processedBatchForState.length > 0) {
            try {
                sessionStorage.setItem(currentCacheKey, JSON.stringify({ items: processedBatchForState, timestamp: Date.now() }));
            } catch (e) { console.warn(`[useItemPageLogic loadItems] Error saving to sessionStorage for key "${currentCacheKey}":`, e); }
        }
    } else { // Load More
        let uniqueNewItemsCount = 0;
        setAllItems(prevAllItems => {
            const existingIds = new Set(prevAllItems.map(item => item.id));
            const uniqueNewItems = processedBatchForState.filter(item => !existingIds.has(item.id));
            uniqueNewItemsCount = uniqueNewItems.length;
            const updatedList = [...prevAllItems, ...uniqueNewItems];
            
            if (!error && uniqueNewItems.length > 0) {
                try {
                    sessionStorage.setItem(currentCacheKey, JSON.stringify({ items: updatedList, timestamp: Date.now() }));
                } catch (e) { console.warn(`[useItemPageLogic loadItems] Error updating sessionStorage for key "${currentCacheKey}" after load more:`, e); }
            }
            return updatedList;
        });
        // Only increment offset by the number of new unique items added
        // For specific queries, this correctly tracks the next page.
        // For curated, it reflects the total unique items shown.
        setCurrentApiOffset(prevOffset => prevOffset + uniqueNewItemsCount); 
        setHasMoreBackendItems(uniqueNewItemsCount > 0 && fetchedItemsFromServer.length >= API_FETCH_LIMIT);
    }
    
    if (isNewQueryLoad) {
        setIsLoading(false);
        setInitialLoadComplete(true);
    } else {
        setIsLoadingMore(false);
    }
    
    if (overallToastMessage && !error) {
        setTimeout(() => toast(overallToastMessage), 0);
    } else if (error && !isAuthError && (isNewQueryLoad || isLoadingMore)) {
        setTimeout(() => toast({ title: `Error Loading ${itemType === 'deal' ? 'Deals' : 'Auctions'}`, description: error || "An unexpected error occurred.", variant: "destructive" }), 0);
    }
    
    return () => { isMounted = false; };

  }, [
    itemType,
    // isLoading, isLoadingMore, hasMoreBackendItems, // These are states, not deps for useCallback if logic handles them internally
    currentApiOffset, // Needed for effectiveOffsetForSpecificQuery when !isNewQueryLoad
    aiRankOrQualifyItems, // Stable function ref based on itemType
    CURATED_CACHE_KEY, SEARCHED_CACHE_KEY_PREFIX, // Derived from itemType, stable if itemType is stable
    GLOBAL_CURATED_CACHE_TTL_MS, STANDARD_CACHE_TTL_MS, // Constants
    // fetchItems, getRandomPopularSearchTerm, // Imported functions, stable
    // toast, // Stable from useToast
    // State setters are stable:
    setIsLoading, setIsRanking, setError, setIsAuthError, 
    setAllItems, setCurrentApiOffset, setHasMoreBackendItems, 
    setInitialLoadComplete, setIsLoadingMore
  ]);


  useEffect(() => {
    let isMounted = true;
    setInputValue(currentQueryFromUrl);
    setBackgroundCacheAttempted(false);
    setProactiveSearchCacheAttempted(false);
    
    const loadWrapper = async () => {
        const cleanupLoadItems = await loadItems(currentQueryFromUrl, true);
        if (typeof cleanupLoadItems === 'function' && !isMounted) {
            cleanupLoadItems();
        }
    };
    loadWrapper();

    return () => {
      isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQueryFromUrl, itemType, loadItems]); // loadItems is now memoized


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
          
          const uniqueItemsMap = new Map<string, DealScopeItem>();
          successfulFetches.flat().forEach(item => {
            if (!uniqueItemsMap.has(item.id)) {
                uniqueItemsMap.set(item.id, item);
            }
          });
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

    if(initialLoadComplete && !currentQueryFromUrl && isMounted) {
        performBackgroundCache();
    }
    return () => {
      isMounted = false;
    };
  }, [
    initialLoadComplete, backgroundCacheAttempted, isLoading, isRanking, error, currentQueryFromUrl, isAuthError,
    itemType, OTHER_ITEM_TYPE_CURATED_CACHE_KEY, otherItemType, aiOtherTypeBackgroundCacheQuery,
    // rankDealsAI, qualifyAuctionsAI // These are stable if derived correctly from itemType
  ]);


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
    if(initialLoadComplete && currentQueryFromUrl && isMounted) {
        performProactiveSearchCache();
    }
    return () => {
      isMounted = false;
    };
  }, [
    currentQueryFromUrl, initialLoadComplete, proactiveSearchCacheAttempted, isLoading, isRanking, error, isAuthError,
    itemType, OTHER_ITEM_TYPE_SEARCHED_CACHE_KEY_PREFIX, otherItemType,
    // rankDealsAI, qualifyAuctionsAI
  ]);


  const handleSearchSubmit = useCallback((query: string) => {
    const newPath = query ? `${pagePath}?q=${encodeURIComponent(query)}` : pagePath;
    router.push(newPath);
  }, [router, pagePath]);

  const handleLogoClick = useCallback(async () => {
    setInputValue('');
    const basePagePath = itemType === 'deal' ? '/' : '/auctions';
    if (currentQueryFromUrl === '' && router.pathname === basePagePath) {
      await loadItems('', true);
    } else {
      router.push(basePagePath);
    }
  }, [router, itemType, currentQueryFromUrl, loadItems]);

  const handleLoadMore = useCallback(async () => {
    if (!isLoading && !isLoadingMore && hasMoreBackendItems) {
      await loadItems(currentQueryFromUrl, false);
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
        const updatedItems = prevItems.filter(item => item.id !== endedItemId);

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
        return updatedItems;
    });


    setTimeout(() => toast({
        title: "Auction Ended",
        description: `"${endedItemTitleForToast.substring(0,30)}..." has ended and been removed.`
    }), 0);
  }, [itemType, currentQueryFromUrl, toast, SEARCHED_AUCTIONS_CACHE_KEY_PREFIX, CURATED_AUCTIONS_CACHE_KEY]);


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
    displayedItems,
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
  };
}
