import type React from 'react';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Zap } from "lucide-react";

interface AppHeaderProps {
  currentView: 'deals' | 'auctions';
  onViewChange: (view: 'deals' | 'auctions') => void;
  onSearch: (query: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ currentView, onViewChange, onSearch, searchQuery, setSearchQuery }) => {
  
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchQuery);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 max-w-screen-2xl items-center">
        <div className="mr-4 flex items-center">
          <Zap className="h-6 w-6 mr-2 text-primary" />
          <h1 className="text-xl font-headline font-bold">BayBot</h1>
        </div>
        
        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <div className="w-full flex-1 md:w-auto md:flex-none">
            <form onSubmit={handleSearchSubmit} className="flex w-full md:w-80 items-center space-x-2">
              <Input
                type="search"
                placeholder="Search items..."
                className="h-9 flex-1"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Button type="submit" size="sm" className="h-9">
                <Search className="h-4 w-4" />
                <span className="sr-only">Search</span>
              </Button>
            </form>
          </div>
          
          <nav className="flex items-center">
             <Tabs value={currentView} onValueChange={(value) => onViewChange(value as 'deals' | 'auctions')} className="hidden md:block">
              <TabsList>
                <TabsTrigger value="deals">Deals</TabsTrigger>
                <TabsTrigger value="auctions">Auctions</TabsTrigger>
              </TabsList>
            </Tabs>
          </nav>
        </div>
      </div>
       <div className="md:hidden p-2 border-t border-border/40">
          <Tabs value={currentView} onValueChange={(value) => onViewChange(value as 'deals' | 'auctions')} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="deals">Deals</TabsTrigger>
              <TabsTrigger value="auctions">Auctions</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
    </header>
  );
};
