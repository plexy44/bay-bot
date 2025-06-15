
'use client';

import type React from 'react';
import { useState, useEffect, useCallback, Suspense }
  from 'react';
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
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  CURATED_AUCTIONS_CACHE_KEY,
  CURATED_DEALS_CACHE_KEY,
  MIN_DESIRED_CURATED_ITEMS,
  MAX_CURATED_FETCH_ATTEMPTS,
  GLOBAL_CURATED_CACHE_TTL_MS,
  STANDARD_CACHE_TTL_MS,
  KEYWORDS_FOR_PROACTIVE_BACKGROUND_CACHE,
  SEARCHED_AUCTIONS_CACHE_KEY_PREFIX,
  SEARCHED_DEALS_CACHE_KEY_PREFIX,
  curatedHomepageSearchTerms
} from '@/lib/constants';
import { qualifyAuctions as qualifyAuctionsAI } from '@/ai/flows/qualify-auctions';
import { rankDeals as rankDealsAI } from '@/ai/flows/rank-deals';

const ITEMS_PER_PAGE = 8;

const AnalysisModal = dynamic(() =>
  import('@/components/baybot/AnalysisModal').then(mod => mod.AnalysisModal),
  { ssr: false, loading: () => <ItemGridLoadingSkeleton count={1} /> }
);

