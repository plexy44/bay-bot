
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
import { ShoppingBag, AlertTriangle, Info } from "lucide-react";
import type { BayBotItem } from '@/types';
import { fetchItems, getRandomPopularSearchTerm } from '@/services/ebay-api-service';
import { rankDeals as rankDealsAI } from '@/ai/flows/rank-deals'; // Still needed for BG deals caching
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  CURATED_AUCTIONS_CACHE_KEY,
  CURATED_DEALS_CACHE_KEY,
  MIN_DESIRED_CURATED_ITEMS,
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);

  const [selectedItemForAnalysis, setSelectedItemForAnalysis] = useState<BayBotItem | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

  const { toast } = useToast();

  const loadItems = useCallback(async (queryToLoad: string) => {
    console.log(`[AuctionsPage loadItems] Initiating. Query: "${queryToLoad}"`);
    const isGlobalCuratedRequest = queryToLoad === '';

    setAllItems([]);
    setDisplayedItems([]);
    setVisibleItemCount(ITEMS_PER_PAGE);
    setIsLoading(true);
    setError(null);
    setIsAuthError(false);

    let finalProcessedItems: BayBotItem[] = [];
    let overallToastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;

    if (isGlobalCuratedRequest) {
      try {
        const cachedDataString = sessionStorage.getItem(CURATED_AUCTIONS_CACHE_KEY);
        if (cachedDataString) {
          const cachedData = JSON.parse(cachedDataString);
          if (cachedData && cachedData.items && Array.isArray(cachedData.items)) {
            const stillActiveCachedItems = cachedData.items.filter((item: BayBotItem) => {
                if (item.type === 'auction' && item.endTime) {
                    return new Date(item.endTime).getTime() > Date.now();
                }
                return true;
            });

            if (stillActiveCachedItems.length !== cachedData.items.length) {
                console.log(`[AuctionsPage loadItems] Filtered out ${cachedData.items.length - stillActiveCachedItems.length} ended auctions from sessionStorage cache.`);
                if (stillActiveCachedItems.length > 0) {
                    sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: stillActiveCachedItems, timestamp: Date.now() }));
                } else {
                    sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
                }
            }
            
            if (stillActiveCachedItems.length > 0) {
                 console.log(`[AuctionsPage loadItems] Found ${stillActiveCachedItems.length} active curated auctions in sessionStorage.`);
                setAllItems(stillActiveCachedItems);
                setDisplayedItems(stillActiveCachedItems.slice(0, ITEMS_PER_PAGE));
                setIsLoading(false);
                toast({ title: "Loaded Cached Curated Auctions", description: "Displaying previously fetched active auctions." });
                return;
            } else {
                 console.log(`[AuctionsPage loadItems] All cached curated auctions were ended or cache was empty/invalid.`);
                 sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
            }
          }
        }
      } catch (e) {
        console.warn("[AuctionsPage loadItems] Error with sessionStorage for curated auctions:", e);
        sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
      }

      console.log(`[AuctionsPage loadItems] Curated auctions: No valid cache or all items ended. Fetching fresh. Target: ${MIN_DESIRED_CURATED_ITEMS} items from up to ${MAX_CURATED_FETCH_ATTEMPTS} unique keywords.`);
      
      const accumulatedItems: BayBotItem[] = [];
      let fetchCountForToast = 0;

      try {
        const keywordPromises = Array.from({ length: MAX_CURATED_FETCH_ATTEMPTS }, () => getRandomPopularSearchTerm());
        const resolvedKeywords = await Promise.all(keywordPromises);
        const uniqueRandomKeywords = Array.from(new Set(resolvedKeywords.filter(kw => kw && kw.trim() !== '')));
        
        fetchCountForToast = uniqueRandomKeywords.length;
        console.log(`[AuctionsPage loadItems] Curated auctions: Using ${uniqueRandomKeywords.length} resolved unique keywords: ${uniqueRandomKeywords.join(', ')}`);

        if (uniqueRandomKeywords.length === 0) {
            console.warn("[AuctionsPage loadItems] Curated auctions: No valid keywords generated after resolving promises. Aborting fetch.");
            throw new Error("Failed to generate valid keywords for curated auctions.");
        }

        const fetchedBatchesPromises = uniqueRandomKeywords.map(kw =>
            fetchItems('auction', kw, true)
        );
        const fetchedBatchesResults = await Promise.allSettled(fetchedBatchesPromises);
        
        const successfulFetches = fetchedBatchesResults
            .filter(result => {
                if (result.status === 'rejected') {
                    const e = result.reason;
                    console.error(`[AuctionsPage loadItems] Error during one of the curated auction fetches:`, e);
                    let displayMessage = "Failed to load some curated auctions.";
                     if (typeof e.message === 'string') {
                        if (e.message.includes("invalid_client") || e.message.includes("Critical eBay API Authentication Failure")) {
                            displayMessage = "Critical eBay API Authentication Failure. Check .env and server logs."; setIsAuthError(true);
                        } else if (e.message.includes("OAuth") || e.message.includes("authenticate with eBay API")) {
                            displayMessage = "eBay API Authentication Failed. Check credentials and server logs."; setIsAuthError(true);
                        } else { displayMessage = e.message; }
                    }
                    setError(prevError => prevError ? `${prevError}. ${displayMessage}` : displayMessage);
                    if (isAuthError) throw new Error("Authentication error during batch fetch."); // Propagate to stop all
                    return false; // Exclude from successfulFetches
                }
                return true; // Include fulfilled promises
            })
            .map(result => (result as PromiseFulfilledResult<BayBotItem[]>).value);

        const consolidatedItems = successfulFetches.flat();
        const uniqueConsolidatedItemsMap = new Map<string, BayBotItem>();
        consolidatedItems.forEach(item => {
            if (!uniqueConsolidatedItemsMap.has(item.id)) {
                uniqueConsolidatedItemsMap.set(item.id, item);
            }
        });
        accumulatedItems.push(...Array.from(uniqueConsolidatedItemsMap.values()));
        console.log(`[AuctionsPage loadItems] Curated auctions: Fetched and consolidated ${accumulatedItems.length} unique server-processed auctions from ${successfulFetches.length} successful keyword fetches.`);

      } catch (e: any) { // Catches errors from keyword generation or auth error propagation
          console.error(`[AuctionsPage loadItems] Overall error in curated auction fetch loop:`, e);
          if (!error && !isAuthError) { // If no specific API error was already set
              setError(e.message || "An unexpected error occurred during curated auction fetch.");
          }
      }
      
      finalProcessedItems = accumulatedItems;
      
      if (finalProcessedItems.length > 0) {
        overallToastMessage = { title: "Curated Auctions: Server Processed", description: `Displaying ${finalProcessedItems.length} server-processed auctions from ${fetchCountForToast} keyword attempts.` };
      } else if (!error) {
        overallToastMessage = { title: "No Curated Auctions", description: `Could not find enough curated auctions after ${fetchCountForToast} keyword attempts.` };
      }
      
      if (!error && finalProcessedItems.length > 0) {
        try {
          sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: finalProcessedItems, timestamp: Date.now() }));
          console.log(`[AuctionsPage loadItems] Saved ${finalProcessedItems.length} curated auctions to sessionStorage.`);
        } catch (e) {
          console.warn("[AuctionsPage loadItems] Error saving curated auctions to sessionStorage:", e);
        }
      }
    } else { 
      const effectiveQueryForEbay = queryToLoad;
      console.log(`[AuctionsPage loadItems] Standard auction search. eBay Query: "${effectiveQueryForEbay}"`);
      try {
        const fetchedItems: BayBotItem[] = await fetchItems('auction', effectiveQueryForEbay, false);
        console.log(`[AuctionsPage loadItems] Fetched ${fetchedItems.length} auctions from server for query "${effectiveQueryForEbay}".`);

        finalProcessedItems = fetchedItems;

        if (fetchedItems.length > 0) {
            overallToastMessage = { title: "Auctions: Server Processed", description: `Displaying ${fetchedItems.length} server-processed auctions for "${effectiveQueryForEbay}".` };
        } else {
            overallToastMessage = { title: "No Auctions Found", description: `No auctions found for "${effectiveQueryForEbay}".` };
        }

      } catch (e: any) {
        console.error(`[AuctionsPage loadItems] Failed to load auctions for query '${effectiveQueryForEbay}'. Error:`, e);
        let displayMessage = `Failed to load auctions for "${effectiveQueryForEbay}". Please try again.`;
        if (typeof e.message === 'string') {
          if (e.message.includes("invalid_client") || e.message.includes("Critical eBay API Authentication Failure")) {
            displayMessage = "Critical eBay API Authentication Failure. Check .env and server logs."; setIsAuthError(true);
          } else if (e.message.includes("OAuth") || e.message.includes("authenticate with eBay API")) {
            displayMessage = "eBay API Authentication Failed. Check credentials and server logs."; setIsAuthError(true);
          } else { displayMessage = e.message; }
        }
        setError(displayMessage);
        finalProcessedItems = [];
      }
    }

    setAllItems(finalProcessedItems);
    setDisplayedItems(finalProcessedItems.slice(0, ITEMS_PER_PAGE));
    setIsLoading(false);

    if (overallToastMessage && !error) {
      toast(overallToastMessage);
    } else if (error && !isAuthError) {
      toast({ title: "Error Loading Auctions", description: error || "An unexpected error occurred.", variant: "destructive" });
    } else if (error && isAuthError) {
       console.log("[AuctionsPage loadItems] Auth error detected. Error will be shown in Alert component.");
    }
    console.log(`[AuctionsPage loadItems] Finalizing. Displayed ${finalProcessedItems.slice(0, ITEMS_PER_PAGE).length} of ${finalProcessedItems.length} total auctions.`);
  }, [toast, currentQueryFromUrl]);

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
            const finalBackgroundAuctions = Array.from(uniqueAuctionsMap.values());
              
            if (finalBackgroundAuctions.length > 0) {
              sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: finalBackgroundAuctions, timestamp: Date.now() }));
              console.log(`[AuctionsPage handleLogoClick] Background task: Saved ${finalBackgroundAuctions.length} curated auctions (server-processed) to sessionStorage.`);
              toast({ title: "Curated Auctions Refreshed", description: `${finalBackgroundAuctions.length} server-processed auctions cached.` });
            } else {
              console.log('[AuctionsPage handleLogoClick] Background task: No curated auctions found to cache.');
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
    router.push(`/auctions?q=${encodeURIComponent(keyword)}`);
  };

  const handleAuctionEnd = useCallback((endedItemId: string) => {
    setAllItems(prevItems => prevItems.filter(item => item.id !== endedItemId));
    
    const isGlobalCuratedView = !currentQueryFromUrl;
    if (isGlobalCuratedView) {
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
    const endedItem = allItems.find(item => item.id === endedItemId); // Find before state updates
    toast({ 
        title: "Auction Ended", 
        description: `${endedItem ? `"${endedItem.title.substring(0,30)}..."` : "An auction"} has ended and been removed.` 
    });
  }, [allItems, currentQueryFromUrl, toast]);


  useEffect(() => {
    setDisplayedItems(allItems.slice(0, visibleItemCount));
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
        isLoading={isLoading} // Pass loading state
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
            {visibleItemCount < allItems.length && (
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
