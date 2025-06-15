
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
import { ShoppingBag, AlertTriangle, Info } from "lucide-react";
import type { BayBotItem } from '@/types';
import { fetchItems, getRandomPopularSearchTerm } from '@/services/ebay-api-service';
// AI ranking for auctions is removed, so qualifyAuctionsAI is not needed.
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  CURATED_AUCTIONS_CACHE_KEY,
  CURATED_DEALS_CACHE_KEY, // Still needed for handleLogoClick
  MIN_DESIRED_CURATED_ITEMS, // Used as a general target
  MAX_CURATED_FETCH_ATTEMPTS
} from '@/lib/constants';

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
  const [isLoading, setIsLoading] = useState(true); // For initial load / primary content
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);

  const [selectedItemForAnalysis, setSelectedItemForAnalysis] = useState<BayBotItem | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

  const { toast } = useToast();

  const loadItems = useCallback(async (queryToLoad: string) => {
    console.log(`[AuctionsPage loadItems] Initiating. Query: "${queryToLoad}"`);
    const isGlobalCuratedRequest = queryToLoad === '';

    // Reset states for new load, but not if it's just a background enhancement.
    // The progressive load handles its own state updates.
    if (!isGlobalCuratedRequest) { // For user searches, reset fully
        setAllItems([]);
        setDisplayedItems([]);
        setVisibleItemCount(ITEMS_PER_PAGE);
    }
    setIsLoading(true); // Always true for a new focused load (search or initial curated)
    setError(null);
    setIsAuthError(false);

    let overallToastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;

    if (isGlobalCuratedRequest) {
      try {
        const cachedDataString = sessionStorage.getItem(CURATED_AUCTIONS_CACHE_KEY);
        if (cachedDataString) {
          const cachedData = JSON.parse(cachedDataString);
          const activeCachedItems = (cachedData.items as BayBotItem[] || []).filter(item => {
            return item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : true;
          });

          if (activeCachedItems.length > 0) {
            console.log(`[AuctionsPage loadItems] Found ${activeCachedItems.length} active curated auctions in sessionStorage.`);
            setAllItems(activeCachedItems);
            // displayedItems will update via useEffect
            setIsLoading(false);
            toast({ title: "Loaded Cached Curated Auctions", description: "Displaying previously fetched active auctions." });
            return; // Exit if valid cache found
          } else {
            console.log(`[AuctionsPage loadItems] All cached curated auctions ended or cache empty. Fetching fresh.`);
            sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
          }
        }
      } catch (e) {
        console.warn("[AuctionsPage loadItems] Error with sessionStorage for curated auctions:", e);
        sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
      }

      // --- Progressive Loading for Global Curated Auctions ---
      console.log(`[AuctionsPage loadItems] Curated auctions: Starting progressive load.`);
      let initialItems: BayBotItem[] = [];
      const attemptedKeywordsForSession = new Set<string>();
      let initialFetchError = null;

      // 1. Initial Foreground Fetch
      try {
        let firstKeyword = '';
        let keywordFetchAttempts = 0;
        while (!firstKeyword && keywordFetchAttempts < 5) { // Try to get a unique keyword
            const randomKw = await getRandomPopularSearchTerm();
            if (!attemptedKeywordsForSession.has(randomKw)) {
                firstKeyword = randomKw;
                attemptedKeywordsForSession.add(randomKw);
            }
            keywordFetchAttempts++;
        }
        if (!firstKeyword) throw new Error("Failed to get unique initial keyword for curated auctions.");

        console.log(`[AuctionsPage loadItems] Curated (Initial): Fetching for keyword "${firstKeyword}".`);
        initialItems = await fetchItems('auction', firstKeyword, true);
        
        if (initialItems.length > 0) {
            setAllItems(initialItems);
            // displayedItems will update via useEffect
            sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: initialItems, timestamp: Date.now() }));
            toast({ title: "Initial Auctions Loaded", description: `Found ${initialItems.length} from first keyword. Fetching more...` });
        } else {
            toast({ title: "Initial Auctions", description: `No auctions from first keyword. Fetching more...` });
        }
      } catch (e: any) {
        console.error(`[AuctionsPage loadItems] Curated (Initial): Error fetching:`, e);
        initialFetchError = e.message || "Failed to fetch initial auctions.";
        if (e.message?.includes("Authentication Failure") || e.message?.includes("invalid_client")) {
          setIsAuthError(true);
          setError(initialFetchError); // Show auth error immediately
        }
      } finally {
        setIsLoading(false); // Initial loading is done
      }

      // 2. Background Enhancement Fetches (only if no critical auth error from initial)
      if (!isAuthError && MAX_CURATED_FETCH_ATTEMPTS > 1) {
        (async () => {
          console.log(`[AuctionsPage loadItems] Curated (Background): Starting enhancement fetches.`);
          const additionalKeywordsToFetch: string[] = [];
          let uniqueKeywordAttempts = 0;
          while (additionalKeywordsToFetch.length < MAX_CURATED_FETCH_ATTEMPTS - 1 && uniqueKeywordAttempts < 10) {
            const randomKw = await getRandomPopularSearchTerm();
            if (!attemptedKeywordsForSession.has(randomKw)) {
              additionalKeywordsToFetch.push(randomKw);
              attemptedKeywordsForSession.add(randomKw);
            }
            uniqueKeywordAttempts++;
          }

          if (additionalKeywordsToFetch.length > 0) {
            console.log(`[AuctionsPage loadItems] Curated (Background): Fetching for ${additionalKeywordsToFetch.length} additional keywords: ${additionalKeywordsToFetch.join(', ')}`);
            const backgroundFetchPromises = additionalKeywordsToFetch.map(kw => fetchItems('auction', kw, true));
            const backgroundResults = await Promise.allSettled(backgroundFetchPromises);

            const successfullyFetchedBackgroundItems = backgroundResults
              .filter(res => res.status === 'fulfilled')
              .flatMap(res => (res as PromiseFulfilledResult<BayBotItem[]>).value);

            if (successfullyFetchedBackgroundItems.length > 0) {
              setAllItems(prevAllItems => {
                const combined = [...prevAllItems, ...successfullyFetchedBackgroundItems];
                const uniqueMap = new Map(combined.map(item => [item.id, item]));
                const newAllItems = Array.from(uniqueMap.values());
                
                // Filter out ended auctions again before final set and cache
                const activeNewAllItems = newAllItems.filter(item => {
                    return item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : true;
                });

                sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: activeNewAllItems, timestamp: Date.now() }));
                console.log(`[AuctionsPage loadItems] Curated (Background): Merged ${successfullyFetchedBackgroundItems.length} new items. Total unique active: ${activeNewAllItems.length}`);
                toast({ title: "More Curated Auctions Loaded", description: `Now displaying ${activeNewAllItems.length} auctions.` });
                return activeNewAllItems;
              });
            } else {
                console.log(`[AuctionsPage loadItems] Curated (Background): No additional items from background fetches.`);
            }
          } else {
             console.log(`[AuctionsPage loadItems] Curated (Background): No additional unique keywords to fetch for background enhancement.`);
          }
        })();
      } else if (isAuthError) {
          console.log("[AuctionsPage loadItems] Curated (Background): Skipped due to initial auth error.");
      }
      
      // If initial fetch failed and no background enhancement happens or also fails
      if (initialItems.length === 0 && (MAX_CURATED_FETCH_ATTEMPTS <= 1 || isAuthError) && initialFetchError && !error) {
        setError(initialFetchError);
      } else if (initialItems.length === 0 && !initialFetchError && !error && !isAuthError) {
        // This means initial fetch was successful but returned 0 items, and we are waiting for background
        // If background also yields nothing, a "no items found" message will appear.
        // No explicit error here, handled by NoItemsMessage component.
      }

    } else { // --- Standard User Search for Auctions ---
      console.log(`[AuctionsPage loadItems] Standard auction search. eBay Query: "${queryToLoad}"`);
      let fetchedItems: BayBotItem[] = [];
      try {
        fetchedItems = await fetchItems('auction', queryToLoad, false);
        console.log(`[AuctionsPage loadItems] Fetched ${fetchedItems.length} auctions from server for query "${queryToLoad}".`);
        
        const activeFetchedItems = fetchedItems.filter(item => {
            return item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : true;
        });
        
        if (activeFetchedItems.length !== fetchedItems.length) {
            console.log(`[AuctionsPage loadItems] Filtered out ${fetchedItems.length - activeFetchedItems.length} ended auctions from user search results.`);
        }

        setAllItems(activeFetchedItems);
        // displayedItems will update via useEffect

        if (activeFetchedItems.length > 0) {
          overallToastMessage = { title: "Auctions Found", description: `Displaying ${activeFetchedItems.length} auctions for "${queryToLoad}".` };
        } else {
          overallToastMessage = { title: "No Auctions Found", description: `No active auctions found for "${queryToLoad}".` };
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
        setAllItems([]); // Ensure allItems is empty on error
      } finally {
        setIsLoading(false);
      }
      if (overallToastMessage && !error) {
        toast(overallToastMessage);
      } else if (error && !isAuthError) {
        toast({ title: "Error Loading Auctions", description: error || "An unexpected error occurred.", variant: "destructive" });
      }
    }
    // The main setIsLoading(false) is handled within each branch (curated progressive or user search)
    // console.log(`[AuctionsPage loadItems] Finalizing.isLoading should be false if not a new progressive load.`);
  }, [toast]); // Removed currentQueryFromUrl, it's passed as queryToLoad

  useEffect(() => {
    console.log(`[AuctionsPage URL useEffect] Current URL query: "${currentQueryFromUrl}". Triggering loadItems.`);
    setInputValue(currentQueryFromUrl); // Keep search bar in sync
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

    (async () => {
      try {
        console.log('[AuctionsPage handleLogoClick] Starting background curated content fetch (deals & auctions)...');
        const keywordPromises = Array.from({ length: MAX_CURATED_FETCH_ATTEMPTS }, () => getRandomPopularSearchTerm());
        const resolvedKeywords = await Promise.all(keywordPromises);
        const uniqueBackgroundKeywords = Array.from(new Set(resolvedKeywords.filter(kw => kw && kw.trim() !== '')));

        if (uniqueBackgroundKeywords.length === 0) {
          console.warn('[AuctionsPage handleLogoClick] Background task: No valid keywords for curated content. Aborting.');
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
              // Assuming rankDealsAI is imported for deals page, or this needs to be adjusted if not.
              // For this file, it's not imported. Let's say deals are not AI ranked for simplicity here,
              // or we'd need to import rankDealsAI.
              // For now, just cache server-processed deals.
              sessionStorage.setItem(CURATED_DEALS_CACHE_KEY, JSON.stringify({ items: uniqueDeals, timestamp: Date.now() }));
              console.log(`[AuctionsPage handleLogoClick] Background task: Saved ${uniqueDeals.length} server-processed curated deals to sessionStorage.`);
              toast({ title: "Curated Deals Refreshed", description: `${uniqueDeals.length} deals cached.` });
            } else {
              console.log('[AuctionsPage handleLogoClick] Background task: No curated deals found to cache.');
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
                .filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : true); // Filter ended
              
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
    // No change needed here, setDisplayedItems is handled by useEffect based on allItems & visibleItemCount
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
    
    // Update cache only if it's the global curated view being affected
    const isGlobalCuratedViewOnPage = !currentQueryFromUrl;
    if (isGlobalCuratedViewOnPage) {
        try {
            const cachedDataString = sessionStorage.getItem(CURATED_AUCTIONS_CACHE_KEY);
            if (cachedDataString) {
                const cachedData = JSON.parse(cachedDataString);
                if (cachedData && cachedData.items && Array.isArray(cachedData.items)) {
                    const updatedCachedItems = cachedData.items.filter((i: BayBotItem) => i.id !== endedItemId);
                    if (updatedCachedItems.length > 0) {
                        sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: updatedCachedItems, timestamp: Date.now() }));
                    } else {
                        sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
                    }
                    console.log(`[AuctionsPage handleAuctionEnd] Updated sessionStorage cache. Removed item ${endedItemId}. New cache size: ${updatedCachedItems.length}`);
                }
            }
        } catch (e) {
            console.warn(`[AuctionsPage handleAuctionEnd] Error updating sessionStorage for ended auction ${endedItemId}:`, e);
        }
    }
    const endedItem = allItems.find(item => item.id === endedItemId);
    toast({ 
        title: "Auction Ended", 
        description: `${endedItem ? `"${endedItem.title.substring(0,30)}..."` : "An auction"} has ended and been removed.` 
    });
  }, [allItems, currentQueryFromUrl, toast]);


  useEffect(() => {
    // This effect ensures displayedItems updates if allItems or visibleItemCount changes
    const activeItems = allItems.filter(item => {
        return item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : true;
    });
    if(allItems.length !== activeItems.length) {
        // If allItems contained ended auctions, update allItems to reflect only active ones
        // This can happen if background fetches complete with items that ended in the meantime
        setAllItems(activeItems); 
    }
    setDisplayedItems(activeItems.slice(0, visibleItemCount));
  }, [allItems, visibleItemCount]);

  let noItemsTitle = "No Auctions Found";
  let noItemsDescription = currentQueryFromUrl
    ? `Try adjusting your search for "${currentQueryFromUrl}".`
    : "No global curated auctions available right now. Check back later or try a specific search!";
  
  if (allItems.length === 0 && !isLoading && !error && currentQueryFromUrl === '') {
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

        {isLoading && <ItemGridLoadingSkeleton count={ITEMS_PER_PAGE} />}

        {!isLoading && displayedItems.length === 0 && !error && (
           <NoItemsMessage title={noItemsTitle} description={noItemsDescription} />
        )}

        {!isLoading && displayedItems.length > 0 && (
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
            {/* Show Load More if there are more items in allItems than currently displayed,
                AND those items are active (not ended) */}
            {allItems.filter(item => item.type === 'auction' && item.endTime ? new Date(item.endTime).getTime() > Date.now() : true).length > displayedItems.length && (
              <div className="text-center">
                <Button onClick={handleLoadMore} size="lg" variant="outline">
                  <ShoppingBag className="mr-2 h-5 w-5" /> Load More Auctions
                </Button>
              </div>
            )}
          </>
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
