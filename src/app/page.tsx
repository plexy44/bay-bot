
'use client';

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { AppHeader } from '@/components/baybot/AppHeader';
import { ItemCard } from '@/components/baybot/ItemCard';
import { ItemGridLoadingSkeleton } from '@/components/baybot/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BarChart2, ShoppingBag, Search, AlertTriangle } from "lucide-react";
import type { BayBotItem } from '@/types';
import { fetchItems, getBatchedCuratedKeywordsQuery, getRandomPopularSearchTerm } from '@/services/ebay-api-service';
import { rankDeals as rankDealsAI, type Deal as AIDeal, type RankDealsInput } from '@/ai/flows/rank-deals';
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';

const ITEMS_PER_PAGE = 8;

const AnalysisModal = dynamic(() =>
  import('@/components/baybot/AnalysisModal').then(mod => mod.AnalysisModal),
  { ssr: false, loading: () => <ItemGridLoadingSkeleton count={1} /> }
);

export default function HomePage() {
  const [currentView, setCurrentView] = useState<'deals' | 'auctions'>('deals');
  const [searchQuery, setSearchQuery] = useState('');
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

  const loadItems = useCallback(async (view: 'deals' | 'auctions', queryFromSearch: string) => {
    setIsLoading(true);
    setIsRanking(false);
    setError(null);
    setIsAuthError(false);
    let fetchedItems: BayBotItem[] = [];
    const isCuratedHomepage = view === 'deals' && !queryFromSearch;
    let aiRankedSuccessfully = false;
    let rankErrorOccurred = false;
    let finalQueryForEbay = queryFromSearch;

    try {
      if (isCuratedHomepage) {
        finalQueryForEbay = await getBatchedCuratedKeywordsQuery();
        console.log(`[HomePage] Curated homepage. Batched query: ${finalQueryForEbay}`);
      } else if (view === 'auctions' && !queryFromSearch) {
        finalQueryForEbay = "collectible auction"; // Default for auctions
        console.log(`[HomePage] Auctions view, no query. Using default: ${finalQueryForEbay}`);
      } else if (!finalQueryForEbay && view === 'deals') { // Fallback if query is empty string for deals
        finalQueryForEbay = await getBatchedCuratedKeywordsQuery();
        console.log(`[HomePage] Deals view, query empty. Fallback to batched: ${finalQueryForEbay}`);
      } else if (!finalQueryForEbay && view === 'auctions') { // Fallback if query is empty string for auctions
        finalQueryForEbay = "collectible auction";
        console.log(`[HomePage] Auctions view, query empty. Fallback to default auction: ${finalQueryForEbay}`);
      }
      
      // Final safety net for query
      if (!finalQueryForEbay) {
        finalQueryForEbay = await getRandomPopularSearchTerm(); // Or a generic term like "electronics"
        console.warn(`[HomePage] finalQueryForEbay was still empty. Using random popular term: ${finalQueryForEbay}`);
      }

      fetchedItems = await fetchItems(view, finalQueryForEbay, isCuratedHomepage);

      if (view === 'deals' && fetchedItems.length > 0) {
        setIsRanking(true);
        const dealsInputForAI: AIDeal[] = fetchedItems.map(mapToAIDeal);
        try {
          const aiRankerInput: RankDealsInput = {
            deals: dealsInputForAI,
            query: finalQueryForEbay, // Use the actual query sent to eBay for AI context
          };
          const rankedOutputFromAI: AIDeal[] = await rankDealsAI(aiRankerInput);

          // Check if AI returned a new list of the same length (successful ranking)
          if (rankedOutputFromAI !== dealsInputForAI && rankedOutputFromAI.length === dealsInputForAI.length) {
            const orderMap = new Map(rankedOutputFromAI.map((deal, index) => [deal.id, index]));
            fetchedItems.sort((a, b) => {
              const posA = orderMap.get(a.id);
              const posB = orderMap.get(b.id);
              if (posA === undefined && posB === undefined) return 0;
              if (posA === undefined) return 1; // Put items not in AI output at the end
              if (posB === undefined) return -1;
              return posA - posB;
            });
            aiRankedSuccessfully = true;
          } else {
            // AI did not provide a new ranking (e.g., error, no change, or length mismatch)
            // Fallback: sort by discount percentage if AI ranking wasn't successful or applicable
            fetchedItems.sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
          }
        } catch (aiRankErrorCaught: any) {
          console.error("AI Ranking failed:", aiRankErrorCaught);
          rankErrorOccurred = true;
          // Fallback sort on AI error
          fetchedItems.sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
        } finally {
          setIsRanking(false);
        }
      } else if (view === 'deals' && fetchedItems.length === 0) {
        // No items for deals, no AI ranking needed.
      }
      // For auctions, no AI ranking is done, and they are sorted by API (itemEndDate).

    } catch (e: any) {
      console.error("Failed to load items:", e);
      let displayMessage = `Failed to load ${view}. Please try again.`;
      if (typeof e.message === 'string') {
          if (e.message.includes("invalid_client") || e.message.includes("Critical eBay API Authentication Failure")) {
            displayMessage = "Critical eBay API Authentication Failure: Please verify EBAY_APP_ID/EBAY_CERT_ID in .env and ensure production API access. Consult server logs.";
            setIsAuthError(true);
          } else if (e.message.includes("OAuth") || e.message.includes("authenticate with eBay API")) {
            displayMessage = "eBay API Authentication Failed. Check credentials and production access. See server logs.";
            setIsAuthError(true);
          } else if (e.message.includes("Failed to fetch from eBay Browse API")) {
            displayMessage = `Error fetching from eBay for "${finalQueryForEbay}". Check query or eBay status.`;
          } else {
            displayMessage = e.message; // Use the error message directly if it's specific enough
          }
      }
      setError(displayMessage);
      setAllItems([]); // Clear items on error
      setDisplayedItems([]);
    } finally {
      setIsLoading(false);
      setIsRanking(false); // Ensure isRanking is false even if AI part was skipped or errored early
    }
    
    // This needs to be outside the try/catch/finally for setIsLoading to correctly set allItems
    // for the current render pass, which then allows setDisplayedItems to work correctly.
    setAllItems(fetchedItems);
    setDisplayedItems(fetchedItems.slice(0, ITEMS_PER_PAGE));
    setVisibleItemCount(ITEMS_PER_PAGE);

    // Toast notifications after all operations
    if (!isLoading && !isRanking) { // Ensure loading states are false before showing toast
        if (error) {
            // Error toast is handled by the Alert component primarily
        } else if (view === 'deals' && fetchedItems.length > 0) {
            if (aiRankedSuccessfully) {
                toast({
                    title: isCuratedHomepage ? "Curated Deals: AI Ranked" : "Deals: AI Ranked",
                    description: isCuratedHomepage 
                        ? "Displaying AI-ranked curated deals." 
                        : "Items intelligently ranked by AI.",
                });
            } else if (rankErrorOccurred) {
                 toast({
                    title: "AI Ranking Error, Sorted by Discount",
                    description: "Displaying deals sorted by highest discount. AI service might be unavailable.",
                    variant: "destructive",
                });
            } else { // AI not successful or not applicable, but deals exist
                 toast({
                    title: "Deals Sorted by Discount",
                    description: "Displaying deals sorted by highest discount.",
                    variant: "default",
                });
            }
        } else if (view === 'auctions' && fetchedItems.length > 0) {
            toast({
                title: "Auctions Loaded",
                description: `Displaying auctions related to "${finalQueryForEbay}".`,
            });
        }
        // No toast if no items are found and no error occurred (UI handles this)
    }
  }, [toast, mapToAIDeal]); // Dependencies of loadItems

  useEffect(() => {
     console.log(`[HomePage useEffect] Triggering loadItems. View: ${currentView}, Query: ${searchQuery}`);
     loadItems(currentView, searchQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, searchQuery]); // loadItems is stable due to useCallback

  const handleSearch = (query: string) => {
    setSearchQuery(query);
  };

  const handleViewChange = (view: 'deals' | 'auctions') => {
    setCurrentView(view);
    setSearchQuery(''); // Clear search query when changing views for a fresh load
  };

  const handleLoadMore = () => {
    const newVisibleCount = visibleItemCount + ITEMS_PER_PAGE;
    setDisplayedItems(allItems.slice(0, newVisibleCount));
    setVisibleItemCount(newVisibleCount);
  };

  const handleAnalyzeItem = (item: BayBotItem) => {
    setSelectedItemForAnalysis(item);
    setIsAnalysisModalOpen(true);
  };

  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader
        currentView={currentView}
        onViewChange={handleViewChange}
        onSearch={handleSearch}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />
      <main className="flex-grow container mx-auto px-4 py-8">
        {error && (
          <Alert variant="destructive" className="mb-6">
            {isAuthError ? <AlertTriangle className="h-4 w-4" /> : <BarChart2 className="h-4 w-4" />}
            <AlertTitle>{isAuthError ? "Authentication Error" : "Error"}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {(isLoading || isRanking) && <ItemGridLoadingSkeleton count={ITEMS_PER_PAGE} />}

        {!isLoading && !isRanking && displayedItems.length === 0 && !error && (
          <div className="text-center py-10">
            <Search className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
            <h2 className="text-2xl font-headline mb-2">No {currentView} found</h2>
            <p className="text-muted-foreground">
              {searchQuery
                ? `Try adjusting your search for "${searchQuery}".`
                : (currentView === 'deals' ? `No curated deals found. Try a different search or check back later.` : `No auctions found. Try a different search or check back later.`)
              }
            </p>
          </div>
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
                  <ShoppingBag className="mr-2 h-5 w-5" /> Load More
                </Button>
              </div>
            )}
          </>
        )}
      </main>
      <footer className="text-center py-6 border-t border-border/40 bg-background/60 backdrop-blur-lg text-sm text-muted-foreground">
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
    
