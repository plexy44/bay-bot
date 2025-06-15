
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
  KEYWORDS_FOR_PROACTIVE_BACKGROUND_CACHE,
  curatedHomepageSearchTerms
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

  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [topUpAttempted, setTopUpAttempted] = useState(false);
  const [backgroundAuctionCacheAttempted, setBackgroundAuctionCacheAttempted] = useState(false);


  useEffect(() => {
    setInitialLoadComplete(false);
    setTopUpAttempted(false);
    setBackgroundAuctionCacheAttempted(false);
  }, [currentQueryFromUrl]);

  const loadItems = useCallback(async (queryToLoad: string) => {
    console.log(`[HomePage loadItems] Initiating. Query to load: "${queryToLoad}"`);
    const isGlobalCuratedRequest = queryToLoad === '';

    setAllItems([]);
    setDisplayedItems([]);
    setVisibleItemCount(ITEMS_PER_PAGE);
    setIsLoading(true);
    setIsRanking(false);
    setError(null);
    setIsAuthError(false);
    if (isGlobalCuratedRequest) {
      setInitialLoadComplete(false); 
      setTopUpAttempted(false);
      setBackgroundAuctionCacheAttempted(false);
    }


    let finalProcessedItems: BayBotItem[] = [];
    let overallToastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;

    if (isGlobalCuratedRequest) {
      try {
        const cachedDataString = sessionStorage.getItem(CURATED_DEALS_CACHE_KEY);
        if (cachedDataString) {
          const cachedData = JSON.parse(cachedDataString);
          if (cachedData && cachedData.items && Array.isArray(cachedData.items) && cachedData.items.length > 0 && (Date.now() - (cachedData.timestamp || 0) < GLOBAL_CURATED_CACHE_TTL_MS)) {
            console.log(`[HomePage loadItems] Found ${cachedData.items.length} fresh curated deals in sessionStorage. Displaying them.`);
            finalProcessedItems = cachedData.items;
            toast({ title: "Loaded Cached Curated Deals", description: "Displaying previously fetched deals for this session." });
          } else if (cachedData.items.length === 0) {
            console.log(`[HomePage loadItems] Session storage for curated deals was empty. Fetching fresh.`);
          } else {
             console.log(`[HomePage loadItems] Curated deals cache found but was stale or invalid. Fetching fresh.`);
             sessionStorage.removeItem(CURATED_DEALS_CACHE_KEY);
          }
        }
      } catch (e) {
        console.warn("[HomePage loadItems] Error reading or parsing curated deals from sessionStorage:", e);
        sessionStorage.removeItem(CURATED_DEALS_CACHE_KEY);
      }

      if (finalProcessedItems.length === 0) {
        console.log(`[HomePage loadItems] Curated deals: No valid cache. Starting iterative fresh fetch.`);
        setIsRanking(true);
        let accumulatedRawEbayItems: BayBotItem[] = [];
        const attemptedKeywordsInitialLoad = new Set<string>();
        
        console.log(`[HomePage loadItems] Curated deals: Iterative fetch. Target raw: ${MIN_DESIRED_CURATED_ITEMS * TARGET_RAW_ITEMS_FACTOR_FOR_AI}, Max keywords: ${MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS}`);

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
                console.log(`[HomePage loadItems] Curated deals: Iteration ${currentBatchNumber}: No new unique keywords found. Breaking iterative fetch.`);
                break; 
              }
              
              keywordsForThisBatch.forEach(kw => attemptedKeywordsInitialLoad.add(kw)); 
              console.log(`[HomePage loadItems] Curated deals: Iteration ${currentBatchNumber}, fetching for keywords: "${keywordsForThisBatch.join('", "')}"`);
              
              const fetchedBatchesPromises = keywordsForThisBatch.map(kw => fetchItems('deal', kw, true));
              const fetchedBatchesResults = await Promise.allSettled(fetchedBatchesPromises);

              const newlyFetchedItemsInBatch = fetchedBatchesResults
                .filter(result => result.status === 'fulfilled')
                .flatMap(result => (result as PromiseFulfilledResult<BayBotItem[]>).value);
              
              const currentAccumulatedIds = new Set(accumulatedRawEbayItems.map(item => item.id));
              const uniqueNewItemsForAccumulation = newlyFetchedItemsInBatch.filter(item => !currentAccumulatedIds.has(item.id));
              
              accumulatedRawEbayItems.push(...uniqueNewItemsForAccumulation);
              console.log(`[HomePage loadItems] Curated deals: Iteration ${currentBatchNumber} added ${uniqueNewItemsForAccumulation.length} unique new items. Total raw items so far: ${accumulatedRawEbayItems.length}. Total unique keywords tried: ${attemptedKeywordsInitialLoad.size}`);

              if (attemptedKeywordsInitialLoad.size >= MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS) {
                console.log(`[HomePage loadItems] Curated deals: Reached max keywords limit (${MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS}).`);
                break;
              }
            }

            console.log(`[HomePage loadItems] Curated deals: Finished iterative raw fetch. Total raw items: ${accumulatedRawEbayItems.length} from ${attemptedKeywordsInitialLoad.size} keywords.`);

            if (accumulatedRawEbayItems.length > 0) {
              const aiQualifiedAndRankedItems: BayBotItem[] = await rankDealsAI(accumulatedRawEbayItems, "general curated deals");
              const aiCount = aiQualifiedAndRankedItems.length;
              console.log(`[HomePage loadItems] Curated deals: AI qualified ${aiCount} items from ${accumulatedRawEbayItems.length} raw items.`);

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

        if (!error && finalProcessedItems.length > 0) {
          try {
            sessionStorage.setItem(CURATED_DEALS_CACHE_KEY, JSON.stringify({ items: finalProcessedItems, timestamp: Date.now() }));
            console.log(`[HomePage loadItems] Saved ${finalProcessedItems.length} curated deals to sessionStorage.`);
          } catch (e) {
            console.warn("[HomePage loadItems] Error saving curated deals to sessionStorage:", e);
          }
        }
      }
    } else { 
      const effectiveQueryForEbay = queryToLoad;
      console.log(`[HomePage loadItems] Standard search. eBay Query: "${effectiveQueryForEbay}", Type: "deal"`);
      try {
        const fetchedItems: BayBotItem[] = await fetchItems('deal', effectiveQueryForEbay, false);
        console.log(`[HomePage loadItems] Fetched ${fetchedItems.length} items from server-side for query "${effectiveQueryForEbay}".`);

        if (fetchedItems.length > 0) {
          setIsRanking(true);
          const aiQueryContext = queryToLoad;
          const aiQualifiedAndRankedItems: BayBotItem[] = await rankDealsAI(fetchedItems, aiQueryContext);
          const aiCount = aiQualifiedAndRankedItems.length;

          finalProcessedItems = [...aiQualifiedAndRankedItems];
          console.log(`[HomePage loadItems] AI qualified and ranked ${aiCount} deals for query "${aiQueryContext}".`);

          if (aiCount < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiCount < fetchedItems.length) {
            const aiQualifiedIds = new Set(aiQualifiedAndRankedItems.map(d => d.id));
            const fallbackItems = fetchedItems.filter(d => !aiQualifiedIds.has(d.id));
            const numFallbacksToAdd = Math.max(0, MIN_DESIRED_CURATED_ITEMS - aiCount);
            finalProcessedItems.push(...fallbackItems.slice(0, numFallbacksToAdd));
            console.log(`[HomePage loadItems] AI returned ${aiCount} (<${MIN_AI_QUALIFIED_ITEMS_THRESHOLD}) deals. Appending ${Math.min(fallbackItems.length, numFallbacksToAdd)} server-processed fallback deals.`);
            overallToastMessage = { title: "Deals: AI Enhanced", description: `Displaying ${aiCount} AI-qualified deals for "${queryToLoad}", plus ${Math.min(fallbackItems.length, numFallbacksToAdd)} more.` };
          } else if (aiCount > 0) {
            overallToastMessage = { title: "Deals: AI Qualified", description: `Displaying ${aiCount} AI-qualified deals for "${queryToLoad}".` };
          } else if (fetchedItems.length > 0) { 
            finalProcessedItems = fetchedItems.slice(0, MIN_DESIRED_CURATED_ITEMS); 
            overallToastMessage = { title: "Deals: Server Processed", description: `Displaying server-processed deals for "${queryToLoad}". AI found no further qualifications.` };
            console.warn(`[HomePage loadItems] AI qualification returned no items for query "${aiQueryContext}". Using server-processed list (${finalProcessedItems.length} items) as fallback.`);
          } else {
             overallToastMessage = { title: "No Deals Found", description: `No deals found for "${queryToLoad}" after processing.` };
          }
        } else {
          overallToastMessage = { title: "No Deals Found", description: `No deals found for "${queryToLoad}" after server processing.` };
          console.log(`[HomePage loadItems] No items fetched for query "${queryToLoad}".`);
        }
      } catch (e: any) {
        console.error(`[HomePage loadItems] Failed to load items for query '${effectiveQueryForEbay}'. Error:`, e);
        let displayMessage = `Failed to load deals. Please try again.`;
        if (typeof e.message === 'string') {
          if (e.message.includes("invalid_client") || e.message.includes("Critical eBay API Authentication Failure")) {
            displayMessage = "Critical eBay API Authentication Failure. Check .env and server logs.";
            setIsAuthError(true);
          } else if (e.message.includes("OAuth") || e.message.includes("authenticate with eBay API")) {
            displayMessage = "eBay API Authentication Failed. Check credentials and server logs.";
            setIsAuthError(true);
          } else if (e.message.includes("Failed to fetch from eBay Browse API") || e.message.includes("Failed to fetch eBay items")) {
            displayMessage = `Error fetching from eBay for "${effectiveQueryForEbay}". Check query or eBay status. Server logs may have details.`;
          } else {
            displayMessage = e.message;
          }
        }
        setError(displayMessage);
        finalProcessedItems = [];
      } finally {
        setIsRanking(false);
      }
    }

    setAllItems(finalProcessedItems);
    setDisplayedItems(finalProcessedItems.slice(0, ITEMS_PER_PAGE));
    setIsLoading(false);
    if (isGlobalCuratedRequest) {
      setInitialLoadComplete(true); 
    }


    if (overallToastMessage && !error) {
      toast(overallToastMessage);
    } else if (error && !isAuthError) {
      toast({ title: "Error Loading Deals", description: error || "An unexpected error occurred.", variant: "destructive" });
    }
    console.log(`[HomePage loadItems] Finalizing. Displayed ${finalProcessedItems.slice(0, ITEMS_PER_PAGE).length} of ${finalProcessedItems.length} total items.`);
  }, [toast, ITEMS_PER_PAGE]);

  useEffect(() => {
    const isGlobalCuratedView = !currentQueryFromUrl;
    if (isGlobalCuratedView && initialLoadComplete && !topUpAttempted && !isLoading && !isRanking && !error && !isAuthError && allItems.length < MIN_DESIRED_CURATED_ITEMS) {
      console.log(`[HomePage Top-Up Effect] Current items ${allItems.length} < ${MIN_DESIRED_CURATED_ITEMS}. Initiating top-up for DEALS.`);
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
            if(randomKw && randomKw.trim() !== '' && !attemptedKeywordsForTopUp.has(randomKw)) {
              additionalKeywordsToFetch.push(randomKw);
              attemptedKeywordsForTopUp.add(randomKw);
            }
            uniqueKeywordSafety++;
          }


          if (additionalKeywordsToFetch.length === 0) {
              console.warn("[HomePage Top-Up Effect] No valid additional unique keywords for deals top-up. Aborting.");
              setIsLoading(false); setIsRanking(false); // Ensure loading is false if aborting
              return;
          }

          console.log(`[HomePage Top-Up Effect] Fetching deals for ${additionalKeywordsToFetch.length} additional keywords: ${additionalKeywordsToFetch.join(', ')}`);
          const additionalFetchedBatchesPromises = additionalKeywordsToFetch.map(kw => fetchItems('deal', kw, true));
          const additionalFetchedBatchesResults = await Promise.allSettled(additionalFetchedBatchesPromises);

          const successfullyFetchedAdditionalItems = additionalFetchedBatchesResults
              .filter(res => res.status === 'fulfilled')
              .flatMap(res => (res as PromiseFulfilledResult<BayBotItem[]>).value)
              .filter(item => !currentItemIds.has(item.id)); 

          if (successfullyFetchedAdditionalItems.length > 0) {
              console.log(`[HomePage Top-Up Effect] Fetched ${successfullyFetchedAdditionalItems.length} new unique additional deals.`);
              const combinedItemsForRanking = [...allItems, ...successfullyFetchedAdditionalItems];
              
              const finalToppedUpItems = await rankDealsAI(combinedItemsForRanking, "general curated deals top-up");
              
              setAllItems(finalToppedUpItems);
              sessionStorage.setItem(CURATED_DEALS_CACHE_KEY, JSON.stringify({ items: finalToppedUpItems, timestamp: Date.now() }));
              toast({ title: "More Curated Deals Loaded", description: `Now displaying ${finalToppedUpItems.length} deals.` });
          } else {
              console.log(`[HomePage Top-Up Effect] No new additional deals found from top-up fetch.`);
          }
        } catch (e: any) {
          console.error("[HomePage Top-Up Effect] Error during deals top-up:", e);
          toast({ title: "Error Topping Up Deals", description: e.message || "Failed to fetch additional deals.", variant: "destructive" });
        } finally {
          setIsLoading(false);
          setIsRanking(false);
        }
      })();
    }
  }, [allItems, initialLoadComplete, topUpAttempted, isLoading, isRanking, error, isAuthError, currentQueryFromUrl, toast]);

  useEffect(() => {
    const isGlobalCuratedView = !currentQueryFromUrl;
    if (isGlobalCuratedView && initialLoadComplete && !backgroundAuctionCacheAttempted && !isLoading && !isRanking && !error && allItems.length > 0) {
        setBackgroundAuctionCacheAttempted(true);
        console.log("[HomePage Background Cache] Conditions met for pre-caching auctions.");

        (async () => {
            try {
                const cachedAuctions = sessionStorage.getItem(CURATED_AUCTIONS_CACHE_KEY);
                if (cachedAuctions) {
                    const parsed = JSON.parse(cachedAuctions);
                    if (parsed.items && parsed.timestamp && (Date.now() - parsed.timestamp < GLOBAL_CURATED_CACHE_TTL_MS)) {
                        console.log("[HomePage Background Cache] Fresh curated auctions already in cache. Skipping proactive fetch.");
                        return;
                    }
                }
                console.log("[HomePage Background Cache] No fresh curated auctions in cache. Initiating proactive fetch for auctions.");

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

                if (keywordsForBackgroundAuctionCache.length === 0) {
                    console.warn("[HomePage Background Cache] No unique keywords generated for proactive auction caching.");
                    return;
                }
                
                console.log(`[HomePage Background Cache] Fetching auctions for background cache with keywords: ${keywordsForBackgroundAuctionCache.join(', ')}`);
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
                    console.log(`[HomePage Background Cache] Proactively cached ${finalBackgroundAuctions.length} auctions.`);
                } else {
                    console.log("[HomePage Background Cache] No auctions found to proactively cache.");
                }
            } catch (e: any) {
                console.error("[HomePage Background Cache] Error during proactive auction caching:", e);
            }
        })();
    }
  }, [allItems, initialLoadComplete, backgroundAuctionCacheAttempted, isLoading, isRanking, error, currentQueryFromUrl, toast]);


  useEffect(() => {
    console.log(`[HomePage URL useEffect] Current URL query: "${currentQueryFromUrl}". Triggering loadItems.`);
    setInputValue(currentQueryFromUrl); 
    loadItems(currentQueryFromUrl);
  }, [currentQueryFromUrl, loadItems]);


  const handleSearchSubmit = useCallback((query: string) => {
    const newPath = query ? `/?q=${encodeURIComponent(query)}` : '/';
    router.push(newPath);
  }, [router]);

  const handleLogoClick = useCallback(async () => {
    console.log('[HomePage handleLogoClick] Logo clicked. Clearing caches and preparing for background curated content refresh.');
    sessionStorage.removeItem(CURATED_DEALS_CACHE_KEY);
    sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
    setInputValue(''); 
    setInitialLoadComplete(false);
    setTopUpAttempted(false);
    setBackgroundAuctionCacheAttempted(false);


    (async () => {
      try {
        console.log('[HomePage handleLogoClick] Starting background curated content fetch (deals & auctions)...');
        
        const keywordPromises = Array.from({ length: MAX_CURATED_FETCH_ATTEMPTS }, () => getRandomPopularSearchTerm());
        const resolvedKeywords = await Promise.all(keywordPromises);
        const uniqueBackgroundKeywords = Array.from(new Set(resolvedKeywords.filter(kw => kw && kw.trim() !== '')));


        if (uniqueBackgroundKeywords.length === 0) {
          console.warn('[HomePage handleLogoClick] Background task: No valid unique keywords for curated content. Aborting.');
          return;
        }
        console.log(`[HomePage handleLogoClick] Background task: Using ${uniqueBackgroundKeywords.length} unique keywords: ${uniqueBackgroundKeywords.join(', ')}`);
        
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
              console.log(`[HomePage handleLogoClick] Background task: Saved ${aiRankedDeals.length} AI-ranked curated deals to sessionStorage.`);
              toast({ title: "Curated Deals Refreshed", description: `${aiRankedDeals.length} AI-ranked deals cached.` });
            } else {
              console.log('[HomePage handleLogoClick] Background task: No curated deals found to AI rank or cache.');
            }
          } catch (dealsError: any) {
            console.error('[HomePage handleLogoClick] Background task error (Deals):', dealsError);
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
              console.log(`[HomePage handleLogoClick] Background task: Saved ${finalBackgroundAuctions.length} active curated auctions (server-processed) to sessionStorage.`);
              toast({ title: "Curated Auctions Refreshed", description: `${finalBackgroundAuctions.length} server-processed auctions cached.` });
            } else {
              console.log('[HomePage handleLogoClick] Background task: No active curated auctions found to cache.');
            }
          } catch (auctionsError: any) {
            console.error('[HomePage handleLogoClick] Background task error (Auctions):', auctionsError);
            const errorMsg = auctionsError.message && auctionsError.message.includes("Authentication Failure") ? "Auctions refresh failed due to auth error." : "Could not refresh curated auctions.";
            toast({ title: "Auctions Refresh Failed", description: errorMsg, variant: "destructive" });
          }
        };

        await Promise.allSettled([dealsTask(), auctionsTask()]);
        console.log('[HomePage handleLogoClick] Background tasks for deals and auctions completed (or failed).');

      } catch (bgError) {
        console.error('[HomePage handleLogoClick] General error in background curated content refresh setup:', bgError);
      }
    })();
    router.push('/'); 
  }, [router, toast]);


  const handleLoadMore = () => {
    const newVisibleCount = visibleItemCount + ITEMS_PER_PAGE;
    setDisplayedItems(allItems.slice(0, newVisibleCount));
    setVisibleItemCount(newVisibleCount);
  };

  const handleAnalyzeItem = (item: BayBotItem) => {
    setSelectedItemForAnalysis(item);
    setIsAnalysisModalOpen(true);
  };

  const handleKeywordSearchFromModal = (keyword: string) => {
    setIsAnalysisModalOpen(false); 
    setInputValue(keyword); 
    router.push(`/?q=${encodeURIComponent(keyword)}`); 
  };


  let noItemsTitle = "No Deals Found";
  let noItemsDescription = currentQueryFromUrl
    ? `Try adjusting your search for "${currentQueryFromUrl}".`
    : "No global curated deals available right now. Check back later or try a specific search!";
  
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

        {(isLoading || (isRanking && displayedItems.length === 0)) && <ItemGridLoadingSkeleton count={ITEMS_PER_PAGE} /> }

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

