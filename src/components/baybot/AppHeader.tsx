
import type React from 'react';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { popularSearchTerms } from '@/lib/ebay-mock-api';


interface AppHeaderProps {
  currentView: 'deals' | 'auctions';
  onViewChange: (view: 'deals' | 'auctions') => void;
  onSearch: (query: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void; // Added for direct control from header
}

export const AppHeader: React.FC<AppHeaderProps> = ({ currentView, onViewChange, onSearch, searchQuery, setSearchQuery }) => {
  
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchQuery);
  };

  const handleLogoClick = () => {
    if (popularSearchTerms.length > 0) {
      const randomTerm = popularSearchTerms[Math.floor(Math.random() * popularSearchTerms.length)];
      setSearchQuery(randomTerm); // Update input field and trigger HomePage's useEffect via state change

      if (currentView !== 'deals') {
        onViewChange('deals'); // Switch to deals view, HomePage useEffect will use new searchQuery
      } else {
        // If already on deals, the change in searchQuery (from setSearchQuery) will trigger
        // HomePage's useEffect to reload with the new randomTerm.
      }
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/60 backdrop-blur-lg supports-[backdrop-filter]:bg-background/40">
      <div className="container flex h-16 max-w-screen-2xl items-center">
        <div className="ml-2 mr-4 flex items-center md:ml-4"> {/* Added ml-2 for small screens, ml-4 for md+ */}
          <button 
            onClick={handleLogoClick} 
            className="text-xl font-headline font-bold text-foreground hover:text-primary transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            aria-label="BayBot - Search random deals"
          >
            BayBot
          </button>
        </div>
        
        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <div className="w-full flex-1 md:w-auto md:flex-none">
            <form onSubmit={handleSearchSubmit} className="flex w-full md:w-80 items-center space-x-2">
              <Input
                type="search"
                placeholder="Search items..."
                className="h-9 flex-1 bg-input/50 backdrop-blur-sm border-border/50 focus:bg-input/70"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Button type="submit" size="sm" className="h-9 interactive-glow">
                <Search className="h-4 w-4" />
                <span className="sr-only">Search</span>
              </Button>
            </form>
          </div>
          
          <nav className="flex items-center">
             <Tabs value={currentView} onValueChange={(value) => onViewChange(value as 'deals' | 'auctions')} className="hidden md:block">
              <TabsList className="bg-muted/50 backdrop-blur-sm">
                <TabsTrigger value="deals" className="baybot-tabs-trigger">Deals</TabsTrigger>
                <TabsTrigger value="auctions" className="baybot-tabs-trigger">Auctions</TabsTrigger>
              </TabsList>
            </Tabs>
          </nav>
        </div>
      </div>
       <div className="md:hidden p-2 border-t border-border/40">
          <Tabs value={currentView} onValueChange={(value) => onViewChange(value as 'deals' | 'auctions')} className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-muted/50 backdrop-blur-sm">
              <TabsTrigger value="deals" className="baybot-tabs-trigger">Deals</TabsTrigger>
              <TabsTrigger value="auctions" className="baybot-tabs-trigger">Auctions</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
    </header>
  );
};
