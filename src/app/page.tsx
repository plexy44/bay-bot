
'use client';

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/baybot/AppHeader';
import { ItemCard } from '@/components/baybot/ItemCard';
import { AnalysisModal } from '@/components/baybot/AnalysisModal';
import { ItemGridLoadingSkeleton } from '@/components/baybot/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BarChart2, ShoppingBag, Search, AlertTriangle } from "lucide-react";
import type { BayBotItem } from '@/types';
import { fetchItems } from '@/services/ebay-api-service';
import { rankDeals as rankDealsAI, type Deal as AIDeal, type RankDealsInput } from '@/ai/flows/rank-deals';
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';


const ITEMS_PER_PAGE = 8;

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

  const loadItems = useCallback(async (view: 'deals' | 'auctions', query: string) => {
    setIsLoading(true);
    setError(null);
    setIsAuthError(false);
    let fetchedItems: BayBotItem[] = [];
    const isCuratedHomepage = view === 'deals' && !query;
    let aiRankedSuccessfully = false;

    try {
      fetchedItems = await fetchItems(view, query, isCuratedHomepage);
      
      if ((query || isCuratedHomepage) && fetchedItems.length > 0 && view === 'deals') {
        setIsRanking(true);
        const dealsForAI = fetchedItems.map(mapToAIDeal);
        try {
          const aiRankerInput: RankDealsInput = {
            deals: dealsForAI,
            query: query || (isCuratedHomepage ? "general deals" : ""), 
          };
          const rankedAIDeals = await rankDealsAI(aiRankerInput);
          
          // Check if rankDealsAI returned a new, successfully ranked list
          // The rankDealsFlow now returns the original `dealsForAI` reference if it failed or returned partial.
          if (rankedAIDeals !== dealsForAI) {
            const rankedMap = new Map(rankedAIDeals.map(d => [d.id, d]));
            fetchedItems = fetchedItems
              .filter(item => rankedMap.has(item.id)) // Safety filter
              .sort((a, b) => {
                  const indexA = rankedAIDeals.findIndex(d => d.id === a.id);
                  const indexB = rankedAIDeals.findIndex(d => d.id === b.id);
                  // Handle cases where an item might not be in rankedAIDeals (should be rare with rankDealsFlow fix)
                  if (indexA === -1 && indexB === -1) return 0;
                  if (indexA === -1) return 1; 
                  if (indexB === -1) return -1;
                  return indexA - indexB;
              });
            aiRankedSuccessfully = true;
            toast({
              title: isCuratedHomepage ? "Top Deals Curated by AI" : "Smart Ranking Applied",
              description: isCuratedHomepage 
                ? "Displaying AI-qualified and ranked top deals."
                : "Items re-ordered by relevance, value, and other factors.",
            });
          } else {
            // AI ranking did not produce a new order (returned original list)
             toast({
                title: "AI Ranking Notice",
                description: "AI ranking did not change the order. Displaying deals sorted by discount.",
                variant: "default",
              });
          }
        } catch (rankError) {
          console.error("AI Ranking failed:", rankError);
          toast({
            title: "AI Ranking Error",
            description: "Displaying default sorted items (by discount). AI ranking service might be unavailable.",
            variant: "destructive",
          });
        } finally {
          setIsRanking(false);
        }
      }
      
      // If AI ranking was not successful or not attempted for deals, sort by discount.
      // For auctions, AI ranking is not applied, so this won't run.
      if (view === 'deals' && !aiRankedSuccessfully) {
        fetchedItems.sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
      }

      setAllItems(fetchedItems);
      setDisplayedItems(fetchedItems.slice(0, ITEMS_PER_PAGE));
      setVisibleItemCount(ITEMS_PER_PAGE);
    } catch (e: any) {
      console.error("Failed to load items:", e);
      const errorMessage = e.message || `Failed to load ${view}. Please try again.`;
      if (errorMessage.includes("invalid_client")) {
        setError("Critical eBay API Authentication Failure: The error 'invalid_client' indicates your EBAY_APP_ID or EBAY_CERT_ID in the .env file is incorrect or lacks production API access. Please verify these credentials and restart your application. Consult server logs for the exact eBay response.");
        setIsAuthError(true);
      } else if (errorMessage.includes("OAuth") || errorMessage.includes("authenticate with eBay API")) {
        setError("eBay API Authentication Failed. Please check your API credentials in the .env file and ensure they have production access. See server logs for more details.");
        setIsAuthError(true);
      } else {
        setError(`Failed to load ${view}. Please check your connection or API setup.`);
      }
      setAllItems([]);
      setDisplayedItems([]);
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, mapToAIDeal, currentView, searchQuery]); // searchQuery added to deps
  
  useEffect(() => {
    // Initial load or when view/searchQuery changes
     loadItems(currentView, searchQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, searchQuery]);


  const handleSearch = (query: string) => {
    setSearchQuery(query); 
  };
  
  const handleViewChange = (view: 'deals' | 'auctions') => {
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
                : `No items found for the current view. Try a search or check back later.`
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
      <footer className="text-center py-6 border-t border-border/40 text-sm text-muted-foreground">
        <div className="container mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 sm:gap-0">
          <p>&copy; {new Date().getFullYear()} BayBot. All rights reserved.</p>
          <ThemeToggle />
        </div>
      </footer>
      <AnalysisModal
        item={selectedItemForAnalysis}
        isOpen={isAnalysisModalOpen}
        onClose={() => setIsAnalysisModalOpen(false)}
      />
    </div>
  );
}

