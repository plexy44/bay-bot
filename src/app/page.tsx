
'use client';

import type React from 'react';
import { useState, useEffect, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppHeader } from '@/components/baybot/AppHeader';
import { ItemCard } from '@/components/baybot/ItemCard';
import { ItemGridLoadingSkeleton } from '@/components/baybot/LoadingSkeleton';
import { NoItemsMessage } from '@/components/baybot/atomic/NoItemsMessage';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShoppingBag, AlertTriangle, Info, Loader2 } from "lucide-react";
import type { BayBotItem } from '@/types';
import { fetchItems, getRandomPopularSearchTerm } from '@/services/ebay-api-service';
import { rankDeals as rankDealsAI } from '@/ai/flows/rank-deals';
import { qualifyAuctions as qualifyAuctionsAI } from '@/ai/flows/qualify-auctions';
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';
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
  const [displayedItems, setDisplayedItems] = useState<BayBotItem[]>([]);
  const [allItems, setAllItems] = useState<BayBotItem[]>([]);
  const [visibleItemCount, setVisibleItemCount] = useState(ITEMS_PER_PAGE);
  const [isLoading, setIsLoading] = useState(true);
  const [isRanking, setIsRanking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);

  const [selectedItemForAnalysis, setSelectedItemForAnalysis] = useState<BayBotItem | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

  const { toast } = useToast();

  // State flags for controlling fetching and caching logic
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [topUpAttempted, setTopUpAttempted] = useState(false);
  const [backgroundAuctionCacheAttempted, setBackgroundAuctionCacheAttempted] = useState(false);
  const [proactiveSearchAuctionCacheAttempted, setProactiveSearchAuctionCacheAttempted] = useState(false);
  const [loadedFromCacheTimestamp, setLoadedFromCacheTimestamp] = useState<number | null>(null);


  useEffect(() => {
    // This effect runs when the search query changes.
    // Reset all relevant state flags to ensure a clean slate for the new view (curated or searched).
    console.log(`[HomePage Query Change Effect] URL query changed to: "${currentQueryFromUrl}". Resetting load/cache flags.`);
    setInitialLoadComplete(false);
    setTopUpAttempted(false);
    setBackgroundAuctionCacheAttempted(false);
    setProactiveSearchAuctionCacheAttempted(false);
    setLoadedFromCacheTimestamp(null);
    setInputValue(currentQueryFromUrl);
    loadItems(currentQueryFromUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQueryFromUrl]); // loadItems is intentionally omitted based on previous fixes


  const loadItems = useCallback(async (queryToLoad: string) => {
    console.log(`[HomePage loadItems] Initiating. Query: "${queryToLoad}"`);
    const isGlobalCuratedRequest = queryToLoad === '';

    setAllItems([]);
    setDisplayedItems([]);
    setVisibleItemCount(ITEMS_PER_PAGE);
    setIsLoading(true);
    setIsRanking(false);
    setError(null);
    setIsAuthError(false);
    // loadedFromCacheTimestamp is reset by the URL change effect if query changes, or here if it's a direct call for the same query.
    if (!isGlobalCuratedRequest || currentQueryFromUrl !== queryToLoad) { // Reset if not global or query actually changed from current state
        setLoadedFromCacheTimestamp(null);
    }


    let finalProcessedItems: BayBotItem[] = [];
    let overallToastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;
    const currentCacheKey = isGlobalCuratedRequest ? CURATED_DEALS_CACHE_KEY : SEARCHED_DEALS_CACHE_KEY_PREFIX + queryToLoad;
    const currentCacheTTL = isGlobalCuratedRequest ? GLOBAL_CURATED_CACHE_TTL_MS : STANDARD_CACHE_TTL_MS;

    try {
      const cachedDataString = sessionStorage.getItem(currentCacheKey);
      if (cachedDataString) {
        const cachedData = JSON.parse(cachedDataString);
        if (cachedData && cachedData.items && Array.isArray(cachedData.items) && cachedData.items.length > 0 && (Date.now() - (cachedData.timestamp || 0) < currentCacheTTL)) {
          console.log(`[HomePage loadItems] CACHE HIT: Found ${cachedData.items.length} fresh items for key "${currentCacheKey}".`);
          finalProcessedItems = cachedData.items;
          if (isGlobalCuratedRequest) {
            setLoadedFromCacheTimestamp(cachedData.timestamp);
          }
          overallToastMessage = { title: `Loaded Cached ${isGlobalCuratedRequest ? "Curated" : "Searched"} Deals`, description: `Displaying previously fetched deals${isGlobalCuratedRequest ? "" : ` for "${queryToLoad}"`}.` };
        } else {
          console.log(`[HomePage loadItems] CACHE STALE/INVALID for key "${currentCacheKey}". Fetching fresh.`);
          sessionStorage.removeItem(currentCacheKey);
        }
      } else {
         console.log(`[HomePage loadItems] CACHE MISS for key "${currentCacheKey}".`);
      }
    } catch (e) {
      console.warn(`[HomePage loadItems] Error reading/parsing cache for key "${currentCacheKey}":`, e);
      sessionStorage.removeItem(currentCacheKey);
    }

    if (finalProcessedItems.length === 0) {
      if (isGlobalCuratedRequest) {
        console.log(`[HomePage loadItems] Curated deals: No valid cache. Starting iterative fresh fetch.`);
        setIsRanking(true);
        let accumulatedRawEbayItems: BayBotItem[] = [];
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
                console.log(`[HomePage loadItems] Curated (Iter ${currentBatchNumber}): No new unique keywords. Breaking.`);
                break;
              }

              keywordsForThisBatch.forEach(kw => attemptedKeywordsInitialLoad.add(kw));
              // console.log(`[HomePage loadItems] Curated (Iter ${currentBatchNumber}): Fetching for: "${keywordsForThisBatch.join('", "')}"`);

              const fetchedBatchesPromises = keywordsForThisBatch.map(kw => fetchItems('deal', kw, true));
              const fetchedBatchesResults = await Promise.allSettled(fetchedBatchesPromises);

              const newlyFetchedItemsInBatch = fetchedBatchesResults
                .filter(result => result.status === 'fulfilled')
                .flatMap(result => (result as PromiseFulfilledResult<BayBotItem[]>).value);

              const currentAccumulatedIds = new Set(accumulatedRawEbayItems.map(item => item.id));
              const uniqueNewItemsForAccumulation = newlyFetchedItemsInBatch.filter(item => !currentAccumulatedIds.has(item.id));

              accumulatedRawEbayItems.push(...uniqueNewItemsForAccumulation);
              // console.log(`[HomePage loadItems] Curated (Iter ${currentBatchNumber}): Added ${uniqueNewItemsForAccumulation.length} unique. Total raw: ${accumulatedRawEbayItems.length}. Keywords tried: ${attemptedKeywordsInitialLoad.size}`);

              if (attemptedKeywordsInitialLoad.size >= MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS) {
                console.log(`[HomePage loadItems] Curated: Reached max keywords limit (${MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS}).`);
                break;
              }
            }

            console.log(`[HomePage loadItems] Curated: Finished iterative fetch. Total raw: ${accumulatedRawEbayItems.length} from ${attemptedKeywordsInitialLoad.size} keywords.`);

            if (accumulatedRawEbayItems.length > 0) {
              const aiQualifiedAndRankedItems: BayBotItem[] = await rankDealsAI(accumulatedRawEbayItems, "general curated deals");
              const aiCount = aiQualifiedAndRankedItems.length;
              console.log(`[HomePage loadItems] Curated: AI qualified ${aiCount} from ${accumulatedRawEbayItems.length} raw.`);

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
                console.log("[HomePage loadItems] CURATED DEALS (CACHE MISS): Initiating proactive BG cache for GLOBAL CURATED auctions.");
                (async () => {
                    try {
                        const cachedAuctions = sessionStorage.getItem(CURATED_AUCTIONS_CACHE_KEY);
                        if (cachedAuctions) {
                            const parsed = JSON.parse(cachedAuctions);
                            if (parsed.items && parsed.timestamp && (Date.now() - parsed.timestamp < GLOBAL_CURATED_CACHE_TTL_MS)) {
                                // console.log("[HomePage BG Cache] Fresh GLOBAL CURATED auctions already in cache. Skipping.");
                                return;
                            }
                        }
                        // console.log("[HomePage BG Cache] No fresh GLOBAL CURATED auctions. Fetching.");
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
                            .map(result => (result as PromiseFulfilledResult<BayBotItem[]>).value);
                        const consolidatedAuctions = successfulAuctionFetches.flat();
                        const uniqueAuctionsMap = new Map<string, BayBotItem>();
                        consolidatedAuctions.forEach(item => { if (!uniqueAuctionsMap.has(item.id)) uniqueAuctionsMap.set(item.id, item); });
                        const finalBackgroundAuctions = Array.from(uniqueAuctionsMap.values())
                            .filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : true);

                        if (finalBackgroundAuctions.length > 0) {
                            sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: finalBackgroundAuctions, timestamp: Date.now() }));
                            console.log(`[HomePage BG Cache] Proactively cached ${finalBackgroundAuctions.length} GLOBAL CURATED auctions.`);
                        }
                    } catch (e: any) {
                        console.error("[HomePage BG Cache] Error during proactive GLOBAL CURATED auction caching:", e);
                    }
                })();
            }

        } catch (e: any) {
          console.error(`[HomePage loadItems] Error during iterative fetch for curated deals:`, e);
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
        console.log(`[HomePage loadItems] User search. eBay Query: "${queryToLoad}"`);
        try {
          const fetchedItems: BayBotItem[] = await fetchItems('deal', queryToLoad, false);
          // console.log(`[HomePage loadItems] Fetched ${fetchedItems.length} items for query "${queryToLoad}".`);

          if (fetchedItems.length > 0) {
            setIsRanking(true);
            const aiQualifiedAndRankedItems: BayBotItem[] = await rankDealsAI(fetchedItems, queryToLoad);
            const aiCount = aiQualifiedAndRankedItems.length;
            setIsRanking(false);

            let sortedAiItems = [...aiQualifiedAndRankedItems];
            if (sortedAiItems.length > 0) {
                sortedAiItems.sort((a, b) => (b.discountPercentage || 0) - (a.discountPercentage || 0));
                // console.log(`[HomePage loadItems] Sorted ${sortedAiItems.length} AI-qualified deals by discount for query "${queryToLoad}".`);
            }

            finalProcessedItems = [...sortedAiItems];
            console.log(`[HomePage loadItems] AI qualified and ranked ${aiCount} deals for query "${queryToLoad}".`);

            if (aiCount < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiCount < fetchedItems.length) {
              const aiQualifiedIds = new Set(finalProcessedItems.map(d => d.id));
              const fallbackItems = fetchedItems.filter(d => !aiQualifiedIds.has(d.id));
              const numFallbacksToAdd = Math.max(0, MIN_DESIRED_CURATED_ITEMS - aiCount);
              finalProcessedItems.push(...fallbackItems.slice(0, numFallbacksToAdd));
              // console.log(`[HomePage loadItems] Appending ${Math.min(fallbackItems.length, numFallbacksToAdd)} fallback deals.`);
              overallToastMessage = { title: "Deals: AI Enhanced & Sorted", description: `Displaying ${aiCount} AI-qualified deals for "${queryToLoad}" (highest discount first), plus ${Math.min(fallbackItems.length, numFallbacksToAdd)} more.` };
            } else if (aiCount > 0) {
              overallToastMessage = { title: "Deals: AI Qualified & Sorted", description: `Displaying ${aiCount} AI-qualified deals for "${queryToLoad}", sorted by highest discount.` };
            } else if (fetchedItems.length > 0) {
              const serverSortedFallback = [...fetchedItems].sort((a,b) => (b.discountPercentage || 0) - (a.discountPercentage || 0));
              finalProcessedItems = serverSortedFallback.slice(0, MIN_DESIRED_CURATED_ITEMS);
              overallToastMessage = { title: "Deals: Server Processed & Sorted", description: `Displaying server-processed deals for "${queryToLoad}", sorted by discount. AI found no further qualifications.` };
              console.warn(`[HomePage loadItems] AI returned no items for query "${queryToLoad}". Using server-sorted fallback (${finalProcessedItems.length} items).`);
            } else {
               overallToastMessage = { title: "No Deals Found", description: `No deals found for "${queryToLoad}" after processing.` };
            }
          } else {
            overallToastMessage = { title: "No Deals Found", description: `No deals found for "${queryToLoad}" from server.` };
            // console.log(`[HomePage loadItems] No items fetched for query "${queryToLoad}".`);
          }
        } catch (e: any) {
          console.error(`[HomePage loadItems] Failed to load items for query '${queryToLoad}'. Error:`, e);
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
    } else {
        // console.log(`[HomePage loadItems] Using ${finalProcessedItems.length} items from CACHE for key "${currentCacheKey}".`);
        if (isGlobalCuratedRequest && !backgroundAuctionCacheAttempted && !isAuthError) {
             setBackgroundAuctionCacheAttempted(true);
             console.log("[HomePage loadItems] CURATED DEALS (CACHE HIT): Initiating proactive BG cache for GLOBAL CURATED auctions.");
             (async () => {
                try {
                    const cachedAuctions = sessionStorage.getItem(CURATED_AUCTIONS_CACHE_KEY);
                    if (cachedAuctions) {
                        const parsed = JSON.parse(cachedAuctions);
                        if (parsed.items && parsed.timestamp && (Date.now() - parsed.timestamp < GLOBAL_CURATED_CACHE_TTL_MS)) {
                            // console.log("[HomePage BG Cache HIT] Fresh GLOBAL CURATED auctions already in cache. Skipping.");
                            return;
                        }
                    }
                    // console.log("[HomePage BG Cache HIT] No fresh GLOBAL CURATED auctions. Fetching.");
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
                        .map(result => (result as PromiseFulfilledResult<BayBotItem[]>).value);
                    const consolidatedAuctions = successfulAuctionFetches.flat();
                    const uniqueAuctionsMap = new Map<string, BayBotItem>();
                    consolidatedAuctions.forEach(item => { if (!uniqueAuctionsMap.has(item.id)) uniqueAuctionsMap.set(item.id, item); });
                    const finalBackgroundAuctions = Array.from(uniqueAuctionsMap.values())
                        .filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : true);

                    if (finalBackgroundAuctions.length > 0) {
                        sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: finalBackgroundAuctions, timestamp: Date.now() }));
                        console.log(`[HomePage BG Cache HIT] Proactively cached ${finalBackgroundAuctions.length} GLOBAL CURATED auctions.`);
                    }
                } catch (e: any) {
                    console.error("[HomePage BG Cache HIT] Error during proactive GLOBAL CURATED auction caching:", e);
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
        // console.log(`[HomePage loadItems] Saved ${finalProcessedItems.length} items to sessionStorage for key "${currentCacheKey}".`);
      } catch (e) {
        console.warn(`[HomePage loadItems] Error saving to sessionStorage for key "${currentCacheKey}":`, e);
      }
    }


    if (overallToastMessage && !error) {
      toast(overallToastMessage);
    } else if (error && !isAuthError) {
      toast({ title: "Error Loading Deals", description: error || "An unexpected error occurred.", variant: "destructive" });
    }
    // console.log(`[HomePage loadItems] Finalizing. Items for state: ${finalProcessedItems.length} for query "${queryToLoad}".`);
  }, [toast, isAuthError, currentQueryFromUrl]); // Removed backgroundAuctionCacheAttempted as it's managed by loadItems now

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
      console.log(`[HomePage Top-Up/Soft Refresh] Conditions met. Items: ${allItems.length}. Stale cache: ${cacheIsStaleIshForSoftRefresh}.`);
      setTopUpAttempted(true); // Prevent multiple top-ups for the same load
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
              console.warn("[HomePage Top-Up/Soft Refresh] No valid additional unique keywords. Aborting.");
              setIsLoading(false); setIsRanking(false);
              return;
          }

          // console.log(`[HomePage Top-Up/Soft Refresh] Fetching deals for ${additionalKeywordsToFetch.length} additional keywords: ${additionalKeywordsToFetch.join(', ')}`);
          const additionalFetchedBatchesPromises = additionalKeywordsToFetch.map(kw => fetchItems('deal', kw, true));
          const additionalFetchedBatchesResults = await Promise.allSettled(additionalFetchedBatchesPromises);

          const successfullyFetchedAdditionalItems = additionalFetchedBatchesResults
              .filter(res => res.status === 'fulfilled')
              .flatMap(res => (res as PromiseFulfilledResult<BayBotItem[]>).value)
              .filter(item => !currentItemIds.has(item.id));

          if (successfullyFetchedAdditionalItems.length > 0) {
              // console.log(`[HomePage Top-Up/Soft Refresh] Fetched ${successfullyFetchedAdditionalItems.length} new unique additional deals.`);
              const combinedItemsForRanking = [...allItems, ...successfullyFetchedAdditionalItems];
              const uniqueCombinedItemsMap = new Map(combinedItemsForRanking.map(item => [item.id, item]));
              const uniqueCombinedItemsList = Array.from(uniqueCombinedItemsMap.values());

              // console.log(`[HomePage Top-Up/Soft Refresh] Total unique items for AI re-ranking: ${uniqueCombinedItemsList.length}`);
              const finalToppedUpItems = await rankDealsAI(uniqueCombinedItemsList, "general curated deals top-up/soft refresh");

              setAllItems(finalToppedUpItems);
              sessionStorage.setItem(CURATED_DEALS_CACHE_KEY, JSON.stringify({ items: finalToppedUpItems, timestamp: Date.now() }));
              toast({ title: "Curated Deals Updated", description: `Displaying ${finalToppedUpItems.length} deals after refresh.` });
          } else {
              // console.log(`[HomePage Top-Up/Soft Refresh] No new additional deals found.`);
              if(cacheIsStaleIshForSoftRefresh && allItems.length >= MIN_DESIRED_CURATED_ITEMS) {
                 toast({title: "Deals Refreshed", description: "Checked for new deals, list is up to date."})
              } else {
                 toast({title: "Deals Top-up", description: "No new deals found in this attempt."})
              }
          }
        } catch (e: any) {
          console.error("[HomePage Top-Up/Soft Refresh] Error:", e);
          toast({ title: "Error Updating Deals", description: e.message || "Failed to fetch additional deals.", variant: "destructive" });
        } finally {
          setIsLoading(false);
          setIsRanking(false);
        }
      })();
    }
  }, [allItems, initialLoadComplete, topUpAttempted, isLoading, isRanking, error, isAuthError, currentQueryFromUrl, toast, loadedFromCacheTimestamp]);

  // Fallback: Background cache for Global Curated Auctions IF deals were loaded from cache by loadItems
  useEffect(() => {
    const isGlobalCuratedView = !currentQueryFromUrl;
    if (isGlobalCuratedView && initialLoadComplete && loadedFromCacheTimestamp && !backgroundAuctionCacheAttempted && !isLoading && !isRanking && !error && !isAuthError) {
        setBackgroundAuctionCacheAttempted(true);
        console.log("[HomePage BG Cache Effect - Fallback] Conditions met for pre-caching GLOBAL CURATED auctions.");
        (async () => {
             try {
                const cachedAuctions = sessionStorage.getItem(CURATED_AUCTIONS_CACHE_KEY);
                if (cachedAuctions) {
                    const parsed = JSON.parse(cachedAuctions);
                     if (parsed.items && parsed.timestamp && (Date.now() - parsed.timestamp < GLOBAL_CURATED_CACHE_TTL_MS)) {
                        // console.log("[HomePage BG Cache Effect - Fallback] Fresh GLOBAL CURATED auctions already in cache. Skipping.");
                        return;
                    }
                }
                // console.log("[HomePage BG Cache Effect - Fallback] No fresh GLOBAL CURATED auctions in cache. Initiating fetch.");
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
                    .map(result => (result as PromiseFulfilledResult<BayBotItem[]>).value);
                const consolidatedAuctions = successfulAuctionFetches.flat();
                const uniqueAuctionsMap = new Map<string, BayBotItem>();
                consolidatedAuctions.forEach(item => { if (!uniqueAuctionsMap.has(item.id)) uniqueAuctionsMap.set(item.id, item); });
                const finalBackgroundAuctions = Array.from(uniqueAuctionsMap.values())
                    .filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : true);

                if (finalBackgroundAuctions.length > 0) {
                    const aiQualifiedAuctions = await qualifyAuctionsAI(finalBackgroundAuctions, "general curated auctions background cache from deals");
                    sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: aiQualifiedAuctions, timestamp: Date.now() }));
                    console.log(`[HomePage BG Cache Effect - Fallback] Proactively cached ${aiQualifiedAuctions.length} AI-qualified GLOBAL CURATED auctions.`);
                }
            } catch (e: any) {
                console.error("[HomePage BG Cache Effect - Fallback] Error during proactive GLOBAL CURATED auction caching:", e);
            }
        })();
    }
  }, [allItems, initialLoadComplete, backgroundAuctionCacheAttempted, isLoading, isRanking, error, currentQueryFromUrl, isAuthError, loadedFromCacheTimestamp]);


  // Proactive cache for SEARCHED auctions (if current page is deals search results)
  useEffect(() => {
    const query = currentQueryFromUrl;
    if (query && initialLoadComplete && !proactiveSearchAuctionCacheAttempted && !isLoading && !isRanking && !error && !isAuthError) {
      setProactiveSearchAuctionCacheAttempted(true);
      console.log(`[HomePage Proactive Search Cache] Conditions met for pre-caching SEARCHED auctions for query: "${query}"`);
      (async () => {
        try {
          const searchedAuctionCacheKey = SEARCHED_AUCTIONS_CACHE_KEY_PREFIX + query;
          const cachedDataString = sessionStorage.getItem(searchedAuctionCacheKey);
          if (cachedDataString) {
            const cachedData = JSON.parse(cachedDataString);
            if (cachedData && cachedData.items && (Date.now() - (cachedData.timestamp || 0) < STANDARD_CACHE_TTL_MS)) {
              // console.log(`[HomePage Proactive Search Cache] Fresh SEARCHED auctions for query "${query}" already in cache. Skipping.`);
              return;
            }
          }
          // console.log(`[HomePage Proactive Search Cache] No fresh SEARCHED auctions in cache for query "${query}". Fetching.`);

          const fetchedAuctions = await fetchItems('auction', query, false);
          if (fetchedAuctions.length > 0) {
            const aiQualifiedAuctions = await qualifyAuctionsAI(fetchedAuctions, query);
            sessionStorage.setItem(searchedAuctionCacheKey, JSON.stringify({ items: aiQualifiedAuctions, timestamp: Date.now() }));
            console.log(`[HomePage Proactive Search Cache] Proactively cached ${aiQualifiedAuctions.length} AI-qualified SEARCHED auctions for query "${query}".`);
          }
        } catch (e: any) {
          console.error(`[HomePage Proactive Search Cache] Error during proactive SEARCHED auction caching for query "${query}":`, e);
        }
      })();
    }
  }, [currentQueryFromUrl, initialLoadComplete, proactiveSearchAuctionCacheAttempted, isLoading, isRanking, error, isAuthError]);


  const handleSearchSubmit = useCallback((query: string) => {
    const newPath = query ? `/?q=${encodeURIComponent(query)}` : '/';
    router.push(newPath);
  }, [router]);

  const handleLogoClick = useCallback(async () => {
    console.log('[HomePage handleLogoClick] Logo clicked. Clearing global curated caches and navigating to homepage.');
    sessionStorage.removeItem(CURATED_DEALS_CACHE_KEY);
    sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
    if (currentQueryFromUrl === '') { // If already on curated homepage, force reload of data
        loadItems('');
    } else {
        router.push('/'); // This will trigger the query change effect
    }
  }, [router, currentQueryFromUrl, loadItems]);


  const handleLoadMore = () => {
    const newVisibleCount = visibleItemCount + ITEMS_PER_PAGE;
    setVisibleItemCount(newVisibleCount);
  };

  const handleAnalyzeItem = (item: BayBotItem) => {
    setSelectedItemForAnalysis(item);
    setIsAnalysisModalOpen(true);
  };

  const handleKeywordSearchFromModal = (keyword: string) => {
    setIsAnalysisModalOpen(false);
    // setInputValue(keyword); // This will be set by the URL change effect
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
      <footer className="sticky bottom-0 z-10 h-16 flex items-center text-center border-t border-border/40 bg-background/60 backdrop-blur-lg text-sm text-muted-foreground">
        <div className="container mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 sm:gap-0">
          <p>&copy; {new Date().getFullYear()} BayBot. All rights reserved.</p>
          <ThemeToggle />
        </div>
      </footer>
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
