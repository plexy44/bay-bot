
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
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  CURATED_DEALS_CACHE_KEY,
  CURATED_AUCTIONS_CACHE_KEY,
  MIN_DESIRED_CURATED_ITEMS,
  MAX_CURATED_FETCH_ATTEMPTS,
  curatedHomepageSearchTerms
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
          if (cachedData && cachedData.items) {
            console.log(`[AuctionsPage loadItems] Found ${cachedData.items.length} curated auctions in sessionStorage.`);
            setAllItems(cachedData.items);
            setDisplayedItems(cachedData.items.slice(0, ITEMS_PER_PAGE));
            setIsLoading(false);
            toast({ title: "Loaded Cached Curated Auctions", description: "Displaying previously fetched auctions." });
            return;
          }
        }
      } catch (e) {
        console.warn("[AuctionsPage loadItems] Error with sessionStorage for curated auctions:", e);
        sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
      }

      console.log(`[AuctionsPage loadItems] Curated auctions: No valid cache. Fetching fresh. Target: ${MIN_DESIRED_CURATED_ITEMS} items from up to ${MAX_CURATED_FETCH_ATTEMPTS} unique keyword attempts.`);
      let accumulatedItems: BayBotItem[] = [];
      const attemptedKeywords = new Set<string>();
      let actualFetchAttempts = 0; // Counts actual fetches with unique keywords

      while (accumulatedItems.length < MIN_DESIRED_CURATED_ITEMS && actualFetchAttempts < MAX_CURATED_FETCH_ATTEMPTS) {
        let currentKeyword = '';
        let keywordObtentionAttempts = 0;
        const MAX_KEYWORD_OBTENTION_ATTEMPTS = curatedHomepageSearchTerms.length + 5; // Try a bit more than available unique terms

        // Loop to get a new, unique keyword
        while (keywordObtentionAttempts < MAX_KEYWORD_OBTENTION_ATTEMPTS) {
          currentKeyword = await getRandomPopularSearchTerm();
          if (!attemptedKeywords.has(currentKeyword)) {
            break; 
          }
          keywordObtentionAttempts++;
          if (attemptedKeywords.size >= curatedHomepageSearchTerms.length) {
            console.warn("[AuctionsPage loadItems] All available unique keywords from list have been attempted for curated auctions.");
            currentKeyword = ''; 
            break;
          }
        }

        if (!currentKeyword) {
          console.log("[AuctionsPage loadItems] Could not obtain a new unique keyword. Ending curated fetch for auctions.");
          break; 
        }
        
        attemptedKeywords.add(currentKeyword);
        actualFetchAttempts++;

        console.log(`[AuctionsPage loadItems] Curated auctions: Actual Fetch Attempt ${actualFetchAttempts}/${MAX_CURATED_FETCH_ATTEMPTS}. Keyword: "${currentKeyword}". Accumulated: ${accumulatedItems.length}`);
        
        try {
          const newBatch = await fetchItems('auction', currentKeyword, true);
          console.log(`[AuctionsPage loadItems] Fetched ${newBatch.length} auctions from server for keyword "${currentKeyword}".`);

          if (newBatch.length > 0) {
            const currentAccumulatedIds = new Set(accumulatedItems.map(item => item.id));
            const uniqueNewItems = newBatch.filter(item => !currentAccumulatedIds.has(item.id));
            accumulatedItems.push(...uniqueNewItems);
            console.log(`[AuctionsPage loadItems] Added ${uniqueNewItems.length} unique server-processed auctions for "${currentKeyword}". Total accumulated: ${accumulatedItems.length}.`);
          } else {
            console.log(`[AuctionsPage loadItems] No auctions found for keyword "${currentKeyword}".`);
          }

        } catch (e: any) {
          console.error(`[AuctionsPage loadItems] Error during curated auction fetch attempt ${actualFetchAttempts} with keyword "${currentKeyword}":`, e);
          let displayMessage = `Failed to load some curated auctions (attempt ${actualFetchAttempts}).`;
           if (typeof e.message === 'string') {
            if (e.message.includes("invalid_client") || e.message.includes("Critical eBay API Authentication Failure")) {
              displayMessage = "Critical eBay API Authentication Failure. Check .env and server logs."; setIsAuthError(true);
              setError(displayMessage);
              break; 
            } else if (e.message.includes("OAuth") || e.message.includes("authenticate with eBay API")) {
              displayMessage = "eBay API Authentication Failed. Check credentials and server logs."; setIsAuthError(true);
              setError(displayMessage);
              break; 
            }
          }
          toast({ title: "Fetch Warning", description: displayMessage, variant: "destructive" });
          if (isAuthError) break;
        }
        
        if (accumulatedItems.length >= MIN_DESIRED_CURATED_ITEMS) {
             console.log(`[AuctionsPage loadItems] Curated auctions: Met or exceeded target of ${MIN_DESIRED_CURATED_ITEMS} items (${accumulatedItems.length}). Stopping fetch attempts.`);
             break;
        }
      }
      
      finalProcessedItems = accumulatedItems;

      if (finalProcessedItems.length > 0) {
        overallToastMessage = { title: "Curated Auctions: Server Processed", description: `Displaying ${finalProcessedItems.length} server-processed auctions from ${actualFetchAttempts} unique keyword attempts.` };
      } else if (!error) {
        overallToastMessage = { title: "No Curated Auctions", description: `Could not find enough curated auctions after ${actualFetchAttempts} attempts.` };
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
    }
    console.log(`[AuctionsPage loadItems] Finalizing. Displayed ${finalProcessedItems.slice(0, ITEMS_PER_PAGE).length} of ${finalProcessedItems.length} total auctions.`);
  }, [toast]);

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
    console.log('[AuctionsPage handleLogoClick] Logo clicked. Clearing UI and preparing for background curated auctions refresh.');
    sessionStorage.removeItem(CURATED_DEALS_CACHE_KEY);
    sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
    setInputValue(''); 

    // This background task fetches auctions only.
    (async () => {
      try {
        console.log('[AuctionsPage handleLogoClick] Starting background curated auctions fetch (server-processed only)...');
        const backgroundKeywordPromises = Array.from({ length: MAX_CURATED_FETCH_ATTEMPTS }, () => getRandomPopularSearchTerm());
        const resolvedBackgroundKeywords = await Promise.all(backgroundKeywordPromises);
        const uniqueBackgroundKeywords = Array.from(new Set(resolvedBackgroundKeywords.filter(kw => kw && kw.trim() !== '')));

        if (uniqueBackgroundKeywords.length === 0) {
          console.warn('[AuctionsPage handleLogoClick] Background task: No valid keywords for curated auctions. Aborting.');
          return;
        }
        
        const backgroundFetchedBatchesPromises = uniqueBackgroundKeywords.map(kw =>
          fetchItems('auction', kw, true) // Fetch as global curated
        );
        const backgroundFetchedBatches = await Promise.all(backgroundFetchedBatchesPromises);
        
        const consolidatedBackgroundItems = backgroundFetchedBatches.flat();
        const uniqueConsolidatedBackgroundMap = new Map<string, BayBotItem>();
        consolidatedBackgroundItems.forEach(item => {
          if (!uniqueConsolidatedBackgroundMap.has(item.id)) {
            uniqueConsolidatedBackgroundMap.set(item.id, item);
          }
        });
        const finalBackgroundAuctions = Array.from(uniqueConsolidatedBackgroundMap.values());

        if (finalBackgroundAuctions.length > 0) {
          sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: finalBackgroundAuctions, timestamp: Date.now() }));
          console.log(`[AuctionsPage handleLogoClick] Background task: Saved ${finalBackgroundAuctions.length} curated auctions (server-processed) to sessionStorage.`);
           toast({ title: "Curated Auctions Refreshed", description: "New set of server-processed curated auctions cached." });
        } else {
           console.log('[AuctionsPage handleLogoClick] Background task: No curated auctions found to cache.');
        }
      } catch (bgError) {
        console.error('[AuctionsPage handleLogoClick] Error in background auction caching:', bgError);
        // Avoid destructive toast here as user is navigating away
        // toast({ title: "Background Refresh Failed", description: "Could not refresh curated auctions in background.", variant: "destructive" });
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
                <ItemCard key={item.id} item={item} onAnalyze={handleAnalyzeItem} />
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

    