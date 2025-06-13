
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
import { qualifyAuctions as qualifyAuctionsAI } from '@/ai/flows/qualify-auctions';
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  CURATED_DEALS_CACHE_KEY, // For clearing on logo click
  CURATED_AUCTIONS_CACHE_KEY,
  MIN_DESIRED_CURATED_ITEMS,
  MAX_CURATED_FETCH_ATTEMPTS,
  MIN_AI_QUALIFIED_ITEMS_THRESHOLD
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
  const [isQualifying, setIsQualifying] = useState(false);
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
    setIsQualifying(false);
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

      console.log(`[AuctionsPage loadItems] Curated auctions: No valid cache. Fetching fresh. Target: ${MIN_DESIRED_CURATED_ITEMS} items.`);
      setIsQualifying(true); // Show AI spinner during the consolidated fetch + AI process

      try {
        const uniqueRandomKeywords = Array.from(new Set(Array.from({ length: MAX_CURATED_FETCH_ATTEMPTS }, () => getRandomPopularSearchTerm())));
        console.log(`[AuctionsPage loadItems] Curated auctions: Using ${uniqueRandomKeywords.length} keywords: ${uniqueRandomKeywords.join(', ')}`);

        const fetchedBatches = await Promise.all(
          uniqueRandomKeywords.map(kw => fetchItems('auction', kw, true))
        );
        
        const consolidatedItems = fetchedBatches.flat();
        const uniqueConsolidatedItemsMap = new Map<string, BayBotItem>();
        consolidatedItems.forEach(item => {
          if (!uniqueConsolidatedItemsMap.has(item.id)) {
            uniqueConsolidatedItemsMap.set(item.id, item);
          }
        });
        const uniqueConsolidatedItems = Array.from(uniqueConsolidatedItemsMap.values());
        console.log(`[AuctionsPage loadItems] Curated auctions: Fetched ${uniqueConsolidatedItems.length} unique items from eBay across keywords.`);

        if (uniqueConsolidatedItems.length > 0) {
          const aiQualifiedAndRankedItems: BayBotItem[] = await qualifyAuctionsAI(uniqueConsolidatedItems, "general curated auctions");
          const aiCount = aiQualifiedAndRankedItems.length;
          console.log(`[AuctionsPage loadItems] Curated auctions: AI qualified ${aiCount} items.`);

          finalProcessedItems = [...aiQualifiedAndRankedItems];

          if (aiCount < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiCount < uniqueConsolidatedItems.length) {
            const aiQualifiedIds = new Set(aiQualifiedAndRankedItems.map(d => d.id));
            const fallbackItems = uniqueConsolidatedItems.filter(d => !aiQualifiedIds.has(d.id));
            finalProcessedItems.push(...fallbackItems);
            overallToastMessage = { title: "Curated Auctions: AI Enhanced", description: `Displaying ${aiCount} AI-qualified auctions, plus ${fallbackItems.length} more.` };
          } else if (aiCount === 0 && uniqueConsolidatedItems.length > 0) {
            finalProcessedItems = uniqueConsolidatedItems;
            overallToastMessage = { title: "Curated Auctions: Server Processed", description: `Displaying ${uniqueConsolidatedItems.length} server-processed auctions. AI found no specific qualifications.` };
          } else if (aiCount > 0) {
            overallToastMessage = { title: "Curated Auctions: AI Qualified", description: `Displaying ${aiCount} AI-qualified auctions.` };
          } else {
             overallToastMessage = { title: "No Curated Auctions", description: "Could not find any curated auctions matching criteria." };
          }
        } else {
          overallToastMessage = { title: "No Curated Auctions", description: "No auctions found from initial fetch." };
        }
        
        if (finalProcessedItems.length < MIN_DESIRED_CURATED_ITEMS && finalProcessedItems.length > 0) {
             console.warn(`[AuctionsPage loadItems] Curated auction fetch resulted in ${finalProcessedItems.length} items, less than target ${MIN_DESIRED_CURATED_ITEMS}. Toast already set by primary/fallback logic.`);
        } else if (finalProcessedItems.length === 0 && !overallToastMessage) {
             overallToastMessage = { title: "No Curated Auctions", description: "No auctions found after processing." };
        }

      } catch (e: any) {
        console.error(`[AuctionsPage loadItems] Error fetching curated auctions:`, e);
        let displayMessage = "Failed to load curated auctions.";
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
        setIsQualifying(false);
      }

      if (!error && finalProcessedItems.length > 0) {
        try {
          sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: finalProcessedItems, timestamp: Date.now() }));
          console.log(`[AuctionsPage loadItems] Saved ${finalProcessedItems.length} curated auctions to sessionStorage.`);
        } catch (e) {
          console.warn("[AuctionsPage loadItems] Error saving curated auctions to sessionStorage:", e);
        }
      }

    } else { // Standard user search logic for auctions
      const effectiveQueryForEbay = queryToLoad;
      console.log(`[AuctionsPage loadItems] Standard auction search. eBay Query: "${effectiveQueryForEbay}"`);
      try {
        const fetchedItems: BayBotItem[] = await fetchItems('auction', effectiveQueryForEbay, false);
        console.log(`[AuctionsPage loadItems] Fetched ${fetchedItems.length} auctions from server for query "${effectiveQueryForEbay}".`);

        if (fetchedItems.length > 0) {
          setIsQualifying(true);
          const aiQualifiedAndRankedItems: BayBotItem[] = await qualifyAuctionsAI(fetchedItems, effectiveQueryForEbay);
          const aiCount = aiQualifiedAndRankedItems.length;
          console.log(`[AuctionsPage loadItems] AI qualified ${aiCount} auctions for query "${effectiveQueryForEbay}".`);

          finalProcessedItems = [...aiQualifiedAndRankedItems];

          if (aiCount < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiCount < fetchedItems.length) {
            const aiQualifiedIds = new Set(aiQualifiedAndRankedItems.map(d => d.id));
            const fallbackItems = fetchedItems.filter(d => !aiQualifiedIds.has(d.id));
            finalProcessedItems.push(...fallbackItems);
            overallToastMessage = { title: "Auctions: AI Enhanced", description: `Displaying ${aiCount} AI-qualified, plus ${fallbackItems.length} more for "${effectiveQueryForEbay}".` };
          } else if (aiCount === 0 && fetchedItems.length > 0) {
             finalProcessedItems = fetchedItems;
             overallToastMessage = { title: "Auctions: Server Processed", description: `Displaying ${fetchedItems.length} server-processed auctions for "${effectiveQueryForEbay}". AI found no specific qualifications.` };
          } else if (aiCount > 0) {
            overallToastMessage = { title: "Auctions: AI Qualified", description: `Displaying ${aiCount} AI-qualified auctions for "${effectiveQueryForEbay}".` };
          } else {
             overallToastMessage = { title: "No Auctions Found", description: `No auctions found for "${effectiveQueryForEbay}" after AI processing.` };
          }
        } else {
          overallToastMessage = { title: "No Auctions Found", description: `No auctions found for "${effectiveQueryForEbay}".` };
        }
      } catch (e: any)
      {
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
      } finally {
        setIsQualifying(false);
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
    console.log('[AuctionsPage handleLogoClick] Logo clicked. Clearing caches and preparing for background auction refresh.');
    sessionStorage.removeItem(CURATED_DEALS_CACHE_KEY);
    sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
    setInputValue(''); // Clear search input on the current page

    // Background task to fetch and cache curated auctions
    (async () => {
      try {
        console.log('[AuctionsPage handleLogoClick] Starting background curated auctions fetch...');
        const uniqueBackgroundKeywords = Array.from(new Set(Array.from({ length: MAX_CURATED_FETCH_ATTEMPTS }, () => getRandomPopularSearchTerm())));
        
        const backgroundFetchedBatches = await Promise.all(
          uniqueBackgroundKeywords.map(kw => fetchItems('auction', kw, true))
        );
        const consolidatedBackgroundItems = backgroundFetchedBatches.flat();
        const uniqueConsolidatedBackgroundMap = new Map<string, BayBotItem>();
        consolidatedBackgroundItems.forEach(item => {
          if (!uniqueConsolidatedBackgroundMap.has(item.id)) {
            uniqueConsolidatedBackgroundMap.set(item.id, item);
          }
        });
        const uniqueConsolidatedBackgroundAuctions = Array.from(uniqueConsolidatedBackgroundMap.values());

        if (uniqueConsolidatedBackgroundAuctions.length > 0) {
          const aiQualifiedAndRankedAuctions = await qualifyAuctionsAI(uniqueConsolidatedBackgroundAuctions, "general curated auctions (background logo click)");
          
          let finalBackgroundAuctions = [...aiQualifiedAndRankedAuctions];
          if (aiQualifiedAndRankedAuctions.length < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiQualifiedAndRankedAuctions.length < uniqueConsolidatedBackgroundAuctions.length) {
            const aiQualifiedIds = new Set(aiQualifiedAndRankedAuctions.map(d => d.id));
            const fallbackItems = uniqueConsolidatedBackgroundAuctions.filter(d => !aiQualifiedIds.has(d.id));
            finalBackgroundAuctions.push(...fallbackItems);
          } else if (aiQualifiedAndRankedAuctions.length === 0 && uniqueConsolidatedBackgroundAuctions.length > 0) {
            finalBackgroundAuctions = uniqueConsolidatedBackgroundAuctions;
          }

          if (finalBackgroundAuctions.length > 0) {
            sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: finalBackgroundAuctions, timestamp: Date.now() }));
            console.log(`[AuctionsPage handleLogoClick] Background task: Saved ${finalBackgroundAuctions.length} curated auctions to sessionStorage.`);
             toast({ title: "Curated Auctions Refreshed", description: "New set of curated auctions cached in background." });
          } else {
             console.log('[AuctionsPage handleLogoClick] Background task: No curated auctions found/qualified to cache.');
          }
        } else {
          console.log('[AuctionsPage handleLogoClick] Background task: No initial items fetched for curated auctions.');
        }
      } catch (bgError) {
        console.error('[AuctionsPage handleLogoClick] Error in background auction caching:', bgError);
        toast({ title: "Background Refresh Failed", description: "Could not refresh curated auctions in background.", variant: "destructive" });
      }
    })();
    router.push('/'); // Navigate to homepage
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
  
  if (allItems.length === 0 && !isLoading && !isQualifying && !error && currentQueryFromUrl === '') {
      noItemsDescription = `We tried fetching curated auctions but couldn't find enough. Try a specific search!`;
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

        {(isLoading || isQualifying) && <ItemGridLoadingSkeleton count={ITEMS_PER_PAGE} />}

        {!isLoading && !isQualifying && displayedItems.length === 0 && !error && (
           <NoItemsMessage title={noItemsTitle} description={noItemsDescription} />
        )}

        {!isLoading && !isQualifying && displayedItems.length > 0 && (
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

    