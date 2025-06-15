
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
import { rankDeals as rankDealsAI } from '@/ai/flows/rank-deals';
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  MIN_DESIRED_CURATED_ITEMS,
  MAX_CURATED_FETCH_ATTEMPTS,
  MIN_AI_QUALIFIED_ITEMS_THRESHOLD,
  CURATED_DEALS_CACHE_KEY,
  CURATED_AUCTIONS_CACHE_KEY
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

    let finalProcessedItems: BayBotItem[] = [];
    let overallToastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;

    if (isGlobalCuratedRequest) {
      try {
        const cachedDataString = sessionStorage.getItem(CURATED_DEALS_CACHE_KEY);
        if (cachedDataString) {
          const cachedData = JSON.parse(cachedDataString);
          if (cachedData && cachedData.items) {
            console.log(`[HomePage loadItems] Found ${cachedData.items.length} curated deals in sessionStorage. Displaying them.`);
            setAllItems(cachedData.items);
            setDisplayedItems(cachedData.items.slice(0, ITEMS_PER_PAGE));
            setIsLoading(false);
            toast({ title: "Loaded Cached Curated Deals", description: "Displaying previously fetched deals for this session." });
            return;
          }
        }
      } catch (e) {
        console.warn("[HomePage loadItems] Error reading or parsing curated deals from sessionStorage:", e);
        sessionStorage.removeItem(CURATED_DEALS_CACHE_KEY);
      }

      console.log(`[HomePage loadItems] Curated deals: No valid cache. Fetching fresh. Target: ${MIN_DESIRED_CURATED_ITEMS} items from up to ${MAX_CURATED_FETCH_ATTEMPTS} keywords.`);
      setIsRanking(true);

      try {
        const keywordPromises = Array.from({ length: MAX_CURATED_FETCH_ATTEMPTS }, () => getRandomPopularSearchTerm());
        const resolvedKeywords = await Promise.all(keywordPromises);
        const uniqueRandomKeywords = Array.from(new Set(resolvedKeywords.filter(kw => kw && kw.trim() !== '')));
        
        console.log(`[HomePage loadItems] Curated deals: Using ${uniqueRandomKeywords.length} resolved unique keywords: ${uniqueRandomKeywords.join(', ')}`);

        if (uniqueRandomKeywords.length === 0) {
          console.warn("[HomePage loadItems] Curated deals: No valid keywords generated after resolving promises. Aborting fetch.");
          throw new Error("Failed to generate valid keywords for curated deals.");
        }
        
        const fetchedBatchesPromises = uniqueRandomKeywords.map(kw =>
          fetchItems('deal', kw, true) // isGlobalCuratedRequest = true
        );
        const fetchedBatchesResults = await Promise.allSettled(fetchedBatchesPromises);
        
        const successfulFetches = fetchedBatchesResults
          .filter(result => result.status === 'fulfilled')
          .map(result => (result as PromiseFulfilledResult<BayBotItem[]>).value);

        const consolidatedItems = successfulFetches.flat();
        const uniqueConsolidatedItemsMap = new Map<string, BayBotItem>();
        consolidatedItems.forEach(item => {
          if (!uniqueConsolidatedItemsMap.has(item.id)) {
            uniqueConsolidatedItemsMap.set(item.id, item);
          }
        });
        const uniqueConsolidatedItems = Array.from(uniqueConsolidatedItemsMap.values());
        console.log(`[HomePage loadItems] Curated deals: Fetched ${uniqueConsolidatedItems.length} unique items from eBay across ${successfulFetches.length} successful keyword fetches.`);

        if (uniqueConsolidatedItems.length > 0) {
          const aiQualifiedAndRankedItems: BayBotItem[] = await rankDealsAI(uniqueConsolidatedItems, "general curated deals");
          const aiCount = aiQualifiedAndRankedItems.length;
          console.log(`[HomePage loadItems] Curated deals: AI qualified ${aiCount} items.`);

          finalProcessedItems = [...aiQualifiedAndRankedItems];

          if (aiCount < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiCount < uniqueConsolidatedItems.length) {
            const aiQualifiedIds = new Set(aiQualifiedAndRankedItems.map(d => d.id));
            const fallbackItems = uniqueConsolidatedItems.filter(d => !aiQualifiedIds.has(d.id));
            finalProcessedItems.push(...fallbackItems);
            overallToastMessage = { title: "Curated Deals: AI Enhanced", description: `Displaying ${aiCount} AI-qualified deals, plus ${fallbackItems.length} more.` };
          } else if (aiCount === 0 && uniqueConsolidatedItems.length > 0) {
            finalProcessedItems = uniqueConsolidatedItems;
            overallToastMessage = { title: "Curated Deals: Server Processed", description: `Displaying ${uniqueConsolidatedItems.length} server-processed deals. AI found no specific qualifications.` };
          } else if (aiCount > 0) {
            overallToastMessage = { title: "Curated Deals: AI Qualified", description: `Displaying ${aiCount} AI-qualified deals.` };
          } else {
             overallToastMessage = { title: "No Curated Deals", description: "Could not find any curated deals matching criteria." };
          }
        } else {
          overallToastMessage = { title: "No Curated Deals", description: "No deals found from initial fetch." };
        }
        
        if (finalProcessedItems.length < MIN_DESIRED_CURATED_ITEMS && finalProcessedItems.length > 0) {
             console.warn(`[HomePage loadItems] Curated deal fetch resulted in ${finalProcessedItems.length} items, less than target ${MIN_DESIRED_CURATED_ITEMS}. Toast already set by primary/fallback logic.`);
        } else if (finalProcessedItems.length === 0 && !overallToastMessage) {
             overallToastMessage = { title: "No Curated Deals", description: "No deals found after processing." };
        }

      } catch (e: any) {
        console.error(`[HomePage loadItems] Error fetching curated deals:`, e);
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
            finalProcessedItems.push(...fallbackItems);
            console.log(`[HomePage loadItems] AI returned ${aiCount} (<${MIN_AI_QUALIFIED_ITEMS_THRESHOLD}) deals. Appending ${fallbackItems.length} server-processed fallback deals.`);
            overallToastMessage = { title: "Deals: AI Enhanced", description: `Displaying ${aiCount} AI-qualified deals for "${queryToLoad}", plus ${fallbackItems.length} more.` };
          } else if (aiCount > 0) {
            overallToastMessage = { title: "Deals: AI Qualified", description: `Displaying ${aiCount} AI-qualified deals for "${queryToLoad}".` };
          } else if (fetchedItems.length > 0) { 
            finalProcessedItems = fetchedItems; 
            overallToastMessage = { title: "Deals: Server Processed", description: `Displaying server-processed deals for "${queryToLoad}". AI found no further qualifications.` };
            console.warn(`[HomePage loadItems] AI qualification returned no items for query "${aiQueryContext}". Using server-processed list (${fetchedItems.length} items) as fallback.`);
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

    if (overallToastMessage && !error) {
      toast(overallToastMessage);
    } else if (error && !isAuthError) {
      toast({ title: "Error Loading Deals", description: error || "An unexpected error occurred.", variant: "destructive" });
    }
    console.log(`[HomePage loadItems] Finalizing. Displayed ${finalProcessedItems.slice(0, ITEMS_PER_PAGE).length} of ${finalProcessedItems.length} total items.`);
  }, [toast]);

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

    (async () => {
      try {
        console.log('[HomePage handleLogoClick] Starting background curated content fetch (deals & auctions)...');
        const keywordPromises = Array.from({ length: MAX_CURATED_FETCH_ATTEMPTS }, () => getRandomPopularSearchTerm());
        const resolvedKeywords = await Promise.all(keywordPromises);
        const uniqueBackgroundKeywords = Array.from(new Set(resolvedKeywords.filter(kw => kw && kw.trim() !== '')));

        if (uniqueBackgroundKeywords.length === 0) {
          console.warn('[HomePage handleLogoClick] Background task: No valid keywords for curated content. Aborting.');
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
            const finalBackgroundAuctions = Array.from(uniqueAuctionsMap.values());
              
            if (finalBackgroundAuctions.length > 0) {
              sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: finalBackgroundAuctions, timestamp: Date.now() }));
              console.log(`[HomePage handleLogoClick] Background task: Saved ${finalBackgroundAuctions.length} curated auctions (server-processed) to sessionStorage.`);
              toast({ title: "Curated Auctions Refreshed", description: `${finalBackgroundAuctions.length} server-processed auctions cached.` });
            } else {
              console.log('[HomePage handleLogoClick] Background task: No curated auctions found to cache.');
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
        isLoading={isLoading || isRanking} // Pass combined loading state
      />
      <main className="flex-grow container mx-auto px-4 py-8">
        {error && (
          <Alert variant="destructive" className="mb-6">
            {isAuthError ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
            <AlertTitle>{isAuthError ? "Authentication Error" : "Error"}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {(isLoading || isRanking) && <ItemGridLoadingSkeleton count={ITEMS_PER_PAGE} />}

        {!isLoading && !isRanking && displayedItems.length === 0 && !error && (
          <NoItemsMessage title={noItemsTitle} description={noItemsDescription} />
        )}

        {!isLoading && !isRanking && displayedItems.length > 0 && (
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

