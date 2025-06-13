
'use client';

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/baybot/AppHeader';
import { ItemCard } from '@/components/baybot/ItemCard';
import { AnalysisModal } from '@/components/baybot/AnalysisModal';
import { ItemGridLoadingSkeleton } from '@/components/baybot/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BarChart2, ShoppingBag, Search } from "lucide-react";
import type { BayBotItem } from '@/types';
import { fetchItems, popularSearchTerms } from '@/lib/ebay-mock-api';
import { rankDeals as rankDealsAI, type Deal as AIDeal, type RankDealsInput } from '@/ai/flows/rank-deals';
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';


const ITEMS_PER_PAGE = 8;

export default function HomePage() {
  const [currentView, setCurrentView] = useState<'deals' | 'auctions'>('deals');
  const [searchQuery, setSearchQuery] = useState(''); // Initialize empty, will be set by useEffect
  const [displayedItems, setDisplayedItems] = useState<BayBotItem[]>([]);
  const [allItems, setAllItems] = useState<BayBotItem[]>([]);
  const [visibleItemCount, setVisibleItemCount] = useState(ITEMS_PER_PAGE);
  const [isLoading, setIsLoading] = useState(true);
  const [isRanking, setIsRanking] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
      let fetchedItems = await fetchItems(view, query);
      
      if (query && fetchedItems.length > 0 && view === 'deals') { // AI ranking only for deals with a query
        setIsRanking(true);
        try {
          const aiRankerInput: RankDealsInput = {
            deals: fetchedItems.map(mapToAIDeal),
            query: query,
          };
          const rankedAIDeals = await rankDealsAI(aiRankerInput);
          
          const rankedMap = new Map(rankedAIDeals.map(d => [d.id, d]));
          fetchedItems = fetchedItems
            .filter(item => rankedMap.has(item.id)) 
            .sort((a, b) => {
                const indexA = rankedAIDeals.findIndex(d => d.id === a.id);
                const indexB = rankedAIDeals.findIndex(d => d.id === b.id);
                return indexA - indexB;
            });

          toast({
            title: "Smart Ranking Applied",
            description: "Items have been re-ordered by relevance and value.",
          });
        } catch (rankError) {
          console.error("AI Ranking failed:", rankError);
          toast({
            title: "AI Ranking Failed",
            description: "Displaying default sorted items. AI ranking service might be unavailable.",
            variant: "destructive",
          });
          if (view === 'deals') {
            fetchedItems.sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
          }
        } finally {
          setIsRanking(false);
        }
      } else if (view === 'deals' && fetchedItems.length > 0) {
        fetchedItems.sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
      }


      setAllItems(fetchedItems);
      setDisplayedItems(fetchedItems.slice(0, ITEMS_PER_PAGE));
      setVisibleItemCount(ITEMS_PER_PAGE);
    } catch (e) {
      console.error("Failed to load items:", e);
      setError(`Failed to load ${view}. Please try again.`);
      setAllItems([]);
      setDisplayedItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [toast, mapToAIDeal]);

  useEffect(() => {
    // Handles initial load (with random search for deals) and subsequent updates.
    if (!searchQuery && currentView === 'deals') {
      // If search query is empty and current view is deals (e.g., initial load scenario, or user clears search).
      // This check ensures Math.random runs client-side.
      if (typeof window !== "undefined" && popularSearchTerms.length > 0) {
        const randomTerm = popularSearchTerms[Math.floor(Math.random() * popularSearchTerms.length)];
        setSearchQuery(randomTerm); // This will trigger a re-render and this useEffect will run again with the new query.
                                    // In the next run, the `else if` block below will execute loadItems.
      } else if (popularSearchTerms.length === 0) {
        // Fallback if popularSearchTerms is empty, load with empty query for deals
        loadItems(currentView, '');
      }
      // If popularSearchTerms has items but Math.random hasn't run yet, we wait for the re-trigger.
    } else if (searchQuery || currentView === 'auctions') {
      // Load items if there's a search query, or if the view is auctions (which doesn't require a query to show something)
      loadItems(currentView, searchQuery);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, searchQuery, loadItems]); // popularSearchTerms is constant, so not strictly needed.

  const handleSearch = (query: string) => {
    setSearchQuery(query); // Update state, useEffect will handle loading.
  };
  
  const handleViewChange = (view: 'deals' | 'auctions') => {
    setCurrentView(view); // Update state, useEffect will handle loading.
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
        setSearchQuery={setSearchQuery} // Pass setSearchQuery for direct updates from AppHeader (e.g. logo click)
      />
      <main className="flex-grow container mx-auto px-4 py-8">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <BarChart2 className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {(isLoading || isRanking) && <ItemGridLoadingSkeleton count={ITEMS_PER_PAGE} />}
        
        {!isLoading && !isRanking && displayedItems.length === 0 && (
          <div className="text-center py-10">
            <Search className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
            <h2 className="text-2xl font-headline mb-2">No {currentView} found</h2>
            <p className="text-muted-foreground">
              Try adjusting your search query or check back later.
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
