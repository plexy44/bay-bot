
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
import { fetchItems } from '@/services/ebay-api-service';
import { qualifyAuctions as qualifyAuctionsAI } from '@/ai/flows/qualify-auctions';
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  GLOBAL_CURATED_AUCTIONS_REQUEST_MARKER,
  MIN_DESIRED_CURATED_DEALS as MIN_DESIRED_CURATED_AUCTIONS, // Alias for clarity
  MAX_CURATED_FETCH_ATTEMPTS,
  MIN_AI_QUALIFIED_ITEMS_THRESHOLD
} from '@/lib/constants';

const ITEMS_PER_PAGE = 8;
const CURATED_AUCTIONS_CACHE_KEY = 'cachedCuratedAuctions';

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
    console.log(`[AuctionsPage loadItems] Initiating. Query to load: "${queryToLoad}"`);
    
    const isGlobalCuratedRequest = queryToLoad === '';

    setAllItems([]);
    setDisplayedItems([]);
    setVisibleItemCount(ITEMS_PER_PAGE);
    setIsLoading(true);
    setIsQualifying(false);
    setError(null);
    setIsAuthError(false);

    if (isGlobalCuratedRequest) {
      try {
        const cachedDataString = sessionStorage.getItem(CURATED_AUCTIONS_CACHE_KEY);
        if (cachedDataString) {
          const cachedData = JSON.parse(cachedDataString);
          if (cachedData && cachedData.items) {
            console.log(`[AuctionsPage loadItems] Found ${cachedData.items.length} curated auctions in sessionStorage. Displaying them.`);
            setAllItems(cachedData.items);
            setDisplayedItems(cachedData.items.slice(0, ITEMS_PER_PAGE));
            setVisibleItemCount(ITEMS_PER_PAGE);
            setIsLoading(false);
            toast({ title: "Loaded Cached Curated Auctions", description: "Displaying previously fetched auctions for this session." });
            return;
          }
        }
      } catch (e) {
        console.warn("[AuctionsPage loadItems] Error reading or parsing curated auctions from sessionStorage:", e);
        sessionStorage.removeItem(CURATED_AUCTIONS_CACHE_KEY);
      }
    }

    let finalProcessedItems: BayBotItem[] = [];
    const processedItemIds = new Set<string>();
    let fetchAttempts = 0;
    let overallToastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;

    if (!isGlobalCuratedRequest) {
      // Standard user search logic for auctions
      const effectiveQueryForEbay = queryToLoad;
      console.log(`[AuctionsPage loadItems] Standard search. eBay Query: "${effectiveQueryForEbay}", Type: "auction"`);
      try {
        const fetchedItems: BayBotItem[] = await fetchItems('auction', effectiveQueryForEbay);
        console.log(`[AuctionsPage loadItems] Fetched ${fetchedItems.length} auctions from server-side for query "${effectiveQueryForEbay}".`);

        if (fetchedItems.length > 0) {
          setIsQualifying(true);
          const aiQueryContext = queryToLoad;
          const aiQualifiedAndRankedItems: BayBotItem[] = await qualifyAuctionsAI(fetchedItems, aiQueryContext);
          const aiCount = aiQualifiedAndRankedItems.length;

          finalProcessedItems = [...aiQualifiedAndRankedItems];
          console.log(`[AuctionsPage loadItems] AI qualified and ranked ${aiCount} auctions for query "${aiQueryContext}".`);

          if (aiCount < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiCount < fetchedItems.length) {
            const aiQualifiedIds = new Set(aiQualifiedAndRankedItems.map(d => d.id));
            const fallbackItems = fetchedItems.filter(d => !aiQualifiedIds.has(d.id));
            finalProcessedItems.push(...fallbackItems);
            console.log(`[AuctionsPage loadItems] AI returned ${aiCount} (<${MIN_AI_QUALIFIED_ITEMS_THRESHOLD}) auctions. Appending ${fallbackItems.length} server-processed fallback auctions.`);
            overallToastMessage = { title: "Auctions: AI Enhanced", description: `Displaying ${aiCount} AI-qualified auctions for "${queryToLoad}", plus ${fallbackItems.length} more.` };
          } else if (aiCount > 0) {
            overallToastMessage = { title: "Auctions: AI Qualified", description: `Displaying ${aiCount} AI-qualified auctions for "${queryToLoad}".` };
          } else {
            finalProcessedItems = fetchedItems;
            overallToastMessage = { title: "Auctions: Server Processed", description: `Displaying server-processed auctions for "${queryToLoad}". AI found no further qualifications.` };
            console.warn(`[AuctionsPage loadItems] AI qualification returned no items for query "${aiQueryContext}". Using server-processed list (${fetchedItems.length} items) as fallback.`);
          }
        } else {
          overallToastMessage = { title: "No Auctions Found", description: `No auctions found for "${queryToLoad}" after server processing.` };
          console.log(`[AuctionsPage loadItems] No items fetched for query "${queryToLoad}".`);
        }
      } catch (e: any) {
        console.error(`[AuctionsPage loadItems] Failed to load items for query '${effectiveQueryForEbay}'. Error:`, e);
        let displayMessage = `Failed to load auctions. Please try again.`;
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
      }
    } else {
      // Iterative curated auctions fetching logic
      console.log(`[AuctionsPage loadItems] Starting curated auctions fetch loop. Target: ${MIN_DESIRED_CURATED_AUCTIONS} items. Max attempts: ${MAX_CURATED_FETCH_ATTEMPTS}.`);
      
      while (finalProcessedItems.length < MIN_DESIRED_CURATED_AUCTIONS && fetchAttempts < MAX_CURATED_FETCH_ATTEMPTS) {
        fetchAttempts++;
        console.log(`[AuctionsPage loadItems] Curated fetch attempt ${fetchAttempts}/${MAX_CURATED_FETCH_ATTEMPTS}. Current items: ${finalProcessedItems.length}`);
        
        if (fetchAttempts > 1 || finalProcessedItems.length > 0) {
             setIsQualifying(true);
        }

        try {
          const fetchedItemsFromAttempt: BayBotItem[] = await fetchItems('auction', GLOBAL_CURATED_AUCTIONS_REQUEST_MARKER);
          const newUniqueFetchedItems = fetchedItemsFromAttempt.filter(item => !processedItemIds.has(item.id));

          if (newUniqueFetchedItems.length === 0) {
            console.log(`[AuctionsPage loadItems] Attempt ${fetchAttempts}: No new unique auctions fetched. Skipping AI for this batch.`);
            setIsQualifying(false); // Turn off if it was on
            if (fetchAttempts === MAX_CURATED_FETCH_ATTEMPTS && finalProcessedItems.length === 0) {
              overallToastMessage = { title: "No Curated Auctions", description: "Could not find enough curated auctions after several attempts." };
            }
            continue;
          }
          
          console.log(`[AuctionsPage loadItems] Attempt ${fetchAttempts}: Fetched ${fetchedItemsFromAttempt.length} auctions (${newUniqueFetchedItems.length} new). Sending to AI.`);
          setIsQualifying(true);

          const aiQueryContext = "general curated auctions";
          const aiQualifiedForBatch: BayBotItem[] = await qualifyAuctionsAI(newUniqueFetchedItems, aiQueryContext);
          const aiCountForBatch = aiQualifiedForBatch.length;
          
          let itemsToAddFromBatch: BayBotItem[] = [];

          if (aiCountForBatch > 0) {
            itemsToAddFromBatch = [...aiQualifiedForBatch];
            if (aiCountForBatch < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiCountForBatch < newUniqueFetchedItems.length) {
              const aiBatchIds = new Set(aiQualifiedForBatch.map(d => d.id));
              const fallbackBatchItems = newUniqueFetchedItems.filter(d => !aiBatchIds.has(d.id));
              itemsToAddFromBatch.push(...fallbackBatchItems);
              console.log(`[AuctionsPage loadItems] Attempt ${fetchAttempts}: AI qualified ${aiCountForBatch}, added ${fallbackBatchItems.length} fallbacks from this batch of new auctions.`);
            } else {
              console.log(`[AuctionsPage loadItems] Attempt ${fetchAttempts}: AI qualified ${aiCountForBatch} auctions from this batch of new items.`);
            }
          } else {
            itemsToAddFromBatch = newUniqueFetchedItems; // If AI returns 0, use all new unique server items for this batch
            console.log(`[AuctionsPage loadItems] Attempt ${fetchAttempts}: AI returned 0 items. Using all ${newUniqueFetchedItems.length} new unique server-processed auctions from this batch.`);
          }

          itemsToAddFromBatch.forEach(item => {
            if (!processedItemIds.has(item.id)) {
              finalProcessedItems.push(item);
              processedItemIds.add(item.id);
            }
          });
          
          setAllItems([...finalProcessedItems]); // Update allItems for Load More
          setDisplayedItems(finalProcessedItems.slice(0, visibleItemCount > 0 ? visibleItemCount : ITEMS_PER_PAGE )); // Update displayed items

        } catch (e: any) {
          console.error(`[AuctionsPage loadItems] Error during curated fetch attempt ${fetchAttempts}:`, e);
          if (typeof e.message === 'string' && (e.message.includes("invalid_client") || e.message.includes("Critical eBay API Authentication Failure") || e.message.includes("OAuth"))) {
            let displayMessage = "Critical eBay API Authentication Failure. Check .env and server logs.";
            setError(displayMessage);
            setIsAuthError(true);
            finalProcessedItems = []; 
            break; 
          }
          if (fetchAttempts === MAX_CURATED_FETCH_ATTEMPTS && finalProcessedItems.length < MIN_DESIRED_CURATED_AUCTIONS) { // Check if error on last attempt and still not enough items
            setError("Failed to load sufficient curated auctions after multiple attempts.");
          }
        } finally {
          setIsQualifying(false); // Turn off AI qualifying indicator for the batch
        }
      } 

      // Determine overall toast message for curated auctions
      if (finalProcessedItems.length > 0 && !error) { // Prioritize showing items if any were found
        overallToastMessage = {
          title: "Curated Auctions Loaded",
          description: `Displaying ${finalProcessedItems.length} curated auctions. ${fetchAttempts} fetch attempt(s) made.`
        };
      } else if (finalProcessedItems.length === 0 && !error && fetchAttempts >= MAX_CURATED_FETCH_ATTEMPTS) { // No items after all attempts
         overallToastMessage = {
          title: "No Curated Auctions",
          description: `Could not find curated auctions after ${fetchAttempts} attempt(s). Try a specific search.`
        };
      }
      // If an error occurred that wasn't an auth error, it will be handled by the main error display
    }

    // Final state updates for all scenarios
    setAllItems(finalProcessedItems);
    setDisplayedItems(finalProcessedItems.slice(0, ITEMS_PER_PAGE));
    setVisibleItemCount(ITEMS_PER_PAGE);
    setIsLoading(false);
    setIsQualifying(false); // Ensure this is off at the very end
    console.log(`[AuctionsPage loadItems] Finalizing. Displayed ${finalProcessedItems.slice(0, ITEMS_PER_PAGE).length} of ${finalProcessedItems.length} total auctions. Fetch attempts (if curated): ${fetchAttempts}`);

    if (overallToastMessage && !error) { // Only show this summary toast if no critical error is displayed
      toast(overallToastMessage);
    } else if (error && !isAuthError) { // Generic error toast if a specific one wasn't set
      toast({ title: "Error Loading Auctions", description: error || "An unexpected error occurred.", variant: "destructive" });
    }
    
    if (isGlobalCuratedRequest && !error && finalProcessedItems.length > 0) {
      try {
        sessionStorage.setItem(CURATED_AUCTIONS_CACHE_KEY, JSON.stringify({ items: finalProcessedItems, timestamp: Date.now() }));
        console.log(`[AuctionsPage loadItems] Saved ${finalProcessedItems.length} curated auctions to sessionStorage.`);
      } catch (e) {
        console.warn("[AuctionsPage loadItems] Error saving curated auctions to sessionStorage:", e);
      }
    }

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
    router.push(`/auctions?q=${encodeURIComponent(keyword)}`); // Navigate to auctions page with new query
  };


  let noItemsTitle = "No Auctions Found";
  let noItemsDescription = currentQueryFromUrl
    ? `Try adjusting your search for "${currentQueryFromUrl}".`
    : "No global curated auctions available for the sampled category at the moment. Check back later!";
  
  if (allItems.length === 0 && !isLoading && !isQualifying && !error && currentQueryFromUrl === '') {
      noItemsDescription = `We tried fetching curated auctions but couldn't find enough. Try a specific search!`;
  }


  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader
        searchInputValue={inputValue}
        onSearchInputChange={setInputValue}
        onSearchSubmit={handleSearchSubmit}
        onLogoClick={() => {
          setInputValue(''); 
          router.push('/'); 
        }}
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
          onKeywordSearch={handleKeywordSearchFromModal} // Pass handler
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

