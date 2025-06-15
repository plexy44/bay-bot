
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
  STALE_CACHE_THRESHOLD_FOR_SOFT_REFRESH_MS,
} from '@/lib/constants';

const ITEMS_PER_PAGE = 8;

type ItemType = 'deal' | 'auction';

export function useItemPageLogic(itemType: ItemType) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentQueryFromUrl = searchParams.get('q') || '';

  const [inputValue, setInputValue] = useState(currentQueryFromUrl);
  const [displayedItems, setDisplayedItems] = useState<DealScopeItem[]>([]);
  const [allItems, setAllItems] = useState<DealScopeItem[]>([]);
  const [visibleItemCount, setVisibleItemCount] = useState(ITEMS_PER_PAGE);
  const [isLoading, setIsLoading] = useState(true);
  const [isRanking, setIsRanking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);

  const [selectedItemForAnalysis, setSelectedItemForAnalysis] = useState<DealScopeItem | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

  const { toast } = useToast();

  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [topUpAttempted, setTopUpAttempted] = useState(false);
  const [backgroundCacheAttempted, setBackgroundCacheAttempted] = useState(false);
  const [proactiveSearchCacheAttempted, setProactiveSearchCacheAttempted] = useState(false);
  const [loadedFromCacheTimestamp, setLoadedFromCacheTimestamp] = useState<number | null>(null);

  const CURATED_CACHE_KEY = itemType === 'deal' ? CURATED_DEALS_CACHE_KEY : CURATED_AUCTIONS_CACHE_KEY;
  const OTHER_ITEM_TYPE_CURATED_CACHE_KEY = itemType === 'deal' ? CURATED_AUCTIONS_CACHE_KEY : CURATED_DEALS_CACHE_KEY;
  const SEARCHED_CACHE_KEY_PREFIX = itemType === 'deal' ? SEARCHED_DEALS_CACHE_KEY_PREFIX : SEARCHED_AUCTIONS_CACHE_KEY_PREFIX;
  const OTHER_ITEM_TYPE_SEARCHED_CACHE_KEY_PREFIX = itemType === 'deal' ? SEARCHED_AUCTIONS_CACHE_KEY_PREFIX : SEARCHED_DEALS_CACHE_KEY_PREFIX;
  const otherItemType = itemType === 'deal' ? 'auction' : 'deal';
  const pagePath = itemType === 'deal' ? '/' : '/auctions';
  const aiRankOrQualifyItems = itemType === 'deal' ? rankDealsAI : qualifyAuctionsAI;
  const aiBackgroundCacheQuery = itemType === 'deal'
    ? "general curated deals background cache from auctions"
    : "general curated auctions background cache from deals";
  const aiOtherTypeBackgroundCacheQuery = itemType === 'deal'
    ? "general curated auctions background cache from deals"
    : "general curated deals background cache from auctions";


  const loadItems = useCallback(async (queryToLoad: string) => {
    const isGlobalCuratedRequest = queryToLoad === '';

    setAllItems([]);
    setDisplayedItems([]);
    setVisibleItemCount(ITEMS_PER_PAGE);
    setIsLoading(true);
    setIsRanking(false);
    setError(null);
    setIsAuthError(false);
    if (!isGlobalCuratedRequest || currentQueryFromUrl !== queryToLoad) {
        setLoadedFromCacheTimestamp(null);
    }

    let processedItemsForState: DealScopeItem[] = [];
    let overallToastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;
    const currentCacheKey = isGlobalCuratedRequest ? CURATED_CACHE_KEY : SEARCHED_CACHE_KEY_PREFIX + queryToLoad;
    const currentCacheTTL = isGlobalCuratedRequest ? GLOBAL_CURATED_CACHE_TTL_MS : STANDARD_CACHE_TTL_MS;

    try {
      const cachedDataString = sessionStorage.getItem(currentCacheKey);
      if (cachedDataString) {
        const cachedData = JSON.parse(cachedDataString);
        let cacheIsValid = cachedData && cachedData.items && Array.isArray(cachedData.items) && (Date.now() - (cachedData.timestamp || 0) < currentCacheTTL);

        if (cacheIsValid) {
            let itemsFromCache = (cachedData.items as DealScopeItem[]);
            if (itemType === 'auction') {
                itemsFromCache = itemsFromCache.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
            }

            if (itemsFromCache.length > 0) {
                processedItemsForState = itemsFromCache;
                if (isGlobalCuratedRequest) {
                    setLoadedFromCacheTimestamp(cachedData.timestamp);
                }
                overallToastMessage = { title: `Loaded Cached ${isGlobalCuratedRequest ? "Curated" : "Searched"} ${itemType === 'deal' ? 'Deals' : 'Auctions'}`, description: `Displaying previously fetched ${itemType === 'auction' ? 'active ' : ''}${itemType === 'deal' ? 'deals' : 'auctions'}${isGlobalCuratedRequest ? "" : ` for "${queryToLoad}"`}.` };
            } else {
                sessionStorage.removeItem(currentCacheKey);
            }
        } else {
          sessionStorage.removeItem(currentCacheKey);
        }
      }
    } catch (e) {
      console.warn(`[useItemPageLogic loadItems] Error with sessionStorage for key "${currentCacheKey}":`, e);
      sessionStorage.removeItem(currentCacheKey);
    }

    if (processedItemsForState.length === 0) {
      if (isGlobalCuratedRequest) {
        if (itemType === 'deal') {
            setIsRanking(true);
            let accumulatedRawEbayItems: DealScopeItem[] = [];
            const attemptedKeywordsInitialLoad = new Set<string>();
            try {
                let currentBatchNumber = 0;
                while (
                  accumulatedRawEbayItems.length < (MIN_DESIRED_CURATED_ITEMS * TARGET_RAW_ITEMS_FACTOR_FOR_AI) &&
                  attemptedKeywordsInitialLoad.size < MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS
                ) {
                  currentBatchNumber++;
                  const keywordsForThisBatch: string[] = [];
                  let uniqueKeywordSafety = 0;
                  while (
                    keywordsForThisBatch.length < KEYWORDS_PER_BATCH_INITIAL_DEALS &&
                    uniqueKeywordSafety < (curatedHomepageSearchTerms.length + 10) &&
                    (attemptedKeywordsInitialLoad.size + keywordsForThisBatch.length < MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS)
                  ) {
                    const randomKw = await getRandomPopularSearchTerm();
                    if (randomKw && randomKw.trim() !== '' && !attemptedKeywordsInitialLoad.has(randomKw) && !keywordsForThisBatch.includes(randomKw)) {
                      keywordsForThisBatch.push(randomKw);
                    }
                    uniqueKeywordSafety++;
                  }
                  if (keywordsForThisBatch.length === 0) break;
                  keywordsForThisBatch.forEach(kw => attemptedKeywordsInitialLoad.add(kw));

                  const fetchedBatchesPromises = keywordsForThisBatch.map(kw => fetchItems('deal', kw, true));
                  const fetchedBatchesResults = await Promise.allSettled(fetchedBatchesPromises);
                  const newlyFetchedItemsInBatch = fetchedBatchesResults
                    .filter(result => result.status === 'fulfilled')
                    .flatMap(result => (result as PromiseFulfilledResult<DealScopeItem[]>).value);
                  const currentAccumulatedIds = new Set(accumulatedRawEbayItems.map(item => item.id));
                  const uniqueNewItemsForAccumulation = newlyFetchedItemsInBatch.filter(item => !currentAccumulatedIds.has(item.id));
                  accumulatedRawEbayItems.push(...uniqueNewItemsForAccumulation);
                  if (attemptedKeywordsInitialLoad.size >= MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS) break;
                }

                if (accumulatedRawEbayItems.length > 0) {
                  const aiQualifiedAndRankedItems: DealScopeItem[] = await rankDealsAI(accumulatedRawEbayItems, "general curated deals");
                  const aiCount = aiQualifiedAndRankedItems.length;
                  processedItemsForState = [...aiQualifiedAndRankedItems];
                  if (aiCount < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiCount < accumulatedRawEbayItems.length) {
                    const aiQualifiedIds = new Set(aiQualifiedAndRankedItems.map(d => d.id));
                    const fallbackItems = accumulatedRawEbayItems.filter(d => !aiQualifiedIds.has(d.id));
                    const numFallbacksToAdd = Math.max(0, MIN_DESIRED_CURATED_ITEMS - aiCount);
                    processedItemsForState.push(...fallbackItems.slice(0, numFallbacksToAdd));
                    overallToastMessage = { title: "Curated Deals: AI Enhanced", description: `Displaying ${aiCount} AI-qualified deals, plus ${Math.min(fallbackItems.length, numFallbacksToAdd)} more.` };
                  } else if (aiCount === 0 && accumulatedRawEbayItems.length > 0) {
                    processedItemsForState = accumulatedRawEbayItems.slice(0, MIN_DESIRED_CURATED_ITEMS);
                    overallToastMessage = { title: "Curated Deals: Server Processed", description: `Displaying ${processedItemsForState.length} server-processed deals. AI found no specific qualifications.` };
                  } else if (aiCount > 0) {
                    overallToastMessage = { title: "Curated Deals: AI Qualified", description: `Displaying ${aiCount} AI-qualified deals.` };
                  } else {
                    overallToastMessage = { title: "No Curated Deals", description: "Could not find any curated deals matching criteria." };
                  }
                } else {
                  overallToastMessage = { title: "No Curated Deals", description: "No deals found from initial iterative fetch." };
                }
            } catch (e: any) { /* error handling below */ }
            finally { setIsRanking(false); }
        } else {
            const initialKeywordsToFetch: string[] = [];
            const attemptedKeywordsForSession = new Set<string>();
            let uniqueKeywordFetchAttempts = 0;
            while (initialKeywordsToFetch.length < MAX_CURATED_FETCH_ATTEMPTS && uniqueKeywordFetchAttempts < (curatedHomepageSearchTerms.length + 10)) {
              const randomKw = await getRandomPopularSearchTerm();
              if (randomKw && randomKw.trim() !== '' && !attemptedKeywordsForSession.has(randomKw)) {
                initialKeywordsToFetch.push(randomKw);
                attemptedKeywordsForSession.add(randomKw);
              }
              uniqueKeywordFetchAttempts++;
            }
            if (initialKeywordsToFetch.length === 0) {
              setError("Could not find keywords for curated auctions.");
            } else {
              const initialFetchPromises = initialKeywordsToFetch.map(kw =>
                fetchItems('auction', kw, true).catch(e => {
                  if (e.message?.includes("Authentication Failure") || e.message?.includes("invalid_client")) setIsAuthError(true);
                  return [];
                })
              );
              const initialResultsSettled = await Promise.all(initialFetchPromises);
              const successfullyFetchedInitialItems = initialResultsSettled
                .flat()
                .filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
              const uniqueInitialItemsMap = new Map(successfullyFetchedInitialItems.map(item => [item.id, item]));
              processedItemsForState = Array.from(uniqueInitialItemsMap.values());
              if (processedItemsForState.length > 0) {
                overallToastMessage = { title: "Curated Auctions Loaded", description: `Found ${processedItemsForState.length} auctions.` };
              } else if (!isAuthError) {
                overallToastMessage = { title: "No Curated Auctions", description: `No auctions found from initial keyword batch.` };
              }
            }
        }
        if (isAuthError && processedItemsForState.length === 0) {
          setError("Critical eBay API Authentication Failure. Check .env and server logs.");
        } else if (!isAuthError && processedItemsForState.length === 0 && (itemType === 'auction' || (itemType === 'deal' && !overallToastMessage?.title.includes("Curated Deals")))) {
          setError(`Failed to fetch curated ${itemType === 'deal' ? 'deals' : 'auctions'}. Please try again.`);
        }

        if (isGlobalCuratedRequest && !backgroundCacheAttempted && !isAuthError && !error) {
            setBackgroundCacheAttempted(true);
            // Logic moved to useEffect
        }

      } else {
        let fetchedItemsFromServer: DealScopeItem[] = [];
        try {
          fetchedItemsFromServer = await fetchItems(itemType, queryToLoad, false);
          let activeFetchedItems = fetchedItemsFromServer;
          if (itemType === 'auction') {
            activeFetchedItems = fetchedItemsFromServer.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
          }

          if (activeFetchedItems.length > 0) {
            setIsRanking(true);
            const aiProcessedItems = await aiRankOrQualifyItems(activeFetchedItems, queryToLoad);
            setIsRanking(false);
            processedItemsForState = aiProcessedItems;

            if (itemType === 'deal' && processedItemsForState.length > 0) {
                let sortedAiItems = [...aiProcessedItems];
                if (sortedAiItems.length > 0) sortedAiItems.sort((a, b) => (b.discountPercentage || 0) - (a.discountPercentage || 0));
                processedItemsForState = [...sortedAiItems];

                if (aiProcessedItems.length < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiProcessedItems.length < activeFetchedItems.length) {
                  const aiQualifiedIds = new Set(processedItemsForState.map(d => d.id));
                  const fallbackItems = activeFetchedItems.filter(d => !aiQualifiedIds.has(d.id));
                  const numFallbacksToAdd = Math.max(0, MIN_DESIRED_CURATED_ITEMS - aiProcessedItems.length);
                  processedItemsForState.push(...fallbackItems.slice(0, numFallbacksToAdd));
                  overallToastMessage = { title: `Deals: AI Enhanced & Sorted`, description: `Displaying ${aiProcessedItems.length} AI-qualified deals for "${queryToLoad}" (highest discount first), plus ${Math.min(fallbackItems.length, numFallbacksToAdd)} more.` };
                } else if (aiProcessedItems.length > 0) {
                  overallToastMessage = { title: `Deals: AI Qualified & Sorted`, description: `Displaying ${aiProcessedItems.length} AI-qualified deals for "${queryToLoad}", sorted by highest discount.` };
                } else if (activeFetchedItems.length > 0) {
                  const serverSortedFallback = [...activeFetchedItems].sort((a,b) => (b.discountPercentage || 0) - (a.discountPercentage || 0));
                  processedItemsForState = serverSortedFallback.slice(0, MIN_DESIRED_CURATED_ITEMS);
                  overallToastMessage = { title: `Deals: Server Processed & Sorted`, description: `Displaying server-processed deals for "${queryToLoad}", sorted by discount. AI found no further qualifications.` };
                } else {
                   overallToastMessage = { title: `No Deals Found`, description: `No deals found for "${queryToLoad}" after processing.` };
                }
            } else if (itemType === 'auction') {
                 if (aiProcessedItems.length > 0) {
                    overallToastMessage = { title: `Searched Auctions: AI Qualified`, description: `Displaying ${aiProcessedItems.length} AI-qualified auctions for "${queryToLoad}".` };
                 } else if (activeFetchedItems.length > 0) {
                    overallToastMessage = { title: `No Auctions Found by AI`, description: `AI found no suitable auctions for "${queryToLoad}" from ${activeFetchedItems.length} fetched.` };
                 } else {
                    overallToastMessage = { title: `No Auctions Found`, description: `No active auctions found for "${queryToLoad}".` };
                 }
            }
          } else {
            overallToastMessage = { title: `No ${itemType === 'deal' ? 'Deals' : 'Auctions'} Found`, description: `No ${itemType === 'auction' ? 'active ' : ''}${itemType === 'deal' ? 'deals' : 'auctions'} found for "${queryToLoad}".` };
          }
        } catch (e: any) {
          let displayMessage = `Failed to load ${itemType} for "${queryToLoad}". Please try again.`;
          if (typeof e.message === 'string') {
            if (e.message.includes("invalid_client") || e.message.includes("Critical eBay API Authentication Failure")) {
              displayMessage = "Critical eBay API Authentication Failure. Check .env and server logs."; setIsAuthError(true);
            } else if (e.message.includes("OAuth") || e.message.includes("authenticate with eBay API")) {
              displayMessage = "eBay API Authentication Failed. Check credentials and server logs."; setIsAuthError(true);
            } else if (e.message.includes("Failed to fetch from eBay Browse API") || e.message.includes("Failed to fetch eBay items")) {
              displayMessage = `Error fetching from eBay for "${queryToLoad}". Check query or eBay status. Server logs may have details.`;
            } else { displayMessage = e.message; }
          }
          setError(displayMessage);
          processedItemsForState = [];
        }
      }
    } else {
        if (isGlobalCuratedRequest && !backgroundCacheAttempted && !isAuthError && !error) {
             setBackgroundCacheAttempted(true);
             // Logic moved to useEffect
        }
    }

    setAllItems(processedItemsForState);
    setIsLoading(false);
    setInitialLoadComplete(true);

    if (!error && processedItemsForState.length > 0 ) {
      try {
        sessionStorage.setItem(currentCacheKey, JSON.stringify({ items: processedItemsForState, timestamp: Date.now() }));
      } catch (e) {
        console.warn(`[useItemPageLogic loadItems] Error saving to sessionStorage for key "${currentCacheKey}":`, e);
      }
    }

    if (overallToastMessage && !error) {
      setTimeout(() => toast(overallToastMessage), 0);
    } else if (error && !isAuthError) {
      setTimeout(() => toast({ title: `Error Loading ${itemType === 'deal' ? 'Deals' : 'Auctions'}`, description: error || "An unexpected error occurred.", variant: "destructive" }), 0);
    }
  }, [
      currentQueryFromUrl, itemType,
      CURATED_CACHE_KEY, SEARCHED_CACHE_KEY_PREFIX, OTHER_ITEM_TYPE_CURATED_CACHE_KEY, otherItemType,
      aiRankOrQualifyItems,
      backgroundCacheAttempted, // This state being a dependency might cause re-runs; consider if it's truly needed for loadItems itself.
      toast, // toast is stable
    ]);

  useEffect(() => {
    setInputValue(currentQueryFromUrl);
    setInitialLoadComplete(false);
    setTopUpAttempted(false);
    setBackgroundCacheAttempted(false);
    setProactiveSearchCacheAttempted(false);
    setLoadedFromCacheTimestamp(null);
    loadItems(currentQueryFromUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQueryFromUrl, itemType, loadItems]);


  // Top-up logic for global curated view
  useEffect(() => {
    let isMounted = true;

    const performTopUp = async () => {
      const isGlobalCuratedView = !currentQueryFromUrl;
      let activeAllItemsForCheck = allItems;
      if (itemType === 'auction') {
          activeAllItemsForCheck = allItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
      }
      const cacheIsStaleIshForSoftRefresh = itemType === 'deal' && loadedFromCacheTimestamp !== null && (Date.now() - loadedFromCacheTimestamp > STALE_CACHE_THRESHOLD_FOR_SOFT_REFRESH_MS);
      const needsTopUp = (itemType === 'deal' && (activeAllItemsForCheck.length < MIN_DESIRED_CURATED_ITEMS || (activeAllItemsForCheck.length > 0 && cacheIsStaleIshForSoftRefresh))) ||
                         (itemType === 'auction' && activeAllItemsForCheck.length < MIN_DESIRED_CURATED_ITEMS);

      if (!(isGlobalCuratedView && initialLoadComplete && !topUpAttempted && !isLoading && !isRanking && !error && !isAuthError && needsTopUp)) {
        return;
      }

      if (!isMounted) return;
      setTopUpAttempted(true);
      setIsLoading(true);
      if(itemType === 'deal') setIsRanking(true);

      try {
        const currentItemIds = new Set(activeAllItemsForCheck.map(item => item.id));
        const numAdditionalKeywords = Math.max(1, Math.floor(MAX_CURATED_FETCH_ATTEMPTS / 2) || 1);
        const additionalKeywordsToFetch: string[] = [];
        let uniqueKeywordSafety = 0; const attemptedKeywordsForTopUp = new Set<string>();
        while(additionalKeywordsToFetch.length < numAdditionalKeywords && uniqueKeywordSafety < (curatedHomepageSearchTerms.length + 5)) {
          const randomKw = await getRandomPopularSearchTerm();
          if(randomKw && randomKw.trim() !== '' && !attemptedKeywordsForTopUp.has(randomKw)){
            additionalKeywordsToFetch.push(randomKw); attemptedKeywordsForTopUp.add(randomKw);
          }
          uniqueKeywordSafety++;
        }

        if (additionalKeywordsToFetch.length === 0) {
            if (isMounted) { setIsLoading(false); if(itemType === 'deal') setIsRanking(false); }
            return;
        }

        const additionalFetchedBatchesPromises = additionalKeywordsToFetch.map(kw => fetchItems(itemType, kw, true));
        const additionalFetchedBatchesResults = await Promise.allSettled(additionalFetchedBatchesPromises);
        const successfullyFetchedAdditionalItemsRaw = additionalFetchedBatchesResults
            .filter(res => res.status === 'fulfilled')
            .flatMap(res => (res as PromiseFulfilledResult<DealScopeItem[]>).value);

        let newUniqueActiveAdditionalItems = successfullyFetchedAdditionalItemsRaw.filter(item => !currentItemIds.has(item.id));
        if (itemType === 'auction') {
          newUniqueActiveAdditionalItems = newUniqueActiveAdditionalItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
        }

        if (newUniqueActiveAdditionalItems.length > 0) {
            let currentActiveItemsInner = allItems; // Use the allItems from the hook's scope for combining
            if(itemType === 'auction') {
                currentActiveItemsInner = allItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
            }
            const combinedItems = [...currentActiveItemsInner, ...newUniqueActiveAdditionalItems];
            const uniqueMap = new Map(combinedItems.map(item => [item.id, item]));
            let itemsToProcessForAI = Array.from(uniqueMap.values());

            let finalToppedUpItemsList = itemsToProcessForAI;
            if (itemType === 'deal') {
              finalToppedUpItemsList = await rankDealsAI(itemsToProcessForAI, "general curated deals top-up/soft refresh");
            }

            if (isMounted) {
              setAllItems(finalToppedUpItemsList);
              sessionStorage.setItem(CURATED_CACHE_KEY, JSON.stringify({ items: finalToppedUpItemsList, timestamp: Date.now() }));
              setTimeout(() => toast({ title: `Curated ${itemType === 'deal' ? 'Deals' : 'Auctions'} Updated`, description: `Now displaying ${finalToppedUpItemsList.length} ${itemType === 'auction' ? 'active ' : ''}${itemType === 'deal' ? 'deals' : 'auctions'}.` }), 0);
            }
        } else {
            if (isMounted) {
              if(itemType === 'deal' && cacheIsStaleIshForSoftRefresh && activeAllItemsForCheck.length >= MIN_DESIRED_CURATED_ITEMS) {
                 setTimeout(() => toast({title: `${itemType === 'deal' ? 'Deals' : 'Auctions'} Refreshed`, description: `Checked for new ${itemType}, list is up to date.`}), 0);
              } else {
                 setTimeout(() => toast({title: `${itemType === 'deal' ? 'Deals' : 'Auctions'} Top-up`, description: `No new ${itemType} found in this attempt.`}), 0);
              }
            }
        }
      } catch (e: any) {
        if (isMounted) {
          setTimeout(() => toast({ title: `Error Updating ${itemType === 'deal' ? 'Deals' : 'Auctions'}`, description: e.message || `Failed to fetch additional ${itemType}.`, variant: "destructive" }), 0);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
          if(itemType === 'deal') setIsRanking(false);
        }
      }
    };

    performTopUp();

    return () => {
      isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems, initialLoadComplete, topUpAttempted, isLoading, isRanking, error, isAuthError, currentQueryFromUrl, loadedFromCacheTimestamp, itemType, CURATED_CACHE_KEY, toast]);


  // Fallback Background cache for OTHER item type
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

          const batchesPromises = keywordsForBgCache.map(kw => fetchItems(otherItemType, kw, true));
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

    performBackgroundCache();
    return () => {
      isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoadComplete, backgroundCacheAttempted, isLoading, isRanking, error, currentQueryFromUrl, isAuthError, itemType, OTHER_ITEM_TYPE_CURATED_CACHE_KEY, otherItemType, aiOtherTypeBackgroundCacheQuery]);

  // Proactive search cache for OTHER item type
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

        const fetchedOtherTypeItems = await fetchItems(otherItemType, query, false);
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
    performProactiveSearchCache();
    return () => {
      isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQueryFromUrl, initialLoadComplete, proactiveSearchCacheAttempted, isLoading, isRanking, error, isAuthError, itemType, OTHER_ITEM_TYPE_SEARCHED_CACHE_KEY_PREFIX, otherItemType, rankDealsAI, qualifyAuctionsAI]);


  const handleSearchSubmit = useCallback((query: string) => {
    const newPath = query ? `${pagePath}?q=${encodeURIComponent(query)}` : pagePath;
    router.push(newPath);
  }, [router, pagePath]);

  const handleLogoClick = useCallback(async () => {
    setInputValue('');
    sessionStorage.removeItem(CURATED_DEALS_CACHE_KEY);
    sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
    if (currentQueryFromUrl === '' && pagePath === (itemType === 'deal' ? '/' : '/auctions')) {
        setInitialLoadComplete(false);
        setTopUpAttempted(false);
        setBackgroundCacheAttempted(false);
        setProactiveSearchCacheAttempted(false);
        setLoadedFromCacheTimestamp(null);
        loadItems('');
    } else {
        router.push(itemType === 'deal' ? '/' : '/auctions');
    }
  }, [router, currentQueryFromUrl, itemType, pagePath, loadItems]);

  const handleLoadMore = () => {
    const newVisibleCount = visibleItemCount + ITEMS_PER_PAGE;
    setVisibleItemCount(newVisibleCount);
  };

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
        const itemToRemove = prevItems.find(item => item.id === endedItemId);
        if (itemToRemove) {
            endedItemTitleForToast = itemToRemove.title;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemType, currentQueryFromUrl, SEARCHED_AUCTIONS_CACHE_KEY_PREFIX, CURATED_AUCTIONS_CACHE_KEY, toast]);

  useEffect(() => {
    let activeItems = allItems;
    if (itemType === 'auction') {
        activeItems = allItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
    }
    setDisplayedItems(activeItems.slice(0, visibleItemCount));
  }, [allItems, visibleItemCount, itemType]);

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
    allItems,
    visibleItemCount,
    isLoading,
    isRanking,
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
    ITEMS_PER_PAGE,
  };
}
