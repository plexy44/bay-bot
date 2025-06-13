
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
import { rankDeals as rankDealsAI, type Deal as AIDeal, type RankDealsInput } from '@/ai/flows/rank-deals';
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';
import { GLOBAL_CURATED_DEALS_REQUEST_MARKER } from '@/lib/constants';

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

  const mapToAIDeal = useCallback((item: BayBotItem): AIDeal => ({
    id: item.id,
    title: item.title,
    price: item.price,
    discountPercentage: item.discountPercentage || 0,
    sellerReputation: item.sellerReputation,
    imageUrl: item.imageUrl,
  }), []);

  const loadItems = useCallback(async (queryToLoad: string) => {
    console.log(`[HomePage loadItems] Initiating. Query to load: "${queryToLoad}"`);
    setAllItems([]);
    setDisplayedItems([]);
    setIsLoading(true);
    setIsRanking(false);
    setError(null);
    setIsAuthError(false);

    let processedItems: BayBotItem[] = [];
    let toastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;

    const isGlobalCuratedRequest = queryToLoad === '';
    const fetchType = 'deals';
    const effectiveQueryForEbay = isGlobalCuratedRequest ? GLOBAL_CURATED_DEALS_REQUEST_MARKER : queryToLoad;
    console.log(`[HomePage loadItems] Effective query for eBay: "${effectiveQueryForEbay}", Fetch type: "${fetchType}"`);

    try {
      const fetchedItems: BayBotItem[] = await fetchItems(fetchType, effectiveQueryForEbay);
      console.log(`[HomePage loadItems] Fetched ${fetchedItems.length} items from fetchItems for type '${fetchType}' using query/marker '${effectiveQueryForEbay}'.`);

      if (fetchedItems.length > 0) {
        if (isGlobalCuratedRequest) {
          processedItems = [...fetchedItems].sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
          toastMessage = { title: "Curated Deals", description: `Displaying deals for a popular category, sorted by discount.` };
          console.log(`[HomePage loadItems] Global curated deals (${processedItems.length}) sorted by discount.`);
        } else {
          setIsRanking(true);
          const dealsInputForAI: AIDeal[] = fetchedItems.map(mapToAIDeal);
          const aiQueryContext = queryToLoad;

          try {
            const aiRankerInput: RankDealsInput = { deals: dealsInputForAI, query: aiQueryContext };
            console.log(`[HomePage loadItems] Sending ${dealsInputForAI.length} deals to AI for ranking. AI Query Context: "${aiQueryContext}"`);
            const rankedOutputFromAI: AIDeal[] = await rankDealsAI(aiRankerInput);

            if (rankedOutputFromAI !== dealsInputForAI && rankedOutputFromAI.length === dealsInputForAI.length) {
              const orderMap = new Map(rankedOutputFromAI.map((deal, index) => [deal.id, index]));
              const sortedFetchedItems = [...fetchedItems].sort((a, b) => {
                const posA = orderMap.get(a.id);
                const posB = orderMap.get(b.id);
                if (posA === undefined && posB === undefined) return 0;
                if (posA === undefined) return 1;
                if (posB === undefined) return -1;
                return posA - posB;
              });
              processedItems = sortedFetchedItems;
              toastMessage = { title: "Deals: AI Ranked", description: `Displaying AI-ranked deals for "${queryToLoad}".` };
              console.log(`[HomePage loadItems] AI successfully ranked ${processedItems.length} deals for query: "${aiQueryContext}".`);
            } else {
              console.warn(`[HomePage loadItems] AI ranking issue or no change for query "${aiQueryContext}". Fallback: Sorting ${fetchedItems.length} deals by discount.`);
              processedItems = [...fetchedItems].sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
              toastMessage = { title: "Deals: Sorted by Discount", description: `Displaying deals for "${queryToLoad}" by discount. AI ranking may have had an issue or no effect.` };
            }
          } catch (aiRankErrorCaught: any) {
            console.error("[HomePage loadItems] AI Ranking failed for user search:", aiRankErrorCaught);
            processedItems = [...fetchedItems].sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
            toastMessage = { title: "Deals: AI Error, Sorted by Discount", description: "AI ranking failed. Displaying deals by discount.", variant: "destructive"};
          }
        }
      } else {
         processedItems = [];
         if (queryToLoad) {
            toastMessage = { title: "No Deals Found", description: `No deals found for "${queryToLoad}".`};
         } else {
            toastMessage = { title: "No Curated Deals", description: "No global curated deals found for the sampled category at this time."};
         }
         console.log(`[HomePage loadItems] No items fetched or processed. isGlobalCuratedRequest: ${isGlobalCuratedRequest}, query: "${queryToLoad}"`);
      }
    } catch (e: any) {
      console.error(`[HomePage loadItems] Failed to load items. Query/Marker '${effectiveQueryForEbay}'. Error:`, e);
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
      processedItems = [];
    } finally {
      setAllItems(processedItems);
      setDisplayedItems(processedItems.slice(0, ITEMS_PER_PAGE));
      setVisibleItemCount(ITEMS_PER_PAGE);
      setIsLoading(false);
      setIsRanking(false);
      console.log(`[HomePage loadItems] Finalizing. Displayed ${processedItems.slice(0, ITEMS_PER_PAGE).length} of ${processedItems.length} items.`);

      if (toastMessage && !error) {
        toast(toastMessage);
      } else if (error && !isAuthError) {
        toast({title: "Error Loading Deals", description: "An unexpected error occurred.", variant: "destructive"});
      }
    }
  }, [toast, mapToAIDeal]);

  useEffect(() => {
    console.log(`[HomePage URL useEffect] Current URL query: "${currentQueryFromUrl}". Triggering loadItems.`);
    setInputValue(currentQueryFromUrl); // Sync input field with URL
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

  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader
        searchInputValue={inputValue}
        onSearchInputChange={setInputValue}
        onSearchSubmit={handleSearchSubmit}
        onLogoClick={() => {
          setInputValue(''); // Clear input visually
          router.push('/'); // Navigate and trigger loadItems via useEffect
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
