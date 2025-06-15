
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
  KEYWORDS_FOR_PROACTIVE_BACKGROUND_CACHE,
  curatedHomepageSearchTerms
} from '@/lib/constants';
import { rankDeals as rankDealsAI } from '@/ai/flows/rank-deals'; // For proactive deals caching

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
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);

  const [selectedItemForAnalysis, setSelectedItemForAnalysis] = useState<BayBotItem | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

  const { toast } = useToast();

  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [topUpAttempted, setTopUpAttempted] = useState(false);
  const [backgroundDealsCacheAttempted, setBackgroundDealsCacheAttempted] = useState(false);


  useEffect(() => {
    setInitialLoadComplete(false);
    setTopUpAttempted(false);
    setBackgroundDealsCacheAttempted(false);
  }, [currentQueryFromUrl]);

  const loadItems = useCallback(async (queryToLoad: string) => {
    console.log(`[AuctionsPage loadItems] Initiating. Query: "${queryToLoad}"`);
    const isGlobalCuratedRequest = queryToLoad === '';

    if (!isGlobalCuratedRequest || allItems.length === 0) {
        setAllItems([]);
        setDisplayedItems([]);
        setVisibleItemCount(ITEMS_PER_PAGE);
    }
    setIsLoading(true);
    setError(null);
    setIsAuthError(false);

    if (isGlobalCuratedRequest) {
      setInitialLoadComplete(false);
      setTopUpAttempted(false);
      setBackgroundDealsCacheAttempted(false);
    }

    let processedItemsForState: BayBotItem[] = [];

    if (isGlobalCuratedRequest) {
      let activeCachedItems: BayBotItem[] = [];
      try {
        const cachedDataString = sessionStorage.getItem(CURATED_AUCTIONS_CACHE_KEY);
        if (cachedDataString) {
          const cachedData = JSON.parse(cachedDataString);
           if (cachedData && cachedData.items && Array.isArray(cachedData.items) && (Date.now() - (cachedData.timestamp || 0) < GLOBAL_CURATED_CACHE_TTL_MS)) {
              activeCachedItems = (cachedData.items as BayBotItem[] || []).filter(item => 
                item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false
              );
              if (activeCachedItems.length > 0) {
                console.log(`[AuctionsPage loadItems] Found ${activeCachedItems.length} active curated auctions in fresh sessionStorage.`);
                processedItemsForState = activeCachedItems;
                toast({ title: "Loaded Cached Curated Auctions", description: "Displaying previously fetched active auctions." });
              } else {
                sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
                console.log(`[AuctionsPage loadItems] Curated auctions cache had no active items or was stale. Cleared.`);
              }
           } else {
              sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
              console.log(`[AuctionsPage loadItems] Curated auctions cache was stale or invalid. Cleared.`);
           }
        }
      } catch (e) {
        console.warn("[AuctionsPage loadItems] Error with sessionStorage for curated auctions:", e);
        sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
      }

      if (processedItemsForState.length === 0) {
        console.log(`[AuctionsPage loadItems] Curated auctions: Starting progressive load.`);
        let initialItems: BayBotItem[] = [];
        const attemptedKeywordsForSession = new Set<string>();
        let initialFetchError = null;
        
        try {
          let firstKeyword = '';
          let keywordFetchAttempts = 0;
          while (!firstKeyword && keywordFetchAttempts < (curatedHomepageSearchTerms.length + 5)) {
              const randomKw = await getRandomPopularSearchTerm();
              if (randomKw && randomKw.trim() !== '' && !attemptedKeywordsForSession.has(randomKw)) {
                  firstKeyword = randomKw;
                  attemptedKeywordsForSession.add(randomKw);
              }
              keywordFetchAttempts++;
          }
          if (!firstKeyword) {
            console.warn("[AuctionsPage loadItems] Curated (Initial): Failed to get a unique initial keyword.");
          } else {
            console.log(`[AuctionsPage loadItems] Curated (Initial): Fetching for keyword "${firstKeyword}".`);
            initialItems = await fetchItems('auction', firstKeyword, true);
            initialItems = initialItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
            
            if (initialItems.length > 0) {
              processedItemsForState = initialItems; 
              sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: initialItems, timestamp: Date.now() }));
              toast({ title: "Initial Auctions Loaded", description: `Found ${initialItems.length} from first keyword. Fetching more...` });
            } else {
              toast({ title: "Initial Auctions", description: `No auctions from first keyword. Fetching more...` });
            }
          }
        } catch (e: any) {
          console.error(`[AuctionsPage loadItems] Curated (Initial): Error fetching:`, e);
          initialFetchError = e.message || "Failed to fetch initial auctions.";
          if (e.message?.includes("Authentication Failure") || e.message?.includes("invalid_client")) {
            setIsAuthError(true); setError(initialFetchError);
          }
        } finally {
          setIsLoading(false); 
          setAllItems(currentAll => {
              const combined = [...currentAll, ...processedItemsForState];
              const uniqueMap = new Map(combined.map(item => [item.id, item]));
              return Array.from(uniqueMap.values()).filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
          });
          setInitialLoadComplete(true);
        }

        if (!isAuthError && MAX_CURATED_FETCH_ATTEMPTS > 1) {
          (async () => { 
            console.log(`[AuctionsPage loadItems] Curated (Background): Starting enhancement fetches.`);
            const additionalKeywordsToFetch: string[] = [];
            let uniqueKeywordAttempts = 0;
            while (additionalKeywordsToFetch.length < (MAX_CURATED_FETCH_ATTEMPTS -1) && uniqueKeywordAttempts < (curatedHomepageSearchTerms.length + 10)) {
              const randomKw = await getRandomPopularSearchTerm();
              if (randomKw && randomKw.trim() !== '' && !attemptedKeywordsForSession.has(randomKw) && !additionalKeywordsToFetch.includes(randomKw)) {
                additionalKeywordsToFetch.push(randomKw);
              }
              uniqueKeywordAttempts++;
            }

            if (additionalKeywordsToFetch.length > 0) {
              additionalKeywordsToFetch.forEach(kw => attemptedKeywordsForSession.add(kw));
              console.log(`[AuctionsPage loadItems] Curated (Background): Fetching for ${additionalKeywordsToFetch.length} additional keywords: ${additionalKeywordsToFetch.join(', ')}.`);
              const backgroundFetchPromises = additionalKeywordsToFetch.map(kw => fetchItems('auction', kw, true));
              const backgroundResults = await Promise.allSettled(backgroundFetchPromises);

              const successfullyFetchedBackgroundItems = backgroundResults
                .filter(res => res.status === 'fulfilled')
                .flatMap(res => (res as PromiseFulfilledResult<BayBotItem[]>).value)
                .filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);

              if (successfullyFetchedBackgroundItems.length > 0) {
                setAllItems(prevAllItems => { 
                  const combined = [...prevAllItems, ...successfullyFetchedBackgroundItems];
                  const uniqueMap = new Map(combined.map(item => [item.id, item]));
                  const activeNewAllItems = Array.from(uniqueMap.values()).filter(item => 
                    item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false
                  );
                  sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: activeNewAllItems, timestamp: Date.now() }));
                  console.log(`[AuctionsPage loadItems] Curated (Background): Merged ${successfullyFetchedBackgroundItems.length} new items. Total unique active: ${activeNewAllItems.length}`);
                  if (activeNewAllItems.length > prevAllItems.length) {
                    toast({ title: "More Curated Auctions Loaded", description: `Now displaying ${activeNewAllItems.length} auctions.` });
                  }
                  return activeNewAllItems; 
                });
              }
            } else {
                console.log(`[AuctionsPage loadItems] Curated (Background): No additional unique keywords to fetch for enhancement.`);
            }
          })().catch(e => console.error("[AuctionsPage loadItems] Error in background enhancement task:", e));
        }
        
        if (processedItemsForState.length === 0 && initialFetchError && !error) { 
          setError(initialFetchError);
        }
      }
    } else { 
      console.log(`[AuctionsPage loadItems] Standard auction search. eBay Query: "${queryToLoad}"`);
      let fetchedItems: BayBotItem[] = [];
      try {
        fetchedItems = await fetchItems('auction', queryToLoad, false);
        const activeFetchedItems = fetchedItems.filter(item => 
            item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false
        );
        processedItemsForState = activeFetchedItems;

        if (activeFetchedItems.length > 0) {
          toast({ title: "Auctions Found", description: `Displaying ${activeFetchedItems.length} auctions for "${queryToLoad}".` });
        } else {
          toast({ title: "No Auctions Found", description: `No active auctions found for "${queryToLoad}".` });
        }
      } catch (e: any)
      {
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
      } finally {
         setIsLoading(false); 
         setAllItems(processedItemsForState);
         setInitialLoadComplete(true);
      }
    }
  }, [toast]);


  useEffect(() => {
    const isGlobalCuratedView = !currentQueryFromUrl;
    const activeAllItems = allItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);

    if (isGlobalCuratedView && initialLoadComplete && !topUpAttempted && !isLoading && !error && !isAuthError && activeAllItems.length < MIN_DESIRED_CURATED_ITEMS) {
      console.log(`[AuctionsPage Top-Up Effect] Current active items ${activeAllItems.length} < ${MIN_DESIRED_CURATED_ITEMS}. Initiating top-up for AUCTIONS.`);
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
              console.warn("[AuctionsPage Top-Up Effect] No valid additional unique keywords for auctions top-up. Aborting.");
              setIsLoading(false); // Ensure loading is false if aborting
              return;
          }
          
          console.log(`[AuctionsPage Top-Up Effect] Fetching auctions for ${additionalKeywordsToFetch.length} additional keywords: ${additionalKeywordsToFetch.join(', ')}`);
          const additionalFetchedBatchesPromises = additionalKeywordsToFetch.map(kw => fetchItems('auction', kw, true));
          const additionalFetchedBatchesResults = await Promise.allSettled(additionalFetchedBatchesPromises);

          const successfullyFetchedAdditionalItemsRaw = additionalFetchedBatchesResults
              .filter(res => res.status === 'fulfilled')
              .flatMap(res => (res as PromiseFulfilledResult<BayBotItem[]>).value);

          const newUniqueActiveAdditionalItems = successfullyFetchedAdditionalItemsRaw
              .filter(item => !currentItemIds.has(item.id)) 
              .filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);

          if (newUniqueActiveAdditionalItems.length > 0) {
              console.log(`[AuctionsPage Top-Up Effect] Fetched ${newUniqueActiveAdditionalItems.length} new unique, active additional auctions.`);
              
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
              console.log(`[AuctionsPage Top-Up Effect] No new, active additional auctions found from top-up fetch.`);
          }
        } catch (e: any) {
          console.error("[AuctionsPage Top-Up Effect] Error during auctions top-up:", e);
          toast({ title: "Error Topping Up Auctions", description: e.message || "Failed to fetch additional auctions.", variant: "destructive" });
        } finally {
          setIsLoading(false); 
        }
      })();
    }
  }, [allItems, initialLoadComplete, topUpAttempted, isLoading, error, isAuthError, currentQueryFromUrl, toast]);

  useEffect(() => {
    const isGlobalCuratedView = !currentQueryFromUrl;
    if (isGlobalCuratedView && initialLoadComplete && !backgroundDealsCacheAttempted && !isLoading && !error && allItems.length > 0) {
        setBackgroundDealsCacheAttempted(true);
        console.log("[AuctionsPage Background Cache] Conditions met for pre-caching deals.");

        (async () => {
            try {
                const cachedDeals = sessionStorage.getItem(CURATED_DEALS_CACHE_KEY);
                if (cachedDeals) {
                    const parsed = JSON.parse(cachedDeals);
                     if (parsed.items && parsed.timestamp && (Date.now() - parsed.timestamp < GLOBAL_CURATED_CACHE_TTL_MS)) {
                        console.log("[AuctionsPage Background Cache] Fresh curated deals already in cache. Skipping proactive fetch.");
                        return;
                    }
                }
                console.log("[AuctionsPage Background Cache] No fresh curated deals in cache. Initiating proactive fetch for deals.");
                
                const keywordsForBackgroundDealsCache: string[] = [];
                let uniqueKeywordSafety = 0;
                const attemptedKeywordsBg = new Set<string>();

                while(keywordsForBackgroundDealsCache.length < KEYWORDS_FOR_PROACTIVE_BACKGROUND_CACHE && uniqueKeywordSafety < (curatedHomepageSearchTerms.length + 5)) {
                     const randomKw = await getRandomPopularSearchTerm();
                     if(randomKw && randomKw.trim() !== '' && !attemptedKeywordsBg.has(randomKw)) {
                         keywordsForBackgroundDealsCache.push(randomKw);
                         attemptedKeywordsBg.add(randomKw);
                     }
                     uniqueKeywordSafety++;
                }

                if (keywordsForBackgroundDealsCache.length === 0) {
                    console.warn("[AuctionsPage Background Cache] No unique keywords generated for proactive deals caching.");
                    return;
                }

                console.log(`[AuctionsPage Background Cache] Fetching deals for background cache with keywords: ${keywordsForBackgroundDealsCache.join(', ')}`);
                const dealBatchesPromises = keywordsForBackgroundDealsCache.map(kw => fetchItems('deal', kw, true));
                const dealBatchesResults = await Promise.allSettled(dealBatchesPromises);

                const successfulDealFetches = dealBatchesResults
                    .filter(result => result.status === 'fulfilled')
                    .map(result => (result as PromiseFulfilledResult<BayBotItem[]>).value);
                
                const consolidatedDeals = successfulDealFetches.flat();
                const uniqueDealsMap = new Map<string, BayBotItem>();
                consolidatedDeals.forEach(item => { if (!uniqueDealsMap.has(item.id)) uniqueDealsMap.set(item.id, item); });
                const uniqueDeals = Array.from(uniqueDealsMap.values());

                if (uniqueDeals.length > 0) {
                    const aiRankedDeals = await rankDealsAI(uniqueDeals, "general curated deals background cache from auctions page");
                    sessionStorage.setItem(CURATED_DEALS_CACHE_KEY, JSON.stringify({ items: aiRankedDeals, timestamp: Date.now() }));
                    console.log(`[AuctionsPage Background Cache] Proactively cached ${aiRankedDeals.length} AI-ranked deals.`);
                } else {
                    console.log("[AuctionsPage Background Cache] No deals found to proactively cache.");
                }
            } catch (e: any) {
                console.error("[AuctionsPage Background Cache] Error during proactive deals caching:", e);
            }
        })();
    }
  }, [allItems, initialLoadComplete, backgroundDealsCacheAttempted, isLoading, error, currentQueryFromUrl]);


  useEffect(() => {
    console.log(`[AuctionsPage URL useEffect] Current URL query: "${currentQueryFromUrl}". Triggering loadItems.`);
    setInputValue(currentQueryFromUrl); 
    loadItems(currentQueryFromUrl);
  }, [currentQueryFromUrl, loadItems]);


  const handleSearchSubmit = useCallback((query: string) => {
    const newPath = query ? `/auctions?q=${encodeURIComponent(query)}` : '/auctions';
    router.push(newPath);
  }, [router]);

  const handleLogoClick = useCallback(async () => {
    console.log('[AuctionsPage handleLogoClick] Logo clicked. Clearing caches and preparing for background curated content refresh.');
    sessionStorage.removeItem(CURATED_DEALS_CACHE_KEY);
    sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
    setInputValue('');
    setInitialLoadComplete(false);
    setTopUpAttempted(false);
    setBackgroundDealsCacheAttempted(false);


    (async () => {
      try {
        console.log('[AuctionsPage handleLogoClick] Starting background curated content fetch (deals & auctions)...');
        
        const keywordPromises = Array.from({ length: MAX_CURATED_FETCH_ATTEMPTS }, () => getRandomPopularSearchTerm());
        const resolvedKeywords = await Promise.all(keywordPromises);
        const uniqueBackgroundKeywords = Array.from(new Set(resolvedKeywords.filter(kw => kw && kw.trim() !== '')));


        if (uniqueBackgroundKeywords.length === 0) {
          console.warn('[AuctionsPage handleLogoClick] Background task: No valid unique keywords for curated content. Aborting.');
          return;
        }
        console.log(`[AuctionsPage handleLogoClick] Background task: Using ${uniqueBackgroundKeywords.length} unique keywords: ${uniqueBackgroundKeywords.join(', ')}`);
        
        const dealsTask = async () => {
          try {
            const dealBatchesPromises = uniqueBackgroundKeywords.map(kw => fetchItems('deal', kw, true));
            const dealBatchesResults = await Promise.allSettled(dealBatchesPromises);
            const successfulDealFetches = dealBatchesResults
              .filter(result => result.status === 'fulfilled')
              .map(result => (result as PromiseFulfilledResult<BayBotItem[]>).value);
            
            const consolidatedDeals = successfulDealFetches.flat();
            const uniqueDealsMap = new Map<string, BayBotItem>();
            consolidatedDeals.forEach(item => { if (!uniqueDealsMap.has(item.id)) uniqueDealsMap.set(item.id, item); });
            const uniqueDeals = Array.from(uniqueDealsMap.values());

            if (uniqueDeals.length > 0) {
              const aiRankedDeals = await rankDealsAI(uniqueDeals, "general curated deals background refresh");
              sessionStorage.setItem(CURATED_DEALS_CACHE_KEY, JSON.stringify({ items: aiRankedDeals, timestamp: Date.now() }));
              console.log(`[AuctionsPage handleLogoClick] Background task: Saved ${aiRankedDeals.length} AI-ranked curated deals to sessionStorage.`);
              toast({ title: "Curated Deals Refreshed", description: `${aiRankedDeals.length} AI-ranked deals cached.` });
            } else {
              console.log('[AuctionsPage handleLogoClick] Background task: No curated deals found to AI rank or cache.');
            }
          } catch (dealsError: any) {
            console.error('[AuctionsPage handleLogoClick] Background task error (Deals):', dealsError);
            const errorMsg = dealsError.message && dealsError.message.includes("Authentication Failure") ? "Deals refresh failed due to auth error." : "Could not refresh curated deals.";
            toast({ title: "Deals Refresh Failed", description: errorMsg, variant: "destructive" });
          }
        };
        
        const auctionsTask = async () => {
          try {
            const auctionBatchesPromises = uniqueBackgroundKeywords.map(kw => fetchItems('auction', kw, true));
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
              console.log(`[AuctionsPage handleLogoClick] Background task: Saved ${finalBackgroundAuctions.length} active curated auctions (server-processed) to sessionStorage.`);
              toast({ title: "Curated Auctions Refreshed", description: `${finalBackgroundAuctions.length} server-processed auctions cached.` });
            } else {
              console.log('[AuctionsPage handleLogoClick] Background task: No active curated auctions found to cache.');
            }
          } catch (auctionsError: any) {
            console.error('[AuctionsPage handleLogoClick] Background task error (Auctions):', auctionsError);
            const errorMsg = auctionsError.message && auctionsError.message.includes("Authentication Failure") ? "Auctions refresh failed due to auth error." : "Could not refresh curated auctions.";
            toast({ title: "Auctions Refresh Failed", description: errorMsg, variant: "destructive" });
          }
        };

        await Promise.allSettled([dealsTask(), auctionsTask()]);
        console.log('[AuctionsPage handleLogoClick] Background tasks for deals and auctions completed (or failed).');

      } catch (bgError) {
        console.error('[AuctionsPage handleLogoClick] General error in background curated content refresh setup:', bgError);
      }
    })();
    router.push('/'); 
  }, [router, toast]);


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
    setInputValue(keyword); 
    router.push(`/auctions?q=${encodeURIComponent(keyword)}`);
  };

  const handleAuctionEnd = useCallback((endedItemId: string) => {
    setAllItems(prevItems => prevItems.filter(item => item.id !== endedItemId));
    
    const isGlobalCuratedViewOnPage = !currentQueryFromUrl;
    if (isGlobalCuratedViewOnPage) {
        try {
            const cachedDataString = sessionStorage.getItem(CURATED_AUCTIONS_CACHE_KEY);
            if (cachedDataString) {
                const cachedData = JSON.parse(cachedDataString);
                if (cachedData && cachedData.items && Array.isArray(cachedData.items)) {
                    const updatedCachedItems = cachedData.items.filter((i: BayBotItem) => i.id !== endedItemId && (i.endTime ? new Date(i.endTime).getTime() > Date.now() : false));
                    if (updatedCachedItems.length > 0) {
                        sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: updatedCachedItems, timestamp: Date.now() }));
                    } else {
                        sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
                    }
                }
            }
        } catch (e) {
            console.warn(`[AuctionsPage handleAuctionEnd] Error updating sessionStorage for ended auction ${endedItemId}:`, e);
        }
    }
    const endedItemTitle = allItems.find(item => item.id === endedItemId)?.title || "An auction";
    toast({ 
        title: "Auction Ended", 
        description: `"${endedItemTitle.substring(0,30)}..." has ended and been removed.` 
    });
  }, [allItems, currentQueryFromUrl, toast]); 


  useEffect(() => {
    const activeItems = allItems.filter(item => {
        return item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false;
    });
    if (JSON.stringify(allItems.map(i => i.id)) !== JSON.stringify(activeItems.map(i => i.id))) {
       setAllItems(activeItems); 
    }
    setDisplayedItems(activeItems.slice(0, visibleItemCount));
  }, [allItems, visibleItemCount]);

  let noItemsTitle = "No Auctions Found";
  let noItemsDescription = currentQueryFromUrl
    ? `Try adjusting your search for "${currentQueryFromUrl}".`
    : "No global curated auctions available right now. Check back later or try a specific search!";
  
  const activeItemsForNoMessage = allItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : false);
  if (activeItemsForNoMessage.length === 0 && !isLoading && !error && currentQueryFromUrl === '') {
      noItemsDescription = `We couldn't find any curated auctions. Try a specific search or check back!`;
  }

  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader
        searchInputValue={inputValue}
        onSearchInputChange={setInputValue}
        onSearchSubmit={handleSearchSubmit}
        onLogoClick={handleLogoClick}
        isLoading={isLoading} 
      />
      <main className="flex-grow container mx-auto px-4 py-8">
        {error && (
          <Alert variant="destructive" className="mb-6">
            {isAuthError ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
            <AlertTitle>{isAuthError ? "Authentication Error" : "Error"}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading && displayedItems.length === 0 && <ItemGridLoadingSkeleton count={ITEMS_PER_PAGE} /> }

        {!isLoading && displayedItems.length === 0 && activeItemsForNoMessage.length === 0 && !error && (
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
         {isLoading && displayedItems.length > 0 && (
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

