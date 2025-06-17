
'use client';

import type React from 'react';
import { useState, useEffect, useCallback }
  from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { DealScopeItem } from '@/types';
import { fetchItems, getRandomPopularSearchTerm } from '@/services/ebay-api-service';
import { rankDeals as rankDealsAI } from '@/ai/flows/rank-deals';
import { qualifyAuctions as qualifyAuctionsAI } from '@/ai/flows/qualify-auctions';
import { useToast } from "@/hooks/use-toast";

import {
  MIN_DESIRED_CURATED_ITEMS,
  MAX_CURATED_FETCH_ATTEMPTS,
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
  const pathname = usePathname();
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

  const aiRankOrQualifyItems = useCallback(
    itemType === 'deal' ? rankDealsAI : qualifyAuctionsAI,
    [itemType]
  );
  const aiOtherTypeBackgroundCacheQuery = itemType === 'deal'
    ? "general curated auctions background cache from deals"
    : "general curated deals background cache from auctions";


  const loadItems = useCallback(async (queryToLoad: string, isNewQueryLoad: boolean, offsetForCall: number = 0) => {
    let isMounted = true;
    const isGlobalCuratedRequest = queryToLoad === '';
    let overallToastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;
    
    if (isNewQueryLoad) {
      setCurrentApiOffset(0);
      setHasMoreBackendItems(true); 
      setIsLoading(true); 
      setError(null);
      setIsAuthError(false);
      setInitialLoadComplete(false);
      setAllItems([]);
    } else { 
      setIsLoadingMore(true); 
    }
    setIsRanking(false); 

    const currentCacheKey = isGlobalCuratedRequest ? CURATED_CACHE_KEY : SEARCHED_CACHE_KEY_PREFIX + queryToLoad;
    
    let fetchedItemsFromServer: DealScopeItem[] = [];
    let processedBatchForAI: DealScopeItem[] = [];
    let attemptedKeywords = new Set<string>();

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
              const uniqueInitialItemsMap = new Map<string, DealScopeItem>();
              itemsFromCache.forEach(item => { if (!uniqueInitialItemsMap.has(item.id)) uniqueInitialItemsMap.set(item.id, item); });
              const uniqueInitialItems = Array.from(uniqueInitialItemsMap.values());
              
              setAllItems(uniqueInitialItems);
              if (isGlobalCuratedRequest) {
                  setCurrentApiOffset(uniqueInitialItems.length);
                  setHasMoreBackendItems(true); // For cached curated, assume more can be loaded
              } else {
                  setCurrentApiOffset(uniqueInitialItems.length >= API_FETCH_LIMIT ? API_FETCH_LIMIT : uniqueInitialItems.length);
                  setHasMoreBackendItems(uniqueInitialItems.length >= API_FETCH_LIMIT);
              }
              setIsLoading(false);
              setInitialLoadComplete(true);
              overallToastMessage = { title: `Loaded Cached ${isGlobalCuratedRequest ? "Curated" : "Searched"} ${itemType === 'deal' ? 'Deals' : 'Auctions'}`, description: `Displaying previously fetched ${itemType === 'auction' ? 'active ' : ''}${itemType === 'deal' ? 'deals' : 'auctions'}${isGlobalCuratedRequest ? "" : ` for "${queryToLoad}"`}.` };
              if (isMounted && overallToastMessage) setTimeout(() => toast(overallToastMessage as any), 0);
              return () => { isMounted = false; };
            } else {
              sessionStorage.removeItem(currentCacheKey);
            }
          } else {
            sessionStorage.removeItem(currentCacheKey);
          }
        }
      }

      if (isGlobalCuratedRequest) {
        if(isMounted) setIsRanking(true);
        let accumulatedRawEbayItemsMap = new Map<string, DealScopeItem>();
        const itemsToAimFor = isNewQueryLoad ? (MIN_DESIRED_CURATED_ITEMS * TARGET_RAW_ITEMS_FACTOR_FOR_AI) : API_FETCH_LIMIT;
        
        attemptedKeywords = new Set<string>();
        const numKeywordsToFetchForThisLoad = isNewQueryLoad ? MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS : MAX_CURATED_FETCH_ATTEMPTS;
        const keywordsPerBatchForThisLoad = isNewQueryLoad ? KEYWORDS_PER_BATCH_INITIAL_DEALS : 1;

        while (Array.from(accumulatedRawEbayItemsMap.values()).length < itemsToAimFor && attemptedKeywords.size < numKeywordsToFetchForThisLoad * keywordsPerBatchForThisLoad ) {
            const keywordsForThisBatch: string[] = [];
            let uniqueKeywordSafety = 0;
            while (keywordsForThisBatch.length < keywordsPerBatchForThisLoad && uniqueKeywordSafety < (curatedHomepageSearchTerms.length + 10) && (attemptedKeywords.size < numKeywordsToFetchForThisLoad * keywordsPerBatchForThisLoad)) {
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
                (result.value as DealScopeItem[]).forEach(item => { if (!accumulatedRawEbayItemsMap.has(item.id)) accumulatedRawEbayItemsMap.set(item.id, item); });
              }
            });
            fetchedItemsFromServer = Array.from(accumulatedRawEbayItemsMap.values());
            if (attemptedKeywords.size >= numKeywordsToFetchForThisLoad * keywordsPerBatchForThisLoad) break;
        }
        processedBatchForAI = Array.from(accumulatedRawEbayItemsMap.values());
      } else { 
        fetchedItemsFromServer = await fetchItems(itemType, queryToLoad, false, offsetForCall, API_FETCH_LIMIT);
        processedBatchForAI = fetchedItemsFromServer;
      }

      let aiProcessedItems: DealScopeItem[] = [];
      if (processedBatchForAI.length > 0) {
        if (isMounted) setIsRanking(true);
        aiProcessedItems = await aiRankOrQualifyItems(processedBatchForAI, isGlobalCuratedRequest ? `general curated ${itemType} ${isNewQueryLoad ? 'initial' : 'more'}` : queryToLoad);
        if (isMounted) setIsRanking(false);
         if (isNewQueryLoad) {
            overallToastMessage = { title: `${isGlobalCuratedRequest ? "Curated " : ""}${itemType === 'deal' ? 'Deals' : 'Auctions'}${isGlobalCuratedRequest ? "" : ` for "${queryToLoad}"`}: AI Qualified`, description: `Displaying ${aiProcessedItems.length} AI-qualified ${itemType}.` };
        } else {
            overallToastMessage = { title: `More ${isGlobalCuratedRequest ? "Curated " : ""}${itemType === 'deal' ? 'Deals' : 'Auctions'}${isGlobalCuratedRequest ? "" : ` for "${queryToLoad}"`}`, description: `Added ${aiProcessedItems.length} more AI-qualified ${itemType}.` };
        }
      } else {
         if (isNewQueryLoad) {
             overallToastMessage = { title: `No ${isGlobalCuratedRequest ? "Curated " : ""}${itemType === 'deal' ? 'Deals' : 'Auctions'} Found`, description: `No ${itemType === 'auction' ? 'active ' : ''}${itemType} found for "${queryToLoad}".` };
        } else {
             overallToastMessage = { title: `No More ${isGlobalCuratedRequest ? "Curated " : ""}${itemType === 'deal' ? 'Deals' : 'Auctions'}`, description: `No more ${itemType} found for "${queryToLoad}".` };
        }
      }
       // Ensure AI output is unique
      const uniqueAiItemsMap = new Map<string, DealScopeItem>();
      aiProcessedItems.forEach(item => { if (!uniqueAiItemsMap.has(item.id)) uniqueAiItemsMap.set(item.id, item); });
      const finalProcessedBatch = Array.from(uniqueAiItemsMap.values());


      if (isNewQueryLoad) {
          if (isMounted) setAllItems(finalProcessedBatch);
          if (isGlobalCuratedRequest) {
              if (isMounted) {
                // If initial curated load yields any items (raw or processed), assume more can be loaded.
                setHasMoreBackendItems(finalProcessedBatch.length > 0 || fetchedItemsFromServer.length > 0);
                setCurrentApiOffset(finalProcessedBatch.length);
              }
          } else { // Specific query initial load
              if (isMounted) {
                setHasMoreBackendItems(fetchedItemsFromServer.length >= API_FETCH_LIMIT);
                setCurrentApiOffset(API_FETCH_LIMIT);
              }
          }
          if (isMounted && !error && finalProcessedBatch.length > 0) {
              try { sessionStorage.setItem(currentCacheKey, JSON.stringify({ items: finalProcessedBatch, timestamp: Date.now() })); }
              catch (e) { console.warn(`[useItemPageLogic loadItems] Error saving to sessionStorage for key "${currentCacheKey}":`, e); }
          }
      } else { // Load More
          let newItemsAddedCount = 0;
          if (isMounted) {
            setAllItems(prevAllItems => {
                const existingIds = new Set(prevAllItems.map(item => item.id));
                const trulyNewItems = finalProcessedBatch.filter(newItem => !existingIds.has(newItem.id));
                newItemsAddedCount = trulyNewItems.length;
                const updatedList = [...prevAllItems, ...trulyNewItems];
                if (!error && trulyNewItems.length > 0) {
                    try { sessionStorage.setItem(currentCacheKey, JSON.stringify({ items: updatedList, timestamp: Date.now() })); }
                    catch (e) { console.warn(`[useItemPageLogic loadItems] Error updating sessionStorage for key "${currentCacheKey}" after load more:`, e); }
                }
                return updatedList;
            });
          }
          
          if (isGlobalCuratedRequest) {
              // For curated "Load More", if this batch added new items, assume we can try again.
              // If it added 0 new items, then we've likely exhausted useful keywords for now.
              if (isMounted) {
                setHasMoreBackendItems(newItemsAddedCount > 0);
                setCurrentApiOffset(prevOffset => prevOffset + newItemsAddedCount);
              }
          } else { // Specific query "Load More"
              if (isMounted) {
                setCurrentApiOffset(prevOffset => prevOffset + API_FETCH_LIMIT);
                setHasMoreBackendItems(fetchedItemsFromServer.length >= API_FETCH_LIMIT);
              }
          }
      }

    } catch (e: any) {
      if (!isMounted) return;
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
      overallToastMessage = { title: `Error Loading ${itemType === 'deal' ? 'Deals' : 'Auctions'}`, description: displayMessage || "An unexpected error occurred.", variant: "destructive" };
    } finally {
      if (!isMounted) return;
      if (isNewQueryLoad) {
          setIsLoading(false);
          setInitialLoadComplete(true);
      } else {
          setIsLoadingMore(false);
      }
      setIsRanking(false); // Ensure ranking is false by the end
      if (isMounted && overallToastMessage) {
          setTimeout(() => { if(isMounted) toast(overallToastMessage as any); }, 0);
      }
    }
    return () => { isMounted = false; };
  }, [
    itemType, CURATED_CACHE_KEY, SEARCHED_CACHE_KEY_PREFIX, 
    GLOBAL_CURATED_CACHE_TTL_MS, STANDARD_CACHE_TTL_MS,
    aiRankOrQualifyItems, 
    toast, 
    setIsLoading, setIsRanking, setError, setIsAuthError, 
    setAllItems, setCurrentApiOffset, setHasMoreBackendItems, 
    setInitialLoadComplete, setIsLoadingMore
  ]);


  useEffect(() => {
    let isMounted = true;
    if (isMounted) {
        setInputValue(currentQueryFromUrl);
        setBackgroundCacheAttempted(false); 
        setProactiveSearchCacheAttempted(false);
    }
    
    const loadInitialData = async () => {
        if(isMounted) await loadItems(currentQueryFromUrl, true, 0);
    };
    loadInitialData();

    return () => {
      isMounted = false;
    };
  }, [currentQueryFromUrl, itemType, loadItems]); 


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
          successfulFetches.flat().forEach(item => { if (!uniqueItemsMap.has(item.id)) uniqueItemsMap.set(item.id, item); });
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
    otherItemType, OTHER_ITEM_TYPE_CURATED_CACHE_KEY, aiOtherTypeBackgroundCacheQuery,
    rankDealsAI, qualifyAuctionsAI
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
    otherItemType, OTHER_ITEM_TYPE_SEARCHED_CACHE_KEY_PREFIX,
    rankDealsAI, qualifyAuctionsAI
  ]);


  const handleSearchSubmit = useCallback((query: string) => {
    const newPath = query ? `${pagePath}?q=${encodeURIComponent(query)}` : pagePath;
    router.push(newPath);
  }, [router, pagePath]);

  const handleLogoClick = useCallback(async () => {
    setInputValue('');
    if (currentQueryFromUrl === '' && pathname === pagePath) {
      await loadItems('', true, 0);
    } else {
      router.push(pagePath);
    }
  }, [router, loadItems, pagePath, pathname, currentQueryFromUrl]);


  const handleLoadMore = useCallback(async () => {
    if (!isLoading && !isLoadingMore && hasMoreBackendItems) {
      await loadItems(currentQueryFromUrl, false, currentApiOffset);
    }
  }, [isLoading, isLoadingMore, hasMoreBackendItems, loadItems, currentQueryFromUrl, currentApiOffset]);

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
    let isMounted = true;
    let endedItemTitleForToast = "An auction";
    
    if(isMounted) {
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
    }

    setTimeout(() => {
        if (isMounted) {
            toast({
                title: "Auction Ended",
                description: `"${endedItemTitleForToast.substring(0,30)}..." has ended and been removed.`
            });
        }
    }, 0);
    return () => { isMounted = false; };
  }, [itemType, currentQueryFromUrl, toast, SEARCHED_AUCTIONS_CACHE_KEY_PREFIX, CURATED_AUCTIONS_CACHE_KEY, setAllItems]);


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
