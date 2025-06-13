
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
import { GLOBAL_CURATED_DEALS_REQUEST_MARKER } from '@/lib/constants';

const ITEMS_PER_PAGE = 8;
const MIN_AI_QUALIFIED_ITEMS_THRESHOLD = 6;

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
    setAllItems([]);
    setDisplayedItems([]);
    setIsLoading(true);
    setIsRanking(false);
    setError(null);
    setIsAuthError(false);

    let finalProcessedItems: BayBotItem[] = [];
    let toastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;

    const isGlobalCuratedRequest = queryToLoad === '';
    const fetchType = 'deal';
    const effectiveQueryForEbay = isGlobalCuratedRequest ? GLOBAL_CURATED_DEALS_REQUEST_MARKER : queryToLoad;
    console.log(`[HomePage loadItems] Effective query for eBay: "${effectiveQueryForEbay}", Fetch type: "${fetchType}"`);

    try {
      const fetchedItems: BayBotItem[] = await fetchItems(fetchType, effectiveQueryForEbay);
      console.log(`[HomePage loadItems] Fetched ${fetchedItems.length} items from server-side processing for type '${fetchType}' using query/marker '${effectiveQueryForEbay}'.`);

      if (fetchedItems.length > 0) {
        setIsRanking(true);
        const aiQueryContext = queryToLoad || "general deals";

        try {
          console.log(`[HomePage loadItems] Sending ${fetchedItems.length} pre-processed deals to AI for qualification/ranking. AI Query Context: "${aiQueryContext}"`);
          const aiQualifiedAndRankedItems: BayBotItem[] = await rankDealsAI(fetchedItems, aiQueryContext);
          const aiCount = aiQualifiedAndRankedItems.length;

          if (aiCount > 0) {
            finalProcessedItems = [...aiQualifiedAndRankedItems];
            console.log(`[HomePage loadItems] AI successfully qualified and ranked ${aiCount} deals. Query: "${aiQueryContext}".`);

            if (aiCount < MIN_AI_QUALIFIED_ITEMS_THRESHOLD && aiCount < fetchedItems.length) {
              const aiQualifiedIds = new Set(aiQualifiedAndRankedItems.map(d => d.id));
              const fallbackItems = fetchedItems.filter(d => !aiQualifiedIds.has(d.id));
              const fallbackCount = fallbackItems.length;

              if (fallbackCount > 0) {
                finalProcessedItems.push(...fallbackItems);
                console.log(`[HomePage loadItems] AI returned ${aiCount} (<${MIN_AI_QUALIFIED_ITEMS_THRESHOLD}) deals. Appending ${fallbackCount} server-processed fallback deals.`);
                toastMessage = {
                  title: isGlobalCuratedRequest ? "Curated Deals: AI Enhanced" : "Deals: AI Enhanced",
                  description: isGlobalCuratedRequest 
                    ? `Displaying ${aiCount} AI-qualified deals, plus ${fallbackCount} more from a popular category.` 
                    : `Displaying ${aiCount} AI-qualified deals for "${queryToLoad}", plus ${fallbackCount} more.`
                };
              } else {
                 toastMessage = { 
                    title: isGlobalCuratedRequest ? "Curated Deals: AI Qualified" : "Deals: AI Qualified",
                    description: isGlobalCuratedRequest 
                      ? `Displaying ${aiCount} AI-qualified deals from a popular category.` 
                      : `Displaying ${aiCount} AI-qualified deals for "${queryToLoad}".`
                  };
              }
            } else { 
              toastMessage = { 
                title: isGlobalCuratedRequest ? "Curated Deals: AI Qualified" : "Deals: AI Qualified",
                description: isGlobalCuratedRequest 
                  ? `Displaying ${aiCount} AI-qualified deals from a popular category.` 
                  : `Displaying ${aiCount} AI-qualified deals for "${queryToLoad}".`
              };
            }
          } else { 
            console.warn(`[HomePage loadItems] AI qualification returned no items for query "${aiQueryContext}". Using server-processed list (${fetchedItems.length} items) as fallback.`);
            finalProcessedItems = fetchedItems; 
            const messageTitle = isGlobalCuratedRequest ? "Curated Deals: Server Processed" : "Deals: Server Processed";
            const messageDesc = isGlobalCuratedRequest ? `Displaying server-processed deals for a popular category. AI found no further qualifications.` : `Displaying server-processed deals for "${queryToLoad}". AI found no further qualifications.`;
            toastMessage = { title: messageTitle, description: messageDesc };
          }
        } catch (aiRankErrorCaught: any) {
          console.error("[HomePage loadItems] AI Qualification/Ranking failed:", aiRankErrorCaught);
          finalProcessedItems = fetchedItems; 
          const messageTitle = isGlobalCuratedRequest ? "Curated Deals: AI Error" : "Deals: AI Error";
          const messageDesc = `AI processing failed. Displaying server-processed deals.`;
          toastMessage = { title: messageTitle, description: messageDesc, variant: "destructive"};
        }
      } else {
         finalProcessedItems = [];
         if (queryToLoad) {
            toastMessage = { title: "No Deals Found", description: `No deals found for "${queryToLoad}" after server processing.`};
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
      finalProcessedItems = [];
    } finally {
      setAllItems(finalProcessedItems);
      setDisplayedItems(finalProcessedItems.slice(0, ITEMS_PER_PAGE));
      setVisibleItemCount(ITEMS_PER_PAGE);
      setIsLoading(false);
      setIsRanking(false);
      console.log(`[HomePage loadItems] Finalizing. Displayed ${finalProcessedItems.slice(0, ITEMS_PER_PAGE).length} of ${finalProcessedItems.length} items.`);

      if (toastMessage && !error) {
        toast(toastMessage);
      } else if (error && !isAuthError) {
        toast({title: "Error Loading Deals", description: "An unexpected error occurred.", variant: "destructive"});
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
