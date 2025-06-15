
'use client';

import type React from 'react';
import { useState, useEffect, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppHeader } from '@/components/baybot/AppHeader';
import { AppFooter } from '@/components/dealscope/AppFooter';
import { ItemCard } from '@/components/baybot/ItemCard';
import { ItemGridLoadingSkeleton } from '@/components/baybot/LoadingSkeleton';
import { NoItemsMessage } from '@/components/baybot/atomic/NoItemsMessage';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShoppingBag, AlertTriangle, Info, Loader2 } from "lucide-react";
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

const AnalysisModal = dynamic(() =>
  import('@/components/baybot/AnalysisModal').then(mod => mod.AnalysisModal),
  { ssr: false, loading: () => <ItemGridLoadingSkeleton count={1} /> }
);

function HomePageContent() {
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
  const [backgroundAuctionCacheAttempted, setBackgroundAuctionCacheAttempted] = useState(false);
  const [proactiveSearchAuctionCacheAttempted, setProactiveSearchAuctionCacheAttempted] = useState(false);
  const [loadedFromCacheTimestamp, setLoadedFromCacheTimestamp] = useState<number | null>(null);


  useEffect(() => {
    setInputValue(currentQueryFromUrl);
    setInitialLoadComplete(false);
    setTopUpAttempted(false);
    setBackgroundAuctionCacheAttempted(false);
    setProactiveSearchAuctionCacheAttempted(false);
    setLoadedFromCacheTimestamp(null);
    loadItems(currentQueryFromUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQueryFromUrl]);


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

    let finalProcessedItems: DealScopeItem[] = [];
    let overallToastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;
    const currentCacheKey = isGlobalCuratedRequest ? CURATED_DEALS_CACHE_KEY : SEARCHED_DEALS_CACHE_KEY_PREFIX + queryToLoad;
    const currentCacheTTL = isGlobalCuratedRequest ? GLOBAL_CURATED_CACHE_TTL_MS : STANDARD_CACHE_TTL_MS;

    try {
      const cachedDataString = sessionStorage.getItem(currentCacheKey);
      if (cachedDataString) {
        const cachedData = JSON.parse(cachedDataString);
        if (cachedData && cachedData.items && Array.isArray(cachedData.items) && cachedData.items.length > 0 && (Date.now() - (cachedData.timestamp || 0) < currentCacheTTL)) {
          finalProcessedItems = cachedData.items;
          if (isGlobalCuratedRequest) {
            setLoadedFromCacheTimestamp(cachedData.timestamp);
          }
          overallToastMessage = { title: `Loaded Cached ${isGlobalCuratedRequest ? "Curated" : "Searched"} Deals`, description: `Displaying previously fetched deals${isGlobalCuratedRequest ? "" : ` for "${queryToLoad}"`}.` };
        } else {
          sessionStorage.removeItem(currentCacheKey);
        }
      }
    } catch (e) {
      console.warn(`[HomePage loadItems] Error reading/parsing cache for key "${currentCacheKey}":`, e);
      sessionStorage.removeItem(currentCacheKey);
    }

    if (finalProcessedItems.length === 0) {
      if (isGlobalCuratedRequest) {
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

              if (keywordsForThisBatch.length === 0) {
                break;
              }

              keywordsForThisBatch.forEach(kw => attemptedKeywordsInitialLoad.add(kw));

              const fetchedBatchesPromises = keywordsForThisBatch.map(kw => fetchItems('deal', kw, true));
              const fetchedBatchesResults = await Promise.allSettled(fetchedBatchesPromises);

              const newlyFetchedItemsInBatch = fetchedBatchesResults
                .filter(result => result.status === 'fulfilled')
                .flatMap(result => (result as PromiseFulfilledResult<DealScopeItem[]>).value);

              const currentAccumulatedIds = new Set(accumulatedRawEbayItems.map(item => item.id));
              const uniqueNewItemsForAccumulation = newlyFetchedItemsInBatch.filter(item => !currentAccumulatedIds.has(item.id));

              accumulatedRawEbayItems.push(...uniqueNewItemsForAccumulation);

              if (attemptedKeywordsInitialLoad.size >= MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS) {
                break;
              }
            }


            if (accumulatedRawEbayItems.length > 0) {
              const aiQualifiedAndRankedItems: DealScopeItem[] = await rankDealsAI(accumulatedRawEbayItems, "general curated deals");
              const aiCount = aiQualifiedAndRankedItems.length;

              finalProcessedItems = [...aiQualifiedAndRankedItems];

              if (aiCount < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiCount < accumulatedRawEbayItems.length) {
                const aiQualifiedIds = new Set(aiQualifiedAndRankedItems.map(d => d.id));
                const fallbackItems = accumulatedRawEbayItems.filter(d => !aiQualifiedIds.has(d.id));
                const numFallbacksToAdd = Math.max(0, MIN_DESIRED_CURATED_ITEMS - aiCount);
                finalProcessedItems.push(...fallbackItems.slice(0, numFallbacksToAdd));
                overallToastMessage = { title: "Curated Deals: AI Enhanced", description: `Displaying ${aiCount} AI-qualified deals, plus ${Math.min(fallbackItems.length, numFallbacksToAdd)} more.` };
              } else if (aiCount === 0 && accumulatedRawEbayItems.length > 0) {
                finalProcessedItems = accumulatedRawEbayItems.slice(0, MIN_DESIRED_CURATED_ITEMS);
                overallToastMessage = { title: "Curated Deals: Server Processed", description: `Displaying ${finalProcessedItems.length} server-processed deals. AI found no specific qualifications.` };
              } else if (aiCount > 0) {
                overallToastMessage = { title: "Curated Deals: AI Qualified", description: `Displaying ${aiCount} AI-qualified deals.` };
              } else {
                overallToastMessage = { title: "No Curated Deals", description: "Could not find any curated deals matching criteria." };
              }
            } else {
              overallToastMessage = { title: "No Curated Deals", description: "No deals found from initial iterative fetch." };
            }

           if (!backgroundAuctionCacheAttempted && !isAuthError) {
                setBackgroundAuctionCacheAttempted(true);
                (async () => {
                    try {
                        const cachedAuctions = sessionStorage.getItem(CURATED_AUCTIONS_CACHE_KEY);
                        if (cachedAuctions) {
                            const parsed = JSON.parse(cachedAuctions);
                            if (parsed.items && parsed.timestamp && (Date.now() - parsed.timestamp < GLOBAL_CURATED_CACHE_TTL_MS)) {
                                return;
                            }
                        }
                        const keywordsForBackgroundAuctionCache: string[] = [];
                        let uniqueKeywordSafety = 0;
                        const attemptedKeywordsBg = new Set<string>();
                        while (keywordsForBackgroundAuctionCache.length < KEYWORDS_FOR_PROACTIVE_BACKGROUND_CACHE && uniqueKeywordSafety < (curatedHomepageSearchTerms.length + 5)) {
                            const randomKw = await getRandomPopularSearchTerm();
                            if (randomKw && randomKw.trim() !== '' && !attemptedKeywordsBg.has(randomKw)) {
                                keywordsForBackgroundAuctionCache.push(randomKw);
                                attemptedKeywordsBg.add(randomKw);
                            }
                            uniqueKeywordSafety++;
                        }
                        if (keywordsForBackgroundAuctionCache.length === 0) { return; }

                        const auctionBatchesPromises = keywordsForBackgroundAuctionCache.map(kw => fetchItems('auction', kw, true));
                        const auctionBatchesResults = await Promise.allSettled(auctionBatchesPromises);
                        const successfulAuctionFetches = auctionBatchesResults
                            .filter(result => result.status === 'fulfilled')
                            .map(result => (result as PromiseFulfilledResult<DealScopeItem[]>).value);
                        const consolidatedAuctions = successfulAuctionFetches.flat();
                        const uniqueAuctionsMap = new Map<string, DealScopeItem>();
                        consolidatedAuctions.forEach(item => { if (!uniqueAuctionsMap.has(item.id)) uniqueAuctionsMap.set(item.id, item); });
                        const finalBackgroundAuctions = Array.from(uniqueAuctionsMap.values())
                            .filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : true);

                        if (finalBackgroundAuctions.length > 0) {
                           const aiQualifiedAuctions = await qualifyAuctionsAI(finalBackgroundAuctions, "general curated auctions background cache from deals");
                           sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: aiQualifiedAuctions, timestamp: Date.now() }));
                        }
                    } catch (e: any) {
                        console.warn("[HomePage BG Cache] Error during proactive GLOBAL CURATED auction caching:", e.message);
                    }
                })();
            }

        } catch (e: any) {
          let displayMessage = "Failed to load curated deals.";
           if (typeof e.message === 'string') {
            if (e.message.includes("invalid_client") || e.message.includes("Critical eBay API Authentication Failure")) {
              displayMessage = "Critical eBay API Authentication Failure. Check .env and server logs."; setIsAuthError(true);
            } else if (e.message.includes("OAuth") || e.message.includes("authenticate with eBay API")) {
              displayMessage = "eBay API Authentication Failed. Check credentials and server logs."; setIsAuthError(true);
            } else { displayMessage = e.message; }
          }
          setError(displayMessage);
          finalProcessedItems = [];
        } finally {
          setIsRanking(false);
        }
      } else { // Standard Search (not global curated)
        try {
          const fetchedItems: DealScopeItem[] = await fetchItems('deal', queryToLoad, false);

          if (fetchedItems.length > 0) {
            setIsRanking(true);
            const aiQualifiedAndRankedItems: DealScopeItem[] = await rankDealsAI(fetchedItems, queryToLoad);
            const aiCount = aiQualifiedAndRankedItems.length;
            setIsRanking(false);

            let sortedAiItems = [...aiQualifiedAndRankedItems];
            if (sortedAiItems.length > 0) {
                sortedAiItems.sort((a, b) => (b.discountPercentage || 0) - (a.discountPercentage || 0));
            }

            finalProcessedItems = [...sortedAiItems];

            if (aiCount < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiCount < fetchedItems.length) {
              const aiQualifiedIds = new Set(finalProcessedItems.map(d => d.id));
              const fallbackItems = fetchedItems.filter(d => !aiQualifiedIds.has(d.id));
              const numFallbacksToAdd = Math.max(0, MIN_DESIRED_CURATED_ITEMS - aiCount);
              finalProcessedItems.push(...fallbackItems.slice(0, numFallbacksToAdd));
              overallToastMessage = { title: "Deals: AI Enhanced & Sorted", description: `Displaying ${aiCount} AI-qualified deals for "${queryToLoad}" (highest discount first), plus ${Math.min(fallbackItems.length, numFallbacksToAdd)} more.` };
            } else if (aiCount > 0) {
              overallToastMessage = { title: "Deals: AI Qualified & Sorted", description: `Displaying ${aiCount} AI-qualified deals for "${queryToLoad}", sorted by highest discount.` };
            } else if (fetchedItems.length > 0) {
              const serverSortedFallback = [...fetchedItems].sort((a,b) => (b.discountPercentage || 0) - (a.discountPercentage || 0));
              finalProcessedItems = serverSortedFallback.slice(0, MIN_DESIRED_CURATED_ITEMS);
              overallToastMessage = { title: "Deals: Server Processed & Sorted", description: `Displaying server-processed deals for "${queryToLoad}", sorted by discount. AI found no further qualifications.` };
            } else {
               overallToastMessage = { title: "No Deals Found", description: `No deals found for "${queryToLoad}" after processing.` };
            }
          } else {
            overallToastMessage = { title: "No Deals Found", description: `No deals found for "${queryToLoad}" from server.` };
          }
        } catch (e: any) {
          let displayMessage = `Failed to load deals for "${queryToLoad}". Please try again.`;
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
          finalProcessedItems = [];
        } finally {
          setIsRanking(false);
        }
      }
    } else { // Loaded from cache
        if (isGlobalCuratedRequest && !backgroundAuctionCacheAttempted && !isAuthError) {
             setBackgroundAuctionCacheAttempted(true);
             (async () => {
                try {
                    const cachedAuctions = sessionStorage.getItem(CURATED_AUCTIONS_CACHE_KEY);
                    if (cachedAuctions) {
                        const parsed = JSON.parse(cachedAuctions);
                        if (parsed.items && parsed.timestamp && (Date.now() - parsed.timestamp < GLOBAL_CURATED_CACHE_TTL_MS)) {
                            return;
                        }
                    }
                    const keywordsForBackgroundAuctionCache: string[] = [];
                    let uniqueKeywordSafety = 0;
                    const attemptedKeywordsBg = new Set<string>();
                    while (keywordsForBackgroundAuctionCache.length < KEYWORDS_FOR_PROACTIVE_BACKGROUND_CACHE && uniqueKeywordSafety < (curatedHomepageSearchTerms.length + 5)) {
                        const randomKw = await getRandomPopularSearchTerm();
                        if (randomKw && randomKw.trim() !== '' && !attemptedKeywordsBg.has(randomKw)) {
                            keywordsForBackgroundAuctionCache.push(randomKw);
                            attemptedKeywordsBg.add(randomKw);
                        }
                        uniqueKeywordSafety++;
                    }
                    if (keywordsForBackgroundAuctionCache.length === 0) { return; }

                    const auctionBatchesPromises = keywordsForBackgroundAuctionCache.map(kw => fetchItems('auction', kw, true));
                    const auctionBatchesResults = await Promise.allSettled(auctionBatchesPromises);
                    const successfulAuctionFetches = auctionBatchesResults
                        .filter(result => result.status === 'fulfilled')
                        .map(result => (result as PromiseFulfilledResult<DealScopeItem[]>).value);
                    const consolidatedAuctions = successfulAuctionFetches.flat();
                    const uniqueAuctionsMap = new Map<string, DealScopeItem>();
                    consolidatedAuctions.forEach(item => { if (!uniqueAuctionsMap.has(item.id)) uniqueAuctionsMap.set(item.id, item); });
                    const finalBackgroundAuctions = Array.from(uniqueAuctionsMap.values())
                        .filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : true);

                    if (finalBackgroundAuctions.length > 0) {
                        const aiQualifiedAuctions = await qualifyAuctionsAI(finalBackgroundAuctions, "general curated auctions background cache from deals");
                        sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: aiQualifiedAuctions, timestamp: Date.now() }));
                    }
                } catch (e: any) {
                    console.warn("[HomePage BG Cache HIT] Error during proactive GLOBAL CURATED auction caching:", e.message);
                }
             })();
        }
    }


    setAllItems(finalProcessedItems);
    setIsLoading(false);
    setInitialLoadComplete(true);

    if (!error && finalProcessedItems.length > 0 ) {
      try {
        sessionStorage.setItem(currentCacheKey, JSON.stringify({ items: finalProcessedItems, timestamp: Date.now() }));
      } catch (e) {
        console.warn(`[HomePage loadItems] Error saving to sessionStorage for key "${currentCacheKey}":`, e);
      }
    }


    if (overallToastMessage && !error) {
      toast(overallToastMessage);
    } else if (error && !isAuthError) {
      toast({ title: "Error Loading Deals", description: error || "An unexpected error occurred.", variant: "destructive" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, isAuthError, currentQueryFromUrl]);

  useEffect(() => {
    const isGlobalCuratedView = !currentQueryFromUrl;
    const cacheIsStaleIshForSoftRefresh =
        loadedFromCacheTimestamp !== null &&
        (Date.now() - loadedFromCacheTimestamp > STALE_CACHE_THRESHOLD_FOR_SOFT_REFRESH_MS);

    if (
      isGlobalCuratedView &&
      initialLoadComplete &&
      !topUpAttempted &&
      !isLoading &&
      !isRanking &&
      !error &&
      !isAuthError &&
      (allItems.length < MIN_DESIRED_CURATED_ITEMS || (allItems.length > 0 && cacheIsStaleIshForSoftRefresh))
    ) {
      setTopUpAttempted(true);
      setIsLoading(true);
      setIsRanking(true);

      (async () => {
        try {
          const currentItemIds = new Set(allItems.map(item => item.id));
          const numAdditionalKeywords = Math.max(1, Math.floor(MAX_CURATED_FETCH_ATTEMPTS / 2) || 1);

          const additionalKeywordsToFetch: string[] = [];
          let uniqueKeywordSafety = 0;
          const attemptedKeywordsForTopUp = new Set<string>();

          while(additionalKeywordsToFetch.length < numAdditionalKeywords && uniqueKeywordSafety < (curatedHomepageSearchTerms.length + 5)) {
            const randomKw = await getRandomPopularSearchTerm();
            if(randomKw && randomKw.trim() !== '' && !attemptedKeywordsForTopUp.has(randomKw)){
              additionalKeywordsToFetch.push(randomKw);
              attemptedKeywordsForTopUp.add(randomKw);
            }
            uniqueKeywordSafety++;
          }

          if (additionalKeywordsToFetch.length === 0) {
              setIsLoading(false); setIsRanking(false);
              return;
          }

          const additionalFetchedBatchesPromises = additionalKeywordsToFetch.map(kw => fetchItems('deal', kw, true));
          const additionalFetchedBatchesResults = await Promise.allSettled(additionalFetchedBatchesPromises);

          const successfullyFetchedAdditionalItems = additionalFetchedBatchesResults
              .filter(res => res.status === 'fulfilled')
              .flatMap(res => (res as PromiseFulfilledResult<DealScopeItem[]>).value)
              .filter(item => !currentItemIds.has(item.id));

          if (successfullyFetchedAdditionalItems.length > 0) {
              const combinedItemsForRanking = [...allItems, ...successfullyFetchedAdditionalItems];
              const uniqueCombinedItemsMap = new Map(combinedItemsForRanking.map(item => [item.id, item]));
              const uniqueCombinedItemsList = Array.from(uniqueCombinedItemsMap.values());

              const finalToppedUpItems = await rankDealsAI(uniqueCombinedItemsList, "general curated deals top-up/soft refresh");

              setAllItems(finalToppedUpItems);
              sessionStorage.setItem(CURATED_DEALS_CACHE_KEY, JSON.stringify({ items: finalToppedUpItems, timestamp: Date.now() }));
              toast({ title: "Curated Deals Updated", description: `Displaying ${finalToppedUpItems.length} deals after refresh.` });
          } else {
              if(cacheIsStaleIshForSoftRefresh && allItems.length >= MIN_DESIRED_CURATED_ITEMS) {
                 toast({title: "Deals Refreshed", description: "Checked for new deals, list is up to date."})
              } else {
                 toast({title: "Deals Top-up", description: "No new deals found in this attempt."})
              }
          }
        } catch (e: any) {
          toast({ title: "Error Updating Deals", description: e.message || "Failed to fetch additional deals.", variant: "destructive" });
        } finally {
          setIsLoading(false);
          setIsRanking(false);
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems, initialLoadComplete, topUpAttempted, isLoading, isRanking, error, isAuthError, currentQueryFromUrl, toast, loadedFromCacheTimestamp]);

  useEffect(() => {
    const isGlobalCuratedView = !currentQueryFromUrl;
    if (isGlobalCuratedView && initialLoadComplete && !backgroundAuctionCacheAttempted && !isLoading && !isRanking && !error && !isAuthError) {
        setBackgroundAuctionCacheAttempted(true);
        (async () => {
             try {
                const cachedAuctions = sessionStorage.getItem(CURATED_AUCTIONS_CACHE_KEY);
                if (cachedAuctions) {
                    const parsed = JSON.parse(cachedAuctions);
                     if (parsed.items && parsed.timestamp && (Date.now() - parsed.timestamp < GLOBAL_CURATED_CACHE_TTL_MS)) {
                        return;
                    }
                }
                const keywordsForBackgroundAuctionCache: string[] = [];
                let uniqueKeywordSafety = 0;
                const attemptedKeywordsBg = new Set<string>();
                while(keywordsForBackgroundAuctionCache.length < KEYWORDS_FOR_PROACTIVE_BACKGROUND_CACHE && uniqueKeywordSafety < (curatedHomepageSearchTerms.length + 5)) {
                     const randomKw = await getRandomPopularSearchTerm();
                     if(randomKw && randomKw.trim() !== '' && !attemptedKeywordsBg.has(randomKw)) {
                         keywordsForBackgroundAuctionCache.push(randomKw);
                         attemptedKeywordsBg.add(randomKw);
                     }
                     uniqueKeywordSafety++;
                }
                if (keywordsForBackgroundAuctionCache.length === 0) { return; }

                const auctionBatchesPromises = keywordsForBackgroundAuctionCache.map(kw => fetchItems('auction', kw, true));
                const auctionBatchesResults = await Promise.allSettled(auctionBatchesPromises);
                const successfulAuctionFetches = auctionBatchesResults
                    .filter(result => result.status === 'fulfilled')
                    .map(result => (result as PromiseFulfilledResult<DealScopeItem[]>).value);
                const consolidatedAuctions = successfulAuctionFetches.flat();
                const uniqueAuctionsMap = new Map<string, DealScopeItem>();
                consolidatedAuctions.forEach(item => { if (!uniqueAuctionsMap.has(item.id)) uniqueAuctionsMap.set(item.id, item); });
                const finalBackgroundAuctions = Array.from(uniqueAuctionsMap.values())
                    .filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : true);

                if (finalBackgroundAuctions.length > 0) {
                    const aiQualifiedAuctions = await qualifyAuctionsAI(finalBackgroundAuctions, "general curated auctions background cache from deals");
                    sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: aiQualifiedAuctions, timestamp: Date.now() }));
                }
            } catch (e: any) {
                console.warn("[HomePage BG Cache Effect - Fallback] Error during proactive GLOBAL CURATED auction caching:", e.message);
            }
        })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems, initialLoadComplete, backgroundAuctionCacheAttempted, isLoading, isRanking, error, currentQueryFromUrl, isAuthError, loadedFromCacheTimestamp, toast]);


  useEffect(() => {
    const query = currentQueryFromUrl;
    if (query && initialLoadComplete && !proactiveSearchAuctionCacheAttempted && !isLoading && !isRanking && !error && !isAuthError) {
      setProactiveSearchAuctionCacheAttempted(true);
      (async () => {
        try {
          const searchedAuctionCacheKey = SEARCHED_AUCTIONS_CACHE_KEY_PREFIX + query;
          const cachedDataString = sessionStorage.getItem(searchedAuctionCacheKey);
          if (cachedDataString) {
            const cachedData = JSON.parse(cachedDataString);
            if (cachedData && cachedData.items && (Date.now() - (cachedData.timestamp || 0) < STANDARD_CACHE_TTL_MS)) {
              return;
            }
          }

          const fetchedAuctions = await fetchItems('auction', query, false);
          if (fetchedAuctions.length > 0) {
            const aiQualifiedAuctions = await qualifyAuctionsAI(fetchedAuctions, query);
            sessionStorage.setItem(searchedAuctionCacheKey, JSON.stringify({ items: aiQualifiedAuctions, timestamp: Date.now() }));
          }
        } catch (e: any) {
          console.warn(`[HomePage Proactive Search Cache] Error during proactive SEARCHED auction caching for query "${query}":`, e.message);
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQueryFromUrl, initialLoadComplete, proactiveSearchAuctionCacheAttempted, isLoading, isRanking, error, isAuthError, toast]);


  const handleSearchSubmit = useCallback((query: string) => {
    const newPath = query ? `/?q=${encodeURIComponent(query)}` : '/';
    router.push(newPath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const handleLogoClick = useCallback(async () => {
    setInputValue('');
    sessionStorage.removeItem(CURATED_DEALS_CACHE_KEY);
    sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
    if (currentQueryFromUrl === '') {
        setInitialLoadComplete(false);
        setTopUpAttempted(false);
        setBackgroundAuctionCacheAttempted(false);
        setProactiveSearchAuctionCacheAttempted(false);
        setLoadedFromCacheTimestamp(null);
        loadItems('');
    } else {
        router.push('/');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, currentQueryFromUrl, loadItems]);


  const handleLoadMore = () => {
    const newVisibleCount = visibleItemCount + ITEMS_PER_PAGE;
    setVisibleItemCount(newVisibleCount);
  };

  const handleAnalyzeItem = (item: DealScopeItem) => {
    setSelectedItemForAnalysis(item);
    setIsAnalysisModalOpen(true);
  };

  const handleKeywordSearchFromModal = (keyword: string) => {
    setIsAnalysisModalOpen(false);
    router.push(`/?q=${encodeURIComponent(keyword)}`);
  };

  useEffect(() => {
    setDisplayedItems(allItems.slice(0, visibleItemCount));
  }, [allItems, visibleItemCount]);


  let noItemsTitle = "No Deals Found";
  let noItemsDescription = currentQueryFromUrl
    ? `No deals found for "${currentQueryFromUrl}". Try adjusting your search.`
    : "No global curated deals available. Try a specific search or check back later!";

  if (allItems.length === 0 && !isLoading && !isRanking && !error && currentQueryFromUrl === '') {
      noItemsDescription = `We tried fetching curated deals but couldn't find enough. Try a specific search!`;
  }


  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader
        searchInputValue={inputValue}
        onSearchInputChange={setInputValue}
        onSearchSubmit={handleSearchSubmit}
        onLogoClick={handleLogoClick}
        isLoading={isLoading || isRanking}
      />
      <main className="flex-grow container mx-auto px-4 py-8">
        {error && (
          <Alert variant="destructive" className="mb-6">
            {isAuthError ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
            <AlertTitle>{isAuthError ? "Authentication Error" : "Error"}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {(isLoading || (isRanking && displayedItems.length === 0 && allItems.length === 0 )) && <ItemGridLoadingSkeleton count={ITEMS_PER_PAGE} /> }

        {!isLoading && !isRanking && displayedItems.length === 0 && !error && (
          <NoItemsMessage title={noItemsTitle} description={noItemsDescription} />
        )}

        {displayedItems.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
              {displayedItems.map(item => (
                <ItemCard key={item.id} item={item} onAnalyze={handleAnalyzeItem} />
              ))}
            </div>
            {visibleItemCount < allItems.length && (
              <div className="text-center">
                <Button onClick={handleLoadMore} size="lg" variant="outline">
                  <ShoppingBag className="mr-2 h-5 w-5" /> Load More Deals
                </Button>
              </div>
            )}
          </>
        )}
         {(isLoading || isRanking) && displayedItems.length > 0 && (
            <div className="text-center py-4 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin inline mr-2" />
                Loading more items...
            </div>
        )}
      </main>
      <AppFooter />
      {isAnalysisModalOpen && selectedItemForAnalysis && (
        <AnalysisModal
          item={selectedItemForAnalysis}
          isOpen={isAnalysisModalOpen}
          onClose={() => setIsAnalysisModalOpen(false)}
          onKeywordSearch={handleKeywordSearchFromModal}
        />
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<ItemGridLoadingSkeleton count={ITEMS_PER_PAGE} />}>
      <HomePageContent />
    </Suspense>
  );
}

    