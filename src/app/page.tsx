
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
import { rankDeals as rankDealsAI } from '@/ai/flows/rank-deals';
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  GLOBAL_CURATED_DEALS_REQUEST_MARKER,
  MIN_DESIRED_CURATED_DEALS,
  MAX_CURATED_FETCH_ATTEMPTS,
  MIN_AI_QUALIFIED_ITEMS_THRESHOLD
} from '@/lib/constants';


const ITEMS_PER_PAGE = 8;
const CURATED_DEALS_CACHE_KEY = 'cachedCuratedDeals';

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

    // Initial state setup
    setAllItems([]);
    setDisplayedItems([]);
    setVisibleItemCount(ITEMS_PER_PAGE);
    setIsLoading(true);
    setIsRanking(false);
    setError(null);
    setIsAuthError(false);

    if (isGlobalCuratedRequest) {
      try {
        const cachedDataString = sessionStorage.getItem(CURATED_DEALS_CACHE_KEY);
        if (cachedDataString) {
          const cachedData = JSON.parse(cachedDataString);
          if (cachedData && cachedData.items) {
            console.log(`[HomePage loadItems] Found ${cachedData.items.length} curated deals in sessionStorage. Displaying them.`);
            setAllItems(cachedData.items);
            setDisplayedItems(cachedData.items.slice(0, ITEMS_PER_PAGE));
            setVisibleItemCount(ITEMS_PER_PAGE);
            setIsLoading(false);
            toast({ title: "Loaded Cached Curated Deals", description: "Displaying previously fetched deals for this session." });
            return; // Exit if cached data is successfully loaded
          }
        }
      } catch (e) {
        console.warn("[HomePage loadItems] Error reading or parsing curated deals from sessionStorage:", e);
        sessionStorage.removeItem(CURATED_DEALS_CACHE_KEY); // Clear potentially corrupted cache
      }
    }
    
    // Proceed with fetching if not a global curated request or if cache was not hit/valid

    let finalProcessedItems: BayBotItem[] = [];
    const processedItemIds = new Set<string>();
    let fetchAttempts = 0;
    let overallToastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;
    
    if (!isGlobalCuratedRequest) {
      // Standard user search logic
      const effectiveQueryForEbay = queryToLoad;
      console.log(`[HomePage loadItems] Standard search. eBay Query: "${effectiveQueryForEbay}", Type: "deal"`);
      try {
        const fetchedItems: BayBotItem[] = await fetchItems('deal', effectiveQueryForEbay);
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
          } else { 
            finalProcessedItems = fetchedItems; 
            overallToastMessage = { title: "Deals: Server Processed", description: `Displaying server-processed deals for "${queryToLoad}". AI found no further qualifications.` };
            console.warn(`[HomePage loadItems] AI qualification returned no items for query "${aiQueryContext}". Using server-processed list (${fetchedItems.length} items) as fallback.`);
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
      }
    } else {
      // Iterative curated deals fetching logic
      console.log(`[HomePage loadItems] Starting curated deals fetch loop. Target: ${MIN_DESIRED_CURATED_DEALS} items. Max attempts: ${MAX_CURATED_FETCH_ATTEMPTS}.`);
      
      while (finalProcessedItems.length < MIN_DESIRED_CURATED_DEALS && fetchAttempts < MAX_CURATED_FETCH_ATTEMPTS) {
        fetchAttempts++;
        console.log(`[HomePage loadItems] Curated fetch attempt ${fetchAttempts}/${MAX_CURATED_FETCH_ATTEMPTS}. Current items: ${finalProcessedItems.length}`);
        
        if (fetchAttempts > 1 || finalProcessedItems.length > 0) {
             setIsRanking(true);
        }

        try {
          const fetchedItemsFromAttempt: BayBotItem[] = await fetchItems('deal', GLOBAL_CURATED_DEALS_REQUEST_MARKER);
          const newUniqueFetchedItems = fetchedItemsFromAttempt.filter(item => !processedItemIds.has(item.id));

          if (newUniqueFetchedItems.length === 0) {
            console.log(`[HomePage loadItems] Attempt ${fetchAttempts}: No new unique items fetched. Skipping AI for this batch.`);
            setIsRanking(false);
            if (fetchAttempts === MAX_CURATED_FETCH_ATTEMPTS && finalProcessedItems.length === 0) {
              overallToastMessage = { title: "No Curated Deals", description: "Could not find enough curated deals after several attempts." };
            }
            continue;
          }
          
          console.log(`[HomePage loadItems] Attempt ${fetchAttempts}: Fetched ${fetchedItemsFromAttempt.length} items (${newUniqueFetchedItems.length} new). Sending to AI.`);
          setIsRanking(true);

          const aiQueryContext = "general curated deals";
          const aiQualifiedForBatch: BayBotItem[] = await rankDealsAI(newUniqueFetchedItems, aiQueryContext);
          const aiCountForBatch = aiQualifiedForBatch.length;
          
          let itemsToAddFromBatch: BayBotItem[] = [];

          if (aiCountForBatch > 0) {
            itemsToAddFromBatch = [...aiQualifiedForBatch];
            if (aiCountForBatch < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiCountForBatch < newUniqueFetchedItems.length) {
              const aiBatchIds = new Set(aiQualifiedForBatch.map(d => d.id));
              const fallbackBatchItems = newUniqueFetchedItems.filter(d => !aiBatchIds.has(d.id));
              itemsToAddFromBatch.push(...fallbackBatchItems);
              console.log(`[HomePage loadItems] Attempt ${fetchAttempts}: AI qualified ${aiCountForBatch}, added ${fallbackBatchItems.length} fallbacks from this batch of new items.`);
            } else {
              console.log(`[HomePage loadItems] Attempt ${fetchAttempts}: AI qualified ${aiCountForBatch} items from this batch of new items.`);
            }
          } else {
            itemsToAddFromBatch = newUniqueFetchedItems;
            console.log(`[HomePage loadItems] Attempt ${fetchAttempts}: AI returned 0 items. Using all ${newUniqueFetchedItems.length} new unique server-processed items from this batch.`);
          }

          itemsToAddFromBatch.forEach(item => {
            if (!processedItemIds.has(item.id)) {
              finalProcessedItems.push(item);
              processedItemIds.add(item.id);
            }
          });
          
          setAllItems([...finalProcessedItems]);
          setDisplayedItems(finalProcessedItems.slice(0, visibleItemCount > 0 ? visibleItemCount : ITEMS_PER_PAGE ));


        } catch (e: any) {
          console.error(`[HomePage loadItems] Error during curated fetch attempt ${fetchAttempts}:`, e);
          if (typeof e.message === 'string' && (e.message.includes("invalid_client") || e.message.includes("Critical eBay API Authentication Failure") || e.message.includes("OAuth"))) {
            let displayMessage = "Critical eBay API Authentication Failure. Check .env and server logs.";
            setError(displayMessage);
            setIsAuthError(true);
            finalProcessedItems = []; 
            break; 
          }
          if (fetchAttempts === MAX_CURATED_FETCH_ATTEMPTS) {
            setError("Failed to load sufficient curated deals after multiple attempts.");
          }
        } finally {
          setIsRanking(false); 
        }
      } 

      if (finalProcessedItems.length > 0 && !error) {
        overallToastMessage = {
          title: "Curated Deals Loaded",
          description: `Displaying ${finalProcessedItems.length} curated deals. ${fetchAttempts} fetch attempt(s) made.`
        };
      } else if (finalProcessedItems.length === 0 && !error && fetchAttempts >= MAX_CURATED_FETCH_ATTEMPTS) {
         overallToastMessage = {
          title: "No Curated Deals",
          description: `Could not find curated deals after ${fetchAttempts} attempt(s). Try a specific search.`
        };
      }
    }

    setAllItems(finalProcessedItems);
    setDisplayedItems(finalProcessedItems.slice(0, ITEMS_PER_PAGE));
    setVisibleItemCount(ITEMS_PER_PAGE); // Ensure this is reset correctly
    setIsLoading(false);
    setIsRanking(false);
    console.log(`[HomePage loadItems] Finalizing. Displayed ${finalProcessedItems.slice(0, ITEMS_PER_PAGE).length} of ${finalProcessedItems.length} total items. Fetch attempts (if curated): ${fetchAttempts}`);

    if (overallToastMessage && !error) {
      toast(overallToastMessage);
    } else if (error && !isAuthError) {
      toast({ title: "Error Loading Deals", description: error || "An unexpected error occurred.", variant: "destructive" });
    }

    // Save to sessionStorage if it was a successful global curated request
    if (isGlobalCuratedRequest && !error) {
      try {
        sessionStorage.setItem(CURATED_DEALS_CACHE_KEY, JSON.stringify({ items: finalProcessedItems, timestamp: Date.now() }));
        console.log(`[HomePage loadItems] Saved ${finalProcessedItems.length} curated deals to sessionStorage.`);
      } catch (e) {
        console.warn("[HomePage loadItems] Error saving curated deals to sessionStorage:", e);
      }
    }

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


  const handleLoadMore = () => {
    const newVisibleCount = visibleItemCount + ITEMS_PER_PAGE;
    setDisplayedItems(allItems.slice(0, newVisibleCount));
    setVisibleItemCount(newVisibleCount);
  };

  const handleAnalyzeItem = (item: BayBotItem) => {
    setSelectedItemForAnalysis(item);
    setIsAnalysisModalOpen(true);
  };

  let noItemsTitle = "No Deals Found";
  let noItemsDescription = currentQueryFromUrl
    ? `Try adjusting your search for "${currentQueryFromUrl}".`
    : "No global curated deals available for the sampled category right now. Check back later!";

  if (allItems.length === 0 && !isLoading && !isRanking && !error && currentQueryFromUrl === '') {
      noItemsDescription = `We tried fetching curated deals but couldn't find enough. Try a specific search!`;
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