function AuctionsPageContent() {
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
  const [backgroundDealsCacheAttempted, setBackgroundDealsCacheAttempted] = useState(false);
  const [proactiveSearchDealsCacheAttempted, setProactiveSearchDealsCacheAttempted] = useState(false);
  // loadedFromCacheTimestamp is not strictly needed for auctions as they don't have a "soft refresh" like deals

  useEffect(() => {
    // This effect runs when the search query changes.
    // Reset all relevant state flags to ensure a clean slate for the new view (curated or searched).
    console.log(`[AuctionsPage Query Change Effect] URL query changed to: "${currentQueryFromUrl}". Resetting load/cache flags.`);
    setInitialLoadComplete(false);
    setTopUpAttempted(false);
    setBackgroundDealsCacheAttempted(false);
    setProactiveSearchDealsCacheAttempted(false);
    setInputValue(currentQueryFromUrl);
    loadItems(currentQueryFromUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQueryFromUrl]); // loadItems is intentionally omitted

  const loadItems = useCallback(async (queryToLoad: string) => {
    console.log(`[AuctionsPage loadItems] Initiating. Query: "${queryToLoad}"`);
    const isGlobalCuratedRequest = queryToLoad === '';

    setAllItems([]);
    setDisplayedItems([]);
    setVisibleItemCount(ITEMS_PER_PAGE);
    setIsLoading(true);
    setIsRanking(false);
    setError(null);
    setIsAuthError(false);

    let processedItemsForState: BayBotItem[] = [];
    let overallToastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;
    const currentCacheKey = isGlobalCuratedRequest ? CURATED_AUCTIONS_CACHE_KEY : SEARCHED_AUCTIONS_CACHE_KEY_PREFIX + queryToLoad;
    const currentCacheTTL = isGlobalCuratedRequest ? GLOBAL_CURATED_CACHE_TTL_MS : STANDARD_CACHE_TTL_MS;

    try {
      const cachedDataString = sessionStorage.getItem(currentCacheKey);
      if (cachedDataString) {
        const cachedData = JSON.parse(cachedDataString);
        if (cachedData && cachedData.items && Array.isArray(cachedData.items) && (Date.now() - (cachedData.timestamp || 0) < currentCacheTTL)) {
          const activeCachedItems = (cachedData.items as BayBotItem[] || []).filter(item =>
            item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false
          );
          if (activeCachedItems.length > 0) {
            console.log(`[AuctionsPage loadItems] CACHE HIT: Found ${activeCachedItems.length} active items for key "${currentCacheKey}".`);
            processedItemsForState = activeCachedItems;
            overallToastMessage = { title: `Loaded Cached ${isGlobalCuratedRequest ? "Curated" : "Searched"} Auctions`, description: `Displaying previously fetched active auctions${isGlobalCuratedRequest ? "" : ` for "${queryToLoad}"`}.` };
          } else {
            sessionStorage.removeItem(currentCacheKey);
            console.log(`[AuctionsPage loadItems] CACHE STALE/INACTIVE for key "${currentCacheKey}". Cleared.`);
          }
        } else {
          sessionStorage.removeItem(currentCacheKey);
          console.log(`[AuctionsPage loadItems] CACHE STALE/INVALID for key "${currentCacheKey}". Cleared.`);
        }
      } else {
          console.log(`[AuctionsPage loadItems] CACHE MISS for key "${currentCacheKey}".`);
      }
    } catch (e) {
      console.warn(`[AuctionsPage loadItems] Error with sessionStorage for key "${currentCacheKey}":`, e);
      sessionStorage.removeItem(currentCacheKey);
    }

    if (processedItemsForState.length === 0) {
      if (isGlobalCuratedRequest) {
        console.log(`[AuctionsPage loadItems] Curated auctions: No valid cache. Starting robust initial fetch.`);
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
          console.warn("[AuctionsPage loadItems] Curated (Initial): Failed to get any unique keywords.");
          setError("Could not find keywords for curated auctions.");
        } else {
          // console.log(`[AuctionsPage loadItems] Curated (Initial): Fetching for ${initialKeywordsToFetch.length} keywords: ${initialKeywordsToFetch.join(', ')}.`);

          const initialFetchPromises = initialKeywordsToFetch.map(kw =>
            fetchItems('auction', kw, true).catch(e => {
              console.error(`[AuctionsPage loadItems] Error fetching auctions for keyword "${kw}":`, e);
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
        if (isAuthError && processedItemsForState.length === 0) {
          setError("Critical eBay API Authentication Failure. Check .env and server logs.");
        } else if (!isAuthError && processedItemsForState.length === 0 && initialKeywordsToFetch.length > 0) {
          setError("Failed to fetch curated auctions. Please try again.");
        }

        if (isGlobalCuratedRequest && !backgroundDealsCacheAttempted && !isAuthError) {
            setBackgroundDealsCacheAttempted(true);
            console.log("[AuctionsPage loadItems] CURATED AUCTIONS (CACHE MISS): Initiating proactive BG cache for GLOBAL CURATED deals.");
            (async () => {
                try {
                    const cachedDeals = sessionStorage.getItem(CURATED_DEALS_CACHE_KEY);
                    if (cachedDeals) {
                        const parsed = JSON.parse(cachedDeals);
                        if (parsed.items && parsed.timestamp && (Date.now() - parsed.timestamp < GLOBAL_CURATED_CACHE_TTL_MS)) {
                            // console.log("[AuctionsPage BG Cache] Fresh GLOBAL CURATED deals already in cache. Skipping.");
                            return;
                        }
                    }
                    // console.log("[AuctionsPage BG Cache] No fresh GLOBAL CURATED deals. Fetching.");
                    const keywordsForBackgroundDealsCache: string[] = [];
                    let uniqueKwSafety = 0;
                    const attemptedKwsBg = new Set<string>();
                    while (keywordsForBackgroundDealsCache.length < KEYWORDS_FOR_PROACTIVE_BACKGROUND_CACHE && uniqueKwSafety < (curatedHomepageSearchTerms.length + 5)) {
                        const rKw = await getRandomPopularSearchTerm();
                        if (rKw && rKw.trim() !== '' && !attemptedKwsBg.has(rKw)) {
                            keywordsForBackgroundDealsCache.push(rKw);
                            attemptedKwsBg.add(rKw);
                        }
                        uniqueKwSafety++;
                    }
                    if (keywordsForBackgroundDealsCache.length === 0) { return; }

                    const dealBatchesPromises = keywordsForBackgroundDealsCache.map(kw => fetchItems('deal', kw, true));
                    const dealBatchesResults = await Promise.allSettled(dealBatchesPromises);
                    const successfulDealFetches = dealBatchesResults.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<BayBotItem[]>).value);
                    const consolidatedDeals = successfulDealFetches.flat();
                    const uniqueDealsMap = new Map(consolidatedDeals.map(i => [i.id, i]));
                    const uniqueDeals = Array.from(uniqueDealsMap.values());

                    if (uniqueDeals.length > 0) {
                        const aiRankedDeals = await rankDealsAI(uniqueDeals, "general curated deals background cache from auctions");
                        sessionStorage.setItem(CURATED_DEALS_CACHE_KEY, JSON.stringify({ items: aiRankedDeals, timestamp: Date.now() }));
                        console.log(`[AuctionsPage BG Cache] Proactively cached ${aiRankedDeals.length} AI-ranked GLOBAL CURATED deals.`);
                    }
                } catch (e: any) {
                    console.error("[AuctionsPage BG Cache] Error during proactive GLOBAL CURATED deals caching:", e);
                }
            })();
        }

      } else { // User Search for Auctions
        console.log(`[AuctionsPage loadItems] User auction search. eBay Query: "${queryToLoad}"`);
        let fetchedItemsFromServer: BayBotItem[] = [];
        try {
          fetchedItemsFromServer = await fetchItems('auction', queryToLoad, false);
          const activeFetchedItems = fetchedItemsFromServer.filter(item =>
            item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false
          );

          if (activeFetchedItems.length > 0) {
            // console.log(`[AuctionsPage loadItems] Fetched ${activeFetchedItems.length} active auctions for query "${queryToLoad}". Passing to AI.`);
            setIsRanking(true);
            const aiQualifiedAuctions = await qualifyAuctionsAI(activeFetchedItems, queryToLoad);
            console.log(`[AuctionsPage loadItems] AI Qualification for query "${queryToLoad}" returned ${aiQualifiedAuctions.length} items (from ${activeFetchedItems.length} inputs).`);
            setIsRanking(false);
            processedItemsForState = aiQualifiedAuctions;

            if (aiQualifiedAuctions.length > 0) {
              overallToastMessage = { title: "Searched Auctions: AI Qualified", description: `Displaying ${aiQualifiedAuctions.length} AI-qualified auctions for "${queryToLoad}".` };
            } else {
              overallToastMessage = { title: "No Auctions Found by AI", description: `AI found no suitable auctions for "${queryToLoad}" from ${activeFetchedItems.length} fetched. Displaying server results if any.` };
            }
          } else {
            overallToastMessage = { title: "No Auctions Found", description: `No active auctions found for "${queryToLoad}".` };
            // console.log(`[AuctionsPage loadItems] No active auctions fetched from server for query "${queryToLoad}".`);
          }
        } catch (e: any) {
          console.error(`[AuctionsPage loadItems] Failed to load auctions for query '${queryToLoad}'. Error:`, e);
          let displayMessage = `Failed to load auctions for "${queryToLoad}". Please try again.`;
          if (typeof e.message === 'string') {
            if (e.message.includes("invalid_client") || e.message.includes("Critical eBay API Authentication Failure")) {
              displayMessage = "Critical eBay API Authentication Failure. Check .env and server logs."; setIsAuthError(true);
            } else if (e.message.includes("OAuth") || e.message.includes("authenticate with eBay API")) {
              displayMessage = "eBay API Authentication Failed. Check credentials and server logs."; setIsAuthError(true);
            } else { displayMessage = e.message; }
          }
          setError(displayMessage);
          processedItemsForState = [];
        }
      }
    } else { // Loaded from cache path
        // console.log(`[AuctionsPage loadItems] Using ${processedItemsForState.length} items from CACHE for key "${currentCacheKey}".`);
        if (isGlobalCuratedRequest && !backgroundDealsCacheAttempted && !isAuthError) {
             setBackgroundDealsCacheAttempted(true);
             console.log("[AuctionsPage loadItems] CURATED AUCTIONS (CACHE HIT): Initiating proactive BG cache for GLOBAL CURATED deals.");
            (async () => {
                try {
                    const cachedDeals = sessionStorage.getItem(CURATED_DEALS_CACHE_KEY);
                    if (cachedDeals) {
                        const parsed = JSON.parse(cachedDeals);
                        if (parsed.items && parsed.timestamp && (Date.now() - parsed.timestamp < GLOBAL_CURATED_CACHE_TTL_MS)) {
                            // console.log("[AuctionsPage BG Cache HIT] Fresh GLOBAL CURATED deals already in cache. Skipping.");
                            return;
                        }
                    }
                    // console.log("[AuctionsPage BG Cache HIT] No fresh GLOBAL CURATED deals. Fetching.");
                    const keywordsForBackgroundDealsCache: string[] = [];
                    let uniqueKwSafety = 0;
                    const attemptedKwsBg = new Set<string>();
                    while (keywordsForBackgroundDealsCache.length < KEYWORDS_FOR_PROACTIVE_BACKGROUND_CACHE && uniqueKwSafety < (curatedHomepageSearchTerms.length + 5)) {
                        const rKw = await getRandomPopularSearchTerm();
                        if (rKw && rKw.trim() !== '' && !attemptedKwsBg.has(rKw)) {
                            keywordsForBackgroundDealsCache.push(rKw);
                            attemptedKwsBg.add(rKw);
                        }
                        uniqueKwSafety++;
                    }
                    if (keywordsForBackgroundDealsCache.length === 0) { return; }

                    const dealBatchesPromises = keywordsForBackgroundDealsCache.map(kw => fetchItems('deal', kw, true));
                    const dealBatchesResults = await Promise.allSettled(dealBatchesPromises);
                    const successfulDealFetches = dealBatchesResults.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<BayBotItem[]>).value);
                    const consolidatedDeals = successfulDealFetches.flat();
                    const uniqueDealsMap = new Map(consolidatedDeals.map(i => [i.id, i]));
                    const uniqueDeals = Array.from(uniqueDealsMap.values());

                    if (uniqueDeals.length > 0) {
                        const aiRankedDeals = await rankDealsAI(uniqueDeals, "general curated deals background cache from auctions");
                        sessionStorage.setItem(CURATED_DEALS_CACHE_KEY, JSON.stringify({ items: aiRankedDeals, timestamp: Date.now() }));
                        console.log(`[AuctionsPage BG Cache HIT] Proactively cached ${aiRankedDeals.length} AI-ranked GLOBAL CURATED deals.`);
                    }
                } catch (e: any) {
                    console.error("[AuctionsPage BG Cache HIT] Error during proactive GLOBAL CURATED deals caching:", e);
                }
            })();
        }
    }


    setAllItems(processedItemsForState);
    setIsLoading(false);
    setInitialLoadComplete(true);

    if (!error && processedItemsForState.length > 0) {
      try {
        sessionStorage.setItem(currentCacheKey, JSON.stringify({ items: processedItemsForState, timestamp: Date.now() }));
        // console.log(`[AuctionsPage loadItems] Saved ${processedItemsForState.length} items to sessionStorage for key "${currentCacheKey}".`);
      } catch (e) {
         console.warn(`[AuctionsPage loadItems] Error saving to sessionStorage for key "${currentCacheKey}":`, e);
      }
    }

    if (overallToastMessage && !error) {
      toast(overallToastMessage);
    } else if (error && !isAuthError) {
      toast({ title: "Error Loading Auctions", description: error || "An unexpected error occurred.", variant: "destructive" });
    }
    // console.log(`[AuctionsPage loadItems] Finalizing. Items for state: ${processedItemsForState.length} for query "${queryToLoad}".`);
  }, [toast, isAuthError, currentQueryFromUrl]); // Removed backgroundDealsCacheAttempted

  // Top-up for GLOBAL CURATED AUCTIONS
  useEffect(() => {
    const isGlobalCuratedView = !currentQueryFromUrl;
    const activeAllItems = allItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);

    if (isGlobalCuratedView && initialLoadComplete && !topUpAttempted && !isLoading && !isRanking && !error && !isAuthError && activeAllItems.length < MIN_DESIRED_CURATED_ITEMS) {
      console.log(`[AuctionsPage Top-Up] Current active ${activeAllItems.length} < ${MIN_DESIRED_CURATED_ITEMS}. Initiating top-up.`);
      setTopUpAttempted(true);
      setIsLoading(true);

      (async () => {
        try {
          const currentItemIds = new Set(activeAllItems.map(item => item.id));
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
              console.warn("[AuctionsPage Top-Up] No valid additional unique keywords. Aborting.");
              setIsLoading(false);
              return;
          }

          // console.log(`[AuctionsPage Top-Up] Fetching for ${additionalKeywordsToFetch.length} additional keywords: ${additionalKeywordsToFetch.join(', ')}`);
          const additionalFetchedBatchesPromises = additionalKeywordsToFetch.map(kw => fetchItems('auction', kw, true));
          const additionalFetchedBatchesResults = await Promise.allSettled(additionalFetchedBatchesPromises);

          const successfullyFetchedAdditionalItemsRaw = additionalFetchedBatchesResults
              .filter(res => res.status === 'fulfilled')
              .flatMap(res => (res as PromiseFulfilledResult<BayBotItem[]>).value);

          const newUniqueActiveAdditionalItems = successfullyFetchedAdditionalItemsRaw
              .filter(item => !currentItemIds.has(item.id))
              .filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);

          if (newUniqueActiveAdditionalItems.length > 0) {
              // console.log(`[AuctionsPage Top-Up] Fetched ${newUniqueActiveAdditionalItems.length} new unique, active additional auctions.`);
              setAllItems(prevAllItems => {
                const currentActiveItemsInner = prevAllItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
                const combinedItems = [...currentActiveItemsInner, ...newUniqueActiveAdditionalItems];
                const uniqueMap = new Map(combinedItems.map(item => [item.id, item]));
                const finalToppedUpItems = Array.from(uniqueMap.values());

                sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: finalToppedUpItems, timestamp: Date.now() }));
                toast({ title: "More Curated Auctions Loaded", description: `Now displaying ${finalToppedUpItems.length} active auctions.` });
                return finalToppedUpItems;
              });
          } else {
              // console.log(`[AuctionsPage Top-Up] No new, active additional auctions found.`);
              toast({ title: "Auction Top-up", description: "No new auctions found in this attempt." });
          }
        } catch (e: any) {
          console.error("[AuctionsPage Top-Up] Error:", e);
          toast({ title: "Error Topping Up Auctions", description: e.message || "Failed to fetch additional auctions.", variant: "destructive" });
        } finally {
          setIsLoading(false);
        }
      })();
    }
  }, [allItems, initialLoadComplete, topUpAttempted, isLoading, isRanking, error, isAuthError, currentQueryFromUrl, toast]);

  // Fallback: Background cache for Global Curated Deals IF auctions were loaded from cache by loadItems
  useEffect(() => {
    const isGlobalCuratedView = !currentQueryFromUrl;
    const auctionsLikelyLoadedFromCache = allItems.length > 0 && processedItemsForState.length > 0 && allItems[0].id === processedItemsForState[0].id; // Heuristic

    if (isGlobalCuratedView && initialLoadComplete && auctionsLikelyLoadedFromCache && !backgroundDealsCacheAttempted && !isLoading && !isRanking && !error && !isAuthError) {
        setBackgroundDealsCacheAttempted(true);
        console.log("[AuctionsPage BG Cache Effect - Fallback] Conditions met for pre-caching GLOBAL CURATED deals.");
        (async () => {
            try {
                const cachedDeals = sessionStorage.getItem(CURATED_DEALS_CACHE_KEY);
                if (cachedDeals) {
                    const parsed = JSON.parse(cachedDeals);
                     if (parsed.items && parsed.timestamp && (Date.now() - parsed.timestamp < GLOBAL_CURATED_CACHE_TTL_MS)) {
                        // console.log("[AuctionsPage BG Cache Effect - Fallback] Fresh GLOBAL CURATED deals already in cache. Skipping.");
                        return;
                    }
                }
                // console.log("[AuctionsPage BG Cache Effect - Fallback] No fresh GLOBAL CURATED deals. Fetching.");
                const keywordsForBackgroundDealsCache: string[] = [];
                let uniqueKeywordSafety = 0;
                const attemptedKwsBg = new Set<string>();
                while(keywordsForBackgroundDealsCache.length < KEYWORDS_FOR_PROACTIVE_BACKGROUND_CACHE && uniqueKeywordSafety < (curatedHomepageSearchTerms.length + 5)) {
                     const randomKw = await getRandomPopularSearchTerm();
                     if(randomKw && randomKw.trim() !== '' && !attemptedKwsBg.has(randomKw)) {
                         keywordsForBackgroundDealsCache.push(randomKw);
                         attemptedKwsBg.add(randomKw);
                     }
                     uniqueKeywordSafety++;
                }
                if (keywordsForBackgroundDealsCache.length === 0) { return; }

                const dealBatchesPromises = keywordsForBackgroundDealsCache.map(kw => fetchItems('deal', kw, true));
                const dealBatchesResults = await Promise.allSettled(dealBatchesPromises);
                const successfulDealFetches = dealBatchesResults
                    .filter(result => result.status === 'fulfilled')
                    .map(result => (result as PromiseFulfilledResult<BayBotItem[]>).value);
                const consolidatedDeals = successfulDealFetches.flat();
                const uniqueDealsMap = new Map(consolidatedDeals.map(i => [i.id, i]));
                const uniqueDeals = Array.from(uniqueDealsMap.values());

                if (uniqueDeals.length > 0) {
                    const aiRankedDeals = await rankDealsAI(uniqueDeals, "general curated deals background cache from auctions");
                    sessionStorage.setItem(CURATED_DEALS_CACHE_KEY, JSON.stringify({ items: aiRankedDeals, timestamp: Date.now() }));
                    console.log(`[AuctionsPage BG Cache Effect - Fallback] Proactively cached ${aiRankedDeals.length} AI-ranked GLOBAL CURATED deals.`);
                }
            } catch (e: any) {
                console.error("[AuctionsPage BG Cache Effect - Fallback] Error during proactive GLOBAL CURATED deals caching:", e);
            }
        })();
    }
  }, [allItems, initialLoadComplete, backgroundDealsCacheAttempted, isLoading, isRanking, error, currentQueryFromUrl, isAuthError, /* processedItemsForState could be added but might cause loops */]);

  // Proactive cache for SEARCHED deals (if current page is auctions search results)
  useEffect(() => {
    const query = currentQueryFromUrl;
    if (query && initialLoadComplete && !proactiveSearchDealsCacheAttempted && !isLoading && !isRanking && !error && !isAuthError) {
      setProactiveSearchDealsCacheAttempted(true);
      console.log(`[AuctionsPage Proactive Search Cache] Conditions met for pre-caching SEARCHED deals for query: "${query}"`);
      (async () => {
        try {
          const searchedDealsCacheKey = SEARCHED_DEALS_CACHE_KEY_PREFIX + query;
          const cachedDataString = sessionStorage.getItem(searchedDealsCacheKey);
          if (cachedDataString) {
            const cachedData = JSON.parse(cachedDataString);
            if (cachedData && cachedData.items && (Date.now() - (cachedData.timestamp || 0) < STANDARD_CACHE_TTL_MS)) {
              // console.log(`[AuctionsPage Proactive Search Cache] Fresh SEARCHED deals for query "${query}" already in cache. Skipping.`);
              return;
            }
          }
          // console.log(`[AuctionsPage Proactive Search Cache] No fresh SEARCHED deals in cache for query "${query}". Fetching.`);

          const fetchedDeals = await fetchItems('deal', query, false);
          if (fetchedDeals.length > 0) {
            const aiRankedDeals = await rankDealsAI(fetchedDeals, query);
            sessionStorage.setItem(searchedDealsCacheKey, JSON.stringify({ items: aiRankedDeals, timestamp: Date.now() }));
            console.log(`[AuctionsPage Proactive Search Cache] Proactively cached ${aiRankedDeals.length} AI-ranked SEARCHED deals for query "${query}".`);
          }
        } catch (e: any) {
          console.error(`[AuctionsPage Proactive Search Cache] Error during proactive SEARCHED deal caching for query "${query}":`, e);
        }
      })();
    }
  }, [currentQueryFromUrl, initialLoadComplete, proactiveSearchDealsCacheAttempted, isLoading, isRanking, error, isAuthError]);

  const handleSearchSubmit = useCallback((query: string) => {
    const newPath = query ? `/auctions?q=${encodeURIComponent(query)}` : '/auctions';
    router.push(newPath);
  }, [router]);

  const handleLogoClick = useCallback(async () => {
    console.log('[AuctionsPage handleLogoClick] Logo clicked. Clearing global curated caches and navigating to homepage (deals).');
    sessionStorage.removeItem(CURATED_DEALS_CACHE_KEY);
    sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
    // setInputValue(''); // This will be set by the router push and subsequent effect
    router.push('/');
  }, [router]);


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
    router.push(`/auctions?q=${encodeURIComponent(keyword)}`);
  };

  const handleAuctionEnd = useCallback((endedItemId: string) => {
    setAllItems(prevItems => prevItems.filter(item => item.id !== endedItemId));

    const currentCacheKeyForEnd = (!currentQueryFromUrl) ? CURATED_AUCTIONS_CACHE_KEY : SEARCHED_AUCTIONS_CACHE_KEY_PREFIX + currentQueryFromUrl;

    try {
        const cachedDataString = sessionStorage.getItem(currentCacheKeyForEnd);
        if (cachedDataString) {
            const cachedData = JSON.parse(cachedDataString);
            if (cachedData && cachedData.items && Array.isArray(cachedData.items)) {
                const updatedCachedItems = cachedData.items.filter((i: BayBotItem) => i.id !== endedItemId && (i.endTime ? new Date(i.endTime).getTime() > Date.now() : false));
                if (updatedCachedItems.length > 0 || cachedData.items.length !== updatedCachedItems.length ) {
                    sessionStorage.setItem(currentCacheKeyForEnd, JSON.stringify({ items: updatedCachedItems, timestamp: Date.now() }));
                } else if (updatedCachedItems.length === 0 && cachedData.items.length > 0) {
                     sessionStorage.removeItem(currentCacheKeyForEnd);
                }
            }
        }
    } catch (e) {
        console.warn(`[AuctionsPage handleAuctionEnd] Error updating sessionStorage for ended auction ${endedItemId} in key ${currentCacheKeyForEnd}:`, e);
    }

    const endedItem = allItems.find(item => item.id === endedItemId);
    const endedItemTitle = endedItem?.title || "An auction";
    toast({
        title: "Auction Ended",
        description: `"${endedItemTitle.substring(0,30)}..." has ended and been removed.`
    });
  }, [currentQueryFromUrl, toast, allItems]); // Added allItems


  useEffect(() => {
    const activeItems = allItems.filter(item =>
      item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false
    );
    setDisplayedItems(activeItems.slice(0, visibleItemCount));
  }, [allItems, visibleItemCount]);

  let noItemsTitle = "No Auctions Found";
  let noItemsDescription = currentQueryFromUrl
    ? `No auctions found for "${currentQueryFromUrl}". Try adjusting your search.`
    : "We're fetching curated auctions. If nothing appears, try a specific search!";

  const activeItemsForNoMessage = allItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
  if (activeItemsForNoMessage.length === 0 && !isLoading && !isRanking && !error && currentQueryFromUrl === '') {
      noItemsDescription = `We couldn't find any active curated auctions. Try a specific search or check back!`;
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

        {(isLoading || (isRanking && displayedItems.length === 0 && allItems.length === 0)) && <ItemGridLoadingSkeleton count={ITEMS_PER_PAGE} /> }

        {!isLoading && !isRanking && displayedItems.length === 0 && activeItemsForNoMessage.length === 0 && !error && (
           <NoItemsMessage title={noItemsTitle} description={noItemsDescription} />
        )}

        {displayedItems.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
              {displayedItems.map(item => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onAnalyze={handleAnalyzeItem}
                  onAuctionEnd={handleAuctionEnd}
                />
              ))}
            </div>
            {activeItemsForNoMessage.length > displayedItems.length && (
              <div className="text-center">
                <Button onClick={handleLoadMore} size="lg" variant="outline">
                  <ShoppingBag className="mr-2 h-5 w-5" /> Load More Auctions
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

export default function AuctionsPage() {
  return (
    <Suspense fallback={<ItemGridLoadingSkeleton count={ITEMS_PER_PAGE} />}>
      <AuctionsPageContent />
    </Suspense>
  );
}
