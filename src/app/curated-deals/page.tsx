
'use client';

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
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

export default function CuratedDealsPage() {
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

  const loadItems = useCallback(async (queryFromSearchState: string) => {
    console.log(`[CuratedDealsPage loadItems] Initiating. Query from state: "${queryFromSearchState}"`);
    setIsLoading(true);
    setIsRanking(false);
    setError(null);
    setIsAuthError(false);
    
    let processedItems: BayBotItem[] = [];
    let toastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;

    const isGlobalCuratedRequest = queryFromSearchState === '';
    const effectiveQueryForEbay = isGlobalCuratedRequest ? GLOBAL_CURATED_DEALS_REQUEST_MARKER : queryFromSearchState;
    const fetchType = 'deals';

    try {
      let fetchedItems: BayBotItem[] = await fetchItems(fetchType, effectiveQueryForEbay);
      console.log(`[CuratedDealsPage loadItems] Fetched ${fetchedItems.length} items for type '${fetchType}' using query/marker '${effectiveQueryForEbay}'.`);

      if (fetchedItems.length > 0) {
        if (isGlobalCuratedRequest) { // Always attempt AI ranking for global curated deals
          setIsRanking(true);
          const dealsInputForAI: AIDeal[] = fetchedItems.map(mapToAIDeal);
          try {
            const aiRankerInput: RankDealsInput = { deals: dealsInputForAI, query: "curated homepage deals" }; // Generic query for AI context
            console.log(`[CuratedDealsPage loadItems] Sending ${dealsInputForAI.length} global curated deals to AI for ranking.`);
            const rankedOutputFromAI: AIDeal[] = await rankDealsAI(aiRankerInput);

            if (rankedOutputFromAI !== dealsInputForAI && rankedOutputFromAI.length === dealsInputForAI.length) {
              const orderMap = new Map(rankedOutputFromAI.map((deal, index) => [deal.id, index]));
              fetchedItems.sort((a, b) => {
                const posA = orderMap.get(a.id);
                const posB = orderMap.get(b.id);
                if (posA === undefined && posB === undefined) return 0;
                if (posA === undefined) return 1;
                if (posB === undefined) return -1;
                return posA - posB;
              });
              processedItems = fetchedItems;
              toastMessage = { title: "Curated Deals: AI Ranked", description: "Displaying AI-ranked global deals." };
              console.log(`[CuratedDealsPage loadItems] AI successfully ranked ${processedItems.length} global curated deals.`);
            } else {
              // AI ranking didn't change order or failed to return a valid list, sort by discount
              processedItems = [...fetchedItems].sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
              toastMessage = { title: "Curated Deals: Sorted by Discount", description: "Displaying global deals, sorted by highest discount." };
              console.log(`[CuratedDealsPage loadItems] AI ranking not applied for global curated. Sorted ${processedItems.length} deals by discount.`);
            }
          } catch (aiRankErrorCaught: any) {
            console.error("[CuratedDealsPage loadItems] AI Ranking failed for global curated deals:", aiRankErrorCaught);
            processedItems = [...fetchedItems].sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
            toastMessage = { title: "Curated Deals: AI Error, Sorted by Discount", description: "AI ranking failed. Displaying global deals by discount.", variant: "destructive"};
          }
        } else { // User-initiated search for deals
           setIsRanking(true);
          const dealsInputForAI: AIDeal[] = fetchedItems.map(mapToAIDeal);
          try {
            const aiRankerInput: RankDealsInput = { deals: dealsInputForAI, query: effectiveQueryForEbay };
            console.log(`[CuratedDealsPage loadItems] Sending ${dealsInputForAI.length} user-searched deals to AI for ranking. Query context: "${effectiveQueryForEbay}"`);
            const rankedOutputFromAI: AIDeal[] = await rankDealsAI(aiRankerInput);

            if (rankedOutputFromAI !== dealsInputForAI && rankedOutputFromAI.length === dealsInputForAI.length) {
              const orderMap = new Map(rankedOutputFromAI.map((deal, index) => [deal.id, index]));
              fetchedItems.sort((a, b) => {
                const posA = orderMap.get(a.id);
                const posB = orderMap.get(b.id);
                if (posA === undefined && posB === undefined) return 0;
                if (posA === undefined) return 1;
                if (posB === undefined) return -1;
                return posA - posB;
              });
              processedItems = fetchedItems;
              aiRankedSuccessfully = true;
              toastMessage = { title: "Deals: AI Ranked", description: `Displaying AI-ranked deals for "${queryFromSearchState}".`};
              console.log(`[CuratedDealsPage loadItems] AI successfully ranked ${processedItems.length} user-searched deals.`);
            } else {
              processedItems = [...fetchedItems].sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
              toastMessage = { title: "Deals: Sorted by Discount", description: `Displaying deals for "${queryFromSearchState}" sorted by highest discount.`};
              console.log(`[CuratedDealsPage loadItems] AI ranking not applied for user search or no change. Sorted ${processedItems.length} deals by discount.`);
            }
          } catch (aiRankErrorCaught: any) {
            console.error("[CuratedDealsPage loadItems] AI Ranking failed for user search:", aiRankErrorCaught);
            processedItems = [...fetchedItems].sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
            toastMessage = { title: "Deals: AI Error, Sorted by Discount", description: `Displaying deals for "${queryFromSearchState}" sorted by discount. AI service might be unavailable.`, variant: "destructive"};
          }
        }
      } else {
         processedItems = [];
         if (queryFromSearchState) {
            toastMessage = { title: "No Deals Found", description: `No deals found for "${queryFromSearchState}".`};
         } else {
            toastMessage = { title: "No Curated Deals", description: "No global curated deals found at this time."};
         }
      }
    } catch (e: any) {
      console.error(`[CuratedDealsPage loadItems] Failed to load items. Query/Marker '${effectiveQueryForEbay}'. Error:`, e);
      let displayMessage = `Failed to load deals. Please try again.`;
      if (typeof e.message === 'string') {
        if (e.message.includes("invalid_client") || e.message.includes("Critical eBay API Authentication Failure")) {
          displayMessage = "Critical eBay API Authentication Failure. Check .env and server logs.";
          setIsAuthError(true);
        } else if (e.message.includes("OAuth") || e.message.includes("authenticate with eBay API")) {
          displayMessage = "eBay API Authentication Failed. Check credentials and server logs.";
          setIsAuthError(true);
        } else if (e.message.includes("Failed to fetch from eBay Browse API")) {
          displayMessage = `Error fetching from eBay for "${effectiveQueryForEbay}". Check query or eBay status. Server logs may have details.`;
        } else {
          displayMessage = e.message;
        }
      }
      setError(displayMessage);
      processedItems = []; // Ensure items are cleared on error
    } finally {
      setAllItems(processedItems);
      setDisplayedItems(processedItems.slice(0, ITEMS_PER_PAGE));
      setVisibleItemCount(ITEMS_PER_PAGE);
      setIsLoading(false);
      setIsRanking(false);
      console.log(`[CuratedDealsPage loadItems] Finalizing. isLoading: false, isRanking: false.`);
      
      if (toastMessage && !error) {
        toast(toastMessage);
      }
    }
  }, [toast, mapToAIDeal]);

  useEffect(() => {
    console.log(`[CuratedDealsPage useEffect] Triggering loadItems. searchQuery: "${searchQuery}"`);
    loadItems(searchQuery);
  }, [searchQuery, loadItems]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
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

  let noItemsTitle = "No Deals Found";
  let noItemsDescription = searchQuery 
    ? `Try adjusting your search for "${searchQuery}".` 
    : "No global curated deals available at the moment. Check back later!";

  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader
        onSearch={handleSearch}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
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
