
'use client';

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { AppHeader } from '@/components/baybot/AppHeader';
import { ItemCard } from '@/components/baybot/ItemCard';
import { ItemGridLoadingSkeleton } from '@/components/baybot/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShoppingBag, Search, AlertTriangle, Info } from "lucide-react"; // Removed BarChart2
import type { BayBotItem } from '@/types';
import { fetchItems, getRandomPopularSearchTerm } from '@/services/ebay-api-service';
import { rankDeals as rankDealsAI, type Deal as AIDeal, type RankDealsInput } from '@/ai/flows/rank-deals';
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';
import { 
  GLOBAL_CURATED_DEALS_REQUEST_MARKER, 
  GLOBAL_CURATED_AUCTIONS_REQUEST_MARKER 
} from '@/lib/constants';

const ITEMS_PER_PAGE = 8;

const AnalysisModal = dynamic(() =>
  import('@/components/baybot/AnalysisModal').then(mod => mod.AnalysisModal),
  { ssr: false, loading: () => <ItemGridLoadingSkeleton count={1} /> }
);

export default function HomePage() {
  const [currentView, setCurrentView] = useState<'deals' | 'auctions'>('deals');
  const [searchQuery, setSearchQuery] = useState(''); // Empty string signifies global curated mode
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

  const loadItems = useCallback(async (viewToLoad: 'deals' | 'auctions', queryFromSearchState: string) => {
    console.log(`[HomePage loadItems] Initiating. View: ${viewToLoad}, Query from state: "${queryFromSearchState}"`);
    setIsLoading(true);
    setIsRanking(false);
    setError(null);
    setIsAuthError(false);
    
    let fetchedItems: BayBotItem[] = [];
    let aiRankedSuccessfully = false;
    let rankErrorOccurred = false;
    
    let effectiveQueryForEbay: string;
    let fetchType: 'deals' | 'auctions' = viewToLoad;
    let isGlobalCuratedRequest = false;
    let currentOperationDescription = "";


    if (queryFromSearchState === '') { // Global curated request (app launch or empty search)
      isGlobalCuratedRequest = true;
      if (viewToLoad === 'deals') {
        effectiveQueryForEbay = GLOBAL_CURATED_DEALS_REQUEST_MARKER;
        currentOperationDescription = "Loading global curated deals";
      } else { // auctions view with empty search
        effectiveQueryForEbay = GLOBAL_CURATED_AUCTIONS_REQUEST_MARKER;
        currentOperationDescription = "Loading global curated auctions";
      }
      console.log(`[HomePage loadItems] Global curated request. Type: ${fetchType}, Marker: "${effectiveQueryForEbay}"`);
    } else { // User-initiated search
      isGlobalCuratedRequest = false;
      effectiveQueryForEbay = queryFromSearchState;
      fetchType = viewToLoad;
      currentOperationDescription = `Searching for "${effectiveQueryForEbay}" in ${fetchType}`;
      console.log(`[HomePage loadItems] User search. Type: ${fetchType}, Query: "${effectiveQueryForEbay}"`);
    }
    
    try {
      fetchedItems = await fetchItems(fetchType, effectiveQueryForEbay);
      console.log(`[HomePage loadItems] Fetched ${fetchedItems.length} items for type '${fetchType}' using query/marker '${effectiveQueryForEbay}'.`);

      if (fetchType === 'deals' && fetchedItems.length > 0) {
        if (isGlobalCuratedRequest) {
          // For global curated deals, bypass AI ranking and sort by discount only
          fetchedItems.sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
          aiRankedSuccessfully = false; // AI was not used
          console.log(`[HomePage loadItems] Global curated deals: Bypassed AI, sorted ${fetchedItems.length} deals by discount.`);
        } else {
          // For user-searched deals, use AI ranking
          setIsRanking(true);
          const dealsInputForAI: AIDeal[] = fetchedItems.map(mapToAIDeal);
          try {
            const aiRankerInput: RankDealsInput = {
              deals: dealsInputForAI,
              query: effectiveQueryForEbay, 
            };
            console.log(`[HomePage loadItems] Sending ${dealsInputForAI.length} user-searched deals to AI for ranking. Query context: "${effectiveQueryForEbay}"`);
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
              aiRankedSuccessfully = true;
              console.log(`[HomePage loadItems] AI successfully ranked ${fetchedItems.length} user-searched deals.`);
            } else {
              // AI ranking not applied or no change, sort by discount as fallback
              fetchedItems.sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
              console.log(`[HomePage loadItems] AI ranking not applied for user search or no change. Sorted ${fetchedItems.length} deals by discount.`);
            }
          } catch (aiRankErrorCaught: any) {
            console.error("[HomePage loadItems] AI Ranking failed for user search:", aiRankErrorCaught);
            rankErrorOccurred = true;
            fetchedItems.sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
            console.log(`[HomePage loadItems] AI ranking error for user search. Sorted ${fetchedItems.length} deals by discount as fallback.`);
          }
        }
      } else if (fetchType === 'deals' && fetchedItems.length === 0) {
        console.log(`[HomePage loadItems] No deals fetched to rank for query/marker "${effectiveQueryForEbay}".`);
      }
      // Auctions are already sorted by itemEndDate by fetchItems

    } catch (e: any) {
      console.error(`[HomePage loadItems] Failed to load items. Type '${fetchType}', Query/Marker '${effectiveQueryForEbay}'. Error:`, e);
      let displayMessage = `Failed to load ${fetchType}. Please try again.`;
      if (typeof e.message === 'string') {
          if (e.message.includes("invalid_client") || e.message.includes("Critical eBay API Authentication Failure")) {
            displayMessage = "Critical eBay API Authentication Failure: Please verify EBAY_APP_ID/EBAY_CERT_ID in .env and ensure production API access. Consult server logs.";
            setIsAuthError(true);
          } else if (e.message.includes("OAuth") || e.message.includes("authenticate with eBay API")) {
            displayMessage = "eBay API Authentication Failed. Check credentials and production access. See server logs.";
            setIsAuthError(true);
          } else if (e.message.includes("Failed to fetch from eBay Browse API")) {
            displayMessage = `Error fetching from eBay for "${effectiveQueryForEbay}". Check query or eBay status. Server logs may have details.`;
          } else {
            displayMessage = e.message; 
          }
      }
      setError(displayMessage);
      setAllItems([]); 
      setDisplayedItems([]);
    } finally {
      setIsLoading(false);
      setIsRanking(false);
      console.log(`[HomePage loadItems] Finalizing. isLoading: false, isRanking: false.`);
    }
    
    setAllItems(fetchedItems);
    setDisplayedItems(fetchedItems.slice(0, ITEMS_PER_PAGE));
    setVisibleItemCount(ITEMS_PER_PAGE);
    console.log(`[HomePage loadItems] Updated allItems (${fetchedItems.length}), displayedItems (${fetchedItems.slice(0, ITEMS_PER_PAGE).length}).`);

    // Toast notifications
    setTimeout(() => {
        if (error) {
            // Error toast is handled by the Alert component primarily
        } else if (fetchType === 'deals' && fetchedItems.length > 0) {
            if (isGlobalCuratedRequest) {
                 toast({
                    title: "Global Curated Deals",
                    description: "Displaying deals from across our curated keywords, sorted by highest discount.",
                });
            } else if (aiRankedSuccessfully) {
                toast({
                    title: "Deals: AI Ranked",
                    description: `Displaying AI-ranked deals for "${queryFromSearchState}".`,
                });
            } else if (rankErrorOccurred) {
                 toast({
                    title: "AI Ranking Error, Sorted by Discount",
                    description: `Displaying deals for "${queryFromSearchState}" sorted by discount. AI service might be unavailable.`,
                    variant: "destructive",
                });
            } else { // AI not used (global) or AI ranking made no change/not applicable (user search)
                 toast({
                    title: "Deals Sorted by Discount",
                    description: `Displaying deals for "${queryFromSearchState}" sorted by highest discount.`,
                });
            }
        } else if (fetchType === 'auctions' && fetchedItems.length > 0) {
            toast({
                title: isGlobalCuratedRequest ? "Global Curated Auctions" : "Auctions Loaded",
                description: isGlobalCuratedRequest 
                    ? "Displaying auctions from our curated keywords, ending soonest."
                    : `Displaying auctions related to "${queryFromSearchState}", ending soonest.`,
            });
        }
    }, 0);
  }, [toast, mapToAIDeal]); 

  useEffect(() => {
     console.log(`[HomePage useEffect] Triggering loadItems. currentView: ${currentView}, searchQuery: "${searchQuery}"`);
     loadItems(currentView, searchQuery);
  }, [currentView, searchQuery, loadItems]); 

  const handleSearch = (query: string) => {
    // If an empty query is submitted, it will trigger the global curated view.
    // If a query is submitted, it will trigger a user search.
    setSearchQuery(query); 
  };

  const handleViewChange = (view: 'deals' | 'auctions') => {
    // Does not clear searchQuery. loadItems will use current searchQuery 
    // or fall back to global curated if searchQuery is empty.
    setCurrentView(view);
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

  // Determine placeholder text based on current state
  let noItemsTitle = `No ${currentView} found`;
  let noItemsDescription = "";
  if (searchQuery === '') { // Global curated view
      noItemsDescription = currentView === 'deals' 
          ? "No global curated deals found. The hourly sweep might be in progress or no items matched."
          : "No global curated auctions found. The hourly sweep might be in progress or no items matched.";
  } else { // User search view
      noItemsDescription = `Try adjusting your search for "${searchQuery}".`;
  }


  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader
        currentView={currentView}
        onViewChange={handleViewChange}
        onSearch={handleSearch} // This sets searchQuery, which useEffect listens to
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery} // Direct control for input field
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
          <div className="text-center py-10">
            <Search className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
            <h2 className="text-2xl font-headline mb-2">{noItemsTitle}</h2>
            <p className="text-muted-foreground">{noItemsDescription}</p>
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
