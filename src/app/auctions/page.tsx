
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
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from '@/components/ThemeToggle';
import { GLOBAL_CURATED_AUCTIONS_REQUEST_MARKER } from '@/lib/constants';

const ITEMS_PER_PAGE = 8;

const AnalysisModal = dynamic(() =>
  import('@/components/baybot/AnalysisModal').then(mod => mod.AnalysisModal),
  { ssr: false, loading: () => <ItemGridLoadingSkeleton count={1} /> }
);

export default function AuctionsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [displayedItems, setDisplayedItems] = useState<BayBotItem[]>([]);
  const [allItems, setAllItems] = useState<BayBotItem[]>([]);
  const [visibleItemCount, setVisibleItemCount] = useState(ITEMS_PER_PAGE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);

  const [selectedItemForAnalysis, setSelectedItemForAnalysis] = useState<BayBotItem | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

  const { toast } = useToast();

  const loadItems = useCallback(async (queryFromSearchState: string) => {
    console.log(`[AuctionsPage loadItems] Initiating. Query from state: "${queryFromSearchState}"`);
    setIsLoading(true);
    setError(null);
    setIsAuthError(false);
    
    let processedItems: BayBotItem[] = [];
    let toastMessage: { title: string; description: string; variant?: 'destructive' } | null = null;

    const isGlobalCuratedRequest = queryFromSearchState === '';
    const fetchType = 'auctions'; // This page is always for auctions
    const effectiveQueryForEbay = isGlobalCuratedRequest ? GLOBAL_CURATED_AUCTIONS_REQUEST_MARKER : queryFromSearchState;
    

    try {
      let fetchedItems: BayBotItem[] = await fetchItems(fetchType, effectiveQueryForEbay);
      console.log(`[AuctionsPage loadItems] Fetched ${fetchedItems.length} items for type '${fetchType}' using query/marker '${effectiveQueryForEbay}'.`);
      
      processedItems = fetchedItems; // Auctions are sorted by API (endingSoonest)

      if (processedItems.length > 0) {
        if (isGlobalCuratedRequest) {
          toastMessage = { title: "Global Curated Auctions", description: "Displaying auctions from our curated keywords, ending soonest."};
        } else {
          toastMessage = { title: "Auctions Loaded", description: `Displaying auctions for "${queryFromSearchState}", ending soonest.`};
        }
      } else {
         if (queryFromSearchState) {
            toastMessage = { title: "No Auctions Found", description: `No auctions found for "${queryFromSearchState}".`};
         } else {
            toastMessage = { title: "No Curated Auctions", description: "No global curated auctions found at this time."};
         }
      }

    } catch (e: any) {
      console.error(`[AuctionsPage loadItems] Failed to load items. Query/Marker '${effectiveQueryForEbay}'. Error:`, e);
      let displayMessage = `Failed to load auctions. Please try again.`;
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
      processedItems = []; 
    } finally {
      setAllItems(processedItems);
      setDisplayedItems(processedItems.slice(0, ITEMS_PER_PAGE));
      setVisibleItemCount(ITEMS_PER_PAGE);
      setIsLoading(false);
      console.log(`[AuctionsPage loadItems] Finalizing. isLoading: false.`);
      
      if (toastMessage && !error) {
        toast(toastMessage);
      }
    }
  }, [toast]);

  useEffect(() => {
    console.log(`[AuctionsPage useEffect] Triggering loadItems. searchQuery: "${searchQuery}"`);
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
    // Analysis modal is primarily for deals, but can show basic info for auctions
    setSelectedItemForAnalysis(item);
    setIsAnalysisModalOpen(true); 
  };
  
  let noItemsTitle = "No Auctions Found";
  let noItemsDescription = searchQuery 
    ? `Try adjusting your search for "${searchQuery}".`
    : "No global curated auctions available at the moment. Check back later!";


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

        {isLoading && <ItemGridLoadingSkeleton count={ITEMS_PER_PAGE} />}

        {!isLoading && displayedItems.length === 0 && !error && (
           <NoItemsMessage title={noItemsTitle} description={noItemsDescription} />
        )}

        {!isLoading && displayedItems.length > 0 && (
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

    