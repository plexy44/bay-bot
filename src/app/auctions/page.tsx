
'use client';

import type React from 'react';
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { AppHeader } from '@/components/baybot/AppHeader';
import { AppFooter } from '@/components/dealscope/AppFooter';
import { ItemCard } from '@/components/baybot/ItemCard';
import { ItemGridLoadingSkeleton } from '@/components/baybot/LoadingSkeleton';
import { NoItemsMessage } from '@/components/baybot/atomic/NoItemsMessage';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShoppingBag, AlertTriangle, Info, Loader2 } from "lucide-react";
import { useItemPageLogic } from '@/hooks/useItemPageLogic';
import { API_FETCH_LIMIT } from '@/lib/constants';

const AnalysisModal = dynamic(() =>
  import('@/components/baybot/AnalysisModal').then(mod => mod.AnalysisModal),
  { ssr: false, loading: () => <ItemGridLoadingSkeleton count={1} /> }
);

function AuctionsPageContent() {
  const {
    inputValue,
    setInputValue,
    displayedItems,
    isLoading, 
    isRanking, 
    isLoadingMore,
    hasMoreBackendItems,
    error,
    isAuthError,
    selectedItemForAnalysis,
    isAnalysisModalOpen,
    setIsAnalysisModalOpen,
    handleSearchSubmit,
    handleLogoClick,
    handleLoadMore,
    handleAnalyzeItem,
    handleKeywordSearchFromModal,
    handleAuctionEnd,
    noItemsTitle,
    noItemsDescription,
    activeItemsForNoMessageCount,
  } = useItemPageLogic('auction');


  return (
    <div className="flex flex-col min-h-screen">
      <AppHeader
        searchInputValue={inputValue}
        onSearchInputChange={setInputValue}
        onSearchSubmit={handleSearchSubmit}
        onLogoClick={handleLogoClick}
        isLoading={isLoading}
      />
      <main className="flex-grow container mx-auto px-4 py-8">
        {error && (
          <Alert variant="destructive" className="mb-6">
            {isAuthError ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
            <AlertTitle>{isAuthError ? "Authentication Error" : "Error"}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading && displayedItems.length === 0 && <ItemGridLoadingSkeleton count={API_FETCH_LIMIT / 2} />}

        {!isLoading && !isRanking && displayedItems.length === 0 && activeItemsForNoMessageCount === 0 && !error && (
           <NoItemsMessage title={noItemsTitle} description={noItemsDescription} />
        )}

        {displayedItems.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
              {displayedItems.map(item => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onAnalyze={handleAnalyzeItem}
                  onAuctionEnd={handleAuctionEnd}
                />
              ))}
            </div>
          </>
        )}
        { (isLoading || isRanking) && displayedItems.length > 0 && !isLoadingMore && (
            <div className="text-center py-4 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin inline mr-2" />
                 {isRanking ? "AI Processing..." : "Loading..."}
            </div>
        )}

        {displayedItems.length > 0 && hasMoreBackendItems && !isLoading && (
            <div className="text-center">
            <Button onClick={handleLoadMore} disabled={isLoadingMore} size="lg" variant="outline">
                {isLoadingMore ? (
                <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Loading More...
                </>
                ) : (
                <>
                    <ShoppingBag className="mr-2 h-5 w-5" /> Load More Auctions
                </>
                )}
            </Button>
            </div>
        )}
         {isLoadingMore && (
            <div className="text-center py-4 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin inline mr-2" />
                Fetching more auctions...
            </div>
        )}
      </main>
      <AppFooter />
      {isAnalysisModalOpen && selectedItemForAnalysis && (
        <AnalysisModal
          item={selectedItemForAnalysis}
          isOpen={isAnalysisModalOpen}
          onClose={() => setIsAnalysisModalOpen(false)}
          onKeywordSearch={handleKeywordSearchFromModal}
        />
      )}
    </div>
  );
}

export default function AuctionsPage() {
  return (
    <Suspense fallback={<ItemGridLoadingSkeleton count={8} />}>
      <AuctionsPageContent />
    </Suspense>
  );
}
